/* dagger_lab.js — lesson 3's private engine: put the states the policy reaches into the training set, labelled by someone who knows.
 *
 * A session is one run of the loop on the five-post course.  Round 0 is the demonstrations (20 calm runs of the expert, as in lessons 1 and 2).  Each later round
 * runs the current clone for PER = 5 rollouts under the gust, someone labels what it visited, and the new frames are added to everything stored (aggregation).
 * The clone is lesson 1's nearest-demo kernel regressor, so "retrain" is "store".  Who labels is the one thing that changes between sessions:
 *   prog    the Bench's expert program labels every visited state exactly (it is a function of the joint angles, so it can answer for any state)
 *   replay  a person replays the clone's run and steers along: the label of a frame is the expert's command for the state the person saw tau frames earlier
 *   take    a person takes over when the cup is more than TOL from the path, after tau frames of reaction, drives until it is within BACK, hands back;
 *           only the frames the person drove are labelled
 *   two     two people (operator A passes the first post above, B below) share the demonstrations and the labelling: each run is labelled by one of them
 * drive = 'latest' retrains after every round (DAgger); 'first' keeps collecting every round from the first clone and retrains on the lot.
 * Everything is a function of the seed, which only selects the stream the collection rollouts draw from.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var DL = {};
DL.H = [0.02, 0.02];
DL.JIT = 0.01; DL.GUST = 0.05; DL.TUBE = 0.04;
DL.NEVAL = 200; DL.SEED = 5;                         // evaluation: 200 rollouts from jittered starts, gust 0.05, as in lessons 1 and 2
DL.NPOSTS = 5; DL.DEMOS = 20; DL.PER = 5; DL.MAXR = 10;
DL.DEFAULT_SEED = 8;                                 // of eight collection seeds, the one whose success curve lies closest to their average
DL.TOL = 0.025; DL.BACK = 0.01;                      // metres from the path: where a person takes over, and where the person hands back
DL.DT = 0.05;                                        // seconds per frame
DL.WA = BN.slalom.world(DL.NPOSTS, { s0: 1 });       // operator A: first post passed above
DL.WB = BN.slalom.world(DL.NPOSTS, { s0: -1 });      // operator B: first post passed below (same posts)
DL.GUSTS = { calm: 0, g05: 0.05, g10: 0.10, g15: 0.15 };

/* ───────────── a session of the loop ───────────── */
DL.session = function (who, tau, drive, seed) {
  var s = { who: who, tau: who === 'replay' || who === 'take' ? tau : 0, drive: drive, seed: seed, X: [], Y: [], F: [], R: [], nws: {}, evs: {} };
  s.rng = BN.rng(100 + seed); s.pick = BN.rng(500 + seed);
  var put = function (rolls) { rolls.forEach(function (ro) { for (var t = 0; t < ro.A.length; t++) { s.X.push(ro.S[t]); s.Y.push(ro.A[t]); } }); };
  if (who === 'two') { put(BN.demos(DL.WA, DL.DEMOS / 2, BN.rng(1), { noise: 0, jit: DL.JIT })); put(BN.demos(DL.WB, DL.DEMOS / 2, BN.rng(1), { noise: 0, jit: DL.JIT })); }
  else put(BN.demos(DL.WA, DL.DEMOS, BN.rng(1), { noise: 0, jit: DL.JIT }));
  s.F.push(s.X.length); s.R.push({ rollouts: 0, collided: 0, labelled: 0 });
  return s;
};
/* the clone after round k: the kernel regressor over the first F[k] stored frames */
DL.clone = function (s, k) {
  if (s.nws[k]) return s.nws[k];
  var nw = new BN.NW(DL.H); for (var i = 0; i < s.F[k]; i++) nw.add(s.X[i], s.Y[i]);
  return (s.nws[k] = nw);
};
/* the kernel answer at a query, written out for speed: the same cells, the same order and the same arithmetic as BN.NW.predict, so the same numbers */
DL.predict = function (nw, q) {
  var h0 = nw.h[0], h1 = nw.h[1], q0 = q[0], q1 = q[1], c0 = Math.floor(q0 / nw.cell[0]) + 1024, c1 = Math.floor(q1 / nw.cell[1]) + 1024, g = nw.g, o0 = 0, o1 = 0, tot = 0;
  for (var i0 = -1; i0 <= 1; i0++) for (var i1 = -1; i1 <= 1; i1++) {
    var a = g[(c0 + i0) * 2048 + c1 + i1]; if (!a) continue;
    for (var t = 0; t < a.length; t++) {
      var id = a[t], x = nw.X[id], z0 = (x[0] - q0) / h0, z1 = (x[1] - q1) / h1, e = z0 * z0 + z1 * z1;
      if (e > 9) continue;
      var w = Math.exp(-0.5 * e), y = nw.Y[id]; tot += w; o0 += w * y[0]; o1 += w * y[1];
    }
  }
  if (tot < 1e-12) { var nb = nw.nearest(q); return nb < 0 ? [0, 0] : nw.Y[nb].slice(); }
  return [o0 / tot, o1 / tot];
};
/* one more round: PER rollouts of the policy, labelled by the session's labeller, added at the end of the round */
DL.collect = function (s) {
  var k = s.F.length - 1, nw = DL.clone(s, s.drive === 'first' ? 0 : k), wA = DL.WA, wB = DL.WB, fresh = [], rec = { rollouts: 0, collided: 0, labelled: 0 }, j, t;
  for (j = 0; j < DL.PER; j++) {
    var ro;
    if (s.who === 'take') {
      var mode = 0, cnt = 0, tau = s.tau;
      ro = BN.rollout(wA, function (q) {
        var dev = BN.slalom.dev(wA, BN.arm.fk(q, wA.body));
        if (mode === 0 && dev > DL.TOL) { mode = 1; cnt = 0; }
        if (mode === 1) { cnt++; if (cnt > tau) mode = 2; }
        if (mode === 2 && dev < DL.BACK) mode = 0;
        if (mode === 2) { var a = BN.slalom.expertAct(wA, q); fresh.push([q, a]); return a; }
        return DL.predict(nw, q);
      }, s.rng, { noise: DL.GUST, jit: DL.JIT });
    } else {
      var op = s.who === 'two' && s.pick() < 0.5 ? wB : wA;
      ro = BN.rollout(wA, function (q) { return DL.predict(nw, q); }, s.rng, { noise: DL.GUST, jit: DL.JIT });
      for (t = 0; t < ro.S.length; t++) fresh.push([ro.S[t], BN.slalom.expertAct(op, ro.S[Math.max(0, t - s.tau)])]);
    }
    rec.rollouts++; if (ro.coll) rec.collided++;
  }
  fresh.forEach(function (f) { s.X.push(f[0]); s.Y.push(f[1]); });
  rec.labelled = fresh.length; s.F.push(s.X.length); s.R.push(rec);
  return rec;
};
DL.ensure = function (s, k) { while (s.F.length - 1 < k) DL.collect(s); };

/* ───────────── what a clone's own frames look like ───────────── */
/* distance from a state to the nearest stored frame, in bandwidths; 3 when nothing is stored within the kernel's reach */
DL.dist = function (nw, q) {
  var h0 = nw.h[0], h1 = nw.h[1], q0 = q[0], q1 = q[1], c0 = Math.floor(q0 / nw.cell[0]) + 1024, c1 = Math.floor(q1 / nw.cell[1]) + 1024, best = Infinity;
  for (var i0 = -1; i0 <= 1; i0++) for (var i1 = -1; i1 <= 1; i1++) {
    var a = nw.g[(c0 + i0) * 2048 + c1 + i1]; if (!a) continue;
    for (var t = 0; t < a.length; t++) { var x = nw.X[a[t]], z0 = (x[0] - q0) / h0, z1 = (x[1] - q1) / h1, e = z0 * z0 + z1 * z1; if (e < best) best = e; }
  }
  return best > 9 ? 3 : Math.sqrt(best);
};
/* expected number of the first T steps that were lost: collided, or farther than TUBE from the nearest path of the given worlds, or never finished */
DL.lost = function (rolls, T, worlds) {
  var tot = 0, i, t;
  for (i = 0; i < rolls.length; i++) {
    var ro = rolls[i], lost = 0, dev = ro.dev;
    if (worlds.length > 1) dev = ro.P.map(function (p) { var m = Infinity; worlds.forEach(function (w) { m = Math.min(m, BN.slalom.dev(w, p)); }); return m; });
    for (t = 0; t < T; t++) {
      var bad = ro.coll && t >= ro.steps;
      if (!bad && t < dev.length && dev[t] > DL.TUBE) bad = true;
      if (!bad && !ro.done && !ro.coll && t >= dev.length) bad = true;
      if (bad) lost++;
    }
    tot += lost;
  }
  return tot / rolls.length;
};
/* the clone after round k, run 200 times: success, collisions, steps lost, and (for one expert) the copy error on its own frames, the share of them at least
 * one bandwidth from the stored frames, and the pull-back per step in the 0.5 to 1 bandwidth bin */
DL.evaluate = function (s, k) {
  DL.ensure(s, k); if (s.evs[k]) return s.evs[k];
  var nw = DL.clone(s, k), wA = DL.WA, two = s.who === 'two';
  var ev = BN.evaluate(wA, function () { return function (q) { return DL.predict(nw, q); }; }, DL.NEVAL, DL.SEED, { noise: DL.GUST, jit: DL.JIT });
  var out = { k: k, frames: s.F[k], labelled: s.F[k] - s.F[0], succ: ev.succ, ci: ev.ci, coll: ev.coll, T: ev.T, C: DL.lost(ev.rolls, ev.T, two ? [DL.WA, DL.WB] : [DL.WA]) };
  var se = 0, ss = 0, n = 0, far = 0, dd = 0, ds = 0, m = 0, post1 = 0, i, t;
  ev.rolls.forEach(function (ro) {
    var d = ro.S.map(function (q) { return DL.dist(nw, q); });
    for (t = 0; t < ro.A.length; t++) {
      n++; if (d[t] >= 1) far++;
      if (!two) { var a = BN.slalom.expertAct(wA, ro.S[t]), p = ro.A[t]; se += Math.pow(p[0] - a[0], 2) + Math.pow(p[1] - a[1], 2); ss += a[0] * a[0] + a[1] * a[1]; }
    }
    for (t = 0; t + 1 < d.length; t++) if (d[t] >= 0.5 && d[t] < 1) { dd += d[t + 1] - d[t]; ds += d[t]; m++; }
    if (ro.coll) { var pe = ro.P[ro.P.length - 1], best = Infinity, bi = 0; wA.posts.forEach(function (c, ci) { var e = Math.hypot(pe[0] - c[0], pe[1] - c[1]); if (e < best) { best = e; bi = ci; } }); if (bi === 0) post1++; }
  });
  out.far = far / n; out.err = two ? NaN : Math.sqrt(se / ss); out.pull = m && !two ? -dd / ds : NaN; out.pullSteps = m; out.post1 = post1 / ev.N;
  out.collected = 0; out.rollouts = 0; for (i = 1; i <= k; i++) { out.collected += s.R[i].collided; out.rollouts += s.R[i].rollouts; }
  out.show = ev.rolls.slice(0, 12).map(function (ro) { return { P: ro.P, coll: ro.coll, done: ro.done }; });
  return (s.evs[k] = out);
};
/* what the policy answers at the start frame, next to what each operator answers, as cup velocities (m/s) */
DL.startFrame = function (s, k) {
  var wA = DL.WA, wB = DL.WB, q0 = BN.slalom.startQ(wA, 0), J = BN.arm.jac(q0, wA.body), nw = DL.clone(s, k);
  var cup = function (u) { return [J[0] * u[0] + J[1] * u[1], J[2] * u[0] + J[3] * u[1]]; };
  var A = cup(BN.slalom.expertAct(wA, q0)), B = cup(BN.slalom.expertAct(wB, q0)), P = cup(DL.predict(nw, q0));
  var deg = function (v) { return Math.atan2(v[1], v[0]) * 180 / Math.PI; };
  return { A: A, B: B, P: P, degA: deg(A), degB: deg(B), degP: deg(P), cup: BN.arm.fk(q0, wA.body) };
};

/* ───────────── the other ways to buy displaced frames: whole demonstrations until the same number of frames are stored ───────────── */
DL.baseline = function (kind, frames) {
  var g = DL.GUSTS[kind], nw = new BN.NW(DL.H), rng = BN.rng(1), wA = DL.WA, tot = 0, m = 0, crashed = 0;
  while (tot < frames) {
    var ro = BN.rollout(wA, BN.expertPolicy(wA), rng, { noise: g, jit: DL.JIT });
    for (var t = 0; t < ro.A.length; t++) nw.add(ro.S[t], ro.A[t]);
    tot += ro.A.length; m++; if (ro.coll) crashed++;
  }
  var ev = BN.evaluate(wA, function () { return function (q) { return DL.predict(nw, q); }; }, DL.NEVAL, DL.SEED, { noise: DL.GUST, jit: DL.JIT });
  return { kind: kind, frames: tot, demos: m, crashed: crashed, succ: ev.succ, ci: ev.ci };
};

root.DL = DL;
if (typeof module !== 'undefined' && module.exports) module.exports = DL;
})(typeof window !== 'undefined' ? window : globalThis);
