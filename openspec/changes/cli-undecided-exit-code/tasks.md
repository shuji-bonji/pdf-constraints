# Tasks

## 1. 受入テスト（直す前に落ちることを確かめる）

- [x] 1.1 `tests/cli.test.ts` を足し、describe / it の名前に仕様 ID と Scenario 名を書く（005 の 4 つ、006 の 1 つ）
- [x] 1.2 変更前の `src/` で、005 の「全結果が needs_external_fact なら 2」と 006 が落ちることを確かめる

## 2. 実装

- [x] 2.1 `src/exit-code.ts` に `exitCodeFor` を書き、`src/cli.ts` から使う
- [x] 2.2 `src/cli.ts` の冒頭のコメントと USAGE の `Exit:` の行、README（英日）の終了コードの表を、`needs_external_fact` だけのときの 2 が分かるように直す

## 3. 確かめる

- [x] 3.1 CI の一覧（`check:engines`・`check`・`typecheck`・`typecheck:tests`・`validate:tables`・`build`・`test`）が終了コード 0
- [x] 3.2 公開 API（`dist/index.d.ts`）が変わっていないことを確かめる
- [x] 3.3 `CHANGELOG.md` に `[Unreleased]` を足す
- [x] 3.4 `npx openspec validate --all && npx spec-ids check` が通る

## 5. archive（承認の後）

- [ ] 5.1 proposal.md の `approved`・`pr` が埋まっていることを確かめる
- [ ] 5.2 `openspec archive cli-undecided-exit-code --yes`（check は既存の capability なので、front matter の書き足しは要らない）
- [ ] 5.3 `npx openspec validate --all`・`npx spec-ids check`・`npx spec-ids pr-scope` を通して commit
