## ADDED Requirements

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
