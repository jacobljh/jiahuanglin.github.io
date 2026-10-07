/* l06_view.js — the drawing and wiring of Lesson 6's widget (load after streetview.js, l06_rare.js and l06_data.js; the page calls SV.l06.wire()).
   It only draws and reads: every curve and count it shows comes from SV.l06 (the engine) or SV.L06 (the data built by tools/chain/verify/engine/build_l06.js). */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l06;

L.wire = function () {
  var cv = document.getElementById('w06-canvas');
  if (!cv || !SV.view || !SV.L06) return;
  var V = SV.view, C = V.C, D = SV.L06, N = D.N;
  function $(id) { return document.getElementById(id); }
  var el = { q: $('w06-q'), qv: $('w06-q-v'), wt: $('w06-wt'), rule: $('w06-rule'), nr: $('w06-nr'), ess: $('w06-ess'), rs: $('w06-rs'), op: $('w06-op'), ex: $('w06-ex'), fa: $('w06-fa'), fd: $('w06-fd') };
  var SHARE = [null, 0.02, 0.05, 0.1, 0.25, 0.5], KEY = ['nat', 'q02', 'q05', 'q10', 'q25', 'q50'], CUT = { pixel: 0, exam: 0.15, half: 0.5 }, PIPE = L.program(), plans = {}, cache = {};
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function pct(x) { return (100 * x).toFixed(1) + '%'; }
  function armId(k, wt) { return k === 0 ? 'nat' : KEY[k] + (wt ? 'w' : 'u'); }
  function plan(k) { return plans[k] || (plans[k] = L.plan(PIPE, N, SHARE[k], SV.SEEDS.train + 100000, { seedR: 16200000 })); }
  var perm = (function () { var a = [], i, j, t, r = SV.rng(2026); for (i = 0; i < N; i++) a.push(i); for (i = N - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; })();
  var street = (function () { var pl = L.plan(PIPE, 20000, null, 3000000), ped = 0, i; for (i = 0; i < pl.items.length; i++) if (pl.items[i].ped) ped++; return pl.nR / ped; })();
  var RFR = D.sets.R.strip.map(function (s) { return L.evalFrame('R', s); }), OFR = [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return L.evalFrame('open', D.sets.open.seed0 + i); });
  function decide(id) {
    if (!cache[id]) {
      var M = D.models[id], m = { dim: SV.DIM, w: M.w, mu: M.mu, sd: M.sd };
      cache[id] = { r: RFR.map(function (f) { return SV.score(m, f.x).s > M.thr; }), o: OFR.map(function (f) { return SV.score(m, f.x).s > M.thr; }) };
    }
    return cache[id];
  }
  function psy(id) {
    var a = D.arms[id], n = D.sets.R.binN, out = [], b, s, h;
    for (b = 0; b < n.length; b++) { h = 0; for (s = 0; s < a.psy.length; s++) h += a.psy[s][b]; out.push(1 - h / (a.psy.length * n[b])); }
    return out;
  }
  function state() {
    var k = +el.q.value, wt = el.wt.checked && k > 0, id = armId(k, wt), a = D.arms[id], rule = el.rule.value, pl = plan(k), dc = decide(id);
    var ped = 0, pedR = 0, wPed = 0, wPedR = 0, i;
    for (i = 0; i < pl.items.length; i++) if (pl.items[i].ped) { ped++; wPed += pl.weights[i]; if (pl.items[i].isR) { pedR++; wPedR += pl.weights[i]; } }
    return { k: k, wt: wt, id: id, a: a, rule: rule, pl: pl, ess: L.ess(pl.weights), dc: dc, shareU: pedR / ped, shareW: wPedR / wPed,
             rs: mean(a.R[rule]), op: mean(a.openClose), ex: mean(a.exam), fa: mean(a.fa0), fr: dc.r.filter(Boolean).length, fo: dc.o.filter(Boolean).length };
  }
  function heightFor(w, narrow) {   // the arithmetic of draw(), down to its last label, so the canvas is as tall as its content
    var cols = narrow ? 80 : 100, tc = narrow ? 4 : 8, tw = (w - 16 - (tc - 1) * 6) / tc, y;
    y = 24 + Math.ceil(N / cols) * ((w - 16) / cols) + 12 + 16;
    y += 2 * (Math.ceil(8 / tc) * (tw / 4 + 5) + 6) + 12;
    y += 16 + (narrow ? 150 : 170) + 40 + 22 + 4 * 21 + 12 + 16;
    return Math.ceil(y + (narrow ? 120 : 130) + 54);
  }
  function draw(st) {
    var narrow = cv.clientWidth < 640;
    cv.style.height = heightFor(Math.max(280, cv.clientWidth || 640), narrow) + 'px';
    var S = V.setup(cv), ctx = S.ctx, w = S.w, pad = 8, y = 4, i, k, b;
    V.mono(ctx, '1,600 frames, one dot each; amber = case R' + (st.wt ? '; area = weight' : ''), pad, y + 6, C.mute, 10);
    var cols = narrow ? 80 : 100, sp = (w - 2 * pad) / cols, gy = y + 20, wmax = 0;
    for (i = 0; i < N; i++) wmax = Math.max(wmax, st.wt ? st.pl.weights[i] : 1);
    for (i = 0; i < N; i++) {
      var pos = perm[i], rr = Math.max(0.9, sp * 0.42 * Math.sqrt((st.wt ? st.pl.weights[i] : 1) / wmax));
      V.dot(ctx, pad + (pos % cols + 0.5) * sp, gy + (Math.floor(pos / cols) + 0.5) * sp, rr, st.pl.items[i].isR ? C.amber : '#b9c9c4');
    }
    y = gy + Math.ceil(N / cols) * sp + 12;
    V.mono(ctx, 'step-outs, a sliver to most shown (top); open (bottom)', pad, y + 6, C.mute, 10);
    var tc = narrow ? 4 : 8, gap = 6, tw = (w - 2 * pad - (tc - 1) * gap) / tc, th = tw / 4;
    y += 16;
    [[RFR, st.dc.r], [OFR, st.dc.o]].forEach(function (g) {
      for (i = 0; i < 8; i++) {
        var tx = pad + (i % tc) * (tw + gap), ty = y + Math.floor(i / tc) * (th + 5), ok = g[1][i];
        V.image(ctx, tx, ty, tw, th, g[0][i].x, { gain: 1.6, border: ok ? C.green : C.red });
        ctx.strokeStyle = ok ? C.green : C.red; ctx.lineWidth = 2; ctx.strokeRect(tx, ty, tw, th);
      }
      y += Math.ceil(8 / tc) * (th + 5) + 6;
    });
    y += 12;
    var bx = 40, bw = w - bx - 12, bh = narrow ? 150 : 170, by = y + 16, Xs = [L.P_R, 0.02, 0.05, 0.1, 0.25, 0.5];
    V.mono(ctx, 'miss rate by share of renders in R (dashed: weighted)', pad, y + 4, C.mute, 10);
    var P = V.plot(ctx, bx, by, bw, bh, { xmin: 0.006, xmax: 0.65, xlog: true, ymin: 0, ymax: 0.7, xticks: Xs, yticks: [0, 0.2, 0.4, 0.6], yfmt: function (t) { return Math.round(100 * t) + '%'; }, xfmt: function (t) { return t < 0.01 ? 'natural' : Math.round(100 * t) + '%'; }, xlabel: 'share of the renders spent on R' });
    var series = [[C.red, function (a) { return mean(a.R.exam); }], [C.blue, function (a) { return mean(a.exam); }], [C.teal, function (a) { return mean(a.openClose); }]];
    series.forEach(function (s) {
      [false, true].forEach(function (wt) {
        var ys = [], xs = [];
        for (k = 0; k < 6; k++) { xs.push(Xs[k]); ys.push(s[1](D.arms[armId(k, wt)])); }
        V.curve(ctx, P, xs, ys, s[0], wt ? 1.6 : 2.4, wt ? [5, 4] : []);
        V.dots(ctx, P, xs, ys, s[0], wt ? 2.2 : 3);
      });
    });
    V.line(ctx, P.X(Xs[st.k]), by, P.X(Xs[st.k]), by + bh, C.ink, 1, [3, 3]);
    series.forEach(function (s) { V.dot(ctx, P.X(Xs[st.k]), P.Y(s[1](st.a)), 5, s[0], C.white); });
    y = by + bh + 40;
    var lx = narrow ? pad : bx;
    (narrow ? [['red: rare slice', C.red], ['blue: exam', C.blue], ['teal: open', C.teal]] : [['red: rare slice', C.red], ['blue: the exam', C.blue], ['teal: open, same range', C.teal]]).forEach(function (g) {
      V.mono(ctx, g[0], lx, y, g[1], 10); lx += 6.3 * g[0].length + 18;
    });
    y += 22;
    var bxx = pad + 150, bww = w - bxx - 78;
    [['effective sample size', st.ess, N, C.teal, Math.round(st.ess) + ' of ' + N], ['R share: the street', street, 0.6, C.mute, pct(street)], ['R share: set as drawn', st.shareU, 0.6, C.amber, pct(st.shareU)], ['R share: set weighted', st.shareW, 0.6, C.green, pct(st.shareW)]].forEach(function (r) {
      V.mono(ctx, r[0], pad, y + 7, C.ink, 10); V.bar(ctx, bxx, y, bww, 14, r[1], r[2], r[3]); V.mono(ctx, r[4], bxx + bww + 6, y + 7, C.ink, 10); y += 21;
    });
    y += 12;
    V.mono(ctx, 'miss by visible fraction; shaded = counted', pad, y + 4, C.mute, 10);
    var ex0 = 40, ew = w - ex0 - 12, eh = narrow ? 120 : 130, ey = y + 16, E = D.sets.R.edges, mm = psy(st.id), m0 = psy('nat');
    var PE = V.plot(ctx, ex0, ey, ew, eh, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, xticks: [0, 0.25, 0.5, 0.75, 1], yticks: [0, 0.5, 1], yfmt: function (t) { return Math.round(100 * t) + '%'; }, xfmt: function (t) { return Math.round(100 * t) + '%'; }, xlabel: 'visible fraction of the silhouette' });
    ctx.fillStyle = C.tealSoft; ctx.fillRect(PE.X(CUT[st.rule]), ey + 1, PE.X(1) - PE.X(CUT[st.rule]), eh - 2);
    for (b = 0; b < mm.length; b++) {
      var x0 = PE.X(E[b]), x1 = PE.X(Math.min(1, E[b + 1]));
      ctx.fillStyle = C.amber; ctx.fillRect(x0 + 1, PE.Y(mm[b]), Math.max(1, x1 - x0 - 2), PE.Y(0) - PE.Y(mm[b]));
      V.dot(ctx, (x0 + x1) / 2, PE.Y(m0[b]), 2.6, C.ink, C.white);
    }
    Object.keys(CUT).forEach(function (r) { V.line(ctx, PE.X(CUT[r]), ey, PE.X(CUT[r]), ey + eh, r === st.rule ? C.ink : C.dim, r === st.rule ? 2 : 1, [4, 3]); });
    V.mono(ctx, 'bars: this detector; dots: the natural one', pad, ey + eh + 40, C.mute, 10);
  }
  function update() {
    var st = state();
    el.qv.textContent = st.k === 0 ? 'natural' : Math.round(100 * SHARE[st.k]) + '%';
    el.nr.textContent = String(st.pl.nR); el.ess.textContent = String(Math.round(st.ess));
    el.rs.textContent = pct(st.rs); el.op.textContent = pct(st.op); el.ex.textContent = pct(st.ex); el.fa.textContent = pct(st.fa);
    el.fd.textContent = st.fr + ' / 8 + ' + st.fo + ' / 8';
    draw(st);
  }
  ['input', 'change'].forEach(function (ev) { [el.q, el.wt, el.rule].forEach(function (e) { e.addEventListener(ev, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
