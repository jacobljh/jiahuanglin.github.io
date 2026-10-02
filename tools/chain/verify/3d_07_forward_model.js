#!/usr/bin/env node
/* Oracle for 3D lesson 07, "What a pixel measures: the forward model and the exam".
 *
 * Re-derives every number the lesson quotes by paths that do not share code with the page's widget:
 *   (1) Lambert's law against the engine's shade() at random surface points; the cosine from foreshortening;
 *   (2) the exam, written out from its definition (PSNR of the mean squared error), and the ladder of models, each built
 *       either by hand from the lesson's formula or through the engine's own renderer on a modified scene;
 *   (3) photo-consistency with the camera algebra written out (not FL.project / FL.backproject), three voting rules;
 *   (4) the staircase: the loss of a first-hit circle as a sum of boxes (closed form from ray-line tangency) against an explicit
 *       ray-circle quadratic and against FL.render (sphere tracing), the cliff counts and plateau widths, the exact
 *       anti-aliased loss against supersampling, the share of positions where a 0.1 mm difference is exactly zero;
 *   (5) the page's widget, driven into each state the prose describes: what it prints must equal the independent number.
 * Prints {"facts": {...}} as its last stdout line; the validator checks every <span data-n="key"> in the page against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

const PI = Math.PI, NT = 12, W = 64, R = 1.15;
const SC = FL.scenes.statue(), BG = SC.bg, L = SC.light, LL = Math.hypot(L[0], L[1]), LX = L[0] / LL, LZ = L[1] / LL;
const TR = FL.orbit(NT, 6, 0, 0, { f: 56, W, start: 0.13 });                               // the data
const HO = FL.orbit(24, 6, 0, 0, { f: 56, W, start: 0.13 + PI / 24 * 0.9 });                // held out
const PT = TR.map(c => FL.render(SC, c)), PH = HO.map(c => FL.render(SC, c));
{ // the field of view of these cameras: the angle between the rays at the two outer edges of the sensor
  const ra = FL.pixelRay(TR[0], 0), rb = FL.pixelRay(TR[0], W), ang = Math.acos(ra.dx * rb.dx + ra.dz * rb.dz) * 180 / PI;
  ok('field of view = 2 atan(W / 2f)', close(ang, 2 * Math.atan(W / 2 / 56) * 180 / PI, 1e-9), ang); facts.fov = ang;
}

/* ── 1. Lambert ── */
const lambertI = n => SC.amb + (1 - SC.amb) * Math.max(0, n.x * LX + n.z * LZ);
{
  const rng = FL.rng(11); let worst = 0, view = 0, n = 0;
  for (let t = 0; t < 600; t++) {
    const sid = Math.floor(rng() * 3), sh = SC.shapes[sid], phi = 2 * PI * rng(), c = Math.cos(phi), s = Math.sin(phi);
    let lo = 0, hi = 6; for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (FL.sdfShape(sh, sh.x + mid * c, sh.z + mid * s) < 0) lo = mid; else hi = mid; }
    const px = sh.x + lo * c, pz = sh.z + lo * s; if (FL.sdf(SC, px, pz) < -1e-6) continue;       // skip points buried in another shape
    const a = FL.albedo(sh, px, pz), I = lambertI(FL.normal(SC, px, pz)), id = FL.nearest(SC, px, pz).id;
    const e1 = FL.shade(SC, { id, x: px, z: pz }, { dx: Math.cos(0.7), dz: Math.sin(0.7) }, {}), e2 = FL.shade(SC, { id, x: px, z: pz }, { dx: Math.cos(2.9), dz: Math.sin(2.9) }, {});
    for (let j = 0; j < 3; j++) { worst = Math.max(worst, Math.abs(a[j] * I - e1[j])); view = Math.max(view, Math.abs(e1[j] - e2[j])); }
    n++;
  }
  ok('Lambert formula == FL.shade at random surface points', worst < 1e-12 && n > 400, [worst, n]);
  ok('the colour does not depend on the camera', view < 1e-15, view);
  // with the specular option on, two cameras disagree about the same point
  let spec = 0; for (let k = 0; k < 40; k++) { const th = 2 * PI * k / 40, hp = { id: 0, x: 1.1 * Math.cos(th), z: 1.1 * Math.sin(th) }; const n0 = FL.normal(SC, hp.x, hp.z);
    const ra = { dx: -n0.x, dz: -n0.z }, rb = { dx: -Math.cos(Math.atan2(n0.z, n0.x) + 0.5), dz: -Math.sin(Math.atan2(n0.z, n0.x) + 0.5) };
    const a = FL.shade(SC, hp, ra, { spec: 0.6 }), b = FL.shade(SC, hp, rb, { spec: 0.6 }); spec = Math.max(spec, Math.abs(a[0] - b[0])); }
  ok('a specular term makes the colour depend on the camera', spec > 0.01, spec);
  // I(theta): the engine's shading of a white circle whose normal makes angle theta with the lamp
  const one = { shapes: [FL.circle(0, 0, 1, [1, 1, 1])], light: [LX, LZ], amb: SC.amb, bg: BG, far: 20, stepScale: 0.9 };
  for (const deg of [0, 30, 60, 90]) {
    const th = deg * PI / 180, ang = Math.atan2(LZ, LX) + th, I = FL.shade(one, { id: 0, x: Math.cos(ang), z: Math.sin(ang) }, { dx: 0, dz: 1 }, {})[0];
    ok('I(theta=' + deg + ')', close(I, SC.amb + (1 - SC.amb) * Math.max(0, Math.cos(th)), 1e-5), I);
    facts['lam_i' + deg] = I;
  }
  facts.lam_ratio = facts.lam_i0 / facts.lam_i90; facts.amb = SC.amb; facts.lamp_x = LX; facts.lamp_z = LZ;   // the constants the page prints
  // foreshortening: the shadow of a segment of length s on the line perpendicular to the beam has length s cos(theta)
  let ferr = 0;
  for (const th of [0.2, 0.7, 1.2, 1.5]) {
    const s = 0.8, nrm = [Math.cos(th), Math.sin(th)], tan = [-nrm[1], nrm[0]], beam = [1, 0];             // beam travels along +x: l = (-1, 0), cos(theta) = n . l
    const p0 = [0, 0], p1 = [s * tan[0], s * tan[1]], shadow = Math.abs((p1[1] - p0[1]) * 1);              // extent across the beam = the z-extent
    ferr = Math.max(ferr, Math.abs(shadow - s * Math.abs(nrm[0]))); void beam;
  }
  ok('cross-section of the beam caught by a tilted segment = s cos(theta)', ferr < 1e-12, ferr);
}

/* ── 2. the exam and its ladder ── */
function mse3(A, B) { let s = 0; for (let i = 0; i < A.W; i++) s += ((A.r[i] - B.r[i]) ** 2 + (A.g[i] - B.g[i]) ** 2 + (A.b[i] - B.b[i]) ** 2) / 3; return s / A.W; }
const psnrOf = m => (m < 1e-10 ? 99 : -10 * Math.log10(m));
function exam(preds, truths) { let s = 0; for (let k = 0; k < preds.length; k++) s += psnrOf(mse3(preds[k], truths[k])); return s / preds.length; }
ok('exam score == FL.psnr', close(psnrOf(mse3(PT[0], PH[0])), FL.psnr(PT[0], PH[0]), 1e-9));
function paint(cam, rule) {
  const out = { W: cam.W, r: new Float32Array(cam.W), g: new Float32Array(cam.W), b: new Float32Array(cam.W) };
  for (let i = 0; i < cam.W; i++) {
    const ray = FL.pixelRay(cam, i + 0.5), h = FL.raycast(SC, ray.ox, ray.oz, ray.dx, ray.dz, SC.far), c = h.hit ? rule(h, ray) : BG;
    out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2];
  }
  return out;
}
facts.ex_bg = exam(HO.map(c => paint(c, () => BG)), PH);
facts.ex_nearest = exam(HO.map(c => { let b = 0, bd = 1e9; TR.forEach((t, k) => { const d = Math.hypot(t.x - c.x, t.z - c.z); if (d < bd) { bd = d; b = k; } }); return PT[b]; }), PH);
ok('answering a training camera with its own photograph is perfect', exam(PT, PT) === 99);
let mc = [0, 0, 0], nobj = 0;
PT.forEach(p => { for (let i = 0; i < p.W; i++) if (Math.abs(p.r[i] - BG[0]) + Math.abs(p.g[i] - BG[1]) + Math.abs(p.b[i] - BG[2]) > 0.02) { mc[0] += p.r[i]; mc[1] += p.g[i]; mc[2] += p.b[i]; nobj++; } });
const MC = mc.map(v => v / nobj);
facts.ex_const = exam(HO.map(c => paint(c, () => MC)), PH);
facts.lad_unlit = exam(HO.map(c => paint(c, h => FL.albedo(SC.shapes[h.id], h.x, h.z))), PH);
ok('unlit albedo == the engine\'s flat render', close(facts.lad_unlit, exam(HO.map(c => FL.render(SC, c, { flat: true })), PH), 1e-9));
{
  let num = [0, 0, 0], den = 0;                                                   // one albedo per channel, least squares against the shading
  PT.forEach(p => { for (let i = 0; i < p.W; i++) if (p.id[i] >= 0) { const I = lambertI(FL.normal(SC, p.hx[i], p.hz[i])); num[0] += p.r[i] * I; num[1] += p.g[i] * I; num[2] += p.b[i] * I; den += I * I; } });
  const a0 = num.map(v => v / den);
  facts.lad_shade1 = exam(HO.map(c => paint(c, h => { const I = lambertI(FL.normal(SC, h.x, h.z)); return [a0[0] * I, a0[1] * I, a0[2] * I]; })), PH);
  const scene1 = { name: 'one albedo', shapes: SC.shapes.map(s => Object.assign({}, s, { col: a0, stripes: 0 })), light: SC.light, amb: SC.amb, bg: SC.bg, far: SC.far, stepScale: SC.stepScale };
  ok('one albedo x shading == the engine on a one-albedo scene', close(facts.lad_shade1, exam(HO.map(c => FL.render(scene1, c)), PH), 1e-9));
  const scene2 = { name: 'base colours', shapes: SC.shapes.map(s => Object.assign({}, s, { stripes: 0 })), light: SC.light, amb: SC.amb, bg: SC.bg, far: SC.far, stepScale: SC.stepScale };
  facts.lad_shade_obj = exam(HO.map(c => FL.render(scene2, c)), PH);
  ok('base colours x shading == own formula', close(facts.lad_shade_obj, exam(HO.map(c => paint(c, h => { const I = lambertI(FL.normal(SC, h.x, h.z)), col = SC.shapes[h.id].col; return [col[0] * I, col[1] * I, col[2] * I]; })), PH), 1e-9));
}
function copyModel(trainCams, trainPhotos, cam) {                                // nearest-pixel copy from the closest camera (by viewing angle) that sees the point
  return paint(cam, h => {
    let best = null;
    for (let k = 0; k < trainCams.length; k++) {
      const tc = trainCams[k], q = FL.project(tc, h.x, h.z); if (q.zc <= 0 || q.u < 0 || q.u >= tc.W) continue;
      const dx = h.x - tc.x, dz = h.z - tc.z, dist = Math.hypot(dx, dz), rr = FL.raycast(SC, tc.x, tc.z, dx / dist, dz / dist, dist + 0.5);
      if (!rr.hit || Math.abs(rr.t - dist) > 0.03) continue;
      const ax = cam.x - h.x, az = cam.z - h.z, bx = tc.x - h.x, bz = tc.z - h.z, ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz)))));
      if (best === null || ang < best.ang) best = { ang, k, i: Math.floor(q.u) };
    }
    if (!best) return [0.5, 0.5, 0.5];
    const p = trainPhotos[best.k]; return [p.r[best.i], p.g[best.i], p.b[best.i]];
  });
}
facts.lad_copy = exam(HO.map(c => copyModel(TR, PT, c)), PH);
{
  let lo = 1e9, hi = -1e9;
  for (const n of [6, 8, 12, 16, 24]) { const tr = FL.orbit(n, 6, 0, 0, { f: 56, W, start: 0.13 }), ph = tr.map(c => FL.render(SC, c)); const e = exam(HO.map(c => copyModel(tr, ph, c)), PH); lo = Math.min(lo, e); hi = Math.max(hi, e); }
  facts.copy_lo = lo; facts.copy_hi = hi;
}
ok('the full forward model reproduces the photographs exactly', exam(HO.map(c => FL.render(SC, c)), PH) === 99);
ok('the ladder is ordered as the prose says', facts.lad_unlit < facts.ex_const && facts.ex_const < facts.lad_shade1 && facts.lad_shade1 < facts.lad_shade_obj && facts.lad_shade_obj < facts.lad_copy - 4 && facts.ex_bg < facts.ex_nearest && facts.ex_nearest < facts.ex_const);

/* ── 3. photo-consistency, with the camera algebra written out ── */
function sample(img, u) {
  const x = u - 0.5, i0 = Math.floor(x), t = x - i0, a = Math.max(0, Math.min(img.W - 1, i0)), b = Math.max(0, Math.min(img.W - 1, i0 + 1));
  return [img.r[a] * (1 - t) + img.r[b] * t, img.g[a] * (1 - t) + img.g[b] * t, img.b[a] * (1 - t) + img.b[b] * t];
}
function variance(cs) { const m = cs.length, mean = [0, 0, 0]; cs.forEach(c => { for (let j = 0; j < 3; j++) mean[j] += c[j] / m; }); let v = 0; cs.forEach(c => { for (let j = 0; j < 3; j++) v += (c[j] - mean[j]) ** 2; }); return v / (3 * m); }
function costEngine(ref, u, z, voters) {
  const P = FL.backproject(TR[ref], u, z), cs = [sample(PT[ref], u)];
  for (const k of voters) { const q = FL.project(TR[k], P.x, P.z); if (!(q.zc > 0 && q.u >= 0 && q.u <= TR[k].W)) return Infinity; cs.push(sample(PT[k], q.u)); }
  return variance(cs);
}
function cost(ref, u, z, voters) {
  const c0 = TR[ref], xc = (u - c0.W / 2) / c0.f * z, Px = c0.x + xc * Math.sin(c0.a) + z * Math.cos(c0.a), Pz = c0.z - xc * Math.cos(c0.a) + z * Math.sin(c0.a), cs = [sample(PT[ref], u)];
  for (const k of voters) {
    const c = TR[k], dx = Px - c.x, dz = Pz - c.z, zc = dx * Math.cos(c.a) + dz * Math.sin(c.a), xk = dx * Math.sin(c.a) - dz * Math.cos(c.a), uu = c.W / 2 + c.f * xk / zc;
    if (!(zc > 0 && uu >= 0 && uu <= c.W)) return Infinity; cs.push(sample(PT[k], uu));
  }
  return variance(cs);
}
{ const rng = FL.rng(5); let worst = 0; for (let t = 0; t < 400; t++) { const ref = Math.floor(rng() * NT), u = 1 + 62 * rng(), z = 2.5 + 7.5 * rng(), vs = [(ref + 1) % NT, (ref + 11) % NT, (ref + 2) % NT], a = costEngine(ref, u, z, vs), b = cost(ref, u, z, vs); if (isFinite(a) && isFinite(b)) worst = Math.max(worst, Math.abs(a - b)); else ok('same exclusions', a === b); } ok('the two cost implementations agree', worst < 1e-12, worst); }
function sees(k, x, z) {
  const tc = TR[k], q = FL.project(tc, x, z); if (!(q.zc > 0 && q.u >= 0 && q.u <= tc.W)) return false;
  const dx = x - tc.x, dz = z - tc.z, dist = Math.hypot(dx, dz), rr = FL.raycast(SC, tc.x, tc.z, dx / dist, dz / dist, dist + 0.5);
  return rr.hit && Math.abs(rr.t - dist) < 0.03;
}
const Z0 = 2.5, Z1 = 10, DZ = 0.01, NZ = Math.round((Z1 - Z0) / DZ) + 1;
function argmin(ref, i, voters) { let best = null; for (let n = 0; n < NZ; n++) { const z = Z0 + n * DZ, c = cost(ref, i + 0.5, z, voters); if (best === null || c < best.c) best = { z, c }; } return best; }
{
  const err = { A: [], B: [], C: [] }, nv = { A: 0, B: 0, C: 0 }; let cnt = 0;
  for (let ref = 0; ref < NT; ref++) for (let i = 0; i < W; i++) {
    if (PT[ref].id[i] !== 0) continue; cnt++;
    const zt = PT[ref].depth[i], P = FL.backproject(TR[ref], i + 0.5, zt), vA = [(ref + 1) % NT, (ref + NT - 1) % NT], vB = [], vC = [];
    for (let o = -3; o <= 3; o++) if (o) vB.push((ref + o + NT) % NT);
    for (let o = -6; o <= 5; o++) { if (!o) continue; const k = (ref + o + NT) % NT; if (sees(k, P.x, P.z)) vC.push(k); }
    for (const [key, vs] of [['A', vA], ['B', vB], ['C', vC]]) { nv[key] += vs.length; err[key].push(vs.length ? Math.abs(argmin(ref, i, vs).z - zt) : 9); }
  }
  facts.pc_pix = cnt;
  for (const k of ['A', 'B', 'C']) { const s = err[k].slice().sort((a, b) => a - b); facts['pc_' + k] = 100 * err[k].filter(e => e <= 0.1).length / cnt; facts['pc_med_' + k] = 100 * s[Math.floor(s.length / 2)]; facts['pc_nv_' + k] = nv[k] / cnt; }
  ok('photo-consistency: knowing who sees the point beats guessing', facts.pc_C > facts.pc_A && facts.pc_A > facts.pc_B);
  ok('the minimum of the cost sits at the truth to the pixel for noise-free cameras', facts.pc_med_C < 3);
}
{
  // the wide valleys: width of {C <= 1e-3} around the truth, by the quarter of pixels with the least / most colour change
  const rows = [];
  for (let ref = 0; ref < NT; ref++) for (let i = 2; i < W - 2; i++) {
    if (PT[ref].id[i] !== 0 || PT[ref].id[i - 2] !== 0 || PT[ref].id[i + 2] !== 0) continue;
    const zt = PT[ref].depth[i], P = FL.backproject(TR[ref], i + 0.5, zt), vs = [];
    for (const o of [-1, 1]) { const k = (ref + o + NT) % NT; if (sees(k, P.x, P.z)) vs.push(k); }
    if (vs.length < 2) continue;
    const g = Math.hypot(PT[ref].r[i + 1] - PT[ref].r[i - 1], PT[ref].g[i + 1] - PT[ref].g[i - 1], PT[ref].b[i + 1] - PT[ref].b[i - 1]) / 2;
    let lo = zt, hi = zt; for (let z = zt; z >= zt - 1; z -= 0.005) { if (cost(ref, i + 0.5, z, vs) > 1e-3) break; lo = z; } for (let z = zt; z <= zt + 1; z += 0.005) { if (cost(ref, i + 0.5, z, vs) > 1e-3) break; hi = z; }
    rows.push({ g, wdt: hi - lo });
  }
  rows.sort((a, b) => a.g - b.g); const q = Math.floor(rows.length / 4), mean = a => a.reduce((s, x) => s + x.wdt, 0) / a.length;
  facts.pc_vw_n = rows.length; facts.pc_flat_w = mean(rows.slice(0, q)); facts.pc_steep_w = mean(rows.slice(rows.length - q));
  ok('flat pixels have wider valleys', facts.pc_flat_w > 3 * facts.pc_steep_w);
  // a plain background pixel: share of the depths 2.5..10 m at which the cost is exactly zero (two neighbours vote)
  let nb = 0, fz = 0;
  for (let ref = 0; ref < NT; ref++) { const vs = [(ref + 1) % NT, (ref + NT - 1) % NT]; for (let i = 3; i < W - 3; i++) { if (PT[ref].id[i] >= 0 || PT[ref].id[i - 3] >= 0 || PT[ref].id[i + 3] >= 0) continue; let z0 = 0; for (let n = 0; n < NZ; n++) if (cost(ref, i + 0.5, Z0 + n * DZ, vs) < 1e-9) z0++; nb++; fz += z0 / NZ; } }
  facts.pc_bg_zero = 100 * fz / nb; ok('background pixels have zero-cost floors', facts.pc_bg_zero > 1);
}

/* ── 4. the staircase ── */
const cliffsOf = (rays, r) => { const c = []; rays.forEach(ray => { const x0 = ray.ox - ray.oz * ray.dx / ray.dz, w = r / Math.abs(ray.dz); c.push(x0 - w, x0 + w); }); return c.sort((a, b) => a - b); };
function hitQ(ray, cx, r) { const ox = ray.ox - cx, oz = ray.oz, b = ox * ray.dx + oz * ray.dz, disc = b * b - (ox * ox + oz * oz - r * r); return disc >= 0 && (-b - Math.sqrt(disc)) > 0; }
function pixErr(c, p, i) { return ((c[0] - p.r[i]) ** 2 + (c[1] - p.g[i]) ** 2 + (c[2] - p.b[i]) ** 2) / 3; }
function stairs(E, lo, hi, step) {
  const vals = new Set(); let prev = null, flat = 0, steps = 0;
  for (let k = 0; k <= Math.round((hi - lo) / step); k++) { const d = lo + k * step, e = E(d); vals.add(e.toFixed(10)); if (prev !== null) { steps++; if (Math.abs(e - prev) < 1e-12) flat++; } prev = e; }
  return { distinct: vals.size, flatPct: 100 * flat / steps };
}
function zeroShare(c, lo, hi, h) {                                                // share of [lo,hi] at least h away from every cliff: where a central difference with step h is exactly zero
  let tot = 0, a0 = null, b0 = null;
  for (const x of c) { const a = Math.max(lo, x - h), b = Math.min(hi, x + h); if (b <= a) continue; if (b0 === null || a > b0) { if (b0 !== null) tot += b0 - a0; a0 = a; b0 = b; } else b0 = Math.max(b0, b); }
  if (b0 !== null) tot += b0 - a0;
  return 1 - tot / (hi - lo);
}
/* the statue's photographs, 12 cameras, a flat circle of radius R and colour MC */
const RAYS = TR.map(cam => Array.from({ length: W }, (_, i) => FL.pixelRay(cam, i + 0.5)));
const flatRays = [].concat(...RAYS);
const BOX = [];
TR.forEach((cam, v) => { for (let i = 0; i < W; i++) { const ray = RAYS[v][i]; BOX.push({ x0: ray.ox - ray.oz * ray.dx / ray.dz, w: R / Math.abs(ray.dz), e1: pixErr(MC, PT[v], i), e0: pixErr(BG, PT[v], i) }); } });
const N = BOX.length;
const Ebox = d => { let e = 0; for (const k of BOX) e += Math.abs(d - k.x0) <= k.w ? k.e1 : k.e0; return e / N; };
const Equad = d => { let e = 0; for (let v = 0; v < NT; v++) for (let i = 0; i < W; i++) e += pixErr(hitQ(RAYS[v][i], d, R) ? MC : BG, PT[v], i); return e / N; };
{ const rng = FL.rng(2); let worst = 0; for (let t = 0; t < 400; t++) { const d = -3.2 + 6.4 * rng(); worst = Math.max(worst, Math.abs(Equad(d) - Ebox(d))); } ok('sum of boxes == explicit ray-circle test', worst < 1e-12, worst); }
const CL = cliffsOf(flatRays, R);
{
  // the engine's own renderer (sphere tracing inflates the circle by its 1 mm hit tolerance): equal away from the cliffs
  const Eeng = d => { const sc = { shapes: [FL.circle(d, 0, R, MC)], light: [0, 1], amb: 1, bg: BG, far: 20, stepScale: 0.9 }; let e = 0; for (let v = 0; v < NT; v++) e += FL.mse(FL.render(sc, TR[v], { flat: true }), PT[v]); return e / NT; };
  const rng = FL.rng(9); let worst = 0, n = 0;
  for (let t = 0; t < 400 && n < 40; t++) { const d = -3.2 + 6.4 * rng(); let m = 1e9; for (const c of CL) m = Math.min(m, Math.abs(c - d)); if (m < 0.004) continue; worst = Math.max(worst, Math.abs(Eeng(d) - Ebox(d))); n++; }
  ok('FL.render of a flat circle == sum of boxes away from cliffs', worst < 1e-6 && n >= 30, [worst, n]);
}
{
  const inS = CL.filter(c => c >= -1.6 && c <= 1.6), uniq = [...new Set(inS.map(c => c.toFixed(9)))], st = stairs(Ebox, -1.6, 1.6, 0.001);
  facts.st_rays = N; facts.st_cliffs = inS.length; facts.st_uniq = uniq.length; facts.st_distinct = st.distinct; facts.st_flat = st.flatPct; facts.st_gap = 3200 / uniq.length;
  // between two consecutive cliffs E is constant and its central difference is exactly 0; across a cliff E jumps by (e1 - e0) / N
  const rng = FL.rng(17); let nz = 0, worstFlat = 0;
  for (let t = 0; t < 300; t++) { const d = -3.2 + 6.4 * rng(); let m = 1e9; for (const c of CL) m = Math.min(m, Math.abs(c - d)); if (m < 2e-4) continue; nz++; if ((Ebox(d + 1e-4) - Ebox(d - 1e-4)) !== 0) worstFlat++; }
  ok('the central difference with h = 0.1 mm is exactly 0 away from cliffs', worstFlat === 0 && nz > 250, [worstFlat, nz]);
  const k0 = BOX.findIndex(b => b.x0 + b.w > -1.2 && b.x0 + b.w < -1.0 && Math.abs(Math.abs(b.x0 + b.w) - 1.1) < 0.1); const top = BOX[k0].x0 + BOX[k0].w;
  const near = CL.filter(c => Math.abs(c - top) < 1e-9).length;
  const jump = Ebox(top + 1e-7) - Ebox(top - 1e-7), want = near * (BOX[k0].e0 - BOX[k0].e1) / N; ok('a cliff has height (e0 - e1) / N per ray that ends there', close(jump, want, 1e-12), [jump, want]);
  facts.cliff_h = (BOX.reduce((s, b) => s + Math.abs(b.e1 - b.e0), 0) / N) / N;
  facts.zero_s1 = 100 * zeroShare(CL, -1.6, 1.6, 1e-4);
  for (const S of [16]) { const c = []; TR.forEach(cam => { for (let i = 0; i < W; i++) for (let s = 0; s < S; s++) { const ray = FL.pixelRay(cam, i + (s + 0.5) / S); c.push(ray.ox - ray.oz * ray.dx / ray.dz - R / Math.abs(ray.dz), ray.ox - ray.oz * ray.dx / ray.dz + R / Math.abs(ray.dz)); } }); c.sort((a, b) => a - b); facts['zero_s' + S] = 100 * zeroShare(c, -1.6, 1.6, 1e-4); }
}
{
  /* the disc of lesson 8: radius 1, six cameras at 5 m, f = 40, 48 pixels, sweep -1.6..1.6 in 1 mm steps */
  const R0 = 1.0, OR = [0.93, 0.55, 0.2], WB = [1, 1, 1], Wd = 48;
  const cams = FL.orbit(6, 5, 0, 0, { f: 40, W: Wd, start: PI / 6 }), TRUE = { shapes: [FL.circle(0, 0, R0, OR)], light: [0, 1], amb: 1, bg: WB, far: 20, stepScale: 0.9 };
  const ph = cams.map(c => FL.render(TRUE, c, { flat: true })), rays = cams.map(c => Array.from({ length: Wd }, (_, i) => FL.pixelRay(c, i + 0.5)));
  const Eq = d => { let e = 0, n = 0; for (let v = 0; v < 6; v++) for (let i = 0; i < Wd; i++) { e += pixErr(hitQ(rays[v][i], d, R0) ? OR : WB, ph[v], i); n++; } return e / n; };
  const bx = []; cams.forEach((c, v) => { for (let i = 0; i < Wd; i++) { const ray = rays[v][i]; bx.push({ x0: ray.ox - ray.oz * ray.dx / ray.dz, w: R0 / Math.abs(ray.dz), e1: pixErr(OR, ph[v], i), e0: pixErr(WB, ph[v], i) }); } });
  const Eb = d => { let e = 0; for (const k of bx) e += Math.abs(d - k.x0) <= k.w ? k.e1 : k.e0; return e / bx.length; };
  const rng = FL.rng(4); let worst = 0; for (let t = 0; t < 300; t++) { const d = -3.2 + 6.4 * rng(); worst = Math.max(worst, Math.abs(Eq(d) - Eb(d))); } ok('disc: sum of boxes == ray test', worst < 1e-12, worst);
  const cl = cliffsOf([].concat(...rays), R0), inS = cl.filter(c => c >= -1.6 && c <= 1.6), uniq = [...new Set(inS.map(c => c.toFixed(9)))], st = stairs(Eq, -1.6, 1.6, 0.001);
  facts.disc_rays = bx.length; facts.disc_cliffs = inS.length; facts.disc_uniq = uniq.length; facts.disc_distinct = st.distinct; facts.disc_flat = st.flatPct; facts.disc_gap = 3200 / uniq.length;
  ok('opposite cameras of the disc see the same rays: its cliffs sit at half as many places as there are cliffs, the statue\'s at as many', facts.disc_uniq * 2 === facts.disc_cliffs && facts.st_uniq === facts.st_cliffs, [facts.disc_uniq, facts.disc_cliffs, facts.st_uniq, facts.st_cliffs]);
  ok('lesson 8 quotes 59 distinct values and 96.4% for this sweep', facts.disc_distinct === 59 && close(facts.disc_flat, 96.4, 0.05), [facts.disc_distinct, facts.disc_flat]);
}
/* anti-aliasing: the exact coverage is the limit of supersampling; a finite number of sub-rays is a staircase again */
const Q = ((MC[0] - BG[0]) ** 2 + (MC[1] - BG[1]) ** 2 + (MC[2] - BG[2]) ** 2) / 3;
function spanOf(cam, d) { const q = FL.toCam(cam, d, 0), r = Math.hypot(q.xc, q.zc), phi = Math.atan2(q.xc, q.zc), al = Math.asin(R / r); return [cam.W / 2 + cam.f * Math.tan(phi - al), cam.W / 2 + cam.f * Math.tan(phi + al)]; }
function Eexact(d) { let e = 0, edge = 0; for (let v = 0; v < NT; v++) { const s = spanOf(TR[v], d); for (let i = 0; i < W; i++) { const c = Math.max(0, Math.min(i + 1, s[1]) - Math.max(i, s[0])), k = BOX[v * W + i]; e += k.e0 + (k.e1 - k.e0 - Q) * c + Q * c * c; if (c > 0 && c < 1) edge++; } } return { E: e / N, edge }; }
function Ess(d, S) {
  let e = 0;
  for (let v = 0; v < NT; v++) for (let i = 0; i < W; i++) {
    let cov = 0; for (let s = 0; s < S; s++) if (hitQ(FL.pixelRay(TR[v], i + (s + 0.5) / S), d, R)) cov++; cov /= S;
    e += pixErr([MC[0] * cov + BG[0] * (1 - cov), MC[1] * cov + BG[1] * (1 - cov), MC[2] * cov + BG[2] * (1 - cov)], PT[v], i);
  }
  return e / N;
}
{ const rng = FL.rng(21); let worst = 0; for (let t = 0; t < 6; t++) { const d = -3 + 6 * rng(); worst = Math.max(worst, Math.abs(Ess(d, 2048) - Eexact(d).E)); } ok('exact coverage == supersampling with 2048 sub-rays', worst < 5e-6, worst); }
{
  // every pixel with a partial footprint contains a silhouette edge: at most two per camera
  let maxEdge = 0; for (let t = 0; t < 60; t++) maxEdge = Math.max(maxEdge, Eexact(-3.2 + 6.4 * t / 59).edge);
  ok('at most two edge pixels per camera', maxEdge <= 2 * NT, maxEdge);
}
const fdiff = (f, d, h) => (f(d + h) - f(d - h)) / (2 * h);
const Eaa = d => Eexact(d).E, H1 = 1e-4;
function adam(f, d0) { let d = d0, m = 0, v = 0; for (let s = 1; s <= 100; s++) { const g = fdiff(f, d, H1); m = 0.9 * m + 0.1 * g; v = 0.999 * v + 0.001 * g * g; d -= 0.05 * (m / (1 - Math.pow(0.9, s))) / (Math.sqrt(v / (1 - Math.pow(0.999, s))) + 1e-12); } return d; }
const cliffNear = d => { let lo = -Infinity, hi = Infinity; for (const c of CL) { if (c <= d) lo = c; else { hi = c; break; } } return [lo, hi]; };

/* held-out score of the hard one-circle model (explicit ray-circle test, the engine's PSNR) */
function examCircle(d) { let s = 0; HO.forEach((cam, v) => { const img = { W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) }; for (let i = 0; i < W; i++) { const c = hitQ(FL.pixelRay(cam, i + 0.5), d, R) ? MC : BG; img.r[i] = c[0]; img.g[i] = c[1]; img.b[i] = c[2]; } s += FL.psnr(img, PH[v]); }); return s / HO.length; }

/* ── 5. the page's own widget, driven into each state the prose describes ── */
const page = loadPage(path.join(DIR, '07_what_a_pixel_measures.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function setState(d, z, cam) { page.set('w07-d', d); if (z !== undefined) page.set('w07-z', z); if (cam !== undefined) page.set('w07-cam', cam); }
{
  // the opening state
  setState(-1.5, 0, 17);
  const eh = Equad(-1.5), ea = Eaa(-1.5), ga = fdiff(Eaa, -1.5, 1e-6), gh = fdiff(Equad, -1.5, H1), pl = cliffNear(-1.5), ed = Eexact(-1.5).edge, ps = examCircle(-1.5);
  ok('widget: E hard', close(page.num('w07-eh'), eh, 6e-5), [page.num('w07-eh'), eh]);
  ok('widget: hard slope is exactly zero', page.num('w07-gh') === 0 && gh === 0, [page.text('w07-gh'), gh]);
  ok('widget: E anti-aliased', close(page.num('w07-ea'), ea, 6e-5), [page.num('w07-ea'), ea]);
  ok('widget: anti-aliased slope', close(page.num('w07-ga'), ga, 6e-5), [page.num('w07-ga'), ga]);
  ok('widget: held-out PSNR', close(page.num('w07-ps'), ps, 0.0051), [page.num('w07-ps'), ps]);
  ok('widget: plateau width', close(page.num('w07-pl'), (pl[1] - pl[0]) * 1000, 0.0051), [page.num('w07-pl'), (pl[1] - pl[0]) * 1000]);
  ok('widget: edge pixels', /\b24 of 768/.test(page.text('w07-px')) && ed === 24, [page.text('w07-px'), ed]);
  facts.t0_eh = eh; facts.t0_ea = ea; facts.t0_ga = ga; facts.t0_gh = gh; facts.t0_ps = ps; facts.t0_pl = (pl[1] - pl[0]) * 1000; facts.t0_edge = ed;
  facts.t0_coarse = fdiff(Equad, -1.5, 0.1); facts.t0_ncl = CL.filter(c => Math.abs(c + 1.5) <= 0.1).length;
  let best = [0, -1]; for (let k = -3200; k <= 3200; k++) { const d = k * 0.001, v = examCircle(d); if (v > best[1]) best = [d, v]; }
  facts.t0_best = best[1]; facts.t0_best_d = best[0];
  // the two cliffs that bound this plateau, and what crosses them
  facts.t1_lo = pl[0]; facts.t1_hi = pl[1];
  facts.t1_drop = -(Equad(pl[1] + 1e-6) - Equad(pl[1] - 1e-6)); facts.t1_dn = Equad(pl[0] + 1e-6) - Equad(pl[0] - 1e-6);
  // descents from here
  page.click('w07-go-hard'); const hardEnd = page.num('w07-end'); ok('widget: the first-hit descent does not move', close(hardEnd, -1.5, 0.0006) && adam(Equad, -1.5) === -1.5, [hardEnd, adam(Equad, -1.5)]);
  page.click('w07-go-aa'); const aaEnd = page.num('w07-end'), mine = adam(Eaa, -1.5); ok('widget: the anti-aliased descent ends where the independent optimiser ends', close(aaEnd, mine, 0.0006), [aaEnd, mine]);
  facts.t2_aa_end = mine;
}
{
  setState(-2.0, 0, 17);
  const hardEnd = (page.click('w07-go-hard'), page.num('w07-end')), e = adam(Eaa, -2.0);
  ok('widget: from -2.0 the first-hit descent does not move either', close(hardEnd, -2.0, 0.0006), hardEnd);
  page.click('w07-go-aa'); ok('widget: from -2.0 the anti-aliased descent ends where the independent one does', close(page.num('w07-end'), e, 0.0006), [page.num('w07-end'), e]);
  facts.t3_end = e;
  let low = [0, 1e9]; for (let k = -400; k <= 400; k++) { const d = k * 0.001, v = Eaa(d); if (v < low[1]) low = [d, v]; }
  facts.t3_min = low[0]; facts.t3_gap = Eaa(e) - low[1];
  ok('the valley at the end of that descent is a local minimum', Eaa(e - 0.01) > Eaa(e) && Eaa(e + 0.01) > Eaa(e) || Math.abs(fdiff(Eaa, e, 1e-4)) < 0.02, [Eaa(e - 0.01), Eaa(e), Eaa(e + 0.01)]);
  facts.t3_ps_end = examCircle(e); facts.t3_ps_min = examCircle(low[0]);
}
{
  // the zoomed window: the plateau is visible; the slider changes what the reader sees
  setState(-1.5, 4, 17); ok('widget: magnify label', /25/.test(page.text('w07-z-v')), page.text('w07-z-v'));
  // share of 1 mm start positions from which the first-hit derivative is exactly zero (whole slider range)
  let z = 0, n = 0; for (let k = 0; k <= 6400; k++) { const d = -3.2 + k * 0.001; n++; if (fdiff(Ebox, d, H1) === 0) z++; }
  facts.start_zero = 100 * z / n;
  facts.zero_full = 100 * zeroShare(CL, -3.2, 3.2, H1);
  // a descent from a hair away from a cliff: the derivative is huge for one step, the walk ends on another plateau
  setState(-1.5, 0, 17);
}
{
  // stepping 1 mm at a time across the plateau's right end: the printed loss jumps by the cliff height
  const pl = cliffNear(-1.5), dA = Math.round((pl[1] - 0.0005) * 1000) / 1000, dB = Math.round((pl[1] + 0.0005) * 1000) / 1000;
  setState(dA, 4, 17); const a = page.num('w07-eh'); setState(dB, 4, 17); const b = page.num('w07-eh');
  ok('widget: E jumps across the cliff by the box height', close(b - a, Equad(dB) - Equad(dA), 2e-4), [a, b, Equad(dA), Equad(dB)]);
}
{
  // the hidden ball: moving it changes nothing the cameras that cannot see it record
  const mv = (dx) => ({ name: 's', shapes: [SC.shapes[0], SC.shapes[1], Object.assign({}, SC.shapes[2], { x: SC.shapes[2].x + dx })], light: SC.light, amb: SC.amb, bg: SC.bg, far: SC.far, stepScale: SC.stepScale });
  const a = TR.map(c => FL.render(SC, c)), b = TR.map(c => FL.render(mv(0.3), c)), b2 = TR.map(c => FL.render(mv(-0.3), c));
  const changed = (A, B) => { let n = 0; for (let i = 0; i < A.W; i++) if (Math.abs(A.r[i] - B.r[i]) + Math.abs(A.g[i] - B.g[i]) + Math.abs(A.b[i] - B.b[i]) > 1e-6) n++; return n; };
  const ch = a.map((p, k) => Math.max(changed(p, b[k]), changed(p, b2[k]))), ballPix = a.map(p => { let n = 0; for (let i = 0; i < p.W; i++) if (p.id[i] === 2) n++; return n; });
  const hidden = ch.map((c, k) => (ballPix[k] === 0 ? c : -1)).filter(c => c >= 0);
  facts.hid_n = ballPix.filter(n => n === 0).length; facts.hid_max = Math.max(...ch);
  ok('cameras that cannot see the ball do not change when it moves', hidden.length === facts.hid_n && hidden.every(c => c === 0), [ch, ballPix]);
}
/* the checkpoint: pixel 37 of a camera at (0, 6) looking straight down, f = 56, 64 pixels, a unit disc */
{
  const cam = FL.camera({ x: 0, z: 6, a: -PI / 2, f: 56, W: 64 }), ray = FL.pixelRay(cam, 37.5), x0 = ray.ox - ray.oz * ray.dx / ray.dz, w = 1 / Math.abs(ray.dz);
  facts.ck_x0 = x0; facts.ck_w = w; facts.ck_lo = x0 - w; facts.ck_hi = x0 + w; facts.ck_foot = 6 / 56; facts.ck_dz = Math.abs(ray.dz);
  ok('checkpoint: x0 = -6 * 5.5 / 56 and |dz| = 1 / sqrt(1 + (5.5 / 56)^2)', close(x0, -6 * 5.5 / 56, 1e-12) && close(Math.abs(ray.dz), 1 / Math.sqrt(1 + (5.5 / 56) ** 2), 1e-12), [x0, ray.dz]);
  ok('checkpoint: the disc is hit exactly on [lo, hi]', hitQ(ray, x0 - w + 1e-6, 1) && hitQ(ray, x0 + w - 1e-6, 1) && !hitQ(ray, x0 - w - 1e-6, 1) && !hitQ(ray, x0 + w + 1e-6, 1));
  const r2 = FL.pixelRay(cam, 38.5), x02 = r2.ox - r2.oz * r2.dx / r2.dz; facts.ck_step = Math.abs(x02 - x0);
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
