/**
 * scope `annotation` の fact 抽出（ISO 32000-2 §12.5）。
 *
 * 注釈 1 個 = 1 subject。**ページ単位・文書単位の事実も subject の fact として持たせる**
 * （`annot.referencedByPageCount` / `annot.nm.duplicatedOnPage`）。
 * 述語を増やさずに書けるようにするための設計で、判断がここに寄っている分だけ
 * `factVocabulary` に判定規則を明記してある（specs/20 §7-1 案 A）。
 *
 * ここでの計算は決定論的でなければならない（I/O・時刻・乱数を持ち込まない）。
 * 観測できなかったものは `null`（= 未取得）にする。false に倒すと冤罪になる。
 */

import { decodeTextString } from 'normativepdf';
import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import type { Facts, Subject } from '../types.js';

type Context = PDFDocument['context'];

/**
 * markup 注釈の subtype（§12.5.6.2 本文の列挙）。
 * Popup / Link / Movie / Widget / RichMedia / PrinterMark / TrapNet は markup ではない。
 */
const MARKUP_SUBTYPES = new Set([
  'Text',
  'FreeText',
  'Line',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Stamp',
  'Caret',
  'Ink',
  'FileAttachment',
  'Sound',
  'Projection',
]);

/** §12.5.6.10 Table 182 の Subtype 値 */
const TEXT_MARKUP_SUBTYPES = new Set(['Highlight', 'Underline', 'Squiggly', 'StrikeOut']);

/** Table 166 AP 例外②の subtype */
const AP_EXEMPT_SUBTYPES = new Set(['Popup', 'Projection', 'Link']);

/** Table 167 が定義するビットは 1〜10。それ以外は 0 でなければならない（R-12.5.3-2） */
const DEFINED_FLAG_MASK = 0b11_1111_1111;

/** Table 134 / 135 の標準ブレンドモード（§11.3.5） */
const STANDARD_BLEND_MODES = new Set([
  'Normal',
  'Compatible',
  'Multiply',
  'Screen',
  'Overlay',
  'Darken',
  'Lighten',
  'ColorDodge',
  'ColorBurn',
  'HardLight',
  'SoftLight',
  'Difference',
  'Exclusion',
  'Hue',
  'Saturation',
  'Color',
  'Luminosity',
]);

function lookup(context: Context, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    return context.lookup(value as Parameters<Context['lookup']>[0]);
  } catch {
    return undefined;
  }
}

function nameOf(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

/** 数値配列。要素に数値以外が混じっていたら「読めなかった」= null にする */
function numbersOf(context: Context, value: unknown): number[] | null {
  const array = lookup(context, value);
  if (!(array instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const element = lookup(context, array.get(i));
    if (!(element instanceof PDFNumber)) return null;
    out.push(element.asNumber());
  }
  return out;
}

/**
 * テキスト文字列（§7.9.2）。**どの文字列がテキスト文字列かは、辞書のキーが決める**
 * （R-7.9.2.1-1）。ここに来る値はそのキーの下にあるものだけである。
 *
 * 復号は normativepdf の `decodeTextString` に任せる。pdf-lib の `decodeText()` は
 * UTF-16BE と PDFDocEncoding しか見ず、**UTF-8 の BOM（R-7.9.2.2.1-4・PDF 2.0）を
 * 扱わない**し、言語エスケープ列（§7.9.2.2.2）も取り除かない。
 * 語彙は同じ Table D.3 から起こしてあるので、その 2 つ以外では同じ値になる。
 */
function textOf(value: unknown): string | null {
  if (value instanceof PDFHexString || value instanceof PDFString) {
    return decodeTextString(Uint8Array.from(value.asBytes()));
  }
  return null;
}

function orientation(p: number[], a: number, b: number, c: number): number {
  const cross =
    (p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) -
    (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]);
  if (Math.abs(cross) < 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

function segmentsCross(p: number[], a: number, b: number, c: number, d: number): boolean {
  return (
    orientation(p, a, b, c) !== orientation(p, a, b, d) &&
    orientation(p, c, d, a) !== orientation(p, c, d, b)
  );
}

/**
 * 四辺形 1 つの向き。
 *
 * - `ccw` / `cw` — 単純多角形で、靴紐公式の符号付き面積が正 / 負
 * - `nonSimple` — 面積 0、または対辺が交差する。いわゆる Z 順（左上→右上→左下→右下）は
 *   ここに落ちる。**向きが定義できないので「反時計回りではない」までしか言えない**
 */
function quadWinding(q: number[]): 'ccw' | 'cw' | 'nonSimple' {
  let area = 0;
  for (let k = 0; k < 4; k += 1) {
    const x1 = q[2 * k];
    const y1 = q[2 * k + 1];
    const x2 = q[(2 * k + 2) % 8];
    const y2 = q[(2 * k + 3) % 8];
    area += x1 * y2 - x2 * y1;
  }
  if (Math.abs(area) < 1e-9) return 'nonSimple';
  if (segmentsCross(q, 0, 1, 2, 3) || segmentsCross(q, 1, 2, 3, 0)) return 'nonSimple';
  return area > 0 ? 'ccw' : 'cw';
}

/** 全四辺形の向きを 1 値に畳む。1 つでも nonSimple があればそれを採る */
function quadPointsWinding(values: number[]): 'ccw' | 'cw' | 'nonSimple' | 'mixed' {
  const seen = new Set<'ccw' | 'cw' | 'nonSimple'>();
  for (let i = 0; i + 8 <= values.length; i += 8) {
    seen.add(quadWinding(values.slice(i, i + 8)));
  }
  if (seen.size === 0) return 'nonSimple';
  if (seen.size === 1) return [...seen][0];
  return seen.has('nonSimple') ? 'nonSimple' : 'mixed';
}

/** `/AP` の値が「外観サブ辞書」を含むか（= `/AS` が要る形か。Table 166 AS） */
function apHasSubdictionary(context: Context, ap: PDFDict): boolean {
  // AP の各エントリ（N / R / D）は「外観ストリーム」か「状態名 → ストリームの辞書」。
  // pdf-lib ではストリームは PDFDict のインスタンスではないので、辞書ならサブ辞書と判る。
  return ap.entries().some(([, value]) => lookup(context, value) instanceof PDFDict);
}

interface PageAnnots {
  pageIndex: number;
  /** Annots に並んでいた参照（直接オブジェクトなら null） */
  refs: (PDFRef | null)[];
  dicts: PDFDict[];
}

function collectPages(doc: PDFDocument): PageAnnots[] {
  const context = doc.context;
  return doc.getPages().map((page, pageIndex) => {
    const annots = lookup(context, page.node.get(PDFName.of('Annots')));
    const refs: (PDFRef | null)[] = [];
    const dicts: PDFDict[] = [];
    if (annots instanceof PDFArray) {
      for (let i = 0; i < annots.size(); i += 1) {
        const raw = annots.get(i);
        const resolved = lookup(context, raw);
        if (!(resolved instanceof PDFDict)) continue;
        refs.push(raw instanceof PDFRef ? raw : null);
        dicts.push(resolved);
      }
    }
    return { pageIndex, refs, dicts };
  });
}

export function extractAnnotationFacts(doc: PDFDocument, given: Facts): Subject[] {
  const context = doc.context;
  const pages = collectPages(doc);

  // R-12.5.2-2: 同じ注釈辞書が複数ページの Annots から参照されていないか
  const pagesPerRef = new Map<string, number>();
  for (const page of pages) {
    for (const ref of new Set(page.refs.filter((r): r is PDFRef => r !== null))) {
      const key = ref.toString();
      pagesPerRef.set(key, (pagesPerRef.get(key) ?? 0) + 1);
    }
  }

  const subjects: Subject[] = [];

  for (const page of pages) {
    // R-12.5.6.2-9 の判定材料: このページで /Popup から指されている参照
    const popupTargets = new Set<string>();
    for (const dict of page.dicts) {
      const popup = dict.get(PDFName.of('Popup'));
      if (popup instanceof PDFRef) popupTargets.add(popup.toString());
    }
    const refKeysOnPage = new Set(
      page.refs.filter((r): r is PDFRef => r !== null).map((r) => r.toString()),
    );
    const nmCounts = new Map<string, number>();
    for (const dict of page.dicts) {
      const nm = textOf(dict.get(PDFName.of('NM')));
      if (nm !== null) nmCounts.set(nm, (nmCounts.get(nm) ?? 0) + 1);
    }

    page.dicts.forEach((dict, index) => {
      const ref = page.refs[index];
      const subtype = nameOf(dict.get(PDFName.of('Subtype')));
      const rect = numbersOf(context, dict.get(PDFName.of('Rect')));
      const contents = textOf(dict.get(PDFName.of('Contents')));
      const colour = numbersOf(context, dict.get(PDFName.of('C')));
      const quadPoints = numbersOf(context, dict.get(PDFName.of('QuadPoints')));
      const flags = lookup(context, dict.get(PDFName.of('F')));
      const ap = lookup(context, dict.get(PDFName.of('AP')));
      const irt = dict.get(PDFName.of('IRT'));
      const nm = textOf(dict.get(PDFName.of('NM')));
      const action = lookup(context, dict.get(PDFName.of('A')));
      const quadPointsWellFormed =
        quadPoints !== null && quadPoints.length > 0 && quadPoints.length % 8 === 0;

      const facts: Facts = {
        'annot.subtype': subtype,
        'annot.hasSubtype': subtype !== null,
        'annot.hasType': dict.has(PDFName.of('Type')),
        'annot.typeValue': nameOf(dict.get(PDFName.of('Type'))),

        'annot.hasRect': rect !== null && rect.length === 4,
        // Table 166 AP 例外①（2020 年に "or" から "and" へ改められた側の読み）
        'annot.rect.isDegenerate':
          rect !== null && rect.length === 4 ? rect[0] === rect[2] && rect[1] === rect[3] : null,

        'annot.hasAP': ap instanceof PDFDict,
        'annot.ap.hasSubdictionary': ap instanceof PDFDict ? apHasSubdictionary(context, ap) : null,
        'annot.hasAS': dict.has(PDFName.of('AS')),
        'annot.isApExemptSubtype': subtype !== null && AP_EXEMPT_SUBTYPES.has(subtype),

        'annot.isMarkup': subtype !== null && MARKUP_SUBTYPES.has(subtype),
        'annot.isTextMarkup': subtype !== null && TEXT_MARKUP_SUBTYPES.has(subtype),

        'annot.hasContents': contents !== null,
        // R-12.5.6.2-7: CRLF の LF は改行の一部なので、単独の LF だけを数える
        'annot.contents.hasLoneLf': contents === null ? null : /(?<!\r)\n/.test(contents),

        'annot.C.length': colour === null ? null : colour.length,
        'annot.C.allInUnitRange': colour === null ? null : colour.every((v) => v >= 0 && v <= 1),

        'annot.hasBM': dict.has(PDFName.of('BM')),
        'annot.BM.isStandard': dict.has(PDFName.of('BM'))
          ? STANDARD_BLEND_MODES.has(nameOf(dict.get(PDFName.of('BM'))) ?? '')
          : null,

        'annot.hasFlags': flags instanceof PDFNumber,
        'annot.flags.hasUndefinedBits':
          flags instanceof PDFNumber ? (flags.asNumber() & ~DEFINED_FLAG_MASK) !== 0 : null,

        'annot.hasQuadPoints': quadPoints !== null,
        'annot.quadPoints.isMultipleOf8': quadPoints === null ? null : quadPointsWellFormed,
        'annot.quadPoints.winding': quadPointsWellFormed ? quadPointsWinding(quadPoints) : null,

        'annot.popup.isReferenced': ref === null ? null : popupTargets.has(ref.toString()),

        'annot.hasRT': dict.has(PDFName.of('RT')),
        'annot.hasIRT': dict.has(PDFName.of('IRT')),
        'annot.irt.samePage': irt instanceof PDFRef ? refKeysOnPage.has(irt.toString()) : null,

        'annot.hasNM': nm !== null,
        'annot.nm.duplicatedOnPage': nm === null ? null : (nmCounts.get(nm) ?? 0) > 1,

        'annot.hasP': dict.has(PDFName.of('P')),
        'annot.isScreenWithRendition':
          subtype === 'Screen' &&
          action instanceof PDFDict &&
          nameOf(action.get(PDFName.of('S'))) === 'Rendition',

        'annot.referencedByPageCount': ref === null ? 1 : (pagesPerRef.get(ref.toString()) ?? 1),

        ...given,
      };

      subjects.push({
        label: `page ${page.pageIndex + 1} #${index} /${subtype ?? '(no Subtype)'}`,
        scope: 'annotation',
        facts,
      });
    });
  }

  return subjects;
}
