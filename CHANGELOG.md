# Changelog

All notable changes to this project will be documented in this file.

## [0.6.1] - 2026-08-30

Reads through [`@normativepdf/recover`](https://www.npmjs.com/package/@normativepdf/recover)
**0.1.2** instead of 0.1.1. One specimen stops being guessed at.

### Changed

- **依存: `@normativepdf/recover` 0.1.1 -> 0.1.2。** 0.1.2 は、`startxref` がどれも
  読めない文書で**相互参照節そのものをファイルの中から探す**ようになった版である
  （§7.5.8.1 —— 相互参照ストリームは `N G obj` で書かれた普通の間接オブジェクトなので
  走査で見つかる）。

  🔴 **この上げ方は任意ではない。** 0.6.0 は `@normativepdf/recover` を `0.1.1` に
  **完全一致で固定**していた。消費側（pdf-verify-mcp）が 0.1.2 に上げても、npm は
  この package の下に 0.1.1 を入れ子で置くので、`checkFile` は古い読み口を通り続ける。
  実測: 入れ子に 0.1.1 を置くと `ua-broken-startxref.pdf` は `ParseError` のまま、
  外して 0.1.2 を読ませると 11 オブジェクト・ページツリー到達になる。

### Fixed（計器）

- **`scripts/golden.mjs` が `observation` を凍結する。**

  🔴 判定だけを凍結していたので、**読めた範囲が動いても差 0 件になっていた。**
  この依存の上げを最初に測ったとき、A/B は差 0 件を出した。実際には veraPDF の
  `6-1-2-t01-fail-a.pdf` が「組み直した 17 件」から「ファイルの表の 18 件」へ
  変わっている。`observation` は `CheckReport` の公開項目で、0.5.0 で `scope` を
  足したところでもある —— そこが動いたことを言えない計器は、その版の主張を支えられない。

  凍結するのは `xrefChain` `objects` `pagesReached` `pages` と `scope` の
  `recovered` / `reconstructed` / `newestSectionUnreadable` / `sections` /
  `chainStop` / `continuedPastStop` / `filledFromScan` / `encrypted` /
  `authenticated`、それに `refusal` の有無。`refusal` の**文面は取らない** ——
  normativepdf のメッセージそのままで、版が上がれば言い回しが変わる。

  T-3 に 3 件足した（8 -> 11）。**判定を 1 つも動かさずに読めた範囲だけを動かす**
  変異で、0.6.0 の計器は 3 件とも差 0 件を返していた。

  この項目を持たないゴールデン（0.6.0 以前）と突き合わせても差にはしない。

### 受入（A/B・検体 2,934 件）

`@normativepdf/recover` だけを 0.1.1 と 0.1.2 で入れ替え、同じ dist で採った。

```
before-rec012.json <-> after-rec012.json
  🔴 pass -> fail / 読めた -> 読めない / 行が消えた : 0 件
  帰属を書く差                                     : 5 件（1 検体）

veraPDF-corpus/PDF_A-1b/6.1 File structure/6.1.2 File header/
  veraPDF test suite 6-1-2-t01-fail-a.pdf
    observation.xrefChain      "unreadable" -> "complete"
    observation.objects        17           -> 18
    observation.reconstructed  true         -> false
    observation.sections       0            -> 1
    observation.chainStop      "unreadable" -> "complete"
```

**判定（`rows`）は 1 行も動いていない。** 動いたのは射程の申告だけで、向きは
「組み直した（推測）」から「ファイルが持っている表を読んだ」である。

計器の T-3 は 11 件とも差を報告した。単体 41 件・`validate:tables` 3 表・
`check:engines`・`typecheck` / `typecheck:tests` / `biome` / `build` は緑。

## [0.6.0] - 2026-08-29

An encrypted document whose key cannot be derived was reported as `pass`. It is now
`needs_external_fact`.

### Fixed

- **`checkBytes` / `checkFile` no longer return `pass` for a document they could not read.**
  When `/Encrypt` is present and the empty password does not produce the file key,
  `openDocument` returns a document but hands out no objects — it does not serve ciphertext
  with the face of plaintext (ADR-0008). Every fact then comes back `null`, every assert
  guarded by `onlyWhen: exists` is skipped, and the result was **zero violations, therefore
  `pass`**. Two specimens (`ua-enc-aesv3-pw.pdf`, `ua-enc-aesv2-pw.pdf`) reported
  `CT-META-3: pass` on documents where not one object had been read.

  A password is a fact that cannot be determined from the file alone. That is what
  `needs_external_fact` is for. When `scope.encrypted` is true and `scope.authenticated` is
  false, every constraint in the loaded tables now yields:

  ```
  status:  needs_external_fact
  missing: given.password
  target:  (document)
  ```

  A document that *is* encrypted but whose key the empty password does derive
  (`ua-enc-aesv3.pdf`) is unaffected and is judged as before. The condition is
  "the key could not be derived", not "the file is encrypted".

### Added

- `fixtures/ua-enc-aesv3-pw.pdf`, `fixtures/ua-enc-aesv2-pw.pdf`, `fixtures/ua-enc-aesv3.pdf`
  — the axis was absent from this package's specimen set, so the first A/B over 2,934
  specimens showed **0 differences** for a change that fixes two of them. The specimens came
  from pdf-verify-mcp's `.golden/specimens`.

### 受入（A/B・検体 2,934 件）

```
before-0.6.0.json <-> after-0.6.0.json
  🔴 pass -> fail / 読めた -> 読めない / 行が消えた : 0 件
  pass -> needs_external_fact                    : 2 件（CT-META-3 × 2、直したかったもの）
  not_applicable -> needs_external_fact          : 10 件
  行が増えた                                     : 40 件
```

52 行はいずれも `-pw` の 2 検体（26 制約 × 2）から出ている。他の 2,932 件は 1 行も動いていない。

**空振り検査の対**: `ua-enc-aesv3.pdf`（暗号化されており、かつ空パスワードで鍵が導ける）は
`pass:3 / not_applicable:3` のまま変わらない。分岐から `!scope.authenticated` を外すと
この検体のテストだけが落ち、分岐ごと外すと `-pw` の 2 件のテストだけが落ちる。

単体 41 件・`validate:tables` 3 表・`check:engines` は緑。

## [0.5.0] - 2026-08-29

PDFs are now opened through
[`@normativepdf/recover`](https://www.npmjs.com/package/@normativepdf/recover) instead of
calling `parsePdf` directly. The core refuses a file that violates the clauses — correct for a
library, but it left this package with **nothing to say** about those files. **15 of 2,931
specimens produced a `ParseError` and had not a single constraint applied to them.** They are
now checked.

### Added

- `observation.scope` — how far the document could be read
  (`recovered` / `chainStop` / `reconstructed` / `sections` / `objects` / … ).
  🔴 **This is not a verdict.** When `reconstructed` is true the cross-reference table was
  rebuilt rather than read from the file, and a reader of the results has to be told so:
  "no failures" and "that part was never observed" are different statements.
  The COS `/Encrypt` dictionary is not included (it would leak the internal representation).

### Removed

- `src/facts/cos.ts` (141 lines, internal). The COS reading helpers now come from
  `@normativepdf/recover`, which is the same code pdf-verify-mcp reads through.
  14 functions were duplicated by name across the two packages and **`has()` disagreed**:
  this package applied ISO 32000-2 §7.3.7 ("a dictionary entry whose value is null shall be
  treated the same as if the entry does not exist"), the other did not. The clause won;
  `@normativepdf/recover` 0.1.1 carries the fix (ADR-0010, acceptance face 2).

### 受入（A/B・検体 2,931 件）

```
base-0.4.0.json <-> after-recover.json
  🔴 pass -> fail / 読めた -> 読めない / 行が消えた : 0 件
  読めなかった -> 読めた                          : 15 件（受入 3 の予測どおり）
  行が増えた                                     : 105 件（読めるようになった検体から出た行）
  not_applicable -> pass                        : 5 件（同じ 15 件の中）
  subjects 1 -> 10                              : 1 件
```

最後の 1 件は `_wout/dss-pades-5sigs-doctimestamp-w2.pdf` —— `/Prev 0` でチェーンが
切れている文書で、条文どおりに読むと目録の向こうが見えない。回復方針で読み進めた結果、
フォントの subject が 9 件増えた。**判定が緩んだ差は 1 件も無い。**

単体 38 件・`validate:tables` 3 表・`check:engines` は緑。

## [0.4.0] - 2026-08-28

`pdf-lib` is gone from the dependencies; PDFs are read through
[`normativepdf`](https://www.npmjs.com/package/normativepdf) 0.9.0, which reads the clauses
directly. **Some files are judged differently as a result.** The change was measured over 2,931
specimens (`fixtures` + the veraPDF corpus + the PDF 2.0 examples + round-trip output) against a
frozen report taken while pdf-lib was still in place, and every difference is accounted for:
**no `pass → fail`, and no `fail → not_applicable`** — that is, no constraint stopped being able
to disprove anything.

### Removed

- **`collectSubjects`, `extractors` and `FactExtractor` are no longer exported** (breaking).
  Fact extraction is internal now. The extractors are meant to be replaceable, and a consumer
  holding their type makes the public surface move every time the reader underneath changes.
  The entry points are `checkBytes` and `checkFile`. If an external extension point is ever
  needed, it will come back in a form that does not name a parser's types.
- `pdf-lib` is no longer a dependency (and is not in `devDependencies` either).

### Added

- **`CheckReport.observation` — how much of the file was read. It is not a verdict.**
  `xrefChain` (where the walk up the `/Prev` chain stopped, §7.5.6), `objects`, `pagesReached`
  and `pages`. "A document with no annotations" and "a document whose annotations could not be
  read" look the same in `results`; that the observation did not cover the whole file can only
  be said here. The CLI prints one line about it when `xrefChain` is not `complete`.
- **`descriptor.fontFileKey` can now be `unreadable`** — the font program is referenced, but the
  object could not be taken (a clause violation) or could not be decoded. Every constraint that
  looks at embedding gates on this fact, so they fall to `not_applicable`: **what could not be
  observed is not reported as a violation.** A reference whose target does not exist is *not*
  `unreadable` — an undefined indirect reference is equal to null (R-7.3.10-13), which is
  something observed about the file, so the constraints still judge it.

### Changed

- **Text strings with a UTF-8 byte order mark are read** (R-7.9.2.2.1-4, PDF 2.0). pdf-lib 1.x
  does not implement this: a `/CreationDate` beginning `EF BB BF` was decoded as PDFDocEncoding
  and became `ï»¿D:...`, so `CT-META-3` **reported two violations against a conforming file**.
  Language escape sequences in UTF-16BE strings (§7.9.2.2.2) are now removed as well.
- **Date syntax follows `normativepdf`'s `parsePdfDate` (§7.9.4).** The exported
  `parsePdfDate(value): number | null` keeps its shape.
- **A name object's `#xx` escapes are resolved in `target`** (R-7.3.5-13): a report that read
  `TMJTIB+FreeMonoBold#c4` now reads `TMJTIB+FreeMonoBoldÄ`.
- **A dictionary entry whose value is null counts as absent** (R-7.3.7-7).
- **Encrypted documents can be read.** `parsePdf` decrypts as the objects are materialised (§7.6).
- **The trailer `/Info` of a hybrid-reference file (`XRefStm`) is read.** pdf-lib carried the key
  with an undefined value, so the Info dates were never observed.
- 🔴 **A file whose structure violates the clauses is no longer read at all.** The
  cross-reference table (§7.5.4), the file header (§7.5.2) and the catalog `/Version`
  (§7.7.2 Table 29) are read strictly, and recovery is left to the consumer. Fourteen corpus
  specimens are affected, all of them deliberately broken *fail* files. `checkBytes` and
  `checkFile` throw for those.
- 🔴 **When the revision chain is truncated, only what was read is judged.** On a `/Prev 0`
  specimen the subject count went from 10 to 1. `observation` is what says so.

### Requires

- Node.js 20 or later (unchanged)
- `normativepdf` 0.9.0

## [0.3.0] - 2026-07-28

### Added

- **A failing assertion now carries its `note` into the result.** The tables have been able to
  attach a note to an assertion since 0.1.0, but the evaluator dropped it, so it reached nobody.
  `Failure.note` is optional and additive; consumers that ignore it are unaffected. The CLI
  prints it as a `Context:` line.

  This surfaced with CT-ANNOT-9. The clause requires counterclockwise `QuadPoints`
  (R-12.5.6.10-5) and essentially every real-world writer uses Z order instead, deliberately,
  because following the clause literally breaks rendering in major viewers. Without the note the
  report said only "the vertex order is not counterclockwise" — true, and read as a defect. A
  constraint whose failure needs context is not served by a message field alone: **the context
  has to travel with the failure, or it does not exist.**

## [0.2.0] - 2026-07-28

### Added

- **A third table: `annotation` (CT-ANNOT-1〜15), mapped from ISO 32000-2 §12.5.** It covers the
  appearance dictionary a writer owes (`AP`), paragraph breaks in `Contents`, the syntax of `C`,
  `BM` and `F`, `QuadPoints` winding, the `Popup` / `IRT` relationships, and the rule that an
  annotation dictionary belongs to exactly one page.

  **`AP` is the reason this domain was chosen.** ISO 32000-1 made the appearance dictionary
  optional and 32000-2 made it a `shall` for writers, so a validator built on 32000-1 — which is
  what PDF/UA-1 validation is — never asks about it. Measured on specimens produced by the two
  writer versions that bracket the fix: `@shuji-bonji/pdf-writer-mcp@0.9.1` fails CT-ANNOT-3 on
  all three annotations it can write and CT-ANNOT-5 on the one carrying a line break, while
  v0.16.0 fails neither.

- **A new scope, `annotation`** (one annotation = one subject), with its fact extractor. The
  registry was written expecting this; `page` was deliberately **not** added — per-page facts
  (`/NM` duplication, `/IRT` on the same page, references from more than one page) are computed
  during extraction and carried on the annotation subject instead.

- **Specimens.** `bad-annot-0.9.1` / `good-annot-0.16.0` carry the known regression pair;
  `synthetic-annot-good` / `synthetic-annot-bad` (built by `scripts/gen-annotation-specimens.mjs`)
  exercise every constraint from both sides. The good specimen is checked to reach `pass` — not
  merely `not_applicable` — on all fifteen, because a rule that is only ever skipped has not
  been tested.

### Notes

- **No new predicate operators.** The frozen set of eight still covers a third domain; what grew
  instead is the fact vocabulary. The trade is deliberate and it has a cost: judgements such as
  "is this quadrilateral counterclockwise" now live in the extractor rather than in the table, so
  `factVocabulary` states the deciding rule for each of them.

- **CT-ANNOT-9 fails on output from pdf-writer-mcp, and that is the intended result.** The clause
  requires counterclockwise vertices (R-12.5.6.10-5); the industry writes them in Z order, which
  is not merely clockwise but **not a simple polygon at all** — opposite edges cross and the
  signed area is zero, so the fact reports `nonSimple`. Writing the table to let that pass would
  have made it a ruler shaped to fit one implementation. The failure carries a note explaining
  that following the clause literally breaks rendering in major viewers, and leaves the decision
  to the reader.

- **Table rows marked "(Required)" carry no requirement id in the corpus**, since they are not
  `shall` sentences. Rather than invent ids, those constraints cite the row as
  `Table 166:Subtype`; `source.table` / `source.key` carry the same information for re-collation
  when the pdf-spec corpus is updated.

- **R-12.5.2-9 (`/M` date format) is not mapped.** The clause says the format *should* be a date
  string, and the `shall` binds processors to accept any format. Mapping it would have
  manufactured a requirement out of a recommendation.

## [0.1.1] - 2026-07-26

### Fixed

- **`README.ja.md` was missing from the published package.** `files` did not list it, and npm
  only auto-includes `README.md` — so the `[日本語](./README.ja.md)` link on the npm page led
  nowhere. It is now packaged alongside the English README.

### Documentation

- **The README is now English, with the Japanese kept as `README.ja.md`.** The npm page and the
  GitHub landing page are what a reader sees before anything else, and they were addressing only
  part of the audience. Nothing about the package's behaviour changed.

## [0.1.0] - 2026-07-26

### Added

- **First release — constraint tables and a deterministic evaluator.** Extracted from the
  proof of concept in [pdf-spec-mcp#12](https://github.com/shuji-bonji/pdf-spec-mcp/issues/12)
  after the mapping was shown to work across two domains: the first re-detected known
  defects (writer W-2/W-3/W-4), the second found an unknown one
  (writer W-6, `ensure_pdfa` writing a non-equivalent `xmp:CreateDate`).

- **Two tables.** `font-embedding` (CT-FONT-1〜5; ISO 32000-2 §9.9.1, §9.9.2, §9.7.4.2 and
  Tables 124/125) and `document-metadata` (CT-META-1〜6; §14.3.2, §14.3.3, §14.3.4, §7.9.4).
  Each records where it was mapped from (`sourceSpec`), so it can be re-checked when the
  specification corpus moves.

- **Four states, no verdict.** Constraints resolve to `pass` / `fail` / `not_applicable` /
  `needs_external_fact`. The last exists because some clauses depend on facts that are not in
  the file — whether a font is a *subset* is known only to whoever made it. Those are supplied
  through `given.*`; without them the constraint degrades rather than defaulting into a silent
  pass or a false accusation.

- **"Violation" vs "trace of a violation".** Where a clause addresses the PDF *processor*
  (the act of writing), a file can only show that someone broke it — not that the last writer
  did (§14.3.4 explicitly allows leaving an existing inconsistency alone). Such constraints
  carry `subjectNote` and their failures are reported as traces.

- **CLI with three exit codes** — 0 no violations found, 1 violations found, **2 could not
  decide**. Keeping "could not decide" out of 0 and 1 is deliberate: reading exit 0 as success
  is how a tool that silently did nothing got mistaken for one that worked.

- **The tables are validated too** (`npm run validate:tables`, wired into CI). A constraint
  table is a mapping of normative text, not inert data; treating it as data is how a synthesised
  table with fabricated rows once became the baseline for its own acceptance test. The validator
  is dependency-free, reads `tables/schema.json` as the single source for enums and patterns, and
  additionally checks what JSON Schema cannot express — that every fact a predicate references
  is declared in the vocabulary, and that constraints with a `subjectNote` do not word their
  failures as outright violations.

### Notes

This package is a library, not an MCP server. It will be exposed through pdf-verify-mcp's
`validate_clauses`. It does not quote the specification (that is pdf-spec-mcp) and it does not
issue verdicts (that is `evaluate_policy`). The absence of failures is never proof of conformance.
