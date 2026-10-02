/* geom3.js — true-3D geometry for the 3D Vision series (lessons 3 and 5, and anywhere a lesson needs real 3D).
 *
 * Conventions: right-handed, column vectors, ACTIVE rotations.  A rotation is a 3×3 row-major array of 9 numbers.
 * A rigid transform T = {R, t} maps  x ↦ R x + t.  A camera is  x_cam = R x_world + t  looking along +z_cam,
 * with x to the right and y DOWN (the computer-vision convention), pixel  u = cx + f·x/z,  v = cy + f·y/z.
 * Rotation vectors w ∈ ℝ³ (axis·angle) are the tangent-space coordinates of SO(3):  R = exp([w]×).
 * Deterministic; no Math.random / Date.
 */
(function (root) {
'use strict';
var G3 = {};
var PI = Math.PI;

/* ───────────────────────────── vectors ───────────────────────────── */
G3.v3 = {
  add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
  dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross: function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; },
  norm: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
  normalize: function (a) { var n = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
};
var v3 = G3.v3;

/* ───────────────────────────── 3×3 matrices & rotations ───────────────────────────── */
var m3 = G3.m3 = {};
m3.id = function () { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; };
m3.mul = function (A, B) {
  var C = new Array(9);
  for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return C;
};
m3.mulv = function (A, v) { return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]]; };
m3.T = function (A) { return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]; };
m3.det = function (A) { return A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]); };
m3.trace = function (A) { return A[0] + A[4] + A[8]; };
m3.add = function (A, B) { var C = new Array(9); for (var i = 0; i < 9; i++) C[i] = A[i] + B[i]; return C; };
m3.scale = function (A, s) { var C = new Array(9); for (var i = 0; i < 9; i++) C[i] = A[i] * s; return C; };
m3.skew = function (w) { return [0, -w[2], w[1], w[2], 0, -w[0], -w[1], w[0], 0]; };
m3.fro = function (A) { var s = 0; for (var i = 0; i < 9; i++) s += A[i] * A[i]; return Math.sqrt(s); };
/* how far from a rotation: ‖RᵀR − I‖_F  (and |det − 1| separately) */
m3.orthErr = function (R) { var E = m3.mul(m3.T(R), R); for (var i = 0; i < 3; i++) E[4 * i] -= 1; return m3.fro(E); };
m3.Rx = function (a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
m3.Ry = function (a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
m3.Rz = function (a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
/* Rodrigues:  exp([w]×) = I + (sin θ/θ)[w]× + ((1−cos θ)/θ²)[w]×²,  θ = ‖w‖ */
m3.exp = function (w) {
  var th = v3.norm(w), K = m3.skew(w), K2 = m3.mul(K, K), a, b;
  if (th < 1e-8) { a = 1 - th * th / 6; b = 0.5 - th * th / 24; } else { a = Math.sin(th) / th; b = (1 - Math.cos(th)) / (th * th); }
  return m3.add(m3.add(m3.id(), m3.scale(K, a)), m3.scale(K2, b));
};
m3.fromAxisAngle = function (axis, angle) { var n = v3.normalize(axis); return m3.exp([n[0] * angle, n[1] * angle, n[2] * angle]); };
/* log map: R → w (angle in [0, π]).  Handles θ≈0 and θ≈π. */
m3.log = function (R) {
  var c = Math.max(-1, Math.min(1, (m3.trace(R) - 1) / 2)), th = Math.acos(c);
  var wx = R[7] - R[5], wy = R[2] - R[6], wz = R[3] - R[1];
  if (th < 1e-8) return [wx / 2, wy / 2, wz / 2];
  if (Math.PI - th < 1e-5) {                                // near π: axis from the symmetric part (R+I)/2 = n nᵀ
    var B = m3.scale(m3.add(R, m3.id()), 0.5), i = 0;
    if (B[4] > B[0]) i = 1; if (B[8] > B[4 * i]) i = 2;
    var n = [B[3 * i], B[3 * i + 1], B[3 * i + 2]]; n = v3.normalize(n);
    var s = [wx, wy, wz]; if (v3.dot(n, s) < 0) n = v3.scale(n, -1);
    return v3.scale(n, th);
  }
  var k = th / (2 * Math.sin(th));
  return [wx * k, wy * k, wz * k];
};
m3.angle = function (R) { return Math.acos(Math.max(-1, Math.min(1, (m3.trace(R) - 1) / 2))); };
/* geodesic distance between two rotations */
m3.dist = function (A, B) { return m3.angle(m3.mul(m3.T(A), B)); };
/* ZYX Euler angles:  R = Rz(yaw)·Ry(pitch)·Rx(roll) */
m3.eulerZYX = function (yaw, pitch, roll) { return m3.mul(m3.Rz(yaw), m3.mul(m3.Ry(pitch), m3.Rx(roll))); };
m3.toEulerZYX = function (R) {
  var sp = -R[6], pitch = Math.asin(Math.max(-1, Math.min(1, sp)));
  if (Math.abs(sp) > 0.999999) return { yaw: Math.atan2(-R[1], R[4]), pitch: pitch, roll: 0, locked: true };   // gimbal lock
  return { yaw: Math.atan2(R[3], R[0]), pitch: pitch, roll: Math.atan2(R[7], R[8]), locked: false };
};
/* nearest rotation in Frobenius norm via the polar decomposition (Newton iteration) */
m3.nearestRotation = function (M) {
  var X = M.slice(), i;
  for (i = 0; i < 40; i++) {
    var Xi = m3.inv(m3.T(X)); if (!Xi) break;
    var Y = m3.scale(m3.add(X, Xi), 0.5), d = 0; for (var k = 0; k < 9; k++) d += Math.abs(Y[k] - X[k]);
    X = Y; if (d < 1e-14) break;
  }
  if (m3.det(X) < 0) X = m3.scale(X, -1);
  return X;
};
m3.inv = function (A) {
  var d = m3.det(A); if (Math.abs(d) < 1e-14) return null;
  var C = [A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4],
           A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5],
           A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3]];
  return m3.scale(C, 1 / d);
};
/* unit quaternions q = [w, x, y, z] */
m3.toQuat = function (R) {
  var t = m3.trace(R), q;
  if (t > 0) { var s = Math.sqrt(t + 1) * 2; q = [s / 4, (R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s]; }
  else if (R[0] > R[4] && R[0] > R[8]) { var s0 = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; q = [(R[7] - R[5]) / s0, s0 / 4, (R[1] + R[3]) / s0, (R[2] + R[6]) / s0]; }
  else if (R[4] > R[8]) { var s1 = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; q = [(R[2] - R[6]) / s1, (R[1] + R[3]) / s1, s1 / 4, (R[5] + R[7]) / s1]; }
  else { var s2 = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; q = [(R[3] - R[1]) / s2, (R[2] + R[6]) / s2, (R[5] + R[7]) / s2, s2 / 4]; }
  var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
m3.fromQuat = function (q) {
  var w = q[0], x = q[1], y = q[2], z = q[3];
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
          2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
          2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
};
m3.slerp = function (qa, qb, t) {
  var d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3], b = qb.slice();
  if (d < 0) { d = -d; b = [-b[0], -b[1], -b[2], -b[3]]; }
  var ka, kb;
  if (d > 0.9995) { ka = 1 - t; kb = t; }
  else { var th = Math.acos(d), s = Math.sin(th); ka = Math.sin((1 - t) * th) / s; kb = Math.sin(t * th) / s; }
  var q = [ka * qa[0] + kb * b[0], ka * qa[1] + kb * b[1], ka * qa[2] + kb * b[2], ka * qa[3] + kb * b[3]];
  var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};

/* ───────────────────────────── SE(3) ───────────────────────────── */
var se3 = G3.se3 = {};
se3.make = function (R, t) { return { R: R, t: t }; };
se3.id = function () { return { R: m3.id(), t: [0, 0, 0] }; };
se3.apply = function (T, p) { var r = m3.mulv(T.R, p); return [r[0] + T.t[0], r[1] + T.t[1], r[2] + T.t[2]]; };
se3.compose = function (A, B) { return { R: m3.mul(A.R, B.R), t: v3.add(m3.mulv(A.R, B.t), A.t) }; };   // A∘B : B first
se3.inv = function (T) { var Rt = m3.T(T.R); return { R: Rt, t: v3.scale(m3.mulv(Rt, T.t), -1) }; };
/* exp of a twist ξ = [ρ, ω] (6-vector):  R = exp([ω]×),  t = V ρ,  V = I + b[ω]× + c[ω]×²  */
se3.exp = function (xi) {
  var rho = [xi[0], xi[1], xi[2]], w = [xi[3], xi[4], xi[5]], th = v3.norm(w), K = m3.skew(w), K2 = m3.mul(K, K), b, c;
  if (th < 1e-8) { b = 0.5 - th * th / 24; c = 1 / 6 - th * th / 120; } else { b = (1 - Math.cos(th)) / (th * th); c = (th - Math.sin(th)) / (th * th * th); }
  var V = m3.add(m3.add(m3.id(), m3.scale(K, b)), m3.scale(K2, c));
  return { R: m3.exp(w), t: m3.mulv(V, rho) };
};
se3.log = function (T) {
  var w = m3.log(T.R), th = v3.norm(w), K = m3.skew(w), K2 = m3.mul(K, K), a;
  if (th < 1e-8) a = 1 / 12; else a = (1 - th * Math.sin(th) / (2 * (1 - Math.cos(th)))) / (th * th);
  var Vinv = m3.add(m3.add(m3.id(), m3.scale(K, -0.5)), m3.scale(K2, a));
  var rho = m3.mulv(Vinv, T.t);
  return [rho[0], rho[1], rho[2], w[0], w[1], w[2]];
};

/* ───────────────────────────── pinhole cameras (3D) ───────────────────────────── */
/* cam = {f, cx, cy, R, t}: x_cam = R x_world + t.  */
G3.camera = function (o) { return { f: o.f || 500, cx: o.cx === undefined ? 320 : o.cx, cy: o.cy === undefined ? 240 : o.cy, R: o.R || m3.id(), t: o.t || [0, 0, 0] }; };
G3.toCam = function (cam, X) { return se3.apply({ R: cam.R, t: cam.t }, X); };
G3.project = function (cam, X) { var c = G3.toCam(cam, X); return [cam.cx + cam.f * c[0] / c[2], cam.cy + cam.f * c[1] / c[2], c[2]]; };
/* camera centre in world coordinates:  C = −Rᵀ t */
G3.center = function (cam) { return v3.scale(m3.mulv(m3.T(cam.R), cam.t), -1); };
/* look-at camera: place the centre at `eye`, optical axis toward `target`, world "up" ≈ −y_cam */
G3.lookAt = function (eye, target, up, o) {
  o = o || {};
  var z = v3.normalize(v3.sub(target, eye)), x = v3.normalize(v3.cross(z, up || [0, 1, 0])), y = v3.cross(z, x);
  // rows of R are the camera axes expressed in world coordinates (x right, y down, z forward)
  var R = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  var t = v3.scale(m3.mulv(R, eye), -1);
  return G3.camera({ f: o.f, cx: o.cx, cy: o.cy, R: R, t: t });
};

/* ───────────────────────────── symmetric eigen / SVD (Jacobi) ───────────────────────────── */
/* eigen-decomposition of a symmetric n×n matrix (row-major array).  returns {vals (descending), vecs} with vecs[k] the k-th eigenvector (array n) */
G3.eigSym = function (A0, n) {
  var A = Float64Array.from(A0), V = new Float64Array(n * n), i, j, k;
  for (i = 0; i < n; i++) V[i * n + i] = 1;
  for (var sweep = 0; sweep < 60; sweep++) {
    var off = 0;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-26) break;
    for (var p = 0; p < n - 1; p++) for (var q = p + 1; q < n; q++) {
      var apq = A[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      var theta = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      var c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (k = 0; k < n; k++) { var akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
      for (k = 0; k < n; k++) { var apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
      for (k = 0; k < n; k++) { var vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
    }
  }
  var idx = []; for (i = 0; i < n; i++) idx.push(i);
  idx.sort(function (a, b) { return A[b * n + b] - A[a * n + a]; });
  var vals = [], vecs = [];
  idx.forEach(function (id) { vals.push(A[id * n + id]); var v = []; for (var r = 0; r < n; r++) v.push(V[r * n + id]); vecs.push(v); });
  return { vals: vals, vecs: vecs };
};
/* SVD of a 3×3:  A = U diag(S) Vᵀ  with S descending, U and V proper rotations (det +1; the last singular value carries the sign) */
G3.svd3 = function (A) {
  var AtA = m3.mul(m3.T(A), A), e = G3.eigSym(AtA, 3);
  var V = [e.vecs[0][0], e.vecs[1][0], e.vecs[2][0], e.vecs[0][1], e.vecs[1][1], e.vecs[2][1], e.vecs[0][2], e.vecs[1][2], e.vecs[2][2]];
  if (m3.det(V) < 0) { V[2] = -V[2]; V[5] = -V[5]; V[8] = -V[8]; }
  var S = [Math.sqrt(Math.max(0, e.vals[0])), Math.sqrt(Math.max(0, e.vals[1])), Math.sqrt(Math.max(0, e.vals[2]))];
  var AV = m3.mul(A, V), U = new Array(9), cols = [];
  for (var j = 0; j < 2; j++) {
    var c = [AV[j], AV[3 + j], AV[6 + j]];
    cols.push(S[j] > 1e-12 ? v3.scale(c, 1 / S[j]) : null);
  }
  if (!cols[0]) cols[0] = [1, 0, 0];
  if (!cols[1]) { var t = Math.abs(cols[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; cols[1] = v3.normalize(v3.sub(t, v3.scale(cols[0], v3.dot(t, cols[0])))); }
  /* the third column is the cross product of the first two (U stays a rotation however small S[2] is: dividing A·v3 by a tiny S[2]
   * would amplify rounding noise), and S[2] carries the sign that makes  A v3 = S[2] u3 */
  cols[2] = v3.cross(cols[0], cols[1]);
  if (AV[2] * cols[2][0] + AV[5] * cols[2][1] + AV[8] * cols[2][2] < 0) S[2] = -S[2];
  for (var jj = 0; jj < 3; jj++) { U[jj] = cols[jj][0]; U[3 + jj] = cols[jj][1]; U[6 + jj] = cols[jj][2]; }
  return { U: U, S: S, V: V };
};

/* ───────────────────────────── Levenberg–Marquardt with a numeric Jacobian ───────────────────────────── */
/* res(x) → Float64Array/Array of residuals.  x0: array of unknowns.  opts: maxIter, lambda0, tol, h, fixed (indices to hold),
 * robust ({huber: delta}).  Returns {x, history: [{iter, cost, lambda, step}], converged}.  cost = ½ Σ ρ(r²).        */
G3.lm = function (res, x0, opts) {
  opts = opts || {};
  var x = Array.from(x0), n = x.length, maxIter = opts.maxIter || 30, lam = opts.lambda0 || 1e-3, h = opts.h || 1e-6, hub = opts.huber;
  var fixed = {}; (opts.fixed || []).forEach(function (i) { fixed[i] = true; });
  var free = []; for (var i = 0; i < n; i++) if (!fixed[i]) free.push(i);
  var m = free.length;
  function wts(r) {                                         // IRLS weights for the Huber loss
    var w = new Float64Array(r.length);
    for (var k = 0; k < r.length; k++) { var a = Math.abs(r[k]); w[k] = (!hub || a <= hub) ? 1 : Math.sqrt(hub / a); }
    return w;
  }
  function cost(r) {
    var c = 0;
    for (var k = 0; k < r.length; k++) { var a = Math.abs(r[k]); c += (!hub || a <= hub) ? 0.5 * a * a : hub * (a - 0.5 * hub); }
    return c;
  }
  var r = res(x), c = cost(r), history = [{ iter: 0, cost: c, lambda: lam, step: 0 }], converged = false;
  for (var iter = 1; iter <= maxIter; iter++) {
    var nr = r.length, J = new Float64Array(nr * m), w = wts(r), jj, k;
    for (jj = 0; jj < m; jj++) {
      var id = free[jj], save = x[id], hh = h * (1 + Math.abs(save));
      x[id] = save + hh; var rp = res(x); x[id] = save - hh; var rm = res(x); x[id] = save;
      for (k = 0; k < nr; k++) J[k * m + jj] = (rp[k] - rm[k]) / (2 * hh) * w[k];
    }
    var H = new Float64Array(m * m), g = new Float64Array(m);
    for (k = 0; k < nr; k++) {
      var rk = r[k] * w[k];
      for (var a = 0; a < m; a++) { var Ja = J[k * m + a]; if (Ja === 0) continue; g[a] += Ja * rk; for (var b = 0; b < m; b++) H[a * m + b] += Ja * J[k * m + b]; }
    }
    var accepted = false, tries = 0;
    while (!accepted && tries++ < 12) {
      var Hd = Float64Array.from(H); for (var d = 0; d < m; d++) Hd[d * m + d] += lam * (H[d * m + d] + 1e-9);
      var nb = new Float64Array(m); for (var q = 0; q < m; q++) nb[q] = -g[q];
      var step = G3._solveSPD(Hd, nb, m);
      if (!step) { lam *= 10; continue; }
      var xn = x.slice(); for (var s = 0; s < m; s++) xn[free[s]] += step[s];
      var rn = res(xn), cn = cost(rn);
      if (cn < c) {
        var sz = 0; for (var s2 = 0; s2 < m; s2++) sz += step[s2] * step[s2];
        x = xn; r = rn; var drop = c - cn; c = cn; lam = Math.max(1e-9, lam / 3); accepted = true;
        history.push({ iter: iter, cost: c, lambda: lam, step: Math.sqrt(sz) });
        if (Math.sqrt(sz) < (opts.tol || 1e-9) || drop < 1e-14 * (1 + c)) converged = true;
      } else lam *= 4;
    }
    if (!accepted || converged) { converged = true; break; }
  }
  return { x: x, history: history, converged: converged };
};
G3._solveSPD = function (A, b, n) {
  var L = new Float64Array(n * n), i, j, k, s;
  for (i = 0; i < n; i++) {
    for (j = 0; j <= i; j++) {
      s = A[i * n + j]; for (k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (s <= 1e-18) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
    }
  }
  var y = new Float64Array(n), x = new Float64Array(n);
  for (i = 0; i < n; i++) { s = b[i]; for (k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  for (i = n - 1; i >= 0; i--) { s = y[i]; for (k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
};

/* ───────────────────────────── two-view geometry ───────────────────────────── */
/* normalised 8-point on NORMALISED image coordinates (x/f-style [x,y] pairs, i.e. K⁻¹ applied).  Returns E with the
 * epipolar constraint  x2ᵀ E x1 = 0  and the essential-manifold projection (singular values σ,σ,0).               */
G3.eightPoint = function (x1, x2) {
  var n = x1.length, AtA = new Float64Array(81), i, a, b;
  for (i = 0; i < n; i++) {
    var p = [x1[i][0], x1[i][1], 1], q = [x2[i][0], x2[i][1], 1], row = new Array(9);
    for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) row[3 * a + b] = q[a] * p[b];
    for (a = 0; a < 9; a++) for (b = 0; b < 9; b++) AtA[a * 9 + b] += row[a] * row[b];
  }
  var e = G3.eigSym(AtA, 9), E = e.vecs[8];                    // eigenvector of the smallest eigenvalue
  var s = G3.svd3(E), sig = (Math.abs(s.S[0]) + Math.abs(s.S[1])) / 2;
  var D = [sig, 0, 0, 0, sig, 0, 0, 0, 0];
  return m3.mul(s.U, m3.mul(D, m3.T(s.V)));
};
/* the four (R, t) candidates of an essential matrix (t is a unit vector; the scale is lost) */
G3.decomposeE = function (E) {
  var s = G3.svd3(E), W = [0, -1, 0, 1, 0, 0, 0, 0, 1], U = s.U, Vt = m3.T(s.V);
  var R1 = m3.mul(U, m3.mul(W, Vt)), R2 = m3.mul(U, m3.mul(m3.T(W), Vt));
  if (m3.det(R1) < 0) R1 = m3.scale(R1, -1); if (m3.det(R2) < 0) R2 = m3.scale(R2, -1);
  var t = [U[2], U[5], U[8]];
  return [{ R: R1, t: t }, { R: R1, t: v3.scale(t, -1) }, { R: R2, t: t }, { R: R2, t: v3.scale(t, -1) }];
};
/* linear (DLT) triangulation of one point from two NORMALISED observations; camera 1 = [I|0], camera 2 = [R|t] */
G3.triangulate2 = function (x1, x2, R, t) {
  // solve for X: x1 ~ X, x2 ~ R X + t.  Cross-product constraints stacked as a 4×4 homogeneous system, solved by eig of AᵀA.
  var P2 = [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2]];
  var rows = [
    [-1, 0, x1[0], 0], [0, -1, x1[1], 0],
    [x2[0] * P2[8] - P2[0], x2[0] * P2[9] - P2[1], x2[0] * P2[10] - P2[2], x2[0] * P2[11] - P2[3]],
    [x2[1] * P2[8] - P2[4], x2[1] * P2[9] - P2[5], x2[1] * P2[10] - P2[6], x2[1] * P2[11] - P2[7]]
  ];
  // careful: row 3/4 use the third row of P2 = [R20 R21 R22 t2] → indices 8..11
  var AtA = new Float64Array(16);
  rows.forEach(function (r) { for (var a = 0; a < 4; a++) for (var b = 0; b < 4; b++) AtA[a * 4 + b] += r[a] * r[b]; });
  var e = G3.eigSym(AtA, 4), v = e.vecs[3];
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
};
/* pick the (R,t) candidate with most points in front of both cameras (cheirality) */
G3.recoverPose = function (E, x1, x2) {
  var cands = G3.decomposeE(E), best = null, bestN = -1;
  cands.forEach(function (c) {
    var n = 0;
    for (var i = 0; i < x1.length; i++) {
      var X = G3.triangulate2(x1[i], x2[i], c.R, c.t), Xc = se3.apply({ R: c.R, t: c.t }, X);
      if (X[2] > 0 && Xc[2] > 0) n++;
    }
    if (n > bestN) { bestN = n; best = c; }
  });
  return { R: best.R, t: best.t, inFront: bestN, candidates: cands };
};

/* ───────────────────────────── perspective drawing helpers ───────────────────────────── */
G3.draw = {};
/* draw an RGB coordinate frame with rotation R at origin o, seen through a view camera, onto ctx */
G3.draw.frame = function (ctx, view, R, o, len, lw) {
  var cols = ['#dc2626', '#16a34a', '#2563eb'], p0 = G3.project(view, o);
  for (var k = 0; k < 3; k++) {
    var axis = [R[k], R[3 + k], R[6 + k]], tip = G3.project(view, v3.add(o, v3.scale(axis, len)));
    ctx.strokeStyle = cols[k]; ctx.lineWidth = lw || 3; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
  }
};

root.G3 = G3;
if (typeof module !== 'undefined' && module.exports) module.exports = G3;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
