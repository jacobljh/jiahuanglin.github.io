/* plan_lab.js — the private engine of lesson 9 (what it eats): the whole ledger as one plan.
 *
 * No new Bench measurement.  Every success is a cell of LG.TABLE (lessons 1 to 4), every price is LG.price on LG.assume (lesson 2), the fleet is lesson 5's FL.sim, the bill for moving
 * an hour is lesson 8's PL.bill, and a plan is spent as lesson 6 spends it: one plan per column, the programme succeeds when all its columns do (P = product of the levels).
 * The programme: the three capabilities of lesson 6 (generalise, recover, contact) at task size K = 1,000, on an own arm with the cameras of PN.CAMS, a fleet of F = 10 robots that
 * may take at most PN.DAYS days to reach PN.TARGET success on recovery.
 *
 * A POINT is a purchase of one source in one column: a descriptor d = {col, src, u} (u = units at scale 1: layouts, demonstrations, insertions, rounds) and the numbers PN.at(d, V, o)
 * reads from it: x dollars (hours + moving them + a fixed cost), s the level it buys.  A VIEW V says what the reader of the table believes about the world:
 *     V.q  the share of recorded units that are new (1: every unit new); V.t  moving an hour has a price; V.z  calm demonstrations and force-less insertions carry nothing the column needs;
 *     V.k  a fleet below its take-off success rate must be funded.
 * PN.TRUE is the view of the world; a planner that leaves one fact out plans on a view in which it is false, buys what that view says, and is paid what the world pays.
 *   PN.model(o, omit)  the columns a planner who leaves out `omit` sees (omit '' : the world itself): {cols: [{name, s0, pts, hull, blocks}]}; pts are the plans that add a point of success
 *                      to every cheaper one, each with the dollars (x) and level (s) the planner believes and the dollars (tx) and level (ts) the world gives it
 *   PN.best(m, B)      the best plan that costs at most B (exhaustive: one point per column, the largest ln P)
 *   PN.sequence(m)     the blocks of the hulls in order of d ln s per dollar: the order of purchases
 *   PN.follow(m, B)    the planner of PN.model(o, omit) ('q', 't', 'z', 'k' or '') buys down its own sequence at the world's prices: what the world pays it (m, B, true: what it promises)
 *   PN.bill(m, plan)   the plan's dollars split into hours, moving them and fixed costs, by source, and its hours and stored bytes
 */
(function (root) {
'use strict';
var LG = root.LG, PL = root.PL, FL = root.FL, PN = {};
var H1 = LG.hours(1), SEC_INS = LG.TABLE.contact.secPerAttempt, HZ = 20;
PN.K = 1000; PN.F = 10; PN.TAU = 20; PN.DAYS = 60; PN.TARGET = 0.98; PN.MIN = 0.01; PN.H1 = H1;
PN.CAMS = { three: { w: 1920, h: 1080, fps: 30, cams: 3 }, one: { w: 1280, h: 720, fps: 30, cams: 1 }, low: { w: 854, h: 480, fps: 15, cams: 2 } };
PN.OLD = { w: 854, h: 480, fps: 15, cams: 2 };        // the older arm's format (lesson 8)
PN.FOOT = { cams: 1 };                                // footage: one 1080p camera (an assumption of this lesson)
PN.FORCE_BYTES = 6 * 4 * 1000 * 3600;                 // a force channel: 6 values of 4 bytes at 1 kHz, bytes an hour (lesson 8)
PN.D = { q: 1, cams: 'three', gap: 'sim0.01', gpu: LG.assume.gpu_per_h, rig: LG.assume.force_rig_cost, tasks: 3 };
PN.TRUE = { q: 1, t: true, z: true, k: true };
PN.opts = function (o) { var r = {}, k; for (k in PN.D) r[k] = o && o[k] !== undefined ? o[k] : PN.D[k]; return r; };
PN.view = function (o, omit) { omit = omit || ''; return { q: omit.indexOf('q') >= 0 ? 1 : o.q, t: omit.indexOf('t') < 0, z: omit.indexOf('z') < 0, k: omit.indexOf('k') < 0 }; };
PN.assume = function (o) { var a = LG.copyAssume(); a.gpu_per_h = o.gpu; a.force_rig_cost = o.rig; return a; };

/* ───────────── prices and the bill for moving ───────────── */
PN.moving = function (o) {                              // dollars to move one effective hour of each kind: storage + decoding once + epochs x (network + cores + idle accelerators)
  var g = o.gpu / PL.gpuH();
  function t(c) { var b = PL.bill(PL.cfg(c), 10, 12); return b.storage + b.once + 10 * (b.network + b.cores + b.idle * g); }
  var own = t(PN.CAMS[o.cams]);
  return { own: own, twin: own, old: t(PN.OLD), video: t(PN.FOOT), sim: 0, corr: own, force: own + PL.billBytes(PN.FORCE_BYTES, 10, 12) };
};
PN.gbPerHour = function (o) {                           // stored GB per hour of each kind (the simulator renders at the model's size and stores nothing)
  var own = PL.bytes(PL.cfg(PN.CAMS[o.cams])).stored / 1e9;
  return { own: own, twin: own, old: PL.bytes(PL.cfg(PN.OLD)).stored / 1e9, video: PL.bytes(PL.cfg(PN.FOOT)).stored / 1e9, sim: 0, corr: own, force: own + PN.FORCE_BYTES / 1e9 };
};
PN.prices = function (o) {                              // dollars per unit at scale 1 (a layout, a demonstration, an insertion) and per supervised hour
  var a = PN.assume(o), z = LG.copyAssume(), k;
  for (k in a) z[k] = a[k]; z.force_rig_cost = 0;
  return { sim: LG.price('sim', a) * H1, twin: LG.price('twin', a) * H1, old: LG.price('old', a) * H1, video: LG.price('video', a) * (1 - a.video_discard) * H1, own: LG.price('own', a) * H1,
           corrHour: LG.price('corr', a), insertion: LG.price('force', z) * SEC_INS / 3600, pipe: 2 * a.week_cost, rig: a.force_rig_cost };
};

/* ───────────── curves ───────────── */
function runmax(a) { var m = -Infinity; return a.map(function (v) { m = Math.max(m, v); return m; }); }
function lerp(xs, ys, x) {                              // piecewise-linear, flat beyond the ends
  var i; if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
var C = null;
function curves(o) {                                    // the table's curves as (units, level) grids; built once
  if (C) return C;
  var T = LG.TABLE, S = T.layouts, R = T.recover, K = T.contact, ownI = S.ownHand.N.indexOf(8), ks = K.noForce.s.slice(1), c = { gen: {}, pool: [] };
  c.base = { gen: S.ownHand.s[ownI], rec: R.calm.s[R.n.indexOf(20)], con: ks.reduce(function (a, b) { return a + b; }, 0) / ks.length };
  ['sim0.001', 'sim0.003', 'sim0.01', 'sim0.03', 'twin', 'old', 'video'].forEach(function (k) { c.gen[k] = { u: S.M, s: runmax(S.src[k].s[8]) }; });
  var hn = [], hs = [], ro = runmax(S.ownHand.s);
  S.ownHand.N.forEach(function (n, i) { if (n >= 8) { hn.push(n - 8); hs.push(ro[i]); } });
  c.gen.ownL = { u: hn, s: hs };
  c.gust = { u: [0].concat(R.n), s: [c.base.rec].concat(runmax(R.g10.s)) };
  c.calm = { u: [0].concat(R.n), s: [c.base.rec].concat(runmax(R.calm.s)) };
  c.rounds = { r: R.corr.rounds, lab: R.corr.labelled, s: runmax(R.corr.s) };
  c.force = { u: [0].concat(K.m), s: [c.base.con].concat(runmax(K.withForce.s)) };
  c.fl = FL.TABLE.lin;
  return (C = c);
}
PN.curves = curves;

/* ───────────── the fleet: lesson 5's FL.sim from a starting success, and what it labels on the way ───────────── */
var FC = {};
function fleet(s0, o) {
  var key = s0.toFixed(5) + '|' + o.gpu, r = FC[key]; if (r) return r;
  var S = FL.sim({ tau: PN.TAU, s0: s0, K: PN.K, F: PN.F, assume: PN.assume(o) }), rc = FL.reach(S, PN.TARGET), lin = curves(o).fl, g, i, fr = 0;
  if (!rc) return (FC[key] = null);
  for (g = 0; g <= rc.g; g++) { var gi = Math.floor(S.rows[g].n / FL.B + 1e-9), m = 0; for (i = 0; i < lin.length; i++) m += lin[i][gi] ? lin[i][gi].frames : 0; fr += m / lin.length; }
  return (FC[key] = { deficit: S.deficit, days: rc.days, cash: rc.cash, level: 1 - FL.p(S.rows[rc.g].n + FL.B), hours: PN.K * fr / HZ / 3600, s0: s0 });
}
PN.fleet = fleet;

/* ───────────── one purchase under one view ───────────── */
function recorded(src) { return src !== 'sim'; }                 // every source but the simulator is recorded by someone, and may repeat itself
PN.at = function (d, V, o) {
  var K = PN.K, p = PN.prices(o), mv = PN.moving(o), gb = PN.gbPerHour(o), cv = curves(o), r = { hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0, s: 0, x: 0, days: 0 }, q, m, f, base, hrsU, kind;
  if (d.col === 'gen') {
    q = recorded(d.src) ? V.q : 1;
    var key = d.src === 'sim' ? o.gap : d.src, pu = d.src === 'sim' ? p.sim : d.src === 'ownL' ? p.own : p[d.src];
    kind = d.src === 'sim' ? 'sim' : d.src === 'ownL' ? 'own' : d.src;
    r.hrs = K * d.u * pu; r.mov = V.t ? K * d.u * mv[kind] * H1 : 0; r.hours = K * d.u * H1; r.gb = r.hours * gb[kind];
    r.s = lerp(cv.gen[key].u, cv.gen[key].s, q * d.u);
    if (d.src !== 'ownL') r.s = Math.max(r.s, cv.base.gen);
  } else if (d.col === 'rec') {
    if (d.src === 'gust' || d.src === 'calm') {
      var cur = (d.src === 'calm' && V.z) ? cv.calm : cv.gust;
      r.hrs = K * d.u * p.own; r.mov = V.t ? K * d.u * mv.own * H1 : 0; r.hours = K * d.u * H1; r.gb = r.hours * gb.own;
      r.s = Math.max(cv.base.rec, lerp(cur.u, cur.s, V.q * d.u));
    } else if (d.src === 'rounds') {
      var i = cv.rounds.r.indexOf(d.u), hh = K * cv.rounds.lab[i] / HZ / 3600;
      r.hrs = hh * p.corrHour; r.mov = V.t ? hh * mv.corr : 0; r.inst = p.pipe; r.hours = hh; r.gb = hh * gb.corr; r.s = cv.rounds.s[i];
    } else {                                                     // the fleet, entered from the plan d.from (a gust purchase) or from the first clone
      var from = d.from ? PN.at(d.from, V, o) : { x: 0, s: cv.base.rec, hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0 };
      f = fleet(from.s, o);
      if (!f || f.days > PN.DAYS) return null;
      r.hrs = from.hrs; r.mov = from.mov + (V.t ? f.hours * mv.corr : 0); r.inst = from.inst + (V.k ? f.deficit : 0); r.hours = from.hours + f.hours; r.gb = from.gb + f.hours * gb.corr;
      r.s = Math.max(f.level, from.s); r.days = f.days; r.deficit = f.deficit;
    }
  } else {                                                       // contact
    var hasRig = d.src === 'force';
    r.hrs = K * d.u * p.insertion; r.mov = V.t ? K * d.u * mv.force * SEC_INS / 3600 : 0; r.inst = hasRig ? p.rig : 0; r.hours = K * d.u * SEC_INS / 3600; r.gb = r.hours * gb.force;
    r.s = (d.src === 'force' || !V.z) ? Math.max(cv.base.con, lerp(cv.force.u, cv.force.s, V.q * d.u)) : cv.base.con;
  }
  r.x = r.hrs + r.mov + r.inst; return r;
};

/* ───────────── the candidates of each column under a view, and the plans that count ───────────── */
PN.NAMES = ['generalise', 'recover', 'contact'];
function gridOf(V, o) {                                          // the descriptors a planner with view V considers, node by node of the tables
  var cv = curves(o), T = LG.TABLE, R = T.recover, qq = V.q, L = [[], [], []], i, from;
  ['sim', 'twin', 'old', 'video'].forEach(function (src) {
    var key = src === 'sim' ? o.gap : src, q = recorded(src) ? qq : 1;
    for (i = 1; i < cv.gen[key].u.length; i++) L[0].push({ col: 'gen', src: src, u: cv.gen[key].u[i] / q });
  });
  for (i = 1; i < cv.gen.ownL.u.length; i++) L[0].push({ col: 'gen', src: 'ownL', u: cv.gen.ownL.u[i] / qq });
  var dem = V.z ? 'gust' : 'calm';                                // a planner that does not know the zeros records calm demonstrations: it believes they teach recovery too
  for (i = 1; i < cv.gust.u.length; i++) L[1].push({ col: 'rec', src: dem, u: cv.gust.u[i] / qq });
  for (i = 1; i < cv.rounds.r.length; i++) L[1].push({ col: 'rec', src: 'rounds', u: cv.rounds.r[i] });
  L[1].push({ col: 'rec', src: 'fleet', u: 0, from: null });
  for (i = 1; i < cv.gust.u.length; i++) L[1].push({ col: 'rec', src: 'fleet', u: 0, from: { col: 'rec', src: dem, u: cv.gust.u[i] / qq } });
  for (i = 1; i < cv.force.u.length; i++) L[2].push({ col: 'con', src: V.z ? 'force' : 'forceless', u: cv.force.u[i] / qq });
  return L;
}
function label(d, o) {
  var K = PN.K, n = function (u) { return Math.round(K * u).toLocaleString('en-US'); };
  if (d.col === 'gen') return (d.src === 'sim' ? 'simulator' : d.src === 'twin' ? 'twin arm' : d.src === 'old' ? 'older arm' : d.src === 'video' ? 'footage' : 'own') + ' ' + n(d.u) + ' layouts';
  if (d.col === 'rec') return d.src === 'rounds' ? 'corrections, ' + d.u + ' rounds' : d.src === 'fleet' ? (d.from ? 'gust demonstrations ' + n(d.from.u) + ', then the fleet' : 'the fleet from the first clone') : (d.src === 'calm' ? 'calm' : 'gust') + ' demonstrations ' + n(d.u);
  return (d.src === 'force' ? 'the rig and ' : 'force-less ') + n(d.u) + ' insertions';
}
PN.label = label;
function pareto(pts) {                                           // keep a plan only if it is dearer than the one before and adds PN.MIN to every cheaper plan
  pts = pts.slice().sort(function (a, b) { return a.x - b.x || b.s - a.s; });
  var out = [], best = -Infinity, i;
  for (i = 0; i < pts.length; i++) if (pts[i].s >= best + PN.MIN - 1e-12) { out.push(pts[i]); best = pts[i].s; }
  return out;
}
function hullOf(pts) {                                           // the upper concave majorant of (x, ln s)
  var h = [], g = function (p) { return Math.log(p.s); }, i;
  for (i = 0; i < pts.length; i++) {
    while (h.length > 1) { var a = h[h.length - 2], b = h[h.length - 1], c = pts[i]; if ((b.x - a.x) * (g(c) - g(a)) - (g(b) - g(a)) * (c.x - a.x) >= 0) h.pop(); else break; }
    h.push(pts[i]);
  }
  return h;
}
function column(name, s0, cand, viewB, viewT, o) {               // points under the view the planner believes (x, s), with what the world gives them (tx, ts)
  var pts = [{ x: 0, s: s0, tx: 0, ts: s0, d: null, comps: { hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0 } }], i;
  for (i = 0; i < cand.length; i++) {
    var b = PN.at(cand[i], viewB, o), t = PN.at(cand[i], viewT, o);
    if (b && t) pts.push({ x: b.x, s: b.s, tx: t.x, ts: t.s, d: cand[i], comps: t });
  }
  return pts;
}
function finish(cols) {
  cols.forEach(function (c, j) {
    c.pts = pareto(c.pts); c.hull = hullOf(c.pts); c.blocks = [];
    for (var k = 1; k < c.hull.length; k++) { var a = c.hull[k - 1], b = c.hull[k]; c.blocks.push({ col: j, k: k, dx: b.x - a.x, dg: Math.log(b.s / a.s), lam: Math.log(b.s / a.s) / (b.x - a.x), to: b }); }
  });
}
var MC = {};
PN.model = function (o, omit) {                                  // the columns a planner who leaves out `omit` sees (omit '' : the world itself)
  o = PN.opts(o); var key = JSON.stringify(o) + '|' + (omit || ''); if (MC[key]) return MC[key];
  var cv = curves(o), V = PN.view(o, omit || ''), L = gridOf(V, o), n = o.tasks, base = [cv.base.gen, cv.base.rec, cv.base.con], cols = [], j;
  for (j = 0; j < n; j++) cols.push({ name: PN.NAMES[j], s0: base[j], pts: column(PN.NAMES[j], base[j], L[j], V, PN.view(o, ''), o) });
  finish(cols); return (MC[key] = { cols: cols, o: o, omit: omit || '' });
};
function planOf(m, idx, useTrue) {
  var pt = idx.map(function (i, c) { return m.cols[c].pts[i]; }), s = pt.map(function (q) { return useTrue ? q.ts : q.s; }), x = pt.map(function (q) { return useTrue ? q.tx : q.x; });
  return { idx: idx, pt: pt, s: s, x: x, spent: x.reduce(function (a, b) { return a + b; }, 0), P: s.reduce(function (a, b) { return a * b; }, 1) };
}
PN.planOf = planOf;
PN.best = function (m, B) {                                      // the best plan the planner believes in that costs at most B (believed prices)
  var A = m.cols[0].pts, Bp = m.cols[1] ? m.cols[1].pts : [{ x: 0, s: 1 }], Dp = m.cols[2] ? m.cols[2].pts : [{ x: 0, s: 1 }], bv = -Infinity, bi = [0, 0, 0], i, j, k, v;
  for (i = 0; i < A.length && A[i].x <= B + 1e-9; i++) for (j = 0; j < Bp.length && A[i].x + Bp[j].x <= B + 1e-9; j++) for (k = 0; k < Dp.length && A[i].x + Bp[j].x + Dp[k].x <= B + 1e-9; k++) {
    v = Math.log(A[i].s * Bp[j].s * Dp[k].s); if (v > bv + 1e-12) { bv = v; bi = [i, j, k]; }
  }
  return planOf(m, bi.slice(0, m.cols.length), false);
};
PN.sequence = function (m) {
  var all = []; m.cols.forEach(function (c) { c.blocks.forEach(function (b) { all.push(b); }); });
  return all.sort(function (a, b) { return b.lam - a.lam || a.col - b.col; });
};
/* a planner that follows its own list: it buys the blocks of its sequence in order, a block that does not fit closes its column, and what is left buys the best single step that fits.
 * It pays the world's prices (tx) and is paid the world's levels (ts); with `believed` it pays and is paid what its own picture says (x, s): the plan it promises. */
PN.follow = function (m, B, believed) {
  var X = believed ? 'x' : 'tx', S = believed ? 's' : 'ts', seq = PN.sequence(m), at = m.cols.map(function () { return 0; }), open = m.cols.map(function () { return true; }), left = B, i, b, c, cost;
  for (i = 0; i < seq.length; i++) {
    b = seq[i]; c = b.col; if (!open[c] || b.k !== at[c] + 1) continue;
    cost = b.to[X] - m.cols[c].hull[at[c]][X];
    if (cost <= left + 1e-9) { left -= cost; at[c] = b.k; } else open[c] = false;
  }
  var idx = at.map(function (a, j) { return m.cols[j].pts.indexOf(m.cols[j].hull[a]); });
  for (;;) {
    var pick = -1, bl = 0, j;
    for (j = 0; j < idx.length; j++) {
      var P = m.cols[j].pts, a = P[idx[j]], n = P[idx[j] + 1];
      if (!n || n[X] - a[X] > left + 1e-9) continue;
      var l = Math.log(n.s / a.s) / (n.x - a.x); if (l > bl) { bl = l; pick = j; }
    }
    if (pick < 0) break;
    left -= m.cols[pick].pts[idx[pick] + 1][X] - m.cols[pick].pts[idx[pick]][X]; idx[pick]++;
  }
  var pt = idx.map(function (i, j) { return m.cols[j].pts[i]; }), lv = pt.map(function (q) { return q[S]; });
  return { idx: idx, pt: pt, s: lv, P: lv.reduce(function (a, v) { return a * v; }, 1), spent: B - left };
};
/* the bill of a plan of the true model: dollars by source and by kind of cost, hours and stored bytes */
PN.bill = function (m, plan) {
  var r = { hrs: 0, mov: 0, inst: 0, total: 0, hours: 0, gb: 0, items: [] };
  plan.pt.forEach(function (q, c) {
    if (!q.d) return;
    var k = q.comps; r.hrs += k.hrs; r.mov += k.mov; r.inst += k.inst; r.hours += k.hours; r.gb += k.gb;
    r.items.push({ col: c, src: q.d.src, label: label(q.d, m.o), x: q.tx, hrs: k.hrs, mov: k.mov, inst: k.inst, hours: k.hours, gb: k.gb, s: q.ts });
  });
  r.total = r.hrs + r.mov + r.inst; return r;
};
root.PN = PN;
if (typeof module !== 'undefined' && module.exports) module.exports = PN;
})(typeof window !== 'undefined' ? window : globalThis);
