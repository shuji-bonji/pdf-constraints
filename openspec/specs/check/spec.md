---
spec_id: CONSTRAINTS
approved: 2026-11-02
pr: 1
---
# check

## Purpose

高水準 API（`checkBytes`・`checkFile`）が、PDF を読み、同梱の制約テーブルを当て、レポートを返すときの規則を定めます。
CLI と pdf-verify-mcp の `validate_clauses` の共通の入口です。レポートが判定の由来（どの版のテーブルで判定したか）と、読めた範囲を持つことを扱います。

この初版は、2026-11-02 時点の既存テストが固定している振る舞いを起こしたもので、期待値は変えていません。
起こした範囲は `tests/check.test.ts` のうち次の 5 件です。

- 「レポートは判定の由来を含む」の 1 件
- 「given.isSubset を渡さないと、サブセット前提の制約は判定に到達しない」の 1 件
- 「鍵が導けない暗号化文書」の 3 件

`tests/check.test.ts` の残りの 18 件は、検体に既知の違反が既知のとおりに出るか（テーブルの中身）を見る回帰なので、起こしていません。制約の中身の正本は `tables/*.json` です。
CLI（`src/cli.ts`）は、固定しているテストが無いので起こしていません。

## できないこと

- 適合を証明すること（違反 0 件は「収録した制約の範囲で反証できなかった」を意味するだけ）
- パスワードの要る暗号化文書の中身を判定すること（パスワードはファイル単体からは決まらない外部事実）

## Requirements

### Requirement: SPEC-CONSTRAINTS-CHECK-001 レポートはパッケージの版と、当てたテーブルの名前と版を持つ

`checkBytes` と `checkFile` のレポートは、`packageVersion`（このパッケージの版）と、`tables`（当てたテーブルごとの `name` と `version`）を持つ（SHALL）。同じ facts から同じ結果が出ることの由来を、どの版のテーブルで判定したかまで言えるようにするため。

#### Scenario: パッケージ版とテーブル版を返す

- **WHEN** `domains: ["document-metadata"]` で検体を判定する
- **THEN** `packageVersion` は semver の形で、`tables` は `[{ name: "document-metadata", version: "1" }]` になる

### Requirement: SPEC-CONSTRAINTS-CHECK-002 外部事実は given から渡し、渡されなければ判定しない

`options.given` の各キーは、`given.<キー>` の fact として制約に渡す（SHALL）。外部事実を要する制約に、その事実を渡さなかったときは、その制約を `needs_external_fact` にし、`missing` に `given.<キー>` を入れる（SHALL）。既定値で埋めない。

#### Scenario: given.isSubset を渡さないと、サブセット前提の制約は判定に到達しない

- **WHEN** `given` を渡さずに、サブセット前提の制約（CT-FONT-3）を含む font-embedding のテーブルを当てる
- **THEN** CT-FONT-3 の状態は `needs_external_fact`、`missing` は `given.isSubset` になる

### Requirement: SPEC-CONSTRAINTS-CHECK-003 鍵が導けない暗号化文書では、すべての制約を needs_external_fact にする

暗号化されていて鍵が導けない文書（レポートの `observation.scope` が `encrypted: true`・`authenticated: false`）では、制約を当てず、当てるはずだったすべての制約を `needs_external_fact`（`missing: "given.password"`、`target: "(document)"`）にする（SHALL）。違反は 0 件になるが、それは判定した結果ではない。オブジェクトを 1 つも読めていないのに制約を当てると、fact がすべて null になり、`onlyWhen` で守られた assert が飛ばされて `pass` に見えるため。根拠は ISO 32000-2 §7.6（暗号化された文書の文字列とストリームは、鍵が無ければ読めない）。

#### Scenario: パスワード付きの文書では、全制約が needs_external_fact になる

- **WHEN** パスワード付きの AESV3 の検体を判定する
- **THEN** `observation.scope.encrypted` は `true`、`authenticated` は `false`、すべての結果が `needs_external_fact`、`missing` は `given.password` だけ、`violations` は 0 になる

#### Scenario: RC4 系（AESV2）でも同じ経路を通る

- **WHEN** パスワード付きの AESV2 の検体を判定する
- **THEN** すべての結果が `needs_external_fact` になる

### Requirement: SPEC-CONSTRAINTS-CHECK-004 鍵が導ける暗号化文書は、通常どおり判定する

暗号化されていても、空のパスワードで鍵が導ける文書（`authenticated: true`）は、復号して通常どおり制約を当てる（SHALL）。003 は「暗号化されている」ことではなく「鍵が導けない」ことだけで判定をやめる。

#### Scenario: 空パスワードで鍵が導ける暗号化文書は、通常どおり判定される

- **WHEN** 空のパスワードで鍵が導ける AESV3 の検体を判定する
- **THEN** `encrypted` と `authenticated` はどちらも `true`、`pass` の結果があり、`needs_external_fact` の結果は 0 件になる
