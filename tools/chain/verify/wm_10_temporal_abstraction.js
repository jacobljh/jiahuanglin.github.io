#!/usr/bin/env node
/* Oracle for World Models lesson 10, "Think coarser to see farther: temporal abstraction".
 *
 * Two experiments, one on the plain Courtyard (a ball that coasts and bounces off the four walls) and one on the maze (task T5 of lesson 9: a wall of 11 posts at x = 4 with a gap
 * above y = 3.9; goal disc (7, 1) of radius 0.45; start within 10 cm of (1, 1) at rest; |a| <= 0.6 m/s per step; 160 steps; an episode "docks" when the ball is inside the goal
 * disc and slower than 0.5 m/s at some step).
 *
 * This oracle
 *   (1) re-implements the jump, the datasets, the learner (random tanh features + ridge, with its Cholesky solver), the three heads (no summary, forecast hits, observed hits), the
 *       one-jump and chained errors and the reach FROM THE LESSON'S SPECIFICATION (own integrator written out, own solver, own gating), checks each against l10_jumps.js and
 *       derives every learner number the prose quotes from its own code, over twelve draws of the random features and the data as well as the draw the page uses;
 *   (2) checks the closed forms: the error budget, the fold of a bounce (slopes +1 and -e, agreement with the simulator to within one sub-step), the counting argument of the
 *       hierarchy, the token arithmetic of the exit, and the share of pixel variance that is nuisance in lesson 3's picture (re-measured with the Courtyard's own renderer);
 *   (3) re-implements the maze planners (jump planner with nudge-then-coast macro-actions, flat and subgoal planners of lesson 9) from the specification, runs every table the prose
 *       quotes with its own code, and checks whole episodes against the lesson's engine;
 *   (4) drives the page's own widget into the states the prose describes and compares what it prints with the independent numbers.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const L10 = require(path.join(DIR, 'l10_jumps.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const lap = m => process.stderr.write('  ' + m + '\n');                  // progress on stderr (no clock: the oracle is deterministic)
const ONLY = process.env.W10_ONLY ? process.env.W10_ONLY.split(',') : null;        // development: run some sections only
const want = k => !ONLY || ONLY.includes(k);
const med = a => { const b = Array.from(a).sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };      // the middle element of the sorted list
const pctl = (a, q) => { const b = Array.from(a).sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };

/* ═════════════ 1. the Courtyard's plain world, written out ═════════════ */
const W = 8, HGT = 5, R = 0.1, GAM = 0.35, REST = 0.9, SUB = 5, DT = 0.1;
const HH = DT / SUB, DAMP = Math.exp(-GAM * HH), GLIDE = (1 - DAMP) / GAM;
/* one control step of the coasting ball (no action), counting the wall hits; x = [x, y, vx, vy] */
function stepPlain(x, ev) {
  let px = x[0], py = x[1], vx = x[2], vy = x[3];
  for (let i = 0; i < SUB; i++) {
    px += vx * GLIDE; py += vy * GLIDE; vx *= DAMP; vy *= DAMP;
    if (px < R) { px = 2 * R - px; vx = -REST * vx; ev.nx++; }
    if (px > W - R) { px = 2 * (W - R) - px; vx = -REST * vx; ev.nx++; }
    if (py < R) { py = 2 * R - py; vy = -REST * vy; ev.ny++; }
    if (py > HGT - R) { py = 2 * (HGT - R) - py; vy = -REST * vy; ev.ny++; }
  }
  return [px, py, vx, vy];
}
function jumpPlain(x, S) { const ev = { nx: 0, ny: 0 }; let s = x; for (let t = 0; t < S; t++) s = stepPlain(s, ev); return { s, nx: ev.nx, ny: ev.ny }; }
{ // the written-out step is the Courtyard's, to the last bit, and so is the engine's jump
  const rng = CY.rng(5), w0 = CY.world({ curtain: null }); let bad = 0, badJ = 0;
  for (let k = 0; k < 600; k++) {
    const x = CY.launch(w0, rng), S = [1, 2, 4, 8, 16, 32, 64][k % 7]; let a = x, b = x;
    for (let t = 0; t < S; t++) { a = CY.step(w0, a, null); b = stepPlain(b, { nx: 0, ny: 0 }); }
    if (a.some((v, i) => v !== b[i])) bad++;
    const e = jumpPlain(x, S), g = L10.jump(x, S);
    if (e.s.some((v, i) => v !== g.s[i]) || e.nx !== g.nx || e.ny !== g.ny) badJ++;
  }
  ok('written-out step equals CY.step to the last bit (600 jumps)', bad === 0, bad);
  ok('written-out jump and hit counts equal the engine\'s', badJ === 0, badJ);
}
/* launched balls at random moments of their first 9.6 s: the states the models are trained on (same stream order as the engine documents: launch, then the moment) */
function baseStates(n, seed, tmax) { const r = CY.rng(seed), w0 = CY.world({ curtain: null }), out = []; for (let i = 0; i < n; i++) { let st = CY.launch(w0, r); const t0 = Math.floor(r() * tmax); for (let t = 0; t < t0; t++) st = CY.step(w0, st, null); out.push(st); } return out; }
function pairsOf(n, seed, S, tmax) { return baseStates(n, seed, tmax || 96).map(x => { const j = jumpPlain(x, S); return { x, y: j.s, nx: j.nx, ny: j.ny }; }); }
{ const a = pairsOf(40, 107, 8), b = L10.pairs(40, 107, 8), a2 = pairsOf(40, 1107, 8, 48), b2 = L10.pairs(40, 1107, 8, 48); ok('test pairs equal the engine\'s', a2.every((d, i) => d.y.every((v, k) => v === b2[i].y[k]) && d.nx === b2[i].nx)); ok('pairs equal the engine\'s', a.every((d, i) => d.y.every((v, k) => v === b[i].y[k]) && d.nx === b[i].nx && d.ny === b[i].ny && d.x.every((v, k) => v === b[i].x[k]))); }

/* ═════════════ 2. the learner, written out ═════════════ */
const MF = 64, SCALE = 1.5, LAM = 1e-4;
function chol(A, p) {                                       // lower Cholesky factor of a symmetric positive definite p x p matrix
  const L = new Float64Array(p * p);
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * p + j]; for (let k = 0; k < j; k++) s -= L[i * p + k] * L[j * p + k];
    L[i * p + j] = i === j ? Math.sqrt(s) : s / L[j * p + j];
  }
  return L;
}
function ridgeFit(F, T, p, q, lam) {                        // (F'F + lam I) W = F'T by Cholesky; F: n rows of p, T: n rows of q; W is p x q (row-major)
  const A = new Float64Array(p * p), B = new Float64Array(p * q);
  for (let i = 0; i < F.length; i++) { const f = F[i], t = T[i]; for (let a = 0; a < p; a++) { const fa = f[a]; for (let b = 0; b < p; b++) A[a * p + b] += fa * f[b]; for (let c = 0; c < q; c++) B[a * q + c] += fa * t[c]; } }
  for (let a = 0; a < p; a++) A[a * p + a] += lam;
  const L = chol(A, p), W2 = new Float64Array(p * q);
  for (let c = 0; c < q; c++) {
    const y = new Float64Array(p); for (let i = 0; i < p; i++) { let s = B[i * q + c]; for (let k = 0; k < i; k++) s -= L[i * p + k] * y[k]; y[i] = s / L[i * p + i]; }
    for (let i = p - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < p; k++) s -= L[k * p + i] * W2[k * q + c]; W2[i * q + c] = s / L[i * p + i]; }
  }
  return W2;
}
const keyOf = (nx, ny) => Math.min(nx, 3) * 4 + Math.min(ny, 3);
function makeLearner(seed, D, MW) {                         // random features (weights from the seeded generator), then the three heads fitted by ridge; MW features (default 64)
  const MF = MW || 64;
  const r = CY.rng(seed), W1 = [], b1 = [];
  for (let i = 0; i < 4; i++) { W1.push([]); }
  const flat = []; for (let i = 0; i < 4 * MF; i++) flat.push(SCALE * CY.randn(r)); for (let j = 0; j < MF; j++) b1.push(CY.randn(r));
  for (let i = 0; i < 4; i++) for (let j = 0; j < MF; j++) W1[i].push(flat[i * MF + j]);
  const phi = x => { const z = [x[0] / 4 - 1, x[1] / 2.5 - 1, x[2] / 3, x[3] / 3], f = new Float64Array(MF + 1); for (let j = 0; j < MF; j++) f[j] = Math.tanh(b1[j] + z[0] * W1[0][j] + z[1] * W1[1][j] + z[2] * W1[2][j] + z[3] * W1[3][j]); f[MF] = 1; return f; };
  const F = D.map(d => phi(d.x)), T = D.map(d => [d.y[0] / 4 - 1, d.y[1] / 2.5 - 1, d.y[2] / 3, d.y[3] / 3, d.nx, d.ny]);
  const p = MF + 1, Wall = ridgeFit(F, T, p, 6, LAM), groups = {};
  D.forEach((d, i) => { (groups[keyOf(d.nx, d.ny)] = groups[keyOf(d.nx, d.ny)] || []).push(i); });
  const gate = {}; for (const k of Object.keys(groups)) if (groups[k].length >= 12) gate[k] = ridgeFit(groups[k].map(i => F[i]), groups[k].map(i => T[i].slice(0, 4)), p, 4, LAM * 3);
  const dot = (f, Wm, q, c) => { let s = 0; for (let k = 0; k < p; k++) s += f[k] * Wm[k * q + c]; return s; };
  const back = u => [(u[0] + 1) * 4, (u[1] + 1) * 2.5, u[2] * 3, u[3] * 3];
  const none = (x, f) => { f = f || phi(x); return back([0, 1, 2, 3].map(c => dot(f, Wall, 6, c))); };
  const counts = (x, f) => { f = f || phi(x); return [Math.max(0, Math.round(dot(f, Wall, 6, 4))), Math.max(0, Math.round(dot(f, Wall, 6, 5)))]; };
  const given = (x, nx, ny, f) => { f = f || phi(x); const Wg = gate[keyOf(nx, ny)]; return Wg ? back([0, 1, 2, 3].map(c => dot(f, Wg, 4, c))) : none(x, f); };
  const forecast = x => { const f = phi(x), c = counts(x, f); return given(x, c[0], c[1], f); };
  return { none, counts, given, forecast, gates: Object.keys(gate).length };
}
const STRIDES = [1, 2, 4, 8, 16, 32, 64], TAU = 0.05, HMAX = 192;
const dist = (q, y) => Math.hypot(q[0] - y[0], q[1] - y[1]);
/* one stride: fit, then the one-jump errors (400 fresh jumps) and the chained errors (100 launched balls, J jumps, the model's own output fed back) */
function studyStride(S, o) {
  const D = pairsOf(o.n, o.dseed, S), te = pairsOf(o.ntest, o.dseed + 1000, S, 48), M = makeLearner(o.seed, D, o.m), res = { S };
  const e = f => te.map(d => dist(f(d), d.y));
  res.eNone = med(e(d => M.none(d.x))); res.eFc = med(e(d => M.forecast(d.x))); res.eObs = med(e(d => M.given(d.x, d.nx, d.ny)));
  const hits = te.filter(d => d.nx + d.ny > 0), clean = te.filter(d => d.nx + d.ny === 0);
  res.pHit = hits.length / te.length;
  { const en = te.map(d => dist(M.none(d.x), d.y)); let sa = 0, sh = 0; te.forEach((d, i) => { sa += en[i] * en[i]; if (d.nx + d.ny > 0) sh += en[i] * en[i]; }); res.sqShareHit = sh / sa; }
  res.hitNone = med(hits.map(d => dist(M.none(d.x), d.y))); res.hitFc = med(hits.map(d => dist(M.forecast(d.x), d.y))); res.hitObs = med(hits.map(d => dist(M.given(d.x, d.nx, d.ny), d.y)));
  res.cleanNone = clean.length ? med(clean.map(d => dist(M.none(d.x), d.y))) : NaN; res.cleanObs = clean.length ? med(clean.map(d => dist(M.given(d.x, d.nx, d.ny), d.y))) : NaN;
  res.recall = hits.length ? hits.filter(d => { const c = M.counts(d.x); return c[0] === d.nx && c[1] === d.ny; }).length / hits.length : NaN;
  res.falseAlarm = clean.length ? clean.filter(d => { const c = M.counts(d.x); return c[0] + c[1] > 0; }).length / clean.length : NaN;
  const K = Math.floor(HMAX / S), r = CY.rng(o.dseed + 7), w0 = CY.world({ curtain: null }), En = [], Ef = [], Eo = [];
  for (let j = 0; j < K; j++) { En.push([]); Ef.push([]); Eo.push([]); }
  const Hs = []; for (let j = 0; j < K; j++) Hs.push([]);                       // did the true chain contain a wall hit within its first j + 1 jumps?
  for (let k = 0; k < o.starts; k++) {
    let st0 = CY.launch(w0, r); const t0 = Math.floor(r() * 48); for (let t = 0; t < t0; t++) st0 = CY.step(w0, st0, null);
    let tru = st0, hn = st0, hf = st0, ho = st0, hit = false;
    for (let j = 0; j < K; j++) { const tj = jumpPlain(tru, S); tru = tj.s; hit = hit || tj.nx + tj.ny > 0; hn = M.none(hn); hf = M.forecast(hf); ho = M.given(ho, tj.nx, tj.ny); En[j].push(dist(hn, tru)); Ef[j].push(dist(hf, tru)); Eo[j].push(dist(ho, tru)); Hs[j].push(hit); }
  }
  res.hitFlags = Hs;
  res.chNone = En.map(med); res.chFc = Ef.map(med); res.chObs = Eo.map(med); res.rawNone = En; res.rawFc = Ef; res.rawObs = Eo;
  const reach = m => { let J = 0; while (J < m.length && m[J] <= TAU) J++; return J * S; };
  res.reachNone = reach(res.chNone); res.reachFc = reach(res.chFc); res.reachObs = reach(res.chObs);
  res.gates = M.gates;
  return res;
}
const OPT = { seed: 6, dseed: 107, n: 1500, ntest: 2000, starts: 100 };
ok('the page\'s learner is the one fixed in the engine', L10.OPT.seed === OPT.seed && L10.OPT.dseed === OPT.dseed && L10.OPT.n === OPT.n && L10.OPT.ntest === OPT.ntest && L10.OPT.starts === OPT.starts && L10.OPT.m === MF && L10.OPT.scale === SCALE && L10.OPT.lam === LAM);
const ST = {};                                              // the draw the page uses, every stride
if (want('study')) {
  for (const S of STRIDES) ST[S] = studyStride(S, OPT);
  lap('study, own code');
  const EN = {}; for (const S of STRIDES) EN[S] = L10.one(S);
  lap('study, engine');
  for (const S of STRIDES) {
    const a = ST[S], b = EN[S];
    ok('stride ' + S + ': one-jump errors equal the engine\'s', close(a.eNone, b.oneNone, 1e-7) && close(a.eFc, b.oneSum, 1e-7) && close(a.eObs, b.oneObs, 1e-7), [a.eNone, b.oneNone, a.eFc, b.oneSum, a.eObs, b.oneObs]);
    ok('stride ' + S + ': chained errors equal the engine\'s', a.chNone.every((v, i) => close(v, b.medNone[i], 1e-7)) && a.chFc.every((v, i) => close(v, b.medSum[i], 1e-7)) && a.chObs.every((v, i) => close(v, b.medObs[i], 1e-7)));
    const same = (x, y) => (Number.isNaN(x) && Number.isNaN(y)) || close(x, y, 1e-7);
    ok('stride ' + S + ': reach, recall, hit errors equal the engine\'s', a.reachNone === b.reachNone && a.reachFc === b.reachSum && a.reachObs === b.reachObs && same(a.recall, b.recall) && same(a.hitNone, b.hitNone) && same(a.hitObs, b.hitObs) && same(a.pHit, b.pBounce), [a.reachNone, b.reachNone, a.recall, b.recall]);
  }
  const setF = (k, v) => { if (Number.isFinite(v)) facts[k] = v; };
  for (const S of STRIDES) {
    const a = ST[S], k = String(S), mm = x => 1000 * x;
    facts['e_none_' + k] = mm(a.eNone); facts['e_fc_' + k] = mm(a.eFc); facts['e_obs_' + k] = mm(a.eObs);
    setF('hit_none_' + k, mm(a.hitNone)); setF('hit_fc_' + k, mm(a.hitFc)); setF('hit_obs_' + k, mm(a.hitObs)); setF('clean_none_' + k, mm(a.cleanNone)); setF('clean_obs_' + k, mm(a.cleanObs));
    setF('p_hit_' + k, 100 * a.pHit); setF('recall_' + k, 100 * a.recall); setF('false_alarm_' + k, 100 * a.falseAlarm); facts['n_hit_' + k] = Math.round(a.pHit * OPT.ntest); facts['n_clean_' + k] = OPT.ntest - Math.round(a.pHit * OPT.ntest);
    setF('sq_share_hit_' + k, 100 * a.sqShareHit);
    facts['reach_none_' + k] = a.reachNone; facts['reach_fc_' + k] = a.reachFc; facts['reach_obs_' + k] = a.reachObs;
    facts['jmax_none_' + k] = a.reachNone / S; facts['jmax_fc_' + k] = a.reachFc / S; facts['jmax_obs_' + k] = a.reachObs / S;
    const at = (m, H) => m[Math.max(0, Math.round(H / S) - 1)];
    facts['ch64_none_' + k] = 100 * at(a.chNone, 64); facts['ch64_fc_' + k] = 100 * at(a.chFc, 64); facts['ch64_obs_' + k] = 100 * at(a.chObs, 64);
    facts['ch192_none_' + k] = 100 * at(a.chNone, 192); facts['ch192_fc_' + k] = 100 * at(a.chFc, 192);
  }
}
if (want('study')) {
  const a8 = ST[8], at64 = (S, raw) => raw[Math.round(64 / S) - 1];
  facts.tail_fc_8_p90 = 100 * pctl(at64(8, a8.rawFc), 0.9); facts.tail_fc_8_over = 100 * at64(8, a8.rawFc).filter(v => v > TAU).length / OPT.starts;
  facts.tail_none_8_over = 100 * at64(8, a8.rawNone).filter(v => v > TAU).length / OPT.starts;
  { const e = at64(8, a8.rawFc), h = at64(8, a8.hitFlags), idx = e.map((v, i) => i).sort((x, y) => e[y] - e[x]);
    facts.tail_chains_hit = 100 * h.filter(Boolean).length / h.length;                                    // chains that contain a true wall hit within 64 steps
    facts.tail_top10_hit = idx.slice(0, 10).filter(i => h[i]).length;                                    // of the ten worst chains, how many contain a hit
    facts.tail_hitfree_over = 100 * idx.filter(i => !h[i] && e[i] > TAU).length / Math.max(1, h.filter(x => !x).length);   // hit-free chains beyond 5 cm (%)
    facts.tail_hit_over = 100 * idx.filter(i => h[i] && e[i] > TAU).length / Math.max(1, h.filter(Boolean).length);         // chains with a hit beyond 5 cm (%)
    facts.tail_hit_med = 100 * med(idx.filter(i => h[i]).map(i => e[i])); facts.tail_hitfree_med = 100 * med(idx.filter(i => !h[i]).map(i => e[i])); }
  for (const S of STRIDES) facts['law_fc_' + S] = (100 * at64(S, ST[S].chFc.map((v, i) => v))) / (100 * (64 / S) * ST[S].eFc);
  facts.law_none_8 = facts.ch64_none_8 / (100 * 8 * ST[8].eNone);
  facts.cross_steps = Math.round(2 * 0.45 / 0.5 / DT);
  for (const S of [8, 16, 32, 64]) facts['er_' + S] = ST[S].eNone / ST[1].eNone;
  facts.law_dev_max = Math.max(...STRIDES.map(S => Math.abs(facts['law_fc_' + S] - 1))) * 100;
  facts.p_clean_8 = 100 - facts.p_hit_8;
  facts.bud_stride_add = Math.ceil(60 / Math.floor(TAU / ST[1].eNone));
}
if (want('study')) { console.error(JSON.stringify(STRIDES.map(S => [S, +(1000 * ST[S].eNone).toFixed(1), +(1000 * ST[S].eFc).toFixed(1), +(1000 * ST[S].eObs).toFixed(1), ST[S].reachNone, ST[S].reachFc, ST[S].reachObs, +(100 * ST[S].recall).toFixed(0)]))); }

/* twelve draws of the random features and of the data: feature seed k = 1..12 with data seed 101 + k (the page uses k = 6) */
const DRAWS = [];
if (want('robust')) {
  for (let k = 1; k <= 12; k++) { const o = Object.assign({}, OPT, { seed: k, dseed: 101 + k }), row = {}; for (const S of STRIDES) row[S] = studyStride(S, o); DRAWS.push(row); }
  lap('twelve draws');
  const dr = S => ({ rN: DRAWS.map(d => d[S].reachNone), rF: DRAWS.map(d => d[S].reachFc), rO: DRAWS.map(d => d[S].reachObs), eN: DRAWS.map(d => 1000 * d[S].eNone), eF: DRAWS.map(d => 1000 * d[S].eFc) });
  for (const S of STRIDES) {
    const q = dr(S), k = String(S);
    facts['rob_reach_none_med_' + k] = med(q.rN); facts['rob_reach_none_min_' + k] = Math.min(...q.rN); facts['rob_reach_none_max_' + k] = Math.max(...q.rN);
    facts['rob_reach_fc_med_' + k] = med(q.rF); facts['rob_reach_fc_min_' + k] = Math.min(...q.rF); facts['rob_reach_fc_max_' + k] = Math.max(...q.rF);
    facts['rob_e_none_med_' + k] = med(q.eN); facts['rob_e_none_min_' + k] = Math.min(...q.eN); facts['rob_e_none_max_' + k] = Math.max(...q.eN);
    facts['rob_e_fc_med_' + k] = med(q.eF); facts['rob_e_fc_max_' + k] = Math.max(...q.eF);
  }
  facts.rob_peak_none_max = Math.max(...DRAWS.map(d => Math.max(...STRIDES.map(S => d[S].reachNone))));
  facts.rob_peak_none_min = Math.min(...DRAWS.map(d => Math.max(...STRIDES.map(S => d[S].reachNone))));
  facts.rob_zero_32 = DRAWS.filter(d => d[32].reachNone === 0).length; facts.rob_zero_64 = DRAWS.filter(d => d[64].reachNone === 0).length;
  facts.rob_fc_beats_none_8 = DRAWS.filter(d => d[8].reachFc > d[8].reachNone).length;
  facts.rob_fc_beats_none_16 = DRAWS.filter(d => d[16].reachFc > d[16].reachNone).length;
  facts.rob_fc_beats_none_32 = DRAWS.filter(d => d[32].reachFc > d[32].reachNone).length;
  facts.rob_fc_beats_none_64 = DRAWS.filter(d => d[64].reachFc > d[64].reachNone).length;
  facts.rob_fc_ratio_16 = med(DRAWS.map(d => d[16].reachFc / Math.max(1, d[16].reachNone)));
  ok('the page\'s draw is the sixth of the twelve', DRAWS[5][8].reachNone === ST[8].reachNone && DRAWS[5][16].reachFc === ST[16].reachFc);
}

/* ═════════════ 3. closed forms ═════════════ */
if (want('forms')) {
  /* 3a. the fold: a jump without a hit is exactly linear; a jump with one hit on the right wall is x' = w - e (u - w), u the unfolded end point */
  const w = W - R, c8 = S => (1 - Math.exp(-GAM * DT * S)) / GAM;
  for (const S of [8, 32]) {
    const c = c8(S), dS = Math.exp(-GAM * DT * S); let n = 0, maxE = 0, maxL = 0; const errs = [];
    for (let v0 = 1.0; v0 <= 4.5; v0 += 0.25) for (let x0 = 3; x0 <= 7.8; x0 += 0.05) {
      const j = jumpPlain([x0, 2.5, v0, 0], S), u = x0 + c * v0;
      if (j.nx === 0 && j.ny === 0) { maxL = Math.max(maxL, Math.abs(j.s[0] - u), Math.abs(j.s[2] - dS * v0)); }
      if (j.nx === 1 && j.ny === 0) { const e = Math.abs(j.s[0] - (w - REST * (u - w))); errs.push(e); maxE = Math.max(maxE, e); n++; }
    }
    ok('a jump without a hit is exactly linear (stride ' + S + ')', maxL < 1e-9, maxL);
    if (S === 8) { facts.fold_n = n; facts.fold_err_max_mm = 1000 * maxE; facts.fold_err_med_mm = 1000 * med(errs); facts.fold_c = c; facts.fold_d = dS; }
  }
  { // slopes of x' against x0 (v0 = 3, stride 8) on either side of the kink at x0* = w - c v0, as secants over half a metre
    const S = 8, c = c8(S), v0 = 3, kink = w - c * v0, f = x0 => jumpPlain([x0, 2.5, v0, 0], S).s[0];
    facts.fold_kink = kink; facts.fold_slope_pre = (f(kink - 0.2) - f(kink - 0.7)) / 0.5; facts.fold_slope_post = (f(kink + 0.7) - f(kink + 0.2)) / 0.5;
    ok('slope +1 before the fold', close(facts.fold_slope_pre, 1, 1e-9), facts.fold_slope_pre);
    ok('slope -e after the fold (secant over 0.5 m, within the sub-step sawtooth)', close(facts.fold_slope_post, -REST, 0.02), facts.fold_slope_post);
  }
  /* 3b. the error budget */
  const tau = TAU, Hn = 60;
  facts.bud_tau_mm = 1000 * tau; facts.bud_H = Hn; facts.bud_delta_add_mm = 1000 * tau / Hn;
  const dRho = (rho, H) => tau * (rho - 1) / (Math.pow(rho, H) - 1);
  facts.bud_delta_105_mm = 1000 * dRho(1.05, Hn); facts.bud_delta_101_mm = 1000 * dRho(1.01, Hn); facts.bud_growth_105 = Math.pow(1.05, Hn);
  ok('budget forms agree at rho -> 1', close(dRho(1 + 1e-9, Hn), tau / Hn, 1e-7));
  if (ST[1]) {
    facts.bud_over = (ST[1].eNone * Hn) / tau;                     // how many times too large the one-step error is for an additive 60-step plan
    facts.bud_jmax_add = Math.floor(tau / ST[1].eNone);            // applications within tolerance if errors only added
    facts.bud_stride_add = Math.ceil(Hn / Math.floor(tau / ST[1].eNone));
    const ch = ST[1].chNone; facts.bud_chain6 = 100 * ch[5]; facts.bud_chain1 = 100 * ch[0]; facts.bud_amp6 = ch[5] / ch[0];
    let lo = 1, hi = 3; for (let it = 0; it < 80; it++) { const rho = (lo + hi) / 2; let sum = 0; for (let i = 0; i < 6; i++) sum += Math.pow(rho, i); if (sum < facts.bud_amp6) lo = rho; else hi = rho; }
    facts.bud_rho_hat = (lo + hi) / 2;
    facts.bud_need_stride_meas = Math.ceil(Hn / (ST[8].reachNone / 8));   // with the stride-8 reach: not used in the prose unless it is clean
  }
  /* 3c. the counting argument of the hierarchy: b nudge choices, H steps; segments of s steps, H/s of them */
  const b = 5, Hh = 64, sh = 8, flat = Math.pow(b, Hh), hier = Math.pow(b, Hh / sh) + (Hh / sh) * Math.pow(b, sh);
  facts.hier_b = b; facts.hier_H = Hh; facts.hier_s = sh; facts.hier_flat_log10 = Hh * Math.log10(b); facts.hier_two_level = hier; facts.hier_two_level_log10 = Math.log10(hier);
  facts.hier_ratio_log10 = Math.log10(flat / hier); facts.hier_opt_s = Math.sqrt(Hh);
  let best = [Infinity, 0]; for (const s of [1, 2, 4, 8, 16, 32, 64]) { const c = Math.pow(b, Hh / s) + (Hh / s) * Math.pow(b, s); if (c < best[0]) best = [c, s]; }
  facts.hier_best_s = best[1]; ok('the best segment length is the square root of the horizon', best[1] === 8, best);
  facts.hier_three_flat = Math.pow(b, 4) ; // placeholder for three levels (unused)
  /* levels multiply the reach: J jumps per level, stride s, k levels */
  facts.lev_s = 8; facts.lev_J = 8; facts.lev_1 = 8 * 8; facts.lev_2 = 8 * 8 * 8; facts.lev_3 = 8 * 8 * 8 * 8;
  /* 3d. the exit arithmetic */
  facts.px_side = 256; facts.px_numbers = 256 * 256 * 3; facts.px_patch = 16; facts.px_tokens = Math.pow(256 / 16, 2); facts.px_fps = 8;
  facts.tok_s = facts.px_tokens * 8; facts.tok_min = facts.tok_s * 60; facts.tok_h = facts.tok_min * 60; facts.tok_h_m = facts.tok_h / 1e6; facts.px_vs_state = facts.px_numbers / 4;
  ok('196,608 numbers, 256 tokens, 7,372,800 tokens an hour', facts.px_numbers === 196608 && facts.px_tokens === 256 && facts.tok_h === 7372800);
  /* the share of pixel variance that is the ball, in lesson 3's picture (nuisance level 1): re-measured with the Courtyard's own renderer */
  { const wr = CY.world({}), r = CY.rng(11), N = 3000, npix = 24 * 15;
    const frames = (nu, fixBall) => { const out = []; for (let i = 0; i < N; i++) { let x, y; do { x = 0.3 + 7.4 * r(); y = 0.3 + 4.4 * r(); } while (CY.occluded(wr, [x, y, 0, 0])); if (fixBall) { x = 5.0; y = 2.0; } const cx = r() * 7 + 0.5, g = 1 + 0.1 * nu * CY.randn(r); out.push(CY.img.render(wr, [x, y, 0, 0], { sigma: 1.5, band: nu > 0 ? { cx, width: 0.4, amp: 0.8 * nu } : null, gain: g })); } return out; };
    const tv = F => { const mean = new Float64Array(npix); F.forEach(f => f.forEach((v, k) => mean[k] += v / F.length)); let sum = 0; F.forEach(f => f.forEach((v, k) => sum += (v - mean[k]) ** 2 / F.length)); return sum; };
    const Vfull = tv(frames(1, false)), Vball = tv(frames(0, false));
    facts.var_full = Vfull; facts.var_ball = Vball; facts.ball_share = 100 * Vball / Vfull; facts.nuis_share = 100 - facts.ball_share;
    ok('lesson 3: ball variance 4.05, total 21.0, ball share 19 %', close(Vball, 4.05, 0.01) && close(Vfull, 21.0, 0.06) && Math.round(facts.ball_share) === 19, [Vball, Vfull]);
  }
  /* 3e. the checkpoint */
  { const e = 0.007, J = Math.floor(TAU / e + 1e-12); facts.ck_J = J; facts.ck_cover = J * 8; facts.ck_l2 = J * facts.ck_cover; facts.ck_l3 = J * facts.ck_l2; let lv = 0, cov = 8; while (cov < 1000) { cov *= J; lv++; } facts.ck_levels = lv; ok('checkpoint: 7 jumps, 56, 392, 2744, three levels', J === 7 && facts.ck_l3 === 2744 && lv === 3, [J, lv]); }
  lap('closed forms');
}
/* the road not taken: spend on the learner (256 features, 6,000 jumps) */
if (want('road')) {
  const o = Object.assign({}, OPT, { n: 6000, m: 256 });
  for (const S of [1, 8, 64]) { const a = studyStride(S, o); facts['cap_e_none_' + S] = 1000 * a.eNone; facts['cap_e_fc_' + S] = 1000 * a.eFc; facts['cap_reach_none_' + S] = a.reachNone; facts['cap_reach_fc_' + S] = a.reachFc; }
  facts.cap_cost = (6000 * 257 * 257) / (1500 * 65 * 65);
  facts.cap_stride_2400 = Math.ceil(2400 / facts.cap_reach_fc_1);
  lap('road: bigger model');
}


/* ═════════════ 4. the maze, planners written out from the specification ═════════════ */
const MP = []; for (let y = 0.2; y <= 3.75; y += 0.35) MP.push({ x: 4.0, y: +y.toFixed(2), r: 0.2 });
ok('eleven posts', MP.length === 11, MP.length);
const WM = CY.world({ curtain: null, posts: MP, goal: { x: 7.0, y: 1.0, r: 0.45 } });
const GX = 7, GY = 1, GR = 0.45, AM = 0.6, TEP = 160, POP = 60, ITERS = 5;
const startOf = seed => { const r = CY.rng(7000 + seed); return [1 + 0.2 * (r() - 0.5), 1 + 0.2 * (r() - 0.5), 0, 0]; };
const dGoal = q => Math.hypot(q[0] - GX, q[1] - GY);
const dockedAt = q => dGoal(q) < GR && Math.hypot(q[2], q[3]) <= 0.5;
const clipN = (ax, ay, A) => { const n = Math.hypot(ax, ay); return n > A ? [ax * A / n, ay * A / n] : [ax, ay]; };
/* a macro-action is a nudge (norm <= 0.6 S, the sum of the S per-step limits) at the first step of a jump, then S - 1 steps of coasting; its cost along a plan of J jumps:
 * 0.2 S times the distance after each jump, plus 3 times the last distance */
function planJumps(s0, J, S, seed, pop, iters) {
  const A = AM * S;
  const cost = v => { let q = s0, c = 0; for (let j = 0; j < J; j++) { q = CY.step(WM, q, clipN(v[2 * j], v[2 * j + 1], A)); for (let u = 1; u < S; u++) q = CY.step(WM, q, null); c += 0.2 * S * dGoal(q); } return c + 3 * dGoal(q); };
  return CY.cem(cost, 2 * J, { iters: iters || ITERS, pop: pop || POP, sd0: 0.5 * A, seed, clip: [-A, A], minSd: 0.02 * Math.max(1, S / 4) }).best;
}
function episodeJ(J, S, seed, pop, iters) {                                 // receding horizon: plan, run the first jump, observe, plan again; reports docking and first entry
  let s = startOf(seed), t = 0, dock = -1, enter = -1, calls = 0, dec = 0, inDisc = 0, vmin = Infinity; const A = AM * S;
  while (t < TEP && dock < 0) {
    const v = planJumps(s, J, S, seed * 1009 + t, pop, iters), a = clipN(v[0], v[1], A); calls += (pop || POP) * (iters || ITERS) * J; dec++;
    for (let u = 0; u < S && t < TEP; u++, t++) { s = CY.step(WM, s, u === 0 ? a : null); if (dGoal(s) < GR) { inDisc++; vmin = Math.min(vmin, Math.hypot(s[2], s[3])); if (enter < 0) enter = t + 1; } if (dockedAt(s)) { dock = t + 1; break; } }
  }
  return { dock, enter, calls, dec, inDisc, vmin };
}
const SUBG = { x: 4.0, y: 4.45 };
function planTo(s0, tg, H, seed, pop, iters) {
  const cost = v => { let q = s0, c = 0, d = 0; for (let t = 0; t < H; t++) { q = CY.step(WM, q, clipN(v[2 * t], v[2 * t + 1], AM)); d = Math.hypot(q[0] - tg.x, q[1] - tg.y); c += 0.2 * d; } return c + 3 * d; };
  return CY.cem(cost, 2 * H, { iters: iters || ITERS, pop: pop || POP, sd0: 0.3, seed, clip: [-AM, AM], minSd: 0.02 }).best;
}
function episodeSk(Hlow, seed, wps, rad, pop, iters) {           // the flat planner of lesson 9 toward each subgoal in turn (none: toward the goal), switching within rad of it
  const goals = wps.concat([{ x: GX, y: GY }]); let gi = 0, s = startOf(seed), dock = -1, calls = 0, dec = 0, sw = -1, inDisc = 0, vmin = Infinity;
  for (let t = 0; t < TEP; t++) {
    while (gi < goals.length - 1 && Math.hypot(s[0] - goals[gi].x, s[1] - goals[gi].y) < rad) { gi++; sw = t; }
    const v = planTo(s, goals[gi], Hlow, seed * 1009 + t, pop, iters); calls += (pop || POP) * (iters || ITERS) * Hlow; dec++;
    s = CY.step(WM, s, clipN(v[0], v[1], AM)); if (dGoal(s) < GR) { inDisc++; vmin = Math.min(vmin, Math.hypot(s[2], s[3])); } if (dockedAt(s)) { dock = t + 1; break; }
  }
  return { dock, calls, dec, sw, inDisc, vmin };
}
const NE = 20, SEEDS = Array.from({ length: NE }, (_, i) => i + 1);
const tally = (rs, key) => { const hits = rs.filter(r => r[key] > 0).map(r => r[key]); return { n: hits.length, med: hits.length ? med(hits) : -1 }; };
const MZ = { flat: {}, jump: {}, sk: {} };
if (want('maze')) {
  /* the engine and this file agree on whole episodes */
  for (const [J, S] of [[3, 8], [2, 8], [6, 4], [1, 16], [24, 2]]) for (const seed of [1, 2, 3]) { const a = episodeJ(J, S, seed), b = L10.episodeJumps(J, S, seed); ok('jump episode (J ' + J + ', stride ' + S + ', seed ' + seed + ') equals the engine\'s', a.dock === b.hit && a.calls === b.apps && a.dec === b.decisions, [a, b.hit, b.apps]); }
  for (const [H, seed] of [[12, 1], [60, 1], [60, 2]]) { const a = episodeSk(H, seed, [], 0), b = L10.episodeFlat(H, seed); ok('flat episode (H ' + H + ', seed ' + seed + ') equals the engine\'s', a.dock === b.hit && a.calls === b.apps, [a, b.hit, b.apps]); }
  for (const [H, seed] of [[8, 1], [8, 2], [25, 3]]) { const a = episodeSk(H, seed, [SUBG], 0.4), b = L10.episodeSkills(H, seed); ok('skill episode (H_low ' + H + ', seed ' + seed + ') equals the engine\'s', a.dock === b.hit && a.calls === b.apps && a.dec === b.decisions, [a, b.hit, b.apps]); }
  lap('maze: engine cross-check');
  /* flat receding-horizon planner of lesson 9 (all of the lesson's numbers are 20 episodes, seeds 1 to 20, starts within 10 cm of (1, 1)) */
  for (const H of [12, 25, 40, 50, 60]) { const rs = SEEDS.map(sd => episodeSk(H, sd, [], 0)), t = tally(rs, 'dock'); MZ.flat[H] = rs; facts['flat_dock_' + H] = t.n; facts['flat_steps_' + H] = t.med; facts['flat_calls_' + H] = Math.round(rs.reduce((a, r) => a + r.calls, 0) / NE); facts['flat_calls_dec_' + H] = POP * ITERS * H; }
  lap('maze: flat planner');
  /* jump planner: every (stride, J) in the grid */
  const GRID = { 1: [24, 48, 64], 2: [8, 16, 24, 32], 4: [3, 4, 6, 8, 12], 8: [1, 2, 3, 4, 6], 16: [1, 2, 3], 32: [1, 2, 3], 64: [1, 2, 3] };
  for (const S of STRIDES) {
    MZ.jump[S] = {};
    for (const J of GRID[S]) { const rs = SEEDS.map(sd => episodeJ(J, S, sd)), t = tally(rs, 'dock'), te = tally(rs, 'enter'); MZ.jump[S][J] = { rs, dock: t.n, steps: t.med, enter: te.n, calls: Math.round(rs.reduce((a, r) => a + r.calls, 0) / NE) }; facts['jd_' + S + '_' + J] = t.n; facts['je_' + S + '_' + J] = te.n; facts['js_' + S + '_' + J] = t.med; facts['jc_' + S + '_' + J] = MZ.jump[S][J].calls; }
    // the smallest J that docks in at least 18 of 20, and the best J
    const Js = GRID[S]; let jd = -1, jb = Js[0]; for (const J of Js) { if (jd < 0 && MZ.jump[S][J].dock >= 18) jd = J; if (MZ.jump[S][J].dock > MZ.jump[S][jb].dock) jb = J; }
    facts['jdock_' + S] = jd; facts['jbest_' + S] = jb; facts['jbest_dock_' + S] = MZ.jump[S][jb].dock; facts['jbest_enter_' + S] = MZ.jump[S][jb].enter;
    facts['jdec_calls_' + S] = jd > 0 ? POP * ITERS * jd : -1;
    lap('maze: jump planner, stride ' + S);
  }
  /* skills and subgoals */
  for (const H of [6, 8, 12, 25]) { const rs = SEEDS.map(sd => episodeSk(H, sd, [SUBG], 0.4)), t = tally(rs, 'dock'); MZ.sk[H] = rs; facts['sk_dock_' + H] = t.n; facts['sk_steps_' + H] = t.med; facts['sk_calls_' + H] = Math.round(rs.reduce((a, r) => a + r.calls, 0) / NE); facts['sk_sw_' + H] = med(rs.map(r => r.sw)); }
  facts.sk_vs_flat = facts.flat_calls_60 / facts.sk_calls_8;
  lap('maze: skills');
  /* the episodes the 'What to try' paragraph and the widget checks use (seed 1 unless stated) */
  { const e1 = episodeJ(3, 8, 1), e2 = episodeJ(1, 64, 1), e3 = episodeJ(64, 1, 1), e4 = episodeSk(8, 1, [SUBG], 0.4), e5 = episodeJ(1, 16, 2), e6 = episodeJ(8, 1, 1);
    facts.ex_dock_8_3 = e1.dock; facts.ex_calls_8_3 = e1.calls; facts.ex_dec_8_3 = e1.dec; facts.ex_disc_8_3 = e1.inDisc; facts.ex_vmin_8_3 = e1.vmin;
    facts.ex_expo_8_3_none = 100 * ST[8].chNone[2]; facts.ex_expo_8_3_fc = 100 * ST[8].chFc[2];
    facts.ex_dock_64_1 = e2.dock; facts.ex_disc_64_1 = e2.inDisc; facts.ex_vmin_64_1 = e2.vmin; facts.ex_calls_64_1 = e2.calls; facts.ex_dec_64_1 = e2.dec;
    facts.ex_dock_1_64 = e3.dock; facts.ex_calls_1_64 = e3.calls; facts.ex_dec_1_64 = e3.dec;
    facts.ex_dock_sk_8 = e4.dock; facts.ex_calls_sk_8 = e4.calls; facts.ex_dec_sk_8 = e4.dec;
    facts.ex_dock_16_1_s2 = e5.dock; facts.ex_disc_16_1_s2 = e5.inDisc; facts.ex_vmin_16_1_s2 = e5.vmin; facts.ex_dock_1_8 = e6.dock; facts.ex_disc_1_8 = e6.inDisc;
    ok('the example episodes are the ones the prose describes', e1.dock === 33 && e2.dock < 0 && e2.inDisc > 0 && e3.dock > 0 && e4.dock > 0 && e6.dock < 0, [e1.dock, e2.dock, e3.dock, e4.dock, e6.dock]); }
  facts.calls_ratio_8 = facts.flat_calls_dec_60 / facts.jdec_calls_8; facts.se_18_20 = Math.sqrt(0.9 * 0.1 / 20);
  facts.jdec_calls_8_3 = POP * ITERS * 3; facts.calls_ratio_8_3 = facts.flat_calls_dec_60 / facts.jdec_calls_8_3;      // J = 3 at stride 8: the setting that docks 20 of 20 (J = 2, 600 calls, docks 18)
  { const rs = SEEDS.map(sd => episodeJ(2, 16, sd, 300, 10)); facts.big_dock_16 = tally(rs, 'dock').n; facts.big_mult = (300 * 10) / (POP * ITERS); lap('maze: bigger search at stride 16'); }
  /* the roads not taken: ten times the evaluations at H = 25, in the flat planner */
  { const rs = SEEDS.slice(0, 10).map(sd => episodeSk(25, sd, [], 0, 300, 8)); facts.road_budget_dock = tally(rs, 'dock').n; facts.road_budget_n = 10; facts.road_budget_mult = (300 * 8) / (POP * ITERS); lap('maze: bigger budget'); }
}


/* ═════════════ 4b. the sentences of the prose that are claims, not numbers ═════════════ */
if (!ONLY) {
  const f = facts, SS = STRIDES;
  ok('in all twelve draws the forecast reaches farther than no summary at strides 8 to 64', [8, 16, 32, 64].every(S => f['rob_fc_beats_none_' + S] === 12), [8, 16, 32, 64].map(S => f['rob_fc_beats_none_' + S]));
  ok('reach without a summary rises, peaks at strides 4 to 8 and is nothing from 32', f.reach_none_1 < f.reach_none_4 && f.reach_none_4 === f.reach_none_8 && f.reach_none_16 < f.reach_none_8 && f.reach_none_32 === 0 && f.reach_none_64 === 0);
  ok('reach with the forecast never falls as the stride grows', SS.every((S, i) => i === 0 || f['reach_fc_' + S] >= f['reach_fc_' + SS[i - 1]] || S === 2), SS.map(S => f['reach_fc_' + S]));
  ok('the floor with the forecast stays within 6.0 to 9.7 mm, without it within 6.2 to 118 mm', SS.every(S => f['e_fc_' + S] > 5.95 && f['e_fc_' + S] < 9.7) && f.e_none_64 > 100 && SS.every(S => f['e_none_' + S] >= 6.15), SS.map(S => f['e_fc_' + S]));
  ok('the chained error follows J e_s within 17 % at every stride', f.law_dev_max < 17, f.law_dev_max);
  ok('planner needs more jumps than the model supplies at strides 1 and 2, and fewer at 4 and 8 (both models)', f.jdock_1 > f.jmax_fc_1 && f.jdock_2 > Math.max(f.jmax_none_2, f.jmax_fc_2) && f.jdock_4 <= Math.min(f.jmax_none_4, f.jmax_fc_4) && f.jdock_8 <= Math.min(f.jmax_none_8, f.jmax_fc_8), [f.jdock_1, f.jdock_2, f.jdock_4, f.jdock_8]);
  ok('no J docks 18 of 20 at strides 16, 32 and 64, yet the ball enters the goal in at least 19 of 20', f.jdock_16 < 0 && f.jdock_32 < 0 && f.jdock_64 < 0 && f.jbest_enter_16 >= 19 && f.jbest_enter_32 >= 19 && f.jbest_enter_64 >= 19);
  ok('ten times the evaluations do not fix stride 16', f.big_dock_16 <= f.jbest_dock_16 + 1 && f.big_dock_16 < 18, [f.big_dock_16, f.jbest_dock_16]);
  ok('the summary is not what makes stride 8 feasible in the maze: the unsummarised model supports the plan', f.jmax_none_8 >= f.jdock_8);
  ok('skills dock 20 of 20 at every low-level horizon, the flat planner none at 25 and 12', [6, 8, 12, 25].every(H => f['sk_dock_' + H] === 20) && f.flat_dock_25 === 0 && f.flat_dock_12 === 0 && f.flat_dock_60 === 20);
  ok('a bigger search at H = 25 does not help', f.road_budget_dock === 0);
  ok('stride 8: J = 3 (900 jump calls a decision, 20 times fewer than the flat planner) docks all 20 in fewer steps than the flat planner; J = 2 (600 calls) docks 18, slower', f.jd_8_3 === 20 && f.js_8_3 < f.flat_steps_60 && f.jdec_calls_8_3 === 900 && f.calls_ratio_8_3 === 20 && f.jd_8_2 === 18 && f.js_8_2 > f.flat_steps_60 && f.jdec_calls_8 === 600 && f.jd_8_6 < f.jd_8_3, [f.jd_8_3, f.js_8_3, f.jd_8_2, f.js_8_2, f.flat_steps_60]);
  ok('the flat planner re-run on this page\'s starts agrees with lesson 9 where the page quotes it (H = 12, 25, 50, 60: 0, 0, 18, 20 docks)', f.flat_dock_12 === 0 && f.flat_dock_25 === 0 && f.flat_dock_50 === 18 && f.flat_dock_60 === 20, [f.flat_dock_12, f.flat_dock_25, f.flat_dock_50, f.flat_dock_60]);
  ok('the bigger model lowers the stride-1 error and reach but not the stride-64 reach without a summary', f.cap_e_none_1 < f.e_none_1 / 10 && f.cap_reach_none_1 > f.reach_none_1 && f.cap_reach_none_64 === 0);
  ok('the ten worst chains of the stride-8 forecast all contain a wall hit', f.tail_top10_hit === 10);
  ok('jumps with a wall hit are rare and carry about half the squared error at strides 8 to 32', f.p_hit_8 < 2 && f.sq_share_hit_8 > 40 && f.sq_share_hit_16 > 40 && f.sq_share_hit_32 > 40);
  ok('the quarantined fit is back on the floor for jumps without a hit', f.clean_obs_16 < 8 && f.clean_obs_64 < 10 && f.clean_none_64 > 90);
}

/* ═════════════ 5. the page's own widget, driven into the states the prose describes ═════════════ */
const PAGE = path.join(DIR, '10_temporal_abstraction.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
if (HAVE_PAGE && want('widget')) {
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const IDX = { 1: 0, 2: 1, 4: 2, 8: 3, 16: 4, 32: 5, 64: 6 }, HIDX = { 8: 0, 16: 1, 24: 2, 32: 3, 48: 4, 64: 5 }, KEY = { none: 'None', sum: 'Fc', obs: 'Obs' };
  const state = (S, H, ep, k, pl) => { page.set('w10-s', IDX[S]); page.set('w10-h', HIDX[H]); page.set('w10-ep', ep); page.set('w10-sum', k); page.set('w10-pl', pl); };
  const calls = () => { const m = /(\d+) decisions, ([\d,]+)/.exec(page.text('w10-calls')); return m ? [+m[1], +m[2].replace(/,/g, '')] : [NaN, NaN]; };
  const f1 = x => Number(x.toFixed(1));
  const check = (name, S, H, ep, k, pl, E) => {                               // E: this file's own episode for these settings
    state(S, H, ep, k, pl);
    const J = Math.max(1, Math.round(H / S)), q = ST[S], ch = q['ch' + KEY[k]], e = q['e' + KEY[k]], r = q['reach' + KEY[k]];
    ok(name + ': stride readout', page.num('w10-s-v') === S && close(Number(/= ([\d.]+) s/.exec(page.text('w10-s-v'))[1]), S / 10, 1e-9), page.text('w10-s-v'));
    ok(name + ': one-jump error', close(page.num('w10-e'), f1(1000 * e), 1e-9), [page.text('w10-e'), 1000 * e]);
    ok(name + ': reach', page.num('w10-reach') === r, [page.text('w10-reach'), r]);
    if (pl === 'jumps') ok(name + ': error at the plan\'s end', close(page.num('w10-expo'), f1(100 * ch[Math.min(ch.length, J) - 1]), 1e-9), [page.text('w10-expo'), 100 * ch[J - 1]]);
    const docked = E.dock > 0;
    ok(name + ': episode outcome', docked ? page.num('w10-res') === E.dock : /no dock/.test(page.text('w10-res')), [page.text('w10-res'), E.dock]);
    ok(name + ': time in the goal disc', E.inDisc ? (page.num('w10-disc') === E.inDisc && close(Number(/slowest ([\d.]+)/.exec(page.text('w10-disc'))[1]), Number(E.vmin.toFixed(2)), 1e-9)) : /never/.test(page.text('w10-disc')), [page.text('w10-disc'), E.inDisc, E.vmin]);
    const c = calls(); ok(name + ': decisions and calls', c[0] === E.dec && c[1] === E.calls, [c, E.dec, E.calls]);
  };
  check('default (stride 8, 24 steps, episode 1)', 8, 24, 1, 'none', 'jumps', episodeJ(3, 8, 1));
  check('forecast at stride 8', 8, 24, 1, 'sum', 'jumps', episodeJ(3, 8, 1));
  check('observed at stride 8', 8, 24, 1, 'obs', 'jumps', episodeJ(3, 8, 1));
  check('stride 64, one jump', 64, 64, 1, 'none', 'jumps', episodeJ(1, 64, 1));
  check('stride 1, 64 steps', 1, 64, 1, 'sum', 'jumps', episodeJ(64, 1, 1));
  check('stride 1, 8 steps', 1, 8, 1, 'none', 'jumps', episodeJ(8, 1, 1));
  check('stride 16, one jump, episode 2', 16, 16, 2, 'none', 'jumps', episodeJ(1, 16, 2));
  check('skills, low-level horizon 8', 32, 8, 1, 'sum', 'skills', episodeSk(8, 1, [SUBG], 0.4));
  for (const S of STRIDES) for (const k of ['none', 'sum']) { state(S, 24, 1, k, 'jumps'); ok('reach readout, stride ' + S + ', ' + k, page.num('w10-reach') === ST[S]['reach' + KEY[k]], [page.text('w10-reach'), ST[S]['reach' + KEY[k]]]); }
  state(8, 24, 1, 'none', 'jumps');
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
  lap('widget');
}

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
