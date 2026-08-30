#!/usr/bin/env node
/**
 * CheckReport のゴールデンを採り、2 つを突き合わせる（B1 = pdf-lib 撤去の L0）。
 *
 * **なぜ撤去前にしか採れないか**: 撤去後に採り直すと、同じパーサ同士の比較になる。
 * pdf-lib で採ったこのゴールデン自体が「第 2 の独立した読み手」を兼ねる
 * （docs/handoff/pdflib-removal.md §6 面 3）。**撤去後に作り直さないこと。**
 *
 * 何を凍結するか — CheckReport の中身をそのまま持つ。要約しない:
 *   ファイルごとに subjects / violations と、制約 1 行ずつの
 *   [constraint, target, status, failuresSha, missing]。失敗は clauses / fact /
 *   actual / traceOnly / message / note まで含めて sha を取る。
 *   読めなかったファイルは落とさずに error として記録する（暗号化 PDF がこれに当たり、
 *   撤去後に読めるようになったら「読めなかった -> 読めた」の差として出る）。
 *
 * 版（packageVersion / テーブル版）は行ではなくヘッダで比べる。0.3.0 -> 0.4.0 で
 * 全ファイルが差になると、判定の差が埋もれるため。
 *
 * 使い方:
 *   node scripts/golden.mjs take <out.json> [--set <dir>]... [--label NAME]
 *                                [--given <given.json>] [--limit N]
 *   node scripts/golden.mjs diff <before.json> <after.json> [--detail <file-key>]
 *   node scripts/golden.mjs t3   [golden.json]      # 計器自身の T-3。採る前に通す
 *
 * 終了コード: 0 = 差なし / 1 = 差あり / 2 = 使い方の誤り・自己検査に失敗
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const sha = (s) => createHash('sha256').update(s ?? '').digest('hex').slice(0, 16);

/** キー順に依存しない JSON 文字列（比較の同一性をキー順で崩さない）。 */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

function listPdfs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * バイト列から読める軸。判定には使わない —— 「1 形しか無い軸」を毎回申告するためだけに要る。
 * CheckReport から取らないのは、読めなかったファイルでも軸を言えるようにするため。
 */
function probe(bytes) {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('latin1');
  const all = Buffer.from(bytes).toString('latin1');
  return {
    headerOffset: head.indexOf('%PDF-'),
    hasEncrypt: /\/Encrypt[\s/<[]/.test(all),
    startxrefCount: (all.match(/startxref/g) ?? []).length,
    hasXrefStream: /\/Type\s*\/XRef/.test(all),
    hasLinearized: /\/Linearized/.test(all),
    bytes: bytes.length,
  };
}

/* ---------------- 採取 ---------------- */

async function take({ sets, label, givenPath, limit }) {
  const distEntry = join(ROOT, 'dist', 'index.js');
  if (!existsSync(distEntry)) {
    console.error(`dist が無い: ${distEntry}\n  先に npm run build を回すこと`);
    process.exit(2);
  }
  const api = await import(distEntry);
  const given = givenPath ? JSON.parse(readFileSync(givenPath, 'utf8')) : undefined;
  const tables = api.listTables().map((n) => api.loadTable(n));

  const files = [];
  for (const dir of sets) {
    const abs = resolve(dir);
    if (!existsSync(abs)) {
      console.error(`検体の置き場が無い: ${abs}`);
      process.exit(2);
    }
    const setName = basename(abs);
    for (const p of listPdfs(abs)) files.push({ key: `${setName}/${relative(abs, p)}`, path: p });
  }
  files.sort((a, b) => a.key.localeCompare(b.key));
  const picked = limit ? files.slice(0, limit) : files;

  const specimens = {};
  let errored = 0;
  let packageVersion = null;
  for (const f of picked) {
    const bytes = new Uint8Array(readFileSync(f.path));
    const entry = { probe: probe(bytes) };
    try {
      const report = await api.checkFile(f.path, given ? { given } : {});
      packageVersion ??= report.packageVersion;
      entry.subjects = report.subjects;
      entry.violations = report.violations;
      // 🔴 **判定だけ凍結すると、読めた範囲が動いても差 0 件になる。**
      //
      // 出自: 2026-08-30、`@normativepdf/recover` 0.1.1 -> 0.1.2。veraPDF の
      // `6-1-2-t01-fail-a.pdf` が「組み直した 17 件」から「ファイルの表の 18 件」に
      // 変わったのに、この A/B は差 0 件を出した。`observation` を記録していなかった
      // からである。`observation` は `CheckReport` の公開項目で、0.5.0 で `scope` を
      // 足したところでもある —— そこが動いたことを言えない計器は、その版の主張を
      // 支えられない（[[instrument-must-pass-t3]] / [[observation-is-not-a-verdict]]）。
      //
      // `scope.refusal` は normativepdf のメッセージそのままで版が上がると言い回しが
      // 変わるので、真偽だけを取る。
      entry.observation = {
        xrefChain: report.observation.xrefChain,
        objects: report.observation.objects,
        pagesReached: report.observation.pagesReached,
        pages: report.observation.pages,
        recovered: report.observation.scope?.recovered ?? null,
        reconstructed: report.observation.scope?.reconstructed ?? null,
        newestSectionUnreadable: report.observation.scope?.newestSectionUnreadable ?? null,
        sections: report.observation.scope?.sections ?? null,
        chainStop: report.observation.scope?.chainStop?.kind ?? null,
        continuedPastStop: report.observation.scope?.continuedPastStop ?? null,
        filledFromScan: report.observation.scope?.filledFromScan ?? null,
        encrypted: report.observation.scope?.encrypted ?? null,
        authenticated: report.observation.scope?.authenticated ?? null,
        refused: (report.observation.scope?.refusal ?? null) !== null,
      };
      entry.rows = report.results
        .map((r) => [
          r.constraint,
          r.target,
          r.status,
          r.failures?.length
            ? sha(
                stable(
                  r.failures.map((x) => ({
                    clauses: x.clauses,
                    fact: x.fact,
                    actual: x.actual,
                    traceOnly: x.traceOnly,
                    message: x.message,
                    note: x.note ?? null,
                  })),
                ),
              )
            : null,
          r.missing ?? null,
        ])
        .sort((a, b) => stable(a).localeCompare(stable(b)));
      entry.rowsSha = sha(stable(entry.rows));
      entry.statusCounts = entry.rows.reduce((acc, r) => {
        acc[r[2]] = (acc[r[2]] ?? 0) + 1;
        return acc;
      }, {});
      // 帰属のために生の失敗を持つ（fail は少ない。pass は行だけで足りる）
      entry.failures = report.results
        .filter((r) => r.status === 'fail')
        .map((r) => ({ constraint: r.constraint, target: r.target, failures: r.failures }));
    } catch (e) {
      errored += 1;
      entry.error = { name: e?.name ?? 'Error', message: String(e?.message ?? e).slice(0, 300) };
    }
    specimens[f.key] = entry;
  }

  return {
    schema: 'pdf-constraints-golden/1',
    label,
    takenAt: new Date().toISOString(),
    packageVersion,
    tables: tables.map((t) => ({ name: t.name, version: t.version })),
    constraintIds: tables.flatMap((t) => t.constraints.map((c) => c.id)).sort(),
    given: given ?? null,
    givenSha: sha(stable(given ?? null)),
    sets: sets.map((d) => resolve(d)),
    specimenCount: picked.length,
    erroredCount: errored,
    specimens,
  };
}

/** 1 形しか無い軸を申告する。1 形の軸は差を運べない。 */
function coverage(golden) {
  const lines = [];
  const s = Object.values(golden.specimens);
  const axis = (name, values) => {
    const shapes = new Set(values.map((v) => JSON.stringify(v)));
    lines.push(
      `  ${shapes.size === 1 ? '⚠ 1 形' : `${shapes.size} 形 `} ${name}` +
        (shapes.size <= 4 ? ` = ${[...shapes].join(' / ')}` : ''),
    );
  };
  axis('読めた / 読めなかった', s.map((x) => (x.error ? 'error' : 'ok')));
  axis('origin > 0', s.map((x) => x.probe.headerOffset > 0));
  axis('/Encrypt を持つ', s.map((x) => x.probe.hasEncrypt));
  axis('増分更新あり（startxref 2 以上）', s.map((x) => x.probe.startxrefCount >= 2));
  axis('xref ストリーム', s.map((x) => x.probe.hasXrefStream));
  axis('線形化', s.map((x) => x.probe.hasLinearized));

  const seen = new Set();
  const failed = new Set();
  const statuses = new Set();
  for (const x of s) {
    for (const [id, , status] of x.rows ?? []) {
      seen.add(id);
      statuses.add(status);
      if (status === 'fail') failed.add(id);
    }
  }
  lines.push(`  状態 ${[...statuses].sort().join(' / ') || '（無し）'}`);
  const never = golden.constraintIds.filter((id) => !seen.has(id));
  const neverFailed = golden.constraintIds.filter((id) => seen.has(id) && !failed.has(id));
  lines.push(
    `  制約 ${golden.constraintIds.length} 件のうち、一度も現れない ${never.length} 件` +
      (never.length && never.length <= 12 ? `: ${never.join(', ')}` : ''),
  );
  lines.push(
    `  一度も fail しない ${neverFailed.length} 件` +
      (neverFailed.length && neverFailed.length <= 12 ? `: ${neverFailed.join(', ')}` : ''),
  );
  return lines;
}

/* ---------------- 突き合わせ ---------------- */

/** 行を key -> [status, failuresSha, missing] に落とす。同じ key が重なるときは番号を振る。 */
function rowMap(rows) {
  const m = new Map();
  const seen = new Map();
  for (const [c, target, status, failSha, missing] of rows ?? []) {
    const base = `${c}\t${target}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    m.set(n === 1 ? base : `${base}#${n}`, [status, failSha, missing]);
  }
  return m;
}

/** 帰属を書けば受け入れる緩み方（handoff §6 面 2）。 */
const ALLOWED_SOFTENING = new Set(['pass->not_applicable', 'pass->needs_external_fact']);

function diff(before, after) {
  const lines = [];
  const transitions = new Map();
  let regressions = 0; // 受入を満たさない差
  let attributable = 0; // 帰属を書けば通る差
  const bump = (k) => transitions.set(k, (transitions.get(k) ?? 0) + 1);

  lines.push('# 版（ここでだけ比べる。行の差に混ぜない）');
  lines.push(`  packageVersion ${before.packageVersion} -> ${after.packageVersion}`);
  for (const t of before.tables) {
    const a = after.tables.find((x) => x.name === t.name);
    lines.push(`  table ${t.name} ${t.version} -> ${a ? a.version : '（無い）'}`);
  }
  if (before.givenSha !== after.givenSha) {
    lines.push(`  🔴 given が違う（${before.givenSha} -> ${after.givenSha}）。比較は成立しない`);
    return { lines, regressions: 1, attributable: 0, transitions };
  }
  // 検体の集合そのものを申告する。同じ set / 同じ件数でなければ、差が 0 でも意味が違う
  lines.push('# 検体の集合');
  lines.push(`  before: ${before.specimenCount} 件  ${(before.sets ?? []).join(' , ')}`);
  lines.push(`  after : ${after.specimenCount} 件  ${(after.sets ?? []).join(' , ')}`);
  if (stable(before.sets ?? []) !== stable(after.sets ?? [])) {
    lines.push('  🔴 --set が違う。同じ検体で採り直すこと');
    regressions += 1;
  }

  const bKeys = Object.keys(before.specimens);
  const aKeys = new Set(Object.keys(after.specimens));
  const gone = bKeys.filter((k) => !aKeys.has(k));
  const added = [...aKeys].filter((k) => !before.specimens[k]);
  if (gone.length) {
    regressions += gone.length;
    lines.push(`# 検体が消えた ${gone.length} 件（ゴールデンと同じ検体で採っていない）`);
    for (const k of gone.slice(0, 20)) lines.push(`  🔴   ${k}`);
  }
  if (added.length) {
    lines.push(`# 検体が増えた ${added.length} 件（比較の対象外）`);
    for (const k of added.slice(0, 20)) lines.push(`  --   ${k}`);
  }

  const fileLines = [];
  for (const key of bKeys.filter((k) => aKeys.has(k))) {
    const b = before.specimens[key];
    const a = after.specimens[key];
    const say = (kind, text) => fileLines.push(`  ${kind} ${key}: ${text}`);

    if (b.error && !a.error) {
      bump('読めなかった->読めた');
      attributable += 1;
      say('DIFF', `読めなかった -> 読めた（旧: ${b.error.message}）。是正か後退かを帰属させる`);
      continue;
    }
    if (!b.error && a.error) {
      bump('読めた->読めない');
      regressions += 1;
      say('🔴  ', `読めた -> 読めなくなった（${a.error.message}）`);
      continue;
    }
    if (b.error && a.error) {
      if (b.error.message !== a.error.message) {
        bump('読めない理由の文言');
        say('--  ', `どちらも読めない。文言のみ差: ${b.error.message} -> ${a.error.message}`);
      }
      continue;
    }

    // 読めた範囲は判定より前に比べる。**判定が同じでも、見た範囲が違えば別の話である。**
    // 片方が `observation` を持たないのは、その版のゴールデンがこの項目より前に
    // 採られたということ。差ではないので黙る（版が違うと言えるのは header だけ）。
    let observationMoved = false;
    if (b.observation && a.observation) {
      for (const field of Object.keys(a.observation)) {
        if (JSON.stringify(b.observation[field]) === JSON.stringify(a.observation[field])) continue;
        observationMoved = true;
        bump(`observation.${field}`);
        attributable += 1;
        say(
          'DIFF',
          `observation.${field}: ${JSON.stringify(b.observation[field])} -> ${JSON.stringify(a.observation[field])}`,
        );
      }
    }

    if (
      !observationMoved &&
      b.rowsSha === a.rowsSha &&
      b.subjects === a.subjects &&
      b.violations === a.violations
    ) {
      continue;
    }
    if (b.subjects !== a.subjects) {
      bump('subjects');
      attributable += 1;
      say('DIFF', `subjects ${b.subjects} -> ${a.subjects}`);
    }
    if (b.violations !== a.violations) {
      bump('violations');
      attributable += 1;
      say('DIFF', `violations ${b.violations} -> ${a.violations}`);
    }
    const bm = rowMap(b.rows);
    const am = rowMap(a.rows);
    for (const [k, bv] of bm) {
      const av = am.get(k);
      const [c, target] = k.split('\t');
      if (!av) {
        bump('行が消えた');
        regressions += 1;
        say('🔴  ', `${c} / ${target}: 行が消えた（${bv[0]}）`);
        continue;
      }
      if (bv[0] !== av[0]) {
        const t = `${bv[0]}->${av[0]}`;
        bump(t);
        if (bv[0] === 'pass' && av[0] === 'fail') {
          regressions += 1;
          say('🔴  ', `${c} / ${target}: pass -> fail（受入は 0 件）`);
        } else if (ALLOWED_SOFTENING.has(t)) {
          attributable += 1;
          say('DIFF', `${c} / ${target}: ${t}（帰属を書けば許容）`);
        } else {
          attributable += 1;
          say('DIFF', `${c} / ${target}: ${t}（帰属が要る）`);
        }
        continue;
      }
      if (bv[1] !== av[1]) {
        bump('failures の中身');
        attributable += 1;
        say('DIFF', `${c} / ${target}: status は ${bv[0]} のまま、failures の中身が変わった`);
      }
      if (bv[2] !== av[2]) {
        bump('missing');
        attributable += 1;
        say('DIFF', `${c} / ${target}: missing ${bv[2]} -> ${av[2]}`);
      }
    }
    for (const k of am.keys()) {
      if (!bm.has(k)) {
        const [c, target] = k.split('\t');
        bump('行が増えた');
        attributable += 1;
        say('DIFF', `${c} / ${target}: 行が増えた（${am.get(k)[0]}）`);
      }
    }
  }

  if (fileLines.length) {
    lines.push('# 検体ごとの差');
    lines.push(...fileLines);
  }
  return { lines, regressions, attributable, transitions };
}

function detail(before, after, key) {
  const b = before.specimens[key];
  const a = after.specimens[key];
  if (!b || !a) return `そのキーの検体が無い: ${key}`;
  const pick = (x) => ({
    observation: x.observation,
    subjects: x.subjects,
    violations: x.violations,
    statusCounts: x.statusCounts,
    error: x.error,
    failures: x.failures,
  });
  return [
    `--- before: ${key}`,
    JSON.stringify(pick(b), null, 2),
    `--- after: ${key}`,
    JSON.stringify(pick(a), null, 2),
  ].join('\n');
}

/* ---------------- 計器自身の T-3 ---------------- */

/**
 * ゴールデンを 1 項目ずつ壊して、diff がそれを報告するかを実測する。
 * 1 つでも見逃したら、そのゴールデンは差を運べていない（[[instrument-must-pass-t3]]）。
 * 壊さない場合に差が 0 件であることも対で見る（空振り検査）。
 */
function t3(golden) {
  const clone = () => JSON.parse(JSON.stringify(golden));
  const keys = Object.keys(golden.specimens);
  const key = keys.find((k) => !golden.specimens[k].error && (golden.specimens[k].rows ?? []).length > 0);
  if (!key) {
    console.error('T-3 を回せない: 行を持つ検体が 1 つも無い');
    process.exit(2);
  }
  const withFail = keys.find((k) => (golden.specimens[k].rows ?? []).some((r) => r[2] === 'fail'));
  const erroredKey = keys.find((k) => golden.specimens[k].error);
  const reSha = (g, k) => {
    g.specimens[k].rowsSha = sha(stable(g.specimens[k].rows));
  };

  const mutations = [
    ['status を 1 行だけ変える', (g) => {
      const r = g.specimens[key].rows[0];
      r[2] = r[2] === 'pass' ? 'not_applicable' : 'pass';
      reSha(g, key);
    }],
    ['行を 1 つ落とす', (g) => { g.specimens[key].rows.splice(0, 1); reSha(g, key); }],
    ['target を 1 つ変える', (g) => { g.specimens[key].rows[0][1] += '-x'; reSha(g, key); }],
    ['violations を 1 増やす', (g) => { g.specimens[key].violations += 1; }],
    ['subjects を 1 増やす', (g) => { g.specimens[key].subjects += 1; }],
    ['検体を 1 つ落とす', (g) => { delete g.specimens[key]; }],
    // 🔴 判定を 1 つも動かさずに、読めた範囲だけを動かす。
    // 0.6.1 より前のこの計器は、この変異を 1 件も報告しなかった。
    ['observation.objects だけ変える（判定は動かさない）', (g) => {
      g.specimens[key].observation.objects += 1;
    }],
    ['observation.reconstructed だけ変える（判定は動かさない）', (g) => {
      g.specimens[key].observation.reconstructed = !g.specimens[key].observation.reconstructed;
    }],
    ['observation.pagesReached だけ変える（判定は動かさない）', (g) => {
      g.specimens[key].observation.pagesReached = !g.specimens[key].observation.pagesReached;
    }],
  ];
  if (withFail) {
    mutations.push(['failures の中身だけ変える（status は動かさない）', (g) => {
      const row = g.specimens[withFail].rows.find((r) => r[2] === 'fail');
      row[3] = sha(`${row[3]}-mutated`);
      reSha(g, withFail);
    }]);
  }
  if (erroredKey) {
    mutations.push(['読めなかった検体を「読めた」にする', (g) => {
      const e = g.specimens[erroredKey];
      delete e.error;
      e.rows = [];
      e.rowsSha = sha(stable([]));
      e.subjects = 0;
      e.violations = 0;
    }]);
  }

  const lines = [];
  let missed = 0;
  const same = diff(golden, clone());
  const sameFindings = same.regressions + same.attributable;
  lines.push(
    `  ${sameFindings === 0 ? 'OK  ' : '🔴  '} 空振り検査（何も壊さない）: 差 ${sameFindings} 件` +
      (sameFindings === 0 ? '' : ' — 壊していないのに差が出る = 比較が決定論的でない'),
  );
  if (sameFindings !== 0) missed += 1;

  for (const [name, mutate] of mutations) {
    const g = clone();
    mutate(g);
    const r = diff(golden, g);
    const found = r.regressions + r.attributable;
    if (found === 0) missed += 1;
    lines.push(`  ${found === 0 ? '🔴  ' : 'OK  '} ${name}: 差 ${found} 件`);
  }
  return { lines, missed, count: mutations.length + 1 };
}

/* ---------------- CLI ---------------- */

/** 値を取るフラグ。**ここに無いものを渡したら止まる**（黙って捨てない）。 */
const VALUE_FLAGS = new Set(['--set', '--label', '--given', '--limit', '--detail']);

/**
 * 宣言に無い引数を拒否する。
 *
 * 出自: 2026-08-28、`SETS="--set a --set b"` を `$SETS` で渡したところ、
 * **zsh は引用符なしの変数展開を単語分割しない**ので 1 個の引数として届き、
 * `--set` が 0 個と見なされて既定（fixtures だけ）で採ってしまった。
 * 14 件のゴールデンが「採れた」顔で出た。捨てたことを言わない計器は、
 * 測っていないことを測ったように見せる（zod 3 の strip と同じ形）。
 */
function assertKnownArgs(rest, positional) {
  for (let i = positional; i < rest.length; i += 1) {
    const a = rest[i];
    if (VALUE_FLAGS.has(a)) {
      if (rest[i + 1] === undefined) {
        console.error(`${a} に値がありません`);
        process.exit(2);
      }
      i += 1;
      continue;
    }
    if (a.includes('--set') || a.includes('--label') || a.includes('--given')) {
      console.error(
        `1 個の引数の中にフラグが埋まっています: ${JSON.stringify(a)}\n` +
          '  zsh は引用符なしの変数展開を単語分割しません。\n' +
          '  フラグは直接書くか、zsh なら ${=SETS} で分割してください。',
      );
      process.exit(2);
    }
    console.error(`知らない引数です: ${JSON.stringify(a)}`);
    process.exit(2);
  }
}

function argValues(rest, flag) {
  const out = [];
  rest.forEach((a, i) => {
    if (a === flag && rest[i + 1]) out.push(rest[i + 1]);
  });
  return out;
}
function argValue(rest, flag, fallback) {
  const i = rest.indexOf(flag);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

const [, , mode, ...rest] = process.argv;

if (mode === 'take') {
  const out = rest[0];
  if (!out || out.startsWith('--')) {
    console.error('usage: golden.mjs take <out.json> [--set <dir>]... [--label NAME] [--given <given.json>] [--limit N]');
    process.exit(2);
  }
  assertKnownArgs(rest, 1);
  const sets = argValues(rest, '--set');
  if (sets.length === 0) {
    console.log('⚠ --set が無いので fixtures/ だけを採る（軸が足りないはず）');
  }
  const golden = await take({
    sets: sets.length ? sets : [join(ROOT, 'fixtures')],
    label: argValue(rest, '--label', 'before'),
    givenPath: argValue(rest, '--given', null),
    limit: Number(argValue(rest, '--limit', 0)) || 0,
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(golden, null, 1)}\n`);
  const size = (statSync(resolve(out)).size / 1024 / 1024).toFixed(1);
  console.log(`\n# ゴールデン ${golden.label}`);
  console.log(`  検体 ${golden.specimenCount} 件（読めなかった ${golden.erroredCount} 件）`);
  console.log(
    `  packageVersion ${golden.packageVersion} / テーブル ${golden.tables.map((t) => `${t.name}@${t.version}`).join(' ')}`,
  );
  console.log(`  書き出し: ${resolve(out)}（${size} MB）`);
  console.log('\n# 軸（1 形しか無い軸は差を運べない）');
  for (const l of coverage(golden)) console.log(l);
  console.log(`\n  次: node scripts/golden.mjs t3 ${out}`);
} else if (mode === 'diff') {
  const [beforePath, afterPath] = rest;
  if (!beforePath || !afterPath) {
    console.error('usage: golden.mjs diff <before.json> <after.json> [--detail <file-key>]');
    process.exit(2);
  }
  assertKnownArgs(rest, 2);
  const before = JSON.parse(readFileSync(resolve(beforePath), 'utf8'));
  const after = JSON.parse(readFileSync(resolve(afterPath), 'utf8'));
  const r = diff(before, after);
  for (const l of r.lines) console.log(l);
  console.log('\n# 遷移の内訳');
  if (r.transitions.size === 0) console.log('  （差なし）');
  for (const [k, n] of [...r.transitions].sort((a, b) => b[1] - a[1])) console.log(`  ${n} 件  ${k}`);
  console.log(
    `\n# 受入（handoff §6 面 2）\n` +
      `  pass -> fail / 読めた -> 読めない / 行が消えた: ${r.regressions} 件（0 でなければ受入を満たさない）\n` +
      `  帰属を書く差: ${r.attributable} 件`,
  );
  const detailKey = argValue(rest, '--detail', null);
  if (detailKey) console.log(`\n${detail(before, after, detailKey)}`);
  process.exit(r.regressions + r.attributable > 0 ? 1 : 0);
} else if (mode === 't3') {
  let golden;
  if (rest[0] && !rest[0].startsWith('--')) {
    golden = JSON.parse(readFileSync(resolve(rest[0]), 'utf8'));
  } else {
    console.log('ゴールデンが渡されなかったので fixtures/ から採る（保存しない）');
    golden = await take({ sets: [join(ROOT, 'fixtures')], label: 't3', givenPath: null, limit: 0 });
  }
  const r = t3(golden);
  console.log('\n# T-3（計器自身。1 項目ずつ壊して差が出るかを実測する）');
  for (const l of r.lines) console.log(l);
  if (r.missed > 0) {
    console.log(`\n🔴 ${r.missed} / ${r.count} 件を見逃した。この計器ではゴールデンを採らない`);
    process.exit(2);
  }
  console.log(`\n  ${r.count} 件すべてが差として出た。ゴールデンを採ってよい`);
} else {
  console.error(
    [
      'usage:',
      '  golden.mjs take <out.json> [--set <dir>]... [--label NAME] [--given <given.json>] [--limit N]',
      '  golden.mjs diff <before.json> <after.json> [--detail <file-key>]',
      '  golden.mjs t3   [golden.json]',
    ].join('\n'),
  );
  process.exit(2);
}
