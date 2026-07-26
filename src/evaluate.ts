/**
 * 述語評価器 — 依存ゼロの純粋関数。
 *
 * **同じ facts からは常に同じ結果**を返す（evaluate_policy のルールエンジンと同じ規律）。
 * ここに I/O・時刻・乱数を持ち込まないこと。判定の再現性がこのパッケージの価値であり、
 * テーブルと評価意味論が同一バージョンで結束していることがその担保になっている。
 */

import type {
  Assertion,
  Constraint,
  ConstraintResult,
  Facts,
  Failure,
  Predicate,
  Subject,
} from './types.js';

/**
 * PDF 日付文字列（ISO 32000-2 §7.9.4）→ epoch ms。文法違反・値域外は null。
 *
 * §7.9.4 の既定値規則（MM/DD は 01、他は 0）と UT オフセットを解釈する。
 * 「D:」以降は前方のフィールドが揃っている限り任意の位置で切れてよい（R-7.9.4-12）。
 */
export function parsePdfDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Z+-])(?:(\d{2})'?(\d{2})?'?)?)?$/.exec(
      value,
    );
  if (!m) return null;
  const [
    ,
    year,
    month = '01',
    day = '01',
    hour = '00',
    min = '00',
    sec = '00',
    sign,
    oh = '00',
    om = '00',
  ] = m;
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(min);
  const s = Number(sec);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const offsetMinutes =
    sign === '+' || sign === '-' ? (Number(oh) * 60 + Number(om)) * (sign === '-' ? -1 : 1) : 0; // R-7.9.4-17: UT 情報が無ければ GMT とみなす
  return Date.UTC(Number(year), mo - 1, d, h, mi, s) - offsetMinutes * 60_000;
}

/** 述語 1 つを評価する */
export function evaluatePredicate(predicate: Predicate, facts: Facts): boolean {
  const actual = facts[predicate.fact];
  switch (predicate.op) {
    case 'eq':
      return actual === predicate.value;
    case 'in':
      return Array.isArray(predicate.value) && predicate.value.includes(actual);
    case 'exists':
      return (actual !== null && actual !== undefined) === predicate.value;
    case 'matches':
      return typeof actual === 'string' && new RegExp(String(predicate.value)).test(actual);
    case 'superset':
      return (
        Array.isArray(actual) &&
        Array.isArray(predicate.value) &&
        predicate.value.every((needle) => actual.includes(needle))
      );
    case 'eqFact':
      return actual === facts[String(predicate.value)];
    case 'dateEquiv': {
      // 「fully equivalent」は文字列一致ではなく**同一時点**（R-14.3.4-2/-4/-5）。
      // 左は PDF 日付文字列、右は fact 参照（ISO 8601）。
      const left = parsePdfDate(actual);
      const right = Date.parse(String(facts[String(predicate.value)]));
      return left !== null && !Number.isNaN(right) && left === right;
    }
    case 'allDistinct':
      return Array.isArray(actual) && new Set(actual).size === actual.length;
    default: {
      // 未知の op はテーブルと評価器の版ずれを意味する。黙って false（= 違反）にしない
      const exhaustive: never = predicate.op;
      throw new Error(`unknown predicate op: ${String(exhaustive)}`);
    }
  }
}

function checkAssertion(
  assertion: Assertion,
  facts: Facts,
  constraint: Constraint,
): Failure | undefined {
  if (assertion.onlyWhen && !assertion.onlyWhen.every((p) => evaluatePredicate(p, facts))) {
    return undefined;
  }
  if (evaluatePredicate(assertion, facts)) return undefined;
  return {
    clauses: constraint.clauses,
    message: assertion.onFail,
    fact: assertion.fact,
    actual: facts[assertion.fact],
    traceOnly: constraint.subjectNote !== undefined,
  };
}

/**
 * 制約 1 件を 1 つの subject に対して評価する。
 *
 * `given.*`（外部事実）が未供給のときは **pass にも fail にも倒さず** `needs_external_fact` を返す。
 * 「サブセットか否か」のようにファイル単体から決定できない事実があり、
 * それを既定値で埋めると沈黙合格（または冤罪）になるため。
 */
export function evaluateConstraint(constraint: Constraint, facts: Facts): ConstraintResult {
  const base = { constraint: constraint.id, target: '' };

  for (const condition of constraint.when) {
    if (condition.fact.startsWith('given.') && facts[condition.fact] === undefined) {
      return { ...base, status: 'needs_external_fact', missing: condition.fact };
    }
    if (!evaluatePredicate(condition, facts)) {
      return { ...base, status: 'not_applicable' };
    }
  }

  const failures = constraint.assert
    .map((assertion) => checkAssertion(assertion, facts, constraint))
    .filter((f): f is Failure => f !== undefined);

  return failures.length > 0 ? { ...base, status: 'fail', failures } : { ...base, status: 'pass' };
}

/**
 * 文書横断の検査。今は「同一フォントの別サブセットが別タグを持つか」（R-9.9.2-3 後段）のみ。
 * 合成 fact `doc.subsetTagsPerBaseName` を subjects から組み立てて評価する。
 */
export function evaluateDocumentAsserts(
  constraint: Constraint,
  subjects: Subject[],
  facts: Facts,
): Failure[] {
  const failures: Failure[] = [];
  for (const assertion of constraint.documentAssert ?? []) {
    if (assertion.fact !== 'doc.subsetTagsPerBaseName' || assertion.op !== 'allDistinct') continue;
    // サブセット前提の検査なので、given が無ければ黙って飛ばす（needs_external_fact は
    // 制約本体の評価が返している）
    for (const condition of constraint.when) {
      if (condition.fact.startsWith('given.') && !evaluatePredicate(condition, facts)) return [];
    }

    const tagsByBaseName = new Map<string, string[]>();
    for (const subject of subjects) {
      const parsed = /^([A-Z]{6})\+(.+)$/.exec(String(subject.facts['font.baseFont'] ?? ''));
      if (!parsed) continue;
      const [, tag, baseName] = parsed;
      tagsByBaseName.set(baseName, [...(tagsByBaseName.get(baseName) ?? []), tag]);
    }
    for (const [baseName, tags] of tagsByBaseName) {
      if (new Set(tags).size !== tags.length) {
        failures.push({
          clauses: constraint.clauses,
          message: `${assertion.onFail} (base=${baseName}, tags=${tags.join(',')})`,
          fact: assertion.fact,
          actual: tags,
          traceOnly: constraint.subjectNote !== undefined,
        });
      }
    }
  }
  return failures;
}
