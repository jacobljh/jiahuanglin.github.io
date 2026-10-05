#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 15 (evaluation you can afford).
 * Re-derives every number the lesson quotes with code written separately from eval_lab.js and from the widget's path:
 *   - the three checkpoints and their 2,000-trial pools: its own plant, rollout loop, brute-force kernel regressor, start offsets, progress and post of each trial
 *     (only the world's primitives, the expert and the random-feature learner come from bench.js);
 *   - exact verdict probabilities by full enumeration with integer arithmetic and a different log-gamma (no windows, no tables shared with the engine):
 *     the pooled two-proportion z-test over every pair of counts, the exact McNemar test over every pair of discordant counts, the Wilson non-overlap rule;
 *   - the intervals (normal, Wilson, Clopper-Pearson by bisection) and their exact coverage; the closed forms for the minimum detectable difference and the sizes;
 *   - the false-positive rate of stopping at the first significant look, by dynamic programming over the counts;
 *   - Monte Carlo from the raw pool outcomes, with its own streams, for every claim that has no closed form (progress scores).
 * Then it drives the page's widget through the states the prose quotes and checks that what it prints is what the independent computation gives.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const Z = 1.96, ZB = 0.8416, DT = 0.05, H = 0.02, JIT = 0.01, K = 2000, GUST = 0.05;
const r1 = (x) => +x.toFixed(6);

/* ───── the pools, written out independently ───── */
const W = BN.slalom.world(5), T = BN.slalom.horizon(W), XS = BN.slalom.xStart(), XE = BN.slalom.xEnd(W);
function gaussStep(q, u, noise, rng) {
  const c = [Math.max(-1.5, Math.min(1.5, u[0])), Math.max(-1.5, Math.min(1.5, u[1]))];
  const n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
  q[0] += DT * (c[0] + n0); q[1] += DT * (c[1] + n1);
}
function runWith(pi, q0, rng, noise) {
  const q = q0.slice(), S = [], A = []; let coll = false, done = false, last = null;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, W.body); last = p; S.push(q.slice());
    if (BN.slalom.collide(W, p)) { coll = true; break; }
    if (p[0] > XE - 0.02) { done = true; break; }
    const u = pi(q); A.push(u); gaussStep(q, u, noise, rng);
  }
  return { S, A, coll, done, last };
}
function expertDemos(m, noise, jit) {                    // m expert runs from one shared stream, as arrays of states and commands
  const rng = BN.rng(1), X = [], Y = [];
  for (let k = 0; k < m; k++) { const dy = jit ? jit * BN.randn(rng) : 0; const r = runWith((q) => BN.slalom.expertAct(W, q), BN.slalom.startQ(W, dy), rng, noise); for (let t = 0; t < r.A.length; t++) { X.push(r.S[t]); Y.push(r.A[t]); } }
  return { X, Y };
}
function tablePolicy(D) {                                // brute force: weight every stored frame, zero beyond three bandwidths; nearest frame when none is near
  const n = D.X.length, x0 = new Float64Array(n), x1 = new Float64Array(n), y0 = new Float64Array(n), y1 = new Float64Array(n);
  for (let i = 0; i < n; i++) { x0[i] = D.X[i][0]; x1[i] = D.X[i][1]; y0[i] = D.Y[i][0]; y1[i] = D.Y[i][1]; }
  return (q) => {
    let sw = 0, a0 = 0, a1 = 0;
    for (let i = 0; i < n; i++) { const dx = (x0[i] - q[0]) / H; if (dx > 3 || dx < -3) continue; const dy = (x1[i] - q[1]) / H, e = dx * dx + dy * dy; if (e <= 9) { const w = Math.exp(-0.5 * e); sw += w; a0 += w * y0[i]; a1 += w * y1[i]; } }
    if (sw >= 1e-12) return [a0 / sw, a1 / sw];
    let best = Infinity, bi = 0; for (let i = 0; i < n; i++) { const e = ((x0[i] - q[0]) / H) ** 2 + ((x1[i] - q[1]) / H) ** 2; if (e < best) { best = e; bi = i; } }
    return [y0[bi], y1[bi]];
  };
}
function trial(pi, k) {                                  // trial k: start offset from seed 7000 + k, gust stream from seed 100000 + k
  const dy = JIT * BN.randn(BN.rng(7000 + k)), r = runWith(pi, BN.slalom.startQ(W, dy), BN.rng(100000 + k), GUST);
  let post = -1; if (r.coll) { let bd = 9; W.posts.forEach((c, i) => { const d = Math.hypot(r.last[0] - c[0], r.last[1] - c[1]); if (d < bd) { bd = d; post = i; } }); }
  return { s: r.done ? 1 : 0, g: r.done ? 1 : Math.max(0, Math.min(1, (r.last[0] - XS) / (XE - XS))), post, dy };
}
const smoothFit = () => { const dm = expertDemos(20, 0, JIT), rf = new BN.RFF(2, 2, 150, 0.1, 0.0048, 1); rf.add(dm.X, dm.Y); rf.solve(); return (q) => Array.from(rf.predict(q)); };
const POOL = { prev: [], next: [], smooth: [] };
for (const [nm, pi] of [['prev', tablePolicy(expertDemos(20, 0.0403, 0))], ['next', tablePolicy(expertDemos(20, 0.0537, 0))], ['smooth', smoothFit()]]) for (let k = 0; k < K; k++) POOL[nm].push(trial(pi, k));
const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
const variance = (a, f) => { const m = mean(a, f); return a.reduce((s, x) => s + (f(x) - m) ** 2, 0) / (a.length - 1); };
const S = {};
for (const nm of Object.keys(POOL)) { const a = POOL[nm]; S[nm] = { n: a.reduce((s, x) => s + x.s, 0), p: mean(a, (x) => x.s), g: mean(a, (x) => x.g), gv: variance(a, (x) => x.g), post: [0, 1, 2, 3, 4].map((i) => mean(a, (x) => (x.post === i ? 1 : 0))) }; }
F.pa_prev = S.prev.p * 100; F.pa_new = S.next.p * 100; F.pa_smooth = S.smooth.p * 100; F.delta = F.pa_new - F.pa_prev;
F._count_prev = S.prev.n; F._count_new = S.next.n; F._count_smooth = S.smooth.n;
check(S.prev.n === 1360 && S.next.n === 1520 && S.smooth.n === 1360, 'the tuned checkpoints finish 1360, 1520 and 1360 of their 2000 trials (got ' + [S.prev.n, S.next.n, S.smooth.n] + ')');
for (const [nm, key] of [['prev', 'prev'], ['next', 'new'], ['smooth', 'smooth']]) {
  F['g_' + key] = S[nm].g * 100; F['gsd_' + key] = Math.sqrt(S[nm].gv) * 100;
  S[nm].post.forEach((v, i) => { F['post_' + key + (i + 1)] = v * 100; });
}
/* success by start offset: the share finishing in the lowest fifth and the middle fifth of start offsets */
for (const [nm, key] of [['next', 'new'], ['smooth', 'smooth'], ['prev', 'prev']]) {
  const srt = POOL[nm].slice().sort((a, b) => a.dy - b.dy), fifth = K / 5;
  F['q1_' + key] = mean(srt.slice(0, fifth), (x) => x.s) * 100; F['q3_' + key] = mean(srt.slice(2 * fifth, 3 * fifth), (x) => x.s) * 100;
}

{ const srt = POOL.next.slice().sort((a, b) => a.dy - b.dy), fifth = K / 5, share = (g, f) => mean(g, (x) => (f(x) ? 1 : 0)) * 100;
  F.q1_post1_new = share(srt.slice(0, fifth), (x) => x.post === 0); F.q3_post1_new = share(srt.slice(2 * fifth, 3 * fifth), (x) => x.post === 0);
  F.lo_dy_min = -srt[0].dy * 100; F.lo_dy_lo = -srt[fifth - 1].dy * 100;
  const sm = POOL.smooth.slice().sort((a, b) => a.dy - b.dy); F.q1_post1_smooth = share(sm.slice(0, fifth), (x) => x.post === 0);
  check(F.q1_post1_new > 30 && F.q3_post1_new < 8 && F.q1_post1_smooth < 5, 'the new table\'s first-post failures come from the starts below the path; the smooth fit\'s do not'); }
/* ───── exact probabilities, by full enumeration ───── */
function lgamma(x) {                                     // Lanczos approximation (g = 7, nine terms)
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const LG = []; for (let i = 0; i <= 2105; i++) LG.push(i < 2 ? 0 : lgamma(i + 1));
function binomPmf(n, p) {                                // multiplicative recursion in log space
  const o = new Array(n + 1); let lg = n * Math.log(1 - p); const r = Math.log(p / (1 - p)); o[0] = Math.exp(lg);
  for (let k = 0; k < n; k++) { lg += Math.log((n - k) / (k + 1)) + r; o[k + 1] = Math.exp(lg); }
  return o;
}
function rejectInt(i, j, n) {                            // pooled two-proportion z-test in integer form: z^2 = 2 n (j - i)^2 / (s (2n - s)) > 1.96^2
  const s = i + j; if (s === 0 || s === 2 * n) return 0;
  return 2 * n * (j - i) * (j - i) > Z * Z * s * (2 * n - s) ? (j > i ? 1 : -1) : 0;
}
function exactIndep(p1, p2, n) {
  const a = binomPmf(n, p1), b = binomPmf(n, p2); let right = 0, wrong = 0, more = 0, tie = 0, less = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { const w = a[i] * b[j], r = rejectInt(i, j, n); if (r > 0) right += w; else if (r < 0) wrong += w; if (j > i) more += w; else if (j === i) tie += w; else less += w; }
  return { right, wrong, more, tie, less };
}
function mcnemarP(b, c) { const m = b + c; if (m === 0) return 1; const k = Math.min(b, c); let s = 0; for (let i = 0; i <= k; i++) s += Math.exp(LG[m] - LG[i] - LG[m - i] - m * Math.LN2); return Math.min(1, 2 * s); }
function exactPaired(pb, pa, n) {
  const r = 1 - pb - pa, lb = pb > 0 ? Math.log(pb) : 0, la = pa > 0 ? Math.log(pa) : 0, lr = Math.log(r); let right = 0, wrong = 0, more = 0, tie = 0, less = 0;
  for (let b = 0; b <= n; b++) { if (pb === 0 && b > 0) break; for (let c = 0; c + b <= n; c++) { if (pa === 0 && c > 0) break;
    const w = Math.exp(LG[n] - LG[b] - LG[c] - LG[n - b - c] + b * lb + c * la + (n - b - c) * lr);
    if (b !== c && mcnemarP(b, c) <= 0.05) { if (b > c) right += w; else wrong += w; }
    if (b > c) more += w; else if (b === c) tie += w; else less += w; } }
  return { right, wrong, more, tie, less };
}
const P1 = S.prev.p, P2 = S.next.p, PB = (P1 + P2) / 2;
const n20 = exactIndep(P1, P2, 20), nSz = Math.ceil(2 * (Z + ZB) ** 2 * PB * (1 - PB) / (P2 - P1) ** 2), nBig = exactIndep(P1, P2, nSz);
F.n20_more = n20.more * 100; F.n20_tie = n20.tie * 100; F.n20_less = n20.less * 100; F.n20_right = n20.right * 100; F.n20_wrong = n20.wrong * 100; F.n20_notahead = (n20.tie + n20.less) * 100;
F.nd8 = nSz; F.n495_more = nBig.more * 100; F.n495_tie = nBig.tie * 100; F.n495_less = nBig.less * 100; F.n495_right = nBig.right * 100; F.n495_wrong = nBig.wrong * 100;

/* ───── intervals and their coverage ───── */
const wilson = (k, n) => { const p = k / n, z2 = Z * Z, c = (p + z2 / (2 * n)) / (1 + z2 / n), h = Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n); return [c - h, c + h]; };
const normalCI = (k, n) => { const p = k / n, h = Z * Math.sqrt(p * (1 - p) / n); return [p - h, p + h]; };
function cdfLE(k, n, p) { let s = 0; for (let i = 0; i <= k; i++) s += Math.exp(LG[n] - LG[i] - LG[n - i] + (i ? i * Math.log(p) : 0) + (n - i ? (n - i) * Math.log(1 - p) : 0)); return s; }
function clopper(k, n) {                                 // bisection on the exact binomial tails
  let lo = 0, hi = 1; const al = 0.05;
  if (k > 0) { let a = 0, b = 1; for (let it = 0; it < 80; it++) { const m = (a + b) / 2; if (1 - cdfLE(k - 1, n, m) < al / 2) a = m; else b = m; } lo = (a + b) / 2; }
  if (k < n) { let a = 0, b = 1; for (let it = 0; it < 80; it++) { const m = (a + b) / 2; if (cdfLE(k, n, m) > al / 2) a = m; else b = m; } hi = (a + b) / 2; }
  return [lo, hi];
}
for (const [k, tag] of [[15, 'i15'], [19, 'i19'], [20, 'i20']]) {
  const a = normalCI(k, 20), b = wilson(k, 20), c = clopper(k, 20);
  F[tag + 'nl'] = a[0] * 100; F[tag + 'nh'] = a[1] * 100; F[tag + 'wl'] = b[0] * 100; F[tag + 'wh'] = b[1] * 100; F[tag + 'cl'] = c[0] * 100; F[tag + 'ch'] = c[1] * 100;
}
{ const a = wilson(5, 10), b = wilson(8, 10); F.i5l = a[0] * 100; F.i5h = a[1] * 100; F.i8l = b[0] * 100; F.i8h = b[1] * 100; check(a[1] > b[0], '5 of 10 and 8 of 10 have overlapping Wilson intervals'); }
function coverage(n, ps, ci) { let tot = 0; for (const p of ps) { const pm = binomPmf(n, p); let c = 0; for (let k = 0; k <= n; k++) { const iv = ci(k, n); if (p >= iv[0] - 1e-12 && p <= iv[1] + 1e-12) c += pm[k]; } tot += c; } return tot / ps.length; }
{ const ps = []; for (let i = 0; i <= 45; i++) ps.push(0.5 + i * 0.01); F.cov_n = coverage(20, ps, normalCI) * 100; F.cov_w = coverage(20, ps, wilson) * 100; F.cov_c = coverage(20, ps, clopper) * 100; }
F.sd20 = Math.sqrt(0.72 * 0.28 / 20) * 100;
const wid = (p, n) => { const z2 = Z * Z; return 2 * Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n) * 100; };
F.w20 = wid(P2, 20); F.w100 = wid(P2, 100); F.w500 = wid(P2, 500);
check(F.cov_w > 94.5 && F.cov_w < 96 && F.cov_n < 91 && F.cov_c > 96.5, 'Wilson covers about 95 %, the normal interval under 91 %, Clopper-Pearson over 96.5 % (' + [F.cov_n, F.cov_w, F.cov_c] + ')');
check(F.i20nl === 100 && F.i20nh === 100 && F.i19nh > 100, 'the normal interval collapses at 20 of 20 and leaves the range at 19 of 20');

for (const n of [100, 200, 500, 1000]) { const e = exactIndep(P1, P2, n); F['n' + n + '_right'] = e.right * 100; F['n' + n + '_more'] = e.more * 100; }
/* ───── minimum detectable difference, sizes, the three rules ───── */
const nOf = (d, pb) => Math.ceil(2 * (Z + ZB) ** 2 * pb * (1 - pb) / (d * d));
const mddOf = (n, pb) => (Z + ZB) * Math.sqrt(2 * pb * (1 - pb) / n) * 100;
F.mdd20 = mddOf(20, 0.72); F.mdd100 = mddOf(100, 0.72); F.mdd500 = mddOf(500, 0.72); F.mdd1000 = mddOf(1000, 0.72);
F.sd_diff20 = Math.sqrt(2 * 0.72 * 0.28 / 20) * 100;
const DPTS = [30, 20, 10, 8, 5, 3], MIN = 3;
for (const d of DPTS) { const n = nOf(d / 100, 0.72); F['nd' + d] = n; F['tt' + d] = 2 * n; F['h' + d] = 2 * n * MIN / 60; F['wk' + d] = 2 * n * MIN / 60 / 40; }
check(F.nd8 === nOf(0.08, 0.72), 'the 68 vs 76 pair needs the same trials as a gap of eight points around 72 %');
F.zsum2 = (Z + ZB) ** 2; F.ncoef = 2 * F.zsum2;
{ const eq = binomPmf(20, 0.72); let hi = 0, tie = 0, zt = 0, ov = 0; const lo = [], up = []; for (let k = 0; k <= 20; k++) { const w = wilson(k, 20); lo.push(w[0]); up.push(w[1]); }
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) { const w = eq[i] * eq[j]; if (j > i) hi += w; if (j === i) tie += w; if (rejectInt(i, j, 20) > 0) zt += w; if (lo[j] > up[i]) ov += w; }
  F.eq_high = hi * 100; F.eq_tie = tie * 100; F.eq_z = zt * 100; F.eq_over = ov * 100; }
for (const nn of [100, 495, 1000]) { const e = binomPmf(nn, 0.72); let h = 0; for (let i = 0; i <= nn; i++) for (let j = i + 1; j <= nn; j++) h += e[i] * e[j]; check(h > 0.40, 'the higher-count rule names the new one of two equal checkpoints in over 40 % of evaluations at any n (' + (h * 100).toFixed(1) + ' % at n = ' + nn + ')'); }
function powerOverlap(p1, p2, n) { const a = binomPmf(n, p1), b = binomPmf(n, p2), lo = [], up = []; for (let k = 0; k <= n; k++) { const w = wilson(k, n); lo.push(w[0]); up.push(w[1]); } let r = 0; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) if (lo[j] > up[i]) r += a[i] * b[j]; return r; }
{ let lo = nSz, hi = 2000; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (powerOverlap(P1, P2, m) >= 0.8) hi = m; else lo = m; } F.n80_over = hi; F.over_ratio = hi / nSz; }
{ let n = 5; while (exactIndep(P1, P2, n).right < 0.8) n++; F._exact_n80 = n; check(Math.abs(n - nSz) / nSz < 0.04, 'the exact smallest n for 80 % power is within 4 % of the closed form (' + n + ' vs ' + nSz + ')'); }
check(F.n495_right > 80 && F.n20_right < 10 && F.n20_notahead > 30, 'twenty trials rarely settle the pair, and a third of the time do not even show the new one ahead');

/* ───── the price ───── */
F.auto_min = 24 * 60 / 850; F.auto_h = F.tt8 * F.auto_min / 60;
F.h8 = F.tt8 * MIN / 60; F.wk8 = F.h8 / 40; F.train_runs = 40; F.train_h = 40 * MIN / 60; F.ratio_train = F.tt8 / 40;
F.sweep_h = 6 * F.h8; F.sweep_wk = F.sweep_h / 40;
F.hours_500 = 2 * 500 * MIN / 60; F.weeks_500 = F.hours_500 / 40; F.ratio_500 = 1000 / 40; F.hours_1000 = 2 * 1000 * MIN / 60; F.weeks_1000 = F.hours_1000 / 40;
F.hours_500_auto = 1000 * 1.7 / 60; /* the widget is set to 1.7 minutes a trial, the AutoEval pace rounded as the page quotes it */
F.hours_20 = 2 * 20 * MIN / 60; F.ratio_20 = 40 / 40;
F.l3_n = nOf(0.956 - 0.635, (0.635 + 0.956) / 2); check(exactIndep(0.635, 0.956, F.l3_n).right >= 0.8, 'lesson 3\'s repair (63.5 -> 95.6 %) is resolved at 80 % power by the closed-form number of trials (' + F.l3_n + ')');
F.ck_n = nOf(0.10, 0.60); F.ck_tt = 2 * F.ck_n; F.ck_h = F.ck_tt * MIN / 60; F.ck_wk = F.ck_h / 40; F.ck_mdd30 = mddOf(30, 0.60);

/* ───── pairing ───── */
function pairs(A, B, mode) {
  const out = [];
  if (mode === 'same') { for (let i = 0; i < A.length; i++) out.push([A[i], B[i]]); return out; }
  const idx = A.map((x, k) => k).sort((a, b) => A[a].dy - A[b].dy);
  for (let i = 0; i + 1 < idx.length; i += 2) { const u = idx[i], v = idx[i + 1]; out.push([A[u], B[v]]); out.push([A[v], B[u]]); }
  return out;
}
function cellsOf(prs) { let a = 0, b = 0, d = 0, d2 = 0; for (const [x, y] of prs) { if (x.s && !y.s) a++; else if (y.s && !x.s) b++; const df = y.g - x.g; d += df; d2 += df * df; } const n = prs.length, dm = d / n; return { a: a / n, b: b / n, psi: (a + b) / n, delta: (b - a) / n, dvar: (d2 - n * dm * dm) / (n - 1) }; }
const nPairs = (psi, delta) => Math.ceil((Z * Math.sqrt(psi) + ZB * Math.sqrt(psi - delta * delta)) ** 2 / (delta * delta));
const psiInd = P2 * (1 - P1) + P1 * (1 - P2);
F.psi_ind = psiInd * 100;
F.n_ind_paired = nPairs(psiInd, P2 - P1);
check(Math.abs(F.n_ind_paired - nSz) / nSz < 0.01, 'the paired formula with independent outcomes agrees with the unpaired one to within 1 % (' + F.n_ind_paired + ' vs ' + nSz + ')');
const CELL = {};
for (const [prevKey, tag] of [['prev', 't'], ['smooth', 's']]) for (const mode of ['start', 'same']) {
  const c = cellsOf(pairs(POOL[prevKey], POOL.next, mode)); CELL[prevKey + mode] = c;
  F['psi_' + mode + '_' + tag] = c.psi * 100; F['n_' + mode + '_' + tag] = nPairs(c.psi, c.delta); F['a_' + mode + '_' + tag] = c.a * 100; F['b_' + mode + '_' + tag] = c.b * 100;
  check(Math.abs(c.delta - (P2 - P1)) < 1e-12, 'pairing leaves the margins, and so the difference, where they were (' + prevKey + ' ' + mode + ')');
}
F.same_gain = nSz / F.n_same_t; F.start_save = (1 - F.n_start_t / nSz) * 100;
F.disc20 = CELL.prevsame.psi * 20;
{ let m = 1; while (2 * Math.pow(0.5, m) > 0.05) m++; F.mc_minm = m; check(mcnemarP(m, 0) <= 0.05 && mcnemarP(m - 1, 0) > 0.05, 'six discordant pairs, all one way, are the least the exact test accepts'); }
F.same_right20 = exactPaired(CELL.prevsame.b, CELL.prevsame.a, 20).right * 100;
F.p100_same_t = exactPaired(CELL.prevsame.b, CELL.prevsame.a, 100).right * 100; F.p500_start_t = exactPaired(CELL.prevstart.b, CELL.prevstart.a, 500).right * 100;
F.p500_same_s = exactPaired(CELL.smoothsame.b, CELL.smoothsame.a, 500).right * 100; F.p500_start_s = exactPaired(CELL.smoothstart.b, CELL.smoothstart.a, 500).right * 100;
F.mc_p = mcnemarP(8, 2);
check(Math.abs(F.mc_p - 0.109375) < 1e-9, 'McNemar example: 8 against 2 discordant pairs gives the exact two-sided p of 0.109');

/* ───── looking early: stopping at the first significant look, exact by dynamic programming over the counts ───── */
function peek(p, nmin, nmax, every) {
  let cur = [[1]], rej = 0;
  for (let n = 1; n <= nmax; n++) {
    const nx = []; for (let i = 0; i <= n; i++) nx.push(new Array(n + 1).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const m = cur[i][j]; if (!m) continue; nx[i][j] += m * (1 - p) * (1 - p); nx[i + 1][j] += m * p * (1 - p); nx[i][j + 1] += m * (1 - p) * p; nx[i + 1][j + 1] += m * p * p; }
    cur = nx;
    if (n >= nmin && (n - nmin) % every === 0) for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) if (rejectInt(i, j, n) !== 0) { rej += cur[i][j]; cur[i][j] = 0; }
  }
  return rej;
}
F.peek_all = peek(0.72, 10, 200, 1) * 100; F.peek_10 = peek(0.72, 10, 200, 10) * 100; F.peek_one = peek(0.72, 200, 200, 1) * 100;
check(F.peek_one > 4 && F.peek_one < 6 && F.peek_all > 25, 'one look keeps the 5 % error rate; a look after every pair raises it above 25 %');

/* ───── progress: sizes by the closed form, checked by resampling the raw pool ───── */
const gvar = (nm) => S[nm].gv;
const nProg = (a, b) => Math.ceil((Z + ZB) ** 2 * (gvar(a) + gvar(b)) / (S[b].g - S[a].g) ** 2);
F.n80_prog_prev = nProg('prev', 'next'); F.n80_prog_smooth = nProg('smooth', 'next');
F.gap_prog_prev = (S.next.g - S.prev.g) * 100; F.gap_prog_smooth = (S.smooth.g - S.next.g) * 100; F.gap_succ = F.delta;
check(S.next.p > S.smooth.p && S.next.g < S.smooth.g, 'the ranking reverses: the new table finishes more trials and the smooth fit gets further');
check(S.next.p > S.prev.p && S.next.g > S.prev.g, 'the previous table and the new table agree under both metrics');
function mcPower(A, B, n, R, seed) {                     // resample the raw pool: R evaluations of n trials per checkpoint; the z-test on mean progress; returns the share that declare the better one better
  let ok = 0; const better = mean(B, (x) => x.g) > mean(A, (x) => x.g) ? 1 : -1;
  for (let r = 0; r < R; r++) {
    const rg = BN.rng(seed + r); let m1 = 0, m2 = 0, q1 = 0, q2 = 0;
    for (let t = 0; t < n; t++) { const x = A[Math.floor(rg() * K)], y = B[Math.floor(rg() * K)]; m1 += x.g; m2 += y.g; q1 += x.g * x.g; q2 += y.g * y.g; }
    const se = Math.sqrt(Math.max(0, (q1 - m1 * m1 / n) / (n - 1)) / n + Math.max(0, (q2 - m2 * m2 / n) / (n - 1)) / n), z = se > 0 ? (m2 - m1) / n / se : 0;
    if (z * better > Z) ok++;
  }
  return ok / R;
}
F._mc_prog_prev = mcPower(POOL.prev, POOL.next, F.n80_prog_prev, 3000, 880000);
F._mc_prog_smooth = mcPower(POOL.smooth, POOL.next, F.n80_prog_smooth, 3000, 890000);
check(Math.abs(F._mc_prog_prev - 0.8) < 0.06 && Math.abs(F._mc_prog_smooth - 0.8) < 0.06, 'at the closed-form sizes the resampled power for progress is about 80 % (' + F._mc_prog_prev + ', ' + F._mc_prog_smooth + ')');
{ // the same resampling for success, against the exact enumeration, at 20 and 100 trials
  const mc = (n, R, seed) => { let ok = 0; for (let r = 0; r < R; r++) { const rg = BN.rng(seed + r); let k1 = 0, k2 = 0; for (let t = 0; t < n; t++) { k1 += POOL.prev[Math.floor(rg() * K)].s; k2 += POOL.next[Math.floor(rg() * K)].s; } if (rejectInt(k1, k2, n) > 0) ok++; } return ok / R; };
  const m20 = mc(20, 20000, 700000), m100 = mc(100, 20000, 710000), e100 = exactIndep(P1, P2, 100).right;
  check(Math.abs(m20 - n20.right) < 0.01 && Math.abs(m100 - e100) < 0.012, 'resampling the raw pool reproduces the exact power at 20 and 100 trials (' + m20 + ' vs ' + n20.right + ', ' + m100 + ' vs ' + e100 + ')');
}

/* ───── claims asserted ───── */
check(F.n20_more > 60 && F.n20_more < 70 && F.n20_right < 10 && F.n20_wrong < 1, 'twenty trials: the new checkpoint is ahead about two times in three, significantly so under one time in ten');
check(Math.abs(F.mdd20 - 39.8) < 0.2, 'twenty trials resolve about 40 points');
check(F.same_gain > 4.5 && F.start_save > 5 && F.start_save < 20 && F.n_same_s > 0.8 * nSz, 'replayed gusts cut similar checkpoints\' trials about fivefold, matched starts about a tenth, and a different recipe barely at all');
check(CELL.prevsame.a === 0, 'the new table never loses a trial the previous one wins when the gusts are replayed');
check(F.q1_new < F.q3_new - 20 && Math.abs(F.q1_smooth - F.q3_smooth) < 15, 'the start offset decides the tables\' trials and not the smooth fit\'s');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '15_evaluation_you_can_afford.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  pg.drain();
  const GRID = [5, 8, 10, 15, 20, 30, 40, 50, 70, 100, 140, 200, 280, 400, 500, 650, 800, 1000];
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const near = (id, want, tol, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= tol)) fail(`${what}: widget #${id} prints ${got}, the independent resampling gives ${want.toFixed(2)} (tolerance ${tol})`); };
  const setState = (n, prev, pair, metric, minutes) => { pg.set('w15-n', GRID.indexOf(n)); pg.set('w15-prev', prev); pg.set('w15-pair', pair); pg.set('w15-metric', metric); pg.set('w15-min', minutes); pg.drain(); };
  /* success, independent trials */
  const probeSucc = (n, tag, minutes) => {
    const e = exactIndep(P1, P2, n);
    eqd('w15-pa', P1 * 100, 1, tag + ' previous true rate'); eqd('w15-pb', P2 * 100, 1, tag + ' new true rate');
    eqd('w15-width', wid(P2, n), 1, tag + ' interval width'); eqd('w15-mdd', mddOf(n, PB), 1, tag + ' smallest detectable difference');
    eqd('w15-right', e.right * 100, 1, tag + ' chance of the right verdict'); eqd('w15-high', e.more * 100, 1, tag + ' chance the higher count is the better one');
    eqd('w15-n80', nSz, 0, tag + ' trials for 80 % power'); eqd('w15-hours', 2 * n * minutes / 60, 1, tag + ' robot-hours'); eqd('w15-weeks', 2 * n * minutes / 60 / 40, 2, tag + ' robot-weeks'); eqd('w15-ratio', 2 * n / 40, 1, tag + ' trials per training run');
  };
  setState(20, 'table', 'indep', 'succ', 3); probeSucc(20, 'default', 3);
  setState(100, 'table', 'indep', 'succ', 3); probeSucc(100, 'n=100', 3);
  setState(200, 'table', 'indep', 'succ', 3); probeSucc(200, 'n=200', 3);
  setState(500, 'table', 'indep', 'succ', 3); probeSucc(500, 'n=500', 3);
  setState(1000, 'table', 'indep', 'succ', 3); probeSucc(1000, 'n=1000', 3);
  setState(500, 'table', 'indep', 'succ', 1.7); probeSucc(500, 'n=500 at 1.7 min', 1.7);
  setState(500, 'smooth', 'indep', 'succ', 3); probeSucc(500, 'smooth fit as previous, n=500', 3);
  /* success, paired trials */
  const probePaired = (prevKey, mode, n, tag) => {
    const c = CELL[prevKey + mode], e = exactPaired(c.b, c.a, n);
    eqd('w15-right', e.right * 100, 1, tag + ' chance of the right verdict'); eqd('w15-high', e.more * 100, 1, tag + ' chance the higher count is the better one');
    eqd('w15-n80', nPairs(c.psi, c.delta), 0, tag + ' pairs for 80 % power'); eqd('w15-pa', P1 * 100, 1, tag + ' previous true rate'); eqd('w15-pb', P2 * 100, 1, tag + ' new true rate');
  };
  setState(500, 'table', 'start', 'succ', 3); probePaired('prev', 'start', 500, 'matched starts, n=500');
  setState(100, 'table', 'same', 'succ', 3); probePaired('prev', 'same', 100, 'same starts and gusts, n=100');
  setState(20, 'table', 'same', 'succ', 3); probePaired('prev', 'same', 20, 'same starts and gusts, n=20');
  setState(500, 'smooth', 'same', 'succ', 3); probePaired('smooth', 'same', 500, 'smooth fit, same starts and gusts, n=500');
  setState(500, 'smooth', 'start', 'succ', 3); probePaired('smooth', 'start', 500, 'smooth fit, matched starts, n=500');
  /* progress */
  const probeProg = (prevKey, n, tag) => {
    const A = POOL[prevKey], B = POOL.next, ga = mean(A, (x) => x.g) * 100, gb = mean(B, (x) => x.g) * 100;
    eqd('w15-pa', ga, 1, tag + ' previous true progress'); eqd('w15-pb', gb, 1, tag + ' new true progress');
    eqd('w15-width', 2 * Z * Math.sqrt(variance(B, (x) => x.g) / n) * 100, 1, tag + ' progress interval width');
    eqd('w15-mdd', (Z + ZB) * Math.sqrt((variance(A, (x) => x.g) + variance(B, (x) => x.g)) / n) * 100, 1, tag + ' smallest detectable progress difference');
    eqd('w15-n80', nProg(prevKey, 'next'), 0, tag + ' trials for 80 % power (progress)');
    near('w15-right', mcPower(A, B, n, 6000, 920000) * 100, 6, tag + ' chance of the right verdict (progress)');
  };
  setState(500, 'table', 'indep', 'prog', 3); probeProg('prev', 500, 'progress, previous table, n=500');
  setState(100, 'smooth', 'indep', 'prog', 3); probeProg('smooth', 100, 'progress, smooth fit, n=100');
  setState(280, 'smooth', 'indep', 'prog', 3); probeProg('smooth', 280, 'progress, smooth fit, n=280');
  /* the thirty rows: at 1000 trials per checkpoint the verdict squares are almost all green for success; the page offers a counter */
  setState(1000, 'table', 'indep', 'succ', 3); const rowsTxt = pg.text('w15-rows'); check(/\d+ \/ \d+ \/ \d+/.test(rowsTxt), 'the rows counter prints right / none / wrong (got ' + rowsTxt + ')');
  { const m = /(\d+) \/ (\d+) \/ (\d+)/.exec(rowsTxt); if (m) check(+m[1] + +m[2] + +m[3] === 30, 'the three counts add to the 30 rows (got ' + rowsTxt + ')'); }
}

for (const k of Object.keys(F)) F[k] = r1(F[k]);
console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
