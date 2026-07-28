# @shuji-bonji/pdf-constraints

[![CI](https://github.com/shuji-bonji/pdf-constraints/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/pdf-constraints/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/pdf-constraints.svg)](https://www.npmjs.com/package/@shuji-bonji/pdf-constraints)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[日本語](./README.ja.md)

Constraint tables that map ISO 32000 clauses to **what a file has to look like structurally**, together with a deterministic evaluator.

This is a shared library for the PDF family, not an MCP server. It is exposed over MCP through [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp)'s `validate_clauses`.

## What it is for

Lining up the question each family member answers puts this package in place:

| Who | Question it answers |
|---|---|
| [pdf-spec-mcp](https://github.com/shuji-bonji/pdf-spec-mcp) | What does the clause **require**? |
| [pdf-reader-mcp](https://github.com/shuji-bonji/pdf-reader-mcp) | What **is** in the file? |
| **pdf-constraints** | **What state does satisfying the clause mean?** |
| [pdf-verify-mcp](https://github.com/shuji-bonji/pdf-verify-mcp) | **What has been broken?** |
| [pdf-writer-mcp](https://github.com/shuji-bonji/pdf-writer-mcp) | How do you **write** it? |

veraPDF decides PDF/A and PDF/UA, but it does not look at the **body of ISO 32000**. That gap is why a `shall` violation — embedding a CFF font program under `/FontFile2` — survived as nothing more than a viewer warning that had been filed under "harmless".

> [!IMPORTANT]
> **No failures is not proof of conformance.** It means nothing in the constraints that shipped could be disproved. Conformance cannot be proven, only disproven.

## Usage

```sh
npx @shuji-bonji/pdf-constraints check document.pdf
npx @shuji-bonji/pdf-constraints check document.pdf --domain font-embedding --given isSubset=true
```

Three exit codes, because **"could not decide" must not be confused with pass or fail**:

| Code | Meaning |
|---|---|
| 0 | No violation found in the constraints checked (not proof of conformance) |
| 1 | Violations found |
| 2 | Could not decide (file unreadable, bad arguments, and so on) |

As a library:

```ts
import { checkFile, loadTable, evaluateConstraint } from '@shuji-bonji/pdf-constraints';

const report = await checkFile('/abs/path/document.pdf', { given: { isSubset: true } });
report.violations;      // number of failures
report.packageVersion;  // which version decided this — the provenance of the determinism
```

The constraint tables are plain JSON and can be read directly:

```ts
import table from '@shuji-bonji/pdf-constraints/tables/font-embedding.json' with { type: 'json' };
```

## Bundled tables

| Domain | Clauses | Constraints |
|---|---|---|
| `font-embedding` | §9.9.1 / §9.9.2 / §9.7.4.2 (including Tables 124 and 125) | CT-FONT-1〜5 — the embedding key matching the program inside it, subset name tags, `Length1` |
| `document-metadata` | §14.3.2 / §14.3.3 / §14.3.4 / §7.9.4 | CT-META-1〜6 — metadata stream type, date syntax, Info↔XMP equivalence, `Trapped` |
| `annotation` | §12.5.2 / §12.5.3 / §12.5.5 / §12.5.6.2 / §12.5.6.10 (including Tables 166, 167, 172 and 182) | CT-ANNOT-1〜15 — the appearance dictionary a writer owes (`AP`), paragraph breaks in `Contents`, colour and flag syntax, `QuadPoints` winding, `Popup` / `IRT` relationships, one-page-only references |

## Four states

Every constraint resolves to one of these. **No verdict is issued** — that is the job of
pdf-verify-mcp's `evaluate_policy`.

| State | Meaning |
|---|---|
| `pass` | Nothing in this constraint could be disproved |
| `fail` | Disproved (the fact and its measured value come back as evidence) |
| `not_applicable` | The clause does not apply to this document |
| `needs_external_fact` | A fact outside the file was not supplied, so the constraint **was not decided** |

### `given.*` — facts that live outside the file

Some clauses rest on a premise the file cannot settle. R-9.9.2-2 says the name of **a subset font**
shall begin with a six-letter tag — but whether a font is a subset is not written anywhere in the
PDF. Only whoever made it knows.

Supply such facts with `--given isSubset=true`. Without them the constraint degrades to
`needs_external_fact`, rather than being **defaulted into a silent pass or a false accusation**.

### "Violation" versus "trace of a violation"

When a clause addresses the PDF processor — the act of writing — all a file can show is that
**someone** broke it, not that the last writer did (§14.3.4 explicitly permits leaving an existing
inconsistency alone). Those constraints carry a `subjectNote`, and the report words their failures
as traces.

## What it does not do

- **Quote the specification** — that is pdf-spec-mcp. Tables reference clause IDs and never copy the text
- **Prove conformance** — only disprove it
- **Issue verdicts** — that is `evaluate_policy`
- **Replace veraPDF** — PDF/A verdicts are veraPDF's; only ISO 32000-1/-2 body clauses ship here
- **Judge whether the content is true** — a file that satisfies every clause can still lie

## Development

```sh
npm install
npm run build
npm test
npm run validate:tables   # validate the constraint tables against tables/schema.json
```

To add a table, drop a `tables/*.json` in and make `validate:tables` pass. To add a predicate (op),
update `tables/schema.json` and `src/evaluate.ts` **together** — tables and evaluation semantics
shipping in the same version is what makes the determinism worth anything.

## License

MIT © shuji-bonji
