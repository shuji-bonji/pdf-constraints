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

## annotation — writer の AP 義務 / CR 正規化の是正前後（§12.5）

| ファイル | 作り方 | 期待 |
|---|---|---|
| `bad-annot-0.9.1.pdf` | `@shuji-bonji/pdf-writer-mcp@0.9.1` の `create_text_pdf` → `add_annotation` × 3（text は `contents` に `\n` を含める / highlight / square） | CT-ANNOT-3 が 3 件・CT-ANNOT-5 が 1 件・CT-ANNOT-9 が 1 件（violations 5） |
| `good-annot-0.16.0.pdf` | 同 v0.16.0 で同じ入力 | **CT-ANNOT-9 の 1 件のみ**（AP と CR は是正済み） |
| `synthetic-annot-good.pdf` | `scripts/gen-annotation-specimens.mjs`（pdf-lib で直接組む） | 違反なし。かつ **15 制約すべてが 1 回以上 `pass` を通る** |
| `synthetic-annot-bad.pdf` | 同スクリプト。CT-ANNOT-3 以外の 14 制約を 1 件ずつ故意に破る | 14 制約が発火（violations 17） |

**good 側で `pass` を数えているのが要点。** 制約が全部 `not_applicable` でも violations は 0 になるので、
「緑になった」だけでは規則が働いたことにならない。特に **CT-ANNOT-9 は合成検体で `pass` する**
（条文どおりの反時計回り四辺形を置いてある）ので、writer 出力での fail が
「常に落ちる規則」ではないことが確かめられる。

`bad-annot` と `good-annot` の差が **AP と CR の 2 点だけ**で、
`QuadPoints` は両版とも同じ（Z 順 = `nonSimple`）なのも意図どおり。
writer は 0.9.1 でも 0.16.0 でも同じ順序で書いており、これは意図的な逸脱である。

## 再生成

旧版は npm から取れる:

```sh
npm i @shuji-bonji/pdf-writer-mcp@0.13.1   # font-embedding の bad 側
npm i @shuji-bonji/pdf-writer-mcp@0.9.1    # document-metadata の bad-meta 側 / annotation の bad 側
npm i @shuji-bonji/pdf-writer-mcp@0.16.0   # annotation の good 側
```

合成検体（`synthetic-annot-*`）はスクリプトで再生成できる:

```sh
node scripts/gen-annotation-specimens.mjs
```

> ⚠️ **0.9.1 の `add_annotation` は引数の形が違う**（1 回に 1 注釈・`inputPath` / `page` / `type` /
> `rect` を直接取る）。現行の配列形式で呼ぶと検証エラーになるので、再生成時は旧版の
> スキーマに合わせること。

詳細な手順は `mcps/_constraint-table-poc/gen-specimens.md`。
