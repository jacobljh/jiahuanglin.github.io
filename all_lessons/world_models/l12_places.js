/* l12_places.js — private engine of World Models lesson 12, "Places: a world you can leave and return to".
 *
 * A camera agent walks a loop through a walled square of coloured posts.  What it sees is a 1-D STRIP: NPX columns across a narrow field of
 * view, each column holding (label, depth): label 0 = the wall, 1..K = the colour of a post.  Three memories keep what it saw and are read by
 * the SAME renderer (a splat re-projection of stored world points into the query camera), so they differ only in WHAT THEY KEEP:
 *     Window     the last M frames                         (evicts by age: indexed by WHEN)
 *     Keyframes  frames whose pose is new, at most M       (indexed by WHERE the camera was)
 *     Cells      one averaged point per map cell           (indexed by WHERE THE THING IS; memory bounded by area, not by time)
 * Everything is deterministic (CY.rng).  Pose = [x, y, theta] (m, m, rad), theta counter-clockwise from +x, bearing positive to the left.
 * Requires courtyard.js (CY) for the seeded generators and the palette.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var PI = Math.PI, PL = {};

PL.W = 12;                       // the arena is a W x W square, wall on all four sides
PL.NPX = 64;                     // columns of the strip
PL.FOV = 64 * PI / 180;          // field of view (rad): 1 degree per column
PL.DB = PL.FOV / PL.NPX;
PL.K = 8;                        // posts, each its own colour 1..K
PL.RPOST = 0.25;                 // post radius (m)
PL.RL = 3.4;                     // radius of the walked loop (m); the loop is centred on the arena
PL.STEP_S = 0.01;                // dead-reckoning noise at scale 1: forward step (m per step) ...
PL.STEP_T = 0.001;               // ... and turn (rad per step)
var NPX = PL.NPX, FOV = PL.FOV, DB = PL.DB, W = PL.W;
PL.COLORS = ['#9a98aa', '#dc3f55', '#d97706', '#c9a400', '#15935a', '#0891b2', '#2f5fd0', '#6d4aff', '#c026a3'];   // label -> colour (0 = wall)

/* ───────── the world and the camera ───────── */
/* K posts on a ring outside the loop, one colour each.  o.twin = gap (m): post 2 gets post 1's colour and stands that far from it (two look-alikes). */
PL.world = function (seed, o) {
  o = o || {};
  var r = CY.rng(seed), posts = [], k, a, rad;
  for (k = 0; k < PL.K; k++) {
    a = (k + 0.5 + 0.6 * (r() - 0.5)) * 2 * PI / PL.K; rad = 4.5 + 0.8 * r();
    posts.push({ x: 6 + rad * Math.cos(a), y: 6 + rad * Math.sin(a), r: PL.RPOST, c: k + 1 });
  }
  if (o.twin) {                                              // post 2 becomes a twin of post 1, o.twin metres away along the ring
    var p1 = posts[0], tx = -(p1.y - 6), ty = p1.x - 6, tl = Math.hypot(tx, ty);
    posts[1] = { x: p1.x + o.twin * tx / tl, y: p1.y + o.twin * ty / tl, r: PL.RPOST, c: p1.c };
  }
  return { posts: posts };
};
/* a hidden hand pushes post k by d metres counter-clockwise along the ring (a copy of the world; the original is untouched) */
PL.push = function (w, k, d) {
  var q = w.posts[k], tl = Math.hypot(q.y - 6, q.x - 6), posts = w.posts.map(function (a) { return { x: a.x, y: a.y, r: a.r, c: a.c }; });
  posts[k].x = q.x - d * (q.y - 6) / tl; posts[k].y = q.y + d * (q.x - 6) / tl;
  return { posts: posts };
};
/* the strip seen from pose p: for every column the nearest of {post, wall} along the ray.  Returns {lab, z, id} (id = index of the post, -1 for the wall) */
PL.render = function (w, p) {
  var lab = new Int8Array(NPX), z = new Float64Array(NPX), id = new Int8Array(NPX), j, q, i;
  for (j = 0; j < NPX; j++) {
    var a = p[2] + FOV / 2 - (j + 0.5) * DB, dx = Math.cos(a), dy = Math.sin(a), t = Infinity, l = 0, hit = -1;
    if (dx > 1e-12) t = Math.min(t, (W - p[0]) / dx); else if (dx < -1e-12) t = Math.min(t, -p[0] / dx);
    if (dy > 1e-12) t = Math.min(t, (W - p[1]) / dy); else if (dy < -1e-12) t = Math.min(t, -p[1] / dy);
    for (i = 0; i < w.posts.length; i++) {
      q = w.posts[i];
      var ox = p[0] - q.x, oy = p[1] - q.y, b = ox * dx + oy * dy, d = b * b - (ox * ox + oy * oy - q.r * q.r);
      if (d >= 0) { var s = -b - Math.sqrt(d); if (s > 0 && s < t) { t = s; l = q.c; hit = i; } }
    }
    lab[j] = l; z[j] = t; id[j] = hit;
  }
  return { lab: lab, z: z, id: id };
};
/* the loop: step i of a lap of n steps (the first pose is the origin of the map) */
PL.truePose = function (i, n) { var f = 2 * PI * i / n; return [6 + PL.RL * Math.cos(f), 6 + PL.RL * Math.sin(f), f + PI / 2]; };
/* dead reckoning: the measured motion of every step is the true motion plus noise; the pose estimate integrates it.  sc scales the noise (0 = exact) */
PL.odometry = function (nSteps, n, sc, seed) {
  var r = CY.rng(seed), est = [PL.truePose(0, n)], inc = [null], i, ds, dth, x, y, th;
  for (i = 1; i < nSteps; i++) {
    var p0 = PL.truePose(i - 1, n), p1 = PL.truePose(i, n);
    ds = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + sc * PL.STEP_S * CY.randn(r); dth = 2 * PI / n + sc * PL.STEP_T * CY.randn(r);
    inc.push([ds, dth]);
    th = est[i - 1][2]; x = est[i - 1][0] + ds * Math.cos(th + dth / 2); y = est[i - 1][1] + ds * Math.sin(th + dth / 2);
    est.push([x, y, th + dth]);
  }
  return { est: est, inc: inc };
};
PL.compose = function (p, inc) { return [p[0] + inc[0] * Math.cos(p[2] + inc[1] / 2), p[1] + inc[0] * Math.sin(p[2] + inc[1] / 2), p[2] + inc[1]]; };

/* ───────── from a strip to world points, and back: the one renderer every memory is read through ───────── */
/* a frame's points: Float64Array of 3 numbers per column (x, y, label): where the ray hit, in the world frame of the pose estimate */
PL.points = function (s, p) {
  var P = new Float64Array(3 * NPX), j;
  for (j = 0; j < NPX; j++) {
    var a = p[2] + FOV / 2 - (j + 0.5) * DB;
    P[3 * j] = p[0] + s.z[j] * Math.cos(a); P[3 * j + 1] = p[1] + s.z[j] * Math.sin(a); P[3 * j + 2] = s.lab[j];
  }
  return P;
};
/* paint the stored points seen from pose q into a strip: each point lands in the column its bearing falls in, the nearest surface wins (a z-buffer);
 * one-column holes between two equal labels are closed; columns no stored point reaches stay -1 (unknown) */
PL.splat = function (pts, q, out) {
  var lab = out.lab, zb = out.z, c = Math.cos(q[2]), s = Math.sin(q[2]), tn = Math.tan(FOV / 2), i, j;
  for (i = 0; i < pts.length; i += 3) {
    var dx = pts[i] - q[0], dy = pts[i + 1] - q[1], fw = dx * c + dy * s, lf = -dx * s + dy * c;       // forward and leftward offsets in the camera frame
    if (fw < 0.05 || Math.abs(lf) > tn * fw) continue;
    j = Math.floor((FOV / 2 - Math.atan2(lf, fw)) / DB);
    var z = Math.sqrt(dx * dx + dy * dy);
    if (j >= 0 && j < NPX && z < zb[j]) { zb[j] = z; lab[j] = pts[i + 2]; }
  }
};
PL.close = function (o) {                                          // close holes of one or two columns whose two sides carry the same label
  var j, g;
  for (j = 1; j < NPX - 1; j++) if (o.lab[j] < 0) {
    for (g = 1; g <= 2 && j + g < NPX && o.lab[j + g] < 0; g++);
    if (j + g < NPX && g <= 2 && o.lab[j - 1] >= 0 && o.lab[j - 1] === o.lab[j + g]) { var k; for (k = 0; k < g; k++) o.lab[j + k] = o.lab[j - 1]; j += g - 1; }
  }
  return o;
};
PL.blank = function () { var o = { lab: new Int8Array(NPX), z: new Float64Array(NPX) }, j; for (j = 0; j < NPX; j++) { o.lab[j] = -1; o.z[j] = 1e9; } return o; };

/* ───────── three memories ───────── */
PL.Window = function (M) { this.M = M; this.fr = []; };          // keeps the last M frames
PL.Window.prototype.write = function (s, p) { this.fr.push(PL.points(s, p)); if (this.fr.length > this.M) this.fr.shift(); };
PL.Window.prototype.read = function (q) { var o = PL.blank(), i; for (i = 0; i < this.fr.length; i++) PL.splat(this.fr[i], q, o); return PL.close(o); };
PL.Window.prototype.numbers = function () { return this.fr.length * (2 * NPX + 3); };

PL.RHO_KF = 0.43; PL.KRET = 6;                                   // a keyframe is written only if no stored one is within RHO_KF in pose; reads use the KRET nearest
var poseDist = function (a, b) { var d = Math.abs(a[2] - b[2]) % (2 * PI); return Math.hypot(a[0] - b[0], a[1] - b[1]) + Math.min(d, 2 * PI - d); };
PL.Keyframes = function (M) { this.M = M; this.fr = []; this.ps = []; };
PL.Keyframes.prototype.write = function (s, p) {
  var i;
  if (this.fr.length >= this.M) return;
  for (i = 0; i < this.ps.length; i++) if (poseDist(this.ps[i], p) < PL.RHO_KF) return;
  this.fr.push(PL.points(s, p)); this.ps.push(p);
};
PL.Keyframes.prototype.read = function (q) {
  var d = this.ps.map(function (p, i) { return [poseDist(p, q), i]; }).sort(function (a, b) { return a[0] - b[0]; }), o = PL.blank(), i;
  for (i = 0; i < Math.min(PL.KRET, d.length); i++) PL.splat(this.fr[d[i][1]], q, o);
  return PL.close(o);
};
PL.Keyframes.prototype.numbers = function () { return this.fr.length * (2 * NPX + 3); };

PL.CELL = 0.05;                                                  // map cells are CELL-metre squares centred on multiples of CELL
PL.Cells = function () { this.c = new Map(); };                  // cell -> [sum x, sum y, count, label]
PL.Cells.prototype.write = function (s, p) {
  var P = PL.points(s, p), j, k, e;
  for (j = 0; j < NPX; j++) {
    k = (Math.round(P[3 * j] / PL.CELL) + 4096) * 8192 + Math.round(P[3 * j + 1] / PL.CELL) + 4096; e = this.c.get(k);
    if (e && e[3] === P[3 * j + 2]) { e[0] += P[3 * j]; e[1] += P[3 * j + 1]; e[2]++; }
    else this.c.set(k, [P[3 * j], P[3 * j + 1], 1, P[3 * j + 2]]);                               // a new place, or the thing there changed: write over it
  }
};
PL.Cells.prototype.pts = function () { var a = new Float64Array(3 * this.c.size), i = 0; this.c.forEach(function (e) { a[i++] = e[0] / e[2]; a[i++] = e[1] / e[2]; a[i++] = e[3]; }); return a; };
PL.Cells.prototype.read = function (q) { var o = PL.blank(); PL.splat(this.pts(), q, o); return PL.close(o); };
PL.Cells.prototype.count = function () { return this.c.size; };
PL.Cells.prototype.numbers = function () { return 3 * this.c.size; };

/* what a model that has forgotten still says: the same pose in a world drawn afresh from the same distribution (plausible, not right) */
PL.priors = function (seed, m) {
  var a = [], i, k;
  for (i = 0; i < m; i++) {
    var w = PL.world(seed + 7919 * (i + 1)), cols = CY.shuffle(w.posts.map(function (q) { return q.c; }), CY.rng(seed + 31 * i + 5));
    for (k = 0; k < w.posts.length; k++) w.posts[k].c = cols[k];                // which colour stands where is not known to the prior
    a.push(w);
  }
  return a;
};
PL.fill = function (pred, pri, p) {
  var f = PL.render(pri, p), lab = new Int8Array(NPX), j;
  for (j = 0; j < NPX; j++) lab[j] = pred.lab[j] >= 0 ? pred.lab[j] : f.lab[j];
  return lab;
};


/* ───────── knowing where you are: dead reckoning, and loop closure by recognising a revisited post ───────── */
/* the posts in a strip that are fully in view (walls on both sides), as blobs: {lab, id, u, z}; u = mean column coordinate, z = depth of the middle */
PL.blobs = function (s) {
  var out = [], j = 0;
  while (j < NPX) {
    if (s.lab[j] <= 0) { j++; continue; }
    var j0 = j; while (j < NPX && s.lab[j] === s.lab[j0] && s.id[j] === s.id[j0]) j++;
    var j1 = j - 1;
    if (j0 > 0 && j1 < NPX - 1 && s.lab[j0 - 1] === 0 && s.lab[j1 + 1] === 0 && j1 - j0 >= 2) out.push({ lab: s.lab[j0], id: s.id[j0], u: (j0 + j1) / 2 + 0.5, z: s.z[Math.round((j0 + j1) / 2)] });
  }
  return out;
};
PL.centre = function (b, p) { var a = p[2] + FOV / 2 - b.u * DB; return [p[0] + (b.z + PL.RPOST) * Math.cos(a), p[1] + (b.z + PL.RPOST) * Math.sin(a)]; };
/* the rigid motion (angle, translation) that takes the points c_i onto the points m_i in the least-squares sense (Procrustes).  The angle needs two points at least 1 m apart;
 * otherwise only the translation is fitted. */
PL.procrustes = function (pairs) {
  var n = pairs.length, cx = 0, cy = 0, mx = 0, my = 0, i, sn = 0, sd = 0, ang = 0, span = 0;
  for (i = 0; i < n; i++) { cx += pairs[i].c[0] / n; cy += pairs[i].c[1] / n; mx += pairs[i].m[0] / n; my += pairs[i].m[1] / n; }
  for (i = 0; i < n; i++) {
    var ax = pairs[i].c[0] - cx, ay = pairs[i].c[1] - cy, bx = pairs[i].m[0] - mx, by = pairs[i].m[1] - my;
    sn += ax * by - ay * bx; sd += ax * bx + ay * by; span = Math.max(span, 2 * Math.hypot(ax, ay));
  }
  if (n >= 2 && span >= 1) ang = Math.atan2(sn, sd);
  var ca = Math.cos(ang), sa = Math.sin(ang);
  return { ang: ang, tx: mx - (ca * cx - sa * cy), ty: my - (sa * cx + ca * cy) };
};
PL.GATE = 1.0;                                                   // a post is matched to a registered one of the same colour only within GATE metres
/* pose estimates for every frame.  Open loop: dead reckoning only.  With closure: each fully visible post is matched to the nearest registered post of its colour;
 * a registered post that has left the view is a reference, and the pose is moved by the Procrustes motion that makes the references and what is seen agree.
 * Returns {pred, corr, stat}: the pose before and after seeing each frame; stat[colour] = [matches to the right post, matches] (the true id only scores this). */
PL.localise = function (strips, od, closure) {
  var T = strips.length, pred = [od.est[0]], corr = [od.est[0]], reg = [], stat = {}, t;
  for (t = 1; t < T; t++) {
    var p = closure ? PL.compose(corr[t - 1], od.inc[t]) : od.est[t], pairs = [];
    pred.push(p);
    if (closure) {
      var bl = PL.blobs(strips[t]), cand = [], bTaken = {}, eTaken = {};
      bl.forEach(function (b, bi) {
        var c = PL.centre(b, p);
        reg.forEach(function (e, ei) { var d = Math.hypot(c[0] - e.pos[0], c[1] - e.pos[1]); if (e.lab === b.lab && d < PL.GATE) cand.push([d, bi, ei, c]); });
      });
      cand.sort(function (x, y) { return x[0] - y[0]; });
      cand.forEach(function (m) {
        if (bTaken[m[1]] || eTaken[m[2]]) return;
        bTaken[m[1]] = eTaken[m[2]] = true;
        var e = reg[m[2]], b = bl[m[1]];
        if (e.frozen) {                                                                    // a post seen before and out of view since: a reference
          pairs.push({ m: e.pos, c: m[3] });
          var st = stat[b.lab] = stat[b.lab] || [0, 0]; st[1]++; if (e.id === b.id) st[0]++;
        } else { e.pos = [(e.pos[0] * e.n + m[3][0]) / (e.n + 1), (e.pos[1] * e.n + m[3][1]) / (e.n + 1)]; e.n++; }     // still the first sighting: refine the entry
        e.last = t;
      });
      bl.forEach(function (b, bi) { if (!bTaken[bi]) reg.push({ lab: b.lab, id: b.id, pos: PL.centre(b, p), n: 1, last: t, frozen: false }); });
      reg.forEach(function (e) { if (e.last < t) e.frozen = true; });
    }
    if (pairs.length) { var g = PL.procrustes(pairs), ca = Math.cos(g.ang), sa = Math.sin(g.ang); p = [ca * p[0] - sa * p[1] + g.tx, sa * p[0] + ca * p[1] + g.ty, p[2] + g.ang]; }
    corr.push(p);
  }
  return { pred: pred, corr: corr, stat: stat, reg: reg };
};

/* ───────── the revisit test ───────── */
PL.stepInc = function (n) { return [2 * PL.RL * Math.sin(PI / n), 2 * PI / n]; };               // the commanded motion of one step of a lap of n steps
PL.iou = function (truth, pred) {                                                                   // [columns right, columns where either side shows a post]
  var inter = 0, uni = 0, j;
  for (j = 0; j < NPX; j++) { if (truth[j] > 0 && truth[j] === pred[j]) inter++; if (truth[j] > 0 || pred[j] > 0) uni++; }
  return [inter, uni];
};
PL.PUSH = { k: 3, d: 1.2 };                                       // the hidden hand of the "pushed" scene: post 3, 1.2 m
var STRIPS = {};                                                  // true strips per (seed, n, scene): independent of noise, closure and memory size
/* Everything that does not depend on the memory: two laps of n steps, the strips really seen (lap 2 after the optional push), the noisy odometry and the pose estimates.
 * o: seed, n, sc (odometry noise scale), closure, twin (gap in m, 0 = none), push (bool) */
PL.prep = function (o) {
  var n = o.n, T = 2 * n, key = [o.seed, n, o.twin || 0, o.push ? 1 : 0].join(), t;
  var w = PL.world(o.seed, { twin: o.twin }), w2 = o.push ? PL.push(w, PL.PUSH.k, PL.PUSH.d) : w;
  if (!STRIPS[key]) { var poses = [], strips = []; for (t = 0; t < T; t++) { poses.push(PL.truePose(t, n)); strips.push(PL.render(t < n ? w : w2, poses[t])); } STRIPS[key] = { poses: poses, strips: strips }; }
  var S = STRIPS[key], od = PL.odometry(T, n, o.sc, o.seed + 2), loc = PL.localise(S.strips, od, o.closure);
  return { o: o, n: n, T: T, K: o.K || Math.round(n / 5), w: w, w2: w2, poses: S.poses, strips: S.strips, od: od, loc: loc, pri: PL.priors(o.seed + 1, 64) };
};
/* Two laps; during lap 2, at nq moments t, each memory is asked: "if I walk K = n/5 more steps (a 72 degree turn), what will I see?"  The answer is read from the memory
 * alone at the pose the commanded motion leads to, filled in from the prior where the memory has nothing, and scored against the strip really seen there.
 * which = ['win', 'key', 'map'] (any subset), M = frames (window) or keyframes (keyframe store) kept. */
PL.run = function (p, M, which, nq) {
  which = which || ['win', 'key', 'map'];
  var n = p.n, T = p.T, K = p.K, loc = p.loc, inc = PL.stepInc(n), t, k, mem = {}, acc = { none: [0, 0], win: [0, 0], key: [0, 0], map: [0, 0] }, Q = [], pe = 0, pn = 0;
  if (which.indexOf('win') >= 0) mem.win = new PL.Window(M);
  if (which.indexOf('key') >= 0) mem.key = new PL.Keyframes(M);
  if (which.indexOf('map') >= 0) mem.map = new PL.Cells();
  var stride = Math.max(1, Math.floor((n - K) / (nq || 16)));
  for (t = 0; t < T; t++) {
    which.forEach(function (m) { mem[m].write(p.strips[t], loc.corr[t]); });
    if (t >= n) { pe += Math.pow(loc.corr[t][0] - p.poses[t][0], 2) + Math.pow(loc.corr[t][1] - p.poses[t][1], 2); pn++; }
    if (t >= n && t + K < T && (t - n) % stride === 0) {
      var q = loc.corr[t], truth = p.strips[t + K], rec = { t: t, q: q, tq: p.poses[t + K], truth: truth, pred: {}, fill: {} }, r;
      for (k = 0; k < K; k++) q = PL.compose(q, inc);
      rec.q = q;
      r = PL.iou(truth.lab, PL.fill(PL.blank(), p.pri[t % 64], q)); acc.none[0] += r[0]; acc.none[1] += r[1];
      which.forEach(function (m) {
        var o2 = mem[m].read(q), f = PL.fill(o2, p.pri[t % 64], q), r2 = PL.iou(truth.lab, f);
        acc[m][0] += r2[0]; acc[m][1] += r2[1]; rec.pred[m] = o2.lab; rec.fill[m] = f;
      });
      Q.push(rec);
    }
  }
  var f = function (a) { return a[1] ? a[0] / a[1] : 0; }, out = { Q: Q, mem: mem, iou: { none: f(acc.none) }, numbers: {}, poseErr: Math.sqrt(pe / pn) };
  which.forEach(function (m) { out.iou[m] = f(acc[m]); out.numbers[m] = mem[m].numbers(); });
  out.kf = mem.key ? mem.key.fr.length : 0; out.cells = mem.map ? mem.map.count() : 0;
  return out;
};
/* the score of a model with no memory at all: its answer is a random layout of the same kind (all 64 priors, at the true query poses, averaged) */
PL.chance = function (p, nq) {
  var n = p.n, K = p.K, stride = Math.max(1, Math.floor((n - K) / (nq || 16))), t, i, I = 0, U = 0;
  for (t = n; t + K < p.T; t += stride) for (i = 0; i < 64; i++) { var r = PL.iou(p.strips[t + K].lab, PL.render(p.pri[i], p.poses[t + K]).lab); I += r[0]; U += r[1]; }
  return U ? I / U : 0;
};
PL.walk = function (o) { return PL.run(PL.prep(o), o.M, null, o.nq); };

/* ───────── drawing (the widget's three panels) ───────── */
PL.draw = {};
/* the arena seen from above.  S: {p: prep, r: run, rec: the query shown, M} */
PL.draw.arena = function (ctx, box, S) {
  var D = CY.draw, C = CY.C, v = D.view(box[0], box[1], box[2], box[3], 0, W, 0, W), p = S.p, n = p.n, rec = S.rec, i, a, pts = [];
  D.frame(ctx, box[0], box[1], box[2], box[3], '#fbfbfe');
  for (i = 0; i <= 90; i++) { a = 2 * PI * i / 90; pts.push([v.X(6 + PL.RL * Math.cos(a)), v.Y(6 + PL.RL * Math.sin(a))]); }
  D.path(ctx, pts, C.dim, 1, [3, 4]);                                                              // the loop that is walked
  var lo = Math.max(0, rec.t - S.M + 1); pts = [];
  for (i = lo; i <= rec.t; i++) pts.push([v.X(p.poses[i][0]), v.Y(p.poses[i][1])]);
  D.path(ctx, pts, 'rgba(109,74,255,0.55)', 6);                                                      // what the window can still see: the last M frames of the walk
  if (S.r.mem.key) S.r.mem.key.ps.forEach(function (q) { D.dot(ctx, v.X(q[0]), v.Y(q[1]), 2.2, C.cyan); });
  pts = []; for (i = n; i <= rec.t; i++) pts.push([v.X(p.loc.corr[i][0]), v.Y(p.loc.corr[i][1])]);
  D.path(ctx, pts, C.amber, 1.3, [2, 2]);                                                          // where the agent believes it has been in lap 2
  if (p.o.push) { var q0 = p.w.posts[PL.PUSH.k]; ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = C.red; ctx.beginPath(); ctx.arc(v.X(q0.x), v.Y(q0.y), PL.RPOST * v.s, 0, 2 * PI); ctx.stroke(); ctx.restore(); }
  p.w2.posts.forEach(function (q) { D.dot(ctx, v.X(q.x), v.Y(q.y), Math.max(3, PL.RPOST * v.s), PL.COLORS[q.c], C.ink); });
  if (S.r.mem.map) S.r.mem.map.c.forEach(function (e) {                                            // the map, over the posts: one dot per cell, coloured by what it holds
    if (e[3] > 0) { ctx.fillStyle = PL.COLORS[e[3]]; ctx.globalAlpha = 0.85; ctx.fillRect(v.X(e[0] / e[2]) - 1.3, v.Y(e[1] / e[2]) - 1.3, 2.6, 2.6); ctx.globalAlpha = 1; }
  });
  [[rec.tq, C.ink, 1], [rec.q, C.amber, 0.9]].forEach(function (z) {                                  // the view asked about: truth (ink) and where the agent thinks it is (amber)
    var x = z[0][0], y = z[0][1], th = z[0][2], L = 2.4;
    ctx.save(); ctx.fillStyle = z[1]; ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.moveTo(v.X(x), v.Y(y));
    ctx.lineTo(v.X(x + L * Math.cos(th + FOV / 2)), v.Y(y + L * Math.sin(th + FOV / 2))); ctx.lineTo(v.X(x + L * Math.cos(th - FOV / 2)), v.Y(y + L * Math.sin(th - FOV / 2))); ctx.closePath(); ctx.fill(); ctx.restore();
    D.dot(ctx, v.X(x), v.Y(y), 4, z[1], C.white); D.arrow(ctx, v.X(x), v.Y(y), v.X(x + 0.55 * Math.cos(th)), v.Y(y + 0.55 * Math.sin(th)), z[1], 1.6, 6);
  });
  D.dot(ctx, v.X(p.poses[rec.t][0]), v.Y(p.poses[rec.t][1]), 3, C.mute, C.white);
  D.mono(ctx, 'arena 12 m x 12 m', box[0] + 6, box[1] + 10, C.mute, 9);
};
/* the strips: what is really there, and what each memory says it will be (unknown columns, filled from the prior, carry a red bar) */
PL.draw.strips = function (ctx, box, S) {
  var D = CY.draw, C = CY.C, rec = S.rec, lw = 62, vw = 40, cw = (box[2] - lw - vw) / NPX, x0 = box[0] + lw, rows = [['truth', rec.truth.lab, null]], j, r;
  [['window', 'win'], ['keyframes', 'key'], ['map', 'map']].forEach(function (m) { if (rec.fill[m[1]]) rows.push([m[0], rec.fill[m[1]], rec.pred[m[1]]]); });
  rows.forEach(function (row, k) {
    var y = box[1] + k * 38;
    D.mono(ctx, row[0], box[0] + 2, y + 11, C.ink, 10);
    for (j = 0; j < NPX; j++) { ctx.fillStyle = PL.COLORS[row[1][j]]; ctx.fillRect(x0 + j * cw, y, cw + 0.6, 22); if (row[2] && row[2][j] < 0) { ctx.fillStyle = C.red; ctx.fillRect(x0 + j * cw, y + 24, cw + 0.6, 4); } }
    D.frame(ctx, x0 - 0.5, y - 0.5, NPX * cw + 1, 23, 'rgba(0,0,0,0)', C.dim);
    if (row[2]) { r = PL.iou(rec.truth.lab, row[1]); D.mono(ctx, r[1] ? (r[0] / r[1]).toFixed(2) : '-', x0 + NPX * cw + 6, y + 11, C.ink, 10); }
  });
  D.mono(ctx, 'left', x0, box[1] - 7, C.mute, 9); D.mono(ctx, 'right', x0 + NPX * cw, box[1] - 7, C.mute, 9, 'right');
  D.mono(ctx, 'red bar: the memory had nothing, the prior guessed', x0, box[1] + rows.length * 38 - 4, C.red, 9);
};
/* revisit IoU against the length of the lap; S: {n: current index, curves: {win, key, map: arrays over the lap grid}, chance, M} */
PL.draw.curve = function (ctx, box, S, NS) {
  var D = CY.draw, C = CY.C, bx = box[0] + 34, by = box[1] + 16, bw = box[2] - 46, bh = box[3] - 44, X = function (i) { return bx + (i + 0.5) / NS.length * bw; }, Y = function (v) { return by + bh * (1 - v); }, i;
  D.frame(ctx, box[0], box[1], box[2], box[3], C.white);
  [0, 0.5, 1].forEach(function (g) { D.line(ctx, bx, Y(g), bx + bw, Y(g), C.grid, 1); D.mono(ctx, g.toFixed(1), bx - 4, Y(g), C.mute, 9, 'right'); });
  NS.forEach(function (n, k) { D.mono(ctx, '' + n, X(k), by + bh + 11, C.mute, 9, 'center'); });
  D.mono(ctx, 'steps per lap n', bx + bw / 2, by + bh + 25, C.mute, 9, 'center');
  D.mono(ctx, 'revisit score, M = ' + S.M, box[0] + 6, box[1] + 9, C.mute, 9);
  D.line(ctx, bx, Y(S.chance), bx + bw, Y(S.chance), C.dim, 1.4, [4, 3]);
  D.line(ctx, X(S.n), by, X(S.n), by + bh, C.grid, 8);
  [['win', C.purple, 'window'], ['key', C.cyan, 'keyframes'], ['map', C.amber, 'map']].forEach(function (c, k) {
    D.path(ctx, NS.map(function (n, i2) { return [X(i2), Y(S.curves[c[0]][i2])]; }), c[1], 2.2);
    NS.forEach(function (n, i2) { D.dot(ctx, X(i2), Y(S.curves[c[0]][i2]), i2 === S.n ? 4.5 : 2.6, c[1], i2 === S.n ? C.ink : C.white); });
    D.mono(ctx, c[2], box[0] + box[2] - 6 - [121, 73, 16][k], box[1] + 9, c[1], 9);                    // the key, in the header line: window, keyframes, map
  });
};

if (typeof module !== 'undefined' && module.exports) module.exports = PL;
root.PL = PL;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
