/* loop_lab.js — lesson 2's private engine: what a clone's own frames look like, measured against the data it was built from.
 *
 * Everything is a function of one number per frame: d, the distance from the frame to the nearest stored demonstration frame, in
 * bandwidths of the nearest-demo policy (1 bandwidth = 0.02 rad, about 1.5 cm at the cup).  The kernel reaches three bandwidths, so
 * beyond that the policy copies one stored frame and d is capped at 3.  Frames are grouped in five bins of d.
 *   share   how the frames of a group of runs are spread over the bins
 *   err     how far the clone's command is from the expert's at the same state, relative to the expert's size (lesson 1's copy error)
 *   drift   the mean change of d from one step to the next, and pull = -drift / (mean d): the share of its distance a run recovers per step
 *   cost    expected number of the first t steps that are lost, and the hazard h that a constant-hazard model needs: C(T) = h T^2 / 2
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var LL = {};
LL.H = [0.02, 0.02];
LL.JIT = 0.01;
LL.TUBE = 0.04;                                   // metres from the expert's path; under the default gust the expert never leaves it
LL.EDGES = [0, 0.5, 1, 1.5, 2, 3];                // bins of d, in bandwidths; the last bin is "two or more" (d is capped at 3)
LL.NB = LL.EDGES.length - 1;
LL.NCLONE = 200; LL.NEXPERT = 100; LL.NHELD = 10; LL.SEED = 5;

/* distance from a state to the nearest stored frame, in bandwidths (3 when nothing is stored within the kernel's reach) */
LL.dist = function (nw, q) {
  var best = Infinity;
  nw.each(q, function (id) { var e = nw.dist2(id, q); if (e < best) best = e; });
  return best > 9 ? 3 : Math.sqrt(best);
};
LL.bin = function (d) { var b = 0; while (b < LL.NB - 1 && d >= LL.EDGES[b + 1]) b++; return b; };

/* one setting: n posts, m demonstrations recorded under gust dnoise, the clone and the expert run under gust `gust` */
LL.simulate = function (n, m, dnoise, gust) {
  var w = BN.slalom.world(n), nw = new BN.NW(LL.H), runs = BN.demos(w, m, BN.rng(1), { noise: dnoise, jit: LL.JIT });
  runs.forEach(function (ro) { for (var t = 0; t < ro.A.length; t++) nw.add(ro.S[t], ro.A[t]); });
  var clone = BN.evaluate(w, function () { return function (q) { return nw.predict(q); }; }, LL.NCLONE, LL.SEED, { noise: gust, jit: LL.JIT });
  var expert = BN.evaluate(w, function () { return BN.expertPolicy(w); }, LL.NEXPERT, LL.SEED, { noise: gust, jit: LL.JIT });
  var held = BN.demos(w, LL.NHELD, BN.rng(99), { noise: dnoise, jit: LL.JIT }).map(function (ro) { return { S: ro.S, A: ro.A.map(function (u, t) { return nw.predict(ro.S[t]); }) }; });
  return { n: n, m: m, dnoise: dnoise, gust: gust, w: w, nw: nw, demos: runs, frames: nw.n, clone: clone, expert: expert, held: held, T: clone.T,
    groups: { own: clone.rolls, exp: expert.rolls, held: held }, acc: { own: newBins(), exp: newBins(), held: newBins() }, done: { own: 0, exp: 0, held: 0 } };
};

function newBins() { var a = []; for (var i = 0; i < LL.NB; i++) a.push({ n: 0, se: 0, ss: 0, dd: 0, ds: 0, m: 0 }); return a; }

/* fold the runs [from, to) of one group into the accumulators: spread over d, copy error by d (command taken vs the expert's at the same state), drift of d */
LL.measure = function (sim, group, from, to) {
  var rolls = sim.groups[group], bins = sim.acc[group], w = sim.w, nw = sim.nw, withErr = group !== 'exp', t;
  to = Math.min(to, rolls.length);
  for (var k = from; k < to; k++) {
    var ro = rolls[k], d = ro.S.map(function (q) { return LL.dist(nw, q); });
    for (t = 0; t < ro.A.length; t++) {
      var b = bins[LL.bin(d[t])]; b.n++;
      if (withErr) { var a = BN.slalom.expertAct(w, ro.S[t]), p = ro.A[t]; b.se += Math.pow(p[0] - a[0], 2) + Math.pow(p[1] - a[1], 2); b.ss += a[0] * a[0] + a[1] * a[1]; }
    }
    for (t = 0; t + 1 < d.length; t++) { var bb = bins[LL.bin(d[t])]; bb.dd += d[t + 1] - d[t]; bb.ds += d[t]; bb.m++; }
  }
  sim.done[group] = Math.max(sim.done[group], to);
};
LL.measureAll = function (sim) { Object.keys(sim.groups).forEach(function (g) { LL.measure(sim, g, 0, sim.groups[g].length); }); return LL.summary(sim); };

/* the numbers of one group of runs, from whatever has been folded in so far */
LL.groupSummary = function (bins, withErr) {
  var tot = 0, se = 0, ss = 0, i, out = { n: 0, err: NaN, bins: [] };
  for (i = 0; i < LL.NB; i++) { tot += bins[i].n; se += bins[i].se; ss += bins[i].ss; }
  for (i = 0; i < LL.NB; i++) {
    var b = bins[i], dm = b.m ? b.ds / b.m : NaN, dr = b.m ? b.dd / b.m : NaN;
    out.bins.push({ n: b.n, m: b.m, share: tot ? b.n / tot : 0, err: withErr && b.ss > 0 ? Math.sqrt(b.se / b.ss) : NaN, drift: dr, meanD: dm, pull: b.m ? -dr / dm : NaN });
  }
  out.n = tot; out.err = withErr && ss > 0 ? Math.sqrt(se / ss) : NaN;
  out.beyond1 = out.bins[2].share + out.bins[3].share + out.bins[4].share;      // share of frames at least one bandwidth from the data
  return out;
};
LL.summary = function (sim) { return { own: LL.groupSummary(sim.acc.own, true), exp: LL.groupSummary(sim.acc.exp, false), held: LL.groupSummary(sim.acc.held, true) }; };

/* the cost curve of a set of rollouts: C(t) = expected steps lost among the first t (collided, or farther than the tube from the expert's path), and h = 2 C(T) / T^2 */
LL.cost = function (ev) {
  var C = BN.costCurve(ev.rolls, ev.T, LL.TUBE);
  return { C: C, T: ev.T, total: C[ev.T], hazard: 2 * C[ev.T] / (ev.T * ev.T), succ: ev.succ };
};
/* the clone and its cost on an n-post course, without the expert or the d statistics (the six-course sweep needs nothing else) */
LL.costOnly = function (n, m, dnoise, gust) {
  var w = BN.slalom.world(n), nw = new BN.NW(LL.H), runs = BN.demos(w, m, BN.rng(1), { noise: dnoise, jit: LL.JIT });
  runs.forEach(function (ro) { for (var t = 0; t < ro.A.length; t++) nw.add(ro.S[t], ro.A[t]); });
  return LL.cost(BN.evaluate(w, function () { return function (q) { return nw.predict(q); }; }, LL.NCLONE, LL.SEED, { noise: gust, jit: LL.JIT }));
};
/* log–log slope of the lost steps against the number of steps allowed, over a set of (T, C) points */
LL.exponent = function (pts) {
  var f = BN.stats.logslope(pts.map(function (p) { return p.T; }), pts.map(function (p) { return p.total; }));
  return { slope: f.slope, r2: f.r2 };
};

root.LL = LL;
if (typeof module !== 'undefined' && module.exports) module.exports = LL;
})(typeof window !== 'undefined' ? window : globalThis);
