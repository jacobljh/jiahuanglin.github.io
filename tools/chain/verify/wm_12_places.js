#!/usr/bin/env node
/* Oracle for World Models lesson 12, "Places: a world you can leave and return to".
 *
 * The lesson's experiment: a camera agent walks a circular loop (radius 3.4 m, counter-clockwise, forward-looking, 64 columns over 64 degrees) in a walled 12 m x 12 m yard with
 * eight coloured posts on a ring outside the loop.  A "revisit test" asks, during lap 2, what the agent will see K = n/5 steps ahead, from memory alone; the answer is scored by the
 * IoU of the columns that show a post.  Three memories (window / keyframes / map) are read through the same re-projection.  Dead reckoning drifts; loop closure matches posts to a register.
 *
 * Independence.  The page's numbers come from the engine all_lessons/world_models_new/l12_places.js (the code the widget runs).  This oracle contains a CLEAN-ROOM re-implementation of the whole
 * protocol written from the lesson's description (closest-approach ray casting, an inverse-lookup reader instead of forward splatting, string-keyed cells, complex-number Procrustes,
 * closed-form look-ahead motion) and
 *   (1) checks that it reproduces the engine exactly (rendering on random poses; IoU, cell counts, keyframe counts and pose errors on several full runs, including twins, a push and closure);
 *   (2) derives every number the lesson quotes from the clean-room version;
 *   (3) checks closed forms and laws the prose relies on: the odometry random walk (heading rms = sigma*sqrt(N) exactly, position rms ~ sqrt(N)), Procrustes optimality, the identity law
 *       Phi(d / (s sqrt 2)) against Monte Carlo in the line and in the plane, the leak arithmetic, the unit costs of the memories;
 *   (4) asserts each claim of the prose (the window's cliff, the memories' independence of the lap length, closure's gain over many worlds, the bent map, ghosts after a push);
 *   (5) drives the page's own widget into the states the prose describes and compares what it prints.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const PL = require(path.join(DIR, 'l12_places.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const PHI = CY.stats.ncdf;
const SEED = 33, NQ = 12, NGRID = [60, 120, 240, 480, 960];

/* ───────────────────────── 1. the clean-room implementation ───────────────────────── */
const DEG = Math.PI / 180;
const A = 12, NC = 64, FOV = 64 * DEG, COL = FOV / NC, NPOST = 8, RP = 0.25, RLOOP = 3.4;
const O = {};
O.makeWorld = (seed, twinGap) => {                                          // posts on a ring outside the walked loop
  const g = CY.rng(seed), posts = [];
  for (let k = 0; k < NPOST; k++) {
    const jitter = g(), rr = g();
    const ang = (k + 0.5 + 0.6 * (jitter - 0.5)) * (2 * Math.PI / NPOST), rad = 4.5 + 0.8 * rr;
    posts.push({ x: 6 + rad * Math.cos(ang), y: 6 + rad * Math.sin(ang), r: RP, c: k + 1 });
  }
  if (twinGap) {                                                            // post 2 becomes a look-alike of post 1, twinGap metres away along the ring
    const p0 = posts[0], tang = Math.atan2(p0.x - 6, -(p0.y - 6));
    posts[1] = { x: p0.x + twinGap * Math.cos(tang), y: p0.y + twinGap * Math.sin(tang), r: RP, c: p0.c };
  }
  return { posts };
};
O.pushPost = (w, k, d) => {                                                 // a hidden hand moves post k by d metres counter-clockwise along the ring
  const posts = w.posts.map(p => Object.assign({}, p)), q = posts[k], dx = q.x - 6, dy = q.y - 6, rad = Math.hypot(dx, dy);
  q.x = q.x - d * dy / rad; q.y = q.y + d * dx / rad;
  return { posts };
};
O.priorWorlds = (seed, m) => {                                              // layouts of the same kind with the colours shuffled: plausible and wrong
  const out = [];
  for (let i = 0; i < m; i++) {
    const w = O.makeWorld(seed + 7919 * (i + 1)), cols = w.posts.map(p => p.c);
    CY.shuffle(cols, CY.rng(seed + 31 * i + 5));
    w.posts.forEach((p, k) => { p.c = cols[k]; });
    out.push(w);
  }
  return out;
};
O.cast = (w, pose) => {                                                     // for every column the first thing the ray meets: closest-approach for posts, four lines for the wall
  const [ox, oy, th] = pose, lab = new Array(NC), z = new Array(NC), id = new Array(NC);
  for (let j = 0; j < NC; j++) {
    const a = th + (FOV / 2 - (j + 0.5) * COL), dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity, l = 0, who = -1;
    for (const [line, axis] of [[0, 'x'], [A, 'x'], [0, 'y'], [A, 'y']]) {
      const t = axis === 'x' ? (Math.abs(dx) > 1e-12 ? (line - ox) / dx : -1) : (Math.abs(dy) > 1e-12 ? (line - oy) / dy : -1);
      if (t > 0 && t < best) { const hx = ox + t * dx, hy = oy + t * dy; if (hx > -1e-9 && hx < A + 1e-9 && hy > -1e-9 && hy < A + 1e-9) best = t; }
    }
    w.posts.forEach((p, i) => {
      const wx = p.x - ox, wy = p.y - oy, t0 = wx * dx + wy * dy;
      if (t0 <= 0) return;
      const h2 = wx * wx + wy * wy - t0 * t0;
      if (h2 > p.r * p.r) return;
      const t = t0 - Math.sqrt(p.r * p.r - h2);
      if (t > 0 && t < best) { best = t; l = p.c; who = i; }
    });
    lab[j] = l; z[j] = best; id[j] = who;
  }
  return { lab, z, id };
};
O.truth = (i, n) => { const f = 2 * Math.PI * i / n; return [6 + RLOOP * Math.cos(f), 6 + RLOOP * Math.sin(f), f + Math.PI / 2]; };
O.chord = n => 2 * RLOOP * Math.sin(Math.PI / n);
const stepPose = (p, ds, dth) => [p[0] + ds * Math.cos(p[2] + dth / 2), p[1] + ds * Math.sin(p[2] + dth / 2), p[2] + dth];
O.odometry = (T, n, sc, seed, quietUntil) => {                              // measured motion = true motion + noise; the estimate integrates it (noise only from step quietUntil on, if given)
  const g = CY.rng(seed), meas = [null], est = [O.truth(0, n)];
  for (let i = 1; i < T; i++) {
    const e1 = CY.randn(g), e2 = CY.randn(g), s = i >= (quietUntil || 0) ? sc : 0;
    const m = [O.chord(n) + s * 0.01 * e1, 2 * Math.PI / n + s * 0.001 * e2];
    meas.push(m); est.push(stepPose(est[i - 1], m[0], m[1]));
  }
  return { meas, est };
};
O.ahead = (p, n, K) => {                                                    // K commanded steps in closed form: a geometric series of unit phasors
  const ds = O.chord(n), dth = 2 * Math.PI / n;
  const num = [Math.cos(K * dth) - 1, Math.sin(K * dth)], den = [Math.cos(dth) - 1, Math.sin(dth)], dd = den[0] * den[0] + den[1] * den[1];
  const ratio = [(num[0] * den[0] + num[1] * den[1]) / dd, (num[1] * den[0] - num[0] * den[1]) / dd];
  const ph = p[2] + dth / 2, rot = [Math.cos(ph), Math.sin(ph)];
  return [p[0] + ds * (rot[0] * ratio[0] - rot[1] * ratio[1]), p[1] + ds * (rot[0] * ratio[1] + rot[1] * ratio[0]), p[2] + K * dth];
};
O.hits = (strip, pose) => strip.lab.map((l, j) => {                         // where each ray of a stored frame ended, in the frame of the pose estimate
  const a = pose[2] + (FOV / 2 - (j + 0.5) * COL);
  return { x: pose[0] + strip.z[j] * Math.cos(a), y: pose[1] + strip.z[j] * Math.sin(a), lab: l };
});
O.readPoints = (groups, q) => {                                             // inverse lookup: for every column the nearest stored point whose bearing falls inside it
  const best = new Array(NC).fill(null), c = Math.cos(q[2]), s = Math.sin(q[2]);
  for (const pts of groups) for (const p of pts) {
    const dx = p.x - q[0], dy = p.y - q[1], fw = dx * c + dy * s, lf = -dx * s + dy * c;
    if (fw < 0.05) continue;
    const bearing = Math.atan2(lf, fw);
    if (Math.abs(bearing) > FOV / 2) continue;
    const col = Math.floor((FOV / 2 - bearing) / COL), d = Math.hypot(dx, dy);
    if (col < 0 || col >= NC) continue;
    if (best[col] === null || d < best[col].d) best[col] = { d, lab: p.lab };
  }
  const lab = best.map(b => (b === null ? -1 : b.lab));
  for (let j = 0; j < NC; j++) {                                            // close gaps of one or two unknown columns between equal labels
    if (lab[j] !== -1) continue;
    let e = j; while (e < NC && lab[e] === -1) e++;
    if (j > 0 && e < NC && e - j <= 2 && lab[j - 1] === lab[e]) for (let t = j; t < e; t++) lab[t] = lab[j - 1];
    j = e;
  }
  return lab;
};
const poseDist = (a, b) => { let d = Math.abs(a[2] - b[2]) % (2 * Math.PI); d = Math.min(d, 2 * Math.PI - d); return Math.hypot(a[0] - b[0], a[1] - b[1]) + d; };
O.WindowMem = class { constructor(M) { this.M = M; this.frames = []; } put(s, p) { this.frames.push(O.hits(s, p)); while (this.frames.length > this.M) this.frames.shift(); }
  get(q) { return O.readPoints(this.frames, q); } numbers() { return this.frames.length * (2 * NC + 3); } };
O.KeyMem = class { constructor(M) { this.M = M; this.items = []; }
  put(s, p) { if (this.items.length >= this.M) return; if (this.items.some(it => poseDist(it.p, p) < 0.43)) return; this.items.push({ p, pts: O.hits(s, p) }); }
  get(q) { const near = this.items.map(it => ({ d: poseDist(it.p, q), it })).sort((a, b) => a.d - b.d).slice(0, 6); return O.readPoints(near.map(x => x.it.pts), q); }
  numbers() { return this.items.length * (2 * NC + 3); } };
O.CellMem = class {
  constructor() { this.cells = {}; }
  put(s, p) {
    for (const h of O.hits(s, p)) {
      const key = Math.round(h.x / 0.05) + '_' + Math.round(h.y / 0.05), c = this.cells[key];
      if (c && c.lab === h.lab) { c.sx += h.x; c.sy += h.y; c.n += 1; } else this.cells[key] = { sx: h.x, sy: h.y, n: 1, lab: h.lab };
    }
  }
  pts() { return Object.values(this.cells).map(c => ({ x: c.sx / c.n, y: c.sy / c.n, lab: c.lab })); }
  get(q) { return O.readPoints([this.pts()], q); }
  count() { return Object.keys(this.cells).length; }
  numbers() { return 3 * this.count(); }
};
O.complete = (lab, prior, pose) => { const f = O.cast(prior, pose); return lab.map((l, j) => (l >= 0 ? l : f.lab[j])); };
O.iou = (truth, pred) => { let inter = 0, uni = 0; for (let j = 0; j < NC; j++) { if (truth[j] > 0 && truth[j] === pred[j]) inter++; if (truth[j] > 0 || pred[j] > 0) uni++; } return { inter, uni }; };
O.blobList = strip => {                                                     // posts fully in view: a run of one colour, at least 3 columns, wall on both sides
  const out = []; let j = 0;
  while (j < NC) {
    if (strip.lab[j] <= 0) { j++; continue; }
    let e = j; while (e + 1 < NC && strip.lab[e + 1] === strip.lab[j] && strip.id[e + 1] === strip.id[j]) e++;
    const clearL = j > 0 && strip.lab[j - 1] === 0, clearR = e < NC - 1 && strip.lab[e + 1] === 0;
    if (clearL && clearR && e - j + 1 >= 3) out.push({ lab: strip.lab[j], id: strip.id[j], col: (j + e) / 2 + 0.5, z: strip.z[Math.round((j + e) / 2)] });
    j = e + 1;
  }
  return out;
};
O.blobCentre = (b, pose) => { const a = pose[2] + FOV / 2 - b.col * COL, d = b.z + RP; return [pose[0] + d * Math.cos(a), pose[1] + d * Math.sin(a)]; };
O.rigid = pairs => {                                                        // least-squares rigid motion z -> R z + t taking each pair's .seen onto its .ref; complex-number form
  const n = pairs.length, mean = k => [pairs.reduce((s, p) => s + p[k][0], 0) / n, pairs.reduce((s, p) => s + p[k][1], 0) / n];
  const ms = mean('seen'), mr = mean('ref');
  let re = 0, im = 0, spread = 0;
  for (const p of pairs) {
    const a = [p.seen[0] - ms[0], p.seen[1] - ms[1]], b = [p.ref[0] - mr[0], p.ref[1] - mr[1]];
    re += a[0] * b[0] + a[1] * b[1]; im += a[0] * b[1] - a[1] * b[0];
    spread = Math.max(spread, 2 * Math.hypot(a[0], a[1]));
  }
  const ang = n >= 2 && spread >= 1 ? Math.atan2(im, re) : 0, c = Math.cos(ang), s = Math.sin(ang);
  return { ang, t: [mr[0] - (c * ms[0] - s * ms[1]), mr[1] - (s * ms[0] + c * ms[1])] };
};
O.locate = (strips, odo, closure) => {
  const T = strips.length, reg = [], before = [odo.est[0]], after = [odo.est[0]], stat = {};
  for (let t = 1; t < T; t++) {
    let pose = closure ? stepPose(after[t - 1], odo.meas[t][0], odo.meas[t][1]) : odo.est[t];
    before.push(pose);
    if (closure) {
      const seen = O.blobList(strips[t]).map(b => ({ b, c: O.blobCentre(b, pose) })), options = [];
      seen.forEach((s, bi) => reg.forEach((e, ei) => { if (e.lab === s.b.lab) { const d = Math.hypot(s.c[0] - e.pos[0], s.c[1] - e.pos[1]); if (d < 1.0) options.push({ d, bi, ei }); } }));
      options.sort((a, b) => a.d - b.d);
      const bDone = new Set(), eDone = new Set(), pairs = [];
      for (const o2 of options) {
        if (bDone.has(o2.bi) || eDone.has(o2.ei)) continue;
        bDone.add(o2.bi); eDone.add(o2.ei);
        const e = reg[o2.ei], s = seen[o2.bi];
        if (e.fixed) { pairs.push({ seen: s.c, ref: e.pos }); const st = (stat[s.b.lab] = stat[s.b.lab] || { ok: 0, all: 0 }); st.all++; if (e.id === s.b.id) st.ok++; }
        else { e.pos = [(e.pos[0] * e.k + s.c[0]) / (e.k + 1), (e.pos[1] * e.k + s.c[1]) / (e.k + 1)]; e.k++; }
        e.seenAt = t;
      }
      seen.forEach((s, bi) => { if (!bDone.has(bi)) reg.push({ lab: s.b.lab, id: s.b.id, pos: s.c, k: 1, seenAt: t, fixed: false }); });
      for (const e of reg) if (e.seenAt < t) e.fixed = true;
      if (pairs.length) { const g = O.rigid(pairs), c = Math.cos(g.ang), s = Math.sin(g.ang); pose = [c * pose[0] - s * pose[1] + g.t[0], s * pose[0] + c * pose[1] + g.t[1], pose[2] + g.ang]; }
    }
    after.push(pose);
  }
  return { before, after, stat, reg };
};
O.exam = (o, which) => {                                                    // two laps; during lap 2 each memory is asked for the strip K steps ahead
  which = which || ['win', 'key', 'map'];
  const n = o.n, T = 2 * n, K = o.K || Math.round(n / 5), w1 = O.makeWorld(o.seed, o.twin), w2 = o.push ? O.pushPost(w1, 3, 1.2) : w1, priors = O.priorWorlds(o.seed + 1, 64);
  const poses = [], strips = [];
  for (let t = 0; t < T; t++) { poses.push(O.truth(t, n)); strips.push(O.cast(t < n ? w1 : w2, poses[t])); }
  const odo = O.odometry(T, n, o.sc, o.seed + 2, o.quietUntil), loc = O.locate(strips, odo, o.closure);
  const mem = {}; if (which.includes('win')) mem.win = new O.WindowMem(o.M); if (which.includes('key')) mem.key = new O.KeyMem(o.M); if (which.includes('map')) mem.map = new O.CellMem();
  const stride = Math.max(1, Math.floor((n - K) / (o.nq || NQ))), tot = {}; ['none'].concat(which).forEach(m => { tot[m] = { inter: 0, uni: 0 }; });
  const queries = []; let se = 0, cnt = 0;
  for (let t = 0; t < T; t++) {
    which.forEach(m => mem[m].put(strips[t], loc.after[t]));
    if (t >= n) { se += (loc.after[t][0] - poses[t][0]) ** 2 + (loc.after[t][1] - poses[t][1]) ** 2; cnt++; }
    if (t >= n && t + K < T && (t - n) % stride === 0) {
      const q = O.ahead(loc.after[t], n, K), truth = strips[t + K].lab, pr = priors[t % 64], rec = { t, q, truth, got: {} };
      let r = O.iou(truth, O.complete(new Array(NC).fill(-1), pr, q)); tot.none.inter += r.inter; tot.none.uni += r.uni;
      which.forEach(m => { const raw = mem[m].get(q), full = O.complete(raw, pr, q); r = O.iou(truth, full); tot[m].inter += r.inter; tot[m].uni += r.uni; rec.got[m] = { raw, full }; });
      queries.push(rec);
    }
  }
  const iou = {}; Object.keys(tot).forEach(m => { iou[m] = tot[m].uni ? tot[m].inter / tot[m].uni : 0; });
  return { iou, queries, loc, poses, strips, mem, poseErr: Math.sqrt(se / cnt), odo, K, n, priors,
           numbers: Object.fromEntries(which.map(m => [m, mem[m].numbers()])), kf: mem.key ? mem.key.items.length : 0, cells: mem.map ? mem.map.count() : 0 };
};
O.chance = r => {                                                           // a model with no memory: a random layout (all 64 of them) at the true pose of every query
  let I = 0, U = 0;
  for (const q of r.queries) for (const pr of r.priors) { const s = O.iou(r.strips[q.t + r.K].lab, O.cast(pr, r.poses[q.t + r.K]).lab); I += s.inter; U += s.uni; }
  return I / U;
};
const exam = (o, which) => O.exam(Object.assign({ nq: NQ }, o), which);
const base = { seed: SEED, n: 240, M: 64, sc: 0, closure: false };

/* ───────────────────────── 2. the engine must agree with the clean-room version ───────────────────────── */
{
  const rng = CY.rng(1234); let worst = 0, bad = 0;
  for (let s = 1; s <= 4; s++) {
    const w = PL.world(s), wo = O.makeWorld(s);
    for (let i = 0; i < NPOST; i++) if (Math.abs(w.posts[i].x - wo.posts[i].x) > 1e-12 || Math.abs(w.posts[i].y - wo.posts[i].y) > 1e-12 || w.posts[i].c !== wo.posts[i].c) bad++;
    for (let t = 0; t < 200; t++) {
      const p = [1 + 10 * rng(), 1 + 10 * rng(), 6.3 * rng()], a = PL.render(w, p), b = O.cast(wo, p);
      for (let j = 0; j < NC; j++) { if (a.lab[j] !== b.lab[j] || a.id[j] !== b.id[j]) bad++; worst = Math.max(worst, Math.abs(a.z[j] - b.z[j])); }
    }
  }
  ok('engine and clean-room agree on the world and on 800 random camera poses (labels, post ids, depth to 1e-5)', bad === 0 && worst < 1e-5, { bad, worst });
  const cfgs = [{ seed: 26, n: 240, M: 64, sc: 0, closure: false }, { seed: 26, n: 240, M: 256, sc: 1, closure: false }, { seed: 26, n: 240, M: 64, sc: 1, closure: true },
    { seed: 7, n: 120, M: 64, sc: 2, closure: true, twin: 1.2 }, { seed: 26, n: 480, M: 256, sc: 1, closure: true, push: true }, { seed: 3, n: 60, M: 16, sc: 4, closure: true }];
  let worstIou = 0, mism = 0;
  for (const c of cfgs) {
    const a = PL.run(PL.prep(c), c.M, null, NQ), b = exam(c);
    for (const k of ['none', 'win', 'key', 'map']) worstIou = Math.max(worstIou, Math.abs(a.iou[k] - b.iou[k]));
    if (a.cells !== b.cells || a.kf !== b.kf || !close(a.poseErr, b.poseErr, 1e-6) || a.numbers.win !== b.numbers.win || a.numbers.map !== b.numbers.map) mism++;
  }
  ok('engine and clean-room agree on six full runs (IoU of the three memories and of no memory, cells, keyframes, numbers stored, pose error)', worstIou < 1e-9 && mism === 0, { worstIou, mism });
  // the engine's chance function against the clean-room's
  const pe = PL.prep(base), ce = PL.chance(pe, NQ), co = O.chance(exam(base));
  ok('chance level: engine == clean-room', close(ce, co, 1e-9), [ce, co]);
}
{ // properties of the pieces
  const rng = CY.rng(5); let worst = 0;
  for (let t = 0; t < 40; t++) {                                            // the closed-form K-step motion equals K composed steps
    const p = [3 + 6 * rng(), 3 + 6 * rng(), 6 * rng()], n = [60, 120, 240, 480, 960][t % 5], K = Math.round(n / 5); let q = p.slice();
    for (let k = 0; k < K; k++) q = PL.compose(q, PL.stepInc(n));
    const c = O.ahead(p, n, K); worst = Math.max(worst, Math.abs(q[0] - c[0]), Math.abs(q[1] - c[1]), Math.abs(q[2] - c[2]));
  }
  ok('K commanded steps: engine loop == closed-form geometric series', worst < 1e-9, worst);
  // Procrustes: the fitted motion beats every nearby motion (the angle is only fitted when two points are 1 m apart, otherwise the best translation), and recovers a known motion
  let bestGap = 0, maxErr = 0, fitted = 0;
  for (let t = 0; t < 60; t++) {
    const n = 2 + (t % 3), ang = (rng() - 0.5) * 0.4, tx = rng() - 0.5, ty = rng() - 0.5, pairs = [];
    for (let i = 0; i < n; i++) { const m = [2 + 6 * rng(), 2 + 6 * rng()], c = Math.cos(ang), s = Math.sin(ang); pairs.push({ seen: [m[0], m[1]], ref: [c * m[0] - s * m[1] + tx + 0.01 * CY.randn(rng), s * m[0] + c * m[1] + ty + 0.01 * CY.randn(rng)] }); }
    const g = O.rigid(pairs), cost = (a, tt) => pairs.reduce((sum, p) => { const c = Math.cos(a), s = Math.sin(a), x = c * p.seen[0] - s * p.seen[1] + tt[0], y = s * p.seen[0] + c * p.seen[1] + tt[1]; return sum + (x - p.ref[0]) ** 2 + (y - p.ref[1]) ** 2; }, 0);
    const c0 = cost(g.ang, g.t), freeAngle = g.ang !== 0; let lowest = Infinity; if (freeAngle) fitted++;
    for (let k = 0; k < 60; k++) lowest = Math.min(lowest, cost(freeAngle ? g.ang + 0.02 * (rng() - 0.5) : 0, [g.t[0] + 0.02 * (rng() - 0.5), g.t[1] + 0.02 * (rng() - 0.5)]));
    bestGap = Math.max(bestGap, c0 - lowest);
    const pe = PL.procrustes(pairs.map(p => ({ c: p.seen, m: p.ref })));
    maxErr = Math.max(maxErr, Math.abs(pe.ang - g.ang), Math.abs(pe.tx - g.t[0]), Math.abs(pe.ty - g.t[1]));
  }
  ok('Procrustes: no perturbation of the fitted motion lowers the squared error; engine == clean-room', bestGap < 1e-12 && maxErr < 1e-9 && fitted >= 30, { bestGap, maxErr, fitted });
  { const w = O.makeWorld(SEED); let miss = 0, tot = 0;                      // a frame read back at its own pose reproduces its post columns
    for (let t = 0; t < 240; t += 7) { const p = O.truth(t, 240), s = O.cast(w, p), lab = O.readPoints([O.hits(s, p)], p); for (let j = 0; j < NC; j++) if (s.lab[j] > 0) { tot++; if (lab[j] !== s.lab[j]) miss++; } }
    ok('a stored frame read at its own pose returns its own post columns', miss === 0, [miss, tot]); }
}

/* ───────────────────────── 3. facts of the lesson ───────────────────────── */
/* 3.1 the yard, the walk, the camera */
facts.lap_m = 2 * Math.PI * RLOOP; facts.step_cm = 100 * O.chord(240); facts.turn_deg = 360 / 240; facts.lap_s = 240 * 0.1; facts.look_m = 48 * O.chord(240); facts.look_deg = 48 * 360 / 240;
facts.fov_deg = 64; facts.cols = NC; facts.n_posts = NPOST;
{ const r = exam(base); let cols = 0, post = 0; for (let t = 240; t < 480; t++) for (let j = 0; j < NC; j++) { cols++; if (r.strips[t].lab[j] > 0) post++; } facts.post_share_pct = 100 * post / cols; facts.chance = O.chance(r); }
/* 3.2 the entry: the same window asked about the next frame and about the strip further ahead (exact poses) */
{
  for (const K of [1, 8, 24, 48]) {
    const r = exam(Object.assign({}, base, { K }), ['win', 'map']);
    facts['k' + K + '_win'] = r.iou.win; facts['k' + K + '_map'] = r.iou.map; facts['k' + K + '_chance'] = O.chance(r);
  }
  const r = exam(base, ['win', 'key', 'map']), K = r.K, ages = [];
  for (const q of r.queries) {                                              // how long ago was each scored column last in view (true geometry, true poses)?
    const tf = q.t + K, s = r.strips[tf], p = r.poses[tf];
    for (let j = 0; j < NC; j++) {
      if (s.lab[j] <= 0) continue;
      const a = p[2] + FOV / 2 - (j + 0.5) * COL, X = p[0] + s.z[j] * Math.cos(a), Y = p[1] + s.z[j] * Math.sin(a);
      let age = -1;
      for (let k = 0; k <= q.t; k++) {
        const pp = r.poses[q.t - k], dx = X - pp[0], dy = Y - pp[1], fw = dx * Math.cos(pp[2]) + dy * Math.sin(pp[2]), lf = -dx * Math.sin(pp[2]) + dy * Math.cos(pp[2]);
        if (fw <= 0.05) continue;
        const ang = Math.atan2(lf, fw); if (Math.abs(ang) > FOV / 2) continue;
        const jj = Math.min(NC - 1, Math.max(0, Math.floor((FOV / 2 - ang) / COL))), z = Math.hypot(dx, dy);
        if (Math.abs(r.strips[q.t - k].z[jj] - z) < 0.15 + 0.03 * z) { age = k; break; }
      }
      ages.push(age);
    }
  }
  ages.sort((a, b) => a - b); const qf = x => ages[Math.floor(x * (ages.length - 1))];
  facts.age_p10 = qf(0.1); facts.age_med = qf(0.5); facts.age_p90 = qf(0.9); facts.age_max = ages[ages.length - 1];
  ok('every scored column was seen in lap 1 (so the exam asks about remembering, not about the unknown)', ages[0] >= 0, ages[0]);
  ok('the window falls with look-ahead: K = 1 > 8 > 24 > 48, ending at chance', facts.k1_win > facts.k8_win && facts.k8_win > facts.k24_win && facts.k24_win > facts.k48_win && facts.k48_win < 0.03, [facts.k1_win, facts.k8_win, facts.k24_win, facts.k48_win]);
  ok('the map does not fall with look-ahead (all within 0.05 of one another)', Math.max(facts.k1_map, facts.k8_map, facts.k24_map, facts.k48_map) - Math.min(facts.k1_map, facts.k8_map, facts.k24_map, facts.k48_map) < 0.05, [facts.k1_map, facts.k8_map, facts.k24_map, facts.k48_map]);
  ok('the window at K = 1 is as good as the map', Math.abs(facts.k1_win - facts.k1_map) < 0.03, [facts.k1_win, facts.k1_map]);
  facts.win64 = r.iou.win; facts.key64 = r.iou.key; facts.map_exact = r.iou.map; facts.num_win64 = r.numbers.win; facts.num_key = r.numbers.key; facts.kf_count = r.kf; facts.cells_exact = r.cells; facts.num_map = r.numbers.map;
  facts.frame_numbers = 2 * NC + 3;
  ok('unit cost of a stored frame is 64 colours + 64 depths + 3 pose numbers', facts.frame_numbers === 131 && r.numbers.win === 64 * 131 && r.numbers.key === r.kf * 131 && r.numbers.map === 3 * r.cells, [r.numbers, r.kf, r.cells]);
  const r256 = exam(Object.assign({}, base, { M: 256 }), ['win']); facts.win256 = r256.iou.win; facts.num_win256 = r256.numbers.win;
  const r32 = exam(Object.assign({}, base, { M: 32 }), ['key']); facts.key_m32 = r32.iou.key;
  ok('a keyframe store of 32 (the loop needs 60) is full and refuses the rest: its score is well below the full store', r32.kf === 32 && r32.iou.key < facts.key64 - 0.2, [r32.kf, r32.iou.key, facts.key64]);
  ok('a window of 64 frames sits at chance on the 48-step query', facts.win64 < 0.03, facts.win64);
  ok('keyframes (budget 64 covers the loop) and the map pass at exact poses; the window of 256 does too', facts.key64 > 0.85 && facts.map_exact > 0.85 && facts.win256 > 0.85, [facts.key64, facts.map_exact, facts.win256]);
  // the map stops growing when the loop is repeated
  const w1 = O.makeWorld(SEED), cm = new O.CellMem(); let c1 = 0;
  for (let t = 0; t < 480; t++) { const p = O.truth(t, 240); cm.put(O.cast(w1, p), p); if (t === 239) c1 = cm.count(); }
  facts.cells_lap1 = c1; facts.cells_lap2 = cm.count();
  ok('with exact poses a second lap adds no cells (memory is bounded by the yard, not by time)', c1 === cm.count(), [c1, cm.count()]);
  // equal budget: a window of as many frames as the keyframe store holds
  const eq = exam(Object.assign({}, base, { M: r.kf }), ['win', 'key']); facts.eq_win = eq.iou.win; facts.eq_key = eq.iou.key; facts.eq_numbers = eq.numbers.win;
  ok('at equal stored numbers the keyframes beat the window by a wide margin', eq.numbers.win === eq.numbers.key && eq.iou.key - eq.iou.win > 0.8, eq);
}
/* 3.3 how long a window must be: the smallest M (multiple of 8) reaching 80 % of the map's score, for each lap length (exact poses; bisection after a monotonicity check) */
{
  const need = {}; let mono = true;
  for (const n of NGRID) {
    const cex = exam(Object.assign({}, base, { n, M: 4000 }), ['map']), ceil = cex.iou.map; facts['cells_' + n] = cex.cells; facts['map_n' + n] = ceil;
    const kex = exam(Object.assign({}, base, { n, M: 64 }), ['key']); facts['key_n' + n] = kex.iou.key; facts['kf_n' + n] = kex.kf;
    const f = M => exam(Object.assign({}, base, { n, M }), ['win']).iou.win;
    let lo = 1, hi = Math.ceil(1.2 * n / 8);                                 // search over M = 8 * i
    let prev = -1; for (const i of [1, Math.ceil(hi / 4), Math.ceil(hi / 2), Math.ceil(3 * hi / 4), hi]) { const v = f(8 * i); if (v + 0.02 < prev) mono = false; prev = v; }
    while (lo < hi) { const mid = (lo + hi) >> 1; if (f(8 * mid) >= 0.8 * ceil) hi = mid; else lo = mid + 1; }
    need[n] = 8 * lo; facts['need_' + n] = need[n]; facts['need_ratio_' + n] = need[n] / n;
  }
  ok('the window score is (up to 0.02) non-decreasing in M, so the bisection is sound', mono);
  ok('the window needed is between 0.7 n and 0.95 n for every lap length', NGRID.every(n => need[n] / n > 0.7 && need[n] / n < 0.95), need);
  facts.need_numbers_960 = need[960] * 131; facts.need_numbers_480 = need[480] * 131;
  facts.num_map_960 = 3 * facts.cells_960; facts.need_vs_map_960 = facts.need_numbers_960 / facts.num_map_960; facts.wall_cells = 4 * A / 0.05;   // the map at n = 960 itself; the wall is 4 x 12 m of 5 cm cells
  ok('the oldest column asked about was last seen n - K = 0.8 n steps ago at most (n = 240: 192), and the window needs about 0.8 n for every lap length', facts.age_max <= 0.8 * 240 + 1 && facts.age_max >= 0.8 * 240 - 6 && NGRID.every(n => Math.abs(need[n] / n - 0.8) < 0.15), [facts.age_max, need]);
  ok('keyframes (budget 64) and the map keep their score at every lap length from 60 to 960 steps (exact poses): all above 0.85', NGRID.every(n => facts['key_n' + n] > 0.85 && facts['map_n' + n] > 0.85), NGRID.map(n => [facts['key_n' + n], facts['map_n' + n]]));
  { const cs = NGRID.map(n => facts['cells_' + n]); ok('the map is set by the surface, not by the lap: cells (exact poses) for laps of 60..960 steps are within 15 % of the wall\'s own cell count (960) and within 10 % of one another from n = 120 up', cs.every(c => Math.abs(c / facts.wall_cells - 1) < 0.15) && Math.max(...cs.slice(1)) / Math.min(...cs.slice(1)) < 1.1, cs); }
  facts.genie3_frames = 60 * 24;                                            // a minute at 24 frames per second
  const e480 = exam(Object.assign({}, base, { n: 480, M: 256 }));
  facts.e480_win = e480.iou.win; facts.e480_key = e480.iou.key; facts.e480_map = e480.iou.map;
  facts.e480_kf = e480.kf; facts.e480_num_key = e480.numbers.key; facts.e480_cells = e480.cells; facts.e480_num_map = e480.numbers.map;
  ok('the keyframe store holds the same keyframes and the map within 3 % of the same cells at n = 480 as at n = 240 (bounded by the yard, not by the lap length)', e480.kf === facts.kf_count && Math.abs(e480.cells / facts.cells_exact - 1) < 0.03, [e480.kf, facts.kf_count, e480.cells, facts.cells_exact]);
  ok('at n = 480 a window of 256 frames is far below the keyframes and the map, which do not move (exact poses)', e480.iou.win < 0.15 && e480.iou.key > 0.85 && e480.iou.map > 0.85, [e480.iou.win, e480.iou.key, e480.iou.map]);
}
/* 3.4 two reasons a picture changes (exact poses; the map built from lap 1 only) */
{
  const K = 48, w1 = O.makeWorld(SEED);
  const change = push => {
    const w2 = push ? O.pushPost(w1, 3, 1.2) : w1, poses = [], strips = [];
    for (let t = 0; t < 480; t++) { poses.push(O.truth(t, 240)); strips.push(O.cast(t < 240 ? w1 : w2, poses[t])); }
    const map = new O.CellMem(); for (let t = 0; t < 240; t++) map.put(strips[t], poses[t]);
    let raw = 0, pose = 0, cnt = 0, posePost = 0, postCols = 0;
    for (let t = 240; t + K < 480; t++) {
      const now = strips[t].lab, later = strips[t + K].lab, pred = map.get(poses[t + K]);
      for (let j = 0; j < NC; j++) { cnt++; if (now[j] !== later[j]) raw++; if (pred[j] !== later[j]) pose++; if (later[j] > 0) { postCols++; if (pred[j] !== later[j]) posePost++; } }
    }
    return { raw: 100 * raw / cnt, pose: 100 * pose / cnt, postWrong: 100 * posePost / postCols };
  };
  const a = change(false), b = change(true);
  facts.chg_raw_pct = a.raw; facts.chg_pose_pct = a.pose; facts.explained_pct = 100 * (1 - a.pose / a.raw); facts.chg_push_pct = b.pose; facts.post_wrong_push_pct = b.postWrong;
  ok('the pose alone explains most of the change between two strips 48 steps apart (> 85 %)', facts.explained_pct > 85, facts.explained_pct);
  ok('after a push the unexplained columns rise and sit on posts (post columns wrong: > 5 x the unpushed value)', b.postWrong > 5 * Math.max(a.postWrong, 0.5), [a.postWrong, b.postWrong]);
}
/* 3.5 dead reckoning: the error of a sum of independent per-step errors (Monte Carlo over 3000 walks) */
{
  const S = 3000, Ns = NGRID, ap = Ns.map(() => 0), ah = Ns.map(() => 0);
  for (let s = 0; s < S; s++) {
    const od = O.odometry(961, 240, 1, 5000 + s);
    Ns.forEach((N, i) => { const e = od.est[N], t = O.truth(N, 240); ap[i] += ((e[0] - t[0]) ** 2 + (e[1] - t[1]) ** 2) / S; ah[i] += (e[2] - t[2]) ** 2 / S; });
  }
  Ns.forEach((N, i) => { facts['pos_' + N + '_cm'] = 100 * Math.sqrt(ap[i]); facts['head_' + N + '_deg'] = Math.sqrt(ah[i]) / DEG; });
  facts.head_formula_240_deg = 0.001 * Math.sqrt(240) / DEG; facts.pos_per_rootstep_cm = facts.pos_240_cm / Math.sqrt(240);
  facts.walk_pct = 100 * facts.pos_240_cm / 100 / facts.lap_m;
  ok('heading error after N steps is sigma*sqrt(N) (3 %)', Ns.every((N, i) => Math.abs(Math.sqrt(ah[i]) / (0.001 * Math.sqrt(N)) - 1) < 0.03), Ns.map((N, i) => Math.sqrt(ah[i]) / (0.001 * Math.sqrt(N))));
  ok('position error grows as sqrt(N): coefficient constant within 5 % over 60..960 steps', Ns.every((N, i) => Math.abs(Math.sqrt(ap[i]) / Math.sqrt(N) / (facts.pos_per_rootstep_cm / 100) - 1) < 0.05), Ns.map((N, i) => Math.sqrt(ap[i]) / Math.sqrt(N)));
  ok('quadrupling the steps doubles the position error (ratio 1.9..2.1)', facts.pos_960_cm / facts.pos_240_cm > 1.9 && facts.pos_960_cm / facts.pos_240_cm < 2.1, facts.pos_960_cm / facts.pos_240_cm);
}
/* 3.6 drift blurs the map; closure repairs the pose (the lesson's world, n = 240, M = 256) */
{
  const sw = {};
  for (const sc of [0, 0.5, 1, 2, 4, 8]) {
    const a = exam({ seed: SEED, n: 240, M: 256, sc, closure: false }), b = exam({ seed: SEED, n: 240, M: 256, sc, closure: true });
    sw[sc] = { a, b }; const k = String(sc).replace('.', 'p');
    facts['win_sc' + k] = a.iou.win; facts['map_sc' + k] = a.iou.map; facts['cells_sc' + k] = a.cells; facts['pose_sc' + k + '_cm'] = 100 * a.poseErr;
    facts['cl_map_sc' + k] = b.iou.map; facts['cl_cells_sc' + k] = b.cells; facts['cl_pose_sc' + k + '_cm'] = 100 * b.poseErr;
  }
  ok('open-loop map score falls monotonically with the noise scale', [0, 0.5, 1, 2, 4, 8].every((s, i, a) => i === 0 || sw[s].a.iou.map < sw[a[i - 1]].a.iou.map), [0, 0.5, 1, 2, 4, 8].map(s => sw[s].a.iou.map));
  ok('map cells grow with the noise scale (ghosts): 1 < 2 < 4', sw[1].a.cells > sw[0].a.cells && sw[2].a.cells > sw[1].a.cells && sw[4].a.cells > sw[2].a.cells);
  ok('a window that reaches back a lap pays the same pose price as the map (within 0.05 at scale 1)', Math.abs(sw[1].a.iou.win - sw[1].a.iou.map) < 0.05, [sw[1].a.iou.win, sw[1].a.iou.map]);
  ok('closure raises the score and lowers the pose error at scales 1 and 2 and 4', [1, 2, 4].every(s => sw[s].b.iou.map > sw[s].a.iou.map + 0.05 && sw[s].b.poseErr < sw[s].a.poseErr));
  ok('closure degrades as the drift outgrows its gate: at scale 8 it scores below 0.5 and more than 0.3 under its scale-1 value, yet still above the open-loop value', sw[8].b.iou.map < 0.5 && sw[1].b.iou.map - sw[8].b.iou.map > 0.3 && sw[8].b.iou.map > sw[8].a.iou.map, [sw[1].b.iou.map, sw[8].b.iou.map, sw[8].a.iou.map]);
  facts.map_ceiling = sw[0].a.iou.map;
  // the whole population of worlds at scale 1
  const S = 40; let o = 0, c = 0, wins = 0, po = 0, pc = 0, co = 0, cc = 0, nn = 0, omin = 1, omax = 0; const none = [];
  for (let s = 1; s <= S; s++) {
    const a = exam({ seed: s, n: 240, M: 256, sc: 1, closure: false }, ['map']), b = exam({ seed: s, n: 240, M: 256, sc: 1, closure: true }, ['map']);
    o += a.iou.map / S; c += b.iou.map / S; if (b.iou.map > a.iou.map) wins++; po += a.poseErr / S; pc += b.poseErr / S; co += a.cells / S; cc += b.cells / S; omin = Math.min(omin, a.iou.map); omax = Math.max(omax, a.iou.map); nn += O.chance(a) / S;
  }
  facts.mean_open = o; facts.mean_clos = c; facts.clos_wins = wins; facts.worlds = S; facts.mean_pose_open_cm = 100 * po; facts.mean_pose_clos_cm = 100 * pc; facts.mean_cells_open = co; facts.mean_cells_clos = cc; facts.open_min = omin; facts.open_max = omax; facts.chance_mean = nn;
  ok('over 40 worlds closure raises the mean map score by at least 0.05 and wins in at least 28 worlds', c - o > 0.05 && wins >= 28, [o, c, wins]);
  ok('the lesson\'s world is a typical world: its open-loop and closure scores are within 0.06 of the 40-world means', Math.abs(facts.map_sc1 - o) < 0.06 && Math.abs(facts.cl_map_sc1 - c) < 0.08, [facts.map_sc1, o, facts.cl_map_sc1, c]);
  // the bent map: closure moves the pose to the map, not the map to the truth.  Lap 1 exact, lap 2 noisy (12 worlds)
  let eo = 0, ec = 0, ex = 0, ed = 0; const S2 = 12;
  for (let s = 1; s <= S2; s++) {
    eo += exam({ seed: s, n: 240, M: 256, sc: 1, closure: false, quietUntil: 240 }, ['map']).iou.map / S2; ec += exam({ seed: s, n: 240, M: 256, sc: 1, closure: true, quietUntil: 240 }, ['map']).iou.map / S2; ex += exam({ seed: s, n: 240, M: 256, sc: 0, closure: false }, ['map']).iou.map / S2; ed += exam({ seed: s, n: 240, M: 256, sc: 1, closure: true }, ['map']).iou.map / S2;
  }
  facts.exact1_open = eo; facts.exact1_clos = ec; facts.exact_ceiling = ex; facts.drift1_clos = ed;
  ok('on the same twelve worlds closure scores more than 0.04 higher with an exact first lap than with a drifting one', ec - ed > 0.04, [ec, ed]);
  ok('with an exact first lap closure comes within 0.06 of the ceiling, and the drifting-lap-1 average is lower than that', ec > ex - 0.06 && c < ec - 0.03, [ec, ex, c]);
}
/* 3.7 the lap-length sweep at scale 1, window of 256 (the lesson's world): where the window falls and the map slowly declines */
{
  const sweep = {};
  for (const n of NGRID) { const a = exam({ seed: SEED, n, M: 256, sc: 1, closure: false }), b = exam({ seed: SEED, n, M: 256, sc: 1, closure: true }); sweep[n] = { a, b }; facts['sw_win_' + n] = a.iou.win; facts['sw_map_' + n] = a.iou.map; facts['sw_clos_' + n] = b.iou.map; facts['sw_key_' + n] = a.iou.key; }
  ok('the window of 256 holds for n <= 240 and is at chance for n >= 480', sweep[240].a.iou.win > 0.5 && sweep[480].a.iou.win < 0.05 && sweep[960].a.iou.win < 0.05, NGRID.map(n => sweep[n].a.iou.win));
  ok('open-loop map score declines with the lap length (960 < 240 < 60) while closure holds above 0.55 everywhere', sweep[960].a.iou.map < sweep[240].a.iou.map && sweep[240].a.iou.map < sweep[60].a.iou.map && NGRID.every(n => sweep[n].b.iou.map > 0.55), NGRID.map(n => [sweep[n].a.iou.map, sweep[n].b.iou.map]));
}
/* 3.8 what a map cannot say */
{
  // identity: two look-alikes d apart, independent Gaussian displacements of std s; the best a place-indexed rule can do is pair by position
  const g = CY.rng(77), S = 400000, law = {};
  for (const r of [0.25, 0.5, 1, 2, 4, 8]) {
    let ok1 = 0, ok2 = 0;
    for (let i = 0; i < S; i++) {
      const ea = r * CY.randn(g), eb = r * CY.randn(g);
      if (ea < 1 + eb) ok1++;                                                // on a line, the best pairing keeps the order: right iff A' < B'
      const ua = [r * CY.randn(g), r * CY.randn(g)], ub = [r * CY.randn(g), r * CY.randn(g)];
      const same = Math.hypot(ua[0], ua[1]) + Math.hypot(ub[0], ub[1]), swap = Math.hypot(ub[0] + 1, ub[1]) + Math.hypot(ua[0] - 1, ua[1]);
      if (same <= swap) ok2++;
    }
    const k = String(r).replace('.', ''), cf = 100 * PHI(1 / (r * Math.SQRT2));
    law[r] = { cf, mc1: 100 * ok1 / S, mc2: 100 * ok2 / S };
    facts['id_' + k] = cf; facts['id_mc1_' + k] = 100 * ok1 / S; facts['id_mc2_' + k] = 100 * ok2 / S;
  }
  ok('identity law Phi(d / (s sqrt 2)) agrees with Monte Carlo on a line to 0.3 points', Object.values(law).every(v => Math.abs(v.cf - v.mc1) < 0.3), law);
  ok('in the plane the same rule is within 2 points of the line value and never above it by more than 0.3', Object.values(law).every(v => Math.abs(v.cf - v.mc2) < 2 && v.mc2 < v.cf + 0.3), law);
  ok('the law falls from certainty to chance: 99.7 > 92 > 76 > 63 > 56 > 53', law[0.25].cf > 99.5 && law[0.5].cf > 90 && law[1].cf > 75 && law[2].cf > 60 && law[4].cf > 55 && law[8].cf < 54);
  facts.s_over_d_240 = (facts.pos_240_cm / 100) / 1.2;
  // twin posts inside the walk: how often does closure pair the right twin?
  for (const sc of [1, 4, 8]) {
    let okc = 0, all = 0, it = 0, id = 0; const S2 = 16;
    for (let s = 1; s <= S2; s++) {
      const a = exam({ seed: s, n: 240, M: 64, sc, closure: true, twin: 1.2 }, ['map']), b = exam({ seed: s, n: 240, M: 64, sc, closure: true }, ['map']);
      const st = a.loc.stat[1] || { ok: 0, all: 0 }; okc += st.ok; all += st.all; it += a.iou.map / S2; id += b.iou.map / S2;
    }
    facts['twin_ok_sc' + sc] = 100 * okc / all; facts['twin_n_sc' + sc] = all; facts['twin_iou_sc' + sc] = it; facts['dist_iou_sc' + sc] = id;
  }
  { let okc = 0, all = 0, pt = 0, pd = 0; const S4 = 16;                     // a longer absence (n = 480): more drift, worse identity
    for (let s = 1; s <= S4; s++) {
      const a = exam({ seed: s, n: 480, M: 64, sc: 4, closure: true, twin: 1.2 }, ['map']), st = a.loc.stat[1] || { ok: 0, all: 0 }; okc += st.ok; all += st.all;
      pt += exam({ seed: s, n: 480, M: 64, sc: 2, closure: true, twin: 1.2 }, ['map']).poseErr / S4; pd += exam({ seed: s, n: 480, M: 64, sc: 2, closure: true }, ['map']).poseErr / S4;
    }
    facts.tw480_ok_sc4 = 100 * okc / all; facts.tw480_n_sc4 = all; facts.tw480_pose_twin_cm = 100 * pt; facts.tw480_pose_dist_cm = 100 * pd;
    ok('a longer absence gives worse identity (right-twin rate at noise 4 on the 480-step lap below that of the 240-step lap) and look-alikes raise the mean pose error at noise 2', facts.tw480_ok_sc4 < facts.twin_ok_sc4 && pt > pd, [facts.tw480_ok_sc4, facts.twin_ok_sc4, pt, pd]); }
  for (const n of [240, 960]) {                                                  // the widget's own states: this world, noise 4, closure on
    const a = exam({ seed: SEED, n, M: 64, sc: 4, closure: true, twin: 1.2 }, ['map']), st = a.loc.stat[1] || { ok: 0, all: 0 };
    facts['wtw_' + n + '_pct'] = st.all ? 100 * st.ok / st.all : 0; facts['wtw_' + n + '_n'] = st.all;
  }
  { const a = exam({ seed: SEED, n: 480, M: 64, sc: 1, closure: true, twin: 1.2 }, ['map']), c = exam({ seed: SEED, n: 480, M: 64, sc: 1, closure: false, twin: 1.2 }, ['map']), st = a.loc.stat[1] || { ok: 0, all: 0 };
    facts.wtw_480_pct = st.all ? 100 * st.ok / st.all : 0; facts.wtw_480_n = st.all; facts.wtw_480_pe_cm = 100 * a.poseErr; facts.wtw_480_open_cm = 100 * c.poseErr;
    ok('in the lesson\'s world, with look-alikes at n 480 and noise 1, closure pairs the right twin less than half the time and ends with more than twice the open-loop pose error', facts.wtw_480_pct < 50 && a.poseErr > 2 * c.poseErr, [facts.wtw_480_pct, a.poseErr, c.poseErr]); }
  { const te = exam({ seed: SEED, n: 240, M: 256, sc: 0, closure: false, twin: 1.2 }), te0 = exam({ seed: SEED, n: 240, M: 256, sc: 0, closure: false });
    facts.twin_exact_map = te.iou.map; facts.twin_exact_win = te.iou.win; facts.twin_exact_dist_map = te0.iou.map;
    ok('with exact poses look-alikes cost the map less than 0.03 (the pose, not the colour, is what places a thing)', te0.iou.map - te.iou.map < 0.03 && te.iou.map > 0.85, [te.iou.map, te0.iou.map]); }
  ok('look-alikes: closure pairs the right twin always at scale 1 and less often as the drift grows (scale 4 below 95 %)', facts.twin_ok_sc1 > 99.9 && facts.twin_ok_sc4 < 95 && facts.twin_ok_sc4 > 60, [facts.twin_ok_sc1, facts.twin_ok_sc4, facts.twin_ok_sc8]);
  ok('look-alikes cost the map score at scale 4', facts.twin_iou_sc4 < facts.dist_iou_sc4, [facts.twin_iou_sc4, facts.dist_iou_sc4]);
  // a push while the agent is away (exact poses): stale places, a ghost, and a hole
  const np = exam(Object.assign({}, base, { M: 256 })), pu = exam(Object.assign({}, base, { M: 256, push: true }));
  facts.push_win = pu.iou.win; facts.push_key = pu.iou.key; facts.push_map = pu.iou.map; facts.nopush_map = np.iou.map;
  ok('a push lowers every memory by more than 0.1', ['win', 'key', 'map'].every(m => np.iou[m] - pu.iou[m] > 0.1), [np.iou, pu.iou]);
  const w1 = O.makeWorld(SEED), w2 = O.pushPost(w1, 3, 1.2), old = w1.posts[3], neu = w2.posts[3], strips = [], poses = [];
  for (let t = 0; t < 480; t++) { poses.push(O.truth(t, 240)); strips.push(O.cast(t < 240 ? w1 : w2, poses[t])); }
  const cm = new O.CellMem(); for (let t = 0; t < 480; t++) cm.put(strips[t], poses[t]);
  const surf = (c, p) => Math.abs(Math.hypot(c.x - p.x, c.y - p.y) - RP) < 0.06, cells4 = cm.pts().filter(c => c.lab === 4);
  facts.ghost_cells = cells4.filter(c => surf(c, old)).length; facts.new_cells = cells4.filter(c => surf(c, neu)).length;
  let seen = 0; for (let t = 240; t < 480; t++) if (strips[t].id.some(v => v === 3)) seen++;
  facts.push_frames = seen; facts.push_cells_all = cells4.length;
  ok('after lap 2 the map still holds a post of that colour at the old place and a second one at the new place', facts.ghost_cells >= 5 && facts.new_cells >= 5, [facts.ghost_cells, facts.new_cells]);
  // closure does not mistake the push for drift on average (16 worlds, scale 1)
  let p0 = 0, p1 = 0, i0 = 0, i1 = 0; const S3 = 16;
  for (let s = 1; s <= S3; s++) { const a = exam({ seed: s, n: 240, M: 64, sc: 1, closure: true }, ['map']), b = exam({ seed: s, n: 240, M: 64, sc: 1, closure: true, push: true }, ['map']); p0 += a.poseErr / S3; p1 += b.poseErr / S3; i0 += a.iou.map / S3; i1 += b.iou.map / S3; }
  facts.pushclos_pose0_cm = 100 * p0; facts.pushclos_pose1_cm = 100 * p1; facts.pushclos_iou0 = i0; facts.pushclos_iou1 = i1;
}
/* 3.9 roads */
facts.leak_097 = Math.pow(0.97, facts.age_med); facts.leak_099 = Math.pow(0.99, facts.age_med); facts.leak_0996 = Math.pow(0.996, facts.age_med); facts.rho_half = Math.pow(0.5, 1 / facts.age_med);
ok('the leak arithmetic: rho_half^age = 1/2', close(Math.pow(facts.rho_half, facts.age_med), 0.5, 1e-12));
/* 3.10 the checkpoint: a lap of 480 steps */
facts.ck_M = facts.need_480; facts.ck_numbers = facts.need_numbers_480; facts.ck_key = facts.num_key; facts.ck_p = 100 * PHI(1 / Math.SQRT2);

/* ───────────────────────── 4. the page's own widget must print the same numbers ───────────────────────── */
const PAGE = path.join(DIR, '12_places_and_memory.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; } };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (HAVE_PAGE) {
  const MS = [8, 16, 32, 64, 128, 256, 512, 1024], NS = NGRID, SC = [0, 0.5, 1, 2, 4, 8];
  const state = (m, n, sc, cl, tw, pu) => { page.set('w12-m', m); page.set('w12-n', n); page.set('w12-sc', sc); page.set('w12-cl', cl); page.set('w12-tw', tw); page.set('w12-pu', pu); };
  const check = (label, cfg, spec) => {
    const r = exam(cfg), c = O.chance(r);
    const want = { 'w12-iw': r.iou.win, 'w12-ik': r.iou.key, 'w12-im': r.iou.map, 'w12-ic': c, 'w12-nw': r.numbers.win, 'w12-nk': r.numbers.key, 'w12-nm': r.numbers.map, 'w12-cells': r.cells, 'w12-kf': r.kf, 'w12-pe': 100 * r.poseErr };
    for (const id of spec) {
      const got = page.num(id), w = want[id];
      const tol = id.endsWith('-iw') || id.endsWith('-ik') || id.endsWith('-im') || id.endsWith('-ic') ? 0.0051 : id === 'w12-pe' ? 0.051 : 0.51;
      ok('widget ' + label + ': ' + id, close(got, w, tol), [got, w]);
    }
    return r;
  };
  const all = ['w12-iw', 'w12-ik', 'w12-im', 'w12-ic', 'w12-nw', 'w12-nk', 'w12-nm', 'w12-cells', 'w12-kf', 'w12-pe'];
  state(3, 2, 0, 'off', 'd', 'n'); check('default (M 64, n 240, exact poses)', Object.assign({}, base), all);
  state(5, 2, 0, 'off', 'd', 'n'); check('M 256', Object.assign({}, base, { M: 256 }), all);
  state(5, 3, 0, 'off', 'd', 'n'); check('M 256, n 480', Object.assign({}, base, { M: 256, n: 480 }), all);
  state(7, 4, 0, 'off', 'd', 'n'); check('M 1024, n 960', Object.assign({}, base, { M: 1024, n: 960 }), all);
  state(0, 0, 0, 'off', 'd', 'n'); check('M 8, n 60', Object.assign({}, base, { M: 8, n: 60 }), all);
  state(5, 2, 2, 'off', 'd', 'n'); check('noise 1 (open loop)', { seed: SEED, n: 240, M: 256, sc: 1, closure: false }, all);
  state(5, 2, 3, 'off', 'd', 'n'); check('noise 2 (open loop)', { seed: SEED, n: 240, M: 256, sc: 2, closure: false }, all);
  state(5, 2, 4, 'off', 'd', 'n'); check('noise 4 (open loop)', { seed: SEED, n: 240, M: 256, sc: 4, closure: false }, all);
  state(5, 2, 2, 'on', 'd', 'n'); check('noise 1 with loop closure', { seed: SEED, n: 240, M: 256, sc: 1, closure: true }, all);
  state(5, 2, 4, 'on', 'd', 'n'); check('noise 4 with loop closure', { seed: SEED, n: 240, M: 256, sc: 4, closure: true }, all);
  state(3, 2, 2, 'on', 'd', 'n'); check('default memory, noise 1 with closure', { seed: SEED, n: 240, M: 64, sc: 1, closure: true }, all);
  state(5, 2, 0, 'off', 'd', 'p'); check('post 4 pushed (exact poses, M 256)', { seed: SEED, n: 240, M: 256, sc: 0, closure: false, push: true }, all);
  state(5, 2, 0, 'off', 't', 'n'); check('look-alike posts (exact poses)', { seed: SEED, n: 240, M: 256, sc: 0, closure: false, twin: 1.2 }, all);
  state(3, 2, 4, 'on', 't', 'n');
  { const r = check('look-alikes, noise 4, closure', { seed: SEED, n: 240, M: 64, sc: 4, closure: true, twin: 1.2 }, all); const st = r.loc.stat[1] || { ok: 0, all: 0 }; const got = page.num('w12-twr');
    ok('widget: twin matches right (%)', st.all ? close(got, 100 * st.ok / st.all, 0.051) : true, [got, st]); facts.twin_w_ok_sc4 = st.all ? 100 * st.ok / st.all : 0; facts.twin_w_n_sc4 = st.all; }
  state(3, 3, 2, 'on', 't', 'n');
  { const r = check('look-alikes, n 480, noise 1, closure', { seed: SEED, n: 480, M: 64, sc: 1, closure: true, twin: 1.2 }, all);
    ok('widget: twin matches right at n 480 (%) equals the fact', close(page.num('w12-twr'), facts.wtw_480_pct, 0.051), [page.num('w12-twr'), facts.wtw_480_pct]); }
  state(3, 4, 4, 'on', 't', 'n');
  { const r = check('look-alikes, n 960, noise 4, closure', { seed: SEED, n: 960, M: 64, sc: 4, closure: true, twin: 1.2 }, all), st = r.loc.stat[1] || { ok: 0, all: 0 };
    ok('widget: twin matches right at n 960 (%) equals the fact', close(page.num('w12-twr'), facts.wtw_960_pct, 0.051) && st.all === facts.wtw_960_n, [page.num('w12-twr'), facts.wtw_960_pct, st]); }
  state(3, 2, 0, 'off', 'd', 'n'); ok('with no twins the pairing readout shows no number', Number.isNaN(page.num('w12-twr')), page.text('w12-twr'));
  // the curve behind the plot is the same experiment for every lap length: the widget's current-n readouts follow n
  const curve = []; for (let i = 0; i < NS.length; i++) { state(5, i, 2, 'off', 'd', 'n'); curve.push(page.num('w12-im')); }
  ok('widget map score follows the lap length like the oracle', NS.every((n, i) => close(curve[i], exam({ seed: SEED, n, M: 256, sc: 1, closure: false }).iou.map, 0.0051)), curve);
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
