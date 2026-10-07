/* l05_cases.js — Lesson 5 (cover the cases): the labelled sample, the ruler for cases, the case table, coverage, and the programs built from them.  Load after street.js and streetview.js.
 *
 * WHAT A PROJECT HOLDS.  A labelled sample: frames in which a person outlined every pedestrian the labelling spec counts (at least 15 % of the silhouette showing) and every vehicle.
 * labelSample() is the ONE place where the lab turns a frame's maps into such outlines; everything after it (ruler, tally, estimate) sees only the outlines and the pedestrian's
 * outlined area.  The Street is a program, so a lesson may also run the ruler on the program's own frames (their outlines are free), and the oracle may compare the ruler with truth.
 *
 *   SV.l05.labelSample(frame)   -> {ped: Uint8Array|null, area, veh: Uint8Array|null}     binary outlines (pedestrian: coverage >= 0.5; vehicle: the pixel's centre ray hits it)
 *   SV.l05.ruler(label)         -> null | {jb, z, lo, hi, step, area, band, cell, exam, ...}   the foot row, its distance, whether a nearer vehicle hides part of the pedestrian
 *   SV.l05.tally(rulers)        -> counts per cell (4 distance bands x {open, stepping out}) over the pedestrians the exam counts
 *   SV.l05.estimate(rulers, o)  -> the scene settings the sample supports (distance range of open pedestrians, step-out probability, whole-pedestrian area)
 *   SV.l05.scenePipe(base, e)   -> a copy of a program with its scene stage edited (exact components, or an estimate)
 *   SV.l05.realCase(kind, n, s) -> a stratified sample from the street's program (LAB PRIVILEGE: a project cannot sample a case on demand)
 * Deterministic: no Math.random, no Date.  Namespace SV.l05; nothing in SV is changed. */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l05 = L;
var C = SV.CAM, W = C.W, H = C.H, HW = W * H, FL = C.f, V0 = C.V0, HC = C.hc;

/* the labelling spec and the exam's rule (written definitions the project owns) */
L.SPEC = { rel: 0.15, minArea: 6 };
L.BAND_ROWS = [18, 16, 14];                                    // a foot row >= 18 is band 0, >= 16 band 1, >= 14 band 2, else band 3
L.BAND_NAMES = ['8 to 12.6 m', '12.6 to 16 m', '16 to 22 m', '22 m and beyond'];
L.CELL_NAMES = [];
(function () { for (var b = 0; b < 4; b++) { L.CELL_NAMES.push(L.BAND_NAMES[b] + ', open'); L.CELL_NAMES.push(L.BAND_NAMES[b] + ', stepping out'); } })();

/* ───────────── the labeller ───────────── */
L.labelSample = function (fr) {
  var out = { ped: null, area: 0, veh: null }, q, n = 0;
  if (fr.scene.ped && fr.area >= Math.max(1, L.SPEC.rel * fr.full)) {
    var m = new Uint8Array(HW);
    for (q = 0; q < HW; q++) if (fr.cov[q] >= 0.5) { m[q] = 1; n++; }
    if (n) { out.ped = m; out.area = fr.area; }
  }
  if (fr.scene.van) {
    var v = new Uint8Array(HW), k = 0, id = fr.scene.van.id;
    for (q = 0; q < HW; q++) if (fr.id[q] === id) { v[q] = 1; k++; }
    if (k) out.veh = v;
  }
  return out;
};

/* ───────────── the ground-plane law and its rows ───────────── */
/* a ground point at depth z lies on image row v = V0 + f*hc/z (continuous, pixel (u, j) covering v in [j, j+1)); a pixel is outlined when at least half of it is pedestrian, and with two sub-rows
 * per pixel at j+0.25 and j+0.75 that means v_foot > j + 0.25.  So the lowest outlined row jb says v_foot in (jb + 0.25, jb + 1.25]. */
L.zOfRow = function (jb) { return FL * HC / (jb + 0.75 - V0); };                      // the reading: the middle of the row's interval
L.rowSpan = function (jb) { return [FL * HC / (jb + 1.25 - V0), jb + 0.25 - V0 > 0 ? FL * HC / (jb + 0.25 - V0) : Infinity]; };
L.bandOfRow = function (jb) { return jb >= L.BAND_ROWS[0] ? 0 : jb >= L.BAND_ROWS[1] ? 1 : jb >= L.BAND_ROWS[2] ? 2 : 3; };
L.bandEdges = function () { return L.BAND_ROWS.map(function (r) { return FL * HC / (r + 0.25 - V0); }); };       // the distances where the foot row changes band: 12.6, 16.05 and 22.2 m

function bbox(m) {
  var jb = -1, jt = H, u0 = W, u1 = -1, n = 0, i, j;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) if (m[j * W + i]) { n++; if (j > jb) jb = j; if (j < jt) jt = j; if (i < u0) u0 = i; if (i > u1) u1 = i; }
  return n ? { jb: jb, jt: jt, u0: u0, u1: u1, n: n } : null;
}
L.bbox = bbox;

/* the ruler: foot row -> distance; a pedestrian is "stepping out" when the outline runs into a vehicle's outline and that vehicle's lowest row, in the touching columns, is at or below the feet
 * (the vehicle is nearer than the pedestrian is). */
L.ruler = function (lab) {
  if (!lab.ped) return null;
  var m = lab.ped, b = bbox(m), step = false, vb = -1, i, j, di, dj, k, vm = lab.veh;
  if (vm) {
    for (j = b.jt; j <= b.jb; j++) for (i = b.u0; i <= b.u1; i++) if (m[j * W + i]) {
      for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
        var jj = j + dj, ii = i + di;
        if (jj >= 0 && jj < H && ii >= 0 && ii < W && vm[jj * W + ii]) { for (k = H - 1; k >= 0; k--) if (vm[k * W + ii]) { if (k > vb) vb = k; break; } }
      }
    }
    step = vb >= b.jb;
  }
  var sp = L.rowSpan(b.jb), band = L.bandOfRow(b.jb);
  return { jb: b.jb, jt: b.jt, u0: b.u0, u1: b.u1, z: L.zOfRow(b.jb), lo: sp[0], hi: sp[1], step: step, vb: vb, area: lab.area, exam: lab.area >= L.SPEC.minArea, band: band, cell: 2 * band + (step ? 1 : 0), cut: b.jb >= H - 1 };
};

/* ───────────── counting cases ───────────── */
L.NCELL = 8;
L.tally = function (rulers) {
  var c = [0, 0, 0, 0, 0, 0, 0, 0], n = 0;
  rulers.forEach(function (r) { if (r && r.exam) { c[r.cell]++; n++; } });
  return { counts: c, n: n, share: c.map(function (x) { return n ? x / n : 0; }) };
};
/* a cell is "drawn" when the program puts at least `floor` of its pedestrians there; coverage = the street's share in drawn cells */
L.coverage = function (p, q, floor) { var s = 0; for (var c = 0; c < p.length; c++) if (q[c] >= (floor === undefined ? 0.01 : floor)) s += p[c]; return s; };
L.beyond = function (p) { return p[4] + p[5] + p[6] + p[7]; };                         // bands 2 and 3: beyond the 16 m the program draws
L.stepShare = function (p) { return p[1] + p[3] + p[5] + p[7]; };
/* the whole pedestrian's area at distance z: A0 (f/z)^2, with A0 read off the open pedestrians of the same sample (median of area * (z/f)^2) */
L.wholeArea = function (rulers) {
  var a = [];
  rulers.forEach(function (r) { if (r && r.exam && !r.step) a.push(r.area * Math.pow(r.z / FL, 2)); });
  a.sort(function (x, y) { return x - y; });
  return a.length ? a[a.length >> 1] : NaN;
};
L.phi = function (r, A0) { return r.area / (A0 * Math.pow(FL / r.z, 2)); };

/* percentile bootstrap of the cell shares: B resamples of the exam pedestrians, 10th and 90th percentile of each cell and of the three headline quantities */
L.bootstrap = function (rulers, B, seed, qvec) {
  var ex = rulers.filter(function (r) { return r && r.exam; }), n = ex.length, rng = SV.rng(seed || 7), out = [], b, i, c;
  for (b = 0; b < B; b++) {
    var cnt = [0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < n; i++) cnt[ex[Math.floor(rng() * n)].cell]++;
    out.push(cnt.map(function (x) { return n ? x / n : 0; }));
  }
  function pct(f, p) { var v = out.map(f).sort(function (x, y) { return x - y; }); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0; }
  var cells = [];
  for (c = 0; c < 8; c++) cells.push([pct(function (s) { return s[c]; }, 0.1), pct(function (s) { return s[c]; }, 0.9)]);
  return { cells: cells, beyond: [pct(L.beyond, 0.1), pct(L.beyond, 0.9)], step: [pct(L.stepShare, 0.1), pct(L.stepShare, 0.9)],
           cover: qvec ? [pct(function (s) { return L.coverage(s, qvec); }, 0.1), pct(function (s) { return L.coverage(s, qvec); }, 0.9)] : null };
};

/* ───────────── from a sample to a scene ───────────── */
/* The program's distance range and step-out probability from a labelled sample.
 *   range: the nearest and farthest OPEN pedestrian, each reading corrected by the ruler's bias (measured on the program's own frames, where the truth is free);
 *   step-out probability: what the program must draw so that ITS ruler counts the same share of step-outs among the pedestrians the exam counts: odds(share) = kappa * odds(p),
 *   kappa = (step-out odds among counted pedestrians) / (step-out odds among drawn pedestrians), measured once on the program's own frames. */
L.estimate = function (rulers, o) {
  o = o || {};
  var ex = rulers.filter(function (r) { return r && r.exam; }), open = ex.filter(function (r) { return !r.step; }), nstep = ex.length - open.length, bias = o.bias || 0, kappa = o.kappa || 1;
  var zs = open.map(function (r) { return r.z - bias; }).sort(function (a, b) { return a - b; });
  var share = ex.length ? nstep / ex.length : 0, odds = share / (1 - share), pe = odds / (odds + kappa);
  return { n: ex.length, nOpen: open.length, nStep: nstep, zlo: zs.length ? zs[0] : NaN, zhi: zs.length ? zs[zs.length - 1] : NaN, share: share, pEmerge: pe, A0: L.wholeArea(rulers) };
};

/* exact components of the scene stage: the street's value of one setting, or the group of settings that belong together (lab privilege: it reads SV.REAL.scene) */
L.COMPONENTS = ['dist', 'emerge', 'body', 'van', 'clutter'];
L.scenePipe = function (base, spec) {
  var p = SV.clone(base), S = p.scene, R = SV.REAL.scene, list = spec.exact || [];
  list.forEach(function (c) {
    if (c === 'dist') S.z = R.z.slice();
    if (c === 'body') { S.r = R.r.slice(); S.h = R.h.slice(); }
    if (c === 'van') { S.van = SV.clone(R.van); S.pVan = R.pVan; }
    if (c === 'clutter') { S.clutter = R.clutter; S.pRed = R.pRed; }
  });
  if (list.indexOf('emerge') >= 0) S.pEmerge = Math.round(1e6 * R.pVan * R.pEmerge / S.pVan) / 1e6;               // the street steps out 0.8 x 0.35 = 28 % of its pedestrians (the van must be there): 0.28 with the program's always-present van
  if (spec.z) S.z = [spec.z[0], spec.z[1]];
  if (spec.pEmerge !== undefined) S.pEmerge = Math.round(1e6 * Math.min(1, spec.pEmerge / S.pVan)) / 1e6;        // spec.pEmerge = the share of pedestrians who step out
  if (spec.clutter !== undefined) S.clutter = spec.clutter;
  if (spec.pRed !== undefined) S.pRed = spec.pRed;
  return p;
};
L.rulers = function (frames) { return frames.map(function (fr) { return L.ruler(L.labelSample(fr)); }); };

/* ───────────── rare cases ───────────── */
/* the case this lesson ends on: a pedestrian whose axis is nearer than 12 m steps out from behind a van (R).  Truth, from the scene: lab privilege. */
L.CLOSE = 12;
L.isClose = function (scene) { return !!(scene.ped && scene.mode === 'emerge' && scene.ped.parts[0].z < L.CLOSE); };
/* a stratified sample from the street's program: rejection at the scene-draw level (the scene alone costs microseconds), one render per kept frame.
 * kind: 'closeStepOut' (steps out, axis nearer than 12 m) or 'closeOpen' (stands in the open, nearer than 12 m).  Returns {frames, tries}. */
L.realCase = function (kind, n, seed0) {
  var want = kind === 'closeStepOut' ? { ped: true, mode: 'emerge' } : { ped: true, mode: 'open' }, out = [], s = seed0, tries = 0;
  while (out.length < n) {
    var sc = SV.drawScene(SV.REAL.scene, SV.stream(s, 'scene'), want);
    tries++;
    if (sc.ped && sc.ped.parts[0].z < L.CLOSE) out.push(SV.sample(SV.REAL, s, want));
    s++;
  }
  return { frames: out, tries: tries };
};
/* the labelled budget of a page: the first n frames of the project's labelled sample, drawn when first needed (frames, outlines, ruler readings), and a strip of frames chosen by what the ruler read */
L.budget = function () {
  var B = { FR: [], LB: [], RS: [], strip: [] };
  B.grow = function (n) { while (B.FR.length < n) { var f = SV.sample(SV.REAL, SV.SEEDS.labeled + B.FR.length), lb = L.labelSample(f); B.FR.push(f); B.LB.push(lb); B.RS.push(L.ruler(lb)); } return B; };
  B.pickStrip = function (cells, within) {
    B.grow(within);
    B.strip = cells.map(function (c) { for (var i = 0; i < within; i++) if (B.RS[i] && B.RS[i].exam && B.RS[i].cell === c) return i; return -1; }).filter(function (i) { return i >= 0; });
    return B;
  };
  return B;
};
/* LAB PRIVILEGE: what the street's own record says about a frame's pedestrian (the oracle and the lab-truth box use it; a project has no such thing) */
L.truthOf = function (fr) { var p = fr.scene.ped; return p ? { z: p.parts[0].z, mode: fr.mode, full: fr.full } : null; };
L.pAbsent = function (p, n) { return Math.pow(1 - p, n); };                              // a case with per-frame probability p is missing from n independent frames with this probability
L.framesFor = function (p, conf) { return Math.log(1 - conf) / Math.log(1 - p); };

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
