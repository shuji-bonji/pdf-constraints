/**
 * CLI の終了コード（openspec/specs/check の 005・006）。
 *
 * 0 / 1 / 2 のうち 2 は「判定できなかった」で、合格（0）と混ぜない。
 * 005 は終了コードを決める関数を直接、006 は dist/cli.js を子プロセスで起動して確かめる。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exitCodeFor } from '../src/exit-code.js';
import type { CheckReport, ConstraintResult } from '../src/types.js';

const root = join(import.meta.dirname, '..');

/** exitCodeFor が読むのは results と violations だけなので、観測の欄は最小にする */
function reportOf(results: ConstraintResult[], violations: number): CheckReport {
  const report = {
    packageVersion: '0.0.0',
    tables: [],
    observation: { xrefChain: 'complete', objects: 0, pagesReached: true, pages: 1 },
    subjects: results.length,
    results,
    violations,
  };
  return report as unknown as CheckReport;
}

const undecided: ConstraintResult = {
  constraint: 'CT-TEST-1',
  target: '(document)',
  status: 'needs_external_fact',
  missing: 'given.password',
};
const passed: ConstraintResult = { constraint: 'CT-TEST-2', target: 'a', status: 'pass' };
const failed: ConstraintResult = {
  constraint: 'CT-TEST-3',
  target: 'a',
  status: 'fail',
  failures: [{ clauses: ['R-0-0'], message: 'wrong', fact: 'x', actual: 1, traceOnly: false }],
};
const notApplicable: ConstraintResult = {
  constraint: 'CT-TEST-4',
  target: 'a',
  status: 'not_applicable',
};

describe('SPEC-CONSTRAINTS-CHECK-005 CLI の終了コードは、違反の有無と判定できたかを分けて返す', () => {
  it('SPEC-CONSTRAINTS-CHECK-005 全結果が needs_external_fact なら 2', () => {
    expect(exitCodeFor(reportOf([undecided, { ...undecided, constraint: 'CT-TEST-5' }], 0))).toBe(
      2,
    );
  });

  it('SPEC-CONSTRAINTS-CHECK-005 違反があれば 1', () => {
    expect(exitCodeFor(reportOf([failed, undecided], 1))).toBe(1);
  });

  it('SPEC-CONSTRAINTS-CHECK-005 判定した結果があり違反が無ければ 0', () => {
    expect(exitCodeFor(reportOf([passed, undecided], 0))).toBe(0);
  });

  it('SPEC-CONSTRAINTS-CHECK-005 not_applicable だけでも判定したとみなして 0', () => {
    expect(exitCodeFor(reportOf([notApplicable], 0))).toBe(0);
  });
});

describe('SPEC-CONSTRAINTS-CHECK-006 鍵が導けない暗号化文書を CLI に渡すと 2 で終わる', () => {
  it('SPEC-CONSTRAINTS-CHECK-006 パスワード付きの文書を CLI に渡す', () => {
    const cli = join(root, 'dist', 'cli.js');
    // 黙って飛ばさない — dist が無いなら、無いことを名指しして落とす
    expect(existsSync(cli), 'dist/cli.js が無い。npm run build の後に回す').toBe(true);
    const run = spawnSync(
      process.execPath,
      [cli, 'check', join(root, 'fixtures', 'ua-enc-aesv3-pw.pdf')],
      {
        encoding: 'utf8',
      },
    );
    expect(run.status).toBe(2);
    expect(run.stdout).toContain('Not decided');
  });
});
