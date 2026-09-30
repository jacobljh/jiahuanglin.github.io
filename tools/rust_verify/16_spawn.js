#!/usr/bin/env node
/* Differential test: all_lessons/rust/lessons/sendsync.js (over traitsolver.js)  vs  the real rustc.
 * Lesson 16's widget: "Can it cross a thread boundary?"
 *
 *   node tools/rust_verify/16_spawn.js [randomCases=500] [seed=16]
 *
 * Part 1  every widget preset in each of the six modes (the verdicts the lesson prints);
 * Part 2  random programs: a fresh set of random user structs (generic or not, some with
 *         `unsafe impl Send/Sync`), and random closures with 1-3 captures, each used by value, by & or
 *         by &mut, with and without `move`, handed to thread::spawn or thread::scope's spawn — plus
 *         bare `is_send::<T>()` / `is_sync::<T>()` probes;
 * Part 3  every repair the engine proposes and believes complete is compiled, and must be accepted.
 * All cases of a part go into ONE file, one function per line, compiled with rustc --edition 2024.
 * Compared per case: the set of error codes; for E0277 the set of (culprit type, sent|shared) named
 * in rustc's headlines vs the engine's failing leaves; for E0373 the borrowed variables it names.
 * Prints every mismatch; exit 1 if any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const SS = require('../../all_lessons/rust/lessons/sendsync.js');

const NRAND = +(process.argv[2] || 500), SEED = +(process.argv[3] || 16);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss16_'));

/* ---------------- random types ---------------- */
const LEAF = ['i32', 'u8', 'u64', 'f64', 'bool', 'char', 'String', '()', 'AtomicUsize', 'AtomicBool'];
const ONE = ['Vec', 'Option', 'Box', 'VecDeque', 'HashSet', 'BTreeSet', 'Rc', 'Arc', 'Cell', 'RefCell', 'Mutex', 'RwLock',
  'std::rc::Weak', 'std::sync::Weak', 'Sender', 'Receiver', 'SyncSender', 'JoinHandle', 'BinaryHeap', 'LinkedList',
  'PhantomData', 'UnsafeCell'];
const TWO = ['HashMap', 'BTreeMap', 'Result'];
const DYN = ['dyn Show', 'dyn Show + Send', 'dyn Show + Sync', 'dyn Show + Send + Sync', 'dyn Debug + Send',
  'dyn Fn()', 'dyn Fn() + Send', 'dyn FnMut(i32) -> i32 + Send + Sync'];
const GUARD = ['MutexGuard', 'RwLockReadGuard', 'RwLockWriteGuard'];

// structs: name -> { params, gen }  (only structs defined earlier may appear in a field: no recursion)
function genType(depth, o) {
  const structs = o.structs || [];
  if (depth <= 0 || rnd() < 0.2) {
    if (structs.length && rnd() < 0.3) { const s = pick(structs); return s.params.length ? s.name + '<' + genType(depth - 1, o) + '>' : s.name; }
    return pick(LEAF);
  }
  const r = rnd();
  if (r < 0.46) return pick(ONE) + '<' + genType(depth - 1, o) + '>';
  if (r < 0.54) return pick(TWO) + '<' + genType(depth - 1, o) + ', ' + genType(depth - 1, o) + '>';
  if (r < 0.59) return pick(GUARD) + (o.staticOnly || rnd() < 0.6 ? "<'static, " : '<') + genType(depth - 1, o) + '>';
  if (r < 0.67) return (o.staticOnly || rnd() < 0.5 ? "&'static " : '&') + genType(depth - 1, o);
  if (r < 0.71) return (o.staticOnly || rnd() < 0.5 ? "&'static mut " : '&mut ') + genType(depth - 1, o);
  if (r < 0.74) return '*const ' + genType(depth - 1, o);
  if (r < 0.76) return '*mut ' + genType(depth - 1, o);
  if (r < 0.83) return '(' + genType(depth - 1, o) + ', ' + genType(depth - 1, o) + ')';
  if (r < 0.86) return '[' + genType(depth - 1, o) + '; 2]';
  if (r < 0.88) return 'fn(i32) -> i32';
  if (r < 0.90) return "&'static str";
  return 'Box<' + pick(DYN) + '>';
}
const TWRAP = ['T', 'Vec<T>', 'Box<T>', 'Option<T>', 'Rc<T>', 'Arc<T>', 'Cell<T>', 'RefCell<T>', 'Mutex<T>', 'PhantomData<T>',
  '(T, u8)', 'std::rc::Weak<T>', 'Sender<T>', 'Receiver<T>', 'RwLock<T>'];
function genStructs(prefix, n) {
  const list = [], lines = [];
  for (let i = 0; i < n; i++) {
    const name = prefix + i, generic = rnd() < 0.4, params = generic ? ['T'] : [];
    const nf = 1 + Math.floor(rnd() * 3), fields = [];
    if (generic) fields.push(pick(TWRAP));
    while (fields.length < nf) fields.push(genType(2, { structs: list, staticOnly: true }));
    const g = generic ? '<T>' : '';
    const tuple = rnd() < 0.25;
    lines.push(tuple ? `struct ${name}${g}(${fields.join(', ')});` : `struct ${name}${g} { ${fields.map((f, k) => 'f' + k + ': ' + f).join(', ')} }`);
    if (rnd() < 0.2) lines.push(`unsafe impl${g} Send for ${name}${g} {}`);
    if (rnd() < 0.12) lines.push(`unsafe impl${g} Sync for ${name}${g} {}`);
    list.push({ name, params });
  }
  return { list, text: lines.join('\n') };
}

/* ---------------- Rust files ---------------- */
const HEADER = `#![allow(unused, dead_code)]
use std::rc::Rc;
use std::sync::{Arc, Mutex, RwLock, MutexGuard, RwLockReadGuard, RwLockWriteGuard};
use std::cell::{Cell, RefCell, UnsafeCell};
use std::collections::*;
use std::sync::mpsc::{Sender, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::sync::atomic::*;
use std::marker::PhantomData;
use std::fmt::Debug;
trait Show {}
fn is_send<X: Send>() {}
fn is_sync<X: Sync>() {}`;

function compile(name, structText, caseLines) {
  const lines = HEADER.split('\n').concat(structText ? structText.split('\n') : []);
  const first = lines.length + 1;
  caseLines.forEach(l => lines.push(l));
  const file = path.join(tmp, name + '.rs');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--error-format=json',
    '-o', path.join(tmp, name + '.rmeta'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const per = caseLines.map(() => ({ codes: new Set(), culprits: new Set(), borrowed: new Set() }));
  const stray = [];
  for (const ln of (r.stderr || '').split('\n')) {
    let d; try { d = JSON.parse(ln); } catch (e) { continue; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) continue;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    const idx = sp ? sp.line_start - first : -1;
    const code = (d.code && d.code.code) || 'nocode';
    if (idx < 0 || idx >= caseLines.length) { stray.push(code + ' ' + d.message + ' @' + (sp && sp.line_start)); continue; }
    per[idx].codes.add(code);
    let m;
    if (code === 'E0277' && (m = /^`(.*)` cannot be (sent|shared) between threads safely$/.exec(d.message)))
      per[idx].culprits.add(norm(m[1]) + '|' + (m[2] === 'sent' ? 'Send' : 'Sync'));
    else if (code === 'E0277') per[idx].culprits.add('?' + d.message);
    if (code === 'E0373' && (m = /but it borrows `([^`]+)`/.exec(d.message))) per[idx].borrowed.add(m[1]);
  }
  return { per, stray };
}
// rustc prints std paths, lifetimes, `(dyn T + 'static)`, and (on 1.98.1) AtomicUsize as Atomic<usize>;
// the solver prints none of these
const ATOM = { bool: 'Bool', i8: 'I8', i16: 'I16', i32: 'I32', i64: 'I64', isize: 'Isize', u8: 'U8', u16: 'U16', u32: 'U32', u64: 'U64', usize: 'Usize' };
function norm(s) {
  let prev;
  s = s.replace(/\bstd::rc::Weak\b/g, 'rc::Weak').replace(/\bstd::sync::Weak\b/g, 'sync::Weak')
    .replace(/\b(?:std|core|alloc)::(?:[a-z_0-9]+::)*/g, '')
    .replace(/\s*\+\s*'static\b/g, '')
    .replace(/'[A-Za-z_]+\s*,\s*/g, '').replace(/&'[A-Za-z_]+\s+/g, '&')
    .replace(/\bAtomic<([a-z0-9]+)>/g, (m, t) => ATOM[t] ? 'Atomic' + ATOM[t] : m);
  for (let i = s.indexOf('(dyn '); i >= 0; i = s.indexOf('(dyn ')) {      // (dyn A + B) -> dyn A + B
    let d = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')' && --d === 0) break; }
    s = s.slice(0, i) + s.slice(i + 1, j) + s.slice(j + 1);
  }
  return s.replace(/\s+/g, ' ').trim();
}
function expect(res) {
  return { codes: new Set(res.codes), culprits: new Set((res.reported || []).map(l => norm(l.type) + '|' + l.trait)), borrowed: new Set(res.borrowed) };
}
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
// rustc shortens very long type names to `Outer<...>` (writing the full name to a file): `...` is a wildcard
function culpritsEq(want, real) {
  if (want.size !== real.size) return false;
  const left = new Set(want);
  for (const r of real) {
    let hit = left.has(r) ? r : null;
    if (!hit && r.includes('...')) {
      const re = new RegExp('^' + r.split('...').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      hit = [...left].find(w => re.test(w)) || null;
    }
    if (!hit) return false;
    left.delete(hit);
  }
  return true;
}
const fmt = (s) => '{' + [...s].sort().join(', ') + '}';

let mismatches = 0, total = 0;
const tally = { accepted: 0, E0277: 0, E0373: 0, E0521: 0 };
function compare(cases, got, label) {
  cases.forEach((c, i) => {
    const want = expect(c.res), real = got.per[i];
    total++;
    for (const k of real.codes) tally[k] = (tally[k] || 0) + 1;
    if (!real.codes.size) tally.accepted++;
    const ok = setEq(want.codes, real.codes) && culpritsEq(want.culprits, real.culprits) && setEq(want.borrowed, real.borrowed);
    if (!ok) {
      mismatches++;
      console.log(`  MISMATCH [${label}] ${c.src}\n     structs: ${c.structs.replace(/\n/g, ' | ') || '-'}\n` +
        `     rustc : codes ${fmt(real.codes)} culprits ${fmt(real.culprits)} borrowed ${fmt(real.borrowed)}\n` +
        `     engine: codes ${fmt(want.codes)} culprits ${fmt(want.culprits)} borrowed ${fmt(want.borrowed)}`);
    }
  });
  if (got.stray.length) { mismatches += got.stray.length; got.stray.forEach(s => console.log(`  [${label}] error outside any case: ${s}`)); }
}

/* ---------------- Part 1: the widget's presets x modes ---------------- */
const MODES = Object.keys(SS.MODES);
const p1 = [], p1lines = [], p1structs = [];
SS.PRESETS.forEach((p, pi) => {
  const st = p.structs.replace(/\bSession\b/g, 'Session' + pi), ty = p.type.replace(/\bSession\b/g, 'Session' + pi);
  if (st) p1structs.push(st);
  MODES.forEach(m => {
    const prog = SS.program(m, ty), src = SS.rust(prog, `p${pi}_${m.replace('-', '_')}`);
    p1.push({ prog, structs: st, res: SS.check(prog, st), src, preset: pi, mode: m }); p1lines.push(src);
  });
});
const g1 = compile('part1', p1structs.join('\n'), p1lines);
compare(p1, g1, 'preset');
console.log(`part 1  widget presets: ${SS.PRESETS.length} presets x ${MODES.length} modes = ${p1.length} programs`);

/* ---------------- Part 2: random programs ---------------- */
const S = genStructs('S', 14);
const p2 = [], p2lines = [];
for (let i = 0; i < NRAND; i++) {
  const r = rnd();
  let prog;
  if (r < 0.15) prog = { kind: rnd() < 0.5 ? 'send' : 'sync', move: false, caps: [{ name: 'v0', type: genType(3, { structs: S.list }), mode: 'val' }] };
  else {
    const kind = r < 0.62 ? 'spawn' : 'scope', n = 1 + Math.floor(rnd() * 3), caps = [];
    for (let k = 0; k < n; k++) caps.push({ name: 'v' + k, type: genType(3, { structs: S.list }), mode: pick(['val', 'ref', 'mut']) });
    prog = { kind, move: rnd() < 0.5, caps };
  }
  const src = SS.rust(prog, 'case' + i);
  p2.push({ prog, structs: S.text, res: SS.check(prog, S.text), src }); p2lines.push(src);
}
const g2 = compile('part2', S.text, p2lines);
compare(p2, g2, 'random');
console.log(`part 2  random programs: ${p2.length} (with ${S.list.length} random structs)`);

/* ---------------- Part 3: every complete repair must compile ---------------- */
const p3lines = [], p3structs = [], p3meta = [];
let proposed = 0, stopped = 0;
p1.concat(p2).forEach((c, i) => {
  if (c.res.ok || c.res.codes[0] === 'unknown') return;
  const fx = SS.repair(c.prog, c.structs);
  if (!fx.result.ok) { stopped++; return; }
  proposed++;
  const ren = (s) => s.replace(/\b(S\d+|Session\d*)\b/g, '$1_fix' + i);
  const prog = JSON.parse(JSON.stringify(fx.prog)); prog.caps.forEach(k => { k.type = ren(k.type); });
  p3structs.push(ren(fx.structs)); p3lines.push(SS.rust(prog, 'fixed' + i));
  p3meta.push({ from: c.src, steps: fx.steps.map(s => s.from + ' → ' + s.to).join('; ') });
});
const g3 = compile('part3', p3structs.filter(Boolean).join('\n'), p3lines);
let badFix = 0;
g3.per.forEach((r, i) => { if (r.codes.size) { badFix++; console.log(`  BAD REPAIR ${p3meta[i].from}\n     steps: ${p3meta[i].steps}\n     rustc: ${fmt(r.codes)} ${fmt(r.culprits)}`); } });
if (g3.stray.length) { badFix += g3.stray.length; g3.stray.forEach(s => console.log('  [repair] error outside any case: ' + s)); }
console.log(`part 3  repairs: ${proposed} complete repairs compiled, ${badFix} rejected; ${stopped} failures the engine calls unfixable by a type change`);

console.log(`\n${total} programs compared (${p1.length} preset + ${p2.length} random), ${mismatches} mismatches; ` +
  `rustc verdicts: accepted ${tally.accepted}, E0277 ${tally.E0277}, E0373 ${tally.E0373 || 0}, E0521 ${tally.E0521 || 0}; bad repairs ${badFix}`);
process.exit(mismatches || badFix ? 1 : 0);
