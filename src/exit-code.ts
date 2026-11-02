/**
 * CLI の終了コード（openspec/specs/check の SPEC-CONSTRAINTS-CHECK-005）。
 *
 *   0 = 違反なし（判定した結果がある。収録した制約の範囲で反証できなかった。適合の証明ではない）
 *   1 = 違反あり
 *   2 = 判定不能（判定した結果が 1 つも無く、外部事実の不足で止まった結果だけがある）
 *
 * 違反の判定を先に置く。`needs_external_fact` が混ざっていても、違反が見つかったことは確かなので 1。
 * `not_applicable` は条件を見て「当てはまらない」と決めた結果なので、判定に数える。
 */

import type { CheckReport } from './types.js';

export function exitCodeFor(report: CheckReport): 0 | 1 | 2 {
  if (report.violations > 0) return 1;
  const decided = report.results.some((result) => result.status !== 'needs_external_fact');
  const undecided = report.results.some((result) => result.status === 'needs_external_fact');
  return !decided && undecided ? 2 : 0;
}
