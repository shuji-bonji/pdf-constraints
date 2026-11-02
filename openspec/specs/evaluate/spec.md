---
spec_id: CONSTRAINTS
approved: 2026-11-02
pr: 1
---
# evaluate

## Purpose

評価器（`evaluatePredicate`・`evaluateConstraint`・`parsePdfDate`）が、制約テーブルの述語をどう読み、1 つの制約を 1 つの対象（subject）に当てた結果の状態をどう決めるかを定めます。
制約の中身（どの条文をどの述語で写したか）は `tables/*.json` が正本で、ここには写しません。

この初版は、2026-11-02 時点の既存テストが固定している振る舞いを起こしたもので、期待値は変えていません。
起こした範囲は `tests/evaluate.test.ts` の全件（18 件）です。
文書横断の検査（`evaluateDocumentAsserts`）は、固定しているテストが無いので起こしていません。
ISO 32000-2 §7.9.4・§14.3.4 は pdf-spec-mcp（`iso32000-2`）で原文を確かめました。

## できないこと

- 制約を満たすことを適合の証明とすること（`pass` は「収録した検査で反証できなかった」を意味するだけ）
- verdict（推奨判定）を出すこと（pdf-verify-mcp の `evaluate_policy` の仕事）

## Requirements

### Requirement: SPEC-CONSTRAINTS-EVALUATE-001 PDF の日付を時点として読み、読めない値は null にする

`parsePdfDate` は ISO 32000-2 §7.9.4 の日付（`D:YYYYMMDDHHmmSSOHH'mm`）を、UTC の時点（ミリ秒）として返す（SHALL）。省いた月・日は 01、省いた時・分・秒は 0 とし（§7.9.4 の既定値）、UT との関係（`O`）が無ければ GMT とみなす（SHALL）。`+09'00'` などのオフセットは時点に換算する（SHALL）。`D:` が無いもの・月や時刻が値域の外のもの・文字列でないものは `null` にし、等価の判定に使わない（SHALL）。

#### Scenario: Z 表記と省略形を解釈する

- **WHEN** `D:20260725221519Z` と `D:2026` を読む
- **THEN** それぞれ 2026-07-25T22:15:19Z と 2026-01-01T00:00:00Z の時点になる

#### Scenario: UT オフセットを換算する

- **WHEN** `D:20260726093000+09'00'` を読む
- **THEN** 2026-07-26T00:30:00Z の時点になる

#### Scenario: UT 情報が無ければ GMT とみなす

- **WHEN** `D:20260725221519` を読む
- **THEN** 2026-07-25T22:15:19Z の時点になる

#### Scenario: 文法違反と値域外は null

- **WHEN** `2026/07/25 22:15:36`・13 月・25 時・`undefined` を読む
- **THEN** どれも `null` になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-002 eq と in は fact の値をそのまま比べる

`eq` は fact の値が `value` と等しいとき、`in` は fact の値が `value` の配列のどれかと等しいときに真を返す（SHALL）。

#### Scenario: eq と in の真と偽

- **WHEN** fact `FontFile2` に `eq FontFile2`・`eq FontFile3`・`in [FontFile, FontFile2]`・`in [FontFile3]` を当てる
- **THEN** 真・偽・真・偽になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-003 exists は有ることと無いことの両方を検査できる

`exists` は、`value: true` なら fact が null でないとき、`value: false` なら fact が null のときに真を返す（SHALL）。条文の「shall not be present」を写すのに使う。

#### Scenario: exists は無いことの検査にも使える

- **WHEN** 値のある fact と null の fact に `exists true` と `exists false` を当てる
- **THEN** 値のある fact に `exists true` は真、null の fact に `exists true` は偽、`exists false` は真になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-004 matches は文字列だけに当て、superset は配列の包含を見る

`matches` は fact が文字列で、正規表現 `value` に合うときだけ真を返す（SHALL）。数値などの文字列でない値には当てず、偽を返す（SHALL）。`superset` は fact の配列が `value` の要素をすべて含むときに真を返す（SHALL）。

#### Scenario: matches と superset の真と偽

- **WHEN** 文字列 `FontFile2` に `matches ^Font`、数値 120 に `matches ^120`、テーブル一覧に必要なテーブルの集合を `superset` で当てる
- **THEN** 文字列の一致は真、数値は偽、すべて含めば真・欠ければ偽になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-005 eqFact は別の fact と突き合わせる

`eqFact` は、fact の値が `value` に名前を書いた別の fact の値と等しいときに真を返す（SHALL）。

#### Scenario: eqFact の真と偽

- **WHEN** 同じ値を持つ 2 つの fact と、値と null の fact を `eqFact` で突き合わせる
- **THEN** 前者は真、後者は偽になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-006 dateEquiv は表記でなく時点で比べる

`dateEquiv` は、fact と `value` に名前を書いた別の fact をどちらも日付として読み（PDF の日付は 001 の規則、XMP の日付は ISO 8601）、同じ時点のときだけ真を返す（SHALL）。どちらかが日付として読めなければ偽を返す（SHALL）。根拠は ISO 32000-2 §14.3.4（Info 辞書と XMP の値の等価）。

#### Scenario: dateEquiv の真と偽

- **WHEN** 同じ時点の PDF の日付と ISO 8601 の日付、1 秒違う日付、日付でない値を `dateEquiv` で比べる
- **THEN** 真・偽・偽になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-007 allDistinct は配列の要素の重複を見る

`allDistinct` は fact の配列の要素がすべて異なるときに真を返す（SHALL）。

#### Scenario: allDistinct の真と偽

- **WHEN** 重複の無い配列と重複のある配列に `allDistinct` を当てる
- **THEN** 真・偽になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-008 未知の演算子は例外にする

`evaluatePredicate` は、知らない `op` を受け取ったら `unknown predicate op` を含む例外を投げる（SHALL）。偽を返して黙って違反にしない。

#### Scenario: 未知の op は例外にする

- **WHEN** `op: "startsWith"` の述語を評価する
- **THEN** `unknown predicate op` を含む例外になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-009 外部事実が無ければ needs_external_fact にし、条件を満たさなければ not_applicable にする

`evaluateConstraint` は制約の `when` を順に見て、`given.` で始まる fact が渡されていなければ `needs_external_fact` を返し、`missing` にその fact の名前を入れる（SHALL）。条件が偽なら `not_applicable` を返す（SHALL）。条件がすべて真のときだけ `assert` を当て、失敗が 1 つでもあれば `fail`、無ければ `pass` を返す（SHALL）。外部事実が無いことを `pass` にも `fail` にも倒さない。

#### Scenario: given が無ければ needs_external_fact

- **WHEN** `when` に `given.flag eq true` を持つ制約を、`given.flag` を渡さずに評価する
- **THEN** 状態は `needs_external_fact`、`missing` は `given.flag` になる

#### Scenario: given が false なら not_applicable

- **WHEN** 同じ制約を `given.flag: false` で評価する
- **THEN** 状態は `not_applicable` になる

#### Scenario: given が true なら実際に判定する

- **WHEN** 同じ制約を `given.flag: true` で、assert を満たす値と満たさない値で評価する
- **THEN** 状態は `pass` と `fail` になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-010 onlyWhen を満たさない assert は検査しない

assert が `onlyWhen` を持ち、その条件を満たさないとき、その assert は検査せず、失敗にも数えない（SHALL）。

#### Scenario: onlyWhen を満たさない assert は検査自体を飛ばす

- **WHEN** `onlyWhen: doc.kind eq A` の assert を、`doc.kind` が B と A の対象に当てる（どちらも assert の値は満たさない）
- **THEN** B では `pass`、A では `fail` になる

### Requirement: SPEC-CONSTRAINTS-EVALUATE-011 assert の note は failure に載せるが、状態は変えない

assert が `note` を持つとき、その assert の failure に `note` を載せる（SHALL）。`note` の無い assert の failure は `note` を持たない（SHALL）。`note` は誤読を防ぐ説明で、状態（`pass` / `fail`）を変えない（SHALL）。

#### Scenario: assertion の note は failure に載る

- **WHEN** `note` を持つ assert を、満たさない値と満たす値で評価する
- **THEN** 前者の failure に同じ `note` が載り、後者は `pass` になる

#### Scenario: note の無い assertion は failure に note を作らない

- **WHEN** `note` の無い assert を満たさない値で評価する
- **THEN** failure は `note` を持たない

### Requirement: SPEC-CONSTRAINTS-EVALUATE-012 主語が processor の制約の failure は痕跡として印を付ける

制約が `subjectNote` を持つとき（条文の主語がファイルではなく処理系のとき）、その failure に `traceOnly: true` を付ける（SHALL）。ファイルから観測できるのは行為の結果で、違反の主体ではないため。

#### Scenario: subjectNote を持つ制約の failure は traceOnly になる

- **WHEN** `subjectNote` を持つ制約を、assert を満たさない値で評価する
- **THEN** failure の `traceOnly` は `true` になる
