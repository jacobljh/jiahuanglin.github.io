/* l03_camera.js — Lesson 3 (the camera is a measurement): the evidence a project can collect about a camera, the estimators that read a camera's parameters off that evidence,
 * and the program-side sensor with a switch for each of its three parts.  Load after street.js and evidence.js; browser and node.  Everything is under SV.l03; nothing in SV is changed.
 *
 * Evidence (what the lab hands over; each function builds frames through the street's camera and returns only the frames, as a camera would):
 *   L.flats(stops, n, seed0)   a card of radiance 2^stop (the unit is declared: a card of unit radiance under the program's unit light), n frames per level, MANUAL mode (gain 1, no auto-exposure)
 *   L.edge(n, seed0)           n frames of a printed step target at a sub-pixel position the estimator is not told, manual mode
 *   SV.evidence.logs(n, seed0) the exposure log (evidence.js): unlabelled frames and the gain the camera chose for each
 * Estimators (pure functions of those frames):  fitGamma, levels, fitLaw, fitEdge, exposurePairs, fitExposure, calibrate.
 * The program side:  L.sense(rad, cam, rng, sw) is SV.sense with a switch for noise, blur and auto-exposure (all on = SV.sense, bit for bit);  L.sample / L.makeSet draw program frames through it.
 * L.cnr is the contrast-to-noise ratio of a pedestrian that the calibrated noise law predicts. */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l03 = L;
var CAM = SV.CAM, W = CAM.W, H = CAM.H, HW = W * H, N3 = 3 * HW;

/* the ladder of exposures: doublings of a card of unit radiance, from far too dark to saturated */
L.STOPS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3];
/* the printed step target: radiance of the black and the white side (the lamp is two stops above the unit card) */
L.EDGE = { lo: 0.1, hi: 2 };
/* an evidence kit of size k: k frames at each of the 11 exposure levels, k frames of the edge target, 30 k frames of the exposure log */
L.LOGS_PER_K = 30;

/* ───────────────────────────── evidence (the lab plays the street's camera) ───────────────────────────── */
function manual() { var c = SV.clone(SV.REAL.sensor); delete c.ae; return c; }              // the street's camera in manual mode: gain 1, no auto-exposure
L.flats = function (stops, n, seed0) {
  var cfg = manual(), out = [];
  stops.forEach(function (s, si) {
    var rad = new Float32Array(N3).fill(Math.pow(2, s)), fr = [];
    for (var j = 0; j < n; j++) fr.push(SV.sense(rad, cfg, SV.stream(seed0 + si * 1000 + j, 'flat')));
    out.push({ stop: s, frames: fr });
  });
  return out;
};
/* radiance of the step target as the program's renderer integrates it: 2 rays across each pixel, the edge at column position x0 */
L.edgeProfile = function (x0) {
  var p = new Float32Array(W), i, a;
  for (i = 0; i < W; i++) { var s = 0; for (a = 0; a < 2; a++) if (i + (a + 0.5) / 2 >= x0) s += 0.5; p[i] = s; }
  return p;
};
L.edge = function (n, seed0) {
  var cfg = manual(), out = [], e = L.EDGE;
  for (var j = 0; j < n; j++) {
    var x0 = 36 + 24 * SV.stream(seed0 + j, 'edge')(), p = L.edgeProfile(x0), rad = new Float32Array(N3);
    for (var c = 0; c < 3; c++) for (var v = 0; v < H; v++) for (var u = 0; u < W; u++) rad[c * HW + v * W + u] = e.lo + (e.hi - e.lo) * p[u];
    out.push(SV.sense(rad, cfg, SV.stream(seed0 + j, 'sensor')));
  }
  return out;
};
/* the street's camera applied to a radiance image: a lab privilege (a project cannot choose the radiance its camera sees) */
L.streetSense = function (rad, rng) { return SV.sense(rad, SV.REAL.sensor, rng); };
/* the three kinds of evidence of kit size k, from the evidence block s (disjoint seeds for disjoint afternoons) */
L.kit = function (k, s) { return { flats: L.flats(L.STOPS, k, 13000000 + 50000 * s), edges: L.edge(k, 13400000 + 50000 * s), logs: SV.evidence.logs(L.LOGS_PER_K * k, 13800000 + 50000 * s) }; };

/* ───────────────────────────── estimators ───────────────────────────── */
/* per exposure level: the mean code, the share of pixels at the two extreme codes, and (given gamma) the mean and the variance of the linearised value q = DN^gamma.
 * The variance is taken inside each frame (the lab's pixels are identical; a real sensor's fixed pattern is removed by subtracting two frames) and corrected for the quantiser:
 * a code step of 1/255 in DN is a step of gamma * DN^(gamma-1) / 255 in q, and a uniform rounding error has variance step^2 / 12. */
L.levels = function (flats, gamma) {
  return flats.map(function (lv) {
    var nf = lv.frames.length, md = 0, c0 = 0, c1 = 0, n = 0, i, k, f;
    for (k = 0; k < nf; k++) { f = lv.frames[k]; for (i = 0; i < f.length; i++) { md += f[i]; if (f[i] <= 0) c0++; else if (f[i] >= 1) c1++; n++; } }
    md /= n;
    var o = { stop: lv.stop, n: n, dn: md, clip0: c0 / n, clip1: c1 / n, usable: c0 / n < 0.005 && c1 / n < 0.005 };
    if (gamma) {
      var mq = 0, vq = 0;
      for (k = 0; k < nf; k++) { f = lv.frames[k]; var s = 0, s2 = 0, q; for (i = 0; i < f.length; i++) { q = Math.pow(f[i], gamma); s += q; s2 += q * q; } s /= f.length; mq += s; vq += (s2 / f.length - s * s) * f.length / (f.length - 1); }
      var step = gamma * Math.pow(md, gamma - 1) / 255;
      o.mean = mq / nf; o.varRaw = vq / nf; o.varQ = step * step / 12; o.var = Math.max(o.varRaw - o.varQ, 1e-12);
    }
    return o;
  });
};
/* gamma: the codes of an exposure ladder follow DN = (kappa * 2^stop)^(1/gamma), so log2(mean DN) is a straight line in the stop with slope 1/gamma (exposure doubling is exact).
 * Only mid-tone levels (usable, mean code above 0.2) enter: where the noise is large against the level it bends the mean of a power of a noisy number. */
L.fitGamma = function (flats) {
  var lv = L.levels(flats).filter(function (o) { return o.usable && o.dn > 0.2; }), n = lv.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  lv.forEach(function (o) { var y = Math.log(o.dn) / Math.LN2; sx += o.stop; sy += y; sxx += o.stop * o.stop; sxy += o.stop * y; });
  var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { gamma: 1 / slope, slope: slope, n: n };
};
/* least squares of var against mean over the usable levels; weights 1/var^2 (every level's variance has the same relative error), iterated.  Five laws are scored by the rms of log10(measured / fitted):
 *   const  var = b            prop  var = c mean^2 (noise proportional to the level)       shot  var = a mean (counting only)       affine  var = a mean + b (counting + read)       none  var = 0 */
function logRms(pts, f) { var s = 0; pts.forEach(function (p) { var r = Math.log10(p.var / Math.max(f(p), 1e-30)); s += r * r; }); return Math.sqrt(s / pts.length); }
L.fitLaw = function (lv) {
  var pts = lv.filter(function (o) { return o.usable && o.var !== undefined; }), n = pts.length, i, a = 0, b = 0;
  var cb = Math.pow(10, pts.reduce(function (s, p) { return s + Math.log10(p.var); }, 0) / n);                       // best constant (geometric mean)
  var cp = Math.pow(10, pts.reduce(function (s, p) { return s + Math.log10(p.var / (p.mean * p.mean)); }, 0) / n);   // best proportional-to-level-squared
  var cs = Math.pow(10, pts.reduce(function (s, p) { return s + Math.log10(p.var / p.mean); }, 0) / n);              // best counting-only slope
  var w = pts.map(function (p) { return 1 / (p.var * p.var); });
  for (var it = 0; it < 4; it++) {
    var sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sw += w[i]; sx += w[i] * pts[i].mean; sy += w[i] * pts[i].var; sxx += w[i] * pts[i].mean * pts[i].mean; sxy += w[i] * pts[i].mean * pts[i].var; }
    a = (sw * sxy - sx * sy) / (sw * sxx - sx * sx); b = (sy - a * sx) / sw;
    if (b < 0) { b = 0; a = sxy / sxx; }
    for (i = 0; i < n; i++) { var f = a * pts[i].mean + b; w[i] = 1 / (f * f); }
  }
  var kap = 0, sk = 0; pts.forEach(function (p) { var e = Math.pow(2, p.stop); kap += p.mean * e; sk += e * e; }); kap /= sk;       // mean level per unit of radiance (least squares through the origin)
  return { a: a, b: b, fw: 1 / a, read: Math.sqrt(b) / a, kappa: kap, n: n, c: { const: cb, prop: cp, shot: cs },
           rms: { none: Infinity, const: logRms(pts, function () { return cb; }), prop: logRms(pts, function (p) { return cp * p.mean * p.mean; }), shot: logRms(pts, function (p) { return cs * p.mean; }), affine: logRms(pts, function (p) { return a * p.mean + b; }) } };
};
/* the program-side blur kernel, copied from SV.sense: a Gaussian truncated at 2.5 sigma, normalised, edges clamped */
function kernel(sig) {
  var kh = Math.ceil(2.5 * sig), k = new Float32Array(2 * kh + 1), s = 0, u;
  for (u = -kh; u <= kh; u++) { k[u + kh] = Math.exp(-u * u / (2 * sig * sig)); s += k[u + kh]; }
  for (u = 0; u < k.length; u++) k[u] /= s;
  return { k: k, h: kh };
}
/* a row of the renderer's edge, blurred with sigma, at the columns a..b */
function blurWin(p, sig, a, b, out) {
  var K = sig > 0 ? kernel(sig) : { k: [1], h: 0 }, i, u;
  for (i = a; i <= b; i++) { var t = 0; for (u = -K.h; u <= K.h; u++) t += K.k[u + K.h] * p[Math.min(W - 1, Math.max(0, i + u))]; out[i - a] = t; }
  return out;
}
L.edgeModel = function (x0, sig, a, b) { return blurWin(L.edgeProfile(x0), sig, a, b, new Float64Array(b - a + 1)); };
/* blur from an edge, by synthesis: the program's renderer already averages each pixel over its area, so the camera's image of a sharp edge differs from the renderer's
 * by ONE more blur; render the edge as the program would (L.edgeProfile), blur it with a trial sigma, and keep the sigma (and the unknown sub-pixel position) that match the frame */
L.fitEdge = function (frames, gamma) {
  var sigs = [], pos = [], first = null, m = new Float64Array(13);
  frames.forEach(function (x) {
    var t = new Float64Array(W), i, v, c;
    for (i = 0; i < W; i++) { var s = 0; for (c = 0; c < 3; c++) for (v = 0; v < H; v++) s += Math.pow(x[c * HW + v * W + i], gamma); t[i] = s / (3 * H); }
    var lo = 0, hi = 0; for (i = 0; i < 20; i++) { lo += t[i] / 20; hi += t[W - 1 - i] / 20; }
    for (i = 0; i < W; i++) t[i] = (t[i] - lo) / (hi - lo);
    var xc = 0; for (i = 1; i < W; i++) if (t[i - 1] < 0.5 && t[i] >= 0.5) { xc = i; break; }
    var a = xc - 6, b = xc + 6, best = Infinity, bs = 0, bx = 0;
    function cost(sg, x0) { blurWin(L.edgeProfile(x0), sg, a, b, m); var e = 0; for (var i2 = a; i2 <= b; i2++) { var d = t[i2] - m[i2 - a]; e += d * d; } return e; }
    var s2, x0, e;
    for (s2 = 0; s2 <= 1.6001; s2 += 0.05) for (x0 = xc - 1.5; x0 <= xc + 1.5001; x0 += 0.125) { e = cost(s2, x0); if (e < best) { best = e; bs = s2; bx = x0; } }
    var s0 = bs; for (s2 = Math.max(0, s0 - 0.05); s2 <= s0 + 0.0501; s2 += 0.005) { e = cost(s2, bx); if (e < best) { best = e; bs = s2; } }
    sigs.push(bs); pos.push(bx);
    if (!first) first = { t: t, xc: xc, x0: bx, sigma: bs };
  });
  var mean = sigs.reduce(function (p, q) { return p + q; }, 0) / sigs.length;
  return { sigma: mean, per: sigs, x0: pos, first: first };
};
/* the exposure controller, from the log: each logged frame gives the level the controller saw (mean linear value before the gain, level = mean(DN^gamma) / gain)
 * and the gain it chose (post = the mean linear value after the gain).  The law is gain = clamp(target / level, 1, maxGain): the plateau is maxGain; in between gain * level = target. */
L.exposurePairs = function (logs, gamma) {
  return logs.map(function (f) { var x = f.x, s = 0; for (var i = 0; i < x.length; i++) s += Math.pow(x[i], gamma); s /= x.length; return { gain: f.gain, post: s, level: s / f.gain }; });
};
L.fitExposure = function (pairs) {
  var maxG = 0; pairs.forEach(function (p) { if (p.gain > maxG) maxG = p.gain; });
  var mid = pairs.filter(function (p) { return p.gain < maxG - 1e-9; }).map(function (p) { return p.post; }).sort(function (a, b) { return a - b; });
  var minG = Infinity; pairs.forEach(function (p) { if (p.gain < minG) minG = p.gain; });
  return { maxGain: maxG, target: mid.length ? mid[mid.length >> 1] : NaN, capShare: (pairs.length - mid.length) / pairs.length, minGain: minG, nMid: mid.length };
};
/* the whole calibration: flats + edge frames + the log -> the camera's parameters (logs: frames {x, gain} or pairs from exposurePairs) */
L.calibrate = function (flats, edges, logs) {
  var g = L.fitGamma(flats), lv = L.levels(flats, g.gamma), law = L.fitLaw(lv), ed = L.fitEdge(edges, g.gamma);
  var pairs = logs.length && logs[0].x ? L.exposurePairs(logs, g.gamma) : logs, ex = L.fitExposure(pairs);
  return { gamma: g.gamma, kappa: law.kappa, fw: law.fw, read: law.read, blur: ed.sigma, target: ex.target, maxGain: ex.maxGain, levels: lv, law: law, edge: ed, exposure: ex };
};
/* the estimates in the form the program-side sensor takes (ev = electrons per unit of radiance = kappa * fw) */
L.camOf = function (est) { return { ev: est.kappa * est.fw, fw: est.fw, read: est.read, blur: est.blur, gamma: est.gamma, bits: 8, ae: { target: est.target, maxGain: est.maxGain } }; };
/* the street's own parameters, for the lab's exact-stage program and for the oracle (never for a page's estimate) */
L.exactCam = function () { var s = SV.REAL.sensor; return { ev: s.ev, fw: s.fw, read: s.read, blur: s.blur, gamma: s.gamma, bits: s.bits, ae: { target: s.ae.target, maxGain: s.ae.maxGain } }; };

/* ───────────────────────────── the program side: SV.sense with a switch for each part ───────────────────────────── */
/* cam: {ev, fw, read, blur, gamma, bits, ae: {target, maxGain}}; sw: {noise, blur, ae} (booleans).  Off: no shot and read noise / no PSF blur / gain fixed at 1 (the ideal sensor's exposure). */
L.gainOf = function (rad, cam) {
  var s = 0, n = rad.length; for (var i = 0; i < n; i++) s += rad[i];
  var ml = cam.ev * s / n / cam.fw;
  return Math.min(cam.ae.maxGain, Math.max(1, cam.ae.target / Math.max(ml, 1e-9)));
};
L.sense = function (rad, cam, rng, sw) {
  var out = new Float32Array(N3), levels = (1 << cam.bits) - 1, ig = 1 / cam.gamma, gain = sw.ae && cam.ae ? L.gainOf(rad, cam) : 1, K = sw.blur && cam.blur > 0 ? kernel(cam.blur) : null;
  var tmp = new Float32Array(HW), tmp2 = new Float32Array(HW), c, i, j, u, v;
  for (c = 0; c < 3; c++) {
    var pl = rad.subarray(c * HW, (c + 1) * HW), src = pl;
    if (K) {
      for (j = 0; j < H; j++) for (i = 0; i < W; i++) { var t = 0; for (u = -K.h; u <= K.h; u++) t += K.k[u + K.h] * pl[j * W + Math.min(W - 1, Math.max(0, i + u))]; tmp[j * W + i] = t; }
      for (j = 0; j < H; j++) for (i = 0; i < W; i++) { var t2 = 0; for (v = -K.h; v <= K.h; v++) t2 += K.k[v + K.h] * tmp[Math.min(H - 1, Math.max(0, j + v)) * W + i]; tmp2[j * W + i] = t2; }
      src = tmp2;
    }
    for (i = 0; i < HW; i++) {
      var e = cam.ev * src[i];
      if (sw.noise) e = e + Math.sqrt(Math.max(e, 0)) * SV.randn(rng) + cam.read * SV.randn(rng);
      var q = Math.min(1, Math.max(0, gain * e / cam.fw));
      out[c * HW + i] = Math.round(Math.pow(q, ig) * levels) / levels;
    }
  }
  return out;
};
/* one program frame drawn through the switchable sensor (SV.sample, with the sensor stage replaced) */
L.sample = function (pipe, cam, sw, seed, want) {
  var rs = SV.stream(seed, 'scene'), rl = SV.stream(seed, 'look'), rn = SV.stream(seed, 'sensor');
  var scene = SV.drawScene(pipe.scene, rs, want), look = SV.drawLook(pipe.look, scene, rl);
  var ren = SV.render(scene, look), x = L.sense(ren.rad, cam, rn, sw), lab = SV.labels(ren.cov, pipe.label, scene, look);
  return { x: x, cov: ren.cov, depth: ren.depth, range: ren.range, id: ren.id, y: lab.present, area: lab.area, full: lab.full, scene: scene, look: look, mode: scene.mode, seed: seed, gain: sw.ae && cam.ae ? L.gainOf(ren.rad, cam) : 1 };
};
L.makeSet = function (pipe, cam, sw, n, seed0, want) {
  var out = new Array(n);
  for (var i = 0; i < n; i++) out[i] = L.sample(pipe, cam, sw, seed0 + i, want);
  return out;
};

/* ───────────────────────────── what the noise law says about a pedestrian ───────────────────────────── */
/* contrast-to-noise ratio of the pedestrian in a frame: the labelled mask (coverage >= 1/2) against a ring two pixels wide around it, per colour channel, in linear units q = DN^gamma;
 * the noise of a pixel at level q after gain g is var = (g / fw) q + (g read / fw)^2 (the calibrated law); the mean of A mask pixels has that variance over A, so
 *   CNR^2 = sum over channels of [ A (q_ped - q_ring)^2 / var - 1 - A / R ]      (R ring pixels; the last two terms remove the noise's own contribution to the squared contrast) */
L.cnr = function (x, mask, gain, cam) {
  var q = new Float64Array(N3), i, c, P = [], R = [], inP = new Uint8Array(HW), ring = new Uint8Array(HW);
  for (i = 0; i < N3; i++) q[i] = Math.pow(x[i], cam.gamma);
  for (i = 0; i < HW; i++) if (mask[i] >= 0.5) { inP[i] = 1; P.push(i); }
  for (var a = 0; a < P.length; a++) {
    var u = P[a] % W, v = (P[a] / W) | 0;
    for (var dv = -2; dv <= 2; dv++) for (var du = -2; du <= 2; du++) { var uu = u + du, vv = v + dv; if (uu < 0 || uu >= W || vv < 0 || vv >= H) continue; var k = vv * W + uu; if (!inP[k] && mask[k] === 0) ring[k] = 1; }
  }
  for (i = 0; i < HW; i++) if (ring[i]) R.push(i);
  if (!P.length || R.length < 3) return NaN;
  var d2 = 0;
  for (c = 0; c < 3; c++) {
    var mp = 0, mr = 0; for (i = 0; i < P.length; i++) mp += q[c * HW + P[i]]; for (i = 0; i < R.length; i++) mr += q[c * HW + R[i]];
    mp /= P.length; mr /= R.length;
    var s2 = gain / cam.fw * Math.max(mp, 1e-6) + Math.pow(gain * cam.read / cam.fw, 2), dl = mp - mr;
    d2 += P.length * dl * dl / s2 - 1 - P.length / R.length;
  }
  return Math.sqrt(Math.max(d2, 0));
};
/* the standard normal distribution function (Abramowitz-Stegun 7.1.26 for erf: error below 1.5e-7) */
L.Phi = function (x) {
  var z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x < 0 ? -y : y));
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
