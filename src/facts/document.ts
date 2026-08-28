/**
 * scope `document` の fact 抽出（Info 辞書と XMP）。
 *
 * XMP は**外形しか見ない**（xpacket + x:xmpmeta があるか）。R-14.3.2-2 は文法が
 * ISO 16684-1 に従うことまで要求するが、その規格は family のコーパス外なので
 * ここでの検査は近似である — テーブル側の `notMapped` にその旨を書いてある。
 */

import { dictGet, type PdfDocument } from 'normativepdf';
import type { Facts, Subject } from '../types.js';
import { asDict, asStream, decodedBytes, has, lookup, nameOf, textOf } from './cos.js';

export async function extractDocumentFacts(doc: PdfDocument, given: Facts): Promise<Subject> {
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

  const info = asDict(await lookup(doc, dictGet(doc.trailer, 'Info')));
  if (info !== null) {
    facts['doc.info.CreationDate'] = textOf(dictGet(info, 'CreationDate'));
    facts['doc.info.ModDate'] = textOf(dictGet(info, 'ModDate'));
    const trapped = dictGet(info, 'Trapped');
    if (trapped !== undefined) {
      // R-14.3.3-5/-6: name の True / False であって boolean ではない
      facts['doc.info.TrappedKind'] =
        trapped.kind === 'name'
          ? `name:${trapped.value}`
          : trapped.kind === 'boolean'
            ? 'boolean'
            : 'other';
    }
  }

  const catalog = asDict(await doc.getCatalog().catch(() => undefined));
  const metadata = catalog === null ? null : asStream(await lookup(doc, dictGet(catalog, 'Metadata')));
  if (metadata !== null) {
    facts['doc.xmp.exists'] = true;
    facts['doc.xmp.dict.Type'] = nameOf(dictGet(metadata.dict, 'Type'));
    facts['doc.xmp.dict.Subtype'] = nameOf(dictGet(metadata.dict, 'Subtype'));
    try {
      const bytes = has(metadata.dict, 'Filter') ? await decodedBytes(doc, metadata) : metadata.raw;
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
