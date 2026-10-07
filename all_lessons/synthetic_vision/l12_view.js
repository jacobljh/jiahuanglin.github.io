/* l12_view.js — the drawing and wiring of Lesson 12's widget (load after streetview.js, l12_proof.js and l12_data.js; the page calls SV.l12.wire()).
   Panel 1 computes the exact upper bound after n real trials (f collisions) with L.cpUpper; the other panels resample the street's stored episodes (L.campaigns): a real campaign of n episodes per candidate,
   400 times over, against the ranking an evaluator (a program's world, or the frame exam) gives. Everything is computed here; the tables behind it come from the builder. */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l12;

L.fmtInt = function (x) { return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
L.fmtP = function (p) { var q = 100 * p; return (q >= 10 ? q.toFixed(0) : q >= 1 ? q.toFixed(1) : q >= 0.01 ? q.toFixed(2) : q.toExponential(1)) + '%'; };
L.fmtDur = function (h) { return h < 100 ? Math.round(h) + ' h' : h < 17520 ? L.fmtInt(h / 24) + ' days' : (h / 8760).toFixed(1) + ' years'; };

L.wire = function () {
  var cv = document.getElementById('w12-canvas');
  if (!cv || !SV.view || !SV.L12) return;
  var V = SV.view, C = V.C, D = SV.L12, minus = '−', M = D.systems.length;
  function $(id) { return document.getElementById(id); }
  var el = { n: $('w12-n'), nv: $('w12-n-v'), f: $('w12-f'), T: $('w12-T'), world: $('w12-world'), stat: $('w12-stat'),
             m1: $('w12-m1'), m2: $('w12-m2'), m3: $('w12-m3'), m4: $('w12-m4'), m5: $('w12-m5'), m6: $('w12-m6'), m7: $('w12-m7'), m8: $('w12-m8'), m9: $('w12-m9') };
  var street = L.pool('street', 'S'), NAME = { exam: 'frame exam', aaaa: 'naive program', aaba: 'camera repaired', abba: 'camera and light', bbba: 'camera, light and scene' };
  var order = street.rate.map(function (r, j) { return j; }).sort(function (a, b) { return street.rate[a] - street.rate[b]; });          // candidates, best (fewest collisions) first
  var boundCurve = {}, valCurve = {};

  function curveBound(f) {                                  // the exact upper bound along n, 60 log-spaced points
    if (boundCurve[f]) return boundCurve[f];
    var xs = [], ys = [], i, n;
    for (i = 0; i < 60; i++) { n = Math.pow(10, 1 + 4 * i / 59); xs.push(n); ys.push(Math.log10(L.cpUpper(f, Math.max(f + 1, Math.round(n))))); }
    return (boundCurve[f] = { xs: xs, ys: ys });
  }
  function curveVal(world, mg) {                            // the evaluator's validity along n: mean agreement, chance above 0.9, chance of a best candidate
    var key = world + mg, ev = L.evaluator(world), out = { xs: [], mean: [], p90: [], hit: [] }, i, g, v;
    if (valCurve[key]) return valCurve[key];
    for (i = 0; i < L.GRID.length; i++) {
      g = L.GRID[i]; if (g > L.NMAX) break;
      v = L.validate(street, ev, g, L.R, mg); out.xs.push(g); out.mean.push(v.mean); out.p90.push(v.p90); out.hit.push(v.hit);
    }
    return (valCurve[key] = out);
  }

  function draw(st) {
    var w = Math.max(280, cv.clientWidth || 640), narrow = w < 640, pad = 8;
    cv.style.height = (narrow ? 960 : 600) + 'px';
    var S = V.setup(cv), ctx = S.ctx, i, j;
    var pw = narrow ? w - 2 * pad : Math.round(w * 0.5) - pad, ph = narrow ? 200 : 250;
    var x1 = pad, y1 = 24, x2 = narrow ? pad : Math.round(w * 0.5) + pad, y2 = narrow ? y1 + ph + 48 : y1, y3 = narrow ? y2 + ph + 48 : y1 + ph + 52, y4 = narrow ? y3 + 170 + 48 : y3, x3 = pad, x4 = narrow ? pad : x2;

    /* 1: the exact upper bound along n */
    V.text(ctx, 'the 95% bound after n real trials with ' + st.f + (st.f === 1 ? ' collision' : ' collisions'), x1, 8, C.ink, 11, 'left', 700);
    var P = V.plot(ctx, x1 + 40, y1 + 6, pw - 52, ph - 34, { xmin: 10, xmax: 1e5, xlog: true, xticks: [10, 100, 1000, 10000, 100000], xfmt: function (t) { return L.fmtInt(t); }, ymin: -5, ymax: 0, yticks: [-5, -4, -3, -2, -1, 0], yfmt: function (t) { return t === 0 ? '1' : '1e' + String(t).replace('-', minus); }, xlabel: 'real trials n', ylabel: 'collision probability' });
    [0, 1, 3].forEach(function (f) { var c = curveBound(f); V.curve(ctx, P, c.xs, c.ys, f === st.f ? C.teal : C.grid, f === st.f ? 2.6 : 1.4); });
    var r3 = curveBound(0), r3y = r3.xs.map(function (x) { return Math.log10(3 / x); });
    V.curve(ctx, P, r3.xs, r3y, C.ink, 1, [4, 3]);
    V.mono(ctx, '3/n', P.X(2500), P.Y(Math.log10(3 / 2500)) - 8, C.ink, 9);
    [1, 2, 3, 4].forEach(function (k) { V.mono(ctx, 'claim 1e' + minus + k, P.bx + P.bw - 2, P.Y(-k) - 6, C.dim, 8, 'right'); V.line(ctx, P.bx, P.Y(-k), P.bx + P.bw, P.Y(-k), C.dim, 0.6, [1, 4]); });
    V.line(ctx, P.X(st.n), P.by, P.X(st.n), P.by + P.bh, C.amber, 1.4, [3, 3]);
    V.dot(ctx, P.X(st.n), P.Y(Math.log10(st.bound)), 4.5, C.amber, C.white);
    V.mono(ctx, 'f = 0 solid teal if chosen; grey: f = 1, 3', P.bx + 4, P.by + P.bh - 8, C.mute, 8);

    /* 2: the evaluator's validity along n */
    var cvv = curveVal(st.world, st.mg), nB = st.nB;
    V.text(ctx, 'what n real episodes per candidate show about the ' + NAME[st.world], x2, narrow ? y2 - 16 : 8, C.ink, 11, 'left', 700);
    var Q = V.plot(ctx, x2 + 34, y2 + 6, pw - 46, ph - 34, { xmin: 10, xmax: 2560, xlog: true, xticks: [10, 40, 160, 640, 2560], xfmt: function (t) { return L.fmtInt(t); }, ymin: 0, ymax: 1, yticks: [0, 0.25, 0.5, 0.75, 1], yfmt: function (t) { return t.toFixed(2); }, xlabel: 'real episodes per candidate', ylabel: '' });
    V.line(ctx, Q.bx, Q.Y(L.RHO), Q.bx + Q.bw, Q.Y(L.RHO), C.red, 0.8, [3, 3]);
    V.curve(ctx, Q, cvv.xs, cvv.mean, C.blue, 2);
    V.curve(ctx, Q, cvv.xs, cvv.p90, C.teal, 2.6);
    V.curve(ctx, Q, cvv.xs, cvv.hit, C.amber, 1.6, [5, 3]);
    V.line(ctx, Q.X(nB), Q.by, Q.X(nB), Q.by + Q.bh, C.amber, 1.2, [3, 3]);
    V.mono(ctx, 'teal: chance the agreement exceeds 0.9', Q.bx + 4, Q.by + Q.bh - 40, C.teal, 8);
    V.mono(ctx, 'blue: mean agreement (Spearman)', Q.bx + 4, Q.by + Q.bh - 28, C.blue, 8);
    V.mono(ctx, 'amber: chance of a best candidate', Q.bx + 4, Q.by + Q.bh - 16, C.amber, 8);

    /* 3: the agreement of each simulated campaign, at the current n */
    var hw = narrow ? w - 2 * pad : Math.round(w * 0.5) - pad, hh = narrow ? 170 : 200, lo = -0.3, hi = 1.0, nb = 26, bins = [], b, hmax = 1;
    for (b = 0; b < nb; b++) bins.push(0);
    st.rho.forEach(function (r) { bins[Math.max(0, Math.min(nb - 1, Math.floor((r - lo) / (hi - lo) * nb)))]++; });
    for (b = 0; b < nb; b++) hmax = Math.max(hmax, bins[b]);
    V.text(ctx, 'the agreement each of ' + L.R + ' simulated campaigns shows, n = ' + L.fmtInt(nB), x3, y3 - 14, C.ink, 11, 'left', 700);
    var hx = x3 + 34, hy = y3 + 4, hwid = hw - 46;
    V.frame(ctx, hx, hy, hwid, hh - 30, C.white, C.grid);
    for (b = 0; b < nb; b++) {
      var bx0 = hx + b / nb * hwid, bh0 = bins[b] / hmax * (hh - 44), col = (lo + (b + 0.5) * (hi - lo) / nb) > L.RHO ? C.teal : C.dim;
      if (bins[b]) { ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = col; ctx.fillRect(bx0 + 0.5, hy + hh - 30 - bh0 - 1, hwid / nb - 1, bh0); ctx.restore(); }
    }
    var xr = hx + (L.RHO - lo) / (hi - lo) * hwid;
    V.line(ctx, xr, hy, xr, hy + hh - 30, C.red, 1, [3, 3]);
    [-0.2, 0, 0.5, 0.9, 1].forEach(function (t) { V.mono(ctx, t.toFixed(1), hx + (t - lo) / (hi - lo) * hwid, hy + hh - 18, C.mute, 8, 'center'); });
    V.mono(ctx, 'Spearman agreement with the real campaign', hx + hwid, hy + hh - 6, C.mute, 9, 'right');

    /* 4: the twelve candidates: the street's collision rates (bars) and the evaluator's (dots) */
    var dx = x4, dw = narrow ? w - 2 * pad : w - x4 - pad, rowH = narrow ? 12.5 : 14.5, dy = y4 + 4, lab = 38, bw2 = dw - lab - 8;
    var vals = st.mg ? st.ev.mg : st.ev.col, svals = st.mg ? street.margin : street.rate, vmin = st.mg ? -4 : 0, vmax = st.mg ? 3.5 : 1;
    V.text(ctx, 'the twelve candidates: ' + (st.mg ? 'mean stopping margin, m' : (st.world === 'exam' ? 'collisions (bar) and frames missed (dot)' : 'collisions per step-out')), dx, y4 - 14, C.ink, 11, 'left', 700);
    for (i = 0; i < M; i++) {
      j = order[i]; var yy = dy + i * rowH, sx = dx + lab + (svals[j] - vmin) / (vmax - vmin) * bw2, ex = dx + lab + (vals[j] - vmin) / (vmax - vmin) * bw2, zx = dx + lab + (0 - vmin) / (vmax - vmin) * bw2;
      V.mono(ctx, D.systems[j], dx + lab - 4, yy + rowH / 2, C.mute, 9, 'right');
      ctx.save(); ctx.fillStyle = C.tealSoft; ctx.fillRect(Math.min(zx, sx), yy + 1.5, Math.abs(sx - zx), rowH - 3); ctx.restore();
      V.dot(ctx, Math.max(dx + lab, Math.min(dx + lab + bw2, ex)), yy + rowH / 2, 3.2, C.amber, C.white);
    }
    V.mono(ctx, 'bars: the street (2,000 episodes each); dots: ' + (st.world === 'exam' ? 'the frame exam' : 'the ' + NAME[st.world]), dx, dy + M * rowH + 10, C.mute, 8);
  }

  function update() {
    var idx = +el.n.value, n = L.GRID[idx], f = +el.f.value, T = +el.T.value, world = el.world.value, mg = el.stat.value === 'mg', nB = Math.min(n, L.NMAX), ev = L.evaluator(world);
    var v = L.validate(street, ev, nB, L.R, mg), bound = L.cpUpper(f, n), hours = L.hours(n, T);
    el.nv.textContent = L.fmtInt(n);
    el.m1.textContent = L.fmtP(bound);
    el.m2.textContent = L.fmtP(L.ruleOfThree(n));
    el.m3.textContent = L.fmtInt(hours) + ' h';
    el.m4.textContent = L.fmtDur(hours);
    el.m5.textContent = v.mean.toFixed(2);
    el.m6.textContent = v.p90.toFixed(2);
    el.m7.textContent = v.hit.toFixed(2);
    el.m8.textContent = L.fmtInt(M * nB);
    el.m9.textContent = (mg ? L.spearman(ev.mg, street.margin) : L.spearman(ev.col, street.rate)).toFixed(2);
    draw({ n: n, f: f, T: T, world: world, mg: mg, nB: nB, ev: ev, rho: v.rho, bound: bound });
  }
  ['input', 'change'].forEach(function (e) { [el.n, el.f, el.T, el.world, el.stat].forEach(function (c) { c.addEventListener(e, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
