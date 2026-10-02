/* l02_belief.js — private engine of World Models lesson 02, "The state you cannot see: belief".  Global BL; needs courtyard.js (CY) loaded first.
 *
 * What it holds (everything the lesson's widget computes, so that the page script only draws):
 *   - the Kalman filter for ONE axis of free flight, written for a scalar reading of the first state component: predict (x <- F x, P <- F P F' + Q) and
 *     update (K = P[:,0] / S, Joseph form); n = 2 (position, velocity) or n = 3 (position, velocity, a constant hidden acceleration "wind");
 *   - a pool of seeded launches with one fixed table of sensor noise per launch and step, so that moving a control re-filters the SAME world;
 *   - the tracks (truth, which steps the sensor sees, the belief of both axes after each step) and the statistics of the lesson: normalised innovation
 *     squared, 95 % coverage, position std at the curtain's exit, error behind the curtain;
 *   - the nudge planner of lesson 1 (K candidate impulses, imagine each ending, pick the best), fed with a true state, with the last two readings, with a
 *     straight line through the last ten readings, with the belief mean, and a claim of success computed from states sampled from the belief;
 *   - the widget: the session (launch pool, candidate nudges, planner cache), BL.compute (one setting of the controls -> tracks, statistics, planners),
 *     BL.layout (the panels for a canvas of a given width: one column below 600 px), BL.readouts (the text of every readout) and BL.paint (the drawing), so the page script only wires the controls.
 * Conventions: state of an axis [p, v] (+ [w]); step = 0.1 s; the filter's F is exact for the friction of the Courtyard (d = exp(-gamma dt), g = (1-d)/gamma);
 * the filter's "doubt" q is a velocity kick (m/s per step) it allows itself each step (the true world has none); everything deterministic.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var BL = {};

BL.TA = 12; BL.TF = 80; BL.AMAX = 3; BL.KC = 128; BL.T = 40; BL.GOAL_R = 0.5;     // the nudge task: impulse at step 12, then coast 80 steps; 40-step tracks
BL.SIGO = 0.1;                                                                 // the real sensor noise, m
BL.PRIOR = [{ mu: [0.5, 2.46], sd: [0.05, 0.29] }, { mu: [2.5, 0], sd: [0.87, 0.43] }];   // what the agent knows of the launcher: x axis, y axis, each [position, velocity]
BL.WIND = [-0.2, 0]; BL.WIND_SD = 0.3;                                         // the hidden wind (m/s^2), and how windy the agent thinks it might be
BL.CHI2 = -2 * Math.log(0.05);                                              // 95 % of a chi-square with 2 degrees of freedom: 5.99

/* ───────────── the model of one axis ───────────── */
BL.model = function (aware) {
  var w = CY.world({ W: 1e3, H: 1e3, curtain: null }), d = Math.exp(-w.gamma * w.dt), g = (1 - d) / w.gamma;
  var u = CY.step(CY.world({ W: 1e3, H: 1e3, curtain: null, wind: [1, 0] }), [500, 500, 0, 0], null);   // the response to a unit constant acceleration, read off the simulator
  return aware ? { n: 3, F: [1, g, u[0] - 500, 0, d, u[2], 0, 0, 1] } : { n: 2, F: [1, g, 0, d] };
};
BL.filter = function (model, R, q, mu, sd) {
  var n = model.n, f = { n: n, F: model.F, R: R, x: new Float64Array(n), P: new Float64Array(n * n), Q: new Float64Array(n * n), T: new Float64Array(n * n), xt: new Float64Array(n), K: new Float64Array(n), nu: NaN, S: NaN }, i;
  for (i = 0; i < n; i++) { f.x[i] = mu[i]; f.P[i * n + i] = sd[i] * sd[i]; }
  f.Q[n + 1] = q * q;
  return f;
};
BL.predict = function (f) {                                      // x <- F x,  P <- F P F' + Q
  var n = f.n, F = f.F, x = f.x, P = f.P, T = f.T, i, j, k, s;
  for (i = 0; i < n; i++) { s = 0; for (j = 0; j < n; j++) s += F[i * n + j] * x[j]; f.xt[i] = s; }
  for (i = 0; i < n; i++) x[i] = f.xt[i];
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) { s = 0; for (k = 0; k < n; k++) s += F[i * n + k] * P[k * n + j]; T[i * n + j] = s; }
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) { s = f.Q[i * n + j]; for (k = 0; k < n; k++) s += T[i * n + k] * F[j * n + k]; P[i * n + j] = s; }
};
BL.update = function (f, z) {                                    // nu = z - x0,  S = P00 + R,  K = P[:,0] / S,  x <- x + K nu,  P <- (I - K H) P (I - K H)' + K R K'  (equal to (I - K H) P, kept symmetric)
  var n = f.n, P = f.P, x = f.x, T = f.T, K = f.K, i, j, S = P[0] + f.R, nu = z - x[0];
  for (i = 0; i < n; i++) K[i] = P[i * n] / S;
  for (i = 0; i < n; i++) x[i] += K[i] * nu;
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) T[i * n + j] = P[i * n + j] - K[i] * P[j];
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) P[i * n + j] = T[i * n + j] - T[i * n] * K[j] + f.R * K[i] * K[j];
  f.nu = nu; f.S = S;
};
/* one axis of one episode: the belief after each step 0..T.  zs[t] is the reading (used where vis[t]).  Returns flat arrays X (n per step), P (n*n per step), nu, S. */
BL.runAxis = function (model, R, q, mu, sd, zs, vis, T) {
  var n = model.n, f = BL.filter(model, R, q, mu, sd), o = { n: n, X: new Float64Array((T + 1) * n), P: new Float64Array((T + 1) * n * n), nu: new Float64Array(T + 1), S: new Float64Array(T + 1) }, t;
  for (t = 0; t <= T; t++) {
    if (t > 0) BL.predict(f);
    if (vis[t]) BL.update(f, zs[t]); else { f.nu = NaN; f.S = NaN; }
    o.X.set(f.x, t * n); o.P.set(f.P, t * n * n); o.nu[t] = f.nu; o.S[t] = f.S;
  }
  return o;
};

/* ───────────── launches, worlds, tracks ───────────── */
BL.pool = function (N, seed) {                                   // N launches, each with one fixed table of unit sensor noise [ex, ey] per step
  var rng = CY.rng(seed), W0 = CY.world({}), E = [], i, t;
  for (i = 0; i < N; i++) { var s0 = CY.launch(W0, rng), z = []; for (t = 0; t <= BL.T; t++) z.push([CY.randn(rng), CY.randn(rng)]); E.push({ s0: s0, z: z }); }
  return E;
};
BL.world = function (width, windOn) { return CY.world({ curtain: width > 0 ? [2.6, 2.6 + width] : null, wind: windOn ? BL.WIND : [0, 0] }); };
BL.path = function (w, s0, T) { var tr = [s0], s = s0, t; for (t = 0; t < T; t++) { s = CY.step(w, s, null); tr.push(s); } return tr; };
BL.freeUntil = function (w, s0, T) {                             // the last step up to which the ball has touched no wall (T = never): until then its path equals the path in a world with no walls in reach
  var wu = CY.world({ W: 1e3, H: 1e3, curtain: null, wind: w.wind }), a = BL.path(w, s0, T), b = BL.path(wu, [s0[0] + 100, s0[1] + 100, s0[2], s0[3]], T), t;
  for (t = 0; t <= T; t++) if (Math.abs(a[t][0] - b[t][0] + 100) > 1e-9 || Math.abs(a[t][1] - b[t][1] + 100) > 1e-9) return t - 1;
  return T;
};
/* the track of one episode under one setting: set = { width, wind (0|1), aware (0|1), rmult (assumed sensor variance / true), q } */
BL.track = function (ep, set, w) {
  w = w || BL.world(set.width, set.wind);
  var tr = BL.path(w, ep.s0, BL.T), vis = tr.map(function (s) { return !CY.occluded(w, s); }), R = BL.SIGO * BL.SIGO * set.rmult, model = BL.model(!!set.aware), ax = [], c;
  for (c = 0; c < 2; c++) {
    var zs = tr.map(function (s, t) { return s[c] + BL.SIGO * ep.z[t][c]; }), mu = BL.PRIOR[c].mu.slice(), sd = BL.PRIOR[c].sd.slice();
    if (set.aware) { mu.push(0); sd.push(BL.WIND_SD); }
    ax.push(BL.runAxis(model, R, set.q, mu, sd, zs, vis, BL.T));
  }
  var last = BL.freeUntil(w, ep.s0, BL.T);
  return { tr: tr, vis: vis, zs: [0, 1].map(function (c) { return tr.map(function (s, t) { return s[c] + BL.SIGO * ep.z[t][c]; }); }), ax: ax, last: last, free: last === BL.T, n: ax[0].n };
};
BL.mean = function (tk, t) { var n = tk.n; return [tk.ax[0].X[t * n], tk.ax[1].X[t * n], tk.ax[0].X[t * n + 1], tk.ax[1].X[t * n + 1]]; };
BL.pvar = function (tk, t, c) { var n = tk.n; return tk.ax[c].P[t * n * n]; };                  // variance of the position of axis c after step t
BL.stats = function (tks) {                                      // calibration and growth statistics over the free-flight episodes of an array of tracks
  var nEp = 0, nisS = 0, nisN = 0, covS = 0, covN = 0, eS = 0, cS = 0, bN = 0, exS = 0, afS = 0, exN = 0, i, t, c;
  for (i = 0; i < tks.length; i++) {
    var tk = tks[i]; if (!tk.free) continue; nEp++;
    var tOut = -1, tIn = -1;
    for (t = 0; t <= BL.T; t++) {
      var ex = tk.ax[0].X[t * tk.n] - tk.tr[t][0], ey = tk.ax[1].X[t * tk.n] - tk.tr[t][1], px = BL.pvar(tk, t, 0), py = BL.pvar(tk, t, 1);
      covN++; if (ex * ex / px + ey * ey / py <= BL.CHI2) covS++;
      if (tk.vis[t]) { nisS += 0.5 * (tk.ax[0].nu[t] * tk.ax[0].nu[t] / tk.ax[0].S[t] + tk.ax[1].nu[t] * tk.ax[1].nu[t] / tk.ax[1].S[t]); nisN++; if (tIn >= 0 && tOut < 0) tOut = t; }
      else { bN++; eS += 0.5 * (ex * ex + ey * ey); cS += 0.5 * (px + py); if (tIn < 0) tIn = t; }
    }
    if (tOut > 0) { exS += Math.sqrt(0.5 * (BL.pvar(tk, tOut - 1, 0) + BL.pvar(tk, tOut - 1, 1))); afS += Math.sqrt(0.5 * (BL.pvar(tk, tOut, 0) + BL.pvar(tk, tOut, 1))); exN++; }
  }
  return { nEp: nEp, nis: nisS / nisN, cov: covS / covN, blindErr: bN ? Math.sqrt(eS / bN) : NaN, blindClaim: bN ? Math.sqrt(cS / bN) : NaN, exitStd: exN ? exS / exN : NaN, afterStd: exN ? afS / exN : NaN, nExit: exN };
};

/* ───────────── the nudge planner of lesson 1 ───────────── */
BL.cands = function (n, K) {                                     // K candidate impulses in the disc |a| <= 3, same draw as lesson 1
  var rc = CY.rng(1000 + n), c = [], k; for (k = 0; k < K; k++) { var an = 2 * Math.PI * rc(), am = BL.AMAX * Math.sqrt(rc()); c.push([am * Math.cos(an), am * Math.sin(an)]); }
  return c;
};
BL.outcome = function (w, s, a) { var q = CY.step(w, s, a), u; for (u = 0; u < BL.TF; u++) q = CY.step(w, q, null); return q; };      // the nudge, then everything coasts
BL.miss = function (w, f) { return Math.hypot(f[0] - w.goal.x, f[1] - w.goal.y); };
BL.best = function (w, bel, cands) {                              // the planner: imagine every candidate from the believed state, keep the smallest miss
  var best = Infinity, bi = 0, k; for (k = 0; k < cands.length; k++) { var m = BL.miss(w, BL.outcome(w, bel, cands[k])); if (m < best) { best = m; bi = k; } }
  return { k: bi, miss: best };
};
BL.twoReadings = function (tk, t) {                              // lesson 1's state: the last two visible readings, taken at face value
  var t1 = -1, t2 = -1, u; for (u = t; u >= 0; u--) if (tk.vis[u]) { if (t1 < 0) t1 = u; else { t2 = u; break; } }
  var dt = (t1 - t2) * 0.1; return [tk.zs[0][t1], tk.zs[1][t1], (tk.zs[0][t1] - tk.zs[0][t2]) / dt, (tk.zs[1][t1] - tk.zs[1][t2]) / dt];
};
BL.lineFit = function (tk, t, m) {                               // a straight line through the last m visible readings, run forward to now at constant velocity
  var idx = [], u; for (u = t; u >= 0 && idx.length < m; u--) if (tk.vis[u]) idx.push(u);
  var out = [0, 0, 0, 0], c;
  for (c = 0; c < 2; c++) {
    var n = idx.length, st = 0, sz = 0, stt = 0, stz = 0, i; for (i = 0; i < n; i++) { var tt = idx[i] * 0.1, zz = tk.zs[c][idx[i]]; st += tt; sz += zz; stt += tt * tt; stz += tt * zz; }
    var b = (n * stz - st * sz) / (n * stt - st * st), a = (sz - b * st) / n; out[c] = a + b * t * 0.1; out[2 + c] = b;
  }
  return out;
};
BL.chol = function (P, n) {                                       // lower Cholesky factor of a small SPD matrix
  var L = new Float64Array(n * n), i, j, k; for (i = 0; i < n; i++) for (j = 0; j <= i; j++) { var s = P[i * n + j]; for (k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]; L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-18)) : s / L[j * n + j]; }
  return L;
};
BL.sample = function (tk, t, rng) {                               // one state (and wind) drawn from the belief: [x, y, vx, vy, wx, wy]
  var out = [0, 0, 0, 0, 0, 0], n = tk.n, c, i, j;
  for (c = 0; c < 2; c++) {
    var P = tk.ax[c].P.subarray(t * n * n, (t + 1) * n * n), L = BL.chol(P, n), e = []; for (i = 0; i < n; i++) e.push(CY.randn(rng));
    for (i = 0; i < n; i++) { var v = tk.ax[c].X[t * n + i]; for (j = 0; j <= i; j++) v += L[i * n + j] * e[j]; if (i === 0) out[c] = v; else if (i === 1) out[2 + c] = v; else out[4 + c] = v; }
  }
  return out;
};
/* the plan from a belief at step t: pick the best candidate from the belief mean (in a model world with the wind it believes in), then ask the belief how likely
 * that nudge is to work (S states drawn from the belief, each flown out in its own model world).  wr is the real world. */
BL.plan = function (n, tk, t, wr, cands, S, seed) {
  var truth = tk.tr[t], bel = BL.mean(tk, t), wm = CY.world({ wind: tk.n === 3 ? [tk.ax[0].X[t * 3 + 2], tk.ax[1].X[t * 3 + 2]] : [0, 0] });
  var pk = BL.best(wm, bel, cands), a = cands[pk.k], real = BL.outcome(wr, truth, a), imagEnd = BL.outcome(wm, bel, a), claim = 0, ends = [], rng = CY.rng(seed + n), q;
  for (q = 0; q < S; q++) {
    var sm = BL.sample(tk, t, rng), ws = CY.world({ wind: [sm[4], sm[5]] }), fe = BL.outcome(ws, sm.slice(0, 4), a);
    ends.push([fe[0], fe[1]]); if (BL.miss(ws, fe) < BL.GOAL_R) claim++;
  }
  return { k: pk.k, a: a, imag: pk.miss, real: BL.miss(wr, real), hit: BL.miss(wr, real) < BL.GOAL_R, claim: S ? claim / S : NaN, ends: ends, realEnd: real, imagEnd: imagEnd };
};

/* ───────────── the widget: session, planners, layout, painting ───────────── */
BL.NEP = 240; BL.NP = 120; BL.NS = 48; BL.CLAIM_SEED = 777;      // launches filtered, launches planned for, states drawn from a belief to make its claim, seed of those draws
BL.session = function () {                                       // the pool of launches, the candidate nudges of each, and a cache: a control that changes nothing for a planner costs nothing
  var S = { pool: BL.pool(BL.NEP, 5), cands: [], memo: {}, W2: CY.world({}) }, i;
  for (i = 0; i < BL.NP; i++) S.cands.push(BL.cands(i, BL.KC));
  return S;
};
BL.planners = function (S, set, w, tks) {                         // the nudge planner fed four ways over the first NP launches: true state, last two readings, belief mean, and the belief's claim
  var out = { tru: 0, two: 0, mean: 0, claim: 0, pl: [] }, TA = BL.TA, wk = set.wind ? 'w' : 'n', n;
  function once(key, fn) { return key in S.memo ? S.memo[key] : (S.memo[key] = fn()); }
  for (n = 0; n < BL.NP; n++) {
    var tk = tks[n], truth = tk.tr[TA], two = BL.twoReadings(tk, TA), cn = S.cands[n], m = tk.n * tk.n;
    var bel = [BL.mean(tk, TA), Array.from(tk.ax[0].P.subarray(TA * m, (TA + 1) * m)), Array.from(tk.ax[1].P.subarray(TA * m, (TA + 1) * m))].join('|');
    out.tru += once('t' + n + wk, function () { var pk = BL.best(w, truth, cn); return BL.miss(w, BL.outcome(w, truth, cn[pk.k])) < BL.GOAL_R ? 1 : 0; });
    out.two += once('u' + n + wk + two.join(','), function () { var pk = BL.best(S.W2, two, cn); return BL.miss(w, BL.outcome(w, truth, cn[pk.k])) < BL.GOAL_R ? 1 : 0; });
    var pl = once('m' + n + wk + set.aware + bel, function () { return BL.plan(n, tk, TA, w, cn, BL.NS, BL.CLAIM_SEED); });
    out.mean += pl.hit ? 1 : 0; out.claim += pl.claim; out.pl.push(pl);
  }
  out.tru /= BL.NP; out.two /= BL.NP; out.mean /= BL.NP; out.claim /= BL.NP;
  return out;
};
BL.compute = function (S, set, ep) {                              // everything one setting of the controls shows: tracks of every launch, their statistics, the planners
  var w = BL.world(set.width, set.wind), tks = S.pool.map(function (e) { return BL.track(e, set, w); });
  return { set: set, w: w, tks: tks, st: BL.stats(tks), P: BL.planners(S, set, w, tks), ep: ep, tk: tks[ep] };
};
BL.ballPixels = function (w, s) {                                 // how many of the picture's numbers the ball changes by more than 0.05
  var a = CY.img.render(w, s), b = CY.img.render(w, s, { ball: 0 }), k = 0, i;
  for (i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.05) k++;
  return k;
};
/* panels for a canvas w CSS px wide.  A the arena, B the error against its band, C the nudge and where the belief says it ends, D four bars, E the camera's picture and its text.
 * From 600 px up A and B stand left, C D E right, the canvas 590 px high; below it everything stacks in one column and H is the height that holds it. */
BL.layout = function (w) {
  w = Math.max(280, w || 640);                                    // the same floor and default as CY.draw.setup
  var nar = w < 600, LW = nar ? w - 16 : Math.round(w * 0.58), RX = nar ? 8 : 8 + LW + 14, RW = nar ? w - 16 : w - RX - 8, L = { narrow: nar };
  L.A = { x: 8, y: 8, w: LW, h: LW * 5 / 8 };
  L.B = { x: 8, y: L.A.y + L.A.h + 14, w: LW, h: 190 };
  L.C = { x: RX, y: nar ? L.B.y + L.B.h + 14 : 8, w: RW, h: RW * 5 / 8 };
  L.D = { x: RX, y: L.C.y + L.C.h + 30, w: RW, dy: 19, n: 4 };
  L.E = { x: RX, y: L.D.y + L.D.n * L.D.dy + 14, w: 96, h: 60, lines: 4 };
  L.H = nar ? Math.ceil(L.E.y + L.E.h + 13 * L.E.lines + 14) : 590;
  if (!nar) L.B.h = L.H - L.B.y - 8;
  return L;
};
BL.readouts = function (ST) {                                     // the text of every readout and control label, keyed by the id suffix of the page
  var st = ST.st, pl = ST.P.pl[ST.ep], set = ST.set, m = function (v) { return isNaN(v) ? '—' : v.toFixed(3) + ' m'; }, p = function (v) { return (100 * v).toFixed(1) + ' %'; };
  return { 'w-v': set.width.toFixed(1) + ' m', 'ep-v': '#' + ST.ep, 'q-v': set.q.toFixed(3) + ' m/s', exit: m(st.exitStd), after: m(st.afterStd), berr: m(st.blindErr), bcl: m(st.blindClaim),
    nis: st.nis.toFixed(2), cov: p(st.cov), nep: st.nEp + ' of ' + BL.NEP, pt: p(ST.P.tru), p2: p(ST.P.two), pm: p(ST.P.mean), pc: p(ST.P.claim), hit: (100 * pl.claim).toFixed(0) + ' % claimed · ' + (pl.hit ? 'hit' : 'miss') };
};
BL.paint = function (cv, ST) {
  var D = CY.draw, C = CY.C, TA = BL.TA, T = BL.T, K95 = Math.sqrt(BL.CHI2), S0 = D.setup(cv), ctx = S0.ctx, L = BL.layout(S0.w);
  var tk = ST.tk, n = tk.n, last = tk.last, pl = ST.P.pl[ST.ep], t, c, tr = tk.tr.slice(0, last + 1);
  var mean = function (tt, cc) { return tk.ax[cc].X[tt * n]; }, pv = function (tt, cc) { return tk.ax[cc].P[tt * n * n]; };
  /* A: the arena, the readings, the belief */
  var v = D.view(L.A.x, L.A.y, L.A.w, L.A.h, 0, 8, 0, 5);
  D.arena(ctx, v, ST.w);
  D.path(ctx, tr.map(function (s) { return [v.X(s[0]), v.Y(s[1])]; }), C.ink, 1.6);
  for (t = 0; t <= last; t++) if (tk.vis[t]) D.dot(ctx, v.X(tk.zs[0][t]), v.Y(tk.zs[1][t]), 2, 'rgba(8,145,178,0.8)');
  D.path(ctx, tr.map(function (s, tt) { return [v.X(mean(tt, 0)), v.Y(mean(tt, 1))]; }), C.purple, 1.4);
  for (t = 0; t <= last; t += 4) D.ellipse(ctx, v, mean(t, 0), mean(t, 1), pv(t, 0), 0, pv(t, 1), K95, 'rgba(109,74,255,0.8)', 'rgba(109,74,255,0.08)');
  D.ellipse(ctx, v, mean(TA, 0), mean(TA, 1), pv(TA, 0), 0, pv(TA, 1), K95, C.amber, 'rgba(217,119,6,0.15)');
  D.arrow(ctx, v.X(tk.tr[TA][0]), v.Y(tk.tr[TA][1]), v.X(tk.tr[TA][0] + 0.3 * pl.a[0]), v.Y(tk.tr[TA][1] + 0.3 * pl.a[1]), C.amber, 2, 7);
  D.label(ctx, 'nudge, t = 1.2 s', v.X(tk.tr[TA][0]) + 6, v.Y(tk.tr[TA][1]) - 12, C.amber, 9);
  if (!tk.free) { D.label(ctx, 'bounce: the linear model stops here', v.X(tk.tr[last][0]) + 6, v.Y(tk.tr[last][1]) + 12, C.red, 9); D.dot(ctx, v.X(tk.tr[last][0]), v.Y(tk.tr[last][1]), 4, C.red, C.white); }
  /* B: error against the belief's own band */
  var bx = L.B.x, by = L.B.y, bw = L.B.w, bh = L.B.h, X0 = bx + 34, X1 = bx + bw - 10, Y0 = by + 22, Y1 = by + bh - 24, ymax = 0.3;
  for (t = 0; t <= last; t++) for (c = 0; c < 2; c++) ymax = Math.max(ymax, Math.abs(mean(t, c) - tk.tr[t][c]), 2.2 * Math.sqrt(pv(t, c)));
  ymax = Math.ceil(ymax * 5) / 5;
  var TX = function (tt) { return X0 + tt / T * (X1 - X0); }, EY = function (e) { return (Y0 + Y1) / 2 - e / ymax * (Y1 - Y0) / 2; };
  D.frame(ctx, bx, by, bw, bh, C.white);
  var tIn = tk.vis.indexOf(false), tOut = tIn >= 0 ? tk.vis.indexOf(true, tIn) : -1;
  if (tIn >= 0) { ctx.fillStyle = 'rgba(98,98,115,0.18)'; ctx.fillRect(TX(tIn), Y0, TX(tOut < 0 ? T : tOut) - TX(tIn), Y1 - Y0); }
  D.line(ctx, X0, EY(0), X1, EY(0), C.dim, 1); D.line(ctx, TX(TA), Y0, TX(TA), Y1, C.amber, 1.2, [4, 3]);
  [['rgba(8,145,178,0.16)', C.cyan], ['rgba(217,119,6,0.14)', C.amber]].forEach(function (col, cc) {
    ctx.fillStyle = col[0]; ctx.beginPath();
    for (t = 0; t <= last; t++) ctx[t ? 'lineTo' : 'moveTo'](TX(t), EY(2 * Math.sqrt(pv(t, cc))));
    for (t = last; t >= 0; t--) ctx.lineTo(TX(t), EY(-2 * Math.sqrt(pv(t, cc))));
    ctx.closePath(); ctx.fill();
    D.path(ctx, tr.map(function (s, tt) { return [TX(tt), EY(mean(tt, cc) - s[cc])]; }), col[1], 1.8);
  });
  [-ymax, 0, ymax].forEach(function (g) { D.mono(ctx, (g > 0 ? '+' : '') + g.toFixed(1), X0 - 4, EY(g), C.mute, 9, 'right'); });
  [0, 1, 2, 3, 4].forEach(function (s) { D.mono(ctx, s + ' s', TX(s * 10), Y1 + 12, C.mute, 9, 'center'); });
  D.mono(ctx, 'belief error (m): x cyan, y amber; band = ±2σ', bx + 8, by + 8, C.mute, 9);
  /* C: the nudge, and where the belief says it ends */
  var v2 = D.view(L.C.x, L.C.y, L.C.w, L.C.h, 0, 8, 0, 5);
  D.arena(ctx, v2, ST.w);
  pl.ends.forEach(function (e) { D.dot(ctx, v2.X(e[0]), v2.Y(e[1]), 2, 'rgba(8,145,178,0.6)'); });
  ctx.save(); ctx.strokeStyle = C.amber; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(v2.X(pl.imagEnd[0]), v2.Y(pl.imagEnd[1]), 5, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
  D.dot(ctx, v2.X(pl.realEnd[0]), v2.Y(pl.realEnd[1]), 4.5, C.ink, pl.hit ? C.green : C.red);
  D.label(ctx, 'belief claims ' + (100 * pl.claim).toFixed(0) + ' %' + (pl.hit ? ' · hit' : ' · miss'), L.C.x + 6, L.C.y + L.C.h + 12, pl.hit ? C.green : C.red, 9);
  /* D: how often the nudge works */
  var rows = [['true state', ST.P.tru, C.green], ['last two readings', ST.P.two, C.red], ['belief mean', ST.P.mean, C.purple], ['belief claimed', ST.P.claim, C.amber]], bwid = L.D.w - 110 - 40;
  rows.forEach(function (r, j) {
    var yy = L.D.y + j * L.D.dy; D.mono(ctx, r[0], L.D.x, yy + 7, C.mute, 9);
    ctx.fillStyle = r[2]; ctx.fillRect(L.D.x + 110, yy, Math.max(2, bwid * r[1]), 14); D.mono(ctx, (100 * r[1]).toFixed(1) + ' %', L.D.x + 110 + Math.max(2, bwid * r[1]) + 4, yy + 7, C.ink, 9);
  });
  /* E: the same ball for a camera: the last picture taken before the nudge */
  for (t = TA; t > 0 && !tk.vis[t]; t--);
  D.image(ctx, CY.img.render(ST.w, tk.tr[t]), 24, 15, L.E.x, L.E.y, L.E.w, L.E.h, { vmin: 0, vmax: 1 });
  ['camera picture at t = ' + (t / 10).toFixed(1) + ' s:', '24 × 15 = 360 numbers, the ball', 'changes ' + BL.ballPixels(ST.w, tk.tr[t]) + ' of them. A sensor model', 'from 4 numbers to 360 is not linear.'].forEach(function (s, j) {
    D.mono(ctx, s, L.E.x, L.E.y + L.E.h + 12 + 13 * j, C.mute, 9);
  });
};

root.BL = BL;
if (typeof module !== 'undefined' && module.exports) module.exports = BL;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
