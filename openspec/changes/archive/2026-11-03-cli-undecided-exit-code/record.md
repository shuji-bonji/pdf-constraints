# record: cli-undecided-exit-code

PDF family の OpenSpec + spec-ids 導入（pdf-agent-stack `docs/specs/31`）の Phase 3、pdf-constraints の 1 件目の記録です。書式は計画 §8 です。時刻は JST です。

| 項目 | 記録 |
| --- | --- |
| 版 | OpenSpec 1.14.1 / spec-ids 0.5.0 / pdf-constraints 0.6.1 → 次の版（人が決める。CLI の振る舞いが変わるので minor の 0.7.0 を提案）/ Claude（claude.ai、モデル claude-opus-5-5）/ 2026-11-02 |
| きっかけ | 初版起こし（`spec-init/evaluate-check`）の途中で、`src/cli.ts` にテストが 1 件も無いことと、冒頭のコメントと README が約束する「2 = 評価に到達できない」に、鍵が導けない暗号化文書（全制約が `needs_external_fact`）が入っていないことに気づいた。エージェントが候補を 2 つ出し、人がこちらを選んだ |
| capability の切り方 | 振る舞いの単位（`evaluate`・`check`）。制約そのもの（CT-*）は `tables/*.json` が正本で、OpenSpec には写さない（人の判断、2026-11-02）。CLI は `check` の結果を終了コードに写す入口なので、新しい capability を作らず `check` に 005・006 を足した |
| PR の切り方 | 3 本。導入 `chore/openspec-init` → 初版起こし `spec-init/evaluate-check`（evaluate 001〜012・check 001〜004）→ 実装 PR `fix/cli-undecided-exit-code`（1 PR 運用） |
| 仕様を書いた時間 | 約 10 分（初版起こしを除く） |
| 実装した時間 | 約 10 分（受入テスト・実装・README 英日・CHANGELOG） |
| 人が判断した箇所 | (1) capability の切り方。(2) 1 件目の対象。(3) `not_applicable` を判定に数えるか（proposal の「人が判断すること」。承認をもって「数える」）。(4) 版（未決）。(5) `approved`・`pr` の記入 |
| 仕様と実装のずれ | 0 件 |
| エージェントが仕様に無い振る舞いを実装した件数 | 0 件 |
| 実装後に仕様を読み返した回数 | 0 回 |
| テスト | `npm test` 41 → 46 件。受入テスト 5 件。005 の 4 件は変更前に「`exitCodeFor` が無い」で落ちた（入口が無いだけ）。006（`dist/cli.js` をパスワード付きの検体で起動）は変更前に終了コード 0 で落ちた。CI の一覧（check:engines・check・typecheck・typecheck:tests・validate:tables・build・test）は終了コード 0 |
| 公開 API | 変更前後の `dist/index.d.ts` が同一 |
| CLI の実測 | 変更後の `dist/cli.js` で、パスワード付きの AESV3 は 2、空パスワードで鍵が導ける AESV3（document-metadata）は 0、違反のある `bad-meta-0.9.1.pdf`（document-metadata）は 1 |
| 承認と archive | 導入（`530d8e0`）と初版起こし PR #1（`approved: 2026-11-02`）でマージ。実装 PR #3 は main（`f97079b`）に rebase し、proposal.md に `approved: 2026-11-03`・`pr: 3` を書いて push。エージェントが PR #3 の head を取り込み、渡した commit からの差が承認欄 2 か所だけであることを確かめてから `openspec archive cli-undecided-exit-code --yes`（+2）。check は既存の capability なので、正本の front matter（`pr: 1`）はそのまま残った |
| 寄り道 | 初版起こしの PR #1 は、最初に導入の commit を含んだまま出したので pr-scope が止めた（verify #26 と同じ形）。導入を署名し直して `chore/openspec-init` で push し、PR #1 に merge で取り込んだ後、導入を main に入れて通した。中身が同じ導入の commit が 2 つ（`8420955` と `530d8e0`）履歴に残る |
| 維持の手間 | 仕様だけを変えた変更: 0 件 |

## 分かったこと

1. **「直す前に落ちる」が振る舞いの差を示したのは 006 だけだった。** 005 の 4 件は関数の切り出しで生まれた入口が無いことで落ちた。006 は CLI を子プロセスで起動したので、変更前の CLI が実際に 0 を返したことを示した。入口を切り出す変更では、外から起動するテストを 1 つ置くと、変更前の振る舞いを測れる。
2. **0.6.0 で直したのはライブラリの層だけで、その上の CLI は直っていなかった。** 0.6.0 は、鍵が導けない文書を「違反 0 = pass」にしないよう、全制約を `needs_external_fact` に落とした。レポートは正しくなったが、CLI はレポートの `violations` だけで終了コードを決めていたので、外から見える結果は変わらず 0 のままだった。
3. **ライブラリの capability は、テストのファイルと一致しなかった。** `tests/check.test.ts` 23 件のうち 18 件はテーブルの中身の回帰で、`check` の正本には起こしていない。テストのファイル単位で capability を決めると、テーブルの中身が正本に二重に入る。
