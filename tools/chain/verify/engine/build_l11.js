#!/usr/bin/env node
'use strict';
/* build_l11.js — the deterministic builder of all_lessons/synthetic_vision/l11_data.js (SV.L11), the tables of Lesson 11 (what braking changes).
 *
 *   node build_l11.js                 run every job (2 workers), merge, write l11_data.js
 *   node build_l11.js --job NAME      run one job; its result goes to tools/chain/syn_notes/w11/jobs/NAME.json
 *   node build_l11.js --merge         merge the job files into l11_data.js
 *   node build_l11.js --check         recompute a few cells from scratch and compare them with l11_data.js
 *
 * What it stores (all closed loop, all on the l11_episode.js engine; seeds from 23,000,000, the private block of Lesson 11):
 *   pbin      the natural probability of each step-out stratum (10^6 forced step-out scene draws)
 *   strat     1,000 STRATIFIED situations (250 per stratum), and for 11 detectors the decision frame kd of the policy 'two alarms in three frames' at the exam's threshold (-1: never decides),
 *             in the program's world; the same situations in the street's world for three detectors; the 'ideal' detector decides at the first frame in which 6 px^2 of the pedestrian show
 *   nat       1,000 NATURAL situations (the street's own frequencies) with kd for three detectors, and the full-score job 'natfull' for the operating-point frontier and the misses of consecutive frames
 *   logs      4,000 natural step-outs driven by the human of l11_episode.js: first frame in which 6 px^2 show, and who braked
 *   regime    four speeds on the first 400 natural situations
 *   live      eight situations per integer step-out distance for the widget
 * An outcome is never stored: it is closed-form kinematics from (situation, kd), which the page and the oracle recompute. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '../../../../all_lessons/synthetic_vision');
const JOBS = path.resolve(__dirname, '../../syn_notes/w11/jobs');
const SV = require(path.join(root, 'street.js'));
require(path.join(root, 'tables.js'));
require(path.join(root, 'l06_rare.js'));
require(path.join(root, 'l06_data.js'));
const L = require(path.join(root, 'l11_episode.js'));
const T = SV.TABLES, D6 = SV.L06;

const r5 = (x) => +Number(x).toPrecision(5);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const SH = L.shuttle();
const PROG = L.programWorld('bbba'), STREET = L.streetWorld();
const SEEDS = { logs: 23000000, strat: 24000000, nat: 25000000, free: 26000000, pbin: 27000000, live: 28000000 };
const PER = 250, PERW = 750, NNAT = 1000, NLOGS = 4000, NFREE = 300;

/* the detectors: the eight programs whose label rule is the program's, and three of Lesson 6's */
const DETS = ['bbba', 'aaaa', 'abba', 'baba', 'aaba', 'abaa', 'baaa', 'bbaa', 'q10u', 'q25u', 'q50u'];
function model(id) {
  if (T.models['swap@' + id]) { const m = T.models['swap@' + id]; return { dim: 110, w: m.w, mu: m.mu, sd: m.sd, thr: m.thrReal }; }
  const m = D6.models[id]; return { dim: 110, w: m.w, mu: m.mu, sd: m.sd, thr: m.thr };
}
const POLICY = (id) => ({ thr: model(id).thr, m: L.POLICY.m, n: L.POLICY.n });
const examOf = (id) => T.swap[id] ? { exam: T.swap[id].realMiss[0], emerge: T.swap[id].missEmerge[0], open: T.swap[id].missOpen[0] } : { exam: D6.arms[id].exam[0], R: D6.arms[id].R.exam[0] };

function strataSeeds() { const out = []; for (let b = 0; b < 4; b++) out.push(L.seedsInBin(PROG, b, PER, SEEDS.strat + b * 100000)); return out; }
const flat = (a) => [].concat.apply([], a);

/* decision frames of several detectors (and the ideal one) on a list of situations of a world; the situation is drawn once and its frames are shared */
function decisions(world, seeds, ids, sh) {
  const kd = {}, ks = []; ids.forEach((id) => { kd[id] = []; });
  seeds.forEach((sd) => {
    const sit = L.situation(world, sd, sh);
    ids.forEach((id) => { kd[id].push(L.episode(world, model(id), POLICY(id), sd, { sit: sit, sh: sh }).kDecide); });
    ks.push(L.firstSeen(sit, L.lastFrame(sit, sh)));
    sit.xs = []; sit.rads = [];
  });
  kd.ideal = ks;
  return kd;
}

const JOBS_FN = {
  pbin: () => ({ p: L.binProbs(PROG, 1000000, SEEDS.pbin).map((x) => +x.toFixed(5)), n: 1000000 }),
  'strat-A': () => { const s = strataSeeds(); return { seeds: s, kd: decisions(PROG, flat(s), ['bbba', 'aaaa', 'abba', 'baba', 'q25u'], SH) }; },
  'strat-B': () => { const s = strataSeeds(); return { kd: decisions(PROG, flat(s), ['aaba', 'abaa', 'baaa', 'bbaa', 'q10u', 'q50u'], SH) }; },
  'strat-street': () => { const s = strataSeeds(); return { kd: decisions(STREET, flat(s), ['bbba', 'q25u', 'aaaa'], SH) }; },
  worlds: () => {                                    // the same detector in the program's world and the street's: 750 situations per stratum, the same seeds in both (the first 250 per stratum are the stratified sample's)
    const s = []; for (let b = 0; b < 4; b++) s.push(L.seedsInBin(PROG, b, PERW, SEEDS.strat + b * 100000)); const seeds = flat(s);
    return { per: PERW, seeds: s, kd: { prog: decisions(PROG, seeds, ['bbba'], SH).bbba, street: decisions(STREET, seeds, ['bbba'], SH).bbba } };
  },
  nat: () => { const seeds = []; for (let i = 0; i < NNAT; i++) seeds.push(SEEDS.nat + i); return { seeds: seeds, kd: decisions(PROG, seeds, ['bbba', 'q25u', 'aaaa'], SH) }; },
  logs: () => {
    const ks = [], braked = [];
    for (let i = 0; i < NLOGS; i++) {
      const sd = SEEDS.logs + i, sit = L.situation(PROG, sd, SH), drv = L.humanDriver(sd);
      ks.push(L.firstSeen(sit, L.lastFrame(sit, SH))); braked.push(drv.A <= L.fullArea(sit) ? 1 : 0);
    }
    return { seed0: SEEDS.logs, n: NLOGS, ks: ks, braked: braked };
  },
  regime: () => {
    const rows = [];
    [5, 6, 7, 8].forEach((v0) => {
      const sh = L.shuttle({ v0: v0 }), kd = [], coast = [], col = [], z = [];
      for (let i = 0; i < 400; i++) {
        const sd = SEEDS.nat + i, sit = L.situation(PROG, sd, sh), ep = L.episode(PROG, model('bbba'), POLICY('bbba'), sd, { sit: sit, sh: sh });
        kd.push(ep.kDecide); col.push(+ep.collision); coast.push(+L.branch(ep, 'coast').collision); z.push(sit.z0); sit.xs = []; sit.rads = [];
      }
      rows.push({ v0: v0, dStop: L.dStop(sh), coast: mean(coast), policy: mean(col), kd: kd, n: 400 });
    });
    return { rows: rows };
  },
  live: () => {
    const out = {}; for (let z = 8; z <= 30; z++) out[z] = [];
    for (let s = SEEDS.live, left = 23 * 8; left > 0 && s < SEEDS.live + 5000000; s++) {
      const z0 = L.stepOutDepth(PROG, s), z = Math.round(z0);
      if (z >= 8 && z <= 30 && Math.abs(z0 - z) < 0.25 && out[z].length < 8) { out[z].push(s); left--; }
    }
    return { seeds: out };
  },
  free: () => {                                     // frontier on the natural pool and on pedestrian-free approaches: bbba, five operating points, three debounce rules
    const m = model('bbba'), val = SV.real.val(1500), negS = val.filter((s) => !s.y).map((s) => SV.score(m, s.x).s), FA = [0.01, 0.03, 0.1, 0.3];
    const thr = FA.map((fa) => SV.thrAtFPR(negS, fa)), POL = [[1, 1], [2, 3], [3, 5]], seeds = [], rowsK = {}, early = {}, k0 = [], bits = [];
    FA.forEach((_, f) => POL.forEach(([a, b]) => { rowsK[f + ':' + a + '/' + b] = []; early[f + ':' + a + '/' + b] = []; }));
    for (let i = 0; i < NNAT; i++) {
      const sd = SEEDS.nat + i, sit = L.situation(PROG, sd, SH), ep = L.episode(PROG, m, { thr: 1e9 }, sd, { sit: sit, sh: SH, full: true }), sc = ep.scores;
      const area = sc.map((_, k) => L.areaAt(sit, k)), c0 = area.findIndex((a) => a >= L.HUMAN.see);
      FA.forEach((_, f) => POL.forEach(([a, b]) => {
        const kd = L.decide(sc.map((s) => s > thr[f]), a, b), key = f + ':' + a + '/' + b;
        rowsK[key].push(kd); early[key].push(kd >= 0 && area[kd] < L.HUMAN.see ? 1 : 0);
      }));
      let bm = 0, nb = 0;                           // the misses of the frames in which the pedestrian counts, at the exam's threshold: a bit string from the first such frame on
      if (c0 >= 0) for (let k = c0; k < Math.min(sc.length, c0 + 12); k++) { if (area[k] >= L.HUMAN.see) { nb++; if (sc[k] <= thr[2]) bm |= (1 << (k - c0)); } else break; }
      k0.push(c0); bits.push(bm * 16 + Math.min(nb, 12)); seeds.push(sd); sit.xs = []; sit.rads = [];
    }
    const freeKd = {}; FA.forEach((_, f) => POL.forEach(([a, b]) => { freeKd[f + ':' + a + '/' + b] = []; }));
    for (let i = 0; i < NFREE; i++) {                // pedestrian-free approaches of 35 frames: when would each rule have braked?
      const d = L.drive(PROG, m, { thr: 1e9 }, SEEDS.free + i, { sh: SH, full: true });
      FA.forEach((_, f) => POL.forEach(([a, b]) => { freeKd[f + ':' + a + '/' + b].push(L.decide(d.scores.map((s) => s > thr[f]), a, b)); })); d.sit.xs = []; d.sit.rads = [];
    }
    return { FA: FA, thr: thr.map(r5), POL: POL, kd: rowsK, early: early, k0: k0, bits: bits, freeKd: freeKd, nFree: NFREE, nNeg: negS.length };
  }
};

function runJob(name) {
  if (!JOBS_FN[name]) throw new Error('unknown job ' + name);
  const t0 = Date.now(), res = JOBS_FN[name]();
  res.sec = +((Date.now() - t0) / 1000).toFixed(1);
  fs.mkdirSync(JOBS, { recursive: true });
  fs.writeFileSync(path.join(JOBS, name + '.json'), JSON.stringify(res));
  console.error('job ' + name + ' done in ' + res.sec + ' s');
}

function merge() {
  const J = (n) => JSON.parse(fs.readFileSync(path.join(JOBS, n + '.json'), 'utf8'));
  const A = J('strat-A'), B = J('strat-B'), S = J('strat-street'), N = J('nat'), WD = J('worlds'), P = J('pbin'), G = J('logs'), R = J('regime'), V = J('live'), F = J('free');
  const strat = { per: PER, seeds: A.seeds, kd: Object.assign({}, A.kd, B.kd) };
  const models = {}; ['bbba', 'q25u', 'aaaa'].forEach((id) => { const m = model(id); models[id] = { w: m.w, mu: m.mu, sd: m.sd, thr: r5(m.thr) }; });
  const exam = {}; DETS.forEach((id) => { exam[id] = examOf(id); });
  const out = { cfg: { v0: SH.v0, a: SH.a, tau: SH.tau, half: SH.half, dt: L.DT, m: L.POLICY.m, n: L.POLICY.n, bins: L.BINS, humanTau: L.HUMAN.tau, humanA: [L.HUMAN.aMin, L.HUMAN.aMax], see: L.HUMAN.see, programDyn: L.PROGRAM_DYN, streetDyn: L.STREET_DYN },
    dets: DETS, pbin: P.p, strat: strat, street: { kd: S.kd }, worlds: { per: WD.per, seeds: WD.seeds, kd: WD.kd }, nat: { seeds: N.seeds, kd: N.kd }, logs: G, regime: R.rows, live: V.seeds, frontier: F, models: models, exam: exam };
  const txt = '/* l11_data.js — generated by tools/chain/verify/engine/build_l11.js; never edited by hand.  SV.L11: the tables of Lesson 11 (what braking changes). */\n(function (root) {\n  var SV = root.SV; SV.L11 = ' +
    JSON.stringify(out) + ';\n})(typeof window !== \'undefined\' ? window : (typeof globalThis !== \'undefined\' ? globalThis : this));\n';
  fs.writeFileSync(path.join(root, 'l11_data.js'), txt);
  console.error('wrote l11_data.js (' + txt.length + ' bytes)');
}

function check() {
  require(path.join(root, 'l11_data.js'));
  const D = SV.L11; let bad = 0;
  const seeds = flat(D.strat.seeds), pick = [seeds[3], seeds[700]];
  pick.forEach((sd) => {
    const i = seeds.indexOf(sd), sit = L.situation(PROG, sd, SH), ep = L.episode(PROG, model('bbba'), POLICY('bbba'), sd, { sit: sit, sh: SH });
    if (ep.kDecide !== D.strat.kd.bbba[i]) { bad++; console.error('MISMATCH bbba seed ' + sd + ': ' + ep.kDecide + ' vs ' + D.strat.kd.bbba[i]); }
    const ep2 = L.episode(STREET, model('q25u'), POLICY('q25u'), sd, { sh: SH });
    if (ep2.kDecide !== D.street.kd.q25u[i]) { bad++; console.error('MISMATCH street q25u seed ' + sd); }
  });
  const wseeds = flat(D.worlds.seeds), wi = 1900, wsit = L.situation(PROG, wseeds[wi], SH);
  if (L.episode(PROG, model('bbba'), POLICY('bbba'), wseeds[wi], { sit: wsit, sh: SH }).kDecide !== D.worlds.kd.prog[wi]) { bad++; console.error('MISMATCH worlds prog'); }
  if (L.episode(STREET, model('bbba'), POLICY('bbba'), wseeds[wi], { sh: SH }).kDecide !== D.worlds.kd.street[wi]) { bad++; console.error('MISMATCH worlds street'); }
  const sd = SEEDS.logs + 17, sit = L.situation(PROG, sd, SH);
  if (L.firstSeen(sit, L.lastFrame(sit, SH)) !== D.logs.ks[17]) { bad++; console.error('MISMATCH logs ks'); }
  console.error(bad ? bad + ' mismatches' : 'check ok');
  process.exit(bad ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv[0] === '--job') runJob(argv[1]);
else if (argv[0] === '--merge') merge();
else if (argv[0] === '--check') check();
else if (require.main === module) {
  const queue = ['strat-A', 'strat-B', 'nat', 'free', 'worlds', 'strat-street', 'regime', 'logs', 'pbin', 'live'], running = [];
  let active = 0, failed = false;
  const next = () => {
    if (!queue.length) { if (!active) { if (failed) process.exit(1); merge(); } return; }
    const name = queue.shift(); active++;
    const p = spawn(process.execPath, [__filename, '--job', name], { stdio: 'inherit' });
    p.on('exit', (code) => { active--; if (code) { failed = true; console.error('job ' + name + ' failed'); } next(); });
  };
  next(); next();
}
