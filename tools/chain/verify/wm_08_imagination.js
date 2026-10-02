#!/usr/bin/env node
/* Oracle for World Models lesson 08, "Practice in imagination".
 *
 * The experiment: lesson 1's nudge on the plain Courtyard.  A policy of ten numbers (a linear map from the state at the nudge to a nudge) is improved by CEM
 * against (a) the simulator, (b) an ensemble of five MLPs fitted to a log of 300 real trials whose nudges lie in a disc of radius 1.2 m/s (the actuator allows 3),
 * (c) the same ensemble minus lambda times its disagreement, (d) the ensemble refitted with real trials from where the policy goes, (e) both.
 *
 * Independent of the page and of l08_imagine.js:
 *   - a second integrator of the Courtyard (five exact-friction sub-steps) used for EVERY real number below (checked against CY.step);
 *   - the closed forms of the lesson (displacement gain c, the linear policy a* = (G - pos)/c - v, its hit rate and nudge sizes);
 *   - the ensemble's predictions through CY.MLP.predict (the engine's custom fast forward is only checked against it), its own CEM, its own practice loop with
 *     the Dyna step; the whole trace of the showcase log is compared with the engine's, number by number;
 *   - the expected maximum of K normals by Monte Carlo, the selection-bias formulas by Monte Carlo, the exact order-statistics expectation of the best of K by subsets;
 *   - the admissibility check of the disagreement penalty, the model-error table, the short-branch experiment (its own networks);
 *   - the page's own widget, driven into every state the prose describes (loadPage), compared with the independent numbers.
 * The engine (l08_imagine.js) is used for the twelve-log sweeps, after being shown equal to the independent pipeline on three logs.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const L8 = require(path.join(DIR, 'l08_imagine.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const med = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sdev = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
const T0 = Date.now();
const lap = name => { if (process.env.ORACLE_TIMING) console.error('  [' + ((Date.now() - T0) / 1000).toFixed(1) + ' s] ' + name); };

/* ── protocol shared with the page ── */
const SHOW = 4;                                            // the showcase log: the one whose outcomes lie nearest the medians of twelve (selected below)
const NLOG = 300, RANGE = 1.2, NL = 60, GENS = 24, POP = 96, ELITE = 16, SD0 = 0.5, ROUND_GENS = 6, FRESH = 30, EXPLORE = 0.3, SD_RESET = 0.3, REFIT_EPOCHS = 40;
const LAMS = [0, 0.25, 0.5, 1, 2, 4, 8, 16], LAM = 1, SWEEP = [0.25, 1, 4, 8, 16];      // LAMS: the page's slider; SWEEP: the values the prose quotes
const GOAL1 = { x: 6.6, y: 2.5, r: 0.5 }, GOAL2 = { x: 6.6, y: 4.0, r: 0.5 };

/* ── 1. a second integrator of the plain Courtyard ── */
const GAMMA = 0.35, DT = 0.1, SUB = 5, RB = 0.1, WALL_E = 0.9, AW = 8, AH = 5, TA = 12, TF = 80;
function stepI(s, a) {
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  if (a) { vx += a[0]; vy += a[1]; }
  const h = DT / SUB, damp = Math.exp(-GAMMA * h), glide = (1 - damp) / GAMMA;
  for (let i = 0; i < SUB; i++) {
    x += vx * glide; y += vy * glide; vx *= damp; vy *= damp;
    if (x < RB) { x = 2 * RB - x; vx = -WALL_E * vx; }
    if (x > AW - RB) { x = 2 * (AW - RB) - x; vx = -WALL_E * vx; }
    if (y < RB) { y = 2 * RB - y; vy = -WALL_E * vy; }
    if (y > AH - RB) { y = 2 * (AH - RB) - y; vy = -WALL_E * vy; }
  }
  return [x, y, vx, vy];
}
const W0 = CY.world({});
{
  const rng = CY.rng(11); let worst = 0;
  for (let n = 0; n < 300; n++) {
    let s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 8 * rng() - 4, 8 * rng() - 4], q = s.slice(), a = n % 2 === 0 ? [3 * rng() - 1.5, 3 * rng() - 1.5] : null;
    for (let t = 0; t < 92; t++) { s = stepI(s, t === 12 ? a : null); q = CY.step(W0, q, t === 12 ? a : null); }
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
  }
  ok('independent integrator == CY.step (300 random 92-step episodes with a nudge at step 12)', worst < 1e-8, worst);
}
const endI = (s, a) => { let q = stepI(s, a); for (let u = 0; u < TF; u++) q = stepI(q, null); return q; };
const missI = (e, g) => Math.hypot(e[0] - g.x, e[1] - g.y);
const bumpI = m => Math.exp(-0.5 * (m / 0.5) * (m / 0.5));
function launchesI(n, seed) { const r = CY.rng(seed), out = []; for (let i = 0; i < n; i++) { let s = CY.launch(W0, r); for (let t = 0; t < TA; t++) s = stepI(s, null); out.push(s); } return out; }
const S60 = launchesI(NL, 5);
{ const S8 = L8.launches(NL, 5); let w = 0; S60.forEach((s, i) => s.forEach((v, c) => { w = Math.max(w, Math.abs(v - S8[i][c])); })); ok('the 60 launches agree with the engine', w < 1e-8, w); }

/* ── 2. closed forms: the displacement gain, the linear policy that always works ── */
const dstep = Math.exp(-GAMMA * DT);
facts.d_step = dstep; facts.d_loss_pct = 100 * (1 - dstep);
const cGain = (1 - Math.pow(dstep, TF + 1)) / GAMMA;       // pos_end = pos + c (v + a) if no wall is touched
facts.c_gain = cGain;
{ // c by simulation in an arena with no walls in reach
  const Wb = CY.world({ W: 1000, H: 1000, curtain: null }); let q = [500, 500, 1, 0]; for (let t = 0; t < 81; t++) q = CY.step(Wb, q, null);
  facts.c_sim = q[0] - 500; ok('displacement gain c = (1 - d^81)/gamma matches a simulation', close(cGain, facts.c_sim, 1e-9), [cGain, facts.c_sim]);
}
{
  const ls = launchesI(3000, 99), norms = []; let hit = 0;
  for (const s of ls) {
    let ax = (GOAL1.x - s[0]) / cGain - s[2], ay = (GOAL1.y - s[1]) / cGain - s[3]; const n = Math.hypot(ax, ay); norms.push(n);
    if (n > 3) { ax *= 3 / n; ay *= 3 / n; }
    if (missI(endI(s, [ax, ay]), GOAL1) < GOAL1.r) hit++;
  }
  norms.sort((a, b) => a - b);
  facts.astar_hit = 100 * hit / ls.length; facts.astar_med = norms[1500]; facts.astar_p99 = norms[Math.floor(0.99 * 3000)]; facts.astar_in12 = 100 * norms.filter(x => x <= 1.2).length / 3000;
  facts.astar_max = norms[2999];
  ok('the linear policy a* = (G - pos)/c - v hits (almost) every launch', facts.astar_hit > 99.5, facts.astar_hit);
}
{ let h = 0, J = 0; for (const s of S60) { const m = missI(endI(s, [0, 0]), GOAL1); if (m < GOAL1.r) h++; J += bumpI(m); } facts.nonudge_hits = 100 * h / NL; facts.nonudge_J = J / NL; }
facts.log_frac_actuator_pct = 100 * RANGE / 3; facts.log_area_pct = 100 * (RANGE / 3) * (RANGE / 3);
lap('closed forms');

/* ── 3. the log, the ensemble and practice, replayed independently ── */
function makeLogI(n, range, seed) {
  const r = CY.rng(seed), S = [], A = [], E = [];
  for (let i = 0; i < n; i++) { let s = CY.launch(W0, r); for (let t = 0; t < TA; t++) s = stepI(s, null); const an = 2 * Math.PI * r(), am = range * Math.sqrt(r()), a = [am * Math.cos(an), am * Math.sin(an)]; S.push(s); A.push(a); E.push(endI(s, a)); }
  return { S, A, E, range };
}
class EnsI {
  constructor(log, seed) { this.log = { S: log.S.slice(), A: log.A.slice(), E: log.E.slice(), range: log.range }; this.seed = seed; this.nets = []; for (let m = 0; m < 5; m++) this.nets.push(new CY.MLP([6, 8, 8, 2], 11 + m)); this.fit(0, 120); }
  fit(round, epochs) {
    const N = this.log.S.length, X = this.log.S.map((s, i) => [(s[0] - 3.5) / 2, (s[1] - 2.5) / 1.5, s[2] - 1.5, s[3], this.log.A[i][0], this.log.A[i][1]]), Y = this.log.E.map(e => [(e[0] - 4) / 2, (e[1] - 2.5) / 1.5]);
    for (let m = 0; m < 5; m++) { const rb = CY.rng(this.seed + m + 97 * round), idx = []; for (let i = 0; i < N; i++) idx.push(Math.floor(rb() * N)); this.nets[m].fit(idx.map(k => X[k]), idx.map(k => Y[k]), { epochs, lr: 0.02, batch: 32, seed: 3 + m + round }); }
  }
  add(S, A, E) { S.forEach((s, i) => { this.log.S.push(s); this.log.A.push(A[i]); this.log.E.push(E[i]); }); }
  predict(s, a) {                                              // through CY.MLP.predict: mean ending (m) and the largest deviation of a member from it (m)
    const f = [(s[0] - 3.5) / 2, (s[1] - 2.5) / 1.5, s[2] - 1.5, s[3], a[0], a[1]], mem = this.nets.map(n => { const o = n.predict(f); return [o[0] * 2 + 4, o[1] * 1.5 + 2.5]; });
    const mx = mean(mem.map(p => p[0])), my = mean(mem.map(p => p[1]));
    return { x: mx, y: my, u: Math.max(...mem.map(p => Math.hypot(p[0] - mx, p[1] - my))), mem };
  }
  clone() { const c = new EnsI({ S: [], A: [], E: [], range: this.log.range }, this.seed); c.log = { S: this.log.S.slice(), A: this.log.A.slice(), E: this.log.E.slice(), range: this.log.range };
    c.nets = this.nets.map((o, m) => { const n = new CY.MLP([6, 8, 8, 2], 11 + m); for (let l = 0; l < o.L; l++) { n.W[l].set(o.W[l]); n.b[l].set(o.b[l]); n.mW[l].set(o.mW[l]); n.vW[l].set(o.vW[l]); n.mb[l].set(o.mb[l]); n.vb[l].set(o.vb[l]); } n.t = o.t; return n; }); return c; }
}
const FBAR = [3.5, 2.5, 1.5, 0];
function nudgeI(th, s) { const f = s.map((v, i) => v - FBAR[i]); let ax = th[4], ay = th[9]; for (let j = 0; j < 4; j++) { ax += th[j] * f[j]; ay += th[5 + j] * f[j]; } const n = Math.hypot(ax, ay); return n > 3 ? [ax * 3 / n, ay * 3 / n] : [ax, ay]; }
function imaginedI(ens, th, S, lam, goal) {
  goal = goal || GOAL1; let J = 0, h = 0, U = 0, out = 0;
  for (const s of S) { const a = nudgeI(th, s), p = ens.predict(s, a), m = missI([p.x, p.y], goal); J += bumpI(m); U += p.u; if (m < goal.r) h++; if (Math.hypot(a[0], a[1]) > ens.log.range) out++; }
  return { J: J / S.length, hits: h / S.length, U: U / S.length, outside: out / S.length, score: J / S.length - lam * U / S.length };
}
function realI(th, S, goal) {
  goal = goal || GOAL1; let J = 0, h = 0;
  for (const s of S) { const m = missI(endI(s, nudgeI(th, s)), goal); J += bumpI(m); if (m < goal.r) h++; }
  return { J: J / S.length, hits: h / S.length };
}
function practiceI(variant, lam, base) {                      // CEM over ten numbers; the incumbent is the best candidate found; Dyna rounds for 'dyna' and 'both'
  const useLam = (variant === 'pess' || variant === 'both') ? lam : 0, rounds = variant === 'dyna' || variant === 'both';
  const ens = variant === 'exact' ? null : base.clone(), rng = CY.rng(1);
  let mu = new Array(10).fill(0), sd = new Array(10).fill(SD0), round = 0, trials = NLOG;
  const score = th => ens ? imaginedI(ens, th, S60, useLam).score : realI(th, S60).J;
  let best = { v: mu.slice(), f: score(mu) };
  const rec = [];
  const row = g => { const re = realI(best.v, S60), im = ens ? imaginedI(ens, best.v, S60, useLam) : { J: re.J, hits: re.hits, U: 0, outside: 0 }; rec.push({ g, th: best.v.slice(), imJ: im.J, imHits: im.hits, U: im.U, outside: im.outside, reJ: re.J, reHits: re.hits, trials }); };
  row(0);
  for (let g = 1; g <= GENS; g++) {
    const cand = [];
    for (let i = 0; i < POP; i++) { const v = []; for (let j = 0; j < 10; j++) v.push(mu[j] + sd[j] * CY.randn(rng)); cand.push({ v, f: score(v) }); }
    cand.sort((p, q) => q.f - p.f);
    for (let j = 0; j < 10; j++) { let m = 0, s2 = 0; for (let i = 0; i < ELITE; i++) m += cand[i].v[j] / ELITE; for (let i = 0; i < ELITE; i++) s2 += (cand[i].v[j] - m) ** 2 / ELITE; mu[j] = m; sd[j] = Math.max(Math.sqrt(s2), 0.01); }
    if (cand[0].f > best.f) best = { v: cand[0].v.slice(), f: cand[0].f };
    if (rounds && g % ROUND_GENS === 0 && g < GENS) {
      const F = launchesI(FRESH, 7000 + 31 * round), rx = CY.rng(8000 + 31 * round), A = [], E = [];
      for (const s of F) { const a0 = nudgeI(best.v, s), a = [a0[0] + EXPLORE * CY.randn(rx), a0[1] + EXPLORE * CY.randn(rx)]; A.push(a); E.push(endI(s, a)); }
      ens.add(F, A, E); round++; ens.fit(round, REFIT_EPOCHS); trials += FRESH;
      sd = sd.map(x => Math.max(x, SD_RESET)); best.f = score(best.v);
    }
    row(g);
  }
  return { rec, ens };
}
function engineBase(sd, range) { return new L8.Model(L8.makeLog(NLOG, range === undefined ? RANGE : range, 100 + sd), { seed: 500 + 13 * sd }); }
const ENG_CFG = (base, variant, lam) => ({ variant, lam, gens: GENS, pop: POP, elite: ELITE, sd0: SD0, seed: 1, S: L8.launches(NL, 5), base, nlog: NLOG, roundGens: ROUND_GENS, fresh: FRESH, explore: EXPLORE, sdReset: SD_RESET, refitEpochs: REFIT_EPOCHS });

/* the independent pipeline on three logs, against the engine */
const IND = {};                                                // showcase results of the independent pipeline
for (const sd of [SHOW, 7, 9]) {
  const logI = makeLogI(NLOG, RANGE, 100 + sd), baseI = new EnsI(logI, 500 + 13 * sd), baseE = engineBase(sd);
  let w = 0; logI.E.forEach((e, i) => e.forEach((v, c) => { w = Math.max(w, Math.abs(v - baseE.log.E[i][c])); }));
  ok('log ' + sd + ': the 300 real endings agree with the engine', w < 1e-8, w);
  { const o = {}; let md = 0; S60.forEach((s, i) => { const a = nudgeI([0.1, 0, -0.5, 0, 0.2, 0, 0.1, 0, -0.5, 0.1], s), p = baseI.predict(s, a), q = baseE.predict(s, a, o); md = Math.max(md, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.u - q.u)); }); ok('log ' + sd + ': the engine\'s fast ensemble forward == CY.MLP.predict', md < 1e-9, md); }
  const variants = sd === SHOW ? [['exact', 0], ['naive', 0], ['pess', LAM], ['dyna', 0], ['both', LAM]] : [['naive', 0], ['both', LAM]];
  for (const [v, lam] of variants) {
    const ri = practiceI(v, lam, baseI), re = L8.practice(ENG_CFG(baseE, v, lam)).rec;
    let worst = 0; ri.rec.forEach((x, g) => { const y = re[g]; for (const k of ['imJ', 'imHits', 'U', 'outside', 'reJ', 'reHits']) worst = Math.max(worst, Math.abs(x[k] - y[k])); ok('trial counts agree', x.trials === y.trials); });
    ok('log ' + sd + ' ' + v + ': the whole 24-generation trace agrees with the engine (independent pipeline)', worst < 1e-6, worst);
    if (sd === SHOW) IND[v] = ri;
  }
  lap('independent pipeline, log ' + sd);
}
const baseS = engineBase(SHOW), CFGS = ENG_CFG(baseS, 'naive', 0);

/* ── 4. the showcase log: what the lesson's widget shows ── */
const recS = v => IND[v].rec;
facts.exact_J = recS('exact')[GENS].reJ; facts.exact_hits = 100 * recS('exact')[GENS].reHits;
{ const r = recS('exact'); const g100 = r.findIndex(x => x.reHits >= 0.9999); facts.exact_g100 = g100; facts.exact_K100 = g100 * POP; facts.bill_exact = g100 * POP * NL; ok('the control reaches 100 % hits', g100 > 0 && g100 <= 12, g100); }
facts.bill_exact_full = GENS * POP * NL;
for (const [key, v] of [['n', 'naive'], ['p', 'pess'], ['d', 'dyna'], ['b', 'both']]) {
  const x = recS(v)[GENS];
  facts[key + '_im'] = x.imJ; facts[key + '_re'] = x.reJ; facts[key + '_imh'] = 100 * x.imHits; facts[key + '_reh'] = 100 * x.reHits; facts[key + '_out'] = 100 * x.outside; facts[key + '_U'] = x.U; facts[key + '_gap'] = x.imJ - x.reJ; facts[key + '_trials'] = x.trials;
}
{ // the naive policy gets WORSE than doing nothing while its imagined return climbs
  const r = recS('naive'); facts.n_re_min = Math.min(...r.map(x => x.reJ)); facts.n_im_g0 = r[0].imJ; facts.n_re_g0 = r[0].reJ;
  let mono = true; for (let g = 1; g <= GENS; g++) if (r[g].imJ < r[g - 1].imJ - 1e-12) mono = false;      // the incumbent is what the optimiser maximises: it cannot fall
  facts.n_re_peak = Math.max(...r.map(x => x.reJ)); facts.n_re_peak_g = r.findIndex(x => x.reJ === facts.n_re_peak);
  { const sz = th => S60.map(s => { const a = nudgeI(th, s); return Math.hypot(a[0], a[1]); }).sort((x, y) => x - y), nn = sz(r[GENS].th), ee = sz(recS('exact')[GENS].th);
    facts.n_amin = nn[0]; facts.n_amed = (nn[29] + nn[30]) / 2; facts.ex_amed = (ee[29] + ee[30]) / 2; facts.ex_amax = ee[NL - 1]; facts.ex_out = 100 * ee.filter(x => x > RANGE).length / NL; }
  ok('naive: the imagined return ends far above the real one', facts.n_gap > 0.6, facts.n_gap);
  ok('naive: practice leaves the real return below doing nothing', facts.n_re < facts.nonudge_J - 0.05, [facts.n_re, facts.nonudge_J]);
  ok('naive: the imagined return of the best policy so far never falls', mono);
  ok('naive: the real return peaks at generation 0 (no stopping time beats not starting)', facts.n_re_peak_g === 0 && facts.n_re_peak === facts.n_re_g0, [facts.n_re_peak_g, facts.n_re_peak, facts.n_re_g0]);
  ok('naive: the nudges are outside the log', facts.n_out > 90, facts.n_out);
  ok('pessimistic: imagined ~ real', Math.abs(facts.p_gap) < 0.03, facts.p_gap);
}
{ // the pessimistic run: penalised score is a lower bound of the real return at the optimum
  const x = imaginedI(IND.pess.ens, recS('pess')[GENS].th, S60, LAM); facts.p_score = x.score; facts.p_score_slack = recS('pess')[GENS].reJ - x.score;
  ok('pessimistic optimum: the penalised score is below the real return', x.score <= recS('pess')[GENS].reJ);
}
{ // the Dyna loop: real return of the incumbent after each round
  const r = recS('dyna'); for (const g of [6, 12, 18, 24]) { facts['d_re_g' + g] = r[g].reJ; facts['d_im_g' + g] = r[g].imJ; }
  facts.d_re_g5 = r[5].reJ; facts.d_im_g5 = r[5].imJ;
  facts.dyna_ratio = ROUND_GENS * POP * NL / FRESH; facts.dyna_new_trials = 3 * FRESH;
  facts.imag_total = GENS * POP * NL; facts.trials_all = r[GENS].trials;
  facts.dyna_per_round_imag = ROUND_GENS * POP * NL; facts.imag_over_real = facts.imag_total / facts.trials_all;
}
lap('showcase facts');

/* ── 5. where the model is wrong (the table) ── */
{
  const NB = L8.NBINS, o = {}, rng = CY.rng(4242), rms = [], uu = [];
  NB.forEach((b, k) => {
    const S = launchesI(300, 4242 + 1 + k); let se = 0, us = 0;
    for (let i = 0; i < 300; i++) { const am = b[0] + (b[1] - b[0]) * rng(), an = 2 * Math.PI * rng(), a = [am * Math.cos(an), am * Math.sin(an)], e = endI(S[i], a), p = IND.naive.ens.predict(S[i], a); se += (p.x - e[0]) ** 2 + (p.y - e[1]) ** 2; us += p.u; }
    rms.push(Math.sqrt(se / 300)); uu.push(us / 300);
  });
  // the same ensemble the engine builds for the showcase log (before any refit): use the engine's untouched base
  const eb = L8.errorByNudge(baseS, 300, 4242);
  const indBase = new EnsI(makeLogI(NLOG, RANGE, 100 + SHOW), 500 + 13 * SHOW), rms2 = [], uu2 = [], r2 = CY.rng(4242);
  NB.forEach((b, k) => { const S = launchesI(300, 4242 + 1 + k); let se = 0, us = 0; for (let i = 0; i < 300; i++) { const am = b[0] + (b[1] - b[0]) * r2(), an = 2 * Math.PI * r2(), a = [am * Math.cos(an), am * Math.sin(an)], e = endI(S[i], a), p = indBase.predict(S[i], a); se += (p.x - e[0]) ** 2 + (p.y - e[1]) ** 2; us += p.u; } rms2.push(Math.sqrt(se / 300)); uu2.push(us / 300); });
  rms2.forEach((v, k) => { ok('error table bin ' + k + ' agrees with the engine', close(v, eb.rms[k], 1e-6) && close(uu2[k], eb.u[k], 1e-6), [v, eb.rms[k]]); facts['err_b' + (k + 1)] = v; facts['u_b' + (k + 1)] = uu2[k]; });
  facts.err_in = Math.sqrt((rms2[0] ** 2 + rms2[1] ** 2) / 2); facts.err_ratio = rms2[4] / rms2[0]; facts.u_ratio = uu2[4] / uu2[0]; facts.err_over_u_hole = rms2[4] / uu2[4];
  ok('the error grows sharply outside the log (bins beyond 1.2 m/s)', rms2[2] > 2.5 * rms2[1] && rms2[4] > 8 * rms2[0], rms2);
  ok('the disagreement grows outside the log too, but less than the error', uu2[4] > 3 * uu2[0] && uu2[4] < rms2[4], uu2);
}
lap('error table');

/* ── 6. the curse: selection bias (theory + Monte Carlo), the pool, blind versus adaptive ── */
for (const K of [10, 100, 1000]) {
  const r = CY.rng(300 + K); let s = 0; const T = K === 1000 ? 6000 : 20000;
  for (let t = 0; t < T; t++) { let m = -1e9; for (let k = 0; k < K; k++) { const z = CY.randn(r); if (z > m) m = z; } s += m / T; }
  const q = L8.emax(K); facts['emax' + K] = s; facts['s2l' + K] = Math.sqrt(2 * Math.log(K)); facts['over' + K] = 100 * (Math.sqrt(2 * Math.log(K)) / s - 1);
  ok('E[max of ' + K + ' normals]: quadrature == Monte Carlo', close(q, s, K === 1000 ? 0.02 : 0.01), [q, s]);
}
{ // the textbook bound E[max of K normals] <= sqrt(2 ln K) (Chernoff: E[max] <= ln K / t + t / 2, best at t = sqrt(2 ln K)), checked for K = 2..2000
  let all = true, n = 0;
  for (let K = 2; K <= 2000; K = K < 100 ? K + 1 : Math.ceil(K * 1.05)) { n++; if (!(L8.emax(K) <= Math.sqrt(2 * Math.log(K)))) all = false; }
  ok('E[max of K normals] <= sqrt(2 ln K) at every K tested (' + n + ' values, K = 2..2000)', all, n);
}
{ // the winner of K noisy estimates: optimism and the real share, Monte Carlo
  const K = 100, dl = 1, sj = 1, r = CY.rng(77); let opt = 0, gain = 0, optEq = 0; const T = 40000;
  for (let t = 0; t < T; t++) {
    let bi = -1, bv = -1e9, bj = 0, be = 0, bv2 = -1e9, be2 = 0;
    for (let k = 0; k < K; k++) { const J = sj * CY.randn(r), e = dl * CY.randn(r); if (J + e > bv) { bv = J + e; bj = J; be = e; } if (0 + e > bv2) { bv2 = e; be2 = e; } }
    opt += be / T; gain += bj / T; optEq += be2 / T;
  }
  const em = L8.emax(K), s = Math.sqrt(dl * dl + sj * sj);
  facts.sel_opt = opt; facts.sel_opt_formula = dl * dl / s * em; facts.sel_gain = gain; facts.sel_gain_formula = sj * sj / s * em; facts.sel_equal = optEq; facts.sel_equal_formula = dl * em; facts.sel_share = 100 * sj * sj / (sj * sj + dl * dl);
  ok('optimism of the winner = delta^2/sqrt(sigma^2+delta^2) E[max]', close(opt, facts.sel_opt_formula, 0.03), [opt, facts.sel_opt_formula]);
  ok('real gain of the winner = sigma^2/sqrt(sigma^2+delta^2) E[max]', close(gain, facts.sel_gain_formula, 0.03), [gain, facts.sel_gain_formula]);
  ok('equal candidates: optimism = delta E[max]', close(optEq, facts.sel_equal_formula, 0.03), [optEq, facts.sel_equal_formula]);
  // checkpoint: K = 100, delta = 0.1, sigma_J = 0.1, true mean 0.5
  const d2 = 0.1, s2 = 0.1, sq = Math.sqrt(d2 * d2 + s2 * s2); facts.ck_opt_equal = d2 * em; facts.ck_apparent = sq * em; facts.ck_opt = d2 * d2 / sq * em; facts.ck_real = s2 * s2 / sq * em; facts.ck_est = 0.5 + facts.ck_apparent; facts.ck_est_equal = 0.5 + facts.ck_opt_equal;
}
const POOLN = 768;
let POOL;
{ // the pool, built with the independent pipeline (CY.MLP.predict, stepI) and compared with the engine's
  const indBase = new EnsI(makeLogI(NLOG, RANGE, 100 + SHOW), 500 + 13 * SHOW), r = CY.rng(2024), pool = [];
  for (let i = 0; i < POOLN; i++) { const th = []; for (let j = 0; j < 10; j++) th.push(0.5 * CY.randn(r)); pool.push({ jh: imaginedI(indBase, th, S60, 0).J, jr: realI(th, S60).J }); }
  const eng = L8.pool(baseS, L8.launches(NL, 5), POOLN, 0.5, 2024); let w = 0; pool.forEach((p, i) => { w = Math.max(w, Math.abs(p.jh - eng[i].jh), Math.abs(p.jr - eng[i].jr)); });
  ok('the pool of random policies agrees with the engine', w < 1e-6, w); POOL = pool;
  const e = pool.map(p => p.jh - p.jr), J = pool.map(p => p.jr);
  facts.pool_delta = sdev(e); facts.pool_sj = sdev(J); facts.pool_share = 100 * facts.pool_sj ** 2 / (facts.pool_sj ** 2 + facts.pool_delta ** 2); facts.pool_mean_err = mean(e);
  // exact expectation of the winner of a random K-subset, versus brute-force subsets
  const eb = (K) => { // brute force: average over many random subsets drawn without replacement
    const r2 = CY.rng(5 + K); let g = 0; const T = 40000;
    for (let t = 0; t < T; t++) { const seen = new Set(); let bi = -1, bv = -1e9; while (seen.size < K) { const i = Math.floor(r2() * POOLN); if (seen.has(i)) continue; seen.add(i); if (pool[i].jh > bv) { bv = pool[i].jh; bi = i; } } g += (pool[bi].jh - pool[bi].jr) / T; }
    return g;
  };
  for (const K of [4, 32]) { const ex = L8.expectedBest(pool, K).gap, bf = eb(K); ok('best-of-' + K + ': exact expectation == brute-force subsets', close(ex, bf, 0.004), [ex, bf]); }
  for (const K of [96, 192, 384]) {
    const g = L8.expectedBest(pool, K).gap, em = L8.emax(K), s = Math.sqrt(facts.pool_delta ** 2 + facts.pool_sj ** 2);
    facts['blind_gap' + K] = g; facts['law_full' + K] = facts.pool_delta * em; facts['law_shrunk' + K] = facts.pool_delta ** 2 / s * em;
  }
  const rn = recS('naive'); for (const g of [1, 2, 4, 6, 12, 24]) facts['cem_gap_g' + g] = rn[g].imJ - rn[g].reJ;
  facts.cem_over_blind384 = facts.cem_gap_g4 / facts.blind_gap384;
  ok('blind best-of-K obeys the selection-bias law (strictly between the shrunk and the full line, K = 96 to 384)', [96, 192, 384].every(K => facts['blind_gap' + K] > facts['law_shrunk' + K] && facts['blind_gap' + K] < facts['law_full' + K]), [96, 192, 384].map(K => [facts['blind_gap' + K], facts['law_shrunk' + K], facts['law_full' + K]]));
  ok('adaptive search at the same K does ten times more damage', facts.cem_gap_g4 > 10 * facts.blind_gap384, [facts.cem_gap_g4, facts.blind_gap384]);
}
lap('curse');

/* ── 7. pessimism: admissibility of the disagreement penalty, the guarantee ── */
{
  const indBase = new EnsI(makeLogI(NLOG, RANGE, 100 + SHOW), 500 + 13 * SHOW), r = CY.rng(31), items = [];
  for (const sg of [0.25, 0.5, 1.0]) for (let i = 0; i < 400; i++) { const th = []; for (let j = 0; j < 10; j++) th.push(sg * CY.randn(r)); const im = imaginedI(indBase, th, S60, 0), re = realI(th, S60); items.push({ e: im.J - re.J, U: im.U, J: re.J }); }
  recS('naive').forEach(x => items.push({ e: x.imJ - x.reJ, U: x.U, J: x.reJ }));
  facts.adm_n = items.length; facts.adm_lam = Math.max(...items.map(x => Math.abs(x.e) / Math.max(x.U, 1e-9)));      // two-sided: lambda U >= |imagined - real|
  for (const lam of [0.25, 0.5, 1]) facts['adm_viol' + String(lam).replace('.', '')] = 100 * items.filter(x => Math.abs(x.e) > lam * x.U).length / items.length;
  ok('lambda = 1 is admissible on all sampled policies (lambda U >= |imagined - real|)', facts.adm_lam < 1, facts.adm_lam);
  // the guarantee: the pessimistic optimum is at least as good as any policy discounted by 2 lambda U
  const ex = recS('exact')[GENS], imEx = imaginedI(indBase, ex.th, S60, LAM);
  facts.g_exact_J = ex.reJ; facts.g_exact_U = imEx.U; facts.g_bound = ex.reJ - 2 * LAM * imEx.U;
  ok('the pessimistic optimum beats the guarantee (best policy minus twice its uncertainty)', recS('pess')[GENS].reJ >= facts.g_bound, [recS('pess')[GENS].reJ, facts.g_bound]);
}
lap('admissibility');

/* ── 8. the twelve logs, by the engine ── */
const NLOGS = 12, S8 = L8.launches(NL, 5), TW = [];
for (let sd = 0; sd < NLOGS; sd++) {
  const base = engineBase(sd), r = { sd }, g = (v, lam) => L8.practice(ENG_CFG(base, v, lam)).rec[GENS];
  r.n = g('naive', 0); r.d = g('dyna', 0); r.b = g('both', LAM);
  for (const lam of SWEEP) r['p' + lam] = g('pess', lam);
  TW.push(r);
}
{
  const keys = ['n', 'p0.25', 'p1', 'p4', 'p8', 'p16', 'd', 'b'];
  const M = {}; keys.forEach(k => { M[k] = med(TW.map(r => r[k].reJ)); M[k + 'i'] = med(TW.map(r => r[k].imJ)); });
  const dev = r => Math.max(...keys.map(k => Math.abs(r[k].reJ - M[k])), ...keys.map(k => Math.abs(r[k].imJ - M[k + 'i'])));
  const best = TW.reduce((a, r) => dev(r) < dev(a) ? r : a);
  ok('the showcase log is the one nearest the medians', best.sd === SHOW, [best.sd, TW.map(r => dev(r).toFixed(2)).join(' ')]);
  facts.showcase_dev = dev(TW[SHOW]);
  for (const k of keys) { const kk = k.replace('.', ''); facts['m12_' + kk + '_im'] = M[k + 'i']; facts['m12_' + kk + '_re'] = M[k]; facts['m12_' + kk + '_min'] = Math.min(...TW.map(r => r[k].reJ)); facts['m12_' + kk + '_max'] = Math.max(...TW.map(r => r[k].reJ)); facts['m12_' + kk + '_reh'] = 100 * med(TW.map(r => r[k].reHits)); facts['m12_' + kk + '_imh'] = 100 * med(TW.map(r => r[k].imHits)); facts['m12_' + kk + '_out'] = 100 * med(TW.map(r => r[k].outside)); facts['m12_' + kk + '_U'] = med(TW.map(r => r[k].U)); facts['m12_' + kk + '_gap'] = med(TW.map(r => r[k].imJ - r[k].reJ)); }
  facts.m12_n_below40 = TW.filter(r => r.n.reJ < 0.4).length; facts.m12_n_below20 = TW.filter(r => r.n.reJ < 0.2).length; facts.m12_n_best = Math.max(...TW.map(r => r.n.reJ));
  facts.m12_d_below50 = TW.filter(r => r.d.reJ < 0.5).length; facts.m12_p1_below90 = TW.filter(r => r.p1.reJ < 0.9).length; facts.m12_b_above90 = TW.filter(r => r.b.reJ >= 0.9).length;
  facts.m12_p1_trials = TW[0].p1.trials; facts.m12_b_trials = TW[0].b.trials; facts.m12_d_trials = TW[0].d.trials;
  ok('naive: the real return is far below the imagined one in every log', TW.every(r => r.n.imJ - r.n.reJ > 0.0) && facts.m12_n_gap > 0.6, facts.m12_n_gap);
  ok('pessimism: the median real return of the pessimistic optimum is high', facts.m12_p1_re > 0.95, facts.m12_p1_re);
  ok('both: robust (every log >= 0.9)', facts.m12_b_above90 === NLOGS, facts.m12_b_above90);
  ok('too much pessimism is timid', facts.m12_p16_re < facts.m12_p1_re - 0.2, [facts.m12_p16_re, facts.m12_p1_re]);
}
lap('twelve logs');

/* the operator's range: the same procedure on logs with other ranges (naive optimiser; imagined versus real); range 1.2 is the twelve logs above */
for (const rg of [0.8, 1.2, 3.0]) {
  const rr = rg === RANGE ? TW.map(r => r.n) : [];
  if (rg !== RANGE) for (let sd = 0; sd < NLOGS; sd++) { const base = engineBase(sd, rg); rr.push(L8.practice(ENG_CFG(base, 'naive', 0)).rec[GENS]); }
  const k = rg.toFixed(1).replace('.', '');
  facts['rg' + k + '_im'] = med(rr.map(x => x.imJ)); facts['rg' + k + '_re'] = med(rr.map(x => x.reJ)); facts['rg' + k + '_min'] = Math.min(...rr.map(x => x.reJ)); facts['rg' + k + '_reh'] = 100 * med(rr.map(x => x.reHits));
}
ok('same imagined return, different truth: range 1.2 fails where 0.8 and 3.0 do not', facts.rg12_re < 0.3 && facts.rg08_re > 0.8 && facts.rg30_re > 0.8 && Math.abs(facts.rg12_im - facts.rg30_im) < 0.15, [facts.rg08_re, facts.rg12_re, facts.rg30_re]);
lap('ranges');

/* ── 9. the short-branch experiment, with its own networks ── */
{
  const NB = L8.NBINS, probes = [], rng = CY.rng(4242);
  NB.forEach((b, k) => { const S = launchesI(300, 4242 + 1 + k); for (let i = 0; i < 300; i++) { const am = b[0] + (b[1] - b[0]) * rng(), an = 2 * Math.PI * rng(), a = [am * Math.cos(an), am * Math.sin(an)]; probes.push({ bin: k, s: S[i], a, e: endI(S[i], a) }); } });
  const acc = { D: NB.map(() => []), B: NB.map(() => []), X: NB.map(() => []) }, NS = 6;
  for (let sd = 0; sd < NS; sd++) {
    const log = makeLogI(NLOG, RANGE, 100 + sd), D = new EnsI(log, 500 + 13 * sd), N = log.S.length;
    const Q = log.S.map((s, i) => stepI(s, log.A[i]));                                  // the state right after the nudge step
    const fX = log.S.map((s, i) => [(s[0] - 3.5) / 2, (s[1] - 2.5) / 1.5, s[2] - 1.5, s[3], log.A[i][0], log.A[i][1]]), fY = Q.map(q => [(q[0] - 3.5) / 2, (q[1] - 2.5) / 1.5, q[2] - 1, q[3]]);
    const vX = Q.map(q => [(q[0] - 3.5) / 2, (q[1] - 2.5) / 1.5, q[2] - 1, q[3]]), vY = log.E.map(e => [(e[0] - 4) / 2, (e[1] - 2.5) / 1.5]);
    const F = [], V = [];
    for (let m = 0; m < 5; m++) {
      const rb = CY.rng(900 + 7 * sd + m), idx = []; for (let i = 0; i < N; i++) idx.push(Math.floor(rb() * N));
      const nf = new CY.MLP([6, 8, 8, 4], 21 + m); nf.fit(idx.map(j => fX[j]), idx.map(j => fY[j]), { epochs: 120, lr: 0.02, batch: 32, seed: 3 + m }); F.push(nf);
      const nv = new CY.MLP([4, 8, 8, 2], 31 + m); nv.fit(idx.map(j => vX[j]), idx.map(j => vY[j]), { epochs: 120, lr: 0.02, batch: 32, seed: 3 + m }); V.push(nv);
    }
    const avg = arrs => { const n = arrs[0].length, m = new Array(n).fill(0); arrs.forEach(a => a.forEach((v, i) => { m[i] += v / arrs.length; })); return m; };
    for (const p of probes) {
      const d = D.predict(p.s, p.a); acc.D[p.bin].push((d.x - p.e[0]) ** 2 + (d.y - p.e[1]) ** 2);
      const f = [(p.s[0] - 3.5) / 2, (p.s[1] - 2.5) / 1.5, p.s[2] - 1.5, p.s[3], p.a[0], p.a[1]], qm = avg(F.map(n => Array.from(n.predict(f)))), vq = avg(V.map(n => Array.from(n.predict(qm))));
      acc.B[p.bin].push((vq[0] * 2 + 4 - p.e[0]) ** 2 + (vq[1] * 1.5 + 2.5 - p.e[1]) ** 2);
      const q = stepI(p.s, p.a), vx = avg(V.map(n => Array.from(n.predict([(q[0] - 3.5) / 2, (q[1] - 2.5) / 1.5, q[2] - 1, q[3]])))); acc.X[p.bin].push((vx[0] * 2 + 4 - p.e[0]) ** 2 + (vx[1] * 1.5 + 2.5 - p.e[1]) ** 2);
    }
  }
  NB.forEach((b, k) => { facts['br_d' + (k + 1)] = Math.sqrt(mean(acc.D[k])); facts['br_b' + (k + 1)] = Math.sqrt(mean(acc.B[k])); facts['br_x' + (k + 1)] = Math.sqrt(mean(acc.X[k])); });
  facts.br_x_gain5 = 100 * (1 - facts.br_x5 / facts.br_d5);
  ok('a learned one-step model + value is not better than the direct model in the hole', facts.br_b5 > 0.97 * facts.br_d5 && facts.br_b4 > 0.97 * facts.br_d4, [facts.br_b4, facts.br_d4, facts.br_b5, facts.br_d5]);
  ok('even an exact first step leaves most of the hole', facts.br_x5 > 0.8 * facts.br_d5, [facts.br_x5, facts.br_d5]);
}
lap('short branch');

/* ── 10. the exit: change the goal ── */
{
  const exTh = recS('exact')[GENS].th, boTh = recS('both')[GENS].th;
  facts.x_ex_g1 = 100 * realI(exTh, S60, GOAL1).hits; facts.x_ex_g2 = 100 * realI(exTh, S60, GOAL2).hits; facts.x_bo_g1 = 100 * realI(boTh, S60, GOAL1).hits; facts.x_bo_g2 = 100 * realI(boTh, S60, GOAL2).hits;
  facts.x_bo_g2J = realI(boTh, S60, GOAL2).J;
  facts.x_shift = (GOAL2.y - GOAL1.y) / cGain;                                           // the nudge the new goal needs, in addition (m/s), for a launch that was already on target
  const sA = L8.search(baseS, S8, GOAL2, 128, 1, 77), sB = L8.search(baseS, S8, GOAL2, 128, 0, 77);
  // independent search: for every launch K random nudges, the model's favourite (penalised), judged by the independent integrator
  const indBase = new EnsI(makeLogI(NLOG, RANGE, 100 + SHOW), 500 + 13 * SHOW);
  function searchI(goal, K, lam, seed) { const r = CY.rng(seed); let imH = 0, reH = 0; for (const s of S60) { let best = -1e9, bi = null; for (let k = 0; k < K; k++) { const an = 2 * Math.PI * r(), am = 3 * Math.sqrt(r()), a = [am * Math.cos(an), am * Math.sin(an)], p = indBase.predict(s, a), sc = bumpI(missI([p.x, p.y], goal)) - lam * p.u; if (sc > best) { best = sc; bi = a; } } const p = indBase.predict(s, bi); if (missI([p.x, p.y], goal) < goal.r) imH++; if (missI(endI(s, bi), goal) < goal.r) reH++; } return { imH: imH / NL, reH: reH / NL }; }
  const iA = searchI(GOAL2, 128, 1, 77), iB = searchI(GOAL2, 128, 0, 77);
  ok('decision-time search (lambda = 1): engine == independent', close(sA.reHits, iA.reH, 1e-9) && close(sA.imHits, iA.imH, 1e-9), [sA, iA]);
  ok('decision-time search (lambda = 0): engine == independent', close(sB.reHits, iB.reH, 1e-9) && close(sB.imHits, iB.imH, 1e-9), [sB, iB]);
  facts.x_s_re = 100 * iA.reH; facts.x_s_im = 100 * iA.imH; facts.x_s0_re = 100 * iB.reH; facts.x_s0_im = 100 * iB.imH;
  const sm = []; for (let sd = 0; sd < NLOGS; sd++) sm.push(L8.search(engineBase(sd), S8, GOAL2, 128, 1, 77).reHits); facts.x_s_re_m12 = 100 * med(sm); facts.x_s_re_min12 = 100 * Math.min(...sm);
  ok('the policy trained for the old goal fails on the new one, the model searched afresh does not', facts.x_ex_g2 < 5 && facts.x_bo_g2 < 5 && facts.x_s_re > 60, [facts.x_ex_g2, facts.x_bo_g2, facts.x_s_re]);
}
lap('exit');

/* ── 11. drive the page's own widget ── */
const PAGE = path.join(DIR, '08_imagination_dreamer.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; }, click() {} };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (HAVE_PAGE) {
  const num = id => page.num(id), setAll = (o) => { for (const k of Object.keys(o)) page.set(k, o[k]); };
  const LAMIDX = v => LAMS.indexOf(v);
  const cmp = (label, variant, lam, g, recs) => {
    const x = recs[g], tol = 0.0051;
    ok(label + ': imagined return', close(num('w08-imj'), x.imJ, tol), [num('w08-imj'), x.imJ]);
    ok(label + ': real return', close(num('w08-rej'), x.reJ, tol), [num('w08-rej'), x.reJ]);
    ok(label + ': gap', close(num('w08-gap'), x.imJ - x.reJ, 0.0101), [num('w08-gap'), x.imJ - x.reJ]);
    ok(label + ': imagined hits', close(num('w08-imh'), 100 * x.imHits, 0.51), [num('w08-imh'), 100 * x.imHits]);
    ok(label + ': real hits', close(num('w08-reh'), 100 * x.reHits, 0.51), [num('w08-reh'), 100 * x.reHits]);
    const ex = variant === 'exact';                                  // no model: no disagreement, no log; the real launches spent are the candidates scored
    if (!ex) {
      ok(label + ': nudges outside the log', close(num('w08-out'), 100 * x.outside, 0.51), [num('w08-out'), 100 * x.outside]);
      ok(label + ': disagreement', close(num('w08-u'), x.U, 0.0051), [num('w08-u'), x.U]);
    }
    ok(label + ': real trials', close(num('w08-tr'), ex ? POP * g * NL : x.trials, 0.51), [num('w08-tr'), ex ? POP * g * NL : x.trials]);
  };
  setAll({ 'w08-rng': '1.2', 'w08-goal': 'trained', 'w08-var': 'naive', 'w08-lam': LAMIDX(LAM), 'w08-g': GENS });
  cmp('widget naive g24', 'naive', 0, GENS, IND.naive.rec);
  page.set('w08-g', 6); cmp('widget naive g6', 'naive', 0, 6, IND.naive.rec);
  page.set('w08-g', 0); cmp('widget naive g0', 'naive', 0, 0, IND.naive.rec);
  setAll({ 'w08-var': 'exact', 'w08-g': GENS }); cmp('widget exact g24', 'exact', 0, GENS, IND.exact.rec);
  page.set('w08-g', g100(IND.exact.rec)); cmp('widget exact at full hits', 'exact', 0, g100(IND.exact.rec), IND.exact.rec);
  setAll({ 'w08-var': 'pess', 'w08-g': GENS }); cmp('widget pess lambda 1 g24', 'pess', LAM, GENS, IND.pess.rec);
  page.set('w08-g', 9); cmp('widget pess lambda 1 g9', 'pess', LAM, 9, IND.pess.rec);
  setAll({ 'w08-var': 'dyna', 'w08-g': GENS }); cmp('widget dyna g24', 'dyna', 0, GENS, IND.dyna.rec);
  for (const g of [6, 12, 18]) { page.set('w08-g', g); cmp('widget dyna g' + g, 'dyna', 0, g, IND.dyna.rec); }
  setAll({ 'w08-var': 'both', 'w08-g': GENS }); cmp('widget both g24', 'both', LAM, GENS, IND.both.rec);
  // other lambdas, through the independent pipeline
  { const baseI = new EnsI(makeLogI(NLOG, RANGE, 100 + SHOW), 500 + 13 * SHOW);
    for (const lam of [0.25, 8, 16]) { const ri = practiceI('pess', lam, baseI).rec; facts['sw_lam' + String(lam).replace('.', '') + '_im'] = ri[GENS].imJ; facts['sw_lam' + String(lam).replace('.', '') + '_re'] = ri[GENS].reJ; facts['sw_lam' + String(lam).replace('.', '') + '_reh'] = 100 * ri[GENS].reHits; facts['sw_lam' + String(lam).replace('.', '') + '_out'] = 100 * ri[GENS].outside;
      setAll({ 'w08-var': 'pess', 'w08-lam': LAMIDX(lam), 'w08-g': GENS }); cmp('widget pess lambda ' + lam, 'pess', lam, GENS, ri); }
    page.set('w08-lam', LAMIDX(LAM)); }
  // goals: the trained policy on the new goal, and the model searched afresh
  setAll({ 'w08-var': 'exact', 'w08-g': GENS, 'w08-goal': 'new' });
  ok('widget: exact-trained policy on the new goal (real hits)', close(num('w08-reh'), facts.x_ex_g2, 0.51), [num('w08-reh'), facts.x_ex_g2]);
  ok('widget: the model searched afresh for the new goal (real hits)', close(num('w08-srch'), facts.x_s_re, 0.51), [num('w08-srch'), facts.x_s_re]);
  setAll({ 'w08-var': 'both', 'w08-goal': 'new' });
  ok('widget: policy trained with both fixes on the new goal (real hits)', close(num('w08-reh'), facts.x_bo_g2, 0.51), [num('w08-reh'), facts.x_bo_g2]);
  page.set('w08-goal', 'trained');
  // a launch: imagined and real miss of the displayed launch
  setAll({ 'w08-var': 'naive', 'w08-g': GENS });
  { const idx = +page.value('w08-ep'), th = IND.naive.rec[GENS].th, s = S60[idx], a = nudgeI(th, s), p = IND.naive.ens.predict(s, a), e = endI(s, a);
    ok('widget: the displayed launch, imagined miss', close(num('w08-lm-im'), missI([p.x, p.y], GOAL1), 0.0051), [num('w08-lm-im'), missI([p.x, p.y], GOAL1)]);
    ok('widget: the displayed launch, real miss', close(num('w08-lm-re'), missI(e, GOAL1), 0.0051), [num('w08-lm-re'), missI(e, GOAL1)]);
    facts.ep_im = missI([p.x, p.y], GOAL1); facts.ep_re = missI(e, GOAL1); facts.ep_idx = idx; facts.ep_a = Math.hypot(a[0], a[1]); facts.ep_u = p.u; facts.ep_rx = e[0]; facts.ep_ry = e[1];
    // the displayed launch is the one where the naive policy's flattery is largest (real miss minus imagined miss)
    let bg = -1, bi = 0; S60.forEach((s2, i) => { const a2 = nudgeI(th, s2), p2 = IND.naive.ens.predict(s2, a2), g2 = missI(endI(s2, a2), GOAL1) - missI([p2.x, p2.y], GOAL1); if (g2 > bg) { bg = g2; bi = i; } });
    ok('the page shows the launch where the flattery is largest', bi === idx, [bi, idx]); facts.ep_gap = bg; }
  // the model-error panel and the pool, as the page prints them
  ok('widget: pool spread of the model error', close(num('w08-delta'), facts.pool_delta, 0.00051), [num('w08-delta'), facts.pool_delta]);
  // the operator range: re-fit and compare to the engine's own run on the same log (independent pipeline for range 3.0)
  for (const rg of [0.8, 3.0]) {
    const baseI = new EnsI(makeLogI(NLOG, rg, 100 + SHOW), 500 + 13 * SHOW), ri = practiceI('naive', 0, baseI).rec;
    setAll({ 'w08-rng': rg.toFixed(1), 'w08-var': 'naive', 'w08-g': GENS }); cmp('widget naive, operator range ' + rg, 'naive', 0, GENS, ri);
    facts['sw_rg' + rg.toFixed(1).replace('.', '') + '_im'] = ri[GENS].imJ; facts['sw_rg' + rg.toFixed(1).replace('.', '') + '_re'] = ri[GENS].reJ;
  }
  page.set('w08-rng', '1.2');
}
function g100(rec) { return rec.findIndex(x => x.reHits >= 0.9999); }
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
lap('widget');
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
