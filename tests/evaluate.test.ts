/**
 * 評価器の単体テスト。
 *
 * 検体経由の回帰（check.test.ts）は「実装が全体として動くか」を見るが、
 * **境界値は検体では踏めない**（テストが緑でも条件を一度も通っていない、が起きる）。
 * ここでは述語ごとに真と偽の両方を当てる。
 */

import { describe, expect, it } from 'vitest';
import { evaluateConstraint, evaluatePredicate, parsePdfDate } from '../src/evaluate.js';
import type { Constraint } from '../src/types.js';

describe('parsePdfDate（ISO 32000-2 §7.9.4）', () => {
  it('Z 表記と省略形を解釈する', () => {
    expect(parsePdfDate('D:20260725221519Z')).toBe(Date.parse('2026-07-25T22:15:19Z'));
    // R-7.9.4-16: 月日は 01、他は 0 が既定値
    expect(parsePdfDate('D:2026')).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('UT オフセットを換算する（表記でなく時点で比べるため）', () => {
    expect(parsePdfDate("D:20260726093000+09'00'")).toBe(Date.parse('2026-07-26T00:30:00Z'));
    expect(parsePdfDate("D:20260725133000-09'00'")).toBe(Date.parse('2026-07-25T22:30:00Z'));
  });

  it('R-7.9.4-17: UT 情報が無ければ GMT とみなす', () => {
    expect(parsePdfDate('D:20260725221519')).toBe(Date.parse('2026-07-25T22:15:19Z'));
  });

  it('文法違反と値域外は null（壊れた値を「等価」に倒さない）', () => {
    expect(parsePdfDate('2026/07/25 22:15:36')).toBeNull(); // D: が無い
    expect(parsePdfDate('D:20261325000000Z')).toBeNull(); // 13 月
    expect(parsePdfDate('D:20260725256119Z')).toBeNull(); // 25 時
    expect(parsePdfDate(undefined)).toBeNull();
  });
});

describe('述語', () => {
  const facts = {
    'a.name': 'FontFile2',
    'a.tables': ['glyf', 'head', 'hhea'],
    'a.absent': null,
    'a.len': 120,
    'b.len': 120,
    'a.pdfDate': 'D:20200102030405Z',
    'b.isoDate': '2020-01-02T03:04:05Z',
    'b.otherDate': '2020-01-02T03:04:06Z',
    'a.tags': ['ABCDEF', 'GHIJKL'],
    'a.dupTags': ['ABCDEF', 'ABCDEF'],
  };
  const check = (op: string, fact: string, value?: unknown) =>
    // biome-ignore lint/suspicious/noExplicitAny: テスト内でのみ op を文字列から渡す
    evaluatePredicate({ fact, op: op as any, value }, facts);

  it('eq / in', () => {
    expect(check('eq', 'a.name', 'FontFile2')).toBe(true);
    expect(check('eq', 'a.name', 'FontFile3')).toBe(false);
    expect(check('in', 'a.name', ['FontFile', 'FontFile2'])).toBe(true);
    expect(check('in', 'a.name', ['FontFile3'])).toBe(false);
  });

  it('exists は「無いことの検査」にも使える（shall not 系）', () => {
    expect(check('exists', 'a.name', true)).toBe(true);
    expect(check('exists', 'a.absent', true)).toBe(false);
    expect(check('exists', 'a.absent', false)).toBe(true);
  });

  it('matches / superset', () => {
    expect(check('matches', 'a.name', '^Font')).toBe(true);
    expect(check('matches', 'a.len', '^120')).toBe(false); // 数値には当てない
    expect(check('superset', 'a.tables', ['glyf', 'head'])).toBe(true);
    expect(check('superset', 'a.tables', ['glyf', 'loca'])).toBe(false);
  });

  it('eqFact は別の fact と突き合わせる', () => {
    expect(check('eqFact', 'a.len', 'b.len')).toBe(true);
    expect(check('eqFact', 'a.len', 'a.absent')).toBe(false);
  });

  it('dateEquiv は表記でなく時点で比べる', () => {
    expect(check('dateEquiv', 'a.pdfDate', 'b.isoDate')).toBe(true);
    expect(check('dateEquiv', 'a.pdfDate', 'b.otherDate')).toBe(false); // 1 秒差
    expect(check('dateEquiv', 'a.name', 'b.isoDate')).toBe(false); // 日付でない
  });

  it('allDistinct', () => {
    expect(check('allDistinct', 'a.tags')).toBe(true);
    expect(check('allDistinct', 'a.dupTags')).toBe(false);
  });

  it('未知の op は例外にする（黙って違反にしない）', () => {
    expect(() => check('startsWith', 'a.name', 'Font')).toThrow(/unknown predicate op/);
  });
});

describe('制約の状態遷移', () => {
  const constraint: Constraint = {
    id: 'CT-TEST-1',
    title: 'test',
    clauses: ['R-0-0'],
    source: { spec: 'pdf20', section: '0' },
    level: 'shall',
    appliesTo: 'document',
    when: [{ fact: 'given.flag', op: 'eq', value: true }],
    assert: [{ fact: 'doc.value', op: 'eq', value: 1, onFail: 'wrong' }],
  };

  it('given が無ければ needs_external_fact（pass にも fail にも倒さない）', () => {
    const result = evaluateConstraint(constraint, { 'doc.value': 2 });
    expect(result.status).toBe('needs_external_fact');
    expect(result.missing).toBe('given.flag');
  });

  it('given が false なら not_applicable', () => {
    expect(evaluateConstraint(constraint, { 'given.flag': false, 'doc.value': 2 }).status).toBe(
      'not_applicable',
    );
  });

  it('given が true なら実際に判定する', () => {
    expect(evaluateConstraint(constraint, { 'given.flag': true, 'doc.value': 1 }).status).toBe(
      'pass',
    );
    expect(evaluateConstraint(constraint, { 'given.flag': true, 'doc.value': 2 }).status).toBe(
      'fail',
    );
  });

  it('onlyWhen を満たさない assert は検査自体を飛ばす', () => {
    const conditional: Constraint = {
      ...constraint,
      when: [],
      assert: [
        {
          fact: 'doc.value',
          op: 'eq',
          value: 1,
          onFail: 'wrong',
          onlyWhen: [{ fact: 'doc.kind', op: 'eq', value: 'A' }],
        },
      ],
    };
    expect(evaluateConstraint(conditional, { 'doc.kind': 'B', 'doc.value': 2 }).status).toBe(
      'pass',
    );
    expect(evaluateConstraint(conditional, { 'doc.kind': 'A', 'doc.value': 2 }).status).toBe(
      'fail',
    );
  });

  it('subjectNote を持つ制約の failure は traceOnly になる', () => {
    const traced: Constraint = {
      ...constraint,
      when: [],
      subjectNote: '主語は processor',
    };
    const result = evaluateConstraint(traced, { 'doc.value': 2 });
    expect(result.failures?.[0].traceOnly).toBe(true);
  });
});
