# 検体（fixtures）

**期待値は「構築時に分かっている正解」から来ている。** どの writer の版で作ったかが答えを決めており、
検体を作り直すときも同じ手順で再現できる（ここが曖昧だとテストが何を測っているか分からなくなる）。

出自: `mcps/_constraint-table-poc/`（pdf-spec-mcp#12 の PoC）。

## font-embedding — writer B-14（W-2/W-3/W-4）の是正前後

| ファイル | 作り方 | 期待 |
|---|---|---|
| `bad-0.13.1.pdf` | `@shuji-bonji/pdf-writer-mcp@0.13.1` の `create_text_pdf`（`.otf` = Noto Sans JP） | CT-FONT-1/2/3/4 fail（violations 8） |
| `good-0.15.1.pdf` | 同 v0.15.1 で同じ入力 | 違反なし |
| `bad-ttf-0.13.1.pdf` | v0.13.1 で `.ttf`（DejaVuSans） | CT-FONT-3/4 のみ fail（violations 4） |
| `good-ttf-0.15.1.pdf` | v0.15.1 で `.ttf` | 違反なし |

`.otf` と `.ttf` で期待が違うのが要点。**本物の TrueType では W-2 は起こらない**ので、
`bad-ttf` は CT-FONT-1 が pass・CT-FONT-2 が not_applicable になる。この分岐が壊れていれば、
テーブルが「壊れた PDF なら何でも fail」になっているということ。

## document-metadata — Info と XMP の等価（§14.3）

| ファイル | 作り方 | 期待 |
|---|---|---|
| `base-xmp.pdf` | v0.15.1 `create_text_pdf` → 同版 `ensure_pdfa` | CT-META-4 fail（**W-6 の実挙動**） |
| `w6-fixed-base-xmp.pdf` | 同じ入力に **W-6 是正後**（v0.15.2）の `ensure_pdfa` | 違反なし |
| `bad-meta-0.9.1.pdf` | `base-xmp` に v0.9.1 の `set_metadata`（dc:title が停滞する版） | `good-meta` と同数（title は §14.3.4 の射程外） |
| `good-meta-0.15.1.pdf` | `base-xmp` に v0.15.1 の `set_metadata` | 同上 |
| `synthetic-good.pdf` | `base-xmp` の `xmp:CreateDate` を Info と同時点にバイト等長置換 | 全 pass の対照 |
| `synthetic-bad.pdf` | `synthetic-good` に pdf-lib で 3 つの故意違反（`/Subtype` 削除・`/ModDate` を `2026/07/25 22:15:36` に・`/Trapped` を boolean） | CT-META-1/3/6 fail |

`bad-meta` と `good-meta` が**同数**であることを確かめているのは、
「観測できる差異」を片端から違反にしていないことの確認である（R-14.3.4 の shall は日時のみで、
dc:title の同期は条文の義務ではない）。

## 再生成

旧版は npm から取れる:

```sh
npm i @shuji-bonji/pdf-writer-mcp@0.13.1   # font-embedding の bad 側
npm i @shuji-bonji/pdf-writer-mcp@0.9.1    # document-metadata の bad-meta 側
```

詳細な手順は `mcps/_constraint-table-poc/gen-specimens.md`。
