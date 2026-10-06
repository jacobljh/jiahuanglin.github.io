/* l06_rare.js — Lesson 6 (the rare case): drawing a case on purpose, and what that does to the statistics.   Load after street.js (and streetview.js).  Namespace SV.l06.
 *
 * The case R is "a pedestrian steps out from behind the van, closer than 12 m": a stratum of the scene program.  The program can DRAW it on purpose (a conditional scene sampler:
 * draw the scene with the step-out forced, keep it only if the pedestrian is closer than 12 m); a data-collection campaign cannot.  Everything here is the program's own machinery
 * (it takes a scene config and a seed), plus three lab privileges, each named as such:
 *     L.evalSet(kind, n, seed0)     stratified frames of the STREET (SV.REAL), generated directly in case R ('R') or among open pedestrians at the same distances ('open'): a project cannot buy these
 *     L.frequency(cfg, n, seed0)    how often a scene program draws case R (scene draws only, no rendering); with SV.REAL.scene it is the street's frequency p, read by simulation
 *     L.P_R                         that frequency of the street (10^6 scene draws, rounded: the builder's and the oracle's value)
 * No Math.random, no Date.  Works in the browser and in node. */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l06 = L;

L.ZR = 12;                      // case R: the pedestrian stands closer than 12 m
L.P_R = 0.008221;               // the street's frequency of case R per frame: the exact integral of the scene law, which 10^6 scene draws reproduce to their sampling error (the oracle recomputes both)

/* is this scene a close step-out? */
L.isR = function (scene) { return !!(scene.ped && scene.mode === 'emerge' && scene.ped.parts[0].z < L.ZR); };

/* a scene from the natural law ('natural'), from its law given R ('R'), given not-R ('notR'), or among OPEN pedestrians closer than 12 m ('open', the control slice).
 * 'R' is rejection sampling on top of the forced composition SV.drawScene(cfg, rng, {ped: true, mode: 'emerge'}), whose law is exactly the natural law given "a pedestrian steps out"
 * (the van is drawn first and the rest of the scene does not depend on the step-out coin), so keeping only z < 12 m gives the natural law given R.  Returns {scene, tries}. */
L.drawScene = function (cfg, rng, stratum) {
  var tries = 0, sc;
  stratum = stratum || 'natural';
  for (;;) {
    tries++;
    if (stratum === 'R') { sc = SV.drawScene(cfg, rng, { ped: true, mode: 'emerge' }); if (sc.ped.parts[0].z < L.ZR) break; }
    else if (stratum === 'open') { sc = SV.drawScene(cfg, rng, { ped: true, mode: 'open' }); if (sc.ped.parts[0].z < L.ZR) break; }
    else if (stratum === 'notR') { sc = SV.drawScene(cfg, rng); if (!L.isR(sc)) break; }
    else { sc = SV.drawScene(cfg, rng); break; }
    if (tries > 100000) throw new Error('l06: the sampler for stratum ' + stratum + ' never accepted');
  }
  return { scene: sc, tries: tries };
};

/* one frame of the pipeline with the scene drawn from the given stratum; for 'natural' it is SV.sample to the last bit */
L.sample = function (pipe, seed, stratum) {
  var rs = SV.stream(seed, 'scene'), rl = SV.stream(seed, 'look'), rn = SV.stream(seed, 'sensor');
  var scene = L.drawScene(pipe.scene, rs, stratum).scene, look = SV.drawLook(pipe.look, scene, rl);
  var ren = SV.render(scene, look), x = SV.sense(ren.rad, pipe.sensor, rn), lab = SV.labels(ren.cov, pipe.label, scene, look);
  return { x: x, cov: ren.cov, y: lab.present, area: lab.area, full: lab.full, mode: scene.mode, z: scene.ped ? scene.ped.parts[0].z : 0, isR: L.isR(scene), seed: seed, scene: scene, look: look, depth: ren.depth, range: ren.range, id: ren.id };
};
/* what a training or evaluation set needs from a frame (the rest is dropped so that a large set fits in memory) */
L.lean = function (f) { return { x: f.x, cov: f.cov, y: f.y, area: f.area, full: f.full, mode: f.mode, z: f.z, isR: f.isR, seed: f.seed }; };

/* the exact-stage program of Lesson 5: the street's scene, light and camera with the program's own label rule */
L.program = function () { return SV.hybrid(SV.SIM0, SV.REAL, { scene: 'b', look: 'b', sensor: 'b', label: 'a' }); };

/* ───────── the design: strata, weights, effective sample size ───────── */
/* p = the street's frequency of R, q = the share of the renders spent on it.  A frame of R carries the density ratio p/q, any other frame (1 - p)/(1 - q). */
L.weights = function (p, q) { return { R: p / q, other: (1 - p) / (1 - q) }; };
/* Kish's effective sample size of a weight vector: the size of an unweighted sample with the same variance of the mean */
L.ess = function (w) { var s = 0, s2 = 0, i; for (i = 0; i < w.length; i++) { s += w[i]; s2 += w[i] * w[i]; } return s * s / s2; };
/* for the two-stratum design the same number in closed form, as a fraction of N */
L.essFrac = function (p, q) { return 1 / (p * p / q + (1 - p) * (1 - p) / (1 - q)); };

/* the PLAN of a training set of N frames with a share q of them drawn in case R (q = null: the natural program), before a single frame is rendered.  The others are the natural frames of
 * seed0, seed0 + 1, ... with the R frames skipped, so for small q the set is the natural set with its few R frames swapped for others; the R frames have their own seeds (seedR + j).
 * Each item is {seed, stratum: 'natural' | 'R', isR, ped}; the weights are target/proposal per stratum: the street (target R share p) by default, or any other target share o.target.
 * Returns {items, weights, nR, q}.  Drawing the scenes of the others costs microseconds; the R scenes are drawn when the frame is rendered. */
L.plan = function (pipe, N, q, seed0, o) {
  o = o || {};
  var p = o.p === undefined ? L.P_R : o.p, t = o.target === undefined ? p : o.target, seedR = o.seedR === undefined ? 16000000 + seed0 : o.seedR, items = [], w = [], i, s, sc, nR = 0;
  if (q === null || q === undefined) {
    for (i = 0; i < N; i++) { sc = SV.drawScene(pipe.scene, SV.stream(seed0 + i, 'scene')); items.push({ seed: seed0 + i, stratum: 'natural', isR: L.isR(sc), ped: !!sc.ped }); w.push(1); if (L.isR(sc)) nR++; }
  } else {
    var n = Math.round(q * N), wR = t / q, wO = (1 - t) / (1 - q);
    for (s = seed0; items.length < N - n; s++) { sc = SV.drawScene(pipe.scene, SV.stream(s, 'scene')); if (L.isR(sc)) continue; items.push({ seed: s, stratum: 'natural', isR: false, ped: !!sc.ped }); w.push(wO); }
    for (i = 0; i < n; i++) { items.push({ seed: seedR + i, stratum: 'R', isR: true, ped: true }); w.push(wR); }
    nR = n;
  }
  return { items: items, weights: w, nR: nR, q: q };
};
/* the frames of a plan (lean) */
L.mixture = function (pipe, N, q, seed0, o) {
  var pl = L.plan(pipe, N, q, seed0, o);
  pl.frames = pl.items.map(function (it) { return L.lean(L.sample(pipe, it.seed, it.stratum)); });
  return pl;
};

/* ───────── lab privilege: stratified frames of the street, for grading the rare slice ───────── */
L.evalSet = function (kind, n, seed0) {
  var out = [], i;
  for (i = 0; i < n; i++) out.push(L.lean(L.sample(SV.REAL, seed0 + i, kind === 'R' ? 'R' : 'open')));
  return out;
};

/* ───────── which pedestrians count: rules on the same frames ───────── */
/* pixel: any pixel of him shows (the program's own rule, kvis 1);  exam: the street's label (at least 15% of the silhouette) and at least 6 px² visible, which is how SV.exam picks its pedestrians;
 * frac15: the street's label alone;  half: at least half of the silhouette visible (a stricter rule, only to show how far the number can move).  f needs y (the street's label), area and full. */
L.RULES = ['pixel', 'exam', 'frac15', 'half'];
L.counts = function (f, rule) {
  if (rule === 'pixel') return f.area >= 1;
  if (rule === 'exam') return !!f.y && f.area >= SV.EXAM.minArea;
  if (rule === 'frac15') return !!f.y;
  return f.area >= 0.5 * f.full;
};
/* miss rate of a score vector over the frames that count under the rule: scores above thr are found */
L.sliceMiss = function (set, scores, thr, rule) {
  var n = 0, hit = 0, i;
  for (i = 0; i < set.length; i++) if (L.counts(set[i], rule)) { n++; if (scores[i] > thr) hit++; }
  return { n: n, miss: n ? 1 - hit / n : null };
};
/* the visible fraction of the silhouette, in bins: the detector's miss rate as the pedestrian steps into view */
L.FRAC_EDGES = [0, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.0001];
L.fracBin = function (f) { var r = f.full > 0 ? f.area / f.full : 0, b = 0; while (b + 1 < L.FRAC_EDGES.length - 1 && r >= L.FRAC_EDGES[b + 1]) b++; return b; };

/* ───────── how often does a scene program draw R?  scene draws only ───────── */
L.frequency = function (cfg, n, seed0) {
  var nR = 0, nPed = 0, nEm = 0, i, sc;
  for (i = 0; i < n; i++) {
    sc = SV.drawScene(cfg, SV.stream(seed0 + i, 'scene'));
    if (sc.ped) { nPed++; if (sc.mode === 'emerge') { nEm++; if (sc.ped.parts[0].z < L.ZR) nR++; } }
  }
  return { n: n, nR: nR, nPed: nPed, nEmerge: nEm, p: nR / n };
};

/* ───────── how many renders for the cases that matter: Neyman allocation ───────── */
/* Estimate the street's cost-weighted loss  L = sum_s p_s c_s mu_s  from n_s frames per stratum.  Var = sum_s (p_s c_s sigma_s)^2 / n_s, and with sum n_s = N the minimiser is
 * n_s proportional to p_s c_s sigma_s.  For the two strata (R, others): the share of renders that goes to R. */
L.neymanShare = function (p, c, sigR, sigO) { var a = p * c * sigR, b = (1 - p) * sigO; return a / (a + b); };
L.estVar = function (p, c, sigR, sigO, q, N) { return (Math.pow(p * c * sigR, 2) / (q * N) + Math.pow((1 - p) * sigO, 2) / ((1 - q) * N)); };

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
