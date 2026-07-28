/**
 * scope → fact 抽出器の対応表。
 *
 * ドメインを増やすときに触るのはここ（`annotation` / `page` を足す想定）。
 * 抽出器は将来 reader の観測や normativepdf の読み口に差し替えうるので、
 * 呼び出し側は必ずこのレジストリ越しに使うこと（specs/18 §6）。
 */

import type { PDFDocument } from 'pdf-lib';
import type { Facts, Scope, Subject } from '../types.js';
import { extractAnnotationFacts } from './annotation.js';
import { extractDocumentFacts } from './document.js';
import { extractEmbeddedFontFacts } from './embedded-font.js';

export type FactExtractor = (doc: PDFDocument, given: Facts) => Subject[];

export const extractors: Record<Scope, FactExtractor> = {
  'embedded-font': extractEmbeddedFontFacts,
  document: (doc, given) => [extractDocumentFacts(doc, given)],
  annotation: extractAnnotationFacts,
};

/** テーブル群が要求する scope の分だけ subject を集める */
export function collectSubjects(
  doc: PDFDocument,
  scopes: Iterable<Scope>,
  given: Facts,
): Map<Scope, Subject[]> {
  const result = new Map<Scope, Subject[]>();
  for (const scope of new Set(scopes)) {
    result.set(scope, extractors[scope](doc, given));
  }
  return result;
}
