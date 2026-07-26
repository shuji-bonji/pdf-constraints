/**
 * 高水準 API — ファイルを読んでテーブルを当てる。
 *
 * ここが CLI と pdf-verify-mcp の `validate_clauses` の共通入口になる。
 * 返り値には**必ずテーブルとパッケージの版を含める**（同じ facts から同じ結果が出ることの
 * 由来を「どの版のテーブルで判定したか」まで言えるようにするため。specs/18 §4.5）。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { evaluateConstraint, evaluateDocumentAsserts } from './evaluate.js';
import { collectSubjects } from './facts/registry.js';
import type { CheckReport, ConstraintTable, Facts, Scope } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const tablesDir = join(here, '..', 'tables');
const packageVersion: string = createRequire(import.meta.url)('../package.json').version;

/** 同梱テーブルの名前一覧 */
export function listTables(): string[] {
  return ['font-embedding', 'document-metadata'];
}

export function loadTable(name: string): ConstraintTable {
  return JSON.parse(readFileSync(join(tablesDir, `${name}.json`), 'utf8')) as ConstraintTable;
}

export interface CheckOptions {
  /** 対象ドメイン。省略時は同梱テーブル全部 */
  domains?: string[];
  /**
   * 外部事実（`isSubset` など）。**ファイル単体からは決定できない事実**を供給する口。
   * 渡さなければ、それを要求する制約は `needs_external_fact` に縮退する（沈黙合格しない）。
   */
  given?: Record<string, unknown>;
}

/** PDF のバイト列に制約テーブルを当てる */
export async function checkBytes(
  bytes: Uint8Array,
  options: CheckOptions = {},
): Promise<CheckReport> {
  const tables = (options.domains ?? listTables()).map(loadTable);
  const given: Facts = Object.fromEntries(
    Object.entries(options.given ?? {}).map(([key, value]) => [`given.${key}`, value]),
  );

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const scopes: Scope[] = tables.flatMap((t) => t.constraints.map((c) => c.appliesTo));
  const subjectsByScope = collectSubjects(doc, scopes, given);

  const report: CheckReport = {
    packageVersion,
    tables: tables.map((t) => ({ name: t.name, version: t.version })),
    subjects: [...subjectsByScope.values()].reduce((sum, list) => sum + list.length, 0),
    results: [],
    violations: 0,
  };

  for (const table of tables) {
    for (const constraint of table.constraints) {
      const subjects = subjectsByScope.get(constraint.appliesTo) ?? [];
      for (const subject of subjects) {
        const result = evaluateConstraint(constraint, subject.facts);
        result.target = subject.label;
        report.results.push(result);
        report.violations += result.failures?.length ?? 0;
      }
      // 文書横断の検査（subject を跨ぐので個別評価とは別立て）
      const crossFailures = evaluateDocumentAsserts(constraint, subjects, given);
      if (crossFailures.length > 0) {
        report.results.push({
          constraint: constraint.id,
          target: '(document)',
          status: 'fail',
          failures: crossFailures,
        });
        report.violations += crossFailures.length;
      }
    }
  }

  return report;
}

/** ファイルパス版 */
export async function checkFile(path: string, options: CheckOptions = {}): Promise<CheckReport> {
  return checkBytes(readFileSync(path), options);
}
