#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 03 (the camera is a measurement).
 *
 * Re-derives every number the lesson quotes, with code that does not share its path with the engine (l03_camera.js) or the widget:
 *   A  the camera model: the mean and variance of SV.sense on flat frames against the closed form (counting + read noise + quantiser), at every usable exposure     [uses SV.REAL: lab privilege]
 *   B  the evidence generators against a direct call of SV.sense, and L.sense against SV.sample bit for bit (the exact-stage program) and against its closed form at other parameters
 *   C  an own implementation of the whole calibration (gamma, the photon-transfer law, the edge fit, the exposure law) on the same frames; it must equal the engine's to 1e-9, and
 *      both must recover the street's parameters within the error bars the lesson quotes                                                                           [uses SV.REAL: lab privilege]
 *   D  the noise-law elimination: rms residuals of the five laws (own weighted fit, and a brute-force grid check of the affine law), the quantiser's share, the pair-difference variance
 *   E  the edge: the 10-90 reading against the synthesis fit, the constant 2.563 from the Gaussian distribution function
 *   F  the exposure log: the gain distribution of 1,000 street frames and 1,000 program frames, recomputed from the renderer with the street's controller law
 *   G  the price of the camera's parts: Shapley values by enumerating the six orders, the exposure part under the street's light, the calibrated cells
 *   H  one calibrated cell recomputed from scratch (own calibration, engine's sensor, own exam) and the contrast-to-noise table recomputed with an own CNR
 *   I  the motion integral by brute force with the lab's renderer
 *   J  the widget, driven through the states the prose names.
 * Last stdout line: {"facts": {...}}.  Set FAST=1 to skip the one slow recomputation (development only). */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
require(path.join(root, dir, 'evidence.js'));
const L = require(path.join(root, dir, 'l03_camera.js'));
require(path.join(root, dir, 'l03_data.js'));
const T = SV.TABLES, D = SV.L03;
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
const pc = (x) => 100 * x;
const quantile = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const CAM = SV.CAM, W = CAM.W, H = CAM.H, HW = W * H;
const RS = SV.REAL.sensor, CAMERA = SV.evidence.CAMERA;                  // the street's true parameters (lab privilege) and the rounded camera of the series
const KAPPA = RS.ev / RS.fw;
const BLOCK = 7;                                                         // the evidence block the page draws its widget kit from (flats 13,350,000; edges 13,750,000)
const FLAT0 = 13000000 + 50000 * BLOCK, EDGE0 = 13400000 + 50000 * BLOCK;
const manualCfg = () => { const c = SV.clone(RS); delete c.ae; return c; };

/* ───────────────────────────── the table cells the lesson quotes ───────────────────────────── */
const miss = (code) => pc(mean(T.swap[code].realMiss));
put('m_aaaa', miss('aaaa'), 1); put('m_aaba', miss('aaba'), 1); put('step1', miss('aaaa') - miss('aaba'), 1);
put('logs_aaaa', pc(mean(T.swap.aaaa.logsAlarm)), 0); put('logs_aaba', pc(mean(T.swap.aaba.logsAlarm)), 1);
put('wobble', pc(sd(T.swap.aaba.realMiss)), 1);
for (const k of D.kits) { const c = D.cal[String(k)]; put('m_cal' + k, pc(mean(c.realMiss)), 1); put('a_cal' + k, pc(mean(c.logsAlarm)), 1); put('d_cal' + k, pc(mean(c.realMiss)) - miss('aaba'), 2); }
put('gap_cal16', Math.abs(F.d_cal16), 1);
put('gap_max', Math.max(...D.kits.map((k) => Math.abs(F['d_cal' + k]))), 1);
check(F.gap_max < 2.5, 'the calibrated program is within about the seed wobble of the exact-stage program at every kit size (max ' + F.gap_max + ')');
check(D.kits.every((k) => D.cal[String(k)].realMiss.length === 3 && D.cal[String(k)].realMiss.every((v) => v > 0)), 'three seeds in every calibrated cell');

/* ───────────────────────────── A. the camera model against SV.sense ───────────────────────────── */
function flatFrames(stop, n, seed0) { const rad = new Float32Array(3 * HW).fill(Math.pow(2, stop)), cfg = manualCfg(); return Array.from({ length: n }, (_, j) => SV.sense(rad, cfg, SV.stream(seed0 + j, 'flat'))); }
{
  let worstMean = 0, worstVar = 0;
  for (let s = -5; s <= 2; s++) {
    const fr = flatFrames(s, 6, 13990000 + 100 * (s + 10)); let mq = 0, mdn = 0, vq = 0, n = 0;
    fr.forEach((x) => { let a = 0; for (let i = 0; i < x.length; i++) a += Math.pow(x[i], RS.gamma); a /= x.length; let v = 0; for (let i = 0; i < x.length; i++) { const d = Math.pow(x[i], RS.gamma) - a; v += d * d; mdn += x[i]; } mq += a; vq += v / (x.length - 1); n++; });
    mq /= n; vq /= n; mdn /= n * 3 * HW;
    const step = RS.gamma * Math.pow(mdn, RS.gamma - 1) / 255, wantMean = KAPPA * Math.pow(2, s), wantVar = (RS.ev * Math.pow(2, s) + RS.read * RS.read) / (RS.fw * RS.fw) + step * step / 12;
    worstMean = Math.max(worstMean, Math.abs(mq / wantMean - 1)); worstVar = Math.max(worstVar, Math.abs(vq / wantVar - 1));
  }
  check(worstMean < 0.006, 'A: mean q of flat frames = kappa 2^s at the eight usable stops (worst relative error ' + worstMean.toFixed(4) + ')');
  check(worstVar < 0.04, 'A: variance of q = (ev 2^s + r^2)/fw^2 + step^2/12 at the eight usable stops (worst relative error ' + worstVar.toFixed(4) + ')');
  check(Math.abs(KAPPA - CAMERA.kappa) < 1e-12 && RS.fw === CAMERA.fw && RS.read === CAMERA.read && RS.blur === CAMERA.blur && RS.gamma === CAMERA.gamma && RS.ae.target === CAMERA.ae.target && RS.ae.maxGain === CAMERA.ae.maxGain, 'A: SV.evidence.CAMERA is the street\'s camera');
}

/* ───────────────────────────── B. generators and the switchable sensor ───────────────────────────── */
{
  const mine = L.flats([-3, 1], 2, FLAT0), cfg = manualCfg();
  [[0, -3], [1, 1]].forEach(([si, s]) => { const rad = new Float32Array(3 * HW).fill(Math.pow(2, s)); const x = SV.sense(rad, cfg, SV.stream(FLAT0 + si * 1000 + 1, 'flat')); check(mine[si].frames[1].every((v, i) => v === x[i]), 'B: L.flats frame is SV.sense of the card at stop ' + s + ' with the documented seed'); });
  const x0 = 36 + 24 * SV.stream(EDGE0 + 2, 'edge')(), rad = new Float32Array(3 * HW);
  for (let c = 0; c < 3; c++) for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { let s = 0; for (let a = 0; a < 2; a++) if (u + (a + 0.5) / 2 >= x0) s += 0.5; rad[c * HW + v * W + u] = 0.1 + 1.9 * s; }
  const e = SV.sense(rad, cfg, SV.stream(EDGE0 + 2, 'sensor')); check(L.edge(3, EDGE0)[2].every((v, i) => v === e[i]), 'B: L.edge frame is SV.sense of the step target at a sub-pixel position');
  const aaba = SV.hybrid(SV.SIM0, SV.REAL, { sensor: 'b' }), aaaa = SV.hybrid(SV.SIM0, SV.REAL, {}), cam = L.exactCam(); let diff = 0, nvals = 0, N = 60;
  for (let s = 1; s <= N; s++) { const a = SV.sample(aaba, s * 7919), b = L.sample(aaaa, cam, { noise: true, blur: true, ae: true }, s * 7919); for (let i = 0; i < a.x.length; i++) if (a.x[i] !== b.x[i]) diff++; nvals += a.x.length; if (a.y !== b.y || a.area !== b.area) diff++; }
  let diff0 = 0; for (let s = 1; s <= 30; s++) { const a = SV.sample(aaaa, s * 31), b = L.sample(aaaa, cam, { noise: false, blur: false, ae: false }, s * 31); for (let i = 0; i < a.x.length; i++) if (a.x[i] !== b.x[i]) diff0++; }
  check(diff === 0 && diff0 === 0, 'B: L.sense with all parts on is SV.sense of the street\'s camera (aaba), and with all off the ideal sensor (aaaa): bit for bit (' + diff + ', ' + diff0 + ' differing values)');
  put('bitexact_n', N, 0);
  // another camera, one part at a time: noise alone gives the closed-form variance, exposure alone the controller's gain
  const rad2 = new Float32Array(3 * HW).fill(0.3), cam2 = { ev: 600, fw: 3000, read: 5, blur: 1.2, gamma: 2.4, bits: 8, ae: { target: 0.2, maxGain: 4 } };
  const x1 = L.sense(rad2, cam2, SV.stream(5, 'x'), { noise: true, blur: false, ae: false });
  let m = 0, v = 0; for (let i = 0; i < x1.length; i++) m += Math.pow(x1[i], cam2.gamma); m /= x1.length; for (let i = 0; i < x1.length; i++) v += Math.pow(Math.pow(x1[i], cam2.gamma) - m, 2); v /= x1.length - 1;
  check(Math.abs(m / (600 * 0.3 / 3000) - 1) < 0.01 && Math.abs(v / ((600 * 0.3 + 25) / 9e6) - 1) < 0.08, 'B: L.sense, noise only, another camera: mean and variance of q follow the closed form (' + (m / 0.06).toFixed(4) + ', ' + (v / ((600 * 0.3 + 25) / 9e6)).toFixed(3) + ')');
  const x2 = L.sense(rad2, cam2, SV.stream(5, 'x'), { noise: false, blur: false, ae: true }), g = Math.min(4, Math.max(1, 0.2 / (600 * 0.3 / 3000)));
  check(Math.abs(Math.pow(x2[0], cam2.gamma) - Math.min(1, g * 0.06)) < 0.003, 'B: L.sense, exposure only: the code is the gamma curve of gain x level');
  check(Math.abs(L.gainOf(rad2, cam2) - g) < 1e-6, 'B: gainOf is clamp(target / level, 1, maxGain)');
}

/* ───────────────────────────── C. an own calibration ───────────────────────────── */
function ownKit(k, block) {                                              // the evidence, drawn directly from SV.sense with the documented seeds
  const cfg = manualCfg(), f0 = 13000000 + 50000 * block, e0 = 13400000 + 50000 * block, flats = [], edges = [];
  L.STOPS.forEach((s, si) => { const rad = new Float32Array(3 * HW).fill(Math.pow(2, s)), fr = []; for (let j = 0; j < k; j++) fr.push(SV.sense(rad, cfg, SV.stream(f0 + si * 1000 + j, 'flat'))); flats.push({ stop: s, frames: fr }); });
  for (let j = 0; j < k; j++) {
    const x0 = 36 + 24 * SV.stream(e0 + j, 'edge')(), rad = new Float32Array(3 * HW);
    for (let c = 0; c < 3; c++) for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { let s = 0; for (let a = 0; a < 2; a++) if (u + (a + 0.5) / 2 >= x0) s += 0.5; rad[c * HW + v * W + u] = 0.1 + 1.9 * s; }
    edges.push(SV.sense(rad, cfg, SV.stream(e0 + j, 'sensor')));
  }
  return { flats, edges };
}
function twoPass(x, gam) { let s = 0; const n = x.length; for (let i = 0; i < n; i++) s += Math.pow(x[i], gam); const m = s / n; let v = 0; for (let i = 0; i < n; i++) { const d = Math.pow(x[i], gam) - m; v += d * d; } return { m, v: v / (n - 1) }; }
function refLevels(flats, gam) {
  return flats.map(({ stop, frames }) => {
    let dn = 0, n = 0, c0 = 0, c1 = 0; frames.forEach((x) => { for (let i = 0; i < x.length; i++) { dn += x[i]; n++; if (x[i] === 0) c0++; if (x[i] === 1) c1++; } }); dn /= n;
    const o = { stop, dn, usable: c0 / n < 0.005 && c1 / n < 0.005, c0: c0 / n, c1: c1 / n };
    if (gam) { const st = frames.map((x) => twoPass(x, gam)), step = gam * Math.pow(dn, gam - 1) / 255; o.mean = mean(st.map((s) => s.m)); o.raw = mean(st.map((s) => s.v)); o.q = step * step / 12; o.var = o.raw - o.q; o.n = n; }
    return o;
  });
}
function refGamma(flats) {
  const lv = refLevels(flats).filter((o) => o.usable && o.dn > 0.2), xs = lv.map((o) => o.stop), ys = lv.map((o) => Math.log2(o.dn)), mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); });
  return 1 / (sxy / sxx);
}
function wls(pts, useVar) {                                              // weights 1/var^2 iterated four times, as the lesson says; normal equations solved by Cramer's rule
  let a = 0, b = 0, w = pts.map((p) => 1 / (p[useVar] * p[useVar]));
  for (let it = 0; it < 4; it++) {
    const S = [0, 0, 0, 0, 0]; pts.forEach((p, i) => { S[0] += w[i]; S[1] += w[i] * p.mean; S[2] += w[i] * p.mean * p.mean; S[3] += w[i] * p[useVar]; S[4] += w[i] * p.mean * p[useVar]; });
    const det = S[0] * S[2] - S[1] * S[1]; a = (S[0] * S[4] - S[1] * S[3]) / det; b = (S[2] * S[3] - S[1] * S[4]) / det;
    if (b < 0) { b = 0; a = S[4] / S[2]; }
    w = pts.map((p) => 1 / Math.pow(a * p.mean + b, 2));
  }
  return { a, b };
}
const lrms = (pts, f, useVar) => Math.sqrt(mean(pts.map((p) => Math.pow(Math.log10(p[useVar] / f(p)), 2))));
function refLaws(lv, useVar) {
  const pts = lv.filter((o) => o.usable), geo = (g) => Math.pow(10, mean(pts.map((p) => Math.log10(p[useVar] / g(p))))), { a, b } = wls(pts, useVar);
  const cb = geo(() => 1), cp = geo((p) => p.mean * p.mean), cs = geo((p) => p.mean);
  return { pts, a, b, cb, cp, cs, rms: { const: lrms(pts, () => cb, useVar), prop: lrms(pts, (p) => cp * p.mean * p.mean, useVar), shot: lrms(pts, (p) => cs * p.mean, useVar), affine: lrms(pts, (p) => a * p.mean + b, useVar) } };
}
function refKernel(sig) { const kh = Math.ceil(2.5 * sig), k = new Float32Array(2 * kh + 1); let s = 0; for (let u = -kh; u <= kh; u++) { k[u + kh] = Math.exp(-u * u / (2 * sig * sig)); s += k[u + kh]; } for (let u = 0; u < k.length; u++) k[u] /= s; return { k, kh }; }
function refEdgeProfile(x0) { const p = []; for (let i = 0; i < W; i++) p.push(((i + 0.25 >= x0) ? 0.5 : 0) + ((i + 0.75 >= x0) ? 0.5 : 0)); return p; }
function refEdgeNormalised(x, gam) {
  const t = []; for (let i = 0; i < W; i++) { let s = 0; for (let c = 0; c < 3; c++) for (let v = 0; v < H; v++) s += Math.pow(x[c * HW + v * W + i], gam); t.push(s / 72); }
  const lo = mean(t.slice(0, 20)), hi = mean(t.slice(W - 20)); return t.map((u) => (u - lo) / (hi - lo));
}
function refCross(t, lvl) { for (let i = 1; i < W; i++) if (t[i - 1] < lvl && t[i] >= lvl) return { i, x: (i - 1 + 0.5) + (lvl - t[i - 1]) / (t[i] - t[i - 1]) }; return { i: 0, x: NaN }; }
function refEdgeFit(x, gam) {
  const t = refEdgeNormalised(x, gam), xc = refCross(t, 0.5).i, a = xc - 6, b = xc + 6;
  const model = (sg, x0) => { const p = refEdgeProfile(x0), K = sg > 0 ? refKernel(sg) : { k: [1], kh: 0 }, out = []; for (let i = a; i <= b; i++) { let s = 0; for (let u = -K.kh; u <= K.kh; u++) s += K.k[u + K.kh] * p[Math.min(W - 1, Math.max(0, i + u))]; out.push(s); } return out; };
  const cost = (sg, x0) => { const m = model(sg, x0); let e = 0; for (let i = a; i <= b; i++) e += Math.pow(t[i] - m[i - a], 2); return e; };
  let best = Infinity, bs = 0, bx = 0;
  for (let s = 0; s <= 1.6001; s += 0.05) for (let x0 = xc - 1.5; x0 <= xc + 1.5001; x0 += 0.125) { const e = cost(s, x0); if (e < best) { best = e; bs = s; bx = x0; } }
  const s0 = bs; for (let s = Math.max(0, s0 - 0.05); s <= s0 + 0.0501; s += 0.005) { const e = cost(s, bx); if (e < best) { best = e; bs = s; } }
  return { sigma: bs, x0: bx, t, xc };
}
function refExposure(pairs) {
  const maxG = Math.max(...pairs.map((p) => p.gain)), mid = pairs.filter((p) => p.gain < maxG - 1e-9).map((p) => p.post).sort((x, y) => x - y);
  return { maxGain: maxG, target: mid[mid.length >> 1], cap: 1 - mid.length / pairs.length, minGain: Math.min(...pairs.map((p) => p.gain)) };
}
function refPairs(logs, gam) { return logs.map((f) => { let s = 0; for (let i = 0; i < f.x.length; i++) s += Math.pow(f.x[i], gam); return { gain: f.gain, post: s / f.x.length, level: s / f.x.length / f.gain }; }); }
function refCalibrate(kit, logs) {
  const gam = refGamma(kit.flats), lv = refLevels(kit.flats, gam), laws = refLaws(lv, 'var'), pts = laws.pts;
  let sk = 0, kk = 0; pts.forEach((p) => { const e = Math.pow(2, p.stop); kk += p.mean * e; sk += e * e; });
  const ed = kit.edges.map((x) => refEdgeFit(x, gam).sigma), ex = refExposure(typeof logs[0].post === 'number' ? logs : refPairs(logs, gam));
  return { gamma: gam, kappa: kk / sk, fw: 1 / laws.a, read: Math.sqrt(laws.b) / laws.a, blur: mean(ed), target: ex.target, maxGain: ex.maxGain, laws, lv, ed, ex };
}
const KITS = {};
for (const k of [1, 16, 32]) {
  const own = ownKit(k, BLOCK), logs = SV.evidence.logs(30 * k, 13800000 + 50000 * BLOCK);
  const mine = L.calibrate(L.flats(L.STOPS, k, FLAT0), L.edge(k, EDGE0), logs), ref = refCalibrate(own, logs);
  KITS[k] = { own, ref, mine };
  for (const key of ['gamma', 'kappa', 'fw', 'read', 'blur', 'target', 'maxGain']) check(Math.abs(ref[key] / mine[key] - 1) < 1e-9, 'C: own calibration equals the engine\'s at k = ' + k + ': ' + key + ' (' + ref[key] + ' vs ' + mine[key] + ')');
  // the lab's privilege: the street's true numbers
  const e = { gamma: 0.006, kappa: 0.0012, fw: 0.025, read: 0.07, blur: 0.012, target: 0.006, maxGain: 1e-9 }, truth = { gamma: RS.gamma, kappa: KAPPA, fw: RS.fw, read: RS.read, blur: RS.blur, target: RS.ae.target, maxGain: RS.ae.maxGain };
  for (const key of Object.keys(e)) check(Math.abs(ref[key] / truth[key] - 1) < (k === 1 ? 4 : 2) * e[key], 'C: k = ' + k + ' estimate of ' + key + ' ' + ref[key].toPrecision(5) + ' is within ' + (100 * e[key]).toFixed(2) + '% of the street\'s ' + truth[key]);
}
{ // the stored spread over 40 repetitions: two kit sizes recomputed with the engine (the other four are anchored by the same code), the rest checked for shape
  const r = D.estReps; check(r === 40, 'C: 40 repeated afternoons stored');
  for (const k of [1, 4]) { const rec = { fw: [], read: [], blur: [], gamma: [], kappa: [], target: [], maxGain: [] }; for (let i = 0; i < r; i++) { const kit = L.kit(k, 100 + i), e = L.calibrate(kit.flats, kit.edges, kit.logs); Object.keys(rec).forEach((f) => rec[f].push(e[f])); }
    Object.keys(rec).forEach((f) => { const m = mean(rec[f]), s = sd(rec[f]); check(Math.abs(m - D.est[k][f][0]) <= 1e-5 * Math.abs(m) + 1e-9 && Math.abs(s - D.est[k][f][1]) <= 0.01 * s + 1e-9, 'C: stored mean and spread of ' + f + ' at k = ' + k + ' (' + m + ', ' + s + ' vs ' + D.est[k][f] + ')'); }); }
  for (const k of D.kits) for (const f of ['fw', 'read', 'blur', 'gamma', 'kappa', 'target']) { const [m, s] = D.est[k][f]; const truth = { fw: RS.fw, read: RS.read, blur: RS.blur, gamma: RS.gamma, kappa: KAPPA, target: RS.ae.target }[f]; check(Math.abs(m - truth) < 4 * s / Math.sqrt(r) + 0.004 * truth, 'C: mean of ' + f + ' at k = ' + k + ' (' + m + ') is the street\'s ' + truth + ' to within sampling and a 0.4% bias'); }
  for (let i = 1; i < D.kits.length; i++) check(D.est[D.kits[i]].fw[1] < D.est[D.kits[i - 1]].fw[1] * 1.15 && D.est[D.kits[i]].blur[1] < D.est[D.kits[i - 1]].blur[1] * 1.15, 'C: the error bars of the full well and the blur shrink with the kit (' + D.kits[i] + ')');
  check(D.est[32].fw[1] < D.est[1].fw[1] / 3.5 && D.est[32].blur[1] < D.est[1].blur[1] / 3.5, 'C: 32 frames shrink the error bars by about sqrt(32)');
  put('reps', r, 0);
  for (const k of [1, 16]) { put('fw_sd_k' + k, D.est[k].fw[1], 0); put('read_sd_k' + k, D.est[k].read[1], 2); }
  put('gamma_sd_k16', D.est[16].gamma[1], 4); put('sigma_sd_k1', D.est[1].blur[1], 3); put('sigma_sd_k32', D.est[32].blur[1], 3);
  put('fw_rel_k1', pc(D.est[1].fw[1] / RS.fw), 1);
}

/* ───────────────────────────── D. the noise law by elimination (the page's kit, k = 16) ───────────────────────────── */
{
  const K = KITS[16], ref = K.ref, lv = ref.lv, laws = ref.laws, pts = laws.pts, nPix = lv[0].n;
  put('gamma_k16', ref.gamma, 3); put('kappa_k16', ref.kappa, 4); put('ev_k16', ref.kappa * ref.fw, 0); put('kappa_pct', pc(ref.kappa), 1); put('fw_k16', ref.fw, 0); put('read_k16', ref.read, 2);
  const all = refLevels(K.own.flats).filter((o) => o.usable), xs = all.map((o) => o.stop), ys = all.map((o) => Math.log2(o.dn)), mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); }); put('gamma_all', sxx / sxy, 3);
  check(lv.filter((o) => o.usable).length === 8, 'D: eight usable levels');
  put('clip0_m7', pc(lv[0].c0), 1); put('clip0_m6', pc(lv[1].c0), 1); check(lv[10].c1 === 1, 'D: at stop 3 every pixel sits at code 255');
  check(lv.every((o) => o.usable === (o.stop >= -5 && o.stop <= 2)), 'D: the usable levels are exactly stops -5 to 2');
  const man = (s) => lv.find((o) => o.stop === s).mean;
  put('man_m3', man(-3), 3); put('man_m2', man(-2), 3); put('man_m1', man(-1), 3);
  { const cfg = SV.clone(RS); [[-3, 'auto_m3'], [-2, 'auto_m2'], [-1, 'auto_m1']].forEach(([s, key]) => { const rad = new Float32Array(3 * HW).fill(Math.pow(2, s)), x = SV.sense(rad, cfg, SV.stream(11, 'auto')); put(key, mean(Array.from(x, (v) => Math.pow(v, ref.gamma))), 3); }); }
  check(F.auto_m3 > 0.11 && F.auto_m3 < 0.13 && F.auto_m2 > 0.11 && F.auto_m2 < 0.13 && F.auto_m1 > 0.11 && F.auto_m1 < 0.13, 'D: with the controller on, stops -3 to -1 all come out at the target (' + [F.auto_m3, F.auto_m2, F.auto_m1] + ')');
  put('mu_ratio', pts[pts.length - 1].mean / pts[0].mean, 0);
  put('var_min_e6', 1e6 * Math.min(...pts.map((p) => p.var)), 1);
  put('se_none', Math.min(...pts.map((p) => p.var)) / (Math.min(...pts.map((p) => p.var)) * Math.sqrt(2 / (nPix - 1))), 0);
  put('var_ratio', Math.max(...pts.map((p) => p.var)) / Math.min(...pts.map((p) => p.var)), 0);
  const dark = pts[0], bright = pts[pts.length - 1];
  put('frac_lo', pc(Math.sqrt(dark.var) / dark.mean), 0); put('frac_hi', pc(Math.sqrt(bright.var) / bright.mean), 0);
  put('shot_short', dark.var / (laws.cs * dark.mean), 1); put('shot_over', pc(laws.cs * bright.mean / bright.var - 1), 0);
  put('r_const', laws.rms.const, 2); put('r_prop', laws.rms.prop, 2); put('r_shot', laws.rms.shot, 3); put('r_affine', laws.rms.affine, 3);
  put('r_floor', Math.log10(Math.E) * Math.sqrt(2 / (nPix - 1)), 3);
  check(laws.rms.affine < 4 * F.r_floor && laws.rms.affine < laws.rms.shot / 8 && laws.rms.shot < laws.rms.prop && laws.rms.shot < laws.rms.const, 'D: the affine law is at the sampling error and the others are far above it (' + JSON.stringify(laws.rms) + ')');
  check(Math.abs(laws.rms.const - engineRms(K.mine, 'const')) < 1e-9 && Math.abs(laws.rms.affine - engineRms(K.mine, 'affine')) < 1e-9, 'D: the engine\'s rms residuals equal the own ones');
  // a brute-force grid over (a, b) cannot beat the weighted fit by more than a few per cent in the rms of the log residual
  { let best = Infinity; for (let la = Math.log10(laws.a) - 0.03; la <= Math.log10(laws.a) + 0.03; la += 0.0005) for (let lb = Math.log10(laws.b) - 0.15; lb <= Math.log10(laws.b) + 0.15; lb += 0.005) { const a = Math.pow(10, la), b = Math.pow(10, lb), r = lrms(pts, (p) => a * p.mean + b, 'var'); if (r < best) best = r; }
    check(best <= laws.rms.affine + 1e-12 && best > 0.8 * laws.rms.affine, 'D: a grid over (a, b) finds no law much better than the weighted fit (' + best.toFixed(5) + ' vs ' + laws.rms.affine.toFixed(5) + ')'); }
  // the quantiser
  put('quant_lo', pc(dark.q / dark.raw), 1); put('quant_hi', pc(bright.q / bright.raw), 1);
  const raw = wls(pts, 'raw'); put('fw_noquant', 1 / raw.a, 0); put('quant_slope', pc(raw.a * ref.fw - 1), 1);
  check(F.fw_noquant < ref.fw && Math.abs(F.fw_noquant / ref.fw - 1) > 0.01, 'D: leaving the quantiser in biases the full well low by more than a per cent');
  // two-frame differences give the same variance as the spread inside a frame
  { const fr = K.own.flats.find((f) => f.stop === 0).frames, d = []; for (let j = 0; j + 1 < fr.length; j += 2) { let s = 0; for (let i = 0; i < fr[j].length; i++) { const a = Math.pow(fr[j][i], ref.gamma) - Math.pow(fr[j + 1][i], ref.gamma); s += a * a; } d.push(s / fr[j].length / 2); }
    const spatial = lv.find((o) => o.stop === 0).raw; put('pair_diff', pc(Math.abs(mean(d) / spatial - 1)), 1); check(F.pair_diff < 2, 'D: the pair-difference variance equals the spatial variance to ' + F.pair_diff + '%'); }
  // a dark frame (lens capped): the camera has no black-level offset, so the negative half of the read noise is clipped at code 0 and the spread of what is left under-reads r
  { const dark = [0, 1, 2, 3].map((j) => SV.sense(new Float32Array(3 * HW), manualCfg(), SV.stream(77000 + j, 'dark'))); let n0 = 0, n = 0, s1 = 0, s2 = 0;
    dark.forEach((x) => { for (let i = 0; i < x.length; i++) { const q = Math.pow(x[i], ref.gamma); if (x[i] === 0) n0++; s1 += q; s2 += q * q; n++; } });
    const m = s1 / n, v = s2 / n - m * m; put('dark_clip', pc(n0 / n), 0); put('dark_read', ref.fw * Math.sqrt(v), 1); check(F.dark_read < 0.75 * RS.read && F.dark_clip > 40, 'D: a dark frame under-reads the read noise (' + F.dark_read + ' of ' + RS.read + ', ' + F.dark_clip + '% of its pixels at code 0)'); }
  // the saturation knee
  put('knee', Math.log2(1 / ref.kappa), 2); check(F.knee > 2 && F.knee < 3, 'D: the unit card saturates between stops 2 and 3');
}
function engineRms(est, key) { return est.law.rms[key]; }

/* ───────────────────────────── E. the edge ───────────────────────────── */
{
  const K = KITS[32], gam = K.ref.gamma, widths = [], fits = K.own.edges.map((x) => refEdgeFit(x, gam).sigma);
  K.own.edges.forEach((x) => { const t = refEdgeNormalised(x, gam); widths.push(refCross(t, 0.9).x - refCross(t, 0.1).x); });
  const phiInv = (p) => { let lo = -8, hi = 8; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (ownPhi(mid) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  put('k1090', 2 * phiInv(0.9), 3); check(Math.abs(F.k1090 - 2.563) < 1e-3, 'E: the 10-90 rise of a Gaussian edge response is 2.563 sigma');
  put('ed_frames', K.own.edges.length, 0);
  put('naive_sigma', mean(widths) / (2 * phiInv(0.9)), 2); put('naive_sd', sd(widths) / (2 * phiInv(0.9)), 2); put('naive_over', pc(mean(widths) / (2 * phiInv(0.9)) / mean(fits) - 1), 0);
  put('width_1090', mean(widths), 2);
  check(Math.abs(mean(fits) - RS.blur) < 0.01 && F.naive_over > 10, 'E: the synthesis fit recovers the blur (' + mean(fits).toFixed(4) + ') and the 10-90 reading is wider than it by ' + F.naive_over + '%');
  put('sigma_k1', refEdgeFit(KITS[1].own.edges[0], gam).sigma, 3);
}
function ownPhi(x) {                                                      // normal distribution function by Simpson's rule on the density (independent of L.Phi)
  const n = 2000, a = 0, b = Math.abs(x), h = (b - a) / n, f = (t) => Math.exp(-t * t / 2) / Math.sqrt(2 * Math.PI);
  let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  const half = s * h / 3; return x >= 0 ? 0.5 + half : 0.5 - half;
}

/* ───────────────────────────── F. the exposure log ───────────────────────────── */
{
  const logs = SV.evidence.logs(1000), gam = CAMERA.gamma, pairs = refPairs(logs, gam);
  check(pairs.every((p, i) => Math.abs(p.gain - D.street.gain[i]) < 6e-5 && Math.abs(p.post - D.street.post[i]) < 6e-6), 'F: the stored street log is the series\' 1,000 shared logs');
  const lawGain = (rad) => { let s = 0; for (let i = 0; i < rad.length; i++) s += rad[i]; return Math.min(RS.ae.maxGain, Math.max(1, RS.ae.target / (KAPPA * s / rad.length))); };
  const aaba = SV.hybrid(SV.SIM0, SV.REAL, { sensor: 'b' }), prog = [];
  for (let i = 0; i < 1000; i++) { const s = 13900000 + i, f = SV.sample(aaba, s), rad = SV.render(f.scene, f.look, { maps: false }).rad; let a = 0; for (let j = 0; j < f.x.length; j++) a += Math.pow(f.x[j], gam); prog.push({ gain: lawGain(rad), post: a / f.x.length }); }
  check(prog.every((p, i) => Math.abs(p.gain - D.prog.gain[i]) < 6e-5 && Math.abs(p.post - D.prog.post[i]) < 6e-6), 'F: the stored program log is recomputed from the renderer and the controller law');
  const sg = pairs.map((p) => p.gain), pg = prog.map((p) => p.gain), sl = pairs.map((p) => p.post / p.gain), pl = prog.map((p) => p.post / p.gain);
  put('gain_max', Math.max(...sg), 1); put('gain_min', Math.min(...sg), 2); put('gain_med', quantile(sg, 0.5), 1); put('cap_share', pc(sg.filter((g) => g > 7.999).length / 1000), 1);
  put('pgain_min', Math.min(...pg), 2); put('pgain_max', Math.max(...pg), 2); put('pgain_med', quantile(pg, 0.5), 2); put('pcap_share', pc(pg.filter((g) => g > 7.999).length / 1000), 0);
  put('lvl_med', quantile(sl, 0.5), 4); put('plvl_med', quantile(pl, 0.5), 4); put('plvl_lo', Math.min(...pl), 4); put('plvl_hi', Math.max(...pl), 4); put('lvl_min', Math.min(...sl), 4); put('lvl_max', Math.max(...sl), 4);
  put('med_stops', Math.log2(F.plvl_med / F.lvl_med), 1);
  put('spread_street', Math.log2(quantile(sl, 0.95) / quantile(sl, 0.05)), 1); put('spread_prog', Math.log2(quantile(pl, 0.95) / quantile(pl, 0.05)), 1);
  put('share_dark', pc(sl.filter((v) => v < quantile(pl, 0.01)).length / 1000), 1);
  check(F.gain_max === 8 && F.gain_min > 1.5 && F.pgain_min > 1.5 && F.pgain_max < 3, 'F: street gains run from about 1.9 to the cap, program gains stay near 2');
  check(F.share_dark > 95, 'F: nearly every street frame is darker than the program\'s darkest per cent');
  const eMed = F.lvl_med * RS.fw, eQ05 = quantile(sl, 0.05) * RS.fw, ePrg = F.plvl_med * RS.fw, snr = (e) => e / Math.sqrt(e + RS.read * RS.read);
  put('e_med', eMed, 0); put('snr_med', snr(eMed), 1); put('snr_q05', snr(eQ05), 1); put('snr_prog', snr(ePrg), 1); put('e_prog', ePrg, 0);
  // the target from the first 30 and the first 960 logged frames (what the widget shows at k = 1 and k = 32)
  put('target_k1', refExposure(pairs.slice(0, 30)).target, 4); put('target_k32', refExposure(pairs.slice(0, 960)).target, 4);
  put('cap_target', RS.ae.target / RS.ae.maxGain, 4);
}

/* ───────────────────────────── G. the price of the parts ───────────────────────────── */
{
  const v = (code) => { const m = code === '' ? T.swap.aaaa.realMiss : code === 'NBA' ? T.swap.aaba.realMiss : D.abl[code].realMiss; return 1 - mean(m); };
  check(['N', 'B', 'A', 'NB', 'NA', 'BA'].every((c) => D.abl[c].realMiss.length === 3), 'G: three seeds in every switched-parts cell');
  const parts = ['N', 'B', 'A'], codeOf = (set) => parts.filter((p, i) => set[i]).join(''), phi = [0, 0, 0];
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  orders.forEach((o) => { const set = [false, false, false]; o.forEach((i) => { const before = v(codeOf(set)); set[i] = true; phi[i] += (v(codeOf(set)) - before) / orders.length; }); });
  put('phi_N', pc(phi[0]), 1); put('phi_B', pc(phi[1]), 1); put('phi_A', pc(phi[2]), 1);
  check(Math.abs(pc(phi[0] + phi[1] + phi[2]) - (miss('aaaa') - miss('aaba'))) < 1e-9, 'G: the three prices add up to the whole gain');
  for (const c of ['N', 'B', 'A', 'NB', 'NA', 'BA']) { put('m_' + c, pc(1 - v(c)), 1); put('g_' + c, pc(v(c) - v('')), 1); }
  put('blur_with_noise', pc(v('NB') - v('N')), 1);
  for (const c of ['N', 'NB', 'NA']) put('a_' + c, pc(mean(D.abl[c].logsAlarm)), 0);
  check(F.phi_N > 0.6 * F.step1 && Math.abs(F.phi_A) < 1.5, 'G: the noise carries most of the camera\'s price and the exposure controller almost none under the program\'s light');
  put('ae_noon', pc(v('NBA') - v('NB')), 1);
  if (D.abl['NB@b']) { put('m_NBb', pc(mean(D.abl['NB@b'].realMiss)), 1); put('m_abba', miss('abba'), 1); put('ae_street', F.m_NBb - F.m_abba, 1); }
}

/* ───────────────────────────── H. one calibrated cell, and the contrast-to-noise table, recomputed from scratch ───────────────────────────── */
const r5 = (x) => +Number(x).toPrecision(5);
const REALSETS = {};
const real = () => REALSETS.t || (REALSETS.t = { test: SV.real.test(3000), val: SV.real.val(1500) });
if (!process.env.FAST) {
  const k = 4, seed = 2, own = ownKit(k, seed), logs = SV.evidence.logs(30 * k, 13800000 + 50000 * seed), est = refCalibrate(own, logs);
  const cam = { ev: est.kappa * est.fw, fw: est.fw, read: est.read, blur: est.blur, gamma: est.gamma, bits: 8, ae: { target: est.target, maxGain: est.maxGain } };
  const pipe = SV.hybrid(SV.SIM0, SV.REAL, {}), all = { noise: true, blur: true, ae: true };
  const m0 = SV.train(L.makeSet(pipe, cam, all, 1600, SV.SEEDS.train + seed * 100000), { seed });
  const model = { dim: m0.dim, w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) }, R = real();
  const score = (s) => SV.score(model, s.x).s, sT = R.test.map(score), sV = R.val.map(score);
  const negV = sV.filter((_, i) => !R.val[i].y).sort((a, b) => a - b), thr = negV[Math.floor(0.9 * negV.length)];
  let hits = 0, tot = 0; R.test.forEach((s, i) => { if (s.y && s.area >= 6) { tot++; if (sT[i] > thr) hits++; } });
  const c = 1 - hits / tot; put('cell_own', pc(c), 1);
  check(Math.abs(c - D.cal['4'].realMiss[seed - 1]) < 1e-4, 'H: calibrated k = 4 seed 2, recomputed from the evidence on: own miss ' + c.toFixed(4) + ' vs table ' + D.cal['4'].realMiss[seed - 1]);
  check(Math.abs(thr - D.cal['4'].thrReal[seed - 1]) < 1e-3, 'H: the real threshold of that cell agrees (' + thr.toFixed(4) + ' vs ' + D.cal['4'].thrReal[seed - 1] + ')');
}
{ // the contrast-to-noise table
  const R = real(), cnrCam = { gamma: 2.2, fw: 4000, read: 3 };
  const ownCnr = (x, cov, gain) => {                                      // own: the ring is found pixel by pixel as 'within two pixels (Chebyshev) of the mask, not in it, not touched by the pedestrian at all'
    const inP = (i) => cov[i] >= 0.5; let d2 = 0;
    const P = [], Rg = []; for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { const i = v * W + u; if (inP(i)) { P.push(i); continue; } if (cov[i] !== 0) continue; let near = false; for (let dv = -2; dv <= 2 && !near; dv++) for (let du = -2; du <= 2 && !near; du++) { const uu = u + du, vv = v + dv; if (uu >= 0 && uu < W && vv >= 0 && vv < H && inP(vv * W + uu)) near = true; } if (near) Rg.push(i); }
    if (!P.length || Rg.length < 3) return NaN;
    for (let c = 0; c < 3; c++) { const mp = mean(P.map((i) => Math.pow(x[c * HW + i], 2.2))), mr = mean(Rg.map((i) => Math.pow(x[c * HW + i], 2.2))), s2 = (gain / 4000) * Math.max(mp, 1e-6) + Math.pow(gain * 3 / 4000, 2); d2 += P.length * Math.pow(mp - mr, 2) / s2 - 1 - P.length / Rg.length; }
    return Math.sqrt(Math.max(d2, 0));
  };
  const lawGain = (rad) => { let s = 0; for (let i = 0; i < rad.length; i++) s += rad[i]; return Math.min(8, Math.max(1, 0.12 / (0.15 * s / rad.length))); };
  const cells = 576, p = 1 - Math.pow(0.9, 1 / cells); let z; { let lo = 0, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (1 - ownPhi(m) > p) lo = m; else hi = m; } z = (lo + hi) / 2; }
  put('cnr_z', z, 2); check(Math.abs(z - D.cnr.z) < 1e-3, 'H: the ideal-observer threshold z = ' + z.toFixed(3) + ' (stored ' + D.cnr.z.toFixed(3) + ')');
  put('cnr_pcell', 1e4 * p, 1);
  const rows = []; R.test.forEach((f) => { if (!(f.y && f.area >= 6)) return; const g = lawGain(SV.render(f.scene, f.look, { maps: false }).rad), c = ownCnr(f.x, f.cov, g); if (isFinite(c)) rows.push({ f, g, c, e: L.cnr(f.x, f.cov, g, cnrCam) }); });
  check(rows.every((r) => Math.abs(r.c - r.e) < 1e-9), 'H: the engine\'s CNR equals the own CNR on every exam pedestrian');
  check(rows.length === D.cnr.n && rows.length === 1323, 'H: 1,323 exam pedestrians have a CNR (' + rows.length + ')');
  const miss = {}; for (const key of ['aaba', 'bbbb']) { const m = T.models['swap@' + key], model = { dim: 110, w: m.w, mu: m.mu, sd: m.sd }; miss[key] = rows.map((r) => (SV.score(model, r.f.x).s > m.thrReal ? 0 : 1)); }
  const bins = D.cnr.bins; let ok = true;
  for (let b = 0; b + 1 < bins.length; b++) {
    const idx = []; rows.forEach((r, i) => { if (r.c >= bins[b] && r.c < bins[b + 1]) idx.push(i); });
    const m = (g) => idx.reduce((s, i) => s + g(i), 0) / idx.length, nb = idx.length;
    if (nb !== D.cnr.nBin[b] || Math.abs(m((i) => 1 - ownPhi(rows[i].c - z)) - D.cnr.bound[b]) > 2e-4 || Math.abs(m((i) => miss.aaba[i]) - D.cnr.aaba[b]) > 1e-4 || Math.abs(m((i) => miss.bbbb[i]) - D.cnr.bbbb[b]) > 1e-4) { ok = false; console.error('H: bin ' + b + ' differs', nb, D.cnr.nBin[b]); }
    put('cn_n' + b, nb, 0); put('cn_bound' + b, pc(m((i) => 1 - ownPhi(rows[i].c - z))), 0); put('cn_aaba' + b, pc(m((i) => miss.aaba[i])), 0); put('cn_bbbb' + b, pc(m((i) => miss.bbbb[i])), 0); put('cn_gain' + b, m((i) => rows[i].g), 1); put('cn_area' + b, m((i) => rows[i].f.area), 0);
  }
  check(ok, 'H: the stored CNR table equals the recomputed one');
  put('cn_all_bound', pc(mean(rows.map((r) => 1 - ownPhi(r.c - z)))), 1); put('cn_all_aaba', pc(mean(miss.aaba)), 1); put('cn_all_bbbb', pc(mean(miss.bbbb)), 1);
  check(Math.abs(F.cn_all_aaba - pc(T.swap.aaba.realMiss[0])) < 0.05 && Math.abs(F.cn_all_bbbb - pc(T.swap.bbbb.realMiss[0])) < 0.05, 'H: the miss rates over the exam pedestrians are the table cells (seed 1)');
  put('below4', pc(rows.filter((r) => r.c < 4).length / rows.length), 0); put('below8', pc(rows.filter((r) => r.c < 8).length / rows.length), 0);
  // the CNR at which the street-trained detector finds half: linear interpolation of its miss rate between the bins' mean CNR
  const mids = []; for (let b = 0; b + 1 < bins.length; b++) { const idx = []; rows.forEach((r, i) => { if (r.c >= bins[b] && r.c < bins[b + 1]) idx.push(i); }); mids.push([mean(idx.map((i) => rows[i].c)), mean(idx.map((i) => miss.bbbb[i]))]); }
  let half = NaN; for (let i = 1; i < mids.length; i++) if (mids[i - 1][1] >= 0.5 && mids[i][1] < 0.5) half = mids[i - 1][0] + (mids[i - 1][1] - 0.5) / (mids[i - 1][1] - mids[i][1]) * (mids[i][0] - mids[i - 1][0]);
  put('cnr_half', half, 0); put('cnr_x', half / z, 1); put('cn_all_n', rows.length, 0); check(isFinite(half), 'H: the street-trained detector\'s miss rate crosses one half');
  put('cn_low_bbbb', pc(mean(rows.map((r, i) => (r.c < 8 ? miss.bbbb[i] : null)).filter((x) => x !== null))), 0);
}

/* ───────────────────────────── I. motion, by brute force with the lab's renderer ───────────────────────────── */
{
  const f = SV.sample(SV.SIM0, 13950000, { ped: true }), ped = f.scene.ped, z = ped.parts[1].z, v = 1.5, t = 0.01;
  const covAt = (dx, o) => { const sc = Object.assign({}, f.scene, { parts: f.scene.parts.map((p) => (p.cls === 'ped' ? Object.assign({}, p, { x: p.x + dx }) : p)) }); return SV.render(sc, f.look, Object.assign({ only: 'ped', maps: false }, o)).cov; };
  const centroid = (cov) => { let s = 0, m = 0; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { s += cov[j * W + i]; m += cov[j * W + i] * (i + 0.5); } return m / s; };
  const fine = { SSh: 256, SSv: 1 };                                      // 256 rays across each pixel, so that the coverage is not quantised
  const dxTest = 4 * z / CAM.f;                                           // a sideways step that the law says moves the image by exactly 4 pixels (a whole number, so that the pixel centroid is exact)
  const meas = centroid(covAt(dxTest, fine)) - centroid(covAt(0, fine)), pred = CAM.f * dxTest / z;
  put('mo_dx', dxTest, 2); put('mo_meas', meas, 2); put('mo_pred', pred, 2);
  check(Math.abs(meas / pred - 1) < 0.005, 'I: the image of the pedestrian moves f dx / Z pixels (' + meas.toFixed(5) + ' vs ' + pred.toFixed(5) + ')');
  // the smear: average the renders along a longer exposure (1 s, so that it is several pixels) and measure how much wider the support of the averaged image is
  const extent = (cov) => { let lo = W, hi = -1; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (cov[j * W + i] > 0.002) { lo = Math.min(lo, i); hi = Math.max(hi, i); } return hi - lo + 1; };
  const steps = 41, avg = new Float32Array(HW); for (let q = 0; q < steps; q++) { const c = covAt(v * 1.0 * q / (steps - 1), { SSh: 4, SSv: 1 }); for (let i = 0; i < HW; i++) avg[i] += c[i] / steps; }
  const smear = extent(avg) - extent(covAt(0, { SSh: 4, SSv: 1 })), want = CAM.f * v * 1.0 / z;
  check(Math.abs(smear - want) <= 1.5, 'I: averaged over an exposure the image is wider by the distance it moves (' + smear + ' px vs ' + want.toFixed(2) + ')');
  put('mo_ped', CAM.f * 1.5 * 0.01 / 8, 2); const fhd = 960 / Math.tan(30 * Math.PI / 180); put('f_hd', fhd, 0); put('mo_ped_hd', fhd * 1.5 * 0.01 / 8, 1);
  put('mo_shuttle', 48 * 10 * 0.01 / 8, 2); put('mo_shuttle_hd', 960 * 10 * 0.01 / 8, 0);
  check(F.mo_ped < 0.5 && F.mo_ped_hd > 2, 'I: sub-pixel at 96 px, several pixels at 1,920');
}

/* ───────────────────────────── the checkpoint exercise ───────────────────────────── */
{
  const p1 = [0.02, 1.4e-5], p2 = [0.20, 1.04e-4], slope = (p2[1] - p1[1]) / (p2[0] - p1[0]), icpt = p1[1] - slope * p1[0], fw = 1 / slope, read = fw * Math.sqrt(icpt), e = p1[0] * fw;
  put('ck_slope4', slope * 1e4, 1); put('ck_fw', fw, 0); put('ck_icpt', icpt * 1e6, 3); put('ck_read', read, 1); put('ck_e', e, 0); put('ck_snr', e / Math.sqrt(e + read * read), 1);
  check(Math.abs(fw - 2000) < 1e-6 && Math.abs(read - 4) < 1e-9, 'the checkpoint camera has fw 2,000 and r 4');
  // the same pixel at gain 8: signal and noise both multiply by 8, the ratio stays
  const g = 8, sig = g * e / fw, noise = g * Math.sqrt(e + read * read) / fw; check(Math.abs(sig / noise - F.ck_snr) < 0.05, 'the gain multiplies signal and noise together');
}

/* ───────────────────────────── J. the widget ───────────────────────────── */
const htmlPath = path.join(root, dir, '03_the_camera_is_a_measurement.html');
function recorder(canvas) {                                               // a 2-D context that records every string drawn on it
  const texts = [], store = { canvas }, ctx = new Proxy(store, {
    get(t, k) { if (k === 'fillText') return (s, x, y) => { texts.push({ s: String(s), x, y, font: t.font }); }; if (k in t) return t[k]; if (k === 'measureText') return (s) => ({ width: String(s).length * 6.2 }); if (k === 'getLineDash') return () => []; if (typeof k === 'symbol') return undefined; return () => {}; },
    set(t, k, v) { t[k] = v; return true; } });
  return { ctx, texts };
}
if (fs.existsSync(htmlPath)) {
  const page = loadPage(htmlPath, { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'J: the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const cvs = page.el('w03-canvas'), rec = recorder(cvs); cvs.__ctx = rec.ctx;
  const grp = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pctS = (x) => (100 * x).toFixed(1) + '%';
  const fix = D.fix, base = SV.sample(SV.SIM0, fix, { ped: true }), rad0 = SV.render(base.scene, base.look).rad;
  const kitOf = (k) => KITS[k] || { ref: refCalibrate(ownKit(k, BLOCK), SV.evidence.logs(30 * k, 13800000 + 50000 * BLOCK)) };
  const ownRatio = (rad) => { let s = 0; for (let i = 0; i < rad.length; i++) s += rad[i]; return s / rad.length; };
  /* the page's readouts at a kit size, against the own calibration (the page's logs are the stored street frames: the first 30 k of the shared 1,000) */
  const storedPairs = D.street.gain.map((g, i) => ({ gain: g, post: D.street.post[i], level: D.street.post[i] / g }));
  function readoutsAt(k, ki) {
    page.set('w03-k', ki); const ref = refCalibrate(ownKit(k, BLOCK), storedPairs.slice(0, 30 * k));
    check(page.text('w03-fw') === grp(ref.fw) + ' ± ' + grp(D.est[k].fw[1]), 'J: k = ' + k + ' full well readout "' + page.text('w03-fw') + '" vs own ' + grp(ref.fw));
    check(page.text('w03-rd') === ref.read.toFixed(2) + ' ± ' + D.est[k].read[1].toFixed(2), 'J: k = ' + k + ' read-noise readout "' + page.text('w03-rd') + '" vs own ' + ref.read.toFixed(2));
    check(page.text('w03-gm') === ref.gamma.toFixed(3), 'J: k = ' + k + ' gamma readout');
    check(page.text('w03-bl') === ref.blur.toFixed(3) + ' ± ' + D.est[k].blur[1].toFixed(3), 'J: k = ' + k + ' blur readout "' + page.text('w03-bl') + '" vs own ' + ref.blur.toFixed(3));
    check(page.text('w03-ae') === ref.target.toFixed(4) + ' · ' + ref.maxGain.toFixed(1), 'J: k = ' + k + ' exposure readout "' + page.text('w03-ae') + '" vs own ' + ref.target.toFixed(4));
    check(page.text('w03-ms') === pctS(mean(D.cal[k].realMiss)) + ' · ' + pctS(mean(T.swap.aaba.realMiss)), 'J: k = ' + k + ' miss readout');
    put('w_fw_k' + k, ref.fw, 0); put('w_rd_k' + k, ref.read, 2); put('w_gm_k' + k, ref.gamma, 3); put('w_bl_k' + k, ref.blur, 3); put('w_tg_k' + k, ref.target, 4);
    return ref;
  }
  const refs = {}; D.kits.forEach((k, ki) => { refs[k] = readoutsAt(k, ki); });
  put('true_fw', RS.fw, 0); put('true_read', RS.read, 0); put('true_blur', RS.blur, 1); put('true_gamma', RS.gamma, 1); put('true_target', RS.ae.target, 2); put('true_cap', RS.ae.maxGain, 0);
  put('sd_ratio_fw', D.est[1].fw[1] / D.est[32].fw[1], 1);
  /* the exposure panel and the other modes run without error */
  page.set('w03-k', 0); ['edge', 'exposure', 'noise'].forEach((m) => { page.set('w03-mode', m); check(page.problems.length === 0, 'J: mode ' + m + ' runs: ' + page.problems.slice(0, 2).join(' | ')); });
  /* the light slider: gain and CNR against own computations from the radiance of the scene */
  const ref1 = refs[1], cam = { ev: ref1.kappa * ref1.fw, fw: ref1.fw, read: ref1.read, blur: ref1.blur, gamma: ref1.gamma, bits: 8, ae: { target: ref1.target, maxGain: ref1.maxGain } };
  const ownCnrFrame = (x, cov, gain, camE) => {                          // the page's CNR: own ring search
    const inP = (i) => cov[i] >= 0.5, P = [], Rg = []; let d2 = 0;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { const i = v * W + u; if (inP(i)) { P.push(i); continue; } if (cov[i] !== 0) continue; let near = false; for (let dv = -2; dv <= 2 && !near; dv++) for (let du = -2; du <= 2 && !near; du++) { const uu = u + du, vv = v + dv; if (uu >= 0 && uu < W && vv >= 0 && vv < H && inP(vv * W + uu)) near = true; } if (near) Rg.push(i); }
    for (let c = 0; c < 3; c++) { const mp = mean(P.map((i) => Math.pow(x[c * HW + i], camE.gamma))), mr = mean(Rg.map((i) => Math.pow(x[c * HW + i], camE.gamma))), s2 = gain / camE.fw * Math.max(mp, 1e-6) + Math.pow(gain * camE.read / camE.fw, 2); d2 += P.length * Math.pow(mp - mr, 2) / s2 - 1 - P.length / Rg.length; }
    return Math.sqrt(Math.max(d2, 0));
  };
  const cnrAt = [], gainAt = [];
  for (let li = 0; li <= 10; li++) {
    page.set('w03-light', li); const light = li / 2, rad = rad0.map((v) => v * Math.pow(2, -light));
    const gain = Math.min(cam.ae.maxGain, Math.max(1, cam.ae.target / (cam.ev * ownRatio(rad) / cam.fw))), x = L.sense(rad, cam, SV.stream(fix, 'cal'), { noise: true, blur: true, ae: true }), c = ownCnrFrame(x, base.cov, gain, cam);
    check(page.text('w03-gn') === gain.toFixed(2), 'J: light ' + light + ' stops: gain readout "' + page.text('w03-gn') + '" vs own ' + gain.toFixed(2));
    check(page.text('w03-cr') === c.toFixed(1) + ' (ideal observer finds ' + Math.round(100 * ownPhi(c - F.cnr_z)) + '%)', 'J: light ' + light + ' stops: CNR readout "' + page.text('w03-cr') + '" vs own ' + c.toFixed(1));
    gainAt.push(gain); cnrAt.push(c);
  }
  for (const li of [0, 2, 4, 6, 8, 10]) { put('gain_l' + li / 2, gainAt[li], 2); put('cnr_l' + li / 2, cnrAt[li], 1); put('bound_l' + li / 2, pc(ownPhi(cnrAt[li] - F.cnr_z)), 0); }
  put('cnr_r1', cnrAt[2] / cnrAt[0], 2); put('cnr_r4', cnrAt[8] / cnrAt[6], 2);
  // each stop halves the signal and divides the noise by sqrt 2 (photons) to 1 (read noise): the ratio of the CNR lies between 1/2 and 1/sqrt 2 (before the correction for the noise's own share matters, at CNR of a few)
  check(cnrAt[2] / cnrAt[0] > 0.5 && cnrAt[2] / cnrAt[0] < Math.SQRT1_2 && cnrAt[8] / cnrAt[6] > 0.5 && cnrAt[8] / cnrAt[6] < Math.SQRT1_2, 'J: the CNR ratio per stop lies in (1/2, 1/sqrt 2) at the first and the fourth stop: ' + cnrAt[2] / cnrAt[0] + ' ' + cnrAt[8] / cnrAt[6]);
  put('cap_stops', Math.log2(cam.ae.target / cam.ae.maxGain / (cam.ev * ownRatio(rad0) / cam.fw)), 1);
  page.set('w03-light', 0);
  /* the verdicts drawn under the three pictures, by the page, against the detector scores recomputed here */
  const boxOf = () => { let b = [W, 0, H, 0]; for (let q = 0; q < HW; q++) if (base.cov[q] > 0.5) { const u = q % W, v = (q - u) / W; b = [Math.min(b[0], u), Math.max(b[1], u), Math.min(b[2], v), Math.max(b[3], v)]; } return b; }, BOX = boxOf();
  const modelsFor = { ideal: [T.models['swap@aaaa'], T.models['swap@aaaa'].thrOwn], cal: [D.model, D.cal['16'].thrOwn[0]] };
  const verdictsAt = (det, li) => {
    page.set('w03-det', det); page.set('w03-light', li); rec.texts.length = 0; page.fire('w03-light', 'change');
    const light = li / 2, rad = rad0.map((v) => v * Math.pow(2, -light)), refE = refs[1];
    const imgs = [SV.sense(rad, SV.SIM0.sensor, SV.stream(fix, 'ideal')), L.sense(rad, cam, SV.stream(fix, 'cal'), { noise: true, blur: true, ae: true }), L.streetSense(rad, SV.stream(fix, 'street'))];
    const [m, thr] = modelsFor[det], model = { dim: 110, w: m.w, mu: m.mu, sd: m.sd }, shown = rec.texts.filter((t) => / · (found|alarm elsewhere|missed)$/.test(t.s)).sort((a, b) => a.x - b.x).map((t) => t.s), out = [];
    imgs.forEach((img, i) => { const sc = SV.score(model, img), iu = sc.cell % sc.nu, jv = Math.floor(sc.cell / sc.nu), cu = Math.min(W - 1, 2 * iu + 1), cv = Math.min(H - 1, 2 * jv + 1), on = cu >= BOX[0] - 3 && cu <= BOX[1] + 3 && cv >= BOX[2] - 3 && cv <= BOX[3] + 3, hit = sc.s > thr;
      const want = sc.s.toFixed(1) + (hit ? ' > ' : ' ≤ ') + thr.toFixed(1) + ' · ' + (hit ? (on ? 'found' : 'alarm elsewhere') : 'missed'); out.push({ score: sc.s, thr, hit, on, text: want });
      check(shown[i] === want, 'J: ' + det + ' detector, ' + light + ' stops, picture ' + i + ': the page draws "' + shown[i] + '", the oracle computes "' + want + '"'); });
    return out;
  };
  const vId = verdictsAt('ideal', 0), vCal = verdictsAt('cal', 0);
  ['ideal', 'cal'].forEach((det, di) => { const v = di ? vCal : vId; ['ideal', 'calibrated', 'street'].forEach((nm, i) => { put('v_' + det + '_' + nm + '_score', v[i].score, 1); put('v_' + det + '_' + nm + '_found', v[i].hit && v[i].on ? 1 : 0, 0); put('v_' + det + '_' + nm + '_alarm', v[i].hit ? 1 : 0, 0); }); });
  put('v_ideal_thr', vId[0].thr, 1); put('v_cal_thr', vCal[0].thr, 1);
  const vDim = verdictsAt('ideal', 6); put('v_dim_street_score', vDim[2].score, 1);
  // the experiments of the paragraph after the widget
  check(vId.every((v) => v.hit && v.on), 'J: the ideal-sensor detector finds the pedestrian in all three pictures at noon');
  check(vDim[0].hit && vDim[0].on && vDim[1].hit && !vDim[1].on && vDim[2].hit && !vDim[2].on, 'J: at 3 stops the ideal-sensor detector finds him in its own picture and raises an alarm elsewhere on the other two');
  const vCal6 = verdictsAt('cal', 6); check(vCal6.every((v) => v.hit && v.on), 'J: the calibrated detector finds him in all three pictures at 3 stops');
  page.set('w03-det', 'ideal'); page.set('w03-light', 0);
  /* switching a part off changes the picture and the selected bar; the page must survive every combination */
  [[false, true, true], [true, false, true], [true, true, false], [false, false, false]].forEach(([n, b2, a]) => { page.check('w03-cn', n); page.check('w03-cb', b2); page.check('w03-ca', a); check(page.problems.length === 0, 'J: parts ' + [n, b2, a] + ' run: ' + page.problems.slice(0, 2).join(' | ')); });
  page.check('w03-cn', true); page.check('w03-cb', true); page.check('w03-ca', true);
  // the first slider changes what the reader sees
  page.set('w03-k', 0); const t0 = page.text('w03-fw'); page.set('w03-k', 5); check(page.text('w03-fw') !== t0 && page.text('w03-k-v') === '32', 'J: the main slider changes the readouts');
  check(page.problems.length === 0, 'J: the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}

if (bad) { console.error(bad + ' check(s) failed'); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
