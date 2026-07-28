/**
 * 制約テーブルの型。
 *
 * ここに現れるのは「条文を満たすとはファイルがどういう状態か」の宣言だけである。
 * 条文原文は持たない（pdf-spec の役割）。verdict も出さない（evaluate_policy の役割）。
 * 詳細は `Document-Note/mcps/PDFfamily/specs/18-pdf-constraints-package.md` §1。
 */

/** 述語の演算子。v1 の凍結セット — 追加は minor バンプ（tables/schema.json と対で更新する） */
export type PredicateOp =
  | 'eq'
  | 'in'
  | 'exists'
  | 'matches'
  | 'superset'
  | 'eqFact'
  | 'allDistinct'
  | 'dateEquiv';

/** 評価スコープ。fact 抽出器はこの単位で登録される */
export type Scope = 'embedded-font' | 'document' | 'annotation';

export interface Predicate {
  fact: string;
  op: PredicateOp;
  value?: unknown;
}

export interface Assertion extends Predicate {
  /**
   * 違反時の説明。`subjectNote` を持つ制約では**「違反」ではなく「違反の痕跡」**と述べる
   * （ファイルから観測できるのは行為の結果であって、誰がいつ破ったかではない）。
   */
  onFail: string;
  note?: string;
  /** この assert だけに掛かる追加条件。満たさなければ検査自体を飛ばす */
  onlyWhen?: Predicate[];
}

export interface Constraint {
  /** `CT-<DOMAIN>-<n>`。一度公開した ID の意味は変えない */
  id: string;
  title: string;
  /** 根拠条文の ID（例: R-9.9.1-33）。原文は複製せず pdf-spec で引く */
  clauses: string[];
  source: { spec: string; section: string; table?: string; key?: string };
  level: string;
  appliesTo: Scope;
  /**
   * 条文の主語が PDF processor（書き込み行為）であることの記録。
   * これを持つ制約の fail は「どこかの writer が破った痕跡」であり、
   * 直近の書き手の違反とは限らない（R-14.3.4-3 は既存の不整合の温存を許す）。
   */
  subjectNote?: string;
  /** 語彙で写像できなかった条文と、その理由。沈黙して存在しないふりをしない */
  notMapped?: string;
  when: Predicate[];
  assert: Assertion[];
  /** 文書横断の検査（同一フォントの別サブセットが同じタグを共有していないか等） */
  documentAssert?: Assertion[];
}

export interface ConstraintTable {
  name: string;
  version: string;
  description: string;
  issue?: string;
  /** 写像の出所。pdf-spec の版が上がったときに再照合するための情報 */
  sourceSpec: {
    spec: string;
    retrievedWith?: string;
    sections: string[];
    specVersionAtMapping?: string;
  };
  factVocabulary: Record<string, string>;
  newPredicates?: string[];
  scopeFindings?: string[];
  constraints: Constraint[];
}

/** fact 名 → 実測値。`given.*` は外部から供給される事実（ファイル単体では決定不能） */
export type Facts = Record<string, unknown>;

/** 評価対象 1 件（フォント 1 つ、または文書そのもの） */
export interface Subject {
  /** レポートに出す識別子（BaseFont 名や "(document)"） */
  label: string;
  scope: Scope;
  facts: Facts;
}

export interface Failure {
  clauses: string[];
  message: string;
  fact: string;
  actual: unknown;
  /** 主語が processor の条文か（レポート側で言い回しを変えるため機械可読にしておく） */
  traceOnly: boolean;
  /**
   * 違反した assertion の `note`。**判定は変えない**が、読み手が結果を誤読しないために要る文脈。
   *
   * 例: CT-ANNOT-9（QuadPoints の反時計回り）は条文どおりに書くと主要ビューアで表示が壊れるため、
   * 業界がほぼ一様に逸脱している。これが無いと「ほぼ全ての PDF に欠陥がある」と読まれる。
   */
  note?: string;
}

/**
 * 制約 1 件の評価結果。
 *
 * - `pass` — 収録した検査では反証できなかった。**適合の証明ではない**
 * - `fail` — 反証できた
 * - `not_applicable` — 適用条件を満たさない（この文書には関係ない条文）
 * - `needs_external_fact` — `given.*` が供給されておらず判定に到達できない。
 *   pass にも fail にも倒さない（沈黙合格を作らないための状態）
 */
export type ConstraintStatus = 'pass' | 'fail' | 'not_applicable' | 'needs_external_fact';

export interface ConstraintResult {
  constraint: string;
  target: string;
  status: ConstraintStatus;
  failures?: Failure[];
  /** needs_external_fact のとき、足りない fact 名 */
  missing?: string;
}

export interface CheckReport {
  /** 判定に使ったテーブルの出所（決定論の由来を言えるようにする） */
  packageVersion: string;
  tables: { name: string; version: string }[];
  subjects: number;
  results: ConstraintResult[];
  violations: number;
}
