/**
 * scope `document` の fact 抽出（Info 辞書と XMP）。
 *
 * XMP は**外形しか見ない**（xpacket + x:xmpmeta があるか）。R-14.3.2-2 は文法が
 * ISO 16684-1 に従うことまで要求するが、その規格は family のコーパス外なので
 * ここでの検査は近似である — テーブル側の `notMapped` にその旨を書いてある。
 */

import { decodeTextString } from 'normativepdf';
import { decodePDFRawStream, PDFDict, type PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import type { Facts, Subject } from '../types.js';

function nameValue(dict: PDFDict, key: string): string | undefined {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.decodeText() : undefined;
}

/**
 * Info の日付・文字列は PDFString / PDFHexString のどちらもありうる。
 *
 * 復号は normativepdf の `decodeTextString`（§7.9.2）に任せる。pdf-lib の
 * `decodeText()` は **UTF-8 の BOM（R-7.9.2.2.1-4）を扱わない**ので、
 * `EF BB BF` で始まる `/CreationDate` は PDFDocEncoding として読まれて日付にならない。
 *
 * 分岐の判定を `decodeText` から `asBytes` に変えてある。pdf-lib では PDFName も
 * `decodeText` を持つので、以前は名前オブジェクトもここでテキスト文字列として復号していた。
 * **名前はテキスト文字列ではない**（§7.3.5 と §7.9.2 は別の条項）。
 */
function stringValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const candidate = value as {
    asBytes?: () => number[] | Uint8Array;
    asString?: () => string;
  };
  if (typeof candidate.asBytes === 'function') {
    return decodeTextString(Uint8Array.from(candidate.asBytes()));
  }
  if (typeof candidate.asString === 'function') return candidate.asString();
  return String(value).replace(/^\(|\)$/g, '');
}

export function extractDocumentFacts(doc: PDFDocument, given: Facts): Subject {
  const context = doc.context;
  const facts: Facts = {
    'doc.xmp.exists': false,
    'doc.xmp.dict.Type': null,
    'doc.xmp.dict.Subtype': null,
    'doc.xmp.hasXmpEnvelope': null,
    'doc.xmp.CreateDate': null,
    'doc.xmp.ModifyDate': null,
    'doc.info.CreationDate': null,
    'doc.info.ModDate': null,
    'doc.info.TrappedKind': null,
    ...given,
  };

  const infoRef = context.trailerInfo?.Info;
  const info = infoRef ? context.lookup(infoRef) : undefined;
  if (info instanceof PDFDict) {
    facts['doc.info.CreationDate'] = stringValue(info.get(PDFName.of('CreationDate')));
    facts['doc.info.ModDate'] = stringValue(info.get(PDFName.of('ModDate')));
    const trapped = info.get(PDFName.of('Trapped'));
    if (trapped !== undefined) {
      // R-14.3.3-5/-6: name の True / False であって boolean ではない
      facts['doc.info.TrappedKind'] =
        trapped instanceof PDFName
          ? `name:${trapped.decodeText()}`
          : trapped.constructor?.name === 'PDFBool'
            ? 'boolean'
            : 'other';
    }
  }

  const metadata = context.lookup(doc.catalog.get(PDFName.of('Metadata')));
  if (metadata instanceof PDFRawStream) {
    facts['doc.xmp.exists'] = true;
    facts['doc.xmp.dict.Type'] = nameValue(metadata.dict, 'Type') ?? null;
    facts['doc.xmp.dict.Subtype'] = nameValue(metadata.dict, 'Subtype') ?? null;
    try {
      const bytes = metadata.dict.has(PDFName.of('Filter'))
        ? decodePDFRawStream(metadata).decode()
        : metadata.contents;
      const text = new TextDecoder().decode(bytes);
      facts['doc.xmp.hasXmpEnvelope'] =
        /<\?xpacket begin=/.test(text) && /<x:xmpmeta[\s>]/.test(text);
      facts['doc.xmp.CreateDate'] =
        /<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/.exec(text)?.[1] ?? null;
      facts['doc.xmp.ModifyDate'] =
        /<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/.exec(text)?.[1] ?? null;
    } catch {
      // 復号できない XMP は「外形を満たさない」ではなく「読めなかった」— false に倒すと
      // 冤罪になるので、外形検査だけ false にし他は null（= 未取得）のままにする
      facts['doc.xmp.hasXmpEnvelope'] = false;
    }
  }

  return { label: '(document)', scope: 'document', facts };
}
