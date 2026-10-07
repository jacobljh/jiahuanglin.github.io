#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 08 (the same contract in a real renderer: Blender 5.2.2 LTS, executed).
 *
 * Re-derives every number the lesson quotes, with code that shares nothing with l08_blender.js, l08_view.js or build_l08.js (it reads only what Blender RETURNED: l08_data.js, the cache of the builder, and, when the binary is installed, a fresh run):
 *   - the twelve conformance tests: closed-form truth (this file's own formulas: the silhouette of a post, the pinhole, the polygon, the quadratic mist) against the recorded measurement, own estimator of the filter's edge-spread width,
 *     own tolerances and own count of how many defaults fail (k of m); the page's own measure() is compared with these;
 *   - the Street's answer to a scene description, with this file's own conversion (checked against the scenes the Street itself draws), at 16 x 16 rays per pixel (the area integral) and at 2 x 2 (the program's pixel);
 *   - the whole-frame errors of the two recorded scenes along the path k = 0 ... 12 (own base64 and 12-bit decoder), and of the 24 scenes from the builder's cache (entry build, every clause set, the Street's own pixel, two sample patterns, 1,024 samples, mask areas);
 *   - the exam: the real validation and test frames of the lab, own threshold and miss rate for the 15 stored detectors, and from-scratch trainings of two cells (all clauses set; a quarter of the frames written upside down) from the cached Blender frames;
 *   - the cost numbers recorded with the data, and their closed forms (1/spp, the sensor's own noise);
 *   - when Blender exists: the whole suite re-run and two frames re-rendered, required to equal what the data file recorded;
 *   - the widget, driven through every step, both scenes and all scales.
 * Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const REPO = path.resolve(__dirname, '../../..');
const root = path.join(REPO, 'all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
require(path.join(root, dir, 'l08_data.js'));
const { loadPage } = require('../dom_probe.js');
const D = SV.L08, T = SV.TABLES;
const W8 = path.join(REPO, 'tools/chain/syn_notes/w08'), CACHE = path.join(W8, 'cache'), SYN = path.join(REPO, 'tools/syn_blender');
const T0 = Date.now();

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => sum(a) / a.length;
const pc = (x) => 100 * x;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const closeTo = (a, b, rel, abs) => (a === null || b === null) ? a === b : Math.abs(a - b) <= (abs || 0) + (rel || 0) * Math.max(Math.abs(a), Math.abs(b));
if (!D) { console.error('FAIL l08_data.js has not been built (node tools/chain/verify/engine/build_l08.js)'); process.exit(1); }

/* ───────────── 0 · the lab's constants, and the sensor's own noise (the scale every tolerance is measured against) ───────────── */
const W = 96, H = 24, HW = W * H, F0 = 83.1, V0 = 9, HC = 1.4, GROUND = 1e5;
check(SV.CAM.W === W && SV.CAM.H === H && Math.abs(SV.CAM.f - F0) < 1e-12 && SV.CAM.V0 === V0 && Math.abs(SV.CAM.hc - HC) < 1e-12, 'the Street camera is 96 x 24, f = 83.1 px, horizon row 9, 1.4 m up');
const TOL = { px: 0.05, rad: 0.01, fRel: 0.005, area: 0.05 };              // positions 0.05 px, radiance 1 % of full scale, focal length 0.5 %, areas 5 %
put('tol_px', TOL.px, 2);
const sens = SV.REAL.sensor;
put('tol_shot', pc(1 / Math.sqrt(sens.ev * 0.95)), 1);                      // relative shot noise of the brightest pixel (radiance 0.95), in percent
put('tol_blur_ratio', sens.blur / TOL.px, 0);                                // the sensor's blur is this many times the position tolerance
{
  const flat = new Float32Array(3 * HW).fill(0.95), x = SV.sense(flat, sens, SV.stream(18000100, 'sensor')), v = [];
  for (let i = 0; i < x.length; i++) v.push(Math.pow(x[i], sens.gamma));
  const m = mean(v), sd = Math.sqrt(mean(v.map((a) => (a - m) * (a - m))));
  check(Math.abs(sd / m - 1 / Math.sqrt(sens.ev * 0.95)) < 0.004, 'the sensor\'s noise at radiance 0.95 is the shot noise 1/sqrt(ev L) (measured ' + (100 * sd / m).toFixed(2) + ' %, closed form ' + F.tol_shot + ' %)');
  put('shot_measured', pc(sd / m), 1);
}
check(TOL.rad <= F.tol_shot / 100 / 4 + 1e-9, 'the radiance tolerance is a quarter of the shot noise or less');

/* handedness: the Street's axes (x right, y up, z forward) against the right/up/toward-the-viewer basis of a right-handed world; Blender's (X right, Y forward, Z up) likewise; the map (x, y, z) -> (x, z, y) */
{
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const cols = (a, b, c) => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];        // axes as columns, in (right, up, toward the viewer)
  const street = cols([1, 0, 0], [0, 1, 0], [0, 0, -1]), blender = cols([1, 0, 0], [0, 0, -1], [0, 1, 0]);
  check(det3(street) === -1, 'the Street\'s axes (x right, y up, z forward) are left-handed');
  check(det3(blender) === 1, 'Blender\'s world (X right, Y forward, Z up) is right-handed');
  check(det3([[1, 0, 0], [0, 0, 1], [0, 1, 0]]) === -1, 'the map (x, y, z) -> (x, z, y) has determinant -1: a reflection that keeps the picture');
  check(det3([[-1, 0, 0], [0, 0, 1], [0, 1, 0]]) === 1, 'the map that keeps determinant +1 (x negated) mirrors the street left to right');
}

/* ───────────── 1 · the twelve tests: closed forms against what Blender recorded ───────────── */
const S = D.suite;
const colCentroid = (c) => { let s = 0, m = 0; c.forEach((v, u) => { s += v; m += v * (u + 0.5); }); return s > 1e-3 ? m / s : null; };
const postU = (x, z, h) => { const us = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) us.push(W / 2 + F0 * (x + sx * h) / (z + sz * h)); return [Math.min(...us), Math.max(...us)]; };
const mid = (p) => (p[0] + p[1]) / 2;
const MS = {};                                                              // the measures of this file, one entry per clause: {d, s, tol}

/* 1 axes and handedness: a post at x = +2 m (z = 10 m) and one at x = -2 m (z = 5 m); the silhouette of an upright post is the hull of its four corners' projections */
function mAxes(R) {
  const tg = mid(postU(2, 10, 0.15)), tr = mid(postU(-2, 5, 0.15));
  const err = (v) => { const g = colCentroid(v.green), r = colCentroid(v.red); return g === null || r === null ? null : Math.max(Math.abs(g - tg), Math.abs(r - tr)); };
  return { d: err(R.default_camera), s: err(R.street), tol: TOL.px, tg: tg, tr: tr, cgStreet: colCentroid(R.street.green), cgMirror: colCentroid(R.mirrored.green), crMirror: colCentroid(R.mirrored.red), mirrorErr: err(R.mirrored), seen: sum(R.default_camera.green) + sum(R.default_camera.red) };
}
/* 2 row order: the sky ends on row 9 seen from the top of the buffer as read (the leading run of sky rows) */
const skyRun = (col) => { let s = 0; for (let i = 0; i < col.length && col[i] > 0.5; i++) s += col[i]; return s; };
const HORIZON = V0 + F0 * HC / GROUND;                                       // the ground plane of the Blender builder ends at 100 km: its far edge sits this far below row 9
function mRows(R) { return { d: Math.abs(skyRun(R.default) - HORIZON), s: Math.abs(skyRun(R.set) - HORIZON), vDef: skyRun(R.default), vSet: skyRun(R.set), tol: TOL.px }; }
/* 3 focal length: slab edges at x = -x0 and +x0, z = 10: the edges are 2 f x0 / 10 pixels apart */
const lensF = (v, x0) => ((v.red.length - sum(v.green)) - sum(v.red)) * 10 / (2 * x0);
function mLens(R) { const fd = lensF(R.default, 1.5), fs_ = lensF(R.set, 1.5); return { d: Math.abs(fd / F0 - 1), s: Math.abs(fs_ / F0 - 1), fDef: fd, fSet: fs_, portAuto: lensF(R.portrait_auto, 0.8), portH: lensF(R.portrait_horizontal, 0.8), tol: TOL.fRel }; }
/* 4 principal point: the horizon row = the sum of the sky column */
function mShift(R) { const d = sum(R.default), s = sum(R.set); return { d: Math.abs(d - HORIZON), s: Math.abs(s - HORIZON), vDef: d, vSet: s, tol: TOL.px }; }
/* 5 pixel centres: an edge placed at u = 40.25 (everything to its right is lit): its position is W minus the lit width of the row */
function mCentre(R) { const e = W - sum(R.set); return { d: Math.abs(e - 40.25), s: Math.abs(e - 40.25), edge: e, tol: TOL.px }; }
/* 8 pixel filter: the edge-spread function of a step at 40 + k/16 read through pixel 34 + j sits at x = j - 5.5 - k/16 from the pixel centre; it is the CDF of the filter, sampled on a regular 1/16 grid.
   Taking the density to be uniform inside each grid interval, E[x] = sum dG (a + b)/2 and E[x^2] = sum dG (a^2 + a b + b^2)/3 (exact for a box), and sigma^2 = E[x^2] - E[x]^2 */
function esfSigma(esf) {
  const pts = []; esf.forEach((row, k) => row.forEach((v, j) => pts.push([j - 5.5 - k / 16, v]))); pts.sort((a, b) => a[0] - b[0]);
  let m1 = 0, m2 = 0, tot = 0;
  for (let i = 1; i < pts.length; i++) { const dG = pts[i][1] - pts[i - 1][1], a = pts[i - 1][0], b = pts[i][0]; tot += dG; m1 += dG * (a + b) / 2; m2 += dG * (a * a + a * b + b * b) / 3; }
  return { sigma: Math.sqrt(m2 - m1 * m1), mean: m1, leak: esf[0][5], n: pts.length, mass: tot };
}
/* the standard deviation of a Blackman-Harris window spanning `span` pixels (numerical integral): what the measured filter should be if Cycles' window spans twice the width asked */
function bhSigma(span) { const n = 400000; let s0 = 0, s2 = 0; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = (t - 0.5) * span, v = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * t) + 0.14128 * Math.cos(4 * Math.PI * t) - 0.01168 * Math.cos(6 * Math.PI * t); s0 += v; s2 += v * x * x; } return Math.sqrt(s2 / s0); }
function mFilter(R) {
  const bh = esfSigma(R.bh15.esf), bx = esfSigma(R.box10.esf);
  return { d: bh.leak, s: bx.leak, sigDef: bh.sigma, sigSet: bx.sigma, mass: bx.mass, sigExtra: Math.sqrt(bh.sigma * bh.sigma - bx.sigma * bx.sigma), sigBox15: esfSigma(R.box15.esf).sigma, sigBh10: esfSigma(R.bh10.esf).sigma, sigGauss: esfSigma(R.gauss15.esf).sigma,
           leakBox15: R.box15.esf[0][5], sumDef: sum(R.bh15.sliver), sumSet: sum(R.box10.sliver), peakDef: Math.max(...R.bh15.sliver), peakSet: Math.max(...R.box10.sliver), tol: TOL.rad };
}
/* 7 what a pixel holds: patches of radiance 0.02 ... 0.95 read back as radiance */
const PATCH = [0.02, 0.05, 0.18, 0.5, 0.95];
const patchErr = (p, k) => p[k][0] / PATCH[k] - 1;
function mOutput(R) {
  const mx = (p) => Math.max(...PATCH.map((_, k) => Math.abs(patchErr(p, k))));
  return { d: mx(R.png8_agx), s: mx(R.exr32), std: mx(R.png8_standard), agx: PATCH.map((_, k) => patchErr(R.png8_agx, k)), tol: TOL.rad };
}
/* 9 sampler: an edge at u = 40.25 (pixels 36 ... 44 should read 0 0 0 0 .75 1 1 1 1) and a 0.3 px sliver at 20.4 ... 20.7 (pixels 16 ... 24 should read 0 0 0 0 .3 0 0 0 0) */
const T40 = [0, 0, 0, 0, 0.75, 1, 1, 1, 1], T20 = [0, 0, 0, 0, 0.3, 0, 0, 0, 0];
const winErr = (v) => Math.max(...v.w40.map((a, k) => Math.abs(a - T40[k])), ...v.w20.map((a, k) => Math.abs(a - T20[k])));
function mSampler(R) {
  const o = { d: winErr(R.default), s: winErr(R.set), denoiseOnly: winErr(R.denoise_only), adaptiveOnly: winErr(R.adaptive_only), secDef: R.default.sec, secSet: R.set.sec, over: R.default.w40[5] - 1, tol: TOL.rad };
  for (const n of [1, 4, 16, 256, 1024]) o['spp' + n] = winErr(R['spp' + n]);
  return o;
}
/* 6 shapes: a cylinder 1.7 m tall, radius 0.25 m at z = 10 m, column 48: its rim at the front (z = 9.75 m) is the top, its foot at the front the bottom */
const rowsOf = (c) => { let a = 0, b = c.length - 1; while (a < c.length && c[a] < 1e-9) a++; while (b >= 0 && c[b] < 1e-9) b--; return { top: a + (1 - c[a]), bottom: b + c[b], height: sum(c) }; };
function mShapes(R, st) {
  const front = 10 - 0.25, tt = V0 - F0 * (1.7 - HC) / front, tb = V0 + F0 * HC / front;
  const pe = (c) => { const e = rowsOf(c); return { top: e.top, bottom: e.bottom, err: Math.max(Math.abs(e.top - tt), Math.abs(e.bottom - tb)), height: e.height }; };
  const shade = (v) => {                                                       // radiance across a wide cylinder against the Street's 16 x 16 render of the same description, pixels whose centre and four neighbours are on the cylinder
    let mx = 0, sm = 0, n = 0;
    for (let u = 1; u < W - 1; u++) { const q = 11 * W + u; if (st.id[q] === 0 && st.id[q - 1] === 0 && st.id[q + 1] === 0 && st.id[q - W] === 0 && st.id[q + W] === 0) { const e = Math.abs(v.row[u] - st.rad[q]) / st.rad[q]; mx = Math.max(mx, e); sm += e; n++; } }
    return { max: mx, mean: sm / n, n: n };
  };
  const exact = 2 * F0 * Math.tan(Math.asin(2 / 15)), wid = (n) => sum(R['vertices_' + n].row);
  const pb = pe(R.placement_base.col), pcn = pe(R.placement_centre.col);
  return { d: pb.err, s: pcn.err, base: pb, centre: pcn, flat: shade(R.shading_flat), smooth: shade(R.shading_smooth), tt: tt, tb: tb, exact: exact, w8: wid(8) / exact - 1, w16: wid(16) / exact - 1, w32: wid(32) / exact - 1, w128: wid(128) / exact - 1, bound32: 1 - Math.cos(Math.PI / 32), tol: TOL.px };
}
/* 10 depth pass: ground plane law z = f hc / (v + 1/2 - V0); range = depth sqrt(1 + tan^2 + rho^2); the mist pass is a quadratic of the range between its start and start + depth */
function mDepth(R) {
  const buf = (s) => { const b = Buffer.from(s, 'base64'), o = new Float64Array(b.length / 4); for (let i = 0; i < o.length; i++) o[i] = b.readFloatLE(4 * i); return o; };
  const z = buf(R.z), m = buf(R.mist), wall = 20 - 0.05, quad = (r) => { const t = Math.min(1, Math.max(0, (r - R.mist_start) / R.mist_depth)); return t * t; };
  let g = 0, rc = 0, ng = 0, wl = 0, mr = 0, mz = 0, nw = 0;
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const q = v * W + u, tp = (u + 0.5 - W / 2) / F0, rho = (V0 - (v + 0.5)) / F0, kk = Math.sqrt(1 + tp * tp + rho * rho);
    if (v + 0.5 - V0 > F0 * HC / wall) { g = Math.max(g, Math.abs(z[q] / (F0 * HC / (v + 0.5 - V0)) - 1)); rc = Math.max(rc, 1 - 1 / kk); ng++; }
    else { wl = Math.max(wl, Math.abs(z[q] - wall)); mr = Math.max(mr, Math.abs(m[q] - quad(wall * kk))); mz = Math.max(mz, Math.abs(m[q] - quad(wall))); nw++; }
  }
  return { d: g, s: g, ground: g, wall: wl, rc: rc, mistRange: mr, mistDepth: mz, ng: ng, nw: nw, skyZ: R.sky ? R.sky.z : null, skyMist: R.sky ? R.sky.mist : null, falloff: R.mist_falloff, tol: TOL.rad };
}
/* 11 object masks: slivers 0.3, 0.3 and 2.3 px wide, 3 m tall, at z = 20 m (3 f / 20 = 12.465 px tall): their area in px^2 under each mask */
function mMask(R) {
  const h = 3 * F0 / 20, tr = [0.3 * h, 0.3 * h, 2.3 * h], area = (w) => ['A', 'B', 'C'].map((k) => sum(w[k].map(sum)));
  const ai = area(R.object_index), ah = area(R.holdout_alpha), ac = area(R.cryptomatte), e = (a) => Math.max(...a.map((v, i) => Math.abs(v / tr[i] - 1)));
  return { d: e(ai), s: e(ah), idx: ai, alp: ah, cry: ac, truth: tr, cryVsAlpha: Math.max(...ac.map((v, i) => Math.abs(v - ah[i]))), tol: TOL.area };
}
/* 12 units */
function mUnits(R) { const t = 10 - 0.05; return { d: Math.abs(R.metre.z_centre - t), s: Math.abs(R.centimetre.z_centre - t), z: R.metre.z_centre, zCm: R.centimetre.z_centre, truth: t, tol: TOL.px }; }

/* the shading test needs the Street's own answer to a description: this file's own conversion, checked against the Street's own scenes below */
function streetOf(d) {
  const parts = d.parts.map((p) => { const q = { id: p.id, pid: p.pid, cls: p.cls, kind: p.kind === 'cyl' ? 'circle' : 'box', x: p.x, z: p.z, y0: p.y0, y1: p.y1 }; if (p.role) q.role = p.role; if (p.kind === 'cyl') q.r = p.r; else { q.hx = p.hx; q.hz = p.hz; } return q; });
  const look = { l: d.l, amb: d.amb, lum: d.lum, col: {}, stripe: {}, ph: {}, ground: d.ground, skyH: d.skyH, skyZ: d.skyZ, win: 0, winPhase: d.winPhase };
  d.parts.forEach((p) => { look.col[p.pid] = p.col; look.stripe[p.pid] = p.stripe || 0; look.ph[p.pid] = p.ph || 0; if (p.cls === 'wall') look.win = p.win || 0; });
  return { scene: { parts: parts, insts: [], ped: null, van: null, mode: d.mode }, look: look };
}
const street = (d, n, o) => { const s = streetOf(d); return SV.render(s.scene, s.look, { SSh: n, SSv: n, only: o && o.only, maps: !(o && o.maps === false) }); };
function descOf(scene, look, seed) {                                         // the other direction: what the Street drew -> a plain description (the lab's scene law of the program bbba)
  const parts = scene.parts.map((p) => { const o = { pid: p.pid, id: p.id, cls: p.cls, role: p.role || null, kind: p.kind === 'circle' ? 'cyl' : 'box', x: p.x, z: p.z, y0: p.y0, y1: p.y1, col: look.col[p.pid], stripe: look.stripe[p.pid] || 0, ph: look.ph[p.pid] || 0, win: p.cls === 'wall' ? look.win : 0 }; if (p.kind === 'circle') o.r = p.r; else { o.hx = p.hx; o.hz = p.hz; } return o; });
  return { seed: seed, parts: parts, l: look.l, amb: look.amb, lum: look.lum, ground: look.ground, skyH: look.skyH, skyZ: look.skyZ, winPhase: look.winPhase, ped: !!scene.ped, mode: scene.mode || null };
}
const PIPE = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'b', look: 'b', sensor: 'b', label: 'a' });      // the exact-stage program bbba of Lesson 5
function drawn(seed) { const sc = SV.drawScene(PIPE.scene, SV.stream(seed, 'scene')), lk = SV.drawLook(PIPE.look, sc, SV.stream(seed, 'look')); return { scene: sc, look: lk }; }
function deepEq(a, b) { if (a === b) return true; if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12; if (Array.isArray(a) !== Array.isArray(b)) return false; const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k])); }
{
  /* the conversion is faithful: the Street renders what it drew and what this file's description of it says to the last bit */
  let ok = true;
  for (const seed of [18000000, 18000003, 18000007]) {
    const dr = drawn(seed), d = descOf(dr.scene, dr.look, seed), a = SV.render(dr.scene, dr.look, { SSh: 3, SSv: 3 }), b = street(d, 3);
    for (let i = 0; i < a.rad.length; i++) if (a.rad[i] !== b.rad[i]) { ok = false; break; }
  }
  check(ok, 'a description converted back to a Street scene renders to the same radiance as the scene the Street drew (three seeds)');
}

function runSuite(R, st) {
  return { axes: mAxes(R.axes), rows: mRows(R.rows), lens: mLens(R.lens), shift: mShift(R.shift), centre: mCentre(R.centre), shapes: mShapes(R.shapes, st), output: mOutput(R.output), filter: mFilter(R.filter), sampler: mSampler(R.sampler), depth: mDepth(R.depth), mask: mMask(R.mask), units: mUnits(R.units) };
}
const shadeStreet = street(S.shapes.shading_flat.desc, 16);
check(deepEq(S.shapes.shading_flat.desc, S.shapes.shading_smooth.desc), 'the two shading tests are the same description');
check(shadeStreet.depth[0] === 0 && shadeStreet.range[0] === 0 && shadeStreet.id[0] === -1, 'where nothing is hit the Street\'s depth and range read 0 (and its id -1)');
const M = runSuite(S, shadeStreet);
const ORDER = ['axes', 'rows', 'lens', 'shift', 'centre', 'shapes', 'output', 'filter', 'sampler', 'depth', 'mask', 'units'];
check(JSON.stringify(D.clauses) === JSON.stringify(ORDER), 'the data file lists the twelve clauses in the order of the path');
const fails = (m) => m.d === null || m.d > m.tol;
let kFail = 0; const failing = [];
ORDER.forEach((c) => { if (fails(M[c])) { kFail++; failing.push(c); } check(M[c].s !== null && M[c].s <= M[c].tol, 'clause ' + c + ' holds once set (error ' + M[c].s + ', tolerance ' + M[c].tol + ')'); });
put('k_fail', kFail, 0); put('m_total', ORDER.length, 0);
check(kFail === 9 && JSON.stringify(failing) === JSON.stringify(['axes', 'rows', 'lens', 'shift', 'shapes', 'output', 'filter', 'sampler', 'mask']), 'nine of the twelve defaults fail: ' + failing.join(', '));
check(['centre', 'depth', 'units'].every((c) => !fails(M[c])), 'pixel centres, the depth pass and units hold at the default');

/* the numbers of the table and of §3 */
{
  const a = M.axes, l = M.lens, sh = M.shift, r = M.rows, c = M.centre, s6 = M.shapes, o = M.output, f = M.filter, sp = M.sampler, dp = M.depth, mk = M.mask, u = M.units;
  check(a.seen < 1e-3 && a.d === null, 'at the default camera neither post is in the frame (a camera looks down the -Z axis)');
  put('post_truth', a.tg, 2); put('ax_set', a.s, 3); put('ax_street_col', a.cgStreet, 2); put('ax_mirror_col', a.cgMirror, 2);
  check(near(a.cgMirror, W - a.cgStreet, 0.05) && near(a.crMirror, W - mid(postU(-2, 5, 0.15)), 0.05), 'the mirrored map puts each post at the mirror image of its column');
  put('rows_def', r.d, 2); put('rows_set', r.s, 3);
  put('fl_def', pc(lensF(S.lens.default, 1.5) / F0 - 1), 1); put('fl_set', pc(l.s), 2);
  put('f_default', l.fDef, 1); put('fl_port_auto', l.portAuto, 2); put('fl_port_h', l.portH, 2);
  put('fov_default', 2 * Math.atan(18 / 50) * 180 / Math.PI, 1); put('fov_set', 2 * Math.atan(W / 2 / F0) * 180 / Math.PI, 1); put('lens_mm', F0 * 36 / W, 2);
  check(near(l.fDef, 50 * W / 36, 0.1), 'the default lens gives f = 50 W / 36 = ' + (50 * W / 36).toFixed(1) + ' px (measured ' + l.fDef.toFixed(1) + ')');
  check(near(l.portAuto, F0 * 36 / W * 96 / 36, 0.1) && near(l.portH, F0 * 36 / W * 24 / 36, 0.1), 'in a 24 x 96 frame AUTO fits the sensor to the 96 side, HORIZONTAL to the 24 side');
  put('hz_def', sh.vDef, 2); put('hz_err_def', sh.d, 2); put('hz_err_set', sh.s, 3);
  put('cen_edge', c.edge, 3); put('cen_err', c.d, 3);
  put('sh_top', s6.d, 2); put('sh_top_set', s6.s, 2); put('sh_h_def', s6.base.height, 1); put('sh_h_set', s6.centre.height, 1);
  put('sh_flat', pc(s6.flat.max), 1); put('sh_smooth', pc(s6.smooth.max), 2); put('sh_n', s6.flat.n, 0); put('sh_w32', -pc(s6.w32), 2); put('sh_bound', pc(s6.bound32), 2);
  put('cyl_depth', S.facts.blender.cylinder_primitive.z_max - S.facts.blender.cylinder_primitive.z_min, 0);
  put('ou_err', pc(o.d), 1); put('ou_set', pc(o.s), 4); put('ou_std', pc(o.std), 2);
  put('ou_018', PATCH[2] * (1 + o.agx[2]), 3); put('ou_095', pc(o.agx[4]), 1); put('ou_002', pc(o.agx[0]), 1); put('ou_005', pc(o.agx[1]), 1); put('ou_05', pc(o.agx[3]), 1);
  put('fi_leak', f.d, 3); put('fi_sig_def', f.sigDef, 3); put('fi_sig_set', f.sigSet, 3); put('fi_sig_box', 1 / Math.sqrt(12), 3); put('fi_sig_box15', f.sigBox15, 3); put('fi_extra', f.sigExtra, 2);
  put('fi_tot_def', Math.hypot(f.sigDef, sens.blur), 3); put('fi_tot_set', Math.hypot(f.sigSet, sens.blur), 3);
  put('fi_sliver_sum_def', f.sumDef, 3); put('fi_sliver_sum_set', f.sumSet, 3); put('fi_peak_def', f.peakDef, 3); put('fi_peak_set', f.peakSet, 3);
  put('sa_def', pc(sp.d), 1); put('sa_set', pc(sp.s), 1); put('sa_over', pc(sp.over), 1); put('sa_dn', pc(sp.denoiseOnly), 1); put('sa_ad', pc(sp.adaptiveOnly), 1);
  put('sa_slow', sp.secDef / sp.secSet, 0);
  check(near(sp.spp1, 1 - 0.3, 2e-3), 'one sample is a point sample at the pixel centre: the 0.3 px sliver reads 1 where 0.3 is true (error ' + sp.spp1 + ')');
  [['1', 1], ['4', 4], ['16', 16], ['256', 256]].forEach(([k, n]) => put('sa_spp' + k, pc(sp['spp' + n]), 2));
  put('de_ground', pc(dp.ground), 2); put('de_n', dp.ng, 0); put('de_range', pc(dp.rc), 1); put('de_mist_range', dp.mistRange, 3); put('de_mist_depth', dp.mistDepth, 3); put('de_wall', dp.wall, 6);
  check(dp.skyZ === 1e10 && dp.skyMist === 1 && dp.falloff === 'QUADRATIC', 'where nothing is hit the Depth pass reads 1e10 and the mist pass 1 (the Street reads 0)');
  put('de_sky_exp', Math.log10(dp.skyZ), 0);
  put('mk_t_A', mk.truth[0], 2); put('mk_t_B', mk.truth[1], 2); put('mk_t_C', mk.truth[2], 2);
  put('mk_i_A', mk.idx[0], 0); put('mk_i_B', mk.idx[1], 0); put('mk_i_C', mk.idx[2], 0); put('mk_a_A', mk.alp[0], 2); put('mk_a_B', mk.alp[1], 2); put('mk_a_C', mk.alp[2], 2);
  put('mk_err_def', pc(mk.d), 0); put('mk_err_set', pc(mk.s), 1); put('mk_cry_gap', mk.cryVsAlpha, 6);
  put('un_err', u.d, 9); put('un_z', u.z, 2);
  check(near(u.z, u.zCm, 1e-6), 'the unit scale changes what the interface calls a unit and not the number in the pass');
  check(near(dp.rc, 1 - 1 / Math.sqrt(1 + ((W / 2 - 0.5) / F0) ** 2 + ((V0 - 23.5) / F0) ** 2), 1e-9), 'range = depth sqrt(1 + tan^2 + rho^2) at the corner of the field gives the 14 % of the lesson');
  check(s6.exact > 22 && s6.exact < 23, 'the exact width of the polygon test');
  check(s6.w32 < 0 && -s6.w32 < s6.bound32, 'the 32-gon is narrower than the circle by less than the bound');
  
  put('fi_sig_gauss', f.sigGauss, 3); put('fi_sig_bh10', f.sigBh10, 3); put('fi_sig_closed', bhSigma(3.0), 3); put('fi_sig_closed10', bhSigma(2.0), 3);
  check(near(f.sigDef, bhSigma(3.0), 0.004) && near(f.sigBh10, bhSigma(2.0), 0.004), 'the default filter is the Blackman-Harris window spanning twice the width asked: measured sigma ' + f.sigDef.toFixed(3) + ' vs ' + bhSigma(3.0).toFixed(3) + ' (width 1.5), ' + f.sigBh10.toFixed(3) + ' vs ' + bhSigma(2.0).toFixed(3) + ' (width 1.0)');
  check(near(f.sigSet, 1 / Math.sqrt(12), 0.002) && near(f.sigBox15, f.sigSet, 1e-9) && near(f.mass, 1, 1e-6), 'the box filter\'s measured width is 1/sqrt(12), whatever width is asked');
  check(S.sampler.facts.one_thread_maxdiff === 0 && S.sampler.facts.eight_threads_maxdiff === 0 && S.sampler.facts.same_twice_maxdiff === 0 && S.sampler.facts.default_same_twice_maxdiff === 0 && S.sampler.facts.other_seed_maxdiff > 0, 'reproducible: the same twice, one thread and eight identical, the same twice at the defaults too; another seed changes the pattern');
  check(Math.abs(D.cost.eevee.edge_profile['1.5'][2] - f.d) < 0.01 && D.cost.eevee.edge_profile['0.0'][2] === 0, 'EEVEE\'s filter_size 1.5 leaks about as much as Cycles\' default (' + D.cost.eevee.edge_profile['1.5'][2].toFixed(3) + ' vs ' + f.d.toFixed(3) + ') and 0 point-samples');
  check(Math.abs(PATCH[2] * (1 + o.agx[2]) - 0.18) < 1e-3 && Math.abs(o.agx[2]) < 1e-3, 'AgX leaves mid-grey 0.18 where it was');
  check(f.sumDef > f.sumSet && f.sumSet > 0.5 && f.sumDef - 0.5 > 3 * (f.sumSet - 0.5), 'the 0.5 px sliver: the box total is nearly exact, the default filter\'s is further off');
  put('sa_other_seed', S.sampler.facts.other_seed_maxdiff, 5); put('sa_threads', Math.max(S.sampler.facts.one_thread_maxdiff, S.sampler.facts.eight_threads_maxdiff, S.sampler.facts.same_twice_maxdiff), 6);
  put('sa_default_repro', S.sampler.facts.default_same_twice_maxdiff, 6);
  check(S.sampler.facts.hash_a1 === S.sampler.facts.hash_a2, 'the conforming render is reproducible: the same twice, to the hash');
  check(S.facts.blender.version === '5.2.2 LTS' && JSON.stringify(S.facts.blender.engines) === JSON.stringify(['BLENDER_EEVEE']) && S.facts.blender.cylinder_primitive.vertices === 32 && S.facts.blender.cylinder_primitive.z_min === -1 && S.facts.blender.cylinder_primitive.z_max === 1 && S.facts.blender.cylinder_primitive.flat && S.facts.blender.cube_primitive.extent === 2, 'facts about the Blender build: 5.2.2 LTS, one EEVEE engine id, the cylinder has 32 sides, depth 2, flat normals');
  check(S.facts.crypto.crypto_ids === 3, 'Cryptomatte: the three slivers have three ids');
  put('cyl_sides', S.facts.blender.cylinder_primitive.vertices, 0);
  MS.all = M;
}
/* the page's own measure() against this file's, on the recorded suite: the bars of the widget are the numbers of the lesson */
const pageProbe = loadPage(path.join(root, dir, '08_the_contract_in_a_real_renderer.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
{
  const PM = pageProbe.win.SV.l08.measure(pageProbe.win.SV.L08.suite);
  ORDER.forEach((c) => {
    const a = PM[c], b = M[c], rel = c === 'filter' ? 2e-2 : 1e-6;
    check(closeTo(a.d, b.d, rel, 1e-9) && closeTo(a.s, b.s, rel, 1e-9), 'the page measures clause ' + c + ' as the oracle does (' + a.d + ' / ' + b.d + ', ' + a.s + ' / ' + b.s + ')');
    check(pageProbe.win.SV.l08.fails(a) === fails(b), 'the page and the oracle agree whether clause ' + c + ' fails at the default');
  });
}

/* ───────────── 2 · the whole frame: the two recorded scenes along the path, and the 24 scenes ───────────── */
const b64 = (s) => Buffer.from(s, 'base64');
function unpack12(s, n) {                                                    // 12-bit codes of the display value L^(1/2.2), two codes in three bytes
  const b = b64(s), o = new Float64Array(n);
  for (let i = 0; i < n; i += 2) { const a = (b[i * 1.5] << 4) | (b[i * 1.5 + 1] >> 4), c = ((b[i * 1.5 + 1] & 15) << 8) | b[i * 1.5 + 2]; o[i] = Math.pow(a / 4095, 2.2); if (i + 1 < n) o[i + 1] = Math.pow(c / 4095, 2.2); }
  return o;
}
const errPix = (a, b) => { const e = new Float64Array(HW); for (let q = 0; q < HW; q++) e[q] = (Math.abs(a[q] - b[q]) + Math.abs(a[HW + q] - b[HW + q]) + Math.abs(a[2 * HW + q] - b[2 * HW + q])) / 3; return e; };
const stats = (maps) => { const v = []; let s = 0, over = 0; maps.forEach((m) => { for (let i = 0; i < m.length; i++) { v.push(m[i]); s += m[i]; if (m[i] > 0.01) over++; } }); v.sort((a, b) => a - b); return { mean: s / v.length, p99: v[Math.floor(0.99 * v.length)], max: v[v.length - 1], over: over / v.length }; };
const PATH = { err: [[], []], p99: [[], []], moved: [[], []], frames: [[], []] };
{
  check(D.frames.desc.length === 2 && D.frames.seeds.length === 2, 'two recorded scenes');
  for (let s = 0; s < 2; s++) {
    const dr = drawn(D.frames.seeds[s]); check(deepEq(descOf(dr.scene, dr.look, D.frames.seeds[s]), D.frames.desc[s]), 'recorded scene ' + s + ' is what the Street draws for seed ' + D.frames.seeds[s]);
    const ref = street(D.frames.desc[s], 16).rad; let prev = null;
    check(D.frames.index[s].length === 13 && D.frames.index[s].every((i) => i >= 0 && i < D.frames.data[s].length), 'scene ' + s + ' has a frame for each of the 13 steps');
    for (let k = 0; k <= 12; k++) {
      const fr = unpack12(D.frames.data[s][D.frames.index[s][k]], 3 * HW), e = errPix(fr, ref), st = stats([e]);
      PATH.err[s].push(st.mean); PATH.p99[s].push(st.p99); PATH.frames[s].push(fr);
      let mv = 0; if (prev) { const d = errPix(fr, prev); for (let q = 0; q < HW; q++) if (d[q] > 0.001) mv++; } PATH.moved[s].push(prev ? mv / HW : null); prev = fr;
    }
    // the clauses that hold at the default change nothing: the frames at those steps are stored once
    [5, 10, 11, 12].forEach((k) => check(D.frames.index[s][k] === D.frames.index[s][k - 1] && PATH.moved[s][k] === 0, 'step ' + k + ' (' + ORDER[k - 1] + ', which holds at the default) leaves the frame as it was'));
  }
  PATH.err.forEach((a, s) => a.forEach((e, k) => { put('p' + 'ab'[s] + '_' + k, pc(e), 3); put('p' + 'ab'[s] + '99_' + k, pc(PATH.p99[s][k]), 2); if (PATH.moved[s][k] !== null) put('p' + 'ab'[s] + 'mv_' + k, pc(PATH.moved[s][k]), 1); }));
  {                                                                          // where the remaining error sits at steps 7 and 8 (scene A): on the pixels that are edges of the reference (a neighbour differs by more than 0.02)
    const ref = street(D.frames.desc[0], 16).rad, m = (q) => (ref[q] + ref[HW + q] + ref[2 * HW + q]) / 3, isEdge = new Uint8Array(HW); let ne = 0;
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) { const q = v * W + u; let e = 0; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([du, dv]) => { const x = u + du, y = v + dv; if (x >= 0 && x < W && y >= 0 && y < H && Math.abs(m(q) - m(y * W + x)) > 0.02) e = 1; }); isEdge[q] = e; ne += e; }
    put('edge_px_pct', pc(ne / HW), 0);
    [7, 8].forEach((k) => { const e = errPix(PATH.frames[0][k], ref); let t = 0, te = 0; for (let q = 0; q < HW; q++) { t += e[q]; if (isEdge[q]) te += e[q]; } put('edge_err_' + k, pc(te / t), 0); });
    check(F.edge_err_7 > 60 && F.edge_err_7 > 2 * F.edge_px_pct, 'at step 7 most of the remaining error is on the edges, which are a minority of the pixels');
  }
  check(PATH.err.every((a) => a[12] < 0.0006 && a[12] < a[2] / 100), 'with every clause set the recorded frames are within 0.06 % of the area integral, and 100 times closer than with two set');
}
const GEN = JSON.parse(JSON.stringify(D.cmp));                                // what the data file stored (compared with the recomputation below)
let CMP = null;
{
  const bin = (tag) => {                                                       // the builder's cache: a json header and raw little-endian float32
    const h = JSON.parse(fs.readFileSync(path.join(CACHE, tag + '.json'), 'utf8')), buf = fs.readFileSync(path.join(CACHE, tag + '.bin')), o = { meta: h };
    Object.keys(h.arrays).forEach((k) => { const a = h.arrays[k], n = a.shape.reduce((x, y) => x * y, 1); o[k] = new Float32Array(buf.buffer.slice(buf.byteOffset + a.offset, buf.byteOffset + a.offset + 4 * n)); });
    return o;
  };
  if (fs.existsSync(path.join(CACHE, 'cmp24_k12.bin'))) {
    const seeds = Array.from({ length: 24 }, (_, i) => 18000000 + i), descs = seeds.map((sd) => { const dr = drawn(sd); return descOf(dr.scene, dr.look, sd); });
    const sc = path.join(W8, 'scenes/frames24.json'); if (fs.existsSync(sc)) check(deepEq(JSON.parse(fs.readFileSync(sc, 'utf8')), descs), 'the 24 scene descriptions the builder gave Blender are what the Street draws for seeds 18,000,000 ...');
    const S16 = descs.map((d) => street(d, 16)), S2 = descs.map((d) => street(d, 2));
    const k2 = bin('cmp24_k2'), k12 = bin('cmp24_k12'), k12b = bin('cmp24_k12b'), hi = bin('cmp24_k12hi');
    const fr = (b, i) => b.rad.subarray(i * 3 * HW, (i + 1) * 3 * HW), idx = Array.from({ length: 24 }, (_, i) => i);
    const o = {
      entry: stats(idx.map((i) => errPix(fr(k2, i), S16[i].rad))), set: stats(idx.map((i) => errPix(fr(k12, i), S16[i].rad))), setVsSt2: stats(idx.map((i) => errPix(fr(k12, i), S2[i].rad))), st2: stats(idx.map((i) => errPix(S2[i].rad, S16[i].rad))),
      noise: stats(idx.map((i) => errPix(fr(k12, i), fr(k12b, i)))), conv: stats(idx.map((i) => errPix(fr(k12, i), fr(hi, i)))), sys: stats(idx.map((i) => errPix(fr(hi, i), S16[i].rad)))
    };
    const rel = [], relA = [];
    descs.forEach((d, i) => {
      if (!d.ped) return;
      const vis = S16[i].cov, ful = street(d, 16, { only: 'ped' }).cov; let a = 0, b = 0, c = 0, e = 0;
      for (let q = 0; q < HW; q++) { a += vis[q]; b += k12.cov[i * HW + q]; c += ful[q]; e += k12.amod[i * HW + q]; }
      if (a >= SV.EXAM.minArea) rel.push(Math.abs(b - a) / a);
      relA.push(Math.abs(e - c) / c);
    });
    o.cov = { n: rel.length, mean: mean(rel), max: Math.max(...rel), nAmodal: relA.length, meanAmodal: mean(relA), maxAmodal: Math.max(...relA) };
    CMP = o;
    Object.keys(GEN).forEach((k) => Object.keys(GEN[k]).forEach((q) => check(closeTo(GEN[k][q], o[k][q], 1e-6, 1e-9), 'cmp ' + k + '.' + q + ': the data file says ' + GEN[k][q] + ', the oracle recomputes ' + o[k][q])));
    put('cache_used', 1, 0);
  } else { CMP = GEN; put('cache_used', 0, 0); console.error('note: the builder\'s cache is absent; the 24-scene statistics are taken from the data file'); }
  put('entry_mean', pc(CMP.entry.mean), 1); put('entry_p99', pc(CMP.entry.p99), 0); put('entry_over', pc(CMP.entry.over), 0);
  put('set_mean', pc(CMP.set.mean), 3); put('set_p99', pc(CMP.set.p99), 2); put('set_over', pc(CMP.set.over), 1);
  put('setvs2_mean', pc(CMP.setVsSt2.mean), 2); put('st2_mean', pc(CMP.st2.mean), 2); put('noise_mean', pc(CMP.noise.mean), 3); put('conv_mean', pc(CMP.conv.mean), 3); put('sys_mean', pc(CMP.sys.mean), 3);
  put('cov_mean', pc(CMP.cov.mean), 1); put('cov_max', pc(CMP.cov.max), 0); put('cov_n', CMP.cov.n, 0); put('cov_amod_mean', pc(CMP.cov.meanAmodal), 1); put('cov_amod_n', CMP.cov.nAmodal, 0);
  put('n_scenes', 24, 0); put('entry_ratio', CMP.entry.mean / CMP.set.mean, 0);
  check(CMP.entry.mean > 0.05 && CMP.entry.over > 0.5, 'the entry build is wrong by several percent on most pixels');
  check(CMP.st2.mean > 5 * CMP.sys.mean, 'the Street\'s own 2 x 2 pixel is further from the area integral than Blender at 1,024 samples');
  check(CMP.sys.mean > 3 * D.cost.spp['512'].mean, 'what remains at 1,024 samples (' + pc(CMP.sys.mean).toFixed(3) + ' %) is not sampling: the sampling error at 512 samples is ' + pc(D.cost.spp['512'].mean).toFixed(4) + ' %');
}

/* ───────────── 3 · the exam: stored detectors graded on the real frames, and two cells trained from scratch ───────────── */
const tag = (t) => D.exam.designs[t];
const TAGS = Object.keys(D.exam.designs);
check(TAGS.length === 15, 'fifteen trained designs in the data file (' + TAGS.join(' ') + ')');
const dim = SV.DIM;
function scoreOf(model, fm) {                                                  // the image score: the largest cell logit of the head
  let best = -Infinity; const n = fm.nu * fm.nv, Fm = fm.F;
  for (let c = 0; c < n; c++) { let z = model.w[dim]; for (let j = 0; j < dim; j++) z += model.w[j] * (Fm[c * dim + j] - model.mu[j]) / model.sd[j]; if (z > best) best = z; }
  return best;
}
/* a cell from scratch: this file's own reading of the cache, own sensor call, own label rule, own flip of a share of the frames (image and mask together, the first `flipPct` of every hundred) */
function ownCell(pre, seed, flipPct) {
  const h = JSON.parse(fs.readFileSync(path.join(CACHE, pre + '.json'), 'utf8')), buf = fs.readFileSync(path.join(CACHE, pre + '.bin'));
  const get = (k) => { const a = h.arrays[k], n = a.shape.reduce((x, y) => x * y, 1); return new Float32Array(buf.buffer.slice(buf.byteOffset + a.offset, buf.byteOffset + a.offset + 4 * n)); };
  const rad = get('rad'), cov = get('cov'), N = h.meta.n; check(N === 1600, pre + ' holds 1,600 frames');
  const flip = (a, planes, off) => { const o = new Float32Array(planes * HW); for (let c = 0; c < planes; c++) for (let j = 0; j < H; j++) for (let u = 0; u < W; u++) o[c * HW + j * W + u] = a[off + c * HW + (H - 1 - j) * W + u]; return o; };
  const strips = [], seed0 = SV.SEEDS.train + seed * 100000; check(!PIPE.label.rel && PIPE.label.kvis === 1, 'the program\'s label rule is "at least one visible pixel"');
  for (let i = 0; i < N; i++) {
    let r = rad.subarray(i * 3 * HW, (i + 1) * 3 * HW), c = cov.subarray(i * HW, (i + 1) * HW);
    if (flipPct && (i % 100) < flipPct) { r = flip(rad, 3, i * 3 * HW); c = flip(cov, 1, i * HW); }
    const x = SV.sense(r, PIPE.sensor, SV.stream(seed0 + i, 'sensor')); let a = 0; for (let q = 0; q < HW; q++) a += c[q];
    strips.push({ x: x, cov: c, y: a >= PIPE.label.kvis && a > 0 ? 1 : 0, area: a, seed: seed0 + i });
  }
  const m0 = SV.train(strips, { seed: seed }), r5 = (v) => +Number(v).toPrecision(5);
  return { model: { w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) }, nPed: strips.filter((q) => q.y).length };
}
const MODELS = {}, NPED = {};
TAGS.forEach((t) => { const m = D.exam.models[t]; MODELS[t] = { w: m.w, mu: m.mu, sd: m.sd }; });
const RETRAIN = [['all_s1', 'all_s1', 0], ['x_rows25', 'all_s1', 25]];
for (const [t, pre, flip] of RETRAIN) {
  if (!fs.existsSync(path.join(CACHE, pre + '.bin'))) { console.error('note: no cache for ' + pre + '; cell ' + t + ' not retrained'); continue; }
  const c = ownCell(pre, 1, flip); MODELS['re_' + t] = c.model; NPED[t] = c.nPed;
}
const VAL = SV.real.val(1500), TEST = SV.real.test(3000), NAMES = Object.keys(MODELS);
const sV = NAMES.map(() => new Float64Array(VAL.length)), sT = NAMES.map(() => new Float64Array(TEST.length));
VAL.forEach((f, i) => { const fm = SV.featureMap(f.x); NAMES.forEach((n, j) => { sV[j][i] = scoreOf(MODELS[n], fm); }); });
TEST.forEach((f, i) => { const fm = SV.featureMap(f.x); NAMES.forEach((n, j) => { sT[j][i] = scoreOf(MODELS[n], fm); }); });
function gradeModel(name) {                                                    // threshold: 10 % of the pedestrian-free validation frames alarm; miss over test pedestrians with >= 6 visible px^2
  const j = NAMES.indexOf(name), negs = Array.from(sV[j]).filter((_, i) => !VAL[i].y).sort((a, b) => a - b), thr = negs[Math.min(negs.length - 1, Math.floor(0.9 * negs.length))];
  let hit = 0, n = 0, hitO = 0, nO = 0, hitE = 0, nE = 0;
  TEST.forEach((f, i) => { if (f.y && f.area >= 6) { n++; const h = sT[j][i] > thr ? 1 : 0; hit += h; if (f.mode === 'emerge') { nE++; hitE += h; } else { nO++; hitO += h; } } });
  return { miss: 1 - hit / n, missOpen: 1 - hitO / nO, missEmerge: 1 - hitE / nE, n: n, thr: thr };
}
const MISS = {}, RES = {};
for (const t of TAGS) {
  const g = gradeModel(t); RES[t] = g; MISS[t] = g.miss;
  check(Math.abs(g.miss - tag(t).realMiss) < 1.5e-4 && Math.abs(g.missOpen - tag(t).missOpen) < 1.5e-4 && Math.abs(g.missEmerge - tag(t).missEmerge) < 1.5e-4 && g.n === tag(t).realN, 'detector ' + t + ' regraded from its stored weights: miss ' + g.miss.toFixed(4) + ' (data file ' + tag(t).realMiss + ')');
  put('miss_' + t, pc(g.miss), 2);
}
for (const [t] of RETRAIN) if (MODELS['re_' + t]) {
  const g = gradeModel('re_' + t);
  check(Math.abs(g.miss - tag(t).realMiss) < 1.5e-4 && NPED[t] === tag(t).nPed, 'cell ' + t + ' trained from the cached frames by this file: miss ' + g.miss.toFixed(4) + ' (data file ' + tag(t).realMiss + '), ' + NPED[t] + ' pedestrian frames (' + tag(t).nPed + ')');
  put('re_' + t, pc(g.miss), 2);
}
put('n_exam', RES.all_s1.n, 0); put('n_ped_frames', tag('all_s1').nPed, 0);
const SW = T.swap.bbba.realMiss;                                              // the Street-rendered cell of Lesson 5, three seeds
check(SW.length === 3, 'the Street-rendered cell has three seeds');
const bl = ['all_s1', 'all_s2', 'all_s3'].map((t) => MISS[t]);
put('blender_miss', pc(mean(bl)), 1); put('street_miss', pc(mean(SW)), 1);
put('blender_range', pc(Math.max(...bl) - Math.min(...bl)), 1); put('street_range', pc(Math.max(...SW) - Math.min(...SW)), 1); put('diff_mean', pc(mean(bl) - mean(SW)), 1);
put('street_s1', pc(SW[0]), 1); put('street_s2', pc(SW[1]), 1); put('street_s3', pc(SW[2]), 1); put('seed1_diff', pc(MISS.all_s1 - SW[0]), 1); put('seed2_diff', pc(MISS.all_s2 - SW[1]), 1); put('seed3_diff', pc(MISS.all_s3 - SW[2]), 1);
check(Math.abs(mean(bl) - mean(SW)) < Math.min(F.blender_range, F.street_range) / 100, 'the production renderer\'s cell differs from the Street\'s by less than a seed range');
const PTS = {}; ['rows', 'lens', 'shift', 'filter', 'output', 'flat', 'base', 'denoise', 'mask', 'all'].forEach((c) => { const t = 'def_' + c; PTS[c] = pc(MISS[t] - MISS.all_s1); put('pts_' + c, PTS[c], 1); put('d_' + c, pc(MISS[t]), 1); });
['x_rows5', 'x_rows25'].forEach((t) => { PTS[t] = pc(MISS[t] - MISS.all_s1); put('pts_' + t, PTS[t], 1); put('d_' + t, pc(MISS[t]), 1); });
put('defall_miss', pc(MISS.def_all), 1); put('seed_range_pts', pc(Math.max(...bl) - Math.min(...bl)), 1);
const quiet = ['filter', 'output', 'denoise', 'mask'].filter((c) => Math.abs(PTS[c]) <= F.blender_range + 0.01);
put('n_quiet', quiet.length, 0); put('n_graded', 8, 0);
check(quiet.length === 4 && Math.abs(PTS.flat) <= F.blender_range && PTS.lens > 20 && PTS.rows > 4 && PTS.base > 1.5 && PTS.shift > 1 && PTS.shift < 2, 'the order of the damage: lens, rows, then a few points, then nothing the exam can see');
check(PTS.all > 10 && PTS.all < PTS.lens, 'the all-defaults build (pose and row order set) is far from the Street, and less far than the lens alone: the errors partly cancel');
check(Math.abs(PTS.x_rows5) < 0.5 && PTS.x_rows25 > 0 && PTS.x_rows25 < 3, 'a quarter of the frames upside down moves the exam by under three points, a twentieth by under half a point');
put('x25_share', 25, 0); put('x5_share', 5, 0); put('x25_frames', 400, 0); put('x5_frames', 80, 0);
check(tag('x_rows25').nPed === tag('all_s1').nPed, 'a flipped frame keeps its label: the same number of pedestrian frames');

/* ───────────── 4 · what a frame costs (recorded timings, closed forms) ───────────── */
{
  const c = D.cost, sec = c.sec, sp = c.spp, ev = c.eevee;
  put('cost_contract_ms', 1000 * sec.contract, 0); put('cost_defaults_ms', 1000 * sec.defaults, 0); put('cost_world_ms', 1000 * sec.world_map_on, 0);
  put('cost_world_x', sec.world_map_on / sec.contract, 0);
  const bt = c.batch || {}; check(bt.all_s1 > 0 && bt.def_denoise > 0, 'the data file records the wall time of the 1,600-frame batches');
  ['all_s1', 'all_s2', 'all_s3'].forEach((t, i) => { put('batch_s' + (i + 1), bt[t], 0); const hf = path.join(CACHE, t + '.json'); if (fs.existsSync(hf)) check(Math.abs(JSON.parse(fs.readFileSync(hf, 'utf8')).meta.seconds - bt[t]) < 0.06, 'batch time of ' + t + ' matches the render header'); });
  put('batch_denoise_s', bt.def_denoise, 0); put('batch_denoise_x', bt.def_denoise / Math.min(bt.all_s1, bt.all_s3), 1); put('batch_ms_frame', 1000 * Math.min(bt.all_s1, bt.all_s3) / 1600, 0); put('cost_defaults_x', sec.defaults / sec.contract, 0);
  put('batch_s', 1600 * sec.contract, 0);
  const spps = Object.keys(sp).map(Number).sort((a, b) => a - b);
  check(sec.contract < sec.world_map_on && sec.world_map_on < sec.defaults, 'timings: contract < world map on < defaults');
  // quasi-Monte-Carlo: the rms error falls about as 1/spp from 4 to 256 samples (a log-log slope near -1), against the 1/sqrt(spp) of independent samples
  const xs = [4, 8, 16, 32, 64, 128, 256], lx = xs.map((n) => Math.log(n)), ly = xs.map((n) => Math.log(sp[n].rms)), mx = mean(lx), my = mean(ly);
  const slope = sum(lx.map((x, i) => (x - mx) * (ly[i] - my))) / sum(lx.map((x) => (x - mx) ** 2));
  put('spp_slope', -slope, 2); put('spp_rms4_x', sp[4].rms / sp[256].rms, 0); put('spp_rms64_pct', pc(sp[64].rms), 3); put('spp_rms1_pct', pc(sp[1].rms), 1); put('spp_rms256_pct', pc(sp[256].rms), 3);
  put('spp64_vs_shot', F.tol_shot / pc(sp[64].rms), 0);
  put('spp_sec64_ms', 1000 * sp[64].sec, 0); put('spp_sec512_ms', 1000 * sp[512].sec, 0);
  check(slope < -0.8 && slope > -1.2, 'error falls as 1/spp between 4 and 256 samples (slope ' + slope.toFixed(2) + ')');
  check(spps.length === 10 && sp[64].rms < F.tol_shot / 100 / 10, 'at 64 samples the sampling error is under a tenth of the sensor\'s own noise');
  put('ev_first_s', ev.first_sec, 1); put('ev_frame_ms', 1000 * ev.frame_sec, 0); put('ev_frame_x', ev.frame_sec / sec.contract, 0);
  put('ev_leak15', ev.edge_profile['1.5'][2], 3); put('ev_leak10', ev.edge_profile['1.0'][2], 3); put('ev_leak0', ev.edge_profile['0.0'][2], 3); put('ev_vs_cycles', pc(ev.frame_vs_cycles_mean_abs), 2); put('ev_vs_cycles_p99', pc(ev.frame_vs_cycles_p99), 1);
  check(!ev.passes.some((p) => /Index/.test(p)) && ev.passes.some((p) => /Crypto/.test(p)), 'EEVEE delivers cryptomatte but no Object Index');
  check(ev.filter_size_default === 1.5 && ev.taa_render_samples === 64, 'EEVEE defaults: filter 1.5 px, 64 render samples');
  put('ev_taa', ev.taa_render_samples, 0);
  put('world_diff', c.worldDiff, 6); check(c.worldDiff === 0, 'the world\'s importance map changes no pixel (largest difference over six scenes ' + c.worldDiff + ')');
}

/* ───────────── 5 · Blender, when it is installed: the whole suite and two frames again ───────────── */
const BLENDER = process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
function withLock(fn) {
  const lock = path.join(W8, 'blender.lock'); let got = false;
  for (let i = 0; i < 300; i++) { try { fs.mkdirSync(lock); got = true; break; } catch (e) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); } }
  if (!got) return null;
  try { return fn(); } finally { fs.rmdirSync(lock); }
}
let reran = 0;
if (fs.existsSync(BLENDER) && !process.env.L08_NO_BLENDER) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l08_oracle_'));
  const run = (script, args) => withLock(() => cp.spawnSync(BLENDER, ['--background', '--factory-startup', '--python', path.join(SYN, script), '--'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const out = path.join(tmp, 'suite.json'), r = run('render_suite.py', ['--out', out]);
  if (r && r.status === 0 && fs.existsSync(out)) {
    const noise = ((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => /warn|error|deprecat/i.test(l));
    check(noise.length === 0, 'Blender printed no warning or error while the twelve tests ran at their defaults and set (' + noise.slice(0, 2).join(' | ') + ')'); put('console_warnings', noise.length, 0);
    const R = JSON.parse(fs.readFileSync(out, 'utf8')), rn = (v, nd) => Array.isArray(v) ? v.map((x) => rn(x, nd)) : +(+v).toFixed(nd);
    const cols = (img) => { const o = new Array(W).fill(0); img.forEach((row) => row.forEach((v, u) => { o[u] += v; })); return o; }, col48 = (img) => img.map((row) => row[48]);
    const rowMean = (img, a0, b0) => { const o = new Array(img[0].length).fill(0); for (let v = a0; v < b0; v++) for (let u = 0; u < o.length; u++) o[u] += img[v][u] / (b0 - a0); return o; };
    const win = (c, a0, b0) => c.map((row) => row.slice(a0, b0)), f32b64 = (arr) => { const b2 = Buffer.alloc(4 * arr.length); arr.forEach((v, i) => b2.writeFloatLE(v, 4 * i)); return b2.toString('base64'); };
    const fresh = { axes: {}, lens: {}, shift: { default: rn(col48(R.T03.default.rad), 5), set: rn(col48(R.T03.set.rad), 5) }, rows: { default: rn(col48(R.T05.default.rad), 5), set: rn(col48(R.T05.set.rad), 5) }, centre: { set: rn(R.T04.set.rad[12], 5) }, filter: {}, output: {}, sampler: {}, shapes: {}, mask: {}, units: { metre: R.T12.metre, centimetre: R.T12.centimetre } };
    ['default_camera', 'street', 'mirrored'].forEach((v) => { fresh.axes[v] = { red: rn(cols(R.T01[v].red), 4), green: rn(cols(R.T01[v].green), 4) }; });
    ['default', 'set', 'portrait_auto', 'portrait_horizontal'].forEach((v) => { const hz = R.T02[v].red.length === 24 ? 9 : 48; fresh.lens[v] = { red: rn(rowMean(R.T02[v].red, hz - 6, hz - 1), 5), green: rn(rowMean(R.T02[v].green, hz - 6, hz - 1), 5) }; });
    Object.keys(R.T06).forEach((k) => { fresh.filter[k] = { esf: rn(R.T06[k].esf, 5) }; if (R.T06[k].sliver) fresh.filter[k].sliver = rn(R.T06[k].sliver, 5); });
    Object.keys(R.T07).forEach((k) => { fresh.output[k] = rn(R.T07[k].patches, 6); });
    Object.keys(R.T08).forEach((k) => { if (k !== 'facts') fresh.sampler[k] = { w40: rn(R.T08[k].rad.slice(36, 45), 5), w20: rn(R.T08[k].rad.slice(16, 25), 5) }; });
    Object.keys(R.T09).forEach((k) => { const v = R.T09[k]; fresh.shapes[k] = k.startsWith('placement') ? { col: rn(v.col, 5) } : k.startsWith('shading') ? { row: rn(v.row, 5), desc: v.desc } : { row: rn(v.row, 5) }; });
    fresh.depth = { z: f32b64(R.T10.set.z.flat()), mist: f32b64(R.T10.set.mist.flat()), mist_start: R.T10.set.mist_start, mist_depth: R.T10.set.mist_depth, mist_falloff: R.T10.set.mist_falloff, sky: R.T10.sky };
    ['holdout_alpha', 'object_index', 'cryptomatte'].forEach((k) => { const c = R.T11[k].cov; fresh.mask[k] = { A: rn(win(c, 36, 45), 4), B: rn(win(c, 56, 65), 4), C: rn(win(c, 16, 27), 4) }; });
    const strip = (o) => { if (Array.isArray(o)) return o.map(strip); if (o && typeof o === 'object') { const r = {}; Object.keys(o).forEach((k) => { if (k !== 'sec' && k !== 'facts') r[k] = strip(o[k]); }); return r; } return o; };
    ORDER.forEach((c) => check(deepEq(strip(fresh[c]), strip(S[c])), 'Blender re-run, clause ' + c + ': every recorded array equals the fresh render, after the same reduction'));
    const FM2 = runSuite(fresh, shadeStreet);
    ORDER.forEach((c) => { const a = FM2[c], b = M[c]; check(closeTo(a.d, b.d, 1e-9, 1e-9) && closeTo(a.s, b.s, 1e-9, 1e-9), 'Blender re-run, clause ' + c + ': error at the default ' + a.d + ' (recorded ' + b.d + '), set ' + a.s + ' (' + b.s + ')'); });
    ['same_twice_maxdiff', 'other_seed_maxdiff', 'one_thread_maxdiff', 'eight_threads_maxdiff', 'default_same_twice_maxdiff', 'hash_a1'].forEach((k) => check(R.T08.facts[k] === S.sampler.facts[k], 'Blender re-run reproduces the determinism fact ' + k));
    check(R.blender_version === '5.2.2 LTS', 'the re-run used Blender 5.2.2 LTS (' + R.blender_version + ')');
    reran = 1;
  } else console.error('note: the Blender suite could not be re-run (' + (r ? 'exit ' + r.status : 'lock busy') + ')');
  // two frames of the path: the recorded 12-bit codes against a fresh render with the first k clauses set
  for (const k of [0, 12]) {
    const f = path.join(tmp, 'd' + k + '.json'); fs.writeFileSync(f, JSON.stringify([D.frames.desc[0]]));
    const pre = path.join(tmp, 'f' + k), rr = run('render_frames.py', ['--desc', f, '--out', pre, '--k', String(k), '--want', 'rad']);
    if (rr && rr.status === 0 && fs.existsSync(pre + '.bin')) {
      const h = JSON.parse(fs.readFileSync(pre + '.json', 'utf8')), buf = fs.readFileSync(pre + '.bin'), a = h.arrays.rad, rad = new Float32Array(buf.buffer.slice(buf.byteOffset + a.offset, buf.byteOffset + a.offset + 4 * 3 * HW));
      const code = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 4095), n = 3 * HW, bytes = Buffer.alloc(Math.ceil(n * 1.5));
      for (let i = 0; i < n; i += 2) { const x = code(rad[i]), y = i + 1 < n ? code(rad[i + 1]) : 0, o = i * 1.5; bytes[o] = x >> 4; bytes[o + 1] = ((x & 15) << 4) | (y >> 8); bytes[o + 2] = y & 255; }
      check(bytes.toString('base64') === D.frames.data[0][D.frames.index[0][k]], 'Blender re-render of scene 0 with ' + k + ' clauses set equals the recorded frame, code for code');
      reran++;
    } else console.error('note: the frame at k = ' + k + ' could not be re-rendered');
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* none */ }
} else console.error('note: Blender is not installed here (or L08_NO_BLENDER is set): the recorded suite and frames are not re-run');
put('blender_rerun', reran, 0);

/* ───────────── 6 · the widget, driven through every state the prose names ───────────── */
{
  const page = loadPage(path.join(root, dir, '08_the_contract_in_a_real_renderer.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const num = (t) => { const m = /-?\d+(?:\.\d+)?(?:e-?\d+)?/i.exec(t.replace('−', '-')); return m ? { v: parseFloat(m[0]), dec: (m[0].split('.')[1] || '').replace(/e.*/i, '').length } : null; };
  const refs = [0, 1].map((s) => street(D.frames.desc[s], 16).rad);
  let nFail = 0;
  for (let s = 0; s < 2; s++) {
    page.set('w08-scene', s);
    for (let k = 0; k <= 12; k++) {
      page.set('w08-k', k);
      const mean_ = num(page.text('w08-mean')), p99 = num(page.text('w08-p99')), mv = page.text('w08-moved');
      check(mean_ && near(mean_.v, pc(PATH.err[s][k]), 0.5 * Math.pow(10, -mean_.dec) + 1e-9), 'widget scene ' + s + ' step ' + k + ': mean error "' + page.text('w08-mean') + '" vs ' + pc(PATH.err[s][k]).toFixed(4));
      check(p99 && near(p99.v, pc(PATH.p99[s][k]), 0.5 * Math.pow(10, -p99.dec) + 1e-9), 'widget scene ' + s + ' step ' + k + ': 99th percentile "' + page.text('w08-p99') + '" vs ' + pc(PATH.p99[s][k]).toFixed(3));
      if (k === 0) check(mv === '—', 'widget step 0 has no step before it');
      else { const m = num(mv); check(m && near(m.v, pc(PATH.moved[s][k]), 0.5 * Math.pow(10, -m.dec) + 1e-9), 'widget scene ' + s + ' step ' + k + ': moved "' + mv + '" vs ' + pc(PATH.moved[s][k]).toFixed(3)); }
      const cl = page.text('w08-clause'), vd = page.text('w08-verdict'), er = page.text('w08-err'), kv = page.text('w08-k-v');
      if (k === 0) check(cl === 'none yet' && kv === 'none' && er === '—' && vd === '—', 'widget step 0: nothing set yet');
      else {
        const c = ORDER[k - 1], m = M[c];
        check(cl === c && kv.indexOf(k + ':') === 0, 'widget step ' + k + ' names clause ' + c + ' (' + cl + ' / ' + kv + ')');
        check(vd === (fails(m) ? 'fails at the default' : 'holds at the default'), 'widget step ' + k + ': verdict "' + vd + '"');
        const parts = er.split('→').map((x) => x.trim()), unit = { px: 1, '%': 100, m: 1, '': 1 }[ { axes: 'px', rows: 'px', lens: '%', shift: 'px', centre: 'px', shapes: 'px', output: '%', filter: '', sampler: '%', depth: '%', mask: '%', units: 'm' }[c] ];
        const dd = parts[0] === 'not in view' ? null : num(parts[0]), ss = num(parts[1]);
        check((m.d === null && dd === null) || (dd && near(dd.v / unit, m.d, 0.5 * Math.pow(10, -dd.dec) / unit + 1e-12)), 'widget step ' + k + ': error at the default "' + parts[0] + '" vs ' + m.d);
        check(ss && (near(ss.v / unit, m.s, 0.5 * Math.pow(10, -ss.dec) / unit + 1e-12) || (c === 'units' && ss.v < 1e-6)), 'widget step ' + k + ': error when set "' + parts[1] + '" vs ' + m.s);
        if (vd.indexOf('fails') === 0) nFail++;
      }
    }
  }
  check(nFail === 2 * 9, 'the widget calls nine of the twelve clauses failing, in both scenes');
  for (const a of ['5', '1', '0.2']) { page.set('w08-amp', a); page.set('w08-k', 6); }
  page.set('w08-scene', 0); page.set('w08-k', 0);
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
  put('widget_states', 2 * 13 + 3, 0);
}

/* ───────────── 7 · claims the prose adds ───────────── */
{
  const A = PATH.err[0], B = PATH.err[1];
  put('pa_drop_4', A[3] / A[4], 1); put('pb_drop_4', B[3] / B[4], 1);
  check(A[4] < 0.6 * A[3] && B[4] < 0.8 * B[3], 'setting the horizon (step 4) lowers the error');
  check(A[6] < 0.2 * A[5] && B[6] < 0.2 * B[5], 'setting the shapes (step 6) cuts the error by more than four fifths');
  check(A[2] > A[0] || B[2] > B[0], 'the whole-frame error is not monotone in the number of clauses set');
  put('path_nonmono_a', pc(A[2] - A[0]), 1);
  check(F.k_fail === 9 && F.m_total === 12, 'k of m');
  put('exit_k', F.k_fail, 0); put('exit_m', F.m_total, 0);
  put('wobble', F.blender_range, 1);
  check(PTS.x_rows25 < 2 * F.blender_range, 'a quarter of the batch upside down moves the exam by less than twice the seed range');
  put('flip_horizon', H - V0, 0);
  // the checkpoint: AUTO fits the sensor width to the longer side (measured above: the portrait frame gave f = lens L / 36 mm), the shift is in units of the longer side
  const CK = { lens: 20, sensor: 36, W: 256, H: 64 }, fAuto = CK.lens * Math.max(CK.W, CK.H) / CK.sensor, shiftWant = (24 - CK.H / 2) / Math.max(CK.W, CK.H);
  put('ck_f', fAuto, 1); put('ck_shift', shiftWant, 5); put('ck_fov_wide', 2 * Math.atan(CK.sensor / 2 / CK.lens) * 180 / Math.PI, 1); put('ck_f_h', CK.lens * 64 / CK.sensor, 1);
  put('ck_fov_port', 2 * Math.atan(32 / (CK.lens * Math.max(64, 256) / CK.sensor)) * 180 / Math.PI, 1);
  check(near(24, CK.H / 2 + shiftWant * Math.max(CK.W, CK.H), 1e-12), 'the checkpoint shift puts the horizon on row 24');
  check(near(M.lens.portAuto, M.lens.portH * 96 / 24, 0.2), 'AUTO against HORIZONTAL in the 24 x 96 frame: the ratio of the two focal lengths is the ratio of the frame\'s sides');
  // the batons of the page: the exit baton quotes the numbers this file computes
  {
    const html = fs.readFileSync(path.join(root, dir, '08_the_contract_in_a_real_renderer.html'), 'utf8'), bt = (id) => { const m = new RegExp('<span class="baton" data-seam="' + id + '">([\\s\\S]*?)</span>').exec(html); return m ? m[1] : ''; };
    const out = bt('S08-09');
    check(out.indexOf(F.k_fail + ' of the ' + F.m_total + ' conventions') >= 0 && out.indexOf('moved the exam by ' + F.pts_x_rows25.toFixed(1) + ' points') >= 0, 'the exit baton quotes k of m and the exam shift this file computes: "' + out.slice(0, 160) + '"');
    check(bt('S07-08').length > 100 && /How do we make a renderer we did not write obey the same contract\?$/.test(bt('S07-08')), 'the entry baton is Lesson 7\'s, ending on its question');
  }
}
check(Date.now() - T0 < 300000, 'the oracle runs in under 300 s (' + Math.round((Date.now() - T0) / 1000) + ' s)');
put('oracle_seconds', (Date.now() - T0) / 1000, 0);
if (bad) { console.error(bad + ' check(s) failed'); if (process.env.L08_FACTS) console.log(JSON.stringify({ facts: F })); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
