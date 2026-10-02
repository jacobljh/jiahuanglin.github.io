/* l09_nerf.js — lesson 09, "Radiance fields: a scene as a function".  A private engine on top of flatland.js.
 *
 * The field itself, its ray marcher and its Adam step are the shared engine's (FL.vol.Field: a grid of nodes, each holding a raw density and
 * three raw colour values, bilinear in between; density = softplus(raw), colour = sigmoid(raw)).  This file adds the experiment around it.
 *   N9.world()                  the statue scene, the 24 held-out cameras (ring of radius 6 m, interleaved with the data ring) and their photographs
 *   N9.cams(n), N9.views(n, shuf)   the data: n cameras on the ring and their photographs; shuf = the same pixels of every photograph in a seeded random order
 *   N9.make(nodes)              an empty field on [-3.4, 3.4]^2: raw density -5 (0.0067 per metre), raw colour 0 (grey)
 *   N9.start(n, nodes, shuf)    a fresh experiment S = {views, F, steps, curve, ...};  N9.train(S, k) takes k Adam steps (full batch, jittered samples)
 *   N9.score(F, cams, imgs)     the exam: mean over cameras of the PSNR of the field's render against the photograph
 *   N9.spend(F, views)          the bill of one pass over the data rays: samples, and how many carry a weight below 1/255
 *   N9.ghost(F, d)              the share of the density that sits more than d metres outside every true object
 *   N9.ray / N9.render          a render with nc evenly spaced samples per ray plus nf samples drawn from the weights of the first pass (inverse CDF)
 *   N9.nearest(n)               the exam score of answering every held-out camera with the nearest stored photograph (lesson 7's baseline)
 *   N9.draw(canvas, S, hi)      the widget's picture of an experiment S, with held-out camera hi (kept here so that the page carries only the wiring)
 * Conventions: x right, z up, metres; colours in [0, 1]; PSNR in dB.  Deterministic: seeded generators only.
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require === 'function' ? require('./flatland.js') : null);
var N9 = {};
var PI = Math.PI;

N9.F = 56; N9.W = 64; N9.R = 6;                 // focal length (px), pixels per photograph, ring radius (m): the cameras of lessons 6 and 7
N9.NS = 48; N9.BOX = 3.4; N9.S0 = -5; N9.LR = 0.15;   // samples per ray, half-width of the field's box (m), initial raw density, Adam step size
N9.EPS = 1 / 255;                               // "negligible weight": a sample below it cannot change an 8-bit pixel, whatever its colour

var _world = null;
N9.world = function () {
  if (_world) return _world;
  var sc = FL.scenes.statue(), held = FL.orbit(24, N9.R, 0, 0, { f: N9.F, W: N9.W, start: 0.13 + PI / 24 * 0.9 });
  _world = { sc: sc, held: held, heldImg: held.map(function (c) { return FL.render(sc, c); }) };
  return _world;
};
N9.cams = function (n) { return FL.orbit(n, N9.R, 0, 0, { f: N9.F, W: N9.W, start: 0.13 }); };
N9.views = function (n, shuf) {
  var w = N9.world(), rng = FL.rng(17);
  return N9.cams(n).map(function (c) {
    var img = FL.render(w.sc, c);
    if (shuf) {                                  // Fisher-Yates on the pixel order of this photograph
      var W = img.W, p = [], o = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) }, i, j, t;
      for (i = 0; i < W; i++) p.push(i);
      for (i = W - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
      for (i = 0; i < W; i++) { o.r[i] = img.r[p[i]]; o.g[i] = img.g[p[i]]; o.b[i] = img.b[p[i]]; }
      img = o;
    }
    return { cam: c, img: img };
  });
};
N9.make = function (nodes) {
  var B = N9.BOX;
  return new FL.vol.Field({ x0: -B, x1: B, z0: -B, z1: B, nx: nodes, nz: nodes, nsamp: N9.NS, bg: N9.world().sc.bg, s0: N9.S0 });
};
N9.score = function (F, cams, imgs) {
  var s = 0, k;
  for (k = 0; k < cams.length; k++) s += FL.psnr(imgs[k], F.renderCam(cams[k]));
  return s / cams.length;
};
/* the exam score of copying: every held-out camera is answered with the photograph of the nearest data camera */
N9.nearest = function (n) {
  var w = N9.world(), cams = N9.cams(n), imgs = cams.map(function (c) { return FL.render(w.sc, c); }), s = 0;
  w.held.forEach(function (hc, k) {
    var b = 0, bd = 1e9;
    cams.forEach(function (c, j) { var d = Math.hypot(c.x - hc.x, c.z - hc.z); if (d < bd) { bd = d; b = j; } });
    s += FL.psnr(w.heldImg[k], imgs[b]);
  });
  return s / w.held.length;
};
N9.emptyScene = function () {                    // the photograph of a field with nothing in it
  var bg = N9.world().sc.bg, s = 0, w = N9.world();
  w.held.forEach(function (c, k) { var W = c.W, im = { W: W, r: new Float32Array(W).fill(bg[0]), g: new Float32Array(W).fill(bg[1]), b: new Float32Array(W).fill(bg[2]) }; s += FL.psnr(w.heldImg[k], im); });
  return s / w.held.length;
};

/* ── the bill and the ghosts ── */
N9.spend = function (F, views) {
  var tot = 0, low = 0;
  views.forEach(function (v) {
    for (var i = 0; i < v.cam.W; i++) {
      var ry = FL.pixelRay(v.cam, i + 0.5), r = F.ray(ry.ox, ry.oz, ry.dx, ry.dz, null);
      if (!r.w) continue;
      for (var k = 0; k < r.w.length; k++) { tot++; if (r.w[k] < N9.EPS) low++; }
    }
  });
  return { samples: tot, low: low, share: tot ? low / tot : 0 };
};
N9.ghost = function (F, d) {
  var sc = N9.world().sc, nx = F.nx, nz = F.nz, den = F.density(), out = 0, all = 0, i, j;
  for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
    var x = F.x0 + (F.x1 - F.x0) * i / (nx - 1), z = F.z0 + (F.z1 - F.z0) * j / (nz - 1), s = den[j * nx + i];
    all += s; if (FL.sdf(sc, x, z) > d) out += s;
  }
  return all > 0 ? out / all : 0;
};

/* ── rays with a chosen set of samples ── */
N9.at = function (F, x, z) {                     // density and colour of the field at a point
  var idx = new Int32Array(4), wt = new Float64Array(4), s = 0, r = 0, g = 0, b = 0, k;
  F._stencil(x, z, 0, idx, wt);
  for (k = 0; k < 4; k++) { s += wt[k] * F.s[idx[k]]; r += wt[k] * F.c[3 * idx[k]]; g += wt[k] * F.c[3 * idx[k] + 1]; b += wt[k] * F.c[3 * idx[k] + 2]; }
  return { sig: FL.vol.softplus(s), col: [FL.vol.sigmoid(r), FL.vol.sigmoid(g), FL.vol.sigmoid(b)] };
};
/* composite along sorted sample distances ts; each sample stands for the stretch between the midpoints to its neighbours (ends clamped to [t0, t1]) */
N9.pass = function (F, ry, ts, t0, t1) {
  var n = ts.length, sig = new Float64Array(n), col = new Array(n), dl = new Float64Array(n), k, q;
  for (k = 0; k < n; k++) {
    q = N9.at(F, ry.ox + ry.dx * ts[k], ry.oz + ry.dz * ts[k]); sig[k] = q.sig; col[k] = q.col;
    dl[k] = (k + 1 < n ? 0.5 * (ts[k] + ts[k + 1]) : t1) - (k > 0 ? 0.5 * (ts[k - 1] + ts[k]) : t0);
  }
  var f = FL.vol.composite(sig, col, dl, F.bg);
  f.sig = sig; f.ts = ts;
  return f;
};
/* nc evenly spaced samples; then nf more drawn from the weights of that first pass (the weights are a probability distribution over the nc bins) */
N9.ray = function (F, ry, t0, t1, nc, nf) {
  var dt = (t1 - t0) / nc, ts = [], k, f = null;
  for (k = 0; k < nc; k++) ts.push(t0 + (k + 0.5) * dt);
  f = N9.pass(F, ry, ts, t0, t1);
  if (!nf) return f;
  var cdf = [0], tot = 0, w = [], fine = [], b = 0, j, u;
  for (k = 0; k < nc; k++) { w.push(f.w[k] + 1e-5); tot += w[k]; }
  for (k = 0; k < nc; k++) cdf.push(cdf[k] + w[k] / tot);
  for (j = 0; j < nf; j++) {
    u = (j + 0.5) / nf;
    while (b < nc - 1 && cdf[b + 1] < u) b++;
    fine.push(t0 + (b + (u - cdf[b]) / (cdf[b + 1] - cdf[b])) * dt);
  }
  return N9.pass(F, ry, ts.concat(fine).sort(function (a, c) { return a - c; }), t0, t1);
};
N9.render = function (F, cam, nc, nf) {
  var W = cam.W, out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) }, i;
  for (i = 0; i < W; i++) {
    var ry = FL.pixelRay(cam, i + 0.5), box = FL.vol.rayBox(ry.ox, ry.oz, ry.dx, ry.dz, F.x0, F.x1, F.z0, F.z1), C = box ? N9.ray(F, ry, box[0], box[1], nc, nf).C : F.bg;
    out.r[i] = C[0]; out.g[i] = C[1]; out.b[i] = C[2];
  }
  return out;
};
N9.heldAt = function (F, nc, nf) {               // exam score with a given sample budget
  var w = N9.world(), s = 0;
  w.held.forEach(function (c, k) { s += FL.psnr(w.heldImg[k], N9.render(F, c, nc, nf)); });
  return s / w.held.length;
};

/* ── an experiment ── */
N9.measure = function (S) {
  var w = N9.world();
  S.tr = N9.score(S.F, S.cams, S.imgs); S.ho = N9.score(S.F, w.held, w.heldImg);
  S.curve.push([S.steps, S.tr, S.ho]);
};
N9.start = function (n, nodes, shuf) {          // the bill (empty, ghost, ho16, ho88) is NaN until the first training step: it costs a few renders
  var S = { n: n, nodes: nodes, shuf: !!shuf, views: N9.views(n, shuf), F: N9.make(nodes), steps: 0, curve: [], nearest: N9.nearest(n), empty: NaN, ghost: NaN, h16: NaN, h88: NaN, queries: 0 };
  S.cams = S.views.map(function (v) { return v.cam; }); S.imgs = S.views.map(function (v) { return v.img; });
  N9.measure(S);
  return S;
};
N9.bill = function (S) {
  var sp = N9.spend(S.F, S.views);
  S.empty = sp.share; S.samples = sp.samples; S.ghost = N9.ghost(S.F, 0.3);
  S.h16 = N9.heldAt(S.F, 16, 0); S.h88 = N9.heldAt(S.F, 8, 8);
  S.queries = S.steps * S.n * N9.W * N9.NS;
};
N9.train = function (S, k) {
  for (var i = 0; i < k; i++) {
    S.F.step(S.views, { lr: N9.LR, jitter: true, seed: 3 }); S.steps++;
    if (S.steps % 10 === 0) N9.measure(S);
  }
  if (S.steps % 10) N9.measure(S);
  N9.bill(S);
};

/* ── the widget's picture ──
 *   left: the scene from above, the field as colour and opacity over the true outlines, the data cameras (blue) and one held-out camera (amber) with its centre ray;
 *   right: that camera's photograph, the field's prediction and where they disagree, then the 48 samples of the centre ray (density grey, transmittance blue, weight orange);
 *   bottom: the exam score against the steps, on the data cameras (blue) and the 24 held-out cameras (amber), dashed the nearest stored photograph. */
N9.PIX = 32;                                     // the pixel of the held-out camera whose ray is drawn
N9.draw = function (cv, S, hi) {
  var D = FL.draw, C = FL.C, WL = N9.world(), SC = WL.sc, PIX = N9.PIX;
  cv.style.height = (cv.clientWidth < 600 ? 800 : 560) + 'px';
  var Sx = D.setup(cv), ctx = Sx.ctx, w = Sx.w, h = Sx.h, narrow = w < 600, F = S.F, nx = F.nx, hh = 2 * N9.BOX / (nx - 1), hcam = WL.held[hi], i, j, k;
  var lw = narrow ? Math.min(w - 16, 420) : Math.min(360, Math.floor(w * 0.47));
  var rx = narrow ? 8 : lw + 28, rw = narrow ? w - 16 : w - rx - 8, ry = narrow ? lw + 40 : 30;
  var py = ry + 136, ph = narrow ? 110 : lw - 136 - 22, cy = narrow ? py + ph + 52 : lw + 52, ch = h - cy - 26;
  /* the scene from above: the field as colour and opacity, the true outlines, the data cameras and one held-out camera with the ray drawn below */
  var v = D.view(8, 8, lw, lw, -6.8, 6.8, -6.8, 6.8), den = F.density();
  D.frame(ctx, 8, 8, lw, lw, C.panel); D.grid(ctx, v, 2);
  for (j = 0; j < nx - 1; j++) for (i = 0; i < nx - 1; i++) {
    var a = j * nx + i, sg = (den[a] + den[a + 1] + den[a + nx] + den[a + nx + 1]) / 4, al = 1 - Math.exp(-sg * hh);
    if (al < 0.02) continue;
    var c0 = F.color(a), c1 = F.color(a + 1), c2 = F.color(a + nx), c3 = F.color(a + nx + 1);
    ctx.fillStyle = D.rgb([(c0[0] + c1[0] + c2[0] + c3[0]) / 4, (c0[1] + c1[1] + c2[1] + c3[1]) / 4, (c0[2] + c1[2] + c2[2] + c3[2]) / 4], al);
    var xa = Math.round(v.X(F.x0 + i * hh)), ya = Math.round(v.Y(F.z0 + (j + 1) * hh));
    ctx.fillRect(xa, ya, Math.round(v.X(F.x0 + (i + 1) * hh)) - xa, Math.round(v.Y(F.z0 + j * hh)) - ya);
  }
  D.scene(ctx, SC, v, { fillAlpha: 0, lineWidth: 1.4 });
  S.cams.forEach(function (c) { D.camera(ctx, c, v, { color: C.blue, fov: false }); });
  D.camera(ctx, hcam, v, { color: C.amber, len: 3.2, label: 'held-out ' + hi });
  var ray = FL.pixelRay(hcam, PIX + 0.5);
  D.wline(ctx, v, ray.ox, ray.oz, ray.ox + ray.dx * 12, ray.oz + ray.dz * 12, 'rgba(217,119,6,0.75)', 1.2);
  D.mono(ctx, 'blue: data · amber: held-out · lines: truth', 12, lw + 18, C.mute, 9);
  /* the held-out camera's photograph, the field's prediction, where they disagree */
  var pred = F.renderCam(hcam), truth = WL.heldImg[hi], sh = 16, px = rx + (PIX + 0.5) * rw / hcam.W;
  D.strip(ctx, truth, rx, ry, rw, sh, { label: 'photograph, held-out camera ' + hi });
  D.strip(ctx, pred, rx, ry + 40, rw, sh, { label: 'the field’s prediction' });
  D.errorStrip(ctx, pred, truth, rx, ry + 80, rw, sh, { label: 'where they disagree: ' + FL.psnr(pred, truth).toFixed(1) + ' dB' });
  D.line(ctx, px, ry - 4, px, ry + 80 + sh + 4, C.amber, 1.2);
  /* the 48 samples of the amber ray: density, transmittance, stopping weight */
  var bx = FL.vol.rayBox(ray.ox, ray.oz, ray.dx, ray.dz, F.x0, F.x1, F.z0, F.z1);
  D.frame(ctx, rx, py, rw, ph, C.white);
  if (bx) {
    var f = N9.ray(F, ray, bx[0], bx[1], N9.NS, 0), cw = rw / N9.NS, smax = 1e-9, wmax = 1e-9, big = 0, tp = [];
    for (k = 0; k < N9.NS; k++) { smax = Math.max(smax, f.sig[k]); wmax = Math.max(wmax, f.w[k]); if (f.w[k] >= N9.EPS) big++; }
    for (k = 0; k < N9.NS; k++) {
      ctx.fillStyle = 'rgba(148,163,184,0.5)'; ctx.fillRect(rx + k * cw, py + ph * 0.5 - ph * 0.42 * f.sig[k] / smax, cw * 0.9, ph * 0.42 * f.sig[k] / smax);
      ctx.fillStyle = C.amber; ctx.fillRect(rx + k * cw, py + ph - 3 - ph * 0.42 * f.w[k] / wmax, cw * 0.9, ph * 0.42 * f.w[k] / wmax);
      tp.push([rx + (k + 0.5) * cw, py + ph * 0.5 - ph * 0.42 * f.Ts[k]]);
    }
    D.path(ctx, tp, C.blue, 1.5);
    D.mono(ctx, big + ' of ' + N9.NS + ' samples carry weight ≥ 1/255', rx + 4, py + ph + 12, C.mute, 9);
  }
  D.mono(ctx, 'one ray: σ grey, T blue, w orange', rx + 4, py - 8, C.mute, 9);
  /* the exam score against the steps */
  var xm = Math.max(150, Math.ceil(S.steps / 50) * 50), cx0 = 8 + 26, cx1 = w - 14;
  var X = function (s) { return cx0 + s / xm * (cx1 - cx0); }, Y = function (db) { return cy + ch - Math.max(0, Math.min(40, db)) / 40 * ch; };
  D.frame(ctx, 8, cy, w - 16, ch, C.white);
  [0, 10, 20, 30, 40].forEach(function (db) { D.line(ctx, cx0, Y(db), cx1, Y(db), C.grid, 1); D.mono(ctx, String(db), 12, Y(db), C.mute, 9); });
  for (k = 0; k <= xm; k += 50) D.mono(ctx, String(k), X(k), cy + ch + 11, C.mute, 9, 'center');
  D.line(ctx, cx0, Y(S.nearest), cx1, Y(S.nearest), C.mute, 1.2, [5, 4]);
  D.path(ctx, S.curve.map(function (p) { return [X(p[0]), Y(p[1])]; }), C.blue, 2);
  D.path(ctx, S.curve.map(function (p) { return [X(p[0]), Y(p[2])]; }), C.amber, 2);
  D.mono(ctx, 'exam score (dB) against training steps', 14, cy - 20, C.mute, 9);
  D.mono(ctx, 'blue data · amber held-out · dashed nearest photo', 14, cy - 8, C.mute, 9);
};

if (typeof module !== 'undefined' && module.exports) module.exports = N9;
root.N9 = N9;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
