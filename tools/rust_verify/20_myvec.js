#!/usr/bin/env node
/* Oracle for Lesson 20's widget: all_lessons/rust/lessons/myvec.js
 *
 *   node tools/rust_verify/20_myvec.js [scripts=500] [perMutant=300] [seed=20]
 *
 * Part 1 (rustc, run): the lesson's MyVec — the two Rust blocks #s-myvec and #s-myvec-rest, extracted from
 *   20_safe_abstraction.html and pasted unchanged — is compiled with rustc (edition 2024) together with a
 *   harness that runs every script against MyVec<Item> AND std::Vec<Item> side by side (each clone under
 *   catch_unwind; Item counts its own clones and drops). After every operation the program prints both
 *   contents, len, MyVec's cap and both results; at the end, how many Items are still alive or were
 *   dropped twice. Required: MyVec == std::Vec everywhere, nothing leaked or dropped twice, and the model
 *   (MyVec.run, mutant "correct") predicts every line: contents, len, cap and result.
 * Part 2 (model): on the same scripts, the correct model reports no broken invariant, no UB and no leak.
 * Part 3 (mutants): the mutants are real UB, so rustc cannot run them. Each is judged instead by REF below,
 *   a reference interpreter written separately from myvec.js in a different style (flat addresses instead
 *   of per-allocation slots, no ownership states: a value is only "dropped or not", and a mutant is judged
 *   by its OUTCOME: UB, a leak, or a result that differs from std::Vec). The model flags a script when an
 *   invariant breaks, UB happens or something leaks. Required, per mutant: flagged on at least one script,
 *   and flagged <=> REF says mishandled, on every script.
 * Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const MV = require(path.join(ROOT, 'all_lessons/rust/lessons/myvec.js'));
const N = +(process.argv[2] || 500), PER = +(process.argv[3] || 300), SEED = +(process.argv[4] || 20);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const irand = (n) => Math.floor(rnd() * n);

/* ───────── the Rust source, straight from the lesson ───────── */
function block(html, id) {
  const m = new RegExp('<pre id="' + id + '"[^>]*><code>([\\s\\S]*?)</code></pre>').exec(html);
  if (!m) throw new Error('lesson has no <pre id="' + id + '">');
  return m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
const html = fs.readFileSync(path.join(ROOT, 'all_lessons/rust/lessons/20_safe_abstraction.html'), 'utf8');
const core = block(html, 's-myvec'), rest = block(html, 's-myvec-rest');
const coreNoMain = core.slice(0, core.search(/^fn main\(\)/m));
if (coreNoMain.length === core.length) throw new Error('#s-myvec has no fn main to strip');

/* ───────── scripts ───────── */
const VALS = 'abcdefgh';
function randomScript(opts) {
  const ops = [], n = 3 + irand(12);
  let len = 0, setlen = false;                          // len as the correct MyVec (= std::Vec) sees it
  for (let k = 0; k < n; k++) {
    const r = rnd(), x = rnd() < (opts.bang || 0.08) ? '!' : VALS[irand(VALS.length)];
    if (opts.setlen && !setlen && rnd() < 0.18) { ops.push({ k: 'setlen', i: Math.max(0, len - 2 + irand(6)) }); setlen = true; continue; }
    if (r < 0.34 || len === 0 && r < 0.6) { ops.push({ k: 'push', x }); len++; }
    else if (r < 0.46) { ops.push({ k: 'pop' }); if (len) len--; }
    else if (r < 0.62) { ops.push({ k: 'insert', i: irand(len + 1), x }); len++; }
    else if (r < 0.72 && len) { ops.push({ k: 'remove', i: irand(len) }); len--; }
    else if (r < 0.80) { const t = irand(len + 2); ops.push({ k: 'truncate', i: t }); len = Math.min(len, t); }
    else ops.push({ k: 'clone' });
  }
  return ops;
}
const txt = (ops) => ops.map(MV.opText).join('; ');

/* ───────── std::Vec semantics (for REF) ───────── */
function stdRun(ops) {
  const a = [], res = [];
  for (const o of ops) {
    if (o.k === 'push') { a.push(o.x); res.push(''); }
    else if (o.k === 'pop') res.push(a.length ? a.pop() : '-');
    else if (o.k === 'insert') { if (o.i > a.length) res.push('panic'); else { a.splice(o.i, 0, o.x); res.push(''); } }
    else if (o.k === 'remove') res.push(o.i < a.length ? a.splice(o.i, 1)[0] : 'panic');
    else if (o.k === 'truncate') { if (a.length > o.i) a.length = o.i; res.push(''); }
    else if (o.k === 'clone') res.push(a.indexOf('!') >= 0 ? 'panic' : a.join(''));
    else res.push('');                                   // `v.len = k` has no std::Vec meaning: it must change nothing
  }
  return { res, fin: a.join('') };
}

/* ───────── REF: an independent reference interpreter of the lesson's Rust, one mutant at a time ─────────
 * Memory is flat: an address is base + index, bases are 1000 apart, the dangling pointer is 8 (inside no
 * allocation). A cell holds a value object or nothing. ptr::read copies the object reference (bits) and
 * changes nothing; drop marks the object dropped; dropping it again, or reading a dropped one, is UB. */
function REF(ops, mut) {
  const allocs = [], mem = new Map(), vals = [];
  let ub = null, pops = 0;
  const UB = (why) => { ub = ub || why; throw UB; };
  const home = (addr) => allocs.find((a) => addr >= a.base && addr < a.base + a.n);
  const touch = (addr) => { const a = home(addr); if (!a) UB('no allocation at ' + addr); if (a.freed) UB('access to freed ' + addr); return a; };
  const alloc = (n) => { const base = 1000 * (allocs.length + 1); allocs.push({ base, n, freed: false }); return base; };
  const dealloc = (p) => { const a = allocs.find((x) => x.base === p); if (!a) UB('free of a pointer never allocated'); if (a.freed) UB('double free of ' + p); a.freed = true; };
  const wr = (addr, val) => { touch(addr); mem.set(addr, val); };
  const rd = (addr) => { touch(addr); const val = mem.get(addr); if (!val) UB('read of uninitialized ' + addr); if (val.dropped) UB('read of dropped ' + val.name); return val; };
  const memmove = (src, dst, n) => { const t = []; for (let i = 0; i < n; i++) { touch(src + i); t.push(mem.get(src + i)); } for (let i = 0; i < n; i++) { touch(dst + i); mem.set(dst + i, t[i]); } };
  const kill = (val) => { if (val.dropped) UB('double drop of ' + val.name); val.dropped = true; };
  const make = (name) => { const val = { name, dropped: false }; vals.push(val); return val; };
  const DANGLING = 8;
  class Vec {
    constructor() { this.ptr = DANGLING; this.cap = 0; this.len = 0; }                  // MyVec::new
    growTo(nc) {                                                                          // grow_to
      const np = alloc(nc);
      if (this.cap !== 0) { if (mut !== 'nocopy') memmove(this.ptr, np, this.len); dealloc(this.ptr); }
      this.ptr = np; this.cap = nc;
    }
    grow() { this.growTo(this.cap === 0 ? 1 : 2 * this.cap); }
    push(x) {
      if (mut !== 'nogrow' && this.len === this.cap) this.grow();
      if (mut === 'lenfirst') { this.len += 1; wr(this.ptr + this.len - 1, x); } else { wr(this.ptr + this.len, x); this.len += 1; }
    }
    pop() {
      if (this.len === 0) return null;
      pops++;
      if (mut === 'popkeep') return rd(this.ptr + this.len - 1);
      this.len -= 1; return rd(this.ptr + this.len);
    }
    slice() {                                                                             // Deref
      if (this.len === 0) return [];
      const a = home(this.ptr);
      if (!a || a.freed || this.ptr + this.len > a.base + a.n) UB('slice outside a live allocation');
      const out = []; for (let i = 0; i < this.len; i++) out.push(this.ptr + i); return out;
    }
    insert(i, x) {
      if (i > this.len) { kill(x); throw 'panic'; }
      if (this.len === this.cap) this.grow();
      memmove(this.ptr + i, this.ptr + i + 1, this.len - i + (mut === 'shift1' ? 1 : 0));
      wr(this.ptr + i, x); this.len += 1;
    }
    remove(i) {
      if (i >= this.len) throw 'panic';
      this.len -= 1; const x = rd(this.ptr + i); memmove(this.ptr + i + 1, this.ptr + i, this.len - i); return x;
    }
    truncate(n) { while (this.len > n) { const x = this.pop(); if (x) kill(x); } }
    clone() {
      if (mut === 'shallow') { const c = new Vec(); c.ptr = this.ptr; c.cap = this.cap; c.len = this.len; return c; }
      const out = new Vec();
      if (this.len > 0) out.growTo(this.len);
      for (const addr of this.slice()) {
        const x = rd(addr);
        if (mut === 'lenfirst') out.len += 1;
        if (x.name === '!') { out.drop(); throw 'panic'; }                               // unwinding drops `out`
        const y = make(x.name);
        if (mut === 'lenfirst') wr(out.ptr + out.len - 1, y); else { wr(out.ptr + out.len, y); out.len += 1; }
      }
      return out;
    }
    drop() {
      for (let x; (x = this.pop());) kill(x);
      if (mut !== 'nofree' && this.cap !== 0) dealloc(this.ptr);
    }
  }
  const res = [];
  let fin = '';
  try {
    const v = new Vec();
    for (const o of ops) {
      try {
        if (o.k === 'push') { v.push(make(o.x)); res.push(''); }
        else if (o.k === 'pop') { const x = v.pop(); if (x) kill(x); res.push(x ? x.name : '-'); }
        else if (o.k === 'insert') { v.insert(o.i, make(o.x)); res.push(''); }
        else if (o.k === 'remove') { const x = v.remove(o.i); kill(x); res.push(x.name); }
        else if (o.k === 'truncate') { v.truncate(o.i); res.push(''); }
        else if (o.k === 'clone') { const c = v.clone(); const s = c.slice().map((a) => rd(a).name).join(''); c.drop(); res.push(s); }
        else if (o.k === 'setlen') { if (mut === 'publen') v.len = o.i; res.push(''); }   // private len: the line does not compile
      } catch (e) { if (e === 'panic') res.push('panic'); else throw e; }
    }
    fin = v.slice().map((a) => rd(a).name).join('');
    v.drop();
  } catch (e) { if (e !== UB) throw e; }
  const leak = !ub && (allocs.some((a) => !a.freed) || vals.some((x) => !x.dropped));
  return { ub, leak, res, fin, pops, allocs: allocs.length };
}
function mishandled(ops, mut) {
  const r = REF(ops, mut), s = stdRun(ops);
  if (r.ub) return 'UB: ' + r.ub;
  if (r.leak) return 'leak';
  if (r.res.join('|') !== s.res.join('|') || r.fin !== s.fin) return 'results differ from std::Vec';
  return '';
}

/* ───────── the lesson's "silent unless" column, as conditions on the CORRECT run ─────────
 * Until its first trigger a mutant runs exactly like the correct MyVec, so each condition is read off the
 * correct model's states (before each operation) or REF's counters; part 3 checks condition <=> flagged. */
function triggers(ops) {
  const R = MV.run(ops, 'correct'), fr = R.frames, ref = REF(ops, 'correct');
  const t = { nogrow: false, nocopy: false, lenfirst: false, popkeep: ref.pops > 0, nofree: ref.allocs > 0, shallow: false, shift1: false, publen: false };
  ops.forEach((o, k) => {
    const b = fr[k].v, grows = b.len === b.cap, capAtShift = grows ? (b.cap ? 2 * b.cap : 1) : b.cap;
    if (o.k === 'push' && grows) t.nogrow = true;                                   // a push meets len == cap
    if ((o.k === 'push' || o.k === 'insert' && o.i <= b.len) && grows && b.len > 0) t.nocopy = true;  // grows while holding values
    if (o.k === 'clone' && R.results[k] === 'panic') t.lenfirst = true;             // an element's clone() panics
    if (o.k === 'clone' && b.cap > 0) t.shallow = true;                             // the cloned vector has a buffer
    if (o.k === 'insert' && o.i <= b.len && b.len + 1 === capAtShift) t.shift1 = true; // exactly one spare slot at the shift
    if (o.k === 'setlen' && o.i !== b.len) t.publen = true;                         // a caller writes a different len
  });
  return t;
}

/* ───────── Part 1: rustc runs MyVec against std::Vec ───────── */
const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const scripts = MV.PRESETS.filter((p) => p.script.indexOf('len =') < 0).map((p) => MV.parse(p.script).ops);
for (let i = 0; i < N; i++) scripts.push(randomScript({}));
const rop = (o) => o.k === 'push' ? `Push('${o.x}')` : o.k === 'pop' ? 'Pop' : o.k === 'insert' ? `Insert(${o.i}, '${o.x}')`
  : o.k === 'remove' ? `Remove(${o.i})` : o.k === 'truncate' ? `Truncate(${o.i})` : 'Dup';
const harness = `
// ───── harness (not part of the lesson) ─────
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
thread_local! { static LIVE: RefCell<HashSet<u64>> = RefCell::new(HashSet::new()); static NEXT: Cell<u64> = Cell::new(0); static TWICE: Cell<u64> = Cell::new(0); }
struct Item { name: char, id: u64 }
impl Item { fn new(name: char) -> Item { let id = NEXT.with(|n| { let v = n.get(); n.set(v + 1); v }); LIVE.with(|l| l.borrow_mut().insert(id)); Item { name, id } } }
impl Clone for Item { fn clone(&self) -> Item { if self.name == '!' { panic!("clone of !"); } Item::new(self.name) } }
impl Drop for Item { fn drop(&mut self) { if !LIVE.with(|l| l.borrow_mut().remove(&self.id)) { TWICE.with(|t| t.set(t.get() + 1)); } } }
impl<T> MyVec<T> { fn cap_for_the_oracle(&self) -> usize { self.cap } }
fn names(s: &[Item]) -> String { s.iter().map(|i| i.name).collect() }
fn opt(x: Option<Item>) -> String { x.map(|i| i.name.to_string()).unwrap_or_else(|| "-".into()) }
enum Op { Push(char), Pop, Insert(usize, char), Remove(usize), Truncate(usize), Dup }
use Op::*;
fn run(ops: &[Op]) {
    let mut mine: MyVec<Item> = MyVec::new();
    let mut theirs: Vec<Item> = Vec::new();
    for op in ops {
        let (a, b) = match op {
            Push(c) => { mine.push(Item::new(*c)); theirs.push(Item::new(*c)); (String::new(), String::new()) }
            Pop => (opt(mine.pop()), opt(theirs.pop())),
            Insert(i, c) => { mine.insert(*i, Item::new(*c)); theirs.insert(*i, Item::new(*c)); (String::new(), String::new()) }
            Remove(i) => (mine.remove(*i).name.to_string(), theirs.remove(*i).name.to_string()),
            Truncate(n) => { mine.truncate(*n); theirs.truncate(*n); (String::new(), String::new()) }
            Dup => {
                let a = match catch_unwind(AssertUnwindSafe(|| mine.clone())) { Ok(c) => names(&c), Err(_) => "panic".into() };
                let b = match catch_unwind(AssertUnwindSafe(|| theirs.clone())) { Ok(c) => names(&c), Err(_) => "panic".into() };
                (a, b)
            }
        };
        println!("{}|{}|{}|{}|{}|{}|{}", names(&mine), mine.len(), mine.cap_for_the_oracle(), names(&theirs), theirs.len(), a, b);
    }
    drop(mine); drop(theirs);
    println!("end live={} twice={}", LIVE.with(|l| l.borrow().len()), TWICE.with(|t| t.get()));
}
fn main() {
    std::panic::set_hook(Box::new(|_| {}));
${scripts.map((ops, i) => `    println!("case ${i}"); run(&[${ops.map(rop).join(', ')}]);`).join('\n')}
}
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'myvec20_'));
const src = path.join(tmp, 'myvec.rs'), exe = path.join(tmp, 'myvec');
fs.writeFileSync(src, coreNoMain + '\n' + rest + '\n' + harness);
const cr = cp.spawnSync(rustc, ['--edition', '2024', '--cap-lints', 'allow', '-C', 'opt-level=0', '-C', 'debuginfo=0', '-o', exe, src], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (cr.status !== 0) { console.log('the MyVec program did not compile:\n' + cr.stderr.split('\n').slice(0, 30).join('\n')); process.exit(1); }
const rr = cp.spawnSync(exe, [], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 120000 });
const got = {}; let cur = null;
(rr.stdout || '').split('\n').forEach((ln) => { const m = /^case (\d+)$/.exec(ln); if (m) { cur = +m[1]; got[cur] = []; } else if (cur !== null && ln) got[cur].push(ln); });
let mism = 0, cases = 0, lines = 0, clonesPanicked = 0, grows = 0;
scripts.forEach((ops, i) => {
  cases++;
  const have = got[i] || [], run = MV.run(ops, 'correct');
  const want = ops.map((o, k) => {
    const f = run.frames[k + 1], v = f.v, s = v.cells.slice(0, v.len).map((c) => c.name).join('');
    return [s, v.len, v.cap, run.results[k]];
  });
  let bad = have.length !== ops.length + 1 || have[ops.length] !== 'end live=0 twice=0';
  for (let k = 0; k < ops.length && !bad; k++) {
    const p = have[k].split('|');                         // mine names | len | cap | std names | len | res mine | res std
    lines++;
    if (p[0] !== p[3] || p[1] !== p[4] || p[5] !== p[6]) bad = 'MyVec and std::Vec disagree';
    else if (p[0] !== want[k][0] || +p[1] !== want[k][1] || +p[2] !== want[k][2] || p[5] !== want[k][3]) bad = 'model disagrees with rustc';
    if (p[5] === 'panic') clonesPanicked++;
  }
  run.frames.forEach((f) => f.ev.forEach((e) => { if (/grow/.test(e)) grows++; }));
  if (bad) { mism++; console.log(`MISMATCH (run) case ${i}: ${bad === true ? 'wrong line count or leaked/double-dropped Items' : bad}\n  script: ${txt(ops)}\n  rustc: ${have.join(' / ')}\n  model: ${want.map((w) => w.join('|')).join(' / ')}`); }
});
console.log(`part 1  rustc: ${scripts.length} scripts (${scripts.length - N} presets + ${N} random), ${lines} operations: MyVec == std::Vec and == the model on every line,`);
console.log(`        ${clonesPanicked} clones panicked mid-copy, ${grows} growths; every Item dropped exactly once` + (mism ? ` — EXCEPT ${mism} scripts` : ''));

/* ───────── Part 2: the correct model reports nothing ───────── */
let m2 = 0;
scripts.forEach((ops) => { cases++; const r = MV.run(ops, 'correct'); if (r.flagged || mishandled(ops, 'correct')) { m2++; console.log(`MISMATCH (correct) ${txt(ops)}: model ${JSON.stringify(r.firstBad || r.firstUB || r.leaks)} / REF ${mishandled(ops, 'correct')}`); } });
mism += m2;
console.log(`part 2  correct model on the same ${scripts.length} scripts: ${scripts.length - m2} clean (no broken invariant, no UB, no leak), ${m2} flagged`);

/* ───────── Part 3: every mutant, model vs REF ───────── */
console.log('part 3  mutants (model flags <=> REF finds UB, a leak or a result std::Vec would not give):');
for (const mu of MV.MUTANTS.filter((x) => x.id !== 'correct')) {
  const set = MV.PRESETS.filter((p) => p.mutant === mu.id || p.script.indexOf('len =') < 0).map((p) => MV.parse(p.script).ops)
    .filter((ops) => mu.id === 'publen' || !ops.some((o) => o.k === 'setlen'));
  while (set.length < PER) set.push(randomScript({ setlen: mu.id === 'publen', bang: mu.id === 'lenfirst' ? 0.12 : 0.08 }));
  let flagged = 0, bad = 0, silent = 0;
  const kinds = {};
  set.forEach((ops) => {
    cases++;
    const r = MV.run(ops, mu.id), why = mishandled(ops, mu.id);
    if (!!r.flagged !== triggers(ops)[mu.id]) {
      silent++;
      if (silent <= 3) console.log(`  MISMATCH ${mu.id} (the lesson's "silent unless" column): ${txt(ops)}: flagged=${r.flagged}, condition=${triggers(ops)[mu.id]}`);
    }
    if (r.flagged) { flagged++; const k = r.firstUB ? r.firstUB.kind : 'leak/invariant only'; kinds[k] = (kinds[k] || 0) + 1; }
    if (!!r.flagged !== !!why) {
      bad++;
      if (bad <= 3) console.log(`  MISMATCH ${mu.id}: ${txt(ops)}\n    model: ${r.flagged ? JSON.stringify(r.firstBad || r.firstUB || r.leaks) : 'not flagged'}\n    REF: ${why || 'handled correctly'}`);
    }
  });
  if (!flagged) { bad++; console.log(`  MISMATCH ${mu.id}: never flagged`); }
  mism += bad + silent;
  console.log(`  ${mu.id.padEnd(9)} ${String(set.length).padStart(4)} scripts, flagged ${String(flagged).padStart(3)}, mismatches ${bad} vs REF, ${silent} vs the condition   ${Object.keys(kinds).map((k) => k + ' ' + kinds[k]).join(', ')}`);
}
console.log(`\n${cases} cases checked (rustc 1.98.1, edition 2024, for part 1), ${mism} mismatches`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(mism ? 1 : 0);
