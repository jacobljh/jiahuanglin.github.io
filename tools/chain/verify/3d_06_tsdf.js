#!/usr/bin/env node
/* Oracle for 3D lesson 06, "From points to a surface".
 *
 * Everything the lesson quotes is re-derived here from the lesson's own formulas, in code that shares nothing with tsdf.js except the Flatland
 * primitives the lesson itself builds on (cameras, FL.render, FL.noisyDepth, FL.raycast):
 *   - a reference fusion (per node, per view, float64) from  d = z_meas - z_cell,  clip at +mu,  abstain below -mu,  w = (6 m / z)^4;
 *   - reference zero crossings by scanning grid edges, and reference distances to the true boundary by brute force over a dense polyline;
 *   - a reference point-cloud exam (pixel-outer loop), reference sphere tracing (the lesson's step rule, written again) and a dense marcher;
 *   - Monte-Carlo checks of the maximum-likelihood average (the 1/sqrt(n) law, inverse-variance weights, the sign-only estimator);
 *   - a brute-force count of marching-cubes classes;
 * then the engine (tsdf.js) is checked against them and the page's own widget is driven into each state "What to try" describes.
 * The last stdout line is {"facts": {...}}; the validator checks every <span data-n="key"> of the page against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const TS = require(path.join(DIR, 'tsdf.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const TIME = !!process.env.ORACLE_TIME; const T0 = Date.now();
const lap = (s) => { if (TIME) console.error('[' + (Date.now() - T0) + ' ms]', s); };

/* ── the lesson's constants, restated (a typo in the engine would show up as a disagreement) ── */
const F = 56, WPX = 64, RING = 6, ZREF = 6, FB = 28, X0 = -3.4, H = 0.05, NG = 137, TOL = 0.05, MU = 0.10, SIG = 3, SEED = 1000;
const ORDER = [0, 12, 6, 18, 3, 9, 15, 21, 1, 13, 7, 19, 4, 10, 16, 22, 2, 14, 8, 20, 5, 11, 17, 23];
const SC = FL.scenes.statue();
const TRAIN = FL.orbit(24, RING, 0, 0, { f: F, W: WPX, start: 0.13 });
const TEST = FL.orbit(24, RING, 0, 0, { f: F, W: WPX, start: 0.13 + Math.PI / 24 * 0.9 });
ok('constants agree with the engine', TS.F === F && TS.W === WPX && TS.R === RING && TS.ZREF === ZREF && TS.FB === FB && TS.X0 === X0 && TS.H === H && TS.NG === NG && TS.TOL === TOL);
ok('view order agrees with the engine', JSON.stringify(TS.ORDER) === JSON.stringify(ORDER));
const w = TS.world();
const REND = TRAIN.map(c => FL.render(SC, c));
const PHOTO = TEST.map(c => FL.render(SC, c));
const TTRUE = TEST.map(c => { const t = []; for (let i = 0; i < WPX; i++) { const r = FL.pixelRay(c, i + 0.5), h = FL.raycast(SC, r.ox, r.oz, r.dx, r.dz, 20); t.push(h.hit ? h.t : -1); } return t; });
let nHit = 0, nAll = 0; TTRUE.forEach(a => a.forEach(t => { nAll++; if (t >= 0) nHit++; }));
facts.n_all = nAll; facts.n_hit = nHit;
ok('train cameras agree', TRAIN.every((c, v) => close(c.x, w.train[v].x) && close(c.z, w.train[v].z) && close(c.a, w.train[v].a)));
ok('held-out cameras agree and are interleaved with the ring', TEST.every((c, v) => close(c.x, w.test[v].x) && close(c.z, w.test[v].z)) &&
   close(Math.atan2(TEST[0].z, TEST[0].x) - Math.atan2(TRAIN[0].z, TRAIN[0].x), Math.PI / 24 * 0.9));
ok('true first hits agree', TTRUE.every((a, c) => a.every((t, i) => close(t, w.tTrue[c][i], 1e-12))));

/* ── 1. the sensor: sigma_Z = sigma6 (Z / 6)^2 ── */
{
  const bins = [[4.5, 5.5], [5.5, 6.5], [6.5, 7.5]], acc = bins.map(() => ({ s: 0, n: 0, zs: 0 }));
  for (let seed = 1; seed <= 120; seed++) {
    const dm = TS.depthMaps(w, SIG, seed * 7);
    for (let v = 0; v < 24; v++) for (let i = 0; i < WPX; i++) {
      const z = REND[v].depth[i]; if (z <= 0 || dm[v][i] <= 0) continue;
      const b = bins.findIndex(r => z >= r[0] && z < r[1]); if (b < 0) continue;
      acc[b].s += (dm[v][i] - z) ** 2; acc[b].n++; acc[b].zs += z;
    }
  }
  acc.forEach((a, b) => { ok('bin ' + b + ' has samples', a.n > 500, a.n); const z = a.zs / a.n, want = SIG * (z / ZREF) ** 2, got = 100 * Math.sqrt(a.s / a.n); ok('stereo noise follows sigma ~ Z^2 in bin ' + b, Math.abs(got / want - 1) < 0.05, [got, want]); });
  facts.sig_near = SIG * (4.85 / ZREF) ** 2; facts.sig_far = SIG * (7.15 / ZREF) ** 2;
}
lap('sensor');

/* ── reference geometry: dense true boundary with a bucket index, distance and nearest shape ── */
const SEGS = [];
SC.shapes.forEach((sh, id) => { const P = FL.boundary(sh, 8000); for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; SEGS.push([a.x, a.z, b.x, b.z, id]); } });
const BK = 0.1, BN = 90, buckets = new Map();
SEGS.forEach((s, k) => {
  const i0 = Math.floor((Math.min(s[0], s[2]) + 4.5) / BK), i1 = Math.floor((Math.max(s[0], s[2]) + 4.5) / BK), j0 = Math.floor((Math.min(s[1], s[3]) + 4.5) / BK), j1 = Math.floor((Math.max(s[1], s[3]) + 4.5) / BK);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const key = j * BN + i; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(k); }
});
function segDist(s, x, z) { const dx = s[2] - s[0], dz = s[3] - s[1], t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - s[0] - t * dx, z - s[1] - t * dz); }
function refDist(x, z) {   // {d, id}: distance to the nearest piece of the true boundary, exact up to the polyline resolution (about a millimetre)
  for (let r = 3; r <= 40; r *= 2) {
    const ci = Math.floor((x + 4.5) / BK), cj = Math.floor((z + 4.5) / BK); let best = Infinity, id = -1;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) { const L = buckets.get(j * BN + i); if (L) for (const k of L) { const d = segDist(SEGS[k], x, z); if (d < best) { best = d; id = SEGS[k][4]; } } }
    if (best < r * BK * 0.9) return { d: best, id };
  }
  let best = Infinity, id = -1; for (const s of SEGS) { const d = segDist(s, x, z); if (d < best) { best = d; id = s[4]; } }
  return { d: best, id };
}

/* ── reference fusion: float64, node by node ── */
function refFuse(dm, mu, n, o) {
  o = o || {}; const order = o.order || ORDER, cams = o.cams || TRAIN, S1 = new Float64Array(NG * NG), S0 = new Float64Array(NG * NG);
  for (let k = 0; k < n; k++) {
    const v = order[k], cam = cams[v];
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const p = FL.project(cam, X0 + i * H, X0 + j * H);
      if (p.zc < 0.3) continue;
      const px = Math.floor(p.u); if (px < 0 || px >= WPX) continue;
      const zm = dm[v][px]; if (zm <= 0) continue;
      let d = zm - p.zc;
      if (d < -mu) { if (o.noskip) d = -mu; else continue; }
      if (d > mu && !o.noclip) d = mu;
      const wt = o.uniform ? 1 : (ZREF / zm) ** 4;
      S1[j * NG + i] += wt * d; S0[j * NG + i] += wt;
    }
  }
  const D = new Float64Array(NG * NG); for (let a = 0; a < NG * NG; a++) D[a] = S0[a] > 0 ? S1[a] / S0[a] : 0;
  return { D, Wt: S0, mu };
}
function refCross(f) {   // one point per grid edge whose two nodes are observed and have opposite signs
  const out = [];
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG - 1; i++) { const a = f.D[j * NG + i], b = f.D[j * NG + i + 1]; if (f.Wt[j * NG + i] > 0 && f.Wt[j * NG + i + 1] > 0 && (a < 0) !== (b < 0)) out.push([X0 + (i + a / (a - b)) * H, X0 + j * H]); }
  for (let i = 0; i < NG; i++) for (let j = 0; j < NG - 1; j++) { const a = f.D[j * NG + i], b = f.D[(j + 1) * NG + i]; if (f.Wt[j * NG + i] > 0 && f.Wt[(j + 1) * NG + i] > 0 && (a < 0) !== (b < 0)) out.push([X0 + i * H, X0 + (j + a / (a - b)) * H]); }
  return out;
}
function refErr(pts) { let s = 0, c = 0, sa = 0, mx = 0; for (const p of pts) { const r = refDist(p[0], p[1]); sa += r.d * r.d; if (r.d > mx) mx = r.d; if (r.id === 0) { s += r.d * r.d; c++; } } return { stat: 100 * Math.sqrt(s / c), all: 100 * Math.sqrt(sa / pts.length), worst: 100 * mx, nv: pts.length }; }
function refHoles(f) {   // the true boundary, sampled every 3 cm; a sample is a hole when a corner node of its cell never received a vote
  let miss = 0; const B = w.bnd;
  for (let k = 0; k < B.n; k++) { const i = Math.floor((B.x[k] - X0) / H), j = Math.floor((B.z[k] - X0) / H); if (!(f.Wt[j * NG + i] > 0 && f.Wt[j * NG + i + 1] > 0 && f.Wt[(j + 1) * NG + i] > 0 && f.Wt[(j + 1) * NG + i + 1] > 0)) miss++; }
  return 100 * miss / B.n;
}
function bil(f, x, z) {   // bilinear D, NaN when a corner is unobserved
  const gx = (x - X0) / H, gz = (z - X0) / H; if (!(gx >= 0 && gz >= 0 && gx < NG - 1 && gz < NG - 1)) return NaN;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, a = j * NG + i;
  if (!(f.Wt[a] > 0 && f.Wt[a + 1] > 0 && f.Wt[a + NG] > 0 && f.Wt[a + NG + 1] > 0)) return NaN;
  return (1 - fz) * ((1 - fx) * f.D[a] + fx * f.D[a + 1]) + fz * ((1 - fx) * f.D[a + NG] + fx * f.D[a + NG + 1]);
}
/* the lesson's tracing rule, written again: step 0.8 D (at least half a cell, at most mu), bisect the first sign change 12 times, cross unobserved space in mu/2 */
function refTrace(f, o, d, count) {
  const hi = X0 + (NG - 1) * H; let t0 = 0, t1 = 1e9;   // slab test
  for (const [oo, dd, lo, up] of [[o[0], d[0], X0, hi], [o[1], d[1], X0, hi]]) {
    if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > up) return { hit: false }; } else { let a = (lo - oo) / dd, b = (up - oo) / dd; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  }
  if (!(t0 < t1)) return { hit: false };
  let t = t0 + 1e-6, prev = null; const te = Math.min(14, t1), at = (s) => { if (count) count.n++; return bil(f, o[0] + d[0] * s, o[1] + d[1] * s); };
  while (t < te) {
    const D = at(t);
    if (Number.isNaN(D)) { prev = null; t += f.mu / 2; continue; }
    if (D <= 0) {
      let a = prev ? prev.t : t, b = t;
      if (prev) for (let it = 0; it < 12; it++) { const m = (a + b) / 2; if (at(m) > 0) a = m; else b = m; }
      return { hit: true, t: b };
    }
    prev = { t, D }; t += Math.min(f.mu, Math.max(0.8 * D, H / 2));
  }
  return { hit: false };
}
function refTraceDense(f, o, d) {   // a different algorithm: march every 2 mm and take the linear root of the first sign change
  const hi = X0 + (NG - 1) * H; let last = NaN, lastT = 0;
  for (let t = 0.5; t < 12; t += 0.002) {
    const x = o[0] + d[0] * t, z = o[1] + d[1] * t; if (x < X0 || x > hi || z < X0 || z > hi) { last = NaN; continue; }
    const D = bil(f, x, z);
    if (!Number.isNaN(D) && D <= 0) { if (!Number.isNaN(last) && last > 0) return { hit: true, t: lastT + 0.002 * last / (last - D) }; return { hit: true, t }; }
    last = D; lastT = t;
  }
  return { hit: false };
}

/* ── reference exam ── */
const sq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function psnrFrom(se, n) { const m = se / n; return m < 1e-10 ? 99 : -10 * Math.log10(m); }
function classify(tt, tm) { if (tt < 0) return tm < 0 ? 0 : 4; if (tm < 0) return 3; return Math.abs(tm - tt) <= TOL ? 0 : (tm > tt ? 1 : 2); }
function refCloud(dm, n) {
  const P = [];
  for (let k = 0; k < n; k++) {
    const v = ORDER[k], cam = TRAIN[v], fx = Math.cos(cam.a), fz = Math.sin(cam.a), rx = Math.sin(cam.a), rz = -Math.cos(cam.a);
    for (let i = 0; i < WPX; i++) { const z = dm[v][i]; if (z <= 0) continue; const xc = (i + 0.5 - WPX / 2) / F * z; P.push({ x: cam.x + xc * rx + z * fx, z: cam.z + xc * rz + z * fz, c: [REND[v].r[i], REND[v].g[i], REND[v].b[i]] }); }
  }
  return P;
}
function refPointExam(P, ws) {   // pixel-outer: for each pixel collect the points whose splat covers it
  const cnt = [0, 0, 0, 0, 0]; let ps = 0;
  for (let c = 0; c < 24; c++) {
    let se = 0;
    const cam = TEST[c], fx = Math.cos(cam.a), fz = Math.sin(cam.a), rx = Math.sin(cam.a), rz = -Math.cos(cam.a);
    const proj = P.map(p => { const dx = p.x - cam.x, dz = p.z - cam.z, zc = dx * fx + dz * fz; return { zc, u: WPX / 2 + F * (dx * rx + dz * rz) / zc, c: p.c }; }).filter(q => q.zc >= 0.3);
    for (let i = 0; i < WPX; i++) {
      let best = null; for (const q of proj) if (Math.abs(i + 0.5 - q.u) <= ws / 2 && (best === null || q.zc < best.zc)) best = q;
      const xc = (i + 0.5 - WPX / 2) / F, tm = best ? best.zc * Math.sqrt(1 + xc * xc) : -1, col = best ? best.c : SC.bg;
      cnt[classify(TTRUE[c][i], tm)]++; se += sq(col, [PHOTO[c].r[i], PHOTO[c].g[i], PHOTO[c].b[i]]) / 3;
    }
    ps += psnrFrom(se, WPX);                       // the exam of lesson 7: PSNR per held-out camera, averaged over the 24 cameras
  }
  return { far: cnt[1], near: cnt[2], empty: cnt[3], phantom: cnt[4], wrong: 100 * (cnt[1] + cnt[2] + cnt[3]) / nHit, psnr: ps / 24 };
}
function meanColour(n) { const s = [0, 0, 0]; let c = 0; for (let k = 0; k < n; k++) { const im = REND[ORDER[k]]; for (let i = 0; i < WPX; i++) if (im.id[i] >= 0) { s[0] += im.r[i]; s[1] += im.g[i]; s[2] += im.b[i]; c++; } } return s.map(v => v / c); }
function copyColour(n, cam, x, z, fb) {
  let best = -1, bd = Infinity; for (let k = 0; k < n; k++) { const v = ORDER[k], d = Math.hypot(TRAIN[v].x - cam.x, TRAIN[v].z - cam.z); if (d < bd) { bd = d; best = v; } }
  const p = FL.project(TRAIN[best], x, z), px = Math.floor(p.u); if (p.zc <= 0 || px < 0 || px >= WPX) return fb;
  return [REND[best].r[px], REND[best].g[px], REND[best].b[px]];
}
/* mode 'const' | 'copy' on a traced field; mode 'trueconst' | 'truecopy' on the real scene */
function refSurfaceExam(f, n, mode, tracer) {
  const cnt = [0, 0, 0, 0, 0], mc = meanColour(n); let ps = 0; const sil = { all: 0, sil: 0, big: 0, bigSe: 0, silPx: 0, bigSil: 0, bigOff: [] };
  for (let c = 0; c < 24; c++) {
    const cam = TEST[c]; let se = 0;
    for (let i = 0; i < WPX; i++) {
      const ray = FL.pixelRay(cam, i + 0.5); let tm;
      if (mode.startsWith('true')) tm = TTRUE[c][i]; else { const h = (tracer || refTrace)(f, [ray.ox, ray.oz], [ray.dx, ray.dz]); tm = h.hit ? h.t : -1; }
      let col = SC.bg;
      if (tm >= 0) col = mode.endsWith('const') ? mc : copyColour(n, cam, ray.ox + ray.dx * tm, ray.oz + ray.dz * tm, mc);
      const e = sq(col, [PHOTO[c].r[i], PHOTO[c].g[i], PHOTO[c].b[i]]) / 3, id = PHOTO[c].id[i], idl = i > 0 ? PHOTO[c].id[i - 1] : id, idr = i < WPX - 1 ? PHOTO[c].id[i + 1] : id;
      cnt[classify(TTRUE[c][i], tm)]++; se += e; sil.all += e; const onSil = idl !== id || idr !== id; if (onSil) { sil.sil += e; sil.silPx++; } if (e > 0.05) { sil.big++; sil.bigSe += e; if (onSil) sil.bigSil++; else sil.bigOff.push({ c, i, id }); }
    }
    ps += psnrFrom(se, WPX);
  }
  return { far: cnt[1], near: cnt[2], empty: cnt[3], phantom: cnt[4], wrong: 100 * (cnt[1] + cnt[2] + cnt[3]) / nHit, psnr: ps / 24, silShare: 100 * sil.sil / sil.all, bigPx: sil.big, bigSil: sil.bigSil, bigOff: sil.bigOff, bigShare: 100 * sil.bigSe / sil.all };
}
lap('reference tools');

/* ── 2. the engine's fusion against the reference ── */
const DM = TS.depthMaps(w, SIG, SEED);
const FZ = TS.fuse(w, DM, MU);
{
  let worst = 0, maskBad = 0;
  for (const n of [1, 4, 24]) {
    const fld = TS.field(FZ, n), ref = refFuse(DM, MU, n);
    for (let a = 0; a < NG * NG; a++) { if ((fld.W[a] > 0) !== (ref.Wt[a] > 0)) maskBad++; else if (ref.Wt[a] > 0) worst = Math.max(worst, Math.abs(fld.D[a] - ref.D[a])); }
  }
  ok('engine fusion == reference fusion (same cells observed)', maskBad === 0, maskBad);
  ok('engine fusion == reference fusion (values)', worst < 2e-6, worst);
  // order independence and the incremental form: fuse in the reverse order and compare, and compare with  D <- (W D + w d) / (W + w)
  const rev = ORDER.slice().reverse(), a = refFuse(DM, MU, 24), b = refFuse(DM, MU, 24, { order: rev });
  let dmax = 0; for (let k = 0; k < NG * NG; k++) if (a.Wt[k] > 0) dmax = Math.max(dmax, Math.abs(a.D[k] - b.D[k]));
  ok('the fused field does not depend on the order of the views', dmax < 1e-12, dmax); facts.order_diff = dmax;
  const node = 70 * NG + 66; let Dk = 0, Wk = 0;
  for (let k = 0; k < 24; k++) { const v = ORDER[k], vt = TS.voteAt(w, DM, MU, v, X0 + 66 * H, X0 + 70 * H); if (vt) { Dk = (Wk * Dk + vt.w * vt.d) / (Wk + vt.w); Wk += vt.w; } }
  ok('incremental update == batch weighted mean', close(Dk, a.D[node], 1e-12) && close(Wk, a.Wt[node], 1e-9), [Dk, a.D[node]]);
}
lap('fusion check');

/* ── 3. the points of the entry ── */
{
  const dm0 = TS.depthMaps(w, 0);
  let count4 = 0; for (let k = 0; k < 4; k++) for (let i = 0; i < WPX; i++) if (REND[ORDER[k]].depth[i] > 0) count4++;
  facts.pts4 = count4;
  const P4 = refCloud(dm0, 4), e4 = refPointExam(P4, 1);
  ok('the cloud has one point per valid pixel', P4.length === count4, [P4.length, count4]);
  const eng = TS.exam(w, { kind: 'points', P: TS.cloud(w, dm0, 4), ws: 1 }, 4);
  ok('engine point exam == reference (wrong rays)', close(eng.wrong, e4.wrong, 1e-9) && eng.far === e4.far && eng.near === e4.near && eng.empty === e4.empty && eng.phantom === e4.phantom, [eng, e4]);
  ok('engine point exam == reference (psnr)', close(eng.psnr, e4.psnr, 1e-4), [eng.psnr, e4.psnr]);
  facts.e1_wrong = e4.wrong; facts.e1_far = e4.far; facts.e1_near = e4.near; facts.e1_empty = e4.empty; facts.e1_psnr = e4.psnr;
  facts.e1_phantom = e4.phantom; facts.n_miss = nAll - nHit;          // rays that hit nothing but get an answer (not counted as wrong), and the rays that hit nothing
  facts.e1_far_pct = 100 * e4.far / nHit; facts.e1_near_pct = 100 * e4.near / nHit;
  for (const n of [2, 8, 24]) {
    const e = refPointExam(refCloud(dm0, n), 1); facts['pn' + n] = refCloud(dm0, n).length; facts['pw' + n] = e.wrong; facts['pf' + n] = e.far; facts['pnr' + n] = e.near;
  }
  facts.pn4 = P4.length; facts.pw4 = e4.wrong; facts.pf4 = e4.far; facts.pnr4 = e4.near;
  const e2 = refPointExam(P4, 2), e3 = refPointExam(P4, 3); facts.ws2_wrong = e2.wrong; facts.ws3_wrong = e3.wrong; facts.ws2_near = e2.near; facts.ws3_near = e3.near; facts.ws2_far = e2.far; facts.ws3_far = e3.far;
  facts.ws2_psnr = e2.psnr; facts.ws3_psnr = e3.psnr;
  // noise: the stereo head of lesson 2, 3 cm at 6 m
  const P4n = refCloud(DM, 4), P24n = refCloud(DM, 24), e4n = refPointExam(P4n, 1), e24n = refPointExam(P24n, 1);
  facts.pn24n = P24n.length; facts.pw4n = e4n.wrong; facts.pw24n = e24n.wrong; facts.pp4n = e4n.psnr; facts.pp24n = e24n.psnr; facts.pnr24n = e24n.near; facts.pf24n = e24n.far;
  const eng24 = TS.exam(w, { kind: 'points', P: TS.cloud(w, DM, 24), ws: 1 }, 24);
  ok('engine point exam == reference (noisy, 24 views)', close(eng24.wrong, e24n.wrong, 1e-9) && close(eng24.psnr, e24n.psnr, 1e-4), [eng24.wrong, e24n.wrong]);
  // does the sensor noise make the cloud thicker?  RMS distance of the statue's points to the true surface
  const rms = P => { let q = 0, c = 0; for (const p of P) { const r = refDist(p.x, p.z); if (r.id === 0) { q += r.d * r.d; c++; } } return Math.sqrt(q / c) * 100; };
  facts.cloud_rms24 = rms(P24n); facts.cloud_rms0 = rms(refCloud(dm0, 24));
}
lap('points');

/* ── 4. the field: error against n, the floor, the sigma/sqrt(n) line; weights; truncation ablations ── */
const NS = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24];
const DM0 = TS.depthMaps(w, 0), FZ0 = TS.fuse(w, DM0, MU);
const refCurve = (dm, mu, o) => NS.map(n => refErr(refCross(refFuse(dm, mu, n, o))));
const CUR = refCurve(DM, MU), CUR0 = refCurve(DM0, MU);
{
  const eng = TS.curve(w, FZ, NS);
  NS.forEach((n, k) => { ok('engine error curve == reference at n=' + n, close(eng[k].stat, CUR[k].stat, 2e-3) && close(eng[k].worst, CUR[k].worst, 5e-3), [eng[k], CUR[k]]); });
  NS.forEach((n, k) => { facts['err' + n] = CUR[k].stat; facts['floor' + n] = CUR0[k].stat; facts['worst' + n] = CUR[k].worst; facts['line' + n] = SIG / Math.sqrt(n); });
  facts.all24 = CUR[9].all;
  facts.quad4 = Math.hypot(CUR0[3].stat, SIG / 2); facts.quad24 = Math.hypot(CUR0[9].stat, SIG / Math.sqrt(24));
  // holes
  [1, 2, 4, 8, 12, 24].forEach(n => { const f = refFuse(DM, MU, n), h = refHoles(f); facts['holes' + n] = h; ok('engine holes == reference at n=' + n, close(TS.holes(w, TS.field(FZ, n)), h, 1e-9)); });
}
{ // the noise part follows sigma / sqrt(n): 12 noise realisations
  const ratios = [], quad = [];
  for (let s = 0; s < 12; s++) {
    const dm = TS.depthMaps(w, SIG, 1000 + s), cur = refCurve(dm, MU);
    NS.forEach((n, k) => { if (n < 4) return; const noise = Math.sqrt(Math.max(0, cur[k].stat ** 2 - CUR0[k].stat ** 2)); ratios.push(noise / (SIG / Math.sqrt(n))); quad.push(cur[k].stat / Math.sqrt(CUR0[k].stat ** 2 + (SIG / Math.sqrt(n)) ** 2)); });
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => Math.sqrt(mean(a.map(v => (v - mean(a)) ** 2)));
  facts.noise_ratio_mean = mean(ratios); facts.noise_ratio_sd = sd(ratios); facts.quad_mean = mean(quad); facts.quad_min = Math.min(...quad); facts.quad_max = Math.max(...quad);
  ok('error^2 = floor^2 + (sigma/sqrt n)^2 within 25% for n >= 4', facts.quad_min > 0.75 && facts.quad_max < 1.3, [facts.quad_min, facts.quad_max]);
  ok('the noise part is about sigma/sqrt n', Math.abs(facts.noise_ratio_mean - 1) < 0.15, facts.noise_ratio_mean);
  // slope of the noise part between n = 4 and n = 24, averaged over the realisations
}
lap('curves');

/* ── 6b. what the floor is made of: the voxels or the depth maps' pixels?  A fresh fusion (written once more, parameterised) with other voxel sizes and other camera resolutions ── */
{
  const floorFor = (Hs, Wpx, f) => {
    const NGx = Math.round(6.8 / Hs) + 1, cams = FL.orbit(24, RING, 0, 0, { f, W: Wpx, start: 0.13 });
    const rend = cams.map(c => FL.render(SC, c)), dm = cams.map((c, v) => FL.noisyDepth(c, rend[v], { kind: 'stereo', f, b: FB / f, sd: 0 }, FL.rng(SEED + v)));
    const S1 = new Float64Array(NGx * NGx), S0 = new Float64Array(NGx * NGx);
    for (let k = 0; k < 24; k++) {
      const v = ORDER[k], cam = cams[v];
      for (let j = 0; j < NGx; j++) for (let i = 0; i < NGx; i++) {
        const p = FL.project(cam, X0 + i * Hs, X0 + j * Hs); if (p.zc < 0.3) continue;
        const px = Math.floor(p.u); if (px < 0 || px >= Wpx || dm[v][px] <= 0) continue;
        let d = dm[v][px] - p.zc; if (d < -MU) continue; if (d > MU) d = MU;
        const wt = (ZREF / dm[v][px]) ** 4; S1[j * NGx + i] += wt * d; S0[j * NGx + i] += wt;
      }
    }
    let q = 0, c = 0; const add = (x, z) => { const r = refDist(x, z); if (r.id === 0) { q += r.d * r.d; c++; } };
    const Dv = a => S1[a] / S0[a];
    for (let j = 0; j < NGx; j++) for (let i = 0; i < NGx - 1; i++) { const a = j * NGx + i, b = a + 1; if (S0[a] > 0 && S0[b] > 0 && (Dv(a) < 0) !== (Dv(b) < 0)) add(X0 + (i + Dv(a) / (Dv(a) - Dv(b))) * Hs, X0 + j * Hs); }
    for (let i = 0; i < NGx; i++) for (let j = 0; j < NGx - 1; j++) { const a = j * NGx + i, b = a + NGx; if (S0[a] > 0 && S0[b] > 0 && (Dv(a) < 0) !== (Dv(b) < 0)) add(X0 + i * Hs, X0 + (j + Dv(a) / (Dv(a) - Dv(b))) * Hs); }
    return 100 * Math.sqrt(q / c);
  };
  facts.floor_same = floorFor(H, WPX, F); facts.floor_h25 = floorFor(0.025, WPX, F); facts.floor_w128 = floorFor(H, 2 * WPX, 2 * F);
  ok('the parameterised fusion reproduces the floor', close(facts.floor_same, CUR0[9].stat, 2e-3), [facts.floor_same, CUR0[9].stat]);
  ok('a finer voxel grid does not lower the floor', facts.floor_h25 > 0.9 * facts.floor_same, [facts.floor_h25, facts.floor_same]);
  ok('twice the pixels per camera lower the floor by a third or more', facts.floor_w128 < 0.7 * facts.floor_same, [facts.floor_w128, facts.floor_same]);
}
{ // inverse-variance weights against equal weights, truncation ablations
  const ur = [];
  for (let s = 0; s < 12; s++) { const dm = TS.depthMaps(w, SIG, 1000 + s); const a = refErr(refCross(refFuse(dm, MU, 24))).stat, b = refErr(refCross(refFuse(dm, MU, 24, { uniform: true }))).stat; ur.push(b / a); }
  facts.uniform_ratio = ur.reduce((x, y) => x + y, 0) / ur.length; facts.uniform_ratio_min = Math.min(...ur); facts.uniform_pct = 100 * (facts.uniform_ratio - 1); facts.uniform_pct_min = 100 * (facts.uniform_ratio_min - 1);
  ok('equal weights are worse than inverse-variance weights on every realisation', facts.uniform_ratio_min > 1.0, facts.uniform_ratio_min);
  const e0 = CUR[9], eNoClip = refErr(refCross(refFuse(DM, MU, 24, { noclip: true }))), eNoSkip = refCross(refFuse(DM, MU, 24, { noskip: true }));
  facts.abl_mle = e0.stat; facts.abl_noclip = eNoClip.stat; facts.abl_noclip_ratio = eNoClip.stat / e0.stat;
  const eNS = refErr(eNoSkip), statueVerts = eNoSkip.filter(p => refDist(p[0], p[1]).id === 0).length;
  facts.abl_noskip_worst = eNS.worst / 100; facts.abl_noskip_statue_verts = statueVerts;
  ok('without abstaining the statue is destroyed', eNS.worst > 50, eNS.worst);
}
lap('ablations');

/* ── 5. Monte Carlo: the maximum-likelihood average on a wall cell ── */
{
  const rng = FL.rng(11), trials = 4000, sg = SIG;
  const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const ns = [1, 2, 4, 8, 16, 32, 64], lx = [], ly = [];
  ns.forEach(n => {
    const Ds = []; for (let t = 0; t < trials; t++) { let s1 = 0, s0 = 0; for (let k = 0; k < n; k++) { const d = sg * FL.randn(rng); s1 += d; s0 += 1; } Ds.push(s1 / s0); }
    const s = std(Ds); facts['wall_n' + n] = s; lx.push(Math.log(n)); ly.push(Math.log(s)); ok('wall: std of the mean at n=' + n + ' is sigma/sqrt n', Math.abs(s / (sg / Math.sqrt(n)) - 1) < 0.05, s);
  });
  const mx = lx.reduce((a, b) => a + b) / lx.length, my = ly.reduce((a, b) => a + b) / ly.length; let sxy = 0, sxx = 0; lx.forEach((x, k) => { sxy += (x - mx) * (ly[k] - my); sxx += (x - mx) ** 2; });
  facts.wall_slope = sxy / sxx; ok('wall: log-log slope is -1/2', Math.abs(facts.wall_slope + 0.5) < 0.05, facts.wall_slope);
  // unequal noise (the stereo law): three views at 4.85, 6 and 7.15 m; inverse-variance weights against equal weights
  const sig3 = [4.85, 6, 7.15].map(z => sg * (z / ZREF) ** 2), wts = sig3.map(s => 1 / (s * s)), W3 = wts.reduce((a, b) => a + b, 0);
  const A = [], B = [];
  for (let t = 0; t < 20000; t++) { const d = sig3.map(s => s * FL.randn(rng)); A.push(d.reduce((s, v, k) => s + wts[k] * v, 0) / W3); B.push(d.reduce((s, v) => s + v, 0) / 3); }
  facts.ex3_mle_std = 1 / Math.sqrt(W3); facts.ex3_eq_std = Math.sqrt(sig3.reduce((s, v) => s + v * v, 0)) / 3; facts.ex3_mle_mc = std(A); facts.ex3_eq_mc = std(B);
  ok('inverse-variance std is 1/sqrt(W)', Math.abs(facts.ex3_mle_mc / facts.ex3_mle_std - 1) < 0.03, [facts.ex3_mle_mc, facts.ex3_mle_std]);
  ok('equal weights std matches its formula', Math.abs(facts.ex3_eq_mc / facts.ex3_eq_std - 1) < 0.03);
  // the weighted mean minimises the weighted squared error: golden-section on  sum w (d - D)^2
  const d0 = sig3.map(s => s * FL.randn(rng)), Jf = D => d0.reduce((s, v, k) => s + wts[k] * (v - D) ** 2, 0); let a = -50, b = 50;
  for (let it = 0; it < 120; it++) { const c = b - (b - a) / 1.618033988749895, d = a + (b - a) / 1.618033988749895; if (Jf(c) < Jf(d)) b = d; else a = c; }
  ok('the weighted mean is the least-squares minimiser', close((a + b) / 2, d0.reduce((s, v, k) => s + wts[k] * v, 0) / W3, 1e-6));
}
lap('monte carlo');

/* ── 6. reading the surface: normals, sphere tracing, occupancy as the alternative ── */
const FLD = TS.field(FZ, 24), REF24 = refFuse(DM, MU, 24);
{
  const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
  const eS = [], eD = [], eO = [], nS = [], nO = [], cS = { n: 0 }, cO = { n: 0 }; let none = 0, rays = 0, dis = 0;
  for (let c = 0; c < 24; c++) for (let i = 0; i < WPX; i++) {
    const tt = TTRUE[c][i], r = FL.pixelRay(TEST[c], i + 0.5), o = [r.ox, r.oz], d = [r.dx, r.dz];
    const h = refTrace(REF24, o, d, cS), eng = TS.trace(FLD, r.ox, r.oz, r.dx, r.dz, 14), dense = refTraceDense(REF24, o, d); rays++;
    if (h.hit !== eng.hit || (h.hit && Math.abs(h.t - eng.t) > 1e-4)) dis++;
    // occupancy: nearest node's sign, marched every half cell
    let t = 0, occHit = null; const hiB = X0 + (NG - 1) * H;
    for (; t < 14; t += H / 2) { const x = o[0] + d[0] * t, z = o[1] + d[1] * t; if (x < X0 || x > hiB || z < X0 || z > hiB) continue; cO.n++; const i0 = Math.round((x - X0) / H), j0 = Math.round((z - X0) / H), a = j0 * NG + i0; if (REF24.Wt[a] > 0 && REF24.D[a] < 0) { occHit = t; break; } }
    if (tt < 0) continue;
    if (!h.hit) none++; else { eS.push(100 * Math.abs(h.t - tt)); if (dense.hit) eD.push(100 * Math.abs(h.t - dense.t)); }
    if (occHit !== null) eO.push(100 * Math.abs(occHit - tt));
    if (h.hit) { // normal of the field at the hit against the true normal
      const x = o[0] + d[0] * h.t, z = o[1] + d[1] * h.t, g = [bil(REF24, x + H, z) - bil(REF24, x - H, z), bil(REF24, x, z + H) - bil(REF24, x, z - H)], tn = FL.normal(SC, x, z), l = Math.hypot(g[0], g[1]);
      if (l > 0 && !Number.isNaN(l)) nS.push(Math.acos(Math.max(-1, Math.min(1, (g[0] * tn.x + g[1] * tn.z) / l))) * 180 / Math.PI);
    }
    if (occHit !== null) { const x = o[0] + d[0] * occHit, z = o[1] + d[1] * occHit, occ = (px, pz) => { const i0 = Math.round((px - X0) / H), j0 = Math.round((pz - X0) / H), a = j0 * NG + i0; return REF24.Wt[a] > 0 && REF24.D[a] < 0 ? 1 : 0; };
      const g = [occ(x - H, z) - occ(x + H, z), occ(x, z - H) - occ(x, z + H)], l = Math.hypot(g[0], g[1]), tn = FL.normal(SC, x, z); if (l > 0) nO.push(Math.acos(Math.max(-1, Math.min(1, (g[0] * tn.x + g[1] * tn.z) / l))) * 180 / Math.PI); }
  }
  ok('engine sphere tracing == the lesson\'s rule written again', dis === 0, dis);
  facts.hit_med = pct(eS, 0.5); facts.hit_p90 = pct(eS, 0.9); facts.hit_none = none; facts.hit_dense_diff_p99 = pct(eD, 0.99);
  ok('sphere tracing agrees with a dense march (p99 within 1 cm)', facts.hit_dense_diff_p99 < 1.0, facts.hit_dense_diff_p99);
  facts.occ_med = pct(eO, 0.5); facts.occ_p90 = pct(eO, 0.9); facts.sdf_normal = pct(nS, 0.5); facts.occ_normal = pct(nO, 0.5);
  facts.sdf_lookups = cS.n / rays; facts.occ_lookups = cO.n / rays;
  ok('the field beats the occupancy bits on first hit', facts.hit_med < facts.occ_med && facts.sdf_normal < facts.occ_normal);
  // the gradient length at the surface (a true signed distance has 1)
  const gl = []; for (const p of refCross(REF24)) { const g = [bil(REF24, p[0] + H, p[1]) - bil(REF24, p[0] - H, p[1]), bil(REF24, p[0], p[1] + H) - bil(REF24, p[0], p[1] - H)]; const l = Math.hypot(g[0], g[1]) / (2 * H); if (!Number.isNaN(l)) gl.push(l); }
  facts.grad_med = pct(gl, 0.5);
  // the fused surface seen by every held-out ray
  const sEx = refSurfaceExam(REF24, 24, 'const'), eng = TS.exam(w, { kind: 'const', fld: FLD }, 24);
  ok('engine surface exam == reference', eng.far === sEx.far && eng.near === sEx.near && eng.empty === sEx.empty && close(eng.psnr, sEx.psnr, 1e-6), [eng.wrong, sEx.wrong, eng.psnr, sEx.psnr]);
  facts.s24_wrong = sEx.wrong; facts.s24_wrong_n = sEx.far + sEx.near + sEx.empty;
}
lap('tracing');

/* ── 7. choosing mu; the narrowest gap; corners; a thin plate ── */
{
  const B0 = FL.boundary(SC.shapes[0], 6000), B1 = FL.boundary(SC.shapes[1], 6000); let best = Infinity;
  for (const p of B0) for (const q of B1) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d < best) best = d; }
  facts.gap_cm = 100 * best; facts.gap_half = 50 * best;
  for (const mu of [0.04, 0.06, 0.10, 0.15, 0.30]) { const e = refErr(refCross(refFuse(DM, mu, 24))); const k = Math.round(mu * 100); facts['mu' + k + '_rms'] = e.stat; facts['mu' + k + '_worst'] = e.worst; }
  const e20 = refErr(refCross(refFuse(DM, 0.2, 24))); facts.mu20_worst = e20.worst; facts.mu20_rms = e20.stat;
  const e0 = refErr(refCross(refFuse(DM0, 0.06, 24))); facts.mu6_worst0 = e0.worst; const e0b = refErr(refCross(refFuse(DM0, 0.20, 24))); facts.mu20_worst0 = e0b.worst;
  // the engine agrees on one of them
  const engE = TS.surfaceError(w, TS.crossings(TS.field(TS.fuse(w, DM, 0.06), 24))); ok('engine mu=6 cm error == reference', close(engE.stat, facts.mu6_rms, 2e-3), [engE.stat, facts.mu6_rms]);
  // a thin plate: width of the region D < 0 across a 4 cm plate, as mu grows
  const plate = (t, mu) => {
    const sc = { shapes: [FL.box(0, 0, 0.6, t / 2, [0.8, 0.5, 0.3], {})], light: [-0.5, 0.8], amb: 0.3, bg: [1, 1, 1], far: 20, stepScale: 0.6 };
    const cams = FL.orbit(24, RING, 0, 0, { f: F, W: WPX, start: 0.13 }), rend = cams.map(c => FL.render(sc, c));
    const dm = cams.map((c, v) => FL.noisyDepth(c, rend[v], { kind: 'stereo', f: F, b: FB / F, sd: SIG / 100 * FB / (ZREF * ZREF) }, FL.rng(1000 + v)));
    const f = refFuse(dm, mu, 24, { cams }); let sum = 0, cnt = 0;
    for (const xc of [-0.4, -0.2, 0, 0.2, 0.4]) { let len = 0; for (let z = -0.6; z <= 0.6; z += 0.002) { const D = bil(f, xc + 0.013, z); if (!Number.isNaN(D) && D < 0) len += 0.002; } sum += len; cnt++; }
    return 100 * sum / cnt;
  };
  facts.plate_6 = plate(0.04, 0.06); facts.plate_10 = plate(0.04, 0.10); facts.plate_20 = plate(0.04, 0.20); facts.plate_30 = plate(0.04, 0.30);
}
lap('mu');

/* ── 8. marching squares and marching cubes: counting the classes ── */
{
  // squares: 16 sign patterns of the four corners, classes under rotation of the cell and swapping inside/outside
  const rot2 = [1, 2, 3, 0]; // corner k -> rot2[k]
  const cls2 = new Set(); for (let m = 0; m < 16; m++) { let best = 99; for (let flip = 0; flip < 2; flip++) { let cur = flip ? (~m & 15) : m; for (let r = 0; r < 4; r++) { best = Math.min(best, cur); let nxt = 0; for (let k = 0; k < 4; k++) if (cur & (1 << k)) nxt |= 1 << rot2[k]; cur = nxt; } } cls2.add(best); }
  facts.ms_cases = 16; facts.ms_classes = cls2.size;
  // cubes: corner k has coordinates (x, y, z) = bits of k; generate the rotation group of the cube as permutations of the 8 corners
  const coords = k => [k & 1, (k >> 1) & 1, (k >> 2) & 1].map(v => 2 * v - 1);
  const idx = c => (c[0] > 0 ? 1 : 0) | (c[1] > 0 ? 2 : 0) | (c[2] > 0 ? 4 : 0);
  const rx = c => [c[0], -c[2], c[1]], ry = c => [c[2], c[1], -c[0]], rz = c => [-c[1], c[0], c[2]], mirror = c => [-c[0], c[1], c[2]];
  const perm = f => Array.from({ length: 8 }, (_, k) => idx(f(coords(k)))), compose = (p, q) => p.map((_, k) => p[q[k]]);
  const id8 = [0, 1, 2, 3, 4, 5, 6, 7], key = p => p.join(',');
  const grow = gens => { const seen = new Map([[key(id8), id8]]); let frontier = [id8]; while (frontier.length) { const nx = []; for (const p of frontier) for (const g of gens) { const q = compose(g, p); if (!seen.has(key(q))) { seen.set(key(q), q); nx.push(q); } } frontier = nx; } return [...seen.values()]; };
  const rotations = grow([perm(rx), perm(ry), perm(rz)]), full = grow([perm(rx), perm(ry), perm(rz), perm(mirror)]);
  const classes = group => { const s = new Set(); for (let m = 0; m < 256; m++) { let best = 999; for (const flip of [0, 1]) for (const p of group) { const mm = flip ? (~m & 255) : m; let nm = 0; for (let k = 0; k < 8; k++) if (mm & (1 << k)) nm |= 1 << p[k]; best = Math.min(best, nm); } s.add(best); } return s.size; };
  ok('the cube has 24 rotations and 48 symmetries', rotations.length === 24 && full.length === 48, [rotations.length, full.length]);
  facts.mc_cases = 256; facts.mc_rot = classes(rotations); facts.mc_full = classes(full); facts.mc_nonempty = facts.mc_rot - 1;
  ok('marching cubes: 15 classes under rotation and inside/outside swap (14 non-empty), 14 if mirror images are identified', facts.mc_rot === 15 && facts.mc_full === 14 && facts.ms_classes === 4, [facts.mc_rot, facts.mc_full, facts.ms_classes]);
}
lap('marching');

/* ── 9. the exit: the surface against the cloud, colour against geometry ── */
{
  const sConst = refSurfaceExam(REF24, 24, 'const'), sCopy = refSurfaceExam(REF24, 24, 'copy'), tConst = refSurfaceExam(null, 24, 'trueconst'), tCopy = refSurfaceExam(null, 24, 'truecopy');
  const eK = TS.exam(w, { kind: 'copy', fld: FLD }, 24), eT = TS.exam(w, { kind: 'trueconst' }, 24), eTK = TS.exam(w, { kind: 'truecopy' }, 24);
  ok('engine copy exam == reference', close(eK.psnr, sCopy.psnr, 1e-6), [eK.psnr, sCopy.psnr]);
  ok('engine true-surface exams == reference', close(eT.psnr, tConst.psnr, 1e-6) && close(eTK.psnr, tCopy.psnr, 1e-6));
  facts.x_const = sConst.psnr; facts.x_copy = sCopy.psnr; facts.x_true_const = tConst.psnr; facts.x_true_copy = tCopy.psnr;
  facts.x_points = facts.pp24n; facts.x_points_wrong = facts.pw24n; facts.x_surf_wrong = sConst.wrong; facts.x_surf_right = 100 - sConst.wrong;
  facts.x_gain = facts.x_const - facts.x_points;                       // what the 31 % -> 1.8 % improvement in geometry buys in dB
  facts.x_copy_big = sCopy.bigPx; facts.x_copy_bigshare = sCopy.bigShare; facts.x_copy_silshare = sCopy.silShare;
  facts.x_true_copy_bigshare = tCopy.bigShare; facts.x_copy_bigsil = sCopy.bigSil;
  ok('all but one high-error pixel of the copied colours sit at a silhouette (a neighbouring pixel shows another object); the one left is on the crate (shape 1), at its edge between a lit and a shaded face', sCopy.bigPx - sCopy.bigSil === 1 && sCopy.bigOff.length === 1 && sCopy.bigOff[0].id === 1, [sCopy.bigSil, sCopy.bigPx, JSON.stringify(sCopy.bigOff)]);
  const e4 = refSurfaceExam(refFuse(DM, MU, 4), 4, 'const'), e4k = refSurfaceExam(refFuse(DM, MU, 4), 4, 'copy');
  facts.x4_const = e4.psnr; facts.x4_copy = e4k.psnr; facts.x4_wrong = e4.wrong;
  const e4p = refPointExam(refCloud(DM, 4), 1); facts.x4_points_wrong = e4p.wrong; facts.x4_points = e4p.psnr;
  ok('geometry is right but a colourless surface is no better than the cloud: the true surface with one colour is the ceiling', tConst.psnr < sCopy.psnr && sConst.psnr < tConst.psnr + 0.01, [sConst.psnr, tConst.psnr]);
  // PSNR depends on the geometry only weakly once the geometry is roughly right
  ok('the cloud with its own colours scores about the same as the best colourless surface', Math.abs(facts.x_points - tConst.psnr) < 3);
}
lap('exit');

/* ── 10. the limit: poses that are not exactly right ── */
{
  const perturb = (posCm, rotDeg) => { const rng = FL.rng(21); return TRAIN.map(c => FL.camera({ x: c.x + posCm / 100 * FL.randn(rng), z: c.z + posCm / 100 * FL.randn(rng), a: c.a + rotDeg * Math.PI / 180 * FL.randn(rng), f: c.f, W: c.W })); };
  facts.pose_rms = refErr(refCross(refFuse(DM, MU, 24, { cams: perturb(2, 0.2) }))).stat;
  facts.pose_rms2 = refErr(refCross(refFuse(DM, MU, 24, { cams: perturb(5, 0.5) }))).stat;
  ok('wrong poses blur the surface, more so the worse they are', facts.pose_rms > 1.3 * CUR[9].stat && facts.pose_rms2 > 3 * CUR[9].stat, [facts.pose_rms, facts.pose_rms2]);
}
lap('poses');

/* ── 11. the checkpoint (pencil) ── */
{
  const sg = [2, 3, 4], d = [2.0, -1.0, 4.0], wt = sg.map(s => 1 / (s * s)), W3 = wt.reduce((a, b) => a + b, 0), D = wt.reduce((s, v, k) => s + v * d[k], 0) / W3;
  facts.ck_w1 = wt[0]; facts.ck_w2 = wt[1]; facts.ck_w3 = wt[2]; facts.ck_W = W3; facts.ck_D = D; facts.ck_sd = 1 / Math.sqrt(W3);
  facts.ck_mean = d.reduce((a, b) => a + b, 0) / 3; facts.ck_mean_sd = Math.sqrt(sg.reduce((s, v) => s + v * v, 0)) / 3;
  facts.ck_share1 = 100 * wt[0] / W3; facts.ck_share3 = 100 * wt[2] / W3;
}

/* ── 11b. why the vote is clipped in front: the largest unclipped vote, noise-free, at an outside node within 20 cm of a surface ── */
{
  let mx = 0;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const x = X0 + i * H, z = X0 + j * H;
    if (FL.sdf(SC, x, z) <= 0 || refDist(x, z).d > 0.2) continue;
    for (let v = 0; v < 24; v++) {
      const p = FL.project(TRAIN[v], x, z); if (p.zc < 0.3) continue;
      const px = Math.floor(p.u); if (px < 0 || px >= WPX || DM0[v][px] <= 0) continue;
      mx = Math.max(mx, DM0[v][px] - p.zc);
    }
  }
  facts.far_vote = mx; ok('a node close to a surface can receive a vote of metres', mx > 1.5, mx);
}

/* ── 12. the small tools the widget draws with: votes, probe, zero set, normal ── */
{
  const pr = TS.probe(w, 3), tr = refDist(pr.x, pr.z);
  ok('the probe lies on the true surface', tr.d < 2e-3, tr.d);
  const V = TS.votesAt(w, DM, MU, 24, pr.x, pr.z); let s1 = 0, s0 = 0, cnt = 0;
  for (let k = 0; k < 24; k++) {
    const v = ORDER[k], p = FL.project(TRAIN[v], pr.x, pr.z), px = Math.floor(p.u);
    if (p.zc < 0.3 || px < 0 || px >= WPX || DM[v][px] <= 0) continue;
    let d = DM[v][px] - p.zc; if (d < -MU) continue; if (d > MU) d = MU;
    const wt = (ZREF / DM[v][px]) ** 4; s1 += wt * d; s0 += wt; cnt++;
  }
  ok('votesAt == the weighted mean of the individual votes', V.votes.length === cnt && close(V.D, s1 / s0, 1e-12) && close(V.W, s0, 1e-9), [V.votes.length, cnt, V.D, s1 / s0]);
  const seg = TS.zeroSet(FLD), cr = refCross(REF24); let off = 0;
  for (let k = 0; k < seg.length; k += 2) { let best = Infinity; for (const q of cr) { const d = Math.hypot(q[0] - seg[k], q[1] - seg[k + 1]); if (d < best) best = d; } off = Math.max(off, best); }
  ok('every vertex of the marching-squares polyline is a grid-edge crossing', off < 1e-5, off);
  let nrm = 0; for (let k = 0; k < Math.min(cr.length, 120); k++) {
    const q = cr[k], g = [bil(REF24, q[0] + H, q[1]) - bil(REF24, q[0] - H, q[1]), bil(REF24, q[0], q[1] + H) - bil(REF24, q[0], q[1] - H)], l = Math.hypot(g[0], g[1]), nn = TS.normal(FLD, q[0], q[1]);
    if (!nn || Number.isNaN(l)) continue; nrm = Math.max(nrm, Math.abs(nn.x - g[0] / l) + Math.abs(nn.z - g[1] / l));
  }
  ok('engine normal == central difference of the reference field', nrm < 1e-4, nrm);
}

/* ── 13. drive the page's own widget into each state "What to try" describes ── */
const page = loadPage(path.join(DIR, '06_points_to_surface.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function refState(n, sg, mu) {
  const dm = TS.depthMaps(w, sg), f = refFuse(dm, mu, n), f0 = refFuse(DM0, mu, n), e = refErr(refCross(f)), e0 = refErr(refCross(f0)), P = refCloud(dm, n), pe = refPointExam(P, 1);
  const sc = refSurfaceExam(f, n, 'const'), sk = refSurfaceExam(f, n, 'copy'), st = refSurfaceExam(null, n, 'trueconst');
  return { err: e.stat, line: sg / Math.sqrt(n), floor: e0.stat, worst: e.worst, holes: refHoles(f), pts: P.length, pw: pe.wrong, sw: sc.wrong, pp: pe.psnr, cp: sc.psnr, kp: sk.psnr, tp: st.psnr };
}
function drive(n, sg, mu, cam, view) {
  page.set('w06-view', view || 'field'); page.set('w06-cam', cam || 4); page.set('w06-mu', mu); page.set('w06-sig', sg); page.set('w06-n', n);
  const g = k => page.num('w06-m-' + k);
  return { err: g('err'), line: g('line'), floor: g('floor'), worst: g('worst'), holes: g('holes'), pw: g('pw'), sw: g('sw'), pp: g('pp'), cp: g('cp'), kp: g('kp'), tp: g('tp') };
}
function same(label, ref, got) {
  const tol = { err: 0.006, line: 0.006, floor: 0.006, worst: 0.06, holes: 0.06, pw: 0.06, sw: 0.06, pp: 0.06, cp: 0.06, kp: 0.06, tp: 0.06 };
  for (const k of Object.keys(tol)) ok(label + ': widget ' + k + ' == oracle', close(got[k], ref[k], tol[k]), [got[k], ref[k]]);
}
const STATES = { A: [4, 3, 10], B: [24, 3, 10], C: [24, 0, 10], D: [24, 8, 10], D2: [24, 8, 15], D3: [24, 8, 25], E1: [24, 3, 4], E2: [24, 3, 30], G: [12, 3, 10], H: [1, 3, 10] };
const REFS = {};
for (const [name, [n, sg, mu]] of Object.entries(STATES)) { REFS[name] = refState(n, sg, mu / 100); same('state ' + name, REFS[name], drive(n, sg, mu)); }
{
  const ex = drive(24, 3, 10, 4, 'exam'); same('exam view', REFS.B, ex);
  page.set('w06-cam', 20); page.set('w06-cam', 1);
  facts.pn4 = REFS.A.pts;   // the cloud of the page's opening state is the cloud of section 1
}
{   // the page as it opens (a fresh instance, no control touched) is state A
  const fresh = loadPage(path.join(DIR, '06_points_to_surface.html'), { dpr: 1 });
  const got = {}; ['err', 'line', 'floor', 'worst', 'holes', 'pw', 'sw', 'pp', 'cp', 'kp', 'tp'].forEach(k => { got[k] = fresh.num('w06-m-' + k); });
  same('as opened', REFS.A, Object.assign({ pts: REFS.A.pts }, got));
  ok('the opening controls are 4 views, 3 cm, mu = 10 cm', fresh.num('w06-n-v') === 4 && fresh.num('w06-sig-v') === 3 && fresh.num('w06-mu-v') === 10, [fresh.num('w06-n-v'), fresh.num('w06-sig-v'), fresh.num('w06-mu-v')]);
  ok('the fresh page ran without errors', fresh.problems.length === 0, fresh.problems.join(' | '));
}
// the facts "What to try" quotes
facts.A_err = REFS.A.err; facts.A_line = REFS.A.line; facts.A_floor = REFS.A.floor; facts.A_holes = REFS.A.holes; facts.A_worst = REFS.A.worst; facts.A_pts = REFS.A.pts; facts.A_pw = REFS.A.pw; facts.A_sw = REFS.A.sw;
facts.A_pp = REFS.A.pp; facts.A_cp = REFS.A.cp; facts.A_kp = REFS.A.kp; facts.A_tp = REFS.A.tp;
facts.B_err = REFS.B.err; facts.B_line = REFS.B.line; facts.B_floor = REFS.B.floor; facts.B_worst = REFS.B.worst; facts.B_holes = REFS.B.holes; facts.B_pts = REFS.B.pts; facts.B_pw = REFS.B.pw; facts.B_sw = REFS.B.sw;
facts.B_pp = REFS.B.pp; facts.B_cp = REFS.B.cp; facts.B_kp = REFS.B.kp; facts.B_tp = REFS.B.tp; facts.B_quad = Math.hypot(REFS.B.floor, REFS.B.line);
facts.C_err = REFS.C.err; facts.C_pw = REFS.C.pw; facts.C_sw = REFS.C.sw; facts.C_pp = REFS.C.pp; facts.C_cp = REFS.C.cp;
facts.D3_err = REFS.D3.err; facts.D2_err = REFS.D2.err; facts.D2_worst = REFS.D2.worst; facts.D2_sw = REFS.D2.sw; facts.D_err = REFS.D.err; facts.D_line = REFS.D.line; facts.D_quad = Math.hypot(REFS.D.floor, REFS.D.line); facts.D_pw = REFS.D.pw; facts.D_sw = REFS.D.sw;
facts.E1_err = REFS.E1.err; facts.E1_worst = REFS.E1.worst; facts.E2_err = REFS.E2.err; facts.E2_worst = REFS.E2.worst; facts.E2_holes = REFS.E2.holes;
facts.G_holes = REFS.G.holes; facts.H_holes = REFS.H.holes; facts.H_err = REFS.H.err;
ok('the widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

if (process.env.ORACLE_DEBUG) console.error(JSON.stringify(facts, null, 1));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
