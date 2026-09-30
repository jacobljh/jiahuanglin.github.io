#!/usr/bin/env node
/* Oracle test for Lesson 18's widget: the state-machine layout engine
 * all_lessons/rust/lessons/asyncsm.js  vs  the real rustc.
 *
 *   node tools/rust_verify/18_asyncsm.js [programs=600] [seed=18]
 *
 * 1. Generates random bodies of an argument-less `async fn` in the widget's language — buffers of
 *    distinct sizes (let), by-value reads (use), borrows, drops (moves) and awaits — half in free
 *    random order, half as staged pipelines whose neighbouring buffers may overlap (to exercise the
 *    greedy choice of rule 2); plus the lesson's presets, every prefix of each (the widget's statement
 *    slider) and the variants the prose mentions.
 * 2. Writes ONE Rust program with each body as a real `async fn` (SM.toRust) and, for a slice of the
 *    cases, the same body again as an `async move {}` block; `main` prints size_of_val of each future,
 *    then polls it to completion by hand with a no-op waker and counts the Pending results.
 * 3. Requires: size_of_val == SM.analyze(body).size; the async block's size equals the async fn's;
 *    the number of Pending polls == the number of awaits (every Tick is pending exactly once).
 * 4. Checks that the lesson's "Show the core JS" listing is a verbatim excerpt of the engine, and that
 *    the numbers the lesson's prose states (CLAIMS) are what the engine computes.
 * Prints every disagreement; exit status 1 if there is any.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SM = require(path.join(ROOT, 'all_lessons', 'rust', 'lessons', 'asyncsm.js'));
const LESSON = path.join(ROOT, 'all_lessons', 'rust', 'lessons', '18_async_state_machines.html');

const N = +(process.argv[2] || 600), SEED = +(process.argv[3] || 18);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (k) => Math.floor(rnd() * k);
const POOL = [3, 5, 9, 17, 24, 40, 64, 100, 130, 256, 300, 512, 700, 1024, 1500];
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function gen() {
  const nl = 1 + ri(6), na = ri(6);
  const pool = POOL.slice(); for (let i = pool.length - 1; i > 0; i--) { const j = ri(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const stmts = []; let declared = 0, awaited = 0, extra = ri(3 * nl + 3);
  const live = [];                       // declared and not yet dropped
  for (let guard = 0; guard < 200 && (declared < nl || awaited < na || extra > 0); guard++) {
    const r = rnd();
    if (declared < nl && r < 0.28) { const nm = NAMES[declared]; stmts.push({ op: 'let', name: nm, size: pool[declared] }); live.push(nm); declared++; }
    else if (awaited < na && r < 0.52) { stmts.push({ op: 'await' }); awaited++; }
    else if (live.length && r < 0.92) {
      const nm = live[ri(live.length)], q = rnd();
      if (q < 0.5) stmts.push({ op: 'use', name: nm });
      else if (q < 0.68) stmts.push({ op: 'borrow', name: nm });
      else { stmts.push({ op: 'drop', name: nm }); live.splice(live.indexOf(nm), 1); }
      extra--;
    } else extra--;
  }
  return stmts;
}

// A second family aimed at rule 2's greedy choice: stages that each declare a buffer, await, use it,
// and drop it either before or after the next stage's let (so neighbouring stages' storage may
// overlap), with some buffers kept over two awaits, borrowed, or never dropped.
function genPipeline() {
  const S = 2 + ri(4);
  const pool = POOL.slice(); for (let i = pool.length - 1; i > 0; i--) { const j = ri(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const st = [], pending = [];
  for (let k = 0; k < S; k++) {
    const nm = NAMES[k];
    st.push({ op: 'let', name: nm, size: pool[k] });
    while (pending.length) { const p = pending.shift(); if (rnd() < 0.85) st.push({ op: 'drop', name: p }); }
    if (rnd() < 0.15) st.push({ op: 'borrow', name: nm });
    st.push({ op: 'await' });
    if (rnd() < 0.2) st.push({ op: 'await' });
    st.push({ op: 'use', name: nm });
    if (rnd() < 0.5) st.push({ op: 'drop', name: nm }); else pending.push(nm);
  }
  return st;
}

// ── cases: presets (and every prefix of each: the widget's first slider), the lesson's variants, then random bodies ──
const cases = [];
SM.PRESETS.forEach(p => {
  const st = SM.parse(p.text);
  if (st.errors.length) { console.log('preset ' + p.id + ' does not parse: ' + st.errors.join('; ')); process.exitCode = 1; }
  for (let k = 1; k <= st.stmts.length; k++) cases.push({ tag: p.id + '[' + k + ']', stmts: st.stmts.slice(0, k) });
});
const VARIANTS = {   // programs the lesson's prose mentions that are not presets
  'three-swapped': SM.PRESETS.find(p => p.id === 'three').text.replace('let row: Buf<400>;\ndrop req;', 'drop req;\nlet row: Buf<400>;'),
  'borrowed-without-borrow': SM.PRESETS.find(p => p.id === 'borrowed').text.replace('borrow header;\n', '')
};
Object.keys(VARIANTS).forEach(k => cases.push({ tag: k, stmts: SM.parse(VARIANTS[k]).stmts }));
const nPreset = cases.length;
for (let i = 0; i < N; i++) cases.push({ tag: i % 2 ? 'pipeline' : 'random', stmts: i % 2 ? genPipeline() : gen() });
cases.forEach((c, i) => { c.id = i; c.block = (i % 7 === 3); c.pred = SM.analyze(c.stmts); c.awaits = c.stmts.filter(s => s.op === 'await').length; });

// ── one program ──
const src = ['#![allow(unused, dropping_copy_types)]', SM.PRELUDE, 'use std::mem::size_of_val;', 'use std::task::Waker;'];
src.push('fn run<F: Future>(f: F) -> usize {',
  '    let mut f = Box::pin(f);',
  '    let mut cx = Context::from_waker(Waker::noop());',
  '    let mut pending = 0;',
  '    while f.as_mut().poll(&mut cx).is_pending() { pending += 1; }',
  '    pending',
  '}');
cases.forEach(c => {
  src.push(SM.toRust(c.stmts, 'case' + c.id));
  if (c.block) {
    const body = SM.toRust(c.stmts, 'x').split('\n').slice(1, -1).join('\n');
    src.push('fn block' + c.id + '() -> impl Future<Output = ()> {\n    async move {\n' + body.replace(/^/gm, '    ') + '\n    }\n}');
  }
});
src.push('fn main() {');
cases.forEach(c => {
  src.push(`    { let f = case${c.id}(); let s = size_of_val(&f); let p = run(f); ` +
    (c.block ? `let b = size_of_val(&block${c.id}()); ` : 'let b = s; ') + `println!("${c.id} {} {} {}", s, b, p); }`);
});
src.push('}');

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asyncsm_'));
const file = path.join(tmp, 'cases.rs'), exe = path.join(tmp, 'cases');
fs.writeFileSync(file, src.join('\n') + '\n');
const ver = cp.spawnSync(rustc, ['--version'], { encoding: 'utf8' }).stdout.trim();
const r = cp.spawnSync(rustc, ['--edition', '2024', '-C', 'opt-level=0', '-o', exe, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) { console.log(r.stderr.split('\n').slice(0, 40).join('\n')); console.log('compile failed'); process.exit(1); }
const run = cp.spawnSync(exe, [], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (run.status !== 0) { console.log(run.stderr); console.log('run failed'); process.exit(1); }
const real = {};
run.stdout.trim().split('\n').forEach(ln => { const [id, s, b, p] = ln.split(' ').map(Number); real[id] = { s, b, p }; });

let bad = 0, blocks = 0;
cases.forEach(c => {
  const got = real[c.id];
  const why = [];
  if (!got) why.push('no output');
  else {
    if (got.s !== c.pred.size) why.push(`size_of_val=${got.s} engine=${c.pred.size}`);
    if (c.block) { blocks++; if (got.b !== got.s) why.push(`async block ${got.b} != async fn ${got.s}`); }
    if (got.p !== c.awaits) why.push(`pending polls ${got.p} != awaits ${c.awaits}`);
  }
  if (why.length) {
    bad++;
    if (bad <= 12) console.log(`  MISMATCH case ${c.id} (${c.tag}): ${why.join('; ')}\n    ` + c.stmts.map(SM.show).join(' '));
  }
});

// ── the core listing and the prose claims ──
let problems = 0;
if (fs.existsSync(LESSON)) {
  const html = fs.readFileSync(LESSON, 'utf8');
  const engine = fs.readFileSync(path.join(ROOT, 'all_lessons', 'rust', 'lessons', 'asyncsm.js'), 'utf8');
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const shown = /<summary>Show the core JS<\/summary>\s*<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(html);
  if (!shown) { console.log('  no "Show the core JS" listing found'); problems++; }
  else {
    const parts = unesc(shown[1]).split(/\n\s*\/\/ …\n/);    // an elision line may separate excerpts
    const okAll = parts.every(p => norm(engine).includes(norm(p)));
    if (!okAll) { console.log('  the "Show the core JS" listing is NOT a verbatim excerpt of asyncsm.js'); problems++; }
    else console.log(`core listing: ${unesc(shown[1]).split('\n').length} lines, verbatim excerpt(s) of asyncsm.js`);
  }
} else console.log('  (lesson file not written yet: listing check skipped)');

// Every widget number the lesson's prose states, as [sentence, what the engine computes, what the
// lesson says]. The engine side is also a compiled case above, so each is checked against rustc too.
const byId = (id) => SM.PRESETS.find(p => p.id === id);
const at = (id) => SM.analyze(SM.parse(byId(id).text).stmts);
const sweep = (id) => { const st = SM.parse(byId(id).text).stmts; return st.map((_, k) => SM.analyze(st.slice(0, k + 1)).size).join(' '); };
const home = (a, nm) => a.items.find(i => i.name === nm).home;
const CLAIMS = [];
(function () {
  const h = at('handler'), kept = at('kept'), both = at('both'), acr = at('across'), bor = at('borrowed'), thr = at('three');
  const swp = SM.analyze(SM.parse(VARIANTS['three-swapped']).stmts), nob = SM.analyze(SM.parse(VARIANTS['borrowed-without-borrow']).stmts);
  CLAIMS.push(['handler: size_of_val', h.size, 1026], ['handler: states', h.states.length, 2],
    ['handler: largest live set', h.largestLive, 1024], ['handler: lower bound', h.lower, 1026],
    ['handler: slider sweep', sweep('handler'), '1 2 66 66 66 66 1026']);
  CLAIMS.push(['kept: size_of_val', kept.size, 1090], ['kept: header goes to the prefix', home(kept, 'header'), 'prefix'],
    ['kept: lower bound', kept.lower, 1026]);
  CLAIMS.push(['both: size_of_val', both.size, 1090], ['both: largest live set', both.largestLive, 1088]);
  CLAIMS.push(['across: size_of_val', acr.size, 290], ['across: session goes to the prefix', home(acr, 'session'), 'prefix']);
  CLAIMS.push(['borrowed: size_of_val', bor.size, 1090], ['borrowed without the borrow', nob.size, 1026],
    ['borrowed: header kept at S2 though not live', bor.savedAt('header', bor.awaits[1]) && !bor.liveAt('header', bor.awaits[1]), true]);
  CLAIMS.push(['three: size_of_val', thr.size, 602], ['three: states', thr.states.length, 3], ['three: lower bound', thr.lower, 402],
    ['three: row goes to the prefix', home(thr, 'row'), 'prefix'], ['three swapped: size_of_val', swp.size, 402]);
})();
CLAIMS.forEach(([d, got, want]) => { if (got !== want) { console.log(`  CLAIM ${d}: engine says ${got}, lesson says ${want}`); problems++; } });
console.log(`prose claims: ${CLAIMS.length} checked, ${CLAIMS.filter(c => c[1] !== c[2]).length} wrong`);

const sizes = cases.map(c => c.pred.size);
// How often each of the lesson's rules decided something: rule 1 (saved in two states -> prefix),
// rule 2 (overlapping storage -> prefix), rule 3 (a borrow kept a value saved at an await where it
// was not live), and the size-neutral last step (at most one state with bytes of its own).
const fired = (re) => cases.filter(c => c.pred.items.some(i => re.test(i.why))).length;
const rule3 = cases.filter(c => c.pred.states.some(st => st.fields.some(f => f.local && !c.pred.liveAt(f.name, st.at)))).length;
console.log(`rules exercised: rule 1 in ${fired(/two or more/)} programs, rule 2 in ${fired(/overlaps/)}, rule 3 in ${rule3}, ` +
  `last step in ${fired(/no other state/)}`);
console.log(`${ver}; ${cases.length} programs (${nPreset} preset prefixes and lesson variants + ${N} random, half of them staged; ` +
  `${blocks} also as async blocks), sizes ${Math.min(...sizes)}..${Math.max(...sizes)} bytes: ${bad} mismatches`);
process.exit(bad || problems || process.exitCode ? 1 : 0);
