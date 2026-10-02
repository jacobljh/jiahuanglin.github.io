/* rigid_motion.js — private engine of 3D lesson 03, "Where is the camera? Rigid motion on a curved space".
 *
 * One small estimation problem, descended four ways.  A rigid body carries three markers p_k = a_k·e_k (a = 1, 2, 3 along its own
 * axes).  A target pose R* puts them at q_k = R*·p_k (plus noise, optionally).  The loss is  f(R) = ½ Σ_k |R p_k − q_k|².
 *   'nine'   gradient descent on the nine entries of R, nothing else
 *   'proj'   the same, then replace R by the nearest rotation after every step
 *   'euler'  gradient descent on (yaw, pitch, roll),  R = Rz(yaw)·Ry(pitch)·Rx(roll)
 *   'exp'    gradient descent on a 3-vector δ in the tangent space:  R ← R·exp([δ]×)
 * Every method uses one fixed step (ETA), the largest round number that is stable for its own Hessian.
 * Needs G3 (geom3.js) and FL (flatland.js, for the seeded generator).  Deterministic: no Math.random, no Date.
 */
(function (root) {
'use strict';
var G3 = root.G3 || (typeof require === 'function' ? require('./geom3.js') : null);
var FL = root.FL || (typeof require === 'function' ? require('./flatland.js') : null);
var m3 = G3.m3, v3 = G3.v3, D2R = Math.PI / 180;
var RM = {};
RM.P = [[1, 0, 0], [0, 2, 0], [0, 0, 3]];              // the three markers, in the body frame
RM.AXIS = [2 / 3, -1 / 3, 2 / 3];                      // unit body axis of the start-to-target rotation
RM.SIGMA = 0.03;                                       // noise on each marker coordinate in the "noisy" setting
RM.ETA = { nine: 0.2, proj: 0.2, euler: 1 / 13, exp: 0.1 };
RM.TOL = 1e-6;                                         // "converged": the Frobenius distance to the best rotation is below this
RM.CAP = 400;
RM.CAP_EULER = 20000;

/* the problem for a start that is `angDeg` from the target and a target whose pitch is `pitchDeg` */
RM.problem = function (angDeg, pitchDeg, noisy) {
  var Rstar = m3.eulerZYX(30 * D2R, pitchDeg * D2R, 20 * D2R);
  var R0 = m3.mul(Rstar, m3.exp(v3.scale(RM.AXIS, angDeg * D2R)));
  var rng = FL.rng(7), Q = [], k;
  for (k = 0; k < 3; k++) {
    var e = [FL.randn(rng), FL.randn(rng), FL.randn(rng)];
    Q.push(v3.add(m3.mulv(Rstar, RM.P[k]), v3.scale(e, noisy ? RM.SIGMA : 0)));
  }
  var S = { Rstar: Rstar, R0: R0, Q: Q, noisy: !!noisy };
  S.Rc = noisy ? RM.bestRotation(S) : Rstar;           // the best rotation for these markers
  S.fc = RM.loss(S.Rc, S);
  return S;
};
RM.loss = function (R, S) {
  var f = 0;
  for (var k = 0; k < 3; k++) { var d = v3.sub(m3.mulv(R, RM.P[k]), S.Q[k]); f += 0.5 * v3.dot(d, d); }
  return f;
};
/* ∂f/∂R, the nine partial derivatives:  Σ_k (R p_k − q_k) p_kᵀ */
RM.gradR = function (R, S) {
  var G = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (var k = 0; k < 3; k++) {
    var d = v3.sub(m3.mulv(R, RM.P[k]), S.Q[k]);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) G[3 * i + j] += d[i] * RM.P[k][j];
  }
  return G;
};
/* ∂f/∂δ at δ = 0 for the update R·exp([δ]×):  Σ_k (Rᵀ q_k) × p_k   (three numbers, in the body frame) */
RM.gradTan = function (R, S) {
  var g = [0, 0, 0], Rt = m3.T(R);
  for (var k = 0; k < 3; k++) g = v3.add(g, v3.cross(m3.mulv(Rt, S.Q[k]), RM.P[k]));
  return g;
};
/* the world axes about which a change of yaw, of pitch and of roll turns the frame:  ∂R/∂angle_j = [a_j]× R */
RM.eulerAxes = function (yaw, pitch) {
  return [[0, 0, 1], [-Math.sin(yaw), Math.cos(yaw), 0], [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch)]];
};
RM.frob = function (A, B) { var s = 0; for (var i = 0; i < 9; i++) s += (A[i] - B[i]) * (A[i] - B[i]); return Math.sqrt(s); };
RM.cosPitch = function (R) { return Math.sqrt(Math.max(0, 1 - R[6] * R[6])); };

/* the best rotation: tangent-space descent from the noise-free target, run until it stops moving */
RM.bestRotation = function (S) {
  var R = S.Rstar.slice();
  for (var it = 0; it < 600; it++) R = m3.mul(R, m3.exp(v3.scale(RM.gradTan(R, S), -RM.ETA.exp)));
  return R;
};

/* one run of one method from S.R0.  Returns every iterate and the numbers a reader watches. */
RM.run = function (S, method) {
  var cap = method === 'euler' ? RM.CAP_EULER : RM.CAP, eta = RM.ETA[method], R = S.R0.slice(), ang = null, it, i, j, n = 0, conv = -1, stalled = false;
  var Rs = new Float64Array(9 * (cap + 1)), orth = new Float64Array(cap + 1), det = new Float64Array(cap + 1), dist = new Float64Array(cap + 1), cosp = new Float64Array(cap + 1), angs = new Float64Array(3 * (cap + 1));
  if (method === 'euler') { var e0 = m3.toEulerZYX(R); ang = [e0.yaw, e0.pitch, e0.roll]; R = m3.eulerZYX(ang[0], ang[1], ang[2]); }
  function record(k) {
    for (var q = 0; q < 9; q++) Rs[9 * k + q] = R[q];
    if (ang) for (q = 0; q < 3; q++) angs[3 * k + q] = ang[q];
    orth[k] = m3.orthErr(R); det[k] = m3.det(R); dist[k] = RM.frob(R, S.Rc); cosp[k] = RM.cosPitch(R);
  }
  record(0);
  for (it = 1; it <= cap; it++) {
    var Rn;
    if (method === 'exp') {
      Rn = m3.mul(R, m3.exp(v3.scale(RM.gradTan(R, S), -eta)));
    } else if (method === 'euler') {
      var G = RM.gradR(R, S), ax = RM.eulerAxes(ang[0], ang[1]), etak = eta / (1 + Math.abs(Math.sin(ang[1])));
      for (j = 0; j < 3; j++) { var dR = m3.mul(m3.skew(ax[j]), R), s = 0; for (i = 0; i < 9; i++) s += G[i] * dR[i]; ang[j] -= etak * s; }
      Rn = m3.eulerZYX(ang[0], ang[1], ang[2]);
    } else {
      var Gn = RM.gradR(R, S);
      Rn = R.map(function (v, q) { return v - eta * Gn[q]; });
      if (method === 'proj') Rn = m3.nearestRotation(Rn);
    }
    var step = RM.frob(Rn, R);
    R = Rn; n = it; record(it);
    if (dist[it] < RM.TOL) { conv = it; break; }
    if (step < 1e-12) { stalled = true; break; }
  }
  return { method: method, n: n, conv: conv, stalled: stalled, R: Rs.subarray(0, 9 * (n + 1)), orth: orth.subarray(0, n + 1), det: det.subarray(0, n + 1),
           dist: dist.subarray(0, n + 1), cosp: cosp.subarray(0, n + 1), ang: angs.subarray(0, 3 * (n + 1)), loss: RM.loss(R, S) };
};

/* ───────────────────────────── the picture ───────────────────────────── */
/* left: the marker paths in perspective, with the start (dashed), the best rotation (ghost) and the iterate shown;
 * right: three log-scale plots over the iteration (orthonormality error, distance to the best rotation, determinant). */
var D = FL.draw, C = FL.C, AX = ['#dc2626', '#16a34a', '#2563eb'];
RM.KEYS = ['nine', 'proj', 'euler', 'exp'];
var COL = { nine: C.amber, proj: C.violet, euler: C.red, exp: C.green }, TAG = { nine: 'nine', proj: 'proj', euler: 'Euler', exp: 'exp' };
RM.shown = function (r, k100) { return Math.round(Math.pow(1 + r.n, k100 / 100)) - 1; };      // slider 0..100 → iteration, log-spaced
RM.at = function (r, i) { return Array.prototype.slice.call(r.R, 9 * i, 9 * i + 9); };
function series(r, f, X, Y) {                                                                 // ~120 log-spaced samples of one curve
  var pts = [], last = -1, t, k;
  for (t = 0; t <= 120; t++) { k = Math.round(Math.pow(1 + r.n, t / 120)) - 1; if (k !== last) { pts.push([X(k), Y(f(r, k))]); last = k; } }
  return pts;
}
var lg = function (v) { return Math.log10(Math.max(v, 1e-17)); };
RM.paint = function (cv, cr, method, k100) {
  var S = cr.S, r = cr.runs[method], ks = RM.shown(r, k100), i, j;
  cv.style.height = (cv.clientWidth < 600 ? 840 : 480) + 'px';
  var Sx = D.setup(cv), ctx = Sx.ctx, w = Sx.w, h = Sx.h, narrow = w < 600;
  var vb = narrow ? [8, 8, w - 16, 310] : [8, 8, Math.round(w * 0.42), h - 16];
  var px = (narrow ? 8 : vb[0] + vb[2] + 10) + 36, pw = w - px - 10, py0 = narrow ? vb[1] + vb[3] + 30 : 26, gap = 30, ph = narrow ? 130 : Math.floor((h - py0 - 2 * gap - 26) / 3);
  /* the 3-D view */
  var cam = G3.lookAt([8.5, -7, 6.5], [0, 0, 0], [0, 0, 1], { f: 1.4 * Math.min(vb[2], vb[3]), cx: vb[0] + vb[2] / 2, cy: vb[1] + vb[3] / 2 + 14 });
  var pr = function (p) { var q = G3.project(cam, p); return [q[0], q[1]]; };
  D.frame(ctx, vb[0], vb[1], vb[2], vb[3], C.panel);
  ctx.save(); ctx.beginPath(); ctx.rect(vb[0], vb[1], vb[2], vb[3]); ctx.clip();
  var ring = []; for (i = 0; i <= 72; i++) ring.push(pr([3 * Math.cos(i * Math.PI / 36), 3 * Math.sin(i * Math.PI / 36), 0]));
  D.path(ctx, ring, C.dim, 1);
  var zt = pr([0, 0, 3.4]), zb = pr([0, 0, -3.4]);
  D.line(ctx, zb[0], zb[1], zt[0], zt[1], C.dim, 1, [2, 4]); D.label(ctx, 'yaw axis', zt[0] + 6, zt[1] + 2, C.mute, 9);
  ctx.save(); ctx.globalAlpha = 0.28; G3.draw.frame(ctx, cam, S.Rc, [0, 0, 0], 3, 5); ctx.restore();
  for (j = 0; j < 3; j++) { var q = pr(S.Q[j]); ctx.strokeStyle = AX[j]; ctx.lineWidth = 1.5; ctx.strokeRect(q[0] - 4, q[1] - 4, 8, 8); }
  ctx.save(); ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.5; G3.draw.frame(ctx, cam, S.R0, [0, 0, 0], 3, 1.5); ctx.restore();
  for (j = 0; j < 3; j++) {                                                                    // the path of marker j up to the iterate shown
    var pts = [], st = Math.max(1, Math.floor(ks / 60));
    for (i = 0; i < ks; i += st) pts.push(pr(m3.mulv(RM.at(r, i), RM.P[j])));
    pts.push(pr(m3.mulv(RM.at(r, ks), RM.P[j])));
    D.path(ctx, pts, AX[j], 1.4);
  }
  var Rk = RM.at(r, ks);
  G3.draw.frame(ctx, cam, Rk, [0, 0, 0], 3, 3);
  for (j = 0; j < 3; j++) { var m = pr(m3.mulv(Rk, RM.P[j])); D.dot(ctx, m[0], m[1], 4, AX[j], C.white); }
  if (method === 'euler') {                                                                    // short lines: the panel clips whatever runs past its edge
    var cp = r.cosp[ks], hot = cp < 0.3 ? C.red : C.mute;
    D.label(ctx, 'cos(pitch) = ' + cp.toFixed(3), vb[0] + 8, vb[1] + 14, hot, 10);
    if (cp < 0.3) D.label(ctx, cp < 0.05 ? 'LOCKED: roll axis = yaw axis' : 'near lock', vb[0] + 8, vb[1] + 27, hot, 10);
  }
  D.label(ctx, 'dashed: start   ghost: best rotation', vb[0] + 8, vb[1] + vb[3] - 22, C.mute, 9);
  D.label(ctx, 'squares: wanted markers', vb[0] + 8, vb[1] + vb[3] - 10, C.mute, 9);
  ctx.restore();
  /* the plots */
  var xmax = Math.log10(1 + Math.max.apply(null, RM.KEYS.map(function (m) { return cr.runs[m].n; })));
  function panel(n, title, y0, y1, ticks, f, thr) {
    var yy = py0 + n * (ph + gap), X = function (k) { return px + Math.log10(1 + k) / xmax * pw; }, Y = function (v) { return yy + ph - (Math.max(y0, Math.min(y1, v)) - y0) / (y1 - y0) * ph; };
    D.frame(ctx, px, yy, pw, ph, C.white);
    ticks.forEach(function (t) { D.line(ctx, px, Y(t[0]), px + pw, Y(t[0]), C.grid, 1); D.mono(ctx, t[1], px - 4, Y(t[0]), C.mute, 9, 'right'); });
    if (thr !== undefined) D.line(ctx, px, Y(thr), px + pw, Y(thr), C.dim, 1, [4, 3]);
    RM.KEYS.forEach(function (m) { if (m !== method) D.path(ctx, series(cr.runs[m], f, X, Y), COL[m], 1.3); });
    D.path(ctx, series(r, f, X, Y), COL[method], 2.8);
    D.line(ctx, X(ks), yy, X(ks), yy + ph, C.ink, 1, [2, 2]);
    D.mono(ctx, title, px + 2, yy - 9, C.mute, 9);
    return { X: X, Y: Y, yy: yy };
  }
  var f1 = function (rr, k) { return lg(rr.orth[k]); }, f2 = function (rr, k) { return lg(rr.dist[k]); }, f3 = function (rr, k) { return rr.det[k]; };
  var tight = pw < 330;                                                                         // narrow plots: shorter title, closer legend, so the two never share a row of pixels
  panel(0, tight ? 'orthonormality error' : 'orthonormality error (log10)', -17, 1, [[0, '1'], [-5, '1e-5'], [-10, '1e-10'], [-15, '1e-15']], f1);
  RM.KEYS.forEach(function (m, n) { D.mono(ctx, TAG[m], tight ? px + pw - 112 + 29 * n : px + pw - 130 + 33 * n, py0 - 9, COL[m], 9); });
  panel(1, 'distance to best rotation (log10)', -8, 1, [[0, '1'], [-3, '1e-3'], [-6, '1e-6']], f2, -6);
  var p3 = panel(2, 'determinant of R', -0.5, 1.5, [[0, '0'], [1, '1']], f3, 0);
  if (method === 'euler') D.path(ctx, series(r, function (rr, k) { return rr.cosp[k]; }, p3.X, p3.Y), C.red, 1.2, [2, 3]);
  [1, 10, 100, 1000, 10000].forEach(function (t) { if (t <= Math.pow(10, xmax)) D.mono(ctx, String(t), p3.X(t), p3.yy + ph + 11, C.mute, 9, 'center'); });
  D.mono(ctx, 'iteration (log scale)', px + pw, p3.yy + ph + 22, C.mute, 9, 'right');
};

root.RM = RM;
if (typeof module !== 'undefined' && module.exports) module.exports = RM;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
