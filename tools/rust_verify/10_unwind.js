#!/usr/bin/env node
/* Oracle for Lesson 10's widget: all_lessons/rust/lessons/unwind.js  vs  the real rustc.
 *
 *   node tools/rust_verify/10_unwind.js [randomCases=360] [seed=10]
 *
 * For every case (the lesson's named configurations first, then random ones) it takes the
 * program the widget says the configuration stands for (Unwind.toRust), compiles it with rustc
 * (edition 2024; `-C panic=abort` for the abort mode), RUNS it, and compares
 *   (a) stdout, line by line, with Unwind.trace(cfg).lines, and
 *   (b) the way the process ended (exit status, or the signal) with Unwind.trace(cfg).status.
 * trace() never reads the Rust text — it applies the drop rules directly — so agreement means the
 * rules are right, not that the generator agrees with itself. Exit status 1 on any mismatch.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const U = require('../../all_lessons/rust/lessons/unwind.js');

const N = +(process.argv[2] || 360), SEED = +(process.argv[3] || 10);
let seed = SEED;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const CODES = Object.keys(U.LAYOUTS);

// The configurations the lesson text talks about (the widget's presets, "What to try", the checkpoint).
const P = U.PRESETS, as = (base, extra) => Object.assign({}, base, extra);
const CHECKPOINT = { depth: 4, fail: 4, mode: 'result', handler: 2, layout: ['0', 'ba', 'p', 'ba', 'bb', '0', '0'] };
const NAMED = [
  ['§4 program, unwind',  P.p1],
  ['§4 program, no fail', as(P.p1, { fail: 4 })],
  ['§4 program, result',  as(P.p1, { mode: 'result' })],
  ['§4 program, abort',   as(P.p1, { mode: 'abort' })],
  ['§4 program, exit',    as(P.p1, { mode: 'exit' })],
  ['serve handles',       P.p2],
  ['serve "handles", unwind', as(P.p2, { mode: 'unwind' })],
  ['pair and let _',      P.p3],
  ['main guard, unwind',  as(P.p1, { layout: ['ba', 'b', 'bb', 'b', '0', '0', '0'] })],
  ['checkpoint',          CHECKPOINT],
  ['checkpoint, unwind',  as(CHECKPOINT, { mode: 'unwind' })],
];

function randomCfg() {
  const depth = 3 + Math.floor(rnd() * 4);
  const layout = [];
  for (let i = 0; i <= 6; i++) layout.push(pick(CODES));
  return { depth, fail: 1 + Math.floor(rnd() * (depth + 1)), mode: pick(U.MODES),
           handler: rnd() < 0.45 ? -1 : Math.floor(rnd() * depth), layout };
}

const cases = NAMED.map(([name, cfg]) => ({ name, cfg }));
for (let i = 0; i < N; i++) cases.push({ name: 'random #' + i, cfg: randomCfg() });

const rustc = process.env.RUSTC || path.join(os.homedir(), '.cargo/bin/rustc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unwind10_'));

function runCase(c, idx) {
  return new Promise((resolve) => {
    const src = path.join(tmp, `c${idx}.rs`), exe = path.join(tmp, `c${idx}`);
    fs.writeFileSync(src, U.toRust(c.cfg));
    const args = ['--edition', '2024', '--cap-lints', 'allow', '-C', 'opt-level=0', '-C', 'debuginfo=0', '-o', exe, src];
    if (U.normal(c.cfg).mode === 'abort') args.unshift('-C', 'panic=abort');
    cp.execFile(rustc, args, { maxBuffer: 1 << 24 }, (err, _o, stderr) => {
      if (err) { resolve({ compileError: stderr || String(err) }); return; }
      const r = cp.spawnSync(exe, [], { encoding: 'utf8', timeout: 10000 });
      resolve({ stdout: r.stdout, status: r.status !== null ? r.status : r.signal });
    });
  });
}

async function main() {
  const width = Math.max(2, os.cpus().length);
  const results = new Array(cases.length);
  let next = 0;
  async function worker() { while (next < cases.length) { const i = next++; results[i] = await runCase(cases[i], i); } }
  await Promise.all(Array.from({ length: width }, worker));

  let bad = 0;
  const byMode = {};
  cases.forEach((c, i) => {
    const want = U.trace(c.cfg), got = results[i], mode = want.cfg.mode;
    byMode[mode] = byMode[mode] || { n: 0, bad: 0 };
    byMode[mode].n++;
    let why = null;
    if (got.compileError) why = 'did not compile:\n' + got.compileError.split('\n').slice(0, 12).join('\n');
    else {
      const lines = got.stdout.split('\n').filter((l) => l.length);
      if (lines.join('|') !== want.lines.join('|')) why = `stdout\n      rustc: ${lines.join(' / ')}\n      model: ${want.lines.join(' / ')}`;
      else if (String(got.status) !== String(want.status)) why = `status rustc=${got.status} model=${want.status}`;
    }
    if (why) {
      bad++; byMode[mode].bad++;
      console.log(`MISMATCH ${c.name} ${JSON.stringify(want.cfg)}\n  ${why}\n--- program ---\n${U.toRust(c.cfg)}`);
    }
  });
  NAMED.forEach(([name], i) => {
    const t = U.trace(cases[i].cfg);
    console.log(`  ${name.padEnd(24)} created=${t.created} dropped=${t.dropped} status=${t.status}  ${t.lines.join(' / ')}`);
  });
  Object.keys(byMode).sort().forEach((m) => console.log(`${m.padEnd(7)} ${byMode[m].n} programs: ${byMode[m].bad} mismatches`));
  console.log(`\n${cases.length} programs compiled and run (${NAMED.length} named + ${N} random), ${bad} mismatches`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
main();
