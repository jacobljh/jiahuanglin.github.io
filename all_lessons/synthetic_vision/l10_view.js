/* l10_view.js — the drawing and wiring of Lesson 10's widget (load after streetview.js, l05_cases.js, l05_data.js, l10_reality.js and l10_data.js; the page calls SV.l10.wire()).
   It only draws and reads: the curves come from SV.L10 (built by tools/chain/verify/engine/build_l10.js), the arithmetic from SV.l10, and the scene estimates are computed here from labelled frames
   drawn on the spot (the first min(M, 800) frames of afternoon 1's stream) by Lesson 5's ruler. */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l10;

L.wire = function () {
  var cv = document.getElementById('w10-canvas');
  if (!cv || !SV.view || !SV.L10 || !SV.l05) return;
  var V = SV.view, C = V.C, D = SV.L10, GRID = [0].concat(D.protocol.M), PPF = D.grade.ppf, N = D.protocol.N, STREAM = L.stream(0), LIVE = 800;
  function $(id) { return document.getElementById(id); }
  var el = { m: $('w10-m'), mv: $('w10-m-v'), hold: $('w10-hold'), truth: $('w10-truth'), r: $('w10-r'), f: $('w10-f'), c: $('w10-c'), cf: $('w10-cf'), eq: $('w10-eq'), split: $('w10-split'), cert: $('w10-cert'), scene: $('w10-scene') };
  var KINDS = ['R', 'F', 'C', 'CF'], COL = { R: C.amber, F: C.violet, C: C.teal, CF: C.green }, TXT = { R: 'real frames only', F: 'naive program + real', C: 'calibrated program', CF: 'calibrated + real' };
  function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function pct(x, d) { return (100 * x).toFixed(d === undefined ? 1 : d) + '%'; }
  function commas(x) { return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  /* the three-seed means of every strategy at every budget, and the fitted real-only learning curve */
  var MEAN = {}, LO = {}, HI = {};
  KINDS.forEach(function (k) {
    MEAN[k] = GRID.map(function (M) { var c = D.cells[k][M]; return c ? mean(c.realMiss) : NaN; });
    LO[k] = GRID.map(function (M) { var c = D.cells[k][M]; return c ? Math.min.apply(null, c.realMiss) : NaN; });
    HI[k] = GRID.map(function (M) { var c = D.cells[k][M]; return c ? Math.max.apply(null, c.realMiss) : NaN; });
  });
  var RPTS = { M: [], y: [] };
  D.protocol.M.forEach(function (M) { D.cells.R[M].realMiss.forEach(function (y) { RPTS.M.push(M); RPTS.y.push(y); }); });
  var FIT = L.fitCurve(RPTS.M, RPTS.y);
  /* the miss rate of the best of the four at a training budget Mt (lower envelope of the means, linear in log M between the grid's budgets); Mt = 0 only the program calibrated from free evidence */
  function policy(Mt) {
    if (Mt <= 0) return MEAN.C[0];
    var best = Infinity;
    KINDS.forEach(function (k) { var Ms = GRID.slice(1), ys = MEAN[k].slice(1); best = Math.min(best, L.interp(Ms, ys, Mt)); });
    return best;
  }
  function bestKind(i) { var b = null; KINDS.forEach(function (k) { if (!isNaN(MEAN[k][i]) && (b === null || MEAN[k][i] < MEAN[b][i])) b = k; }); return b; }
  function idxOf(M) { return M <= 0 ? 0 : Math.max(0.4, 1 + Math.log(M / GRID[1]) / Math.LN2); }
  function eqText(x) { return !isFinite(x) || x > GRID[GRID.length - 1] ? 'beyond ' + commas(GRID[GRID.length - 1]) : commas(x < 100 ? Math.round(x / 5) * 5 : x < 1000 ? Math.round(x / 10) * 10 : Math.round(x / 50) * 50); }
  /* the scene read from the first min(M, 800) labelled frames: the estimate and a bootstrap over the pedestrians the frames hold (10th and 90th percentile of 100 resamples) */
  function scene(M) {
    var n = Math.min(M, LIVE), rs = STREAM.grow(n).rs.slice(0, n), ex = rs.filter(function (r) { return r && r.exam; }), e = SV.l05.estimate(rs, { bias: SV.L05.calib.bias, kappa: SV.L05.calib.kappa }), rng = SV.rng(100 + n), B = [], b, i;
    for (b = 0; b < 100; b++) { var s = []; for (i = 0; i < ex.length; i++) s.push(ex[Math.floor(rng() * ex.length)]); B.push(SV.l05.estimate(s, { bias: SV.L05.calib.bias, kappa: SV.L05.calib.kappa })); }
    function q(f, p) { var v = B.map(f).filter(function (x) { return isFinite(x); }).sort(function (a, c) { return a - c; }); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : NaN; }
    return { n: n, e: e, lo: [q(function (x) { return x.zlo; }, 0.1), q(function (x) { return x.zhi; }, 0.1), q(function (x) { return x.pEmerge; }, 0.1)], hi: [q(function (x) { return x.zlo; }, 0.9), q(function (x) { return x.zhi; }, 0.9), q(function (x) { return x.pEmerge; }, 0.9)] };
  }
  function state() {
    var i = +el.m.value, M = GRID[i], hold = el.hold.value, G, Mt, best = null, p, cert, w, eq, sc;
    if (M <= GRID[1]) G = 0;                                            // 25 frames or fewer: nothing to spare (the measured curves start at 25)
    else if (hold === 'best') { best = L.bestSplit(policy, M, PPF, GRID.slice(1)); G = best.grade; }
    else G = hold === 'quarter' ? Math.round(M / 4) : hold === 'half' ? Math.round(M / 2) : 0;
    Mt = M - G; p = policy(Mt);
    cert = G > 0 ? L.certify(p, G, PPF) : NaN; w = G > 0 ? L.halfWidth(p, PPF * G) : NaN;
    eq = L.realEq(FIT, p); sc = scene(Math.max(Mt, 0));
    return { i: i, M: M, G: G, Mt: Mt, p: p, cert: cert, w: w, eq: eq, sc: sc, best: bestKind(i) };
  }
  function draw(st) {
    var narrow = cv.clientWidth < 640;
    cv.style.height = (narrow ? 700 : 560) + 'px';
    var S = V.setup(cv), ctx = S.ctx, w = S.w, pad = 8, bx = 44, bw = w - bx - 14, by = 26, bh = narrow ? 230 : 260, k, i;
    V.mono(ctx, 'exam miss rate of the detector, three-seed mean, against real labelled frames M (log scale)', pad, 8, C.mute, 10);
    var P = V.plot(ctx, bx, by, bw, bh, { xmin: -0.3, xmax: 7.3, ymin: 0.4, ymax: 0.85, xticks: [0, 1, 2, 3, 4, 5, 6, 7], yticks: [0.4, 0.5, 0.6, 0.7, 0.8], yfmt: function (t) { return Math.round(100 * t) + '%'; }, xfmt: function (t) { return String(GRID[t]); }, xlabel: 'real labelled frames M' });
    var refs = [[D.ref.naive, 'naive program, any N', C.red], [D.ref.exact, 'the street\'s own scene, light and camera', C.ink]];
    refs.forEach(function (r) { V.line(ctx, bx, P.Y(r[0]), bx + bw, P.Y(r[0]), r[2], 1, [5, 4]); V.mono(ctx, r[1] + ' ' + pct(r[0]), bx + bw - 4, P.Y(r[0]) + (r[2] === C.red ? 9 : -8), r[2], 9, 'right'); });
    KINDS.forEach(function (kd) {
      var xs = [], ys = [];
      for (i = 0; i < GRID.length; i++) if (!isNaN(MEAN[kd][i])) { xs.push(i); ys.push(MEAN[kd][i]); V.line(ctx, P.X(i), P.Y(LO[kd][i]), P.X(i), P.Y(HI[kd][i]), COL[kd], 1); }
      V.curve(ctx, P, xs, ys, COL[kd], 2.2, kd === 'F' ? [6, 3] : []); V.dots(ctx, P, xs, ys, COL[kd], 2.8);
    });
    V.line(ctx, P.X(st.i), by, P.X(st.i), by + bh, C.ink, 1, [3, 3]);
    KINDS.forEach(function (kd) { if (!isNaN(MEAN[kd][st.i])) V.dot(ctx, P.X(st.i), P.Y(MEAN[kd][st.i]), 5, COL[kd], C.white); });
    if (st.G > 0) {                                                     // the detector trained on Mt frames and the 95% band the G held-out frames put around it
      var xm = P.X(idxOf(st.Mt)), lo = st.p - st.w, hi = st.p + st.w;
      ctx.fillStyle = C.tealSoft; ctx.fillRect(xm - 7, P.Y(Math.min(hi, 0.85)), 14, P.Y(Math.max(lo, 0.4)) - P.Y(Math.min(hi, 0.85)));
      V.line(ctx, xm - 7, P.Y(Math.min(hi, 0.85)), xm + 7, P.Y(Math.min(hi, 0.85)), C.ink, 2); V.line(ctx, xm - 7, P.Y(Math.max(lo, 0.4)), xm + 7, P.Y(Math.max(lo, 0.4)), C.ink, 2);
      V.dot(ctx, xm, P.Y(st.p), 4, C.ink, C.white);
    }
    var lx = bx, ly = by + bh + 38;
    KINDS.forEach(function (kd) { V.mono(ctx, '● ' + TXT[kd], lx, ly, COL[kd], 10); lx += 6.3 * (TXT[kd].length + 3) + 10; if (lx > w - 140 && kd !== 'CF') { lx = bx; ly += 14; } });
    var y = ly + 22;
    V.mono(ctx, 'the budget M: frames that train and calibrate (teal), frames held out to grade (amber)', pad, y, C.mute, 10);
    var bb = bx, bwid = bw, frac = st.M / GRID[GRID.length - 1];
    V.frame(ctx, bb, y + 8, bwid, 16, '#f1f6f4', C.grid);
    ctx.fillStyle = C.teal; ctx.fillRect(bb + 1, y + 9, Math.max(0, (bwid - 2) * frac * (st.Mt / Math.max(st.M, 1))), 14);
    ctx.fillStyle = C.amber; ctx.fillRect(bb + 1 + (bwid - 2) * frac * (st.Mt / Math.max(st.M, 1)), y + 9, Math.max(0, (bwid - 2) * frac * (st.G / Math.max(st.M, 1))), 14);
    V.mono(ctx, 'train ' + commas(st.Mt) + ' · grade ' + commas(st.G) + (st.G > 0 ? ' → ' + Math.round(PPF * st.G) + ' pedestrians' : ''), bb, y + 36, C.ink, 10);
    y += 56;
    V.mono(ctx, 'what the first ' + st.sc.n + ' labelled frames say about the street\'s pedestrians (Lesson 5\'s ruler; whiskers: 10th to 90th percentile of 100 resamples)', pad, y, C.mute, 10);
    var cw = narrow ? w - 2 * pad : (w - 2 * pad - 20) / 2, ch = 44, cx = [pad, narrow ? pad : pad + cw + 20], cy = [y + 14, narrow ? y + 14 + ch + 36 : y + 14];
    function axis(x0, y0, wd, lo, hi, ticks, title, fmt) {
      V.line(ctx, x0, y0 + 20, x0 + wd, y0 + 20, C.dim, 1);
      ticks.forEach(function (t) { var xx = x0 + (t - lo) / (hi - lo) * wd; V.line(ctx, xx, y0 + 17, xx, y0 + 23, C.dim, 1); V.mono(ctx, fmt(t), xx, y0 + 32, C.mute, 9, 'center'); });
      V.mono(ctx, title, x0, y0 + 2, C.ink, 10);
      return function (v) { return x0 + (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * wd; };
    }
    var Xz = axis(cx[0], cy[0], cw, 6, 28, [8, 12, 16, 20, 24, 28], 'distance range of pedestrians, m', String), Xp = axis(cx[1], cy[1], cw, 0, 0.6, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 'share of pedestrians who step out', function (t) { return t.toFixed(1); });
    V.line(ctx, Xz(8), cy[0] + 14, Xz(16), cy[0] + 14, C.dim, 4); V.dot(ctx, Xp(0), cy[1] + 14, 3.5, C.dim);
    if (isFinite(st.sc.e.zlo)) {
      V.line(ctx, Xz(st.sc.e.zlo), cy[0] + 20, Xz(st.sc.e.zhi), cy[0] + 20, C.teal, 5);
      [[0, st.sc.e.zlo], [1, st.sc.e.zhi]].forEach(function (a) { if (isFinite(st.sc.lo[a[0]])) V.line(ctx, Xz(st.sc.lo[a[0]]), cy[0] + 20, Xz(st.sc.hi[a[0]]), cy[0] + 20, C.ink, 1.5); });
      V.line(ctx, Xp(st.sc.lo[2]), cy[1] + 20, Xp(st.sc.hi[2]), cy[1] + 20, C.ink, 1.5); V.dot(ctx, Xp(st.sc.e.pEmerge), cy[1] + 20, 4.5, C.teal, C.white);
    }
    if (el.truth.checked) { [8, 24].forEach(function (t) { V.line(ctx, Xz(t), cy[0] + 12, Xz(t), cy[0] + 28, C.red, 2); }); V.line(ctx, Xp(0.28), cy[1] + 12, Xp(0.28), cy[1] + 28, C.red, 2); }
  }
  function update() {
    var st = state(), i = st.i, kd;
    el.mv.textContent = commas(st.M);
    KINDS.forEach(function (k) { el[k.toLowerCase()].textContent = isNaN(MEAN[k][i]) ? '—' : pct(MEAN[k][i]); });
    el.eq.textContent = eqText(st.eq);
    el.split.textContent = st.M === 0 ? 'nothing to grade' : commas(st.Mt) + ' · ' + commas(st.G);
    el.cert.textContent = st.G > 0 ? '≤ ' + pct(st.cert) + ' (±' + (100 * st.w).toFixed(1) + ')' : '—';
    el.scene.textContent = st.M === 0 || !isFinite(st.sc.e.zlo) ? 'none read' : st.sc.e.zlo.toFixed(1) + '–' + st.sc.e.zhi.toFixed(1) + ' m · ' + st.sc.e.pEmerge.toFixed(2);
    draw(st);
  }
  ['input', 'change'].forEach(function (ev) { [el.m, el.hold, el.truth].forEach(function (e) { e.addEventListener(ev, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
