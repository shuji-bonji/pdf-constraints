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

🔴 **`--set` は 1 つずつ直接書く。** 2026-08-28、`SETS="--set a --set b"` を `$SETS` で
渡したところ、**zsh は引用符なしの変数展開を単語分割しない**ので 1 個の引数として届き、
`--set` が 0 個と見なされて既定（`fixtures` だけ 14 件）で採れてしまった。
**計器はそれを黙って捨てていた** —— zod 3 の strip と同じ形である。
`scripts/golden.mjs` は宣言に無い引数で止まるようにした（`take` / `diff` とも）。
`diff` は検体の集合（`--set` の並びと件数）も申告し、違えば受入違反として数える。
zsh で変数にまとめるなら `${=SETS}` と書く。

**もう 1 つ、ゴールデンの性質として記録しておく**: ゴールデンは**判定**を凍結する。
`pass` の行は状態しか持たないので、**判定を動かさない事実の変化は写らない**。
「差 0 件」は「判定が変わらなかった」であって「何も変わらなかった」ではない。
事実の側を測るには、上のような probe を別に当てる。

##### 4 set で採り直した結果（2026-08-28）— **予測 1 が出た。1 検体・1 制約**

検体 **2,931 件**（読めなかった 5 件は変わらず）。差は 2 行で、**同じ 1 検体**である。

```
DIFF pdf20examples/pdf20-utf8-test.pdf: violations 2 -> 0
DIFF pdf20examples/pdf20-utf8-test.pdf: CT-META-3 / (document): fail->pass
```

**帰属: 是正。しかも「誤検出だったもの」が消えた側の是正である。**
ゴールデンが持っていた `before` の `failures` に、そのまま証拠が残っていた:

| | |
|---|---|
| 制約 | `CT-META-3`「Info の日付値は §7.9.4 の日付文字列文法に従うこと」 |
| 条文 | R-7.9.4-2 / -12 / -14 / -15 |
| before の `actual` | `ï»¿D:20211230134641+11'00'`（`/CreationDate`）・`ï»¿D:20211230134824+11'00'`（`/ModDate`） |
| after | 2 件とも消えて `pass` |

先頭の `ï»¿` は **UTF-8 の BOM（`EF BB BF`）を PDFDocEncoding として読んだ姿**である。
pdf-lib は `R-7.9.2.2.1-4` を実装していないので、この 3 バイトを本文の一部として復号し、
文字列は `D:` で始まらなくなる。制約はそれを見て**「この文書の日付は文法に合わない」と
2 件の違反を報告していた。ファイルは条文に適合しており、違反は道具の側の産物だった。**

`(document)` スコープの他の 5 制約は前後とも `not_applicable` のままで、
**「制約が反証できなくなった」形の `fail → pass` ではない**（§6 面 2 の後退の可能性はここでは無い）。

予測 2（言語エスケープ列）と予測 3（日付の文法）は、2,931 件のどこにも該当検体が無く、
**出なかった**。probe の数字（UTF-16BE 291 件中、言語エスケープ列 0 件／日付 964 件中、
旧実装との差 0 件）と整合する。

### L2 + L3. 入口と抽出器 3 本（**分けられない**・2026-08-28 実施）

🔴 **L2 と L3 は切り離せなかった。** `check.ts` の入口を替えると、そこから流れる `doc` の型が
`collectSubjects` と抽出器 3 本すべてに当たる。入口だけを替えて抽出器を pdf-lib のままにするには
同じファイルを 2 つのパーサで読むしかなく、それは測る対象を 2 つにする。まとめて実施した。

入れたもの:

- `src/check.ts`: `PDFDocument.load(bytes, { updateMetadata: false })` → **`await parsePdf(bytes)`**。
  `updateMetadata: false` は pdf-lib が Info を書き換えないための引数で、読むだけなら要らない
- **`src/facts/cos.ts` を新設**（120 行）。`instanceof` と `context.lookup` に相当するものを
  `kind` の見分けと `await doc.resolve` の上に置き直した共通部分。ここに判定は書かない
- 抽出器 3 本と `collectSubjects` を **async 化**（`resolve` / `getObject` が async なため。
  圧縮オブジェクトはフィルタ付きのオブジェクトストリームの中にある）
- `enumerateIndirectObjects()` → `doc.xref` を歩いて `getObject`。**読めない 1 件で文書全体を
  落とさない**（try/catch で飛ばす）
- `doc.getPages()` → `readPageTree`（継承の解決つき・§7.7.3.4）
- `decodePDFRawStream(stream).decode()` → `decodeStream`。`/Filter` と `/DecodeParms` が
  間接参照のときは**先に解決してから**渡す（`decodeStream` の解決口は同期のため）
- **`src/` から `from 'pdf-lib'` が 0 件になった**（`package.json` の依存は L4 で落とす）

**波及は `checkBytes` で止まった**（§4 の予測どおり）。公開 API の形は変わらない。

#### 予測される A/B の差（L2+L3）

1. **暗号化 4 検体が「読めなかった → 読めた」になる。** normativepdf は材料化の時点で
   復号する。**新しく生まれた行が `fail` でも後退ではない**（判定が生まれただけ）
2. **壊れた xref の検体が「読めた → 読めない」に落ちうる。** §7.5.4 を条文どおり厳格に読み、
   回復方針は消費者側に置く設計（normativepdf `DESIGN.md` §4.2）。verify の `revision-diff.ts`
   移行では 2,987 件中 6 件が該当した。**計器はこれを受入違反の側に数える**ので、
   出たら 1 件ずつ「読めなくなったのは条文どおりか」を書いて帰属させる
3. **`has()` が null 等価規則を適用する。** `dictGet` は「値が null のエントリは無いのと同じ」
   （R-7.3.7-7）を適用する。pdf-lib の `dict.has()` は鍵の有無しか見ない。
   `annot.hasType` / `hasAS` / `hasBM` / `hasRT` / `hasIRT` / `hasP` が動きうる
4. **名前の 4 か所が `CosName.value` になる。** `#xx` の解決と UTF-8 の復号は字句解析が
   済ませている（R-7.3.5-13）。`#`-エスケープを含む名前で差が出る
5. **Info の日付が間接参照で書かれている場合、`null` になる。** 以前は pdf-lib の
   `PDFRef` が文字列化されて `"1 0 R"` が fact に入っていた（それも日付ではないので
   `CT-META-3` は fail のまま。判定は動かない見込み）

#### L2+L3 の A/B 実測（2026-08-28・2,931 検体）

`npm run build` / `npm test`（38 件）/ `npm run check` は通った。A/B は
**受入違反 131 件・帰属を書く差 27 件**。中身は 5 群に分かれる。

| 群 | 件数 | 帰属 |
|---|---|---|
| 暗号化 4 検体が「読めなかった → 読めた」 | 4 | **是正**（予測 1。normativepdf は材料化の時点で復号する） |
| 名前が `TMJTIB+FreeMonoBold#c4` → `TMJTIB+FreeMonoBoldÄ` | 10 行（2 検体・消えて増える） | **是正**（予測 4。`#xx` の解決。判定は同じで label だけ動いた） |
| UTF-8 BOM の日付（L1 から継続） | 2 | **是正** |
| 「読めた → 読めない」14 件 | 14 | **厳格化**（予測 2）。エラーが条文を名指ししている（§7.5.4 の xref・§7.5.2 のヘッダ・§7.7.2 の catalog `/Version`）。すべて veraPDF の *fail* 検体 |
| 🔴 **未決 2 件**（下記） | 115 + 2 | **後退。受入を満たさない** |

##### 🔴 未決 1 — 「観測できなかった」が「違反」に化ける（`pass → fail` 2 件）

`PDF_A-2b/6.1.7.1 General/veraPDF test suite 6-1-7-1-t01-fail-a.pdf` で
`CT-FONT-1` と `CT-FONT-4` が `pass → fail`。実測した原因:

```
FontDescriptor obj 15 → FontFile2 = 17 0 R
  resolve 失敗: keyword "stream" shall be followed by CRLF or LF, not CR alone
                (R-7.3.8.1-6) (at byte 5580)
```

意図的に壊した検体で、normativepdf は条文どおり拒否する。pdf-lib は緩く読めていた。
`cos.ts` の `lookup` がその失敗を握って `undefined` を返すため、
`program.container` / `stream.dict.Length1` が**初期値 `null` のまま**制約に食われ、
「フォントプログラムが読めなかった」ではなく「**違反している**」と判定された。

**この repo が冒頭で自ら禁じている形である**（「観測できなかったものは `null`（= 未取得）。
false に倒すと冤罪になる」）。評価器の 4 状態に「観測できなかった」は無く、
`needs_external_fact` は `given.*` の未供給専用である。

##### 🔴 未決 2 — 観測が不完全なまま判定が出る（`行が消えた` 115 件の実体）

`_wout/dss-pades-5sigs-doctimestamp-w2.pdf` で subjects が **10 → 1**。実測:

```
chainStop {"kind":"prev-zero","offset":335210}
xref エントリ 9 / 取れた dict 6・array 1・stream 1 / 落ちた 0
readPageTree → pages 0, reached false
trailer Info: 108 0 R（xref に無いので解決できない）
```

**`/Prev 0` でリビジョンチェーンが打ち切られている**ので、`xref` には最新セクションの
9 件しか無い。pdf-lib は全リビジョンのオブジェクトを列挙していた。結果、注釈 6 と
フォント 3 の subject が消え、`CT-META-1/2/4` が `pass → not_applicable` に落ちた。

**normativepdf は正しい**（[[prev-zero-swallowed-is-a-complete-chain]] と同じ線）。
問題は、**その文書の観測が不完全であることが `CheckReport` のどこにも出ない**こと。
「注釈が 1 つも無い文書」と「注釈を読めなかった文書」が同じ顔になる。
`doc.chainStop` は `PdfDocument` が持っているので、観測できる。

#### 決裁と対処（2026-08-28・shuji）— **L2+L3 は受入充足**

- **未決 1 = 案 B。** 指し先はあるのに**条文違反で受け取れなかった**とき
  `descriptor.fontFileKey` を `unreadable` にする。`CT-FONT-1` / `CT-FONT-4` は
  `when` がこの fact で門を開けているので `not_applicable` に落ちる。行は残る。
  🔴 **一度これを広く取りすぎて後退を作った**: 指し先が**存在しない**参照まで
  `unreadable` にしたため、`CT-FONT-5` が 2,931 件で唯一 fail していた検体
  （`6.2.11.4.1 Embedding` = フォントが埋め込まれていない）が `not_applicable` に落ちた。
  **計器の軸の申告「一度も fail しない制約」が 1 → 2 件に増えて捕まえた。**
  未定義の間接参照が null と等価なのは R-7.3.10-13 が定めることで、**観測できた事実**である。
  `cos.ts` の `tryLookup` で 2 つを分けた
- **未決 2 = `CheckReport.observation` を足す。** `xrefChain` / `objects` /
  `pagesReached` / `pages`。**判定ではなく判定の射程。** CLI は `complete` でないときだけ
  1 行足す（`exit 0` は「違反が無かった」であって「全部を検査できた」ではない、と
  同じ位置）

#### L2+L3 の最終 A/B（2026-08-28・2,931 検体）— 全 10 群の帰属

`npm run build` / `npm test`（38 件）/ `npm run check` は通る。
**`pass → fail` 0 件・`fail → not_applicable` 0 件・「一度も fail しない制約」は
`CT-FONT-3` の 1 件のまま**（L0 と同じ）。

| 遷移 | 件数 | 帰属 |
|---|---|---|
| 行が消えた | 115 | **観測の範囲**。105 行は `_wout/dss-pades-...-w2.pdf`（`/Prev 0` でチェーン打ち切り・`observation` が申告）、10 行は名前のラベル変更の片側 |
| 読めた → 読めない | 14 | **厳格化**。エラーが条文を名指ししている（§7.5.4 の xref・§7.5.2 のヘッダ・§7.7.2 の catalog `/Version`）。14 件とも veraPDF の *fail* 検体 |
| 行が増えた | 10 | **是正**。`TMJTIB+FreeMonoBold#c4` → `TMJTIB+FreeMonoBoldÄ`（`#xx` の解決・R-7.3.5-13）。消えた 10 行と対で、判定は同じ |
| `pass → not_applicable` | 9 | 7 件は `CT-META-1/2/4`（Info / XMP が読めた範囲に無い・`observation` が申告）、2 件は `CT-FONT-1/4`（`unreadable`） |
| 読めなかった → 読めた | 4 | **是正**。暗号化 4 検体。normativepdf は材料化の時点で復号する |
| `not_applicable → pass` | 2 | **是正**。`Isartor test suite manual.pdf` の `CT-META-4/5`。実測: **pdf-lib は `trailerInfo` に `Info` の鍵を持ちながら値を `undefined` で落としていた**（`XRefStm` を持つハイブリッド文書）。normativepdf は `Info = 283 0 R` を読む。日付が揃ったので `when` が成立し、Info と XMP は完全等価で `pass` |
| `subjects` | 1 | 上記 `_wout`（10 → 1） |
| `violations` | 1 | `pdf20-utf8-test.pdf`（2 → 0） |
| `fail → pass` | 1 | **是正**。UTF-8 BOM の日付（L1 から継続） |
| 読めない理由の文言 | 1 | ヘッダの検体。前後とも読めない。文言が条文を名指しする側に変わった |

**受入 3 面の判定**: 面 1（撤去）は `src/` から `pdf-lib` 0 件で L4 待ち。
面 2（判定の A/B）は上表のとおり全件帰属済みで、後退は 0 件。
面 3（独立オラクル）は pdf-lib で採ったゴールデンがそのまま担っている。

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

**2026-08-28 追記 — 観測の範囲が変わる差を分けて数える。**
L2+L3 の実測で、上の 3 分類に収まらない差が 2 種類出た。どちらも
「判定が変わった」のではなく「**読めた範囲が変わった**」ものである。

| 差 | 受入 | 理由 |
|---|---|---|
| **読めた → 読めない**（文書ごと） | **帰属付きで許容**。エラーが**条文を名指ししていること**を条件にする | §7.5.4 / §7.5.2 / §7.7.2 を条文どおり厳格に読む設計で、回復方針は消費者側に置く（normativepdf `DESIGN.md` §4.2）。14 件とも veraPDF の *fail* 検体 |
| **行が消えた / 増えた**（subject ごと） | **帰属付きで許容**。ただし `CheckReport.observation` が「文書全体は読めていない」と申告していることを条件にする | リビジョンチェーンの打ち切りなどで、その subject を運ぶオブジェクトが読めた範囲に無い。申告が無いまま行が消えるのは**見逃し**であり、許容しない |

**`fail → not_applicable` は最も危険な差である。** 制約が反証できなくなった形で、
`take` が毎回印字する「一度も fail しない制約」の件数が増える。
2026-08-28 に実際に踏んだ（下記 L2+L3 の記録）。**この件数が増えたら、増えた制約を名指しして
「なぜ判定しなくなったか」を書く。**

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
