/* returns_lab.js — lesson 18's private engine: what the next hour of a source is worth, measured by the policy itself.
 *
 * The layouts task of the ledger (bodies_lab.js, lessons 7 and 8): the policy copies the demonstration of the stored layout nearest to the new layout, and
 * success is the share of 1000 test layouts it completes.  A purchase is a pool: your own first na layouts, n layouts of the twin arm (an arm of the same make, labelled in task
 * space) and m layouts of one other source (a simulator whose arm model is off by a gap, joint angles as labels; an older arm; footage).  Each source draws its own 256 layouts
 * (the ledger's table gives every foreign source the same ones, which pairs the sources; a purchase from two of them must not buy the same layouts twice), and a pool of the
 * first n of one list and the first m of another is scored exactly as BL.run scores it: the nearest stored layout of any source, ties to the earlier source, each demonstration
 * executed in its own label space.  The lists are searched once (the nearest of the first j demonstrations, for every j), so a pool costs a few thousand comparisons and only
 * the (demonstration, test layout) pairs not seen before cost a rollout.
 * Everything is a function of fixed seeds.  RT.draw picks another draw of the layouts (0 to 7); the page uses 7, the draw closest to the medians of the eight.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js'), BL = root.BL || require('./bodies_lab.js'), LG = root.LG || require('./ledger.js');
var RT = {};
RT.draw = 7;                                                               // of eight draws of the layouts, the one closest to their medians
RT.CAP = 256;                                                              // attempted layouts one source can supply
RT.SEED = { twin: 2125, other: 2428 };                                     // layout lists, offset by 1000 per draw
RT.GAPS = [0.001, 0.003, 0.01, 0.03];

/* the footage and simulator bodies, added exactly as the table builder adds them */
RT.setup = function () {
  if (RT.ready) return; RT.ready = true;
  var demo0 = BL.demo;
  BL.demo = function (body, theta, seed) {
    var d = demo0(body, theta, seed);
    if (body.labelNoise) { var r = BN.rng(seed * 7 + 3); for (var i = 0; i < d.P.length; i++) d.P[i] += body.labelNoise * BN.randn(r); }
    return d;
  };
  BL.bodies.video = { name: 'footage of a person', L1: 0.5, L2: 0.5, gain: 0.85, rgain: 0.85, lag: 0, noise: 0.12, labelNoise: 0.003 };
  RT.GAPS.forEach(function (g) { BL.bodies['sim' + g] = { name: 'simulator, links off by ' + (g * 100) + ' %', L1: 0.5 * (1 + g), L2: 0.5 * (1 - g), gain: 0.85 }; });
};
/* the other sources: the body that records them, the label space their file is read in, the price line of the ledger, and their key in the ledger's table */
RT.OTHER = {
  'sim0.003': { body: 'sim0.003', space: 'joint', price: 'sim', tab: 'sim0.003', name: 'simulator, 0.3 % gap, joint labels' },
  'sim0.01':  { body: 'sim0.01',  space: 'joint', price: 'sim', tab: 'sim0.01',  name: 'simulator, 1 % gap, joint labels' },
  'sim0.03':  { body: 'sim0.03',  space: 'joint', price: 'sim', tab: 'sim0.03',  name: 'simulator, 3 % gap, joint labels' },
  'simH0.03': { body: 'sim0.03',  space: 'hand',  price: 'sim', tab: 'simH0.03', name: 'simulator, 3 % gap, hand labels' },
  'old':      { body: 'old',      space: 'hand',  price: 'old', tab: 'old',      name: 'older arm, hand labels' },
  'video':    { body: 'video',    space: 'hand',  price: 'video', tab: 'video',  name: 'footage, hand labels' }
};

/* ───────────── lists: the layouts a source supplies, and for every test layout the nearest of the first j kept demonstrations ───────────── */
RT.lists = {};
RT.list = function (role, other) {
  RT.setup();
  var key = role + '|' + (role === 'other' ? other : '') + '|' + RT.draw;
  if (RT.lists[key]) return RT.lists[key];
  var space = role === 'other' ? RT.OTHER[other].space : 'hand', demos, i, k, j;
  if (role === 'own') demos = BL.file('A');
  else {
    var body = role === 'twin' ? BL.bodies.twin : BL.bodies[RT.OTHER[other].body];
    demos = BL.collect(body, BL.layouts(RT.CAP, RT.SEED[role] + 1000 * RT.draw), RT.CAP);
    demos = demos.map(function (d) { var c = Object.create(d); c.id = 'rt' + RT.draw + ':' + role + ':' + d.id; return c; });
  }
  var nd = demos.length, tests = BL.testSet(), NT = tests.length, L = { demos: demos, space: space, nd: nd, cnt: new Int32Array(RT.CAP + 1), bd: new Float64Array(NT * nd), bi: new Int16Array(NT * nd) };
  for (k = 0; k < nd; k++) for (j = demos[k].k + 1; j <= RT.CAP; j++) L.cnt[j]++;                    // kept demonstrations among the first j attempted layouts
  for (i = 0; i < NT; i++) {
    var best = Infinity, bj = 0;
    for (j = 0; j < nd; j++) { var d = BL.dist(tests[i], demos[j].theta); if (d < best) { best = d; bj = j; } L.bd[i * nd + j] = best; L.bi[i * nd + j] = bj; }
  }
  return (RT.lists[key] = L);
};
/* the outcome of following one demonstration on test layout k: 1 completed, 2 touched a post, 3 timed out (memoised, shared with BL.run) */
RT.outcome = function (dm, space, k) {
  var key = dm.id + '|' + space + '|' + k, r = BL.cache[key];
  if (!r) { var th = BL.testSet()[k], me = BL.bodies.A, ro = BL.execute(me, BL.world(th, me), dm, space, BN.rng(1000 * BL.EVSEED + k + 1)); r = BL.cache[key] = ro.done ? 1 : (ro.coll ? 2 : 3); }
  return r;
};

/* ───────────── a pool and its success ───────────── */
/* sp = {na, n, m, other}: na own layouts, n attempted twin layouts, m attempted layouts of the other source.  Returns the success on the 1000 test layouts and, per source, the share
 * of test layouts whose nearest stored layout belongs to it and the success on those layouts. */
RT.scores = {};
RT.score = function (sp) {
  var key = [sp.na, sp.n, sp.m, sp.other, RT.draw].join('|');
  if (RT.scores[key]) return RT.scores[key];
  var Ls = [RT.list('own'), RT.list('twin'), RT.list('other', sp.other)], use = [sp.na, Ls[1].cnt[sp.n], sp.m > 0 ? Ls[2].cnt[sp.m] : 0];
  var NT = BL.testSet().length, pick = [0, 0, 0], good = [0, 0, 0], ok = 0, k, s;
  for (k = 0; k < NT; k++) {
    var bestD = Infinity, src = -1, idx = 0;
    for (s = 0; s < 3; s++) {
      if (use[s] === 0) continue;
      var d = Ls[s].bd[k * Ls[s].nd + use[s] - 1];
      if (d < bestD) { bestD = d; src = s; idx = Ls[s].bi[k * Ls[s].nd + use[s] - 1]; }
    }
    var r = RT.outcome(Ls[src].demos[idx], Ls[src].space, k);
    pick[src]++; if (r === 1) { ok++; good[src]++; }
  }
  return (RT.scores[key] = { succ: ok / NT, ok: ok, N: NT, pick: pick, good: good, kept: use });
};

/* ───────────── prices: dollars per attempted layout, from the ledger's price of an hour ───────────── */
/* Footage is priced per attempted hour, as in lesson 17: its exchange rate is measured per attempted hour and already contains its discards, so they are paid for once. */
RT.cost = function (priceKey, assume) {
  var a = assume || LG.assume, hour = priceKey === 'video' ? (a.video_wage_per_h + a.track_per_h) / a.video_duty : LG.price(priceKey, a);
  return hour * LG.hours(1);
};

/* ───────────── the rule, applied to a budget B ───────────── */
/* sp0 = {na, other}; cT, cO the dollars per layout of the twin and of the other source.  A split spends cO m on the other source and the rest on the twin (at most 256 layouts). */
RT.split = function (B, sp0, cT, cO, m) {
  var spend = cO * m; if (spend > B + 1e-9) return null;
  var n = Math.min(RT.CAP, Math.floor((B - spend) / cT + 1e-9)), r = RT.score({ na: sp0.na, n: n, m: m, other: sp0.other });
  return { m: m, n: n, succ: r.succ, spent: spend + cT * n, r: r };
};
RT.best = function (B, sp0, cT, cO) {                                       // every split, from none of the other source to as much as the budget buys; the first of equals
  var top = Math.min(RT.CAP, Math.floor(B / cO + 1e-9)), best = null, m, c;
  for (m = 0; m <= top; m++) { c = RT.split(B, sp0, cT, cO, m); if (c && (!best || c.succ > best.succ)) best = c; }
  return best;
};
RT.profile = function (B, sp0, cT, cO) {                                    // the success of every split of the budget, indexed by the layouts of the other source
  var top = Math.min(RT.CAP, Math.floor(B / cO + 1e-9)), out = [], m;
  for (m = 0; m <= top; m++) out.push(RT.split(B, sp0, cT, cO, m));
  return out;
};
/* the three shortcuts, and the cascade down lesson 17's ranking */
RT.allIn = function (B, sp0, cT, cO) {                                      // every dollar on the cheaper hour (by price per hour, a tie to the other source), as far as its 256 layouts go
  var o = cO <= cT, c = o ? cO : cT, k = Math.min(RT.CAP, Math.floor(B / c + 1e-9)), m = o ? k : 0, n = o ? 0 : k, r = RT.score({ na: sp0.na, n: n, m: m, other: sp0.other });
  return { m: m, n: n, succ: r.succ, spent: c * k, r: r };
};
RT.equal = function (B, sp0, cT, cO) {
  var m = Math.min(RT.CAP, Math.floor(B / 2 / cO + 1e-9)), n = Math.min(RT.CAP, Math.floor(B / 2 / cT + 1e-9)), r = RT.score({ na: sp0.na, n: n, m: m, other: sp0.other });
  return { m: m, n: n, succ: r.succ, spent: cO * m + cT * n, r: r };
};
RT.rate64 = function (tab, na) { var M = LG.TABLE.layouts.M; return LG.TABLE.layouts.src[tab].rho[na][M.indexOf(64)]; };   // lesson 17's operating point: 8 own layouts, 64 attempted
RT.cascade = function (B, sp0, cT, cO) {                                    // lesson 17's ranking: the lower cost per useful hour (price over rate) first, to the end of its 256 layouts, then the other
  var rT = RT.rate64('twin', sp0.na), rO = RT.rate64(RT.OTHER[sp0.other].tab, sp0.na), cuT = cT / rT, cuO = rO > 0 ? cO / rO : Infinity, m = 0, n = 0;
  if (cuO <= cuT) { m = Math.min(RT.CAP, Math.floor(B / cO + 1e-9)); n = Math.min(RT.CAP, Math.floor((B - cO * m) / cT + 1e-9)); }
  else { n = Math.min(RT.CAP, Math.floor(B / cT + 1e-9)); if (isFinite(cuO)) m = Math.min(RT.CAP, Math.floor((B - cT * n) / cO + 1e-9)); }
  var r = RT.score({ na: sp0.na, n: n, m: m, other: sp0.other });
  return { m: m, n: n, succ: r.succ, spent: cO * m + cT * n, r: r };
};
RT.target = function (B, sp0, cT, cO, T) {                                  // each source until it alone would take the pool to T (all 256 if it never does), cheaper first
  var need = function (key) {
    for (var j = 0; j <= RT.CAP; j += 4) if (RT.score({ na: sp0.na, n: key === 'twin' ? j : 0, m: key === 'twin' ? 0 : j, other: sp0.other }).succ >= T) return j;
    return RT.CAP;
  };
  var m = 0, n = 0, left = B;
  if (cO <= cT) { m = Math.min(need('other'), Math.floor(left / cO + 1e-9)); left -= cO * m; n = Math.min(need('twin'), Math.floor(left / cT + 1e-9)); }
  else { n = Math.min(need('twin'), Math.floor(left / cT + 1e-9)); left -= cT * n; m = Math.min(need('other'), Math.floor(left / cO + 1e-9)); }
  var r = RT.score({ na: sp0.na, n: n, m: m, other: sp0.other });
  return { m: m, n: n, succ: r.succ, spent: cO * m + cT * n, r: r };
};
/* marginal value per dollar at a pool, in points of success per dollar: the gain of d more layouts of each source over their price */
RT.lambda = function (a, sp0, cT, cO, d) {
  var s0 = RT.score({ na: sp0.na, n: a.n, m: a.m, other: sp0.other }).succ, n2 = Math.min(RT.CAP, a.n + d), m2 = Math.min(RT.CAP, a.m + d);
  var sT = RT.score({ na: sp0.na, n: n2, m: a.m, other: sp0.other }).succ, sO = RT.score({ na: sp0.na, n: a.n, m: m2, other: sp0.other }).succ;
  return { twin: n2 > a.n ? 100 * (sT - s0) / (cT * (n2 - a.n)) : NaN, other: m2 > a.m ? 100 * (sO - s0) / (cO * (m2 - a.m)) : NaN };
};

/* ───────────── the rule on curves: the ledger's own-layout curve and each source's exchange rate ───────────── */
RT.ownAt = function (E) {                                                    // success of E own layouts: the running maximum of the table's curve, linear between its points
  var c = LG.TABLE.layouts.ownHand, xs = [0].concat(c.N), ys = [0], i;
  for (i = 0; i < c.s.length; i++) ys.push(Math.max(ys[i], c.s[i]));
  if (E <= 0) return 0;
  for (i = 1; i < xs.length; i++) if (E <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (E - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};
RT.equiv = function (tab, na, m) {                                           // own layouts that m attempted layouts of a table source are worth: rate x m, linear between the table's points
  var r = LG.TABLE.layouts.src[tab].rho[na], M = LG.TABLE.layouts.M, x0 = 0, y0 = 0, i;
  for (i = 1; i < M.length; i++) { var y1 = r[i] * M[i]; if (m <= M[i]) return y0 + (y1 - y0) * (m - x0) / (M[i] - x0); x0 = M[i]; y0 = y1; }
  return y0;
};
RT.fit = function (tab, na) {                                                // rate(h) = e^a h^-gamma through the table's rates at 8 to 256 attempted layouts: log-log least squares
  var r = LG.TABLE.layouts.src[tab].rho[na], M = LG.TABLE.layouts.M, xs = [], ys = [], i;
  for (i = 2; i < M.length; i++) if (r[i] > 0) { xs.push(Math.log(M[i])); ys.push(Math.log(r[i])); }
  var n = xs.length, mx = 0, my = 0, sxx = 0, sxy = 0, syy = 0;
  for (i = 0; i < n; i++) { mx += xs[i] / n; my += ys[i] / n; }
  for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) * (ys[i] - my); }
  return { k: Math.exp(my - sxy / sxx * mx), gamma: -sxy / sxx, beta: 1 + sxy / sxx, r2: sxy * sxy / (sxx * syy) };
};
RT.marginal = function (f, cost, h) { return cost / (f.k * f.beta * Math.pow(Math.min(RT.CAP, Math.max(8, h)), f.beta - 1)); };   // dollars of the next useful layout after h attempted ones (the fit holds from 8 to 256)
RT.model = function (sp) { return RT.ownAt(sp.na + RT.equiv('twin', sp.na, sp.n) + RT.equiv(RT.OTHER[sp.other].tab, sp.na, sp.m)); };

root.RT = RT;
if (typeof module !== 'undefined' && module.exports) module.exports = RT;
})(typeof window !== 'undefined' ? window : globalThis);
