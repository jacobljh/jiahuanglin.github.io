/* l13_sampling.js — private engine of 3D lesson 13, "Sampling the unseen: generative 3D".
 *
 * The world is the one of lessons 11 and 12 (FL.shape): a star-shaped object is theta in R^10 (radius R(phi) = 1 + sum_k a_k cos k phi + b_k sin k phi),
 * and it is either an OVAL or a TREFOIL, a Gaussian each (SH.classes(), prior 1/2 : 1/2).  Two numbers summarise an object, its scores
 * z = (z_oval, z_tref): the least-squares coefficients of theta on the two factor shapes SH.M[0], SH.M[1].  A real oval has z_tref ~ 0, a real trefoil z_oval ~ 0.
 * The photograph is the front of lesson 12: FRONT_N = 16 radii at random angles on the arc ALPHA +- 25 degrees, noise FSD = 0.04 (4.6 cm of the 1.15 m statue).
 *
 * Everything here is exact: with a Gaussian-mixture prior and a linear measurement the posterior is a Gaussian mixture, and so is every noised version of it,
 * so the "trained diffusion model" of the lesson is replaced by its exact minimiser, the denoiser  eps(z, t) = -s_t grad log p_t(z)  (see epsHat).
 *
 *   L13.fronts()                       the four fronts of the widget (2 balanced, 1 leaning, 1 clear), each {id, c (true kind), th, fr, post, w (oval weight)}
 *   L13.posterior(fr)                  {w, comp, mean}: the mixture posterior of a front (SH.mixturePosterior) and its mean (the best squared-error answer)
 *   L13.zOf / L13.hybrid / L13.dist    scores of an object (elongation, triangularity), its hybrid score min(|e|, |t|), rms radius difference over the unseen arc (cm)
 *   L13.reverse(F, rng)                one draw by reverse diffusion in theta space (deterministic DDIM from pure noise), with the path of its clean-sample estimates
 *   L13.climb(F, rng, {omega, start})  one score distillation run: gradient steps on theta through random views of a view-space prior, guidance omega, from a round blob or from `start`
 *   L13.tiles(F, rng, joint)           an outline made of four 90-degree tiles, drawn jointly (one object) or independently (one object per tile)
 *   L13.run / L13.stats                the answer sets of the widget (mean, sample, reverse, climb, views) and every number it prints
 *
 * Deterministic: no Math.random, no Date.  Depends on FL (flatland.js).  Global L13; module.exports under node.
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require !== 'undefined' ? require('./flatland.js') : null);
var SH = FL.shape, D = SH.dim, PI = Math.PI;
var L13 = { CM: 115, ALPHA: PI / 3, HALF: 25 * PI / 180, FSD: 0.04, NF: 16, SC: 0.05, NV: 9, VHALF: 50 * PI / 180, NVIEW: 12, NT: 24, TDDIM: 60, TMAX: 0.99, STEPS: 200, LR: 0.03 };

/* ───────────────────────────── the world, a front, its posterior ───────────────────────────── */
var CLS = null;
L13.classes = function () { return CLS || (CLS = SH.classes()); };
L13.shape = function (c, rng) { var k = L13.classes()[c]; return SH.sample({ mean: k.mu, cov: k.Lam }, rng, 1)[0]; };
L13.front = function (th, rng) {                                   // 16 radii at random angles on the front arc, noisy
  var ang = [], r = [], i;
  for (i = 0; i < L13.NF; i++) ang.push(L13.ALPHA - L13.HALF + 2 * L13.HALF * rng());
  for (i = 0; i < L13.NF; i++) r.push(SH.radius(th, ang[i]) + L13.FSD * FL.randn(rng));
  return { ang: ang, r: r };
};
L13.posterior = function (fr) {
  var mp = SH.mixturePosterior(fr.ang, fr.r, L13.FSD, L13.classes());
  return { w: mp.map(function (c) { return c.w; }), comp: mp, mean: SH.mixtureMean(mp) };
};
L13.zOf = function (th) {
  var z = [0, 0], c, i;
  for (c = 0; c < 2; c++) { var s = 0, q = 0; for (i = 0; i < D; i++) { s += th[i] * SH.M[c][i]; q += SH.M[c][i] * SH.M[c][i]; } z[c] = s / q; }
  return z;
};
/* how much of the OTHER kind an object carries: the smaller of its two scores in absolute value.  A real oval has triangularity ~ 0 and a real trefoil elongation ~ 0, so a valid
 * object has a small hybrid score (95% of the world's objects have h <= 0.5); a blend of the two kinds has both scores large. */
L13.hybrid = function (th) { var z = L13.zOf(th); return Math.min(Math.abs(z[0]), Math.abs(z[1])); };
L13.VALID = 0.5;
L13.probes = []; for (var q0 = 0; q0 < 72; q0++) L13.probes.push(-PI + 2 * PI * (q0 + 0.5) / 72);
L13.unseen = L13.probes.filter(function (p) { return !SH.seen(p, [L13.ALPHA], L13.HALF); });
L13.dist = function (a, b) { var s = 0; L13.unseen.forEach(function (p) { var d = SH.radius(a, p) - SH.radius(b, p); s += d * d; }); return L13.CM * Math.sqrt(s / L13.unseen.length); };
L13.kind = function (th) { var z = L13.zOf(th); return z[0] > z[1] ? 0 : 1; };            // 0 oval, 1 trefoil

/* the pool of lesson 12: 400 objects drawn alternately from the two kinds (seed 11), each with its front.  The widget's four fronts are picked from it by the rules in
 * L13.select (two with the posterior closest to 1/2 : 1/2, one oval at about 4 : 1, one clear trefoil); their indices are fixed here so a page does not need all 400 posteriors. */
L13.draws = function () {
  if (L13._draws) return L13._draws;
  var rng = FL.rng(11), out = [], i;
  for (i = 0; i < 400; i++) { var c = i % 2, th = L13.shape(c, rng), fr = L13.front(th, rng); out.push({ i: i, c: c, th: th, fr: fr }); }
  return (L13._draws = out);
};
L13.FRONT_IDX = [316, 323, 396, 175];
L13.select = function () {                                         // the rule behind FRONT_IDX (the oracle checks it): needs every posterior
  var pool = L13.draws().map(function (d) { var post = L13.posterior(d.fr); return { i: d.i, c: d.c, w: post.w[0] }; });
  var bal = pool.slice().sort(function (a, b) { return Math.abs(a.w - 0.5) - Math.abs(b.w - 0.5); });
  var lean = pool.filter(function (p) { return p.c === 0; }).sort(function (a, b) { return Math.abs(a.w - 0.8) - Math.abs(b.w - 0.8); })[0];
  var clear = pool.filter(function (p) { return p.c === 1; }).sort(function (a, b) { return Math.abs(a.w - 0.002) - Math.abs(b.w - 0.002); })[0];
  return [bal[0].i, bal[1].i, lean.i, clear.i];
};
L13.fronts = function () {
  if (L13._fronts) return L13._fronts;
  var ids = ['A', 'B', 'C', 'D'], ds = L13.draws();
  return (L13._fronts = L13.FRONT_IDX.map(function (i, k) { var f = ds[i]; f.post = L13.posterior(f.fr); f.w = f.post.w[0]; f.id = ids[k]; f.n = k; f.cache = {}; return f; }));
};

/* ───────────────────────────── small dense algebra (row-major Float64Array) ───────────────────────────── */
function cholInv(C, n) {                                           // inverse and log-determinant of a symmetric positive definite matrix
  var L = new Float64Array(n * n), i, j, k, s, ld = 0;
  for (i = 0; i < n; i++) for (j = 0; j <= i; j++) {
    s = C[i * n + j]; for (k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { L[i * n + i] = Math.sqrt(s); ld += 2 * Math.log(L[i * n + i]); } else L[i * n + j] = s / L[j * n + j];
  }
  var inv = new Float64Array(n * n), y = new Float64Array(n), x = new Float64Array(n);
  for (var c = 0; c < n; c++) {
    for (i = 0; i < n; i++) { s = i === c ? 1 : 0; for (k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
    for (i = n - 1; i >= 0; i--) { s = y[i]; for (k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
    for (i = 0; i < n; i++) inv[i * n + c] = x[i];
  }
  return { inv: inv, ld: ld };
}

/* ───────────────────────────── the exact denoiser of a Gaussian mixture ───────────────────────────── */
/* data x ~ sum_c w_c N(m_c, S_c);  z = a x + s e  with a^2 + s^2 = 1.  Then z ~ sum_c w_c N(a m_c, C_c), C_c = a^2 S_c + s^2 I, and the minimiser of E|eps_hat - e|^2 is
 *     eps(z) = -s grad log p_t(z) = s sum_c r_c(z) C_c^-1 (z - a m_c),   r_c(z) = posterior probability of component c given z.
 * P holds, per component, C_c^-1 (Ci), log det C_c (ld), w, and m_c (m) for one noise level. */
function level(comps, n, a, s) {
  return comps.map(function (c) {
    var C = new Float64Array(n * n), i;
    for (i = 0; i < n * n; i++) C[i] = a * a * c.S[i];
    for (i = 0; i < n; i++) C[i * n + i] += s * s;
    var ci = cholInv(C, n);
    return { Ci: ci.inv, ld: ci.ld, w: c.w, m: c.m, v: new Float64Array(n), r: 0 };
  });
}
function epsHat(P, n, z, a, s, out) {
  var mx = -1e300, c, i, j, Z = 0;
  for (c = 0; c < P.length; c++) {
    var Q = P[c], q = 0;
    for (i = 0; i < n; i++) { var v = 0; for (j = 0; j < n; j++) v += Q.Ci[i * n + j] * (z[j] - a * Q.m[j]); Q.v[i] = v; q += v * (z[i] - a * Q.m[i]); }
    Q.r = Math.log(Q.w) - 0.5 * (q + Q.ld); if (Q.r > mx) mx = Q.r;
  }
  for (c = 0; c < P.length; c++) { P[c].r = Math.exp(P[c].r - mx); Z += P[c].r; }
  for (i = 0; i < n; i++) out[i] = 0;
  for (c = 0; c < P.length; c++) { var rc = s * P[c].r / Z; for (i = 0; i < n; i++) out[i] += rc * P[c].v[i]; }
  return out;
}
L13.epsHat = epsHat; L13.level = level;
var aT = function (t) { return Math.cos(PI * t / 2); }, sT = function (t) { return Math.sin(PI * t / 2); };
L13.aT = aT; L13.sT = sT;

/* ───────────────────────────── reverse diffusion in theta space (deterministic DDIM) ───────────────────────────── */
function thetaComps(F) {
  return F.post.comp.map(function (c) { return { w: c.w, m: Float64Array.from(c.mean, function (v) { return v / L13.SC; }), S: Float64Array.from(c.cov, function (v) { return v / (L13.SC * L13.SC); }) }; });
}
L13.diffModel = function (F) {
  if (F.cache.diff) return F.cache.diff;
  var T = L13.TDDIM, comps = thetaComps(F), ts = [], a = [], s = [], P = [], k;
  for (k = 0; k <= T; k++) { var t = L13.TMAX * (1 - k / T); ts.push(t); a.push(aT(t)); s.push(sT(t)); }
  for (k = 0; k < T; k++) P.push(level(comps, D, a[k], s[k]));
  return (F.cache.diff = { ts: ts, a: a, s: s, P: P });
};
L13.reverse = function (F, rng) {
  var M = L13.diffModel(F), z = new Float64Array(D), x0 = new Float64Array(D), eps = new Float64Array(D), i, k, path = [];
  for (i = 0; i < D; i++) z[i] = FL.randn(rng);
  for (k = 0; k < L13.TDDIM; k++) {
    epsHat(M.P[k], D, z, M.a[k], M.s[k], eps);                                          // the denoiser at this noise level
    for (i = 0; i < D; i++) x0[i] = (z[i] - M.s[k] * eps[i]) / M.a[k];                  // its estimate of the clean sample
    for (i = 0; i < D; i++) z[i] = M.a[k + 1] * x0[i] + M.s[k + 1] * eps[i];             // re-noise to the next, lower level
    path.push(L13.zOf(x0.map(function (v) { return v * L13.SC; })));
  }
  var th = Float64Array.from(z, function (v) { return v * L13.SC; });
  return { th: th, path: path };
};

/* ───────────────────────────── score distillation: gradient steps on theta through random views ───────────────────────────── */
/* A view k at azimuth 2 pi k / NVIEW reads NV radii across +- 50 degrees: x = A_k theta (a linear render).  The "2-D prior" of a view is the exact diffusion model of what that view
 * reads: conditional on the photograph (the posterior predictive) and, for guidance, unconditional (the world's own view distribution).  Units: theta / SC. */
function viewTables(comps, A, n) {                                // comps in theta units / SC; returns per-level tables for one view
  var At = SH.mT(A, n, D), vc = comps.map(function (c) {
    var S = SH.mmul(SH.mmul(A, n, D, c.S, D), n, D, At, n);
    return { w: c.w, m: SH.mmul(A, n, D, c.m, 1), S: S };
  }), tab = [], j;
  for (j = 0; j < L13.NT; j++) { var t = 0.02 + 0.96 * j / (L13.NT - 1); tab.push(level(vc, n, aT(t), sT(t))); }
  return tab;
}
function worldComps() {
  return L13.classes().map(function (c) { return { w: c.pi, m: Float64Array.from(c.mu, function (v) { return v / L13.SC; }), S: Float64Array.from(c.Lam, function (v) { return v / (L13.SC * L13.SC); }) }; });
}
L13.views = function () {
  if (L13._views) return L13._views;
  var vs = [], k;
  for (k = 0; k < L13.NVIEW; k++) { var A = SH.design(SH.arc(2 * PI * k / L13.NVIEW, L13.NV, L13.VHALF)); vs.push({ A: A, unc: viewTables(worldComps(), A, L13.NV) }); }
  return (L13._views = vs);
};
L13.viewModel = function (F) {                                    // the conditional tables of this front (built once)
  if (F.cache.view) return F.cache.view;
  var vs = L13.views(), comps = thetaComps(F);
  return (F.cache.view = vs.map(function (v) { return viewTables(comps, v.A, L13.NV); }));
};
L13.climb = function (F, rng, o) {
  o = o || {};
  var om = o.omega || 1, V = 2, vs = L13.views(), cond = L13.viewModel(F), NV = L13.NV, NT = L13.NT, th = new Float64Array(D), m = new Float64Array(D), v = new Float64Array(D);
  var g = new Float64Array(D), x = new Float64Array(NV), z = new Float64Array(NV), eps = new Float64Array(NV), ec = new Float64Array(NV), eu = new Float64Array(NV), path = [];
  var i, j, k, q, steps = o.steps || L13.STEPS, lr = o.lr || L13.LR;
  for (i = 0; i < D; i++) th[i] = o.start ? o.start[i] / L13.SC : 0.2 * FL.randn(rng);  // a near-neutral blob (a circle of radius 1 plus a hair of noise), or a given start
  for (k = 1; k <= steps; k++) {
    if ((k - 1) % 10 === 0) path.push(L13.zOf(th.map(function (u) { return u * L13.SC; })));
    for (j = 0; j < D; j++) g[j] = 0;
    for (q = 0; q < V; q++) {
      var vi = Math.floor(rng() * L13.NVIEW), ti = Math.floor(rng() * NT), t = 0.02 + 0.96 * ti / (NT - 1), a = aT(t), s = sT(t), A = vs[vi].A;
      for (i = 0; i < NV; i++) eps[i] = FL.randn(rng);
      for (i = 0; i < NV; i++) { var r = 0; for (j = 0; j < D; j++) r += A[i * D + j] * th[j]; x[i] = r; z[i] = a * r + s * eps[i]; }          // render the view, noise it
      epsHat(cond[vi][ti], NV, z, a, s, ec);
      if (om !== 1) { epsHat(vs[vi].unc[ti], NV, z, a, s, eu); for (i = 0; i < NV; i++) ec[i] = eu[i] + om * (ec[i] - eu[i]); }          // classifier-free guidance
      for (j = 0; j < D; j++) { var gs = 0; for (i = 0; i < NV; i++) gs += (ec[i] - eps[i]) * A[i * D + j]; g[j] += s * s * gs / V; }  // SDS: w(t) (eps_hat - eps) dx/dtheta, no U-Net Jacobian
    }
    for (j = 0; j < D; j++) {                                                           // Adam
      m[j] = 0.9 * m[j] + 0.1 * g[j]; v[j] = 0.999 * v[j] + 0.001 * g[j] * g[j];
      th[j] -= lr * (m[j] / (1 - Math.pow(0.9, k))) / (Math.sqrt(v[j] / (1 - Math.pow(0.999, k))) + 1e-8);
    }
  }
  path.push(L13.zOf(th.map(function (u) { return u * L13.SC; })));
  return { th: Float64Array.from(th, function (u) { return u * L13.SC; }), path: path };
};

/* ───────────────────────────── tiles: four views drawn independently or jointly ───────────────────────────── */
L13.tiles = function (F, rng, joint) {
  var one = SH.sampleMixture(F.post.comp, rng, 1)[0], out = [one], k;
  for (k = 1; k < 4; k++) out.push(joint ? one : SH.sampleMixture(F.post.comp, rng, 1)[0]);
  return out;
};
L13.tileOf = function (phi) {                                      // which of the four 90-degree tiles (centred at ALPHA + 90 k) holds direction phi
  var d = FL.se2.wrap(phi - L13.ALPHA + PI / 4);                   // 0 at the start of tile 0
  return Math.floor((d < 0 ? d + 2 * PI : d) / (PI / 2)) % 4;
};

/* ───────────────────────────── answer sets and everything the widget prints ───────────────────────────── */
var MODES = ['mean', 'sample', 'reverse', 'climb', 'views'];
L13.run = function (F, mode, n, o) {
  o = o || {}; var batch = o.batch || 0, om = o.omega || 1, key = mode + '/' + batch + '/' + (mode === 'climb' ? om : 1), c = F.cache[key] || (F.cache[key] = { th: [], path: [], tiles: [] }), i;
  if (mode === 'mean') return { th: [F.post.mean], path: [], tiles: [] };
  for (i = c.th.length; i < n; i++) {
    var rng = FL.rng((1000 * (F.n + 1) + 97 * batch + 31 * MODES.indexOf(mode) + 7919 * i + 5) >>> 0);
    if (mode === 'sample') { var s = SH.sampleMixture(F.post.comp, rng, 1)[0]; c.th.push(s); c.path.push(null); c.tiles.push(null); }
    else if (mode === 'reverse') { var r = L13.reverse(F, rng); c.th.push(r.th); c.path.push(r.path); c.tiles.push(null); }
    else if (mode === 'climb') { var cl = L13.climb(F, rng, { omega: om }); c.th.push(cl.th); c.path.push(cl.path); c.tiles.push(null); }
    else { var ts = L13.tiles(F, rng, false); c.th.push(ts[0]); c.path.push(null); c.tiles.push(ts); }
  }
  return { th: c.th.slice(0, n), path: c.path.slice(0, n), tiles: c.tiles.slice(0, n) };
};
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), k = b.length; return k ? (k % 2 ? b[(k - 1) / 2] : 0.5 * (b[k / 2 - 1] + b[k / 2])) : NaN; }
/* every readout: the kind each answer is closest to, the share of ovals, the hybrid score, the share of valid answers (h <= 0.5), the rms error against the truth,
 * how different the answers are from each other, how often consecutive answers change kind, and (four independent tiles) how often the tiles agree on the kind */
L13.stats = function (F, res) {
  var th = res.th, n = th.length, i, j, ov = 0, fd = [], in2 = 0, se = 0, flips = 0, pd = 0, np = 0, agree = 0, kinds = th.map(L13.kind);
  for (i = 0; i < n; i++) {
    if (kinds[i] === 0) ov++;
    var f = L13.hybrid(th[i]); fd.push(f); if (f <= L13.VALID) in2++;
    var e = L13.dist(th[i], F.th); se += e * e;
    if (i && kinds[i] !== kinds[i - 1]) flips++;
    for (j = 0; j < i; j++) { var d = L13.dist(th[i], th[j]); pd += d * d; np++; }
  }
  if (res.tiles[0]) res.tiles.forEach(function (ts) { var k0 = L13.kind(ts[0]), ok = true; ts.forEach(function (t) { if (L13.kind(t) !== k0) ok = false; }); if (ok) agree++; });
  return { n: n, wOval: F.post.w[0], ovalShare: n ? ov / n : NaN, fam: median(fd), in2: n ? in2 / n : NaN, rms: n ? Math.sqrt(se / n) : NaN, spread: np ? Math.sqrt(pd / np) : NaN, flips: flips, agree: res.tiles[0] ? agree / n : NaN };
};
L13.world = function (n, seed) {                                   // scores of n real objects (alternating kinds): the grey cloud of the score plane
  var rng = FL.rng(seed || 7), out = [];
  for (var i = 0; i < n; i++) out.push(L13.zOf(L13.shape(i % 2, rng)));
  return out;
};

root.L13 = L13;
if (typeof module !== 'undefined' && module.exports) module.exports = L13;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
