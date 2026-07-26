#!/usr/bin/env node
/**
 * 制約テーブル（tables/*.json）を tables/schema.json で検証する。
 *
 * **なぜデータを検証するのか**: テーブルは「ただのデータ」ではなく規範の写像である。
 * pdf-spec の S-4 では合成表が実在しない空行を持ち、それを基準線にした受け入れ検査が
 * バグごと緑になった。データも検証対象にしないと同じことが起きる。
 *
 * **なぜ依存ゼロなのか**: このパッケージの依存は pdf-lib だけに保つ方針（specs/18 §2）。
 * JSON Schema の完全実装は要らない — 使っている語彙（required / type / enum / pattern /
 * minItems / minLength / additionalProperties / $ref / items）だけを解釈する。
 * enum やパターンは **schema.json から読む**ので、二重管理にはならない。
 *
 * さらに JSON Schema では書けない相互参照も見る:
 *   - 述語が参照する fact が factVocabulary に定義されているか
 *   - eqFact / dateEquiv の value（= 別の fact 名）も定義されているか
 *   - 制約 ID がテーブル内で一意か
 *   - subjectNote を持つ制約の onFail が「痕跡」と述べているか（specs/18 §1 の文言規律）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tablesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tables');
const schema = JSON.parse(readFileSync(join(tablesDir, 'schema.json'), 'utf8'));

/** @type {string[]} */
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

/** schema.json の $ref（#/definitions/x）を解決する */
function resolve(node) {
  if (node && typeof node === 'object' && typeof node.$ref === 'string') {
    const path = node.$ref.replace(/^#\//, '').split('/');
    return path.reduce((acc, key) => acc[key], schema);
  }
  return node;
}

function validate(value, rawSchema, where) {
  const s = resolve(rawSchema);
  if (!s) return;

  if (s.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fail(where, `expected an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
    }
    for (const key of s.required ?? []) {
      if (!(key in value)) fail(where, `missing required property "${key}"`);
    }
    if (s.additionalProperties === false && s.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in s.properties)) fail(where, `unknown property "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(s.properties ?? {})) {
      if (key in value) validate(value[key], sub, `${where}.${key}`);
    }
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      for (const [key, sub] of Object.entries(value)) {
        validate(sub, s.additionalProperties, `${where}.${key}`);
      }
    }
    if (typeof s.minProperties === 'number' && Object.keys(value).length < s.minProperties) {
      fail(where, `expected at least ${s.minProperties} propertie(s)`);
    }
    return;
  }

  if (s.type === 'array') {
    if (!Array.isArray(value)) return fail(where, `expected an array, got ${typeof value}`);
    if (typeof s.minItems === 'number' && value.length < s.minItems) {
      fail(where, `expected at least ${s.minItems} item(s), got ${value.length}`);
    }
    value.forEach((item, i) => validate(item, s.items, `${where}[${i}]`));
    return;
  }

  if (s.type === 'string') {
    if (typeof value !== 'string') return fail(where, `expected a string, got ${typeof value}`);
    if (typeof s.minLength === 'number' && value.length < s.minLength) {
      fail(where, 'expected a non-empty string');
    }
    if (s.pattern && !new RegExp(s.pattern).test(value)) {
      fail(where, `"${value}" does not match ${s.pattern}`);
    }
  }

  if (Array.isArray(s.enum) && !s.enum.includes(value)) {
    fail(where, `"${value}" is not one of ${s.enum.join(' | ')}`);
  }
}

/** JSON Schema では書けない検査 */
function crossCheck(table, file) {
  const vocabulary = new Set(Object.keys(table.factVocabulary ?? {}));
  const seenIds = new Set();

  for (const constraint of table.constraints ?? []) {
    const where = `${file} ${constraint.id}`;
    if (seenIds.has(constraint.id)) fail(where, 'duplicate constraint id');
    seenIds.add(constraint.id);

    const predicates = [
      ...(constraint.when ?? []),
      ...(constraint.assert ?? []),
      ...(constraint.documentAssert ?? []),
      ...(constraint.assert ?? []).flatMap((a) => a.onlyWhen ?? []),
      ...(constraint.when ?? []).flatMap((a) => a.onlyWhen ?? []),
    ];

    for (const p of predicates) {
      // documentAssert の doc.* は評価器が組み立てる合成 fact なので語彙外を許す
      const synthetic = p.fact?.startsWith('doc.subsetTagsPerBaseName');
      if (p.fact && !vocabulary.has(p.fact) && !synthetic) {
        fail(where, `fact "${p.fact}" is not declared in factVocabulary`);
      }
      // 別 fact を参照する述語は、その参照先も語彙に無ければならない
      if ((p.op === 'eqFact' || p.op === 'dateEquiv') && !vocabulary.has(p.value)) {
        fail(where, `${p.op} references "${p.value}", which is not declared in factVocabulary`);
      }
    }

    // 主語が processor の条文は「違反」と断定しない（specs/18 §1 / F-5）
    if (constraint.subjectNote) {
      for (const a of constraint.assert ?? []) {
        if (!a.onFail.includes('痕跡')) {
          fail(where, 'has subjectNote but its onFail claims a violation outright — say 痕跡');
        }
      }
    }
  }
}

const files = readdirSync(tablesDir).filter((f) => f.endsWith('.json') && f !== 'schema.json');
if (files.length === 0) {
  console.error('No constraint tables found in tables/.');
  process.exit(1);
}

for (const file of files) {
  const table = JSON.parse(readFileSync(join(tablesDir, file), 'utf8'));
  validate(table, schema, file);
  crossCheck(table, file);
  if (table.name && file !== `${table.name}.json`) {
    fail(file, `table name "${table.name}" does not match the file name`);
  }
}

if (errors.length > 0) {
  console.error(`Constraint table validation failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Validated ${files.length} constraint table(s): ${files.join(', ')}`);
