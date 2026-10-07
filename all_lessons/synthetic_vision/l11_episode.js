/* l11_episode.js — Lesson 11 (what braking changes): the closed-loop step-out episode of the Street.   Load after street.js.   Namespace SV.l11.   Lesson 12 imports this file.
 *
 * THE EPISODE.  A pedestrian steps out from behind the van and walks toward the shuttle's lane while the shuttle drives at v0 along +z.  The camera sits at the shuttle's front and records a
 * frame every DT = 0.1 s; the van and the clutter stand still in the world, so frame k is the street seen from s = v0 t_k metres further on, with the pedestrian x = x0 - u t_k.  A DETECTOR
 * scores each frame (SV.score), an alarm is a score above the detector's threshold, and the POLICY brakes once m of the last n frames alarmed.  The decision frame k_d fixes the BRAKE ONSET
 * t_d + tau (tau = the latency from decision to deceleration); the shuttle then decelerates at a until it stops.  The outcome is a collision (the front reaches the pedestrian's near surface
 * while the pedestrian is inside the lane) with an impact speed, or a stop short of the pedestrian, or a pass.  The decision is final (an emergency brake, once on, stays on), so nothing rendered after the decision
 * can change it: the outcome of ANY action at the decision, brake or coast, is closed-form kinematics on the same frames.  That is what makes a branch cheap, and exact.
 *
 * SITUATION = a seed.  Everything random in an episode is a function of the seed, in named streams (common random numbers, CRN):
 *     stream(seed,'scene')   the scene (van, clutter, the pedestrian's depth z0 and start x0)       stream(seed,'look')   the light and colours
 *     stream(seed,'dyn')     the pedestrian's walking speed u                                          stream(seed,'sensor'+k)  the sensor noise of frame k  (L.noise)
 *     stream(seed,'driver')  the human driver's draw (L.humanDriver)
 * So two detectors, two policies or two worlds that share a seed share the scene, the light and the noise of every frame; frame k's noise is the same whether or not an earlier frame was rendered.
 *
 * API (all pure and deterministic; browser and node; no Math.random, no Date):
 *   L.SHUTTLE {v0:7, a:3, tau:0.4, half:1}   the lab's ASSUMPTIONS (speed m/s, deceleration m/s^2, latency s, half-width m): not facts about any vehicle.   L.POLICY {m:2, n:3}.   L.DT
 *   L.PROGRAM_DYN / L.STREET_DYN {u:[lo,hi]}  the pedestrian's walking speed law: the program's (a fixed 1.4 m/s) and the street's (LAB PRIVILEGE: a spread with the same mean)
 *   L.world(pipe, dyn) -> {pipe, dyn};  L.programWorld(code='bbba') the exact-stage program of Lessons 5-6 (or any of the sixteen codes) with the program's walking speed;  L.streetWorld() the street
 *   L.situation(world, seed, sh) -> sit  {seed, z0, x0, u, r, ...}: draws the scene, light and speed once; sit caches its frames (reuse sit to score several detectors on the same frames)
 *   L.frame(sit, k) -> Float32Array   the sensor image of coast frame k (L.radiance: the noise-free radiance);   L.areaAt(sit, k)  the pedestrian's visible area (px^2) in it;   L.noise(seed, k)  its noise stream
 *   L.episode(world, model, policy, seed, opts) -> ep   model {dim,w,mu,sd}, policy {thr, m, n};  opts {sh, sit, full:true (score every frame to the arrival), extra:n (keep scoring n frames after the decision, for display), v0, a, tau}
 *        ep = {seed, z0, x0, u, r, kDecide (-1: never), tDecide (null: never), onset (s; Infinity: never), outcome 'collision'|'stop'|'pass', collision, vImpact, margin, tf, scores, alarms, sit, sh}
 *        margin = the signed STOPPING MARGIN (m): distance left to the pedestrian's near surface when a shuttle decided at tDecide has stopped; negative = could not stop even if the pedestrian stood still.
 *        A shuttle that never decides gets the margin of a decision at the last instant, -dStop.
 *   L.branch(ep, action) -> outcome   action 'brake' (the onset the policy chose) | 'coast' (never brake) | a number (an onset, s): the same situation, the same frames, another action
 *   L.outcome(sit, onset, sh) -> {outcome, collision, vImpact, margin, tf}    L.dStop(sh) = v0 tau + v0^2/(2a)    L.deadline(sit, sh) = the latest decision time that still stops short
 *   L.travel / L.speedAt / L.timeAt (v0, a, onset)   the kinematics in closed form
 *   L.humanDriver(seed) -> {A, tau};  L.humanEpisode(sit, drv, sh) -> ep-like record with braked, onset and outcome;  L.humanLogs(world, n, seed0, opts) -> episodes of the natural law of step-outs
 *   L.drive(world, model, policy, seed, opts) -> {kDecide, scores, ...}   a pedestrian-free approach of K frames (the false-brake side of the policy)
 *   L.BINS, L.binOf(z), L.seedsInBin(world, bin, n, seed0), L.binProbs(world, n, seed0)   the step-out distance strata of Lessons 5-6 and the stratified situation sampler
 *   L.decide(alarms, m, n) -> the first frame with m alarms among the last n, or -1;   L.mean, L.sd, L.cov, L.corr: the small statistics the builder and the oracle share
 *   L.resample(a, b, n, repeats) -> {dS, dI, sdS, sdI}   two arms' per-situation 0/1 outcomes a, b (same situation order): repeat r draws n situations with SV.rng(1000 + r); dS = the mean of a - b over the SAME n (shared numbers),
 *        dI = the mean of a over n minus the mean of b over n OTHER situations (independent); sdS, sdI their spreads over the repeats */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l11 = L;

L.DT = 0.1;
L.SHUTTLE = { v0: 7, a: 3, tau: 0.4, half: 1.0 };
L.POLICY = { m: 2, n: 3 };
L.PROGRAM_DYN = { u: [1.4, 1.4] };
L.STREET_DYN = { u: [0.6, 2.2] };
L.HUMAN = { tau: 0.7, aMin: 6, aMax: 27, see: 6 };
L.BINS = [[0, 12], [12, 16], [16, 22], [22, 99]];
L.BIN_NAMES = ['closer than 12 m', '12 to 16 m', '16 to 22 m', '22 m and beyond'];
L.NFREE = 35;

L.shuttle = function (o) { var s = L.SHUTTLE; o = o || {}; return { v0: o.v0 === undefined ? s.v0 : o.v0, a: o.a === undefined ? s.a : o.a, tau: o.tau === undefined ? s.tau : o.tau, half: o.half === undefined ? s.half : o.half }; };
L.world = function (pipe, dyn) { return { pipe: pipe, dyn: dyn || L.PROGRAM_DYN }; };
L.programWorld = function (code) { code = code || 'bbba'; var p = {}; ['scene', 'look', 'sensor', 'label'].forEach(function (k, i) { p[k] = code[i]; }); return L.world(SV.hybrid(SV.SIM0, SV.REAL, p), L.PROGRAM_DYN); };
L.streetWorld = function () { return L.world(SV.REAL, L.STREET_DYN); };

/* ───────── kinematics: the shuttle holds v0 until the brake onset tb, then decelerates at a until it stops ───────── */
L.dStop = function (sh) { return sh.v0 * sh.tau + sh.v0 * sh.v0 / (2 * sh.a); };
L.travel = function (t, v0, a, tb) { if (t <= tb) return v0 * t; var d = Math.min(t - tb, v0 / a); return v0 * tb + v0 * d - 0.5 * a * d * d; };
L.speedAt = function (t, v0, a, tb) { return t <= tb ? v0 : Math.max(0, v0 - a * (t - tb)); };
L.timeAt = function (s, v0, a, tb) { if (s <= v0 * tb) return s / v0; var disc = v0 * v0 - 2 * a * (s - v0 * tb); return disc < 0 ? Infinity : tb + (v0 - Math.sqrt(disc)) / a; };

/* the outcome of braking from the onset tb (Infinity: never): the front reaches the pedestrian's near surface z0 - r at tf, or the shuttle stops short of it */
L.outcome = function (sit, tb, sh) {
  var zc = sit.z0 - sit.r, tf = L.timeAt(zc, sh.v0, sh.a, tb), margin = tb === Infinity ? null : zc - L.travel(Infinity, sh.v0, sh.a, tb);
  if (tf === Infinity) return { outcome: 'stop', collision: false, vImpact: 0, margin: margin, tf: Infinity };
  var xp = sit.x0 - sit.u * tf, hit = Math.abs(xp) < sh.half + sit.r;
  return { outcome: hit ? 'collision' : 'pass', collision: hit, vImpact: hit ? L.speedAt(tf, sh.v0, sh.a, tb) : 0, margin: margin, tf: tf };
};
/* the latest decision time at which a shuttle still stops short of the pedestrian's near surface */
L.deadline = function (sit, sh) { return (sit.z0 - sit.r - L.dStop(sh)) / sh.v0; };
/* the signed stopping margin of a decision at time td: distance left when the shuttle has stopped (negative: it could not) */
L.marginAt = function (sit, td, sh) { return sit.z0 - sit.r - sh.v0 * td - L.dStop(sh); };

/* ───────── situations and frames ───────── */
L.noise = function (seed, k) { return SV.stream(seed, 'sensor' + k); };
L.situation = function (world, seed, sh) {
  sh = sh || L.shuttle();
  var pipe = world.pipe, sc = SV.drawScene(pipe.scene, SV.stream(seed, 'scene'), { ped: true, mode: 'emerge', vis: 0 });
  var look = SV.drawLook(pipe.look, sc, SV.stream(seed, 'look')), u = SV.uni(SV.stream(seed, 'dyn'), world.dyn.u[0], world.dyn.u[1]), pp = sc.ped.parts;
  return { seed: seed, world: world, sh: sh, scene: sc, look: look, u: u, x0: pp[0].x, z0: pp[0].z, r: pp[1].r, ped: sc.ped.id, xs: [], rads: [], area: [] };
};
/* a pedestrian-free approach (the false-brake side of a policy): the scene law of the world with no pedestrian */
L.free = function (world, seed, sh) {
  sh = sh || L.shuttle();
  var pipe = world.pipe, sc = SV.drawScene(pipe.scene, SV.stream(seed, 'scene'), { ped: false });
  return { seed: seed, world: world, sh: sh, scene: sc, look: SV.drawLook(pipe.look, sc, SV.stream(seed, 'look')), u: 0, x0: 0, z0: Infinity, r: 0, ped: -1, xs: [], rads: [], area: [] };
};
/* coast frame k: the camera has travelled v0 t_k, the pedestrian has walked u t_k; sensor noise from the stream of (seed, k) */
L.radiance = function (sit, k) {
  if (sit.rads[k]) return sit.rads[k];
  var t = k * L.DT, s = sit.sh.v0 * t, xp = sit.x0 - sit.u * t, i, a = 0;
  var parts = sit.scene.parts.map(function (p) { var q = {}, key; for (key in p) q[key] = p[key]; q.z = p.z - s; if (p.id === sit.ped) q.x = xp; return q; });
  var ren = SV.render({ insts: sit.scene.insts, parts: parts }, sit.look, {});
  for (i = 0; i < ren.cov.length; i++) a += ren.cov[i];
  sit.area[k] = a;
  return (sit.rads[k] = ren.rad);
};
L.frame = function (sit, k) { return sit.xs[k] || (sit.xs[k] = SV.sense(L.radiance(sit, k), sit.world.pipe.sensor, L.noise(sit.seed, k))); };
L.areaAt = function (sit, k) { L.radiance(sit, k); return sit.area[k]; };

/* ───────── the policy: m alarms among the last n frames ───────── */
L.windowCount = function (alarms, k, n) { var c = 0, j; for (j = Math.max(0, k - n + 1); j <= k; j++) if (alarms[j]) c++; return c; };
L.decide = function (alarms, m, n) { for (var k = 0; k < alarms.length; k++) if (L.windowCount(alarms, k, n) >= m) return k; return -1; };

/* ───────── one episode of a detector's policy ───────── */
L.episode = function (world, model, policy, seed, opts) {
  opts = opts || {};
  var sh = opts.sh || L.shuttle(opts), sit = opts.sit || L.situation(world, seed, sh), P = policy || L.POLICY, m = P.m || L.POLICY.m, n = P.n || L.POLICY.n;
  var kEnd = L.lastFrame(sit, sh), scores = [], alarms = [], k, kd = -1, kStop = Infinity;
  for (k = 0; k <= kEnd && k <= kStop; k++) {
    scores.push(SV.score(model, L.frame(sit, k)).s); alarms.push(scores[k] > P.thr);
    if (kd < 0 && L.windowCount(alarms, k, n) >= m) { kd = k; if (!opts.full) kStop = k + (opts.extra || 0); }
  }
  return L.finish(sit, sh, kd, scores, alarms);
};
/* the record of an episode whose decision frame is kd (-1: never): onset = t_d + tau, outcome and margin in closed form */
L.finish = function (sit, sh, kd, scores, alarms) {
  var td = kd < 0 ? Infinity : kd * L.DT, onset = td + sh.tau, o = L.outcome(sit, onset, sh), zc = sit.z0 - sit.r;
  return { seed: sit.seed, z0: sit.z0, x0: sit.x0, u: sit.u, r: sit.r, kDecide: kd, tDecide: kd < 0 ? null : td, onset: onset, outcome: o.outcome, collision: o.collision, vImpact: o.vImpact,
           margin: kd < 0 ? -L.dStop(sh) : L.marginAt(sit, td, sh), tf: o.tf, tf0: zc / sh.v0, scores: scores, alarms: alarms, sit: sit, sh: sh };
};
/* the same situation and the same decision, another action: 'brake' (the policy's onset), 'coast' (never brake), or an onset in seconds */
L.branch = function (ep, action) {
  var tb = action === 'coast' ? Infinity : action === 'brake' ? ep.onset : action;
  var o = L.outcome(ep.sit, tb, ep.sh); o.onset = tb; return o;
};

/* ───────── the false-brake side: a pedestrian-free approach of K frames ───────── */
L.drive = function (world, model, policy, seed, opts) {
  opts = opts || {};
  var sh = opts.sh || L.shuttle(opts), sit = opts.sit || L.free(world, seed, sh), P = policy || L.POLICY, K = opts.K || L.NFREE, scores = [], alarms = [], k, kd = -1;
  for (k = 0; k < K; k++) {
    scores.push(SV.score(model, L.frame(sit, k)).s); alarms.push(scores[k] > P.thr);
    if (kd < 0 && L.windowCount(alarms, k, P.n || L.POLICY.n) >= (P.m || L.POLICY.m)) { kd = k; if (!opts.full) break; }
  }
  return { seed: seed, kDecide: kd, K: K, scores: scores, alarms: alarms, sit: sit };
};

/* ───────── the human driver of the logs ─────────
 * A driver has a personal threshold A (px^2, uniform on 6 to 27) on the pedestrian's full silhouette at the moment of the step-out: a step-out that looks smaller does not register (a far pedestrian is a few pixels;
 * 27 px^2 is the smallest silhouette of any step-out closer than 12 m, so every driver notices those).
 * A driver who registers it brakes tau_h = 0.7 s after the first frame in which 6 px^2 of the pedestrian show (the exam's own rule for a pedestrian that counts), at the shuttle's deceleration.
 * Who brakes is decided by the situation (its size on the image), and so is the outcome: that is the confounding. */
L.humanDriver = function (seed) { var H = L.HUMAN; return { A: SV.uni(SV.stream(seed, 'driver'), H.aMin, H.aMax), tau: H.tau }; };
L.fullArea = function (sit) {                    // the pedestrian's whole silhouette (px^2) at the step-out, from the amodal render
  if (sit.full === undefined) { var ren = SV.render(sit.scene, sit.look, { only: 'ped', maps: true }), a = 0, i; for (i = 0; i < ren.cov.length; i++) a += ren.cov[i]; sit.full = a; }
  return sit.full;
};
L.firstSeen = function (sit, kMax) {              // the first frame in which at least HUMAN.see px^2 of the pedestrian show (-1: never before kMax): the frame at which the exam would count the pedestrian
  for (var k = 0; k <= kMax; k++) if (L.areaAt(sit, k) >= L.HUMAN.see) return k;
  return -1;
};
L.lastFrame = function (sit, sh) { return Math.floor((sit.z0 - sit.r) / sh.v0 / L.DT); };      // the last frame before the unbraked front reaches the pedestrian
L.humanEpisode = function (sit, drv, sh) {
  sh = sh || sit.sh; var kEnd = L.lastFrame(sit, sh), braked = drv.A <= L.fullArea(sit), ks = braked ? L.firstSeen(sit, kEnd) : -1;
  var onset = ks < 0 ? Infinity : ks * L.DT + drv.tau, o = L.outcome(sit, onset, sh), c = L.outcome(sit, Infinity, sh);
  return { seed: sit.seed, z0: sit.z0, u: sit.u, A: drv.A, full: sit.full, braked: braked, onset: onset, collision: o.collision, vImpact: o.vImpact, outcome: o.outcome,
           coast: c.collision, coastV: c.vImpact, sit: sit };
};
L.humanLogs = function (world, n, seed0, opts) {
  var out = [], i, sit, sh = L.shuttle(opts);
  for (i = 0; i < n; i++) { sit = L.situation(world, seed0 + i, sh); out.push(L.humanEpisode(sit, L.humanDriver(seed0 + i), sh)); delete out[i].sit; }
  return out;
};

/* ───────── strata of the step-out distance, and the stratified situation sampler ───────── */
L.binOf = function (z) { for (var b = L.BINS.length - 1; b > 0; b--) if (z >= L.BINS[b][0]) return b; return 0; };
L.stepOutDepth = function (world, seed) { return SV.drawScene(world.pipe.scene, SV.stream(seed, 'scene'), { ped: true, mode: 'emerge', vis: 0 }).ped.parts[0].z; };
/* the first n seeds from seed0 on whose forced step-out is in the stratum (scene draws only: microseconds each) */
L.seedsInBin = function (world, bin, n, seed0) {
  var out = [], s = seed0, z;
  while (out.length < n) { z = L.stepOutDepth(world, s); if (L.binOf(z) === bin) out.push(s); s++; if (s - seed0 > 5e6) throw new Error('l11: the sampler never filled stratum ' + bin); }
  return out;
};
/* the natural probability of each stratum among forced step-outs: scene draws only */
L.binProbs = function (world, n, seed0) { var c = L.BINS.map(function () { return 0; }), i; for (i = 0; i < n; i++) c[L.binOf(L.stepOutDepth(world, seed0 + i))]++; return c.map(function (x) { return x / n; }); };

/* ───────── small statistics (used by the builder, the oracle and the page) ───────── */
L.mean = function (a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
L.cov = function (a, b) { var ma = L.mean(a), mb = L.mean(b), s = 0, i; for (i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / (a.length - 1); };
L.sd = function (a) { return Math.sqrt(L.cov(a, a)); };
L.corr = function (a, b) { return L.cov(a, b) / (L.sd(a) * L.sd(b)); };

/* the estimate of (mean of arm a) - (mean of arm b) from n situations out of the pool, repeated: with SHARED numbers both arms use the same n situations, with INDEPENDENT numbers arm b uses n others.
 * Seeded (repeat r uses SV.rng(1000 + r)), so every caller draws the same repeats.  Returns {dS, dI, sdS, sdI}: the estimates and their spread in the two modes. */
L.resample = function (a, b, n, repeats) {
  var dS = [], dI = [], N = a.length, r, i, j, t, perm = [];
  for (r = 0; r < repeats; r++) {
    var rng = SV.rng(1000 + r), s0 = 0, s1 = 0, s2 = 0;
    for (i = 0; i < N; i++) perm[i] = i;
    for (i = N - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (i = 0; i < n; i++) { s0 += a[perm[i]] - b[perm[i]]; s1 += a[perm[i]]; s2 += b[perm[n + i]]; }
    dS.push(s0 / n); dI.push((s1 - s2) / n);
  }
  return { dS: dS, dI: dI, sdS: L.sd(dS), sdI: L.sd(dI) };
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
