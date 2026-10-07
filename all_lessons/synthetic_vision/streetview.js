/* streetview.js — canvas helpers shared by the lessons of the Synthetic Vision Data series (load after street.js).  Everything here only draws; nothing computes a result.
 * Frames are SV images: Float32Array(3*W*H), the red plane, then green, then blue, values 0..1.  Text goes through V.text / V.mono / V.label, which shrink or clip a string
 * rather than let it leave the canvas, so narrow screens cut nothing off. */
(function (root) {
'use strict';
var SV = root.SV, V = {}, PI = Math.PI;
SV.view = V;
V.C = { ink: '#17221f', mute: '#5d6c67', dim: '#92a09b', grid: '#dde8e4', teal: '#087f68', tealSoft: '#dcf4ed', amber: '#c56a09', amberSoft: '#fbe8cf', red: '#cf3e51', redSoft: '#fbdde1',
        green: '#16844d', greenSoft: '#d8f0e1', blue: '#2563eb', blueSoft: '#dbe7ff', violet: '#7c3aed', violetSoft: '#e9defd', panel: '#f7faf9', white: '#ffffff' };
var C = V.C;

/* DPR-aware canvas setup; returns {ctx, w, h} in CSS pixels */
V.setup = function (canvas) {
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  var w = Math.max(280, canvas.clientWidth || 640), h = Math.max(120, canvas.clientHeight || 300);
  var rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  return { ctx: ctx, w: w, h: h };
};
V.line = function (ctx, x1, y1, x2, y2, color, width, dash) {
  ctx.save(); ctx.strokeStyle = color || C.ink; ctx.lineWidth = width || 1; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
};
V.dot = function (ctx, x, y, r, fill, stroke) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); ctx.fillStyle = fill || C.ink; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
};
V.frame = function (ctx, x, y, w, h, fill, stroke) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  ctx.strokeStyle = stroke || C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
};
/* text that cannot leave the canvas: shrink to 75 % (not below 7 px), then truncate with an ellipsis */
V.fit = function (ctx, s, x, align, size, fontOf) {
  var cv = ctx.canvas, cw = cv && cv.clientWidth, sz = size, w, t, n, m;
  s = String(s); t = s;
  ctx.font = fontOf(sz);
  if (!cw || !ctx.measureText) return { s: s, size: sz };
  var avail = align === 'right' ? x - 2 : align === 'center' ? 2 * Math.min(x - 2, cw - 2 - x) : cw - 2 - x;
  m = ctx.measureText(s); w = m && m.width;
  if (!(w > avail)) return { s: s, size: sz };
  while (w > avail && sz > Math.max(7, size * 0.75)) { sz -= 0.5; ctx.font = fontOf(sz); m = ctx.measureText(s); w = m && m.width; }
  for (n = s.length; w > avail && n > 3; ) { n--; t = s.slice(0, n) + '…'; m = ctx.measureText(t); w = m && m.width; }
  return { s: n < s.length ? t : s, size: sz };
};
V.text = function (ctx, s, x, y, color, size, align, weight) {
  var f = function (z) { return (weight || 500) + ' ' + z + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif'; }, r = V.fit(ctx, s, x, align || 'left', size || 12, f);
  ctx.fillStyle = color || C.ink; ctx.font = f(r.size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.s, x, y);
};
V.mono = function (ctx, s, x, y, color, size, align) {
  var f = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; }, r = V.fit(ctx, s, x, align || 'left', size || 10, f);
  ctx.fillStyle = color || C.mute; ctx.font = f(r.size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.s, x, y);
};
V.label = function (ctx, s, x, y, color, size, align) { V.mono(ctx, s, x, y, color || C.mute, size || 10, align); };

function rgb(c) { return 'rgb(' + Math.round(255 * Math.min(1, Math.max(0, c[0]))) + ',' + Math.round(255 * Math.min(1, Math.max(0, c[1]))) + ',' + Math.round(255 * Math.min(1, Math.max(0, c[2]))) + ')'; }
V.rgb = rgb;
/* a frame: nearest-neighbour blow-up of the W x H image into the box (x, y, w, h); o.gain brightens, o.border.  The pixels go through a W x H sprite that is built once per
 * (image, gain) and stretched with smoothing off, so a page full of thumbnails costs one drawImage each. */
var SPRITES = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function sprite(img, g) {
  var W = SV.CAM.W, H = SV.CAM.H, HW = W * H, hit = SPRITES && SPRITES.get(img);
  if (hit && hit.g === g) return hit.c;
  if (typeof document === 'undefined') return null;
  var c = document.createElement('canvas'), q, k;
  c.width = W; c.height = H;
  var cx = c.getContext && c.getContext('2d');
  if (!cx || !cx.createImageData) return null;
  var id = cx.createImageData(W, H), d = id.data;
  for (q = 0; q < HW; q++) {
    for (k = 0; k < 3; k++) d[4 * q + k] = Math.round(255 * Math.min(1, Math.max(0, img[k * HW + q] * g)));
    d[4 * q + 3] = 255;
  }
  cx.putImageData(id, 0, 0);
  if (SPRITES) SPRITES.set(img, { g: g, c: c });
  return c;
}
V.image = function (ctx, x, y, w, h, img, o) {
  o = o || {};
  var W = SV.CAM.W, H = SV.CAM.H, HW = W * H, cw = w / W, ch = h / H, g = o.gain || 1, i, j, sp = sprite(img, g);
  if (sp) { ctx.imageSmoothingEnabled = false; ctx.drawImage(sp, x, y, w, h); }
  else for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
    var q = j * W + i;
    ctx.fillStyle = rgb([img[q] * g, img[HW + q] * g, img[2 * HW + q] * g]);
    ctx.fillRect(x + i * cw, y + j * ch, cw + 0.6, ch + 0.6);
  }
  ctx.strokeStyle = o.border || C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (o.label) V.mono(ctx, o.label, x, y - 7, C.mute, 10);
};
/* a five-stop colour ramp (dark blue, teal, green, yellow, light) for depth and range */
var RAMP = [[0.18, 0.2, 0.45], [0.1, 0.45, 0.6], [0.15, 0.62, 0.45], [0.85, 0.8, 0.25], [0.98, 0.95, 0.75]];
V.ramp = function (t) { t = Math.min(1, Math.max(0, t)); var k = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(k)), f = k - i; return [RAMP[i][0] * (1 - f) + RAMP[i + 1][0] * f, RAMP[i][1] * (1 - f) + RAMP[i + 1][1] * f, RAMP[i][2] * (1 - f) + RAMP[i + 1][2] * f]; };
/* a single plane through the ramp (arr: W*H numbers; zero = nothing there, drawn grey) */
V.plane = function (ctx, x, y, w, h, arr, lo, hi, o) {
  o = o || {};
  var W = SV.CAM.W, H = SV.CAM.H, cw = w / W, ch = h / H, i, j;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
    var v = arr[j * W + i];
    ctx.fillStyle = (o.zeroGrey && v === 0) ? '#e8eeec' : rgb(V.ramp((v - lo) / (hi - lo)));
    ctx.fillRect(x + i * cw, y + j * ch, cw + 0.6, ch + 0.6);
  }
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (o.label) V.mono(ctx, o.label, x, y - 7, C.mute, 10);
};
/* a coverage mask: the pedestrian's pixels in colour over white (alpha = coverage) */
V.mask = function (ctx, x, y, w, h, cov, color, o) {
  o = o || {};
  var W = SV.CAM.W, H = SV.CAM.H, cw = w / W, ch = h / H, i, j;
  V.frame(ctx, x, y, w, h, '#f4f8f7');
  ctx.fillStyle = color || C.teal;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
    var a = cov[j * W + i];
    if (a > 0) { ctx.globalAlpha = Math.min(1, 0.25 + 0.75 * a); ctx.fillRect(x + i * cw, y + j * ch, cw + 0.6, ch + 0.6); }
  }
  ctx.globalAlpha = 1;
  if (o.label) V.mono(ctx, o.label, x, y - 7, C.mute, 10);
};
/* the detector's logit map (stride-2 cells) as a diverging map: grey-blue below zero, red above; cells above the threshold are outlined, the largest is boxed */
V.heat = function (ctx, x, y, w, h, lg, o) {
  o = o || {};
  var nu = lg.nu, nv = lg.nv, cw = w / nu, ch = h / nv, lo = o.lo === undefined ? -6 : o.lo, hi = o.hi === undefined ? 6 : o.hi, best = -Infinity, bi = 0, i, j;
  V.frame(ctx, x, y, w, h, '#ffffff');
  for (j = 0; j < nv; j++) for (i = 0; i < nu; i++) {
    var z = lg.z[j * nu + i], t;
    if (z > best) { best = z; bi = j * nu + i; }
    if (z >= 0) { t = Math.min(1, z / hi); ctx.fillStyle = 'rgb(' + Math.round(255 - 40 * t) + ',' + Math.round(255 - 190 * t) + ',' + Math.round(255 - 200 * t) + ')'; }
    else { t = Math.min(1, z / lo); ctx.fillStyle = 'rgb(' + Math.round(255 - 70 * t) + ',' + Math.round(255 - 45 * t) + ',' + Math.round(255 - 15 * t) + ')'; }
    ctx.fillRect(x + i * cw, y + j * ch, cw + 0.5, ch + 0.5);
  }
  if (o.thr !== undefined) {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
    for (j = 0; j < nv; j++) for (i = 0; i < nu; i++) if (lg.z[j * nu + i] > o.thr) ctx.strokeRect(x + i * cw + 0.5, y + j * ch + 0.5, cw - 1, ch - 1);
  }
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x + (bi % nu) * cw - 1, y + Math.floor(bi / nu) * ch - 1, cw + 2, ch + 2);
  if (o.mark) {                                                   /* where the pedestrian really is: the bounding box of the pixels that are at least half pedestrian */
    var W = SV.CAM.W, Hh = SV.CAM.H, i0 = W, i1 = -1, j0 = Hh, j1 = -1, pxw = w / W, pxh = h / Hh;
    for (j = 0; j < Hh; j++) for (i = 0; i < W; i++) if (o.mark[j * W + i] > 0.5) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    if (i1 >= 0) { ctx.save(); ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(x + i0 * pxw - 1, y + j0 * pxh - 1, (i1 - i0 + 1) * pxw + 2, (j1 - j0 + 1) * pxh + 2); ctx.restore(); }
  }
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (o.label) V.mono(ctx, o.label, x, y - 7, C.mute, 10);
  return best;
};

/* a plot box with ticks and axis labels; returns the mapping.  o: xmin xmax ymin ymax, xlog, xticks, yticks, xfmt, yfmt, xlabel, ylabel */
V.plot = function (ctx, bx, by, bw, bh, o) {
  var xmin = o.xmin, xmax = o.xmax, ymin = o.ymin, ymax = o.ymax, xl = !!o.xlog, i;
  var fx = function (x) { return xl ? Math.log(x) : x; }, a = fx(xmin), b = fx(xmax);
  var X = function (x) { return bx + (fx(x) - a) / (b - a) * bw; }, Y = function (y) { return by + bh - (y - ymin) / (ymax - ymin) * bh; };
  V.frame(ctx, bx, by, bw, bh, C.white, C.grid);
  (o.yticks || []).forEach(function (t) { V.line(ctx, bx, Y(t), bx + bw, Y(t), C.grid, 1); V.mono(ctx, (o.yfmt || String)(t), bx - 4, Y(t), C.mute, 9, 'right'); });
  (o.xticks || []).forEach(function (t) { V.line(ctx, X(t), by + bh, X(t), by + bh + 3, C.dim, 1); V.mono(ctx, (o.xfmt || String)(t), X(t), by + bh + 11, C.mute, 9, 'center'); });
  if (o.xlabel) V.mono(ctx, o.xlabel, bx + bw, by + bh + 24, C.mute, 10, 'right');
  if (o.ylabel) V.mono(ctx, o.ylabel, bx, by - 8, C.mute, 10);
  return { X: X, Y: Y, bx: bx, by: by, bw: bw, bh: bh };
};
V.curve = function (ctx, P, xs, ys, color, width, dash) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); ctx.beginPath();
  for (var i = 0; i < xs.length; i++) { if (i) ctx.lineTo(P.X(xs[i]), P.Y(ys[i])); else ctx.moveTo(P.X(xs[i]), P.Y(ys[i])); }
  ctx.stroke(); ctx.restore();
};
V.dots = function (ctx, P, xs, ys, color, r) { for (var i = 0; i < xs.length; i++) V.dot(ctx, P.X(xs[i]), P.Y(ys[i]), r || 3, color, C.white); };
/* a horizontal bar of width proportional to v (0..vmax) in the box; returns nothing */
V.bar = function (ctx, x, y, w, h, v, vmax, color, bg) {
  V.frame(ctx, x, y, w, h, bg || '#f1f6f4', C.grid);
  ctx.fillStyle = color || C.teal; ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, Math.max(0, v / vmax))), h - 2);
};
V.pct = function (x, d) { return (100 * x).toFixed(d === undefined ? 0 : d) + '%'; };

if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
