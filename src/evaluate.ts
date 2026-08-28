/**
 * 述語評価器 — 純粋関数だけで書く。
 *
 * **同じ facts からは常に同じ結果**を返す（evaluate_policy のルールエンジンと同じ規律）。
 * ここに I/O・時刻・乱数を持ち込まないこと。判定の再現性がこのパッケージの価値であり、
 * テーブルと評価意味論が同一バージョンで結束していることがその担保になっている。
 *
 * 唯一の実行時依存は normativepdf の `parsePdfDate`（§7.9.4 の文法）である。純粋関数で、
 * I/O も時刻も持たない。自前の正規表現を捨てたのは、条文の細目——アポストロフィと
 * 分オフセットの前後関係（R-7.9.4-14 / -15）や既定値規則（R-7.9.4-16）——を
 * 2 か所で持たないため。
 */

import { parsePdfDate as parsePdfDateFields } from 'normativepdf';
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
 * **公開しているのはこの形（epoch ms）である。** 文法の解釈は normativepdf に置き、
 * ここは `PdfDate` の各欄を UT へ畳む変換だけを持つ。`dateEquiv` 述語が数値の比較を
 * 前提にしているので、戻り値の形は変えない。欄そのものが要る消費者は
 * normativepdf の `parsePdfDate` を直接呼ぶこと。
 *
 * UT 情報が無い（`utRelationship === null`）ときは GMT とみなす（R-7.9.4-17）。
 *
 * ⚠️ 既知の欠陥（移行前からある。ここでは直さない）: `Date.UTC` は年 0〜99 を
 * 1900〜1999 に写す。`D:0050...` は 1950 年になる。直すと A/B に差が出て、
 * pdf-lib 撤去による差と混ざるため、別の変更で直す。
 */
export function parsePdfDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = parsePdfDateFields(value);
  if (parsed === null) return null;
  const signed =
    parsed.utRelationship === '+' ? 1 : parsed.utRelationship === '-' ? -1 : 0;
  const offsetMinutes = signed * (parsed.offsetHours * 60 + parsed.offsetMinutes);
  return (
    Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
    ) -
    offsetMinutes * 60_000
  );
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
    // 文脈を持つ制約（業界慣行との齟齬など）は、それが読み手に届かないと
    // 「技術的に正しいが誤読される報告」になる。fail と同じ場所で運ぶ
    ...(assertion.note === undefined ? {} : { note: assertion.note }),
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
          ...(assertion.note === undefined ? {} : { note: assertion.note }),
        });
      }
    }
  }
  return failures;
}
