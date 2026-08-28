/**
 * `@shuji-bonji/pdf-constraints`
 *
 * ISO 32000 の条文を「ファイルが構造上どういう状態か」へ写像した制約テーブルと、
 * その決定論的評価器。**条文原文は持たず**（pdf-spec の役割）、**verdict も出さない**
 * （evaluate_policy の役割）。制約ごとに pass / fail / not_applicable /
 * needs_external_fact の 4 状態までしか言わない。
 *
 * fail が無いことは「収録した制約の範囲で反証できなかった」以上を意味しない。
 * 適合の証明ではない。
 *
 * **入口はバイト列とパスの 2 つ**（`checkBytes` / `checkFile`）。0.4.0 で
 * `collectSubjects` / `extractors` / `FactExtractor` の公開をやめ、fact の抽出は
 * 内部に閉じた。抽出器は差し替えうるもので、その型に外から依存されると
 * 読み口を替えるたびに公開面が動く。外部の拡張点として必要になったときに、
 * パーサ非依存の形で出し直す。
 */

export { type CheckOptions, checkBytes, checkFile, listTables, loadTable } from './check.js';
export {
  evaluateConstraint,
  evaluateDocumentAsserts,
  evaluatePredicate,
  parsePdfDate,
} from './evaluate.js';
export type {
  Assertion,
  CheckReport,
  Constraint,
  ConstraintResult,
  ConstraintStatus,
  ConstraintTable,
  Facts,
  Failure,
  Observation,
  Predicate,
  PredicateOp,
  Scope,
  Subject,
} from './types.js';
