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
import { type DocumentScope, openDocument } from '@normativepdf/recover';
import { readPageTree } from 'normativepdf';
import { evaluateConstraint, evaluateDocumentAsserts } from './evaluate.js';
import { collectSubjects } from './facts/registry.js';
import type { CheckReport, ConstraintTable, Facts, ObservedScope, Scope } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const tablesDir = join(here, '..', 'tables');
const packageVersion: string = createRequire(import.meta.url)('../package.json').version;

/** 同梱テーブルの名前一覧 */
export function listTables(): string[] {
  return ['font-embedding', 'document-metadata', 'annotation'];
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

/**
 * `DocumentScope` から、出力に載せてよい項目だけを取り出す。
 *
 * 🔴 `encryptDict` は COS 辞書なので出さない（JSON にすると内部表現が出る）。
 * 🔴 これは**判定ではない**。「どこまで読んだか」であって「適合しているか」ではない。
 */
function toObservedScope(scope: DocumentScope): ObservedScope {
  return {
    recovered: scope.recovered,
    refusal: scope.refusal,
    chainStop: scope.chainStop,
    newestSectionUnreadable: scope.newestSectionUnreadable,
    sections: scope.sections,
    continuedPastStop: scope.continuedPastStop,
    filledFromScan: scope.filledFromScan,
    reconstructed: scope.reconstructed,
    objects: scope.objects,
    encrypted: scope.encrypted,
    authenticated: scope.authenticated,
  };
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

  // `updateMetadata: false` は pdf-lib が Info を書き換えないようにするための引数だった。
  // normativepdf は読むだけなので要らない。暗号化文書は材料化の時点で復号される（§7.6）。
  //
  // 🔴 `parsePdf` ではなく `openDocument`（`@normativepdf/recover`）を通す。
  // コアは条文に反する文書を受け取らずに例外を投げる。それは正しいが、そこで
  // 止めると**その文書について何も言えない** —— 検体 2,931 件のうち 15 件が
  // `ParseError` で 1 つの制約も当たっていなかった（2026-08-29 実測）。
  // 回復方針で組み立てた文書は「どこまで読んだか」を `scope` が申告するので、
  // 読み手は「違反が無い」と「そこを見ていない」を分けられる（ADR-0010 受入 3）。
  const { doc, scope } = await openDocument(bytes);
  const scopes: Scope[] = tables.flatMap((t) => t.constraints.map((c) => c.appliesTo));
  const subjectsByScope = await collectSubjects(doc, scopes, given);

  // どこまで読めたか。判定ではないが、**判定の射程**なので必ず載せる。
  // 「注釈が無い」と「注釈を読めなかった」を利用者が見分けられるようにする。
  const tree = await readPageTree({
    resolve: (value) => doc.resolve(value),
    getCatalog: () => doc.getCatalog(),
  }).catch(() => null);

  const report: CheckReport = {
    packageVersion,
    tables: tables.map((t) => ({ name: t.name, version: t.version })),
    observation: {
      xrefChain: scope.chainStop.kind,
      objects: scope.objects,
      pagesReached: tree?.reached ?? false,
      pages: tree?.pages.length ?? 0,
      scope: toObservedScope(scope),
    },
    subjects: [...subjectsByScope.values()].reduce((sum, list) => sum + list.length, 0),
    results: [],
    violations: 0,
  };

  // 🔴 **鍵が導けない暗号化文書では、オブジェクトを 1 つも読めていない。**
  //
  // `openDocument` は文書を返すが、復号器を付けないのでオブジェクトを渡さない
  // （暗号文を平文の顔で配らないため・ADR-0008）。その状態で制約を当てると、
  // fact がすべて null になり、`onlyWhen: exists` で守られた assert は飛ばされ、
  // **違反 0 = pass** になる。「違反していない」と「その対象を観測していない」が
  // 同じ顔をする（0.5.0 で実際にそうなった —— 検体 2 件で CT-META-3 が pass）。
  //
  // パスワードは**ファイル単体からは決定できない事実**である。この package が
  // そういう事実に対して持っている答えは `needs_external_fact` で、これはその定義
  // そのものにあたる。判定へ進まず、全制約をそこへ落とす。
  if (scope.encrypted && !scope.authenticated) {
    for (const table of tables) {
      for (const constraint of table.constraints) {
        report.results.push({
          constraint: constraint.id,
          target: '(document)',
          status: 'needs_external_fact',
          missing: 'given.password',
        });
      }
    }
    return report;
  }

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
