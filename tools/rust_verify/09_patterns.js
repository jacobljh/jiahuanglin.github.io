#!/usr/bin/env node
/* Differential test: all_lessons/rust/lessons/patterns.js  vs  the real rustc (Lesson 09's widget).
 *
 *   node tools/rust_verify/09_patterns.js [cases=600] [seed=9]
 *
 * Generates random well-formed (type, arms) cases over the widget's types (bool, u8, tuples, Option,
 * Result, the Light enum) and some compositions of them, writes ONE Rust file with one `fn` per case
 * (every arm on its own line, guards are `if c`), compiles it with --error-format=json, and compares,
 * case by case:
 *   (a) exhaustiveness: did rustc report E0004 for this match?
 *   (b) reachability: the exact set of arm lines carrying an `unreachable_patterns` warning
 *       (a whole arm, or an alternative inside an arm's or-pattern);
 *   (c) the witnesses: rustc's E0004 headline must equal the one the engine builds, character for
 *       character — which checks the witness list, its order, and the "and N more" count.
 * Any disagreement is printed; exit status 1 if there is one (or if the generator made rustc reject
 * the file for any other reason).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const P = require('../../all_lessons/rust/lessons/patterns.js');

const N = +(process.argv[2] || 600), SEED = +(process.argv[3] || 9);
let seed = SEED;
// 32-bit LCG (Math.imul keeps the product exact; a plain `*` would overflow 2^53 and degenerate)
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x80000000; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));      // inclusive

const PRESETS = ['bool', 'Option<bool>', '(bool, bool)', 'Option<Option<bool>>', 'Light', 'Result<u8, bool>', 'u8'];
const COMPOSITES = ['(bool, Light)', 'Option<u8>', '(u8, bool)', 'Result<Option<bool>, Light>', 'Option<(bool, bool)>',
  '(Option<bool>, u8)', '(bool, bool, bool)', 'Result<u8, Option<bool>>', 'Option<Light>', '(Light, Light)'];
const INTERESTING = [0, 1, 2, 5, 9, 10, 42, 99, 100, 127, 128, 200, 254, 255];

function genInt() {
  const v = () => (rnd() < 0.7 ? pick(INTERESTING) : ri(0, 255));
  const r = rnd();
  if (r < 0.40) return String(v());
  let a = v(), b = v(); if (a > b) { const t = a; a = b; b = t; }
  if (r < 0.62) return a + '..=' + b;
  if (r < 0.74 && a < b) return a + '..' + b;
  if (r < 0.84) return a + '..';
  if (r < 0.93) return '..=' + b;
  return b > 0 ? '..' + b : '..=' + b;
}

// ctx: { names: counter, inOr: bool }  — bindings never appear inside an or-pattern (rustc would want
// every alternative to bind the same names), and every binding name in one pattern is unique.
function gen(ty, depth, ctx) {
  const r = rnd(), pw = ctx.top ? ctx.pw / 3 : ctx.pw;
  ctx.top = false;
  if (depth <= 0 || r < pw) {
    if (!ctx.inOr && rnd() < 0.35) return 'v' + (ctx.names++);
    return '_';
  }
  if (r < pw + 0.10 && depth >= 1) {                // an or-pattern
    const k = ri(2, 3), alts = [];
    const inner = { names: ctx.names, inOr: true, pw: ctx.pw };
    for (let i = 0; i < k; i++) alts.push(genCtor(ty, depth - 1, inner));
    return alts.join(' | ');
  }
  if (r < pw + 0.14 && !ctx.inOr) {                  // x @ pattern
    const name = 'v' + (ctx.names++);
    const sub = genCtor(ty, depth - 1, ctx);
    return name + ' @ ' + (sub.indexOf('|') >= 0 && !/^\(/.test(sub) ? '(' + sub + ')' : sub);
  }
  return genCtor(ty, depth - 1, ctx);
}
function genCtor(ty, depth, ctx) {
  switch (ty.k) {
    case 'bool': return rnd() < 0.5 ? 'true' : 'false';
    case 'int': return genInt();
    case 'tuple': {
      const n = ty.items.length;
      const parts = ty.items.map((t) => gen(t, depth, ctx));
      if (n >= 2 && rnd() < 0.15) {                  // use `..` for a run of fields
        const at = ri(0, n - 1), drop = ri(1, n - at);
        const kept = parts.slice(0, at).concat(['..'], parts.slice(at + drop));
        return '(' + kept.join(', ') + ')';
      }
      return '(' + parts.join(', ') + (n === 1 ? ',' : '') + ')';
    }
    case 'enum': {
      const i = ri(0, ty.variants.length - 1), v = ty.variants[i], name = ty.prefix + v.n;
      if (!v.f.length) return name;
      if (rnd() < 0.08) return name + '(..)';
      return name + '(' + v.f.map((t) => gen(t, depth, ctx)).join(', ') + ')';
    }
  }
  throw new Error('bad type');
}

function genCase() {
  const tyName = rnd() < 0.62 ? pick(PRESETS) : pick(COMPOSITES);
  const ty = P.parseType(tyName);
  const sparse = rnd() < 0.5, pw = sparse ? 0.06 : 0.22;          // half the cases rarely use wildcards
  const nArms = rnd() < 0.03 ? 0 : ri(1, 6);
  const arms = [];
  for (let i = 0; i < nArms; i++) {
    const src = gen(ty, ri(1, 4), { names: 0, inOr: false, pw, top: true });
    arms.push({ src, guard: rnd() < 0.2 });
  }
  if (nArms && rnd() < (sparse ? 0.1 : 0.3)) {
    arms.push({ src: rnd() < 0.5 ? '_' : 'rest', guard: false });   // a catch-all ...
    if (rnd() < 0.3) arms.push({ src: gen(ty, 2, { names: 0, inOr: false, pw, top: true }), guard: rnd() < 0.2 }); // ... and one after it
  }
  return { tyName, ty, arms };
}

const HEADER = [
  '#![allow(unused)]',
  '#![allow(overlapping_range_endpoints, non_contiguous_range_endpoints)]',
  '#![warn(unreachable_patterns)]',
  '#[derive(Clone, Copy)]',
  'enum Light { Off, Red, Amber, Green(bool) }',
];

const cases = [];
for (let i = 0; i < N; i++) cases.push(genCase());
const lines = HEADER.slice();
cases.forEach((cs, i) => {
  lines.push('fn case' + i + '(x: ' + cs.tyName + ', c: bool) {');
  lines.push('    match x {'); cs.matchLine = lines.length;
  cs.armLines = cs.arms.map((a) => { lines.push('        ' + a.src + (a.guard ? ' if c' : '') + ' => {}'); return lines.length; });
  lines.push('    }');
  lines.push('}');
});

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pat09_'));
const file = path.join(tmp, 'cases.rs');
fs.writeFileSync(file, lines.join('\n') + '\n');
const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json',
  '-o', path.join(tmp, 'cases.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });

const e0004 = new Map();               // matchLine -> headline
const unreachable = new Set();         // arm lines with an unreachable_patterns warning
let genBugs = 0;
for (const ln of (r.stderr || '').split('\n')) {
  let d; try { d = JSON.parse(ln); } catch (e) { continue; }
  if (d.$message_type && d.$message_type !== 'diagnostic') continue;
  const code = d.code && d.code.code;
  const sp = (d.spans || []).find((s) => s.is_primary) || (d.spans || [])[0];
  if (d.level === 'error') {
    if (/^aborting due to/.test(d.message)) continue;
    if (code === 'E0004' && sp) e0004.set(sp.line_start, d.message);
    else { genBugs++; console.log('  [generator bug?] ' + code + ' ' + d.message + ' @' + (sp && sp.line_start) + ': ' + (sp ? lines[sp.line_start - 1].trim() : '')); }
  } else if (d.level === 'warning' && code === 'unreachable_patterns' && sp) {
    unreachable.add(sp.line_start);
  }
}

let bad = 0, nExh = 0, nUnreach = 0, nWit = 0, nMore = 0, nGuard = 0, nOr = 0;
cases.forEach((cs, i) => {
  let mine;
  try {
    const arms = cs.arms.map((a) => { const x = P.parseArm(a.src + (a.guard ? ' if c' : ''), cs.ty); return x; });
    mine = P.check(cs.ty, arms);
  } catch (e) { bad++; console.log('  ENGINE ERROR case' + i + ' ' + cs.tyName + ': ' + e.message); return; }
  const realHead = e0004.get(cs.matchLine) || null;
  const realUnr = cs.armLines.map((l, k) => (unreachable.has(l) ? k : -1)).filter((k) => k >= 0);
  const mineUnr = mine.arms.map((a, k) => (!a.useful || a.redundant.length ? k : -1)).filter((k) => k >= 0);
  const probs = [];
  if (mine.exhaustive !== (realHead === null)) probs.push('exhaustive: rustc=' + (realHead === null) + ' engine=' + mine.exhaustive);
  if (realHead !== null && mine.headline !== realHead) probs.push('witnesses:\n        rustc : ' + realHead + '\n        engine: ' + mine.headline);
  if (realUnr.join(',') !== mineUnr.join(',')) probs.push('unreachable arms: rustc=[' + realUnr.map((k) => k + 1) + '] engine=[' + mineUnr.map((k) => k + 1) + ']');
  if (mine.exhaustive) nExh++; else nWit++;
  if (realHead && / more not covered$/.test(realHead)) nMore++;
  if (mineUnr.length) nUnreach++;
  if (cs.arms.some((a) => a.guard)) nGuard++;
  if (cs.arms.some((a) => a.src.indexOf('|') >= 0)) nOr++;
  if (probs.length) {
    bad++;
    console.log('  MISMATCH case' + i + '  match x: ' + cs.tyName + ' { ' + cs.arms.map((a) => a.src + (a.guard ? ' if c' : '')).join(' ; ') + ' }');
    probs.forEach((p) => console.log('      ' + p));
  }
});
console.log(N + ' cases (' + nExh + ' exhaustive, ' + nWit + ' with E0004 [' + nMore + ' "and N more"], ' + nUnreach +
  ' with unreachable arms/alternatives, ' + nGuard + ' with guards, ' + nOr + ' with or-patterns): ' + bad + ' mismatches, ' + genBugs + ' generator problems');
process.exit(bad || genBugs ? 1 : 0);
