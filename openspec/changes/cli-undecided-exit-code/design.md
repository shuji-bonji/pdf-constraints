# Design

## 終了コードを決める関数

`src/cli.ts` の `main` の最後の `return report.violations > 0 ? 1 : 0` を、`src/exit-code.ts` の `exitCodeFor(report: CheckReport): 0 | 1 | 2` に切り出す。`src/cli.ts` は import すると `main` を走らせるので、テストからは `exitCodeFor` を直接呼ぶ。`exitCodeFor` は `src/index.ts` から export しない（公開 API を変えない）。

```ts
export function exitCodeFor(report: CheckReport): 0 | 1 | 2 {
  if (report.violations > 0) return 1;
  const decided = report.results.some((r) => r.status !== 'needs_external_fact');
  const undecided = report.results.some((r) => r.status === 'needs_external_fact');
  return !decided && undecided ? 2 : 0;
}
```

違反の判定を先に置く。`needs_external_fact` が混ざっていても、違反が見つかったことは確かなので 1 を返す。

## CLI を通しで確かめる

006 は `dist/cli.js` を子プロセスで起動して確かめる。CI は `npm run build` の後に `npm test` を回すので、`dist/` はある。手元で `dist/` が無いときは、`dist/cli.js` が無いことを名前を挙げて失敗させる（黙って飛ばさない）。

## ライブラリの制約と仕様の制約

- 仕様: ISO 32000-2 は CLI の終了コードを定めない。これはこのパッケージの約束で、根拠は README の「判定できなかったことを合格や違反と混ぜない」と、SPEC-CONSTRAINTS-CHECK-003。
- ライブラリ: `@normativepdf/recover` の `openDocument` が、鍵が導けない文書で `scope.encrypted: true`・`authenticated: false` を返すことに頼る（今と同じ）。

## 公開 API

変わらない。`exitCodeFor` は内部の関数。版は CLI の振る舞いが変わるので minor（0.7.0）を提案する。
