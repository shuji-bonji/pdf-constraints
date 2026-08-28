/**
 * COS オブジェクトの読み口（抽出器 3 本の共通部分）。
 *
 * pdf-lib の `instanceof` と `context.lookup` に相当するものを、normativepdf の
 * 判別可能合併（`kind`）と `await doc.resolve` の上に置き直したもの。
 * **ここに判定を書かない** —— 型の見分けと、参照の解決と、バイト列の復号だけを持つ。
 *
 * 🔴 `has()` は `dictGet` を使う。「値が null のエントリは、エントリが無いのと同じ」
 * （R-7.3.7-7）を適用する読み方で、pdf-lib の `dict.has()`（鍵の有無しか見ない）とは
 * ここだけ違う。条文の側を採る。
 */

import {
  type CosArray,
  type CosDict,
  type CosObject,
  type CosRef,
  type CosStream,
  decodeStream,
  decodeTextString,
  dictGet,
  type PdfDocument,
} from 'normativepdf';

/**
 * 参照の解決の結果。**「そこに無い」と「読めなかった」を分ける。**
 *
 * - `value` が `null` オブジェクト — 指し先が存在しない。R-7.3.10-13 が
 *   「未定義の間接参照は null と等価」と定めており、これは**観測できた事実**である
 * - `unreadable` — 指し先はあるが条文違反で受け取れなかった。これは**観測の失敗**で、
 *   ファイルについて何も言えない
 *
 * この 2 つを同じ `undefined` に畳むと、「フォントプログラムが埋め込まれていない」と
 * 「フォントプログラムを読めなかった」が同じ顔になる（2026-08-28 に一度そうして、
 * `CT-FONT-5` が唯一 fail していた検体を not_applicable に落とした）。
 */
export interface Lookup {
  readonly value: CosObject | undefined;
  readonly unreadable: boolean;
}

/** 参照なら解決する。読めなかったのか、そこに無いのかを区別して返す */
export async function tryLookup(doc: PdfDocument, value: CosObject | undefined): Promise<Lookup> {
  if (value === undefined) return { value: undefined, unreadable: false };
  try {
    return { value: await doc.resolve(value), unreadable: false };
  } catch {
    return { value: undefined, unreadable: true };
  }
}

/** 参照なら解決する。`undefined` はそのまま返す（鍵が無い場合と区別しない） */
export async function lookup(
  doc: PdfDocument,
  value: CosObject | undefined,
): Promise<CosObject | undefined> {
  return (await tryLookup(doc, value)).value;
}

export function asDict(value: CosObject | undefined): CosDict | null {
  return value !== undefined && value.kind === 'dict' ? value : null;
}

export function asArray(value: CosObject | undefined): CosArray | null {
  return value !== undefined && value.kind === 'array' ? value : null;
}

export function asStream(value: CosObject | undefined): CosStream | null {
  return value !== undefined && value.kind === 'stream' ? value : null;
}

export function asRef(value: CosObject | undefined): CosRef | null {
  return value !== undefined && value.kind === 'ref' ? value : null;
}

/** 名前オブジェクトの値。`#xx` の解決と UTF-8 の復号は字句解析が済ませている（R-7.3.5-13） */
export function nameOf(value: CosObject | undefined): string | null {
  return value !== undefined && value.kind === 'name' ? value.value : null;
}

/** 数値（integer / real のどちらも） */
export function numberOf(value: CosObject | undefined): number | null {
  if (value === undefined) return null;
  return value.kind === 'integer' || value.kind === 'real' ? value.value : null;
}

/** テキスト文字列（§7.9.2）。どの文字列がテキスト文字列かは辞書の鍵が決める（R-7.9.2.1-1） */
export function textOf(value: CosObject | undefined): string | null {
  return value !== undefined && value.kind === 'string' ? decodeTextString(value.bytes) : null;
}

/** 鍵があるか。**値が null のエントリは無いものとして扱う**（R-7.3.7-7） */
export function has(dict: CosDict, key: string): boolean {
  return dictGet(dict, key) !== undefined;
}

/** 参照を鍵にするときの文字列表現 */
export function refKey(ref: CosRef): string {
  return `${ref.objectNumber} ${ref.generationNumber} R`;
}

/** 数値配列。要素に数値以外が混じっていたら「読めなかった」= null にする */
export async function numbersOf(
  doc: PdfDocument,
  value: CosObject | undefined,
): Promise<number[] | null> {
  const array = asArray(await lookup(doc, value));
  if (array === null) return null;
  const out: number[] = [];
  for (const item of array.items) {
    const n = numberOf(await lookup(doc, item));
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/**
 * ストリームの復号後のバイト列。
 *
 * `decodeStream` は `/Filter` と `/DecodeParms` を同期で解決する口しか持たないので、
 * 間接参照で書かれている場合に備えて**先に解決した辞書を渡す**。
 */
export async function decodedBytes(doc: PdfDocument, stream: CosStream): Promise<Uint8Array> {
  const entries = new Map(stream.dict.entries);
  let patched = false;
  for (const key of ['Filter', 'DecodeParms']) {
    const raw = entries.get(key);
    if (raw !== undefined && raw.kind === 'ref') {
      const value = await lookup(doc, raw);
      if (value !== undefined) {
        entries.set(key, value);
        patched = true;
      }
    }
  }
  const target: CosStream = patched
    ? { kind: 'stream', dict: { kind: 'dict', entries }, raw: stream.raw }
    : stream;
  return decodeStream(target);
}
