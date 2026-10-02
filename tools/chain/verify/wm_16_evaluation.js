#!/usr/bin/env node
/* Oracle for World Models lesson 16, "The exam we never stopped taking: evaluation".
 *
 * Everything the lesson quotes is re-derived here from the lesson's own definitions, NOT with the engine's code (l16_zoo.js), apart from the lesson-3 instruments that
 * the atlas rows 1-2 name (l03_state.js) and the shared simulator (courtyard.js).  The independent zoo below re-implements, from the head comment of the engine:
 *   - the logs (trial generator with the same draw order), the random tanh features, the bootstrap ensemble, the ridge fit (normal equations + a Cholesky solve, not CY.la.ridge),
 *   - the held-out error, the coverage of the 90 % intervals, the intervention error, the planner (best of the first K candidates by imagined miss, run in the true world),
 *     the imagined success, the success judged by the other half of the ensemble, the support share, Kendall's tau-b;
 *   - then it checks that the engine's zoo (the one the page runs) gives the same numbers, to the last digit shown.
 * Independent checks of the prose: the confounded log's regression slope against the closed form B s_u^2 / (s_u^2 + kappa^2 s_w^2); the exact planner's success curve against
 * 1 - (1 - p)^K; the binomial power formula against simulation; the rule of three against simulation; the evaluator arithmetic; the bag invariance of identical balls;
 * the atlas miniatures (each exam's blind spot, measured).  Then the page's own widget is driven into the states the prose describes.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const ZO = require(path.join(DIR, 'l16_zoo.js'));
const L3 = require(path.join(DIR, 'l03_state.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
const HEAVY = !process.env.ORACLE_QUICK;                    // development only: ORACLE_QUICK=1 skips the multi-zoo analyses
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const quant = (a, f) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const nNeed = (p1, p2) => { const pb = (p1 + p2) / 2; return Math.pow(1.959964 * Math.sqrt(2 * pb * (1 - pb)) + 0.841621 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / ((p1 - p2) ** 2); };   // launches per policy: two-sided 5 %, power 80 %
const t0 = () => process.hrtime.bigint(), msSince = t => Number(process.hrtime.bigint() - t) / 1e6;

/* ══════════════ 1. the task and an independent zoo ══════════════ */
const TA = 12, TF = 80, KM = 128, NDEC = 100, NDO = 300, NOWN = 200, E = 4, W0 = CY.world({});
const GOALS = [{ x: 6.6, y: 2.5, r: 0.5 }, { x: 4.0, y: 1.2, r: 0.5 }];
const SCL = [1 / 8, 1 / 5, 1 / 3, 1 / 3, 1 / 3, 1 / 3];
const RECIPES = [
  { id: 'tiny', M: 8, n: 500, rho: 3 }, { id: 'small', M: 24, n: 500, rho: 3 }, { id: 'mid', M: 64, n: 500, rho: 3 }, { id: 'twin', M: 64, n: 500, rho: 3, twin: 1 },
  { id: 'big', M: 128, n: 500, rho: 3 }, { id: 'scarce', M: 64, n: 100, rho: 3 }, { id: 'plenty', M: 64, n: 2000, rho: 3 }, { id: 'cautious', M: 64, n: 500, rho: 1.2 },
  { id: 'narrow', M: 64, n: 500, rho: 0.5 }, { id: 'weighted', M: 64, n: 500, rho: 3, weighted: 1 }, { id: 'confound', M: 64, n: 500, rho: 0.3, wind: 0.05 }, { id: 'bigcaut', M: 128, n: 500, rho: 1.2 }
];
const NAMES = ['tiny', 'small', 'mid', 'twin', 'big', 'scarce', 'plenty', 'cautious', 'narrow', 'weighted', 'confounded', 'big-cautious'];
const IDX = {}; RECIPES.forEach((r, i) => { IDX[r.id] = i; });
ok('the engine lists the same twelve recipes', JSON.stringify(ZO.RECIPES.map(r => ({ id: r.id, M: r.M, n: r.n, rho: r.rho, twin: r.twin, wind: r.wind, weighted: r.weighted }))) === JSON.stringify(RECIPES.map(r => ({ id: r.id, M: r.M, n: r.n, rho: r.rho, twin: r.twin, wind: r.wind, weighted: r.weighted }))));

const dstep = (w, s) => CY.step(w, s, null);
function atNudge(w, s) { for (let t = 0; t < TA; t++) s = dstep(w, s); return s; }
function endOf(w, s, a) { let q = CY.step(w, s, a); for (let u = 0; u < TF; u++) q = dstep(w, q); return q; }
function discNudge(r, rho) { const th = 2 * Math.PI * r(); const rad = rho * Math.sqrt(r()); return [rad * Math.cos(th), rad * Math.sin(th)]; }
/* the wind and the nudge in a floor with no walls in reach: finite differences with steps different from the engine's, and the closed form of the nudge */
const BIG = CY.world({ W: 1e3, H: 1e3, curtain: null });
const dBig = (wind, a) => { const w = wind ? CY.world({ W: 1e3, H: 1e3, curtain: null, wind: [wind, 0] }) : BIG; return endOf(w, [500, 500, 1.5, 0], a)[0]; };
const Bfd = (dBig(0, [0.5, 0]) - dBig(0, [-0.5, 0])) / 1.0, Cfd = (dBig(0.01, null) - dBig(-0.01, null)) / 0.02;
const Dcoef = Math.exp(-W0.gamma * W0.dt), Bclosed = (1 - Math.pow(Dcoef, TF + 1)) / W0.gamma;
ok('nudge gain B = (1 - d^81) / gamma', close(Bfd, Bclosed, 1e-7), [Bfd, Bclosed]);
const KAPPA = Cfd / Bfd; facts.kappa = KAPPA; facts.B_gain = Bfd; facts.C_gain = Cfd;
ok('engine kappa agrees', close(ZO.KAPPA, KAPPA, 1e-6), [ZO.KAPPA, KAPPA]);

function trialsOf(n, seed, rc) {
  const r = CY.rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const g = rc.wind ? rc.wind * CY.randn(r) : 0;
    const w = rc.wind ? CY.world({ wind: [g, 0] }) : W0;
    const s0 = CY.launch(W0, r);
    const s = atNudge(w, s0);
    let a = discNudge(r, rc.rho);
    if (rc.wind) a = [a[0] - KAPPA * g, a[1]];
    out.push({ s, a, e: endOf(w, s, a), g });
  }
  return out;
}
function phiOf(f, s, a) {
  const x = [s[0] * SCL[0], s[1] * SCL[1], s[2] * SCL[2], s[3] * SCL[3], a[0] * SCL[4], a[1] * SCL[5]], phi = new Float64Array(f.M + 7);
  phi[0] = 1; for (let k = 0; k < 6; k++) phi[1 + k] = x[k];
  for (let j = 0; j < f.M; j++) { let z = f.c[j]; for (let k = 0; k < 6; k++) z += f.R[j][k] * x[k]; phi[7 + j] = Math.tanh(z); }
  return phi;
}
function cholSolve(A, B, n, m) {                       // solve A X = B, A symmetric positive definite (n x n), B (n x m); Cholesky A = L L^T
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (s <= 0) throw new Error('not positive definite'); L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
  }
  const X = new Float64Array(n * m);
  for (let c = 0; c < m; c++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = B[i * m + c]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * X[k * m + c]; X[i * m + c] = s / L[i * n + i]; }
  }
  return X;
}
function relevance(s, a) {
  const k = (1 - Math.exp(-0.35 * 0.1 * 81)) / 0.35, x = s[0] + k * (s[2] + a[0]), y = s[1] + k * (s[3] + a[1]);
  return 1 + 6 * Math.exp(-0.5 * (((x - 6.6) / 1.5) ** 2 + ((y - 2.5) / 1.5) ** 2));
}
function fitModel(rc, zs, nOverride, MOverride) {
  const n = nOverride || rc.n, M = MOverride || rc.M, p = M + 7;
  const data = trialsOf(n, 1000 * zs + 17 + (rc.twin ? 500 : 0), rc);
  const fr = CY.rng(100 * zs + 5 + M + (rc.twin ? 77 : 0)), f = { M, R: [], c: [] };
  for (let j = 0; j < M; j++) { const row = []; for (let k = 0; k < 6; k++) row.push(2 * CY.randn(fr)); f.R.push(row); f.c.push(CY.randn(fr)); }
  const Phi = data.map(d => phiOf(f, d.s, d.a)), Y = data.map(d => [d.e[0] / 8, d.e[1] / 5]);
  const wt = data.map(d => rc.weighted ? relevance(d.s, d.a) : 1);
  const Ws = [];
  for (let e = 0; e < E; e++) {
    const br = CY.rng(7000 * zs + 31 * e + M + (rc.twin ? 9 : 0)), mult = new Float64Array(n);
    for (let i = 0; i < n; i++) mult[Math.floor(br() * n)] += 1;
    const G = new Float64Array(p * p), B = new Float64Array(p * 2);
    for (let i = 0; i < n; i++) {
      const w = mult[i] * wt[i]; if (w === 0) continue;
      const ph = Phi[i];
      for (let a = 0; a < p; a++) { const wa = w * ph[a]; for (let b = 0; b <= a; b++) G[a * p + b] += wa * ph[b]; B[a * 2] += wa * Y[i][0]; B[a * 2 + 1] += wa * Y[i][1]; }
    }
    for (let a = 0; a < p; a++) { for (let b = a + 1; b < p; b++) G[a * p + b] = G[b * p + a]; G[a * p + a] += 1e-3; }
    Ws.push(cholSolve(G, B, p, 2));
  }
  let rlog = 0; for (const d of data) rlog = Math.max(rlog, Math.hypot(d.a[0], d.a[1]));
  return { rc, f, Ws, p, rlog, data };
}
function ask(m, s, a) {                                     // member endings and their mean
  const ph = phiOf(m.f, s, a), mem = [];
  for (let e = 0; e < E; e++) { let x = 0, y = 0; const W = m.Ws[e]; for (let j = 0; j < m.p; j++) { x += ph[j] * W[j * 2]; y += ph[j] * W[j * 2 + 1]; } mem.push([8 * x, 5 * y]); }
  return { mem, mean: [mem.reduce((s, q) => s + q[0], 0) / E, mem.reduce((s, q) => s + q[1], 0) / E] };
}
/* benchmark sets */
function makeSet(N, seed) {
  const r = CY.rng(seed), L = [], A = [], rc = CY.rng(77);
  for (let i = 0; i < N; i++) L.push(atNudge(W0, CY.launch(W0, r)));
  for (let k = 0; k < KM; k++) A.push(discNudge(rc, 3));
  const TE = new Float64Array(N * KM * 2);
  for (let i = 0; i < N; i++) for (let k = 0; k < KM; k++) { const e = endOf(W0, L[i], A[k]); TE[(i * KM + k) * 2] = e[0]; TE[(i * KM + k) * 2 + 1] = e[1]; }
  return { N, L, A, TE };
}
const BM = makeSet(NDEC, 5);
const DO = []; { const r = CY.rng(99); for (let i = 0; i < NDO; i++) { const s = atNudge(W0, CY.launch(W0, r)), a = discNudge(r, 3); DO.push({ s, a, e: endOf(W0, s, a) }); } }
function table(m, S) {                                       // predicted endings of every (launch, candidate): mean and members
  const PE = new Float64Array(S.N * KM * 2), PM = []; for (let e = 0; e < E; e++) PM.push(new Float64Array(S.N * KM * 2));
  for (let i = 0; i < S.N; i++) for (let k = 0; k < KM; k++) { const q = ask(m, S.L[i], S.A[k]), o = (i * KM + k) * 2; PE[o] = q.mean[0]; PE[o + 1] = q.mean[1]; for (let e = 0; e < E; e++) { PM[e][o] = q.mem[e][0]; PM[e][o + 1] = q.mem[e][1]; } }
  return { PE, PM };
}
/* best of the first K by imagined miss: cumulative curves over K = 1..128 of real hits, imagined hits, picks beyond rlog and (optionally) hits as judged by table J */
function planCurves(P, S, goal, rlog, J) {
  const real = new Float64Array(KM), imag = new Float64Array(KM), out = new Float64Array(KM), jud = new Float64Array(KM);
  for (let i = 0; i < S.N; i++) {
    let best = Infinity, bi = -1;
    for (let k = 0; k < KM; k++) {
      const dm = Math.hypot(P[(i * KM + k) * 2] - goal.x, P[(i * KM + k) * 2 + 1] - goal.y);
      if (dm < best) { best = dm; bi = k; }
      const rm = Math.hypot(S.TE[(i * KM + bi) * 2] - goal.x, S.TE[(i * KM + bi) * 2 + 1] - goal.y);
      if (rm < goal.r) real[k] += 1 / S.N;
      if (best < goal.r) imag[k] += 1 / S.N;
      if (rlog !== undefined && Math.hypot(S.A[bi][0], S.A[bi][1]) > rlog) out[k] += 1 / S.N;
      if (J && Math.hypot(J[(i * KM + bi) * 2] - goal.x, J[(i * KM + bi) * 2 + 1] - goal.y) < goal.r) jud[k] += 1 / S.N;
    }
  }
  return { real, imag, out, jud };
}
function avgTab(A, B) { const o = new Float64Array(A.length); for (let i = 0; i < o.length; i++) o[i] = 0.5 * (A[i] + B[i]); return o; }
function tauB(x, y) {
  let c = 0, d = 0, tx = 0, ty = 0; const n = x.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]);
    if (a === 0 && b === 0) continue; if (a === 0) { tx++; continue; } if (b === 0) { ty++; continue; }
    if (a === b) c++; else d++;
  }
  return (c - d) / Math.sqrt((c + d + tx) * (c + d + ty));
}
/* a whole zoo: models, grades on the benchmark, curves for both goals */
function buildZoo(zs) {
  const models = RECIPES.map(rc => fitModel(rc, zs)), G = [];
  models.forEach((m, j) => {
    const own = trialsOf(NOWN, 50000 + zs, m.rc); let se = 0, cov = 0;
    for (const d of own) {
      const q = ask(m, d.s, d.a), sdx = Math.sqrt(q.mem.reduce((s, x) => s + (x[0] - q.mean[0]) ** 2, 0) / E), sdy = Math.sqrt(q.mem.reduce((s, x) => s + (x[1] - q.mean[1]) ** 2, 0) / E);
      se += (q.mean[0] - d.e[0]) ** 2 + (q.mean[1] - d.e[1]) ** 2;
      if (Math.abs(q.mean[0] - d.e[0]) <= 1.645 * sdx) cov++;
      if (Math.abs(q.mean[1] - d.e[1]) <= 1.645 * sdy) cov++;
    }
    let sd = 0; for (const d of DO) { const q = ask(m, d.s, d.a).mean; sd += (q[0] - d.e[0]) ** 2 + (q[1] - d.e[1]) ** 2; }
    const T = table(m, BM), g = { own: Math.sqrt(se / own.length), cov: cov / (2 * own.length), dox: Math.sqrt(sd / NDO), T, plan: [], jud: [] };
    for (const goal of GOALS) {
      g.plan.push(planCurves(T.PE, BM, goal, m.rlog));
      g.jud.push(planCurves(avgTab(T.PM[0], T.PM[1]), BM, goal, undefined, avgTab(T.PM[2], T.PM[3])));
    }
    G.push(g);
  });
  return { zs, models, G };
}
/* score of rung r (0 own, 1 cal, 2 dox, 3 img, 4 jud), oriented so that larger = better ranked */
function rungScore(Z, r, j, K, gi) {
  const g = Z.G[j];
  return r === 0 ? -g.own : r === 1 ? -Math.abs(100 * g.cov - 90) : r === 2 ? -g.dox : r === 3 ? g.plan[gi].imag[K - 1] : g.jud[gi].jud[K - 1];
}
function tauRung(Z, r, K, gi) { return tauB(Z.G.map((g, j) => rungScore(Z, r, j, K, gi)), Z.G.map(g => g.plan[gi].real[K - 1])); }

/* ══════════════ 2. the displayed zoo (seed 2): independent against the engine ══════════════ */
const ZS = 2, K64 = 64;
let T0 = t0(); const Z = buildZoo(ZS); console.error('independent zoo built in', msSince(T0).toFixed(0), 'ms');
T0 = t0(); const S = ZO.session(ZS); console.error('engine session built in', msSince(T0).toFixed(0), 'ms');
{
  let worst = 0;
  for (let j = 0; j < 12; j++) {
    const g = S.zoo.grades[j];
    worst = Math.max(worst, Math.abs(g.own - Z.G[j].own), Math.abs(g.cov - Z.G[j].cov), Math.abs(g.dox - Z.G[j].dox) / 10);
    for (let gi = 0; gi < 2; gi++) for (let K = 1; K <= 128; K++) {
      worst = Math.max(worst, Math.abs(S.plan[gi][j].real[K - 1] - Z.G[j].plan[gi].real[K - 1]), Math.abs(S.plan[gi][j].imag[K - 1] - Z.G[j].plan[gi].imag[K - 1]), Math.abs(S.jud[gi][j].judged[K - 1] - Z.G[j].jud[gi].jud[K - 1]));
    }
  }
  ok('the engine zoo and the independent zoo agree on every exam, goal and budget', worst < 1e-6, worst);
}
const NM = j => NAMES[j];
const real64 = j => 100 * Z.G[j].plan[0].real[K64 - 1];
for (let j = 0; j < 12; j++) {
  const id = RECIPES[j].id;
  facts['own_' + id] = Z.G[j].own; facts['real64_' + id] = real64(j); facts['imag64_' + id] = 100 * Z.G[j].plan[0].imag[K64 - 1];
  facts['dox_' + id] = Z.G[j].dox; facts['cov_' + id] = 100 * Z.G[j].cov; facts['jud64_' + id] = 100 * Z.G[j].jud[0].jud[K64 - 1];
  facts['real64m_' + id] = 100 * Z.G[j].plan[1].real[K64 - 1]; facts['real128_' + id] = 100 * Z.G[j].plan[0].real[127]; facts['imag128_' + id] = 100 * Z.G[j].plan[0].imag[127];
  facts['out64_' + id] = 100 * Z.G[j].plan[0].out[K64 - 1];
}
{ // exact planner
  const ex = gi => planCurves(BM.TE, BM, GOALS[gi]);
  const e0 = ex(0), e1 = ex(1);
  facts.exact1 = 100 * e0.real[0]; facts.exact16 = 100 * e0.real[15]; facts.exact64 = 100 * e0.real[63]; facts.exact128 = 100 * e0.real[127]; facts.exact64_moved = 100 * e1.real[63]; facts.exact128_moved = 100 * e1.real[127];
  for (let j = 0; j < 12; j++) { const eng = S.ex; ok('exact curve agrees with the engine', close(eng[0].real[63], e0.real[63], 1e-9) && close(eng[1].real[127], e1.real[127], 1e-9)); }
  // the exact curve against 1 - (1 - p)^K, p = share of candidates that really hit (all launches)
  let hits = 0; for (let i = 0; i < NDEC; i++) for (let k = 0; k < KM; k++) if (Math.hypot(BM.TE[(i * KM + k) * 2] - 6.6, BM.TE[(i * KM + k) * 2 + 1] - 2.5) < 0.5) hits++;
  const p = hits / (NDEC * KM); facts.p_cand = 100 * p; facts.k_formula64 = 100 * (1 - Math.pow(1 - p, 64)); facts.k_formula16 = 100 * (1 - Math.pow(1 - p, 16));
  ok('exact planner follows 1 - (1 - p)^K within 8 points at K = 16 and 64', Math.abs(facts.exact64 - facts.k_formula64) < 8 && Math.abs(facts.exact16 - facts.k_formula16) < 10, [facts.exact64, facts.k_formula64, facts.exact16, facts.k_formula16]);
}
/* A/A control, extremes */
facts.twin_gap = Math.abs(real64(IDX.twin) - real64(IDX.mid)); facts.twin_own_ratio = Z.G[IDX.twin].own / Z.G[IDX.mid].own;
{ // the pair
  let pretty = 0, useful = 0; for (let j = 1; j < 12; j++) { if (Z.G[j].own < Z.G[pretty].own) pretty = j; if (Z.G[j].plan[0].real[63] > Z.G[useful].plan[0].real[63]) useful = j; }
  ok('the best held-out error is narrow, the best decision is big', pretty === IDX.narrow && useful === IDX.big, [NM(pretty), NM(useful)]);
  facts.pair_own_ratio = Z.G[useful].own / Z.G[pretty].own; facts.pair_real_gap = real64(useful) - real64(pretty); facts.pair_dox_ratio = Z.G[pretty].dox / Z.G[useful].dox;
  facts.pair_n = ZO.nNeeded(Z.G[pretty].plan[0].real[63], Z.G[useful].plan[0].real[63]);
  const p1 = Z.G[pretty].plan[0].real[63], p2 = Z.G[useful].plan[0].real[63], pb = (p1 + p2) / 2;
  const nn = Math.pow(1.959964 * Math.sqrt(2 * pb * (1 - pb)) + 0.841621 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / ((p1 - p2) ** 2);
  ok('launches needed for the displayed pair: engine = independent formula', close(facts.pair_n, nn, 1e-9), [facts.pair_n, nn]);
  facts.pair_n = nn; facts.pair_n_ceil = Math.ceil(nn);
  facts.pair_se = 100 * Math.sqrt(p2 * (1 - p2) / NDEC);
}
{ const byOwn = Z.G.map((g, j) => j).sort((x, y) => Z.G[x].own - Z.G[y].own);
  ok('narrow is first and big fifth by held-out error', byOwn[0] === IDX.narrow && byOwn.indexOf(IDX.big) === 4, byOwn.map(NM));
  ok('confounded has the third lowest held-out error and the worst error under nudges set by fiat', byOwn.indexOf(IDX.confound) === 2 && Z.G.every(g => g.dox <= Z.G[IDX.confound].dox), byOwn.map(NM));
  const byDec = Z.G.map((g, j) => j).sort((x, y) => Z.G[y].plan[0].real[63] - Z.G[x].plan[0].real[63]);
  ok('big has the best decision at K = 64', byDec[0] === IDX.big, byDec.map(NM)); }
facts.narrow_dox_over_own = Z.G[IDX.narrow].dox / Z.G[IDX.narrow].own;
facts.twin_mid_n = Math.ceil(nNeed(Z.G[IDX.twin].plan[0].real[63], Z.G[IDX.mid].plan[0].real[63]));
function pickOf(j, i, K, gi) {                                  // the planner's pick for launch i: the imagined miss it reports and the real miss it gets
  const P = Z.G[j].T.PE, g = GOALS[gi]; let best = Infinity, bi = 0;
  for (let k = 0; k < K; k++) { const dm = Math.hypot(P[(i * KM + k) * 2] - g.x, P[(i * KM + k) * 2 + 1] - g.y); if (dm < best) { best = dm; bi = k; } }
  return { imag: best, real: Math.hypot(BM.TE[(i * KM + bi) * 2] - g.x, BM.TE[(i * KM + bi) * 2 + 1] - g.y) };
}
{ const a = pickOf(IDX.narrow, 40, K64, 0), b = pickOf(IDX.big, 40, K64, 0); facts.pick40_A_imag = a.imag; facts.pick40_A_real = a.real; facts.pick40_B_imag = b.imag; facts.pick40_B_real = b.real; }
/* the ladder on the displayed zoo */
for (let gi = 0; gi < 2; gi++) for (let r = 0; r < 5; r++) {
  const tv = tauRung(Z, r, K64, gi); facts['tau' + r + '_g' + gi] = tv;
  ok('engine tau agrees', close(ZO.tauOf(S, r, K64, gi), tv, 1e-9), [r, gi, ZO.tauOf(S, r, K64, gi), tv]);
}

console.error('part 1 done; fails so far', fails);

/* ══════════════ 3. twenty re-trained zoos: what is stable and what is luck ══════════════ */
const med2 = med;
function meanTable(m, S) {                                   // the ensemble mean only: the mean of the read-outs is the read-out of the mean (linearity), one dot product per question
  const M = m.f.M, p = m.p, Wb = new Float64Array(p * 2), R = new Float64Array(M * 6), c = Float64Array.from(m.f.c), x = new Float64Array(6), phi = new Float64Array(p);
  for (let e = 0; e < E; e++) for (let q = 0; q < p * 2; q++) Wb[q] += m.Ws[e][q] / E;
  for (let j = 0; j < M; j++) for (let k = 0; k < 6; k++) R[j * 6 + k] = m.f.R[j][k];
  const PE = new Float64Array(S.N * KM * 2);
  for (let i = 0; i < S.N; i++) for (let k = 0; k < KM; k++) {
    const s = S.L[i], a = S.A[k];
    x[0] = s[0] * SCL[0]; x[1] = s[1] * SCL[1]; x[2] = s[2] * SCL[2]; x[3] = s[3] * SCL[3]; x[4] = a[0] * SCL[4]; x[5] = a[1] * SCL[5];
    phi[0] = 1; for (let q = 0; q < 6; q++) phi[1 + q] = x[q];
    for (let j = 0; j < M; j++) { let z = c[j]; for (let q = 0; q < 6; q++) z += R[j * 6 + q] * x[q]; phi[7 + j] = Math.tanh(z); }
    let ox = 0, oy = 0; for (let j = 0; j < p; j++) { ox += phi[j] * Wb[j * 2]; oy += phi[j] * Wb[j * 2 + 1]; }
    PE[(i * KM + k) * 2] = 8 * ox; PE[(i * KM + k) * 2 + 1] = 5 * oy;
  }
  return PE;
}
const NZ = 20, zoos = [];
if (HEAVY) {
T0 = t0();
for (let z = 1; z <= NZ; z++) zoos.push(z === ZS ? Z : buildZoo(z));
console.error('20 zoos in', msSince(T0).toFixed(0), 'ms');
{
  const taus = []; for (let gi = 0; gi < 2; gi++) for (let r = 0; r < 5; r++) taus.push(zoos.map(Zz => tauRung(Zz, r, K64, gi)));
  for (let gi = 0; gi < 2; gi++) for (let r = 0; r < 5; r++) { const a = taus[gi * 5 + r]; facts['tau20_r' + r + '_g' + gi] = med2(a); facts['tau20q1_r' + r + '_g' + gi] = quant(a, 0.25); facts['tau20q3_r' + r + '_g' + gi] = quant(a, 0.75); }
  let same = 0, narrowBest = 0, bigBest = 0, confBest = 0; const twinGaps = [], confGap = [], narGap = [], wGap = [], imag128 = [], real128 = [], conf2big = [], bigOwnConf = [], recipeBest = {};
  zoos.forEach(Zz => {
    let pr = 0, us = 0; for (let j = 1; j < 12; j++) { if (Zz.G[j].own < Zz.G[pr].own) pr = j; if (Zz.G[j].plan[0].real[63] > Zz.G[us].plan[0].real[63]) us = j; }
    if (pr === us) same++; if (pr === IDX.narrow) narrowBest++; if (pr === IDX.confound) confBest++; if (us === IDX.big) bigBest++; recipeBest[RECIPES[us].id] = (recipeBest[RECIPES[us].id] || 0) + 1;
    const R = j => 100 * Zz.G[j].plan[0].real[63];
    twinGaps.push(Math.abs(R(IDX.twin) - R(IDX.mid))); confGap.push(R(IDX.big) - R(IDX.confound)); narGap.push(R(IDX.big) - R(IDX.narrow)); wGap.push(R(IDX.weighted) - R(IDX.mid));
    bigOwnConf.push(Zz.G[IDX.big].own / Zz.G[IDX.confound].own);
    for (let j = 0; j < 12; j++) { imag128.push(100 * Zz.G[j].plan[0].imag[127]); real128.push(100 * Zz.G[j].plan[0].real[127]); }
  });
  facts.z20_same_best = same; facts.z20_narrow_best_own = narrowBest; facts.z20_conf_best_own = confBest; facts.z20_big_best_dec = bigBest;
  facts.z20_twin_gap_med = med2(twinGaps); facts.z20_twin_gap_max = Math.max(...twinGaps); facts.z20_conf_vs_big_med = med2(confGap); facts.z20_conf_vs_big_min = Math.min(...confGap); facts.z20_nar_vs_big_med = med2(narGap); facts.z20_nar_vs_big_min = Math.min(...narGap);
  facts.z20_weighted_gain_med = med2(wGap); facts.z20_weighted_gain_q1 = quant(wGap, 0.25); facts.z20_weighted_gain_q3 = quant(wGap, 0.75);
  { const perR = RECIPES.map(() => ({ g0: [], g1: [] })), jud128 = []; let sameGoals = 0;
    zoos.forEach(Zz => { let b0 = 0, b1 = 0; for (let j = 0; j < 12; j++) { const r0 = 100 * Zz.G[j].plan[0].real[63], r1 = 100 * Zz.G[j].plan[1].real[63]; perR[j].g0.push(r0); perR[j].g1.push(r1); jud128.push(100 * Zz.G[j].jud[0].jud[127]); if (j > 0) { if (r0 > 100 * Zz.G[b0].plan[0].real[63]) b0 = j; if (r1 > 100 * Zz.G[b1].plan[1].real[63]) b1 = j; } } if (b0 === b1) sameGoals++; });
    RECIPES.forEach((rc, j) => { facts['z20_med0_' + rc.id] = med2(perR[j].g0); facts['z20_med1_' + rc.id] = med2(perR[j].g1); });
    facts.z20_same_best_goals = sameGoals; facts.z20_jud128_mean = mean(jud128); }
  { let cp = 0, cc = 0, np = 0, nc = 0, ex = 0;
    zoos.forEach(Zz => { const G = Zz.G; if (G[IDX.confound].own < G[IDX.mid].own) cp++; if (G[IDX.confound].dox > 5 * G[IDX.confound].own) cc++; if (G[IDX.narrow].own < G[IDX.mid].own) np++; if (G[IDX.narrow].dox > 5 * G[IDX.narrow].own) nc++; });
    facts.z20_conf_pass_own = cp; facts.z20_conf_caught_dox = cc; facts.z20_nar_pass_own = np; facts.z20_nar_caught_dox = nc;
    ok('over twenty zoos, confounded passes the held-out exam against the reference every time and the intervention exam catches it every time', cp === 20 && cc === 20, [cp, cc]); }
  facts.z20_imag128_mean = mean(imag128); facts.z20_real128_mean = mean(real128); facts.z20_big_own_over_conf_med = med2(bigOwnConf);
  ok('best held-out error and best decision are never the same model in 20 zoos', same === 0, same);
  ok('confounded loses to big by 19+ points in every one of the 20 zoos', facts.z20_conf_vs_big_min >= 15, facts.z20_conf_vs_big_min);
  ok('the imagined success of the planner is near 100 % while the real one is not', facts.z20_imag128_mean > facts.z20_real128_mean + 30, [facts.z20_imag128_mean, facts.z20_real128_mean]);
  console.error('best decision by recipe over 20 zoos', JSON.stringify(recipeBest));
}

}
console.error('part 2 done; fails so far', fails);

/* ══════════════ 4. the decision against a thousand launches: how many real launches rank the zoo? ══════════════ */
const NT = 1000, BIG1000 = makeSet(NT, 5001), NZT = 12;
let TRUTHS = [];
function hitsOf(PE, S, goal, K) {                            // 0/1 per launch: does the pick of the first K candidates really hit?
  const h = new Uint8Array(S.N);
  for (let i = 0; i < S.N; i++) {
    let best = Infinity, bi = 0;
    for (let k = 0; k < K; k++) { const dm = Math.hypot(PE[(i * KM + k) * 2] - goal.x, PE[(i * KM + k) * 2 + 1] - goal.y); if (dm < best) { best = dm; bi = k; } }
    h[i] = Math.hypot(S.TE[(i * KM + bi) * 2] - goal.x, S.TE[(i * KM + bi) * 2 + 1] - goal.y) < goal.r ? 1 : 0;
  }
  return h;
}
if (HEAVY) {
  T0 = t0();
  const nlist = [10, 20, 50, 100, 200], acc = {}, cheap = {}, H0all = [], TR0all = [], curse = {};
  TRUTHS = TR0all;
  for (let gi = 0; gi < 2; gi++) { nlist.forEach(n => { acc[gi + '_' + n] = []; }); for (let r = 0; r < 5; r++) cheap[gi + '_' + r] = []; }
  const truthSpread = [];
  for (let z = 1; z <= NZT; z++) {
    const Zz = zoos[z - 1];
    const tabs = Zz.models.map(m => meanTable(m, BIG1000));
    for (let gi = 0; gi < 2; gi++) {
      const H = tabs.map(PE => hitsOf(PE, BIG1000, GOALS[gi], K64)), truth = H.map(h => mean(Array.from(h)));
      if (gi === 0) { truthSpread.push(...truth); H0all.push(H); TR0all.push(truth); }
      for (let r = 0; r < 5; r++) cheap[gi + '_' + r].push(tauB(Zz.G.map((g, j) => rungScore(Zz, r, j, K64, gi)), truth));
      for (const n of nlist) {                                 // a block of n launches ranks the zoo; the truth it is compared with uses the OTHER launches only
        const ts = []; const sums = H.map(h => { let s = 0; for (let i = 0; i < NT; i++) s += h[i]; return s; });
        for (let b = 0; b + n <= NT && ts.length < 20; b += n) {
          const meas = H.map(h => { let s = 0; for (let i = b; i < b + n; i++) s += h[i]; return s / n; }), tex = H.map((h, j) => { let s = 0; for (let i = b; i < b + n; i++) s += h[i]; return (sums[j] - s) / (NT - n); });
          ts.push(tauB(meas, tex));
          if (gi === 0) {                                      // the winner of the block: how much is it flattered, and is it the best model?
            let w = 0, bt = 0; meas.forEach((x, j) => { if (x > meas[w]) w = j; if (tex[j] > tex[bt]) bt = j; });
            const key = 'n' + n; (curse[key] = curse[key] || { infl: [], regret: [], best: [] }); curse[key].infl.push(meas[w] - tex[w]); curse[key].regret.push(tex[bt] - tex[w]); curse[key].best.push(w === bt ? 1 : 0);
          }
        }
        acc[gi + '_' + n].push(mean(ts));
      }
    }
  }
  for (let gi = 0; gi < 2; gi++) { for (const n of nlist) facts['taun_g' + gi + '_' + n] = med(acc[gi + '_' + n]); for (let r = 0; r < 5; r++) facts['taut_g' + gi + '_r' + r] = med(cheap[gi + '_' + r]); }
  { // the same launches for both models, or different ones: how often does the n-launch comparison pick the truly better of two models that are 10 to 20 points apart?
    const out = {}; for (const n of [20, 50, 100, 173]) out[n] = { shared: [0, 0], indep: [0, 0] };
    H0all.forEach((H, z) => { const tr = TR0all[z]; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
      const d = Math.abs(tr[i] - tr[j]); if (d < 0.10 || d > 0.20) continue; const hi = tr[i] > tr[j] ? i : j, lo = hi === i ? j : i;
      for (const n of [20, 50, 100, 173]) for (let b = 0; b + 2 * n <= NT; b += 2 * n) {
        let a1 = 0, a2 = 0, c1 = 0; for (let q = b; q < b + n; q++) { a1 += H[hi][q]; a2 += H[lo][q]; } for (let q = b + n; q < b + 2 * n; q++) c1 += H[lo][q];
        out[n].shared[1]++; if (a1 > a2) out[n].shared[0]++; else if (a1 === a2) out[n].shared[0] += 0.5;
        out[n].indep[1]++; if (a1 > c1) out[n].indep[0]++; else if (a1 === c1) out[n].indep[0] += 0.5;
      } } });
    for (const n of [20, 50, 100, 173]) { facts['pair_shared_' + n] = 100 * out[n].shared[0] / out[n].shared[1]; facts['pair_indep_' + n] = 100 * out[n].indep[0] / out[n].indep[1]; }
  }
  for (const n of nlist) { const c = curse['n' + n]; facts['curse_infl_' + n] = 100 * mean(c.infl); facts['curse_regret_' + n] = 100 * mean(c.regret); facts['curse_best_' + n] = 100 * mean(c.best); }
  console.error('truth analysis in', msSince(T0).toFixed(0), 'ms');
  ok('ten real launches rank the zoo better than the best cheap exam at the series goal', facts.taun_g0_10 > Math.max(facts.taut_g0_r0, facts.taut_g0_r1, facts.taut_g0_r2, facts.taut_g0_r3, facts.taut_g0_r4), [facts.taun_g0_10, facts.taut_g0_r0]);
}
console.error('part 3 done; fails so far', fails);

/* ══════════════ 5. the price of the decision ══════════════ */
if (HEAVY) { // 5a. retrained copies of one recipe: how far does the held-out error, or a benchmark of 100 launches, tell the copies apart?
  T0 = t0();
  const copies = [];
  for (let c = 0; c < 60; c++) {
    const m = fitModel(RECIPES[IDX.mid], 101 + c), h = hitsOf(meanTable(m, BIG1000), BIG1000, GOALS[0], K64);
    let s = 0; for (let i = 0; i < NDEC; i++) s += h[i];
    const own = trialsOf(NOWN, 51000 + c, RECIPES[IDX.mid]); let se = 0; for (const d of own) { const q = ask(m, d.s, d.a).mean; se += (q[0] - d.e[0]) ** 2 + (q[1] - d.e[1]) ** 2; }
    copies.push({ meas: s / NDEC, truth: mean(Array.from(h).slice(NDEC)), own: Math.sqrt(se / NOWN) });
  }
  const ct = copies.map(c => c.truth), cm = copies.map(c => c.meas), co = copies.map(c => c.own), mt = mean(ct);
  facts.copies_truth_mean = 100 * mt; facts.copies_truth_sd = 100 * Math.sqrt(mean(ct.map(x => (x - mt) ** 2))); facts.copies_truth_max = 100 * Math.max(...ct); facts.copies_truth_min = 100 * Math.min(...ct);
  facts.copies_tau_own = tauB(co.map(x => -x), ct); facts.copies_tau_bench = tauB(cm, ct);
  let bo = 0; co.forEach((x, i) => { if (x < co[bo]) bo = i; }); facts.copies_pick_own = 100 * ct[bo]; facts.copies_iqr = 100 * (quant(ct, 0.75) - quant(ct, 0.25));
  let bb = 0; cm.forEach((x, i) => { if (x > cm[bb]) bb = i; }); facts.copies_pick_bench_meas = 100 * cm[bb]; facts.copies_pick_bench_truth = 100 * ct[bb];
  const rr = CY.rng(4242);
  for (const R of [12, 60]) {
    let infl = 0, own = 0; const reps = 2000;
    for (let rep = 0; rep < reps; rep++) {
      let bestB = null, bestO = null; for (let q = 0; q < R; q++) { const c = copies[Math.floor(rr() * copies.length)]; if (!bestB || c.meas > bestB.meas) bestB = c; if (!bestO || c.own < bestO.own) bestO = c; }
      infl += bestB.meas - bestB.truth; own += bestO.truth;
    }
    facts['copies_infl_R' + R] = 100 * infl / reps; facts['copies_pickown_R' + R] = 100 * own / reps;
  }
  facts.se_100_p27 = 100 * Math.sqrt(mt * (1 - mt) / NDEC); facts.copies_sd_over_se = facts.copies_truth_sd / facts.se_100_p27;
  console.error('copies', msSince(T0).toFixed(0), 'ms');
}
{ // 5b. how many launches separate two policies, and what zero failures prove
  const pw = nNeed;
  facts.n_gap15 = pw(0.55, 0.40); const n15 = Math.ceil(facts.n_gap15); facts.n_gap15_ceil = n15;
  const sim = (n, p1, p2, reps, seed) => { const r = CY.rng(seed); let hit = 0; for (let q = 0; q < reps; q++) { let a = 0, b = 0; for (let i = 0; i < n; i++) { if (r() < p1) a++; if (r() < p2) b++; } const pa = a / n, pbb = b / n, pp = (a + b) / (2 * n), se = Math.sqrt(2 * pp * (1 - pp) / n); if (se > 0 && Math.abs(pa - pbb) / se > 1.959964) hit++; } return hit / reps; };
  facts.power_sim_n = 100 * sim(n15, 0.55, 0.40, 20000, 11); facts.size_sim_n = 100 * sim(n15, 0.475, 0.475, 20000, 12); facts.power_sim_100 = 100 * sim(100, 0.55, 0.40, 20000, 13); facts.power_sim_40 = 100 * sim(40, 0.55, 0.40, 20000, 14);
  ok('simulated power at the computed n is 80 % (+-1.5)', Math.abs(facts.power_sim_n - 80) < 1.8, facts.power_sim_n);
  ok('simulated size of the test is 5 % (+-1)', Math.abs(facts.size_sim_n - 5) < 1.2, facts.size_sim_n);
  facts.se_100_p50 = 100 * Math.sqrt(0.25 / 100); facts.se_100_p45 = 100 * Math.sqrt(0.45 * 0.55 / 100);
  // rule of three
  for (const n of [20, 50, 100, 300]) { facts['r3_bound_' + n] = 100 * (1 - Math.pow(0.05, 1 / n)); facts['r3_approx_' + n] = 100 * 3 / n; }
  facts.r3_ln20 = Math.log(20);
  const zero = (n, p, reps, seed) => { const r = CY.rng(seed); let z = 0; for (let q = 0; q < reps; q++) { let any = false; for (let i = 0; i < n && !any; i++) if (r() < p) any = true; if (!any) z++; } return z / reps; };
  facts.r3_sim_at_bound = 100 * zero(100, 1 - Math.pow(0.05, 1 / 100), 40000, 21); facts.r3_sim_at_2pct = 100 * zero(100, 0.02, 40000, 22); facts.r3_sim_at_5pct = 100 * zero(100, 0.05, 40000, 23); facts.r3_exact_2pct = 100 * Math.pow(0.98, 100);
  ok('zero failures in 100 trials happens 5 % of the time when p equals the bound', Math.abs(facts.r3_sim_at_bound - 5) < 0.4, facts.r3_sim_at_bound);
  facts.r3_n_for_1pct = Math.ceil(Math.log(0.05) / Math.log(0.99)); facts.r3_n_for_01pct = Math.ceil(Math.log(0.05) / Math.log(0.999));
  // the 1X sentence, read as the simplest label noise: the evaluator's verdict on an episode is right with probability a, whoever the policy is
  const a = 0.7, shrink = 2 * a - 1; facts.x1_shrink = shrink; facts.x1_gap_seen = 100 * shrink * 0.15;
  const pA = 0.55, pB = 0.40, qA = (1 - a) + shrink * pA, qB = (1 - a) + shrink * pB; facts.x1_qA = 100 * qA; facts.x1_qB = 100 * qB;
  const nx = Math.pow(1.281552 / (qA - qB), 2) * (qA * (1 - qA) + qB * (1 - qB)); facts.x1_n = nx;
  { const r = CY.rng(31); let good = 0; const reps = 20000, nn = Math.ceil(nx); for (let q = 0; q < reps; q++) { let u = 0, v = 0; for (let i = 0; i < nn; i++) { if (r() < qA) u++; if (r() < qB) v++; } if (u > v) good++; } facts.x1_sim_correct = 100 * good / reps; }
  ok('the evaluator with 70 % verdict accuracy ranks the right policy first about 90 % of the time at the computed n', Math.abs(facts.x1_sim_correct - 90) < 2, facts.x1_sim_correct);
  facts.gem_per_cell = 1600 / (8 * 5);
  { const se = Math.sqrt(0.55 * 0.45 / 40 + 0.40 * 0.60 / 40), zz = 0.15 / se, Phi = CY.stats.ncdf; facts.gem_power = 100 * (Phi(zz - 1.959964) + Phi(-zz - 1.959964)); facts.gem_se_gap = 100 * se; facts.gem_power_sim = 100 * sim(40, 0.55, 0.40, 20000, 15); }
  ok('analytic power at 40 per cell matches simulation', Math.abs(facts.gem_power - facts.gem_power_sim) < 3, [facts.gem_power, facts.gem_power_sim]);
  facts.ck_bound300 = 100 * (1 - Math.pow(0.05, 1 / 300)); facts.ck_n_60_50 = pw(0.6, 0.5); facts.ck_n_60_50_ceil = Math.ceil(pw(0.6, 0.5));
  facts.val_policies = 12; facts.val_cost = 12 * n15; facts.val_hours = facts.val_cost * 8.1 / 3600; facts.val_saving_per_pair = 2 * n15; facts.val_breakeven = facts.val_cost / facts.val_saving_per_pair;
}
{ // 5c. a model as the judge of other models' policies (the displayed zoo, K = 64, the series' goal), and over the twenty zoos
  const evalZoo = Zz => {
    const picks = Zz.G.map(g => { const P = g.T.PE, pk = []; for (let i = 0; i < NDEC; i++) { let best = Infinity, bi = 0; for (let k = 0; k < K64; k++) { const dm = Math.hypot(P[(i * KM + k) * 2] - 6.6, P[(i * KM + k) * 2 + 1] - 2.5); if (dm < best) { best = dm; bi = k; } } pk.push(bi); } return pk; });
    const real = Zz.G.map(g => g.plan[0].real[K64 - 1]);
    const pred = (e, j) => { const P = Zz.G[e].T.PE; let h = 0; for (let i = 0; i < NDEC; i++) { const o = (i * KM + picks[j][i]) * 2; if (Math.hypot(P[o] - 6.6, P[o + 1] - 2.5) < 0.5) h++; } return h / NDEC; };
    const taus = [], selfB = [], othB = [];
    for (let e = 0; e < 12; e++) {
      const js = [], pr = [], rl = []; let bias = 0;
      for (let j = 0; j < 12; j++) { const pj = pred(e, j); if (j === e) selfB.push(pj - real[j]); else { js.push(j); pr.push(pj); rl.push(real[j]); bias += (pj - real[j]) / 11; } }
      taus.push(tauB(pr, rl)); othB.push(bias);
    }
    return { taus, selfB, othB };
  };
  const ev = evalZoo(Z); facts.ev_tau_med = med(ev.taus); facts.ev_tau_best = Math.max(...ev.taus); facts.ev_tau_worst = Math.min(...ev.taus); facts.ev_self_bias = 100 * mean(ev.selfB); facts.ev_other_bias = 100 * mean(ev.othB);
  let bestE = 0; ev.taus.forEach((x, e) => { if (x > ev.taus[bestE]) bestE = e; }); facts.ev_best_is = bestE; console.error('best evaluator', NAMES[bestE]);
  if (HEAVY) { const all = zoos.map(evalZoo); facts.ev20_tau_med = med(all.map(a => med(a.taus))); facts.ev20_tau_best_med = med(all.map(a => Math.max(...a.taus))); facts.ev20_self_bias_med = 100 * med(all.map(a => mean(a.selfB))); facts.ev20_other_bias_med = 100 * med(all.map(a => mean(a.othB))); }
}
console.error('part 5 done; fails so far', fails);

/* ══════════════ 6. what the planner leans on, the product, and the bill for a better model ══════════════ */
{ // 6a. picks beyond the log (the support), reach and selection (the displayed zoo, K = 64, the series' goal)
  for (let j = 0; j < 12; j++) {
    const id = RECIPES[j].id, P = Z.G[j].T.PE, rlog = Z.models[j].rlog; let nin = 0, hin = 0, nout = 0, hout = 0;
    for (let i = 0; i < NDEC; i++) {
      let best = Infinity, bi = 0;
      for (let k = 0; k < K64; k++) { const dm = Math.hypot(P[(i * KM + k) * 2] - 6.6, P[(i * KM + k) * 2 + 1] - 2.5); if (dm < best) { best = dm; bi = k; } }
      const hit = Math.hypot(BM.TE[(i * KM + bi) * 2] - 6.6, BM.TE[(i * KM + bi) * 2 + 1] - 2.5) < 0.5, outside = Math.hypot(BM.A[bi][0], BM.A[bi][1]) > rlog;
      if (outside) { nout++; if (hit) hout++; } else { nin++; if (hit) hin++; }
    }
    ok('picks beyond the log agree with the engine for ' + id, close(100 * nout / NDEC, facts['out64_' + id], 1e-9), [nout, facts['out64_' + id]]);
    ok('real success = hits inside + hits outside for ' + id, hin + hout === Math.round(real64(j)), [hin, hout, real64(j)]);
    facts['pickout_' + id] = 100 * nout / NDEC; facts['pickin_n_' + id] = nin; facts['pickin_hit_' + id] = hin; facts['pickout_n_' + id] = nout; facts['pickout_hit_' + id] = hout;
    facts['sel64_' + id] = 100 * real64(j) / facts.exact64;                 // real success / reach: how often the pick is a hit when a hit was on offer
  }
  for (let gi = 0; gi < 2; gi++) {                                     // which nudges hit, for each goal
    const goal = GOALS[gi], sizes = []; for (let i = 0; i < NDEC; i++) for (let k = 0; k < KM; k++) if (Math.hypot(BM.TE[(i * KM + k) * 2] - goal.x, BM.TE[(i * KM + k) * 2 + 1] - goal.y) < goal.r) sizes.push(Math.hypot(BM.A[k][0], BM.A[k][1]));
    facts['hit_med_g' + gi] = med(sizes); facts['hit_in12_g' + gi] = 100 * sizes.filter(s => s <= 1.2).length / sizes.length;
  }
  ok('reach: the exact planner at K = 64 hits on 85 launches of 100 (the ceiling every model shares)', Math.round(facts.exact64) === 85, facts.exact64);
}
{ // 6b. the bill: capacity and data against the decision (K = 128, the series' goal, mean of three zoos)
  T0 = t0();
  const Ms = [32, 128, 256], Ns = [250, 1000, 4000], ZSs = [1, 2, 3];
  for (const M of Ms) for (const n of Ns) {
    const r = [], o = [];
    for (const zs of ZSs) {
      const m = fitModel(RECIPES[IDX.mid], zs, n, M), T = table(m, BM), pc = planCurves(T.PE, BM, GOALS[0], m.rlog);
      r.push(100 * pc.real[127]);
      const own = trialsOf(NOWN, 50000 + zs, RECIPES[IDX.mid]); let se = 0; for (const d of own) { const q = ask(m, d.s, d.a).mean; se += (q[0] - d.e[0]) ** 2 + (q[1] - d.e[1]) ** 2; } o.push(Math.sqrt(se / NOWN));
    }
    facts['grid_real_M' + M + '_n' + n] = mean(r); facts['grid_own_M' + M + '_n' + n] = mean(o);
  }
  for (const n of Ns) facts['hours_n' + n] = n * 8.1 / 3600;
  console.error('scaling grid', msSince(T0).toFixed(0), 'ms');
  ok('more capacity and more data both help: the corner cell beats the first', facts.grid_real_M256_n1000 > facts.grid_real_M32_n250 + 40, [facts.grid_real_M256_n1000, facts.grid_real_M32_n250]);
}
{ // 6c. the confounded log: what a regression on it recovers of a nudge's effect
  const rc = RECIPES[IDX.confound], su2 = rc.rho * rc.rho / 4, sw2 = rc.wind * rc.wind, closed = su2 / (su2 + KAPPA * KAPPA * sw2);
  facts.conf_closed = closed; facts.conf_kw = KAPPA * rc.wind; facts.conf_su = Math.sqrt(su2);
  const slope = (xs, ys) => { const mx = mean(xs), my = mean(ys); let c = 0, v = 0; for (let i = 0; i < xs.length; i++) { c += (xs[i] - mx) * (ys[i] - my); v += (xs[i] - mx) ** 2; } return c / v; };
  { const r = CY.rng(808), xs = [], ys = [], n = 40000;                  // a floor with no walls in reach: the closed form must hold
    for (let i = 0; i < n; i++) { const g = rc.wind * CY.randn(r), w = CY.world({ W: 1e3, H: 1e3, curtain: null, wind: [g, 0] }), u = discNudge(r, rc.rho), a = [u[0] - KAPPA * g, u[1]]; xs.push(a[0]); ys.push(endOf(w, [500, 500, 1.5, 0], a)[0]); }
    facts.conf_floor = slope(xs, ys) / Bfd; ok('regression slope on a confounded log = B s_u^2 / (s_u^2 + kappa^2 s_w^2) (wall-free floor, 40000 trials)', close(facts.conf_floor, closed, 0.02), [facts.conf_floor, closed]); }
  { const log = trialsOf(20000, 909, rc); facts.conf_courtyard = slope(log.map(d => d.a[0]), log.map(d => d.e[0])) / Bfd; }
  facts.conf_own_ratio = Z.G[IDX.mid].own / Z.G[IDX.confound].own; facts.conf_dox_over_own = Z.G[IDX.confound].dox / Z.G[IDX.confound].own;
}
if (HEAVY) { // 6d. lesson 8's law for the winner of a benchmark: optimism = d^2 / sqrt(s^2 + d^2) * E[max of R normals]
  const Phi = CY.stats.ncdf, Emax = R => { let s = 0; const h = 0.001; for (let x = -9; x < 9; x += h) { const xm = x + h / 2, f = Math.exp(-xm * xm / 2) / Math.sqrt(2 * Math.PI); s += xm * R * f * Math.pow(Phi(xm), R - 1) * h; } return s; };
  facts.emax12 = Emax(12); facts.emax12_check = (() => { const r = CY.rng(5), reps = 200000; let s = 0; for (let q = 0; q < reps; q++) { let m = -Infinity; for (let i = 0; i < 12; i++) m = Math.max(m, CY.randn(r)); s += m; } return s / reps; })();
  ok('E[max of 12 normals] by quadrature = by simulation', close(facts.emax12, facts.emax12_check, 0.01), [facts.emax12, facts.emax12_check]);
  for (const n of [10, 20, 50, 100, 200]) {
    const pr = [];
    for (let z = 0; z < TRUTHS.length; z++) { const tr = TRUTHS[z], pm = mean(tr), s2 = mean(tr.map(x => (x - pm) ** 2)), d2 = pm * (1 - pm) / n; pr.push(d2 / Math.sqrt(s2 + d2) * facts.emax12); }
    facts['curse_law_' + n] = 100 * mean(pr);
  }
  facts.curse_sigma = 100 * mean(TRUTHS.map(tr => { const pm = mean(tr); return Math.sqrt(mean(tr.map(x => (x - pm) ** 2))); }));
  ok('the law of lesson 8 predicts the winner\'s optimism within a factor 1.5 at every benchmark size', [10, 20, 50, 100, 200].every(n => facts['curse_law_' + n] / facts['curse_infl_' + n] < 1.5 && facts['curse_law_' + n] / facts['curse_infl_' + n] > 0.67), [10, 20, 50, 100, 200].map(n => [facts['curse_law_' + n], facts['curse_infl_' + n]]));
}

/* ══════════════ 7. the failure atlas: ten miniatures, each with the exam that passes it and the exam that catches it ══════════════ */
{ // row 1-2: lesson 3's instruments
  const mo = L3.model(1.5, 'flicker'), c = L3.cheap(mo, 12);
  facts.atl_nuis_rec = c.pca.rec; facts.atl_nuis_pos = c.pca.r2.pos; facts.atl_nuis_band = c.pca.r2.band; facts.atl_pred_rec = Math.max(0, c.cf.rec); facts.atl_pred_pos = c.cf.r2.pos;
  const gu = L3.grad(mo, 12, 'gu'), gg = L3.grad(mo, 12, 'gg'), last = a => a[a.length - 1];
  facts.atl_col_loss_u = last(gu.trace.pred); facts.atl_col_rank_u = last(gu.trace.rank); facts.atl_col_pos_u = gu.r2.pos; facts.atl_col_std_u = last(gu.trace.std);
  facts.atl_col_loss_g = last(gg.trace.pred); facts.atl_col_rank_g = last(gg.trace.rank); facts.atl_col_pos_g = gg.r2.pos; facts.atl_col_std_g = last(gg.trace.std);
  for (const lam of [1, 1.5, 2]) { const m2 = L3.model(lam, 'flicker'), c2 = L3.cheap(m2, 12);
    ok('lesson 3 rows hold for lambda = ' + lam, c2.pca.rec > 0.8 && c2.pca.r2.pos < 0.15 && c2.pca.r2.band > 0.99 && c2.cf.r2.pos > 0.9, [c2.pca.rec, c2.pca.r2.pos, c2.cf.r2.pos]); }
  ok('rebuild code: rebuilds most of the picture, reads the curtain, not the ball', facts.atl_nuis_rec > 0.9 && facts.atl_nuis_pos < 0.1 && facts.atl_nuis_band > 0.99, [facts.atl_nuis_rec, facts.atl_nuis_pos, facts.atl_nuis_band]);
  ok('predictive code: reads the ball, rebuilds nothing', facts.atl_pred_pos > 0.9 && facts.atl_pred_rec < 0.02, [facts.atl_pred_pos, facts.atl_pred_rec]);
  ok('collapse: loss ~0 with rank ~1; the guard raises both loss and rank', facts.atl_col_loss_u < 0.002 && facts.atl_col_rank_u < 1.5 && facts.atl_col_rank_g > 10 && facts.atl_col_pos_g > 0.9 && facts.atl_col_pos_u < 0.05, [facts.atl_col_loss_u, facts.atl_col_rank_u, facts.atl_col_rank_g, facts.atl_col_pos_g, facts.atl_col_pos_u]);
}
{ // row 3: the fork: the squared-error optimum is the mean of the modes (three independent logs; the first is quoted)
  const Wf = CY.scenes.fork(), outcome = (b, vx) => { let s = [0.5, 2.5 + b, vx, 0]; for (let t = 0; t < 40; t++) s = CY.step(Wf, s, null); return s; };
  const gen = (n, seed) => { const r = CY.rng(seed), o = []; for (let i = 0; i < n; i++) { const b = 0.15 * CY.randn(r), vx = 2.3 + 0.2 * r(), z = 2.5 + b + 0.1 * CY.randn(r), e = outcome(b, vx); o.push({ z, y: e[1] }); } return o; };
  const forkRun = (s1, s2) => {
    const tr = gen(800, s1), te = gen(2000, s2), M = 12, rr = CY.rng(5), R = [], c = []; for (let j = 0; j < M; j++) { R.push(8 * CY.randn(rr)); c.push(CY.randn(rr)); }
    const feat = z => { const f = [1, (z - 2.5) / 0.15]; for (let j = 0; j < M; j++) f.push(Math.tanh(R[j] * (z - 2.5) / 0.15 / 3 + c[j])); return f; };
    const p = M + 2, Phi = new Float64Array(tr.length * p), Y = new Float64Array(tr.length); tr.forEach((d, i) => { Phi.set(feat(d.z), i * p); Y[i] = d.y; });
    const W = CY.la.ridge(Phi, tr.length, p, Y, 1, 1e-3), pred = z => { const f = feat(z); let s = 0; for (let j = 0; j < p; j++) s += f[j] * W[j]; return s; };
    let se = 0; te.forEach(d => { se += (pred(d.z) - d.y) ** 2; });
    let floor = 0, cnt = 0; for (let zc = 2.2; zc <= 2.8; zc += 0.02) { const sl = te.filter(d => Math.abs(d.z - zc) < 0.01); if (sl.length > 20) { const m = mean(sl.map(d => d.y)); floor += sl.reduce((a, d) => a + (d.y - m) ** 2, 0); cnt += sl.length; } }
    const sl = te.filter(d => Math.abs(d.z - 2.5) < 0.03), ans = pred(2.5);
    return { mse: se / te.length, floor: floor / cnt, ans, near: 100 * sl.filter(d => Math.abs(d.y - ans) < 0.3).length / sl.length };
  };
  const f0 = forkRun(1, 2); facts.atl_fork_mse = f0.mse; facts.atl_fork_floor = f0.floor; facts.atl_fork_ans = f0.ans; facts.atl_fork_near = f0.near;
  ok('fork: the mean-squared-error model is at the floor (within 10 %) and its answer is where few outcomes are, in three independent logs', [f0, forkRun(3, 4), forkRun(5, 6)].every(f => f.mse < 1.1 * f.floor && f.near < 20), [f0, forkRun(3, 4), forkRun(5, 6)]);
}
{ // rows 4 and 10: a one-step model of the Courtyard fitted to 150 launches with random nudges: compounding, and contact
  const W = CY.world({}), T = 93, d = Math.exp(-W.gamma * W.dt), SCm = [1 / 8, 1 / 5, 1 / 3, 1 / 3, 1 / 1.5, 1 / 1.5];
  const mkLog = (n, seed) => { const r = CY.rng(seed), rows = [], runs = []; for (let i = 0; i < n; i++) { let s = CY.launch(W, r); const tr = [s], acts = []; for (let t = 0; t < T; t++) { const a = t === TA ? discNudge(r, 1.5) : null, s2 = CY.step(W, s, a), sa = a ? [s[0], s[1], s[2] + a[0], s[3] + a[1]] : s; rows.push({ s, a: a || [0, 0], s2, contact: Math.abs(s2[2] - d * sa[2]) > 1e-9 || Math.abs(s2[3] - d * sa[3]) > 1e-9 }); acts.push(a); s = s2; tr.push(s); } runs.push({ tr, acts }); } return { rows, runs }; };
  let seAll = 0, nAll = 0, seF = 0, nF = 0, seC = 0, nC = 0; const ends = [], perSeed = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const lg = mkLog(150, 100 + seed), te = mkLog(60, 900 + seed), M = 24, rr = CY.rng(7 + seed), R = new Float64Array(M * 6), c = new Float64Array(M);
    for (let j = 0; j < M; j++) { for (let k = 0; k < 6; k++) R[j * 6 + k] = 3 * CY.randn(rr); c[j] = 1.5 * CY.randn(rr); }
    const p = M + 7, phi = new Float64Array(p), feat = (s, a) => { phi[0] = 1; const x = [s[0], s[1], s[2], s[3], a[0], a[1]]; for (let k = 0; k < 6; k++) phi[1 + k] = x[k] * SCm[k]; for (let j = 0; j < M; j++) { let z = c[j]; for (let k = 0; k < 6; k++) z += R[j * 6 + k] * phi[1 + k]; phi[7 + j] = Math.tanh(z); } };
    const n = lg.rows.length, Phi = new Float64Array(n * p), Y = new Float64Array(n * 4);
    lg.rows.forEach((r, i) => { feat(r.s, r.a); Phi.set(phi, i * p); for (let k = 0; k < 4; k++) Y[i * 4 + k] = r.s2[k] - r.s[k]; });
    const Wt = CY.la.ridge(Phi, n, p, Y, 4, 1e-4), step = (s, a) => { feat(s, a || [0, 0]); const o = [0, 0, 0, 0]; for (let k = 0; k < 4; k++) { let z = 0; for (let j = 0; j < p; j++) z += phi[j] * Wt[j * 4 + k]; o[k] = s[k] + z; } return o; };
    let sa = 0, na = 0, sf = 0, nf = 0, sc = 0, nc = 0; const endsSeed = [];
    te.rows.forEach(r => { const q = step(r.s, r.a), e = (q[0] - r.s2[0]) ** 2 + (q[1] - r.s2[1]) ** 2; seAll += e; nAll++; sa += e; na++; if (r.contact) { seC += e; nC++; sc += e; nc++; } else { seF += e; nF++; sf += e; nf++; } });
    te.runs.forEach(run => { let q = step(run.tr[TA], run.acts[TA]); for (let u = 0; u < TF; u++) q = step(q, null); const e = run.tr[TA + 81], d1 = Math.hypot(q[0] - e[0], q[1] - e[1]); ends.push(d1); endsSeed.push(d1); });
    perSeed.push({ ratio: Math.sqrt(sc / nc) / Math.sqrt(sf / nf), amp: med(endsSeed) / Math.sqrt(sa / na / 2) });
  }
  ok('compounding and contact blur hold in every one of the six seeds', perSeed.every(s => s.ratio > 20 && s.amp > 100), perSeed);
  facts.atl_step_all_mm = 1000 * Math.sqrt(seAll / nAll / 2); facts.atl_step_free_mm = 1000 * Math.sqrt(seF / nF / 2); facts.atl_step_contact_mm = 1000 * Math.sqrt(seC / nC / 2);
  facts.atl_step_ratio = facts.atl_step_contact_mm / facts.atl_step_free_mm; facts.atl_step_share = 100 * nC / nAll; facts.atl_step_end_m = med(ends); facts.atl_step_amp = 1000 * facts.atl_step_end_m / facts.atl_step_all_mm;
  ok('compounding: a one-step error of millimetres becomes an ending error of 100 times that or more', facts.atl_step_amp > 100, facts.atl_step_amp);
  ok('contact steps are rare and badly predicted', facts.atl_step_share < 2 && facts.atl_step_ratio > 20, [facts.atl_step_share, facts.atl_step_ratio]);
}
{ // row 7: myopia: the exact model, a planner that scores the ball h steps after the nudge instead of at the end
  for (const h of [40, 60, 81]) {
    let hit = 0;
    for (let i = 0; i < NDEC; i++) { let best = Infinity, bk = 0; for (let k = 0; k < KM; k++) { let q = CY.step(W0, BM.L[i], BM.A[k]); for (let u = 1; u < h; u++) q = CY.step(W0, q, null); const m = Math.hypot(q[0] - 6.6, q[1] - 2.5); if (m < best) { best = m; bk = k; } } if (Math.hypot(BM.TE[(i * KM + bk) * 2] - 6.6, BM.TE[(i * KM + bk) * 2 + 1] - 2.5) < 0.5) hit++; }
    facts['atl_myo_' + h] = hit;
  }
  ok('myopia: the planner that scores the ball at the end is the exact planner', facts.atl_myo_81 === Math.round(facts.exact128), [facts.atl_myo_81, facts.exact128]);
}
{ // row 8: forgetting: a window of W readings; next reading while the ball is visible, and where it reappears after a long curtain (three independent logs; the first is quoted)
  const w = CY.world({ curtain: [2.2, 3.8] });
  const mk = (n, seed) => { const r = CY.rng(seed), out = []; for (let i = 0; i < n; i++) { let s = CY.launch(w, r, { speed: [2.6, 2.6] }); const tr = [s]; for (let t = 0; t < 30; t++) { s = CY.step(w, s, null); tr.push(s); } const tin = tr.findIndex(q => CY.occluded(w, q)), tout = tr.findIndex((q, t) => t > tin && !CY.occluded(w, q)); out.push({ tr, rd: tr.map(q => CY.occluded(w, q) ? null : [q[0] + 0.02 * CY.randn(r), q[1] + 0.02 * CY.randn(r)]), tin, tout }); } return out; };
  const feat = (c, t, W) => { const f = [1]; for (let k = 0; k < W; k++) { const q = c.rd[t - k]; f.push(q ? 1 : 0, q ? q[0] - 2.5 : 0, q ? q[1] - 2.5 : 0); } return f; };
  const fgtRun = (s1, s2) => {
    const tr = mk(500, s1), te = mk(300, s2), res = { hidden: med(te.map(c => c.tout - c.tin)) };
    for (const W of [8, 16]) {
      const rowsOf = cs => { const R = []; cs.forEach(c => { for (let t = W - 1; t + 1 < c.rd.length; t++) if (c.rd[t + 1] && c.rd[t]) R.push({ f: feat(c, t, W), y: c.tr[t + 1] }); }); return R; };
      const A = rowsOf(tr), B = rowsOf(te), p = 1 + 3 * W, Ax = new Float64Array(A.length * p), Y = new Float64Array(A.length * 2);
      A.forEach((r, i) => { Ax.set(r.f, i * p); Y[i * 2] = r.y[0]; Y[i * 2 + 1] = r.y[1]; });
      const Wt = CY.la.ridge(Ax, A.length, p, Y, 2, 1e-3); let se = 0; B.forEach(r => { for (let k = 0; k < 2; k++) { let s = 0; for (let j = 0; j < p; j++) s += r.f[j] * Wt[j * 2 + k]; se += (s - r.y[k]) ** 2; } });
      res['vis' + W] = Math.sqrt(se / (2 * B.length));
      const A2 = new Float64Array(tr.length * p), Y2 = new Float64Array(tr.length); tr.forEach((c, i) => { A2.set(feat(c, c.tout - 1, W), i * p); Y2[i] = c.tr[c.tout][1]; });
      const W2 = CY.la.ridge(A2, tr.length, p, Y2, 1, 1e-3); let good = 0; te.forEach(c => { const f = feat(c, c.tout - 1, W); let s = 0; for (let j = 0; j < p; j++) s += f[j] * W2[j]; if (Math.abs(s - c.tr[c.tout][1]) < 0.3) good++; });
      res['back' + W] = 100 * good / te.length;
    }
    return res;
  };
  const g0 = fgtRun(1, 2); facts.atl_fgt_hidden = g0.hidden; facts.atl_fgt_vis_W8 = g0.vis8; facts.atl_fgt_vis_W16 = g0.vis16; facts.atl_fgt_back_W8 = g0.back8; facts.atl_fgt_back_W16 = g0.back16;
  const g1 = fgtRun(3, 4), g2 = fgtRun(5, 6);
  ok('forgetting: windows shorter than the curtain pass the visible exam and fail the reappearance exam, in three independent logs', [g0, g1, g2].every(g => g.back8 < 40 && g.back16 > 95 && Math.abs(g.vis8 - g.vis16) < 0.01), [g0, g1, g2]);
}
{ // row 9: identity: two identical balls cross behind the curtain; the detector returns the two positions as an unlabelled pair
  const w = CY.world({ curtain: [2.2, 3.8] }), r = CY.rng(11), n = 2000; let nn = 0, cross = 0;
  for (let i = 0; i < n; i++) {
    const a = CY.launch(w, r, { speed: [2.6, 2.6] }), b = CY.launch(w, r, { speed: [2.6, 2.6] }), A = [a], B = [b];
    for (let t = 0; t < 30; t++) { A.push(CY.step(w, A[t], null)); B.push(CY.step(w, B[t], null)); }
    const tin = Math.min(A.findIndex(q => CY.occluded(w, q)), B.findIndex(q => CY.occluded(w, q))), tout = Math.max(A.findIndex((q, t) => t > tin && !CY.occluded(w, q)), B.findIndex((q, t) => t > tin && !CY.occluded(w, q)));
    const sw = r() < 0.5, bag = sw ? [B[tout], A[tout]] : [A[tout], B[tout]], last = [A[tin - 1], B[tin - 1]];
    const d00 = Math.hypot(bag[0][0] - last[0][0], bag[0][1] - last[0][1]) + Math.hypot(bag[1][0] - last[1][0], bag[1][1] - last[1][1]), d01 = Math.hypot(bag[0][0] - last[1][0], bag[0][1] - last[1][1]) + Math.hypot(bag[1][0] - last[0][0], bag[1][1] - last[0][1]);
    if ((d00 <= d01 ? 0 : 1) === (sw ? 1 : 0)) nn++;
    if ((A[tin - 1][1] - B[tin - 1][1]) * (A[tout][1] - B[tout][1]) < 0) cross++;
  }
  facts.atl_id_cross = 100 * cross / n; facts.atl_id_right = 100 * nn / n; facts.atl_id_wrong = 100 - facts.atl_id_right;
  ok('identity: matching the pair to the last sighting is wrong about as often as the balls cross', Math.abs((100 - facts.atl_id_right) - facts.atl_id_cross) < 1.5, [facts.atl_id_right, facts.atl_id_cross]);
}
console.error('part 6 done; fails so far', fails);
/* ══════════════ 8. the page's own widget ══════════════ */
const PAGE = path.join(DIR, '16_evaluation_failures_capstone.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
if (HAVE_PAGE) {
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const nums = id => (page.text(id).match(/[-−]?\d+(?:\.\d+)?/g) || []).map(s => parseFloat(s.replace('−', '-')));
  const setView = (rung, kidx, goal, A, B, ep) => { page.set('w16-rung', rung); page.set('w16-k', kidx); page.set('w16-goal', goal); page.set('w16-a', A); page.set('w16-b', B); page.set('w16-ep', ep); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const modelRow = (j, K, gi) => ({ real: 100 * Z.G[j].plan[gi].real[K - 1], imag: 100 * Z.G[j].plan[gi].imag[K - 1], own: Z.G[j].own });
  const checkModel = (label, id, j, K, gi) => {
    const w = nums(id), e = modelRow(j, K, gi);
    ok('widget ' + label + ': real, imagined, held-out error', w.length >= 3 && near(w[0], e.real, 0.51) && near(w[1], e.imag, 0.51) && near(w[2], e.own, 0.0051), [w, e]);
  };
  { // the opening state: held-out error, K = 64, the series' goal, narrow against big, launch 40
    setView(0, 6, 0, IDX.narrow, IDX.big, 40);
    ok('widget: exam label', /held-out error/.test(page.text('w16-rung-v')) && page.text('w16-k-v') === 'K = 64' && page.text('w16-ep-v') === '#40', [page.text('w16-rung-v'), page.text('w16-k-v'), page.text('w16-ep-v')]);
    ok('widget: tau of the held-out error', near(nums('w16-tau')[0], tauRung(Z, 0, 64, 0), 0.0051), [nums('w16-tau'), tauRung(Z, 0, 64, 0)]);
    const ts = nums('w16-taus'); ok('widget: the five taus at the series goal', ts.length === 5 && ts.every((x, r) => near(x, tauRung(Z, r, 64, 0), 0.0051)), [ts]);
    ok('widget: the best model on the held-out error is narrow, with its real success', /^narrow/.test(page.text('w16-best')) && near(nums('w16-best')[0], real64(IDX.narrow), 0.51), page.text('w16-best'));
    checkModel('A (narrow)', 'w16-a-m', IDX.narrow, 64, 0); checkModel('B (big)', 'w16-b-m', IDX.big, 64, 0);
    const rv = nums('w16-rev'); ok('widget: the pair of lowest error and best decision', /^narrow/.test(page.text('w16-rev')) && /big/.test(page.text('w16-rev')) && rv.length === 4 && near(rv[0], Z.G[IDX.narrow].own, 0.0051) && near(rv[1], real64(IDX.narrow), 0.51) && near(rv[2], Z.G[IDX.big].own, 0.0051) && near(rv[3], real64(IDX.big), 0.51), [page.text('w16-rev'), rv]);
    ok('widget: launches per policy for the pair', nums('w16-n')[0] === facts.pair_n_ceil, [page.text('w16-n'), facts.pair_n_ceil]);
    const pk = nums('w16-pick'); ok('widget: the picks on launch 40', pk.length === 4 && near(pk[0], facts.pick40_A_imag, 0.0051) && near(pk[1], facts.pick40_A_real, 0.0051) && near(pk[2], facts.pick40_B_imag, 0.0051) && near(pk[3], facts.pick40_B_real, 0.0051), [page.text('w16-pick'), facts.pick40_A_imag, facts.pick40_A_real, facts.pick40_B_imag, facts.pick40_B_real]);
  }
  for (let r = 0; r < 5; r++) {                                       // each exam in turn, both goals
    for (let gi = 0; gi < 2; gi++) { setView(r, 6, gi, IDX.narrow, IDX.big, 40); ok('widget: tau of exam ' + r + ' at goal ' + gi, near(nums('w16-tau')[0], tauRung(Z, r, 64, gi), 0.0051), [nums('w16-tau'), tauRung(Z, r, 64, gi)]); }
  }
  { setView(0, 6, 1, IDX.narrow, IDX.big, 40); const w = nums('w16-a-m'); ok('widget: narrow at the moved goal', near(w[0], facts.real64m_narrow, 0.51), [w, facts.real64m_narrow]); }
  { setView(0, 7, 0, IDX.narrow, IDX.big, 40); checkModel('A at K = 128', 'w16-a-m', IDX.narrow, 128, 0); checkModel('B at K = 128', 'w16-b-m', IDX.big, 128, 0); ok('widget: K label', page.text('w16-k-v') === 'K = 128'); }
  { setView(0, 6, 0, IDX.twin, IDX.mid, 40); checkModel('A (twin)', 'w16-a-m', IDX.twin, 64, 0); checkModel('B (mid)', 'w16-b-m', IDX.mid, 64, 0); ok('widget: launches per policy to tell twin from mid', nums('w16-n')[0] === facts.twin_mid_n, [page.text('w16-n'), facts.twin_mid_n]); }
  { setView(3, 5, 0, IDX.cautious, IDX.confound, 5);                  // a different exam, budget and launch
    const w = nums('w16-tau'); ok('widget: tau of imagined success at K = 32', near(w[0], tauRung(Z, 3, 32, 0), 0.0051), [w, tauRung(Z, 3, 32, 0)]);
    const a = pickOf(IDX.cautious, 5, 32, 0), b = pickOf(IDX.confound, 5, 32, 0), pk = nums('w16-pick');
    ok('widget: the picks on launch 5 at K = 32', pk.length === 4 && near(pk[0], a.imag, 0.0051) && near(pk[1], a.real, 0.0051) && near(pk[2], b.imag, 0.0051) && near(pk[3], b.real, 0.0051), [page.text('w16-pick'), a, b]); }
  { setView(0, 6, 0, IDX.narrow, IDX.big, 40); page.set('w16-ep', 99); ok('widget: the launch label follows the slider', page.text('w16-ep-v') === '#99'); }
}

if (fails) { console.error(fails + ' check(s) failed'); }
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
