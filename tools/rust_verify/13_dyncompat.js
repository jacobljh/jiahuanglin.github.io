#!/usr/bin/env node
/* Differential test: all_lessons/rust/lessons/dyncompat.js  vs  the real rustc.
 *
 *   node tools/rust_verify/13_dyncompat.js [traits=450] [seed=13]
 *
 * Generates random well-formed traits (methods with every receiver, generic / Self-taking / Self- or
 * impl-returning / async / `where Self: Sized` variants, associated consts, associated types, generic
 * associated types, supertraits Sized / Clone / Debug) and asks rustc three questions per trait:
 *   A  `fn a_i(_: &dyn T_i<Out = f64>) {}`  (associated types named): E0038 or not, and with exactly
 *      which "...because ..." reasons (compared as sets of rustc's own words)?
 *   B  the bare `fn b_i(_: &dyn T_i) {}` for traits that have a plain associated type: E0191, E0038, or ok?
 *   C  for every method of a trait rustc accepted in A: does `x.m(..)` on a `Box<dyn T_i>` compile?
 *      The engine says yes exactly for the methods it gives a table slot; for the others it predicts
 *      which rejection rustc prints (`cannot be invoked on a trait object`, or E0161 for by-value self).
 * Every disagreement is printed; exit status 1 if there is any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const DC = require('../../all_lessons/rust/lessons/dyncompat.js');

const NT = +(process.argv[2] || 450), SEED = +(process.argv[3] || 13);
let seed = SEED >>> 0;                 // mulberry32: deterministic, and free of the LCG's short low-bit cycles
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let z = seed; z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FN_NAMES = ['area', 'scale', 'dup', 'label', 'load', 'same', 'consume', 'make', 'grow', 'name', 'reset', 'boxed'];

function genTrait(i) {
  const r = rnd();
  const sup = r < 0.64 ? 'none' : r < 0.71 ? 'Sized' : r < 0.78 ? 'Clone' : 'Debug';
  const n = pick([0, 1, 1, 2, 2, 2, 3, 3, 4]);
  const items = [], used = new Set();
  let consts = 0, types = 0, gats = 0;
  for (let k = 0; k < n; k++) {
    const q = rnd();
    if (q < 0.08) { items.push({ kind: 'const', name: ['SIDES', 'K'][consts++ % 2] + (consts > 2 ? consts : '') }); continue; }
    if (q < 0.20) {
      const gat = rnd() < 0.3;
      if (gat) items.push({ kind: 'type', name: 'Item' + (gats++ ? gats : ''), gat: true });
      else items.push({ kind: 'type', name: ['Out', 'Unit'][types++ % 2] + (types > 2 ? types : ''), gat: false });
      continue;
    }
    let name; do { name = pick(FN_NAMES); } while (used.has(name)); used.add(name);
    items.push({ kind: 'fn', name, recv: pick(['ref', 'ref', 'ref', 'mut', 'mut', 'value', 'box', 'none']),
      ret: pick(['unit', 'f64', 'f64', 'f64', 'self', 'impl', 'boxdyn']), generic: rnd() < 0.15, selfArg: rnd() < 0.12,
      async: rnd() < 0.1, sized: rnd() < 0.25 });
  }
  return { name: 'T' + i, sup, items };
}

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyncompat_'));

function compile(name, lines) {
  const file = path.join(tmp, name + '.rs');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json',
    '-o', path.join(tmp, name + '.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const errs = [];
  for (const ln of (r.stderr || '').split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    const because = [];
    for (const c of d.children || []) for (const s of c.spans || [])
      if (s.label && s.label.startsWith('...because ')) because.push(s.label.slice('...because '.length));
    errs.push({ code: d.code && d.code.code, message: d.message, line: sp ? sp.line_start : -1, because });
  }
  return errs;
}
const HEADER = ['#![allow(unused)]', 'use std::fmt::{Debug, Display};'];
const setEq = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

const traits = [];
for (let i = 0; i < NT; i++) traits.push(genTrait(i));

// ── A and B: one file, a probe per line ─────────────────────────────────────────
const lines = HEADER.slice(), probeAt = {};
traits.forEach((t, i) => {
  const src = DC.render(t).split('\n');
  src.forEach((ln, k) => { lines.push(ln); if (k >= 1 && k <= t.items.length) probeAt[lines.length] = { i, part: 'item', j: k - 1 }; });
  lines.push(`fn a${i}(_: &${DC.dynType(t, true)}) {}`); probeAt[lines.length] = { i, part: 'A' };
  if (t.items.some(x => x.kind === 'type' && !x.gat)) { lines.push(`fn b${i}(_: &${DC.dynType(t, false)}) {}`); probeAt[lines.length] = { i, part: 'B' }; }
});
const errsAB = compile('probes', lines);
const got = {};                       // "A:3" -> [errors];  "item:3:1" -> [errors] at a trait's own line
let genBugs = 0;
for (const e of errsAB) {
  const p = probeAt[e.line];
  if (!p) { genBugs++; console.log(`  [generator problem] ${e.code} ${e.message} @line ${e.line}`); continue; }
  const key = p.part === 'item' ? 'item:' + p.i + ':' + p.j : p.part + ':' + p.i;
  (got[key] = got[key] || []).push(e);
}
let bad = 0, nA = 0, nB = 0, nC = 0, nI = 0, rejA = 0, e191 = 0;
const why = { A: 0, B: 0, C: 0, I: 0 };
function realVerdict(errs) {
  if (!errs || !errs.length) return { code: null, reasons: [] };
  if (errs.length > 1) return { code: 'MULTI:' + errs.map(e => e.code).join(','), reasons: [] };
  return { code: errs[0].code, reasons: errs[0].because };
}
traits.forEach((t, i) => {
  for (const part of ['A', 'B']) {
    if (part === 'B' && !t.items.some(x => x.kind === 'type' && !x.gat)) continue;
    const mine = DC.analyze(t, part === 'A'), real = realVerdict(got[part + ':' + i]);
    part === 'A' ? nA++ : nB++;
    if (part === 'A' && real.code === 'E0038') rejA++;
    if (part === 'B' && real.code === 'E0191') e191++;
    const same = mine.code === real.code && (real.code !== 'E0038' || setEq(mine.reasons, real.reasons));
    if (!same) {
      bad++; why[part]++;
      console.log(`  MISMATCH ${part} ${DC.probe(t, part === 'A')}\n${DC.render(t).replace(/^/gm, '      ')}` +
        `\n      rustc : ${real.code || 'accepted'} ${JSON.stringify(real.reasons)}\n      engine: ${mine.code || 'accepted'} ${JSON.stringify(mine.reasons)}`);
    }
  }
  // a method returning Box<dyn ThisTrait> is itself a use of the dyn type: rustc must reject that line
  // exactly when the trait is not dyn compatible, with the same reasons; no other trait line may err.
  const mineA = DC.analyze(t, true);
  t.items.forEach((it, j) => {
    const real = realVerdict(got['item:' + i + ':' + j]);
    const boxdyn = it.kind === 'fn' && it.ret === 'boxdyn';
    if (boxdyn) nI++;
    const want = boxdyn && mineA.code === 'E0038' ? { code: 'E0038', reasons: mineA.reasons } : { code: null, reasons: [] };
    if (real.code !== want.code || (want.code && !setEq(real.reasons, want.reasons))) {
      bad++; why.I++;
      console.log(`  MISMATCH item ${t.name}::${it.name || it.kind}  rustc: ${real.code || 'ok'} ${JSON.stringify(real.reasons)}  engine: ${want.code || 'ok'} ${JSON.stringify(want.reasons)}`);
    }
  });
});

// ── C: call every method through a Box<dyn T> of each trait rustc accepted ─────────
const lc = HEADER.slice(), callAt = {};
traits.forEach((t, i) => {
  if (realVerdict(got['A:' + i]).code) return;
  lc.push(...DC.render(t).split('\n'));
  t.items.forEach((it, j) => {
    if (it.kind !== 'fn' || it.recv === 'none') return;
    const args = []; if (it.generic) args.push('0u8'); if (it.selfArg) args.push('todo!()');
    lc.push(`fn c${i}_${j}(mut x: Box<${DC.dynType(t, true)}>) { let _ = x.${it.name}(${args.join(', ')}); }`);
    callAt[lc.length] = { i, j };
  });
});
const errsC = compile('calls', lc);
const gotC = {};
for (const e of errsC) {
  const p = callAt[e.line];
  if (!p) { genBugs++; console.log(`  [generator problem, calls] ${e.code} ${e.message} @line ${e.line}`); continue; }
  (gotC[p.i + ':' + p.j] = gotC[p.i + ':' + p.j] || []).push(e);
}
const kinds = { slot: 0, sized: 0, value: 0 };
Object.keys(callAt).forEach(ln => {
  const { i, j } = callAt[ln], t = traits[i], it = t.items[j];
  const v = DC.analyze(t, true).items[j].verdict;
  const errs = gotC[i + ':' + j] || [];
  nC++; kinds[v] = (kinds[v] || 0) + 1;
  const real = errs.length === 0 ? 'callable'
    : errs.length === 1 && errs[0].code === 'E0161' ? 'E0161'
    : errs.length === 1 && !errs[0].code && /cannot be invoked on a trait object/.test(errs[0].message) ? 'not-invocable'
    : 'OTHER:' + errs.map(e => (e.code || '') + ' ' + e.message).join(' | ');
  const mine = v === 'slot' ? 'callable' : v === 'value' ? 'E0161' : v === 'sized' ? 'not-invocable' : 'engine-said-' + v;
  if (real !== mine) { bad++; why.C++; console.log(`  MISMATCH C ${t.name}::${it.name}  ${DC.renderItem(it, t)}\n      rustc: ${real}   engine: ${mine}`); }
});

console.log(`A  ${nA} traits as &dyn T<..>: ${rejA} rejected with E0038, ${nA - rejA} accepted — ${why.A} mismatches (code + exact reason set)`);
console.log(`B  ${nB} bare &dyn T with an associated type: ${e191} E0191 — ${why.B} mismatches`);
console.log(`A' ${nI} methods returning Box<dyn ThisTrait>, whose own line must err exactly when the trait does — ${why.I} mismatches`);
console.log(`C  ${nC} method calls through Box<dyn T> (engine: ${kinds.slot} slot, ${kinds.sized} where-Self-Sized, ${kinds.value} by-value) — ${why.C} mismatches`);
console.log(`\n${nA + nB + nI + nC} checks on ${NT} random traits, ${bad} mismatches, ${genBugs} generator problems`);
process.exit(bad || genBugs ? 1 : 0);
