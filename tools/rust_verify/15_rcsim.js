#!/usr/bin/env node
/* Oracle for Lesson 15's widget: all_lessons/rust/lessons/rcsim.js  vs  the real rustc.
 *
 *   node tools/rust_verify/15_rcsim.js [randomScripts=400] [seed=15] [rejectedScripts=80]
 *
 * Part 1 (run): every well-formed script — the lesson's named scripts first, then random ones — becomes one
 * Rust function (RcSim.toRust: each operation wrapped in catch_unwind, the counts printed after every step
 * through a hidden observer Weak, the first panic ends the scope). All functions go into ONE program, which
 * is compiled with rustc (edition 2024) and RUN. Its stdout, case by case and line by line, must equal
 * RcSim.run(script).lines — which the engine computes from the counting and borrow-flag rules alone, without
 * reading the Rust text.
 * Part 2 (compile): scripts whose last operation breaks the compile-time law (drop a handle that a guard still
 * borrows; use a binding after drop) go into one library; rustc must reject each on exactly the line of that
 * operation, with the code RcSim.analyze names (E0505 / E0382), and nothing else.
 * Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const R = require('../../all_lessons/rust/lessons/rcsim.js');

const N = +(process.argv[2] || 400), SEED = +(process.argv[3] || 15), NBAD = +(process.argv[4] || 80);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Scripts the lesson text talks about: the presets, "What to try", the checkpoint.
const NAMED = R.PRESETS.filter((p) => p.id !== 'e0505').map((p) => [p.label, p.script]).concat([
  ['try: drop g1 before the writer', [{ k: 'new' }, { k: 'clone', t: 'h1' }, { k: 'bor', t: 'h1' }, { k: 'drop', t: 'g1' }, { k: 'mut', t: 'h2' }]],
  ['try: break the cycle by hand',   [{ k: 'new' }, { k: 'new' }, { k: 'link', t: 'h1', u: 'h2' }, { k: 'link', t: 'h2', u: 'h1' }, { k: 'cut', t: 'h2' }]],
  ['checkpoint: three-node ring',    [{ k: 'new' }, { k: 'new' }, { k: 'new' }, { k: 'link', t: 'h1', u: 'h2' }, { k: 'link', t: 'h2', u: 'h3' }, { k: 'link', t: 'h3', u: 'h1' }]],
  ['checkpoint: ring, one Weak edge', [{ k: 'new' }, { k: 'new' }, { k: 'new' }, { k: 'link', t: 'h1', u: 'h2' }, { k: 'link', t: 'h2', u: 'h3' }, { k: 'link', t: 'h3', u: 'h1', weak: true }]],
  ['checkpoint: ring, weak, guard',  [{ k: 'new' }, { k: 'new' }, { k: 'new' }, { k: 'link', t: 'h1', u: 'h2' }, { k: 'link', t: 'h2', u: 'h3' }, { k: 'bor', t: 'h3' }, { k: 'link', t: 'h3', u: 'h1', weak: true }]]
]);

// State after the whole script so far (the frame before the closing brace).
function stateOf(script) {
  const t = R.run(script);
  return { t, st: t.frames[Math.max(0, t.frames.length - 2)].st };
}
// One random operation that keeps the script well-formed (compiles, never touches a None handle).
function randomOp(script) {
  const { st } = stateOf(script);
  const live = st.binds.filter((b) => b.live);
  const strong = live.filter((b) => b.kind === 'h' && b.a >= 0), weak = live.filter((b) => b.kind === 'w');
  const guardedBy = (h) => live.some((g) => g.kind === 'g' && g.via === h.name);
  const menu = [];
  if (st.allocs.length < R.NAMES.length) menu.push([0.14, () => ({ k: 'new' })]);
  if (strong.length) {
    menu.push([0.11, () => ({ k: 'clone', t: pick(strong).name })]);
    menu.push([weak.length ? 0.06 : 0.12, () => ({ k: 'down', t: pick(strong).name })]);
    menu.push([0.14, () => ({ k: 'bor', t: pick(strong).name })]);
    menu.push([0.11, () => ({ k: 'mut', t: pick(strong).name })]);
    menu.push([0.10, () => ({ k: 'link', t: pick(strong).name, u: pick(strong).name })]);
    menu.push([0.06, () => ({ k: 'link', t: pick(strong).name, u: pick(strong).name, weak: true })]);
    menu.push([0.05, () => ({ k: 'cut', t: pick(strong).name })]);
  }
  if (weak.length) menu.push([weak.some((w) => st.allocs[w.a].strong === 0) ? 0.2 : 0.08, () => ({ k: 'up', t: pick(weak).name })]);
  const droppable = live.filter((b) => !(b.kind === 'h' && guardedBy(b)));
  if (droppable.length) menu.push([0.18, () => ({ k: 'drop', t: pick(droppable).name })]);
  // bias toward the Weak paths: drop an owner of a value that a Weak (handle or back edge) still observes
  const observed = droppable.filter((b) => b.kind === 'h' && b.a >= 0 && st.allocs[b.a].weak > 0);
  if (observed.length) menu.push([0.3, () => ({ k: 'drop', t: pick(observed).name })]);
  if (!menu.length) return null;                     // nothing left to do (five allocations, no live names)
  let total = menu.reduce((s, m) => s + m[0], 0), r = rnd() * total;
  for (const m of menu) { if ((r -= m[0]) <= 0) return m[1](); }
  return menu[menu.length - 1][1]();
}
function randomScript(maxLen) {
  const s = [{ k: 'new' }], len = 3 + Math.floor(rnd() * (maxLen - 2));
  while (s.length < len) {
    const op = randomOp(s);
    if (!op) break;
    s.push(op);
    const t = R.run(s);
    if (t.verdict === 'panic') break;                 // the first panic ends the scope: nothing after it runs
    if (t.verdict !== 'ok') throw new Error('generator made a bad script: ' + t.verdict + ' ' + t.msg);
  }
  return s;
}
// A script whose LAST operation breaks the compile-time law.
function rejectedScript() {
  for (;;) {
    const s = randomScript(12), nm = R.names(s);
    const declared = [], dropped = new Set(), guards = [];
    s.forEach((op, i) => {
      if (op.k === 'drop') dropped.add(op.t);
      if (nm[i]) declared.push(nm[i]);
      if (op.k === 'bor' || op.k === 'mut') guards.push({ g: nm[i], via: op.t });
    });
    const held = guards.filter((x) => !dropped.has(x.g) && !dropped.has(x.via));
    // (re-using a dropped GUARD would stretch its borrow to the new use, so rustc would also flag the earlier
    //  drop of its handle as E0505 — two errors; keep each rejected script to exactly one)
    const gone = declared.filter((x) => dropped.has(x) && !guards.some((g) => g.g === x && dropped.has(g.via)));
    if (rnd() < 0.55 && held.length) { const x = pick(held); s.push({ k: 'drop', t: x.via }); }
    else if (gone.length) {
      const x = pick(gone);
      s.push(x[0] === 'h' ? pick([{ k: 'clone', t: x }, { k: 'bor', t: x }, { k: 'down', t: x }, { k: 'drop', t: x }]) : x[0] === 'w' ? pick([{ k: 'up', t: x }, { k: 'drop', t: x }]) : { k: 'drop', t: x });
    } else continue;
    const an = R.analyze(s);
    if (!an.ok && an.at === s.length - 1) return s;
  }
}

const good = NAMED.map(([name, script]) => ({ name, script }));
for (let i = 0; i < N; i++) good.push({ name: 'random #' + i, script: randomScript(R.MAX_OPS) });
const bad = [{ name: 'preset: drop the handle a guard borrows', script: R.PRESETS.find((p) => p.id === 'e0505').script }];
for (let i = 0; i < NBAD; i++) bad.push({ name: 'rejected #' + i, script: rejectedScript() });

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rcsim15_'));
let mism = 0;

// ── Part 1: compile and run all well-formed scripts in one program
{
  const body = [R.HEADER];
  good.forEach((c, i) => body.push(R.toRust(c.script, 'c' + i).src));
  body.push('fn main() {', '    std::panic::set_hook(Box::new(|_| {}));',
    '    let cases: Vec<fn(&mut Obs)> = vec![' + good.map((_, i) => 'c' + i).join(', ') + '];',
    '    for (i, c) in cases.iter().enumerate() {',
    '        println!("case {i}");',
    '        let mut obs: Obs = Vec::new();',
    '        if catch_unwind(AssertUnwindSafe(|| c(&mut obs))).is_err() { println!("UNCAUGHT panic"); }',
    '        println!("end");', '        show(&obs);', '    }', '}');
  const src = path.join(tmp, 'run.rs'), exe = path.join(tmp, 'run');
  fs.writeFileSync(src, body.join('\n') + '\n');
  const cr = cp.spawnSync(rustc, ['--edition', '2024', '--cap-lints', 'allow', '-C', 'opt-level=0', '-C', 'debuginfo=0', '-o', exe, src], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (cr.status !== 0) { console.log('run program did not compile:\n' + cr.stderr.split('\n').slice(0, 30).join('\n')); process.exit(1); }
  const rr = cp.spawnSync(exe, [], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 60000 });
  const got = {}; let cur = null;
  rr.stdout.split('\n').forEach((ln) => {
    const m = /^case (\d+)$/.exec(ln);
    if (m) { cur = +m[1]; got[cur] = []; } else if (cur !== null && ln.length) got[cur].push(ln);
  });
  const tally = { ok: 0, panic: 0, leak: 0, none: 0, cascade: 0, weakedge: 0, observed: 0 };
  good.forEach((c, i) => {
    const t = R.run(c.script), want = t.lines, have = got[i] || [];
    // the program prints "end" + the final state itself after the function returns; the engine's lines end the same way
    if (want.join('\n') !== have.join('\n')) {
      mism++;
      console.log(`MISMATCH (run) ${c.name}\n  script: ${c.script.map((_, j) => R.label(c.script, j, false)).join(' ; ')}`);
      const k = want.findIndex((l, j) => l !== have[j]);
      console.log(`  first difference at line ${k}: rustc=${JSON.stringify(have[k])} engine=${JSON.stringify(want[k])}`);
    }
    tally[t.verdict === 'panic' ? 'panic' : 'ok']++;
    if (t.leaked.length) tally.leak++;
    if (t.lines.some((l) => / none$/.test(l))) tally.none++;
    if (t.frames.slice(1, -1).some((f) => f.ev.length)) tally.cascade++;                 // a value dropped mid-script
    if (c.script.some((op) => op.k === 'link' && op.weak)) tally.weakedge++;
    if (t.frames.some((f) => f.st.allocs.some((A) => !A.alive && A.weak > 0))) tally.observed++;   // dropped, block kept by a Weak
  });
  NAMED.forEach(([name], i) => {
    const t = R.run(good[i].script);
    console.log(`  ${name.padEnd(40)} ${t.verdict}${t.panicAt >= 0 ? ' at op ' + (t.panicAt + 1) + ' (' + t.msg + ')' : ''}  leaked=[${t.leaked.join(',')}]`);
  });
  console.log(`run:     ${good.length} scripts (${NAMED.length} named + ${N} random) compiled and run: ${tally.ok} ended normally, ${tally.panic} panicked, ${tally.leak} leaked,`);
  console.log(`         ${tally.cascade} dropped a value mid-script, ${tally.weakedge} used a Weak back edge, ${tally.observed} kept a dropped value's block alive by a Weak, ${tally.none} had a failed upgrade`);
}

// ── Part 2: every rejected script must fail on the right line with the right code, and only there
{
  const body = [R.HEADER], where = [];
  bad.forEach((c, i) => {
    const r = R.toRust(c.script, 'b' + i), base = body.join('\n').split('\n').length;   // line of 'pub fn'
    body.push(r.src);
    where.push(base + 1 + r.lines[c.script.length - 1]);                                // 1-based line of the last op
  });
  const src = path.join(tmp, 'rejected.rs');
  fs.writeFileSync(src, body.join('\n') + '\n');
  const cr = cp.spawnSync(rustc, ['--edition', '2024', '--crate-type', 'lib', '--emit=metadata', '--cap-lints', 'allow', '--error-format=json', '-o', path.join(tmp, 'rejected.rmeta'), src], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const errs = [];
  (cr.stderr || '').split('\n').forEach((ln) => {
    let d; try { d = JSON.parse(ln); } catch (e) { return; }
    if (d.level !== 'error' || /^aborting/.test(d.message)) return;
    const sp = (d.spans || []).find((s) => s.is_primary) || (d.spans || [])[0];
    errs.push({ code: d.code && d.code.code, line: sp ? sp.line_start : -1, msg: d.message });
  });
  const codes = {};
  bad.forEach((c, i) => {
    const an = R.analyze(c.script), mine = errs.filter((e) => e.line === where[i]);
    codes[an.code] = (codes[an.code] || 0) + 1;
    if (mine.length !== 1 || mine[0].code !== an.code || mine[0].msg !== an.msg) {
      mism++;
      console.log(`MISMATCH (compile) ${c.name}: engine ${an.code} "${an.msg}" at line ${where[i]}; rustc ${JSON.stringify(mine)}\n  script: ${c.script.map((_, j) => R.label(c.script, j, false)).join(' ; ')}`);
    }
  });
  const stray = errs.filter((e) => where.indexOf(e.line) < 0);
  stray.forEach((e) => { mism++; console.log(`MISMATCH (compile) stray error ${e.code} "${e.msg}" at line ${e.line}`); });
  console.log(`compile: ${bad.length} rejected scripts (${Object.keys(codes).map((k) => codes[k] + ' ' + k).join(', ')}), ${errs.length} errors from rustc, ${stray.length} stray`);
}

console.log(`\n${good.length + bad.length} scripts checked against rustc 1.98.1 (edition 2024), ${mism} mismatches`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(mism ? 1 : 0);
