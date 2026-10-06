/* l04_light.js — Lesson 4 (same scene, other pixels): the light as a nuisance.  Namespace SV.l04.  Browser and node; load after street.js, evidence.js.
 *
 *   SV.l04.camera()                the calibrated camera of Lesson 3 as a sensor configuration (read from SV.evidence.CAMERA, never from the street)
 *   SV.l04.scaleLook(look, s, lim) every numeric range of a look configuration scaled by s about its centre, clipped to physical limits (s = 1 returns the same ranges)
 *   SV.l04.GROUPS                  the look parameters in four groups: sun direction, brightness, colours, textures
 *   SV.l04.program(look)           the program of this lesson: SIM0's scene and label, the calibrated camera, and the given look
 *   SV.l04.relight(frame, ...)     the same scene (and label) drawn again with another look and sensor stream
 */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l04 = L;

/* ───────────────────────────── the look: ranges, limits, groups ───────────────────────────── */
L.NUMERIC = ['sunEl', 'sunAz', 'amb', 'lum', 'ground', 'stripe'];        // the look parameters that are ranges [lo, hi]; the others (palettes, sky, windows) are choices or a level
/* physical limits: the sun is above the horizon, the azimuth wraps at 180 degrees, ambient light is a fraction, light cannot be negative, an albedo lies in (0, 1), a stripe cannot make a shirt negative */
L.LIMITS = { sunEl: [0, 90], sunAz: [-180, 180], amb: [0.02, 0.95], lum: [0.01, 3], ground: [0.02, 0.9], stripe: [0, 0.8] };
L.GROUPS = { sun: ['sunEl', 'sunAz'], bright: ['lum', 'amb'], colour: ['pedPalette', 'vanPalette', 'sky', 'ground'], texture: ['windows', 'stripe'] };
L.GROUP_NAMES = ['sun', 'bright', 'colour', 'texture'];

/* scale a range [lo, hi] about its centre c by s: [lo + (1 - s)(c - lo), hi - (1 - s)(hi - c)], so that s = 1 gives lo and hi exactly */
L.scaleRange = function (r, s, lim) {
  var lo = r[0], hi = r[1], c = (lo + hi) / 2, a = lo + (1 - s) * (c - lo), b = hi - (1 - s) * (hi - c);
  if (lim) { a = Math.max(lim[0], a); b = Math.min(lim[1], b); }
  return [a, b];
};
L.scaleLook = function (look, s, lim) {
  var out = SV.clone(look), k;
  lim = lim || L.LIMITS;
  L.NUMERIC.forEach(function (name) { if (look[name]) out[name] = L.scaleRange(look[name], s, lim[name]); });
  return out;
};

/* ───────────────────────────── the program of this lesson ───────────────────────────── */
/* the calibrated camera of Lesson 3: gamma, full well, read noise, blur, auto-exposure, and the exposure scale kappa = ev / fw */
L.camera = function () {
  var K = SV.evidence.CAMERA;
  return { ideal: false, ev: Math.round(K.kappa * K.fw), fw: K.fw, read: K.read, blur: K.blur, gamma: K.gamma, bits: K.bits, ae: { target: K.ae.target, maxGain: K.ae.maxGain } };
};
/* SIM0's scene and label, the calibrated camera, and the given look: with SIM0's own look this is the program aaba of the table */
L.program = function (look) {
  return { name: 'l04', scene: SV.clone(SV.SIM0.scene), look: SV.clone(look || SV.SIM0.look), sensor: L.camera(), label: SV.clone(SV.SIM0.label) };
};

/* the same scene and label, drawn again: a frame is a function of three random streams (scene, look, sensor), so the scene stream of `seed` with the look stream of `lookSeed`
 * gives the same pedestrian, van and clutter under another light.  want is passed to the scene as in SV.sample. */
L.relight = function (pipe, seed, lookSeed, sensorSeed, want) {
  var rs = SV.stream(seed, 'scene'), rl = SV.stream(lookSeed, 'look'), rn = SV.stream(sensorSeed === undefined ? lookSeed : sensorSeed, 'sensor');
  var scene = SV.drawScene(pipe.scene, rs, want), look = SV.drawLook(pipe.look, scene, rl);
  var ren = SV.render(scene, look), x = SV.sense(ren.rad, pipe.sensor, rn), lab = SV.labels(ren.cov, pipe.label, scene, look);
  return { x: x, gain: L.gainOf(ren.rad, pipe.sensor), rad: ren.rad, cov: ren.cov, y: lab.present, area: lab.area, full: lab.full, scene: scene, look: look, mode: scene.mode, seed: seed, lookSeed: lookSeed };
};

/* ───────────────────────────── probe pixels ───────────────────────────── */
/* Where the content of a frame is known without a label: the top row is sky (the wall of the far buildings ends below it), the bottom rows are road, rows 3-6 are the far wall.
 * A probe is the median of a band of rows, read through the calibrated camera (SV.evidence.linear), so a tree, a van or a pole over part of the band does not move it. */
var W = SV.CAM.W, H = SV.CAM.H, HW = W * H;
L.BANDS = { sky: [0, 1], wall: [3, 7], road: [20, 24] };
function median(a) { var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : 0.5 * (b[m - 1] + b[m]); }
function quantile(a, p) { var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }), k = p * (b.length - 1), i = Math.floor(k), f = k - i; return i + 1 < b.length ? b[i] * (1 - f) + b[i + 1] * f : b[i]; }
L.median = median; L.quantile = quantile;
L.band = function (lin, c, band) {
  var a = [], u, v;
  for (v = band[0]; v < band[1]; v++) for (u = 0; u < W; u++) a.push(lin[c * HW + v * W + u]);
  return median(a);
};
/* the probes of one frame: the three-channel level of the sky, the wall and the road, in scene-radiance units (a frame is {x, gain}) */
L.probes = function (frame) {
  var lin = SV.evidence.linear(frame), p = { gain: frame.gain, sky: [], wall: [], road: [] };
  for (var c = 0; c < 3; c++) { p.sky.push(L.band(lin, c, L.BANDS.sky)); p.wall.push(L.band(lin, c, L.BANDS.wall)); p.road.push(L.band(lin, c, L.BANDS.road)); }
  p.level = (p.sky[0] + p.sky[1] + p.sky[2]) / 3;                               // sky level
  p.chroma = [p.sky[0] / p.sky[1], p.sky[2] / p.sky[1]];                         // sky colour with the level divided out: red / green and blue / green
  p.ground = (p.road[0] + p.road[1] + p.road[2]) / 3;                            // road level
  return p;
};
/* the gain the camera's auto-exposure chooses for a radiance image (what a camera writes into its metadata); the program knows it for its own frames */
L.gainOf = function (rad, cfg) {
  var s = 0, i;
  for (i = 0; i < rad.length; i++) s += rad[i];
  return Math.min(cfg.ae.maxGain, Math.max(1, cfg.ae.target / Math.max(cfg.ev * s / rad.length / cfg.fw, 1e-9)));
};

/* The program is the calibration standard of its own probes.  Draw frames of the program's three skies at lum = 1, read them through the probes, and keep for each sky its colour
 * (chroma) and the level the probes report: the logs' frames are then classified and divided by these, so whatever the blur and the wall under the top row do to the probe cancels. */
L.skyTable = function (nPerType) {
  var look = SV.clone(SV.SIM0.look), pipe, i, f, t, key, seen = {}, tab = [];
  look.sky = 'varied'; look.lum = [1, 1]; pipe = L.program(look);
  for (i = 0; i < 120 && tab.length < 3; i++) { f = L.relight(pipe, 1000 + i, 1000 + i); key = f.look.skyH.join(','); if (!seen[key]) { seen[key] = { n: 0, chroma: [[], []], level: [] }; tab.push(seen[key]); } }
  for (i = 0; i < 400 && tab.some(function (t) { return t.n < (nPerType || 12); }); i++) {
    f = L.relight(pipe, 2000 + i, 2000 + i); t = seen[f.look.skyH.join(',')];
    if (t && t.n < (nPerType || 12)) { var p = L.probes(f); t.n++; t.chroma[0].push(p.chroma[0]); t.chroma[1].push(p.chroma[1]); t.level.push(p.level); }
  }
  return tab.map(function (t) { return { chroma: [median(t.chroma[0]), median(t.chroma[1])], level: median(t.level) }; }).sort(function (a, b) { return a.chroma[1] - b.chroma[1]; });   // warm, grey, blue by blue / green
};
/* the sky a frame shows: the nearest of the table's colours in chroma, or -1 when none is near (a tree or a van covers half of the top row) */
L.classify = function (p, tab, tol) {
  var best = -1, bd = (tol || 0.12), k, d;
  for (k = 0; k < tab.length; k++) { d = Math.hypot(p.chroma[0] - tab[k].chroma[0], p.chroma[1] - tab[k].chroma[1]); if (d < bd) { bd = d; best = k; } }
  return best;
};

/* ───────────────────────────── the range of the world, from the probes ───────────────────────────── */
/* if v is uniform on [lo, hi] then its p-quantile is lo + p (hi - lo): two quantiles a and b give the whole range, and a few outliers (a tree over the sky) move neither */
L.uniformRange = function (v, a, b) {
  var qa = quantile(v, a), qb = quantile(v, b), span = (qb - qa) / (b - a);
  return [qa - a * span, qb + (1 - b) * span];
};
/* the light the program shines on the road at its own sun and ambient light: ground albedo x (ambient + (1 - ambient) sin elevation) */
L.roadFactor = function (look) { var a = look.amb[0], e = look.sunEl[0] * Math.PI / 180; return a + (1 - a) * Math.sin(e); };
/* Read one frame through the probes.  Which sky it shows (the nearest colour of the table), its brightness lum = sky level / the level the probes report for that sky at lum = 1, and the road's
 * light G = road level / lum, which is ground albedo x light on the road: the road is lit by the sun and the sky alone, so G does not depend on the exposure. */
L.read = function (frame, tab) {
  var p = L.probes(frame), k = L.classify(p, tab), l;
  if (k < 0) return null;
  l = p.level / tab[k].level;
  return { sky: k, lum: l, G: p.ground / l };
};
/* the range of the logs: the 5 % and 95 % quantiles of the brightness and of G stretched to a whole range, and how often each sky appears */
L.summarise = function (reads) {
  var lum = [], G = [], kinds = [0, 0, 0], i;
  for (i = 0; i < reads.length; i++) if (reads[i]) { lum.push(reads[i].lum); G.push(reads[i].G); kinds[reads[i].sky]++; }
  return { n: reads.length, used: lum.length, lum: L.uniformRange(lum, 0.05, 0.95), G: L.uniformRange(G, 0.05, 0.95), sky: kinds.map(function (x) { return x / lum.length; }), lums: lum, Gs: G };
};
L.estimate = function (logs, o) {
  var tab = (o && o.table) || L.skyTable();
  return L.summarise(logs.map(function (f) { return L.read(f, tab); }));
};
/* the look of the estimated-range program: SIM0's look with what the probes saw replaced; parts = which of 'lum', 'sky', 'ground' to take from the evidence */
L.estimatedLook = function (est, parts) {
  var look = SV.clone(SV.SIM0.look), F0 = L.roadFactor(look), lim = L.LIMITS;
  parts = parts || ['lum', 'sky', 'ground'];
  if (parts.indexOf('lum') >= 0) look.lum = [Math.max(lim.lum[0], est.lum[0]), est.lum[1]];
  if (parts.indexOf('sky') >= 0) look.sky = Math.min.apply(null, est.sky) > 0.05 ? 'varied' : 'blue';
  if (parts.indexOf('ground') >= 0) look.ground = [Math.max(lim.ground[0], est.G[0] / F0), Math.min(lim.ground[1], est.G[1] / F0)];
  return look;
};

/* ───────────────────────────── recoverability: is the pedestrian in the pixels? ───────────────────────────── */
/* Gaussian error function (Abramowitz and Stegun 7.1.26, error below 1.5e-7), the normal distribution function and its inverse (bisection) */
L.erf = function (x) {
  var t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
L.Phi = function (x) { return 0.5 * (1 + L.erf(x / Math.SQRT2)); };
L.PhiInv = function (p) { var lo = -9, hi = 9, m, k; for (k = 0; k < 60; k++) { m = (lo + hi) / 2; if (L.Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
/* a separable Gaussian blur of a three-plane image (the camera's point spread function), edges replicated */
L.blur = function (img, sigma) {
  var kh = Math.ceil(2.5 * sigma), k = [], s = 0, u, c, i, j, t, out = new Float32Array(img.length), tmp = new Float32Array(HW);
  for (u = -kh; u <= kh; u++) { k.push(Math.exp(-u * u / (2 * sigma * sigma))); s += k[k.length - 1]; }
  for (u = 0; u < k.length; u++) k[u] /= s;
  for (c = 0; c < 3; c++) {
    for (j = 0; j < H; j++) for (i = 0; i < W; i++) { t = 0; for (u = -kh; u <= kh; u++) t += k[u + kh] * img[c * HW + j * W + Math.min(W - 1, Math.max(0, i + u))]; tmp[j * W + i] = t; }
    for (j = 0; j < H; j++) for (i = 0; i < W; i++) { t = 0; for (u = -kh; u <= kh; u++) t += k[u + kh] * tmp[Math.min(H - 1, Math.max(0, j + u)) * W + i]; out[c * HW + j * W + i] = t; }
  }
  return out;
};
/* The signal of a pedestrian is the picture with him minus the same picture without him, as the camera records it.  The camera adds noise of variance (ev L + read^2) / ev^2 to a radiance
 * L (shot noise plus read noise, in radiance units), independently at every pixel.  An observer who knows the signal exactly and tests it against the noise has the
 * contrast-to-noise ratio  CNR = sqrt( sum over pixels and channels of (signal / sd)^2 ),  and no detector does better.  frame comes from L.relight (it carries rad). */
L.cnr = function (frame, cam) {
  cam = cam || L.camera();
  var rad = frame.rad || SV.render(frame.scene, frame.look, { maps: false }).rad;
  var rest = SV.render({ parts: frame.scene.parts.filter(function (q) { return q.cls !== 'ped'; }) }, frame.look, { maps: false }).rad, d = new Float32Array(rest.length), i, s2 = 0, v;
  for (i = 0; i < d.length; i++) d[i] = rad[i] - rest[i];
  var db = L.blur(d, cam.blur), rb = L.blur(rest, cam.blur);
  for (i = 0; i < d.length; i++) { v = (cam.ev * Math.max(rb[i], 0) + cam.read * cam.read) / (cam.ev * cam.ev); s2 += db[i] * db[i] / v; }
  return Math.sqrt(s2);
};
/* To keep one empty frame in ten from alarming when a frame has K cells that could each alarm, each cell may alarm with probability 1 - 0.9^(1/K): for Gaussian noise that is
 * a threshold of z noise sds.  A pedestrian of contrast-to-noise ratio c is then found with probability Phi(c - z), and missed with probability Phi(z - c). */
L.zAlarm = function (K, fa) { return L.PhiInv(Math.pow(1 - (fa === undefined ? 0.1 : fa), 1 / K)); };
L.CELLS = 48 * 12;                                                                            // the detector's stride-2 grid
L.Z = L.zAlarm(L.CELLS);
L.missFloor = function (c) { return L.Phi(L.Z - c); };

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
