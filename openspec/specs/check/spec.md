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

### Requirement: SPEC-CONSTRAINTS-CHECK-005 CLI の終了コードは、違反の有無と判定できたかを分けて返す

CLI（`pdf-constraints check`）は、レポートの違反が 1 件以上なら 1 を返す（SHALL）。違反が 0 件で、判定した結果（`pass`・`fail`・`not_applicable`）が 1 つも無く、`needs_external_fact` の結果が 1 つ以上あるときは 2（判定不能）を返す（SHALL）。それ以外（判定した結果があり違反が 0 件、または結果が 0 件）は 0 を返す（SHALL）。1 つの制約も判定していないレポートを 0（違反なし）として返さないため。一部の制約だけが `needs_external_fact` のときは、判定した部分があるので違反の有無を返す。

#### Scenario: 全結果が needs_external_fact なら 2

- **WHEN** すべての結果が `needs_external_fact` で違反が 0 件のレポートの終了コードを決める
- **THEN** 2 になる

#### Scenario: 違反があれば 1

- **WHEN** `fail` の結果と `needs_external_fact` の結果が混ざり、違反が 1 件以上のレポートの終了コードを決める
- **THEN** 1 になる

#### Scenario: 判定した結果があり違反が無ければ 0

- **WHEN** `pass` の結果と `needs_external_fact` の結果が混ざり、違反が 0 件のレポートの終了コードを決める
- **THEN** 0 になる

#### Scenario: not_applicable だけでも判定したとみなして 0

- **WHEN** すべての結果が `not_applicable` のレポートの終了コードを決める
- **THEN** 0 になる

### Requirement: SPEC-CONSTRAINTS-CHECK-006 鍵が導けない暗号化文書を CLI に渡すと 2 で終わる

CLI に鍵が導けない暗号化文書を渡すと、終了コード 2 で終わり、出力に判定しなかった制約の数（`Not decided`）を出す（SHALL）。SPEC-CONSTRAINTS-CHECK-003 のとおり、すべての制約が `needs_external_fact` になるため。

#### Scenario: パスワード付きの文書を CLI に渡す

- **WHEN** パスワード付きの AESV3 の検体を `pdf-constraints check` に渡す
- **THEN** 終了コードは 2 で、標準出力に `Not decided` の行がある
