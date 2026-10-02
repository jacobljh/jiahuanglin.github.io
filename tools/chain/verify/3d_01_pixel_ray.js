#!/usr/bin/env node
/* Oracle for 3D lesson 01, "A pixel is a ray".
 *
 * Re-derives every number the lesson quotes from the closed-form algebra of the lesson (u_B = u_A - f b / Z for a
 * slide, u_B = W/2 + f tan(phi - theta) for a turn), WITHOUT calling FL.project / FL.backproject, then
 *   (1) checks the engine's projective geometry (what the widget calls) against those formulas,
 *   (2) drives the page's own widget into each state the prose describes and checks that what it prints equals the
 *       independent number.
 * Prints {"facts": {...}} as its last line; the validator checks every <span data-n="key"> in the page against it.
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

const F = 44, W = 120, SS = 4, FAR = 40;
const SC = FL.scenes.street();
const A = FL.camera({ x: 0, z: 0, a: Math.PI / 2, f: F, W: W });

/* ── 1. the pixel-width table ── */
for (const [w, Z] of [[1, 2.5], [2, 5], [4, 10]]) ok('width on the sensor', close(F * w / Z, 17.6));
facts.size_px = F * 1 / 2.5;

/* ── 2. parallax of a slide: engine geometry == f b / Z, for 300 random points and several baselines ── */
{
  const rng = FL.rng(5);
  let worst = 0;
  for (let n = 0; n < 300; n++) {
    const b = 0.05 + 1.2 * rng();
    const p = { x: -4 + 8 * rng(), z: 1 + 12 * rng() };
    const B = FL.moved(A, b, 0, 0);
    const pa = FL.project(A, p.x, p.z), pb = FL.project(B, p.x, p.z);
    worst = Math.max(worst, Math.abs((pa.u - pb.u) - F * b / pa.zc), Math.abs(pa.zc - pb.zc));
  }
  ok('slide parallax f b / Z (engine vs formula)', worst < 1e-9, worst);
}
const b05 = 0.5;
facts.shift_z25 = F * b05 / 2.5; facts.shift_z5 = F * b05 / 5; facts.shift_z10 = F * b05 / 10; facts.shift_z40 = F * b05 / 40;

/* ── 3. a turn: u_B = W/2 + f tan(phi - theta), independent of depth ── */
{
  let worst = 0;
  for (const deg of [1, 5, 12]) {
    const th = deg * Math.PI / 180, B = FL.moved(A, 0, 0, -th);
    for (let u = 3; u < W; u += 7) for (const Z of [1.5, 4, 30]) {
      const P = FL.backproject(A, u, Z), q = FL.project(B, P.x, P.z).u;
      const phi = Math.atan((u - W / 2) / F);
      worst = Math.max(worst, Math.abs(q - (W / 2 + F * Math.tan(phi - th))));
    }
  }
  ok('turn formula, any depth', worst < 1e-9, worst);
}
facts.turn5_c = F * Math.tan(5 * Math.PI / 180);

/* ── 4. an independent implementation of the exam, built from the closed forms ── */
function photo(cam) {
  const img = FL.render(SC, cam);
  for (let i = 0; i < cam.W; i++) {
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < SS; k++) {
      const ray = FL.pixelRay(cam, i + (k + 0.5) / SS), h = FL.raycast(SC, ray.ox, ray.oz, ray.dx, ray.dz, SC.far);
      const c = h.hit ? FL.shade(SC, h, ray, {}) : SC.bg;
      r += c[0]; g += c[1]; b += c[2];
    }
    img.r[i] = r / SS; img.g[i] = g / SS; img.b[i] = b / SS;
  }
  return img;
}
const IMG_A = photo(A);
/* where does edge `u` of A's pixel (at depth Z) land in B, and how deep is it there?  closed forms only */
function land(u, Z, mode, amount) {
  if (mode === 'slide') return { u: u - F * amount / Z, z: Z };
  const th = amount, X = (u - W / 2) / F * Z;
  const Xb = X * Math.cos(th) - Z * Math.sin(th), Zb = X * Math.sin(th) + Z * Math.cos(th);
  return { u: W / 2 + F * Xb / Zb, z: Zb };
}
function exam(b, mode, depthMode, Z0) {
  const amount = mode === 'slide' ? b : b * 10 * Math.PI / 180;
  const camB = mode === 'slide' ? FL.moved(A, b, 0, 0) : FL.moved(A, 0, 0, -amount);
  const truth = photo(camB);
  const iv = [];
  for (let i = 0; i < W; i++) {
    const Z = depthMode === 'true' ? (IMG_A.depth[i] > 0 ? IMG_A.depth[i] : FAR) : Z0;
    const p = land(i, Z, mode, amount), q = land(i + 1, Z, mode, amount);
    iv.push({ lo: Math.min(p.u, q.u), hi: Math.max(p.u, q.u), z: (p.z + q.z) / 2, i });
  }
  /* for every sub-sample centre, scan ALL pixels and keep the nearest that covers it (a different loop order from the page) */
  const cov = new Float64Array(W), col = [new Float64Array(W), new Float64Array(W), new Float64Array(W)];
  for (let s = 0; s < W * SS; s++) {
    const c = (s + 0.5) / SS;
    let best = null;
    for (const v of iv) if (c >= v.lo && c <= v.hi && (best === null || v.z < best.z)) best = v;
    if (best) {
      const j = Math.floor(s / SS);
      cov[j] += 1 / SS; col[0][j] += IMG_A.r[best.i] / SS; col[1][j] += IMG_A.g[best.i] / SS; col[2][j] += IMG_A.b[best.i] / SS;
    }
  }
  let se = 0, cw = 0, un = 0;
  for (let j = 0; j < W; j++) {
    un += 1 - cov[j];
    if (cov[j] > 1e-12) {
      const r = col[0][j] / cov[j], g = col[1][j] / cov[j], bb = col[2][j] / cov[j];
      se += cov[j] * ((r - truth.r[j]) ** 2 + (g - truth.g[j]) ** 2 + (bb - truth.b[j]) ** 2) / 3; cw += cov[j];
    }
  }
  return { psnr: se > 1e-12 * cw ? -10 * Math.log10(se / cw) : 99, unseen: 100 * un / W };
}

/* ── 5. drive the widget into each state the prose describes; it must print what the independent exam computes ── */
const page = loadPage(path.join(DIR, '01_pixel_is_a_ray.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function state(b, move, dep, z0) {
  page.set('w01-move', move); page.set('w01-dep', dep); page.set('w01-z0', z0); page.set('w01-b', b);
  return { acc: page.num('w01-acc'), un: page.num('w01-un'), s: [page.num('w01-s0'), page.num('w01-s1'), page.num('w01-s2')] };
}
function same(label, mine, w) {
  ok(label + ' accuracy', close(mine.psnr, w.acc, 0.051), `oracle ${mine.psnr.toFixed(3)} vs widget ${w.acc}`);
  ok(label + ' unseen', close(mine.unseen, w.un, 0.051), `oracle ${mine.unseen.toFixed(3)} vs widget ${w.un}`);
}

// the opening state: slide, b = 0.5, one guessed depth 6 m
{
  const w = state(0.5, 'slide', 'guess', 6), e = exam(0.5, 'slide', 'guess', 6);
  same('guess Z0=6', e, w);
  facts.acc_g6 = e.psnr; facts.un_g6 = e.unseen;
  // the three shifts: f b / Z at the depth the camera actually sees at the middle of each object
  const mids = [0, 1, 2].map(id => { const idx = []; for (let i = 0; i < W; i++) if (IMG_A.id[i] === id) idx.push(i); return idx[Math.floor(idx.length / 2)]; });
  mids.forEach((i0, k) => {
    const Z = IMG_A.depth[i0], d = F * 0.5 / Z;
    ok('shift readout ' + k, close(d, w.s[k], 0.051), `${d} vs ${w.s[k]}`);
    facts[['obs_crate', 'obs_ball', 'obs_tower'][k]] = d;
  });
}
// the best single guess
{
  let best = -1, bz = 0;
  for (let z = 1.5; z <= 14.0001; z += 0.1) { const e = exam(0.5, 'slide', 'guess', z); if (e.psnr > best) { best = e.psnr; bz = z; } }
  facts.acc_g_best = best; facts.best_z0 = bz;
  const w = state(0.5, 'slide', 'guess', Math.round(bz * 10) / 10);
  ok('best-guess accuracy matches the widget', close(w.acc, best, 0.051), `${best} vs ${w.acc}`);
}
// true depths at b = 0.5, and the sweep over the baseline
{
  const w = state(0.5, 'slide', 'true', 6), e = exam(0.5, 'slide', 'true', 6);
  same('true depth b=0.5', e, w);
  facts.acc_t5 = e.psnr; facts.un_t5 = e.unseen;
  let lo = 1e9, hi = -1e9;
  for (let b = 0.1; b <= 1.2001; b += 0.05) { const x = exam(b, 'slide', 'true', 6).psnr; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  facts.acc_t_lo = lo; facts.acc_t_hi = hi;
  const w2 = state(1.2, 'slide', 'true', 6); same('true depth b=1.2', exam(1.2, 'slide', 'true', 6), w2);
}
// the crate's hole: f b (1/Zn - 1/Zf), Zn = front face of the crate
{
  const Zn = 3 - 0.55, strip = F * 0.5 * (1 / Zn - 1 / FAR);
  facts.strip_crate = strip;
  // compare with the engine: the crate's front-face pixel shift minus the background's
  const i0 = (() => { for (let i = 0; i < W; i++) if (IMG_A.id[i] === 0) return i; })();
  ok('crate front face depth', close(IMG_A.depth[i0], Zn, 2e-3), IMG_A.depth[i0]);
}
// a turn: accuracy independent of the depth used; the readouts
{
  const eTrue = exam(0.5, 'turn', 'true', 6), eG1 = exam(0.5, 'turn', 'guess', 1.5), eG2 = exam(0.5, 'turn', 'guess', 14);
  ok('turn: accuracy does not depend on depth', close(eTrue.psnr, eG1.psnr, 1e-6) && close(eTrue.psnr, eG2.psnr, 1e-6), [eTrue.psnr, eG1.psnr, eG2.psnr]);
  const w = state(0.5, 'turn', 'guess', 6); same('turn 5deg (guess)', eG1, w);
  const w2 = state(0.5, 'turn', 'true', 6); same('turn 5deg (true)', eTrue, w2);
  facts.acc_turn = eTrue.psnr;
  const th = 5 * Math.PI / 180;
  const mids = [0, 1, 2].map(id => { const idx = []; for (let i = 0; i < W; i++) if (IMG_A.id[i] === id) idx.push(i); return idx[Math.floor(idx.length / 2)]; });
  mids.forEach((i0, k) => {
    const u = i0 + 0.0;   // the widget measures the shift of the world point seen at the middle pixel's CENTRE ray, so use the engine's hit point
    const px = IMG_A.hx[i0], pz = IMG_A.hz[i0];
    const ua = FL.project(A, px, pz).u, phi = Math.atan((ua - W / 2) / F), d = ua - (W / 2 + F * Math.tan(phi - th));
    ok('turn shift readout ' + k, close(d, w.s[k], 0.051), `${d} vs ${w.s[k]}`);
    facts[['turn_crate', 'turn_ball', 'turn_tower'][k]] = d;
    void u;
  });
}
// the half-pixel experiment of "Where this points next"
{
  const zOf = d => F * 0.5 / d;
  const dC = F * 0.5 / 2.5, dT = F * 0.5 / 10;
  facts.ex_crate_lo = zOf(dC + 0.5); facts.ex_crate_hi = zOf(dC - 0.5);
  facts.ex_tower_lo = zOf(dT + 0.5); facts.ex_tower_hi = zOf(dT - 0.5);
  // the same thing by brute force: triangulate with the engine after moving the matched pixel by half a pixel
  const B = FL.moved(A, 0.5, 0, 0);
  for (const [Z, lo, hi] of [[2.5, facts.ex_crate_lo, facts.ex_crate_hi], [10, facts.ex_tower_lo, facts.ex_tower_hi]]) {
    const p = { x: 0.3, z: Z }, uA = FL.project(A, p.x, p.z).u, uB = FL.project(B, p.x, p.z).u;
    const tri1 = FL.triangulate(A, uA, B, uB - 0.5), tri2 = FL.triangulate(A, uA, B, uB + 0.5);
    ok('half-pixel triangulation', close(tri1.zc, lo, 1e-6) && close(tri2.zc, hi, 1e-6), [tri1.zc, lo, tri2.zc, hi]);
  }
}
// the checkpoint
facts.ck_post = F * 0.2 / 4; facts.ck_post2 = F * 0.2 / 2;

ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
