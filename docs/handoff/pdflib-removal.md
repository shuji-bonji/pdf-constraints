# 引き継ぎ: pdf-constraints の pdf-lib 撤去（normativepdf へ）

- 対象リポジトリ: `@shuji-bonji/pdf-constraints` 0.3.0（この文書のある repo）
- 起票: 2026-08-27
- **トラック B の第 1 段（B1）。** 前段 = normativepdf の §7.9 文字列層
  （`lib/normativepdf/docs/handoff/text-string-and-date.md`）。
  後段 = `mcp/pdf-verify-mcp/docs/handoff/pdflib-removal.md`（B2）
- 🔴 **B2 より先にやる。** verify の受入基準「`dependencies` から pdf-lib が消える」は、
  pdf-constraints が pdf-lib を持っている限り満たせない（下記 §1）
- 前提はトラック A の A1（版の土台）だけ。SDK には触れないので A2〜A4 とは無関係
- この文書だけで着手できる
- **起票先: [shuji-bonji/pdf-agent-stack#21](https://github.com/shuji-bonji/pdf-agent-stack/issues/21)**（トラック B の第 2 段 = B1）

---

## 1. なぜここが先か

```
pdf-verify-mcp
  ├─ pdf-lib ^1.17.1                    ← B2 で消す
  └─ @shuji-bonji/pdf-constraints 0.3.0
       └─ pdf-lib ^1.17.1               ← ここが残ると依存ツリーに戻ってくる
```

`pdf-constraints` は **`dependencies` に `pdf-lib: ^1.17.1`** を持つ公開ライブラリで、
verify がそれを消費している。verify の 5 ファイルを移しても、pdf-lib は推移依存として残る。

## 2. いま何が pdf-lib の上にあるか（実測 2026-08-27）

`src` 全体 1,099 行のうち、pdf-lib を使うのは **5 ファイル / 638 行**。

| ファイル | 行数 | `lookup` 系 | 既存 `await` | pdf-lib から取る記号 |
|---|---|---|---|---|
| `src/facts/annotation.ts` | 307 | 17 | 0 | `PDFArray` `PDFDict` `PDFDocument` `PDFHexString` `PDFName` `PDFNumber` `PDFRef` `PDFString` |
| `src/facts/embedded-font.ts` | 123 | 5 | 0 | `decodePDFRawStream` `PDFDict` `PDFDocument` `PDFName` `PDFNumber` `PDFRawStream` `PDFRef` |
| `src/check.ts` | 92 | 0 | **1** | `PDFDocument`（`PDFDocument.load(bytes, { updateMetadata: false })`） |
| `src/facts/document.ts` | 82 | 6 | 0 | `decodePDFRawStream` `PDFDict` `PDFDocument` `PDFName` `PDFRawStream` |
| `src/facts/registry.ts` | 34 | 0 | 0 | `PDFDocument` |

記号は重複を除いて 10 種。**すべて COS プリミティブか文書ローダ**で、
高レベル API は使っていない。`decodeText()` の呼び出しが 6 箇所ある（→ §5 の前段）。

## 3. 公開 API はほぼ変わらない

消費者が呼ぶのはバイト列とパスだけである。

```ts
export async function checkBytes(bytes: Uint8Array, options?: CheckOptions): Promise<CheckReport>
export async function checkFile(path: string, options?: CheckOptions): Promise<CheckReport>
```

verify が使っているのは `checkFile` と `listTables` の 2 つだけ（実測）。
**pdf-lib はほぼ実装詳細**なので、内部を入れ替えても消費者は変わらない。

### 🔴 例外が 1 つ — `PDFDocument` が公開面に漏れている

```ts
// src/index.ts から export されている
export type FactExtractor = (doc: PDFDocument, given: Facts) => Subject[];
export function collectSubjects(doc: PDFDocument, scopes: Iterable<Scope>, given: Facts): Subject[];
```

**この 2 つは破壊的変更になる。** 決裁が要る（§6 の未決 1）。
いま実際に触っている消費者は 0 件（verify は使っていない）。

## 4. async の波及は `checkBytes` で止まる（実測）

抽出器 3 本（`document` / `embedded-font` / `annotation`）は **`await` を 1 つも持たない同期関数**で、
`lookup` 系が計 28 箇所。normativepdf の `resolve` / `getObject` は async なので、
この 3 本と `collectSubjects` が async になる。

呼び出し元は `checkBytes`（`src/check.ts`）1 か所で、**そこは既に `export async function`** である。
`PDFDocument.load` の `await` が 1 件あるだけなので、公開 API の形は変わらない。

**したがって波及は「抽出器 3 本 + `collectSubjects` を async にする + `checkBytes` に `await` を足す」で止まる。**

## 5. 段取り

### L0. ゴールデン採取 — **撤去前に固定する（後から作れない）**

`checkBytes` / `checkFile` の `CheckReport` を、検体群に対して凍結する。

- 検体の軸: `fixtures/` の既存検体 + `scripts/gen-annotation-specimens.mjs` が作るもの +
  暗号化 PDF + 壊れた xref + `origin > 0`
- 収録している 3 scope（`document` / `embedded-font` / `annotation`）すべてを通る検体を含める
- 🔴 **計器そのものに T-3 を通してから採る**（[[instrument-must-pass-t3]]）。
  `CheckReport` の 1 項目を書き換えて A/B が差を報告することを先に実測する

### L1. normativepdf の §7.9 文字列層を消費する

`decodeText()` × 6 を `decodeTextString` に置き換える。**この repo が第 1 消費者**
（前段 handoff の受入面 4）。

### L2. `src/check.ts` の入口を `parsePdf` へ

`PDFDocument.load(bytes, { updateMetadata: false })` → `parsePdf(bytes)`。
`updateMetadata: false` は pdf-lib が Info を書き換えないようにするための引数で、
normativepdf は読むだけなので不要になる。

### L3. 抽出器 3 本（28 lookup・async 化）

`document` → `embedded-font` → `annotation` の順（lookup が少ない順）。
各段で L0 のゴールデンと A/B を取る。

### L4. `registry.ts` の型を差し替え、`package.json` から pdf-lib を落とす

`FactExtractor` の公開をどうするかは §6 の未決 1 に従う。

## 6. 受入基準（3 面・着手前に決める）

### 面 1 — 撤去

`grep -rl "from 'pdf-lib'" src/` が **5 → 0**、`package.json` の `dependencies` から
`pdf-lib` が消える。**`devDependencies` にも残さない**（§7 の理由）。

### 面 2 — 判定の A/B

L0 のゴールデンと差 0。**差が出たら 1 件ずつ「是正」か「後退」かを帰属させる。**

予測される差が 2 種類ある。

1. **strict 化で「読めた → 判定不能」に落ちる検体。** normativepdf は §7.5.4 を条文どおり
   厳格に読み、回復方針は消費者側に置く設計（normativepdf `DESIGN.md` §4.2）。
   verify の `revision-diff.ts` 移行では PDF 2,987 件中 6 件が該当した
2. **UTF-8 BOM 付きテキスト文字列の復号（`R-7.9.2.2.1-4`）。** pdf-lib 1.x は扱わない。
   **これは是正**（条文が正）

**受入の条件**: A/B の差のうち **`pass → fail` は 0 件**。
`pass → not_applicable` / `pass → needs_external_fact` は帰属付きで許容。
**`fail → pass` も帰属が要る**（制約が反証できなくなるのは後退でありうる）。

### 面 3 — 独立オラクル

🔴 **この repo にはテスト側の pdf-lib が無い**（実測: `src` / `tests` の grep 0 件）。
writer の `tests/helpers/pdf-lib-reader.ts`（ADR-0004「二面で測る」）に相当するものが無いので、
**撤去すると自分のパーサで読んで自分の判定を確かめる形になる**（GUARDS T-2）。

対応: **L0 のゴールデンを pdf-lib で採ったこと自体が第 2 の面**である。
撤去後にゴールデンを作り直さないこと（作り直すと同じパーサ同士の比較になる）。
加えて、`fixtures/` の検体について **qpdf の `--check`** を通し、
「読めるファイルなのに判定不能になった」を切り分けられるようにする。

### T-3（3 通り以上を実測）

1. `decodeTextString` の BOM 検査を外す → 該当検体の `CheckReport` が変わる
2. `await` を 1 つ落とす → Promise が値として比較され、該当検体が落ちる
3. ゴールデンの 1 項目を書き換える → A/B が差を報告する（L0 で実測済みのものを再確認）

## 7. 決めること

### 未決 1 — `FactExtractor` / `collectSubjects` の公開をどうするか

3 案:

| 案 | 内容 | 影響 |
|---|---|---|
| **A** | 型を `CosDict` ベースに変えて export し続ける | 破壊的変更。normativepdf の型が公開面に出る |
| **B** | export をやめ、内部に閉じる | 破壊的変更。ただし実際の消費者は 0 件 |
| **C** | `doc` を受け取らない形に変え、`Subject[]` を返す関数だけ残す | 設計変更。抽出器の差し替え点が消える |

**B を推す。** 実際に触っている消費者が 0 件で、`checkBytes` / `checkFile` という
バイト列を受ける入口が既にあるため。外部の拡張点として残す必要が立ってから A に戻せばよい。
どの案でも **major を上げる**（0.3.0 → 0.4.0 ではなく 1.0.0 か、0.x のまま minor で告知）。

### 未決 2 — `devDependencies` に pdf-lib を残すか

writer と verify は「テスト側の独立した読み手」として残している（ADR-0004 / GUARDS T-2）。
**この repo では残さない**ことを推す。理由は §6 面 3 のとおりで、ここでの二面性は
「pdf-lib で採ったゴールデン」が担うため、テスト実行時に pdf-lib は要らない。

## 8. 測らないと決めること

- **性能。** normativepdf は async、pdf-lib は同期
- **制約テーブルの内容。** `tables/*.json` は触らない。変えるのは事実の抽出だけ
- **verify 側の出力。** B2 の受入で測る

## 9. 関連

- `lib/normativepdf/docs/handoff/text-string-and-date.md` — 前段（N）
- `mcp/pdf-verify-mcp/docs/handoff/pdflib-removal.md` — 後段（B2）
- `information/issue-draft-08-sdk-v2-and-version-alignment.md` — トラック A（A1 だけが前提）
- `Document-Note/mcps/PDFfamily/specs/18-pdf-constraints-package.md` — この repo の役割
