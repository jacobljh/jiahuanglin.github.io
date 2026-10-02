#!/usr/bin/env node
/* Oracle for 3D lesson 10, "Speed: grids, hashes and Gaussian splats".
 *
 * Independent pieces
 *   (a) the bill of lesson 9's field, recomputed with a second implementation of the ray (its own bilinear weights, transmittance as exp(-optical depth));
 *       the area-against-volume law by brute force on the statue's own SDF (and on a 3-D sphere); the per-query arithmetic of a NeRF and of Instant-NGP's decoders;
 *   (b) the occupancy mask: the masked ray equals the shared engine's ray when nothing is masked (parameters identical after 150 steps);
 *   (c) the hash against a BigInt implementation of h(x) = (x1 pi1 xor x2 pi2) mod T; the hashed feature field's gradient against central differences;
 *       collisions counted over the occupied nodes with the real hash and compared with 1 - (1 - 1/T)^(M-1); the table of section 3 from runs of the engines;
 *   (d) the splat renderer rewritten from the lesson's equations (explicit 2x2 products, no shared code with FL.gs), the EWA projection against a numerical line
 *       integral of the Gaussian density along the pixel's ray, equality of the splat composite with lesson 8's composite, and the analytic gradient of FL.gs.grad
 *       against central finite differences of the rewritten loss;
 *   (e) every other number the prose quotes (budget sweep, growth against no growth and against random growth, few views, longer training, cost arithmetic from the
 *       sources the lesson cites);
 *   (f) the page's widget, driven into each state "What to try" describes: what it prints must equal the engine's own run.
 * Heavy runs can be cached while developing: L10_CACHE=/path/file.json (never set by the validator).
 * Prints {"facts": {...}} as its last stdout line; the validator checks every <span data-n="key"> in the page against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const N9 = require(path.join(DIR, 'l09_nerf.js'));
const H10 = require(path.join(DIR, 'l10_speed.js'));
const L10 = H10.L10;
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const PI = Math.PI;
const CACHE = process.env.L10_CACHE || null;
let cache = {};
if (CACHE && fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
function memo(key, f) {                    // development only: heavy, deterministic, JSON-able results
  if (CACHE && key in cache) return cache[key];
  const v = f();
  if (CACHE) { cache[key] = v; fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  return v;
}

const W = 64, NS = 48, BOX = 3.4, F0 = 56, EPS = 1 / 255;
const world = N9.world(), SC = world.sc, BG = SC.bg;
const BOXV = [-BOX, BOX, -BOX, BOX];
const sigmoid = x => 1 / (1 + Math.exp(-x)), softplus = x => (x > 30 ? x : Math.log1p(Math.exp(x)));

/* ───────────────────────── 1. the bill ───────────────────────── */
facts.rays12 = 12 * W; facts.spr = NS; facts.smp_step = 12 * W * NS; facts.smp_run = 150 * 12 * W * NS; facts.unk_grid = 40 * 40 * 4; facts.nodes_grid = 40 * 40;
const S12 = N9.start(12, 40, false); N9.train(S12, 150);                                // lesson 9's run, by its own engine
facts.d_tr = S12.tr; facts.d_ho = S12.ho; facts.share_w = 100 * S12.empty;
{
  // second implementation of the data rays' weights: its own bilinear interpolation, transmittance as exp(-optical depth)
  const F = S12.F, nx = 40, h = 2 * BOX / 39;
  const dens = (x, z) => {
    const gx = Math.min(Math.max((x + BOX) / h, 0), 39), gz = Math.min(Math.max((z + BOX) / h, 0), 39), i = Math.min(Math.floor(gx), 38), j = Math.min(Math.floor(gz), 38), fx = gx - i, fz = gz - j;
    const s = (1 - fx) * (1 - fz) * F.s[j * nx + i] + fx * (1 - fz) * F.s[j * nx + i + 1] + (1 - fx) * fz * F.s[(j + 1) * nx + i] + fx * fz * F.s[(j + 1) * nx + i + 1];
    return softplus(s);
  };
  let tot = 0, low = 0, empty = 0, hidden = 0;
  for (const v of S12.views) for (let i = 0; i < W; i++) {
    const r = FL.pixelRay(v.cam, i + 0.5);
    let lo = 0, hi = Infinity;
    for (const [o, d] of [[r.ox, r.dx], [r.oz, r.dz]]) { if (Math.abs(d) < 1e-12) continue; const a = (-BOX - o) / d, b = (BOX - o) / d; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
    const dt = (hi - lo) / NS; let depth = 0;
    for (let m = 0; m < NS; m++) {
      const t = lo + (m + 0.5) * dt, s = dens(r.ox + r.dx * t, r.oz + r.dz * t), T = Math.exp(-depth), a = 1 - Math.exp(-s * dt);
      tot++; if (T * a < EPS) low++; if (a < EPS) empty++; if (T < EPS) hidden++;
      depth += s * dt;
    }
  }
  ok('bill: second implementation == engine (share of samples with w < 1/255)', close(100 * low / tot, facts.share_w, 1e-9), [100 * low / tot, facts.share_w]);
  facts.share_empty = 100 * empty / tot; facts.share_hidden = 100 * hidden / tot; facts.share_dim = facts.share_w - facts.share_empty;
  ok('every sample with alpha < 1/255 is also below the weight line (so the dim share is the rest)', empty <= low && facts.share_dim > 0, [empty, low]);
  ok('bill: every data ray crosses the box', tot === facts.smp_step, tot);
}
facts.eps_grey = 255;
// the area-against-volume law, on the statue's own SDF: cells whose centre is within half a cell diagonal of the surface
function touchedFlat(N) {
  const h = 2 * BOX / N, out = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = -BOX + (i + 0.5) * h, z = -BOX + (j + 0.5) * h; if (Math.abs(FL.sdf(SC, x, z)) < h * Math.SQRT1_2) out.push([i, j]); }
  return out;
}
{
  const cs = [20, 39, 78, 156].map(N => ({ N, k: touchedFlat(N).length }));
  facts.touch39 = cs[1].k; facts.cells39 = 39 * 39; facts.touch39_pct = 100 * cs[1].k / (39 * 39);
  const c = cs.map(o => o.k / (o.N * o.N) * o.N); facts.touch_c = c.reduce((a, b) => a + b, 0) / c.length;
  ok('touched fraction x N is constant to 3% from N = 20 to 156', Math.max(...c) / Math.min(...c) < 1.03, c);
  facts.touch_n156 = cs[3].k; facts.touch_pct156 = 100 * cs[3].k / (156 * 156);
}
{
  const sph = N => { const r = 0.25 * N, c = N / 2, half = Math.sqrt(3) / 2; let k = 0; for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.sqrt((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 + (z + 0.5 - c) ** 2) - r; if (d > -half && d < half) k++; } return k; };
  const cs = memo('sph', () => [32, 64, 128, 256].map(N => sph(N) / N ** 3 * N));
  facts.sph_c32 = cs[0]; facts.sph_c64 = cs[1]; facts.sph_c128 = cs[2]; facts.sph_c256 = cs[3];
  facts.sph_lim = 4 * PI * Math.sqrt(3) / 16;                                      // shell volume 4 pi r^2 * sqrt(3) h, r = N/4 cells: fraction = 1.360 / N
  ok('sphere shell fraction x N rises towards 4 pi sqrt(3) / 16 (within 1% at N = 256)', cs.every((v, k) => k === 0 || v >= cs[k - 1]) && Math.abs(cs[3] / facts.sph_lim - 1) < 0.01, [cs, facts.sph_lim]);
  facts.sph_1024 = 1024 / facts.sph_lim; facts.cells1024 = 1024 ** 3; facts.air1024 = 100 * (1 - 1 / facts.sph_1024); facts.sph_pct128 = 100 * cs[2] / 128; facts.sph_cells128 = Math.round(cs[2] / 128 * 128 ** 3);
}
{   // arithmetic of one NeRF query (layers from the paper; encodings of 60 and 24 numbers, the paper's Eq. 4) and of Instant-NGP's two decoders
  const nerf = 60 * 256 + 3 * 256 * 256 + (256 + 60) * 256 + 3 * 256 * 256 + 256 * (1 + 256) + (256 + 24) * 128 + 128 * 3;
  facts.nerf_macs = nerf; facts.nerf_q_ray = 64 + 64 + 128; facts.nerf_macs_ray = 256 * nerf; facts.nerf_q_frame = 640000 * 256; facts.nerf_macs_frame = 640000 * 256 * nerf / 1e12;
  const ingp = 32 * 64 + 64 * 16 + 32 * 64 + 64 * 64 + 64 * 3;
  facts.ingp_macs = ingp; facts.ingp_reads = 16 * 8 * 2; facts.macs_ratio = nerf / ingp;
  facts.ingp_max_params = 2 ** 24 * 16 * 2; facts.ingp_fine_nodes = 2049 ** 3; facts.ingp_ratio = 2049 ** 3 / 2 ** 24;
}

/* ───────────────────────── 2. the occupancy mask ───────────────────────── */
function scoreOf(r, S) {
  let tr = 0, ho = 0;
  S.cams.forEach((c, k) => { tr += FL.psnr(S.imgs[k], r.renderCam(c)); });
  world.held.forEach((c, k) => { ho += FL.psnr(world.heldImg[k], r.renderCam(c)); });
  return { tr: tr / S.cams.length, ho: ho / world.held.length };
}
function trainMasked(opts) {            // lesson 9's run, with an occupancy mask: refreshed from the field every `every` steps from step `warm`, or supplied
  const S = N9.start(12, 40, false), F = H10.maskField(S.F);
  if (opts.T) H10.hashNodes(F, opts.T);
  if (opts.mask) F.mask = opts.mask;
  let workWarm = 0;
  for (let s = 0; s < 150; s++) {
    if (opts.tau !== undefined && s >= opts.warm && (s - opts.warm) % opts.every === 0 && (!opts.freeze || s === opts.warm)) F.mask = H10.occupancy(H10.fieldDensity(F), BOXV, 39, opts.tau);
    if (s === opts.warm) workWarm = F.work;
    F.step(S.views, { lr: N9.LR, jitter: true, seed: opts.seed || 3 }); S.steps++;
  }
  const work = F.work, r = scoreOf(F, S);
  return { work, workWarm, cells: F.mask ? F.mask.count : null, tr: r.tr, ho: r.ho };
}
{
  // identity: the masked ray with no mask is the shared engine's ray, bit for bit
  const A = N9.start(12, 40, false); N9.train(A, 150);
  const B = N9.start(12, 40, false); H10.maskField(B.F);
  for (let s = 0; s < 150; s++) B.F.step(B.views, { lr: N9.LR, jitter: true, seed: 3 });
  let md = 0; for (let k = 0; k < A.F.s.length; k++) md = Math.max(md, Math.abs(A.F.s[k] - B.F.s[k])); for (let k = 0; k < A.F.c.length; k++) md = Math.max(md, Math.abs(A.F.c[k] - B.F.c[k]));
  ok('masked ray with no mask == the shared engine after 150 steps', md === 0, md);
  facts.occ_identity = md;
  facts.haze = softplus(-5); facts.haze_path = softplus(-5) * 2 * BOX;
  // the learned mask: warm-up 32 steps with everything occupied, then refreshed every 16 steps; tau = 0.1 per metre
  const r = memo('occ', () => trainMasked({ tau: 0.1, warm: 32, every: 16 }));
  facts.occ_work = r.work; facts.occ_work_pct = 100 * r.work / facts.smp_run; facts.occ_cells = r.cells; facts.occ_cells_pct = 100 * r.cells / (39 * 39);
  facts.occ_step = (r.work - r.workWarm) / 118; facts.occ_step_pct = 100 * facts.occ_step / facts.smp_step; facts.occ_tr = r.tr; facts.occ_ho = r.ho;
  ok('the mask saves work and does not cost accuracy', facts.occ_work_pct < 50 && r.tr > facts.d_tr - 0.2 && r.ho > facts.d_ho - 0.2, [facts.occ_work_pct, r.tr, r.ho]);
  // a mask taken before anything has formed is empty; frozen, nothing can form (refreshed, the optimiser's momentum happens to carry the densities over the threshold)
  const e = memo('occ16f', () => trainMasked({ tau: 0.1, warm: 16, every: 16, freeze: true })), e2 = memo('occ16r', () => trainMasked({ tau: 0.1, warm: 16, every: 16 }));
  facts.occ16_cells = e.cells; facts.occ16_tr = e.tr; facts.occ16_ho = e.ho; facts.bg_ho = N9.emptyScene(); facts.occ16r_tr = e2.tr; facts.occ16r_ho = e2.ho; facts.occ16r_cells = e2.cells;
  ok('a mask frozen at step 16 is empty and the run never recovers', e.cells === 0 && e.tr < 6 && close(e.ho, facts.bg_ho, 0.5), [e.cells, e.tr, e.ho, facts.bg_ho]);
  ok('a mask refreshed from step 16 recovers (momentum), to within 0.5 dB of the warm-started run', e2.cells > 0 && e2.tr > facts.occ_tr - 0.5, [e2.cells, e2.tr, facts.occ_tr]);
  { const S0 = N9.start(12, 40, false); H10.maskField(S0.F); for (let s = 0; s < 16; s++) S0.F.step(S0.views, { lr: N9.LR, jitter: true, seed: 3 }); const dn = H10.fieldDensity(S0.F); let mx = 0; for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) mx = Math.max(mx, dn(-BOX + i * 2 * BOX / 39, -BOX + j * 2 * BOX / 39)); facts.occ16_maxd = mx; ok('at step 16 no node has reached 0.1 per metre', mx < 0.1, mx); }
  // the mask applied at render time to lesson 9's trained field
  const F = S12.F; H10.maskField(F);
  F.mask = H10.occupancy(H10.fieldDensity(F), BOXV, 39, 0.1);
  const rm = scoreOf(F, S12); facts.rt_dtr = rm.tr - facts.d_tr; facts.rt_dho = rm.ho - facts.d_ho; facts.rt_cells = F.mask.count; F.mask = null;
  facts.occ_kib = 128 ** 3 / 8 / 1024;
}

/* ───────────────────────── 3. the hash ───────────────────────── */
{
  // the hash against BigInt arithmetic
  const rng = FL.rng(9); let bad = 0;
  for (let n = 0; n < 20000; n++) {
    const i = Math.floor(rng() * 4096), j = Math.floor(rng() * 4096), T = 2 ** (4 + Math.floor(rng() * 20));
    const ref = Number((((BigInt(i) * 1n) ^ ((BigInt(j) * 2654435761n) & 0xFFFFFFFFn)) & 0xFFFFFFFFn) % BigInt(T));
    if (ref !== H10.hash(i, j, T)) bad++;
  }
  ok('hash == BigInt implementation of (x1 pi1 xor x2 pi2) mod T', bad === 0, bad);
  // the hashed field's gradient against central differences (tiny configuration)
  const sc = FL.scenes.statue(), cams = FL.orbit(3, 6, 0, 0, { f: 56, W: 8 }), views = cams.map(c => ({ cam: c, img: FL.render(sc, c) }));
  const G = new H10.HashField({ x0: -BOX, x1: BOX, z0: -BOX, z1: BOX, res: [4, 8, 16, 32], T: 64, F: 2, H: 8, nsamp: 20, bg: sc.bg, seed: 3 });
  const r2 = FL.rng(5); for (let k = 0; k < G.nParams; k++) G.p[k] += (r2() * 2 - 1) * 0.3; G.p[G.ob2] = -1;
  let Pn = 0; for (const v of views) Pn += v.cam.W; const wgt = 1 / (3 * Pn);
  const lossOnly = () => { let L = 0; for (const v of views) for (let i = 0; i < v.cam.W; i++) { const r = FL.pixelRay(v.cam, i + 0.5); L += G.ray(r.ox, r.oz, r.dx, r.dz, null, [v.img.r[i], v.img.g[i], v.img.b[i]], 0).err * wgt; } return L; };
  G.g.fill(0); for (const v of views) for (let i = 0; i < v.cam.W; i++) { const r = FL.pixelRay(v.cam, i + 0.5); G.ray(r.ox, r.oz, r.dx, r.dz, null, [v.img.r[i], v.img.g[i], v.img.b[i]], wgt); }
  const g = Float64Array.from(G.g); let worst = 0, gmax = 0; for (let k = 0; k < G.nParams; k++) gmax = Math.max(gmax, Math.abs(g[k]));
  for (let k = 0; k < G.nParams; k += 3) { const h = 1e-6, s0 = G.p[k]; G.p[k] = s0 + h; const lp = lossOnly(); G.p[k] = s0 - h; const lm = lossOnly(); G.p[k] = s0; worst = Math.max(worst, Math.abs((lp - lm) / (2 * h) - g[k]) / gmax); }
  ok('hashed field: analytic gradient == finite differences (relative to the largest component)', worst < 1e-4, worst);
  facts.hg_err = worst;
}
{
  // collisions among the occupied nodes with the real hash
  const N = 64, cells = touchedFlat(N), nodes = H10.nodesOfCells(cells, N), M = nodes.length;
  facts.occ_cells64 = cells.length; facts.occ_nodes64 = M; facts.nodes64 = 65 * 65;
  const share = (list, T) => { const m = new Map(); for (const [i, j] of list) { const s = H10.hash(i, j, T); m.set(s, (m.get(s) || 0) + 1); } let k = 0; for (const [i, j] of list) if (m.get(H10.hash(i, j, T)) > 1) k++; return 100 * k / list.length; };
  facts.col64_256 = share(nodes, 256); facts.col64_256_pred = 100 * (1 - Math.pow(1 - 1 / 256, M - 1));
  ok('collision share at T = 256 matches 1 - (1 - 1/T)^(M-1) to 3 points', close(facts.col64_256, facts.col64_256_pred, 3), [facts.col64_256, facts.col64_256_pred]);
  // pairs of occupied nodes that collide at the finest level, then also one level up (the parent node), then also two levels up
  const T = 256, hh = (i, j) => H10.hash(i, j, T); let c1 = 0, c2 = 0, c3 = 0, same = 0;
  for (let a = 0; a < M; a++) for (let b = a + 1; b < M; b++) {
    const [ia, ja] = nodes[a], [ib, jb] = nodes[b];
    if (hh(ia, ja) !== hh(ib, jb)) continue; c1++;
    if ((ia >> 1) === (ib >> 1) && (ja >> 1) === (jb >> 1)) { same++; continue; }
    if (hh(ia >> 1, ja >> 1) !== hh(ib >> 1, jb >> 1)) continue; c2++;
    if (((ia >> 2) === (ib >> 2) && (ja >> 2) === (jb >> 2)) || hh(ia >> 2, ja >> 2) === hh(ib >> 2, jb >> 2)) c3++;
  }
  facts.pairs_all = M * (M - 1) / 2; facts.pairs1 = c1; facts.pairs2 = c2; facts.pairs3 = c3; facts.pairs_pred1 = facts.pairs_all / T; facts.pairs2_indep = c1 / T;
  ok('no pair of occupied nodes collides at all three levels', c3 === 0, c3);
  ok('some pairs survive the second level and fewer the third', c2 > 0 && c2 < c1 && c3 <= c2 && same === 0, [c1, c2, c3, same]);
  ok('the levels are not independent hashes: far more pairs survive level two than c1 / T', c2 > 10 * c1 / T, [c2, c1 / T]);
  // the grid of lesson 9 (40 nodes a side = 39 cells): occupied nodes, empty nodes, and how many occupied nodes share their slot with an empty node, at T = 512
  const cells39 = touchedFlat(39), occ39 = H10.nodesOfCells(cells39, 39), set = new Set(occ39.map(([i, j]) => j * 40 + i));
  facts.occ_nodes39 = occ39.length; facts.empty_nodes39 = 1600 - occ39.length;
  const T5 = 512, slotOcc = new Map(), slotEmpty = new Set();
  for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) { const s = H10.hash(i, j, T5); if (set.has(j * 40 + i)) slotOcc.set(s, (slotOcc.get(s) || 0) + 1); else slotEmpty.add(s); }
  let withEmpty = 0, withOcc = 0; for (const [i, j] of occ39) { const s = H10.hash(i, j, T5); if (slotEmpty.has(s)) withEmpty++; if (slotOcc.get(s) > 1) withOcc++; }
  facts.share_empty512 = 100 * withEmpty / occ39.length; facts.share_occ512 = 100 * withOcc / occ39.length;
  facts.empty_per_slot512 = facts.empty_nodes39 / T5;
  ok('at T = 512 every occupied node of lesson 9\'s grid shares its slot with at least one empty node', facts.share_empty512 === 100, facts.share_empty512);
}
function idealMask(dil) {
  const N = 39, h = 2 * BOX / N, m = new Uint8Array(N * N); let k = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = -BOX + (i + 0.5) * h, z = -BOX + (j + 0.5) * h; if (Math.abs(FL.sdf(SC, x, z)) < h * (Math.SQRT1_2 + dil)) { m[j * N + i] = 1; k++; } }
  m.count = k; m.N = N; m.box = BOXV; return m;
}
{
  const rows = memo('rows', () => {
    const out = {};
    out.dm = trainMasked({ mask: idealMask(2) });
    out.h1 = trainMasked({ T: 512 });
    out.h1m = trainMasked({ T: 512, mask: idealMask(2) });
    out.h1s = [4, 5].map(sd => trainMasked({ T: 512, seed: sd }).tr);
    const S = N9.start(12, 40, false);
    const hf = seed => {
      const G = new H10.HashField({ x0: -BOX, x1: BOX, z0: -BOX, z1: BOX, res: [16, 32, 64], T: 256, F: 2, H: 16, nsamp: NS, bg: SC.bg, seed });
      for (let s = 0; s < 150; s++) G.step(S.views, { lr: 0.05, seed: 3 });
      const r = scoreOf(G, S); return { tr: r.tr, ho: r.ho, par: G.nParams, dense: G.dense.join(',') };
    };
    out.h3 = hf(11); out.h3s = [12, 13].map(sd => hf(sd).tr);
    return out;
  });
  facts.dm_tr = rows.dm.tr; facts.dm_ho = rows.dm.ho; facts.dm_cells = rows.dm.cells; facts.dm_work_pct = 100 * rows.dm.work / facts.smp_run;
  facts.h1_tr = rows.h1.tr; facts.h1_ho = rows.h1.ho; facts.h1m_tr = rows.h1m.tr; facts.h1m_ho = rows.h1m.ho;
  facts.h3_tr = rows.h3.tr; facts.h3_ho = rows.h3.ho; facts.h3_par = rows.h3.par; facts.h1_par = 4 * 512; facts.h3_entries = 3 * 256;
  ok('one hashed level without a mask collapses (all jitter seeds)', rows.h1.tr < 16 && rows.h1s.every(v => v < 16), [rows.h1.tr, rows.h1s]);
  ok('the same level with the idealised mask fits (within 3 dB of the unhashed masked field)', rows.h1m.tr > 17 && rows.h1m.tr > rows.dm.tr - 3.5, [rows.h1m.tr, rows.dm.tr]);
  facts.h3_lo = Math.min(rows.h3.tr, ...rows.h3s); facts.h3_hi = Math.max(rows.h3.tr, ...rows.h3s);
  ok('three hashed levels with a decoder stay above 22 dB for every initialisation (the one-level table is below 16)', facts.h3_lo > 22 && rows.h3.tr > facts.d_tr && rows.h3.dense === 'false,false,false', [rows.h3, rows.h3s]);
  facts.h3_gain = rows.h3.tr - rows.h1.tr; facts.h3_share = 100 * facts.h3_par / 6400;
}

/* ───────────────────────── 4. splats: projection and compositing ───────────────────────── */
const mul2 = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
const tr2 = A => [[A[0][0], A[1][0]], [A[0][1], A[1][1]]];
/* one Gaussian, one camera: image mean and variance from the lesson's formulas: Sigma = R diag(s1^2, s2^2) R^T, Sigma_cam = Q Sigma Q^T (Q: rows = right, forward), v = J Sigma_cam J^T */
function project(P, k, cam, dil) {
  const x = P[9 * k], z = P[9 * k + 1], s1 = Math.exp(P[9 * k + 2]), s2 = Math.exp(P[9 * k + 3]), th = P[9 * k + 4];
  const Rm = [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]], D = [[s1 * s1, 0], [0, s2 * s2]];
  const Sg = mul2(mul2(Rm, D), tr2(Rm));
  const fw = [Math.cos(cam.a), Math.sin(cam.a)], rt = [Math.sin(cam.a), -Math.cos(cam.a)], Q = [[rt[0], rt[1]], [fw[0], fw[1]]];
  const Sc = mul2(mul2(Q, Sg), tr2(Q)), xc = (x - cam.x) * rt[0] + (z - cam.z) * rt[1], zc = (x - cam.x) * fw[0] + (z - cam.z) * fw[1];
  const J = [cam.f / zc, -cam.f * xc / (zc * zc)];
  const v = J[0] * (Sc[0][0] * J[0] + Sc[0][1] * J[1]) + J[1] * (Sc[1][0] * J[0] + Sc[1][1] * J[1]) + dil;
  return { m: cam.W / 2 + cam.f * xc / zc, v, zc, xc };
}
/* the splat renderer, from the equations: sort by depth, alpha = o exp(-(u-m)^2 / 2v) (at most 0.99), C = sum T alpha c + T_end bg; pairs = contributions with alpha >= 1e-5 until T < 1e-4 */
function splatRender(S, cam) {
  const P = S.p, out = { W: cam.W, r: new Float64Array(cam.W), g: new Float64Array(cam.W), b: new Float64Array(cam.W), pairs: 0 }, items = [];
  for (let k = 0; k < S.K; k++) {
    const q = project(P, k, cam, S.dil); if (q.zc < 0.25) continue;
    items.push({ m: q.m, v: q.v, zc: q.zc, o: sigmoid(P[9 * k + 5]), c: [sigmoid(P[9 * k + 6]), sigmoid(P[9 * k + 7]), sigmoid(P[9 * k + 8])] });
  }
  items.sort((a, b) => a.zc - b.zc);
  for (let i = 0; i < cam.W; i++) {
    const u = i + 0.5; let T = 1, C = [0, 0, 0];
    for (const it of items) {
      const d = u - it.m; if (d * d > 24 * it.v) continue;
      const a = Math.min(0.99, it.o * Math.exp(-d * d / (2 * it.v))); if (a < 1e-5) continue;
      for (let q = 0; q < 3; q++) C[q] += T * a * it.c[q];
      out.pairs++; T *= 1 - a; if (T < 1e-4) break;
    }
    out.r[i] = C[0] + T * S.bg[0]; out.g[i] = C[1] + T * S.bg[1]; out.b[i] = C[2] + T * S.bg[2];
  }
  return out;
}
function randomSplats(K, seed) {
  const rng = FL.rng(seed), S = FL.gs.make(K); S.bg = [0.9, 0.92, 0.95];
  for (let k = 0; k < K; k++) {
    const a = 2 * PI * rng(), rad = 0.4 + 2.2 * rng(), b = k * 9;
    S.p[b] = rad * Math.cos(a); S.p[b + 1] = rad * Math.sin(a); S.p[b + 2] = Math.log(0.15 + 0.4 * rng()); S.p[b + 3] = Math.log(0.1 + 0.3 * rng()); S.p[b + 4] = PI * rng();
    S.p[b + 5] = -1.5 + 3 * rng(); for (let q = 6; q < 9; q++) S.p[b + q] = -2 + 4 * rng();
  }
  return S;
}
{
  // EWA against a numerical line integral of the Gaussian density along every pixel's ray
  const cam = FL.camera({ x: 0, z: 0, a: PI / 2, f: F0, W: W });
  function check(label, x, z, s1, s2, th) {
    const S = FL.gs.make(1); S.p[0] = x; S.p[1] = z; S.p[2] = Math.log(s1); S.p[3] = Math.log(s2); S.p[4] = th; S.dil = 0;
    const q = project(S.p, 0, cam, 0), e = FL.gs.geom(S, 0, cam);
    ok(label + ': rewritten projection == FL.gs.geom', close(q.m, e.m, 1e-9) && close(q.v, e.v, 1e-9), [q, e]);
    // exact: Phi(u) = integral over t of G(c + t d(u)) dt, G = exp(-1/2 (x - mu)^T Sigma^-1 (x - mu)), on a fine grid of u
    const c = Math.cos(th), s = Math.sin(th), a11 = c * c * s1 * s1 + s * s * s2 * s2, a12 = c * s * (s1 * s1 - s2 * s2), a22 = s * s * s1 * s1 + c * c * s2 * s2, det = a11 * a22 - a12 * a12;
    const i11 = a22 / det, i12 = -a12 / det, i22 = a11 / det, sd = Math.sqrt(q.v);
    let sw = 0, su = 0, suu = 0, peak = 0; const du = sd / 40, prof = [];
    for (let u = q.m - 7 * sd; u <= q.m + 7 * sd; u += du) {
      const r = FL.pixelRay(cam, u); let I = 0;
      for (let t = 0; t < 14; t += 0.002) { const px = r.ox + r.dx * t - x, pz = r.oz + r.dz * t - z; I += Math.exp(-0.5 * (i11 * px * px + 2 * i12 * px * pz + i22 * pz * pz)) * 0.002; }
      prof.push([u, I]); sw += I; su += u * I; peak = Math.max(peak, I);
    }
    const mean = su / sw; for (const [u, I] of prof) suu += (u - mean) ** 2 * I;
    const varN = suu / sw; let shape = 0; for (const [u, I] of prof) if (Math.abs(u - q.m) < 3 * sd) shape = Math.max(shape, Math.abs(I / peak - Math.exp(-((u - q.m) ** 2) / (2 * q.v))));
    return { v: q.v, m: q.m, vn: varN, mn: mean, shape };
  }
  const A = check('axis, sigma 0.2 at 5 m', 0, 5, 0.2, 0.2, 0), B = check('off axis, x 1.0', 1.0, 5, 0.2, 0.2, 0), C = check('anisotropic', 1.4, 5.5, 0.3, 0.1, 0.7);
  facts.ewa_v = A.v; facts.ewa_vn = A.vn; facts.ewa_verr = 100 * Math.abs(A.vn - A.v) / A.v; facts.ewa_shape = 100 * A.shape; facts.ewa_sd = Math.sqrt(A.v); facts.ewa_cover = 6 * Math.sqrt(A.v);
  facts.ewa_v2 = B.v; facts.ewa_v2n = B.vn; facts.ewa_v3 = C.v; facts.ewa_v3n = C.vn;
  ok('EWA variance == numerical line integral (axis) to 1.5%', facts.ewa_verr < 1.5, [A.v, A.vn]);
  ok('EWA variance == numerical line integral (off axis, anisotropic) to 1.5%', Math.abs(B.vn - B.v) / B.v < 0.015 && Math.abs(C.vn - C.v) / C.v < 0.015, [B, C]);
  ok('EWA mean == numerical line integral to 0.1 px', Math.abs(A.mn - A.m) < 0.1 && Math.abs(B.mn - B.m) < 0.1 && Math.abs(C.mn - C.m) < 0.1, [A.mn - A.m, B.mn - B.m, C.mn - C.m]);
  facts.ewa_J1 = F0 / 5; facts.ewa_J2 = F0 * 1.0 / 25;
  facts.ewa_dil = 0.3; facts.ewa_vd = A.v + 0.3;
  // a Gaussian's footprint in pixels grows as 1/z: at 2.5 m and at 10 m
  facts.ewa_sd_near = F0 * 0.2 / 2.5; facts.ewa_sd_far = F0 * 0.2 / 10;
  const Dn = check('2.5 m', 0, 2.5, 0.2, 0.2, 0), Df = check('10 m', 0, 10, 0.2, 0.2, 0);
  ok('footprint sd at 2.5 m and at 10 m (numerical line integral) is f s / z to 4%', Math.abs(Math.sqrt(Dn.vn) / facts.ewa_sd_near - 1) < 0.04 && Math.abs(Math.sqrt(Df.vn) / facts.ewa_sd_far - 1) < 0.04, [Math.sqrt(Dn.vn), facts.ewa_sd_near, Math.sqrt(Df.vn), facts.ewa_sd_far]);
}
{
  // the rewritten renderer equals FL.gs.render; and the splat composite is lesson 8's composite with alpha as the opacity
  let worst = 0, worstPairs = 0;
  for (const seed of [1, 2, 3]) {
    const S = randomSplats(30, seed), cams = FL.orbit(4, 6, 0, 0, { f: 56, W: 64, start: 0.4 * seed });
    for (const cam of cams) { const a = FL.gs.render(S, cam), b = splatRender(S, cam); for (let i = 0; i < 64; i++) worst = Math.max(worst, Math.abs(a.r[i] - b.r[i]), Math.abs(a.g[i] - b.g[i]), Math.abs(a.b[i] - b.b[i])); worstPairs = Math.max(worstPairs, Math.abs(a.pairs - b.pairs)); }
  }
  ok('rewritten splat renderer == FL.gs.render (colours)', worst < 1e-6, worst); ok('rewritten renderer counts the same (splat, pixel) pairs', worstPairs === 0, worstPairs);
  const S = randomSplats(12, 4), cam = FL.camera({ x: 0, z: -5, a: PI / 2, f: 56, W: 64 }), pr = [];
  for (let k = 0; k < S.K; k++) pr.push({ k, q: project(S.p, k, cam, S.dil) });
  pr.sort((a, b) => a.q.zc - b.q.zc);
  const u = 31.5, sig = [], col = [], dl = [];
  for (const { k, q } of pr) { const d = u - q.m, a = Math.min(0.99, sigmoid(S.p[9 * k + 5]) * Math.exp(-d * d / (2 * q.v))); sig.push(-Math.log(1 - a)); col.push([sigmoid(S.p[9 * k + 6]), sigmoid(S.p[9 * k + 7]), sigmoid(S.p[9 * k + 8])]); dl.push(1); }
  const l8 = FL.vol.composite(sig, col, dl, S.bg), mine = splatRender(S, cam);
  ok('splat composite == lesson 8 composite with sigma delta = -ln(1 - alpha)', Math.abs(l8.C[0] - mine.r[31]) < 1e-4 && Math.abs(l8.C[1] - mine.g[31]) < 1e-4, [l8.C, mine.r[31]]);
  // thin cloud: physical opacity 1 - exp(-tau G) against o G, o = 1 - exp(-tau)
  const phys = (tau, g) => 1 - Math.exp(-tau * g), og = (tau, g) => (1 - Math.exp(-tau)) * g, g1 = Math.exp(-0.5);
  facts.thin_err = 100 * Math.abs(phys(0.1, g1) - og(0.1, g1)) / phys(0.1, g1); facts.thick_err = 100 * Math.abs(phys(3, g1) - og(3, g1)) / phys(3, g1);
  ok('thin cloud: physical opacity ~ o G; thick: it is not', facts.thin_err < 3 && facts.thick_err > 30, [facts.thin_err, facts.thick_err]);
}

/* ───────────────────────── 5. fitting ───────────────────────── */
{
  // analytic gradient of FL.gs.grad against central differences of the rewritten loss, every parameter
  const S = randomSplats(5, 6), cams = FL.orbit(3, 6, 0, 0, { f: 56, W: 20, start: 0.3 }), views = cams.map(c => ({ cam: c, img: FL.render(SC, c) }));
  for (let k = 0; k < S.K; k++) S.p[9 * k + 5] = Math.min(S.p[9 * k + 5], 0.5);              // keep every opacity below the 0.99 cap
  const loss = () => { let L = 0, Pn = 0; for (const v of views) Pn += v.cam.W; for (const v of views) { const r = splatRender(S, v.cam); for (let i = 0; i < v.cam.W; i++) L += ((r.r[i] - v.img.r[i]) ** 2 + (r.g[i] - v.img.g[i]) ** 2 + (r.b[i] - v.img.b[i]) ** 2) / (3 * Pn); } return L; };
  const g = FL.gs.grad(S, views); ok('engine loss == rewritten loss', close(g.loss, loss(), 1e-6), [g.loss, loss()]);
  let worst = 0, gmax = 0; for (let k = 0; k < g.grad.length; k++) gmax = Math.max(gmax, Math.abs(g.grad[k]));
  for (let k = 0; k < S.K * 9; k++) { const h = 1e-6 * (1 + Math.abs(S.p[k])), s0 = S.p[k]; S.p[k] = s0 + h; const lp = loss(); S.p[k] = s0 - h; const lm = loss(); S.p[k] = s0; worst = Math.max(worst, Math.abs((lp - lm) / (2 * h) - g.grad[k]) / gmax); }
  facts.gs_grad_err = worst; facts.gs_grad_digits = -Math.log10(Math.max(worst, 1e-16));
  ok('splat gradient == finite differences of the rewritten loss (relative to the largest component)', worst < 5e-3, worst);
}
{
  // a Gaussian outside every data camera's view receives no gradient at all (and Adam then leaves it where it started)
  const S = randomSplats(5, 6), cams = FL.orbit(3, 6, 0, 0, { f: 56, W: 64, start: 0.3 }), views = cams.map(c => ({ cam: c, img: FL.render(SC, c) }));
  const unseen = (x, z) => cams.every(c => { const q = FL.gs.geom({ p: Float64Array.from([x, z, Math.log(0.3), Math.log(0.3), 0, 0, 0, 0, 0]), dil: 0.3 }, 0, c); return !q.ok || Math.abs(32 - q.m) > 5 * Math.sqrt(q.v) + 32; });
  let spot = null; for (const rad of [8, 10, 12, 14]) for (let a = 0; a < 360 && !spot; a += 5) { const x = rad * Math.cos(a * PI / 180), z = rad * Math.sin(a * PI / 180); if (unseen(x, z)) spot = [x, z]; }
  ok('there is a place outside every data camera\'s view', spot !== null);
  if (spot) {
    const T = FL.gs.make(6); T.bg = S.bg; for (let k = 0; k < 5 * 9; k++) T.p[k] = S.p[k]; T.p.set([spot[0], spot[1], Math.log(0.3), Math.log(0.3), 0, 0, 0, 0, 0], 45);
    const g = FL.gs.grad(T, views).grad; let m = 0; for (let q = 45; q < 54; q++) m = Math.max(m, Math.abs(g[q]));
    ok('a Gaussian that no data camera sees has exactly zero gradient', m === 0, m);
    const T2 = FL.gs.make(6); T2.bg = S.bg; T2.p.set(T.p); for (let s = 0; s < 20; s++) FL.gs.step(T2, views, {});
    let moved = 0; for (let q = 45; q < 54; q++) moved = Math.max(moved, Math.abs(T2.p[q] - T.p[q]));
    ok('and Adam leaves it exactly where it started (20 steps), while the Gaussians the cameras see move', moved === 0 && Math.abs(T2.p[0] - T.p[0]) > 0, moved);
  }
}
const fit = (n, K0, steps, seed) => { const r = L10.Run.fit(n, K0, steps, seed); return { K: r.S.K, tr: r.tr, ho: r.ho, pairs: r.pairs, loss: r.loss[r.loss.length - 1], run: r }; };
const light = o => ({ K: o.K, tr: o.tr, ho: o.ho, pairs: o.pairs, loss: o.loss });
{
  const m = fit(12, 40, 400); facts.sp_K = m.K; facts.sp_par = 9 * m.K; facts.sp_tr = m.tr; facts.sp_ho = m.ho; facts.sp_pairs = m.pairs; facts.field_per_view = W * NS;
  facts.pairs_ratio = facts.field_per_view / m.pairs; facts.occ_per_view = facts.occ_step / 12; facts.occ_pairs_ratio = facts.occ_per_view / m.pairs;
  { // the fitted set, scored by the rewritten renderer, on the held-out cameras of lesson 9
    const r = m.run, LW = L10.world(); let tr = 0, pr = 0, ho = 0, same = true;
    r.views.forEach(v => { const q = splatRender(r.S, v.cam); tr += FL.psnr(v.img, q); pr += q.pairs; });
    world.held.forEach((c, k) => { ho += FL.psnr(world.heldImg[k], splatRender(r.S, c)); const d = LW.held[k]; if (Math.abs(c.x - d.x) + Math.abs(c.z - d.z) + Math.abs(c.a - d.a) > 1e-12) same = false; for (let i = 0; i < W; i++) if (LW.heldImg[k].r[i] !== world.heldImg[k].r[i]) same = false; });
    ok('the lab scores the same 24 held-out cameras as lesson 9', same);
    ok('fitted Gaussians scored by the rewritten renderer: same PSNR and pairs as the lab', close(tr / 12, r.tr, 1e-4) && close(ho / 24, r.ho, 1e-4) && close(pr / 12, r.pairs, 1e-9), [tr / 12, r.tr, ho / 24, r.ho, pr / 12, r.pairs]);
  }
  // the initial points are what the cameras saw
  ok('lab: initial Gaussians sit on surface points seen by the cameras (within 25 cm of the true surface)', (() => { const S = L10.init(L10.views(12), 40, 7); let w = 0; for (let k = 0; k < S.K; k++) w = Math.max(w, Math.abs(FL.sdf(SC, S.p[9 * k], S.p[9 * k + 1]))); return w < 0.4; })());
  // the budget sweep
  const sweep = memo('sweep', () => [8, 16, 24, 40, 64, 96].map(K => light(fit(12, K, 400))));
  [8, 16, 24, 40, 64, 96].forEach((K, i) => { facts['bk' + K + '_tr'] = sweep[i].tr; facts['bk' + K + '_ho'] = sweep[i].ho; facts['bk' + K + '_pairs'] = sweep[i].pairs; });
  facts.bk_gain_ho = sweep[5].ho - sweep[3].ho; facts.bk_gain_tr = sweep[5].tr - sweep[3].tr; facts.bk_pairs_ratio = sweep[5].pairs / sweep[3].pairs; facts.par_ratio = 6400 / (9 * 40);
  ok('more Gaussians fit the photographs better and cost more pairs', sweep.every((o, i) => i === 0 || (o.tr > sweep[i - 1].tr && o.pairs > sweep[i - 1].pairs)), sweep);
  ok('the exam score saturates: 96 Gaussians gain under 1 dB of held-out over 40', sweep[5].ho - sweep[3].ho < 1.0, [sweep[3].ho, sweep[5].ho]);
}
{
  // growth, against no growth, against growing at random, against starting at the final size (six initialisations each); every run is 400 steps, then 300 more
  // (the widget's protocol: a slider move fits for 400 steps; each press of 'densify' is one round of clone / split / prune followed by 100 steps)
  const res = memo('growth2', () => {
    const out = { none: [], grad: [], rand: [], big: [] };
    const done = r => light({ K: r.S.K, tr: r.tr, ho: r.ho, pairs: r.pairs, loss: r.loss[r.loss.length - 1] });
    for (let seed = 1; seed <= 6; seed++) {
      const a = new L10.Run(12, 24, seed); a.train(400); a.train(300); out.none.push(done(a));
      for (const rule of ['grad', 'rand']) {
        const r = new L10.Run(12, 24, seed); r.train(400);
        for (let q = 0; q < 3; q++) {
          if (rule === 'rand') { const rng = FL.rng(900 + seed * 10 + q); for (let k = 0; k < r.S.K; k++) { r.S.dmSum[k] = rng(); r.S.dmCnt[k] = 1; } }
          r.grow(); r.train(100);
        }
        out[rule].push(done(r));
      }
      const b = new L10.Run(12, 64, seed); b.train(400); b.train(300); out.big.push(done(b));
    }
    return out;
  });
  const mean = (a, k) => a.reduce((s, o) => s + o[k], 0) / a.length;
  for (const key of ['none', 'grad', 'rand', 'big']) { facts['gr_' + key + '_loss'] = mean(res[key], 'loss'); facts['gr_' + key + '_tr'] = mean(res[key], 'tr'); facts['gr_' + key + '_ho'] = mean(res[key], 'ho'); facts['gr_' + key + '_pairs'] = mean(res[key], 'pairs'); facts['gr_' + key + '_K'] = res[key][0].K; }
  facts.gr_pairs_cut = 100 * (1 - facts.gr_grad_pairs / facts.gr_big_pairs); facts.gr_big_diff = 100 * (facts.gr_grad_loss / facts.gr_big_loss - 1); facts.gr_rand_diff = 100 * (1 - facts.gr_rand_loss / facts.gr_grad_loss);
  facts.gr_loss_ratio = facts.gr_none_loss / facts.gr_grad_loss; facts.gr_rand_ratio = facts.gr_rand_loss / facts.gr_grad_loss;
  facts.gr_rand_wins = res.rand.filter((o, i) => o.loss < res.grad[i].loss).length;
  ok('random and gradient-chosen growth trade places across the initialisations (a tie, not a win for the gradient)', facts.gr_rand_wins >= 2 && facts.gr_rand_wins <= 4, facts.gr_rand_wins);
  ok('growth beats no growth at equal steps (every initialisation)', res.grad.every((o, i) => o.loss < res.none[i].loss * 0.85), [res.grad.map(o => o.loss), res.none.map(o => o.loss)]);
  ok('growth reaches the same K', res.grad.every(o => o.K === res.rand[0].K && o.K === 64), res.grad.map(o => o.K));
  ok('choosing by position gradient is not better than choosing at random in this toy (within 10% either way)', Math.abs(facts.gr_grad_loss / facts.gr_rand_loss - 1) < 0.1, [facts.gr_grad_loss, facts.gr_rand_loss]);
  ok('growing from 24 matches starting at 64 in loss (within 5%) with at least 20% fewer pairs', Math.abs(facts.gr_grad_loss / facts.gr_big_loss - 1) < 0.05 && facts.gr_grad_pairs < 0.8 * facts.gr_big_pairs, [facts.gr_grad_loss, facts.gr_big_loss, facts.gr_grad_pairs, facts.gr_big_pairs]);
}

/* ───────────────────────── 6. the exam with few photographs ───────────────────────── */
const exit3 = memo('exit3', () => {
  const o = {};
  for (const n of [12, 6, 3, 1]) o['n' + n] = light(fit(n, 40, 400));
  const r3 = fit(3, 40, 400).run; r3.train(600); o.n3long = { tr: r3.tr, ho: r3.ho };
  const r3b = fit(3, 40, 400).run;
  const rows = world.held.map((c, k) => { const ang = Math.atan2(c.z, c.x); let best = 9; r3b.views.forEach(v => { best = Math.min(best, Math.abs(FL.se2.wrap(ang - Math.atan2(v.cam.z, v.cam.x)))); }); return { deg: best * 180 / PI, psnr: FL.psnr(world.heldImg[k], FL.gs.render(r3b.S, c)) }; });
  rows.sort((a, b) => a.deg - b.deg);
  o.near = rows.slice(0, 6).reduce((s, x) => s + x.psnr, 0) / 6; o.far = rows.slice(-6).reduce((s, x) => s + x.psnr, 0) / 6; o.near_deg = rows[5].deg; o.far_deg = rows[rows.length - 6].deg;
  return o;
});
for (const n of [12, 6, 3, 1]) { facts['v' + n + '_tr'] = exit3['n' + n].tr; facts['v' + n + '_ho'] = exit3['n' + n].ho; facts['v' + n + '_pairs'] = exit3['n' + n].pairs; }
facts.v3_tr_long = exit3.n3long.tr; facts.v3_ho_long = exit3.n3long.ho; facts.v3_near = exit3.near; facts.v3_far = exit3.far; facts.v3_near_deg = exit3.near_deg; facts.v3_far_deg = exit3.far_deg;
ok('three photographs: the Gaussians fit them far better than the exam', facts.v3_tr - facts.v3_ho > 10, [facts.v3_tr, facts.v3_ho]);
ok('more training does not repair three photographs (held-out within 1 dB, fit up)', facts.v3_tr_long > facts.v3_tr && Math.abs(facts.v3_ho_long - facts.v3_ho) < 1.0, [facts.v3_tr, facts.v3_tr_long, facts.v3_ho, facts.v3_ho_long]);
ok('cameras far from every data camera score worse than the near ones', facts.v3_far < facts.v3_near - 2, [facts.v3_near, facts.v3_far]);
{
  const g3 = memo('grid3', () => { const S = N9.start(3, 40, false); N9.train(S, 150); const a = { tr: S.tr, ho: S.ho, nearest: S.nearest }; N9.train(S, 450); a.tr600 = S.tr; a.ho600 = S.ho; return a; });
  facts.g3_tr = g3.tr; facts.g3_ho = g3.ho; facts.g3_nearest = g3.nearest; facts.g3_tr600 = g3.tr600; facts.g3_ho600 = g3.ho600;
  const h3 = memo('hash3', () => {
    const S = N9.start(3, 40, false), G = new H10.HashField({ x0: -BOX, x1: BOX, z0: -BOX, z1: BOX, res: [16, 32, 64], T: 256, F: 2, H: 16, nsamp: NS, bg: SC.bg, seed: 11 });
    for (let s = 0; s < 150; s++) G.step(S.views, { lr: 0.05, seed: 3 });
    return scoreOf(G, S);
  });
  facts.h3v3_tr = h3.tr; facts.h3v3_ho = h3.ho;
  ok('three photographs: grid, hashed field and Gaussians all score far above their exam', facts.g3_tr - facts.g3_ho > 15 && facts.h3v3_tr - facts.h3v3_ho > 10, [facts.g3_tr, facts.g3_ho, facts.h3v3_tr, facts.h3v3_ho]);
}

/* ───────────────────────── 7. what they cost ───────────────────────── */
facts.gs_floats = 3 + 3 + 4 + 1 + 3 * 16; facts.gs_bytes = 59 * 4; facts.gs_flat = 9; facts.gs_3m_mb = 3e6 * 59 * 4 / 1e6; facts.gs_model_m = 734e6 / (59 * 4) / 1e6;
facts.t_ratio_nerf = 48 * 60 / (41 + 33 / 60); facts.t_fps_ratio = 134 / 0.06; facts.t_mem_ratio = 734 / 8.6; facts.t_ingp_t = (41 + 33 / 60) / (5 + 37 / 60); facts.t_ingp_fps = 134 / 11.7; facts.t_psnr_gain = 27.21 - 25.30;
facts.tile_px = 16 * 16;

/* ───────────────────────── 8. the checkpoint ───────────────────────── */
{
  const v = (F0 * 0.2 / 5) ** 2; facts.ck_v = v; facts.ck_sd = Math.sqrt(v); facts.ck_cover = 6 * Math.sqrt(v);
  const M = 300, T = 1024; facts.ck_share = 100 * (1 - Math.pow(1 - 1 / T, M - 1));
  facts.ck_v_far = (F0 * 0.2 / 10) ** 2; facts.ck_ratio_area = (5 / 2.5) ** 2;
}

/* ───────────────────────── 9. the widget ───────────────────────── */
{
  // the page's own widget, driven into every state "What to try" describes; what it prints must equal the engine's run (scored above by the rewritten renderer)
  const PAGE = path.join(DIR, '10_speed_grids_and_splats.html');
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const num = id => page.num(id), cam = (r, hi) => FL.psnr(world.heldImg[hi], FL.gs.render(r.S, world.held[hi]));
  const same = (label, id, want, tol) => ok('widget: ' + label, Math.abs(num(id) - want) <= tol, [num(id), want]);
  const readouts = (label, r, hi) => {
    same(label + ': Gaussians', 'w10-m-k', r.S.K, 0); same(label + ': numbers stored', 'w10-m-par', 9 * r.S.K, 0); same(label + ': pairs per camera', 'w10-m-pairs', Math.round(r.pairs), 0);
    same(label + ': steps', 'w10-m-steps', r.steps, 0); same(label + ': data cameras', 'w10-m-tr', r.tr, 0.051); same(label + ': held-out cameras', 'w10-m-ho', r.ho, 0.051);
    same(label + ': fit minus exam', 'w10-m-gap', r.tr - r.ho, 0.051); same(label + ': this held-out camera', 'w10-m-cam', cam(r, hi), 0.051);
  };
  // 1. the opening state
  const r0 = L10.Run.fit(12, 40, 400, 7); readouts('opening state', r0, 17);
  ok('opening state is the lab\'s 40-Gaussian fit', r0.S.K === facts.sp_K && close(r0.tr, facts.sp_tr, 1e-9) && close(r0.ho, facts.sp_ho, 1e-9));
  // 2. the budget slider
  for (const K of [8, 96, 24]) {
    page.set('w10-k', K); const r = L10.Run.fit(12, K, 400, 7); readouts('K0 = ' + K, r, 17);
    ok('slider label follows the slider', page.text('w10-k-v') === String(K));
    if (K === 8 || K === 96) ok('budget sweep fact K0 = ' + K, close(r.tr, facts['bk' + K + '_tr'], 1e-9) && close(r.ho, facts['bk' + K + '_ho'], 1e-9));
  }
  // 3. K0 = 24 and three densify presses (the widget's seed-7 path)
  const rg = new L10.Run(12, 24, 7); rg.train(400); readouts('K0 = 24 fit', rg, 17);
  facts.w_g0_tr = rg.tr; facts.w_g0_ho = rg.ho; const path24 = [rg.S.K];
  for (let q = 1; q <= 3; q++) {
    page.click('w10-grow'); rg.grow(); rg.train(100); readouts('densify ' + q, rg, 17); path24.push(rg.S.K);
    ok('densify adds Gaussians and marks the new ones', rg.fresh > 0 && rg.S.K > path24[q - 1], [rg.fresh, path24]);
    facts['w_g' + q + '_tr'] = rg.tr; facts['w_g' + q + '_ho'] = rg.ho; facts['w_g' + q + '_pairs'] = rg.pairs;
  }
  ok('three densify presses take 24 Gaussians to 33, 46 and 64', path24.join(',') === '24,33,46,64', path24);
  ok('three densify presses raise both scores', facts.w_g3_tr > facts.w_g0_tr + 2 && facts.w_g3_ho > facts.w_g0_ho + 1, [facts.w_g0_tr, facts.w_g3_tr, facts.w_g0_ho, facts.w_g3_ho]);
  // 4. three data cameras: the exit
  page.set('w10-k', 40); page.set('w10-n', 3);
  const r3 = L10.Run.fit(3, 40, 400, 7); readouts('three views', r3, 17);
  ok('three views: the lab\'s numbers', close(r3.tr, facts.v3_tr, 1e-9) && close(r3.ho, facts.v3_ho, 1e-9) && Math.round(r3.pairs) === Math.round(facts.v3_pairs));
  const dataAng = r3.views.map(v => Math.atan2(v.cam.z, v.cam.x)), deg = k => Math.min(...dataAng.map(a => Math.abs(FL.se2.wrap(Math.atan2(world.held[k].z, world.held[k].x) - a)))) * 180 / PI;
  for (const k of [0, 4]) { page.set('w10-h', k); same('held-out camera ' + k + ' under three views', 'w10-m-cam', cam(r3, k), 0.051); facts['w3_cam' + k] = cam(r3, k); facts['w3_deg' + k] = deg(k); }
  ok('camera 0 is near a data camera, camera 4 far from all, and the near one scores higher', facts.w3_deg0 < 8 && facts.w3_deg4 > 50 && facts.w3_cam0 > facts.w3_cam4 + 3, [facts.w3_deg0, facts.w3_deg4, facts.w3_cam0, facts.w3_cam4]);
  for (let q = 0; q < 6; q++) page.click('w10-train');
  r3.train(600); readouts('three views, 600 more steps', r3, 4);
  ok('600 more steps: the lab\'s numbers', close(r3.tr, facts.v3_tr_long, 1e-9) && close(r3.ho, facts.v3_ho_long, 1e-9));
  // 5. one data camera, and reset
  page.set('w10-n', 1); const r1 = L10.Run.fit(1, 40, 400, 7); readouts('one view', r1, 4);
  ok('one view: the lab\'s numbers', close(r1.tr, facts.v1_tr, 1e-9) && close(r1.ho, facts.v1_ho, 1e-9));
  page.click('w10-train'); page.click('w10-reset'); readouts('reset refits from scratch', r1, 4);
  // 6. the narrow layout draws without error, and the held-out slider is cheap
  page.el('w10-canvas').clientWidth = 340; page.set('w10-n', 12); page.click('w10-train'); page.set('w10-h', 5); page.el('w10-canvas').clientWidth = 640;
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
}

module.exports = { facts };
if (require.main === module) {
  console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
  console.log(JSON.stringify({ facts }));
  process.exit(fails ? 1 : 0);
}
