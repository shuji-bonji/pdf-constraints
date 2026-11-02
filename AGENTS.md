# AGENTS.md

このリポジトリ（pdf-constraints）で作業するエージェントと人が、最初に読む規則です。利用者向けの説明は [README.ja.md](./README.ja.md)、PDF family 全体の計画は pdf-agent-stack の `docs/specs/31-openspec-spec-ids-adoption-plan.md` にあります。

## 仕様の正本

- 意図の正本は `openspec/specs/` です（[OpenSpec](https://github.com/Fission-AI/OpenSpec) の置き場）。Wiki・Discussions・README・`docs/` は正本にしません。
- 変更は `openspec/changes/<slug>/` に出し（`openspec new change <slug>`）、人が承認するまで実装を始めません。`<slug>` に日付を入れません（`openspec archive` が `YYYY-MM-DD-` を付けます）。
- 実装する係は `openspec/specs/` の本文を直接書き換えません。正本へ取り込むのは `openspec archive` です。実装から仕様へ戻したい発見は、新しい `openspec/changes/` に書きます。
- 制約そのもの（`CT-FONT-1` などの ID・条文番号・述語）の正本は `tables/*.json` です（`tables/schema.json` と `npm run validate:tables` が検査します）。`openspec/specs/` はテーブルの中身を写さず、評価器の振る舞いを定めます。
- capability は振る舞いの単位で、`evaluate`（述語の意味と制約の状態）と `check`（文書を読み、テーブルを当て、レポートを返す）の 2 つです（PDF family の計画 §4.2、2026-11-02 決定）。

## 仕様 ID

- 形式は `SPEC-CONSTRAINTS-<機能>-<3 桁>` です（例: `SPEC-CONSTRAINTS-EVALUATE-001`）。機能は `openspec/specs/<capability>/spec.md` のディレクトリ名を大文字にしたものです。番号は機能ごとに 001 からの通し番号です。
- 要求の見出しは `### Requirement: SPEC-CONSTRAINTS-<機能>-<3 桁> 題` の形で書きます。各要求に `#### Scenario:` を 1 つ以上書き、Scenario 名をテスト名の後半にします。
- 新しい ID は `npx spec-ids next <capability>` で取ります（複数なら `--count 3`）。一度使った番号はその機能の中で再利用しません。
- 仕様を外すときは差分の `## REMOVED Requirements` に書き、テストからも ID を外します。

## テストの置き場

- テストは `tests/**/*.test.ts`（vitest）で、CI で全件が回ります。`spec-ids check` はこのテスト名を読みます。
- 検体は `fixtures/` にあります（`fixtures/README.md`）。テーブルを変える変更では、`npm run golden:diff` で検体の判定が変わらないこと（または変わった箇所が意図どおりであること）を確かめます。
- 初版起こしでは、既存テストの名前の**先頭**に仕様 ID を足します（`spec-ids pr-scope` は「ID とその後ろの空白を消すと元の行に戻るか」で差分を見るので、末尾に括弧で足すと通りません）。

## 承認の記録

- `openspec/changes/<slug>/proposal.md` の先頭の front matter に `approved: YYYY-MM-DD`（JST）と `pr: N` を人が書きます。エージェントは空のキー（`approved:`・`pr:`）のまま出します。`implementation`（`required` / `none`）と `targets`（書き換える capability の配列）はエージェントが書きます。
- `openspec/specs/<capability>/spec.md` の front matter には `spec_id: CONSTRAINTS`・`introduced_by`（その capability を作った変更の slug）を書きます。ライブラリなので `kind` は書きません（計画 §10-6）。
- 🔴 新しい capability を作る変更では、`openspec archive` が差分の front matter を正本に写しません（OpenSpec 1.14.1）。archive の後、正本の先頭に front matter を書き足してから `npx spec-ids check` を回します。

## PR の種類

| ブランチ | 種類 | 入れてよいもの |
| --- | --- | --- |
| `spec/<slug>` | 仕様 PR | `openspec/changes/<slug>/` の proposal.md と差分の `specs/<capability>/spec.md` |
| `spec-init/<capability>` | 初版起こし | `openspec/specs/<capability>/spec.md` と、既存テスト名への仕様 ID の追加 |
| それ以外（`feat/` `fix/` `docs/` `chore/`） | 実装 PR | `src/`・`tables/`・テスト・版・CHANGELOG、`openspec archive` による取り込み（`openspec/changes/<slug>/` → `openspec/changes/archive/YYYY-MM-DD-<slug>/` と `openspec/specs/` の更新） |

- 1 つの変更を 1 本の PR（提案 → 仕様 → 実装 → archive）で進めてもよいです（PDF family の計画 §6.3）。その場合もブランチは実装 PR の名前にします。仕様 PR と実装 PR を分けるか（計画 §10-3 の層 3）は、変更ごとに決めます。
- 🔴 実装 PR は `openspec/changes/<slug>/` の追加を `pr-scope` が通しません。人が proposal.md に `approved` と `pr` を書いたら、**マージの前に** `openspec archive` の commit を足します。
- CI の `spec-gate` は `npx openspec validate --all` → `npx spec-ids check` の順に走り、PR のときだけ `npx spec-ids pr-scope` が変えてよいパスを検査します。
- 署名・push・PR・マージ・タグは人が行います。

## 記録

- 変更ごとに `openspec/changes/<slug>/record.md` を残します（版・かかった時間・人が判断した箇所・仕様と実装のずれ・読み返した回数。書式は計画 §8）。archive でそのまま `archive/` に移ります。
