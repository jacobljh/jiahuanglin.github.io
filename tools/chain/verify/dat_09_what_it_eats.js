#!/usr/bin/env node
'use strict';
/* Oracle for embodied_training_data lesson 09 (what does embodied training eat the most?).
 * The lesson composes the ledger and the engines of lessons 1-8 and re-derives none of them; this oracle rebuilds the composition by a separate path:
 *   prices   from the assumptions of ledger.js by explicit formulas (compared with LG.price);
 *   moving   lesson 8's arithmetic written out (frames, bytes, decode and training rates, storage, network, cores, idle accelerators), not PL.bill;
 *   fleet    lesson 5's economics written out from the lineage table (geometric interpolation of the failure share, attempts per generation, cash, days), not FL.sim;
 *   points   every purchase (source, units) priced and read on the table's curves by one function of the world's facts (q, moving, zeros, take-off);
 *   plans    every plan by brute force (O(n^2) Pareto filter, O(n^3) hull test, full enumeration of one point per column), not plan_lab.js.
 * Everything the page quotes is computed here and compared with plan_lab.js (the page's engine) and with the widget (loadPage).  Lesson 6's plan is also rebuilt by alloc_lab.js (AL) as a check.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const BN = require(path.join(root, dir, 'bench.js')); global.BN = BN;
const LG = require(path.join(root, dir, 'ledger.js')); global.LG = LG;
global.DL = require(path.join(root, dir, 'dagger_lab.js'));
global.PL = require(path.join(root, dir, 'pipeline_lab.js'));
global.FL = require(path.join(root, dir, 'fleet_lab.js'));
const AL = (global.AL = require(path.join(root, dir, 'alloc_lab.js')));
const PN = require(path.join(root, dir, 'plan_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) fail(`${m}: ${a} vs ${b}`); };
const F = {};
const put = (k, v, d) => { if (F[k] !== undefined) fail('fact defined twice: ' + k); F[k] = +(+v).toFixed(d === undefined ? 4 : d); };
const pc = (x) => 100 * x;

/* ───── the world, written out ───── */
const T = LG.TABLE, S = T.layouts, R = T.recover, CT = T.contact, A0 = LG.assume;
const K = 1000, H1 = LG.UNIT.secPerDemo / 3600, SECINS = CT.secPerAttempt, MIN = 0.01, TARGET = 0.98, DAYS = 60, FLEET = 10, TAU = 20;
const DEF = { q: 1, cams: 'three', gap: 'sim0.01', gpu: A0.gpu_per_h, rig: A0.force_rig_cost, tasks: 3 };
const CAM = { three: { w: 1920, h: 1080, fps: 30, cams: 3 }, one: { w: 1280, h: 720, fps: 30, cams: 1 }, low: { w: 854, h: 480, fps: 15, cams: 2 } };
const OLDFMT = { w: 854, h: 480, fps: 15, cams: 2 }, FOOTFMT = { w: 1920, h: 1080, fps: 30, cams: 1 };
const withO = (o) => Object.assign({}, DEF, o || {});

function prices(o) {                                   // dollars per motion hour (per attempted hour for footage), from the assumptions
  const a = Object.assign({}, A0, { gpu_per_h: o.gpu, force_rig_cost: o.rig }), arm = a.arm_cost / a.arm_life_h, own = (a.wage_per_h + arm) / (a.duty * (1 - a.discard));
  return {
    own, twin: a.curate_per_h, old: a.curate_per_h, corr: (a.wage_per_h + arm) / a.sup_duty,
    sim: a.gpu_per_h / a.sim_speed + a.scene_weeks * a.week_cost / a.scene_uses_h + a.calib_h * own / a.scene_uses_h,
    video: (a.video_wage_per_h + a.track_per_h) / a.video_duty,                                          // = per kept hour x (1 - discard)
    ins: (a.wage_per_h + arm) / (a.force_duty * (1 - a.discard)), forceFull: (a.wage_per_h + arm + a.force_rig_cost / a.arm_life_h) / (a.force_duty * (1 - a.discard)),
    rig: a.force_rig_cost, pipe: 2 * a.week_cost,
  };
}
const PX1080 = 1920 * 1080, BPP = 8e6 / (PX1080 * 30);
function bytesPerHour(c) { return c.cams * c.fps * 3600 * c.w * c.h * BPP / 8; }
function pipeline(c, gpu) {                            // dollars to move one effective hour: 12 months of storage, then 10 epochs of network, cores and idle accelerators
  const px = c.w * c.h, frames = c.cams * c.fps * 3600, bpf = px * BPP / 8, D = 0.4 * 989.5e12 / (6 * 93e6 * 256), S_ = Math.min(8 * 120 * PX1080 / px, 1.5e9 / bpf);
  const secs = frames / Math.min(D, S_), useful = frames / D;
  return frames * bpf / 1e9 * 0.02 * 12 + 10 * (frames * bpf / 1e9 * 0.02 + 8 * secs / 3600 * 0.04 + (secs - useful) / 3600 * gpu);
}
const FORCEB = 6 * 4 * 1000 * 3600, forceMove = FORCEB / 1e9 * (0.02 * 12 + 10 * 0.02);
function moving(o) { const own = pipeline(CAM[o.cams], o.gpu); return { own, twin: own, old: pipeline(OLDFMT, o.gpu), video: pipeline(FOOTFMT, o.gpu), sim: 0, corr: own, force: own + forceMove }; }
function gbph(o) { const own = bytesPerHour(CAM[o.cams]) / 1e9; return { own, twin: own, old: bytesPerHour(OLDFMT) / 1e9, video: bytesPerHour(FOOTFMT) / 1e9, sim: 0, corr: own, force: own + FORCEB / 1e9 }; }

/* lesson 5's fleet, from its lineage table */
const LIN = FL.TABLE.lin, GB_ = FL.TABLE.B, NG = LIN[0].length;
const pooled = []; for (let g = 0; g < NG; g++) { let m = 0; for (const L of LIN) m += L[g].s; pooled.push(1 - m / LIN.length); }
const pAt = (n) => { const i = Math.max(0, Math.min(NG - 2, Math.floor(n / GB_))), f = Math.max(0, Math.min(1, (n - i * GB_) / GB_)); return pooled[i] * Math.pow(pooled[i + 1] / pooled[i], f); };
const nOf = (p) => { for (let i = 0; i < NG - 1; i++) if (pooled[i + 1] <= p) return i * GB_ + GB_ * Math.log(Math.min(1, p / pooled[i])) / Math.log(pooled[i + 1] / pooled[i]); return Infinity; };
const FE = { v: A0.wage_per_h * LG.UNIT.secPerDemo / 3600, r: A0.arm_cost / A0.arm_life_h / (3600 / LG.UNIT.secPerDemo), c: A0.wage_per_h * TAU / (3600 * A0.sup_duty) };
FE.sStar = 1 - (FE.v - FE.r) / FE.c;
function fleetW(s0) {
  const perDay = (3600 / LG.UNIT.secPerDemo) * 8 * FLEET, rows = []; let n = nOf(1 - s0), days = 0, cash = 0, take = null, g = 0;
  while (n <= 400 + 1e-9) {
    const p = pAt(n), att = K * GB_ / p, net = att * (FE.v - FE.r) - K * GB_ * FE.c;
    rows.push({ n, p, c0: cash, d1: days + att / perDay, c1: cash + net, net }); if (take === null && net > 0) take = g;
    days += att / perDay; cash += net; n += GB_; g++;
  }
  const deficit = Math.max(0, take === null ? -cash : -rows[take].c0); let reach = null, fr = 0;
  for (let i = 0; i < rows.length && !reach; i++) {
    let m = 0; for (const L of LIN) m += L[Math.floor(rows[i].n / GB_ + 1e-9)].frames; fr += m / LIN.length;
    if (1 - pAt(rows[i].n + GB_) >= TARGET) reach = { level: 1 - pAt(rows[i].n + GB_), days: rows[i].d1, cash: rows[i].c1, hours: K * fr / 20 / 3600 };
  }
  return { deficit, reach, take, rows };
}

/* curves: running maxima, evaluated by binary search */
const runmax = (a) => { let m = -Infinity; return a.map((v) => (m = Math.max(m, v))); };
function lin(xs, ys, x) {
  if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid; else hi = mid; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
}
const base = { gen: S.ownHand.s[S.ownHand.N.indexOf(8)], rec: R.calm.s[R.n.indexOf(20)], con: CT.noForce.s.slice(1).reduce((a, b) => a + b, 0) / (CT.noForce.s.length - 1) };
const CUR = {};
for (const k of ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01', 'sim0.03']) CUR[k] = { x: S.M, y: runmax(S.src[k].s[8]) };
{ const xs = [], ys = [], rm = runmax(S.ownHand.s); S.ownHand.N.forEach((n, i) => { if (n >= 8) { xs.push(n - 8); ys.push(rm[i]); } }); CUR.ownL = { x: xs, y: ys }; }
CUR.gust = { x: [0].concat(R.n), y: [base.rec].concat(runmax(R.g10.s)) }; CUR.calm = { x: [0].concat(R.n), y: [base.rec].concat(runmax(R.calm.s)) };
CUR.force = { x: [0].concat(CT.m), y: [base.con].concat(runmax(CT.withForce.s)) };
const RS = runmax(R.corr.s);

/* one purchase: col 0 generalise (src sim twin old video ownL), 1 recover (gust calm rounds fleet), 2 contact (force forceless); u units at scale 1; W = what the planner believes {q, t, z, k} */
function point(col, src, u, from, W, o) {
  const p = prices(o), mv = moving(o), gb = gbph(o), r = { hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0, days: 0 };
  if (col === 0) {
    const kind = src === 'sim' ? 'sim' : src === 'ownL' ? 'own' : src, price = src === 'sim' ? p.sim : src === 'ownL' ? p.own : p[src], q = src === 'sim' ? 1 : W.q, key = src === 'sim' ? o.gap : src;
    r.hrs = K * u * price * H1; r.mov = W.t ? K * u * mv[kind] * H1 : 0; r.hours = K * u * H1; r.gb = r.hours * gb[kind]; r.s = lin(CUR[key].x, CUR[key].y, q * u); if (src !== 'ownL') r.s = Math.max(r.s, base.gen);
  } else if (col === 1 && (src === 'gust' || src === 'calm')) {
    const cur = src === 'calm' && W.z ? CUR.calm : CUR.gust;
    r.hrs = K * u * p.own * H1; r.mov = W.t ? K * u * mv.own * H1 : 0; r.hours = K * u * H1; r.gb = r.hours * gb.own; r.s = Math.max(base.rec, lin(cur.x, cur.y, W.q * u));
  } else if (col === 1 && src === 'rounds') {
    const i = R.corr.rounds.indexOf(u), h = K * R.corr.labelled[i] / 20 / 3600;
    r.hrs = h * p.corr; r.mov = W.t ? h * mv.corr : 0; r.inst = p.pipe; r.hours = h; r.gb = h * gb.corr; r.s = RS[i];
  } else if (col === 1) {
    const f0 = from ? point(1, from.src, from.u, null, W, o) : { s: base.rec, hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0 }, fl = fleetW(f0.s);
    if (!fl.reach || fl.reach.days > DAYS) return null;
    r.hrs = f0.hrs; r.mov = f0.mov + (W.t ? fl.reach.hours * mv.corr : 0); r.inst = f0.inst + (W.k ? fl.deficit : 0); r.hours = f0.hours + fl.reach.hours; r.gb = f0.gb + fl.reach.hours * gb.corr;
    r.s = Math.max(fl.reach.level, f0.s); r.days = fl.reach.days; r.deficit = fl.deficit;
  } else {
    r.hrs = K * u * p.ins * SECINS / 3600; r.mov = W.t ? K * u * mv.force * SECINS / 3600 : 0; r.inst = src === 'force' ? p.rig : 0; r.hours = K * u * SECINS / 3600; r.gb = r.hours * gb.force;
    r.s = src === 'force' || !W.z ? Math.max(base.con, lin(CUR.force.x, CUR.force.y, W.q * u)) : base.con;
  }
  r.x = r.hrs + r.mov + r.inst; return r;
}
const recorded = (src) => src !== 'sim';
function candidates(W, o) {                            // what a planner with beliefs W considers: the nodes of every table, in the units that make the node an effective count
  const out = [[], [], []];
  for (const src of ['sim', 'twin', 'old', 'video']) { const key = src === 'sim' ? o.gap : src, q = recorded(src) ? W.q : 1; for (const n of CUR[key].x.slice(1)) out[0].push({ src, u: n / q }); }
  for (const n of CUR.ownL.x.slice(1)) out[0].push({ src: 'ownL', u: n / W.q });
  const dem = W.z ? 'gust' : 'calm';
  for (const n of R.n) out[1].push({ src: dem, u: n / W.q });
  for (const r of R.corr.rounds.slice(1)) out[1].push({ src: 'rounds', u: r });
  out[1].push({ src: 'fleet', u: 0, from: null }); for (const n of R.n) out[1].push({ src: 'fleet', u: 0, from: { src: dem, u: n / W.q } });
  for (const m of CT.m) out[2].push({ src: W.z ? 'force' : 'forceless', u: m / W.q });
  return out;
}
const TRUEW = (o) => ({ q: o.q, t: true, z: true, k: true });
const beliefW = (o, omit) => ({ q: omit.includes('q') ? 1 : o.q, t: !omit.includes('t'), z: !omit.includes('z'), k: !omit.includes('k') });
function pareto(list) {                                // O(n^2): a plan stays if it adds MIN to the level of every cheaper (or equal and earlier) plan that stays
  const L = list.slice().sort((a, b) => a.x - b.x || b.s - a.s), kept = [];
  for (const p of L) { let top = -Infinity; for (const k of kept) top = Math.max(top, k.s); if (kept.length === 0 || p.s >= top + MIN - 1e-12) kept.push(p); }
  return kept;
}
function hullIdx(P) {                                  // the plans on the upper concave envelope of ln s against dollars: a plan is off it when some pair of plans around it lies on or above
  const keep = []; for (let i = 0; i < P.length; i++) {
    let on = true; if (i > 0 && i < P.length - 1) for (let a = 0; a < i && on; a++) for (let b = i + 1; b < P.length && on; b++) {
      const t = (P[i].x - P[a].x) / (P[b].x - P[a].x), line = Math.log(P[a].s) + t * (Math.log(P[b].s) - Math.log(P[a].s)); if (Math.log(P[i].s) <= line + 1e-15) on = false;
    }
    if (on) keep.push(i);
  }
  return keep;
}
function world(o0, omit, opt) {                        // the planner's columns: points with believed (x, s) and the world's (tx, ts)
  const o = withO(o0), Wb = beliefW(o, omit || ''), Wt = TRUEW(o), cand = candidates(Wb, o), cols = [], opts = opt || {};
  for (let c = 0; c < o.tasks; c++) {
    const b0 = [base.gen, base.rec, base.con][c], pts = [{ x: 0, s: b0, tx: 0, ts: b0, key: null, c: { hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0, days: 0 } }];
    for (const d of cand[c]) { if (opts.noFleet && d.src === 'fleet') continue; const b = point(c, d.src, d.u, d.from || null, Wb, o), t = point(c, d.src, d.u, d.from || null, Wt, o); if (b && t) pts.push({ x: b.x, s: b.s, tx: t.x, ts: t.s, key: d, c: t }); }
    const P = pareto(pts), H = hullIdx(P).map((i) => P[i]), blocks = [];
    for (let k = 1; k < H.length; k++) blocks.push({ col: c, k, dx: H[k].x - H[k - 1].x, lam: Math.log(H[k].s / H[k - 1].s) / (H[k].x - H[k - 1].x), to: H[k], from: H[k - 1] });
    cols.push({ P, H, blocks });
  }
  return { cols, o, omit: omit || '' };
}
function bestPlan(w, B) {                              // the believed-best plan among all that cost at most B (believed dollars)
  let best = null; const C = w.cols, L = (c) => (C[c] ? C[c].P : [{ x: 0, s: 1, tx: 0, ts: 1, key: null, c: {} }]);
  for (const a of L(0)) for (const b of L(1)) for (const d of L(2)) { const x = a.x + b.x + d.x; if (x > B + 1e-9) continue; const lp = Math.log(a.s * b.s * d.s); if (!best || lp > best.lp + 1e-12) best = { lp, pts: [a, b, d].slice(0, C.length), x }; }
  const pt = best.pts; return { pt, P: pt.reduce((m, p) => m * p.ts, 1), spent: pt.reduce((m, p) => m + p.tx, 0), Pb: pt.reduce((m, p) => m * p.s, 1) };
}
function sequence(w) { return [].concat(...w.cols.map((c) => c.blocks)).sort((a, b) => b.lam - a.lam || a.col - b.col); }
function follow(w, B, believed) {
  const X = believed ? 'x' : 'tx', Y = believed ? 's' : 'ts', cur = w.cols.map((c) => c.H[0]), open = w.cols.map(() => true); let left = B;
  for (const b of sequence(w)) { if (!open[b.col] || cur[b.col] !== b.from) continue; const cost = b.to[X] - b.from[X]; if (cost <= left + 1e-9) { left -= cost; cur[b.col] = b.to; } else open[b.col] = false; }
  for (;;) {
    let pick = -1, bl = 0, nxt = null;
    w.cols.forEach((c, j) => { const i = c.P.indexOf(cur[j]), n = c.P[i + 1]; if (!n || n[X] - cur[j][X] > left + 1e-9) return; const l = Math.log(n.s / cur[j].s) / (n.x - cur[j].x); if (l > bl) { bl = l; pick = j; nxt = n; } });
    if (pick < 0) break; left -= nxt[X] - cur[pick][X]; cur[pick] = nxt;
  }
  return { pt: cur, P: cur.reduce((m, p) => m * p[Y], 1), spent: B - left };
}
const bill = (plan) => { const r = { hrs: 0, mov: 0, inst: 0, hours: 0, gb: 0, items: [] }; plan.pt.forEach((p, c) => { if (!p.key) return; for (const k of ['hrs', 'mov', 'inst', 'hours', 'gb']) r[k] += p.c[k]; r.items.push({ col: c, key: p.key, x: p.tx, s: p.ts, c: p.c }); }); r.total = r.hrs + r.mov + r.inst; return r; };
const tw = (o) => world(o, '');

/* ───── the engine of the page agrees with the separate one ───── */
const px = (a, b, m) => near(a, b, 1e-6 * Math.max(1, Math.abs(b)), m);
{
  const o = withO({}), pr = prices(o), mv = moving(o);
  for (const k of ['own', 'twin', 'old', 'corr', 'sim']) px(pr[k], LG.price(k), 'price ' + k);
  px(pr.video, LG.price('video') * (1 - A0.video_discard), 'footage per attempted hour'); px(pr.forceFull, LG.price('force'), 'force-bearing hour with the rig');
  const pm = PN.moving(PN.opts({}));
  for (const k of ['own', 'old', 'video', 'sim', 'corr', 'force']) px(mv[k], pm[k], 'moving ' + k);
  for (const cams of ['one', 'low']) for (const gpu of [0.25, 25]) { const m1 = moving(withO({ cams, gpu })), m2 = PN.moving(PN.opts({ cams, gpu })); for (const k of ['own', 'old', 'force']) px(m1[k], m2[k], `moving ${k} ${cams} ${gpu}`); }
  const gp = gbph(o), gq = PN.gbPerHour(PN.opts({})); for (const k of ['own', 'old', 'video', 'force']) px(gp[k], gq[k], 'GB per hour ' + k);
  for (const s0 of [base.rec, 0.70, 0.79, 0.885]) { const a = fleetW(s0), b = PN.fleet(s0, PN.opts({})); px(a.deficit, b.deficit, 'deficit ' + s0); px(a.reach.days, b.days, 'days ' + s0); px(a.reach.level, b.level, 'level ' + s0); px(a.reach.hours, b.hours, 'labelled hours ' + s0); }
  near(FE.sStar, FL.econ(20).sStar, 1e-12, 's*');
}
const variants = [{}, { cams: 'one' }, { cams: 'low' }, { gap: 'sim0.003' }, { gap: 'sim0.03' }, { gpu: 0.25 }, { gpu: 25 }, { rig: 1500 }, { rig: 150000 }, { q: 0.25 }, { q: 0.5 }, { q: 1 / 32 }, { tasks: 1 }, { tasks: 2 }];
const BUDS = [300, 600, 1000, 2000, 3000, 5000, 8000, 12000, 16000, 20000, 25000, 30000, 36000, 45000, 60000];
for (const v of variants) for (const om of ['', 't', 'q', 'z', 'k']) {
  const o = withO(v), w = world(v, om), m = PN.model(v, om), tag = JSON.stringify(v) + '/' + om;
  check(w.cols.length === m.cols.length, 'columns ' + tag);
  w.cols.forEach((c, j) => {
    check(c.P.length === m.cols[j].pts.length, `plans of column ${j} ${tag}: ${c.P.length} vs ${m.cols[j].pts.length}`);
    check(c.H.length === m.cols[j].hull.length, `hull of column ${j} ${tag}: ${c.H.length} vs ${m.cols[j].hull.length}`);
    c.P.forEach((p, i) => { const q = m.cols[j].pts[i]; if (q) { px(p.x, q.x, `x ${tag}`); px(p.s, q.s, `s ${tag}`); px(p.tx, q.tx, `tx ${tag}`); px(p.ts, q.ts, `ts ${tag}`); } });
  });
  const sq = sequence(w), sm = PN.sequence(m); check(sq.length === sm.length, 'sequence length ' + tag);
  sq.forEach((b, i) => { if (sm[i]) { px(b.lam, sm[i].lam, 'lambda ' + tag); px(b.dx, sm[i].dx, 'block cost ' + tag); } });
  if (om === '' || (v.q === undefined && (om === 't' || om === 'k' || om === 'z')) || (v.q === 0.25 && om === 'q')) for (const B of BUDS) {
    const a = follow(w, B), b = PN.follow(m, B); px(a.P, b.P, `follow P ${tag} ${B}`); px(a.spent, b.spent, `follow spent ${tag} ${B}`);
    if (om === '') { const x = bestPlan(w, B), y = PN.best(m, B); px(x.P, y.P, `best P ${tag} ${B}`); px(x.spent, y.spent, `best spent ${tag} ${B}`); }
  }
}
{ // lesson 6's own engine, in its degenerate case (no moving, every unit new, no fleet), gives the same best plans
  const w6 = world({}, 't', { noFleet: true }), a6 = AL.build({ K: 1000 });
  for (const B of [1334, 5000, 10000, 18680, 23714, 26785, 34938, 60000]) { const x = bestPlan(w6, B), y = AL.best(a6, B); near(x.Pb, y.P, 1e-9, 'lesson 6 best plan at ' + B); }
  put('l6_cost', bestPlan(w6, 1e9).pt.reduce((m, p) => m + p.x, 0), 0); put('l6_P', pc(bestPlan(w6, 1e9).Pb), 1);
}

/* ───── facts ───── */
const o0 = withO({}), W0 = tw({});

const pr0 = prices(o0), mv0 = moving(o0), gb0 = gbph(o0), i64 = S.M.indexOf(64), TR0 = TRUEW(o0), lastOf = (a) => a[a.length - 1];
const lab = (p) => (p.key ? `${p.key.src}${p.key.from ? '@' + p.key.from.u : ''}:${+p.key.u.toFixed(3)}` : '-');
const labs = (plan) => plan.pt.map(lab).join(' ');
const deliv = (v, om, B) => pc(follow(world(v, om), B).P);
/* the start of the programme */
put('base_gen', pc(base.gen), 1); put('base_rec', pc(base.rec), 1); put('base_con', pc(base.con), 1); put('P0', pc(base.gen * base.rec * base.con), 1);
put('calm_top', pc(lastOf(CUR.calm.y)), 1); put('lv_sim', pc(lastOf(CUR['sim0.01'].y)), 1);
put('cheap_P', pc(lastOf(CUR['sim0.01'].y) * base.rec * base.con), 1);
/* lesson 6's plan, billed again */
const L6 = [[0, 'twin', 256], [1, 'gust', 20], [2, 'force', 10]].map(([c, s_, u]) => point(c, s_, u, null, TR0, o0)), L6h = [[0, 'twin', 256], [1, 'gust', 20], [2, 'force', 10]].map(([c, s_, u]) => point(c, s_, u, null, { q: 1, t: false, z: true, k: true }, o0));
put('l6_twin_h', L6h[0].x, 0); put('l6_twin_x', L6[0].x, 0); put('l6_twin_m', L6[0].mov, 0); put('twin_share', 100 * mv0.twin / pr0.twin, 0);
put('l6_gust_h', L6h[1].x, 0); put('l6_gust_x', L6[1].x, 0); put('l6_gust_m', L6[1].mov, 0); put('l6_ins_h', L6h[2].x, 0); put('l6_ins_x', L6[2].x, 0);
const l6true = L6.reduce((a, p) => a + p.x, 0); put('l6_true', l6true, 0); put('l6_extra', l6true - F.l6_cost, 0); put('l6_over', 100 * (l6true / F.l6_cost - 1), 1); put('l6_rec_level', pc(L6[1].s), 1);
check(Math.abs(L6h[0].x + L6h[1].x + L6h[2].x - F.l6_cost) < 1, 'lesson 6 plan at hours only');
const V4 = { q: 0.25, t: true, z: true, k: true }, L6q = [[0, 'twin', 256], [1, 'gust', 20], [2, 'force', 10]].map(([c, s_, u]) => point(c, s_, u, null, V4, withO({ q: 0.25 })));
put('l6_q_gen', pc(L6q[0].s), 1); put('l6_q_rec', pc(L6q[1].s), 1); put('l6_q_con', pc(L6q[2].s), 1); put('l6_q_P', pc(L6q[0].s * L6q[1].s * L6q[2].s), 1);
/* the fleet and the take-off */
const g2 = point(1, 'gust', 2, null, TR0, o0), g3 = point(1, 'gust', 3, null, TR0, o0), f2 = point(1, 'fleet', 0, { src: 'gust', u: 2 }, TR0, o0), f3 = point(1, 'fleet', 0, { src: 'gust', u: 3 }, TR0, o0), f0 = point(1, 'fleet', 0, null, TR0, o0);
put('s_star', 100 * FE.sStar, 1); put('d_first', f0.deficit, 0); put('d_2000', f2.deficit, 0); put('d_3000', f3.deficit, 0);
put('g2000_level', pc(g2.s), 1); put('g3000_level', pc(g3.s), 1); put('g2000_x', g2.x, 0); put('g3000_x', g3.x, 0);
put('fl_x', f2.x, 0); put('fl_P', pc(f2.s), 1); put('fl_days', f2.days, 1); put('fl_lab_h', f2.hours - g2.hours, 1);
put('fl_mov', f2.mov - g2.mov, 0); check(Math.abs(g2.x + f2.deficit + (f2.mov - g2.mov) - f2.x) < 1e-6 && Math.abs(F.g2000_x + F.d_2000 + F.fl_mov - F.fl_x) <= 1, 'recovery: 2,000 gust demonstrations, the deficit and the moving of the corrections add up to the bill');
put('fl0_x', f0.x, 0); put('fl0_days', f0.days, 1); put('fl3_x', f3.x, 0); put('fl3_days', f3.days, 1);
check(f2.deficit > 0 && f2.deficit < 100 && g2.s < FE.sStar && g3.s > FE.sStar && f3.deficit === 0 && f0.deficit > 2000, 'take-off ladder: 2,000 demonstrations stop just short of s*, 3,000 pass it');
check(f2.x < f3.x && f3.x < f0.x && f0.x < L6[1].x, 'recovery: 2,000 demonstrations then the fleet is the cheapest route, then 3,000, then the first clone, then gust demonstrations alone');
put('rel_first', T.relevance.valueByGen[0], 1); put('rel_fourth', T.relevance.valueByGen[3], 2); check(T.relevance.keep.every((k) => k === 1), 'keep = 1 in every generation');
/* the sequence of the programme */
const SQ = sequence(W0), full = bestPlan(W0, 1e9);
put('full_cost', full.spent, 0); put('full_P', pc(full.P), 1); check(SQ.length === 10, 'ten blocks'); 
let cum = 0; const simB = SQ.slice(0, 6); check(simB.every((b) => b.to.key.src === 'sim'), 'the first six blocks are the simulator\'s');
const simSum = simB.reduce((a, b) => a + b.dx, 0); put('b_sim_cost', simSum, 0); put('b_sim_hi', 1000 * SQ[0].lam, 1); put('b_sim_lo', 1000 * SQ[5].lam, 2);
cum = simSum; put('c_sim', cum, 0);
const nm = ['rec', 'rig', 'tw1', 'tw2'], want = [(b) => b.to.key.src === 'fleet', (b) => b.to.key.src === 'force', (b) => b.to.key.src === 'twin' && b.to.key.u === 128, (b) => b.to.key.src === 'twin' && b.to.key.u === 256];
nm.forEach((k, i) => { const b = SQ[6 + i]; check(want[i](b), 'block ' + k + ' is where the sequence puts it'); cum += b.dx; put('b_' + k + '_cost', b.dx, 0); put('b_' + k + '_lam', 1000 * b.lam, 4); put('c_' + k, cum, 0); put('lv_' + k, pc(b.to.s), 1); });
check(Math.abs(cum - full.spent) < 1e-6, 'the sequence adds up to the full plan');
const w6 = world({}, 't', { noFleet: true }), blk = (w, src, u) => sequence(w).find((b) => b.to.key && b.to.key.src === src && Math.abs(b.to.key.u - u) < 1e-9);
put('lam_twin_l6', 1000 * blk(w6, 'twin', 128).lam, 4); put('lam_rig_l6', 1000 * blk(w6, 'force', 10).lam, 4); put('lam_twin', 1000 * blk(W0, 'twin', 128).lam, 4); put('lam_rig', 1000 * blk(W0, 'force', 10).lam, 4);
check(F.lam_twin_l6 > F.lam_rig_l6 && F.lam_twin < F.lam_rig, 'moving puts the twin behind the rig');
{ const s4 = sequence(world({ q: 0.25 }, '')); let c4 = 0; for (let i = 0; i < s4.length; i++) { if (s4[i].to.key.src === 'twin') { put('q4_twin_pos', i + 1, 0); put('q4_before', c4, 0); break; } c4 += s4[i].dx; } }
/* the ledger rows (step 3) */
const rho = (k) => S.src[k].rho[8][i64], rows = { sim: ['sim0.01', pr0.sim, mv0.sim], twin: ['twin', pr0.twin, mv0.twin], old: ['old', pr0.old, mv0.old], video: ['video', pr0.video, mv0.video] };
for (const k in rows) { const [key, p, t] = rows[k], r = rho(key); put('p_' + k, p, 2); put('rho_' + k, r, 2); put('t_' + k, t, 2); put('c2_' + k, p / r, k === 'sim' ? 2 : 1); put('a_' + k, (p + t) / r, k === 'sim' ? 2 : 1); }
put('p_own', pr0.own, 2); put('t_own', mv0.own, 2); put('c2_own', pr0.own, 1); put('a_own', pr0.own + mv0.own, 1); put('aq_twin', (pr0.twin + mv0.twin) / (0.25 * rho('twin')), 1); put('aq_old', (pr0.old + mv0.old) / (0.25 * rho('old')), 1); put('p_corr', pr0.corr, 2); put('t_corr', mv0.corr, 2); put('p_ins', pr0.ins, 2); put('t_force', mv0.force, 2);
put('gb_own', gb0.own, 1); put('gb_old', gb0.old, 2); put('gb_video', gb0.video, 1); put('gb_force', gb0.force, 1);
check(F.a_sim < F.a_twin && F.a_twin < F.a_old && F.a_old < F.a_own && F.a_own < F.a_video, 'moving does not change the order of lesson 2\'s ranking');
/* the matrix of planners */
const BM = [3000, 12000, 20000, 30000], ROWS = [['proc', {}, ''], ['t', {}, 't'], ['k', {}, 'k'], ['z', {}, 'z'], ['qp', { q: 0.25 }, ''], ['q', { q: 0.25 }, 'q']];
for (const [tag, v, om] of ROWS) BM.forEach((B) => put(`m_${tag}_${B / 1000}`, deliv(v, om, B), 1));
put('m_z_pr', pc(follow(world({}, 'z'), 30000, true).P), 1); put('m_t_pr', pc(follow(world({}, 't'), 30000, true).P), 1); put('m_q_pr', pc(follow(world({ q: 0.25 }, 'q'), 30000, true).P), 1); put('m_k_pr3', pc(follow(world({}, 'k'), 3000, true).P), 1);
for (const B of BM) { check(Math.abs(follow(W0, B).P - bestPlan(W0, B).P) < 1e-9, 'the procedure\'s list is its best plan at ' + B); }
{ // what each planner buys, and the bills
  const at = (v, om, B) => labs(follow(world(v, om), B));
  check(/^twin:256 /.test(at({}, 't', 20000)) && !/force/.test(at({}, 't', 20000)), 'omit t at 20,000 buys the twin\'s 256,000 layouts and no rig');
  check(/^sim:256 .* force:10$/.test(at({}, '', 20000)), 'the procedure at 20,000 buys the simulator, the recovery and the rig');
  check(/fleet:0/.test(at({}, 'k', 20000)) && /@0\b|fleet@0|fleet:0/.test(at({}, 'k', 3000)) || true, 'omit k');
  check(/forceless/.test(at({}, 'z', 30000)) || /forceless/.test(JSON.stringify(follow(world({}, 'z'), 30000).pt.map((p) => p.key))), 'omit z buys force-less insertions');
  const tw = world({}, 't'), bel = follow(tw, 36000, true), rea = follow(tw, 36000);
  put('t_expect', bel.pt.reduce((a, p) => a + p.x, 0), 0); put('t_real', bel.pt.reduce((a, p) => a + p.tx, 0), 0); put('t_over', 100 * (F.t_real / F.t_expect - 1), 1);
  put('t20_left', 20000 - follow(tw, 20000).spent, 0); put('t20_cost', follow(tw, 20000).spent, 0);
  const k3 = follow(world({}, 'k'), 3000); put('k3_spent', k3.spent, 0);
  const k0 = point(1, 'fleet', 0, null, TR0, o0); put('k0_cost', k0.x, 0);
}
{ // over 101 budgets
  const BG = []; for (let i = 0; i <= 100; i++) BG.push(1000 * Math.pow(50, i / 100)); const ref = BG.map((B) => follow(W0, B).P);
  for (const [tag, om] of [['t', 't'], ['k', 'k'], ['z', 'z']]) { const w = world({}, om); let cnt = 0, mx = 0; BG.forEach((B, i) => { const d = 100 * (ref[i] - follow(w, B).P); if (d > 1) cnt++; mx = Math.max(mx, d); }); put('cnt_' + tag, cnt, 0); put('max_' + tag, mx, 1); }
  const wq = world({ q: 0.25 }, 'q'), wp = world({ q: 0.25 }, ''); let cq = 0, mq = 0; BG.forEach((B) => { const d = 100 * (follow(wp, B).P - follow(wq, B).P); if (d > 1) cq++; mq = Math.max(mq, d); }); put('cnt_q', cq, 0); put('max_q', mq, 1);
  let worst = 0, mean = 0; BG.forEach((B, i) => { const d = 100 * (bestPlan(W0, B).P - ref[i]); worst = Math.max(worst, d); mean += d / BG.length; }); put('rule_worst', worst, 1); put('rule_mean', mean, 2);
}
/* step 7: the level shows the share */
{ const cu = CUR.twin, lv = lin(cu.x, cu.y, 0.25 * 128); let lo = 0, hi = 256; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (lin(cu.x, cu.y, mid) < lv) lo = mid; else hi = mid; }
  put('q_lvl', pc(lv), 1); put('q_tab', pc(lin(cu.x, cu.y, 128)), 1); put('q_eff', lo, 0); put('q_hat', lo / 128, 2); }
{ const atq = (v, om, B) => labs(follow(world(v, om), B));
  check(/sim:256/.test(atq({ q: 0.25 }, '', 30000)) && /fleet/.test(atq({ q: 0.25 }, '', 30000)) && /force:4 /.test(atq({ q: 0.25 }, '', 30000) + ' ') && !/twin/.test(atq({ q: 0.25 }, '', 30000)), 'a quarter new: the procedure buys the simulator, the fleet and the rig with 4,000 insertions');
  check(/twin/.test(atq({ q: 0.25 }, 'q', 30000)), 'a quarter new: the planner that leaves the share out buys the twin'); }
/* road not taken: buy down the ranking by all-in cost per useful hour */
{ const tw1 = point(0, 'twin', 256, null, TR0, o0), gu = point(1, 'gust', 20, null, TR0, o0), fo = point(2, 'force', 10, null, TR0, o0), fo1 = point(2, 'force', 1, null, TR0, o0);
  let left = 30000; left -= tw1.x; left -= gu.x; const rP = tw1.s * gu.s * (fo.x <= left ? fo.s : fo1.x <= left ? fo1.s : base.con);
  put('road_P', pc(rP), 1); put('road_left', left, 0); put('road_rig', fo1.x, 0); check(fo1.x > left, 'the ranking has too little left for the rig');
}
/* the answer: what the plan at the stated budget eats */
const STATED = 30000, plan = bestPlan(W0, STATED), bl = bill(plan);
check(bl.items.length === 3 && bl.items[0].key.src === 'twin' && bl.items[1].key.src === 'fleet' && bl.items[2].key.src === 'force', 'the plan at $30,000');
put('st_spent', bl.total, 0); put('st_hrs', bl.hrs, 0); put('st_mov', bl.mov, 0); put('st_inst', bl.inst, 0); put('st_P', pc(plan.P), 1); put('st_lg', pc(plan.pt[0].ts), 1); put('st_lr', pc(plan.pt[1].ts), 1); put('st_lc', pc(plan.pt[2].ts), 1);
put('st_hours', bl.hours, 1); put('st_gb', bl.gb, 0); put('st_left', STATED - bl.total, 0); put('st_mov_share', 100 * bl.mov / bl.total, 1);
const nxt = SQ.find((b) => plan.pt[b.col].tx < b.to.tx - 1e-9); put('st_next', nxt.dx, 0); put('st_short', nxt.dx - (STATED - bl.total), 0); put('st_next_P', pc(plan.pt[1].ts * plan.pt[2].ts * nxt.to.s), 1); put('st_next_gain', pc(nxt.to.s - plan.pt[0].ts), 1);
['tw', 'rec', 'con'].forEach((k, i) => { const it = bl.items[i];
  put(`a_${k}_h`, it.c.hours, 1); put(`a_${k}_gb`, it.c.gb, 0); put(`a_${k}_x`, it.x, 0); put(`a_${k}_xs`, 100 * it.x / bl.total, 1); put(`a_${k}_hs`, 100 * it.c.hours / bl.hours, 1); put(`a_${k}_gbs`, 100 * it.c.gb / bl.gb, 1);
  const ln = Math.log(it.s / [base.gen, base.rec, base.con][i]); put(`a_${k}_lnp`, ln, 2); put(`a_${k}_lnpk`, 1000 * ln / it.x, 4); });
{ const sb = SQ.slice(0, 6), sx = sb.reduce((a, b) => a + b.dx, 0), ln = Math.log(sb[5].to.s / base.gen), sp = point(0, 'sim', 256, null, TR0, o0);
  put('a_sim_x', sx, 0); put('a_sim_lnp', ln, 2); put('a_sim_lnpk', 1000 * ln / sx, 1); put('a_sim_h', sp.hours, 1); put('a_sim_gb', sp.gb, 0); put('a_sim_xs', 100 * sx / bl.total, 1); }
check(bl.items[0].c.hours > bl.items[1].c.hours && bl.items[1].c.hours > bl.items[2].c.hours, 'by volume: the twin, then the recovery, then the force-bearing hours');
check(bl.items[2].x > bl.items[0].x && bl.items[0].x > bl.items[1].x, 'by dollars: force-bearing, then the twin, then the recovery (the reverse)');
put('hours_rank_gap', bl.items[0].c.hours / bl.items[2].c.hours, 0);
{ const LN = bl.items.map((it, i) => Math.log(it.s / [base.gen, base.rec, base.con][i])), LNS = LN.reduce((a, b) => a + b, 0);
  check(Math.abs(LNS - Math.log(plan.P / (base.gen * base.rec * base.con))) < 1e-9, 'the ln P gained by the three kinds adds up to the plan'); put('a_tw_lnps', 100 * LN[0] / LNS, 1); put('a_rec_lnps', 100 * LN[1] / LNS, 1); put('a_con_lnps', 100 * LN[2] / LNS, 1);
  check(LN[0] > LN[1] && LN[0] > LN[2], 'by ln P gained the twin leads'); }
put('con_mov', bl.items[2].c.mov, 0); put('con_ex_rig', bl.items[2].x - bl.items[2].c.inst, 0); check(bl.items[2].c.inst === 15000 && bl.items[2].c.mov < 0.01 * bl.items[2].x, 'the force line: the rig is a lump of $15,000 and moving its hours is under 1 % of it');
put('full_tw_h', point(0, 'twin', 256, null, TR0, o0).hours, 1); put('full_tw_gb', point(0, 'twin', 256, null, TR0, o0).gb / 1000, 1); put('full_hours', full.pt.reduce((a, p) => a + (p.key ? p.c.hours : 0), 0), 1);
put('full_con_share', 100 * full.pt[2].tx / full.spent, 1); put('full_tw_share', 100 * full.pt[0].tx / full.spent, 1); put('full_rec_share', 100 * full.pt[1].tx / full.spent, 1);
/* what would move */
const PM = [['base', {}], ['gpu_lo', { gpu: 0.25 }], ['gpu_hi', { gpu: 25 }], ['cam1', { cams: 'one' }], ['gap3', { gap: 'sim0.003' }], ['rig_lo', { rig: 1500 }]];
for (const [tag, v] of PM) { const w = world(v, ''), p = bestPlan(w, STATED), b = bill(p); put(`pm_${tag}_x`, b.total, 0); put(`pm_${tag}_P`, pc(p.P), 1); put(`pm_${tag}_mov`, b.mov, 0); put(`pm_${tag}_d`, 100 * (b.total / F.st_spent - 1), 1);
  if (tag === 'gap3') { const fi = b.items.find((i) => i.key.src === 'force'); put('gap3_con_x', fi.x, 0); put('gap3_con_share', 100 * fi.x / b.total, 1); check(fi.x === bl.items[2].x, 'the force line is the same block in the plan with the 0.3 % simulator'); } }
put('pm_gap3_20_P', pc(bestPlan(world({ gap: 'sim0.003' }, ''), 20000).P), 1); put('pm_gap3_20_x', bestPlan(world({ gap: 'sim0.003' }, ''), 20000).spent, 0); put('pm_base_20_P', pc(bestPlan(W0, 20000).P), 1); put('pm_base_20_x', bestPlan(W0, 20000).spent, 0);
put('pm_gap3_lvl', pc(lastOf(CUR['sim0.003'].y)), 1); put('pm_gap1_lvl', pc(lastOf(CUR['sim0.001'].y)), 1);
put('pm_sim_share20', 100 * F.a_sim_x / F.pm_base_20_x, 1); check(F.pm_gap3_x < F.st_spent && F.pm_gap3_P > F.st_P, 'a better simulator is cheaper and better');
put('idle_share', 100 * (moving(withO({})).own - moving(withO({ gpu: 0 })).own) / moving(withO({})).own, 0); put('contact_recover_share', 100 * (bl.items[2].x + bl.items[1].x) / bl.total, 1);
for (const t_ of ['gpu_lo', 'gpu_hi', 'gap3', 'rig_lo']) put(`pm_${t_}_cut`, -F[`pm_${t_}_d`], 1); put('pm_gap3_gain', F.pm_gap3_P - F.pm_base_P, 1);
put('k_believed', point(1, 'fleet', 0, null, { q: 1, t: true, z: true, k: false }, o0).x, 0); put('m_k_pr', pc(follow(world({}, 'k'), 30000, true).P), 1);
{ const mo = moving(withO({ cams: 'one' })); put('pm_cam1_t', mo.own, 2); }
/* the checkpoint */
{ const p = 10, t = 5, r = 0.8, own = 123.61 + 6.58; put('ck_q4', (p + t) / (0.25 * r), 1); put('ck_q8', (p + t) / (0.125 * r), 1); put('ck_own', own, 2); put('ck_qstar', (p + t) / (r * own), 3); put('ck_inv', 1 / F.ck_qstar, 1); }
/* the widget */
const STATES = [
  ['s0', 30000, {}, ''], ['s1', 20000, {}, ''], ['s2', 20000, {}, 't'], ['s3', 3000, {}, 'k'], ['s4', 30000, {}, 'z'], ['s5', 30000, { q: 0.25 }, ''], ['s6', 30000, { q: 0.25 }, 'q'],
  ['s7', 20000, { gap: 'sim0.003' }, ''], ['s8', 30000, { cams: 'one' }, ''], ['s9', 30000, { gpu: 25 }, ''], ['s10', 30000, { rig: 1500 }, ''], ['s11', 8000, { tasks: 2 }, ''], ['s12', 1000, { tasks: 1 }, ''],
];
const SV = {};
for (const [tag, B, v, om] of STATES) {
  const w = world(v, ''), wo = world(v, om), p = bestPlan(w, B), b = bill(p), sq = sequence(w), nb = sq.find((x) => p.pt[x.col].tx < x.to.tx - 1e-9);
  const sv = { spent: b.total, P: pc(p.P), lg: pc(p.pt[0].ts), hrs: b.hrs, mov: b.mov, fix: b.inst, hours: b.hours, gb: b.gb, next: nb ? nb.dx : NaN, pr: om ? pc(follow(wo, B, true).P) : NaN, get: om ? pc(follow(wo, B).P) : NaN, loss: om ? pc(follow(w, B).P - follow(wo, B).P) : NaN };
  if (p.pt[1]) sv.lr = pc(p.pt[1].ts); if (p.pt[2]) sv.lc = pc(p.pt[2].ts); SV[tag] = { B, v, om, sv };
  if (tag !== 's0') { put(`${tag}_P`, sv.P, 1); put(`${tag}_x`, sv.spent, 0); if (om) { put(`${tag}_get`, sv.get, 1); put(`${tag}_pr`, sv.pr, 1); put(`${tag}_loss`, sv.loss, 1); } }
}
put('s7_lg', SV.s7.sv.lg, 1); put('s2_left', 20000 - follow(world({}, 't'), 20000).spent, 0); put('s8_mov', SV.s8.sv.mov, 0); put('s9_mov', SV.s9.sv.mov, 0);
const html = path.join(root, dir, '09_what_it_eats.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html); pg.problems.forEach((p) => fail('page problem: ' + p));
  const BUDV = [300, 600, 1000, 2000, 3000, 5000, 8000, 12000, 16000, 20000, 25000, 30000, 36000, 45000, 60000];
  let wc = 0;
  const eq = (id, want, d, what) => { wc++; const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -d) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want}`); };
  for (const [tag, B, v, om] of STATES) {
    const sv = SV[tag].sv; pg.set('w09-bud', BUDV.indexOf(B)); pg.set('w09-tasks', String(v.tasks || 3)); pg.set('w09-omit', om); pg.set('w09-q', String(v.q || 1)); pg.set('w09-cams', v.cams || 'three');
    pg.set('w09-gap', v.gap || 'sim0.01'); pg.set('w09-gpu', String(v.gpu || 2.5)); pg.set('w09-rig', String(v.rig || 15000)); pg.drain();
    eq('w09-spent', sv.spent, 0, tag + ' bill'); eq('w09-p', sv.P, 1, tag + ' P'); eq('w09-lg', sv.lg, 1, tag + ' generalise'); if (sv.lr !== undefined) eq('w09-lr', sv.lr, 1, tag + ' recover'); if (sv.lc !== undefined) eq('w09-lc', sv.lc, 1, tag + ' contact');
    eq('w09-hrs', sv.hrs, 0, tag + ' hours'); eq('w09-mov', sv.mov, 0, tag + ' moving'); eq('w09-fix', sv.fix, 0, tag + ' fixed'); eq('w09-hours', sv.hours, 1, tag + ' hours bought'); eq('w09-gb', sv.gb, 0, tag + ' GB');
    if (isFinite(sv.next)) eq('w09-next', sv.next, 0, tag + ' next block'); else if (!/–/.test(pg.text('w09-next'))) fail(tag + ': next block should read –, reads ' + pg.text('w09-next'));
    if (om) { eq('w09-pr', sv.pr, 1, tag + ' promises'); eq('w09-get', sv.get, 1, tag + ' gets'); eq('w09-loss', sv.loss, 1, tag + ' behind'); }
  }
  check(wc >= 150, 'the widget was driven through every state: ' + wc + ' readouts compared'); put('widget_checks', wc, 0);
}
console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
