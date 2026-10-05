/* exchange_lab.js — lesson 1's private engine: every source of data in one unit, the exchange rate.
 *
 * The task is the layouts task of lessons 7 and 8 (bodies_lab.js, BL): the policy copies the stored demonstration of the layout nearest to a new one.  Your arm A holds n layouts of its
 * own; a source adds m ATTEMPTED layouts of its own (attempted, because a laboratory keeps only the demonstrations that succeeded).  One layout is one demonstration of 9.3 s of motion.
 *   S         success of the pooled set on 1000 fresh layouts, with its Wilson interval
 *   N_eq(S)   the number of own layouts whose own curve reaches S (BL.equivalentOwn: the running maximum of the curve, linear in between, the origin below the first point)
 *   rho       the exchange rate (N_eq(S) - n) / m: own layouts replaced per attempted layout of the source (so own hours per source hour); 1 = as good as your own, 0 = worthless, below 0 = harmful
 * The interval of rho pushes the Wilson interval of S through the inversion.  It is the sampling error of the 1000 test layouts and nothing else: not the draw of the layouts, not the noise of the own curve.
 * This file adds the sources that bodies_lab.js does not have, the footage of a person and the simulators whose arm model is off by a fraction of a link, exactly as
 * tools/chain/verify/engine/build_ledger.js built them for the ledger (so the cells agree with LG.TABLE).  The contact block applies the same idea to a source that lacks a column:
 * the "own curve" is the with-force clone of insertion_lab.js (IL), the "source" the same demonstrations with the force channels dropped, used alone.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var BL = root.BL || require('./bodies_lab.js');
var IL = root.IL || require('./insertion_lab.js');
var EX = {};
EX.GAPS = [0.001, 0.003, 0.01, 0.03];
EX.M = BL.MS.slice();                                                    // attempted layouts offered: 0, 4, ..., 256
EX.BASES = [8, 32];                                                      // own layouts held
EX.SOURCES = [
  { key: 'twin', body: 'twin', space: 'hand', label: 'an arm of the same make' },
  { key: 'old', body: 'old', space: 'hand', label: 'an older arm, another laboratory' },
  { key: 'video', body: 'video', space: 'hand', label: 'footage of a person' },
  { key: 'sim0.001', body: 'sim0.001', space: 'joint', gap: 0.001, label: 'simulator, arm model off by 0.1 %' },
  { key: 'sim0.003', body: 'sim0.003', space: 'joint', gap: 0.003, label: 'simulator, off by 0.3 %' },
  { key: 'sim0.01', body: 'sim0.01', space: 'joint', gap: 0.01, label: 'simulator, off by 1 %' },
  { key: 'sim0.03', body: 'sim0.03', space: 'joint', gap: 0.03, label: 'simulator, off by 3 %' },
  { key: 'simH0.03', body: 'sim0.03', space: 'hand', gap: 0.03, label: 'simulator, off by 3 %, hand labels' }
];
EX.source = function (key) { for (var i = 0; i < EX.SOURCES.length; i++) if (EX.SOURCES[i].key === key) return EX.SOURCES[i]; return null; };

/* the bodies of the two extra sources.  Footage: a person's hand wobbles more than the arm (0.12 against 0.08), is slower, and is tracked in pixels with 3 mm of error. */
EX.install = function () {
  if (BL.__exchange) return;
  var demo0 = BL.demo;
  BL.demo = function (body, theta, seed) {
    var d = demo0(body, theta, seed);
    if (body.labelNoise) { var r = BN.rng(seed * 7 + 3); for (var i = 0; i < d.P.length; i++) d.P[i] += body.labelNoise * BN.randn(r); }
    return d;
  };
  BL.bodies.video = { name: 'footage of a person', L1: 0.5, L2: 0.5, gain: 0.85, rgain: 0.85, lag: 0, noise: 0.12, labelNoise: 0.003 };
  EX.GAPS.forEach(function (g) { BL.bodies['sim' + g] = { name: 'simulator, links off by ' + (g * 100) + ' %', L1: 0.5 * (1 + g), L2: 0.5 * (1 - g), gain: 0.85 }; });
  BL.__exchange = true;
};
EX.install();

/* frames stored from the kept demonstrations of the first m attempted layouts of a body; how many were kept */
EX.frames = function (body, m) { return BL.file(body).filter(function (d) { return d.k < m; }).reduce(function (a, d) { return a + d.n; }, 0); };
/* the mean gap (cm) between where a simulator's hand went and where arm A's hand goes when A tracks the simulator's joint angles (joint labels) */
EX.gapCm = function (key) { return BL.gap(EX.source(key).body) * 100; };

/* one operating point: n own layouts plus the first m attempted layouts of the source.  Memoised. */
EX.memo = {};
EX.cell = function (key, na, m) {
  var id = key + '|' + na + '|' + m, S = EX.source(key);
  if (EX.memo[id]) return EX.memo[id];
  var cur = BL.ownCurve(S.space), r = BL.setting({ na: na, body: S.body, m: m, w: 1, space: S.space });
  var at = function (s) { return m > 0 ? (BL.equivalentOwn(cur, s) - na) / m : NaN; };
  return (EX.memo[id] = { key: key, na: na, m: m, s: r.succ, lo: r.ci[0], hi: r.ci[1], kept: r.kept, frames: m > 0 ? EX.frames(S.body, m) : 0,
    neq: BL.equivalentOwn(cur, r.succ), rho: at(r.succ), rlo: at(r.ci[0]), rhi: at(r.ci[1]) });
};

/* the contact block: m demonstrations of the yielding policy on the 1 mm peg; the clone built from them with and without the force channels; 200 attempts each */
EX.CM = [1, 2, 3, 5, 10, 20, 40];
EX.cmemo = {};
EX.contact = function (m) {
  if (EX.cmemo[m]) return EX.cmemo[m];
  var W = IL.world(1.0), rolls = IL.demos(W, m, 23), out = { m: m };
  [true, false].forEach(function (withForce) {
    var fr = IL.frames(rolls, withForce), cl = IL.clone(fr, withForce), ev = IL.evaluate(W, function () { return cl; }, 200, 5);
    out[withForce ? 'f' : 'n'] = { s: ev.succ, lo: ev.ci[0], hi: ev.ci[1], frames: fr.X.length };
  });
  return (EX.cmemo[m] = out);
};
/* how many with-force demonstrations the m demonstrations without force are worth, read off the with-force curve; nothing of your own is held (n = 0) */
EX.contactRate = function (m) {
  var c = EX.contact(m), f = EX.contact(EX.CM[0]), cur = { N: [EX.CM[0]], s: [f.f.s] }, at = function (s) { return BL.equivalentOwn(cur, s); };
  return { neq: at(c.n.s), rho: at(c.n.s) / m, rlo: at(c.n.lo) / m, rhi: at(c.n.hi) / m };
};

root.EX = EX;
if (typeof module !== 'undefined' && module.exports) module.exports = EX;
})(typeof window !== 'undefined' ? window : globalThis);
