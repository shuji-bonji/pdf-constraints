---
approved:
pr:
implementation: required
targets: [check]
---

# Proposal

## Why

CLI（`pdf-constraints check`）の終了コードは 3 値で、README と `src/cli.ts` の冒頭のコメントは「2 = 判定不能（引数不正・ファイルが開けない・**評価に到達できない**）」と約束しています。判定できなかったことを合格と混ぜないための値です。

ところが、パスワード付きの暗号化文書（鍵が導けない文書）では、`checkBytes` がすべての制約を `needs_external_fact` にし（SPEC-CONSTRAINTS-CHECK-003）、違反は 0 件になります。CLI は `report.violations > 0 ? 1 : 0` で終了コードを決めるので、**1 つの制約も判定していないのに 0（違反なし）を返します**。出力には `Not decided: N` の行が出ますが、終了コードだけを読む CI では合格に見えます。CLI にはテストが 1 件もありません。

## What Changes

- 終了コードの決め方を正本（`check`）に書き、関数に切り出してテストで固定する。
- 判定した制約（`pass`・`fail`・`not_applicable` の結果）が 1 つも無く、`needs_external_fact` の結果が 1 つ以上あるときは 2 を返す。

### 変わる振る舞い

- CLI が、すべての結果が `needs_external_fact` のレポート（鍵が導けない暗号化文書、外部事実を要する制約だけのテーブルを当てたときなど）で 0 ではなく 2 を返す。

### 変わらない振る舞い

- 違反が 1 件以上あれば 1。一部の制約だけが `needs_external_fact` で、ほかに判定した制約があれば、これまでどおり違反の有無で 0 か 1（出力の `Not decided` の行で知らせる）。
- 結果が 0 件（対象が 1 つも無い）なら 0。
- 引数の誤り・ファイルが開けないときの 2。
- ライブラリの API（`checkBytes`・`checkFile`・`evaluateConstraint`）とレポートの形。公開 API の変更は無い。
- 制約テーブル（`tables/*.json`）。

### 対象外

- 一部の制約だけが `needs_external_fact` のときに 2 にすること（判定した部分があるので、違反の有無を返す）。
- pdf-verify-mcp の `validate_clauses` の出力（終了コードを使わない）。

## Capabilities

- `check`（既存）: 005・006 を ADDED。

## 人が判断すること

- 「判定した制約が 1 つも無い」の線引き（`not_applicable` を判定に数えるか）。この提案では数える（条件を見て「当てはまらない」と決めたので、判定はしている）。
- 版。CLI の終了コードが変わるので patch（0.6.2）か minor（0.7.0）。CLI を使う側から見ると振る舞いの変更なので minor を提案。
