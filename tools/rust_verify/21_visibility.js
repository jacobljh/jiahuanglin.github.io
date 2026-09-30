#!/usr/bin/env node
/* Differential test: all_lessons/rust/lessons/visibility.js (and, part 2, traitsolver.js) vs the real rustc.
 *
 *   node tools/rust_verify/21_visibility.js [trees=320] [seed=21] [combos=120]
 *
 * Part 1 — privacy. Random module trees (nested `mod`s holding fns, structs with fields, and impl blocks with
 * methods and associated functions; every item gets a random visibility rustc accepts: private, pub,
 * pub(crate), pub(super), pub(self), pub(in path)). Each tree gets random probes — call a fn, write or read a
 * field, call a method or an associated function, build a struct literal — written in a random module of the
 * tree, or in another crate that depends on it. The tree's source is emitted here, independently of the
 * engine, and the engine parses that text. rustc 1.98.1 (edition 2024) compiles, per tree:
 *   A   the tree with its in-crate probes, except struct literals whose path the engine calls visible;
 *   B   the tree with exactly those literals (E0451 comes from a later compiler pass that rustc skips once
 *       any earlier error exists, so they are compiled apart);
 *   L   the tree alone as the library `tree`, which must compile;  D, D2  the other crate's probes, split
 *       the same way, compiled with `--extern tree=`.
 * Each probe is one line; rustc's errors are matched to probes by line, and each probe's set of
 * (code, message) must equal Vis.check's. Any error that is not on a probe line is a generator bug.
 * One normalization: when a struct cannot be named from the probe, rustc's E0616 names it by a longer path
 * (`field `y` of struct `tree::ma::S2` is private`); the engine says `S2`, so that prefix is removed.
 *
 * Part 2 — auto traits through a private field. For random field types T, `pub struct Cache { hits: u64,
 * extra: T }` (both fields private) is checked for Send and Sync from outside its module; traitsolver.js
 * predicts both, and whether adding `extra` flips the struct's answer (without it, Cache is Send + Sync).
 * Exit status 1 on any disagreement.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const V = require('../../all_lessons/rust/lessons/visibility.js');
const TS = require('../../all_lessons/rust/lessons/traitsolver.js');

const NTREES = +(process.argv[2] || 320), SEED = +(process.argv[3] || 21), NCOMBO = +(process.argv[4] || 120);
let seed = SEED >>> 0;                 // mulberry32
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let z = seed; z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vis21_'));

function compile(name, src, crateName, extra) {
  const file = path.join(tmp, name + '.rs');
  fs.writeFileSync(file, src);
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--crate-name', crateName, '--emit=metadata',
    '--error-format=json', '-o', path.join(tmp, 'lib' + crateName + '.rmeta'), file].concat(extra || []), { encoding: 'utf8', maxBuffer: 1 << 28 });
  const errs = [];
  for (const ln of (r.stderr || '').split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.$message_type !== 'diagnostic' || d.level !== 'error' || /^aborting due to/.test(d.message)) continue;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    errs.push({ code: d.code ? d.code.code : null, msg: d.message, line: sp ? sp.line_start : -1 });
  }
  return { ok: r.status === 0, errs };
}

/* ───────────── part 1: random module trees ───────────── */
const MODN = ['ma', 'mb', 'mc', 'md', 'me', 'mf', 'mg', 'mh'];
function genTree() {
  const mods = [{ name: 'crate', parent: -1, depth: 0, items: [] }];
  const n = 1 + Math.floor(rnd() * 7);
  for (let i = 0; i < n; i++) {
    const cands = mods.map((m, k) => k).filter(k => mods[k].depth < 4);
    const par = rnd() < 0.55 ? cands[cands.length - 1] : pick(cands);   // lean toward depth
    mods.push({ name: MODN[i], parent: par, depth: mods[par].depth + 1, items: [] });
  }
  const anc = (k) => { const out = []; for (let m = k; m >= 0; m = mods[m].parent) out.push(m); return out; };
  const abs = (k) => anc(k).reverse().map(m => mods[m].name).join('::');
  function vis(home) {                                   // a visibility rustc accepts on an item in `home`
    const r = rnd();
    if (r < 0.28) return '';
    if (r < 0.54) return 'pub ';
    if (r < 0.66) return 'pub(crate) ';
    if (r < 0.78 && home > 0) return 'pub(super) ';
    if (r < 0.81) return 'pub(self) ';
    const a = pick(anc(home));                            // pub(in <an enclosing module>)
    const q = rnd();
    if (a === home && q < 0.3) return 'pub(in self) ';
    if (home > 0 && a === mods[home].parent && q < 0.3) return 'pub(in super) ';
    const up = anc(home).indexOf(a);
    if (up === 2 && q < 0.5) return 'pub(in super::super) ';
    return 'pub(in ' + abs(a) + ') ';
  }
  let nf = 0, ns = 0;
  mods.forEach((m, k) => {
    if (k > 0) mods[m.parent].items.push({ k: 'mod', id: k, vis: vis(m.parent) });
  });
  mods.forEach((m, k) => {
    const fns = pick([0, 1, 1, 2]), sts = pick(k === 0 ? [0, 1] : [0, 1, 1, 2]);
    for (let i = 0; i < fns; i++) m.items.push({ k: 'fn', name: 'f' + (++nf), vis: vis(k) });
    for (let i = 0; i < sts; i++) {
      const fields = ['x', 'y', 'z'].slice(0, 1 + Math.floor(rnd() * 3)).map(f => ({ name: f, vis: vis(k) }));
      const meths = [];
      ['get', 'put', 'new', 'make'].forEach(nm => { if (rnd() < 0.4) meths.push({ name: nm, self: nm === 'get' ? '&self' : nm === 'put' ? '&mut self' : '', vis: vis(k) }); });
      m.items.push({ k: 'struct', name: 'S' + (++ns), vis: vis(k), fields, meths });
    }
    for (let i = m.items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = m.items[i]; m.items[i] = m.items[j]; m.items[j] = t; }
  });
  return { mods, abs };
}
function emit(g, extra) {                                // the tree as Rust; extra[k] = probe lines inside module k
  const out = [];
  (function body(k, ind) {
    const pad = '    '.repeat(ind);
    g.mods[k].items.forEach(it => {
      if (it.k === 'fn') out.push({ text: pad + it.vis + 'fn ' + it.name + '() {}' });
      else if (it.k === 'struct') {
        out.push({ text: pad + it.vis + 'struct ' + it.name + ' {' });
        it.fields.forEach(f => out.push({ text: pad + '    ' + f.vis + f.name + ': u8,' }));
        out.push({ text: pad + '}' });
        if (it.meths.length) {
          out.push({ text: pad + 'impl ' + it.name + ' {' });
          it.meths.forEach(x => out.push({ text: pad + '    ' + x.vis + 'fn ' + x.name + '(' + x.self + ') {}' }));
          out.push({ text: pad + '}' });
        }
      } else {
        out.push({ text: pad + it.vis + 'mod ' + g.mods[it.id].name + ' {' });
        body(it.id, ind + 1);
        out.push({ text: pad + '}' });
      }
    });
    (extra && extra[k] || []).forEach(p => out.push({ text: pad + p.text, probe: p }));
  })(0, 0);
  return out;
}
function probeLine(modPath, pr, k, base) {               // one probe, on one line
  const where = modPath.replace(/^crate/, base);
  const fn = 'fn probe_' + k;
  if (pr.kind === 'call') return fn + '() { ' + where + '::' + pr.name + '(); }';
  if (pr.kind === 'assoc') return fn + '() { ' + where + '::' + pr.s + '::' + pr.name + '(); }';
  if (pr.kind === 'method') return fn + '(v: &mut ' + where + '::' + pr.s + ') { v.' + pr.name + '(); }';
  if (pr.kind === 'field') return fn + '(v: &mut ' + where + '::' + pr.s + ') { ' + (pr.write ? 'v.' + pr.name + ' = 0;' : 'let _ = &v.' + pr.name + ';') + ' }';
  return fn + '() { let _ = ' + where + '::' + pr.s + ' { ' + pr.fields.map(f => f + ': 0').join(', ') + ' }; }';
}

let bad = 0, genBugs = 0, total = 0, rejected = 0;
const byCode = {};
for (let t = 0; t < NTREES; t++) {
  const g = genTree();
  const plain = emit(g).map(l => l.text).join('\n') + '\n';
  let tree;
  try { tree = V.parse(plain); } catch (e) { bad++; console.log(`tree ${t}: the engine refused a tree rustc accepts: ${e.message}\n${plain}`); continue; }
  const idOf = {};                                        // generator module index -> engine module id
  tree.mods.forEach(m => { idOf[V.pathOf(tree, m.id)] = m.id; });
  const all = V.probes(tree);
  if (!all.length) { t--; continue; }                    // a tree with no items offers no probe: draw another
  const nProbe = 8 + Math.floor(rnd() * 9);
  const inA = {}, inB = {}, dA = [], dB = [];
  const cases = [];
  for (let k = 0; k < nProbe; k++) {
    const builds = all.filter(x => x.kind === 'build');
    const pr = Object.assign({}, builds.length && rnd() < 0.2 ? pick(builds) : pick(all));   // extra literals: E0451 needs a visible path
    if (pr.kind === 'field') pr.write = rnd() < 0.5;
    if (pr.kind === 'build') pr.fields = tree.mods[pr.mod].structs.find(s => s.name === pr.s).fields.map(f => f.name);
    const from = rnd() < 0.25 ? V.EXT : Math.floor(rnd() * g.mods.length);
    const fromId = from === V.EXT ? V.EXT : idOf[g.abs(from)];
    const want = V.check(tree, fromId, pr);
    const later = pr.kind === 'build' && want.masked === null && !want.errors.some(e => e.code === 'E0603');
    const c = { k, pr, from, want, text: probeLine(V.pathOf(tree, pr.mod), pr, k, from === V.EXT ? 'tree' : 'crate') };
    cases.push(c);
    if (from === V.EXT) (later ? dB : dA).push(c);
    else { const bin = later ? inB : inA; (bin[from] = bin[from] || []).push(c); }
  }
  const got = {};
  cases.forEach(c => { got[c.k] = []; });
  function run(name, lines, crateName, extra) {
    const res = compile(name + t, lines.map(l => l.text).join('\n') + '\n', crateName, extra);
    res.errs.forEach(e => {
      const l = lines[e.line - 1];
      if (l && l.probe) got[l.probe.k].push((e.code || '-') + ' ' + e.msg.replace(/struct `(?:\w+::)+(\w+)`/, 'struct `$1`'));
      else { genBugs++; console.log(`tree ${t} ${name}: error off the probe lines: ${e.code} ${e.msg} @${e.line}`); }
    });
    return res;
  }
  if (Object.keys(inA).length) run('A', emit(g, inA), 't');
  if (Object.keys(inB).length) run('B', emit(g, inB), 't');
  if (dA.length || dB.length) {
    const lib = compile('L' + t, plain, 'tree');
    if (!lib.ok) { genBugs++; console.log(`tree ${t}: the library itself failed: ${JSON.stringify(lib.errs)}`); }
    const ext = ['--extern', 'tree=' + path.join(tmp, 'libtree.rmeta')];
    if (dA.length) run('D', dA.map(c => ({ text: c.text, probe: c })), 'down', ext);
    if (dB.length) run('E', dB.map(c => ({ text: c.text, probe: c })), 'down', ext);
  }
  cases.forEach(c => {
    total++;
    const mine = c.want.errors.map(e => e.code + ' ' + e.msg).sort(), real = got[c.k].sort();
    if (real.length) rejected++;
    real.forEach(x => { const code = x.split(' ')[0]; byCode[code] = (byCode[code] || 0) + 1; });
    if (JSON.stringify(mine) !== JSON.stringify(real)) {
      bad++;
      console.log(`MISMATCH tree ${t}, from ${c.from === V.EXT ? 'another crate' : g.abs(c.from)}: ${c.text}\n  rustc : ${JSON.stringify(real)}\n  engine: ${JSON.stringify(mine)}\n${plain}`);
    }
  });
}
console.log(`part 1: ${NTREES} module trees, ${total} probes (${rejected} rejected by rustc; by code ${JSON.stringify(byCode)}): ${bad} mismatches, ${genBugs} generator problems`);

/* ───────────── part 2: an auto trait leaks through a private field ───────────── */
const LEAF = ['i32', 'u8', 'f64', 'bool', 'String', '()', 'AtomicUsize'];
const ONE = ['Vec', 'Option', 'Box', 'Rc', 'Arc', 'Cell', 'RefCell', 'Mutex', 'RwLock', 'std::rc::Weak', 'std::sync::Weak', 'Sender', 'Receiver', 'JoinHandle'];
function genType(depth) {
  if (depth <= 0 || rnd() < 0.2) return pick(LEAF);
  const r = rnd();
  if (r < 0.62) return pick(ONE) + '<' + genType(depth - 1) + '>';
  if (r < 0.70) return 'HashMap<String, ' + genType(depth - 1) + '>';
  if (r < 0.76) return "MutexGuard<'static, " + genType(depth - 1) + '>';
  if (r < 0.82) return "&'static " + genType(depth - 1);
  if (r < 0.86) return '*const ' + genType(depth - 1);
  if (r < 0.93) return '(' + genType(depth - 1) + ', ' + genType(depth - 1) + ')';
  return pick(['Box<dyn Show>', 'Box<dyn Show + Send>', 'Box<dyn Show + Send + Sync>']);
}
const combos = [], seenT = new Set();
while (combos.length < NCOMBO) { const ty = genType(3); if (!seenT.has(ty)) { seenT.add(ty); combos.push(ty); } }
const lines = ['#![allow(unused)]', 'use std::rc::Rc; use std::sync::{Arc, Mutex, RwLock, MutexGuard};', 'use std::cell::{Cell, RefCell};',
  'use std::collections::HashMap; use std::sync::mpsc::{Sender, Receiver}; use std::thread::JoinHandle;',
  'use std::sync::atomic::AtomicUsize;', 'pub trait Show {}', 'fn need_send<T: Send>() {}', 'fn need_sync<T: Sync>() {}'];
combos.forEach((ty, i) => lines.push(`mod c${i} { use super::*; pub struct Cache { hits: u64, extra: ${ty} } }`));
const firstSend = lines.length + 1;
combos.forEach((ty, i) => lines.push(`fn s${i}() { need_send::<c${i}::Cache>(); }`));
const firstSync = lines.length + 1;
combos.forEach((ty, i) => lines.push(`fn y${i}() { need_sync::<c${i}::Cache>(); }`));
const r2 = compile('autotraits', lines.join('\n') + '\n', 'autotraits');
const failed = new Set();
r2.errs.forEach(e => { if (e.code === 'E0277') failed.add(e.line); else { genBugs++; console.log(`part 2: unexpected ${e.code} ${e.msg} @${e.line}`); } });
const v1 = { structs: { Cache: { params: [], fields: ['u64'] } } };
let bad2 = 0, flips = 0;
['Send', 'Sync'].forEach(trait => {
  const before = TS.solve(trait, TS.parse('Cache'), v1).ok;
  if (!before) { bad2++; console.log('part 2: the solver says Cache { hits: u64 } is not ' + trait); }
  combos.forEach((ty, i) => {
    const real = !failed.has((trait === 'Send' ? firstSend : firstSync) + i);
    const mine = TS.solve(trait, TS.parse('Cache'), { structs: { Cache: { params: [], fields: ['u64', ty] } } }).ok;
    if (before && !mine) flips++;
    if (mine !== real) { bad2++; console.log(`part 2 MISMATCH ${trait} with private field ${ty}: rustc=${real} solver=${mine}`); }
  });
});
console.log(`part 2: ${combos.length} private field types x {Send, Sync} = ${2 * combos.length} checks, ${flips} flips from yes to no predicted: ${bad2} mismatches`);
console.log(`\n${total + 2 * combos.length} cases in all, ${bad + bad2} mismatches, ${genBugs} generator problems`);
process.exit(bad || bad2 || genBugs ? 1 : 0);
