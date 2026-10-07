/* l09_view.js — the drawing and wiring of Lesson 9's widget (load after streetview.js, l09_factory.js and l09_data.js; the page calls SV.l09.wire()).
   It only draws and reads: the frames are drawn live by the engine (SV.l09), every probability and count comes from the engine's closed forms or from SV.L09 (built by tools/chain/verify/engine/build_l09.js). */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l09;

L.wire = function () {
  var cv = document.getElementById('w09-canvas');
  if (!cv || !SV.view || !SV.L09) return;
  var V = SV.view, C = V.C, D = SV.L09, B = D.bench, PIPE = L.program('bbba'), DECL = L.declOf(PIPE), IDS = L.INV.map(function (I) { return I.id; });
  function $(id) { return document.getElementById(id); }
  var el = { k: $('w09-k'), kv: $('w09-k-v'), fault: $('w09-fault'), lr: $('w09-learner'), lin: $('w09-lineage'), f: $('w09-f'), c: $('w09-c'), pc: $('w09-pc'), po: $('w09-po'), k95: $('w09-k95'), fire: $('w09-fire'), auc: $('w09-auc'), gap: $('w09-gap') };
  var NAMES = { none: 'no fault' }, LR = { '1nn': '1-NN', '10nn': '10-NN', detector: 'the detector' }, SHOW = 19900140, cache = {}, bitsCache = {};
  L.FAULTS.forEach(function (F) { NAMES[F.id] = F.name; });
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function bitsOf(hex) { if (!bitsCache[hex]) { var a = [], i; for (i = 0; i < 1000; i++) a.push((parseInt(hex.charAt(i >> 2), 16) >> (3 - (i & 3))) & 1); bitsCache[hex] = a; } return bitsCache[hex]; }
  function kOf() { return Math.round(Math.pow(10, +el.k.value / 10)); }
  function stat(id) {
    if (id === 'none') return { f: 0, c: 0, fr: 0, any: null, hit: null, rep: null, run: null, b: null };
    var b = B[id], F = L.faultById(id);
    return { f: F.f, c: b.cAny !== undefined ? b.cAny : b.run.cHit, fr: b.run.replay / b.run.n, any: bitsOf(b.runBits), hit: bitsOf(b.hitBits), rep: bitsOf(b.replayBits), run: b.run, b: b };
  }
  function found(f, c, k) { return 1 - Math.pow(1 - f * c, k); }
  function k95(f, c) { var q = f * c; return q > 0 ? Math.max(1, Math.ceil(Math.log(0.05) / Math.log(1 - q))) : Infinity; }
  function observed(bits, k, seed) {                           // an inspection of k frames drawn from the 1,000 of the run: does any of them carry the flag?
    var rng = SV.rng(seed), hit = 0, t, j;
    for (t = 0; t < 300; t++) for (j = 0; j < k; j++) if (bits[Math.floor(rng() * 1000)]) { hit++; break; }
    return hit / 300;
  }
  function firing(id, st) {                                    // the checks that flag a 1,000-frame run of this fault with probability >= 0.95
    var out = [], b = st.b, r = st.run;
    if (!b) return out;
    if (b.c) IDS.forEach(function (n) { if (1 - Math.pow(1 - st.f * b.c[n], 1000) >= 0.95) out.push(n); });
    else if (st.c > 0 && 1 - Math.pow(1 - st.f * st.c, 1000) >= 0.95) out.push('frames');
    if (r.dup > 0) out.push('dup'); if (r.lineage > 0) out.push('lineage'); if (r.rateFail) out.push('rate');
    if (b.pool.fails.some(function (x) { return x; })) out.push('pool');
    if (r.integrity > 0) out.push('integrity'); if (r.replay > 0) out.push('replay');
    return out;
  }
  function pair(id) {
    if (!cache[id]) {
      var sd = L.seedsOf(SHOW), a = L.make(PIPE, sd), F = id === 'none' ? null : L.faultById(id);
      cache[id] = { a: a, b: F && F.gen ? F.gen(PIPE, sd) : a, same: !(F && F.gen) };
    }
    return cache[id];
  }
  function leak(kind, lr) { return mean([1, 2, 3].map(function (s) { return D.leak[s].cells[kind][lr]; })); }
  function ladder(k, kind) { return mean([1, 2, 3].map(function (s) { return D.leak[s].ladder[k][kind]; })); }

  function state() {
    var id = el.fault.value, k = kOf(), st = stat(id), kind = el.lin.checked ? 'lineage' : 'random', lr = el.lr.value;
    return { id: id, k: k, st: st, pc: found(st.f, st.c, k), po: st.any ? observed(st.any, k, 9100 + k) : 0, k95: k95(st.f, st.c), fire: firing(id, st), kind: kind, lr: lr, auc: leak(kind, lr), gap: leak('random', lr) - leak('lineage', lr) };
  }
  function draw(s) {
    var narrow = cv.clientWidth < 640;
    cv.style.height = (narrow ? 930 : 760) + 'px';
    var S = V.setup(cv), ctx = S.ctx, w = S.w, pad = 8, y = 4, i, j;
    /* A: is the fault found within k frames? */
    V.mono(ctx, 'chance k frames find it; dots = 300 draws', pad, y + 6, C.mute, 10);
    var bx = 40, bw = w - bx - 14, bh = narrow ? 150 : 170, by = y + 22;
    var P = V.plot(ctx, bx, by, bw, bh, { xmin: 1, xmax: 1000, xlog: true, ymin: 0, ymax: 1, xticks: [1, 10, 100, 1000], yticks: [0, 0.5, 0.95, 1], yfmt: function (t) { return Math.round(100 * t) + '%'; }, xlabel: 'frames checked, k' });
    var xs = [], f0 = [], f1 = [], f2 = [];
    for (i = 0; i <= 40; i++) { var kk = Math.pow(10, 3 * i / 40); xs.push(kk); f0.push(found(s.st.f, 1, kk)); f1.push(found(s.st.f, s.st.c, kk)); f2.push(found(s.st.fr, 1, kk)); }
    V.line(ctx, P.X(1), P.Y(0.95), P.X(1000), P.Y(0.95), C.dim, 1, [2, 3]);
    V.curve(ctx, P, xs, f0, C.dim, 2, [5, 4]);
    if (s.st.fr > 0) V.curve(ctx, P, xs, f2, C.amber, 2, [2, 3]);
    V.curve(ctx, P, xs, f1, C.teal, 2.6);
    if (s.st.any) [1, 3, 10, 30, 100, 300, 1000].forEach(function (kk2) {
      V.dot(ctx, P.X(kk2), P.Y(observed(s.st.any, kk2, 9100 + kk2)), 3.2, C.teal, C.white);
      if (s.st.fr > 0) V.dot(ctx, P.X(kk2), P.Y(observed(s.st.rep, kk2, 9300 + kk2)), 3, C.amber, C.white);
    });
    V.line(ctx, P.X(s.k), by, P.X(s.k), by + bh, C.ink, 1, [3, 3]);
    var lx = bx, ly = by + bh + 38; [['looking (best case)', C.dim], ['per-frame checks', C.teal], ['replay of k rows', C.amber]].forEach(function (g) { var wd = 6.4 * g[0].length; if (lx + wd > w - pad) { lx = bx; ly += 13; } V.mono(ctx, g[0], lx, ly, g[1], 10); lx += wd + 18; });
    y = ly + 18;
    /* B: the frame as drawn and as the faulty factory wrote it, and every check */
    var pr = pair(s.id), tw = narrow ? (w - 2 * pad - 16) / 3 : (w - 2 * pad - 24) / 4, th = tw / 4, rows = [['as drawn', pr.a], [s.id === 'none' || pr.same ? 'as written (valid)' : 'as written + fault', pr.b]];
    V.mono(ctx, narrow ? 'frame, mask, depth (drawn, written)' : 'frame, mask and depth as drawn and as written', pad, y + 4, C.mute, 10);
    y += 14;
    rows.forEach(function (r, ri) {
      var x0 = pad, ty = y;
      if (narrow) { V.mono(ctx, r[0], pad, y + 8, ri ? C.red : C.mute, 10); ty = y + 12; y += 12; }
      V.image(ctx, x0, ty, tw, th, r[1].x, { gain: 1.6 });
      V.mask(ctx, x0 + tw + 8, ty, tw, th, r[1].cov, C.teal);
      V.plane(ctx, x0 + 2 * (tw + 8), ty, tw, th, r[1].depth, 0, 60, { zeroGrey: true });
      if (!narrow) V.mono(ctx, r[0], x0 + 3 * (tw + 8), ty + th / 2, ri ? C.red : C.mute, 10);
      y += th + 8;
    });
    y += 6;
    var live = L.check(pr.b, DECL), cw = (w - 2 * pad) / (narrow ? 4 : 8), ch = 38;
    V.mono(ctx, 'per-frame checks (red = fails); c = share flagged', pad, y + 4, C.mute, 10);
    y += 14;
    IDS.forEach(function (n, q) {
      var gx = pad + (q % (narrow ? 4 : 8)) * cw, gy = y + Math.floor(q / (narrow ? 4 : 8)) * (ch + 4), bad = live.indexOf(n) >= 0, cc = s.st.b && s.st.b.c ? s.st.b.c[n] : null;
      V.frame(ctx, gx, gy, cw - 4, ch, bad ? C.redSoft : C.greenSoft, bad ? C.red : C.green);
      V.mono(ctx, n + (bad ? ' FAIL' : ''), gx + 4, gy + 11, bad ? C.red : C.green, 10);
      V.mono(ctx, cc === null ? 'c: -' : 'c: ' + cc.toFixed(2), gx + 4, gy + 27, C.mute, 9.5);
    });
    y += Math.ceil(IDS.length / (narrow ? 4 : 8)) * (ch + 4) + 6;
    var r = s.st.run, bl = [['dup', r ? r.dup : 0], ['lineage', r ? r.lineage : 0], ['rate', r && r.rateFail ? 1 : 0], ['pool', s.st.b ? s.st.b.pool.fails.filter(function (x) { return x; }).length : 0], ['integrity', r ? r.integrity : 0], ['replay', r ? r.replay : 0]];
    V.mono(ctx, 'batch checks and audit of the run (count)', pad, y + 4, C.mute, 10);
    y += 14;
    bl.forEach(function (g, q) {
      var gx = pad + (q % (narrow ? 3 : 6)) * ((w - 2 * pad) / (narrow ? 3 : 6)), gy = y + Math.floor(q / (narrow ? 3 : 6)) * 28, bad = g[1] > 0, cw2 = (w - 2 * pad) / (narrow ? 3 : 6) - 4;
      V.frame(ctx, gx, gy, cw2, 24, bad ? C.redSoft : C.greenSoft, bad ? C.red : C.green);
      V.mono(ctx, g[0] + ': ' + (bad ? g[1] : 'ok'), gx + 4, gy + 12, bad ? C.red : C.green, 10);
    });
    y += Math.ceil(6 / (narrow ? 3 : 6)) * 28 + 14;
    /* C: the leak */
    V.mono(ctx, 'AUC, 3 seeds: amber = by frame, teal = by lineage', pad, y + 4, C.mute, 10);
    y += 16;
    var lw = narrow ? w - 2 * pad : Math.floor(w * 0.55), bx2 = pad + 78, bwid = lw - 78 - 40, rowH = 24;
    L.LEARNERS.forEach(function (lr, q) {
      [['random', C.amber], ['lineage', C.teal]].forEach(function (g, gi) {
        var yy = y + q * (2 * rowH + 8) + gi * (rowH - 2), v = leak(g[0], lr), sel = lr === s.lr;
        if (gi === 0) V.mono(ctx, LR[lr], pad, yy + 10, sel ? C.ink : C.mute, 10);
        V.bar(ctx, bx2, yy, bwid, rowH - 6, Math.max(0, v - 0.4), 0.6, sel ? g[1] : '#c9d6d2');
        V.mono(ctx, v.toFixed(3), bx2 + bwid + 4, yy + 8, sel ? C.ink : C.mute, 9.5);
      });
    });
    var kx = narrow ? pad : pad + lw + 18, ky = narrow ? y + 3 * (2 * rowH + 8) + 14 : y, kw = narrow ? w - 2 * pad - 34 : w - kx - 20, kh = narrow ? 100 : 3 * (2 * rowH + 8) - 26;
    V.mono(ctx, 'leak of a k-NN learner vs k (frame - lineage)', kx, ky + 4, C.mute, 10);
    var P2 = V.plot(ctx, kx + 30, ky + 18, kw - 30, kh, { xmin: 1, xmax: 100, xlog: true, ymin: 0, ymax: 0.25, xticks: [1, 10, 100], yticks: [0, 0.1, 0.2], xlabel: 'k' });
    var kk3 = [1, 3, 10, 30, 100], gs = kk3.map(function (k2) { return ladder(k2, 'random') - ladder(k2, 'lineage'); });
    V.curve(ctx, P2, kk3, gs, C.amber, 2); V.dots(ctx, P2, kk3, gs, C.amber, 3);
    var dg = leak('random', 'detector') - leak('lineage', 'detector');
    V.line(ctx, P2.X(1), P2.Y(Math.max(0, dg)), P2.X(100), P2.Y(Math.max(0, dg)), C.teal, 2, [4, 3]);
    V.mono(ctx, 'detector: ' + dg.toFixed(3), P2.X(1) + 4, P2.Y(Math.max(0, dg)) - 6, C.teal, 9.5);
  }
  function update() {
    var s = state(), k = s.k;
    el.kv.textContent = String(k);
    el.f.textContent = s.id === 'none' ? '—' : Math.round(100 * s.st.f) + '%';
    el.c.textContent = s.id === 'none' ? '—' : s.st.c.toFixed(3);
    el.pc.textContent = s.id === 'none' ? '—' : s.pc.toFixed(3);
    el.po.textContent = s.id === 'none' ? '—' : s.po.toFixed(3);
    el.k95.textContent = s.id === 'none' ? '—' : (isFinite(s.k95) ? String(s.k95) : 'never');
    el.fire.textContent = s.id === 'none' ? 'none: every check is green' : (s.fire.length ? s.fire.join(', ') : 'none: nothing inside the factory fires');
    el.auc.textContent = s.auc.toFixed(3);
    el.gap.textContent = (s.gap >= 0 ? '+' : '') + s.gap.toFixed(3);
    draw(s);
  }
  ['input', 'change'].forEach(function (ev) { [el.k, el.fault, el.lr, el.lin].forEach(function (e) { e.addEventListener(ev, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
