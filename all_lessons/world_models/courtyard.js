/* courtyard.js — the running world of the World Models series.
 *
 * The Courtyard is a small, honest laboratory: a ball rolls on a floor with friction, bounces off walls and posts,
 * can disappear behind a curtain, is pushed by an agent, and is nudged by a wind the agent cannot see.  Every idea
 * of the series — belief, learned dynamics, branching futures, compounding error, causal effects, imagination,
 * planning — is exercised on it with REAL computation (filters, small neural networks trained by Adam, planners).
 *
 * Conventions: state s = [x, y, vx, vy] (metres, metres/second); one step = world.dt seconds; an action is an impulse
 * a = [ax, ay] added to the velocity at the start of a step.  Deterministic: no Math.random, no Date; pass CY.rng(seed).
 */
(function (root) {
'use strict';
var CY = {};
var PI = Math.PI;

/* ───────────────────────────── random numbers ───────────────────────────── */
CY.rng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
CY.randn = function (rng) { var u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * rng()); };
CY.shuffle = function (arr, rng) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };

/* ───────────────────────────── small dense linear algebra (row-major Float64Array) ───────────────────────────── */
var la = CY.la = {};
la.zeros = function (r, c) { return new Float64Array(r * c); };
la.mul = function (A, ar, ac, B, bc) {                 // (ar×ac)·(ac×bc)
  var C = new Float64Array(ar * bc);
  for (var i = 0; i < ar; i++) for (var k = 0; k < ac; k++) { var a = A[i * ac + k]; if (a === 0) continue; for (var j = 0; j < bc; j++) C[i * bc + j] += a * B[k * bc + j]; }
  return C;
};
la.T = function (A, r, c) { var B = new Float64Array(r * c); for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) B[j * r + i] = A[i * c + j]; return B; };
la.solve = function (A, b, n) {                        // Gauss–Jordan with partial pivoting; b may have m columns (n×m)
  var m = b.length / n, M = new Float64Array(n * (n + m)), i, j, k, w = n + m;
  for (i = 0; i < n; i++) { for (j = 0; j < n; j++) M[i * w + j] = A[i * n + j]; for (j = 0; j < m; j++) M[i * w + n + j] = b[i * m + j]; }
  for (i = 0; i < n; i++) {
    var p = i, best = Math.abs(M[i * w + i]);
    for (k = i + 1; k < n; k++) { var v = Math.abs(M[k * w + i]); if (v > best) { best = v; p = k; } }
    if (best < 1e-13) return null;
    if (p !== i) for (j = 0; j < w; j++) { var t = M[i * w + j]; M[i * w + j] = M[p * w + j]; M[p * w + j] = t; }
    var d = M[i * w + i]; for (j = i; j < w; j++) M[i * w + j] /= d;
    for (k = 0; k < n; k++) if (k !== i) { var f = M[k * w + i]; if (f !== 0) for (j = i; j < w; j++) M[k * w + j] -= f * M[i * w + j]; }
  }
  var X = new Float64Array(n * m);
  for (i = 0; i < n; i++) for (j = 0; j < m; j++) X[i * m + j] = M[i * w + n + j];
  return X;
};
la.inv = function (A, n) { var I = new Float64Array(n * n); for (var i = 0; i < n; i++) I[i * n + i] = 1; return la.solve(A, I, n); };
/* ridge regression: W = (ΦᵀΦ + λI)⁻¹ ΦᵀY   with Φ (n×p), Y (n×q) → W (p×q) */
la.ridge = function (Phi, n, p, Y, q, lambda) {
  var Pt = la.T(Phi, n, p), A = la.mul(Pt, p, n, Phi, p), B = la.mul(Pt, p, n, Y, q);
  for (var i = 0; i < p; i++) A[i * p + i] += lambda || 1e-9;
  return la.solve(A, B, p);
};
/* symmetric eigen-decomposition (cyclic Jacobi).  vals descending, vecs[k] = k-th eigenvector */
la.eigSym = function (A0, n) {
  var A = Float64Array.from(A0), V = new Float64Array(n * n), i, j, k;
  for (i = 0; i < n; i++) V[i * n + i] = 1;
  for (var sweep = 0; sweep < 60; sweep++) {
    var off = 0; for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-26) break;
    for (var p = 0; p < n - 1; p++) for (var q = p + 1; q < n; q++) {
      var apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
      var th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
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
/* sample covariance of rows of X (n×d), mean-centred; returns {mean, cov} */
la.cov = function (X, n, d) {
  var mean = new Float64Array(d), C = new Float64Array(d * d), i, a, b;
  for (i = 0; i < n; i++) for (a = 0; a < d; a++) mean[a] += X[i * d + a] / n;
  for (i = 0; i < n; i++) for (a = 0; a < d; a++) for (b = 0; b < d; b++) C[a * d + b] += (X[i * d + a] - mean[a]) * (X[i * d + b] - mean[b]) / (n - 1);
  return { mean: mean, cov: C };
};

/* ───────────────────────────── the Courtyard world ───────────────────────────── */
/* opts (all optional): W,H arena; r ball radius; gamma friction (1/s); e wall restitution; dt; sigV velocity jitter per step;
 * wind [wx,wy] constant acceleration; posts [{x,y,r}] round posts; diamonds [{x,y,h}] square posts rotated 45° (vertex pointing ±x,±y,
 * half-diagonal h); curtain [x0,x1] (the sensor cannot see the ball while x is inside); goal {x,y,r}; sigO observation noise. */
CY.world = function (o) {
  o = o || {};
  return {
    W: o.W || 8, H: o.H || 5, r: o.r === undefined ? 0.1 : o.r, gamma: o.gamma === undefined ? 0.35 : o.gamma, e: o.e === undefined ? 0.9 : o.e,
    ePost: o.ePost === undefined ? 0.95 : o.ePost, dt: o.dt || 0.1, sub: o.sub || 5, sigV: o.sigV || 0, wind: o.wind || [0, 0],
    posts: o.posts || [], diamonds: o.diamonds || [], curtain: o.curtain === undefined ? [2.6, 3.4] : o.curtain,
    goal: o.goal || { x: 6.6, y: 2.5, r: 0.5 }, sigO: o.sigO === undefined ? 0.1 : o.sigO
  };
};
function collideCircle(w, st, cx, cy, cr, ePost) {
  var dx = st[0] - cx, dy = st[1] - cy, d = Math.sqrt(dx * dx + dy * dy), R = w.r + cr;
  if (d < R && d > 1e-9) {
    var nx = dx / d, ny = dy / d; st[0] = cx + nx * R; st[1] = cy + ny * R;
    var vn = st[2] * nx + st[3] * ny;
    if (vn < 0) { st[2] -= (1 + ePost) * vn * nx; st[3] -= (1 + ePost) * vn * ny; }
  }
}
/* diamond = square rotated 45° with half-diagonal h: |x−cx| + |y−cy| ≤ h.  Ball vs convex polygon via closest boundary point. */
function collideDiamond(w, st, dm, ePost) {
  var cx = dm.x, cy = dm.y, h = dm.h, V = [[cx - h, cy], [cx, cy - h], [cx + h, cy], [cx, cy + h]], best = 1e9, bx = 0, by = 0;
  for (var i = 0; i < 4; i++) {
    var a = V[i], b = V[(i + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], t = ((st[0] - a[0]) * ex + (st[1] - a[1]) * ey) / (ex * ex + ey * ey);
    t = Math.max(0, Math.min(1, t));
    var px = a[0] + t * ex, py = a[1] + t * ey, d2 = (st[0] - px) * (st[0] - px) + (st[1] - py) * (st[1] - py);
    if (d2 < best) { best = d2; bx = px; by = py; }
  }
  var d = Math.sqrt(best), inside = Math.abs(st[0] - cx) + Math.abs(st[1] - cy) <= h;
  if (d < w.r || inside) {
    var nx = st[0] - bx, ny = st[1] - by, nl = Math.sqrt(nx * nx + ny * ny);
    if (nl < 1e-9) { nx = st[0] - cx; ny = st[1] - cy; nl = Math.sqrt(nx * nx + ny * ny) || 1; }
    nx /= nl; ny /= nl; if (inside) { nx = -nx; ny = -ny; }
    st[0] = bx + nx * w.r; st[1] = by + ny * w.r;
    var vn = st[2] * nx + st[3] * ny;
    if (vn < 0) { st[2] -= (1 + ePost) * vn * nx; st[3] -= (1 + ePost) * vn * ny; }
  }
}
/* one control step.  s = [x,y,vx,vy]; a = [ax,ay] impulse or null; rng only needed if world.sigV > 0.  Returns a NEW state. */
CY.step = function (w, s, a, rng) {
  var st = [s[0], s[1], s[2], s[3]];
  if (a) { st[2] += a[0]; st[3] += a[1]; }
  var n = w.sub, h = w.dt / n, damp = Math.exp(-w.gamma * h), glide = w.gamma > 1e-9 ? (1 - damp) / w.gamma : h;   // exact for pure friction
  for (var i = 0; i < n; i++) {
    st[2] += w.wind[0] * h; st[3] += w.wind[1] * h;
    st[0] += st[2] * glide; st[1] += st[3] * glide; st[2] *= damp; st[3] *= damp;
    if (st[0] < w.r) { st[0] = 2 * w.r - st[0]; st[2] = -w.e * st[2]; }
    if (st[0] > w.W - w.r) { st[0] = 2 * (w.W - w.r) - st[0]; st[2] = -w.e * st[2]; }
    if (st[1] < w.r) { st[1] = 2 * w.r - st[1]; st[3] = -w.e * st[3]; }
    if (st[1] > w.H - w.r) { st[1] = 2 * (w.H - w.r) - st[1]; st[3] = -w.e * st[3]; }
    for (var p = 0; p < w.posts.length; p++) collideCircle(w, st, w.posts[p].x, w.posts[p].y, w.posts[p].r, w.ePost);
    for (var q = 0; q < w.diamonds.length; q++) collideDiamond(w, st, w.diamonds[q], w.ePost);
  }
  if (w.sigV && rng) { st[2] += w.sigV * CY.randn(rng); st[3] += w.sigV * CY.randn(rng); }
  return st;
};
/* roll out T steps; actions[t] = impulse or null (missing → null).  returns array of T+1 states */
CY.rollout = function (w, s0, actions, T, rng) {
  var tr = [s0.slice()], s = s0;
  for (var t = 0; t < T; t++) { s = CY.step(w, s, actions ? actions[t] || null : null, rng); tr.push(s); }
  return tr;
};
CY.occluded = function (w, s) { return !!w.curtain && s[0] > w.curtain[0] && s[0] < w.curtain[1]; };
/* sensor reading: noisy position, or null behind the curtain */
CY.observe = function (w, s, rng) {
  if (CY.occluded(w, s)) return null;
  return [s[0] + w.sigO * CY.randn(rng), s[1] + w.sigO * CY.randn(rng)];
};
CY.inGoal = function (w, s) { return Math.hypot(s[0] - w.goal.x, s[1] - w.goal.y) < w.goal.r; };
CY.speed = function (s) { return Math.hypot(s[2], s[3]); };

/* ───────────────────────────── Kalman filter (linear Gaussian) ───────────────────────────── */
/* model: {F (n×n), H (m×n), Q (n×n), R (m×m), n, m}.  state {x (n), P (n×n)}.  Row-major Float64Array/Array. */
CY.kf = {};
CY.kf.predict = function (model, st) {
  var n = model.n, F = model.F, x = new Float64Array(n), i, j;
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) x[i] += F[i * n + j] * st.x[j];
  var FP = la.mul(F, n, n, st.P, n), P = la.mul(FP, n, n, la.T(F, n, n), n);
  for (i = 0; i < n * n; i++) P[i] += model.Q[i];
  return { x: x, P: P };
};
CY.kf.update = function (model, st, z) {
  var n = model.n, m = model.m, H = model.H, Ht = la.T(H, m, n);
  var S = la.mul(la.mul(H, m, n, st.P, n), m, n, Ht, m);
  for (var i = 0; i < m * m; i++) S[i] += model.R[i];
  var PHt = la.mul(st.P, n, n, Ht, m), K = la.solve(S, la.T(PHt, n, m), m);          // K^T = S^{-1} (P Hᵀ)ᵀ  (S symmetric)
  var Kk = la.T(K, m, n);                                                             // n×m
  var y = new Float64Array(m); for (i = 0; i < m; i++) { var hx = 0; for (var j = 0; j < n; j++) hx += H[i * n + j] * st.x[j]; y[i] = z[i] - hx; }
  var x = Float64Array.from(st.x); for (i = 0; i < n; i++) for (var k = 0; k < m; k++) x[i] += Kk[i * m + k] * y[k];
  var KH = la.mul(Kk, n, m, H, n), IKH = new Float64Array(n * n);
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) IKH[i * n + j] = (i === j ? 1 : 0) - KH[i * n + j];
  var P = la.mul(la.mul(IKH, n, n, st.P, n), n, n, la.T(IKH, n, n), n), KRKt = la.mul(la.mul(Kk, n, m, model.R, m), n, m, la.T(Kk, n, m), n);   // Joseph form
  for (i = 0; i < n * n; i++) P[i] += KRKt[i];
  return { x: x, P: P, S: S, innov: y };
};
/* free-flight model for ONE axis of the Courtyard: state [pos, vel], friction decay d = exp(−γ·dt), velocity jitter σv, sensor noise σo.
 * (A ball that does not hit anything moves independently in x and y, so two of these are a complete filter for free flight.) */
CY.kf.axisModel = function (w, sigV, sigO) {
  var d = Math.exp(-w.gamma * w.dt), dt = w.dt;
  // exact for dv/dt = −γ v : v' = d v,  p' = p + v (1−d)/γ
  var g = w.gamma > 1e-9 ? (1 - d) / w.gamma : dt;
  var qv = sigV * sigV;
  return { n: 2, m: 1, F: [1, g, 0, d], H: [1, 0], Q: [qv * g * g, qv * g, qv * g, qv], R: [sigO * sigO] };
};

/* ───────────────────────────── neural networks (tanh MLP, Adam, MDN head) ───────────────────────────── */
/* sizes = [in, h1, …, out].  Hidden layers tanh, linear output.  Xavier init from a seed. */
CY.MLP = function (sizes, seed) {
  var rng = CY.rng(seed || 1), L = sizes.length - 1;
  this.sizes = sizes; this.L = L; this.W = []; this.b = []; this.mW = []; this.vW = []; this.mb = []; this.vb = []; this.t = 0;
  for (var l = 0; l < L; l++) {
    var fi = sizes[l], fo = sizes[l + 1], sc = Math.sqrt(2 / (fi + fo)), W = new Float64Array(fi * fo);
    for (var i = 0; i < W.length; i++) W[i] = sc * CY.randn(rng);
    this.W.push(W); this.b.push(new Float64Array(fo));
    this.mW.push(new Float64Array(fi * fo)); this.vW.push(new Float64Array(fi * fo)); this.mb.push(new Float64Array(fo)); this.vb.push(new Float64Array(fo));
  }
};
var MLP = CY.MLP.prototype;
/* forward one sample; returns the activations list (acts[0] = input … acts[L] = output) */
MLP.forward = function (x) {
  var acts = [Float64Array.from(x)], L = this.L;
  for (var l = 0; l < L; l++) {
    var fi = this.sizes[l], fo = this.sizes[l + 1], a = acts[l], W = this.W[l], b = this.b[l], y = new Float64Array(fo);
    for (var j = 0; j < fo; j++) { var s = b[j]; for (var i = 0; i < fi; i++) s += a[i] * W[i * fo + j]; y[j] = l < L - 1 ? Math.tanh(s) : s; }
    acts.push(y);
  }
  return acts;
};
MLP.predict = function (x) { var a = this.forward(x); return a[this.L]; };
/* accumulate gradients of a scalar loss given dLoss/dOutput for one sample's activations.  g = {W:[...], b:[...]} */
MLP.backward = function (acts, dOut, g) {
  var L = this.L, d = Float64Array.from(dOut);
  for (var l = L - 1; l >= 0; l--) {
    var fi = this.sizes[l], fo = this.sizes[l + 1], a = acts[l], gW = g.W[l], gb = g.b[l], W = this.W[l];
    for (var j = 0; j < fo; j++) { gb[j] += d[j]; for (var i = 0; i < fi; i++) gW[i * fo + j] += a[i] * d[j]; }
    if (l > 0) {
      var nd = new Float64Array(fi);
      for (var i2 = 0; i2 < fi; i2++) { var s = 0; for (var j2 = 0; j2 < fo; j2++) s += W[i2 * fo + j2] * d[j2]; nd[i2] = s * (1 - a[i2] * a[i2]); }
      d = nd;
    }
  }
};
MLP.zeroGrad = function () { var g = { W: [], b: [] }; for (var l = 0; l < this.L; l++) { g.W.push(new Float64Array(this.W[l].length)); g.b.push(new Float64Array(this.b[l].length)); } return g; };
MLP.adam = function (g, lr, scale) {
  var b1 = 0.9, b2 = 0.999; this.t++;
  var c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), s = scale === undefined ? 1 : scale;
  for (var l = 0; l < this.L; l++) {
    var W = this.W[l], gw = g.W[l], mW = this.mW[l], vW = this.vW[l], i;
    for (i = 0; i < W.length; i++) { var gi = gw[i] * s; mW[i] = b1 * mW[i] + (1 - b1) * gi; vW[i] = b2 * vW[i] + (1 - b2) * gi * gi; W[i] -= lr * (mW[i] / c1) / (Math.sqrt(vW[i] / c2) + 1e-8); }
    var bb = this.b[l], gb = g.b[l], mb = this.mb[l], vb = this.vb[l];
    for (i = 0; i < bb.length; i++) { var gj = gb[i] * s; mb[i] = b1 * mb[i] + (1 - b1) * gj; vb[i] = b2 * vb[i] + (1 - b2) * gj * gj; bb[i] -= lr * (mb[i] / c1) / (Math.sqrt(vb[i] / c2) + 1e-8); }
  }
};
/* regression with squared error.  X: array of input arrays, Y: array of target arrays.  opts: epochs, batch, lr, seed, weights (per-sample).
 * returns the loss history (mean squared error per epoch).  */
MLP.fit = function (X, Y, opts) {
  opts = opts || {};
  var n = X.length, epochs = opts.epochs || 100, batch = Math.min(opts.batch || 32, n), lr = opts.lr || 0.01, rng = CY.rng(opts.seed || 7), hist = [];
  var idx = []; for (var i = 0; i < n; i++) idx.push(i);
  for (var ep = 0; ep < epochs; ep++) {
    CY.shuffle(idx, rng); var tot = 0;
    for (var s = 0; s < n; s += batch) {
      var g = this.zeroGrad(), cnt = Math.min(batch, n - s);
      for (var k = 0; k < cnt; k++) {
        var id = idx[s + k], acts = this.forward(X[id]), out = acts[this.L], d = new Float64Array(out.length), q;
        for (q = 0; q < out.length; q++) { var e = out[q] - Y[id][q]; d[q] = 2 * e / out.length; tot += e * e / out.length; }
        this.backward(acts, d, g);
      }
      this.adam(g, lr, 1 / cnt);
    }
    hist.push(tot / n);
  }
  return hist;
};
/* mixture-density head on a network with 3K outputs [logits(K), means(K), log-sigmas(K)] for a SCALAR target y.
 * returns NLL and fills dOut.  Also a helper to read the mixture. */
CY.mdn = {};
CY.mdn.mixture = function (out, K) {
  var mx = -1e9, k, pi = new Float64Array(K), Z = 0;
  for (k = 0; k < K; k++) if (out[k] > mx) mx = out[k];
  for (k = 0; k < K; k++) { pi[k] = Math.exp(out[k] - mx); Z += pi[k]; }
  var mu = new Float64Array(K), sg = new Float64Array(K);
  for (k = 0; k < K; k++) { pi[k] /= Z; mu[k] = out[K + k]; sg[k] = Math.exp(Math.max(-5, Math.min(2, out[2 * K + k]))); }
  return { pi: pi, mu: mu, sg: sg };
};
CY.mdn.nll = function (out, K, y, dOut) {
  var m = CY.mdn.mixture(out, K), k, p = new Float64Array(K), tot = 0;
  for (k = 0; k < K; k++) { var z = (y - m.mu[k]) / m.sg[k]; p[k] = m.pi[k] * Math.exp(-0.5 * z * z) / (m.sg[k] * Math.sqrt(2 * PI)); tot += p[k]; }
  tot = Math.max(tot, 1e-300);
  for (k = 0; k < K; k++) {
    var r = p[k] / tot, zz = (y - m.mu[k]) / m.sg[k];
    dOut[k] = m.pi[k] - r; dOut[K + k] = r * (m.mu[k] - y) / (m.sg[k] * m.sg[k]); dOut[2 * K + k] = r * (1 - zz * zz);
    if (out[2 * K + k] < -5 || out[2 * K + k] > 2) dOut[2 * K + k] = 0;
  }
  return -Math.log(tot);
};
CY.mdn.density = function (out, K, y) {
  var m = CY.mdn.mixture(out, K), tot = 0;
  for (var k = 0; k < K; k++) { var z = (y - m.mu[k]) / m.sg[k]; tot += m.pi[k] * Math.exp(-0.5 * z * z) / (m.sg[k] * Math.sqrt(2 * PI)); }
  return tot;
};
CY.mdn.sample = function (out, K, rng) {
  var m = CY.mdn.mixture(out, K), u = rng(), acc = 0, k;
  for (k = 0; k < K; k++) { acc += m.pi[k]; if (u <= acc) break; }
  if (k >= K) k = K - 1;
  return m.mu[k] + m.sg[k] * CY.randn(rng);
};
/* fit an MDN head: net.sizes[last] must be 3K.  X: inputs, Y: scalar targets. returns NLL history. */
MLP.fitMDN = function (X, Y, K, opts) {
  opts = opts || {};
  var n = X.length, epochs = opts.epochs || 100, batch = Math.min(opts.batch || 32, n), lr = opts.lr || 0.01, rng = CY.rng(opts.seed || 7), hist = [];
  var idx = []; for (var i = 0; i < n; i++) idx.push(i);
  for (var ep = 0; ep < epochs; ep++) {
    CY.shuffle(idx, rng); var tot = 0;
    for (var s = 0; s < n; s += batch) {
      var g = this.zeroGrad(), cnt = Math.min(batch, n - s);
      for (var k = 0; k < cnt; k++) {
        var id = idx[s + k], acts = this.forward(X[id]), d = new Float64Array(3 * K);
        tot += CY.mdn.nll(acts[this.L], K, Y[id], d);
        this.backward(acts, d, g);
      }
      this.adam(g, lr, 1 / cnt);
    }
    hist.push(tot / n);
  }
  return hist;
};
/* bootstrap ensemble of regressors: members trained on resampled data; predict() → {mean, std} per output dim */
CY.Ensemble = function (sizes, M, seed) { this.nets = []; for (var m = 0; m < M; m++) this.nets.push(new CY.MLP(sizes, (seed || 1) * 101 + m * 17 + 3)); };
CY.Ensemble.prototype.fit = function (X, Y, opts) {
  opts = opts || {};
  var rng = CY.rng((opts.seed || 5) + 31), n = X.length;
  for (var m = 0; m < this.nets.length; m++) {
    var Xb = [], Yb = [];
    for (var i = 0; i < n; i++) { var j = Math.floor(rng() * n); Xb.push(X[j]); Yb.push(Y[j]); }
    this.nets[m].fit(Xb, Yb, { epochs: opts.epochs, batch: opts.batch, lr: opts.lr, seed: (opts.seed || 5) + m });
  }
};
CY.Ensemble.prototype.predict = function (x) {
  var M = this.nets.length, outs = this.nets.map(function (n) { return n.predict(x); }), q = outs[0].length, mean = new Float64Array(q), std = new Float64Array(q);
  for (var k = 0; k < q; k++) { for (var m = 0; m < M; m++) mean[k] += outs[m][k] / M; for (var m2 = 0; m2 < M; m2++) std[k] += (outs[m2][k] - mean[k]) * (outs[m2][k] - mean[k]) / M; std[k] = Math.sqrt(std[k]); }
  return { mean: mean, std: std };
};

/* ───────────────────────────── planning: the cross-entropy method ───────────────────────────── */
/* minimise cost(vec) over R^dim.  opts: iters, pop, elite, mu0 (array), sd0 (array|number), seed, clip [lo,hi].  Returns {best, bestCost, mu, sd, history}. */
CY.cem = function (cost, dim, opts) {
  opts = opts || {};
  var iters = opts.iters || 6, pop = opts.pop || 60, elite = opts.elite || Math.max(3, Math.round(pop / 6)), rng = CY.rng(opts.seed || 11);
  var mu = new Float64Array(dim), sd = new Float64Array(dim), i, j, hist = [], best = null, bestCost = Infinity;
  for (j = 0; j < dim; j++) { mu[j] = opts.mu0 ? opts.mu0[j] : 0; sd[j] = typeof opts.sd0 === 'number' ? opts.sd0 : (opts.sd0 ? opts.sd0[j] : 1); }
  for (var it = 0; it < iters; it++) {
    var cands = [];
    for (i = 0; i < pop; i++) {
      var v = new Float64Array(dim);
      for (j = 0; j < dim; j++) { v[j] = mu[j] + sd[j] * CY.randn(rng); if (opts.clip) v[j] = Math.max(opts.clip[0], Math.min(opts.clip[1], v[j])); }
      cands.push({ v: v, c: cost(v) });
    }
    cands.sort(function (a, b) { return a.c - b.c; });
    if (cands[0].c < bestCost) { bestCost = cands[0].c; best = cands[0].v; }
    for (j = 0; j < dim; j++) {
      var m = 0, s2 = 0; for (i = 0; i < elite; i++) m += cands[i].v[j] / elite;
      for (i = 0; i < elite; i++) s2 += (cands[i].v[j] - m) * (cands[i].v[j] - m) / elite;
      mu[j] = m; sd[j] = Math.max(Math.sqrt(s2), opts.minSd || 1e-3);
    }
    hist.push({ iter: it, best: cands[0].c, meanElite: cands.slice(0, elite).reduce(function (a, c) { return a + c.c; }, 0) / elite });
  }
  return { best: best, bestCost: bestCost, mu: mu, sd: sd, history: hist };
};

/* ───────────────────────────── statistics helpers ───────────────────────────── */
CY.stats = {
  mean: function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; },
  std: function (a) { var m = CY.stats.mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / Math.max(1, a.length - 1)); },
  /* standard normal CDF (Abramowitz–Stegun 7.1.26 via erf) */
  ncdf: function (x) { var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2); return 0.5 * (1 + (x >= 0 ? y : -y)); },
  npdf: function (x, m, s) { var z = (x - m) / s; return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * PI)); },
  quantile: function (a, q) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.max(0, Math.floor(q * b.length)))]; }
};

/* ───────────────────────────── drawing ───────────────────────────── */
CY.C = { ink: '#20202a', mute: '#626273', dim: '#9a98aa', grid: '#e7e5ef', purple: '#6d4aff', purpleSoft: '#dcd6ff', cyan: '#0891b2', cyanSoft: '#cceef4',
         amber: '#d97706', amberSoft: '#fde7c6', green: '#15935a', greenSoft: '#d5f2e2', red: '#dc3f55', redSoft: '#f9d8df', white: '#ffffff', panel: '#f8f8fc', code: '#f2f1f7' };
CY.draw = {};
var D = CY.draw;
D.setup = function (canvas) {
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  var w = Math.max(280, canvas.clientWidth || 640), h = Math.max(120, canvas.clientHeight || 300), rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  return { ctx: ctx, w: w, h: h };
};
D.view = function (bx, by, bw, bh, x0, x1, y0, y1) {          // world (x right, y UP) → canvas
  var s = Math.min(bw / (x1 - x0), bh / (y1 - y0)), ox = bx + (bw - s * (x1 - x0)) / 2, oy = by + (bh - s * (y1 - y0)) / 2;
  return { s: s, ox: ox, oy: oy, bx: bx, by: by, bw: bw, bh: bh, X: function (x) { return ox + (x - x0) * s; }, Y: function (y) { return oy + (y1 - y) * s; },
           ix: function (px) { return x0 + (px - ox) / s; }, iy: function (py) { return y1 - (py - oy) / s; } };
};
D.line = function (ctx, x1, y1, x2, y2, color, width, dash) { ctx.save(); ctx.strokeStyle = color || CY.C.ink; ctx.lineWidth = width || 1; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore(); };
D.dot = function (ctx, x, y, r, fill, stroke) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); ctx.fillStyle = fill || CY.C.ink; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
/* Text that cannot leave the canvas: shrink the font (to 75 %, at least 7 px), then truncate with an ellipsis.  Every label in every
 * widget passes through D.text / D.mono / D.label, so narrow screens clip nothing at the canvas edge. */
D.fit = function (ctx, s, x, align, size, fontOf) {
  var cv = ctx.canvas, cw = cv && cv.clientWidth, sz = size, w, t, n, m;
  s = String(s); t = s;
  ctx.font = fontOf(sz);
  if (!cw || !ctx.measureText) return { s: s, size: sz };
  var avail = align === 'right' ? x - 2 : align === 'center' ? 2 * Math.min(x - 2, cw - 2 - x) : cw - 2 - x;
  m = ctx.measureText(s); w = m && m.width;
  if (!(w > avail)) return { s: s, size: sz };
  while (w > avail && sz > Math.max(7, size * 0.75)) { sz -= 0.5; ctx.font = fontOf(sz); m = ctx.measureText(s); w = m && m.width; }
  for (n = s.length; w > avail && n > 3; ) { n--; t = s.slice(0, n) + '\u2026'; m = ctx.measureText(t); w = m && m.width; }
  return { s: n < s.length ? t : s, size: sz };
};
D.text = function (ctx, s, x, y, color, size, align, weight) {
  var f = function (z) { return (weight || 500) + ' ' + z + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif'; }, r = D.fit(ctx, s, x, align || 'left', size || 12, f);
  ctx.fillStyle = color || CY.C.ink; ctx.font = f(r.size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.s, x, y);
};
D.mono = function (ctx, s, x, y, color, size, align) {
  var f = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; }, r = D.fit(ctx, s, x, align || 'left', size || 10, f);
  ctx.fillStyle = color || CY.C.mute; ctx.font = f(r.size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.s, x, y);
};
D.frame = function (ctx, x, y, w, h, fill, stroke) { ctx.save(); ctx.fillStyle = fill || CY.C.panel; ctx.strokeStyle = stroke || CY.C.grid; ctx.lineWidth = 1; ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.restore(); };
D.path = function (ctx, pts, color, width, dash) { if (pts.length < 2) return; ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); ctx.restore(); };
/* the arena: floor, curtain, posts, diamonds, goal.  v from D.view */
D.arena = function (ctx, v, w, o) {
  o = o || {};
  ctx.save(); ctx.fillStyle = '#fbfbfe'; ctx.fillRect(v.X(0), v.Y(w.H), w.W * v.s, w.H * v.s); ctx.strokeStyle = CY.C.dim; ctx.lineWidth = 1.5; ctx.strokeRect(v.X(0), v.Y(w.H), w.W * v.s, w.H * v.s); ctx.restore();
  if (w.goal && o.goal !== false) { ctx.save(); ctx.fillStyle = 'rgba(21,147,90,0.16)'; ctx.strokeStyle = CY.C.green; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(v.X(w.goal.x), v.Y(w.goal.y), w.goal.r * v.s, 0, 2 * PI); ctx.fill(); ctx.stroke(); ctx.restore(); }
  if (w.curtain && o.curtain !== false) { ctx.save(); ctx.fillStyle = 'rgba(98,98,115,0.20)'; ctx.fillRect(v.X(w.curtain[0]), v.Y(w.H), (w.curtain[1] - w.curtain[0]) * v.s, w.H * v.s); ctx.restore(); D.mono(ctx, 'curtain', v.X((w.curtain[0] + w.curtain[1]) / 2), v.Y(w.H) + 9, CY.C.mute, 9, 'center'); }
  w.posts.forEach(function (p) { D.dot(ctx, v.X(p.x), v.Y(p.y), p.r * v.s, '#c9c6da', CY.C.dim); });
  w.diamonds.forEach(function (d) { ctx.save(); ctx.fillStyle = '#c9c6da'; ctx.strokeStyle = CY.C.dim; ctx.beginPath(); ctx.moveTo(v.X(d.x - d.h), v.Y(d.y)); ctx.lineTo(v.X(d.x), v.Y(d.y + d.h)); ctx.lineTo(v.X(d.x + d.h), v.Y(d.y)); ctx.lineTo(v.X(d.x), v.Y(d.y - d.h)); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); });
};
/* covariance ellipse (2×2 cov of [x,y]) at (mx,my) with `k` sigmas */
D.ellipse = function (ctx, v, mx, my, c11, c12, c22, k, stroke, fill) {
  var tr = c11 + c22, det = c11 * c22 - c12 * c12, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det)), l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  var ang = Math.atan2(l1 - c11, c12 || 1e-12); if (Math.abs(c12) < 1e-14) ang = c11 >= c22 ? 0 : PI / 2;
  ctx.save(); ctx.translate(v.X(mx), v.Y(my)); ctx.rotate(-ang);
  ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, k * Math.sqrt(l1) * v.s), Math.max(1, k * Math.sqrt(l2) * v.s), 0, 0, 2 * PI);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } ctx.strokeStyle = stroke || CY.C.purple; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
};
D.plot = function (ctx, xs, ys, bx, by, bw, bh, o) {
  o = o || {};
  var xmin = o.xmin !== undefined ? o.xmin : Math.min.apply(null, xs), xmax = o.xmax !== undefined ? o.xmax : Math.max.apply(null, xs);
  var ymin = o.ymin !== undefined ? o.ymin : Math.min.apply(null, ys), ymax = o.ymax !== undefined ? o.ymax : Math.max.apply(null, ys);
  if (ymax === ymin) ymax = ymin + 1; if (xmax === xmin) xmax = xmin + 1;
  var X = function (x) { return bx + (x - xmin) / (xmax - xmin) * bw; }, Y = function (y) { return by + bh - (y - ymin) / (ymax - ymin) * bh; };
  if (!o.noframe) D.frame(ctx, bx, by, bw, bh, o.fill || CY.C.white);
  ctx.save(); ctx.strokeStyle = o.color || CY.C.purple; ctx.lineWidth = o.width || 2; ctx.setLineDash(o.dash || []); ctx.beginPath();
  for (var i = 0; i < xs.length; i++) { if (i) ctx.lineTo(X(xs[i]), Y(ys[i])); else ctx.moveTo(X(xs[i]), Y(ys[i])); }
  ctx.stroke(); ctx.restore();
  return { X: X, Y: Y };
};

/* ───────────────────────────── scenes and launchers (shared by several lessons) ───────────────────────────── */
/* CY.launch: a launcher fires the ball from the left wall with a speed and angle the agent does not choose.  Returns s0 = [x,y,vx,vy].
 * o: x (0.5), speed [lo,hi] (default 2.0–3.0 m/s), spread (total angular range in rad, 0.6), y [lo,hi] (default 1–4 m).  Draw order of rng(): speed, angle, y. */
CY.launch = function (w, rng, o) {
  o = o || {};
  var sp = o.speed ? o.speed[0] + (o.speed[1] - o.speed[0]) * rng() : 2.0 + rng();
  var th = (o.spread === undefined ? 0.6 : o.spread) * (rng() - 0.5);
  var y0 = o.y ? o.y[0] + (o.y[1] - o.y[0]) * rng() : 1 + 3 * rng();
  return [o.x === undefined ? 0.5 : o.x, y0, sp * Math.cos(th), sp * Math.sin(th)];
};
CY.scenes = {
  /* the plain Courtyard */
  plain: function (o) { return CY.world(o); },
  /* the fork: a diamond post (half-diagonal 0.6, left vertex at x = 3.8) just after the curtain; a ball arriving at its left vertex slides up or down the face
   * depending on which side of the vertex it arrives (a lateral difference of a few centimetres); posts are soft (ePost 0.1) so it slides instead of rebounding. */
  fork: function (o) {
    var base = { diamonds: [{ x: 4.4, y: 2.5, h: 0.6 }], ePost: 0.1 }, k;
    o = o || {}; for (k in o) base[k] = o[k];
    return CY.world(base);
  }
};
/* CY.forkLaunch: aimed at the fork's left vertex with a hidden lateral aim error b ~ N(0, aim²) (default aim 0.15 m) and speed 2.3–2.5 m/s. */
CY.forkLaunch = function (rng, aim) {
  var b = (aim === undefined ? 0.15 : aim) * CY.randn(rng);
  return [0.5, 2.5 + b, 2.3 + 0.2 * rng(), 0];
};

/* ───────────────────────────── k-means (a codebook) ───────────────────────────── */
/* X: array of equal-length arrays.  k-means++ seeding, Lloyd iterations.  Returns {centers (K arrays), assign (Int32Array), inertia}. */
CY.kmeans = function (X, K, o) {
  o = o || {};
  var rng = CY.rng(o.seed || 3), n = X.length, d = X[0].length, iters = o.iters || 25, i, k, j;
  var d2 = function (a, b) { var s = 0; for (var q = 0; q < d; q++) { var t = a[q] - b[q]; s += t * t; } return s; };
  var centers = [Float64Array.from(X[Math.floor(rng() * n)])], dist = new Float64Array(n).fill(Infinity);
  while (centers.length < K) {
    var last = centers[centers.length - 1], tot = 0;
    for (i = 0; i < n; i++) { var dd = d2(X[i], last); if (dd < dist[i]) dist[i] = dd; tot += dist[i]; }
    var r = rng() * tot, acc = 0, pick = n - 1;
    for (i = 0; i < n; i++) { acc += dist[i]; if (acc >= r) { pick = i; break; } }
    centers.push(Float64Array.from(X[pick]));
  }
  var assign = new Int32Array(n), inertia = 0;
  for (var it = 0; it < iters; it++) {
    inertia = 0;
    for (i = 0; i < n; i++) { var best = 0, bd = Infinity; for (k = 0; k < K; k++) { var e = d2(X[i], centers[k]); if (e < bd) { bd = e; best = k; } } assign[i] = best; inertia += bd; }
    var sum = [], cnt = new Int32Array(K);
    for (k = 0; k < K; k++) sum.push(new Float64Array(d));
    for (i = 0; i < n; i++) { cnt[assign[i]]++; for (j = 0; j < d; j++) sum[assign[i]][j] += X[i][j]; }
    for (k = 0; k < K; k++) {
      if (cnt[k] === 0) { var far = 0, fd = -1; for (i = 0; i < n; i++) { var e2 = d2(X[i], centers[assign[i]]); if (e2 > fd) { fd = e2; far = i; } } centers[k] = Float64Array.from(X[far]); }
      else for (j = 0; j < d; j++) centers[k][j] = sum[k][j] / cnt[k];
    }
  }
  return { centers: centers, assign: assign, inertia: inertia };
};
CY.kmeans.nearest = function (centers, x) {
  var best = 0, bd = Infinity;
  for (var k = 0; k < centers.length; k++) { var s = 0; for (var q = 0; q < x.length; q++) { var t = x[q] - centers[k][q]; s += t * t; } if (s < bd) { bd = s; best = k; } }
  return best;
};

/* ───────────────────────────── a recurrent network with backpropagation through time ───────────────────────────── */
/* Elman network: h_t = tanh(Wx·x_t + Wh·h_{t−1} + bh),  y_t = Wy·h_t + by.   A sequence is {x: [[…] per step], y: [[…] per step], m: [0|1 per step] (optional loss mask)}.
 * loss = Σ_t m_t · mean_k (y_tk − target_tk)²; fit() returns the mean loss per masked step for every epoch.  Adam, global-norm gradient clipping. */
CY.RNN = function (nIn, nHid, nOut, seed) {
  var rng = CY.rng(seed || 1);
  var mat = function (r, c, sc) { var M = new Float64Array(r * c); for (var k = 0; k < M.length; k++) M[k] = sc * CY.randn(rng); return M; };
  this.nIn = nIn; this.nHid = nHid; this.nOut = nOut; this.t = 0;
  this.Wx = mat(nIn, nHid, Math.sqrt(1 / nIn)); this.Wh = mat(nHid, nHid, 0.7 / Math.sqrt(nHid)); this.bh = new Float64Array(nHid);
  this.Wy = mat(nHid, nOut, Math.sqrt(1 / nHid)); this.by = new Float64Array(nOut);
  this.names = ['Wx', 'Wh', 'bh', 'Wy', 'by']; this.mom = {}; this.vel = {};
  for (var q = 0; q < this.names.length; q++) { this.mom[this.names[q]] = new Float64Array(this[this.names[q]].length); this.vel[this.names[q]] = new Float64Array(this[this.names[q]].length); }
};
var RNN = CY.RNN.prototype;
RNN.zeros = function () { return new Float64Array(this.nHid); };
/* one step from hidden state h with input x → {h, y} */
RNN.step = function (h, x) {
  var nI = this.nIn, nH = this.nHid, nO = this.nOut, hn = new Float64Array(nH), y = new Float64Array(nO), i, j;
  for (j = 0; j < nH; j++) {
    var s = this.bh[j];
    for (i = 0; i < nI; i++) s += x[i] * this.Wx[i * nH + j];
    for (i = 0; i < nH; i++) s += h[i] * this.Wh[i * nH + j];
    hn[j] = Math.tanh(s);
  }
  for (j = 0; j < nO; j++) { var o = this.by[j]; for (i = 0; i < nH; i++) o += hn[i] * this.Wy[i * nO + j]; y[j] = o; }
  return { h: hn, y: y };
};
/* run a whole input sequence; hs[0] = h0 (zeros by default), hs[t+1] = hidden after step t */
RNN.run = function (xs, h0) {
  var hs = [h0 ? Float64Array.from(h0) : this.zeros()], ys = [];
  for (var t = 0; t < xs.length; t++) { var r = this.step(hs[t], xs[t]); hs.push(r.h); ys.push(r.y); }
  return { hs: hs, ys: ys };
};
RNN.zeroGrad = function () { var g = {}; for (var q = 0; q < this.names.length; q++) g[this.names[q]] = new Float64Array(this[this.names[q]].length); return g; };
/* accumulate the gradient of the sequence loss into g; returns {loss, count} (count = number of masked-in steps) */
RNN.backward = function (seq, run, g) {
  var T = seq.x.length, nI = this.nIn, nH = this.nHid, nO = this.nOut, dhn = new Float64Array(nH), loss = 0, count = 0, t, i, j;
  for (t = T - 1; t >= 0; t--) {
    var h = run.hs[t + 1], hp = run.hs[t], x = seq.x[t], da = new Float64Array(nH), dh = Float64Array.from(dhn), mk = seq.m ? seq.m[t] : 1;
    if (mk) {
      count++;
      for (j = 0; j < nO; j++) {
        var e = run.ys[t][j] - seq.y[t][j], dy = 2 * e / nO * mk; loss += mk * e * e / nO;
        g.by[j] += dy;
        for (i = 0; i < nH; i++) { g.Wy[i * nO + j] += h[i] * dy; dh[i] += this.Wy[i * nO + j] * dy; }
      }
    }
    for (i = 0; i < nH; i++) da[i] = dh[i] * (1 - h[i] * h[i]);
    for (j = 0; j < nH; j++) {
      g.bh[j] += da[j];
      for (i = 0; i < nI; i++) g.Wx[i * nH + j] += x[i] * da[j];
      for (i = 0; i < nH; i++) g.Wh[i * nH + j] += hp[i] * da[j];
    }
    for (i = 0; i < nH; i++) { var s = 0; for (j = 0; j < nH; j++) s += this.Wh[i * nH + j] * da[j]; dhn[i] = s; }
  }
  return { loss: loss, count: count };
};
RNN.adam = function (g, lr, scale, clip) {
  var b1 = 0.9, b2 = 0.999, q, i, nm = 0; this.t++;
  for (q = 0; q < this.names.length; q++) { var gq = g[this.names[q]]; for (i = 0; i < gq.length; i++) nm += gq[i] * scale * gq[i] * scale; }
  nm = Math.sqrt(nm); var cs = clip && nm > clip ? clip / nm : 1;
  var c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
  for (q = 0; q < this.names.length; q++) {
    var name = this.names[q], P = this[name], G = g[name], M = this.mom[name], V = this.vel[name];
    for (i = 0; i < P.length; i++) { var gi = G[i] * scale * cs; M[i] = b1 * M[i] + (1 - b1) * gi; V[i] = b2 * V[i] + (1 - b2) * gi * gi; P[i] -= lr * (M[i] / c1) / (Math.sqrt(V[i] / c2) + 1e-8); }
  }
  return nm;
};
/* opts: epochs, batch (sequences per update), lr, seed, clip (5) */
RNN.fit = function (seqs, opts) {
  opts = opts || {};
  var n = seqs.length, epochs = opts.epochs || 50, batch = Math.min(opts.batch || 16, n), lr = opts.lr || 0.01, rng = CY.rng(opts.seed || 7), hist = [], idx = [], i;
  for (i = 0; i < n; i++) idx.push(i);
  for (var ep = 0; ep < epochs; ep++) {
    CY.shuffle(idx, rng); var tot = 0, cnt = 0;
    for (var s = 0; s < n; s += batch) {
      var g = this.zeroGrad(), m = Math.min(batch, n - s), steps = 0;
      for (var k = 0; k < m; k++) { var sq = seqs[idx[s + k]], r = this.run(sq.x), b = this.backward(sq, r, g); tot += b.loss; cnt += b.count; steps += b.count; }
      this.adam(g, lr, 1 / Math.max(1, steps), opts.clip === undefined ? 5 : opts.clip);
    }
    hist.push(tot / Math.max(1, cnt));
  }
  return hist;
};

/* ───────────────────────────── pictures of the Courtyard (the observation, when the observation is an image) ───────────────────────────── */
CY.img = {};
/* A grayscale picture of the world with the ball in state s: Float32Array(w·h), row 0 = TOP of the arena (y = H).
 * o: w,h pixels (default 24×15, i.e. 3 px/m); sigma (ball blur in px, 0.8); ball (peak brightness of the ball blob, 0.8); floor (0.18); gain (global brightness, 1);
 *    curtainDim (0.45: the curtain darkens the floor, and the ball is NOT drawn while it is behind it unless o.seeThrough);
 *    band {cx, width, amp}: a soft vertical band of extra brightness (a "cloud shadow"/glare: pure nuisance); noise (σ of additive pixel noise, needs o.rng).
 * Layers: floor, goal disc (+0.12), posts and diamonds (0.55), curtain, ball blob, band, gain, noise.  Values are not clipped. */
CY.img.render = function (w, s, o) {
  o = o || {};
  var pw = o.w || 24, ph = o.h || 15, ppm = pw / w.W, out = new Float32Array(pw * ph), sig = o.sigma || 0.8, i, j, q;
  var floor = o.floor === undefined ? 0.18 : o.floor, peak = o.ball === undefined ? 0.8 : o.ball, gain = o.gain === undefined ? 1 : o.gain;
  var hidden = !o.seeThrough && CY.occluded(w, s), bx = s[0] * ppm, by = (w.H - s[1]) * ppm, dim = o.curtainDim === undefined ? 0.45 : o.curtainDim;
  for (j = 0; j < ph; j++) for (i = 0; i < pw; i++) {
    var X = (i + 0.5) / ppm, Y = w.H - (j + 0.5) / ppm, v = floor;
    if (w.goal && Math.hypot(X - w.goal.x, Y - w.goal.y) < w.goal.r) v += 0.12;
    for (q = 0; q < w.posts.length; q++) if (Math.hypot(X - w.posts[q].x, Y - w.posts[q].y) < w.posts[q].r) v = 0.55;
    for (q = 0; q < w.diamonds.length; q++) if (Math.abs(X - w.diamonds[q].x) + Math.abs(Y - w.diamonds[q].y) <= w.diamonds[q].h) v = 0.55;
    if (w.curtain && X > w.curtain[0] && X < w.curtain[1]) v *= 1 - dim;
    if (!hidden) { var dx = i + 0.5 - bx, dy = j + 0.5 - by; v += peak * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); }
    if (o.band) v += o.band.amp * Math.exp(-(X - o.band.cx) * (X - o.band.cx) / (2 * o.band.width * o.band.width));
    v *= gain; if (o.noise) v += o.noise * CY.randn(o.rng);
    out[j * pw + i] = v;
  }
  return out;
};

/* ───────────────────────────── more drawing helpers ───────────────────────────── */
D.label = function (ctx, s, x, y, color, size, align) {          // mono text with a white halo so it stays legible over plots
  var f = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; }, r = D.fit(ctx, s, x, align || 'left', size || 10, f);
  ctx.save(); ctx.font = f(r.size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(r.s, x, y); ctx.fillStyle = color || CY.C.mute; ctx.fillText(r.s, x, y); ctx.restore();
};
D.arrow = function (ctx, x1, y1, x2, y2, color, width, head) {
  var a = Math.atan2(y2 - y1, x2 - x1), hd = head || 6; ctx.save(); ctx.strokeStyle = color || CY.C.ink; ctx.fillStyle = color || CY.C.ink; ctx.lineWidth = width || 1.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hd * Math.cos(a - 0.45), y2 - hd * Math.sin(a - 0.45)); ctx.lineTo(x2 - hd * Math.cos(a + 0.45), y2 - hd * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill(); ctx.restore();
};
/* histogram of vals over [lo,hi] in nb bins, drawn as bars in the box (bx,by,bw,bh).  o: color, fill (frame fill), ymax (counts at full height), noframe.
 * Returns {counts, X (value→px), Y (count→px), ymax}. */
D.hist = function (ctx, vals, lo, hi, nb, bx, by, bw, bh, o) {
  o = o || {};
  var counts = new Float64Array(nb), i, mx = 0;
  for (i = 0; i < vals.length; i++) { var b = Math.floor((vals[i] - lo) / (hi - lo) * nb); if (b >= 0 && b < nb) counts[b]++; }
  for (i = 0; i < nb; i++) mx = Math.max(mx, counts[i]);
  var ymax = o.ymax || Math.max(1, mx), X = function (v) { return bx + (v - lo) / (hi - lo) * bw; }, Y = function (c) { return by + bh - c / ymax * bh; };
  if (!o.noframe) D.frame(ctx, bx, by, bw, bh, o.fill || CY.C.white);
  ctx.save(); ctx.fillStyle = o.color || CY.C.purpleSoft; ctx.strokeStyle = o.stroke || CY.C.purple; ctx.lineWidth = 1;
  for (i = 0; i < nb; i++) { var x0 = bx + i / nb * bw, hh = counts[i] / ymax * bh; if (hh > 0) { ctx.fillRect(x0 + 0.5, by + bh - hh, bw / nb - 1, hh); ctx.strokeRect(x0 + 0.5, by + bh - hh, bw / nb - 1, hh); } }
  ctx.restore();
  return { counts: counts, X: X, Y: Y, ymax: ymax };
};
/* a small raster image: a (iw·ih numbers, row-major, row 0 on top) drawn into (x,y,w,h) with crisp pixels.  o: vmin, vmax, map 'gray' | 'heat' | 'diverge'. */
D.image = function (ctx, a, iw, ih, x, y, w, h, o) {
  o = o || {};
  var vmin = o.vmin === undefined ? 0 : o.vmin, vmax = o.vmax === undefined ? 1 : o.vmax, map = o.map || 'gray', pw = w / iw, ph = h / ih;
  ctx.save();
  for (var j = 0; j < ih; j++) for (var i = 0; i < iw; i++) {
    var t = Math.max(0, Math.min(1, (a[j * iw + i] - vmin) / (vmax - vmin || 1)), 0), c;
    if (map === 'heat') { c = 'rgb(' + Math.round(255 * Math.min(1, 2 * t)) + ',' + Math.round(255 * Math.max(0, Math.min(1, 2 * t - 0.6))) + ',' + Math.round(60 * (1 - t)) + ')'; }
    else if (map === 'diverge') { c = t < 0.5 ? 'rgb(' + Math.round(80 + 175 * t * 2) + ',' + Math.round(110 + 145 * t * 2) + ',255)' : 'rgb(255,' + Math.round(255 - 175 * (t - 0.5) * 2) + ',' + Math.round(255 - 200 * (t - 0.5) * 2) + ')'; }
    else { var g = Math.round(255 * t); c = 'rgb(' + g + ',' + g + ',' + g + ')'; }
    ctx.fillStyle = c; ctx.fillRect(x + i * pw, y + j * ph, Math.ceil(pw), Math.ceil(ph));
  }
  ctx.strokeStyle = CY.C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.restore();
};

root.CY = CY;
if (typeof module !== 'undefined' && module.exports) module.exports = CY;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
