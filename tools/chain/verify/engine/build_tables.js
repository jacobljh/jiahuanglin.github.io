#!/usr/bin/env node
'use strict';
/* build_tables.js — measures the series' base tables and writes them into all_lessons/synthetic_vision_new/tables.js
 *
 *   node tools/chain/verify/engine/build_tables.js [--jobs 9]     (runs every experiment in parallel worker processes, ~15 min on ten cores, then rewrites tables.js)
 *   node tools/chain/verify/engine/build_tables.js --check        (recomputes three cells live and compares them with the stored table)
 *
 * What is measured (every cell is a pure function of fixed seeds; see syn_lab.js for the protocol):
 *   swap    the sixteen programs: each of scene, look, sensor and label taken from the program SIM0 (a) or from the real street (b); N = 1600 frames, seeds 1-3
 *   curve   the program SIM0 (aaaa) and the real street (bbbb) at N = 10 ... 2560 frames, seeds 1-3
 *   models  the weights (5 significant digits) of the seed-1 detector of every cell, so a page can score a frame live exactly as the lab did
 * The table is the single source of the numbers lessons 1 and 2 quote; their oracles recompute cells from scratch and compare.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const DIR = fs.existsSync(path.join(ROOT, 'all_lessons/synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const OUT = path.join(ROOT, 'all_lessons', DIR, 'tables.js');
const LAB = path.join(__dirname, 'syn_lab.js');
const NS = [10, 20, 40, 80, 160, 320, 640, 1280, 2560], SEEDS = [1, 2, 3], PICKS = [];
for (const a of 'ab') for (const b of 'ab') for (const c of 'ab') for (const d of 'ab') PICKS.push(a + b + c + d);
const argv = process.argv.slice(2), has = (f) => argv.includes(f), arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

function runJob(spec) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [LAB, JSON.stringify(Object.assign({ model: spec.seed === 1 }, spec))], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => { if (code !== 0) return reject(new Error('job failed ' + JSON.stringify(spec))); resolve(JSON.parse(out.trim().split('\n').pop())); });
  });
}
async function pool(jobs, k, onDone) {
  const res = new Array(jobs.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: k }, async () => { for (;;) { const i = next++; if (i >= jobs.length) return; res[i] = await runJob(jobs[i]); onDone(++done, jobs.length); } }));
  return res;
}
const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

async function build() {
  const jobs = [];
  for (const p of PICKS) for (const s of SEEDS) jobs.push({ pick: p, N: 1600, seed: s });                    // the big ones first, so the pool stays busy
  for (const p of ['aaaa', 'bbbb']) for (const N of NS.slice().reverse()) for (const s of SEEDS) jobs.push({ pick: p, N: N, seed: s });
  const t0 = Date.now();
  const res = await pool(jobs, +arg('--jobs', 9), (d, n) => { if (d % 10 === 0 || d === n) console.error(d + '/' + n + ' jobs, ' + Math.round((Date.now() - t0) / 1000) + ' s'); });
  const pick = (p, N) => res.filter((r) => r.pick === p && r.N === N).sort((a, b) => a.seed - b.seed);
  const FIELDS = ['realMiss', 'missOpen', 'missEmerge', 'realAUC', 'ownMiss', 'ownAUC', 'carriedFA', 'logsAlarm', 'domAUC', 'thrReal', 'thrOwn'];
  const cell = (rows) => { const o = {}; for (const f of FIELDS) o[f] = rows.map((r) => r[f]); return o; };
  const T = { protocol: { N: 1600, seeds: SEEDS, realTest: 3000, realVal: 1500, logs: 1000, fa: 0.1, minArea: 6 }, swap: {}, curve: { N: NS.concat([1600]).sort((a, b) => a - b), sim: {}, real: {} }, models: {} };
  for (const p of PICKS) { T.swap[p] = cell(pick(p, 1600)); const m = pick(p, 1600)[0].model; T.models['swap@' + p] = { w: m.w, mu: m.mu, sd: m.sd, thrReal: pick(p, 1600)[0].thrReal, thrOwn: pick(p, 1600)[0].thrOwn }; }
  for (const [name, p] of [['sim', 'aaaa'], ['real', 'bbbb']]) {
    for (const N of T.curve.N) {
      const rows = pick(p, N); T.curve[name][N] = cell(rows);
      const m = rows[0].model; T.models[name + '@' + N] = { w: m.w, mu: m.mu, sd: m.sd, thrReal: rows[0].thrReal, thrOwn: rows[0].thrOwn };
    }
  }
  const body = '/* tables.js — measured by tools/chain/verify/engine/build_tables.js (do not edit by hand).  Every cell is a function of fixed seeds; syn_lab.js recomputes any of them.\n' +
    ' * swap[abcd] : the program trained on stages (scene, look, sensor, label), each a = the naive program SIM0 or b = the real street; per-seed arrays\n' +
    ' * curve.sim / curve.real[N] : programs aaaa and bbbb at N training frames;  models[name]: weights of the seed-1 detector, thresholds thrReal (10 % false alarms on real validation frames) and thrOwn (on its own program) */\n' +
    '(function (root) {\n  var SV = root.SV || (root.SV = {});\n  SV.TABLES = ' + JSON.stringify(T) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports = (typeof globalThis !== \'undefined\' ? globalThis : this).SV;\n';
  fs.writeFileSync(OUT, body);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + body.length + ' bytes, ' + res.length + ' experiments, ' + Math.round((Date.now() - t0) / 1000) + ' s)');
}

async function check() {
  delete global.SV; require(OUT);
  const T = (global.SV || globalThis.SV).TABLES;
  let bad = 0;
  for (const spec of [{ pick: 'aaaa', N: 80, seed: 2 }, { pick: 'bbbb', N: 160, seed: 3 }, { pick: 'abba', N: 1600, seed: 1 }]) {
    const r = await runJob(Object.assign({}, spec));
    const stored = spec.N === 1600 && spec.pick.length === 4 && T.swap[spec.pick] ? T.swap[spec.pick] : T.curve[spec.pick === 'aaaa' ? 'sim' : 'real'][spec.N];
    for (const f of ['realMiss', 'ownMiss', 'carriedFA', 'logsAlarm', 'domAUC', 'realAUC']) {
      const want = stored[f][spec.seed - 1];
      if (Math.abs(want - r[f]) > 1e-9) { bad++; console.error('MISMATCH', JSON.stringify(spec), f, 'stored', want, 'live', r[f]); }
    }
  }
  console.log(bad ? bad + ' mismatches' : 'tables.js agrees with a live recomputation of three cells');
  process.exit(bad ? 1 : 0);
}

(has('--check') ? check() : build()).catch((e) => { console.error(e); process.exit(1); });
