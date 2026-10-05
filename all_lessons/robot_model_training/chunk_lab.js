/* chunk_lab.js — lesson 5's private engine: a policy that draws a whole plan at once, and the plant that makes it pay for it.
 *
 * The data are those of lessons 3 and 4: two operators, A passing the first post above and B below, each with 20 calm demonstrations and four
 * rounds of five rollouts of their own clone, every visited state labelled by that operator.  A stored frame is a state and a route (0 = A, 1 = B);
 * the plan it carries is what its operator would do from there, H commands long, on a perfect plant (the operator takes over at that state).
 *
 * The head (kind 'route'): at a state q the stored frames within the kernel split into the two routes; the route is drawn with probability
 * proportional to the kernel mass of its frames, and the plan is the kernel-weighted mean of that route's plans.  The executor plays H commands
 * without looking, then asks again.  H = 1 is a draw at every step.  The other kinds are the alternatives the lesson rules out by measurement:
 *   'copy'  one stored frame is drawn in proportion to its kernel weight and its plan is copied (lesson 4's sampler, applied to plans)
 *   'hold'  the route is drawn and held for H steps, but the command is the route's mean command at the current state: the loop stays closed
 *   'ens'   a plan is drawn at every step and the executed command is the weighted mean of the plans drawn in the last H steps (temporal ensembling)
 * 'tau' is a temperature on the route draw (the probability goes as mass^(1/tau); tau = 0 takes the heavier route).
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var CL = {}, exp = Math.exp, floor = Math.floor, max = Math.max, min = Math.min;      // local aliases: the kernel loop is the hot path
CL.H = [0.02, 0.02];            // kernel bandwidths (rad)
CL.JIT = 0.01;                  // start jitter (m)
CL.GUST = 0.05;                 // the gust of lessons 1 to 4 (rad/s)
CL.DT = 0.05;
CL.MAXH = 40;                   // longest plan a frame carries
CL.SEEDS = [1, 2];              // demonstration streams of operator A and B
CL.HS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40];   // chunk lengths of the sweep

/* what the expert would do from state q0 on a perfect plant: its next H commands */
CL.plan = function (w, q0, H) {
  var q = [q0[0], q0[1]], out = [];
  for (var k = 0; k < H; k++) { var u = BN.slalom.expertAct(w, q); out.push(u); q[0] += CL.DT * u[0]; q[1] += CL.DT * u[1]; }
  return out;
};

/* one operator's frames: m calm demonstrations, then DAgger: per rollouts of the operator's own clone under the gust, every visited state labelled by the operator */
CL.operator = function (w, seed, m, rounds, per, gust) {
  var rng = BN.rng(seed), nw = new BN.NW(CL.H), X = [], t, k, j;
  BN.demos(w, m, rng, { noise: 0, jit: CL.JIT }).forEach(function (ro) { for (t = 0; t < ro.A.length; t++) { nw.add(ro.S[t], ro.A[t]); X.push(ro.S[t]); } });
  for (k = 0; k < rounds; k++) {
    var batch = [];
    for (j = 0; j < per; j++) { var ro = BN.rollout(w, function (q) { return nw.predict(q); }, rng, { noise: gust, jit: CL.JIT }); for (t = 0; t < ro.S.length; t++) batch.push(ro.S[t]); }
    batch.forEach(function (s) { nw.add(s, BN.slalom.expertAct(w, s)); X.push(s); });
  }
  return X;
};

/* both operators in one grid index (cells of three bandwidths, CSR layout); the plan of a frame is computed when it is first asked for */
CL.build = function (n, o) {
  o = o || {};
  var wA = BN.slalom.world(n, { s0: 1 }), wB = BN.slalom.world(n, { s0: -1 }), w = BN.slalom.world(n), seeds = o.seeds || CL.SEEDS;
  var XA = CL.operator(wA, seeds[0], 20, 4, 5, CL.GUST), XB = CL.operator(wB, seeds[1], 20, 4, 5, CL.GUST), X = XA.concat(XB), N = X.length, i;
  var D = { n: n, w: w, wA: wA, wB: wB, N: N, nA: XA.length, nB: XB.length, states: X, route: new Uint8Array(N), x0: new Float64Array(N), x1: new Float64Array(N) };
  var c0 = 3 * CL.H[0], c1 = 3 * CL.H[1], lo0 = Infinity, lo1 = Infinity, hi0 = -Infinity, hi1 = -Infinity;
  for (i = 0; i < N; i++) { D.route[i] = i < XA.length ? 0 : 1; D.x0[i] = X[i][0]; D.x1[i] = X[i][1]; lo0 = Math.min(lo0, D.x0[i]); lo1 = Math.min(lo1, D.x1[i]); hi0 = Math.max(hi0, D.x0[i]); hi1 = Math.max(hi1, D.x1[i]); }
  D.lo0 = lo0; D.lo1 = lo1; D.g0 = Math.floor((hi0 - lo0) / c0) + 1; D.g1 = Math.floor((hi1 - lo1) / c1) + 1;
  var cell = new Int32Array(N), count = new Int32Array(D.g0 * D.g1 + 1);
  for (i = 0; i < N; i++) { cell[i] = Math.floor((D.x0[i] - lo0) / c0) * D.g1 + Math.floor((D.x1[i] - lo1) / c1); count[cell[i] + 1]++; }
  for (i = 0; i < D.g0 * D.g1; i++) count[i + 1] += count[i];
  D.start = count.slice(); D.items = new Int32Array(N); var fill = count.slice(0, D.g0 * D.g1);
  for (i = 0; i < N; i++) D.items[fill[cell[i]]++] = i;
  D.ids = new Int32Array(N); D.ws = new Float64Array(N); D.cnt = 0;           // the frames in reach of the last query, and their kernel weights
  D.pl = new Float64Array(N * CL.MAXH * 2); D.plen = new Uint8Array(N);       // plans, flat: frame i, command k, joint j at (i * MAXH + k) * 2 + j
  D.ensure = function (id, H) {                                                 // compute the plan of frame id the first time it is needed
    var want = H > 1 ? CL.MAXH : 1, k, base = id * CL.MAXH * 2;
    if (D.plen[id] < want) { var p = CL.plan(D.route[id] ? wB : wA, X[id], want); for (k = 0; k < want; k++) { D.pl[base + 2 * k] = p[k][0]; D.pl[base + 2 * k + 1] = p[k][1]; } D.plen[id] = want; }
  };
  D.plan = function (id, H) {                                                   // the first H commands of the plan of frame id, as [u1, u2] pairs
    var out = [], base = id * CL.MAXH * 2; D.ensure(id, H);
    for (var k = 0; k < H; k++) out.push([D.pl[base + 2 * k], D.pl[base + 2 * k + 1]]); return out;
  };
  return D;
};

/* kernel weights of every frame within three bandwidths of q (into D.ids, D.ws) and the mass of each route */
CL.reach = function (D, q) {
  var c0 = 3 * CL.H[0], c1 = 3 * CL.H[1], g0 = floor((q[0] - D.lo0) / c0), g1 = floor((q[1] - D.lo1) / c1), m = [0, 0], cnt = 0, a, b, i;
  for (a = max(0, g0 - 1); a <= min(D.g0 - 1, g0 + 1); a++) for (b = max(0, g1 - 1); b <= min(D.g1 - 1, g1 + 1); b++) {
    var cl = a * D.g1 + b, end = D.start[cl + 1];
    for (i = D.start[cl]; i < end; i++) {
      var id = D.items[i], z0 = (D.x0[id] - q[0]) / CL.H[0], z1 = (D.x1[id] - q[1]) / CL.H[1], e = z0 * z0 + z1 * z1;
      if (e <= 9) { var wj = exp(-0.5 * e); D.ids[cnt] = id; D.ws[cnt] = wj; cnt++; m[D.route[id]] += wj; }
    }
  }
  D.cnt = cnt; return { m: m, tot: m[0] + m[1] };
};
CL.pRoute = function (m, tau) {                              // probability of route B; tau = 0 takes the heavier route
  if (tau === 0) return m[1] > m[0] ? 1 : 0;
  var e = 1 / (tau || 1), a = Math.pow(m[0], e), b = Math.pow(m[1], e);
  return b / (a + b);
};
/* the kernel-weighted mean of the plans of the frames of route r (first H commands), or null when that route has nothing in reach */
CL.meanPlan = function (D, r, H) {
  var sx = new Float64Array(H), sy = new Float64Array(H), tot = 0, i, k;
  for (i = 0; i < D.cnt; i++) {
    var id = D.ids[i]; if (D.route[id] !== r) continue;
    D.ensure(id, H);
    var wj = D.ws[i], base = id * CL.MAXH * 2; tot += wj;
    for (k = 0; k < H; k++) { sx[k] += wj * D.pl[base + 2 * k]; sy[k] += wj * D.pl[base + 2 * k + 1]; }
  }
  if (tot < 1e-12) return null;
  var seq = []; for (k = 0; k < H; k++) seq.push([sx[k] / tot, sy[k] / tot]); return seq;
};
CL.nearest = function (D, q, r) {                            // the single nearest stored frame (of route r, if given)
  var best = Infinity, bi = 0;
  for (var i = 0; i < D.N; i++) { if (r !== undefined && D.route[i] !== r) continue; var z0 = (D.x0[i] - q[0]) / CL.H[0], z1 = (D.x1[i] - q[1]) / CL.H[1], e = z0 * z0 + z1 * z1; if (e < best) { best = e; bi = i; } }
  return bi;
};
CL.nearestPlan = function (D, q, H) { var id = CL.nearest(D, q); return { route: D.route[id], seq: D.plan(id, H) }; };
/* one draw of the head: which route, and the H commands of its mean plan */
CL.draw = function (D, q, H, rng, tau) {
  var ms = CL.reach(D, q);
  if (ms.tot < 1e-12) return CL.nearestPlan(D, q, H);
  var r = rng() < CL.pRoute(ms.m, tau) ? 1 : 0, seq = CL.meanPlan(D, r, H);
  return seq ? { route: r, seq: seq } : CL.nearestPlan(D, q, H);
};
CL.drawCopy = function (D, q, H, rng) {                      // lesson 4's draw of one stored frame in proportion to its kernel weight (frames taken in storage order), applied to plans
  var ms = CL.reach(D, q); if (ms.tot < 1e-12) return CL.nearestPlan(D, q, H);
  var ord = Array.prototype.slice.call(D.ids, 0, D.cnt).map(function (id, i) { return [id, D.ws[i]]; }).sort(function (a, b) { return a[0] - b[0]; });
  var u = rng() * ms.tot, k = 0; while (k < ord.length - 1 && u > ord[k][1]) { u -= ord[k][1]; k++; }
  var id = ord[k][0]; return { route: D.route[id], seq: D.plan(id, H) };
};
CL.meanCommand = function (D, q, r) {                        // the route's mean command at q, the loop closed (uses the reach of the last query)
  var seq = CL.meanPlan(D, r, 1);
  return seq ? seq[0] : D.plan(CL.nearest(D, q, r), 1)[0];
};
CL.pseed = function (base, k) { return BN.rng(base * 100003 + 7919 * k + 1); };

/* the forks: along each operator's own route on a perfect plant, the runs of steps in which the probability of route B lies between lo and hi */
CL.windows = function (D, lo, hi) {
  var runs = [], r, t;
  for (r = 0; r < 2; r++) {
    var w = r ? D.wB : D.wA, ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(1), { noise: 0, q0: BN.slalom.startQ(w, 0) }), run = 0, from = 0;
    for (t = 0; t < ro.S.length; t++) {
      var ms = CL.reach(D, ro.S[t]), p = ms.tot > 0 ? ms.m[1] / ms.tot : 0;
      if (p >= lo && p <= hi) { if (!run) from = t; run++; } else { if (run) runs.push({ route: r, from: from, len: run }); run = 0; }
    }
    if (run) runs.push({ route: r, from: from, len: run });
  }
  var sum = 0; runs.forEach(function (x) { sum += x.len; });
  return { runs: runs, mean: runs.length ? sum / runs.length : 0 };
};
/* the room the course leaves: the closest the operator's cup comes to a post centre, less the 5 cm that counts as a touch (metres) */
CL.margin = function (D) {
  var m = Infinity;
  [D.wA, D.wB].forEach(function (w) {
    var ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(1), { noise: 0, q0: BN.slalom.startQ(w, 0) });
    w.posts.forEach(function (c) { ro.P.forEach(function (p) { m = Math.min(m, Math.hypot(p[0] - c[0], p[1] - c[1])); }); });
  });
  return m - (BN.slalom.W.postR + BN.slalom.W.grip);
};
/* what the open-loop drift is made of: c, the Frobenius norm of the arm's Jacobian (m per rad, rms along the operators' routes), and l, the cup's
 * displacement per step (m) along them.  After H steps a plan on a plant with gust sigma and gain g leaves the cup, against where the plan meant it
 * to be, off by a random part of rms c sigma dt sqrt(H) and a systematic part (1 - g) l H: rms drift^2 = (c sigma dt)^2 H + ((1 - g) l)^2 H^2.
 * The room m (the margin) is spent when the systematic part plus two standard deviations of the random part reach it. */
CL.geometry = function (D) {
  var j2 = 0, ns = 0, len = 0, nl = 0;
  [D.wA, D.wB].forEach(function (w) {
    var ro = BN.rollout(w, BN.expertPolicy(w), BN.rng(1), { noise: 0, q0: BN.slalom.startQ(w, 0) });
    ro.S.forEach(function (q, t) {
      var J = BN.arm.jac(q); j2 += J[0] * J[0] + J[1] * J[1] + J[2] * J[2] + J[3] * J[3]; ns++;
      if (t + 1 < ro.P.length) { len += Math.hypot(ro.P[t + 1][0] - ro.P[t][0], ro.P[t + 1][1] - ro.P[t][1]); nl++; }
    });
  });
  return { c: Math.sqrt(j2 / ns), l: len / nl };
};
CL.budget = function (geo, sigma, gain, margin) {            // the chunk length at which (1 - g) l H + 2 c sigma dt sqrt(H) = margin
  var a = 2 * geo.c * sigma * CL.DT, b = (1 - gain) * geo.l, x;
  if (b > 1e-12) x = (-a + Math.sqrt(a * a + 4 * b * margin)) / (2 * b); else if (a > 1e-12) x = margin / a; else return Infinity;
  return x * x;
};
CL.driftLaw = function (geo, sigma, gain, H) { var a = geo.c * sigma * CL.DT, b = (1 - gain) * geo.l; return Math.sqrt(a * a * H + b * b * H * H); };

/* the policy of one rollout.  spec: {kind, H, tau, seed}.  It records the route of every draw (hist) and, for plans, how far the cup ended from where the plan
 * meant it to be when the next draw came (drift, metres: the cup at the next draw against the cup at the start of the plan moved by its own commands) */
CL.policy = function (D, spec, k) {
  var H = spec.H, kind = spec.kind || 'route', rng = CL.pseed(spec.seed || 11, k), buf = [], hist = [], drift = [], start = null, plans = [], route = -1, age = 0;
  var f = function (q, t) {
    if (kind === 'hold') {
      var ms = CL.reach(D, q);
      if (route < 0 || age >= H) { route = ms.tot < 1e-12 ? D.route[CL.nearest(D, q)] : (rng() < CL.pRoute(ms.m) ? 1 : 0); age = 0; hist.push([t, route]); }
      age++; return CL.meanCommand(D, q, route);
    }
    if (kind === 'ens') {
      var d = CL.draw(D, q, H, rng); hist.push([t, d.route]); plans.push({ t0: t, seq: d.seq });
      while (plans.length && t - plans[0].t0 >= H) plans.shift();
      var a0 = 0, a1 = 0, tw = 0;
      for (var c = 0; c < plans.length; c++) { var wc = Math.exp(-0.01 * c), u = plans[c].seq[t - plans[c].t0]; a0 += wc * u[0]; a1 += wc * u[1]; tw += wc; }
      return [a0 / tw, a1 / tw];
    }
    if (buf.length === 0) {
      if (start) { var pi = BN.arm.fk([start.q[0] + CL.DT * start.s[0], start.q[1] + CL.DT * start.s[1]]), pa = BN.arm.fk(q); drift.push(Math.hypot(pa[0] - pi[0], pa[1] - pi[1])); }
      var dr = kind === 'copy' ? CL.drawCopy(D, q, H, rng) : CL.draw(D, q, H, rng, spec.tau);
      buf = dr.seq.map(function (u) { return [u[0], u[1]]; }); hist.push([t, dr.route]);
      var s = [0, 0]; buf.forEach(function (u) { s[0] += u[0]; s[1] += u[1]; }); start = { q: [q[0], q[1]], s: s };
    }
    return buf.shift();
  };
  f.hist = hist; f.drift = drift; return f;
};

/* an evaluation that can be extended: run(m) adds m more rollouts from the same stream, summary() reports whatever has run so far */
CL.Eval = function (D, spec, plant, N, seed) {
  this.D = D; this.spec = spec; this.plant = plant; this.N = N; this.rng = BN.rng(seed || 5); this.k = 0; this.rolls = []; this.keep = 12;
  this.s = { ok: 0, coll: 0, chg: 0, dec: 0, dsum: 0, dn: 0, steps: 0 };
};
CL.Eval.prototype.run = function (m) {
  var D = this.D, s = this.s, end = Math.min(this.N, this.k + m);
  for (; this.k < end; this.k++) {
    var pol = CL.policy(D, this.spec, this.k), ro = BN.rollout(D.w, pol, this.rng, { plant: this.plant, jit: CL.JIT, T: BN.slalom.horizon(D.w) });
    if (ro.done) s.ok++; if (ro.coll) s.coll++; s.steps += ro.steps;
    var h = pol.hist, c = 0; for (var i = 1; i < h.length; i++) if (h[i][1] !== h[i - 1][1]) c++;
    s.chg += c; s.dec += h.length; pol.drift.forEach(function (d) { s.dsum += d * d; s.dn++; });
    if (this.k < this.keep) this.rolls.push({ P: ro.P, coll: ro.coll, done: ro.done, hist: h });
  }
  return this;
};
CL.Eval.prototype.summary = function () {
  var s = this.s, n = Math.max(1, this.k), ci = BN.stats.wilson(s.ok, n);
  return { n: this.k, succ: s.ok / n, coll: s.coll / n, ci: ci, changes: s.chg / n, decisions: s.dec / n, drift: s.dn ? Math.sqrt(s.dsum / s.dn) : NaN, chunks: s.dn, done: this.k >= this.N };
};

root.CL = CL;
if (typeof module !== 'undefined' && module.exports) module.exports = CL;
})(typeof window !== 'undefined' ? window : globalThis);
