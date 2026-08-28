/**
 * scope `embedded-font` の fact 抽出。
 *
 * **フォント辞書は委譲先が書いたものを自分の目で開く。** 高水準 API は自分が書いた辞書を
 * そのまま読み返すので、「CFF なのに FontFile2 と名乗っている」は API 越しには見えない。
 * ここではストリームを復号して **sfnt のテーブルディレクトリを直接読む**。
 */

import { type CosObject, dictGet, type PdfDocument } from 'normativepdf';
import type { Facts, Subject } from '../types.js';
import { asDict, asRef, asStream, decodedBytes, lookup, nameOf, numberOf } from './cos.js';

/** sfnt / bare CFF のコンテナ種別とテーブル一覧を、復号後のバイト列から読む */
function inspectProgram(bytes: Uint8Array): { container: string; tables: string[] } {
  if (bytes.length < 12) return { container: 'unknown', tables: [] };
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  const version = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];

  let container = 'unknown';
  if (version === 0x00010000 || tag === 'true') container = 'truetype';
  else if (tag === 'OTTO') container = 'otto';
  else if (tag === 'ttcf') container = 'ttc';
  else if (bytes[0] === 0x01 && bytes[1] === 0x00) return { container: 'bareCFF', tables: [] };
  if (container === 'unknown') return { container, tables: [] };

  const numTables = (bytes[4] << 8) | bytes[5];
  const tables: string[] = [];
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 4 > bytes.length) break;
    tables.push(String.fromCharCode(...bytes.slice(offset, offset + 4)));
  }
  return { container, tables };
}

interface Indirect {
  readonly key: string;
  readonly generation: number;
  readonly objectNumber: number;
  readonly object: CosObject;
}

/**
 * 間接オブジェクトを 1 つずつ読む。
 *
 * pdf-lib の `enumerateIndirectObjects()` に相当する。相互参照表に載っているものが
 * 全部で、**読めなかったものは飛ばす**（壊れた 1 件で文書全体を落とさない）。
 */
async function* indirectObjects(doc: PdfDocument): AsyncGenerator<Indirect> {
  for (const [objectNumber, entry] of doc.xref) {
    if (entry.type !== 'in-use' && entry.type !== 'compressed') continue;
    const generation = entry.type === 'in-use' ? entry.generation : 0;
    let object: CosObject;
    try {
      object = await doc.getObject(objectNumber, generation);
    } catch {
      continue;
    }
    yield { key: `${objectNumber} ${generation} R`, generation, objectNumber, object };
  }
}

/**
 * 文書中の埋め込みフォントを 1 つずつ subject にする。
 * FontDescriptor を軸に、参照元のフォント辞書（/Subtype・/BaseFont）を逆引きする。
 */
export async function extractEmbeddedFontFacts(doc: PdfDocument, given: Facts): Promise<Subject[]> {
  const fontByDescriptor = new Map<string, { subtype?: string; baseFont?: string }>();

  for await (const { object } of indirectObjects(doc)) {
    const dict = asDict(object);
    if (dict === null || nameOf(dictGet(dict, 'Type')) !== 'Font') continue;
    const descriptor = asRef(dictGet(dict, 'FontDescriptor'));
    if (descriptor !== null) {
      fontByDescriptor.set(`${descriptor.objectNumber} ${descriptor.generationNumber} R`, {
        subtype: nameOf(dictGet(dict, 'Subtype')) ?? undefined,
        baseFont: nameOf(dictGet(dict, 'BaseFont')) ?? undefined,
      });
    }
  }

  const subjects: Subject[] = [];
  for await (const { key, object } of indirectObjects(doc)) {
    const dict = asDict(object);
    if (dict === null || nameOf(dictGet(dict, 'Type')) !== 'FontDescriptor') continue;

    const font = fontByDescriptor.get(key) ?? {};
    let fontFileKey = 'none';
    let streamValue: CosObject | undefined;
    for (const name of ['FontFile', 'FontFile2', 'FontFile3']) {
      const value = dictGet(dict, name);
      if (value !== undefined) {
        fontFileKey = name;
        streamValue = value;
      }
    }

    const facts: Facts = {
      'descriptor.fontFileKey': fontFileKey,
      'descriptor.fontName': nameOf(dictGet(dict, 'FontName')),
      'font.subtype': font.subtype ?? null,
      'font.baseFont': font.baseFont ?? null,
      'stream.dict.Subtype': null,
      'stream.dict.Length1': null,
      'stream.decodedLength': null,
      'program.container': null,
      'program.sfntTables': [],
      'program.isCffBased': null,
      ...given,
    };

    if (streamValue !== undefined) {
      const stream = asStream(await lookup(doc, streamValue));
      if (stream !== null) {
        facts['stream.dict.Subtype'] = nameOf(dictGet(stream.dict, 'Subtype'));
        facts['stream.dict.Length1'] = numberOf(dictGet(stream.dict, 'Length1'));

        const decoded = await decodedBytes(doc, stream);
        facts['stream.decodedLength'] = decoded.length;
        const program = inspectProgram(decoded);
        facts['program.container'] = program.container;
        facts['program.sfntTables'] = program.tables;
        facts['program.isCffBased'] =
          program.container === 'otto' ||
          program.container === 'bareCFF' ||
          program.tables.includes('CFF ');
      }
    }

    subjects.push({
      label: String(facts['font.baseFont'] ?? key),
      scope: 'embedded-font',
      facts,
    });
  }
  return subjects;
}
