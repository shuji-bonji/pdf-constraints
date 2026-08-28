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

### 🔴 例外がもう 1 つ — `parsePdfDate` の戻り値が変わる（2026-08-28 追記）

この repo は `src/evaluate.ts` の `parsePdfDate(value: unknown): number | null` を
`src/index.ts` から**公開している**。normativepdf の同名関数は `PdfDate | null` を返す別物で、
L1 で入れ替えると戻り値の型が変わる。**同名だが同じものではない。**
選べるのは 3 つ: (a) 内部だけ normativepdf に載せ替え、公開する `parsePdfDate` は
`PdfDate` → epoch ミリ秒の薄い変換として残す / (b) 公開をやめる（未決 1 と同じ扱い） /
(c) `PdfDate` をそのまま返す形に変える。**(a) を推す** —— `dateEquiv` 述語が数値の比較を
前提にしていて、そこは変える必要が無いため。

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

#### 計器 — `scripts/golden.mjs`（2026-08-28 に入れた）

```bash
npm run build                       # dist を読むので先に建てる

# 1. 計器自身の T-3 を先に通す（fixtures から採って壊す。保存しない）
node scripts/golden.mjs t3

# 2. 撤去前のゴールデンを採る。**fixtures だけでは足りない**（下記の軸）
node scripts/golden.mjs take .golden/before.json --label before \
  --set fixtures --set ../normativepdf/corpus/veraPDF-corpus

# 3. 各段（L1〜L4）のあとで採り直して突き合わせる
node scripts/golden.mjs take .golden/after-L3.json --label after-L3 \
  --set fixtures --set ../normativepdf/corpus/veraPDF-corpus
node scripts/golden.mjs diff .golden/before.json .golden/after-L3.json
node scripts/golden.mjs diff .golden/before.json .golden/after-L3.json --detail '<検体キー>'
```

凍結するのは要約ではなく中身である。検体ごとに `subjects` / `violations` と、制約 1 行ずつの
`[constraint, target, status, failures の sha, missing]`。失敗は `clauses` / `fact` / `actual` /
`traceOnly` / `message` / `note` まで入れて sha を取る。**読めなかったファイルは落とさずに
`error` として記録する** —— 暗号化 PDF がこれに当たり、撤去後に読めるようになったら
「読めなかった → 読めた」の差として出る（沈黙して消えない）。
版（`packageVersion` / テーブル版）は行ではなくヘッダで比べる。0.3.0 → 0.4.0 で全ファイルが
差になると、判定の差が埋もれるため。

`diff` は差を 2 つに分けて数える。**`pass → fail` / 読めた → 読めない / 行が消えた**は受入を
満たさない差（0 件でなければならない）。それ以外は「帰属を書く差」で、
`pass → not_applicable` と `pass → needs_external_fact` は §6 面 2 のとおり帰属付きで許容する。
終了コードは 0 = 差なし / 1 = 差あり / 2 = 使い方の誤り・自己検査に失敗。

**T-3 は 9 通りとも差として出た**（2026-08-28 実測）: 空振り検査（壊さなければ差 0 件）・
status を 1 行変える・行を落とす・target を変える・`violations` を 1 増やす・`subjects` を
1 増やす・検体を 1 つ落とす・**status を動かさずに failures の中身だけ変える**・
読めなかった検体を「読めた」にする。

#### 🔴 `fixtures/` だけでは 4 つの軸が 1 形しかない（2026-08-28 実測）

`take` は毎回この一覧を印字する。fixtures 14 件だけで採ると:

| 軸 | fixtures だけ | + veraPDF コーパス |
|---|---|---|
| 読めた / 読めなかった | ⚠ 1 形（全部読めた） | 2 形（暗号化検体が `error`） |
| `origin > 0` | ⚠ 1 形 | 2 形 |
| `/Encrypt` を持つ | ⚠ 1 形 | 2 形 |
| 増分更新（`startxref` 2 個以上） | ⚠ 1 形 | 2 形 |
| xref ストリーム | 2 形 | 2 形 |
| 線形化 | ⚠ 1 形 | 2 形 |

**1 形しかない軸は差を運べない**（[[fixtures-produce-only-one-shape]]）。
`--set ../normativepdf/corpus/veraPDF-corpus`（2,917 件・gitignore。無ければ
normativepdf 側で `npm run corpus:fetch`）を必ず足すこと。150 件で 1.4 秒・0.3 MB なので、
全件でも 30 秒・6 MB 程度で収まる。

制約の側の被覆も同じ表に出る。fixtures 14 件で **26 制約すべてが 1 回以上現れ、状態は
4 つとも出る**（`pass` / `fail` / `not_applicable` / `needs_external_fact`）。
一度も `fail` しない制約は fixtures だけで 3 件（`CT-FONT-3` / `CT-FONT-5` / `CT-META-2`）。

ゴールデンの置き場は `.golden/`（gitignore 済み）。**撤去後に作り直さないこと** —
作り直すと同じパーサ同士の比較になり、§6 面 3 の第 2 の読み手が消える。

#### 採ったもの（2026-08-28・pdf-lib 1.17.1 / pdf-constraints 0.3.0 / テーブル 3 本とも v1）

`.golden/before.json`（4.3 MB）。**gitignore なので、この数字だけが committed な控えである。**

| | |
|---|---|
| 検体 | **2,921 件**（`fixtures` 14 + veraPDF コーパス 2,907） |
| 読めなかった | **5 件**（下記） |
| 判定の行 | **31,221 行** |
| 状態の内訳 | `pass` 14,193 / `not_applicable` 15,461 / `needs_external_fact` 1,362 / **`fail` 205** |
| fail を 1 件以上持つ検体 | **152 件** |
| 一度も fail しない制約 | **`CT-FONT-3` の 1 件だけ**（他 25 件は 1 回以上 fail する） |

制約ごとの fail 件数（多い順）: `CT-ANNOT-3` 66 / `CT-ANNOT-9` 28 / `CT-META-2` 25 /
`CT-FONT-4` 24 / `CT-META-4` 17 / `CT-META-5` 15 / `CT-ANNOT-10` 5 / `CT-FONT-1` 3 /
以下 1〜2 件が 17 件。

**決定論は実測した。** 同じコードで 2 回全走し、`label` と `takenAt` を除いて
**2,921 検体すべてが完全に同一**（`diff` で差 0 件）。これがコーパス全体での空振り検査に当たる。

##### 🔴 この 5 件は「撤去後に読めるようになる」ことが予測される

| 検体 | pdf-lib の言い分 |
|---|---|
| `Isartor .../6.1.3 File trailer/isartor-6-1-3-t02-fail-a.pdf` | 暗号化されている |
| `PDF_A-2b/.../veraPDF test suite 6-1-3-t02-fail-a.pdf` | 暗号化されている |
| `PDF_A-4/.../veraPDF test suite 6-1-3-t02-fail-a.pdf` | 暗号化されている |
| `PDF_UA-1/7.16 Security/7.16-t01-fail-a.pdf` | 暗号化されている |
| `PDF_A-1b/.../6.1.2 File header/veraPDF test suite 6-1-2-t01-fail-b.pdf` | `Failed to parse number (line:0 col:5 offset=5)` |

normativepdf 0.9.0 は `parsePdf(bytes, { password })` が材料化の時点で復号する。
L2 のあと、この 4 件（暗号化）は**「読めなかった → 読めた」**として `diff` に出るはずで、
これは**是正**として帰属させる（判定が生まれるので `fail` が増えることもある —— §6 面 2 の
「`fail → pass` にも帰属が要る」の裏返しで、**新しく生まれた行は後退ではない**）。
残る 1 件はファイルヘッダの検体なので、`origin > 0` の読み方次第で結果が変わる。
**5 件とも、動かなかったら「なぜ動かなかったか」を書く。** 予測が外れることも観測である。

##### 🔴 ゴールデンの盲点 — `CT-FONT-3`

2,921 件のどれでも fail しない。**この制約が壊れても、A/B は片方向にしか気づけない**
（`pass → fail` は出るが、`fail → pass` は出しようがない）。L3 で
`embedded-font` の抽出器を触ったら、`CT-FONT-3` だけは A/B ではなくユニットテストで見る。

### L1. normativepdf の §7.9 文字列層を消費する

`decodeText()` × 6 を `decodeTextString` に置き換える。**この repo が第 1 消費者**
（前段 handoff の受入面 4）。

**前段 N は済んでいる**: normativepdf **0.9.0 が npm の latest**（2026-08-27 公開）。
B1 が要る記号は 14/14 が 0.9.0 の公開面にある（`parsePdf` `decodeTextString` `parsePdfDate`
`formatPdfDate` `dictGet` `dictGetRaw` `decodeStream` `CosDict` `CosArray` `CosName`
`CosString` `CosStream` `CosRef` `readPageTree`。2026-08-28 実測）。
自前の `parsePdfDate` の扱いは §3 の例外 2 を見ること。

#### 🔴 `decodeText()` 6 か所のうち、テキスト文字列は 2 か所だけだった（2026-08-28 実測）

`decodeText()` は pdf-lib のメソッド名であって、条項の名前ではない。中身は 2 つに割れる。

| 場所 | 受け取る型 | 条項 | L1 で置き換えるか |
|---|---|---|---|
| `document.ts` の `stringValue`（Info の日付） | `PDFString` / `PDFHexString` | **§7.9.2 テキスト文字列** | **する** |
| `annotation.ts` の `textOf`（`/Contents` 等） | `PDFString` / `PDFHexString` | **§7.9.2 テキスト文字列** | **する** |
| `document.ts` の `nameValue` | `PDFName` | §7.3.5 名前 | しない |
| `document.ts` の `/Trapped` | `PDFName` | §7.3.5 名前 | しない |
| `embedded-font.ts` の `nameValue` | `PDFName` | §7.3.5 名前 | しない |
| `annotation.ts` の `nameOf` | `PDFName` | §7.3.5 名前 | しない |

**名前はテキスト文字列ではない。** `decodeTextString` を名前のバイト列に当てると、
`#xx` の解決が無いうえに PDFDocEncoding として読むので、UTF-8 の名前（R-7.3.5-13）が壊れる。
名前の 4 か所は **L2 で `CosName.value` に置き換わる**（`#xx` の解決と UTF-8 の復号は
normativepdf の字句解析が済ませている）。L1 で触るのは 2 か所である。

L1 で入れた変更（2026-08-28）:

- `dependencies` に `normativepdf: 0.9.0` を足した（`pdf-lib` はまだ残る）
- 上の 2 か所を `decodeTextString(Uint8Array.from(value.asBytes()))` にした
- `stringValue` の分岐を `decodeText` から **`asBytes`** に変えた。pdf-lib では
  `PDFName` も `decodeText` を持つので、以前は名前もここでテキスト文字列として復号していた
- `evaluate.ts` の `parsePdfDate` を、normativepdf の `parsePdfDate` の戻り値
  （`PdfDate`）を UT へ畳む薄い変換にした。**公開している形（`number | null`）は変えない**

**予測される A/B の差**（`node scripts/golden.mjs diff .golden/before.json .golden/after-L1.json`）:

1. **UTF-8 BOM 付きのテキスト文字列**が読めるようになる（pdf-lib 1.x は `R-7.9.2.2.1-4` を
   満たしていない）。normativepdf のコーパス実測では、テキスト文字列 2,612 件のうち
   差は 6 件で**すべてこれ**。日付でも 941 件中 2 件が該当する（読めなかった → 読める）
2. **UTF-16BE の言語エスケープ列**（§7.9.2.2.2）が取り除かれる。pdf-lib は残していた
3. **日付の文法が条文どおりになる。** アポストロフィと分オフセットの前後関係
   （R-7.9.4-14 / -15）を守らない文字列は `null` になる。PDF 1.7 の末尾アポストロフィは
   受け入れる（NOTE 2）ので、既存のテストはそのまま通るはず

1 と 3 は**是正**（条文が正）。2 は言語エスケープ列を持つ検体があれば出る。
**どれも「予測」であって、出なかったら出なかったことを書く。**

##### 実測（2026-08-28）— **3 つとも出なかった。理由は検体側にある**

`npm test` 38 件・`npm run check`・`npm run build` は通り、
`diff .golden/before.json .golden/after-L1.json` は **差 0 件**（受入は満たす）。
予測が 1 つも出なかったので、**判定ではなく事実の側を測り直した**（使い捨ての probe。
`pdf-lib` の `decodeText()` と normativepdf の `decodeTextString()` を突き合わせる）:

| 測ったもの | 件数 |
|---|---|
| この消費者が読むテキスト文字列（Info の日付 + 注釈の `/Contents` `/T` `/Subj` `/RC` `/NM` `/DA`） | **1,470 件** |
| うち UTF-8 BOM 付き | **0 件** |
| うち UTF-16BE BOM 付き | 30 件（**言語エスケープ列を含むものは 0 件**） |
| 2 実装の復号結果が違うもの | **0 件** |
| Info の日付（旧の正規表現と normativepdf の比較） | 964 件中 **962 件が同値・2 件は両方 null・差 0 件** |
| コーパス全体の文字列（間接オブジェクトを全走査。この消費者が読まないものも含む） | **29,344 件**・UTF-8 BOM **0 件**・UTF-16BE BOM 291 件・復号の差 **0 件** |

🔴 **原因は検体の集合。** normativepdf の差分オラクルが「UTF-8 BOM で 6 件差」と測ったのは
`corpus/` **全体**で、その 6 件は `corpus/pdf20examples/`（7 件・PDF 2.0 の例）側にある。
L0 で採ったゴールデンは `--set fixtures --set ../normativepdf/corpus/veraPDF-corpus` だけで、
**`pdf20examples/` と `_wout/` を入れていなかった** —— つまり
**この変更が動かすと予測した軸そのものが検体に無かった**（[[fixtures-produce-only-one-shape]] の
コーパス版）。`pdf20examples/` には `PDF 2.0 UTF-8 string and annotation.pdf` /
`pdf20-utf8-test.pdf` / `PDF 2.0 with offset start.pdf` が入っている。

**以後、検体の集合はこの 4 つで固定する**（L0 のゴールデンも採り直す）:

```bash
node scripts/golden.mjs take .golden/before-full.json --label before-full \
  --set fixtures \
  --set ../normativepdf/corpus/veraPDF-corpus \
  --set ../normativepdf/corpus/pdf20examples \
  --set ../normativepdf/corpus/_wout
```

**もう 1 つ、ゴールデンの性質として記録しておく**: ゴールデンは**判定**を凍結する。
`pass` の行は状態しか持たないので、**判定を動かさない事実の変化は写らない**。
「差 0 件」は「判定が変わらなかった」であって「何も変わらなかった」ではない。
事実の側を測るには、上のような probe を別に当てる。

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

### 未決 1 — `FactExtractor` / `collectSubjects` の公開 → **決着（2026-08-27・shuji）: 案 B**

> 「実質の消費者 0 件なら、配慮せず最も正しい姿にする」。**export をやめて内部に閉じる。**
> 版は **0.3.0 → 0.4.0**（0.x のまま minor + 告知。1.0.0 には上げない）。
> 以下は決着の根拠として残す。

3 案:

| 案 | 内容 | 影響 |
|---|---|---|
| **A** | 型を `CosDict` ベースに変えて export し続ける | 破壊的変更。normativepdf の型が公開面に出る |
| **B** | export をやめ、内部に閉じる | 破壊的変更。ただし実際の消費者は 0 件 |
| **C** | `doc` を受け取らない形に変え、`Subject[]` を返す関数だけ残す | 設計変更。抽出器の差し替え点が消える |

**B を推す。** 実際に触っている消費者が 0 件で、`checkBytes` / `checkFile` という
バイト列を受ける入口が既にあるため。外部の拡張点として残す必要が立ってから A に戻せばよい。
どの案でも公開面が変わる。**0.x のまま minor + 告知**を採った（上記の決着）。

### 未決 2 — `devDependencies` に pdf-lib を残すか（推し = 残さない）

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
