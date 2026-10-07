#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 04 (same scene, other pixels).
 *
 * Re-derives every number the lesson quotes, with its own code where the lesson's engine (l04_light.js) is the thing being tested:
 *   - label blindness: the same scene re-drawn under eight looks has the identical mask, label and area (own re-render through the lab's renderer, own comparison);
 *   - the cross-look matrix of l04_data.js, with one training re-run from scratch (own exam code); the camera's relative noise at two brightnesses from the noise law;
 *   - the contrast-to-noise ratio: an own implementation (direct 2-D convolution, own noise law), a Monte-Carlo check that it is the detectability of the lab's own camera (a matched filter on
 *     real noisy frames), the alarm threshold for a 576-cell frame by simulation, the recoverability line c0 (own bisection of a binned psychometric curve), the shares below it, and the two costs of
 *     dim frames (heavier alarm tail, hopeless positives) from the stored detectors;
 *   - the probes: an own re-implementation of the whole estimator (own linearisation, own medians, the three skies drawn by an own call of the renderer) compared with the engine, and both compared with
 *     the hidden look of the logs (LAB PRIVILEGE: SV.real.logs carries the look; SV.REAL.look is the truth the estimates are graded against), the error of the estimate against the amount of evidence
 *     over disjoint blocks of the logs, and two looks with the same road light and different pictures (what the road cannot separate);
 *   - the sweep, the group table (Shapley prices by enumerating the 24 orders), the estimated-range programs and the learning curves from l04_data.js; two cells of it recomputed from scratch;
 *   - the exact-stage cells used at the seams, from tables.js;
 *   - the widget, driven along its width slider, its evidence slider and its scene selector.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'evidence.js'));
require(path.join(root, dir, 'tables.js'));
const L = require(path.join(root, dir, 'l04_light.js'));
require(path.join(root, dir, 'l04_data.js'));
require(path.join(root, dir, 'l03_data.js'));                       // Lesson 3's recorded gains of its 1,000 program frames (its oracle recomputes them from the renderer)
const T = SV.TABLES, D = SV.L04;
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const T0 = Date.now(), tick = (m) => { if (process.env.SV_TICK) console.error('[t+' + ((Date.now() - T0) / 1000).toFixed(1) + 's] ' + m); };
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };
const pct = (x) => 100 * x;
const CAM = SV.CAM, W = CAM.W, H = CAM.H, HW = W * H;
const REAL = SV.REAL;                                                    // LAB PRIVILEGE below: the hidden street the estimates are graded against
const camera = { ideal: false, ev: 600, fw: 4000, read: 3, blur: 0.7, gamma: 2.2, bits: 8, ae: { target: 0.12, maxGain: 8 } };
const r5 = (x) => +Number(x).toPrecision(5);
const cellMean = (cell, f) => mean(cell[f]);

/* ───────────────────────────── 1 · the label does not see the light ───────────────────────────── */
tick('1 · the label does not see the light');
/* an own program of this lesson: SIM0's scene, the calibrated camera, SIM0's look with the brightness range given */
function progWith(lumRange) { const p = SV.hybrid(SV.SIM0, REAL, { scene: 'a', look: 'a', sensor: 'b', label: 'a' }); if (lumRange) p.look.lum = lumRange; return p; }
{
  const E = D.estimate, pipe = progWith(E.lum);
  let maxd = 0, nsc = 0, sameY = true, sameA = true;
  for (let sc = 0; sc < 8; sc++) {
    const seed = 3100 + sc, rs = () => SV.stream(seed, 'scene');
    const ref = SV.drawScene(pipe.scene, rs(), { ped: true }), covs = [];
    for (let k = 0; k < 8; k++) {
      const scene = SV.drawScene(pipe.scene, rs(), { ped: true }), look = SV.drawLook(pipe.look, scene, SV.stream(seed * 10 + k, 'look'));
      const ren = SV.render(scene, look), lab = SV.labels(ren.cov, pipe.label, scene, look);
      covs.push({ cov: ren.cov, y: lab.present, area: lab.area, lum: look.lum });
    }
    for (let k = 1; k < 8; k++) { for (let q = 0; q < HW; q++) maxd = Math.max(maxd, Math.abs(covs[k].cov[q] - covs[0].cov[q])); if (covs[k].y !== covs[0].y) sameY = false; if (covs[k].area !== covs[0].area) sameA = false; }
    check(new Set(covs.map((c) => c.lum.toFixed(4))).size === 8, 'eight different looks of scene ' + sc);
    nsc++;
  }
  check(maxd === 0 && sameY && sameA, 'the same scene under eight looks has one mask, one label, one area (max |mask difference| ' + maxd + ')');
  put('blind_scenes', nsc, 0); put('blind_looks', 8, 0); put('blind_maxdiff', maxd, 0);
}
put('st_lum_lo', REAL.look.lum[0], 2); put('st_lum_hi', REAL.look.lum[1], 0); put('st_ratio', REAL.look.lum[1] / REAL.look.lum[0], 1);
put('st_el_lo', REAL.look.sunEl[0], 0); put('st_el_hi', REAL.look.sunEl[1], 0); put('st_az', REAL.look.sunAz[1], 0);
{
  const logs = SV.evidence.logs(1000), g = logs.map((f) => f.gain).sort((a, b) => a - b);
  put('gain_lo', g[0], 1); put('gain_hi', g[g.length - 1], 0); put('gain_capped', pct(g.filter((v) => v >= 8 - 1e-9).length / g.length), 0);
}
/* the camera's noise law (Lesson 3): the relative noise of a pixel of radiance L is sqrt(ev L + read^2) / (ev L) */
{
  const rel = (Lr) => Math.sqrt(camera.ev * Lr + camera.read * camera.read) / (camera.ev * Lr);
  const Lb = 0.30, Ld = 0.30 * 0.15;                                      // a road pixel at brightness 1 and at brightness 0.15
  put('rel_bright', pct(rel(Lb)), 1); put('rel_dim', pct(rel(Ld)), 1); put('rel_ratio', rel(Ld) / rel(Lb), 1);
}

/* ───────────────────────────── 2 · the cross-look matrix ───────────────────────────── */
tick('2 · the cross-look matrix');
const XN = D.xlook.names;
XN.concat(['mixed']).forEach((tr) => XN.forEach((te) => put('xl_' + tr + '_' + te, pct(D.xlook[tr][te]), 1)));
{
  const bright = ['noon', 'low', 'against'];
  let off = 0; bright.forEach((a) => bright.forEach((b) => { if (a !== b) off = Math.max(off, D.xlook[a][b]); }));
  put('xl_off_bright', pct(off), 1);
  put('xl_dim_from_bright_min', pct(Math.min(...bright.map((a) => D.xlook[a].dim))), 1); put('xl_dim_from_bright_max', pct(Math.max(...bright.map((a) => D.xlook[a].dim))), 1);
  put('xl_pay', pct(D.xlook.mixed.dim - D.xlook.dim.dim), 1); put('xl_dim_off_max', pct(Math.max(D.xlook.dim.noon, D.xlook.dim.low, D.xlook.dim.against)), 1);
  check(F.xl_off_bright < 2 && F.xl_dim_from_bright_min > 8 && D.xlook.dim.dim < 0.08, 'the three bright looks are one look to the detector; the dim look is another');
}

/* one cell of the matrix again from scratch, with this file's own exam: train on the dim look (N = 800), grade on the noon look and on the dim look */
function xlookProg(nm) { const o = D.xlook.looks[nm], p = progWith(null); ['sunEl', 'sunAz', 'amb', 'lum'].forEach((k) => { p.look[k] = [o[k], o[k]]; }); return p; }
{
  const model0 = SV.train(SV.makeSet(xlookProg('dim'), D.protocol.xN, SV.SEEDS.train + 100000), { seed: 1 });
  const model = { dim: model0.dim, w: Array.from(model0.w, r5), mu: Array.from(model0.mu, r5), sd: Array.from(model0.sd, r5) };
  for (const te of ['noon', 'dim']) {
    const v = SV.makeSet(xlookProg(te), 800, SV.SEEDS.simVal), t = SV.makeSet(xlookProg(te), 1500, SV.SEEDS.simTest), score = (f) => SV.score(model, f.x).s;
    const neg = v.filter((f) => !f.y).map(score).sort((a, b) => a - b), thr = neg[Math.floor(0.9 * neg.length)];
    let hit = 0, tot = 0; t.forEach((f) => { if (f.y && f.area >= 6) { tot++; if (score(f) > thr) hit++; } });
    check(Math.abs((1 - hit / tot) - D.xlook.dim[te]) < 1e-4, 'cross-look cell dim -> ' + te + ': own ' + (1 - hit / tot).toFixed(4) + ' vs data ' + D.xlook.dim[te]);
  }
}

/* ───────────────────────────── 3 · where a nuisance stops being a nuisance ───────────────────────────── */
tick('3 · where a nuisance stops being a nuisance');
/* the contrast-to-noise ratio, own implementation: the picture with the pedestrian minus the same picture without him, convolved with the camera's PSF by a direct 2-D sum,
 * divided pixel by pixel by the noise sd of the blurred background (shot noise ev L plus read noise squared, over ev squared) */
function cnrOwn(scene, look) {
  const withP = SV.render(scene, look, { maps: false }).rad, noP = SV.render({ parts: scene.parts.filter((q) => q.cls !== 'ped') }, look, { maps: false }).rad;
  const sg = camera.blur, kh = Math.ceil(2.5 * sg), k1 = []; for (let u = -kh; u <= kh; u++) k1.push(Math.exp(-u * u / (2 * sg * sg)));
  const ks = k1.reduce((a, b) => a + b, 0), kk = (u, v) => k1[u + kh] * k1[v + kh] / (ks * ks);
  const blurPix = (img, c, i, j) => { let t = 0; for (let v = -kh; v <= kh; v++) for (let u = -kh; u <= kh; u++) t += kk(u, v) * img[c * HW + Math.min(H - 1, Math.max(0, j + v)) * W + Math.min(W - 1, Math.max(0, i + u))]; return t; };
  let s2 = 0;
  for (let c = 0; c < 3; c++) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const d = blurPix(withP, c, i, j) - blurPix(noP, c, i, j), bg = blurPix(noP, c, i, j);
    if (d !== 0) s2 += d * d / ((camera.ev * Math.max(bg, 0) + camera.read * camera.read) / (camera.ev * camera.ev));
  }
  return Math.sqrt(s2);
}
{
  const pipe = progWith(L.scaleRange(REAL.look.lum, 1, L.LIMITS.lum)); let worst = 0, n = 0;
  for (let i = 0; i < 12; i++) { const f = L.relight(pipe, 777000 + i, 777000 + i, 777000 + i, { ped: true }); if (!f.y) continue; const a = cnrOwn(f.scene, f.look), b = L.cnr(f); worst = Math.max(worst, Math.abs(a - b) / b); n++; }
  check(n >= 8 && worst < 1e-4, 'the engine\'s CNR equals the own direct-convolution CNR (worst relative difference ' + worst.toExponential(1) + ' over ' + n + ' frames)');
}
/* the CNR is the detectability of the lab's own camera: noisy frames of one scene with and without the pedestrian through SV.sense (fixed exposure, so that the gain cannot differ), linearised,
 * and the matched filter w = signal / variance; the empirical d' = (mean with - mean without) / sd without must equal the CNR.  Four fixed brightnesses, from the street's dimmest light to a bright one */
{
  const cam = Object.assign({}, camera, { ae: undefined });
  let worst = 0, shown = 0; const cn = [];
  for (const lumv of [0.02, 0.05, 0.12, 0.5]) {
    const pipe = progWith([lumv, lumv]);
    for (let i = 0; i < 40; i++) {
      const f = L.relight(pipe, 880000 + i, 880000 + i, 880000 + i, { ped: true }); if (!f.y || f.area < 6) continue;
      const rest = SV.render({ parts: f.scene.parts.filter((q) => q.cls !== 'ped') }, f.look, { maps: false }).rad, c = cnrOwn(f.scene, f.look);
      // the signal and its noise sd in radiance units, blurred as the camera blurs
      const blurred = (img) => L.blur(img, camera.blur), sig = blurred(Float32Array.from(f.rad, (v, q) => v - rest[q])), bgb = blurred(rest);
      const wgt = new Float64Array(3 * HW); for (let q = 0; q < 3 * HW; q++) wgt[q] = sig[q] / ((camera.ev * Math.max(bgb[q], 0) + camera.read * camera.read) / (camera.ev * camera.ev));
      const stat = (rad, rng) => { const x = SV.sense(rad, cam, rng); let t = 0; for (let q = 0; q < 3 * HW; q++) t += wgt[q] * (Math.pow(x[q], camera.gamma) * camera.fw / camera.ev - bgb[q]); return t; };
      const t0 = [], t1 = []; for (let r = 0; r < 300; r++) { t0.push(stat(rest, SV.rng(5 + r))); t1.push(stat(f.rad, SV.rng(9000 + r))); }
      const dp = (mean(t1) - mean(t0)) / sd(t0); worst = Math.max(worst, Math.abs(dp - c) / c); shown++; cn.push(c);
      break;
    }
  }
  check(shown === 4 && Math.min(...cn) > 2 && Math.max(...cn) < 60 && worst < 0.15, 'a matched filter on the lab\'s own noisy frames finds d\' within 15% of the CNR (worst ' + worst.toFixed(3) + ' over ' + shown + ' scenes, CNR ' + cn.map((v) => v.toFixed(1)).join(', ') + ')');
  put('cnr_mf_err', pct(worst), 0); put('cnr_mf_n', shown, 0);
}
/* the alarm threshold of a frame with K cells: simulate the maximum of K standard normals and find z with 10% of empty frames above it */
{
  const K = L.CELLS, rng = SV.rng(2024), z = L.Z, trials = 20000; let above = 0;
  for (let t = 0; t < trials; t++) { let mx = -Infinity; for (let k = 0; k < K; k++) { const v = SV.randn(rng); if (v > mx) mx = v; } if (mx > z) above++; }
  check(Math.abs(above / trials - 0.1) < 0.012, 'z = ' + z.toFixed(3) + ' lets ' + (above / trials).toFixed(3) + ' of empty frames of ' + K + ' cells alarm');
  put('cells', K, 0); put('z_alarm', z, 2); put('z_hit_half', pct(L.Phi(0)), 0);
  put('ideal_hit_at_8', pct(L.Phi(8 - z)), 0);
}
/* the recoverability line: the detector of the street's look (the table's abba, seed 1) on frames of its own program; own sliding-window crossing against the stored logistic fit */
const scaleR = (r, s, lim) => { const c = (r[0] + r[1]) / 2, a = c - s * (c - r[0]), b = c + s * (r[1] - c); return lim ? [Math.max(lim[0], a), Math.min(lim[1], b)] : [a, b]; };   // own scaling about the centre
function lumProg(s) { return progWith(scaleR(REAL.look.lum, s, L.LIMITS.lum)); }
function allProg(s) { const p = progWith(null), lim = L.LIMITS; p.look = SV.clone(REAL.look); ['sunEl', 'sunAz', 'amb', 'lum', 'ground', 'stripe'].forEach((k) => { p.look[k] = scaleR(REAL.look[k], s, lim[k]); }); return p; }
const modelOfStored = (key) => { const m = D.models[key]; return { dim: 110, w: m.w, mu: m.mu, sd: m.sd, thrOwn: m.thrOwn, thrReal: m.thrReal }; };
{
  const m = modelOfStored('wall@1'), pipe = allProg(1), rows = [];
  const near = (x, y) => (typeof x === 'number' ? Math.abs(x - y) < 1e-9 : Array.isArray(x) ? x.length === y.length && x.every((v, i) => near(v, y[i])) : x && typeof x === 'object' ? Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => near(x[k], y[k])) : x === y);
  check(near(allProg(1).look, REAL.look) && near(allProg(1).look, SV.hybrid(SV.SIM0, REAL, { scene: 'a', look: 'b', sensor: 'b', label: 'a' }).look), 'width 1 of the whole look is the street\'s look (the table\'s abba)');
  for (let i = 0; i < 1500; i++) { const f = L.relight(pipe, SV.SEEDS.simTest + i, SV.SEEDS.simTest + i, SV.SEEDS.simTest + i); if (f.y && f.area >= SV.EXAM.minArea) rows.push({ cnr: cnrOwn(f.scene, f.look), hit: SV.score(m, f.x).s > m.thrOwn }); }
  rows.sort((a, b) => a.cnr - b.cnr);
  // the 50% line: an own maximum-likelihood fit of hit against log10 CNR by a compass search (the builder uses Newton's iteration), centred so that the two parameters are nearly uncorrelated
  const uu = rows.map((r) => Math.log10(r.cnr)), um = mean(uu);
  const fit = (idx) => {
    const ll = (a, b) => { let t = 0; for (const i of idx) { const z = a + b * (uu[i] - um); t += rows[i].hit ? -Math.log1p(Math.exp(-z)) : -Math.log1p(Math.exp(z)); } return t; };
    let a = 0, b = 1, step = 1, best = ll(a, b);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    while (step > 1e-9) { let moved = false; for (const [da, db] of dirs) { const v = ll(a + da * step, b + db * step); if (v > best) { best = v; a += da * step; b += db * step; moved = true; break; } } if (!moved) step /= 2; }
    return { a, b, c0: Math.pow(10, um - a / b) };
  };
  const all = rows.map((_, i) => i), f0 = fit(all);
  put('c0', D.cnr.c0, 1);
  check(Math.abs(f0.c0 - D.cnr.c0) / D.cnr.c0 < 0.002 && Math.abs(f0.b - D.cnr.fit.b) / D.cnr.fit.b < 0.005, 'the independent maximum-likelihood line (' + f0.c0.toFixed(3) + ', slope ' + f0.b.toFixed(3) + ') equals the stored logistic fit (' + D.cnr.c0 + ', slope ' + D.cnr.fit.b + ')');
  { const rg = SV.rng(99), cs = []; for (let k = 0; k < 200; k++) cs.push(fit(all.map(() => Math.floor(rg() * all.length))).c0); cs.sort((x, y) => x - y); put('c0_lo', cs[Math.floor(0.05 * cs.length)], 1); put('c0_hi', cs[Math.floor(0.95 * cs.length)], 1); }
  put('n_below12', rows.filter((r) => r.cnr < 12).length, 0); put('hit_below12', pct(rows.filter((r) => r.cnr < 12 && r.hit).length / rows.filter((r) => r.cnr < 12).length), 0);
  check(rows.length === D.cnr.n, 'the same ' + D.cnr.n + ' pedestrians (own ' + rows.length + ')');
  const edges = D.cnr.bins.map((b) => b.lo).concat([1e9]);
  D.cnr.bins.forEach((b, k) => {
    const a = rows.filter((r) => r.cnr >= edges[k] && r.cnr < edges[k + 1]), h = a.filter((r) => r.hit).length / a.length;
    check(a.length === b.n && Math.abs(h - b.hit) < 6e-5, 'psychometric bin ' + k + ': own n ' + a.length + ', hit ' + h.toFixed(4) + ' vs data ' + b.n + ', ' + b.hit);
    put('hit_b' + (k + 1), pct(h), 0); put('n_b' + (k + 1), a.length, 0);
  });
}
tick('line fitted');
/* the share of pedestrians below the line, by width, for both families, with the same frames as the builder and own CNR */
for (const [fam, prog] of [['lum', lumProg], ['all', allProg]]) for (const s of D.protocol.widths) {
  const pipe = prog(s), c = []; let frames = 0, dim = 0;
  for (let i = 0; i < 4000 && c.length < 600; i++) { const f = L.relight(pipe, SV.SEEDS.train + 100000 + i, SV.SEEDS.train + 100000 + i, SV.SEEDS.train + 100000 + i); frames++; if (f.look.lum < 0.12) dim++; if (f.y && f.area >= SV.EXAM.minArea) c.push(cnrOwn(f.scene, f.look)); }
  const share = c.filter((v) => v < D.cnr.c0).length / c.length;
  check(Math.abs(share - D.cnr[fam][s]) < 0.004, 'share below the line, ' + fam + ', s = ' + s + ': own ' + share.toFixed(4) + ' vs data ' + D.cnr[fam][s]);
  put('share' + (fam === 'lum' ? '' : 'all') + '_' + String(s).replace('.', ''), pct(D.cnr[fam][s]), 1);
  if (fam === 'all') { put('dimfrac_' + String(s).replace('.', ''), pct(D.cnr.dimAll[s]), 0); check(Math.abs(dim / frames - D.cnr.dimAll[s]) < 0.002, 'dim fraction, whole look, s = ' + s); }
}
tick('shares done');
/* the two costs of dim frames, from the stored detectors of the whole look at widths 1 and 1.5 */
for (const s of [1, 1.5]) {
  const m = modelOfStored('wall@' + s), pipe = allProg(s), tag = String(s).replace('.', '');
  const grab = (seed0, n) => { const out = []; for (let i = 0; i < n; i++) { const f = L.relight(pipe, seed0 + i, seed0 + i, seed0 + i); out.push({ lum: f.look.lum, y: f.y, area: f.area, sc: SV.score(m, f.x).s }); } return out; };
  const val = grab(SV.SEEDS.simVal, 800), test = grab(SV.SEEDS.simTest, 1500);
  const thrOf = (set) => SV.thrAtFPR(set.filter((r) => !r.y).map((r) => r.sc), 0.1), missOf = (set, thr) => { const p = set.filter((r) => r.y && r.area >= 6); return p.filter((r) => r.sc <= thr).length / p.length; };
  const bright = (set) => set.filter((r) => r.lum >= 0.2), dim = (set) => set.filter((r) => r.lum < 0.2), thrP = thrOf(val), thrB = thrOf(bright(val));
  check(Math.abs(thrP - m.thrOwn) < 1e-3, 'own pooled threshold equals the stored one (' + thrP.toFixed(4) + ' vs ' + m.thrOwn + ')');
  put('dimshare_' + tag, pct(dim(val).length / val.length), 0);
  put('thr_pooled_' + tag, thrP, 2); put('thr_bright_' + tag, thrB, 2); put('thr_ratio_' + tag, thrP / thrB, 1);
  put('fa_dim_' + tag, pct(SV.rate(dim(val).filter((r) => !r.y).map((r) => r.sc), thrP)), 0); put('fa_bright_' + tag, pct(SV.rate(bright(val).filter((r) => !r.y).map((r) => r.sc), thrP)), 0);
  put('missb_pooled_' + tag, pct(missOf(bright(test), thrP)), 1); put('missb_own_' + tag, pct(missOf(bright(test), thrB)), 1); put('missd_pooled_' + tag, pct(missOf(dim(test), thrP)), 0);
}

/* ───────────────────────────── 4 · the range of the street, from the probe pixels ───────────────────────────── */
tick('4 · the range of the street, from the probe pixels');
tick('dim costs done');
/* an own re-implementation of the estimator: own linearisation, own medians, own drawing of the program's three skies at brightness 1, own classification, own quantiles */
const medOf = (a) => { const b = Array.from(a).sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : 0.5 * (b[m - 1] + b[m]); };
const quantOf = (a, p) => { const b = Array.from(a).sort((x, y) => x - y), k = p * (b.length - 1), i = Math.floor(k), f = k - i; return i + 1 < b.length ? b[i] * (1 - f) + b[i + 1] * f : b[i]; };
function ownProbe(x, gain) {                                              // x: DN image, 3 planes; the linearisation is DN^gamma / (kappa gain)
  const k = 1 / (0.15 * gain), band = (c, v0, v1) => { const a = []; for (let v = v0; v < v1; v++) for (let u = 0; u < W; u++) a.push(Math.pow(x[c * HW + v * W + u], 2.2) * k); return medOf(a); };
  const sky = [band(0, 0, 1), band(1, 0, 1), band(2, 0, 1)], road = [band(0, 20, 24), band(1, 20, 24), band(2, 20, 24)];
  return { level: mean(sky), chroma: [sky[0] / sky[1], sky[2] / sky[1]], ground: mean(road), sky, road };
}
function ownSkyTable() {
  const look0 = SV.clone(SV.SIM0.look); look0.sky = 'varied'; look0.lum = [1, 1];
  const pipe = SV.hybrid(SV.SIM0, REAL, { scene: 'a', look: 'a', sensor: 'b', label: 'a' }); pipe.look = look0;
  const frameAt = (seed) => {
    const scene = SV.drawScene(pipe.scene, SV.stream(seed, 'scene')), look = SV.drawLook(pipe.look, scene, SV.stream(seed, 'look')), ren = SV.render(scene, look);
    let s = 0; for (let i = 0; i < ren.rad.length; i++) s += ren.rad[i];
    const gain = Math.min(8, Math.max(1, 0.12 / Math.max(600 * s / ren.rad.length / 4000, 1e-9)));
    return { x: SV.sense(ren.rad, camera, SV.stream(seed, 'sensor')), gain, key: look.skyH.join(',') };
  };
  const by = {}; let seed;
  for (seed = 2000; seed < 2400; seed++) { const f = frameAt(seed), p = ownProbe(f.x, f.gain); (by[f.key] = by[f.key] || { c0: [], c1: [], lv: [] }); const t = by[f.key]; if (t.lv.length < 12) { t.c0.push(p.chroma[0]); t.c1.push(p.chroma[1]); t.lv.push(p.level); } }
  return Object.keys(by).map((k) => ({ chroma: [medOf(by[k].c0), medOf(by[k].c1)], level: medOf(by[k].lv) })).sort((a, b) => a.chroma[1] - b.chroma[1]);
}
const TAB = ownSkyTable(), TABE = L.skyTable();
check(TAB.length === 3, 'three skies');
TAB.forEach((t, k) => check(Math.abs(t.level - TABE[k].level) / t.level < 1e-6 && Math.abs(t.chroma[0] - TABE[k].chroma[0]) < 1e-6, 'sky ' + k + ': own table equals the engine\'s table'));
const LOGS = SV.evidence.logs(1000), TRUTH = SV.real.logs(1000);
const PR = LOGS.map((f) => ownProbe(f.x, f.gain));
function classify(p) { let best = -1, bd = 0.12; TAB.forEach((t, k) => { const d = Math.hypot(p.chroma[0] - t.chroma[0], p.chroma[1] - t.chroma[1]); if (d < bd) { bd = d; best = k; } }); return best; }
const cls = PR.map(classify), lumHat = PR.map((p, i) => cls[i] < 0 ? NaN : p.level / TAB[cls[i]].level), Ghat = PR.map((p, i) => cls[i] < 0 ? NaN : p.ground / lumHat[i]);
function ownRange(v, a, b) { const qa = quantOf(v, a), qb = quantOf(v, b), span = (qb - qa) / (b - a); return [qa - a * span, qb + (1 - b) * span]; }
const rangeOf = (idx, arr) => ownRange(idx.filter((i) => !isNaN(arr[i])).map((i) => arr[i]), 0.05, 0.95);
const NS = [10, 30, 100, 300, 1000], OWNR = {};
for (const n of NS) {
  const idx = Array.from({ length: n }, (_, i) => i), r = rangeOf(idx, lumHat), e = L.estimate(LOGS.slice(0, n), { table: TABE });
  check(Math.abs(e.lum[0] - r[0]) < 2e-5 && Math.abs(e.lum[1] - r[1]) < 2e-5, 'n = ' + n + ': the engine\'s brightness range equals the own estimate');
  OWNR[n] = r; put('est_lo_n' + n, r[0], 3); put('est_hi_n' + n, r[1], 3);
}
put('true_lo', REAL.look.lum[0], 2); put('true_hi', REAL.look.lum[1], 2);
{
  const tl = TRUTH.map((f) => f.look.lum), ratio = lumHat.map((v, i) => v / tl[i]).filter((v) => !isNaN(v)).sort((a, b) => a - b);
  put('probe_ratio_med', ratio[ratio.length >> 1], 2); put('probe_ratio_q10', ratio[Math.floor(0.1 * ratio.length)], 2); put('probe_ratio_q90', ratio[Math.floor(0.9 * ratio.length)], 2);
  put('probe_used', pct(ratio.length / 1000), 0);
  const names = (f) => f.look.skyH[2] > 0.9 ? 'blue' : f.look.skyH[0] > 0.9 ? 'warm' : 'grey', ord = ['warm', 'grey', 'blue'];
  let ok = 0, n = 0; const share = { blue: 0, grey: 0, warm: 0 };
  cls.forEach((k, i) => { if (k < 0) return; n++; share[ord[k]]++; if (ord[k] === names(TRUTH[i])) ok++; });
  put('sky_acc', pct(ok / n), 1); put('sky_blue', pct(share.blue / n), 0); put('sky_grey', pct(share.grey / n), 0); put('sky_warm', pct(share.warm / n), 0);
  check(ok / n > 0.97, 'the sky class read from the colour is right in ' + (ok / n).toFixed(3) + ' of the frames');
  const F = (a, e) => a + (1 - a) * Math.sin(e * Math.PI / 180), R = REAL.look;
  put('G_true_lo', R.ground[0] * F(R.amb[0], R.sunEl[0]), 3); put('G_true_hi', R.ground[1] * F(R.amb[1], R.sunEl[1]), 3);
  const gr = rangeOf(Array.from({ length: 1000 }, (_, i) => i), Ghat); put('G_est_lo', gr[0], 3); put('G_est_hi', gr[1], 3);
  const tG = TRUTH.map((f) => f.look.ground * F(f.look.amb, Math.asin(f.look.l[1]) * 180 / Math.PI)), gq = [0.05, 0.5, 0.95].map((p) => quantOf(tG, p)), hq = [0.05, 0.5, 0.95].map((p) => quantOf(Ghat.filter((v) => !isNaN(v)), p));
  put('G_ratio_med', hq[1] / gq[1], 2);
  const logsRatio = PR.map((p, i) => p.ground / tG[i] / (tl[i] * 1)).map((v, i) => v); void logsRatio;
}
/* how the estimate scatters with the amount of evidence: a bootstrap of the 1000 frames (the page's error bar), 300 resamples per n */
{
  const ok = lumHat.filter((v) => !isNaN(v)), rng = SV.rng(77);
  for (const n of [10, 30, 100, 300]) {
    const los = [], his = [];
    for (let b = 0; b < 300; b++) { const s = []; for (let i = 0; i < n; i++) s.push(ok[Math.floor(rng() * ok.length)]); const r = ownRange(s, 0.05, 0.95); los.push(r[0]); his.push(r[1]); }
    put('sd_lo_n' + n, sd(los), 3); put('sd_hi_n' + n, sd(his), 3);
  }
  check(F.sd_hi_n300 < F.sd_hi_n100 && F.sd_hi_n100 < F.sd_hi_n30 && F.sd_hi_n30 < F.sd_hi_n10, 'the error of the estimate falls as evidence grows');
  check(Math.abs(F.est_lo_n1000 - F.true_lo) < 0.03 && Math.abs(F.est_hi_n1000 - F.true_hi) < 0.1, 'the estimated range of brightness is near the street\'s (' + F.est_lo_n1000 + '..' + F.est_hi_n1000 + ')');
}
/* two roads with the same road light and different pictures: ground 0.30, ambient 0.45, sun 55 degrees against ground 0.45, ambient 0.20, sun 30 degrees; same scene, same sky, same brightness (noise-free) */
{
  const pipe = progWith(null), scene = SV.drawScene(pipe.scene, SV.stream(4242, 'scene'), { ped: true }), base = SV.drawLook(pipe.look, scene, SV.stream(4242, 'look'));
  const mk = (g, a, el) => { const lk = SV.clone(base); lk.ground = g; lk.amb = a; lk.lum = 0.6; const e = el * Math.PI / 180; lk.l = [0, Math.sin(e), -Math.cos(e)]; return lk; };
  const bandMed = (rad, c, v0, v1) => { const a = []; for (let v = v0; v < v1; v++) for (let u = 0; u < W; u++) a.push(rad[c * HW + v * W + u]); return medOf(a); };
  const A = SV.render(scene, mk(0.30, 0.45, 55), { maps: false }).rad, B = SV.render(scene, mk(0.45, 0.20, 30), { maps: false }).rad;
  const roadA = bandMed(A, 1, 20, 24), roadB = bandMed(B, 1, 20, 24), wallA = bandMed(A, 1, 3, 7), wallB = bandMed(B, 1, 3, 7);
  put('conf_road_ratio', roadB / roadA, 2); put('conf_wall_ratio', wallB / wallA, 2);
  put('conf_G_A', 0.30 * (0.45 + 0.55 * Math.sin(55 * Math.PI / 180)), 3); put('conf_G_B', 0.45 * (0.20 + 0.80 * Math.sin(30 * Math.PI / 180)), 3);
  check(Math.abs(roadB / roadA - 1) < 0.01 && Math.abs(wallB / wallA - 1) > 0.1, 'same road light, different wall: the road cannot say which look it is');
}

/* ───────────────────────────── 5 · how wide: the sweeps ───────────────────────────── */
tick('5 · how wide: the sweeps');
const SW = D.protocol.widths, sk = (s) => String(s).replace('.', '');
SW.forEach((s) => {
  const c = D.sweep[s], a = D.wall[s];
  put('sw_exam_' + sk(s), pct(cellMean(c, 'realMiss')), 1); put('sw_own_' + sk(s), pct(cellMean(c, 'ownMiss')), 1); put('sw_logs_' + sk(s), pct(cellMean(c, 'logsAlarm')), 1); put('sw_dom_' + sk(s), cellMean(c, 'domAUC'), 2);
  put('wl_exam_' + sk(s), pct(cellMean(a, 'realMiss')), 1); put('wl_own_' + sk(s), pct(cellMean(a, 'ownMiss')), 1); put('wl_logs_' + sk(s), pct(cellMean(a, 'logsAlarm')), 1);
});
{
  const sds = SW.map((s) => sd(D.sweep[s].realMiss.map(pct))).concat(SW.map((s) => sd(D.wall[s].realMiss.map(pct))));
  put('sw_sd_max', Math.max(...sds), 1);
  put('sw_flat', Math.max(...SW.map((s) => F['sw_exam_' + sk(s)])) - Math.min(...SW.map((s) => F['sw_exam_' + sk(s)])), 1);
  put('sw_own_max', Math.max(...SW.map((s) => F['sw_own_' + sk(s)])), 1);
  put('wl_u_wide', Math.max(F.wl_exam_15, F.wl_exam_2, F.wl_exam_3) - F.wl_exam_05, 1); put('wl_u_narrow', F.wl_exam_0 - F.wl_exam_05, 1);
  put('wl_own_jump', F.wl_own_15 - F.wl_own_1, 1); put('wl_own_3', F.wl_own_3, 1); put('wl_gap_3', F.wl_exam_3 - F.wl_exam_1, 1);
  SW.forEach((x) => { const r = scaleR(REAL.look.lum, x, L.LIMITS.lum); put('sw_lo_' + sk(x), r[0], 2); put('sw_hi_' + sk(x), r[1], 2); });
  put('ratio_centre', Math.max(REAL.look.lum[1] / ((REAL.look.lum[0] + REAL.look.lum[1]) / 2), ((REAL.look.lum[0] + REAL.look.lum[1]) / 2) / REAL.look.lum[0]), 1); put('ratio_top', REAL.look.lum[1] / REAL.look.lum[0], 1);
  put('level_gain', pct(mean(T.swap.aaba.realMiss)) - F.sw_exam_0, 1);       // moving the program's one brightness from 1 to the centre of the street's range
  put('width_gain', F.sw_exam_0 - F.sw_exam_1, 1);                            // what the whole range then adds
  put('meter_fall', F.sw_logs_0 - F.sw_logs_15, 1);
  check(F.wl_own_15 > F.wl_own_1 + 5 && F.wl_own_05 < F.wl_own_1 + 3, 'the whole look: the program\'s own miss rate stays flat to the street\'s range and jumps beyond it');
  check(F.sw_flat < 3 && F.sw_own_max < 6, 'the brightness alone: the exam and the own miss rate are flat in the width');
}
/* the cost of invariance: the whole look at the street's width (abba) and three times wider, N = 200 ... 1600 */
[200, 400, 800, 1600].forEach((N) => {
  const a = D.curve[1][N], b = D.curve[3][N];
  put('inv_exam1_' + N, pct(cellMean(a, 'realMiss')), 1); put('inv_exam3_' + N, pct(cellMean(b, 'realMiss')), 1); put('inv_gap_' + N, pct(cellMean(b, 'realMiss') - cellMean(a, 'realMiss')), 1);
  put('inv_own3_' + N, pct(cellMean(b, 'ownMiss')), 1); put('inv_own1_' + N, pct(cellMean(a, 'ownMiss')), 1);
});

/* ───────────────────────────── 6 · the program built from the probes, against the exact one ───────────────────────────── */
tick('6 · the program built from the probes, against the exact one');
{
  const e = D.est, m = (c) => pct(mean(T.swap[c].realMiss));
  put('aa_miss', m('aaba'), 1); put('ab_miss', m('abba'), 1); put('aa_logs', pct(mean(T.swap.aaba.logsAlarm)), 1); put('ab_logs', pct(mean(T.swap.abba.logsAlarm)), 1); put('ab_own', pct(mean(T.swap.abba.ownMiss)), 1);
  put('est_lum', pct(cellMean(e.lum, 'realMiss')), 1); put('est_lum_own', pct(cellMean(e.lum, 'ownMiss')), 1); put('est_lum_logs', pct(cellMean(e.lum, 'logsAlarm')), 1); put('est_lum_dom', cellMean(e.lum, 'domAUC'), 2);
  put('est_lum_open', pct(cellMean(e.lum, 'missOpen')), 1); put('est_lum_emerge', pct(cellMean(e.lum, 'missEmerge')), 1);
  put('est_lsg', pct(cellMean(e['lum+sky+ground'], 'realMiss')), 1); put('est_lsg_logs', pct(cellMean(e['lum+sky+ground'], 'logsAlarm')), 1);
  put('est_ls', pct(e['lum+sky'].realMiss[0]), 1); put('est_lum_s1', pct(e.lum.realMiss[0]), 1);
  put('est_gain', F.aa_miss - F.est_lum, 1); put('ab_gain', F.aa_miss - F.ab_miss, 1); put('est_vs_ab', F.est_lum - F.ab_miss, 1); put('est_vs_ab_abs', Math.abs(F.est_lum - F.ab_miss), 1); put('lsg_vs_lum', F.est_lsg - F.est_lum, 1);
  put('est_lo', D.estimate.lum[0], 2); put('est_hi', D.estimate.lum[1], 2); put('est_used', D.estimate.used, 0); put('est_centre', (D.estimate.lum[0] + D.estimate.lum[1]) / 2, 2);
  check(Math.abs(D.estimate.lum[0] - OWNR[1000][0]) < 2e-5 && Math.abs(D.estimate.lum[1] - OWNR[1000][1]) < 2e-5, 'the stored estimate equals the own estimate from 1000 frames');
  check(Math.abs(F.est_lum - F.ab_miss) < 2.5 && F.est_lum < F.aa_miss - 2, 'the program built from the sky probe lands within about two points of the exact-stage look (' + F.est_lum + ' against ' + F.ab_miss + ')');
}
/* the seams: exact-stage cells of the tables */
{
  const m = (c) => pct(mean(T.swap[c].realMiss));
  put('aaaa', m('aaaa'), 1); put('bbba', m('bbba'), 1);
  put('sc_bad', m('aaaa') - m('baaa'), 1); put('sc_good', m('abba') - m('bbba'), 1);
  check(Math.abs(F.sc_bad - 5.5) < 0.1 && Math.abs(F.sc_good - 14.8) < 0.1, 'the scene repair is worth 5.5 points while the pixels are wrong and 14.8 once they are right');
}
/* the program's own frames: the exposure gain of the camera, against the street's logs */
{
  const pipe = SV.hybrid(SV.SIM0, REAL, { scene: 'a', look: 'a', sensor: 'b', label: 'a' }), g = [];
  for (let i = 0; i < 300; i++) { const f = L.relight(pipe, 5000 + i, 5000 + i, 5000 + i); g.push(f.gain); }
  g.sort((a, b) => a - b); put('pg_capped', pct(g.filter((v) => v >= 8 - 1e-9).length / g.length), 0);
  check(F.pg_capped === 0, 'the program\'s frames are never at the exposure cap');
  // the range the page quotes is Lesson 3's: its 1,000 program frames; this lesson's own 300 frames lie inside it (to a tenth)
  const g3 = SV.L03.prog.gain, lo3 = Math.min(...g3), hi3 = Math.max(...g3); put('pg_lo', lo3, 1); put('pg_hi', hi3, 1);
  check(g[0] > lo3 - 0.1 && g[g.length - 1] < hi3 + 0.1 && g3.length === 1000, 'the program\'s 300 frames here run within the gain range Lesson 3 recorded over its 1,000');
}

/* ───────────────────────────── 7 · what the repaired pixels leave: the scene ───────────────────────────── */
tick('7 · what the repaired pixels leave: the scene');
{
  // the pedestrians the program draws (SIM0's scene, the estimated brightness): distance from the label's depth at the mask, and how strong they are
  const pipe = progWith(D.estimate.lum), z = [], c = []; let emerge = 0, n = 0;
  for (let i = 0; i < 1500 && c.length < 600; i++) {
    const f = SV.sample(pipe, SV.SEEDS.train + 100000 + i); if (!(f.y && f.area >= 6)) continue;
    const zs = []; for (let q = 0; q < HW; q++) if (f.cov[q] > 0.5) zs.push(f.depth[q]); z.push(medOf(zs)); n++; if (f.mode === 'emerge') emerge++; c.push(cnrOwn(f.scene, f.look));
  }
  put('prog_n', n, 0); put('prog_zmin', Math.min(...z), 0); put('prog_zmax', Math.max(...z), 0); put('prog_emerge', pct(emerge / n), 0); put('prog_pemerge', SV.SIM0.scene.pEmerge * 100, 0);
  put('prog_zlo_cfg', SV.SIM0.scene.z[0], 0); put('prog_zhi_cfg', SV.SIM0.scene.z[1], 0);
  c.sort((a, b) => a - b); put('prog_cnr_med', c[c.length >> 1], 0); put('prog_cnr_q05', c[Math.floor(0.05 * c.length)], 0);
  // LAB PRIVILEGE: the street's exam pedestrians with their labels (a project has none): their contrast-to-noise ratio
  const test = SV.real.test(3000), sc = []; test.forEach((f) => { if (f.y && f.area >= 6) sc.push(cnrOwn(f.scene, f.look)); });
  sc.sort((a, b) => a - b); put('street_cnr_med', sc[sc.length >> 1], 0); put('street_cnr_q05', sc[Math.floor(0.05 * sc.length)], 0); put('street_n', sc.length, 0);
  put('cnr_ratio', F.prog_cnr_med / F.street_cnr_med, 1);
  check(F.prog_zmin >= 7.5 && F.prog_zmax <= 16.5 && F.prog_emerge === 0, 'every pedestrian of the program stands 8-16 m away in the open');
  check(F.prog_cnr_med > 1.3 * F.street_cnr_med, 'the program\'s pedestrians are stronger than the street\'s');
}

/* ───────────────────────────── the checkpoint: a pedestrian of 12 px² ───────────────────────────── */
tick('the checkpoint: a pedestrian of 12 px²');
{
  const sig = (Lr) => Math.sqrt(camera.ev * Lr + camera.read * camera.read) / camera.ev, cnrOf = (delta, Lr) => Math.sqrt(36) * delta / sig(Lr);
  put('ck_sigma_bright', sig(0.08), 4); put('ck_cnr_bright', cnrOf(0.03, 0.08), 1); put('ck_sigma_dim', sig(0.02), 4); put('ck_cnr_dim', cnrOf(0.0075, 0.02), 1);
  put('ck_ideal', pct(L.Phi(cnrOf(0.0075, 0.02) - L.Z)), 0); put('ck_ratio', cnrOf(0.03, 0.08) / cnrOf(0.0075, 0.02), 1);
  check(F.ck_cnr_bright > D.cnr.c0 && F.ck_cnr_dim < D.cnr.c0, 'the checkpoint pedestrian is above the line in the bright light and below it in the dim');
}

/* ───────────────────────────── the widget, driven along its three sliders and its two selectors ───────────────────────────── */
tick('the widget, driven along its three sliders and its two selectors');
const SCENES = [9, 8, 5, 12, 19, 42], NSV = [10, 30, 100, 300, 1000];
function stripOwn(si, sc) {                                                   // eight frames of one scene under eight looks of the estimated range at width s: own drawing, own CNR, the stored detector of that width
  const s = SW[si], pipe = progWith(scaleR(D.estimate.lum, s, L.LIMITS.lum)), m = modelOfStored('sweep@' + s); let below = 0, missed = 0, zs = 0; const cs = [];
  for (let k = 0; k < 8; k++) {
    const scene = SV.drawScene(pipe.scene, SV.stream(SCENES[sc], 'scene'), { ped: true }), look = SV.drawLook(pipe.look, scene, SV.stream(1000 + 17 * k, 'look')), ren = SV.render(scene, look);
    const x = SV.sense(ren.rad, camera, SV.stream(5000 + 31 * k, 'sensor')), lab = SV.labels(ren.cov, pipe.label, scene, look);
    const cn = cnrOwn(scene, look); cs.push(cn); if (cn < D.cnr.c0) below++; if (SV.score(m, x).s <= m.thrOwn) missed++;
    if (k === 0) { const d = []; for (let q = 0; q < HW; q++) if (ren.cov[q] > 0.5) d.push(ren.depth[q]); zs = medOf(d); }
    void lab;
  }
  return { below, missed, z: zs, cnrMed: medOf(cs) };
}
const alarmsOwn = (si) => { const m = modelOfStored('sweep@' + SW[si]); return LOGS.slice(0, 8).filter((f) => SV.score(m, f.x).s > m.thrOwn).length; };
{
  const sz = (si, sc) => stripOwn(si, sc);
  const a = sz(2, 2), far = sz(2, 5);
  put('try_z', a.z, 0); put('try_below_s1', a.below, 0); put('try_missed_s1', a.missed, 0); put('try_zfar', far.z, 0); put('try_cnr_near', a.cnrMed, 0); put('try_cnr_far', far.cnrMed, 0);
  put('try_hi_s3', scaleR(D.estimate.lum, 3, L.LIMITS.lum)[1], 1);
  put('logs_alarm_s0', alarmsOwn(0), 0); put('logs_alarm_s15', alarmsOwn(3), 0);
  const page = loadPage(path.join(root, dir, '04_same_scene_other_pixels.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const f1 = (x) => (100 * x).toFixed(1) + '%';
  for (let si = 0; si < SW.length; si++) {
    page.set('w04-s', si); page.set('w04-src', 'prog'); page.set('w04-scene', 2); page.set('w04-n', 2);
    const s = SW[si], cl = D.sweep[s], al = D.wall[s], st = stripOwn(si, 2);
    check(page.text('w04-s-v') === String(s), 'widget width label at ' + s);
    check(page.text('w04-exam') === f1(mean(cl.realMiss)) && page.text('w04-own') === f1(mean(cl.ownMiss)) && page.text('w04-logs') === f1(mean(cl.logsAlarm)), 'widget readouts of the brightness sweep at s = ' + s + ': ' + page.text('w04-exam') + ' ' + page.text('w04-own') + ' ' + page.text('w04-logs'));
    check(page.text('w04-examall') === f1(mean(al.realMiss)) && page.text('w04-ownall') === f1(mean(al.ownMiss)), 'widget readouts of the whole look at s = ' + s);
    check(page.text('w04-strip') === st.below + ' of 8 below the line, ' + st.missed + ' missed', 'widget strip at s = ' + s + ': "' + page.text('w04-strip') + '" against own ' + st.below + ', ' + st.missed);
    page.set('w04-src', 'logs');
    check(page.text('w04-strip') === alarmsOwn(si) + ' of 8 alarm', 'widget logs strip at s = ' + s + ': "' + page.text('w04-strip') + '" against own ' + alarmsOwn(si));
  }
  page.set('w04-src', 'prog');
  for (let ni = 0; ni < NSV.length; ni++) {
    page.set('w04-n', ni);
    const idx = Array.from({ length: NSV[ni] }, (_, i) => i), r = rangeOf(idx, lumHat);
    check(page.text('w04-est') === r[0].toFixed(2) + ' to ' + r[1].toFixed(2), 'widget estimate from ' + NSV[ni] + ' frames: "' + page.text('w04-est') + '" against own ' + r[0].toFixed(2) + ' to ' + r[1].toFixed(2));
    check(page.text('w04-n-v') === String(NSV[ni]), 'widget evidence label');
  }
  page.set('w04-scene', 5); page.set('w04-s', 5); page.set('w04-src', 'logs');
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}

/* ───────────────────────────── two cells of the table, recomputed from scratch with this file's own exam ───────────────────────────── */
tick("two cells of the table, recomputed from scratch with this file's own exam");
function ownCell(pipe, seed) {
  const m0 = SV.train(SV.makeSet(pipe, 1600, SV.SEEDS.train + seed * 100000), { seed });
  const model = { dim: m0.dim, w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) };
  const test = SV.real.test(3000), val = SV.real.val(1500), logs = SV.real.logs(1000), score = (s) => SV.score(model, s.x).s;
  const sT = test.map(score), sV = val.map(score), sL = logs.map(score);
  const negV = sV.filter((_, i) => !val[i].y).sort((a, b) => a - b), thr = negV[Math.floor(0.9 * negV.length)];
  let hits = 0, tot = 0; test.forEach((s, i) => { if (s.y && s.area >= 6) { tot++; if (sT[i] > thr) hits++; } });
  const ownV = SV.makeSet(pipe, 800, SV.SEEDS.simVal), negO = ownV.map(score).filter((_, i) => !ownV[i].y).sort((a, b) => a - b), thrO = negO[Math.floor(0.9 * negO.length)];
  return { miss: 1 - hits / tot, logs: sL.filter((v) => v > thrO).length / sL.length };
}
{
  const wide = progWith(null); wide.look = L.scaleLook(SV.clone(REAL.look), 1.5);                // the engine's own arithmetic for the ranges, so that the frames are the builder's to the last bit
  const c1 = ownCell(wide, 2), c2 = ownCell(progWith(D.estimate.lum), 3);
  check(Math.abs(c1.miss - D.wall[1.5].realMiss[1]) < 1e-4 && Math.abs(c1.logs - D.wall[1.5].logsAlarm[1]) < 1e-4, 'whole look at width 1.5, seed 2, from scratch: ' + c1.miss.toFixed(4) + ' vs ' + D.wall[1.5].realMiss[1]);
  check(Math.abs(c2.miss - D.est.lum.realMiss[2]) < 1e-4 && Math.abs(c2.logs - D.est.lum.logsAlarm[2]) < 1e-4, 'the program built from the sky, seed 3, from scratch: ' + c2.miss.toFixed(4) + ' vs ' + D.est.lum.realMiss[2]);
}

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
