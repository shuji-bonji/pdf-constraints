# Changelog

All notable changes to this project will be documented in this file.

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
