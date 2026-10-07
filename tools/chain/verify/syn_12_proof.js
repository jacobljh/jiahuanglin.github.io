#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 12 (proof).
 *
 * Own implementations (nothing below calls the page's engine l12_proof.js except where a check says "the engine"):
 *   - the exact binomial (Clopper-Pearson) limits two ways, by brute-force sums of binomial terms and by the regularized incomplete beta (a continued fraction), and the rule of three against them
 *     for epsilon = 1e-1 ... 1e-6 and f = 0, 1, 3; the Poisson limits that the constants 3, 4.74, 6.30, 7.75 are; the road-vehicle arithmetic of the one published study the lesson cites;
 *   - Spearman's rho and Kendall's tau-b (own code, a hand case with ties, a closed form without ties, an inversion count);
 *   - the stored closed-loop tables of l12_data.js: decoded here, and TWO (world, protocol, candidate) cells re-run from scratch with the l11_episode.js engine (SV.score, one episode at a time),
 *     the programs' own operating points recomputed (800 pedestrian-free validation frames) and the street's from tables.js;
 *   - the evaluator experiment: five evaluators against the street's ranking (rho, tau, margins, picks, gaps in rate, bootstrap spreads), the simulated real campaigns (own draw scheme, 400 repeats),
 *     the number of real episodes that validates an evaluator, and the same for a failure ten times rarer (binomial draws);
 *   - the interval for p - p_sim after n real episodes (simulation against the formula) and the cost of confirming a gap;
 *   - the aiming arithmetic (variances of three allocations by formula and by simulation; the exact zero-failure bound by a Lagrangian solve and by random search);
 *   - the ledger (Lesson 2's Shapley prices recomputed from the sixteen programs, the real observations of every line, the share that are step-outs, scaled to a failure ten times rarer);
 *   - the widget, driven through the states the prose names.
 * LAB PRIVILEGES: the street's closed loop (SV.REAL with the street's walking speeds) is run in the lab; a project cannot do that. The oracle says so wherever it compares an evaluator with the street.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const req = (f) => require(path.join(root, dir, f));
const SV = req('street.js');
req('tables.js');
const LL = req('l11_episode.js');
req('l12_data.js');
const E = req('l12_proof.js');                 // the page's engine: only compared with the oracle's own numbers
req('l12_view.js');
req('evidence.js'); const L3 = req('l03_camera.js');
req('l05_cases.js'); req('l05_data.js'); const L10 = req('l10_reality.js'); req('l10_data.js');
const { loadPage } = require('../dom_probe.js');
const T = SV.TABLES, D = SV.L12, SYS = D.systems, M = SYS.length;
const T0 = Date.now();
let lapT = T0; const lap = (name) => { if (process.env.L12_TIME) { const n = Date.now(); console.error('lap ' + name + ' ' + ((n - lapT) / 1000).toFixed(1) + ' s'); lapT = n; } };

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { if (v !== v) return; F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const pc = (x) => 100 * x;
const ECODE = (e) => String(e).replace('.', '').replace('-', 'm');

/* ═════════════ 1 · the exact binomial limits, two ways, and the rule of three ═════════════ */
function lgam(x) {                                  // Lanczos approximation of ln Gamma
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgam(1 - x);
  x -= 1; let a = 0.99999999999980993; const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {                          // Lentz's continued fraction for the incomplete beta
  const TINY = 1e-300; let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < TINY) d = TINY; d = 1 / d; let h = d;
  for (let m = 1; m <= 5000; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY; c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY; d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY; c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY; d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
function betai(x, a, b) {                           // regularized incomplete beta I_x(a, b)
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgam(a + b) - lgam(a) - lgam(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
const cdfBeta = (f, n, p) => (f >= n ? 1 : betai(1 - p, n - f, f + 1));                    // P(X <= f), X ~ Binomial(n, p)
function bruteCdf(f, n, p) {                        // the sum of the terms, binomial coefficients by the multiplicative formula
  let s = 0, c = 1;
  for (let i = 0; i <= f; i++) { if (i > 0) c = c * (n - i + 1) / i; s += c * Math.pow(p, i) * Math.pow(1 - p, n - i); }
  return s;
}
function bisect(fn, lo, hi, it) { for (let i = 0; i < (it || 200); i++) { const mid = (lo + hi) / 2; if (fn(mid)) lo = mid; else hi = mid; } return (lo + hi) / 2; }
const upperBeta = (f, n, alpha) => bisect((p) => cdfBeta(f, n, p) > alpha, 0, 1, 200);          // the p at which P(X <= f) = alpha
const lowerBeta = (f, n, alpha) => (f <= 0 ? 0 : bisect((p) => 1 - cdfBeta(f - 1, n, p) < alpha, 0, 1, 200));
const smallestN = (eps, f) => { let lo = f + 1, hi = lo; while (upperBeta(f, hi, 0.05) > eps) { lo = hi; hi *= 2; } while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (upperBeta(f, mid, 0.05) > eps) lo = mid; else hi = mid; } return hi; };

{ // the two methods against each other, and the engine against both
  let worst = 0, worstE = 0, pts = 0;
  for (const n of [12, 30, 100, 300]) for (const f of [0, 1, 2, 5]) for (const p of [0.001, 0.01, 0.05, 0.2]) {
    if (f >= n) continue; const a = bruteCdf(f, n, p), b = cdfBeta(f, n, p), c = E.binomCdf(f, n, p); worst = Math.max(worst, rel(a, b)); worstE = Math.max(worstE, rel(c, a)); pts++;
  }
  check(worst < 1e-8, 'binomial cdf by brute-force sums and by the incomplete beta agree (' + worst + ')');
  check(worstE < 1e-8, 'the engine\'s binomial cdf agrees with the brute-force sums (' + worstE + ')');
  let wU = 0; for (const [f, n] of [[0, 10], [0, 100], [1, 100], [3, 100], [0, 2995], [1, 4742], [3, 7752], [5, 600], [20, 150], [0, 1e6], [3, 7.7e6]]) wU = Math.max(wU, rel(E.cpUpper(f, n), upperBeta(f, n, 0.05)));
  check(wU < 1e-7, 'the engine\'s exact upper limit agrees with the beta-function limit (' + wU + ')');
  let wL = 0; for (const [f, n] of [[1, 10], [3, 100], [20, 150], [60, 400], [900, 6400]]) wL = Math.max(wL, rel(E.cpLower(f, n, 0.025), lowerBeta(f, n, 0.025)));
  check(wL < 1e-7, 'the engine\'s exact lower limit agrees with the beta-function limit (' + wL + ')');
  for (const n of [1, 10, 100, 2995]) check(near(upperBeta(0, n, 0.05), 1 - Math.pow(0.05, 1 / n), 1e-12), 'with no failure the limit is 1 - 0.05^(1/n), n = ' + n);
}
/* the Poisson limits: the constant c_f in "n >= c_f / eps" is the mean lambda with P(Poisson(lambda) <= f) = 0.05 */
const poissonCdf = (f, lam) => { let t = Math.exp(-lam), s = t; for (let i = 1; i <= f; i++) { t *= lam / i; s += t; } return s; };
const cF = [0, 1, 2, 3].map((f) => bisect((lam) => poissonCdf(f, lam) > 0.05, 0, 30, 200));
put('c_f0', cF[0], 3); put('c_f1', cF[1], 3); put('c_f3', cF[3], 3);
check(near(cF[0], -Math.log(0.05), 1e-9), 'the f = 0 constant is -ln 0.05');
const EPS = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6], NT = {};
for (const eps of EPS) {
  const k = ECODE(eps.toExponential(0).replace('e-', 'e')), n0 = smallestN(eps, 0), n1 = smallestN(eps, 1), n3 = smallestN(eps, 3), r3 = 3 / eps;
  NT[eps] = { n0, n1, n3 };
  check(E.nFor(eps, 0) === n0 && E.nFor(eps, 1) === n1 && E.nFor(eps, 3) === n3, 'the engine\'s smallest n equals the oracle\'s for eps = ' + eps);
  check(upperBeta(0, n0, 0.05) <= eps && upperBeta(0, n0 - 1, 0.05) > eps, 'n0 is the smallest n for eps = ' + eps);
  check(upperBeta(1, n1, 0.05) <= eps && upperBeta(1, n1 - 1, 0.05) > eps, 'n1 is the smallest n for eps = ' + eps);
  check(upperBeta(3, n3, 0.05) <= eps && upperBeta(3, n3 - 1, 0.05) > eps, 'n3 is the smallest n for eps = ' + eps);
  check(rel(n0 * eps, cF[0]) < 0.04, 'n0 times eps is near ' + cF[0].toFixed(3) + ' (eps = ' + eps + ')');
  const e = 'e' + Math.round(-Math.log10(eps));
  put('n0_' + e, n0, 0); put('r3_' + e, r3, 0); put('n1_' + e, n1, 0); put('n3_' + e, n3, 0); put('rr_' + e, n0 / r3, 3);
}
check(rel(NT[1e-6].n0 * 1e-6, cF[0]) < 1e-3 && rel(NT[1e-6].n1 * 1e-6, cF[1]) < 1e-3 && rel(NT[1e-6].n3 * 1e-6, cF[3]) < 1e-3, 'at eps = 1e-6 the counts are the Poisson constants over eps');
check(NT[1e-1].n0 === 29 && NT[1e-2].n0 === 299 && NT[1e-3].n0 === 2995, 'the exact counts: 29, 299, 2,995');
put('rr_gap_10', pc(1 - NT[1e-1].n0 / 30), 1);                                   // the rule overstates by this much at eps = 0.1
put('f1_over_f0', cF[1] / cF[0], 2);
const TH = [1, 10, 100];
for (const t of TH) { put('h_e3_T' + t, NT[1e-3].n0 * t, 0); put('h_e4_T' + t, NT[1e-4].n0 * t, 0); put('h_e2_T' + t, NT[1e-2].n0 * t, 0); }
const HY = 8760;
EPS.forEach((e, i) => put('h_e' + (i + 1) + '_T10', NT[e].n0 * 10, 0));
put('yrs_e3_T10', NT[1e-3].n0 * 10 / HY, 1); put('fleet_days_e3_T10', NT[1e-3].n0 * 10 / (100 * 24), 0);
put('h_e3_T10_k', NT[1e-3].n0 * 10 / 1000, 1);
put('n_e4_h_T10', NT[1e-4].n0 * 10, 0); put('yrs_e4_T10', NT[1e-4].n0 * 10 / HY, 0);

{ // road vehicles (Kalra and Paddock, 2016): the same arithmetic, with the 2013 US human rate of 1.09 fatalities per 100 million miles
  const rate = 1.09e-8, nExact = Math.log(0.05) / Math.log1p(-rate), nRule = 3 / rate, years = nExact / (100 * 25 * HY), events = 1.96 * 1.96 / (0.2 * 0.2), nEst = events / rate;
  put('kp_exact_M', nExact / 1e6, 0); put('kp_rule_M', nRule / 1e6, 0); put('kp_years', years, 1); put('kp_events', events, 0); put('kp_est_B', nEst / 1e9, 1);
  check(near(nExact / 1e6, 274.8, 0.1) && near(years, 12.55, 0.02) && near(nEst / 1e9, 8.8, 0.05), 'the road-vehicle arithmetic reproduces the published 275 million miles, about 12.5 years and 8.8 billion miles');
}
{ // the proof's price scales with 1/eps: ten times rarer, ten times the trials
  check(near(NT[1e-4].n0 / NT[1e-3].n0, 10, 0.02) && near(NT[1e-6].n3 / NT[1e-5].n3, 10, 0.02), 'a failure ten times rarer costs ten times the trials');
  put('x10_ratio', NT[1e-4].n0 / NT[1e-3].n0, 1);
}
lap('binomial');

/* ═════════════ 2 · rank statistics: own code, a hand case, closed forms ═════════════ */
const ranksOf = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length); let i = 0; while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const corr = (x, y) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const rhoOf = (a, b) => corr(ranksOf(a), ranksOf(b));
function tauOf(a, b) {                              // the form b: pairs tied in neither are concordant or discordant; ties in one variable shrink the denominator
  let c = 0, dd = 0, ta = 0, tb = 0; const n = a.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const da = a[i] - a[j], db = b[i] - b[j]; if (da === 0 && db === 0) continue; if (da === 0) ta++; else if (db === 0) tb++; else if (da * db > 0) c++; else dd++; }
  return (c - dd) / Math.sqrt((c + dd + ta) * (c + dd + tb));
}
function inversions(a) { let k = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) k++; return k; }   // a count of out-of-order pairs
{
  const a = [1, 2, 2, 3, 5], b = [2, 1, 2, 4, 5];       // a hand case with ties; ranks of a: 1, 2.5, 2.5, 4, 5; of b: 2.5, 1, 2.5, 4, 5
  const ra = ranksOf(a), rb = ranksOf(b);
  check(JSON.stringify(ra) === '[1,2.5,2.5,4,5]' && JSON.stringify(rb) === '[2.5,1,2.5,4,5]', 'average ranks of the hand case');
  const hand = (() => { const ma = mean(ra), mb = mean(rb); let s = 0, x = 0, y = 0; for (let i = 0; i < 5; i++) { s += (ra[i] - ma) * (rb[i] - mb); x += (ra[i] - ma) ** 2; y += (rb[i] - mb) ** 2; } return s / Math.sqrt(x * y); })();
  check(near(E.spearman(a, b), hand, 1e-12) && near(rhoOf(a, b), hand, 1e-12), 'Spearman on the hand case with ties');
  // pairs: concordant 6, discordant 1... counted by hand below
  let c = 0, d = 0, ta = 0, tb = 0; const pairs = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
  for (const [i, j] of pairs) { const x = Math.sign(a[i] - a[j]), y = Math.sign(b[i] - b[j]); if (x === 0 && y === 0) { /* tied in both */ } else if (x === 0) ta++; else if (y === 0) tb++; else if (x === y) c++; else d++; }
  check(c === 7 && d === 1 && ta === 1 && tb === 1, 'hand-counted pairs: 7 concordant, 1 discordant, one tie in each variable');
  const handTau = (c - d) / Math.sqrt((c + d + ta) * (c + d + tb));
  check(near(E.kendallB(a, b), handTau, 1e-12) && near(tauOf(a, b), handTau, 1e-12), 'Kendall tau-b on the hand case with ties (' + handTau.toFixed(4) + ')');
  put('hand_rho', rhoOf(a, b), 4); put('hand_tau', handTau, 4);
  // without ties: rho = 1 - 6 sum d^2 / (n (n^2 - 1)) and tau = 1 - 2 (inversions) / (n (n - 1) / 2) (inversions of one ranking in the order of the other)
  const rng = SV.rng(31);
  for (let t = 0; t < 40; t++) {
    const n = 12, x = Array.from({ length: n }, () => rng()), y = x.map((v) => v + 0.7 * (rng() - 0.5));
    const rx = ranksOf(x), ry = ranksOf(y); let sd2 = 0; for (let i = 0; i < n; i++) sd2 += (rx[i] - ry[i]) ** 2;
    const closed = 1 - 6 * sd2 / (n * (n * n - 1)); const order = x.map((v, i) => i).sort((i, j) => x[i] - x[j]); const inv = inversions(order.map((i) => ry[i]));
    const closedT = 1 - 2 * inv / (n * (n - 1) / 2);
    check(near(E.spearman(x, y), closed, 1e-10) && near(rhoOf(x, y), closed, 1e-10), 'Spearman equals 1 - 6 sum d^2 / n(n^2 - 1) without ties');
    check(near(E.kendallB(x, y), closedT, 1e-10) && near(tauOf(x, y), closedT, 1e-10), 'Kendall tau equals 1 - 2 (inversions) / pairs without ties');
  }
}
lap('ranks');

/* ═════════════ 3 · the stored closed-loop tables: decoded here, two cells re-run with the engine ═════════════ */
const SHc = LL.shuttle(), cfg = D.cfg;
check(cfg.v0 === 7 && cfg.a === 3 && cfg.tau === 0.4 && cfg.half === 1 && cfg.dt === 0.1 && cfg.m === 2 && cfg.n === 3 && SHc.v0 === 7 && SHc.a === 3 && SHc.tau === 0.4 && SHc.half === 1 && LL.POLICY.m === 2 && LL.POLICY.n === 3, 'the shuttle and the policy are Lesson 11\'s');
const dStop = 7 * 0.4 + 7 * 7 / (2 * 3);
check(near(dStop, LL.dStop(SHc), 1e-12), 'stopping distance 7 x 0.4 + 49/6');
const WORLDS = D.worlds, PROGS = ['aaaa', 'aaba', 'abba', 'bbba'];
check(JSON.stringify(WORLDS) === '["aaaa","aaba","abba","bbba","street"]' && SYS.length === 12 && D.cfg.np === 1000 && D.cfg.ns === 2000, 'twelve candidates, five worlds, 1,000 and 2,000 episodes');
for (const [tw, orig] of Object.entries(D.twins)) check(JSON.stringify(T.models['swap@' + tw].w) === JSON.stringify(T.models['swap@' + orig].w) && T.models['swap@' + tw].thrReal === T.models['swap@' + orig].thrReal, 'the detector of ' + tw + ' is the detector of ' + orig);
const own = {};                                      // the oracle's own decode: own[world][proto] = {n, zc, bin, kd[j][i], col[j][i], rate[j], mg[j][i], margin[j]}
for (const w of WORLDS) {
  own[w] = {}; const data = D.data[w];
  for (const p of Object.keys(data.kd)) {
    const kd = data.kd[p].map((s) => Array.from(s, (ch) => ch.charCodeAt(0) - 49)), col = data.col[p].map((s) => Array.from(s, (ch) => +ch)), zc = data.zc.map((v) => v / 1000);
    const mg = kd.map((row) => row.map((k, i) => (k < 0 ? -dStop : zc[i] - 7 * (k * 0.1) - dStop)));
    own[w][p] = { n: data.n, zc, bin: Array.from(data.bin, (ch) => +ch), kd, col, mg, rate: col.map(mean), margin: mg.map(mean) };
    check(kd.length === 12 && kd.every((r) => r.length === data.n) && col.every((r) => r.length === data.n) && zc.length === data.n && data.bin.length === data.n, 'table shapes for ' + w + p);
    const pool = E.pool(w, p); check(pool.rate.every((r, j) => near(r, own[w][p].rate[j], 1e-12)) && pool.margin.every((r, j) => near(r, own[w][p].margin[j], 1e-9)), 'the engine\'s pool decodes ' + w + p + ' as the oracle does');
  }
}
const ST = own.street.S, jOf = (c) => SYS.indexOf(c);
for (let j = 0; j < M; j++) check(near(D.data.street.thr.S[j], +T.models['swap@' + SYS[j]].thrReal.toPrecision(5), 1e-12), 'the street\'s operating point of ' + SYS[j] + ' is the exam threshold of tables.js');
{ // two cells re-run from scratch with the engine l11_episode.js (SV.score on every frame, one episode at a time)
  const cells = [['aaba', 'W', 'abba', 1000], ['street', 'S', 'bbba', 2000]];
  for (const [w, p, code, nEp] of cells) {
    const world = w === 'street' ? LL.streetWorld() : LL.programWorld(w), m = T.models['swap@' + code], model = { dim: SV.DIM, w: m.w, mu: m.mu, sd: m.sd }, j = jOf(code), thr = D.data[w].thr[p][j];
    let mism = 0, hits = 0;
    for (let i = 0; i < nEp; i++) {
      const ep = LL.episode(world, model, { thr: thr, m: 2, n: 3 }, D.data[w].seed0 + i, { sh: SHc });
      if (ep.kDecide !== own[w][p].kd[j][i] || +ep.collision !== own[w][p].col[j][i] || Math.round((ep.sit.z0 - ep.sit.r) * 1000) !== D.data[w].zc[i] || LL.binOf(ep.sit.z0) !== own[w][p].bin[i]) mism++;
      hits += +ep.collision;
    }
    check(mism === 0, 'cell (' + w + ', ' + p + ', ' + code + ') re-run with the engine: ' + mism + ' of ' + nEp + ' episodes differ');
    check(near(hits / nEp, own[w][p].rate[j], 1e-12), 'the re-run cell has the stored collision rate');
  }
  // the program's own operating points: 10% false alarms on the world's own pedestrian-free validation frames, recomputed for one world with SV.score
  const wld = LL.programWorld('aaba'), val = SV.makeSet(wld.pipe, 800, SV.SEEDS.simVal).filter((s) => !s.y);
  for (let j = 0; j < M; j++) {
    const m = T.models['swap@' + SYS[j]], model = { dim: SV.DIM, w: m.w, mu: m.mu, sd: m.sd }, thr = +SV.thrAtFPR(val.map((s) => SV.score(model, s.x).s), 0.1).toPrecision(5);
    check(thr === D.data.aaba.thr.W[j], 'the operating point of ' + SYS[j] + ' inside the camera-repaired program: ' + thr + ' vs ' + D.data.aaba.thr.W[j]);
  }
  // the naive program's own validation set gives the table's own threshold for its own detector (Lesson 2's thrOwn)
  check(D.data.aaaa.thr.W[jOf('aaaa')] === +T.models['swap@aaaa'].thrOwn.toPrecision(5) || near(D.data.aaaa.thr.W[jOf('aaaa')], T.models['swap@aaaa'].thrOwn, 0.002), 'the naive program\'s own threshold for its own detector is Lesson 2\'s thrOwn');
}
lap('cells');
put('n_cand', M, 0); put('n_worlds', WORLDS.length, 0); put('np', D.cfg.np, 0); put('ns', D.cfg.ns, 0);
put('d_stop', dStop, 1);

/* ═════════════ 4 · the program as an evaluator: five evaluators against the street (a LAB PRIVILEGE) ═════════════ */
const exam = SYS.map((c) => T.swap[c].realMiss[0]);
const evals = { exam: { col: exam, mg: exam.map((x) => -x) } };
for (const w of PROGS) evals[w] = { col: own[w].S.rate, mg: own[w].S.margin };
const streetRate = ST.rate, streetMargin = ST.margin, best = streetRate.indexOf(Math.min(...streetRate));
put('best_code_is_bbba', SYS[best] === 'bbba' ? 1 : 0, 0);
put('street_best', pc(streetRate[best]), 1); put('street_worst', pc(Math.max(...streetRate)), 1);
for (const e of E.EVALS) {
  const v = evals[e], rho = rhoOf(v.col, streetRate), tau = tauOf(v.col, streetRate), rhoM = rhoOf(v.mg, streetMargin);
  check(near(E.spearman(v.col, streetRate), rho, 1e-12) && near(E.kendallB(v.col, streetRate), tau, 1e-12), 'the engine ranks as the oracle does (' + e + ')');
  put('rho_' + e, rho, 2); put('tau_' + e, tau, 2); put('rhom_' + e, rhoM, 2);
  const pick = v.col.indexOf(Math.min(...v.col)); put('pick_rate_' + e, pc(streetRate[pick]), 1); put('regret_' + e, pc(streetRate[pick] - streetRate[best]), 1);
  if (e !== 'exam') { const gaps = v.col.map((x, j) => x - streetRate[j]); put('offset_' + e, pc(mean(gaps)), 1); put('mae_' + e, pc(mean(gaps.map(Math.abs))), 1); put('ratio_lo_' + e, Math.min(...v.col.map((x, j) => x / streetRate[j])), 2); put('ratio_hi_' + e, Math.max(...v.col.map((x, j) => x / streetRate[j])), 2); }
}
{ // the sampling spread of rho: both sides resampled (episodes drawn with replacement), 300 repeats, own generator
  const rngB = SV.rng(31337);
  const resample = (pool) => { const n = pool.n, idx = Array.from({ length: n }, () => Math.floor(rngB() * n)); return pool.col.map((row) => { let k = 0; for (let i = 0; i < n; i++) k += row[idx[i]]; return k / n; }); };
  for (const w of PROGS) { const a = [], b = []; for (let r = 0; r < 300; r++) { const x = resample(own[w].S), y = resample(ST); a.push(rhoOf(x, y)); b.push(tauOf(x, y)); } put('rho_sd_' + w, sdev(a), 2); put('rho_bs_' + w, mean(a), 2); put('tau_sd_' + w, sdev(b), 2); }
}
put('exam_lo', pc(Math.min(...exam)), 1); put('exam_hi', pc(Math.max(...exam)), 1);
put('exam_rho_margin', rhoOf(exam.map((x) => -x), streetMargin), 2);
{ // leaving out the one candidate a world's own program trained: how much does rho move?
  let worst = 0;
  for (const w of PROGS) { const keep = SYS.map((c, j) => j).filter((j) => SYS[j] !== w); worst = Math.max(worst, Math.abs(rhoOf(keep.map((j) => evals[w].col[j]), keep.map((j) => streetRate[j])) - rhoOf(evals[w].col, streetRate))); }
  put('home_max_delta', worst, 2); check(worst < 0.06, 'dropping the candidate a world trained moves rho by at most 0.06 (' + worst + ')');
}
{ // the road not taken: the exam's rule applied inside the program (protocol W)
  for (const w of PROGS) { const v = own[w].W; put('w_rho_' + w, rhoOf(v.rate, streetRate), 2); put('w_min_' + w, pc(Math.min(...v.rate)), 1); put('w_max_' + w, pc(Math.max(...v.rate)), 1); put('w_rhom_' + w, rhoOf(v.margin, streetMargin), 2); }
  const rngB = SV.rng(41414), a = [];
  for (let r = 0; r < 300; r++) { const pool = own.aaaa.W, n = pool.n, idx = Array.from({ length: n }, () => Math.floor(rngB() * n)), x = pool.col.map((row) => { let k = 0; for (let i = 0; i < n; i++) k += row[idx[i]]; return k / n; }), p2 = ST, n2 = p2.n, i2 = Array.from({ length: n2 }, () => Math.floor(rngB() * n2)), y = p2.col.map((row) => { let k = 0; for (let i = 0; i < n2; i++) k += row[i2[i]]; return k / n2; }); a.push(rhoOf(x, y)); }
  put('w_rho_sd_aaaa', sdev(a), 2); check(mean(a) < -0.2 && sdev(a) < 0.25, 'under the program\'s own operating points the naive world ranks against the street (' + mean(a).toFixed(2) + ')');
  check(F.w_max_aaaa < 6 && F.w_rho_aaaa < 0, 'every candidate looks safe in the naive world under its own operating point');
}
lap('evaluators');

/* ═════════════ 5 · simulated real campaigns: the cost of validating an evaluator ═════════════ */
const R = 400, SEED = 22700000, R_FINE = 4000, SEED_FINE = 23700000;
function campaignStats(poolOwn, n, evList, useMargin, Rn, seed0) {   // own draw scheme: repeat r seeds SV.rng(seed0 + r); candidate after candidate, n draws each, one index per draw for the collision and the margin
  const RR = Rn || R, S0 = seed0 === undefined ? SEED : seed0, out = {}; for (const e of evList) out[e] = { rho: [], hit: 0 };
  for (let r = 0; r < RR; r++) {
    const rng = SV.rng(S0 + r), rate = [], marg = [];
    for (let j = 0; j < M; j++) { let k = 0, s = 0; for (let i = 0; i < n; i++) { const q = Math.floor(rng() * poolOwn.n); k += poolOwn.col[j][q]; s += poolOwn.mg[j][q]; } rate.push(k / n); marg.push(s / n); }
    const est = useMargin ? marg : rate, bestEst = useMargin ? marg.map((x) => -x) : rate;
    for (const e of evList) {
      out[e].rho.push(rhoOf(useMargin ? evals[e].mg : evals[e].col, est));
      const j = bestEst.indexOf(Math.min(...bestEst)); if (poolOwn.rate[j] - Math.min(...poolOwn.rate) <= 0.01 + 1e-12) out[e].hit++;
    }
  }
  for (const e of evList) { const rho = out[e].rho; out[e] = { mean: mean(rho), p90: rho.filter((x) => x > 0.9).length / RR, hit: out[e].hit / RR, rho }; }
  return out;
}
const GRIDN = [10, 20, 40, 80, 160, 320, 640, 1280, 2560];
const VAL = {};
for (const n of GRIDN) { VAL[n] = { col: campaignStats(ST, n, E.EVALS, false), mg: campaignStats(ST, n, E.EVALS, true) }; }
{ // the engine's campaigns equal the oracle's
  const pool = E.pool('street', 'S');
  for (const n of [80, 640]) for (const e of ['bbba', 'aaba', 'exam']) for (const useMargin of [false, true]) {
    const v = E.validate(pool, E.evaluator(e), n, R, useMargin), o = VAL[n][useMargin ? 'mg' : 'col'][e];
    check(near(v.mean, o.mean, 1e-9) && near(v.p90, o.p90, 1e-12) && near(v.hit, o.hit, 1e-12), 'the engine\'s campaigns equal the oracle\'s (' + [e, n, useMargin] + '): ' + v.mean + ' vs ' + o.mean);
  }
}
for (const n of [20, 80, 160, 320, 640, 1280, 2560]) {
  put('vb_mean_' + n, VAL[n].col.bbba.mean, 2); put('vb_p90_' + n, VAL[n].col.bbba.p90, 2); put('vb_hit_' + n, VAL[n].col.bbba.hit, 2);
  put('va_p90_' + n, VAL[n].col.abba.p90, 2); put('vn_p90_' + n, VAL[n].col.aaaa.p90, 2); put('vn_mean_' + n, VAL[n].col.aaaa.mean, 2); put('vc_p90_' + n, VAL[n].col.aaba.p90, 2);
  put('vm_mean_' + n, VAL[n].mg.bbba.mean, 2); put('vm_p90_' + n, VAL[n].mg.bbba.p90, 2); put('vx_mean_' + n, VAL[n].col.exam.mean, 2); put('vx_p90_' + n, VAL[n].col.exam.p90, 2); put('vmn_p90_' + n, VAL[n].mg.aaaa.p90, 2);
}
{ // checks of the simulation itself: the draws are unbiased and binomial
  const n = 160, j = jOf('bbba'), est = []; for (let r = 0; r < 2000; r++) { const rng = SV.rng(SEED + 100000 + r); let k = 0; for (let i = 0; i < n; i++) k += ST.col[j][Math.floor(rng() * ST.n)]; est.push(k / n); }
  const p = ST.rate[j]; check(near(mean(est), p, 0.004) && rel(sdev(est), Math.sqrt(p * (1 - p) / n)) < 0.06, 'a simulated campaign estimates the street\'s rate without bias, with the binomial spread (' + mean(est).toFixed(4) + ' vs ' + p.toFixed(4) + '; ' + sdev(est).toFixed(4) + ' vs ' + Math.sqrt(p * (1 - p) / n).toFixed(4) + ')');
  put('se_160_pts', pc(Math.sqrt(p * (1 - p) / 160)), 1);
}
/* the price of the validation: the number of episodes per candidate at which the chance of an agreement above 0.9 (or of picking a best candidate) reaches 0.9, by 4,000 campaigns per setting, interpolated between steps of 20 */
const crossing = (stat, from, step, to) => { let prev = null; for (let n = from; n <= to; n += step) { const v = stat(n); if (v >= 0.9) return prev === null ? n : prev.n + (0.9 - prev.v) / (v - prev.v) * step; prev = { n, v }; } return Infinity; };
const fineAt = (n, useMargin, key) => campaignStats(ST, n, ['bbba'], useMargin, R_FINE, SEED_FINE).bbba[key];
const nstar = crossing((n) => fineAt(n, false, 'p90'), 20, 20, 2560), nstarM = crossing((n) => fineAt(n, true, 'p90'), 20, 20, 2560), nstarHit = crossing((n) => fineAt(n, false, 'hit'), 20, 20, 2560), nstarHitM = crossing((n) => fineAt(n, true, 'hit'), 20, 20, 2560);
const nstarA = nstar;
const R50 = (x) => Math.round(x / 50) * 50, R10 = (x) => Math.round(x / 10) * 10;
put('nstar', nstar, 0); put('nstar_r', R50(nstar), 0); put('nstar_m', nstarM, 0); put('nstar_m_r', R10(nstarM), 0); put('nstar_hit', nstarHit, 0); put('nstar_hit_r', R10(nstarHit), 0);
put('nstar_total', M * R50(nstar), 0); put('nstar_m_total', M * R10(nstarM), 0);
check(nstar > 320 && nstar < 640 && Math.abs(R50(nstar) - nstar) < 20, 'the validation price is between 320 and 640 episodes per candidate and sits clear of a rounding edge (' + nstar.toFixed(1) + ')');
check(nstarM < nstar && nstarHit < nstar && Math.abs(R10(nstarM) - nstarM) < 3.5, 'the margin and the best-candidate question are cheaper than the whole ranking (' + nstarM.toFixed(1) + ', ' + nstarHit.toFixed(1) + ')');
check(Math.max(...GRIDN.map((n) => VAL[n].col.aaaa.p90)) < 0.5 && Math.max(...GRIDN.map((n) => VAL[n].col.aaba.p90)) < 0.5, 'a naive or camera-only evaluator is never confirmed above 0.9 with probability 0.9 by collisions');
put('naive_max_p90', Math.max(...GRIDN.map((n) => VAL[n].col.aaaa.p90)), 2); put('camera_max_p90', Math.max(...GRIDN.map((n) => VAL[n].col.aaba.p90)), 2);
put('exam_mean_1280', VAL[1280].col.exam.mean, 2);
{ // real episodes alone: a campaign's estimates of the twelve rates against the street's own twelve rates (the evaluator is the street itself)
  evals.street = { col: streetRate, mg: streetMargin };
  for (const n of [160, 1280]) { const d = campaignStats(ST, n, ['street'], false).street; put('direct_mean_' + n, d.mean, 2); put('direct_p90_' + n, d.p90, 2); }
}
{ // a failure ten times rarer: every candidate's collision probability divided by ten (binomial draws, the same scheme); the price of the validation
  const streetP = ST.rate, ev = evals.bbba.col;
  const p90Rare = (n, scale) => { let ok = 0; for (let r = 0; r < R_FINE; r++) { const rng = SV.rng(SEED_FINE + 5000000 + r), est = []; for (let j = 0; j < M; j++) { const q = streetP[j] * scale; let k = 0; for (let i = 0; i < n; i++) if (rng() < q) k++; est.push(k / n); } if (rhoOf(ev, est) > 0.9) ok++; } return ok / R_FINE; };
  const n1 = crossing((n) => p90Rare(n, 1), 300, 40, 700);
  const nr = crossing((n) => p90Rare(n, 0.1), 3000, 1000, 12000);
  put('nstar_rare', nr, 0); put('nstar_rare_r', Math.round(nr / 1000) * 1000, 0); put('nstar_param', n1, 0); put('rare_ratio', nr / n1, 0); put('rare_ratio_r', Math.round(nr / 1000) * 1000 / R50(nstar), 0);
  check(Math.abs(Math.round(nr / 1000) * 1000 - nr) < 450, 'the price for a rarer failure sits clear of a rounding edge (' + nr.toFixed(0) + ')');
  check(nr / n1 > 9 && nr / n1 < 18, 'a failure ten times rarer costs about ten to fifteen times the episodes (' + (nr / n1).toFixed(1) + ')');
  check(Math.abs(n1 - nstar) <= 40, 'binomial draws and bootstrap draws give the same price at the current rarity (' + n1.toFixed(0) + ' vs ' + nstar.toFixed(0) + ')');
}
lap('campaigns');

/* ═════════════ 6 · why the program cannot stand in for the trials ═════════════ */
{
  const j = jOf('bbba'), p = ST.rate[j], psim = own.bbba.S.rate[j];
  put('p_street_bbba', pc(p), 1); put('p_sim_bbba', pc(psim), 1); put('gap_bbba', pc(psim - p), 1);
  const widths = {};
  for (const n of [25, 100, 400, 1600, 6400]) {
    const hw = []; for (let r = 0; r < R; r++) { const rng = SV.rng(22800000 + r); let k = 0; for (let i = 0; i < n; i++) k += ST.col[j][Math.floor(rng() * ST.n)]; hw.push((upperBeta(k, n, 0.025) - lowerBeta(k, n, 0.025)) / 2); }
    const f = 1.96 * Math.sqrt(p * (1 - p) / n); widths[n] = [mean(hw), f];
    put('hw_' + n, pc(mean(hw)), n === 6400 ? 2 : 1); put('hwf_' + n, pc(f), n === 6400 ? 2 : 1);
    check(rel(mean(hw), f) < 0.1, 'simulated half-width of the interval for p - p_sim near the formula at n = ' + n);
  }
  check(near(widths[100][0] / widths[400][0], 2, 0.15) && near(widths[400][0] / widths[1600][0], 2, 0.15) && near(widths[1600][0] / widths[6400][0], 2, 0.15), 'each factor 4 in n halves the width');
  for (const d of [0.05, 0.02, 0.01]) put('n_delta_' + Math.round(d * 100), 1.96 * 1.96 * p * (1 - p) / (d * d), 0);
  const gap = Math.abs(psim - p); put('n_gap_all', 1.96 * 1.96 * p * (1 - p) / (gap * gap), 0);
  // the closest band and the farthest band: where the program is far off, and where it says zero
  const P = D.pbin;
  const bandRate = (o, h) => { let k = 0, c = 0; for (let i = 0; i < o.n; i++) if (o.bin[i] === h) { c++; k += o.col[j][i]; } return [k / c, c, k]; };
  const bR = bandRate(own.bbba.S, 0), sR = bandRate(ST, 0), bF = bandRate(own.bbba.S, 3), sF = bandRate(ST, 3);
  put('p_sim_R', pc(bR[0]), 1); put('p_str_R', pc(sR[0]), 1); put('gap_R', pc(bR[0] - sR[0]), 1);
  put('n_gap_R', 1.96 * 1.96 * sR[0] * (1 - sR[0]) / ((bR[0] - sR[0]) ** 2), 0); put('n_gap_R_all', 1.96 * 1.96 * sR[0] * (1 - sR[0]) / ((bR[0] - sR[0]) ** 2) / P[0], 0);
  put('p_sim_far', pc(bF[0]), 1); put('p_str_far', pc(sF[0]), 1); put('n_far_sim', bF[1], 0); put('k_far_sim', bF[2], 0);
  check(bF[2] === 0, 'the program draws no collision in the farthest band');
  put('far_str_hi', pc(upperBeta(sF[2], sF[1], 0.025)), 1);
  // the assumption that would let a program estimate certify: p <= k p_sim; its test costs 3 / (k p_sim) trials, at least 3 / eps when k p_sim <= eps
  const eps = 1e-3, psimRare = eps / 10, k = 3, nTest = smallestN(k * psimRare, 0);
  put('k_assume', k, 0); put('n_test_k3', nTest, 0); put('n_test_ratio', nTest / NT[eps].n0, 1);
  check(nTest >= NT[eps].n0 && near(nTest / NT[eps].n0, 10 / 3, 0.02), 'testing p <= 0.3 eps costs 10 / eps, more than the 3 / eps of proving p <= eps');
  put('r_far_zero', 0, 0);
}
lap('program vs street');

/* ═════════════ 7 · aiming: where the collisions are, and what allocating trials by the program's map buys and costs ═════════════ */
{
  const P = D.pbin, j = jOf('bbba');
  { // the strata's natural probabilities, recomputed from 10^6 scene draws of the street with another seed block
    const q = LL.binProbs(LL.streetWorld(), 1000000, 29000000); for (let h = 0; h < 4; h++) check(near(q[h], P[h], 0.002), 'stratum ' + h + ' probability ' + q[h] + ' vs ' + P[h]); check(near(P.reduce((a, b) => a + b, 0), 1, 1e-4), 'the strata probabilities sum to one');
  }
  const bandP = (o) => [0, 1, 2, 3].map((h) => { let k = 0, c = 0; for (let i = 0; i < o.n; i++) if (o.bin[i] === h) { c++; k += o.col[j][i]; } return k / c; });
  const pr = bandP(own.bbba.S), ps = bandP(ST);
  for (let h = 0; h < 4; h++) { put('P_' + h, pc(P[h]), 1); put('pr_' + h, pc(pr[h]), 1); put('ps_' + h, pc(ps[h]), 1); }
  const tot = P.reduce((a, x, h) => a + x * ps[h], 0); put('p_all', pc(tot), 1);
  for (let h = 0; h < 4; h++) put('cs_' + h, pc(P[h] * ps[h] / tot), 0);
  put('cs_near2', pc((P[0] * ps[0] + P[1] * ps[1]) / tot), 0); put('P_near2', pc(P[0] + P[1]), 0);
  const v = (p) => p * (1 - p), vSRS = tot * (1 - tot), vProp = P.reduce((a, x, h) => a + x * v(ps[h]), 0), sN = P.reduce((a, x, h) => a + x * Math.sqrt(v(ps[h])), 0), vNey = sN * sN;
  check(near(E.varSRS(P, ps), vSRS, 1e-12) && near(E.varProp(P, ps), vProp, 1e-12) && near(E.varNeyman(P, ps), vNey, 1e-12), 'the engine\'s variances are the oracle\'s');
  put('v_srs', vSRS, 4); put('v_prop', vProp, 4); put('v_ney', vNey, 4);
  put('var_ratio_prop', vSRS / vProp, 2); put('var_ratio_ney', vSRS / vNey, 2);
  // the allocation by the program's predicted risks, floored at a fraction lam of the natural shares
  const lam = 0.2, sp = P.reduce((a, x, h) => a + x * Math.sqrt(v(pr[h])), 0), w = P.map((x, h) => (1 - lam) * x * Math.sqrt(v(pr[h])) / sp + lam * x);
  check(E.alloc(P, pr, lam).every((x, h) => near(x, w[h], 1e-12)), 'the engine\'s allocation is the oracle\'s');
  const vAim = P.reduce((a, x, h) => a + x * x * v(ps[h]) / w[h], 0); put('lam', lam, 1);
  for (let h = 0; h < 4; h++) put('w_' + h, pc(w[h]), 1);
  put('var_ratio_aim', vSRS / vAim, 2); put('yield_nat', 100 * tot, 1); put('yield_aim', 100 * w.reduce((a, x, h) => a + x * ps[h], 0), 1); put('yield_ratio', w.reduce((a, x, h) => a + x * ps[h], 0) / tot, 2);
  { // the allocation with no floor puts nothing in the stratum the program calls safe: its variance is infinite
    const w0 = P.map((x, h) => x * Math.sqrt(v(pr[h])) / sp); check(w0[3] === 0 && pr[3] === 0, 'with no floor the farthest stratum gets no trial: the program says zero collisions there');
  }
  // simulation of the three designs at n = 400: bootstrap within strata from the street's stored episodes, 4,000 repeats
  const n = 400, byBin = [0, 1, 2, 3].map((h) => { const ix = []; for (let i = 0; i < ST.n; i++) if (ST.bin[i] === h) ix.push(i); return ix; });
  const sim = (alloc, seed0) => { const est = []; for (let r = 0; r < 4000; r++) { const rng = SV.rng(seed0 + r); let e = 0; for (let h = 0; h < 4; h++) { const nh = Math.max(1, Math.round(n * alloc[h])); let k = 0; for (let i = 0; i < nh; i++) k += ST.col[j][byBin[h][Math.floor(rng() * byBin[h].length)]]; e += P[h] * k / nh; } est.push(e); } return sdev(est); };
  const sdProp = sim(P, 22900000), sdAim = sim(w, 22910000);
  const srsEst = []; for (let r = 0; r < 4000; r++) { const rng = SV.rng(22920000 + r); let k = 0; for (let i = 0; i < n; i++) k += ST.col[j][Math.floor(rng() * ST.n)]; srsEst.push(k / n); }
  const sdSRS = sdev(srsEst);
  put('sd_srs', pc(sdSRS), 2); put('sd_prop', pc(sdProp), 2); put('sd_aim', pc(sdAim), 2);
  check(rel(sdSRS, Math.sqrt(vSRS / n)) < 0.05 && rel(sdProp, Math.sqrt(vProp / n)) < 0.05 && rel(sdAim, Math.sqrt(vAim / n)) < 0.05, 'the simulated spreads of the three designs match the formulas (' + [sdSRS, sdProp, sdAim].map((x) => x.toFixed(4)).join(' ') + ' vs ' + [vSRS, vProp, vAim].map((x) => Math.sqrt(x / n).toFixed(4)).join(' ') + ')');
  put('th_sd_srs', pc(Math.sqrt(vSRS / n)), 2); put('th_sd_prop', pc(Math.sqrt(vProp / n)), 2); put('th_sd_aim', pc(Math.sqrt(vAim / n)), 2);
  put('sd_ratio_sim', (sdSRS / sdAim) ** 2, 2);
  { // the zero-failure bound under an allocation: sup of sum P_h p_h over the p whose chance of no failure is at least 5%: a Lagrangian solve, checked by random search
    const c = -Math.log(0.05);
    const zeroBound = (nh) => { const mx = Math.max(...P.map((x, h) => x / nh[h])); let lo = 0, hi = mx; for (let it = 0; it < 200; it++) { const mu = (lo + hi) / 2, s = nh.reduce((a, x, h) => a + x * Math.max(0, Math.log(P[h] / (mu * x))), 0); if (s > c) lo = mu; else hi = mu; } const mu = (lo + hi) / 2; return P.reduce((a, x, h) => a + x * (1 - Math.exp(-Math.max(0, Math.log(x / (mu * nh[h]))))), 0); };
    const nProof = NT[1e-3].n0, nat = P.map((x) => nProof * x), aimed = w.map((x) => nProof * x);
    const bNat = zeroBound(nat), bAim = zeroBound(aimed);
    check(near(bNat, 1 - Math.pow(0.05, 1 / nProof), 1e-9), 'with the natural allocation the stratified zero-failure bound is the unstratified one');
    const rngS = SV.rng(777); let bestRand = 0;
    for (let t = 0; t < 200000; t++) { const wt = P.map(() => (rngS() < 0.3 ? 0 : -Math.log(1 - rngS()))); if (wt.every((x) => x === 0)) continue; const s = aimed.reduce((a, x, h) => a + x * wt[h], 0), q = wt.map((x) => c * x / s); bestRand = Math.max(bestRand, P.reduce((a, x, h) => a + x * (1 - Math.exp(-q[h])), 0)); }
    check(bestRand <= bAim * (1 + 1e-9) && bestRand > bAim * 0.97, 'the Lagrangian bound for the aimed allocation is the maximum of a random search (' + bestRand + ' vs ' + bAim + ')');
    put('zb_nat_pct', pc(bNat), 3); put('zb_aim_pct', pc(bAim), 3); put('zb_ratio', bAim / bNat, 1);
    check(near(bAim / bNat, 1 / lam, 0.25), 'the aimed allocation makes the proof about 1/lam times looser');
    put('zb_n_aim', Math.ceil(NT[1e-3].n0 * bAim / bNat), 0);
    put('zb_nat_n', nProof, 0);
  }
}
lap('aiming');

/* ═════════════ 8 · the ledger ═════════════ */
{
  // Lesson 2's prices: the Shapley decomposition of the 33-point gap over the sixteen programs (three-seed means), recomputed here
  const miss = (code) => mean(T.swap[code].realMiss), stages = ['scene', 'light', 'camera', 'label'], sh = {}; stages.forEach((s) => { sh[s] = 0; });
  const perms = []; (function rec(a, rest) { if (!rest.length) { perms.push(a); return; } rest.forEach((x, i) => rec(a.concat(x), rest.filter((_, k) => k !== i))); })([], stages);
  perms.forEach((p) => { const S = new Set(); let prev = miss('aaaa'); p.forEach((s) => { S.add(s); const cur = miss(stages.map((q) => (S.has(q) ? 'b' : 'a')).join('')); sh[s] += prev - cur; prev = cur; }); });
  put('price_camera', pc(sh.camera / 24), 1); put('price_light', pc(sh.light / 24), 1); put('price_scene', pc(sh.scene / 24), 1); put('price_label', pc(sh.label / 24), 1);
  put('gap_total', pc(miss('aaaa') - miss('bbbb')), 1);
  check(near(F.price_camera, 16.3, 0.05) && near(F.price_light, 8.5, 0.05) && near(F.price_scene, 8.4, 0.05) && near(F.price_label, -0.1, 0.05), 'Lesson 2\'s prices: camera 16.3, light 8.5, scene 8.4, label -0.1');
  // real observations: the bench kit of Lesson 3 (flats, one edge shot, exposure log), the logs of Lesson 4, the labelled budget of Lesson 10
  const kit = L3.kit(1, 140), flats = kit.flats.reduce((s, f) => s + f.frames.length, 0), edges = kit.edges.length, logsKit = kit.logs.length;
  put('kit_flats', flats, 0); put('kit_edges', edges, 0); put('kit_logs', logsKit, 0); put('kit_frames', flats + edges + logsKit, 0);
  const D10 = SV.L10, GRID = [0].concat(D10.protocol.M), KINDS = ['R', 'F', 'C', 'CF'];
  const MEAN = {}; KINDS.forEach((k) => { MEAN[k] = GRID.map((Mg) => { const c = D10.cells[k][Mg]; return c ? mean(c.realMiss) : NaN; }); });
  const policy = (Mt) => { if (Mt <= 0) return MEAN.C[0]; let b = Infinity; KINDS.forEach((k) => { b = Math.min(b, L10.interp(GRID.slice(1), MEAN[k].slice(1), Mt)); }); return b; };
  const bs = L10.bestSplit(policy, 400, D10.grade.ppf, GRID.slice(1));
  put('l10_train', bs.train, 0); put('l10_grade', bs.grade, 0); put('l10_miss', pc(bs.p), 1); put('l10_bound', pc(bs.bound), 1); put('l10_naive', pc(mean(T.swap.aaaa.realMiss)), 1);
  put('l10_budget', 400, 0);
  const logsN = 1000, benchN = F.kit_frames, labN = 400, nVal = M * F.nstar_r, nProof = NT[1e-3].n0, frames = benchN + logsN, ep = nVal + nProof, all = frames + labN + ep;
  put('led_frames', frames, 0); put('led_lab', labN, 0); put('led_val', nVal, 0); put('led_proof', nProof, 0); put('led_ep', ep, 0); put('led_all', all, 0); put('led_share', pc(ep / all), 0);
  put('led_logs', logsN, 0); put('led_bench_afternoons', 1, 0);
  // ten times rarer: the proof needs ten times the trials, the validation the measured multiple; the frames do not change
  const nProofR = NT[1e-4].n0, nValR = M * F.nstar_rare_r, epR = nProofR + nValR, allR = frames + labN + epR;
  put('led_proof_r', nProofR, 0); put('led_val_r', nValR, 0); put('led_ep_r', epR, 0); put('led_all_r', allR, 0); put('led_share_r', pc(epR / allR), 0);
  put('led_ep_ratio', epR / ep, 0); put('led_frames_ratio', 1, 0);
  // hours at one step-out per ten hours (an assumption): the episodes of both lines, and the same for the rarer failure
  put('led_hours_T10', ep * 10, 0); put('led_years_T10', ep * 10 / HY, 1); put('led_cross_inv_r', Math.round(1 / (1 - Math.pow(0.05, 1 / nVal)) / 100) * 100, 0); put('led_cross_inv', 1 / (1 - Math.pow(0.05, 1 / nVal)), 0); put('led_hours_r_T10', epR * 10, 0); put('led_years_r_T10', epR * 10 / HY, 0);
  put('led_val_hours_T10', nVal * 10, 0); put('led_proof_hours_T10', nProof * 10, 0);
  put('led_val_over_proof', nVal / nProof, 1);
  check(nVal > nProof && F.led_share > 80 && F.led_share_r > F.led_share && F.led_share_r > 95, 'the validation line is the largest at 1e-3, step-outs are over 80% of the real observations, over 95% at 1e-4');
  put('led_lab_frames', labN + logsN + benchN, 0);
}
lap('ledger');

/* ═════════════ 9 · the widget, driven through the states the prose names ═════════════ */
const PAGE_FILE = path.join(root, dir, '12_proof.html');
const fmtInt = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtP = (p) => { const q = 100 * p; return (q >= 10 ? q.toFixed(0) : q >= 1 ? q.toFixed(1) : q >= 0.01 ? q.toFixed(2) : q.toExponential(1)) + '%'; };
const fmtDur = (h) => (h < 100 ? Math.round(h) + ' h' : h < 17520 ? fmtInt(h / 24) + ' days' : (h / 8760).toFixed(1) + ' years');
const GRID = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 10000, 30000, 100000];
if (fs.existsSync(PAGE_FILE)) {
  const page = loadPage(PAGE_FILE, { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const WK = { exam: 'x', aaaa: 'n', aaba: 'c', abba: 'l', bbba: 'b' };
  const states = [[8, 0, 10, 'bbba', 'col'], [9, 0, 10, 'bbba', 'col'], [10, 0, 100, 'bbba', 'col'], [5, 0, 10, 'bbba', 'col'], [5, 1, 10, 'bbba', 'col'], [5, 3, 10, 'bbba', 'col'], [4, 0, 1, 'bbba', 'col'], [4, 0, 10, 'bbba', 'mg'], [6, 0, 10, 'bbba', 'col'], [6, 0, 10, 'aaaa', 'col'], [6, 0, 10, 'aaba', 'col'], [6, 0, 10, 'abba', 'col'], [6, 0, 10, 'exam', 'col'], [6, 0, 10, 'aaaa', 'mg'], [4, 0, 10, 'bbba', 'col'], [7, 0, 10, 'bbba', 'col'], [11, 0, 100, 'bbba', 'col'], [2, 0, 10, 'bbba', 'col'], [0, 0, 10, 'bbba', 'col']];
  const wf = {};
  for (const [gi, f, Th, world, stat] of states) {
    page.el('w12-n').value = String(gi); page.el('w12-f').value = String(f); page.el('w12-T').value = String(Th); page.el('w12-world').value = world; page.set('w12-stat', stat);
    const n = GRID[gi], nB = Math.min(n, 2560), bound = upperBeta(f, n, 0.05), tag = [gi, f, Th, world, stat].join('/');
    check(page.text('w12-n-v') === fmtInt(n), 'widget ' + tag + ': n "' + page.text('w12-n-v') + '"');
    check(page.text('w12-m1') === fmtP(bound), 'widget ' + tag + ': bound "' + page.text('w12-m1') + '" vs ' + fmtP(bound));
    check(page.text('w12-m2') === fmtP(3 / n), 'widget ' + tag + ': rule of three "' + page.text('w12-m2') + '"');
    check(page.text('w12-m3') === fmtInt(n * Th) + ' h' && page.text('w12-m4') === fmtDur(n * Th), 'widget ' + tag + ': hours "' + page.text('w12-m3') + '" / "' + page.text('w12-m4') + '"');
    const o = (nB in VAL ? VAL[nB] : null);
    if (!o) fail('no campaign table for n = ' + nB);
    else {
      const v = o[stat][world]; check(near(page.num('w12-m5'), v.mean, 0.0051) && near(page.num('w12-m6'), v.p90, 0.0051) && near(page.num('w12-m7'), v.hit, 0.0051), 'widget ' + tag + ': agreement "' + [page.text('w12-m5'), page.text('w12-m6'), page.text('w12-m7')] + '" vs ' + [v.mean, v.p90, v.hit].map((x) => x.toFixed(3)));
      const own9 = stat === 'mg' ? rhoOf(evals[world].mg, streetMargin) : rhoOf(evals[world].col, streetRate);
      check(near(page.num('w12-m9'), own9, 0.0051) && page.text('w12-m8') === fmtInt(M * nB), 'widget ' + tag + ': all-data agreement "' + page.text('w12-m9') + '" vs ' + own9.toFixed(3) + ', episodes "' + page.text('w12-m8') + '"');
      wf[tag] = { bound, v };
    }
  }
  put('w_bound_2560', pc(upperBeta(0, 2560, 0.05)), 2); put('w_rule_2560', pc(3 / 2560), 2);
  put('w_bound_10000', pc(upperBeta(0, 10000, 0.05)), 3); put('w_hours_10000_T10', 100000, 0); put('w_years_10000_T10', 100000 / HY, 1);
  put('w_bound_320_f0', pc(upperBeta(0, 320, 0.05)), 2); put('w_bound_320_f1', pc(upperBeta(1, 320, 0.05)), 2); put('w_bound_320_f3', pc(upperBeta(3, 320, 0.05)), 2);
  put('w_bound_100000', pc(upperBeta(0, 100000, 0.05)), 4); put('w_hours_1e5_T100', 1e7, 0); put('w_years_1e5_T100', 1e7 / HY, 0);
  put('w_bound_10', pc(upperBeta(0, 10, 0.05)), 0);
  put('w_hours_2560_T10', 25600, 0); put('w_years_2560_T10', 25600 / HY, 1);
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}
lap('widget');

/* ═════════════ 10 · the checkpoint ═════════════ */
{
  const n = 600; put('ck_100', pc(1 - Math.pow(0.05, 1 / 100)), 2); put('ck_n', n, 0); put('ck_f0', pc(upperBeta(0, n, 0.05)), 3); put('ck_rule', pc(3 / n), 1); put('ck_f1', pc(upperBeta(1, n, 0.05)), 2); put('ck_n_f1', smallestN(0.01, 1), 0);
  put('ck_hours', 3000 * 20, 0); put('ck_years', 3000 * 20 / HY, 1); put('ck_n_e3', NT[1e-3].n0, 0);
  check(upperBeta(1, 600, 0.05) < 0.01 && smallestN(0.01, 1) < 600, 'one collision in 600 supports a claim of 1%');
}
put('seconds', (Date.now() - T0) / 1000, 0);
check(Date.now() - T0 < 175000, 'the oracle runs in under 175 s (' + Math.round((Date.now() - T0) / 1000) + ' s)');
if (bad) { console.error(bad + ' check(s) failed'); if (process.env.L12_FACTS) console.log(JSON.stringify({ facts: F })); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
