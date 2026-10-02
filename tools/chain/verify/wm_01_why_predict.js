#!/usr/bin/env node
/* Oracle for World Models lesson 01, "Why predict? The world-model contract".
 *
 * The lesson's numbers all come from one experiment, the NUDGE TASK on the plain Courtyard: a launcher fires the ball, at step 12 the
 * agent may add one impulse (|a| <= 3 m/s), then the ball coasts for 80 steps; success = the ball ends inside the goal disc.
 *
 * This oracle
 *   (1) re-implements the Courtyard's free-flight-plus-walls physics WITHOUT calling CY.step (a separate five-sub-step integrator),
 *       cross-checks it against the engine on random states and against the closed form for pure friction (stopping distance v/gamma);
 *   (2) replays the widget's protocol (60 launches, 512 candidate nudges per launch, fixed seeds) with that integrator and derives every
 *       quoted number: random-nudge success p, trials until success, the (1+1)-ES baseline, success of best-of-K planning for the true state
 *       and for the state a sensor gives, the sensor-noise sweep, the noise the planner can stand;
 *   (3) checks the closed forms of the lesson: 1-(1-p)^K, K for 99 %, the break-even cost ratio, the sqrt(2)*sigma/dt velocity error,
 *       and validates p with a fresh, larger Monte-Carlo sample;
 *   (4) drives the page's own widget into each state the prose describes and compares what it prints.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ── 1. an independent integrator for the plain Courtyard (walls only) ── */
const GAMMA = 0.35, DT = 0.1, SUB = 5, RB = 0.1, WALL_E = 0.9, AW = 8, AH = 5, GOAL = { x: 6.6, y: 2.5, r: 0.5 };
function stepI(s, a) {
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  if (a) { vx += a[0]; vy += a[1]; }
  const h = DT / SUB, damp = Math.exp(-GAMMA * h), glide = (1 - damp) / GAMMA;     // exact solution of dv/dt = -gamma v over one sub-step
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
  for (let n = 0; n < 500; n++) {
    let s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 6 * rng() - 3, 6 * rng() - 3], q = s.slice(), a = n % 3 === 0 ? [rng() - 0.5, rng() - 0.5] : null;
    for (let t = 0; t < 25; t++) { s = stepI(s, t === 0 ? a : null); q = CY.step(W0, q, t === 0 ? a : null); }
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
  }
  ok('independent integrator == CY.step (500 random trajectories, 25 steps, walls included)', worst < 1e-9, worst);
}
{ // closed form: with no walls in reach a ball pushed at speed v stops after v/gamma; position after t seconds is x0 + v (1 - e^{-gamma t})/gamma
  const v = 2.4; let s = [0.5, 2.5, v, 0]; const Wbig = CY.world({ W: 1000, H: 1000, curtain: null });
  let q = s.slice(); for (let t = 0; t < 600; t++) q = CY.step(Wbig, q, null);
  ok('stopping distance v/gamma (engine, 60 s of coasting)', close(q[0] - 0.5, v / GAMMA, 1e-3), q[0] - 0.5);
  ok('exact friction integral after 1 s', close((() => { let r = [0.5, 2.5, v, 0]; for (let t = 0; t < 10; t++) r = stepI(r, null); return r[0] - 0.5; })(), v * (1 - Math.exp(-GAMMA * 1)) / GAMMA, 1e-9));
  facts.stop_gain = 1 / GAMMA;           // metres of stopping distance per m/s of velocity error
  { let r = [0.5, 2.5, v, 0]; for (let t = 0; t < 80; t++) r = CY.step(Wbig, r, null);   // the 8 s the task allows
    facts.coast8_pct = 100 * (r[0] - 0.5) / (v / GAMMA);
    ok('after the 8 s the task allows a ball has covered 1 - e^{-8 gamma} of its stopping distance', close(facts.coast8_pct, 100 * (1 - Math.exp(-GAMMA * 8)), 1e-6), facts.coast8_pct); }
}

/* ── 2. the protocol of the widget, replayed ── */
const TA = 12, TF = 80, AMAX = 3, N = 60, KMAX = 512;
const rng = CY.rng(5), TR = [], ZZ = [], CAND = [];
for (let i = 0; i < N; i++) {
  const s0 = CY.launch(W0, rng), tr = [s0], z = [];
  for (let t = 0; t < TA; t++) tr.push(stepI(tr[t], null));
  for (let t = 0; t <= TA; t++) z.push([CY.randn(rng), CY.randn(rng)]);
  TR.push(tr); ZZ.push(z);
  const rc = CY.rng(1000 + i), cand = [];
  for (let k = 0; k < KMAX; k++) { const an = 2 * Math.PI * rc(), am = AMAX * Math.sqrt(rc()); cand.push([am * Math.cos(an), am * Math.sin(an)]); }
  CAND.push(cand);
}
const outcome = (s, a) => { let q = stepI(s, a); for (let u = 0; u < TF; u++) q = stepI(q, null); return q; };
const missOf = f => Math.hypot(f[0] - GOAL.x, f[1] - GOAL.y);
const occl = s => s[0] > 2.6 && s[0] < 3.4;
const TRUE_MISS = TR.map((tr, i) => CAND[i].map(a => missOf(outcome(tr[TA], a))));
let hits = 0; TRUE_MISS.forEach(r => r.forEach(m => { if (m < GOAL.r) hits++; }));
const p = hits / (N * KMAX);
facts.p_pct = 100 * p;
facts.behind_pct = 100 * TR.filter(tr => occl(tr[TA])).length / N;
facts.mean_speed_ta = TR.reduce((a, tr) => a + Math.hypot(tr[TA][2], tr[TA][3]), 0) / N;
{ // trials until the first success when nudges are tried blindly at random, in list order
  const firsts = TRUE_MISS.map(r => { const j = r.findIndex(m => m < GOAL.r); return j < 0 ? KMAX + 1 : j + 1; });
  facts.rand_mean = firsts.reduce((a, b) => a + b, 0) / N;
  facts.rand_theory = 1 / p;
  facts.rand_tail100 = 100 * Math.pow(1 - p, 100);            // P(no success in 100 blind trials), percent
  ok('blind trials: measured mean is the geometric mean 1/p within 25 %', Math.abs(facts.rand_mean / facts.rand_theory - 1) < 0.25, [facts.rand_mean, facts.rand_theory]);
}
{ // the adaptive baseline: (1+1) evolution strategy with restarts, real trials until success
  const rdisc = r => { const an = 2 * Math.PI * r(), am = AMAX * Math.sqrt(r()); return [am * Math.cos(an), am * Math.sin(an)]; };
  const counts = TR.map((tr, i) => {
    const r = CY.rng(100 + i), s = tr[TA]; let a = rdisc(r), sig = 1.0, trials = 1, m = missOf(outcome(s, a)), since = 0;
    while (m >= GOAL.r && trials < 2000) {
      if (since >= 25) { a = rdisc(r); sig = 1.0; m = missOf(outcome(s, a)); trials++; since = 0; continue; }
      const b = [a[0] + sig * CY.randn(r), a[1] + sig * CY.randn(r)], nb = Math.hypot(b[0], b[1]);
      if (nb > AMAX) { b[0] *= AMAX / nb; b[1] *= AMAX / nb; }
      const mb = missOf(outcome(s, b)); trials++; since++;
      if (mb < m) { a = b; m = mb; sig *= 1.5; since = 0; } else sig = Math.max(0.02, sig * 0.85);
    }
    return trials;
  });
  const sorted = counts.slice().sort((x, y) => x - y);
  facts.es_median = (sorted[N / 2 - 1] + sorted[N / 2]) / 2; facts.es_mean = counts.reduce((a, b) => a + b, 0) / N;
}
// believed state from what the sensor gives: the last two visible readings, taken at face value
function believed(i, sig) {
  const tr = TR[i]; let t1 = -1, t2 = -1;
  for (let u = TA; u >= 0; u--) if (!occl(tr[u])) { if (t1 < 0) t1 = u; else { t2 = u; break; } }
  const z1 = [tr[t1][0] + sig * ZZ[i][t1][0], tr[t1][1] + sig * ZZ[i][t1][1]], z2 = [tr[t2][0] + sig * ZZ[i][t2][0], tr[t2][1] + sig * ZZ[i][t2][1]], dt = (t1 - t2) * DT;
  return [z1[0], z1[1], (z1[0] - z2[0]) / dt, (z1[1] - z2[1]) / dt];
}
function curveOf(missB) {
  const succ = new Float64Array(KMAX);
  for (let i = 0; i < N; i++) { let best = Infinity, bi = 0; for (let k = 0; k < KMAX; k++) { if (missB[i][k] < best) { best = missB[i][k]; bi = k; } if (TRUE_MISS[i][bi] < GOAL.r) succ[k] += 1 / N; } }
  return succ;
}
const beliefMiss = sig => TR.map((_, i) => { const b = believed(i, sig); return CAND[i].map(a => missOf(outcome(b, a))); });
const curveTrue = curveOf(TRUE_MISS);
const Ks = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
facts.k_default = 128;
for (const K of [1, 16, 128, 512]) { facts['st_' + K] = 100 * curveTrue[K - 1]; facts['sf_' + K] = 100 * (1 - Math.pow(1 - p, K)); }
for (const K of Ks) if (K >= 16) ok('best-of-K success follows 1-(1-p)^K (K=' + K + ')', Math.abs(curveTrue[K - 1] - (1 - Math.pow(1 - p, K))) < 0.12, [curveTrue[K - 1], 1 - Math.pow(1 - p, K)]);
facts.k99 = Math.ceil(Math.log(0.01) / Math.log(1 - p));
facts.k99_approx = 4.6 / p;
facts.breakeven = facts.k99 * p / (1 - p);
ok('K99 ~ 4.6/p', Math.abs(facts.k99 / facts.k99_approx - 1) < 0.02, [facts.k99, facts.k99_approx]);
// amortisation: trials over 100 launches
facts.amort_rand = 100 * facts.rand_theory;
// the sensor
const sweep = {};
for (const sg of [0, 0.005, 0.01, 0.02, 0.05, 0.1]) {
  const c = curveOf(beliefMiss(sg)); sweep[sg] = c;
  facts['sw_' + String(sg).replace('0.', '').replace('.', '') + '_128'] = 100 * c[127];
}
// keep keys readable
facts.sw0 = 100 * sweep[0][127]; facts.sw005 = 100 * sweep[0.005][127]; facts.sw01 = 100 * sweep[0.01][127]; facts.sw02 = 100 * sweep[0.02][127]; facts.sw05 = 100 * sweep[0.05][127]; facts.sw10 = 100 * sweep[0.1][127];
facts.sat_read512 = 100 * sweep[0.1][KMAX - 1];            // success at K = 512 with the real sensor
facts.sat_read1 = 100 * sweep[0.1][0];
{ // largest sensor noise with >= 90 % success at K = 128 (scan)
  let best = 0; for (let sg = 0; sg <= 0.02001; sg += 0.0005) { const c = curveOf(beliefMiss(sg)); if (c[127] >= 0.9) best = sg; else if (sg > 0.003) break; }
  facts.sig90_mm = 1000 * best;
}
{ // imagined miss vs real miss with the real sensor, K = 512, averaged over launches
  const bm = beliefMiss(0.1); let imag = 0, real = 0;
  for (let i = 0; i < N; i++) { let best = Infinity, bi = 0; for (let k = 0; k < KMAX; k++) if (bm[i][k] < best) { best = bm[i][k]; bi = k; } imag += best / N; real += TRUE_MISS[i][bi] / N; }
  facts.imag_miss512 = imag; facts.real_miss512 = real;
}
// the velocity read off two noisy positions
{
  const rr = CY.rng(21); let s2 = 0, n = 200000; for (let i = 0; i < n; i++) { const d = (0.1 * CY.randn(rr) - 0.1 * CY.randn(rr)) / DT; s2 += d * d; }
  facts.vel_err = Math.sqrt(s2 / n);
  ok('velocity from two readings has error sqrt(2) sigma/dt', close(facts.vel_err, Math.SQRT2 * 0.1 / DT, 0.02), facts.vel_err);
  facts.vel_err_formula = Math.SQRT2 * 0.1 / DT;
  facts.pos_err_from_vel = facts.vel_err_formula / GAMMA;       // metres of stopping-point error from that velocity error
}
/* ── what a stale or a noisy state does to the planner (review additions) ── */
const successFrom = (stateOf, K) => curveOf(TR.map((_, i) => { const s = stateOf(i); return CAND[i].map(a => missOf(outcome(s, a))); }))[K - 1];
{ // (a) free flight conserves the stopping point x + v/gamma, so an OLD state with exact numbers points at the same ending
  const r = CY.rng(51); let worst = 0;
  for (let n = 0; n < 300; n++) {
    let s = [1 + 2 * r(), 1.5 + 2 * r(), 3 * r() - 1.5, 3 * r() - 1.5]; const p0 = [s[0] + s[2] / GAMMA, s[1] + s[3] / GAMMA];
    for (let t = 0; t < 4; t++) { s = stepI(s, null); worst = Math.max(worst, Math.abs(s[0] + s[2] / GAMMA - p0[0]), Math.abs(s[1] + s[3] / GAMMA - p0[1])); }
  }
  ok('free flight conserves the stopping point x + v/gamma (no wall in reach)', worst < 1e-9, worst);
  ok('noise-free readings from before the curtain give the same success as the true state (K = 128)', close(sweep[0][127], curveTrue[127], 1e-12), [sweep[0][127], curveTrue[127]]);
  facts.hidden_n = TR.filter(tr => occl(tr[TA])).length;
  let stale = 0; for (let i = 0; i < N; i++) { let u = TA; while (u > 0 && occl(TR[i][u])) u--; stale = Math.max(stale, TA - u); }
  ok('the last visible reading is at most four steps old', stale <= 4, stale);
}
{ // (b) which half of the sensor's error does the damage: the true state with only the position wrong, or only the velocity wrong (by the noise of two readings)
  const sg = 0.1;
  facts.pos_only_succ = 100 * successFrom(i => { const t = TR[i][TA]; return [t[0] + sg * ZZ[i][TA][0], t[1] + sg * ZZ[i][TA][1], t[2], t[3]]; }, 128);
  facts.vel_only_succ = 100 * successFrom(i => { const t = TR[i][TA]; return [t[0], t[1], t[2] + sg * (ZZ[i][TA][0] - ZZ[i][TA - 1][0]) / DT, t[3] + sg * (ZZ[i][TA][1] - ZZ[i][TA - 1][1]) / DT]; }, 128);
  ok('a position error of one sensor sigma costs little; the velocity error of two readings costs nearly everything', facts.pos_only_succ > 90 && facts.vel_only_succ < 20, [facts.pos_only_succ, facts.vel_only_succ]);
}
{ // (c) the road not taken: a least-squares line through the last (up to) ten readings it has; the state is the fitted position at the last reading and the slope
  const M10 = 10;
  const lineState = (i, sg) => {
    const tr = TR[i], idx = []; for (let u = TA; u >= 0 && idx.length < M10; u--) if (!occl(tr[u])) idx.unshift(u);
    const n = idx.length, out = [];
    for (let ax = 0; ax < 2; ax++) {
      let st = 0, sy = 0, stt = 0, sty = 0;
      for (const u of idx) { const t = u * DT, y = tr[u][ax] + sg * ZZ[i][u][ax]; st += t; sy += y; stt += t * t; sty += t * y; }
      const slope = (n * sty - st * sy) / (n * stt - st * st), icpt = (sy - slope * st) / n;
      out.push([icpt + slope * idx[n - 1] * DT, slope]);
    }
    return { s: [out[0][0], out[1][0], out[0][1], out[1][1]], n, last: idx[n - 1] };
  };
  { // the closed-form normal equations against the engine's ridge solver (tiny penalty), on every launch, both axes
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const ls = lineState(i, 0.1), tr = TR[i], idx = []; for (let u = TA; u >= 0 && idx.length < M10; u--) if (!occl(tr[u])) idx.unshift(u);
      for (let ax = 0; ax < 2; ax++) {
        const Phi = new Float64Array(idx.length * 2), Y = new Float64Array(idx.length);
        idx.forEach((u, q) => { Phi[2 * q] = 1; Phi[2 * q + 1] = u * DT; Y[q] = tr[u][ax] + 0.1 * ZZ[i][u][ax]; });
        const w = CY.la.ridge(Phi, idx.length, 2, Y, 1, 1e-12);
        worst = Math.max(worst, Math.abs(w[1] - ls.s[2 + ax]), Math.abs(w[0] + w[1] * idx[idx.length - 1] * DT - ls.s[ax]));
      }
    }
    ok('line fit: closed form == ridge solver', worst < 1e-6, worst);
  }
  facts.fit10_succ_noisy = 100 * successFrom(i => lineState(i, 0.1).s, 128);
  facts.fit10_succ_clean = 100 * successFrom(i => lineState(i, 0).s, 128);
  ok('a planner handed the line fit still fails on most launches, even from noise-free readings', facts.fit10_succ_noisy < 30 && facts.fit10_succ_clean < 15, [facts.fit10_succ_noisy, facts.fit10_succ_clean]);
  ok('and it is far below the true state', facts.fit10_succ_noisy < 0.4 * facts.st_128 && facts.fit10_succ_noisy > facts.sw10, [facts.fit10_succ_noisy, facts.st_128, facts.sw10]);
  // the bias: the slope of a line through 10 noise-free readings is the velocity half a window earlier, which friction has since reduced
  const dd = Math.exp(-GAMMA * DT); facts.fit10_lag_pct = 100 * (Math.pow(dd, -4.5) - 1);
  let rel = 0, cnt = 0; for (let i = 0; i < N; i++) { const ls = lineState(i, 0), last = TR[i][ls.last]; if (ls.n < M10) continue; rel += Math.hypot(ls.s[2], ls.s[3]) / Math.hypot(last[2], last[3]) - 1; cnt++; }
  ok('measured friction bias of the noise-free slope matches d^-4.5 - 1 (within 1.5 points)', Math.abs(100 * rel / cnt - facts.fit10_lag_pct) < 1.5, [100 * rel / cnt, facts.fit10_lag_pct]);
}

// a fresh, larger Monte-Carlo estimate of p (different launches, different candidates)
{
  const rf = CY.rng(777); let h = 0, n = 60000;
  for (let j = 0; j < n; j++) {
    let s = CY.launch(W0, rf); for (let t = 0; t < TA; t++) s = stepI(s, null);
    const an = 2 * Math.PI * rf(), am = AMAX * Math.sqrt(rf()); if (missOf(outcome(s, [am * Math.cos(an), am * Math.sin(an)])) < GOAL.r) h++;
  }
  facts.p_fresh_pct = 100 * h / n;
  ok('p from a fresh sample agrees with the protocol sample (|diff| < 0.4 points)', Math.abs(facts.p_fresh_pct - facts.p_pct) < 0.4, [facts.p_fresh_pct, facts.p_pct]);
}
// the checkpoint: p = 2 %
{ const q = 0.02; facts.ck_E = 1 / q; facts.ck_K = Math.ceil(Math.log(0.05) / Math.log(1 - q)); facts.ck_ratio = facts.ck_K * q / (1 - q); facts.ck_cost = 0.05; }
facts.fric_pct = 100 * (1 - Math.exp(-GAMMA * DT));
facts.sig90_ratio = 100 / facts.sig90_mm;
{ // least-squares line through m readings: slope error sqrt(12) sigma / (dt sqrt(m (m^2 - 1)))
  const m = 10, f = Math.sqrt(12) * 0.1 / (DT * Math.sqrt(m * (m * m - 1))), rr = CY.rng(31); let s2 = 0; const n = 100000;
  for (let j = 0; j < n; j++) { let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let t = 0; t < m; t++) { const x = t * DT, y = 0.1 * CY.randn(rr); sx += x; sy += y; sxx += x * x; sxy += x * y; } const sl = (m * sxy - sx * sy) / (m * sxx - sx * sx); s2 += sl * sl; }
  facts.fit10_vel_err = f; ok('line-fit slope error formula (m = 10) vs Monte Carlo', close(Math.sqrt(s2 / n), f, 0.003), [Math.sqrt(s2 / n), f]);
  facts.fit10_stop_err = f / GAMMA;
}
facts.steps_imag = 1 + TF;                 // steps in one imagined push
facts.secs_real = TF * DT;                 // seconds in one real push

/* ── 3. the page's own widget must print the same numbers ── */
const PAGE = path.join(DIR, '01_what_is_a_world_model.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; } };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function readWidget(mode, kexp, sig, ep) {
  page.set('w01-mode', mode); page.set('w01-sig', sig); page.set('w01-k', kexp); page.set('w01-ep', ep);
  return { su: page.num('w01-su'), ra: page.num('w01-ra'), ad: page.num('w01-ad'), be: page.num('w01-be'), pe: page.num('w01-pe'), ve: page.num('w01-ve'), im: page.num('w01-im'), rm: page.num('w01-rm'), hit: page.text('w01-hit') };
}
{
  const w = readWidget('true', 7, 0.1, 28);
  ok('widget: success at K=128, true state', close(w.su, 100 * curveTrue[127], 0.51), [w.su, 100 * curveTrue[127]]);
  ok('widget: random-trial mean', close(w.ra, facts.rand_mean, 0.51), [w.ra, facts.rand_mean]);
  ok('widget: adaptive-search median', close(w.ad, facts.es_median, 0.51), [w.ad, facts.es_median]);
  ok('widget: break-even ratio', close(w.be, facts.breakeven, 0.051) || close(w.be, 128 * p / (1 - p), 0.051), [w.be, 128 * p / (1 - p)]);
  // the visible launch: independent best-of-K
  const i = 28; let best = Infinity, bi = 0; for (let k = 0; k < 128; k++) if (TRUE_MISS[i][k] < best) { best = TRUE_MISS[i][k]; bi = k; }
  ok('widget: best imagined miss on launch 28', close(w.im, best, 0.0051), [w.im, best]);
  ok('widget: real miss equals imagined miss when the model and state are exact', close(w.rm, best, 0.0051), [w.rm, best]);
  facts.ep28_miss128 = best;
}
for (const sg of [0, 0.01, 0.05, 0.1]) {
  const w = readWidget('read', 7, sg, 28), c = sweep[sg] || curveOf(beliefMiss(sg));
  ok('widget: success at K=128 for sensor noise ' + sg, close(w.su, 100 * c[127], 0.51), [w.su, 100 * c[127]]);
}
{
  const w = readWidget('read', 9, 0.1, 28);
  ok('widget: success at K=512 with the real sensor', close(w.su, facts.sat_read512, 0.51), [w.su, facts.sat_read512]);
  const bel = believed(28, 0.1), tru = TR[28][TA];
  const pe = Math.hypot(bel[0] - tru[0], bel[1] - tru[1]), ve = Math.hypot(bel[2] - tru[2], bel[3] - tru[3]);
  ok('widget: believed-state position error on launch 28', close(w.pe, pe, 0.0051), [w.pe, pe]);
  ok('widget: believed-state velocity error on launch 28', close(w.ve, ve, 0.051), [w.ve, ve]);
  facts.ep28_pos_err = pe; facts.ep28_vel_err = ve;
  const bm = beliefMiss(0.1)[28]; let best = Infinity, bi = 0; for (let k = 0; k < KMAX; k++) if (bm[k] < best) { best = bm[k]; bi = k; }
  ok('widget: best imagined miss, K=512, real sensor', close(w.im, best, 0.0051), [w.im, best]);
  ok('widget: real miss, K=512, real sensor', close(w.rm, TRUE_MISS[28][bi], 0.0051), [w.rm, TRUE_MISS[28][bi]]);
  facts.ep28_imag512 = best; facts.ep28_real512 = TRUE_MISS[28][bi];
  let b2 = Infinity, bi2 = 0; for (let k = 0; k < 128; k++) if (bm[k] < b2) { b2 = bm[k]; bi2 = k; }
  facts.ep28_imag128 = b2; facts.ep28_real128 = TRUE_MISS[28][bi2];
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
