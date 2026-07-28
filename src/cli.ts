#!/usr/bin/env node
/**
 * CLI — MCP 抜きで制約テーブルを当てる（CI の回帰などに使う）。
 *
 * **exit code は 3 値**:
 *   0 = 違反なし（収録した制約の範囲で反証できなかった。適合の証明ではない）
 *   1 = 違反あり
 *   2 = 判定不能（引数不正・ファイルが開けない・評価に到達できない）
 *
 * 2 を分けているのは、**判定できなかったことを「合格」や「違反」と混ぜないため**。
 * exit 0 を成功と読んだ結果を取り違えた事例（pdfnative 監査 G-1）の再演を避ける。
 */

import { checkFile, listTables } from './check.js';
import type { CheckReport } from './types.js';

const USAGE = `Usage: pdf-constraints check <file.pdf> [options]

Options:
  --domain <name>     Table to apply (repeatable). Default: all bundled tables
  --given <k=v>       Supply an external fact (repeatable), e.g. --given isSubset=true
  --json              Print the raw report as JSON

Bundled tables: ${listTables().join(', ')}

Exit: 0 = no violations found, 1 = violations found, 2 = could not decide`;

function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(
    `# Constraint check (pdf-constraints@${report.packageVersion}; ` +
      `${report.tables.map((t) => `${t.name} v${t.version}`).join(', ')})`,
    '',
  );
  for (const result of report.results) {
    if (result.status === 'fail') {
      for (const failure of result.failures ?? []) {
        // 主語が processor の条文は「違反」と断定しない（specs/18 §1 / F-5）
        const kind = failure.traceOnly ? 'TRACE' : 'FAIL ';
        lines.push(
          `${kind} ${result.constraint} [${failure.clauses.join(', ')}] ${result.target}`,
          `      ${failure.message}`,
          `      ${failure.fact} = ${JSON.stringify(failure.actual)}`,
        );
        // 判定は変えないが、これが無いと誤読される文脈（業界慣行との齟齬など）
        if (failure.note) lines.push(`      Context: ${failure.note}`);
      }
    } else if (result.status === 'needs_external_fact') {
      lines.push(
        `SKIP  ${result.constraint} ${result.target} — needs ${result.missing} ` +
          `(pass にも fail にも倒していない)`,
      );
    }
  }
  if (report.violations === 0) lines.push('No violations found in the constraints checked.');

  // 縮退した制約は要約にも出す。exit 0 は「違反が無かった」であって
  // 「全部を検査できた」ではない — その差を数字で見せておかないと読み違えられる
  const skipped = report.results.filter((r) => r.status === 'needs_external_fact').length;
  lines.push(
    '',
    `Subjects: ${report.subjects}  Violations: ${report.violations}` +
      (skipped > 0 ? `  Not decided: ${skipped} (missing external facts — see --given)` : ''),
    'Note: the absence of failures is not proof of conformance — only that nothing in the',
    'bundled constraints could be disproved.',
  );
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] !== 'check' || !argv[1]) {
    console.error(USAGE);
    return 2;
  }
  const file = argv[1];
  const domains: string[] = [];
  const given: Record<string, unknown> = {};
  let asJson = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--domain' && argv[i + 1]) domains.push(argv[++i]);
    else if (arg === '--json') asJson = true;
    else if (arg === '--given' && argv[i + 1]) {
      const [key, raw] = argv[++i].split('=');
      given[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
    } else {
      console.error(`Unknown argument: ${arg}\n\n${USAGE}`);
      return 2;
    }
  }

  let report: CheckReport;
  try {
    report = await checkFile(file, {
      domains: domains.length > 0 ? domains : undefined,
      given,
    });
  } catch (error) {
    // 開けない・壊れている・テーブルが無い — いずれも「判定できなかった」
    console.error(`Could not decide: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  console.log(asJson ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.violations > 0 ? 1 : 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Could not decide: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
