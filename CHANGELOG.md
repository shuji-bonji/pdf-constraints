# Changelog

All notable changes to this project will be documented in this file.

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
