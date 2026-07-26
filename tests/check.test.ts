/**
 * 検体による回帰。
 *
 * 期待値は**構築時に分かっている正解**（どの writer の版で作ったか）から来ている。
 * 検体の作り方は `fixtures/README.md`。
 *
 * ここで見ているのは「テーブル + 評価器が、既知の違反を既知のとおりに検出するか」であって、
 * 適合の証明ではない。fail が無い検体も「収録した制約の範囲で反証できなかった」に過ぎない。
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile } from '../src/check.js';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', `${name}.pdf`);

describe('font-embedding — writer B-14（W-2/3/4）の是正前後', () => {
  const options = { domains: ['font-embedding'], given: { isSubset: true } };

  it('v0.13.1 の .otf 出力は 4 制約すべてに違反する（CFF を FontFile2 で埋め込む）', async () => {
    const report = await checkFile(fixture('bad-0.13.1'), options);
    expect(report.violations).toBe(8);

    // 「表面が壊れている」ではなく W-2 の実体を捉えていることを確認する
    const container = report.results
      .flatMap((r) => r.failures ?? [])
      .find((f) => f.fact === 'program.container');
    expect(container?.actual).toBe('otto');
    expect(container?.clauses).toContain('R-9.9.1-33');
  });

  it('v0.15.1 の .otf 出力は違反なし（CIDFontType0 + FontFile3 /OpenType）', async () => {
    const report = await checkFile(fixture('good-0.15.1'), options);
    expect(report.violations).toBe(0);
  });

  it('.ttf 入力では W-2 は非該当で W-3/W-4 のみ違反する（分岐が効いている）', async () => {
    const report = await checkFile(fixture('bad-ttf-0.13.1'), options);
    expect(report.violations).toBe(4);

    // 本物の TrueType なので CT-FONT-1 は pass、CT-FONT-2 は not_applicable
    const byId = new Map(report.results.map((r) => [r.constraint, r.status]));
    expect(byId.get('CT-FONT-1')).toBe('pass');
    expect(byId.get('CT-FONT-2')).toBe('not_applicable');
  });

  it('v0.15.1 の .ttf 出力は違反なし（Length1 とサブセットタグが揃う）', async () => {
    const report = await checkFile(fixture('good-ttf-0.15.1'), options);
    expect(report.violations).toBe(0);
  });

  it('given.isSubset を渡さないと、サブセット前提の制約は判定に到達しない', async () => {
    const report = await checkFile(fixture('bad-0.13.1'), { domains: ['font-embedding'] });
    const subsetRule = report.results.find((r) => r.constraint === 'CT-FONT-3');

    // pass にも fail にも倒さない — 既定値で埋めると沈黙合格か冤罪になる
    expect(subsetRule?.status).toBe('needs_external_fact');
    expect(subsetRule?.missing).toBe('given.isSubset');
  });
});

describe('document-metadata — Info と XMP の等価（§14.3）', () => {
  const options = { domains: ['document-metadata'] };

  it('W-6 是正前の ensure_pdfa 出力は作成日時の不等価を検出される', async () => {
    const report = await checkFile(fixture('base-xmp'), options);
    expect(report.violations).toBe(1);

    const failure = report.results.flatMap((r) => r.failures ?? [])[0];
    expect(failure.clauses).toContain('R-14.3.4-2');
    // 条文の主語は processor なので「違反」と断定しない（specs/18 §1 / F-5）
    expect(failure.traceOnly).toBe(true);
    expect(failure.message).toContain('痕跡');
  });

  it('W-6 是正後の出力では違反が消える', async () => {
    const report = await checkFile(fixture('w6-fixed-base-xmp'), options);
    expect(report.violations).toBe(0);
  });

  it('日時を揃えた対照検体は全制約 pass', async () => {
    const report = await checkFile(fixture('synthetic-good'), options);
    expect(report.violations).toBe(0);
  });

  it('故意に壊した検体は 3 種の違反を検出する', async () => {
    const report = await checkFile(fixture('synthetic-bad'), options);
    const failed = report.results.filter((r) => r.status === 'fail').map((r) => r.constraint);

    expect(failed).toContain('CT-META-1'); // /Subtype を削った
    expect(failed).toContain('CT-META-3'); // /ModDate が D: 形式でない
    expect(failed).toContain('CT-META-6'); // /Trapped が boolean
  });

  it('dc:title の停滞は違反にしない（R-14.3.4 の shall は日時のみ）', async () => {
    // 0.9.1 は Info の title だけ更新して dc:title を据え置くが、それは条文の射程外。
    // 射程を広げすぎると「観測できる差異」を片端から違反にしてしまう（F-7）
    const stale = await checkFile(fixture('bad-meta-0.9.1'), options);
    const synced = await checkFile(fixture('good-meta-0.15.1'), options);
    expect(stale.violations).toBe(synced.violations);
  });
});

describe('レポートは判定の由来を含む', () => {
  it('パッケージ版とテーブル版を返す', async () => {
    const report = await checkFile(fixture('synthetic-good'), { domains: ['document-metadata'] });

    // 「どの版のテーブルで判定したか」を言えないと決定論の意味がない（specs/18 §4.5）
    expect(report.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.tables).toEqual([{ name: 'document-metadata', version: '1' }]);
  });
});
