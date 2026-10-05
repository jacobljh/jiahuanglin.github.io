#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 07 (how much data: the coverage law).
 * Re-derives every number the lesson quotes without using layout_lab.js for the quoted values: its own demonstrations (BN.rollout with the expert), its own chunked tracker driven through
 * BN.rollout and BN.plant, a brute-force nearest layout (an argmin over the first N layouts) and a brute-force nearest frame.  Only the world's primitives (arm, posts, expert, rollout, plant)
 * come from bench.js; the experiment's definition is the head comment of layout_lab.js.  The page's engine is then run on the same draws and must agree with this code exactly, success count
 * for success count, and the page's widget must print what this code computes.  Closed forms (the Poisson coverage, the mean nearest distance of N uniform points) are checked against the measured curves.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const LL = require(path.join(root, dir, 'layout_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const R = (x, d) => +x.toFixed(d === undefined ? 3 : d);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const lsSlope = (xs, ys) => { const lx = xs.map(Math.log), ly = ys.map(Math.log), mx = mean(lx), my = mean(ly); let sxy = 0, sxx = 0; lx.forEach((x, i) => { sxy += (x - mx) * (ly[i] - my); sxx += (x - mx) * (x - mx); }); return sxy / sxx; };      // least-squares slope of log y on log x
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };

/* ───── the experiment, written out independently ───── */
const H = 16, K = 20, PLANT = { gain: 0.85, noise: 0.08 }, JIT = 0.01, LEV = 0.4, NMAX = 256, NDRAW = 64, DT = 0.05;
const world = (th) => BN.slalom.world(5, { shift: th[0], tilt: th[1] });
const dist = (a, b) => Math.abs(a[0] - b[0]) + LEV * Math.abs(a[1] - b[1]);
function layoutSeq(d, g) { const r = BN.rng(1000 + g), out = []; for (let i = 0; i < NMAX; i++) { const s = (2 * r() - 1) * 0.10, t = (2 * r() - 1) * 0.20; out.push([s, d === 1 ? 0 : t]); } return out; }
function cellGrid(d) { const th = [], ns = d === 1 ? 100 : 20, nt = d === 1 ? 1 : 16; for (let b = 0; b < nt; b++) for (let a = 0; a < ns; a++) th.push([-0.10 + (a + 0.5) * 0.20 / ns, d === 1 ? 0 : -0.20 + (b + 0.5) * 0.40 / nt]); return th; }
/* demonstration r of a layout: the expert's own calm run from a jittered start; the stored thing is its joint states */
let demosMade = 0, demosFailed = 0;
function demoStates(th, seed, r, jit) { const w = world(th), ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(seed * 16 + r + 1), { noise: 0, jit: jit === undefined ? JIT : jit }); demosMade++; if (!(ro.done && !ro.coll)) demosFailed++; return ro.S; }
function makeTable(th, seed, m, jit) { const runs = []; for (let r = 0; r < m; r++) runs.push(demoStates(th, seed, r, jit)); return { th, runs }; }
/* the policy: at every 16th step look for the stored frame nearest the arm (all frames of all demonstrations, brute force), then track the 16 poses that followed it with u = K (target - q) */
function copyRun(tab, th, seed, opt) {
  opt = opt || {};
  const w = world(th); if (opt.ghost) w.posts = [];                       // ghost posts: the run does not stop at a touch (used to follow the whole path)
  let cur = null, t0 = 0;
  const pol = (q, t) => {
    const j = t % H;
    if (j === 0) { let bd = Infinity; tab.runs.forEach((S, r) => { for (let i = 0; i < S.length - 1; i++) { const e = (S[i][0] - q[0]) ** 2 + (S[i][1] - q[1]) ** 2; if (e < bd) { bd = e; cur = S; t0 = i; } } }); }
    const tg = cur[Math.min(t0 + j + 1, cur.length - 1)];
    return [K * (tg[0] - q[0]), K * (tg[1] - q[1])];
  };
  const ro = BN.rollout(w, pol, BN.rng(seed), { plant: opt.noiseless ? { gain: PLANT.gain, noise: 0 } : PLANT, jit: opt.noiseless ? 0 : JIT });
  return ro;
}
const okRun = (ro) => ro.done && !ro.coll;
const tabSeed = (d, g, j) => (64 * d + g) * 256 + j;

/* the experiment for one draw: the success of every test cell for every N = 1..256 (m demonstrations per layout), by brute force over the first N layouts */
function sweepDraw(d, g, cells, m, memo) {
  const lay = layoutSeq(d, g), tabs = [], succ = new Array(NMAX + 1).fill(0), err = new Array(NMAX + 1).fill(0), nsucc = new Array(NMAX + 1).fill(0);
  const outcome = (c, j) => { const key = c * NMAX + j; if (memo[key] === undefined) { if (!tabs[j]) tabs[j] = makeTable(lay[j], tabSeed(d, g, j), m); memo[key] = okRun(copyRun(tabs[j], cells[c], 30000 + c)) ? 1 : 0; } return memo[key]; };
  for (let N = 1; N <= NMAX; N++) {
    let s = 0, e = 0;
    for (let c = 0; c < cells.length; c++) { let bk = 0, bd = Infinity; for (let j = 0; j < N; j++) { const dd = dist(lay[j], cells[c]); if (dd < bd) { bd = dd; bk = j; } } s += outcome(c, bk); e += bd; }
    nsucc[N] = s; succ[N] = s / cells.length; err[N] = e / cells.length;
  }
  return { succ, err, nsucc };
}
/* success of the first N layouts, m demonstrations each, from scratch (used for m > 1 and for the budget table) */
function successAt(d, g, N, m, cells, nlay) {
  const lay = (nlay || layoutSeq(d, g)), tabs = []; let s = 0;
  for (let c = 0; c < cells.length; c++) { let bk = 0, bd = Infinity; for (let j = 0; j < N; j++) { const dd = dist(lay[j], cells[c]); if (dd < bd) { bd = dd; bk = j; } } if (!tabs[bk]) tabs[bk] = makeTable(lay[bk], tabSeed(d, g, bk), m); s += okRun(copyRun(tabs[bk], cells[c], 30000 + c)) ? 1 : 0; }
  return s / cells.length;
}

const cellsOf = { 1: cellGrid(1), 2: cellGrid(2) };
const SW = {}; // per-draw sweeps at m = 1
for (const d of [1, 2]) { SW[d] = []; for (let g = 0; g < NDRAW; g++) SW[d].push(sweepDraw(d, g, cellsOf[d], 1, {})); }

/* the engine carries a copy of the expert, for speed: its stored demonstrations must be the oracle's (BN.rollout with the real expert) to the last bit */
{ let diff = 0, n = 0; const lay = layoutSeq(2, 0);
  for (let j = 0; j < 24; j++) { const tab = LL.addDemos(LL.table(lay[j], tabSeed(2, 0, j)), 3); for (let r = 0; r < 3; r++) { const S = demoStates(lay[j], tabSeed(2, 0, j), r); n++; if (S.length * 2 !== tab.S[r].length) { diff++; continue; } for (let t = 0; t < S.length; t++) if (S[t][0] !== tab.S[r][2 * t] || S[t][1] !== tab.S[r][2 * t + 1]) { diff++; break; } } }
  F.table_mismatch = diff; check(diff === 0, `the engine's demonstrations differ from the real expert's in ${diff} of ${n} cases`); }
/* the page's engine must agree, success count for success count, on every draw and every N */
for (const d of [1, 2]) {
  const cells = LL.cells(d); let mism = 0, errd = 0;
  check(cells.n === cellsOf[d].length && cells.th.every((c, i) => Math.abs(c[0] - cellsOf[d][i][0]) < 1e-12 && Math.abs(c[1] - cellsOf[d][i][1]) < 1e-12), `d=${d}: the engine's test cells are the oracle's`);
  for (let g = 0; g < NDRAW; g++) {
    const cv = new LL.Draw(d, g, cells).curve(1);
    for (let N = 1; N <= NMAX; N++) { if (Math.abs(cv.succ[N] - SW[d][g].succ[N]) > 1e-12) mism++; errd = Math.max(errd, Math.abs(cv.err[N] - SW[d][g].err[N])); }
  }
  F[`engine_mismatch_d${d}`] = mism;
  check(mism === 0, `d=${d}: the engine and the independent implementation disagree on ${mism} of ${NDRAW * NMAX} (draw, N) success values`);
  check(errd < 1e-12, `d=${d}: nearest-distance error differs between engine and oracle by ${errd}`);
}

/* ───── mean curves over the 32 draws, the numbers of §3 ───── */
const meanCurve = {}, meanErr = {}, sdCurve = {};
for (const d of [1, 2]) {
  meanCurve[d] = []; meanErr[d] = []; sdCurve[d] = [];
  for (let N = 0; N <= NMAX; N++) { meanCurve[d].push(mean(SW[d].map((x) => x.succ[N]))); meanErr[d].push(mean(SW[d].map((x) => x.err[N]))); sdCurve[d].push(sd(SW[d].map((x) => x.succ[N]))); }
}
const firstN = (m, level) => { for (let N = 1; N <= NMAX; N++) if (m[N] >= level) return N; return NaN; };
const POW2 = [1, 2, 4, 8, 16, 32, 64, 128, 256];
for (const d of [1, 2]) {
  for (const N of POW2) { F[`s${d}_${N}`] = R(meanCurve[d][N] * 100, 2); F[`e${d}_${N}`] = R(meanErr[d][N] * 100, 3); }
  F[`n90_${d}`] = firstN(meanCurve[d], 0.9); F[`n50_${d}`] = firstN(meanCurve[d], 0.5); F[`n99_${d}`] = firstN(meanCurve[d], 0.99);
  F[`slope${d}`] = R(lsSlope(POW2, POW2.map((N) => meanErr[d][N])), 4);
  F[`slope${d}_all`] = R(lsSlope(Array.from({ length: NMAX }, (_, i) => i + 1), meanErr[d].slice(1)), 3);
  F[`slope${d}_8up`] = R(lsSlope(Array.from({ length: NMAX - 7 }, (_, i) => i + 8), meanErr[d].slice(8)), 3);
}
F.sd2_96 = R(sdCurve[2][96] * 100, 2); F.sd2_n90 = R(sdCurve[2][F.n90_2] * 100, 2); F.sd1_n90 = R(sdCurve[1][F.n90_1] * 100, 2); F.sd1_8 = R(sdCurve[1][8] * 100, 2); F.sd2_16 = R(sdCurve[2][16] * 100, 2);
/* how many of the 32 sets reach 90 % at their own N90 */
F.sets90_2 = SW[2].filter((x) => x.succ[F.n90_2] >= 0.9).length; F.sets90_1 = SW[1].filter((x) => x.succ[F.n90_1] >= 0.9).length;
/* the spread of N90 between four groups of sixteen draws */
for (const d of [1, 2]) { const v = []; for (let k = 0; k < 4; k++) { const m = Array.from({ length: NMAX + 1 }, (_, N) => mean(SW[d].slice(16 * k, 16 * k + 16).map((x) => x.succ[N]))); v.push(firstN(m, 0.9)); } F[`n90_${d}_gmin`] = Math.min(...v); F[`n90_${d}_gmax`] = Math.max(...v); }
/* 64 more draws (the engine, whose agreement with this code was checked above): is the N90 of the first 64 draws typical? */
for (const d of [1, 2]) { const cells = LL.cells(d), cv = []; for (let g = NDRAW; g < 2 * NDRAW; g++) cv.push(new LL.Draw(d, g, cells).curve(1)); const m2 = Array.from({ length: NMAX + 1 }, (_, N) => mean(SW[d].concat(cv.map((c) => ({ succ: c.succ }))).map((x) => x.succ[N]))); F[`n90_${d}_128sets`] = firstN(m2, 0.9); check(Math.abs(F[`n90_${d}_128sets`] - F[`n90_${d}`]) <= 0.1 * F[`n90_${d}`] + 1, `d=${d}: N90 of the first 64 sets (${F[`n90_${d}`]}) is typical (128 sets: ${F[`n90_${d}_128sets`]})`); }

/* ───── §1: one layout's footprint ───── */
const tab0 = makeTable([0, 0], 777, 1);
const probe = (s, t, n, seed0) => { let ok = 0; for (let i = 0; i < n; i++) if (okRun(copyRun(tab0, [s, t], seed0 + i))) ok++; return ok / n * 100; };
for (const [k, s] of [['m2', -0.02], ['m15', -0.015], ['m1', -0.01], ['0', 0], ['p1', 0.01], ['p15', 0.015], ['p2', 0.02]]) F['fp_' + k] = R(probe(s, 0, 200, 20000), 1);
/* the engine's footprint, re-derived: 3 gust seeds (55000..) per lattice point, success in at least 2 (d = 2: shift step 0.25 cm, tilt step 0.01); 6 seeds, at least 3 (d = 1: step 0.1 cm) */
function footprintOracle(d) {
  const ds = d === 1 ? 0.001 : 0.0025, dt = 0.01, ms = Math.round(0.04 / ds), mt = d === 1 ? 0 : 12, ns = d === 1 ? 6 : 3; let n = 0, lo = Infinity, hi = -Infinity; const pts = [];
  for (let a = -ms; a <= ms; a++) for (let b = -mt; b <= mt; b++) { let h = 0; for (let k = 0; k < ns; k++) if (okRun(copyRun(tab0, [a * ds, b * dt], 55000 + k))) h++; if (2 * h >= ns) { n++; pts.push([a * ds, b * dt]); if (b === 0) { lo = Math.min(lo, a * ds); hi = Math.max(hi, a * ds); } } }
  return { n, area: n * (d === 1 ? ds : ds * dt), lo, hi, width: hi - lo + ds, pts };
}
const fpo = { 1: footprintOracle(1), 2: footprintOracle(2) }, fpe = { 1: LL.footprint(1), 2: LL.footprint(2) };
for (const d of [1, 2]) check(fpo[d].n === fpe[d].F.length && Math.abs(fpo[d].area - fpe[d].area) < 1e-12, `d=${d}: footprint from the engine (${fpe[d].F.length} points) differs from the independent probe (${fpo[d].n})`);
const V = { 1: 0.20, 2: 0.20 * 0.40 };
F.fp_lo = R((fpo[1].lo - 0.0005) * 100, 2); F.fp_hi = R((fpo[1].hi + 0.0005) * 100, 2); F.fp_w = R(fpo[1].width * 100, 2); F.fp_w2 = R(fpo[2].width * 100, 2);   // the edges are the borders of the footprint's 1 mm cells
F.fp_area = R(fpo[2].area * 100, 4);                                         // cm x tilt
F.share1 = R(fpo[1].area / V[1] * 100, 2); F.share2 = R(fpo[2].area / V[2] * 100, 2);
F.nc1 = R(V[1] / fpo[1].area, 2); F.nc2 = R(V[2] / fpo[2].area, 2);
F.poisson1 = R(Math.LN10 * F.nc1, 1); F.poisson2 = R(Math.LN10 * F.nc2, 1);
F.range_s = 20; F.ratio_s = R(0.20 / fpo[1].width, 2);
F.fp_tilt_w = R(fpo[2].area / fpo[1].width, 4); F.ratio_t = R(0.40 / F.fp_tilt_w, 2);
F.ratio_mult = R(F.nc2 / F.nc1, 2); F.rho = R(Math.sqrt(F.nc2), 2);
F.n90_x = R(F.n90_2 / F.n90_1, 1);
/* the share of the box one layout serves, as a count of test cells in a 20 x 16 grid: 3.1 percent of 320 is about 10 cells */
check(Math.abs(F.ratio_s * F.ratio_t - F.nc2) < 0.05 * F.nc2 + 1e-9, 'the box is as many footprints wide as the product of the two ratios (N_c of d=2 = ratio_s x ratio_t)');

/* the footprint predicts coverage: cell x is served by a layout lying at x - offset (inside the box) */
function predictOracle(d) {
  const f = fpo[d], cells = cellsOf[d], cellA = d === 1 ? 0.001 : 0.0025 * 0.01, a = cells.map((x) => { let c = 0; for (const o of f.pts) if (Math.abs(x[0] - o[0]) <= 0.10 && (d === 1 || Math.abs(x[1] - o[1]) <= 0.20)) c++; return c * cellA / V[d]; });
  return (N) => mean(a.map((p) => 1 - Math.pow(1 - p, N)));
}
const pred = { 1: predictOracle(1), 2: predictOracle(2) };
for (const d of [1, 2]) {
  const pe = LL.predict(fpe[d], LL.cells(d)); let gap = 0;
  for (const N of [1, 2, 4, 8, 16, 32, 64, 128, 256]) { check(Math.abs(pe.at(N) - pred[d](N)) < 1e-9, `d=${d}: engine and oracle footprint predictions differ at N=${N}`); if (N >= 3) gap = Math.max(gap, Math.abs(pred[d](N) - meanCurve[d][N])); }
  F[`pred_gap${d}`] = R(gap * 100, 2);
  check(gap < 0.06, `d=${d}: the footprint predicts the measured success curve to within 6 points for N >= 3 (worst gap ${(gap * 100).toFixed(2)})`);
  let pn = NaN; for (let N = 1; N <= 1000; N++) if (pred[d](N) >= 0.9) { pn = N; break; } F[`pred_n90_${d}`] = pn;
  F[`pred_s${d}_16`] = R(pred[d](16) * 100, 2); F[`pred_s${d}_64`] = R(pred[d](64) * 100, 2);
}
F.edge_x1 = R(F.n90_1 / F.poisson1, 2); F.edge_x2 = R(F.n90_2 / F.poisson2, 2);
F.pred_edge_x2 = R(F.pred_n90_2 / F.poisson2, 2);
/* closed form for the mean distance to the nearest of N uniform points: Gamma(1 + 1/d) (V / (c N))^(1/d), c = volume of the unit ball of the layout distance (cm and tilt) */
{ const c1 = 2, c2 = 1 / 20, g1 = 1, g2 = Math.sqrt(Math.PI) / 2;
  for (const N of [4, 16, 64, 256]) { F[`cf1_${N}`] = R(g1 * (20 / (c1 * N)), 3); F[`cf2_${N}`] = R(g2 * Math.sqrt(8 / (c2 * N)), 3); }
  for (const N of [16, 64, 256]) { check(Math.abs(F[`cf1_${N}`] - F[`e1_${N}`]) < 0.10 * F[`cf1_${N}`], `closed form for d=1 at N=${N}: ${F[`cf1_${N}`]} vs ${F[`e1_${N}`]}`); check(Math.abs(F[`cf2_${N}`] - F[`e2_${N}`]) < 0.10 * F[`cf2_${N}`], `closed form for d=2 at N=${N}: ${F[`cf2_${N}`]} vs ${F[`e2_${N}`]}`); } }

/* ───── §2: the error of copying a layout is the distance to it ───── */
function expertPathAt(th) { const w = world(th), ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(1), { noise: 0, jit: 0 }), X = ro.P.map((p) => p[0]), Y = ro.P.map((p) => p[1]); return (x) => { if (x <= X[0]) return Y[0]; if (x >= X[X.length - 1]) return Y[Y.length - 1]; let lo = 0, hi = X.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; } return Y[lo] + (Y[hi] - Y[lo]) * (x - X[lo]) / (X[hi] - X[lo]); }; }
function pathError(th0, th, seed, jit) {                                          // the gust-free cup path of the policy that copies th0, against the expert's own path on th: the worst vertical gap, in cm
  const tab = makeTable(th0, seed, 1, jit), ro = copyRun(tab, th, 1, { noiseless: true, ghost: true }), ey = expertPathAt(th); let e = 0;
  ro.P.forEach((p) => { e = Math.max(e, Math.abs(p[1] - ey(p[0]))); }); return e * 100;
}
const pairs = [['1 cm of shift', [0, 0], [0.01, 0]], ['2 cm of shift', [0, 0], [0.02, 0]], ['4 cm of shift', [0, 0], [-0.04, 0]], ['0.05 of tilt', [0, 0], [0, 0.05]], ['2 cm and 0.05', [0, 0], [0.02, 0.05]], ['2 cm and -0.05', [0, 0], [0.02, -0.05]], ['6 cm and 0.1', [0, 0], [-0.06, 0.10]]];
pairs.forEach((p, i) => { F[`pe_D${i}`] = R(dist(p[1], p[2]) * 100, 2); F[`pe_e${i}`] = R(pathError(p[1], p[2], 600 + i, 0), 2); check(Math.abs(F[`pe_e${i}`] - F[`pe_D${i}`]) < 0.5, `path error ${F[`pe_e${i}`]} cm against distance ${F[`pe_D${i}`]} cm (pair ${i})`); });
{ const rr = BN.rng(4242), ratios = [], gaps = [];
  for (let i = 0; i < 200; i++) {
    const A = [(2 * rr() - 1) * 0.1, (2 * rr() - 1) * 0.2], B = [Math.max(-0.1, Math.min(0.1, A[0] + (2 * rr() - 1) * 0.05)), Math.max(-0.2, Math.min(0.2, A[1] + (2 * rr() - 1) * 0.1))], D = dist(A, B) * 100;
    if (D < 1) continue; const e = pathError(A, B, 100 + i); ratios.push(e / D); gaps.push(Math.abs(e - D));
  }
  ratios.sort((x, y) => x - y); gaps.sort((x, y) => x - y);
  F.pe_n = ratios.length; F.pe_med = R(ratios[ratios.length >> 1], 3); F.pe_p5 = R(ratios[Math.floor(0.05 * ratios.length)], 3); F.pe_p95 = R(ratios[Math.floor(0.95 * ratios.length)], 3); F.pe_gap90 = R(gaps[Math.floor(0.9 * gaps.length)], 2); F.pe_gapmax = R(gaps[gaps.length - 1], 2);
  check(F.pe_med > 0.97 && F.pe_med < 1.03, 'the median error is the distance (ratio ' + F.pe_med + ')'); check(F.pe_gap90 < 2.5, 'nine pairs in ten are within 2.5 cm of error = distance (the demonstration starts 1 cm off its nominal start)'); }
/* a layout this far from the demonstrated one is not served; the success window of the footprint is where the error is below the clearance */
F.clear_cm = 1.55;
/* the expert can demonstrate every layout in the box, gust included */
{ let ok = 0; cellsOf[2].forEach((th, c) => { const w = world(th), ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(30000 + c), { noise: 0, jit: JIT }); if (okRun(ro)) ok++; }); F.expert_cells = R(ok / cellsOf[2].length * 100, 1); check(ok === cellsOf[2].length, 'the expert completes the course on every test layout of the box when recording a demonstration (calm)'); }
{ let steps = 0, n = 0; for (let j = 0; j < 40; j++) { const th = layoutSeq(2, 0)[j], S = demoStates(th, tabSeed(2, 0, j), 0); steps += S.length - 1; n++; } F.demo_s = R(steps / n * DT, 2); check(Math.abs(F.demo_s - 9.3) < 0.2, 'a demonstration takes about 9.3 s on any layout of the box (got ' + F.demo_s + ')'); }

/* ───── §3: aliasing at very small N: a layout 16 cm away serves a row shifted by twice the pass offset ───── */
{ const tab = makeTable([0.06, 0], 4242, 1); let far = 0, tot = 0; for (let c = 0; c < cellsOf[1].length; c++) { const x = cellsOf[1][c]; if (Math.abs(x[0] - 0.06) > 0.155) { tot++; if (okRun(copyRun(tab, x, 30000 + c))) far++; } } F.alias_far = far; F.alias_tot = tot; }

/* ───── §5: which data buy it ───── */
const M_LIST = [1, 2, 3, 5, 8];
{ const Nq = 64, row = {}; M_LIST.forEach((m) => { row[m] = mean(Array.from({ length: NDRAW }, (_, g) => m === 1 ? SW[2][g].succ[Nq] : successAt(2, g, Nq, m, cellsOf[2]))) * 100; F[`m64_${m}`] = R(row[m], 2); });
  F.m64_spread = R(Math.max(...M_LIST.map((m) => row[m])) - Math.min(...M_LIST.map((m) => row[m])), 2); check(F.m64_spread < 1.0, 'demonstrations per layout change success by less than a point at N = 64 (spread ' + F.m64_spread + ')'); }
{ const N1 = 16, row = {}; M_LIST.forEach((m) => { row[m] = mean(Array.from({ length: NDRAW }, (_, g) => m === 1 ? SW[1][g].succ[N1] : successAt(1, g, N1, m, cellsOf[1]))) * 100; F[`m16_${m}`] = R(row[m], 2); });
  F.m16_spread = R(Math.max(...M_LIST.map((m) => row[m])) - Math.min(...M_LIST.map((m) => row[m])), 2); check(F.m16_spread < 1.0, 'd=1: demonstrations per layout change success by less than a point at N = 16'); }
/* the same budget of 128 demonstrations, spent as N layouts x m demonstrations each (d = 2) */
const SPLIT = [[1, 128], [16, 8], [32, 4], [64, 2], [128, 1]], PR = { demo: 9.3, reset: 20, layout: 120 };
for (const [N, m] of SPLIT) { const v = mean(Array.from({ length: NDRAW }, (_, g) => m === 1 ? SW[2][g].succ[N] : successAt(2, g, N, m, cellsOf[2]))) * 100; F[`b_${N}_${m}`] = R(v, 2); F[`bh_${N}_${m}`] = R(N * (PR.layout + m * (PR.demo + PR.reset)) / 3600, 2); }
check(F.b_128_1 > F.b_64_2 && F.b_64_2 > F.b_32_4 && F.b_32_4 > F.b_16_8 && F.b_16_8 > F.b_1_128, 'at a fixed budget of demonstrations, more layouts always win');
check(F.b_128_1 - F.b_16_8 > 50, 'the same 128 demonstrations: 128 layouts beat 16 layouts by more than 50 points');
/* ... and the same budget of operator time (hours), not of demonstrations */
{ const hrs = F.bh_128_1, mm = 8, Nt = Math.floor(hrs * 3600 / (PR.layout + mm * (PR.demo + PR.reset))); F.timeq_N = Nt; F.timeq_h = R(Nt * (PR.layout + mm * (PR.demo + PR.reset)) / 3600, 2);
  F.timeq_s = R(mean(Array.from({ length: NDRAW }, (_, g) => successAt(2, g, Nt, mm, cellsOf[2]))) * 100, 2); check(F.b_128_1 > F.timeq_s + 10, 'at equal operator time, one demonstration per layout still beats eight'); }

/* ───── road not taken: choose the layouts instead of drawing them ───── */
function gridSet(d, gs, gt) { const L = []; for (let j = 0; j < gt; j++) for (let i = 0; i < gs; i++) L.push([-0.10 + (i + 0.5) * 0.20 / gs, d === 1 ? 0 : -0.20 + (j + 0.5) * 0.40 / gt]); return L; }
function gridSucc(d, L) { const tabs = L.map((th, k) => makeTable(th, 90000 + k, 1)); let s = 0; cellsOf[d].forEach((x, c) => { let bk = 0, bd = Infinity; L.forEach((th, k) => { const dd = dist(th, x); if (dd < bd) { bd = dd; bk = k; } }); if (okRun(copyRun(tabs[bk], x, 30000 + c))) s++; }); return s / cellsOf[d].length; }
{ const best = {}; for (let gs = 1; gs <= 14; gs++) { const v = gridSucc(1, gridSet(1, gs, 1)); best[gs] = { gs, gt: 1, v }; }
  let n = NaN; for (let N = 1; N <= 14; N++) if (best[N].v >= 0.9) { n = N; break; } F.grid_n90_1 = n; F.grid_s1_5 = R(best[5].v * 100, 1); F.grid_s1_6 = R(best[6].v * 100, 1); F.grid_gain_1 = R(F.n90_1 / n, 2); }
{ const best = {}; for (let gs = 2; gs <= 20; gs++) for (let gt = 2; gt <= 12; gt++) { const N = gs * gt; if (N < 30 || N > 70) continue; const v = gridSucc(2, gridSet(2, gs, gt)); if (!best[N] || v > best[N].v) best[N] = { gs, gt, v }; }
  const Ns = Object.keys(best).map(Number).sort((a, b) => a - b); let n = NaN, pick = null; for (const N of Ns) if (best[N].v >= 0.9) { n = N; pick = best[N]; break; }
  F.grid_n90_2 = n; F.grid_gs = pick.gs; F.grid_gt = pick.gt; F.grid_s2 = R(pick.v * 100, 1); F.grid_gain_2 = R(F.n90_2 / n, 2);
  const g99 = (() => { for (const N of Object.keys(best).map(Number).sort((a, b) => a - b)) if (best[N].v >= 0.99) return N; return NaN; })(); F.grid_n99_2_in_range = g99; }
check(F.grid_gain_1 > 2 && F.grid_gain_1 < 3.2 && F.grid_gain_2 > 1.8 && F.grid_gain_2 < 3.2, 'a deliberate grid saves about a factor ln 10 = 2.3 against random placement (' + F.grid_gain_1 + ', ' + F.grid_gain_2 + ')');

/* ───── §6: what ninety percent costs ───── */
F.price_demo = PR.demo; F.price_reset = PR.reset; F.price_layout = PR.layout; F.sec_layout_m1 = R(PR.layout + PR.demo + PR.reset, 1); F.sec_layout_m3 = R(PR.layout + 3 * (PR.demo + PR.reset), 1); F.sec_layout_m8 = R(PR.layout + 8 * (PR.demo + PR.reset), 1);
F.h_n90_m1 = R(F.n90_2 * F.sec_layout_m1 / 3600, 2); F.h_n90_m3 = R(F.n90_2 * F.sec_layout_m3 / 3600, 2); F.h_n90_m8 = R(F.n90_2 * F.sec_layout_m8 / 3600, 2); F.h_n90_d1_m1 = R(F.n90_1 * F.sec_layout_m1 / 3600, 2); F.min_n90_d1_m1 = R(F.n90_1 * F.sec_layout_m1 / 60, 0);
F.rt1_pace = R(130000 / 13 / 17, 1);                                         // demonstrations per robot-month (DERIVED from 130k, 13 robots, 17 months)
F.rt1_weeks_n90 = R(F.n90_2 / F.rt1_pace * 52 / 12, 2); F.rt1_weeks_n90x3 = R(3 * F.n90_2 / F.rt1_pace * 52 / 12, 2);
for (let k = 1; k <= 8; k++) { const n = Math.LN10 * Math.pow(F.rho, k); F[`k${k}_n90`] = Math.round(n); F[`k${k}_h`] = R(n * F.sec_layout_m1 / 3600, 1); F[`k${k}_wk`] = R(n * F.sec_layout_m1 / 3600 / 40, 1); F[`k${k}_rt1_mo`] = R(n / F.rt1_pace, 1); }
F.k10_n90 = Math.LN10 * Math.pow(F.rho, 10); F.k5_yr = R(F.k5_h / 40 / 52, 2); F.k6_yr = R(F.k6_h / 40 / 52, 2); F.k8_yr = R(F.k8_h / 40 / 52, 0);
F.k3_over_droid = R(F.k3_n90 / 564, 2); F.k6_over_rt1 = R(F.k6_n90 / 130000, 2);
check(F.k2_n90 > 70 && F.k2_n90 < 90, 'the Poisson formula at two numbers is near 78 (got ' + F.k2_n90 + ')');
F.mult_edge = R(F.n90_2 / F.n90_1, 2);

/* ───── further numbers the page quotes ───── */
F.demos_made = demosMade; F.demos_failed = demosFailed; check(demosFailed === 0, demosFailed + ' of ' + demosMade + ' calm demonstrations failed: the expert must be able to demonstrate every layout of the box');
for (const d of [1, 2]) for (const N of POW2) F[`pred_s${d}_${N}`] = R(pred[d](N) * 100, 2);
{ const w = world([0, 0]), ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(1), { noise: 0, jit: 0 }); let best = Infinity; ro.P.forEach((p) => w.posts.forEach((c) => { best = Math.min(best, Math.hypot(p[0] - c[0], p[1] - c[1])); })); F.clear_cm = R((best - 0.05) * 100, 2); check(F.clear_cm > 1 && F.clear_cm < 2.2, 'the expert path clears the posts by about 1.5 cm (got ' + F.clear_cm + ')'); }
{ const rho = 6, k = 4, n = Math.LN10 * Math.pow(rho, k); F.ck_n = Math.round(n); F.ck_h = R(n * F.sec_layout_m1 / 3600, 1); F.ck_wk = R(n * F.sec_layout_m1 / 3600 / 40, 1); F.ck_h8 = R(n * F.sec_layout_m8 / 3600, 1); F.ck_ratio8 = R(F.sec_layout_m8 / F.sec_layout_m1, 2); F.ck_pow = Math.pow(rho, k); F.ck_dem = R(F.ck_n / F.rt1_pace, 1); }
F.sets_n = NDRAW;
/* footprints differ from layout to layout (each rests on one demonstration, with its own start jitter): their size at the four corners of the box (layouts at +-8 cm, +-0.16), on the same lattice and seeds, against its size at the middle */
{ const area = (c, seed) => { const tab = makeTable(c, seed, 1); let n = 0; for (let a = -16; a <= 16; a++) for (let b = -12; b <= 12; b++) { let h = 0; for (let k = 0; k < 3; k++) if (okRun(copyRun(tab, [c[0] + a * 0.0025, c[1] + b * 0.01], 55000 + k))) h++; if (h >= 2) n++; } return n; };
  const cs = [[0.08, 0.16], [-0.08, 0.16], [0.08, -0.16], [-0.08, -0.16]].map((c, i) => area(c, 5000 + i)); F.corner_share = R(mean(cs) / fpo[2].n * 100, 0); F.corner_min = R(Math.min(...cs) / fpo[2].n * 100, 0); F.corner_max = R(Math.max(...cs) / fpo[2].n * 100, 0);
  check(F.corner_min > 80 && F.corner_max < 125, 'footprints at the corners are within about a tenth of the central size, one way or the other (' + F.corner_min + '-' + F.corner_max + ' %)'); }
{ const at = (ds) => { let ok = 0; for (let i = 0; i < 100; i++) if (okRun(copyRun(tab0, [ds, 0], 40000 + i))) ok++; return ok; }; F.alias_m20 = at(-0.20); F.alias_m10 = at(-0.10);
  check(F.alias_m20 >= 95 && F.alias_m10 <= 5, 'a row moved down by 20 cm is served by the unmoved layout (the path threads the swapped posts), at 10 cm it is not'); }
check(F.s1_1 > F.pred_s1_1 + 5 && F.s1_4 < F.pred_s1_4 + 1 && F.s2_4 < F.pred_s2_4 + 1, 'the far-end bonus exists at N = 1 and is gone by N = 4');
{ const w = world([0.10, 0.20]), ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(1), { noise: 0, jit: 0 }); F.reach_corner = R(Math.max(...ro.P.map((p) => Math.hypot(p[0], p[1]))), 3); check(F.reach_corner > 0.9 && F.reach_corner < 1.0, 'the top corner of the box is near but inside the arm\'s reach'); }
F.set0_s2_16 = R(SW[2][0].succ[16] * 100, 1); F.set0_s2_16_m8 = R(successAt(2, 0, 16, 8, cellsOf[2]) * 100, 1); F.h_128_m8 = R(128 * F.sec_layout_m8 / 3600, 1); F.h_128_m1 = R(128 * F.sec_layout_m1 / 3600, 1);
for (const d of [1, 2]) F[`n95_${d}`] = firstN(meanCurve[d], 0.95);
F.alias_bonus1 = R(F.s1_1 - F.pred_s1_1, 1); F.alias_bonus2 = R(F.s2_1 - F.pred_s2_1, 1);
/* why the footprint's curve runs above the measured one: (a) the policy copies the nearest layout, which is not always one whose footprint holds the cell; (b) the footprint is not the same everywhere */
{ const FS = new Set(fpo[2].pts.map((o) => Math.round(o[0] / 0.0025) + ',' + Math.round(o[1] / 0.01))), inF = (a, b) => FS.has(Math.round((a[0] - b[0]) / 0.0025) + ',' + Math.round((a[1] - b[1]) / 0.01));
  for (const [tag, N] of [['64', 64], ['n90', F.n90_2]]) {
    let ideal = 0, near = 0;
    for (let g = 0; g < NDRAW; g++) { const lay = layoutSeq(2, g); let si = 0, sn = 0; cellsOf[2].forEach((x) => { let any = false, bk = 0, bd = Infinity; for (let j = 0; j < N; j++) { if (inF(x, lay[j])) any = true; const dd = dist(lay[j], x); if (dd < bd) { bd = dd; bk = j; } } if (any) si++; if (inF(x, lay[bk])) sn++; }); ideal += si / cellsOf[2].length; near += sn / cellsOf[2].length; }
    F[`dec_ideal_${tag}`] = R(ideal / NDRAW * 100, 1); F[`dec_near_${tag}`] = R(near / NDRAW * 100, 1); F[`dec_meas_${tag}`] = R(meanCurve[2][N] * 100, 1);
    check(F[`dec_ideal_${tag}`] >= F[`dec_near_${tag}`] && F[`dec_near_${tag}`] >= F[`dec_meas_${tag}`] - 0.5, 'ideal >= nearest-in-footprint >= measured at N = ' + N);
  } }

check(F.n90_1 >= F.poisson1 && F.n90_2 >= F.poisson2, 'the edges only add: N90 is at least ln 10 V / A');
check(Math.abs(F.slope1 + 1) < 0.08 && Math.abs(F.slope2 + 0.5) < 0.05, 'the fitted exponents are -1/d: ' + F.slope1 + ', ' + F.slope2);
check(F.s2_256 < 99 && F.n95_2 > 100 && F.n95_2 < 200 && F.n90_2 > 90 && F.n90_2 < 120 && F.n90_1 > 10 && F.n90_1 < 20, 'N90 is about a hundred for two numbers and about fifteen for one; 99 % is out of reach at 256 layouts');
check(F.grid_n90_1 <= 8 && F.grid_n90_2 >= 40 && F.grid_n90_2 <= 50, 'a grid reaches 90 % with about 6 and 45 layouts');
check(F.n90_x > 5 && F.n90_x < 9, 'the second number multiplies the layouts for 90 % by 5 to 9');

/* ───── the page's widget prints what this code computes ───── */
const html = path.join(root, dir, '07_how_much_data_coverage.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const kOf = (N) => { let best = 0, bd = 1e9; for (let k = 0; k <= 128; k++) { const dd = Math.abs(Math.round(Math.pow(2, k / 16)) - N); if (dd < bd) { bd = dd; best = k; } } return best; };
  const nOf = (k) => Math.round(Math.pow(2, k / 16));
  const state = (d, N, m) => { pg.set('w07-d', String(d)); pg.set('w07-n', kOf(N)); pg.set('w07-m', m); pg.drain(); return nOf(kOf(N)); };
  const probe = (d, N, m, tag) => {
    const Nw = state(d, N, m), sw = d === 1 ? SW[1] : SW[2];
    eqd('w07-n-v', Nw, 0, tag + ' layouts'); eqd('w07-total', Nw * m, 0, tag + ' demonstrations in total');
    const own = m === 1 ? sw[0].succ[Nw] : successAt(d, 0, Nw, m, cellsOf[d]);
    eqd('w07-succ', own * 100, 1, tag + ' success of this set');
    eqd('w07-mean', meanCurve[d][Nw] * 100, 1, tag + ' mean success'); eqd('w07-sd', sdCurve[d][Nw] * 100, 1, tag + ' spread between sets');
    eqd('w07-err', meanErr[d][Nw] * 100, 2, tag + ' mean distance'); eqd('w07-hours', Nw * (PR.layout + m * (PR.demo + PR.reset)) / 3600, 1, tag + ' operator hours');
  };
  probe(2, 16, 1, 'default'); probe(2, 64, 1, 'd=2 N=64'); probe(2, 64, 3, 'd=2 N=64 m=3'); probe(2, 128, 1, 'd=2 N=128'); probe(2, 256, 1, 'd=2 N=256'); probe(2, 1, 1, 'd=2 N=1'); probe(2, 16, 8, 'd=2 N=16 m=8');
  probe(1, 8, 1, 'd=1 N=8'); probe(1, 16, 1, 'd=1 N=16'); probe(1, 16, 8, 'd=1 N=16 m=8'); probe(1, 1, 1, 'd=1 N=1');
  for (const d of [1, 2]) { pg.set('w07-d', String(d)); pg.drain(); eqd('w07-n90', F[`n90_${d}`], 0, `d=${d} N90`); eqd('w07-poisson', F[`poisson${d}`], 1, `d=${d} Poisson N90`); eqd('w07-slope', F[`slope${d}`], 2, `d=${d} fitted exponent`); eqd('w07-share', F[`share${d}`], 1, `d=${d} share of the box`); }
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
