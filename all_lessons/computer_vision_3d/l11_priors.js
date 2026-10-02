/* l11_priors.js — private engine of 3D lesson 11, "When the views run out: learning across scenes".
 *
 * The toy (FL.shape): a star-shaped object has radius R(phi) = 1 + sum_{k<=5} (a_k cos k phi + b_k sin k phi), theta in R^10, in units of
 * the object's mean radius (1.15 m for the statue: CM = 115 turns a radius error into centimetres).  A depth camera at azimuth alpha reads
 * R in NPIX = 9 directions spread over the arc it faces, |phi - alpha| <= HALF = 50 degrees.  With r = y - 1 the readings are LINEAR in theta:
 *        r = A theta + n,      n ~ N(0, sigma^2 I),      A = rows (cos phi, sin phi, cos 2phi, ...).
 * A prior theta ~ N(mu, Lam) then gives a Gaussian posterior in closed form:
 *        P = Lam^-1 + A'A/sigma^2,   S = P^-1,   m = m0 + K r,   K = S A'/sigma^2,   m0 = S Lam^-1 mu.
 * Probes: 72 directions, 5 degrees apart; a probe is "seen" when some camera's arc contains it.  Everything is deterministic (FL.rng).
 * L11.draw(canvas, scene) paints the widget (browser only; the page script only wires controls and readouts).
 * Global L11; module.exports under node.  Needs flatland.js (FL.shape).
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require !== 'undefined' ? require('./flatland.js') : null);
var SH = FL.shape, D = SH.dim, PI = Math.PI;
var L11 = { D: D, HALF: 50 * PI / 180, NPIX: 9, CM: 115, NPROBE: 72, NCAL: 1000, SEED_CAL: 2024, SEED_DRAW: 500, SEED_SAMPLE: 900 };

L11.probes = [];
for (var q = 0; q < L11.NPROBE; q++) L11.probes.push(-PI + 2 * PI * (q + 0.5) / L11.NPROBE);
L11.H = SH.design(L11.probes);

/* camera azimuths: 'walk' = V cameras 30 degrees apart on one side; 'around' = V cameras evenly round the ring */
L11.alphas = function (V, path) {
  var a = [];
  for (var k = 0; k < V; k++) a.push(path === 'around' ? 2 * PI * k / V : k * PI / 6);
  return a;
};
L11.angles = function (alphas) {
  var p = [];
  alphas.forEach(function (a) { SH.arc(a, L11.NPIX, L11.HALF).forEach(function (x) { p.push(x); }); });
  return p;
};
L11.seen = function (alphas) { return L11.probes.map(function (p) { return SH.seen(p, alphas, L11.HALF); }); };

/* the three priors of the lesson; LamInv cached.  none: N(0, I) on every harmonic; smooth: sd 0.12/k; learned: mean and covariance of 400 objects */
L11.makePriors = function () {
  var out = { none: SH.prior('broad'), smooth: SH.prior('smooth', { s0: 0.12, p: 1 }), learned: SH.prior('learned') };
  for (var k in out) out[k].LamInv = SH.minv(out[k].Lam, D);
  return out;
};

L11.fit = function (phis, sigma, prior) {
  var m = phis.length, A = SH.design(phis), At = SH.mT(A, m, D), P = SH.mmul(At, D, m, A, D), s2 = sigma * sigma, i;
  for (i = 0; i < D * D; i++) P[i] = prior.LamInv[i] + P[i] / s2;
  var S = SH.minv(P, D), K = SH.mmul(S, D, D, At, m);
  for (i = 0; i < K.length; i++) K[i] /= s2;
  var m0 = SH.mmul(S, D, D, SH.mmul(prior.LamInv, D, D, prior.mu, 1), 1);
  return { m: m, A: A, S: S, K: K, m0: m0 };
};
L11.mean = function (fit, r) {
  var out = Float64Array.from(fit.m0), i, j;
  for (i = 0; i < D; i++) for (j = 0; j < fit.m; j++) out[i] += fit.K[i * fit.m + j] * r[j];
  return out;
};
/* posterior standard deviation of R at each probe: sqrt(h' S h) */
L11.std = function (fit) {
  var H = L11.H, S = fit.S, out = new Float64Array(L11.NPROBE), j, i, k;
  for (j = 0; j < L11.NPROBE; j++) {
    var v = 0;
    for (i = 0; i < D; i++) for (k = 0; k < D; k++) v += H[j * D + i] * S[i * D + k] * H[j * D + k];
    out[j] = Math.sqrt(Math.max(v, 0));
  }
  return out;
};
L11.radius = function (theta) {
  var out = new Float64Array(L11.NPROBE), j, i;
  for (j = 0; j < L11.NPROBE; j++) { var v = 1; for (i = 0; i < D; i++) v += L11.H[j * D + i] * theta[i]; out[j] = v; }
  return out;
};

/* singular values of A (descending): eigenvalues of A'A by cyclic Jacobi rotations */
L11.singular = function (A, m) {
  var a = new Float64Array(D * D), i, j, r, p, qq, k;
  for (i = 0; i < D; i++) for (j = 0; j < D; j++) { var s = 0; for (r = 0; r < m; r++) s += A[r * D + i] * A[r * D + j]; a[i * D + j] = s; }
  for (var sweep = 0; sweep < 60; sweep++) {
    var off = 0;
    for (i = 0; i < D; i++) for (j = i + 1; j < D; j++) off += a[i * D + j] * a[i * D + j];
    if (off < 1e-30) break;
    for (p = 0; p < D; p++) for (qq = p + 1; qq < D; qq++) {
      var apq = a[p * D + qq]; if (Math.abs(apq) < 1e-300) continue;
      var th = (a[qq * D + qq] - a[p * D + p]) / (2 * apq), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (k = 0; k < D; k++) { var akp = a[k * D + p], akq = a[k * D + qq]; a[k * D + p] = c * akp - sn * akq; a[k * D + qq] = sn * akp + c * akq; }
      for (k = 0; k < D; k++) { var apk = a[p * D + k], aqk = a[qq * D + k]; a[p * D + k] = c * apk - sn * aqk; a[qq * D + k] = sn * apk + c * aqk; }
    }
  }
  var ev = []; for (i = 0; i < D; i++) ev.push(Math.sqrt(Math.max(a[i * D + i], 0)));
  return ev.sort(function (x, y) { return y - x; });
};

/* the objects: the statue (a typical member of the family) and the same statue squared off by a trait the family never had */
L11.oodFactor = function () { var f = new Float64Array(D); f[2] = -0.09; f[6] = -0.12; f[7] = 0.05; f[8] = 0.07; return f; };
L11.object = function (kind) {
  var th = Float64Array.from(SH.statueTheta());
  if (kind === 'ood') { var f = L11.oodFactor(); for (var i = 0; i < D; i++) th[i] += f[i]; }
  return th;
};
/* one object from the world the prior was learned from (ood = false) or from a world with the extra trait (ood = true) */
L11.world = function (rng, ood) {
  var th = SH.sampleFamily(rng), i;
  if (ood) { var z = 1 + 0.25 * FL.randn(rng), f = L11.oodFactor(); for (i = 0; i < D; i++) th[i] += z * f[i]; }
  return th;
};
/* noisy readings r = A theta + n for the given angles */
L11.readings = function (A, m, theta, sigma, rng) {
  var r = new Float64Array(m), i, k;
  for (i = 0; i < m; i++) { var s = 0; for (k = 0; k < D; k++) s += A[i * D + k] * theta[k]; r[i] = s + sigma * FL.randn(rng); }
  return r;
};

/* error and honesty of a posterior over N objects from a world: mean unseen RMSE, mean unseen 2-sigma coverage, claimed sigma */
L11.calibrate = function (alphas, sigma, prior, ood, N, seed) {
  var fit = L11.fit(L11.angles(alphas), sigma, prior), sd = L11.std(fit), seen = L11.seen(alphas), rng = FL.rng(seed), H = L11.H;
  var un = [], j, k, t;
  for (j = 0; j < L11.NPROBE; j++) if (!seen[j]) un.push(j);
  var out = { nUnseen: un.length, rmse: 0, cov: 0, claimed: 0 };
  if (!un.length) return out;
  for (k = 0; k < un.length; k++) out.claimed += sd[un[k]] / un.length;
  for (t = 0; t < N; t++) {
    var th = L11.world(rng, ood), mean = L11.mean(fit, L11.readings(fit.A, fit.m, th, sigma, rng)), se = 0, c = 0;
    for (k = 0; k < un.length; k++) {
      var e = 0; j = un[k];
      for (var i = 0; i < D; i++) e += H[j * D + i] * (mean[i] - th[i]);
      se += e * e; if (Math.abs(e) <= 2 * sd[j]) c++;
    }
    out.rmse += Math.sqrt(se / un.length) / N; out.cov += c / un.length / N;
  }
  return out;
};

/* everything one control setting implies, for the widget: the posterior, one displayed object (the statue, or object number `draw` of the world),
 * its noisy readings, three scenes drawn from the posterior, and the numbers the readouts print.  c = {views, path, prior, obj, sigma, priors};
 * `draw` counts presses of "another draw" (0 = the page as it opens). */
L11.scene = function (c, draw) {
  var al = L11.alphas(c.views, c.path), phis = L11.angles(al), prior = c.priors[c.prior], ood = c.obj === 'ood', j;
  var fit = L11.fit(phis, c.sigma, prior), sd = L11.std(fit), seen = L11.seen(al);
  var th = c.obj === 'statue' ? L11.object('statue') : L11.world(FL.rng(700 + draw), ood);
  var r = L11.readings(fit.A, fit.m, th, c.sigma, FL.rng(L11.SEED_DRAW + draw)), mean = L11.mean(fit, r);
  var Rt = L11.radius(th), Rm = L11.radius(mean), nU = 0, nS = 0, cU = 0, cS = 0, se = 0, bar = 0;
  for (j = 0; j < L11.NPROBE; j++) {
    var e = Rm[j] - Rt[j], inb = Math.abs(e) <= 2 * sd[j];
    if (seen[j]) { nS++; if (inb) cS++; } else { nU++; se += e * e; bar += sd[j]; if (inb) cU++; }
  }
  return { views: c.views, sigma: c.sigma, al: al, phis: phis, r: r, seen: seen, sd: sd, Rt: Rt, Rm: Rm, nU: nU, sv: L11.singular(fit.A, fit.m),
           samples: SH.sample({ mean: mean, cov: fit.S }, FL.rng(L11.SEED_SAMPLE + draw), 3).map(function (t) { return L11.radius(t); }),
           err: nU ? Math.sqrt(se / nU) * L11.CM : NaN, bar: nU ? bar / nU * L11.CM : NaN, cU: nU ? 100 * cU / nU : NaN, cS: nS ? 100 * cS / nS : NaN,
           cal: L11.calibrate(al, c.sigma, prior, ood, L11.NCAL, L11.SEED_CAL) };
};

/* the widget's canvas (browser only): the object from above with readings, truth, posterior mean, +-2 sd band and three posterior draws; the same curves unrolled over phi; the singular values of A against sigma. T is the object L11.scene returns. */
L11.draw = function (cv, T) {
  var D = FL.draw, C = FL.C, CM = L11.CM, NP = L11.NPROBE, HALF = L11.HALF;
  cv.style.height = (cv.clientWidth < 600 ? 740 : 500) + 'px';
  var S = D.setup(cv), ctx = S.ctx, w = S.w, h = S.h, narrow = w < 600, j, k;
  var tw = narrow ? Math.min(w - 16, 340) : Math.min(w * 0.37, h - 150), tx = narrow ? (w - tw) / 2 : 8, ty = 8;
  var px = narrow ? 8 : tx + tw + 26, py = narrow ? ty + tw + 34 : 24, pw = w - px - 10, ph = narrow ? 200 : h - py - 40;
  var bx = 8, by = narrow ? py + ph + 52 : ty + tw + 34, bw = narrow ? w - 16 : tw, bh = narrow ? 90 : h - by - 30;
  var v = D.view(tx, ty, tw, tw, -2.1, 2.1, -2.1, 2.1);
  var rm = function (R) { return Math.max(0.02, Math.min(1.8, R)) * CM / 100; };
  var loop = function (Rv, off) {
    var pts = [];
    for (var q = 0; q <= NP; q++) { var a = L11.probes[q % NP], rr = rm(Rv[q % NP] + off * T.sd[q % NP]); pts.push([v.X(rr * Math.cos(a)), v.Y(rr * Math.sin(a))]); }
    return pts;
  };
  var trace = function (pts) { pts.forEach(function (p, q) { if (q) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); };
  D.frame(ctx, tx, ty, tw, tw, C.panel); D.grid(ctx, v, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, tw); ctx.clip();
  var tp = loop(T.Rt, 0);
  ctx.beginPath(); trace(tp); ctx.fillStyle = 'rgba(217,119,6,0.10)'; ctx.fill();
  ctx.beginPath(); trace(loop(T.Rm, 2)); trace(loop(T.Rm, -2)); ctx.fillStyle = 'rgba(37,99,235,0.20)'; ctx.fill('evenodd');
  T.samples.forEach(function (Rs) { D.path(ctx, loop(Rs, 0), 'rgba(124,58,237,0.75)', 1.1); });
  D.path(ctx, loop(T.Rm, 0), C.blue, 2);
  var runs = function (color, width, wantSeen, dash) {
    var pts = [];
    for (var q = 0; q <= NP; q++) { if (T.seen[q % NP] === wantSeen) pts.push(tp[q]); else { if (pts.length > 1) D.path(ctx, pts, color, width, dash); pts = []; } }
    if (pts.length > 1) D.path(ctx, pts, color, width, dash);
  };
  runs(C.green, 5, true); runs(C.ink, 1.6, true); runs(C.ink, 1.4, false, [4, 3]);
  T.phis.forEach(function (a, q) { D.dot(ctx, v.X(rm(1 + T.r[q]) * Math.cos(a)), v.Y(rm(1 + T.r[q]) * Math.sin(a)), 2.6, C.green, C.white); });
  ctx.restore();
  T.al.forEach(function (a, q) { D.camera(ctx, FL.lookAt(1.85 * Math.cos(a), 1.85 * Math.sin(a), 0, 0, { f: 56, W: 64 }), v, { color: C.blue, label: String(q + 1), len: 0.5, fov: false }); });
  D.mono(ctx, 'seen from above, 1 m grid', tx + 6, ty + tw - 9, C.mute, 9);
  var X = function (a) { return px + (a + PI) / (2 * PI) * pw; }, Y = function (R) { return py + ph - (R - 0.3) / 1.4 * ph; };
  D.frame(ctx, px, py, pw, ph, C.white);
  [-PI, -PI / 2, 0, PI / 2, PI].forEach(function (a, q) { D.line(ctx, X(a), py, X(a), py + ph, C.grid, 1); D.mono(ctx, Math.round(a * 180 / PI) + '°', X(a), py + ph + 11, C.mute, 9, q === 0 ? 'left' : q === 4 ? 'right' : 'center'); });
  [0.5, 1, 1.5].forEach(function (R) { D.line(ctx, px, Y(R), px + pw, Y(R), C.grid, 1); D.mono(ctx, R.toFixed(1), px + 4, Y(R) - 6, C.mute, 9); });
  ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
  var bar7 = function (a, b) { ctx.fillStyle = 'rgba(22,163,74,0.35)'; ctx.fillRect(X(a), py + ph - 7, X(b) - X(a), 7); };
  T.al.forEach(function (a) { var lo = FL.se2.wrap(a - HALF), hi = lo + 2 * HALF; if (hi > PI) { bar7(lo, PI); bar7(-PI, hi - 2 * PI); } else bar7(lo, hi); });
  ctx.beginPath();
  for (j = 0; j < NP; j++) { if (j) ctx.lineTo(X(L11.probes[j]), Y(T.Rm[j] + 2 * T.sd[j])); else ctx.moveTo(X(L11.probes[j]), Y(T.Rm[j] + 2 * T.sd[j])); }
  for (j = NP - 1; j >= 0; j--) ctx.lineTo(X(L11.probes[j]), Y(T.Rm[j] - 2 * T.sd[j]));
  ctx.closePath(); ctx.fillStyle = 'rgba(37,99,235,0.20)'; ctx.fill();
  var curve = function (Rv, color, width) { D.path(ctx, L11.probes.map(function (a, q) { return [X(a), Y(Rv[q])]; }), color, width); };
  T.samples.forEach(function (Rs) { curve(Rs, 'rgba(124,58,237,0.75)', 1.1); });
  curve(T.Rt, C.ink, 2); curve(T.Rm, C.blue, 2);
  T.phis.forEach(function (a, q) { D.dot(ctx, X(FL.se2.wrap(a)), Y(1 + T.r[q]), 2.6, C.green, C.white); });
  ctx.restore();
  D.mono(ctx, 'radius R (units of 1.15 m) against direction φ', px, py - 9, C.mute, 9);
  D.mono(ctx, 'green bars: directions a camera read', px, py + ph + 25, C.mute, 9);
  D.frame(ctx, bx, by, bw, bh, C.white);
  var lo = -4, hi = 1, cw = bw / 10, yS = function (s) { return by + bh - (Math.max(s > 1e-12 ? Math.log10(s) : lo, lo) - lo) / (hi - lo) * bh; };
  for (k = 0; k < 10; k++) { ctx.fillStyle = T.sv[k] < T.sigma ? 'rgba(220,38,38,0.55)' : 'rgba(37,99,235,0.60)'; ctx.fillRect(bx + k * cw + 3, Math.min(yS(T.sv[k]), by + bh - 3), cw - 6, Math.max(by + bh - yS(T.sv[k]), 3)); }
  D.line(ctx, bx, yS(T.sigma), bx + bw, yS(T.sigma), C.red, 1.4, [5, 3]);
  D.label(ctx, 'noise σ', bx + bw - 4, yS(T.sigma) - 7, C.red, 9, 'right');
  D.mono(ctx, 'singular values of A, log scale', bx, by - 8, C.mute, 9);
};

root.L11 = L11;
if (typeof module !== 'undefined' && module.exports) module.exports = L11;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
