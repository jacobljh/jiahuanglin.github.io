/* l08_view.js — the drawing and wiring of Lesson 8's widget (load after streetview.js, l08_blender.js and l08_data.js; the page calls SV.l08.wire()).
   It draws and reads: the Street's frames and every error are recomputed here from the recorded Blender frames (SV.L08.frames) and the recorded conformance suite (SV.L08.suite). */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l08;

L.wire = function () {
  var cv = document.getElementById('w08-canvas');
  if (!cv || !SV.view || !SV.L08) return;
  var V = SV.view, C = V.C, D = SV.L08, W = SV.CAM.W, H = SV.CAM.H, HW = W * H;
  function $(id) { return document.getElementById(id); }
  var el = { k: $('w08-k'), kv: $('w08-k-v'), sc: $('w08-scene'), amp: $('w08-amp'), cl: $('w08-clause'), mean: $('w08-mean'), p99: $('w08-p99'), moved: $('w08-moved'), err: $('w08-err'), vd: $('w08-verdict') };
  var MEAS = L.measure(D.suite), REF = [], CACHE = {}, SCALE = { '5': 0.05, '1': 0.01, '0.2': 0.002 };
  function ref(s) { return REF[s] || (REF[s] = L.streetRender(D.frames.desc[s], 16).rad); }
  function frame(s, k) { var key = s + ':' + k; return CACHE[key] || (CACHE[key] = L.frameAt(D, s, k)); }
  function disp(rad) { var o = new Float32Array(rad.length), i; for (i = 0; i < rad.length; i++) o[i] = Math.pow(Math.min(1, Math.max(0, rad[i])), 1 / 2.2); return o; }
  function dframe(s, k) { var key = 'd' + s + ':' + k; return CACHE[key] || (CACHE[key] = disp(frame(s, k))); }
  function fmt(x, unit) {                                          // an error in its own unit
    if (x === null) return 'not in view';
    if (unit === '%') return (100 * x).toFixed(x < 0.0095 ? 2 : 1) + '%';
    if (unit === 'px') return x.toFixed(x < 0.095 ? 3 : 2) + ' px';
    if (unit === 'm') return x.toExponential(0) + ' m';
    return x.toFixed(3);
  }
  function lg(x, tol) { return x === null ? 3 : Math.min(3, Math.max(-2, Math.log(Math.max(x, 1e-12) / tol) / Math.LN10)); }
  function state() {
    var k = +el.k.value, s = +el.sc.value, fr = frame(s, k), R = ref(s), e = L.errMap(fr, R), st = L.stats([e]), prev = k > 0 ? frame(s, k - 1) : null;
    return { k: k, s: s, fr: fr, e: e, st: st, moved: prev ? L.changed(fr, prev) : null, clause: k > 0 ? L.CLAUSES[k - 1] : null, scale: SCALE[el.amp.value] };
  }
  function draw(S) {
    cv.style.height = (cv.clientWidth < 640 ? 700 : 470) + 'px';
    var g = V.setup(cv), ctx = g.ctx, w = g.w, narrow = w < 640, pad = 8, i;
    var pw = narrow ? w - 2 * pad : Math.floor(w * 0.55), ph = pw / 4, y = 16, x0 = pad;
    var d = dframe(S.s, S.k);
    V.image(ctx, x0, y + 4, pw, ph, disp(ref(S.s)), { label: 'the Street, 16 x 16 rays per pixel (the area integral)' }); y += ph + 24;
    V.image(ctx, x0, y + 4, pw, ph, d, { label: 'Blender, recorded: ' + (S.k === 0 ? 'every setting at its default' : S.k + ' of 12 conventions set') }); y += ph + 24;
    V.plane(ctx, x0, y + 4, pw, ph, S.e, 0, S.scale, { label: '|difference|: full scale = ' + (100 * S.scale).toString().replace(/\.0+$/, '') + '% of radiance' }); y += ph + 28;
    /* the clause bars: error / tolerance on a log scale, at the default (red) and set (green) */
    var bx = narrow ? pad : pad + pw + 22, bw = narrow ? w - 2 * pad : w - bx - pad, by = narrow ? y + 4 : 16, rowH = narrow ? 24 : Math.min(30, Math.floor((ph * 3 + 90) / 13)), lab = narrow ? 112 : 128;
    V.mono(ctx, 'error / tolerance, log scale (0 = the tolerance)', bx, by, C.mute, 9.5); by += 14;
    var x1 = bx + lab, xw = bw - lab - 4;
    function X(v) { return x1 + (v + 2) / 5 * xw; }
    for (i = 0; i < 12; i++) {
      var m = MEAS[L.CLAUSES[i].id], yy = by + i * rowH, done = i < S.k, cur = i === S.k - 1;
      if (cur) { ctx.fillStyle = C.amberSoft; ctx.fillRect(bx - 2, yy - 1, bw + 4, rowH - 1); }
      V.mono(ctx, (i + 1) + ' ' + L.CLAUSES[i].id, bx, yy + rowH * 0.3, cur ? C.ink : C.mute, 9.5);
      var a = lg(m.d, m.tol), b = lg(m.s, m.tol), bh = Math.max(4, rowH * 0.3);
      ctx.globalAlpha = done ? 0.28 : 1; ctx.fillStyle = L.fails(m) ? C.red : C.green; ctx.fillRect(x1, yy, Math.max(1, X(a) - x1), bh);
      ctx.globalAlpha = done ? 1 : 0.28; ctx.fillStyle = C.teal; ctx.fillRect(x1, yy + bh + 1, Math.max(1, X(b) - x1), bh); ctx.globalAlpha = 1;
      if (m.d === null) V.mono(ctx, 'not in view', X(a) - 4, yy + bh / 2, C.white, 8, 'right');
    }
    V.line(ctx, X(0), by - 2, X(0), by + 12 * rowH, C.ink, 1, [3, 3]);
    V.mono(ctx, 'red: at the default · teal: set', bx, by + 12 * rowH + 10, C.mute, 9);
  }
  function update() {
    var S = state(), c = S.clause, m = c ? MEAS[c.id] : null;
    el.kv.textContent = S.k === 0 ? 'none' : S.k + ': ' + c.name;
    el.cl.textContent = c ? c.id : 'none yet';
    el.mean.textContent = (100 * S.st.mean).toFixed(3) + '%'; el.p99.textContent = (100 * S.st.p99).toFixed(2) + '%';
    el.moved.textContent = S.moved === null ? '—' : (100 * S.moved).toFixed(1) + '%';
    el.err.textContent = m ? fmt(m.d, m.unit) + ' → ' + fmt(m.s, m.unit) : '—';
    el.vd.textContent = m ? (L.fails(m) ? 'fails at the default' : 'holds at the default') : '—';
    draw(S);
  }
  ['input', 'change'].forEach(function (ev) { el.k.addEventListener(ev, update); el.sc.addEventListener(ev, update); el.amp.addEventListener(ev, update); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
