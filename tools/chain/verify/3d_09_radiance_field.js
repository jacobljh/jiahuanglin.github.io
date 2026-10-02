#!/usr/bin/env node
/* Oracle for 3D lesson 09, "Radiance fields: a scene as a function".
 *
 * Independent pieces
 *   (a) a second implementation of the lesson's loop, written without FL.vol.Field and FL.vol.composite (transmittance as exp(-optical depth), the
 *       backward pass as an O(n^2) sum over the samples behind, its own box clipping and bilinear weights): its 150-step run must equal the engine's;
 *   (b) the analytic gradient against central finite differences of that second implementation's loss;
 *   (c) the interpolation-error law of a grid, by brute force over phases; the billboard class, by compositing; a tiny network with its own
 *       back-propagation (checked against finite differences) for the frequency experiment;
 *   (d) importance sampling written again (bisection on the cumulative weights) and compared with the private engine's;
 *   (e) every other number the prose quotes, from the engine's runs (views sweep, resolution sweep, shuffled photographs, cost arithmetic);
 *   (f) the page's widget, driven into each state "What to try" describes: what it prints must equal the independent number.
 * Prints {"facts": {...}} as its last stdout line; the validator checks every <span data-n="key"> in the page against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const N9 = require(path.join(DIR, 'l09_nerf.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const log = (...a) => console.error(...a);
const PI = Math.PI;

const W = 64, NS = 48, BOX = 3.4, F0 = 56;
const world = N9.world(), SC = world.sc, BG = SC.bg;
const bgPSNR = (() => { let s = 0; world.held.forEach((c, k) => { const im = { W, r: new Float32Array(W).fill(BG[0]), g: new Float32Array(W).fill(BG[1]), b: new Float32Array(W).fill(BG[2]) }; s += FL.psnr(world.heldImg[k], im); }); return s / world.held.length; })();

/* ───────────────────────── 1. counts ───────────────────────── */
facts.unk = 40 * 40 * 4; facts.unk64 = 64 * 64; facts.h_node = 2 * BOX / 39; facts.pix_foot = 6 / F0;
facts.rays12 = 12 * W; facts.spr = NS; facts.smp12 = 12 * W * NS; facts.tab12 = 12 * W * NS * 4;
facts.obs3 = 3 * W * 3; facts.gap3 = facts.unk - facts.obs3; facts.obs12 = 12 * W * 3;
facts.fov = 2 * Math.atan(W / 2 / F0) * 180 / PI;

/* ───────────────────────── 2. a second implementation of the loop ───────────────────────── */
const softplus = x => (x > 30 ? x : Math.log1p(Math.exp(x))), sigm = x => 1 / (1 + Math.exp(-x));
function newRef(N, s0) { return { N, s: new Float64Array(N * N).fill(s0 === undefined ? -5 : s0), c: new Float64Array(3 * N * N), ms: new Float64Array(N * N), vs: new Float64Array(N * N), mc: new Float64Array(3 * N * N), vc: new Float64Array(3 * N * N), t: 0 }; }
function stencil(N, x, z) {
  let gx = (x + BOX) / (2 * BOX) * (N - 1), gz = (z + BOX) / (2 * BOX) * (N - 1);
  gx = Math.min(Math.max(gx, 0), N - 1); gz = Math.min(Math.max(gz, 0), N - 1);
  const i0 = Math.min(Math.floor(gx), N - 2), j0 = Math.min(Math.floor(gz), N - 2), fx = gx - i0, fz = gz - j0;
  return [[j0 * N + i0, (1 - fx) * (1 - fz)], [j0 * N + i0 + 1, fx * (1 - fz)], [(j0 + 1) * N + i0, (1 - fx) * fz], [(j0 + 1) * N + i0 + 1, fx * fz]];
}
function span(r) {                       // clip the ray to the box one axis at a time
  let lo = 0, hi = Infinity;
  for (const [o, d] of [[r.ox, r.dx], [r.oz, r.dz]]) {
    if (Math.abs(d) < 1e-12) { if (o < -BOX || o > BOX) return null; continue; }
    const a = (-BOX - o) / d, b = (BOX - o) / d; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
  }
  return lo < hi ? [lo, hi] : null;
}
/* one ray, samples at distances ts, each standing for [lo_k, hi_k]: optical depth as a running sum, T = exp(-depth), w_k = T_k (1 - exp(-sigma_k delta_k)) */
function march(R, r, ts, seg) {
  const n = ts.length, st = [], sraw = [], sig = [], col = [];
  for (let m = 0; m < n; m++) {
    const sq = stencil(R.N, r.ox + r.dx * ts[m], r.oz + r.dz * ts[m]); let s = 0; const c = [0, 0, 0];
    for (const [id, w] of sq) { s += w * R.s[id]; for (let q = 0; q < 3; q++) c[q] += w * R.c[3 * id + q]; }
    st.push(sq); sraw.push(s); sig.push(softplus(s)); col.push(c.map(sigm));
  }
  const dl = seg.map(([a, b]) => b - a), cum = [0]; for (let m = 0; m < n; m++) cum.push(cum[m] + sig[m] * dl[m]);
  const T = cum.map(v => Math.exp(-v)), w = sig.map((s, m) => T[m] * (1 - Math.exp(-s * dl[m])));
  const C = [0, 0, 0]; for (let q = 0; q < 3; q++) { for (let m = 0; m < n; m++) C[q] += w[m] * col[m][q]; C[q] += T[n] * BG[q]; }
  return { n, st, sraw, sig, col, dl, T, w, C };
}
function evenSamples(sp, n, u) { const dt = (sp[1] - sp[0]) / n, ts = [], seg = []; for (let m = 0; m < n; m++) { ts.push(sp[0] + (m + (u ? u[m] : 0.5)) * dt); seg.push([sp[0] + m * dt, sp[0] + (m + 1) * dt]); } return { ts, seg }; }
function trainRef(views, N, steps) {
  const R = newRef(N), gS = new Float64Array(N * N), gC = new Float64Array(3 * N * N), u = new Array(NS);
  let P = 0; for (const v of views) P += v.cam.W; const wgt = 1 / (3 * P);
  for (let t = 0; t < steps; t++) {
    const rng = FL.rng(3 + R.t * 7919); gS.fill(0); gC.fill(0);
    for (const v of views) for (let i = 0; i < v.cam.W; i++) {
      const r = FL.pixelRay(v.cam, i + 0.5), sp = span(r); if (!sp) continue;
      for (let m = 0; m < NS; m++) u[m] = rng();
      const { ts, seg } = evenSamples(sp, NS, u), f = march(R, r, ts, seg), gt = [v.img.r[i], v.img.g[i], v.img.b[i]], dL = f.C.map((c, q) => 2 * (c - gt[q]) * wgt);
      for (let k = 0; k < NS; k++) {
        let ds = 0;
        for (let q = 0; q < 3; q++) {                // dC/dsigma_k = delta_k (T_{k+1} c_k - sum_{i>k} w_i c_i - T_end bg)
          let hide = f.T[NS] * BG[q]; for (let j = k + 1; j < NS; j++) hide += f.w[j] * f.col[j][q];
          ds += dL[q] * f.dl[k] * (f.T[k + 1] * f.col[k][q] - hide);
        }
        ds *= sigm(f.sraw[k]);
        for (const [id, w] of f.st[k]) { gS[id] += w * ds; for (let q = 0; q < 3; q++) gC[3 * id + q] += w * dL[q] * f.w[k] * f.col[k][q] * (1 - f.col[k][q]); }
      }
    }
    R.t++; const b1 = 0.9, b2 = 0.999, c1 = 1 - Math.pow(b1, R.t), c2 = 1 - Math.pow(b2, R.t), lr = 0.15;
    for (let k = 0; k < R.s.length; k++) { R.ms[k] = b1 * R.ms[k] + (1 - b1) * gS[k]; R.vs[k] = b2 * R.vs[k] + (1 - b2) * gS[k] * gS[k]; R.s[k] -= lr * (R.ms[k] / c1) / (Math.sqrt(R.vs[k] / c2) + 1e-8); }
    for (let k = 0; k < R.c.length; k++) { R.mc[k] = b1 * R.mc[k] + (1 - b1) * gC[k]; R.vc[k] = b2 * R.vc[k] + (1 - b2) * gC[k] * gC[k]; R.c[k] -= lr * (R.mc[k] / c1) / (Math.sqrt(R.vc[k] / c2) + 1e-8); }
  }
  return R;
}
function psnrRef(R, cams, imgs, renderRay) {         // exam score by the reference renderer: mean over cameras of -10 log10(mse)
  let tot = 0;
  cams.forEach((cam, k) => {
    let se = 0;
    for (let i = 0; i < cam.W; i++) {
      const r = FL.pixelRay(cam, i + 0.5), sp = span(r), C = sp ? renderRay(R, r, sp) : BG;
      se += ((C[0] - imgs[k].r[i]) ** 2 + (C[1] - imgs[k].g[i]) ** 2 + (C[2] - imgs[k].b[i]) ** 2) / 3;
    }
    tot += -10 * Math.log10(se / cam.W);
  });
  return tot / cams.length;
}
const rayEven = (R, r, sp) => { const e = evenSamples(sp, NS); return march(R, r, e.ts, e.seg).C; };

/* ── (b) the analytic gradient against central finite differences of the second implementation ── */
{
  const F = new FL.vol.Field({ x0: -BOX, x1: BOX, z0: -BOX, z1: BOX, nx: 7, nz: 7, nsamp: 20, bg: BG, s0: -1 }), rng = FL.rng(5);
  for (let i = 0; i < F.s.length; i++) F.s[i] = -1 + 2 * rng();
  for (let i = 0; i < F.c.length; i++) F.c[i] = 2 * rng() - 1;
  const cams = FL.orbit(3, 6, 0, 0, { f: F0, W: 8, start: 0.13 }), views = cams.map(c => ({ cam: c, img: FL.render(SC, c) }));
  const P = views.reduce((a, v) => a + v.cam.W, 0), wgt = 1 / (3 * P);
  F.gS.fill(0); F.gC.fill(0);
  for (const v of views) for (let i = 0; i < v.cam.W; i++) { const r = FL.pixelRay(v.cam, i + 0.5); F.ray(r.ox, r.oz, r.dx, r.dz, null, [v.img.r[i], v.img.g[i], v.img.b[i]], wgt); }
  const gS = Float64Array.from(F.gS), gC = Float64Array.from(F.gC);
  const R = { N: 7, s: F.s, c: F.c };                       // the second implementation reads the same raw numbers
  const loss = () => { let L = 0; for (const v of views) for (let i = 0; i < v.cam.W; i++) { const r = FL.pixelRay(v.cam, i + 0.5), sp = span(r); if (!sp) continue; const e = evenSamples(sp, 20), C = march(R, r, e.ts, e.seg).C; L += wgt * ((C[0] - v.img.r[i]) ** 2 + (C[1] - v.img.g[i]) ** 2 + (C[2] - v.img.b[i]) ** 2); } return L; };
  let worstAbs = 0, gmax = 0, checked = 0;
  for (let k = 0; k < 49; k++) {
    const h = 1e-6;
    let p0 = R.s[k]; R.s[k] = p0 + h; let lp = loss(); R.s[k] = p0 - h; let lm = loss(); R.s[k] = p0;
    worstAbs = Math.max(worstAbs, Math.abs((lp - lm) / (2 * h) - gS[k])); gmax = Math.max(gmax, Math.abs(gS[k])); checked++;
    for (let q = 0; q < 3; q++) {
      const id = 3 * k + q; p0 = R.c[id]; R.c[id] = p0 + h; lp = loss(); R.c[id] = p0 - h; lm = loss(); R.c[id] = p0;
      worstAbs = Math.max(worstAbs, Math.abs((lp - lm) / (2 * h) - gC[id])); gmax = Math.max(gmax, Math.abs(gC[id])); checked++;
    }
  }
  const worst = worstAbs / gmax;
  ok('analytic gradient == central finite differences', worst < 1e-6 && checked === 196, [worst, checked]);
  facts.fd_err = worst; facts.fd_digits = -Math.log10(worst); facts.fd_checked = checked;
}

/* ── (a) the second implementation reproduces the engine's run (150 steps, 12 and 3 cameras) ── */
const RUN = {};                                           // engine runs, kept for the later facts
function engineRun(n, nodes, shuf, steps) { const S = N9.start(n, nodes, shuf); N9.train(S, steps); return S; }
{
  for (const n of [12, 3]) {
    const S = engineRun(n, 40, false, 150); RUN['r' + n] = S;
    const R = trainRef(S.views, 40, 150);
    let md = 0; for (let k = 0; k < 1600; k++) md = Math.max(md, Math.abs(R.s[k] - S.F.s[k]));
    const trR = psnrRef(R, S.cams, S.imgs, rayEven), hoR = psnrRef(R, world.held, world.heldImg, rayEven);
    ok(`second implementation == engine after 150 steps (${n} cameras): parameters`, md < 1e-8, md);
    ok(`second implementation == engine: train PSNR (${n})`, close(trR, S.tr, 1e-6), [trR, S.tr]);
    ok(`second implementation == engine: held-out PSNR (${n})`, close(hoR, S.ho, 1e-6), [hoR, S.ho]);
    if (n === 12) facts.ref_dpar = md;
    log('reference training equals the engine, n=' + n, md);
  }
}

/* ───────────────────────── 3. the main run: 12 data cameras, 40 x 40 nodes, 150 steps ───────────────────────── */
{
  const S = RUN.r12, S0 = N9.start(12, 40, false);
  facts.r0_tr = S0.tr; facts.r0_ho = S0.ho; facts.bg_ho = bgPSNR; facts.nn12 = S0.nearest;
  facts.r12_tr = S.tr; facts.r12_ho = S.ho; facts.r12_steps = S.steps; facts.r12_q = S.queries;
  facts.r12_empty = 100 * S.empty; facts.r12_ghost = 100 * S.ghost; facts.r12_h16 = S.h16; facts.r12_h88 = S.h88;
  ok('queries = steps x rays x samples', S.queries === 150 * 12 * W * NS, S.queries);
  ok('untrained field scores about the empty scene', Math.abs(S0.ho - bgPSNR) < 0.5, [S0.ho, bgPSNR]);
  // the curve: step 50 and the first checkpoint past the nearest stored photograph
  const at = k => S.curve.find(p => p[0] === k);
  facts.r12_tr50 = at(50)[1]; facts.r12_ho50 = at(50)[2];
  const pass = S.curve.find(p => p[2] > facts.nn12); facts.pass_step = pass[0];
  ok('the field passes the nearest-photograph baseline early', pass[0] <= 60, pass);
  // the same 150 steps taken as 50 + 100 give the same field (steps are sequential)
  const Sb = N9.start(12, 40, false); N9.train(Sb, 50); N9.train(Sb, 100);
  ok('50 + 100 steps == 150 steps', close(Sb.ho, S.ho, 1e-9) && close(Sb.tr, S.tr, 1e-9), [Sb.ho, S.ho]);
  // 300 steps
  N9.train(Sb, 150); facts.r12_tr300 = Sb.tr; facts.r12_ho300 = Sb.ho; facts.tr_gain300 = Sb.tr - S.tr; ok('300 steps improve the data fit and hardly move held-out', Sb.tr > S.tr + 1.5 && Math.abs(Sb.ho - S.ho) < 2, [Sb.tr, Sb.ho]);
  // the bill, recomputed with the second implementation: weights of the data rays at midpoint samples
  const R = { N: 40, s: S.F.s, c: S.F.c }; let tot = 0, low = 0;
  for (const v of S.views) for (let i = 0; i < W; i++) { const r = FL.pixelRay(v.cam, i + 0.5), sp = span(r); if (!sp) continue; const e = evenSamples(sp, NS), f = march(R, r, e.ts, e.seg); for (const w of f.w) { tot++; if (w < 1 / 255) low++; } }
  ok('empty share: second implementation == engine', close(100 * low / tot, facts.r12_empty, 1e-9), [100 * low / tot, facts.r12_empty]);
  ok('every data ray crosses the box', tot === 12 * W * NS, tot);
  // the samples below 1/255, itemised as lesson 10 itemises them: empty = their own opacity 1 - exp(-sigma delta) is below 1/255 (they stop nothing whatever light reaches them);
  // dimmed = the rest (visible on their own, but what stands in front of them leaves too little light)
  { let zero = 0, air = 0; const R2 = { N: 40, s: S.F.s, c: S.F.c };
    for (const v of S.views) for (let i = 0; i < W; i++) { const r = FL.pixelRay(v.cam, i + 0.5), sp = span(r); if (!sp) continue; const e = evenSamples(sp, NS), f = march(R2, r, e.ts, e.seg); let big = 0; f.w.forEach((w, k) => { if (1 - Math.exp(-f.sig[k] * f.dl[k]) < 1 / 255) air++; if (w >= 1 / 255) big++; }); if (!big) zero++; }
    facts.r12_air = 100 * air / tot; facts.r12_dim = facts.r12_empty - facts.r12_air; facts.r12_zero = zero; facts.r12_perray = (1 - S.empty) * NS;
    ok('most of the samples below 1/255 are empty space: their own opacity is below 1/255', facts.r12_air > 0.9 * facts.r12_empty && facts.r12_air <= facts.r12_empty, [facts.r12_air, facts.r12_empty]);
    ok('the rest are dimmed, and they are few', facts.r12_dim > 0 && facts.r12_dim < 0.1 * facts.r12_empty, [facts.r12_dim, facts.r12_empty]); }
  // ghost: brute force over nodes with explicit signed distance to each shape
  let all = 0, out = 0; const den = S.F.density();
  for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) { const x = -BOX + 2 * BOX * i / 39, z = -BOX + 2 * BOX * j / 39; let d = 1e9; for (const sh of SC.shapes) d = Math.min(d, FL.sdfShape(sh, x, z)); all += den[j * 40 + i]; if (d > 0.3) out += den[j * 40 + i]; }
  ok('ghost share: brute force == engine', close(out / all, S.ghost, 1e-12), [out / all, S.ghost]);
  ok('the field is mostly empty space and shell', facts.r12_empty > 70 && facts.r12_ghost < 15, [facts.r12_empty, facts.r12_ghost]);
}

/* ── the baseline photographs: the nearest stored photograph, by position (lesson 7's definition) ── */
function nearestRef(n) {
  const cams = N9.cams(n), imgs = cams.map(c => FL.render(SC, c)); let s = 0;
  world.held.forEach((hc, k) => { let b = 0, bd = 1e9; cams.forEach((c, j) => { const d = (c.x - hc.x) ** 2 + (c.z - hc.z) ** 2; if (d < bd) { bd = d; b = j; } }); s += FL.psnr(world.heldImg[k], imgs[b]); });
  return s / world.held.length;
}
ok('nearest stored photograph: engine helper == direct', close(nearestRef(12), facts.nn12, 1e-9));
ok('lesson 7 numbers: empty scene 4.6 dB, nearest stored photograph 14.0 dB', close(bgPSNR, 4.62, 0.01) && close(facts.nn12, 13.98, 0.01), [bgPSNR, facts.nn12]);
{ // the exact surface painted with one colour (the mean colour of the object pixels of the data), lesson 7's definition
  const MC = [0, 0, 0]; let nobj = 0;
  for (const v of RUN.r12.views) for (let i = 0; i < W; i++) if (Math.abs(v.img.r[i] - BG[0]) + Math.abs(v.img.g[i] - BG[1]) + Math.abs(v.img.b[i] - BG[2]) > 0.02) { MC[0] += v.img.r[i]; MC[1] += v.img.g[i]; MC[2] += v.img.b[i]; nobj++; }
  for (let q = 0; q < 3; q++) MC[q] /= nobj;
  let tot = 0;
  world.held.forEach((c, k) => { const img = world.heldImg[k]; let se = 0; for (let i = 0; i < W; i++) { const ry = FL.pixelRay(c, i + 0.5), h = FL.raycast(SC, ry.ox, ry.oz, ry.dx, ry.dz, SC.far), col = h.hit ? MC : BG; se += ((col[0] - img.r[i]) ** 2 + (col[1] - img.g[i]) ** 2 + (col[2] - img.b[i]) ** 2) / 3; } tot += -10 * Math.log10(se / W); });
  facts.ex_const = tot / world.held.length;
  ok('lesson 7: the exact surface in one colour scores 19.2 dB', close(facts.ex_const, 19.2, 0.05), facts.ex_const);
}
{ // lesson 7's top rung: the true surface, each point coloured by copying the pixel of the data camera that sees it best (smallest angle to the new camera)
  const TR = N9.cams(12), PT = RUN.r12.views.map(v => v.img);
  const copyCam = cam => {
    const out = { W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) };
    for (let i = 0; i < W; i++) {
      const ry = FL.pixelRay(cam, i + 0.5), h = FL.raycast(SC, ry.ox, ry.oz, ry.dx, ry.dz, SC.far); let c = BG;
      if (h.hit) {
        let best = null;
        for (let k = 0; k < TR.length; k++) {
          const tc = TR[k], q = FL.project(tc, h.x, h.z); if (q.zc <= 0 || q.u < 0 || q.u >= tc.W) continue;
          const dx = h.x - tc.x, dz = h.z - tc.z, dist = Math.hypot(dx, dz), rr = FL.raycast(SC, tc.x, tc.z, dx / dist, dz / dist, dist + 0.5);
          if (!rr.hit || Math.abs(rr.t - dist) > 0.03) continue;          // the data camera must see this very point
          const ax = cam.x - h.x, az = cam.z - h.z, bx = tc.x - h.x, bz = tc.z - h.z, ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz)))));
          if (best === null || ang < best.ang) best = { ang, k, i: Math.floor(q.u) };
        }
        c = best ? [PT[best.k].r[best.i], PT[best.k].g[best.i], PT[best.k].b[best.i]] : [0.5, 0.5, 0.5];
      }
      out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2];
    }
    return out;
  };
  let s = 0; world.held.forEach((c, k) => { s += FL.psnr(world.heldImg[k], copyCam(c)); });
  facts.lad_copy = s / world.held.length;
  ok('lesson 7: the true surface with colours copied from the data scores 34.6 dB', close(facts.lad_copy, 34.6, 0.05), facts.lad_copy);
}

/* ───────────────────────── 4. options for the function (section 1) ───────────────────────── */
facts.sig0 = softplus(-5);
{ // sample positions at the bin centres instead of random places in the bins
  const S = N9.start(12, 40, false);
  for (let t = 0; t < 150; t++) S.F.step(S.views, { lr: 0.15, jitter: false, seed: 3 });
  S.steps = 150; N9.measure(S); facts.nj_tr = S.tr; facts.nj_ho = S.ho;
  ok('fixed sample positions change little in this field', Math.abs(S.ho - RUN.r12.ho) < 1 && Math.abs(S.tr - RUN.r12.tr) < 1.5, [S.tr, S.ho]);
}
{
  const S = N9.start(12, 40, false);
  S.F._stencil = function (x, z, m, idx, wt) {                      // nearest node only: a table of independent cells
    const gx = (x - this.x0) / (this.x1 - this.x0) * (this.nx - 1), gz = (z - this.z0) / (this.z1 - this.z0) * (this.nz - 1), b = m * 4;
    const i = Math.max(0, Math.min(this.nx - 1, Math.round(gx))), j = Math.max(0, Math.min(this.nz - 1, Math.round(gz)));
    idx[b] = idx[b + 1] = idx[b + 2] = idx[b + 3] = j * this.nx + i; wt[b] = 1; wt[b + 1] = wt[b + 2] = wt[b + 3] = 0;
  };
  N9.train(S, 150);
  facts.nn_tr = S.tr; facts.nn_ho = S.ho; facts.bl_tr = RUN.r12.tr; facts.bl_ho = RUN.r12.ho;
  ok('cells without interpolation are worse than bilinear (both train and held-out)', facts.nn_tr < facts.bl_tr - 1 && facts.nn_ho < facts.bl_ho - 0.5, [facts.nn_tr, facts.nn_ho, facts.bl_tr, facts.bl_ho]);
}

/* ───────────────────────── 5. what the function may depend on (section 3) ───────────────────────── */
{
  // billboard class: for each pixel of each data camera, a thin sheet of optical thickness kappa on its own ray, coloured with that pixel, visible only to rays travelling in that direction
  const KAPPA = 6, views = RUN.r12.views; let tot = 0, mind = 1e9;
  for (const v of views) {
    let se = 0;
    for (let i = 0; i < W; i++) {
      const f = FL.vol.composite([KAPPA / 0.05], [[v.img.r[i], v.img.g[i], v.img.b[i]]], [0.05], BG), p = [v.img.r[i], v.img.g[i], v.img.b[i]];
      se += ((f.C[0] - p[0]) ** 2 + (f.C[1] - p[1]) ** 2 + (f.C[2] - p[2]) ** 2) / 3;
    }
    tot += -10 * Math.log10(se / W);
  }
  facts.free_tr = tot / views.length; facts.opq = 1 - Math.exp(-KAPPA);
  // a held-out ray is never a data ray: the smallest angle between any held-out pixel direction and any data pixel direction
  const dir = cam => { const o = []; for (let i = 0; i < W; i++) { const r = FL.pixelRay(cam, i + 0.5); o.push(Math.atan2(r.dz, r.dx)); } return o; };
  const dd = [].concat(...views.map(v => dir(v.cam))); for (const hc of world.held) for (const a of dir(hc)) for (const b of dd) mind = Math.min(mind, Math.abs(FL.se2.wrap(a - b)));
  ok('no held-out ray travels in the direction of a data ray (to the sheets\' tolerance of 1e-5 rad)', mind > 1e-5, mind);
  facts.free_ho = bgPSNR;
  ok('billboards reproduce the data to > 40 dB', facts.free_tr > 40, facts.free_tr);
  // the same pixels in a shuffled order: the billboards fit them just as well, a field shared by all rays does not
  for (const n of [3, 12, 24]) {
    const S = engineRun(n, 40, true, 150); facts['shuf' + n + '_tr'] = S.tr; facts['shuf' + n + '_ho'] = S.ho; RUN['s' + n] = S;
  }
  ok('shuffled pixels: the field memorises 3 cameras better than 12, and 12 better than 24', facts.shuf3_tr > facts.shuf12_tr + 3 && facts.shuf12_tr > facts.shuf24_tr, [facts.shuf3_tr, facts.shuf12_tr, facts.shuf24_tr]);
  ok('shuffled pixels at 12 cameras are fitted much worse than the real photographs', facts.shuf12_tr < facts.r12_tr - 8, [facts.shuf12_tr, facts.r12_tr]);
  { // the sheets fit the shuffled photographs exactly as well: the error is a mean over pixels, which does not depend on their order
    let tt = 0;
    for (const v of RUN.s12.views) {
      let se = 0;
      for (let i = 0; i < W; i++) { const p = [v.img.r[i], v.img.g[i], v.img.b[i]], f = FL.vol.composite([KAPPA / 0.05], [p], [0.05], BG); se += ((f.C[0] - p[0]) ** 2 + (f.C[1] - p[1]) ** 2 + (f.C[2] - p[2]) ** 2) / 3; }
      tt += -10 * Math.log10(se / W);
    }
    ok('the sheets fit the shuffled photographs exactly as well as the real ones', close(tt / RUN.s12.views.length, facts.free_tr, 1e-9), [tt / RUN.s12.views.length, facts.free_tr]);
  }
}

/* ───────────────────────── 5b. a node behind an opaque layer gets no signal (section 2) ───────────────────────── */
{
  // the bracket of lesson 8, delta_k ( T_{k+1} c_k - sum_{i>k} w_i c_i - T_N c_bg ), on a ray with an opaque sheet at sample 1, computed from exp() directly
  const sig = [0.5, 40, 3, 3], dl = [0.2, 0.2, 0.2, 0.2], col = [[0.9, 0.1, 0.1], [0.1, 0.8, 0.1], [0.2, 0.2, 0.9], [0.9, 0.9, 0.1]], bgc = [0.5, 0.5, 0.5], n = 4;
  const T = [1], w = [];
  for (let k = 0; k < n; k++) { const a = 1 - Math.exp(-sig[k] * dl[k]); w.push(T[k] * a); T.push(T[k] * (1 - a)); }
  const chan = (k, q) => { let s = T[k + 1] * col[k][q]; for (let i = k + 1; i < n; i++) s -= w[i] * col[i][q]; return dl[k] * (s - T[n] * bgc[q]); };
  const mag = k => Math.hypot(chan(k, 0), chan(k, 1), chan(k, 2));
  facts.hide_front = mag(0); facts.hide_behind = Math.max(mag(2), mag(3));
  ok('behind an opaque layer the bracket carries a factor T and vanishes; in front of it it does not', facts.hide_behind < 1e-3 * facts.hide_front, [facts.hide_front, facts.hide_behind]);
  const g = FL.vol.compositeGrad(Float64Array.from(sig), col, Float64Array.from(dl), bgc, [1, 1, 1]);
  for (let k = 0; k < n; k++) ok('the engine\'s dL/dsigma_k == the bracket written out (k = ' + k + ')', close(g.dsig[k], chan(k, 0) + chan(k, 1) + chan(k, 2), 1e-12), [g.dsig[k], chan(k, 0) + chan(k, 1) + chan(k, 2)]);
}

/* ───────────────────────── 6. the views sweep (section 5) ───────────────────────── */
{
  const NV = [2, 3, 4, 6, 8, 12, 16, 24], ho = [], gh = [], tr = [];
  for (const n of NV) {
    const S = n === 12 ? RUN.r12 : n === 3 ? RUN.r3 : engineRun(n, 40, false, 150);
    facts['sw' + n + '_tr'] = S.tr; facts['sw' + n + '_ho'] = S.ho; facts['sw' + n + '_gh'] = 100 * S.ghost; facts['sw' + n + '_nn'] = S.nearest; facts['sw' + n + '_em'] = 100 * S.empty;
    ho.push(S.ho); gh.push(S.ghost); tr.push(S.tr); log('views', n, 'train', S.tr.toFixed(2), 'held-out', S.ho.toFixed(2), 'ghost', (100 * S.ghost).toFixed(1), 'nearest', S.nearest.toFixed(2));
  }
  ok('held-out rises with the number of cameras (to within a dB of wobble)', ho.every((v, k) => k === 0 || v > ho[k - 1] - 0.3) && ho[7] > ho[1] + 10, ho);
  ok('train falls with the number of cameras', tr.every((v, k) => k === 0 || v < tr[k - 1] + 0.3) && tr[1] > tr[5] + 5, tr);
  ok('ghost density falls monotonically from 3 cameras up', gh.every((v, k) => k <= 1 || v < gh[k - 1]), gh);
  ok('with 3 cameras the field is worse than copying the nearest photograph; with 12 it is far better', facts.sw3_ho < facts.sw3_nn && facts.sw12_ho > facts.sw12_nn + 5, [facts.sw3_ho, facts.sw3_nn, facts.sw12_ho, facts.sw12_nn]);
  ok('with 12 cameras the field also passes lesson 7\'s exact surface in one colour (19.2 dB)', facts.sw12_ho > facts.ex_const + 0.5, [facts.sw12_ho, facts.ex_const]);
  facts.sw3_gap = facts.sw3_tr - facts.sw3_ho; facts.sw12_gap = facts.sw12_tr - facts.sw12_ho; facts.sw24_gap = facts.sw24_tr - facts.sw24_ho;
}

/* ───────────────────────── 7. resolution (section 4) ───────────────────────── */
{
  for (const N of [20, 40, 80]) {
    const S = N === 40 ? RUN.r12 : engineRun(12, N, false, 150);
    facts['res' + N + '_tr'] = S.tr; facts['res' + N + '_ho'] = S.ho; facts['res' + N + '_par'] = N * N * 4; log('nodes', N, S.tr.toFixed(2), S.ho.toFixed(2));
  }
  facts.res_gain = facts.res80_tr - facts.res40_tr; facts.res_loss = facts.res40_ho - facts.res80_ho;
  ok('a finer grid fits the data better', facts.res20_tr < facts.res40_tr && facts.res40_tr < facts.res80_tr, [facts.res20_tr, facts.res40_tr, facts.res80_tr]);
  ok('but held-out does not follow: best at 40', facts.res40_ho > facts.res20_ho && facts.res40_ho > facts.res80_ho, [facts.res20_ho, facts.res40_ho, facts.res80_ho]);
  // the interpolation law: worst case over phases of linear interpolation of A sin(2 pi x / P) on nodes h apart is A (1 - cos(pi h / P))
  const h = facts.h_node, rows = { ie_2: 2 * h, ie_ball: 2 * PI * 0.5 / 7, ie_5: 5 * h, ie_stat: 2 * PI * 1.15 / 5, ie_10: 10 * h, ie_20: 20 * h };
  for (const [k, P] of Object.entries(rows)) {
    let worst = 0;
    for (let ph = 0; ph < 360; ph++) {                       // brute force over the phase of the nodes against the wave
      const a = ph / 360 * Math.max(P, h); let e = 0;
      for (let q = 0; q <= 400; q++) { const x = a + h * q / 400, f = Math.sin(2 * PI * x / P), fa = Math.sin(2 * PI * a / P), fb = Math.sin(2 * PI * (a + h) / P), li = fa + (fb - fa) * q / 400; e = Math.max(e, Math.abs(f - li)); }
      worst = Math.max(worst, e);
    }
    const cf = 1 - Math.cos(PI * h / P);
    ok('interpolation error law ' + k, worst <= cf + 1e-6 && worst >= 0.97 * cf, [worst, cf]);
    facts[k] = 100 * cf; facts[k + '_ph'] = P / h;
  }
  facts.ball_period = 2 * PI * 0.5 / 7; facts.stat_period = 2 * PI * 1.15 / 5;
  ok('scene facts: the ball has 7 stripes on radius 0.5, the statue 5 on mean radius 1.15', SC.shapes[2].stripes === 7 && SC.shapes[2].r === 0.5 && SC.shapes[0].stripes === 5 && SC.shapes[0].r === 1.15);
}

/* ───────────────────────── 8. a tiny network and its input encoding (section 4) ───────────────────────── */
function gamma(p, L) { if (!L) return [p]; const o = []; for (let k = 0; k < L; k++) { const f = Math.pow(2, k) * PI; o.push(Math.sin(f * p), Math.cos(f * p)); } return o; }
const MLP = (() => {
  function init(din, hid, depth, seed) {
    const rng = FL.rng(seed), dims = [din]; for (let i = 0; i < depth; i++) dims.push(hid); dims.push(1);
    const Wt = [], B = [];
    for (let l = 0; l < dims.length - 1; l++) { const a = dims[l], b = dims[l + 1], s = Math.sqrt(2 / a), w = new Float64Array(a * b); for (let i = 0; i < w.length; i++) w[i] = s * FL.randn(rng); Wt.push(w); B.push(new Float64Array(b)); }
    return { dims, W: Wt, B };
  }
  function fwd(net, x) {
    const acts = [Float64Array.from(x)], nl = net.W.length;
    for (let l = 0; l < nl; l++) { const din = net.dims[l], dout = net.dims[l + 1], a = acts[l], o = new Float64Array(dout); for (let j = 0; j < dout; j++) { let s = net.B[l][j]; for (let i = 0; i < din; i++) s += net.W[l][j * din + i] * a[i]; o[j] = l < nl - 1 ? Math.max(0, s) : s; } acts.push(o); }
    return acts;
  }
  function lossGrad(net, X, Y) {
    const nl = net.W.length, gW = net.W.map(w => new Float64Array(w.length)), gB = net.B.map(b => new Float64Array(b.length)); let loss = 0;
    for (let n = 0; n < X.length; n++) {
      const acts = fwd(net, X[n]), e = acts[nl][0] - Y[n]; loss += e * e / X.length; let d = new Float64Array([2 * e / X.length]);
      for (let l = nl - 1; l >= 0; l--) {
        const din = net.dims[l], dout = net.dims[l + 1], dp = new Float64Array(din);
        for (let j = 0; j < dout; j++) { const dj = (l < nl - 1 && acts[l + 1][j] <= 0) ? 0 : d[j]; if (dj === 0) continue; gB[l][j] += dj; for (let i = 0; i < din; i++) { gW[l][j * din + i] += dj * acts[l][i]; dp[i] += dj * net.W[l][j * din + i]; } }
        d = dp;
      }
    }
    return { loss, gW, gB };
  }
  function adam(net, X, Y, steps, lr) {
    const nl = net.W.length, z = a => a.map(x => new Float64Array(x.length)), mW = z(net.W), vW = z(net.W), mB = z(net.B), vB = z(net.B);
    for (let s = 1; s <= steps; s++) {
      const g = lossGrad(net, X, Y), c1 = 1 - Math.pow(0.9, s), c2 = 1 - Math.pow(0.999, s);
      for (let l = 0; l < nl; l++) for (const [P, G, M, V] of [[net.W[l], g.gW[l], mW[l], vW[l]], [net.B[l], g.gB[l], mB[l], vB[l]]])
        for (let i = 0; i < P.length; i++) { M[i] = 0.9 * M[i] + 0.1 * G[i]; V[i] = 0.999 * V[i] + 0.001 * G[i] * G[i]; P[i] -= lr * (M[i] / c1) / (Math.sqrt(V[i] / c2) + 1e-8); }
    }
  }
  return { init, fwd, lossGrad, adam };
})();
const FREQ = [1, 2, 4, 8, 16], PHASE = [0.3, 1.1, 2.0, 0.7, 1.6];
const target = x => FREQ.reduce((s, f, i) => s + Math.sin(2 * PI * f * x + PHASE[i]) / FREQ.length, 0);
function component(fn, f) { let a = 0, b = 0; const M = 2048; for (let k = 0; k < M; k++) { const x = (k + 0.5) / M, v = fn(x); a += v * Math.sin(2 * PI * f * x) * 2 / M; b += v * Math.cos(2 * PI * f * x) * 2 / M; } return [a, b]; }
function mlpExperiment(L, hid, depth, steps, seed) {
  const X = [], Y = []; for (let i = 0; i < 256; i++) { const x = (i + 0.5) / 256; X.push(gamma(2 * x - 1, L)); Y.push(target(x)); }
  const net = MLP.init(X[0].length, hid, depth, seed); MLP.adam(net, X, Y, steps, 0.003);
  const fit = x => MLP.fwd(net, gamma(2 * x - 1, L))[net.W.length][0];
  const err = FREQ.map(f => { const a = component(fit, f), t = component(target, f); return Math.hypot(a[0] - t[0], a[1] - t[1]) / Math.hypot(t[0], t[1]); });
  let mse = 0; for (let i = 0; i < 256; i++) mse += (fit((i + 0.5) / 256) - Y[i]) ** 2 / 256;
  const pw = Y.reduce((a, y) => a + y * y, 0) / Y.length;
  return { err, mse, rms: 100 * Math.sqrt(mse / pw), params: net.W.reduce((a, w) => a + w.length, 0) + net.B.reduce((a, b) => a + b.length, 0) };
}
{
  // the network's back-propagation against finite differences
  const net = MLP.init(9, 6, 2, 3), X = [], Y = [], rng = FL.rng(2); for (let i = 0; i < 12; i++) { X.push(gamma(2 * rng() - 1, 4).concat([rng()]).slice(0, 9)); Y.push(rng() - 0.5); }
  const g = MLP.lossGrad(net, X, Y); let worst = 0;
  for (let l = 0; l < net.W.length; l++) for (let i = 0; i < net.W[l].length; i += 3) { const h = 1e-6, p0 = net.W[l][i]; net.W[l][i] = p0 + h; const lp = MLP.lossGrad(net, X, Y).loss; net.W[l][i] = p0 - h; const lm = MLP.lossGrad(net, X, Y).loss; net.W[l][i] = p0; const num = (lp - lm) / (2 * h); if (Math.abs(num) > 1e-8) worst = Math.max(worst, Math.abs(num - g.gW[l][i]) / (1e-6 + Math.abs(num))); }
  ok('tiny network: back-propagation == finite differences', worst < 1e-5, worst);
  const rows = [['raw', 0], ['g2', 2], ['g4', 4], ['g5', 5]];
  for (const [key, L] of rows) { const r = mlpExperiment(L, 32, 2, 1000, 5); for (let k = 0; k < 5; k++) facts[`mlp_${key}_e${FREQ[k]}`] = r.err[k]; facts[`mlp_${key}_mse`] = r.mse; facts[`mlp_${key}_rms`] = r.rms; facts[`mlp_${key}_par`] = r.params; log('mlp', key, r.err.map(v => v.toFixed(3)).join(' '), r.mse.toExponential(2)); }
  ok('raw coordinate: the slow components are held, the fast are not (monotone from 4 cycles up)', facts.mlp_raw_e1 < 0.2 && facts.mlp_raw_e8 > 0.35 && facts.mlp_raw_e16 > facts.mlp_raw_e8 - 0.05 && facts.mlp_raw_e16 > 0.5, [facts.mlp_raw_e1, facts.mlp_raw_e8, facts.mlp_raw_e16]);
  ok('encoded with L = 4: every component within 3%', [1, 2, 4, 8, 16].every(f => facts['mlp_g4_e' + f] < 0.03), [1, 2, 4, 8, 16].map(f => facts['mlp_g4_e' + f]));
  ok('L = 2 holds the components up to 8 cycles and starts to lose the 16-cycle one', facts.mlp_g2_e8 < 0.1 && facts.mlp_g2_e16 > facts.mlp_g4_e16, [facts.mlp_g2_e8, facts.mlp_g2_e16]);
  facts.mlp_ratio = facts.mlp_raw_mse / facts.mlp_g4_mse; facts.mlp_g4_max = 100 * Math.max(...[1, 2, 4, 8, 16].map(f => facts['mlp_g4_e' + f]));
  // robustness of the qualitative claim over network initialisations
  for (const seed of [1, 9]) {
    const a = mlpExperiment(0, 32, 2, 1000, seed), b = mlpExperiment(4, 32, 2, 1000, seed);
    ok('seed ' + seed + ': raw misses the fast components, L = 4 holds them', a.err[3] > 0.3 && a.err[4] > 0.5 && b.err.every(v => v < 0.05), [a.err, b.err]);
  }
  facts.gamma_dims_L10 = 2 * 10; facts.gamma_dims_L10_code = 2 * 10 + 1; facts.gamma3_L10 = 3 * 2 * 10; facts.gamma3_L10_code = 3 * 2 * 10 + 3; facts.gamma3_L4 = 3 * 2 * 4; facts.gamma3_L4_code = 3 * 2 * 4 + 3;
}

/* ───────────────────────── 9. where to put the samples (section 6) ───────────────────────── */
{
  const S = RUN.r12, R = { N: 40, s: S.F.s, c: S.F.c };
  // importance sampling written again: cumulative weights of the first pass, then bisection for each equal slice of probability
  function rayImportance(Rr, r, sp, nc, nf) {
    const e = evenSamples(sp, nc), f1 = march(Rr, r, e.ts, e.seg);
    if (!nf) return f1.C;
    const w = f1.w.map(x => x + 1e-5), tot = w.reduce((a, b) => a + b, 0), cdf = [0]; for (const x of w) cdf.push(cdf[cdf.length - 1] + x / tot);
    const dt = (sp[1] - sp[0]) / nc, ts = e.ts.slice();
    for (let j = 0; j < nf; j++) {
      const u = (j + 0.5) / nf; let lo = 0, hi = nc;                  // largest bin b with cdf[b] <= u
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] <= u) lo = mid; else hi = mid; }
      ts.push(sp[0] + (lo + (u - cdf[lo]) / (cdf[lo + 1] - cdf[lo])) * dt);
    }
    ts.sort((a, b) => a - b);
    const seg = ts.map((t, k) => [k === 0 ? sp[0] : 0.5 * (ts[k - 1] + t), k + 1 === ts.length ? sp[1] : 0.5 * (t + ts[k + 1])]);
    return march(Rr, r, ts, seg).C;
  }
  const tab = {};
  for (const [nc, nf] of [[16, 0], [24, 0], [32, 0], [48, 0], [8, 8], [12, 12], [16, 16]]) {
    const mine = psnrRef(R, world.held, world.heldImg, (Rr, r, sp) => rayImportance(Rr, r, sp, nc, nf)), eng = N9.heldAt(S.F, nc, nf);
    ok(`importance sampling ${nc}+${nf}: second implementation == engine`, close(mine, eng, 1e-6), [mine, eng]);
    tab[`${nc}_${nf}`] = mine;
  }
  ok('uniform 48 through the explicit-sample path == the engine renderer', close(tab['48_0'], S.ho, 1e-6), [tab['48_0'], S.ho]);
  facts.is_u16 = tab['16_0']; facts.is_u24 = tab['24_0']; facts.is_u32 = tab['32_0']; facts.is_u48 = tab['48_0']; facts.is_h88 = tab['8_8']; facts.is_h1212 = tab['12_12']; facts.is_h1616 = tab['16_16'];
  ok('the readouts of the run are these numbers', close(S.h16, facts.is_u16, 1e-6) && close(S.h88, facts.is_h88, 1e-6), [S.h16, facts.is_u16, S.h88, facts.is_h88]);
  ok('importance sampling at 16 samples matches uniform at 24 (within 0.15 dB) and beats uniform 16', Math.abs(facts.is_h88 - facts.is_u24) < 0.15 && facts.is_h88 > facts.is_u16 + 0.4, [facts.is_h88, facts.is_u24, facts.is_u16]);
  ok('16 + 16 importance samples are within 0.1 dB of 48 uniform', Math.abs(facts.is_h1616 - facts.is_u48) < 0.1, [facts.is_h1616, facts.is_u48]);
  facts.is_save = 1 - 16 / 24;
}

/* ───────────────────────── 10. the bill ───────────────────────── */
{
  facts.nerf_q_step = 4096 * 256; facts.nerf_q_lo = 4096 * 256 * 100000; facts.nerf_q_hi = 4096 * 256 * 300000; facts.nerf_q_img = 640000 * 256; facts.nerf_q_img_lo = 150e6; facts.nerf_q_img_hi = 200e6;
  facts.nerf_ratio_step = facts.nerf_q_step / facts.smp12; facts.nerf_lo11 = facts.nerf_q_lo / 1e11; facts.nerf_hi11 = facts.nerf_q_hi / 1e11;
  facts.nerf_hier = 64 + 128; facts.nerf_total = 64 + 192;
  facts.nerf_mb_ratio = 15000 / 5;
}

/* ───────────────────────── 11. the checkpoint ───────────────────────── */
{
  const sA = -1, sB = 2, tt = 0.25, g = -0.3, s = (1 - tt) * sA + tt * sB, sp = Math.log1p(Math.exp(s)), dsp = 1 / (1 + Math.exp(-s));
  facts.ck_s = s; facts.ck_sigma = sp; facts.ck_dsp = dsp; facts.ck_gA = g * dsp * (1 - tt); facts.ck_gB = g * dsp * tt; facts.ck_ratio = facts.ck_gB / facts.ck_gA;
  const loss = (a, b) => g * Math.log1p(Math.exp((1 - tt) * a + tt * b));  // the loss is linear in sigma with slope g, so dL/ds_A = g softplus'(s) (1 - tt)
  const h = 1e-6, nA = (loss(sA + h, sB) - loss(sA - h, sB)) / (2 * h), nB = (loss(sA, sB + h) - loss(sA, sB - h)) / (2 * h);
  ok('checkpoint: node gradients by finite differences', close(nA, facts.ck_gA, 1e-8) && close(nB, facts.ck_gB, 1e-8), [nA, facts.ck_gA, nB, facts.ck_gB]);
}

/* ───────────────────────── 12. the page's own widget ───────────────────────── */
let page = null;
const PAGE = path.join(DIR, '09_radiance_fields_nerf.html');
if (fs.existsSync(PAGE)) {
  page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const num = id => page.num(id);
  const state = (n, grid, data, hc) => { page.set('w09-grid', grid); page.set('w09-data', data); page.set('w09-hc', hc === undefined ? 17 : hc); page.set('w09-n', n); };
  // the opening state: 12 cameras, an untrained field
  state(12, '40', 'real');
  ok('opening: both scores are the empty field\'s', close(num('w09-tr'), facts.r0_tr, 0.051) && close(num('w09-ho'), facts.r0_ho, 0.051), [num('w09-tr'), facts.r0_tr, num('w09-ho'), facts.r0_ho]);
  ok('opening: steps 0', num('w09-st') === 0);
  // press train 50, then 50 + 50 more: must equal the engine's 50 and 150 steps
  page.click('w09-t50');
  ok('50 steps: train', close(num('w09-tr'), facts.r12_tr50, 0.051), [num('w09-tr'), facts.r12_tr50]);
  ok('50 steps: held-out', close(num('w09-ho'), facts.r12_ho50, 0.051), [num('w09-ho'), facts.r12_ho50]);
  page.click('w09-t50'); page.click('w09-t50');
  const same = (label, id, v, tol) => ok(label, close(num(id), v, tol), [num(id), v]);
  same('150 steps (3 x 50): train', 'w09-tr', facts.r12_tr, 0.051); same('150 steps: held-out', 'w09-ho', facts.r12_ho, 0.051); same('150 steps: steps', 'w09-st', 150, 0);
  same('150 steps: queries (millions)', 'w09-q', facts.r12_q / 1e6, 0.0051); same('150 steps: samples below 1/255', 'w09-em', facts.r12_empty, 0.051);
  same('150 steps: ghost density', 'w09-gh', facts.r12_ghost, 0.051); same('150 steps: held-out with 16 even samples', 'w09-h16', facts.r12_h16, 0.051); same('150 steps: held-out with 8 + 8', 'w09-h88', facts.r12_h88, 0.051);
  page.click('w09-t150');
  same('300 steps: train', 'w09-tr', facts.r12_tr300, 0.051); same('300 steps: held-out', 'w09-ho', facts.r12_ho300, 0.051); same('300 steps: steps', 'w09-st', 300, 0);
  // three cameras
  state(3, '40', 'real'); page.click('w09-t150');
  same('3 cameras: train', 'w09-tr', facts.sw3_tr, 0.051); same('3 cameras: held-out', 'w09-ho', facts.sw3_ho, 0.051); same('3 cameras: ghost', 'w09-gh', facts.sw3_gh, 0.051);
  // 24 cameras
  state(24, '40', 'real'); page.click('w09-t150');
  same('24 cameras: train', 'w09-tr', facts.sw24_tr, 0.051); same('24 cameras: held-out', 'w09-ho', facts.sw24_ho, 0.051);
  // shuffled
  state(3, '40', 'shuf'); page.click('w09-t150'); same('shuffled, 3 cameras: train', 'w09-tr', facts.shuf3_tr, 0.051);
  state(12, '40', 'shuf'); page.click('w09-t150'); same('shuffled, 12 cameras: train', 'w09-tr', facts.shuf12_tr, 0.051);
  // grids
  state(12, '20', 'real'); page.click('w09-t150'); same('20 nodes: train', 'w09-tr', facts.res20_tr, 0.051); same('20 nodes: held-out', 'w09-ho', facts.res20_ho, 0.051);
  state(12, '80', 'real'); page.click('w09-t150'); same('80 nodes: train', 'w09-tr', facts.res80_tr, 0.051); same('80 nodes: held-out', 'w09-ho', facts.res80_ho, 0.051);
  // reset returns to the empty field
  page.click('w09-reset'); same('reset: steps', 'w09-st', 0, 0);
  // the narrow layout draws without errors
  page.el('w09-canvas').clientWidth = 340; state(12, '40', 'real'); page.click('w09-t50'); page.set('w09-hc', 5); page.el('w09-canvas').clientWidth = 640;
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
}

/* ───────────────────────── done ───────────────────────── */
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
