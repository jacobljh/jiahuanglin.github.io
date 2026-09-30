#!/usr/bin/env node
/* Differential fuzz: the MiniRust interpreter (MR.run) vs. a real rustc-compiled program.
 *
 *   node tools/rust_verify/drop_fuzz.js [programs=200] [seed=1] [--show N]
 *
 * Generates random *valid* programs full of `Drop`-printing values (moves, conditional moves, partial moves,
 * reassignment, shadowing, temporaries, `let _ =`, loops, early return, Vec of droppers, String capacity),
 * compiles them together into ONE crate (`fn p0() … fn pN()`), runs the binary, and compares its stdout,
 * program by program, with what the interpreter prints for the same body.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const MR = require(process.env.MR || path.join(__dirname, '../../all_lessons/rust/lessons/minirust.js'));
const N = +(process.argv[2] || 200), SEED = +(process.argv[3] || 1);
const SHOW = (() => { const i = process.argv.indexOf('--show'); return i > 0 ? +process.argv[i + 1] : 5; })();
let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)], chance = (p) => rnd() < p;
function wpick(pairs) { let t = 0; for (const [w] of pairs) t += w; let r = rnd() * t; for (const [w, v] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][1]; }

const ITEMS = `struct G { n: &'static str }
impl Drop for G { fn drop(&mut self) { println!("drop {}", self.n); } }
struct W { a: G, b: G }
struct D { g: G, k: usize }
impl Drop for D { fn drop(&mut self) { println!("drop D{}", self.k); } }
fn take(g: G) { println!("take {}", g.n); }
fn make(n: &'static str) -> G { G { n: n } }
fn pass(g: G) -> G { g }
fn two(a: G, b: G) { println!("two {} {}", a.n, b.n); }
fn early(flag: bool) -> G { let l = G { n: "L" }; if flag { return G { n: "E" }; } G { n: "N" } }
`;
const REAL_PRE = `#![allow(unused)]
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
static SEQ: AtomicU64 = AtomicU64::new(0);
static IDX: AtomicUsize = AtomicUsize::new(0);
fn reset(seq: u64) { SEQ.store(seq, Ordering::SeqCst); IDX.store(0, Ordering::SeqCst); }
fn cond() -> bool { let i = IDX.fetch_add(1, Ordering::SeqCst); (SEQ.load(Ordering::SeqCst) >> (i % 64)) & 1 == 1 }
`;

function genBody() {
  const lines = [];
  let vid = 0;
  const scopes = [[]];
  let inLoop = 0;
  const all = () => scopes.flat().filter(v => !v.shadowed);
  const ind = () => '    '.repeat(scopes.length);
  const emit = (s) => lines.push(ind() + s);
  const fresh = (p) => p + (vid++);
  const lab = () => '"L' + (vid++) + '"';
  const declare = (v) => { const sc = scopes[scopes.length - 1]; const old = sc.concat(...scopes).filter(o => o.name === v.name); old.forEach(o => { o.shadowed = true; }); sc.push(v); return v; };
  const live = (ty) => all().filter(v => v.ty === ty && v.st === 'live' && !(v.ty === 'W' && (v.pa || v.pb)) && (inLoop === 0 || v.depthLoop >= inLoop));
  const anyLive = (ty) => { const c = live(ty); return c.length ? pick(c) : null; };
  const anyMut = (ty) => { const c = live(ty).filter(v => v.mut); return c.length ? pick(c) : null; };
  const anyVar = (ty) => { const c = all().filter(v => v.ty === ty && (inLoop === 0 || v.depthLoop >= inLoop || v.st !== 'x')); return c.length ? pick(c) : null; };
  const mk = (name, ty, mut, extra) => declare(Object.assign({ name, ty, mut, st: 'live', pa: false, pb: false, len: null, depthLoop: inLoop }, extra || {}));
  // may `v` be moved / consumed here? (inside a loop only variables born inside the loop)
  const movable = (v) => inLoop === 0 || v.depthLoop >= inLoop;

  function gExpr(consume) {           // an expression of type G; may consume a G variable
    const opts = [[3, () => 'G { n: ' + lab() + ' }'], [2, () => 'make(' + lab() + ')']];
    const g = consume ? live('G').filter(movable) : [];
    if (g.length) { opts.push([4, () => { const v = pick(g); v.st = 'moved'; return v.name; }]); opts.push([2, () => { const v = pick(g); v.st = 'moved'; return 'pass(' + v.name + ')'; }]); }
    return wpick(opts)();
  }
  function stmt(depth) {
    const kinds = [];
    kinds.push([5, 'letG'], [2, 'letMake'], [1, 'mark'], [1, 'discardLet'], [1, 'tempExpr']);
    if (live('G').filter(movable).length) kinds.push([5, 'moveLet'], [3, 'take'], [2, 'drop'], [1, 'forget'], [2, 'passLet'], [1, 'two'], [2, 'wrap']);
    if (anyMut('G')) kinds.push([3, 'reassign']);
    if (all().some(v => v.ty === 'G' && v.st !== 'live' && v.mut && !v.shadowed) ) kinds.push([1, 'reinit']);
    if (all().some(v => v.ty === 'W' && v.st === 'live' && !v.pa && !v.pb && movable(v))) kinds.push([3, 'partial']);
    if (all().some(v => v.ty === 'W' && v.st === 'live' && (v.pa !== v.pb) && movable(v))) kinds.push([3, 'restField']);
    if (live('G').filter(movable).length) kinds.push([2, 'wrapD']);
    if (anyLive('G')) kinds.push([1, 'letUnderscore']);
    kinds.push([2, 'vecLet']);
    if (all().some(v => v.ty === 'V' && v.st === 'live' && v.mut)) kinds.push([2, 'vecOp']);
    kinds.push([2, 'strStuff']);
    if (all().some(v => v.name && v.shadowable)) kinds.push([1, 'shadow']);
    if (depth < 2) kinds.push([3, 'block'], [3, 'if'], [2, 'for'], [1, 'while']);
    if (depth < 2 && inLoop === 0) kinds.push([1, 'earlyRet']);
    if (inLoop > 0) kinds.push([1, 'brk']);
    const k = wpick(kinds);
    switch (k) {
      case 'letG': { const n = fresh('g'), m = chance(0.5); emit('let ' + (m ? 'mut ' : '') + n + ' = G { n: ' + lab() + ' };'); mk(n, 'G', m, { shadowable: true }); break; }
      case 'letMake': { const n = fresh('g'), m = chance(0.4); emit('let ' + (m ? 'mut ' : '') + n + ' = make(' + lab() + ');'); mk(n, 'G', m, { shadowable: true }); break; }
      case 'mark': emit('println!("mark {}", ' + ri(100) + ');'); break;
      case 'discardLet': emit('let _ = G { n: ' + lab() + ' };'); break;
      case 'tempExpr': emit(pick(['G { n: ' + lab() + ' };', 'make(' + lab() + ');', 'println!("len {}", make(' + lab() + ').n.len());'])); break;
      case 'moveLet': { const v = pick(live('G').filter(movable)); const n = fresh('g'), m = chance(0.5); emit('let ' + (m ? 'mut ' : '') + n + ' = ' + v.name + ';'); v.st = 'moved'; mk(n, 'G', m, { shadowable: true }); break; }
      case 'take': { const v = pick(live('G').filter(movable)); emit('take(' + v.name + ');'); v.st = 'moved'; break; }
      case 'drop': { const v = pick(live('G').filter(movable)); emit('drop(' + v.name + ');'); v.st = 'moved'; break; }
      case 'forget': { const v = pick(live('G').filter(movable)); emit('std::mem::forget(' + v.name + ');'); v.st = 'moved'; break; }
      case 'passLet': { const v = pick(live('G').filter(movable)); const n = fresh('g'); emit('let ' + n + ' = pass(' + v.name + ');'); v.st = 'moved'; mk(n, 'G', false, { shadowable: true }); break; }
      case 'two': { const a = pick(live('G').filter(movable)); a.st = 'moved'; const b = wpick([[2, () => gExpr(true)], [1, () => 'G { n: ' + lab() + ' }']])(); emit('two(' + a.name + ', ' + b + ');'); break; }
      case 'wrap': { const a = gExpr(true), b = gExpr(true); const n = fresh('w'), m = chance(0.5); emit('let ' + (m ? 'mut ' : '') + n + ' = W { a: ' + a + ', b: ' + b + ' };'); mk(n, 'W', m); break; }
      case 'wrapD': { const a = gExpr(true); const n = fresh('d'); emit('let ' + n + ' = D { g: ' + a + ', k: ' + ri(9) + ' };'); mk(n, 'D', false); break; }
      case 'reassign': { const v = anyMut('G'); if (!v) break; const e = gExpr(true); emit(v.name + ' = ' + e + ';'); break; }
      case 'reinit': { const c = all().filter(v => v.ty === 'G' && v.st !== 'live' && v.mut && movableLoop(v)); if (!c.length) break; const v = pick(c); emit(v.name + ' = G { n: ' + lab() + ' };'); v.st = 'live'; break; }
      case 'partial': { const c = all().filter(v => v.ty === 'W' && v.st === 'live' && !v.pa && !v.pb && movable(v)); const w = pick(c); const f = pick(['a', 'b']); const n = fresh('g'); emit('let ' + n + ' = ' + w.name + '.' + f + ';'); if (f === 'a') w.pa = true; else w.pb = true; mk(n, 'G', false, { shadowable: true }); break; }
      case 'restField': { const c = all().filter(v => v.ty === 'W' && v.st === 'live' && (v.pa !== v.pb) && movable(v)); const w = pick(c); const f = w.pa ? 'b' : 'a'; const n = fresh('g'); emit('let ' + n + ' = ' + w.name + '.' + f + ';'); w.pa = w.pb = true; mk(n, 'G', false, { shadowable: true }); break; }
      case 'letUnderscore': { const v = anyLive('G'); emit('let _ = ' + v.name + ';'); break; }
      case 'vecLet': { const n = fresh('v'), m = true; const cnt = ri(4);
        if (chance(0.25)) { const wc = ri(7); emit('let mut ' + n + ': Vec<G> = Vec::with_capacity(' + wc + ');'); mk(n, 'V', m, { len: 0 }); break; } const items = []; for (let i = 0; i < cnt; i++) items.push('G { n: ' + lab() + ' }'); emit('let mut ' + n + (cnt ? '' : ': Vec<G>') + ' = ' + (cnt ? 'vec![' + items.join(', ') + ']' : 'Vec::new()') + ';'); mk(n, 'V', m, { len: cnt }); break; }
      case 'vecOp': {
        const v = pick(all().filter(v => v.ty === 'V' && v.st === 'live' && v.mut));
        const ops = ['push', 'push', 'clear', 'cap', 'cap'];
        if (v.len !== null && v.len > 0 && (inLoop === 0 || v.depthLoop >= inLoop)) ops.push('remove');
        if (live('G').filter(movable).length) ops.push('pushvar');
        const o = pick(ops);
        if (o === 'push') { emit(v.name + '.push(G { n: ' + lab() + ' });'); v.len = v.len === null ? null : v.len + 1; }
        else if (o === 'pushvar') { const g = pick(live('G').filter(movable)); emit(v.name + '.push(' + g.name + ');'); g.st = 'moved'; v.len = v.len === null ? null : v.len + 1; }
        else if (o === 'clear') { emit(v.name + '.clear();'); v.len = 0; }
        else if (o === 'cap') { emit('println!("{} {}", ' + v.name + '.len(), ' + v.name + '.capacity());'); }
        else { const n = fresh('g'); emit('let ' + n + ' = ' + v.name + '.remove(0);'); v.len -= 1; mk(n, 'G', false, { shadowable: true }); }
        if (inLoop > 0 || v.condTouched) v.len = null;
        break;
      }
      case 'strStuff': {
        const n = fresh('s');
        const lit = pick(['', 'a', 'ab', 'hello', 'x'.repeat(9)]);
        emit('let mut ' + n + ' = ' + pick(['String::new()', 'String::from("' + lit + '")']) + ';');
        const ops = 1 + ri(3);
        for (let i = 0; i < ops; i++) emit(n + '.push_str("' + pick(['a', 'bc', 'defgh', 'x'.repeat(11)]) + '");');
        emit('println!("{} {}", ' + n + '.len(), ' + n + '.capacity());');
        if (chance(0.4)) { const c = fresh('s'); emit('let ' + c + ' = ' + n + '.clone();'); emit('println!("{} {}", ' + c + '.len(), ' + c + '.capacity());'); }
        break;
      }
      case 'shadow': { const c = all().filter(v => v.shadowable && v.ty === 'G'); if (!c.length) break; const v = pick(c); emit('let ' + v.name + ' = G { n: ' + lab() + ' };'); mk(v.name, 'G', false, { shadowable: true }); break; }
      case 'block': { emit('{'); scopes.push([]); const n = 1 + ri(3); for (let i = 0; i < n; i++) stmt(depth + 1); scopes.pop(); emit('}'); break; }
      case 'if': {
        const outer = all().filter(v => v.ty !== 'S');
        const snap = () => outer.map(v => ({ v, st: v.st, pa: v.pa, pb: v.pb, len: v.len }));
        const restore = (s) => s.forEach(o => { o.v.st = o.st; o.v.pa = o.pa; o.v.pb = o.pb; o.v.len = o.len; });
        const s0 = snap();
        emit('if cond() {'); scopes.push([]); const n1 = 1 + ri(2); for (let i = 0; i < n1; i++) stmt(depth + 1); scopes.pop();
        const s1 = snap(); restore(s0);
        let s2 = s0;
        const hasElse = chance(0.5);
        if (hasElse) { emit('} else {'); scopes.push([]); const n2 = 1 + ri(2); for (let i = 0; i < n2; i++) stmt(depth + 1); scopes.pop(); s2 = snap(); restore(s0); }
        emit('}');
        // merge: equal states stay; differing states become 'maybe' (a drop flag decides at run time)
        outer.forEach((v, i) => {
          const a = s1[i], b = s2[i];
          if (a.st === b.st && a.pa === b.pa && a.pb === b.pb) { v.st = a.st; v.pa = a.pa; v.pb = a.pb; }
          else { v.st = 'maybe'; v.pa = v.pb = false; }
          v.len = a.len === b.len ? a.len : null;
          if (v.st === 'maybe' || v.len === null) v.condTouched = true;
        });
        break;
      }
      case 'for': {
        emit('for i' + (vid++) + ' in 0..' + (1 + ri(3)) + ' {'); scopes.push([]); inLoop++;
        const n = 1 + ri(3); for (let i = 0; i < n; i++) stmt(depth + 1);
        inLoop--; scopes.pop(); emit('}'); bumpLoopLens(); break;
      }
      case 'while': {
        emit('while cond() {'); scopes.push([]); inLoop++;
        const n = 1 + ri(3); for (let i = 0; i < n; i++) stmt(depth + 1);
        inLoop--; scopes.pop(); emit('}'); bumpLoopLens(); break;
      }
      case 'earlyRet': { emit('if cond() {'); scopes.push([]); emit('    println!("early");'); scopes.pop(); emit('    return;'); emit('}'); break; }
      case 'brk': emit('if cond() { ' + pick(['break', 'continue']) + '; }'); break;
    }
  }
  function movableLoop(v) { return inLoop === 0 || v.depthLoop >= inLoop; }
  function bumpLoopLens() { all().forEach(v => { if (v.ty === 'V') v.len = null; }); }
  const n = 4 + ri(9);
  for (let i = 0; i < n; i++) stmt(0);
  return lines;
}

/* ─────────── harness ─────────── */
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrdrop_'));
function compileAndRun(progs) {
  // compile each program alone the first time: a rejected one must not sink the batch
  const src = [REAL_PRE + ITEMS];
  progs.forEach((p, i) => { src.push('fn p' + i + '() {\n    reset(' + p.seq + 'u64);\n' + p.body.join('\n') + '\n}'); });
  src.push('fn main() {\n' + progs.map((p, i) => '    println!("=== p' + i + '");\n    p' + i + '();').join('\n') + '\n}');
  const file = path.join(tmp, 'all.rs');
  fs.writeFileSync(file, src.join('\n') + '\n');
  const r = cp.spawnSync(rustc, ['--edition', '2024', '-A', 'warnings', '--error-format=json', '-o', path.join(tmp, 'all.bin'), file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const errs = [];
  for (const ln of r.stderr.split('\n')) { let d; try { d = JSON.parse(ln); } catch (e) { continue; } if (d.level === 'error' && !/^aborting/.test(d.message)) errs.push({ msg: d.message, line: (d.spans.find(s => s.is_primary) || d.spans[0] || {}).line_start || 0, code: d.code && d.code.code, rendered: d.rendered }); }
  return { file, errs, ok: r.status === 0, bin: path.join(tmp, 'all.bin'), startLine: (REAL_PRE + ITEMS).split('\n').length };
}

let progs = [];
for (let i = 0; i < N; i++) { const body = genBody(); let seqLo = (Math.floor(rnd() * 4294967296)), seqHi = Math.floor(rnd() * 4294967296); progs.push({ body, seqLo, seqHi, seq: '0x' + seqHi.toString(16).padStart(8, '0') + seqLo.toString(16).padStart(8, '0') }); }

// find programs rustc rejects (generator bugs) and remove them, iterating
let rejected = 0, shownRej = 0;
for (let round = 0; round < 6; round++) {
  const c = compileAndRun(progs);
  if (c.ok) { c.bad = []; break; }
  // map error lines to programs
  const starts = []; let line = c.startLine + 1;
  progs.forEach((p) => { starts.push(line); line += p.body.length + 3; });
  const badIdx = new Set();
  c.errs.forEach(e => { let k = -1; for (let i = 0; i < starts.length; i++) if (e.line >= starts[i]) k = i; if (k >= 0 && e.line < starts[k] + progs[k].body.length + 3) badIdx.add(k); });
  if (!badIdx.size) { console.log('rustc failed but no program was blamed:'); c.errs.slice(0, 3).forEach(e => console.log(e.rendered || e.msg)); process.exit(2); }
  badIdx.forEach(k => { rejected++; if (shownRej < 3) { shownRej++; console.log('generator produced a program rustc rejects:\n' + progs[k].body.map((l, j) => String(j + 1).padStart(3) + ' ' + l).join('\n')); c.errs.filter(e => e.line >= starts[k] && e.line < starts[k] + progs[k].body.length + 3).slice(0, 2).forEach(e => console.log('  ' + e.msg + '  @' + (e.line - starts[k] - 1))); } });
  progs = progs.filter((_, i) => !badIdx.has(i));
}
const fin = compileAndRun(progs);
if (!fin.ok) { console.log('final compile failed'); fin.errs.slice(0, 3).forEach(e => console.log(e.rendered || e.msg)); process.exit(2); }
const run = cp.spawnSync(fin.bin, [], { encoding: 'utf8', maxBuffer: 1 << 28 });
const real = {};
let cur = null;
run.stdout.split('\n').forEach(l => { const m = /^=== p(\d+)$/.exec(l); if (m) { cur = +m[1]; real[cur] = []; } else if (cur !== null && l !== '') real[cur].push(l); });

let bad = 0, shown = 0, evTotal = 0;
progs.forEach((p, i) => {
  const mini = ITEMS + 'fn main() {\n' + p.body.join('\n') + '\n}\n';
  const conds = []; for (let b = 0; b < 64; b++) conds.push(((b < 32 ? p.seqLo >>> b : p.seqHi >>> (b - 32)) & 1) === 1);
  let res;
  try { res = MR.run(mini, { conds, maxEvents: 100000, fuel: 2000000, snapshots: false }); } catch (e) { res = { out: ['CRASH ' + e.message], error: { msg: e.stack } }; }
  evTotal += res.events ? res.events.length : 0;
  const a = real[i] || [], b = res.out;
  const same = a.length === b.length && a.every((x, j) => x === b[j]) && !res.error;
  if (!same) {
    bad++;
    if (shown < SHOW) {
      shown++;
      console.log('\n──── MISMATCH (p' + i + ') ────');
      p.body.forEach((l, j) => console.log(String(j + 1).padStart(3) + '  ' + l));
      console.log('cond bits: ' + conds.slice(0, 12).map(b => b ? 1 : 0).join(''));
      const m = Math.max(a.length, b.length);
      for (let j = 0; j < m; j++) console.log((a[j] === b[j] ? '   ' : ' ! ') + String(a[j] === undefined ? '' : a[j]).padEnd(24) + ' | ' + (b[j] === undefined ? '' : b[j]));
      if (res.error) console.log('interpreter error:', res.error.msg);
    }
  }
});
console.log('\n' + (progs.length - bad) + '/' + progs.length + ' programs agree with rustc (' + bad + ' mismatches; ' + rejected + ' generated programs were rejected by rustc and dropped; ' + evTotal + ' interpreter events)');
process.exit(bad ? 1 : 0);
