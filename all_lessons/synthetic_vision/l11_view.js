/* l11_view.js — the drawing and wiring of Lesson 11's widget (load after streetview.js, l11_episode.js and l11_data.js; the page calls SV.l11.wire()).
   It computes one live episode with the engine (frames, scores, the decision) and replays both branches in closed form; the spread panel resamples the 1,000 natural situations stored by the builder. */
(function (root) {
'use strict';
var SV = root.SV, L = SV.l11;

L.POOL_REPEATS = 400;           // the spread panel: how many times 20 situations are drawn
L.POOL_N = 20;

L.wire = function () {
  var cv = document.getElementById('w11-canvas');
  if (!cv || !SV.view || !SV.L11) return;
  var V = SV.view, C = V.C, D = SV.L11, cfg = D.cfg, minus = '−';
  function $(id) { return document.getElementById(id); }
  var el = { z: $('w11-z'), zv: $('w11-z-v'), j: $('w11-j'), jv: $('w11-j-v'), det: $('w11-det'), pair: $('w11-pair'), crn: $('w11-crn'),
             td: $('w11-td'), dl: $('w11-dl'), mg: $('w11-mg'), ob: $('w11-ob'), oc: $('w11-oc'), sp: $('w11-sp'), kk: $('w11-kk'), df: $('w11-df') };
  var sh = L.shuttle(), world = L.programWorld('bbba'), sits = {}, MODEL = {}, NAME = { bbba: 'natural detector', q25u: 'oversampled detector', aaaa: 'naive detector' };
  ['bbba', 'q25u', 'aaaa'].forEach(function (id) { var m = D.models[id]; MODEL[id] = { dim: SV.DIM, w: m.w, mu: m.mu, sd: m.sd, thr: m.thr }; });
  function sgn(x, d) { return (x < 0 ? minus : '+') + Math.abs(x).toFixed(d); }
  function pct(x) { return (100 * x).toFixed(1) + '%'; }

  /* the natural pool: outcomes of the stored decisions, in closed form */
  var pool = (function () {
    var out = { coast: [], bbba: [], q25u: [], aaaa: [] }, i, sit, k;
    for (i = 0; i < D.nat.seeds.length; i++) {
      sit = L.situation(world, D.nat.seeds[i], sh); out.coast.push(+L.outcome(sit, Infinity, sh).collision);
      for (k in { bbba: 1, q25u: 1, aaaa: 1 }) out[k].push(+L.finish(sit, sh, D.nat.kd[k][i], [], []).collision);
    }
    return out;
  })();
  var PAIRS = { act: { a: 'bbba', b: 'coast', name: 'braking minus never braking (natural detector)' }, det: { a: 'bbba', b: 'q25u', name: 'natural minus oversampled detector' }, naive: { a: 'bbba', b: 'aaaa', name: 'natural minus naive detector' } }, spreads = {};
  function spread(p) { return spreads[p] || (spreads[p] = L.resample(pool[PAIRS[p].a], pool[PAIRS[p].b], L.POOL_N, L.POOL_REPEATS)); }

  var cache = {};                 // one live episode per (distance, situation, detector): the sliders re-ask often, the frames are scored once
  function live(z, j, det) {
    var key = z + ':' + j + ':' + det, seed, sit, M, ep;
    if (cache[key]) return cache[key];
    seed = D.live[z][j]; sit = sits[z + ':' + j] || (sits[z + ':' + j] = L.situation(world, seed, sh)); M = MODEL[det];
    ep = L.episode(world, M, { thr: M.thr, m: cfg.m, n: cfg.n }, seed, { sit: sit, sh: sh, extra: 5 });          // scores the frames to the decision and five more (all of them if it never decides)
    return (cache[key] = { ep: ep, sit: sit, brake: L.branch(ep, 'brake'), coast: L.branch(ep, 'coast'), dl: L.deadline(sit, sh), zc: sit.z0 - sit.r,
             tIn: (sit.x0 - sh.half - sit.r) / sit.u, tOut: (sit.x0 + sh.half + sit.r) / sit.u });
  }
  function outText(o) { return o.outcome === 'stop' ? 'stops ' + o.margin.toFixed(1) + ' m short' : o.outcome === 'collision' ? 'collision at ' + o.vImpact.toFixed(1) + ' m/s' : 'passes clear'; }

  function draw(st, sp, crnOn) {
    var narrow = cv.clientWidth < 640, w = Math.max(280, cv.clientWidth || 640);
    cv.style.height = (narrow ? 780 : 570) + 'px';
    var S = V.setup(cv), ctx = S.ctx, pad = 8, ep = st.ep, T = Math.max(ep.tf0 + 0.5, 1) , i, k;
    var ax = narrow ? pad : pad, aw = narrow ? w - 2 * pad : Math.round(w * 0.5) - pad, ay = 22, ah = narrow ? 230 : 290;
    /* A: distance against time */
    V.text(ctx, 'distance travelled against time', ax, 8, C.ink, 11, 'left', 700);
    var P = V.plot(ctx, ax + 34, ay + 8, aw - 44, ah - 30, { xmin: 0, xmax: T, ymin: 0, ymax: st.zc + 2, xticks: [0, 1, 2, 3, 4].filter(function (t) { return t <= T + 1e-9; }), yticks: [0, 5, 10, 15, 20, 25, 30], xlabel: 't (s)', ylabel: 'm' });
    V.line(ctx, P.X(0), P.Y(st.zc), P.X(T), P.Y(st.zc), C.dim, 1, [3, 3]);
    V.line(ctx, P.X(Math.max(0, st.tIn)), P.Y(st.zc), P.X(Math.min(T, st.tOut)), P.Y(st.zc), C.amber, 6);
    V.mono(ctx, 'pedestrian in the lane', P.X(Math.max(0, st.tIn)) + 2, P.Y(st.zc) - 10, C.amber, 9);
    var ts = [], c1 = [], c2 = [], tt;
    for (tt = 0; tt <= T + 1e-9; tt += T / 120) { ts.push(tt); c1.push(Math.min(st.zc, sh.v0 * tt)); c2.push(Math.min(st.zc, L.travel(tt, sh.v0, sh.a, ep.onset))); }
    V.curve(ctx, P, ts, c1, C.mute, 1.5, [5, 4]); V.curve(ctx, P, ts, c2, C.teal, 2.5);
    if (st.dl > 0) { V.line(ctx, P.X(st.dl), P.Y(0), P.X(st.dl), P.Y(st.zc), C.violet, 1, [2, 3]); V.mono(ctx, 'deadline', P.X(st.dl), P.Y(0) - 6, C.violet, 9, 'center'); }
    if (ep.tDecide !== null) { V.line(ctx, P.X(ep.tDecide), P.Y(0), P.X(ep.tDecide), P.Y(6), C.red, 2); V.mono(ctx, 'decides', P.X(ep.tDecide), P.Y(6) - 6, C.red, 9, 'center'); }
    var hit = function (o, t, col) { if (o.tf < Infinity && o.tf <= T) V.dot(ctx, P.X(o.tf), P.Y(st.zc), 5, o.collision ? C.red : C.green, C.white); };
    hit(st.coast); hit(st.brake);
    if (st.brake.outcome === 'stop') { V.line(ctx, P.X(T) - 6, P.Y(st.zc), P.X(T) - 6, P.Y(st.zc - st.brake.margin), C.teal, 2); V.mono(ctx, 'margin ' + st.brake.margin.toFixed(1) + ' m', P.X(T) - 10, P.Y(st.zc - st.brake.margin / 2), C.teal, 9, 'right'); }
    V.mono(ctx, 'dashed: never brakes', ax + 52, 21, C.mute, 9); V.mono(ctx, 'solid: the policy', ax + aw - 10, 21, C.teal, 9, 'right');
    /* B: frames and scores */
    var bx = narrow ? pad : Math.round(w * 0.5) + pad, bw = narrow ? w - 2 * pad : w - bx - pad, by = narrow ? ay + ah + 24 : ay;
    V.text(ctx, 'what the camera saw (red border: an alarm)', bx, by - 14, C.ink, 11, 'left', 700);
    var n = ep.scores.length - 1, want = [0], q;
    if (ep.kDecide >= 0) for (q = 1; q <= 5; q++) want.push(Math.round(ep.kDecide * q / 5)); else for (q = 1; q <= 5; q++) want.push(Math.round(n * q / 5));
    var ks = want.filter(function (x, idx) { return want.indexOf(x) === idx; }), gap = 6, cols = 3, fw = (bw - (cols - 1) * gap) / cols, fh = fw / 4;
    for (i = 0; i < ks.length; i++) {
      k = ks[i]; var fx = bx + (i % cols) * (fw + gap), fy = by + Math.floor(i / cols) * (fh + 26);
      V.image(ctx, fx, fy, fw, fh, L.frame(st.sit, k), { gain: 1.0, border: ep.alarms[k] ? C.red : C.grid });
      V.mono(ctx, (k * L.DT).toFixed(1) + ' s  ' + ep.scores[k].toFixed(1), fx, fy + fh + 9, k === ep.kDecide ? C.red : C.mute, 9);
      if (k === ep.kDecide) V.mono(ctx, 'decides', fx, fy + fh + 19, C.red, 9);
    }
    var ty = by + 2 * (fh + 26) + 12, th = narrow ? 120 : 112;
    var smin = Math.min(Math.min.apply(null, ep.scores), st.thr), smax = Math.max.apply(null, ep.scores);
    var R = V.plot(ctx, bx + 30, ty + 6, bw - 36, th, { xmin: 0, xmax: T, ymin: Math.floor(smin - 0.5), ymax: Math.ceil(smax + 0.5), xticks: [0, 1, 2, 3, 4].filter(function (t) { return t <= T + 1e-9; }), xlabel: 't (s)', ylabel: 'score of the frame' });
    var tx = ep.scores.map(function (s, kk) { return kk * L.DT; });
    V.curve(ctx, R, tx, ep.scores, C.blue, 1.5);
    ep.scores.forEach(function (s, kk) { V.dot(ctx, R.X(kk * L.DT), R.Y(s), ep.alarms[kk] ? 3.2 : 2, ep.alarms[kk] ? C.red : C.dim, C.white); });
    V.line(ctx, R.X(0), R.Y(MODEL[st.det].thr), R.X(T), R.Y(MODEL[st.det].thr), C.amber, 1.2, [4, 3]);
    if (ep.tDecide !== null) V.line(ctx, R.X(ep.tDecide), R.by, R.X(ep.tDecide), R.by + R.bh, C.red, 1);
    /* C: the spread of a 20-episode difference */
    var cy = narrow ? ty + th + 52 : ay + ah + 44, cw = w - 2 * pad, ch = narrow ? 150 : 160, lo = Infinity, hi = -Infinity, nb = 24;
    sp.dS.concat(sp.dI).forEach(function (x) { lo = Math.min(lo, x); hi = Math.max(hi, x); });
    var bw2 = (hi - lo) / nb || 1, hs = [], hi2 = [], b;
    for (b = 0; b < nb; b++) { hs.push(0); hi2.push(0); }
    sp.dS.forEach(function (x) { hs[Math.min(nb - 1, Math.floor((x - lo) / bw2))]++; }); sp.dI.forEach(function (x) { hi2[Math.min(nb - 1, Math.floor((x - lo) / bw2))]++; });
    var hmax = Math.max.apply(null, hs.concat(hi2)), hx = pad + 40, hw = cw - 50;
    V.text(ctx, 'the same 20-episode estimate, ' + L.POOL_REPEATS + ' times over: ' + PAIRS[el.pair.value].name, pad, cy - 10, C.ink, 11, 'left', 700);
    V.frame(ctx, hx, cy + 4, hw, ch, C.white, C.grid);
    for (b = 0; b < nb; b++) {
      var x0 = hx + b / nb * hw, bwid = hw / nb - 1;
      var drawBar = function (cnt, col, filled) { var hh = cnt / hmax * (ch - 10); if (!cnt) return; ctx.save(); ctx.globalAlpha = filled ? 0.85 : 0.35; ctx.fillStyle = col; ctx.fillRect(x0 + 0.5, cy + 4 + ch - hh, bwid, hh); ctx.restore(); };
      drawBar(crnOn ? hi2[b] : hs[b], C.amber, !crnOn); drawBar(crnOn ? hs[b] : hi2[b], C.teal, crnOn);
    }
    var all = pool[PAIRS[el.pair.value].a], bb = pool[PAIRS[el.pair.value].b], tru = L.mean(all) - L.mean(bb);
    V.line(ctx, hx + (tru - lo) / (hi - lo || 1) * hw, cy + 4, hx + (tru - lo) / (hi - lo || 1) * hw, cy + 4 + ch, C.ink, 1.2, [3, 3]);
    V.mono(ctx, 'all 1,000: ' + sgn(100 * tru, 1) + ' points', hx + (tru - lo) / (hi - lo || 1) * hw + 3, cy + 14, C.ink, 9);
    V.mono(ctx, 'teal: shared numbers, sd ' + (100 * sp.sdS).toFixed(1) + ' points', hx + 4, cy + ch - 10, C.teal, 10); V.mono(ctx, 'amber: independent, sd ' + (100 * sp.sdI).toFixed(1) + ' points', hx + 4, cy + ch + 2, C.amber, 10);
    V.mono(ctx, 'estimate (points of collision rate)', hx + hw, cy + ch + 18, C.mute, 10, 'right');
  }

  function update() {
    var z = +el.z.value, j = +el.j.value, det = el.det.value, p = el.pair.value, crnOn = el.crn.checked;
    el.zv.textContent = z + ' m'; el.jv.textContent = String(j + 1);
    var st = live(z, j, det); st.det = det; st.thr = MODEL[det].thr;
    var sp = spread(p), ep = st.ep, mg = ep.margin;
    el.td.textContent = ep.tDecide === null ? 'never' : ep.tDecide.toFixed(1) + ' s';
    el.dl.textContent = st.dl.toFixed(2) + ' s';
    el.mg.textContent = sgn(mg, 1) + ' m';
    el.ob.textContent = outText(st.brake); el.oc.textContent = outText(st.coast);
    el.sp.textContent = (100 * (crnOn ? sp.sdS : sp.sdI)).toFixed(1) + ' points';
    el.kk.textContent = (sp.sdI * sp.sdI / (sp.sdS * sp.sdS)).toFixed(1) + ' x';
    el.df.textContent = sgn(100 * (L.mean(pool[PAIRS[p].a]) - L.mean(pool[PAIRS[p].b])), 1) + ' points';
    draw(st, sp, crnOn);
  }
  ['input', 'change'].forEach(function (ev) { [el.z, el.j, el.det, el.pair, el.crn].forEach(function (e) { e.addEventListener(ev, update); }); });
  window.addEventListener('resize', update);
  update();
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
