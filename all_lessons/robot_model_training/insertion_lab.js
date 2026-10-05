/* insertion_lab.js — lesson 10's private engine: a peg, a chamfered hole, an arm that holds a position or yields to a force.
 *
 * Everything is one planar point, the peg's axis, in the frame of the hole (millimetres, newtons, seconds).  x is sideways (0 = the axis of the hole), z is height
 * (0 = the rim, up is positive; the peg is in once z reaches -Z).  A peg of width W in a hole of width W + c has c/2 of slack on each side, so in this frame the
 * hole is a bore of half-width h0 = c/2 with a 30 degree chamfer b millimetres wide at its mouth: the peg can drop only while |x| <= h0.
 *   contact  a penalty spring of stiffness kc along the normal of the nearest face of the funnel, plus Coulomb friction mu (regularised at low speed)
 *   arm      the tip is pulled to a commanded target by a spring of stiffness K (the tracker of lesson 6) through a damper cd, so velocity = force / cd
 *   policy   every dt = 0.05 s it reads what it can sense and moves the target by u dt; the force sensor sees the contact force plus noise
 *   world    the hole is where the camera and the arm's repeatability put it: a sideways error e0 ~ N(0, sigma_pose^2) that no sensor of the policy can see,
 *            and a sideways load FL ~ N(0, sigma_load^2) on the tip (a cable, a tool that is not balanced)
 * An attempt ends when the peg is in, when the contact force passes the protective stop Flim (a jam) or when the time is up.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var IL = {};

IL.P = {
  dt: 0.05, ns: 5, cd: 10,                     // control step (s), physics substeps per step, tip damping (N s/mm)
  K: 100, kc: 1000,                            // arm tracker stiffness and contact stiffness (N/mm)
  mu: 0.15, slope: Math.tan(Math.PI / 6), b: 1.0,   // friction, chamfer slope (30 degrees), chamfer width (mm)
  Flim: 20, Z: 4, z0: 2, v: 1, T: 30,        // protective stop (N), insertion depth (mm), start height (mm), approach speed (mm/s), time allowed (s)
  vreg: 1,                                     // speed (mm/s) above which friction is fully developed
  sigmaCam: 0.5, sigmaArm: 0.3, sigmaLoad: 5, sigmaF: 0.15,   // camera error, arm repeatability (mm), sideways load (N), force-sensor noise (N)
  Fpush: 10, fdead: 0.4, Cx: 0.35              // the yielding policy: push force (N), force dead band (N), sideways admittance (mm/s per N)
};
IL.P.Cz = IL.P.v / IL.P.Fpush;                 // vertical admittance (mm/s per N): the approach speed when nothing pushes back
IL.poseSigma = function () { var P = IL.P; return Math.sqrt(P.sigmaCam * P.sigmaCam + P.sigmaArm * P.sigmaArm); };

IL.world = function (c, o) {
  var P = IL.P, W = { c: c, h0: c / 2, b: P.b, slope: P.slope, mu: P.mu, kc: P.kc, Flim: P.Flim, Z: P.Z };
  if (o) for (var k in o) W[k] = o[k];
  W.w = W.h0 + W.b; W.s0 = -W.slope * W.b;     // the chamfer runs from (w, 0) on the rim down to (h0, s0) at the lip of the bore
  return W;
};

/* force of the funnel on the tip at (x, z) moving at (vx, vz): [fx, fz, normal force] */
IL.contact = function (W, x, z, vx, vz) {
  var sg = x < 0 ? -1 : 1, u = sg * x, vu = sg * vx;
  if (u <= W.h0) return [0, 0, 0];
  var Su = u >= W.w ? 0 : -W.slope * (W.w - u);
  if (z >= Su) return [0, 0, 0];
  var best = Infinity, cu = 0, cz = 0, a, b2, t, d;
  a = u >= W.w ? u : W.w; d = (a - u) * (a - u) + z * z;                          // the flat top beyond the chamfer
  best = d; cu = a; cz = 0;
  b2 = W.b * W.b * (1 + W.slope * W.slope);                                        // the chamfer from (w, 0) to (h0, s0)
  t = ((u - W.w) * (-W.b) + z * (-W.slope * W.b)) / b2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  a = W.w - t * W.b; var g = -t * W.slope * W.b; d = (a - u) * (a - u) + (g - z) * (g - z);
  if (d < best) { best = d; cu = a; cz = g; }
  g = z < W.s0 ? z : W.s0; d = (W.h0 - u) * (W.h0 - u) + (g - z) * (g - z);       // the wall of the bore
  if (d < best) { best = d; cu = W.h0; cz = g; }
  var dist = Math.sqrt(best), nu = dist > 1e-12 ? (cu - u) / dist : 0, nz = dist > 1e-12 ? (cz - z) / dist : 1, N = W.kc * dist;
  var tu = -nz, tz = nu, vt = vu * tu + vz * tz, f = -W.mu * N * Math.tanh(vt / IL.P.vreg);
  return [sg * (N * nu + f * tu), N * nz + f * tz, N];
};

/* the behaviours of the lesson.  A policy is {K, act(obs)}; obs = {t, z, d, fx, fz}: step, tip height, how far the target has been moved sideways, sensed force */
IL.stiff = function () { return { K: IL.P.K, act: function () { return [0, -IL.P.v]; } }; };
IL.soft = function (K) { return { K: K, act: function () { return [0, -IL.P.v]; } }; };
IL.dead = function (f, d) { return Math.abs(f) < d ? 0 : f - (f > 0 ? d : -d); };
IL.yielding = function () {
  var P = IL.P;
  return { K: P.K, act: function (ob) {
    var uz = -P.Cz * (P.Fpush - ob.fz); uz = uz > P.v ? P.v : uz < -P.v ? -P.v : uz;
    return [P.Cx * IL.dead(ob.fx, P.fdead), uz];
  } };
};

/* one attempt; returns the outcome and (if o.keep) the traces.  o: e0, FL (the hole's errors), Kscale (the arm and the part are this much stiffer), T */
IL.rollout = function (W, pol, rng, o) {
  o = o || {}; var P = IL.P, dt = P.dt, ns = P.ns, h = dt / ns, a = h / P.cd, nT = Math.round((o.T || P.T) / dt), Kt = pol.K * (o.Kscale || 1);
  var e0 = o.e0 === undefined ? IL.poseSigma() * BN.randn(rng) : o.e0, FL = o.FL === undefined ? P.sigmaLoad * BN.randn(rng) : o.FL;
  var x = e0, z = P.z0, vx = 0, vz = 0, xc = 0, zc = P.z0, fx = 0, fz = 0, peak = 0, out = 'timeout', steps = nT;
  var tr = o.keep ? { X: [], Z: [], FX: [], FZ: [], D: [], U: [], F: [] } : null;
  for (var t = 0; t < nT; t++) {
    var u = pol.act({ t: t, z: z, d: xc, fx: fx, fz: fz });
    if (tr) { tr.X.push(x); tr.Z.push(z); tr.FX.push(fx); tr.FZ.push(fz); tr.D.push(xc); tr.U.push(u); }
    xc += u[0] * dt; zc += u[1] * dt;
    var cx = 0, cz = 0;
    for (var s = 0; s < ns; s++) {
      var c = IL.contact(W, x, z, vx, vz); cx = c[0]; cz = c[1];
      var x1 = (x + a * (Kt * (e0 + xc) + FL + cx)) / (1 + a * Kt), z1 = (z + a * (Kt * zc + cz)) / (1 + a * Kt);   // the spring of the arm is taken implicitly
      vx = (x1 - x) / h; vz = (z1 - z) / h; x = x1; z = z1;
    }
    var F = Math.sqrt(cx * cx + cz * cz); if (F > peak) peak = F;
    if (tr) tr.F.push(F);
    fx = cx + P.sigmaF * BN.randn(rng); fz = cz + P.sigmaF * BN.randn(rng);
    if (F > W.Flim) { out = 'jam'; steps = t + 1; break; }
    if (z <= -W.Z) { out = 'in'; steps = t + 1; break; }
  }
  var r = { out: out, steps: steps, time: steps * dt, peak: peak, e0: e0, FL: FL, x: x, z: z };
  if (tr) r.tr = tr;
  return r;
};

/* N attempts at clearance c; policyFor(k) returns the policy of attempt k.  The hole errors (e0, FL) of attempt k come from their own random stream, so every
 * policy meets the same N holes; o.keep = true (or a count) keeps the traces of the attempts; o.load scales the sideways load */
IL.evaluate = function (W, policyFor, N, seed, o) {
  o = o || {}; var P = IL.P, rh = BN.rng(seed), rn = BN.rng(seed + 7919), sg = IL.poseSigma(), n = { in: 0, jam: 0, timeout: 0 }, tSum = 0, pSum = 0, aSum = 0, rolls = [], k;
  for (k = 0; k < N; k++) {
    var e0 = sg * BN.randn(rh), FL = P.sigmaLoad * (o.load === undefined ? 1 : o.load) * BN.randn(rh);
    var r = IL.rollout(W, policyFor(k), rn, { e0: e0, FL: FL, Kscale: o.Kscale, T: o.T, keep: o.keep === true || k < (o.keep || 0) });
    n[r.out]++; pSum += r.peak; aSum += r.time; if (r.out === 'in') tSum += r.time; rolls.push(r);
  }
  return { N: N, succ: n.in / N, jam: n.jam / N, timeout: n.timeout / N, ci: BN.stats.wilson(n.in, N), peak: pSum / N, time: n.in ? tSum / n.in : NaN, attempt: aSum / N, rolls: rolls };
};

/* demonstrations: the yielding policy attempts m holes (with the force channels recorded); the frames kept for learning are the (observation, action) pairs,
 * thinned so that a frame is kept only once the observation has moved half a bandwidth since the last kept one */
IL.demos = function (W, m, seed) { return IL.evaluate(W, function () { return IL.yielding(); }, m, seed, { keep: true }).rolls; };
IL.HC = { pos: [1.5, 1.0], force: [1.5, 1.0, 0.6, 1.5] };      // kernel bandwidths: (z mm, d mm) and (z, d, fx N, fz N)
IL.frames = function (rolls, withForce) {
  var X = [], Y = [], last;
  rolls.forEach(function (r) {
    last = null;
    for (var t = 0; t < r.tr.X.length; t++) {
      var ob = [r.tr.Z[t], r.tr.D[t]]; if (withForce) ob.push(r.tr.FX[t], r.tr.FZ[t]);
      var bw = withForce ? IL.HC.force : IL.HC.pos, far = !last;
      for (var j = 0; j < ob.length && !far; j++) if (Math.abs(ob[j] - last[j]) > 0.5 * bw[j]) far = true;
      if (far) { X.push(ob); Y.push(r.tr.U[t]); last = ob; }
    }
  });
  return { X: X, Y: Y };
};
/* the nearest-demo learner of lesson 1 over a few numbers: the kernel-weighted mean of the stored actions, weights exp(-e/2) with e = sum of ((x - xi)/h)^2,
 * zero beyond e = 9 (three bandwidths); a query with nothing that near gets the action of the single nearest stored frame */
IL.Kernel = function (h) { this.h = h; this.X = []; this.Y = []; };
IL.Kernel.prototype.add = function (x, y) { this.X.push(x); this.Y.push(y); };
IL.Kernel.prototype.predict = function (x) {
  var n = this.X.length, d = this.h.length, s0 = 0, s1 = 0, tot = 0, best = Infinity, bi = 0, i, j;
  for (i = 0; i < n; i++) {
    var xi = this.X[i], e = 0;
    for (j = 0; j < d; j++) { var z = (xi[j] - x[j]) / this.h[j]; e += z * z; }
    if (e < best) { best = e; bi = i; }
    if (e <= 9) { var w = Math.exp(-0.5 * e); tot += w; s0 += w * this.Y[i][0]; s1 += w * this.Y[i][1]; }
  }
  return tot < 1e-12 ? this.Y[bi].slice() : [s0 / tot, s1 / tot];
};
IL.clone = function (frames, withForce) {
  var nw = new IL.Kernel(withForce ? IL.HC.force : IL.HC.pos);
  for (var i = 0; i < frames.X.length; i++) nw.add(frames.X[i], frames.Y[i]);
  return { K: IL.P.K, nw: nw, act: function (ob) { return nw.predict(withForce ? [ob.z, ob.d, ob.fx, ob.fz] : [ob.z, ob.d]); } };
};

/* closed forms the lesson derives */
IL.erf = function (x) { return 2 * BN.stats.ncdf(x * Math.SQRT2) - 1; };
IL.share = function (half, sigma) { return IL.erf(half / (sigma * Math.SQRT2)); };            // P(|e| < half) for e ~ N(0, sigma^2)
IL.give = function (K, mu) {                                                                   // sideways give of an arm of stiffness K at the protective stop (mm)
  var P = IL.P, m = mu === undefined ? P.mu : mu, n = Math.sqrt(1 + P.slope * P.slope);
  return P.Flim * (P.slope / n - m / n) / K;
};
IL.series = function (W, K) {                                                                  // arm and contact in series, along the vertical (N/mm)
  var P = IL.P, kz = W.kc / (1 + P.slope * P.slope), k = K === undefined ? P.K : K; return k * kz / (k + kz);
};

root.IL = IL;
if (typeof module !== 'undefined' && module.exports) module.exports = IL;
})(typeof window !== 'undefined' ? window : globalThis);
