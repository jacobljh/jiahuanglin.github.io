/* l07_view.js — the drawing and wiring of Lesson 7's widget (load after streetview.js, l07_labels.js and l07_data.js; the page calls SV.l07.wire()).
   It only draws and reads: every count and miss rate it shows is computed here from the columns of SV.L07 (the pedestrians of the real test set and the 3,000 frames of Lesson 6's rare slice, built by
   tools/chain/verify/engine/build_l07.js) and from the decisions of nine detectors stored there; the little pictures are the real frames, re-rendered by the engine (SV.l07.cover) when they are drawn. */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l07;

L.wire = function () {
  var cv = document.getElementById('w07-canvas');
  if (!cv || !SV.view || !SV.L07) return;
  var V = SV.view, C = V.C, D = SV.L07, IDS = D.ids, W = SV.CAM.W, H = SV.CAM.H;
  function $(id) { return document.getElementById(id); }
  var el = { cut: $('w07-cut'), cutv: $('w07-cut-v'), k6: $('w07-k6'), pop: $('w07-pop'), area: $('w07-area'), det: $('w07-det'), dist: $('w07-dist'), off: $('w07-off'),
             n: $('w07-n'), miss: $('w07-miss'), vs: $('w07-vs'), spread: $('w07-spread'), close: $('w07-close'), iou: $('w07-iou') };
  var NAME = { modal: 'program: any pixel', rel15: 'street: 15%', rel50: 'taught at 50%', amodal: 'amodal', shift05: 'half pixel off', shift10: 'one pixel off', fine: '8x8 rays', ray: 'centre ray', soft: 'default filter' };
  var READ = { lab: ['a', 'f'], fine: ['a8', 'f8'], ray: ['a1', 'f'], filter: ['aB', 'f'], amodal: ['f', 'f'] };
  var COL = { modal: C.teal, rel15: C.blue, rel50: C.violet, amodal: C.amber, shift05: C.red, shift10: '#8a1f2f', fine: C.green, ray: '#6b7d77', soft: '#b08a00' };
  var POP = {}, cache = {}, order = {};
  function load(key, cols, n, fnd, frameOf) {
    var q = { n: n, c: {}, found: {}, frameOf: frameOf }, k;
    Object.keys(cols).forEach(function (c) { q.c[c] = L.unpack(D[key][c], D.pack[key][c]); });
    IDS.forEach(function (id) { q.found[id] = L.unbits(D[fnd][id], n); });
    q.rng = []; for (k = 0; k < n; k++) q.rng.push(L.footRange(q.c.x[k], q.c.z[k]));
    return q;
  }
  POP.all = load('ped', D.ped, D.sets.ped, 'found', function (k) { return SV.sample(SV.REAL, SV.SEEDS.test + POP.all.c.i[k]); });
  POP.R = load('R', D.R, D.sets.R, 'foundR', function (k) { return L.rareFrame(D.sets.seedR + k); });
  function frac(q, rd, k) { var r = READ[rd]; return q.c[r[1]][k] > 0 ? q.c[r[0]][k] / q.c[r[1]][k] : 0; }
  function counts(q, k, st) { var r = READ[st.rd]; return q.c[r[0]][k] >= st.k && q.c[r[0]][k] >= st.r * q.c[r[1]][k]; }
  function missOf(q, id, st) { var n = 0, m = 0, i; for (i = 0; i < q.n; i++) if (counts(q, i, st)) { n++; if (!q.found[id][i]) m++; } return { n: n, miss: n ? m / n : 0 }; }
  function pct(x, dd) { return (100 * x).toFixed(dd === undefined ? 1 : dd) + '%'; }
  function state() { return { r: +el.cut.value, k: el.k6.checked ? 6 : 1, pop: el.pop.value, rd: el.area.value, det: el.det.value, dist: el.dist.value, off: el.off.checked }; }
  function atCut(q, st) {                   // three pedestrians just under the cut and three just over it (among those with enough pixels)
    var rd = st.rd === 'amodal' ? 'lab' : st.rd, key = st.pop + rd, o = order[key], i, below = [], above = [], A = READ[rd][0], ok = [];
    if (!o) { o = []; for (i = 0; i < q.n; i++) o.push(i); o.sort(function (a, b) { return frac(q, rd, a) - frac(q, rd, b) || a - b; }); order[key] = o; }
    for (i = 0; i < o.length; i++) if (q.c[A][o[i]] >= st.k && q.c.f[o[i]] >= 6) ok.push(o[i]);
    for (i = 0; i < ok.length; i++) { if (frac(q, rd, ok[i]) < st.r) below.push(ok[i]); else above.push(ok[i]); }
    return below.slice(-3).concat(above.slice(0, 6 - Math.min(3, below.length)));
  }
  function frame(q, pk, i) {                // the real frame and its masks, re-rendered once
    var key = pk + ':' + i;
    if (!cache[key]) {
      var fr = q.frameOf(i), sc = fr.scene, sil = L.cover(sc, { only: 'ped' }), u = 0, s = 0, j;
      for (j = 0; j < sil.length; j++) { u += sil[j] * (j % W); s += sil[j]; }
      cache[key] = { x: fr.x, cov: fr.cov, sil: sil, sc: sc, u0: Math.max(0, Math.min(W - 24, Math.round(s ? u / s : 48) - 12)), m: {} };
    }
    return cache[key];
  }
  function mask(f, kind) {
    if (!f.m[kind]) f.m[kind] = kind === 'fine' ? L.cover(f.sc, { SSh: 8, SSv: 8 }) : kind === 'ray' ? L.cover(f.sc, { SSh: 1, SSv: 1 }) : kind === 'filter' ? L.blur(f.cov, D.sigX) : kind === 'shift' ? L.cover(f.sc, { dx: 0.5, dy: 0.5 }) : kind === 'amodal' ? f.sil : f.cov;
    return f.m[kind];
  }
  function tile(ctx, f, x, y, s, st) {
    var cell = s / 24, vis = mask(f, st.rd), sh = st.off ? mask(f, 'shift') : null, a, b, q;
    for (b = 0; b < H; b++) for (a = 0; a < 24; a++) {
      q = b * W + f.u0 + a;
      ctx.fillStyle = V.rgb([f.x[q] * 1.6, f.x[W * H + q] * 1.6, f.x[2 * W * H + q] * 1.6]); ctx.fillRect(x + a * cell, y + b * cell, cell + 0.5, cell + 0.5);
      if (f.sil[q] >= 0.5 && f.cov[q] < 0.5) { ctx.globalAlpha = 0.5; ctx.fillStyle = C.amber; ctx.fillRect(x + a * cell, y + b * cell, cell + 0.5, cell + 0.5); ctx.globalAlpha = 1; }
      if (vis[q] > 0) { ctx.globalAlpha = Math.min(0.75, 0.15 + 0.6 * vis[q]); ctx.fillStyle = C.teal; ctx.fillRect(x + a * cell, y + b * cell, cell + 0.5, cell + 0.5); ctx.globalAlpha = 1; }
      if (sh && sh[q] >= 0.5) { ctx.strokeStyle = C.violet; ctx.lineWidth = 1.5; ctx.strokeRect(x + a * cell + 1, y + b * cell + 1, cell - 2, cell - 2); }
    }
  }
  function heightFor(w, narrow) { var cols = narrow ? 3 : 6, ts = Math.min(150, (w - 16 - (cols - 1) * 8) / cols); return Math.ceil((narrow ? 258 : 278) + (6 / cols - 1) * (ts + 44) + ts + 44); }
  function capFit(ctx, s, size, maxW) {
    var fo = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; }, sz = size, t = s, n,
      wd = function (u) { var m = ctx.measureText ? ctx.measureText(u) : null; return m && m.width ? m.width : 0; };
    ctx.font = fo(sz);
    while (wd(t) > maxW && sz > 7) { sz -= 0.5; ctx.font = fo(sz); }
    for (n = s.length; wd(t) > maxW && n > 3; ) { n--; t = s.slice(0, n) + '…'; }
    return { s: t, size: sz };
  }
  function draw(st, q) {
    var narrow = cv.clientWidth < 640, w0 = Math.max(280, cv.clientWidth || 640);
    cv.style.height = heightFor(w0, narrow) + 'px';
    var S = V.setup(cv), ctx = S.ctx, w = S.w, pad = 8, i, y = 4, cuts = [];
    V.mono(ctx, 'reported miss rate against the cut, nine detectors', pad, y + 6, C.mute, 10);
    var bx = 40, bw = w - bx - 14, bh = narrow ? 170 : 190, by = y + 24;
    for (i = 0; i <= 16; i++) cuts.push(i * 0.05);
    var Pl = V.plot(ctx, bx, by, bw, bh, { xmin: 0, xmax: 0.8, ymin: 0.2, ymax: 0.9, xticks: [0, 0.15, 0.3, 0.5, 0.65, 0.8], yticks: [0.2, 0.4, 0.6, 0.8], yfmt: function (t) { return Math.round(100 * t) + '%'; }, xfmt: function (t) { return Math.round(100 * t) + '%'; }, xlabel: 'visible fraction of the silhouette that must show' });
    V.line(ctx, Pl.X(0.15), by, Pl.X(0.15), by + bh, C.dim, 1, [3, 3]); V.mono(ctx, 'street 15%', Pl.X(0.15) + 3, by + 9, C.dim, 9);
    IDS.forEach(function (id) {
      var ys = cuts.map(function (r) { return missOf(q, id, { r: r, k: st.k, rd: st.rd }).miss; });
      V.curve(ctx, Pl, cuts, ys, id === st.det ? COL[id] : '#c3d0cb', id === st.det ? 3 : 1.4);
    });
    V.line(ctx, Pl.X(st.r), by, Pl.X(st.r), by + bh, C.ink, 1.5);
    IDS.forEach(function (id) { V.dot(ctx, Pl.X(st.r), Pl.Y(missOf(q, id, st).miss), id === st.det ? 4.5 : 2.5, COL[id], C.white); });
    var m = missOf(q, st.det, st);
    V.mono(ctx, NAME[st.det] + ': ' + pct(m.miss) + ' of ' + m.n + ' counted', Math.min(Pl.X(st.r) + 6, bx + bw - 190), by + bh - 8, C.ink, 10);
    y = by + bh + 34;
    V.mono(ctx, 'three just under the cut (not counted), three just over', pad, y + 2, C.mute, 10);
    V.mono(ctx, 'teal visible · amber hidden' + (st.off ? ' · violet shifted' : ''), pad, y + 14, C.mute, 10);
    y += 26;
    var cols = narrow ? 3 : 6, gap = 8, ts = Math.min(150, (w - 2 * pad - (cols - 1) * gap) / cols);
    atCut(q, st).forEach(function (idx, t) {
      var tx = pad + (t % cols) * (ts + gap), ty = y + Math.floor(t / cols) * (ts + 44), ct = counts(q, idx, st), fd = q.found[st.det][idx], cap;
      tile(ctx, frame(q, st.pop, idx), tx, ty, ts, st);
      ctx.strokeStyle = ct ? (fd ? C.green : C.red) : C.dim; ctx.lineWidth = 2.5; ctx.setLineDash(ct ? [] : [4, 3]); ctx.strokeRect(tx + 1, ty + 1, ts - 2, ts - 2); ctx.setLineDash([]);
      cap = capFit(ctx, pct(frac(q, st.rd === 'amodal' ? 'lab' : st.rd, idx), 0) + ' of ' + q.c.f[idx].toFixed(1) + ' px2', 9.5, ts);
      V.mono(ctx, cap.s, tx, ty + ts + 9, C.ink, cap.size);
      cap = capFit(ctx, ct ? (fd ? 'counted, found' : 'counted, missed') : 'not counted', 9, ts);
      V.mono(ctx, cap.s, tx, ty + ts + 21, ct ? (fd ? C.green : C.red) : C.mute, cap.size);
      cap = capFit(ctx, (st.dist === 'range' ? 'range ' : 'depth ') + (st.dist === 'range' ? q.rng[idx] : q.c.z[idx]).toFixed(1) + ' m', 9, ts);
      V.mono(ctx, cap.s, tx, ty + ts + 33, C.mute, cap.size);
    });
  }
  function update() {
    var st = state(), q = POP[st.pop], m = missOf(q, st.det, st), ex = missOf(q, st.det, { r: 0.15, k: 6, rd: 'lab' }), i, lo = 1, hi = 0, nc = 0, mc = 0, iu = 0, ni = 0;
    el.cutv.textContent = Math.round(100 * st.r) + '%';
    el.n.textContent = String(m.n);
    el.miss.textContent = pct(m.miss);
    el.vs.textContent = ((m.miss - ex.miss) >= 0 ? '+' : '−') + (100 * Math.abs(m.miss - ex.miss)).toFixed(1) + ' pts';
    IDS.forEach(function (id) { var v = missOf(q, id, st).miss; if (v < lo) lo = v; if (v > hi) hi = v; });
    el.spread.textContent = (100 * (hi - lo)).toFixed(1) + ' pts';
    for (i = 0; i < q.n; i++) if (counts(q, i, st)) { if ((st.dist === 'range' ? q.rng[i] : q.c.z[i]) < 12) { nc++; if (!q.found[st.det][i]) mc++; } if (q.c.iou05) { iu += q.c.iou05[i]; ni++; } }
    el.close.textContent = nc + ' · ' + pct(nc ? mc / nc : 0);
    el.iou.textContent = ni ? pct(iu / ni, 0) : '—';
    draw(st, q);
  }
  ['input', 'change'].forEach(function (ev) { [el.cut, el.k6, el.pop, el.area, el.det, el.dist, el.off].forEach(function (e) { e.addEventListener(ev, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
