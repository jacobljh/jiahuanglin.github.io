/* alloc_lab.js — the private engine of lesson 6 (the allocation problem): three capabilities, their sources, a budget, and the plans that spend it.
 *
 * No new Bench measurement: every curve is a cell of LG.TABLE and every price is LG.price on LG.assume.  Three capabilities, each measured on the task of the robot lesson that introduced it:
 *   generalise  how many layouts the policy has seen (layouts task): the programme holds 8 own layouts; sources: a simulator (gap g), the twin arm, the older arm, footage, more own layouts
 *   recover     the five-post course under a gust: the programme holds 20 calm demonstrations; sources: own demonstrations recorded under gust 0.05 or 0.10, corrections (they need a pipeline)
 *   contact     the peg with 1 mm of clearance: the programme holds force-less insertions (a plateau); source: force-bearing insertions (they need the rig)
 * A COLUMN is the list of PLANS for one capability, each a point (x dollars, s success): the cheapest way to reach s.  A plan counts as better than a cheaper one only if it adds one point of
 * success (AL.MIN: the table's cells are 200 or 1000 runs, so a smaller step is noise).  The programme succeeds when all three do, P = s_gen s_rec s_con.
 *   AL.A            the lesson's own assumptions: K (hours multiplied by K, prices and rates unchanged), rig (LG.assume.force_rig_cost), pipe (a correction pipeline), sim (which simulator)
 *   AL.build(o)     the columns at scale K: {cols: [{name, s0, pts, hull, blocks}]}; hull = the upper concave majorant of ln s against x; blocks = its pieces {dx, dg, lam = d ln s per dollar}
 *   AL.best(m, B)   the exhaustive search: the best plan (one point per column) that costs at most B, by ln P (or by the sum of the levels with f = 'sum')
 *   AL.sequence(m)  every block of every column, in order of marginal value per dollar: the order of purchases
 *   AL.rule(m, B)   spend B by that order, buying every block that still fits
 *   AL.without(m)   the same model with no instrument on offer: the rig and the pipeline are not for sale, so force-bearing hours and corrections cannot be bought
 *   AL.mixture / AL.tuned / AL.bestMixture   a fixed share of the budget to each column; the shares of the best plan at one budget; the best fixed shares over a set of budgets
 *   AL.priceRank    lesson 2's order: the cheapest hour first, each source to the end of its catalogue
 *   AL.threshold    the smallest budget at which the best plan buys force-bearing hours (and with them the rig)
 */
(function (root) {
'use strict';
var LG = root.LG, AL = {};
var H1 = LG.hours(1), SEC_INS = LG.TABLE.contact.secPerAttempt, HZ = 20, NAMES = ['generalise', 'recover', 'contact'];
AL.NAMES = NAMES; AL.H1 = H1; AL.SEC_INS = SEC_INS; AL.BASE = { gen: 8, rec: 20 }; AL.MIN = 0.01;
AL.A = { K: 1000, rig: LG.assume.force_rig_cost, pipe: 2 * LG.assume.week_cost, sim: 'sim0.01' };      // pipe: two engineer-weeks, at the ledger's week cost
AL.opts = function (o) { var r = {}, k; for (k in AL.A) r[k] = o && o[k] !== undefined ? o[k] : AL.A[k]; return r; };

/* dollars per unit of each source at scale 1: a layout, a demonstration, an insertion attempt; a supervised hour for corrections.  The rig is NOT in the insertion price: lesson 2 wrote it off over the arm's life */
AL.price = function (a) {
  a = a || LG.assume; var z = LG.copyAssume(), k; for (k in a) z[k] = a[k]; z.force_rig_cost = 0;
  return { sim: LG.price('sim', a) * H1, twin: LG.price('twin', a) * H1, old: LG.price('old', a) * H1, video: LG.price('video', a) * (1 - a.video_discard) * H1, own: LG.price('own', a) * H1,
           corrHour: LG.price('corr', a), insertion: LG.price('force', z) * SEC_INS / 3600 };
};
function runmax(a) { var m = -Infinity; return a.map(function (v) { m = Math.max(m, v); return m; }); }
function pareto(pts) {                                                  // keep a plan only if it is dearer than the one before and adds at least AL.MIN to every cheaper plan
  pts = pts.slice().sort(function (p, q) { return p.x - q.x || q.s - p.s; });
  var out = [], best = -Infinity, i;
  for (i = 0; i < pts.length; i++) if (i === 0 || pts[i].s >= best + AL.MIN - 1e-12) { out.push(pts[i]); best = pts[i].s; }
  return out;
}
function hullOf(pts) {                                                  // upper concave majorant of (x, ln s): the plans on the straight pieces of the best spending path
  var h = [], i, g = function (p) { return Math.log(p.s); };
  for (i = 0; i < pts.length; i++) {
    while (h.length > 1) {
      var o = h[h.length - 2], a = h[h.length - 1], p = pts[i];
      if ((a.x - o.x) * (g(p) - g(o)) - (g(a) - g(o)) * (p.x - o.x) >= 0) h.pop(); else break;
    }
    h.push(pts[i]);
  }
  return h;
}
function finish(cols) {
  cols.forEach(function (c, j) {
    c.pts = pareto(c.pts); c.hull = hullOf(c.pts); c.blocks = [];
    for (var k = 1; k < c.hull.length; k++) c.blocks.push({ col: j, k: k, dx: c.hull[k].x - c.hull[k - 1].x, dg: Math.log(c.hull[k].s / c.hull[k - 1].s), lam: Math.log(c.hull[k].s / c.hull[k - 1].s) / (c.hull[k].x - c.hull[k - 1].x), to: c.hull[k] });
  });
}
AL.build = function (o) {
  o = AL.opts(o); var K = o.K, T = LG.TABLE, S = T.layouts, R = T.recover, C = T.contact, p = AL.price(), cols = [], i;
  /* generalise: foreign layouts added to 8 own layouts; x = K x (price per layout) x (attempted layouts) */
  var gs0 = S.ownHand.s[S.ownHand.N.indexOf(AL.BASE.gen)], gp = [{ x: 0, s: gs0, src: 'own', n: 0 }];
  [[o.sim, 'sim', p.sim], ['twin', 'twin', p.twin], ['old', 'old', p.old], ['video', 'video', p.video]].forEach(function (q) {
    var cur = runmax(S.src[q[0]].s[AL.BASE.gen]);
    for (i = 1; i < S.M.length; i++) gp.push({ x: K * q[2] * S.M[i], s: cur[i], src: q[1], n: K * S.M[i] });
  });
  var os = runmax(S.ownHand.s);
  for (i = 0; i < S.ownHand.N.length; i++) if (S.ownHand.N[i] > AL.BASE.gen) gp.push({ x: K * p.own * (S.ownHand.N[i] - AL.BASE.gen), s: os[i], src: 'ownL', n: K * (S.ownHand.N[i] - AL.BASE.gen) });
  cols.push({ name: NAMES[0], key: 'gen', s0: gs0, pts: gp });
  /* recover: demonstrations recorded under a gust, or rounds of corrections on top of the 20 calm demonstrations (the pipeline is a fixed cost) */
  var rs0 = R.calm.s[R.n.indexOf(AL.BASE.rec)], rp = [{ x: 0, s: rs0, src: 'calm', n: 0 }];
  [['g05', R.g05], ['g10', R.g10]].forEach(function (q) { var cur = runmax(q[1].s); for (i = 0; i < R.n.length; i++) rp.push({ x: K * p.own * R.n[i], s: cur[i], src: q[0], n: K * R.n[i] }); });
  var cs = runmax(R.corr.s);
  for (i = 1; i < R.corr.rounds.length; i++) rp.push({ x: o.pipe + K * p.corrHour * R.corr.labelled[i] / HZ / 3600, s: cs[i], src: 'corr', n: K * R.corr.rollouts[i], inst: o.pipe > 0 });
  cols.push({ name: NAMES[1], key: 'rec', s0: rs0, pts: rp });
  /* contact: force-less insertions plateau; force-bearing ones need the rig, a fixed cost */
  var ks = C.noForce.s.slice(1), cs0 = ks.reduce(function (a, b) { return a + b; }, 0) / ks.length, kp = [{ x: 0, s: cs0, src: 'stock', n: 0 }], fs = runmax(C.withForce.s);
  for (i = 0; i < C.m.length; i++) kp.push({ x: o.rig + K * p.insertion * C.m[i], s: fs[i], src: 'force', n: K * C.m[i], inst: o.rig > 0 });
  cols.push({ name: NAMES[2], key: 'con', s0: cs0, pts: kp });
  finish(cols);
  return { cols: cols, o: o, p: p };
};
AL.drop = function (m, fn) {
  var cols = m.cols.map(function (c) { return { name: c.name, key: c.key, s0: c.s0, pts: c.pts.filter(function (q) { return !fn(q); }) }; });
  finish(cols); return { cols: cols, o: m.o, p: m.p };
};
AL.without = function (m) { return AL.drop(m, function (q) { return q.inst; }); };      // no instrument on offer: a source that needs a fixed cost cannot be bought
AL.prod = function (lv) { return lv.reduce(function (a, s) { return a * s; }, 1); };
/* the exhaustive search over plans: one point per column, total cost at most B, the largest ln P (or the largest sum of the levels with f = 'sum') */
AL.best = function (m, B, f) {
  var A = m.cols[0].pts, Bp = m.cols[1].pts, Cp = m.cols[2].pts, bestV = -Infinity, bi = [0, 0, 0], i, j, k, v, sum = f === 'sum';
  for (i = 0; i < A.length && A[i].x <= B + 1e-9; i++) for (j = 0; j < Bp.length && A[i].x + Bp[j].x <= B + 1e-9; j++) for (k = 0; k < Cp.length && A[i].x + Bp[j].x + Cp[k].x <= B + 1e-9; k++) {
    v = sum ? A[i].s + Bp[j].s + Cp[k].s : Math.log(A[i].s * Bp[j].s * Cp[k].s);
    if (v > bestV + 1e-12) { bestV = v; bi = [i, j, k]; }
  }
  return AL.planOf(m, bi);
};
AL.planOf = function (m, idx) {
  var pt = idx.map(function (i, c) { return m.cols[c].pts[i]; }), lv = pt.map(function (q) { return q.s; });
  return { idx: idx, pt: pt, s: lv, x: pt.map(function (q) { return q.x; }), spent: pt.reduce(function (a, q) { return a + q.x; }, 0), P: AL.prod(lv) };
};
AL.sequence = function (m) {
  var all = [];
  m.cols.forEach(function (c) { c.blocks.forEach(function (b) { all.push(b); }); });
  return all.sort(function (a, b) { return b.lam - a.lam || a.col - b.col; });
};
/* spend B in order of marginal value per dollar: a block that does not fit closes its column and the next block that fits is bought; what is left buys the best single step that still fits */
AL.rule = function (m, B) {
  var open = [true, true, true], at = [0, 0, 0], left = B, seq = AL.sequence(m), i, b, j, k;
  for (i = 0; i < seq.length; i++) { b = seq[i]; if (!open[b.col] || b.k !== at[b.col] + 1) continue; if (b.dx <= left + 1e-9) { left -= b.dx; at[b.col] = b.k; } else open[b.col] = false; }
  var idx = at.map(function (a, c) { return m.cols[c].pts.indexOf(m.cols[c].hull[a]); });
  for (;;) {
    var pick = -1, bl = 0;
    for (j = 0; j < 3; j++) { var c = m.cols[j], a = c.pts[idx[j]], n = c.pts[idx[j] + 1]; if (!n || n.x - a.x > left + 1e-9) continue; var l = Math.log(n.s / a.s) / (n.x - a.x); if (l > bl) { bl = l; pick = j; } }
    if (pick < 0) break;
    k = m.cols[pick]; left -= k.pts[idx[pick] + 1].x - k.pts[idx[pick]].x; idx[pick]++;
  }
  var lv = m.cols.map(function (c, j) { return c.pts[idx[j]].s; });
  return { idx: idx, s: lv, P: AL.prod(lv), spent: B - left };
};
/* a fixed share of the budget to each column, each column buying the best plan it can pay for out of its share */
AL.mixture = function (m, f, B) {
  var lv = m.cols.map(function (c, j) { var s = c.pts[0].s, i; for (i = 0; i < c.pts.length; i++) if (c.pts[i].x <= f[j] * B + 1e-9) s = c.pts[i].s; return s; });
  return { s: lv, P: AL.prod(lv) };
};
AL.tuned = function (m, B0) { var b = AL.best(m, B0), t = b.spent || 1; return b.x.map(function (x) { return x / t; }); };      // the shares of the best plan at B0
AL.shares = function (step) { var out = [], a, b, n = Math.round(1 / step); for (a = 0; a <= n; a++) for (b = 0; a + b <= n; b++) out.push([a * step, b * step, (n - a - b) * step]); return out; };
/* the fixed shares that lose least over a set of budgets: the largest mean of ln (P of the mixture / P of the best plan) */
AL.bestMixture = function (m, Bs, step) {
  var opt = Bs.map(function (B) { return AL.best(m, B).P; }), best = null, i, sh = AL.shares(step || 0.05);
  sh.forEach(function (f) {
    var tot = 0, worst = Infinity;
    for (i = 0; i < Bs.length; i++) { var r = AL.mixture(m, f, Bs[i]).P / opt[i]; tot += Math.log(r); worst = Math.min(worst, r); }
    if (!best || tot > best.tot + 1e-12) best = { f: f, tot: tot / Bs.length, worst: worst };
  });
  best.opt = opt; return best;
};
/* lesson 2's ranking: the cheapest hour first, each source bought to the end of its catalogue before the next; what is left buys the largest plan of the next one that it can pay for */
AL.RANK = ['sim', 'twin', 'old', 'video', 'corr', 'own', 'force'];       // by dollars per hour; 'own' is the own robot's hour: demonstrations recorded under a gust, more own layouts
AL.sourceOf = function (src) { return /^sim/.test(src) ? 'sim' : (src === 'g05' || src === 'g10' || src === 'ownL') ? 'own' : src; };
AL.priceRank = function (m, B) {
  var left = B, lv = m.cols.map(function (c) { return c.pts[0].s; }), take = [];
  AL.RANK.forEach(function (src) {
    m.cols.forEach(function (c, j) {
      var i, pick = null;
      for (i = 1; i < c.pts.length; i++) if (AL.sourceOf(c.pts[i].src) === src && c.pts[i].x <= left + 1e-9) pick = c.pts[i];
      if (pick) { left -= pick.x; if (pick.s > lv[j]) lv[j] = pick.s; take.push(pick); }
    });
  });
  return { s: lv, P: AL.prod(lv), spent: B - left, take: take };
};
/* the smallest budget at which the best plan buys the instrument: the cheapest plan with force-bearing hours that beats the best plan without them at its own cost */
AL.threshold = function (m) {
  var m0 = AL.drop(m, function (q) { return q.src === 'force' || q.src === 'corr'; }), A = m.cols[0].pts, Bp = m.cols[1].pts, Cp = m.cols[2].pts, c = [], i, j, k;
  for (i = 0; i < A.length; i++) for (j = 0; j < Bp.length; j++) for (k = 0; k < Cp.length; k++) if (Cp[k].src === 'force') c.push({ x: A[i].x + Bp[j].x + Cp[k].x, P: A[i].s * Bp[j].s * Cp[k].s });
  c.sort(function (a, b) { return a.x - b.x; });
  for (i = 0; i < c.length; i++) if (c[i].P > AL.best(m0, c[i].x).P + 1e-12) return c[i].x;
  return Infinity;
};
/* the smallest budget at which a rule buys force-bearing hours, found by bisection on the budget (a rule is a function of the budget that returns its plan's levels) */
AL.firstBuy = function (fn) { var a = 1, b = 1e10, i, mid; for (i = 0; i < 70; i++) { mid = Math.sqrt(a * b); if (fn(mid).s[2] > 0.7) b = mid; else a = mid; } return b; };
AL.thresholds = function (m) {
  return { exact: AL.threshold(m), rule: AL.firstBuy(function (B) { return AL.rule(m, B); }), rank: AL.firstBuy(function (B) { return AL.priceRank(m, B); }) };
};
/* the plan that maximises the smallest of the three levels (the cheapest such plan when several tie) */
AL.maxmin = function (m, B) {
  var A = m.cols[0].pts, Bp = m.cols[1].pts, Cp = m.cols[2].pts, best = null, i, j, k, v, x;
  for (i = 0; i < A.length; i++) for (j = 0; j < Bp.length; j++) for (k = 0; k < Cp.length; k++) {
    x = A[i].x + Bp[j].x + Cp[k].x; if (x > B + 1e-9) continue; v = Math.min(A[i].s, Bp[j].s, Cp[k].s);
    if (!best || v > best.v + 1e-12 || (Math.abs(v - best.v) <= 1e-12 && x < best.x)) best = { v: v, x: x, idx: [i, j, k] };
  }
  return AL.planOf(m, best.idx);
};
/* d ln s per dollar of the next plan up the column from the plan the column is at (the average over the whole block when the next plan includes the instrument) */
AL.next = function (m, plan) {
  return m.cols.map(function (c, j) { var k = plan.idx[j], a = c.pts[k], b = c.pts[k + 1]; return b ? Math.log(b.s / a.s) / (b.x - a.x) : null; });
};
root.AL = AL;
if (typeof module !== 'undefined' && module.exports) module.exports = AL;
})(typeof window !== 'undefined' ? window : globalThis);
