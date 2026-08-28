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

import { type CosDict, type CosRef, dictGet, type PdfDocument, readPageTree } from 'normativepdf';
import type { Facts, Subject } from '../types.js';
import { asArray, asDict, asRef, has, lookup, nameOf, numbersOf, refKey, textOf } from './cos.js';

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
async function apHasSubdictionary(doc: PdfDocument, ap: CosDict): Promise<boolean> {
  // AP の各エントリ（N / R / D）は「外観ストリーム」か「状態名 → ストリームの辞書」。
  // ストリームは kind: 'stream' なので、kind: 'dict' ならサブ辞書と判る。
  for (const [, value] of ap.entries) {
    if (asDict(await lookup(doc, value)) !== null) return true;
  }
  return false;
}

interface PageAnnots {
  pageIndex: number;
  /** Annots に並んでいた参照（直接オブジェクトなら null） */
  refs: (CosRef | null)[];
  dicts: CosDict[];
}

async function collectPages(doc: PdfDocument): Promise<PageAnnots[]> {
  const tree = await readPageTree({
    resolve: (value) => doc.resolve(value),
    getCatalog: () => doc.getCatalog(),
  });
  const out: PageAnnots[] = [];
  for (const page of tree.pages) {
    const annots = asArray(await lookup(doc, dictGet(page.dict, 'Annots')));
    const refs: (CosRef | null)[] = [];
    const dicts: CosDict[] = [];
    if (annots !== null) {
      for (const raw of annots.items) {
        const resolved = asDict(await lookup(doc, raw));
        if (resolved === null) continue;
        refs.push(asRef(raw));
        dicts.push(resolved);
      }
    }
    out.push({ pageIndex: page.index, refs, dicts });
  }
  return out;
}

export async function extractAnnotationFacts(doc: PdfDocument, given: Facts): Promise<Subject[]> {
  const pages = await collectPages(doc);

  // R-12.5.2-2: 同じ注釈辞書が複数ページの Annots から参照されていないか
  const pagesPerRef = new Map<string, number>();
  for (const page of pages) {
    for (const key of new Set(
      page.refs.filter((r): r is CosRef => r !== null).map((r) => refKey(r)),
    )) {
      pagesPerRef.set(key, (pagesPerRef.get(key) ?? 0) + 1);
    }
  }

  const subjects: Subject[] = [];

  for (const page of pages) {
    // R-12.5.6.2-9 の判定材料: このページで /Popup から指されている参照
    const popupTargets = new Set<string>();
    for (const dict of page.dicts) {
      const popup = asRef(dictGet(dict, 'Popup'));
      if (popup !== null) popupTargets.add(refKey(popup));
    }
    const refKeysOnPage = new Set(
      page.refs.filter((r): r is CosRef => r !== null).map((r) => refKey(r)),
    );
    const nmCounts = new Map<string, number>();
    for (const dict of page.dicts) {
      const nm = textOf(dictGet(dict, 'NM'));
      if (nm !== null) nmCounts.set(nm, (nmCounts.get(nm) ?? 0) + 1);
    }

    for (const [index, dict] of page.dicts.entries()) {
      const ref = page.refs[index];
      const subtype = nameOf(dictGet(dict, 'Subtype'));
      const rect = await numbersOf(doc, dictGet(dict, 'Rect'));
      const contents = textOf(dictGet(dict, 'Contents'));
      const colour = await numbersOf(doc, dictGet(dict, 'C'));
      const quadPoints = await numbersOf(doc, dictGet(dict, 'QuadPoints'));
      const flags = await lookup(doc, dictGet(dict, 'F'));
      const ap = asDict(await lookup(doc, dictGet(dict, 'AP')));
      const irt = asRef(dictGet(dict, 'IRT'));
      const nm = textOf(dictGet(dict, 'NM'));
      const action = asDict(await lookup(doc, dictGet(dict, 'A')));
      const flagsValue =
        flags !== undefined && (flags.kind === 'integer' || flags.kind === 'real')
          ? flags.value
          : null;
      const quadPointsWellFormed =
        quadPoints !== null && quadPoints.length > 0 && quadPoints.length % 8 === 0;

      const facts: Facts = {
        'annot.subtype': subtype,
        'annot.hasSubtype': subtype !== null,
        'annot.hasType': has(dict, 'Type'),
        'annot.typeValue': nameOf(dictGet(dict, 'Type')),

        'annot.hasRect': rect !== null && rect.length === 4,
        // Table 166 AP 例外①（2020 年に "or" から "and" へ改められた側の読み）
        'annot.rect.isDegenerate':
          rect !== null && rect.length === 4 ? rect[0] === rect[2] && rect[1] === rect[3] : null,

        'annot.hasAP': ap !== null,
        'annot.ap.hasSubdictionary': ap !== null ? await apHasSubdictionary(doc, ap) : null,
        'annot.hasAS': has(dict, 'AS'),
        'annot.isApExemptSubtype': subtype !== null && AP_EXEMPT_SUBTYPES.has(subtype),

        'annot.isMarkup': subtype !== null && MARKUP_SUBTYPES.has(subtype),
        'annot.isTextMarkup': subtype !== null && TEXT_MARKUP_SUBTYPES.has(subtype),

        'annot.hasContents': contents !== null,
        // R-12.5.6.2-7: CRLF の LF は改行の一部なので、単独の LF だけを数える
        'annot.contents.hasLoneLf': contents === null ? null : /(?<!\r)\n/.test(contents),

        'annot.C.length': colour === null ? null : colour.length,
        'annot.C.allInUnitRange': colour === null ? null : colour.every((v) => v >= 0 && v <= 1),

        'annot.hasBM': has(dict, 'BM'),
        'annot.BM.isStandard': has(dict, 'BM')
          ? STANDARD_BLEND_MODES.has(nameOf(dictGet(dict, 'BM')) ?? '')
          : null,

        'annot.hasFlags': flagsValue !== null,
        'annot.flags.hasUndefinedBits':
          flagsValue !== null ? (flagsValue & ~DEFINED_FLAG_MASK) !== 0 : null,

        'annot.hasQuadPoints': quadPoints !== null,
        'annot.quadPoints.isMultipleOf8': quadPoints === null ? null : quadPointsWellFormed,
        'annot.quadPoints.winding': quadPointsWellFormed ? quadPointsWinding(quadPoints) : null,

        'annot.popup.isReferenced': ref === null ? null : popupTargets.has(refKey(ref)),

        'annot.hasRT': has(dict, 'RT'),
        'annot.hasIRT': has(dict, 'IRT'),
        'annot.irt.samePage': irt !== null ? refKeysOnPage.has(refKey(irt)) : null,

        'annot.hasNM': nm !== null,
        'annot.nm.duplicatedOnPage': nm === null ? null : (nmCounts.get(nm) ?? 0) > 1,

        'annot.hasP': has(dict, 'P'),
        'annot.isScreenWithRendition':
          subtype === 'Screen' && action !== null && nameOf(dictGet(action, 'S')) === 'Rendition',

        'annot.referencedByPageCount': ref === null ? 1 : (pagesPerRef.get(refKey(ref)) ?? 1),

        ...given,
      };

      subjects.push({
        label: `page ${page.pageIndex + 1} #${index} /${subtype ?? '(no Subtype)'}`,
        scope: 'annotation',
        facts,
      });
    }
  }

  return subjects;
}
