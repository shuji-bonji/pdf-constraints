# @shuji-bonji/pdf-constraints

[![CI](https://github.com/shuji-bonji/pdf-constraints/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-constraints/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-constraints.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-constraints)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

ISO 32000 の条文を「**ファイルが構造上どういう状態か**」へ写像した制約テーブルと、その決定論的評価器です。

これは PDF family の共有基盤ライブラリで、MCP サーバではありません。
MCP としての露出は [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) の `validate_clauses` が担います。

## 何のためのものか

family の各メンバーが答える問いを並べると、このパッケージの位置が決まります。

| 誰が | 答える問い |
|---|---|
| [pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) | 条文は**何を要求する**か |
| [pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp) | ファイルに**何がある**か |
| **pdf-constraints** | **条文を満たすとはどういう状態か** |
| [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) | **どこが破られている**か |
| [pdf-writer-mcp](https://github.com/shuji-bonji/pdf-writer-mcp) | それを**どう書く**か |

veraPDF は PDF/A・PDF/UA を判定しますが、**ISO 32000 本体の条文違反は見ません**。
そこが空いていたために「CFF フォントを `FontFile2` で埋め込む」という shall 違反が、
ビューアの警告として「無害」と誤分類されたまま残ったことがあります。本パッケージはその穴を埋めます。

> [!IMPORTANT]
> **fail が無いことは適合の証明ではありません。** 「収録した制約の範囲で反証できなかった」以上を意味しません。
> 適合は証明できず、反証できるだけです。

## 使い方

```sh
npx @shuji-bonji/pdf-constraints check document.pdf
npx @shuji-bonji/pdf-constraints check document.pdf --domain font-embedding --given isSubset=true
```

終了コードは 3 値です。**判定できなかったことを合格や違反と混ぜません**。

| code | 意味 |
|---|---|
| 0 | 収録した制約では違反を見つけられなかった（適合の証明ではない） |
| 1 | 違反あり |
| 2 | 判定不能（ファイルが開けない・引数不正など） |

ライブラリとして:

```ts
import { checkFile, loadTable, evaluateConstraint } from '@shuji-bonji/pdf-constraints';

const report = await checkFile('/abs/path/document.pdf', { given: { isSubset: true } });
report.violations;      // 違反数
report.packageVersion;  // どの版のテーブルで判定したか（決定論の由来）
```

制約テーブル（JSON）は直接読めます。

```ts
import table from '@shuji-bonji/pdf-constraints/tables/font-embedding.json' with { type: 'json' };
```

## 収録テーブル

| ドメイン | 条文 | 制約 |
|---|---|---|
| `font-embedding` | §9.9.1 / §9.9.2 / §9.7.4.2（Table 124 / 125 含む） | CT-FONT-1〜5 — 埋め込みキーと中身の一致、サブセット名タグ、`Length1` |
| `document-metadata` | §14.3.2 / §14.3.3 / §14.3.4 / §7.9.4 | CT-META-1〜6 — メタデータストリームの型、日付書式、Info↔XMP の等価、`Trapped` |

## 4 つの状態

制約ごとに次のどれかを返します。**verdict（推奨判定）は出しません** — それは
pdf-verify-mcp の `evaluate_policy` の役割です。

| 状態 | 意味 |
|---|---|
| `pass` | 収録した検査では反証できなかった |
| `fail` | 反証できた |
| `not_applicable` | 適用条件を満たさない（この文書には関係ない条文） |
| `needs_external_fact` | 外部事実が供給されておらず判定に到達できない |

### `given.*` — ファイルの外にある事実

条文には、ファイル単体からは判定できない前提を持つものがあります。たとえば
R-9.9.2-2「**サブセットフォントの**名前は 6 大文字タグで始まる shall」の「サブセットか否か」は、
PDF の中には書かれていません（作った側だけが知っている）。

こうした事実は `--given isSubset=true` で供給します。渡さなければ、その制約は
`needs_external_fact` に縮退します — **既定値で埋めて沈黙合格や冤罪を作らない**ためです。

### 「違反」と「違反の痕跡」

条文の主語が PDF processor（書き込み行為）である場合、ファイルから観測できるのは
**誰かが破った痕跡**であって、直近の書き手の違反とは限りません（§14.3.4 は、既存の不整合を
そのまま残すことを許しています）。そうした制約は `subjectNote` を持ち、レポートでも
「違反の痕跡」と述べます。

## やらないこと

- **条文原文の提供** — pdf-spec-mcp の役割です。テーブルは clause ID で参照するだけで原文を複製しません
- **適合の証明** — 反証できるだけです
- **verdict・推奨判定** — `evaluate_policy` の役割です
- **veraPDF の代替** — PDF/A の判定主体は veraPDF です。収録は ISO 32000-1/-2 本体条文のみ
- **内容の真偽判定** — 条文に適合したファイルが嘘を述べることはあります

## 開発

```sh
npm install
npm run build
npm test
npm run validate:tables   # 制約テーブル自身を tables/schema.json で検証
```

テーブルを増やすときは `tables/*.json` を足して `validate:tables` を通します。
述語（op）を増やす場合は `tables/schema.json` と `src/evaluate.ts` を対で更新してください —
テーブルと評価意味論が同一バージョンで結束していることが、このパッケージの決定論の担保です。

## ライセンス

MIT © shuji-bonji
