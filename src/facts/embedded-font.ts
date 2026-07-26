/**
 * scope `embedded-font` の fact 抽出。
 *
 * **フォント辞書は委譲先が書いたものを自分の目で開く。** pdf-lib は自分が書いた辞書を
 * そのまま読み返すので、「CFF なのに FontFile2 と名乗っている」は pdf-lib の API 越しには
 * 見えない。ここではストリームを復号して **sfnt のテーブルディレクトリを直接読む**。
 */

import {
  decodePDFRawStream,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';
import type { Facts, Subject } from '../types.js';

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

function nameValue(dict: PDFDict, key: string): string | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.decodeText() : undefined;
}

/**
 * 文書中の埋め込みフォントを 1 つずつ subject にする。
 * FontDescriptor を軸に、参照元のフォント辞書（/Subtype・/BaseFont）を逆引きする。
 */
export function extractEmbeddedFontFacts(doc: PDFDocument, given: Facts): Subject[] {
  const context = doc.context;
  const fontByDescriptor = new Map<string, { subtype?: string; baseFont?: string }>();

  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (nameValue(object, 'Type') !== 'Font') continue;
    const descriptor = object.get(PDFName.of('FontDescriptor'));
    if (descriptor instanceof PDFRef) {
      fontByDescriptor.set(descriptor.toString(), {
        subtype: nameValue(object, 'Subtype'),
        baseFont: nameValue(object, 'BaseFont'),
      });
    }
  }

  const subjects: Subject[] = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (nameValue(object, 'Type') !== 'FontDescriptor') continue;

    const font = fontByDescriptor.get(ref.toString()) ?? {};
    let fontFileKey = 'none';
    let streamRef: unknown;
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      if (object.has(PDFName.of(key))) {
        fontFileKey = key;
        streamRef = object.get(PDFName.of(key));
      }
    }

    const facts: Facts = {
      'descriptor.fontFileKey': fontFileKey,
      'descriptor.fontName': nameValue(object, 'FontName') ?? null,
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

    if (streamRef !== undefined) {
      const stream = context.lookup(streamRef as PDFRef);
      if (stream instanceof PDFRawStream) {
        facts['stream.dict.Subtype'] = nameValue(stream.dict, 'Subtype') ?? null;
        const length1 = stream.dict.get(PDFName.of('Length1'));
        facts['stream.dict.Length1'] = length1 instanceof PDFNumber ? length1.asNumber() : null;

        const decoded = decodePDFRawStream(stream).decode();
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
      label: String(facts['font.baseFont'] ?? ref.toString()),
      scope: 'embedded-font',
      facts,
    });
  }
  return subjects;
}
