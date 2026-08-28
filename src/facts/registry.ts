/**
 * scope → fact 抽出器の対応表。
 *
 * ドメインを増やすときに触るのはここ（`page` を足す想定）。
 * 抽出器は将来 reader の観測に差し替えうるので、呼び出し側は必ず
 * このレジストリ越しに使うこと（specs/18 §6）。
 *
 * 抽出器が async なのは、normativepdf の `resolve` / `getObject` が async だから
 * （圧縮オブジェクトはフィルタ付きのオブジェクトストリームの中にある）。
 */

import type { PdfDocument } from 'normativepdf';
import type { Facts, Scope, Subject } from '../types.js';
import { extractAnnotationFacts } from './annotation.js';
import { extractDocumentFacts } from './document.js';
import { extractEmbeddedFontFacts } from './embedded-font.js';

export type FactExtractor = (doc: PdfDocument, given: Facts) => Promise<Subject[]>;

export const extractors: Record<Scope, FactExtractor> = {
  'embedded-font': extractEmbeddedFontFacts,
  document: async (doc, given) => [await extractDocumentFacts(doc, given)],
  annotation: extractAnnotationFacts,
};

/** テーブル群が要求する scope の分だけ subject を集める */
export async function collectSubjects(
  doc: PdfDocument,
  scopes: Iterable<Scope>,
  given: Facts,
): Promise<Map<Scope, Subject[]>> {
  const result = new Map<Scope, Subject[]>();
  for (const scope of new Set(scopes)) {
    result.set(scope, await extractors[scope](doc, given));
  }
  return result;
}
