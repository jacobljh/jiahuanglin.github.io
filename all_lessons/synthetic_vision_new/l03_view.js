/* l03_view.js — the drawing of the Lesson 3 widget.  Pictures only: every number drawn arrives in the state object `s`; nothing is computed here except plot coordinates.
 *   X.images   the same radiance through three sensors, each with the detector's score map (wide screens) and a verdict line
 *   X.noise    the photon-transfer plot of the flat frames, with the five candidate laws
 *   X.edge     one edge frame against the renderer's own edge and the blurred edge that fits
 *   X.exposure the exposure log: gain against the level the controller saw, for the street and for the program
 *   X.bars     the miss rate of the programs whose camera has only some of its parts */
(function (root) {
'use strict';
var SV = root.SV, V = SV.view, C = V.C, L = SV.l03, X = {};
L.view = X;
function lg(v) { return Math.log(v) / Math.LN10; }
function geo(a, b, n) { var o = [], i; for (i = 0; i < n; i++) o.push(a * Math.pow(b / a, i / (n - 1))); return o; }
function clipTo(ctx, x, y, w, h, fn) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); fn(); ctx.restore(); }
function sig(v, d) { return Number(v).toFixed(d); }

/* the height X.images uses on a canvas w pixels wide */
X.imagesHeight = function (w) { var narrow = w < 640, cw = narrow ? w - 16 : Math.floor((w - 32) / 3), ih = cw / 4; return narrow ? 3 * (ih + 30) : 17 + 2 * ih + 20; };
/* the same radiance through three sensors: s = {names, imgs, model, thr, cov, verdicts: [{text, color}]}; returns the height used */
X.images = function (ctx, x, y, w, s) {
  var narrow = w < 640, pad = 8, k, cw = narrow ? w - 2 * pad : Math.floor((w - 4 * pad) / 3), ih = cw / 4;
  for (k = 0; k < 3; k++) {
    var cx = narrow ? x + pad : x + pad + k * (cw + pad), ty = narrow ? y + k * (ih + 30) : y;
    V.mono(ctx, s.names[k], cx, ty + 6, C.ink, 10);
    V.image(ctx, cx, ty + 13, cw, ih, s.imgs[k], { gain: 1.6 });
    if (!narrow) V.heat(ctx, cx, ty + 17 + ih, cw, ih, SV.logits(s.model, s.imgs[k]), { thr: s.thr, lo: -8, hi: 10, mark: s.cov });
    V.mono(ctx, s.verdicts[k].text, cx, ty + (narrow ? 13 + ih + 9 : 17 + 2 * ih + 9), s.verdicts[k].color, 9.5);
  }
  return X.imagesHeight(w);
};

/* the photon-transfer plot: s = {levels: [{stop, mean, var, usable}], law: {a, b, c, rms, fw, read}} */
X.noise = function (ctx, x, y, w, h, s) {
  var bx = x + 40, by = y + 16, bw = w - 50, bh = h - 42, law = s.law;
  V.mono(ctx, 'flat frames: variance of q = DN^γ against its mean q (log scales)', x, y + 6, C.mute, 10);
  var P = V.plot(ctx, bx, by, bw, bh, { xmin: 0.001, xmax: 1.3, xlog: true, ymin: -7, ymax: -3, xticks: [0.001, 0.01, 0.1, 1], yticks: [-7, -6, -5, -4, -3], xfmt: function (t) { return t >= 0.1 ? String(t) : '1e' + Math.round(lg(t)); }, yfmt: function (t) { return '1e' + t; }, xlabel: 'mean level q' });
  var xs = geo(0.0011, 1.25, 40), f = { const: function () { return law.c.const; }, prop: function (u) { return law.c.prop * u * u; }, shot: function (u) { return law.c.shot * u; }, affine: function (u) { return law.a * u + law.b; } };
  clipTo(ctx, bx, by, bw, bh, function () {
    [['const', C.dim, [5, 4]], ['prop', C.amber, [5, 4]], ['shot', C.blue, [5, 4]], ['affine', C.teal, null]].forEach(function (c) {
      V.curve(ctx, P, xs, xs.map(function (u) { return lg(f[c[0]](u)); }), c[1], c[0] === 'affine' ? 2.4 : 1.6, c[2] || []);
    });
  });
  s.levels.forEach(function (o) {
    if (!(o.var > 1e-9) || !(o.mean > 0)) return;
    if (o.usable) V.dot(ctx, P.X(o.mean), P.Y(lg(o.var)), 4, C.ink, C.white); else V.dot(ctx, P.X(o.mean), P.Y(lg(o.var)), 4, C.white, C.dim);
  });
  var lx = bx + bw * 0.46, ly = by + bh - 62, r = law.rms;
  V.mono(ctx, 'rms of log10(measured / law)', lx, ly, C.mute, 9.5);
  V.mono(ctx, 'constant          ' + sig(r.const, 2), lx, ly + 12, C.dim, 9.5);
  V.mono(ctx, 'noise ∝ level     ' + sig(r.prop, 2), lx, ly + 24, C.amber, 9.5);
  V.mono(ctx, 'counting only     ' + sig(r.shot, 3), lx, ly + 36, C.blue, 9.5);
  V.mono(ctx, 'counting + read   ' + sig(r.affine, 3), lx, ly + 48, C.teal, 9.5);
  V.mono(ctx, '● used   ○ clipped, left out', bx + 8, by + 11, C.mute, 9.5);
};

/* one edge frame: s = {first: {t, xc, x0, sigma}, per: [sigma of each frame]} */
X.edge = function (ctx, x, y, w, h, s) {
  var f = s.first, bx = x + 34, by = y + 16, bw = w - 46, bh = h - 42, a = f.xc - 6, b = f.xc + 6, i;
  V.mono(ctx, 'edge target, one frame: level across the edge (24 rows, 3 colours averaged)', x, y + 6, C.mute, 10);
  var P = V.plot(ctx, bx, by, bw, bh, { xmin: -6.5, xmax: 6.5, ymin: -0.1, ymax: 1.1, xticks: [-6, -3, 0, 3, 6], yticks: [0, 0.5, 1], yfmt: function (t) { return String(t); }, xlabel: 'pixels from the edge' });
  var sharp = L.edgeProfile(f.x0), mod = L.edgeModel(f.x0, f.sigma, a, b), ux = [], my = [];
  for (i = a; i <= b; i++) { ux.push(i + 0.5 - f.x0); my.push(mod[i - a]); }
  V.curve(ctx, P, ux, my, C.blue, 2);
  for (i = a; i <= b; i++) V.dot(ctx, P.X(i + 0.5 - f.x0), P.Y(sharp[i]), 3.2, C.white, C.amber);
  for (i = a; i <= b; i++) V.dot(ctx, P.X(i + 0.5 - f.x0), P.Y(f.t[i]), 3.6, C.ink, C.white);
  var lx = bx + bw * 0.5, ly = by + bh - 48;
  V.mono(ctx, '● camera frame', lx, ly, C.ink, 9.5);
  V.mono(ctx, '○ renderer, 2 rays per pixel', lx, ly + 12, C.amber, 9.5);
  V.mono(ctx, '— renderer, then blur σ = ' + sig(f.sigma, 2) + ' px', lx, ly + 24, C.blue, 9.5);
  V.mono(ctx, s.per.length + ' frame' + (s.per.length > 1 ? 's' : '') + ': mean σ = ' + sig(s.mean, 3) + ' px', lx, ly + 36, C.mute, 9.5);
};

/* the exposure log: s = {street: [{gain, level}], prog: [{gain, level}], target, maxGain} */
X.exposure = function (ctx, x, y, w, h, s) {
  var bx = x + 30, by = y + 16, bw = w - 42, bh = h - 42;
  V.mono(ctx, 'the exposure log: the gain the camera chose against the level it saw', x, y + 6, C.mute, 10);
  var P = V.plot(ctx, bx, by, bw, bh, { xmin: 0.0015, xmax: 0.09, xlog: true, ymin: 0, ymax: 9, xticks: [0.002, 0.005, 0.01, 0.02, 0.05], yticks: [1, 2, 4, 6, 8], xfmt: function (t) { return String(t); }, xlabel: 'level before the gain' });
  s.prog.forEach(function (p) { V.dot(ctx, P.X(p.level), P.Y(p.gain), 1.7, C.amber); });
  s.street.forEach(function (p) { V.dot(ctx, P.X(p.level), P.Y(p.gain), 1.7, C.teal); });
  var xs = geo(0.0016, 0.088, 60);
  clipTo(ctx, bx, by, bw, bh, function () { V.curve(ctx, P, xs, xs.map(function (u) { return Math.min(s.maxGain, Math.max(1, s.target / u)); }), C.ink, 1.6, [5, 3]); });
  var lx = bx + 10, ly = by + bh - 38;
  V.mono(ctx, '● street, ' + s.street.length + ' logged frames', lx, ly, C.teal, 9.5);
  V.mono(ctx, '● program, ' + s.prog.length + ' frames', lx, ly + 12, C.amber, 9.5);
  V.mono(ctx, '-- gain = clamp(' + sig(s.target, 3) + ' / level, 1, ' + sig(s.maxGain, 1) + ')', lx, ly + 24, C.ink, 9.5);
};

/* bars: s = {bars: [{label, v (0..1), color, sel}]} — the miss rate of the programs */
X.bars = function (ctx, x, y, w, h, s) {
  var bx = x + 34, by = y + 18, bw = w - 44, bh = h - 44, n = s.bars.length, slot = bw / n;
  V.mono(ctx, 'miss rate on the street: the program whose camera has only these parts', x, y + 6, C.mute, 10);
  var P = V.plot(ctx, bx, by, bw, bh, { xmin: 0, xmax: n, ymin: 0, ymax: 1, yticks: [0, 0.5, 1], yfmt: function (t) { return Math.round(100 * t) + '%'; } });
  s.bars.forEach(function (b, i) {
    var x0 = bx + i * slot + 4, bw2 = slot - 8, top = P.Y(b.v);
    ctx.fillStyle = b.color; ctx.fillRect(x0, top, bw2, P.Y(0) - top);
    if (b.sel) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x0, top, bw2, P.Y(0) - top); }
    V.mono(ctx, String(Math.round(100 * b.v)), x0 + bw2 / 2, top - 7, b.sel ? C.ink : C.mute, 9, 'center');
    V.mono(ctx, b.label, x0 + bw2 / 2, by + bh + 11, b.sel ? C.ink : C.mute, 9, 'center');
  });
};
if (typeof module !== 'undefined' && module.exports) module.exports = X;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
