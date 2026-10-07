#!/usr/bin/env node
'use strict';
/* Oracle for synthetic_vision lesson 05 (cover the cases).
 *
 * Re-derives every number the lesson quotes, with its own code (it never loads l05_cases.js; the page does):
 *   - the ground-plane law and the ruler's rows by brute force: a pedestrian is moved through the scene at 0.01 m steps, the street's renderer draws him, and the foot row is read off the
 *     outline; the rows' distance intervals, the half-row error table and the band edges come from the transitions (and are compared with the closed form);
 *   - its own labeller and ruler (foot row, "touches a nearer vehicle", visible fraction) on the 3,000 test frames and on an independent 12,000-frame sample (seeds 15,500,000 +): the ruler
 *     against the street's own record (LAB PRIVILEGE: the oracle reads scene.ped, mode, full), the step-out call (tp / fp / fn), the cell shares and the coverage, against the builder's 40,000-frame pool;
 *   - the counting arithmetic: (1 - p)^n by simulation, the rule of three, the standard deviation of the coverage against n (formula, the pool's draws and its own);
 *   - the component table, the estimated-stage table and the clutter sweep from the builder's data (l05_data.js), tied to the series' table cells (abba and bbba are retrained by the builder and
 *     must equal tables.js to the last digit), the compounding and "the meter sees the background" claims as checks with tolerances;
 *   - the estimates of the nine labelled samples of the repair (its own estimator), and ONE estimated-stage program trained from scratch (n = 200, seed 1) against the stored cell;
 *   - the frequency of the close step-out by 10^6 scene draws (its own stream), the stratified close-step-out and close-open exams with its own rejection sampler and the series' seed-1 bbba model;
 *   - the widget, driven through the states the prose names, against its own count on the first n frames of the labelled budget.
 * Where it compares an estimate with the street's truth (SV.REAL, scene.ped, mode) it says so: that is the lab's privilege.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'synthetic_vision_new')) ? 'synthetic_vision_new' : 'synthetic_vision';
const SV = require(path.join(root, dir, 'street.js'));
require(path.join(root, dir, 'tables.js'));
require(path.join(root, dir, 'l05_data.js'));
const T = SV.TABLES, D = SV.L05;
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) fail(m + ': ' + a + ' vs ' + b + ' (tol ' + tol + ')'); };
const F = {};
const put = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 6 : d); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); };
const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const C = SV.CAM, W = C.W, H = C.H, HW = W * H, f0 = C.f, V0 = C.V0, hc = C.hc, FHC = f0 * hc;
const pc = (x) => 100 * x;

/* ───────────── 0. the settings the prose quotes, read from the lab's own specs ───────────── */
{
  const R = SV.REAL.scene, S = SV.SIM0.scene;
  check(f0 === 83.1 && V0 === 9 && hc === 1.4 && W === 96 && H === 24, 'camera: 96 x 24, f = 83.1 px, horizon on row 9, height 1.4 m');
  check(S.z[0] === 8 && S.z[1] === 16 && R.z[0] === 8 && R.z[1] === 24, 'distance ranges: 8 to 16 m (program), 8 to 24 m (street)');
  check(S.pEmerge === 0 && Math.abs(R.pVan * R.pEmerge - 0.28) < 1e-9, 'step-out probability: 0 (program), 0.28 (street: a van in 0.8 of the frames, 0.35 of them step out)');
  check(R.van.z[0] === 5 && R.van.z[1] === 18 && S.van.z[0] === 8 && S.van.z[1] === 12 && R.pVan === 0.8 && S.pVan === 1, 'van: 5 to 18 m and in 80% of the frames (street), 8 to 12 m and always (program)');
  check(R.clutter === 2 * S.clutter && R.pRed === 0.1 && S.pRed === 0, 'clutter: twice the program\'s, a tenth of the poles red');
  check(R.h[0] === 1.5 && R.h[1] === 1.9 && SV.EXAM.minArea === 6 && SV.EXAM.fa === 0.1, 'pedestrian heights 1.5 to 1.9 m; the exam counts pedestrians with at least 6 px^2 at 10% false alarms');
  check(/pPed = 0\.02/.test(String(SV.real.logs)), 'the unlabelled frames hold a pedestrian with probability 0.02 (one frame in fifty), as Lesson 2 says');
}

/* ───────────── 1. the law and its rows, by brute force ───────────── */
put('fhc', FHC, 1);
put('ex_z', FHC / (16.75 - V0), 1);
put('err_8', pc(8 * 0.5 / FHC), 1); put('err_16', pc(16 * 0.5 / FHC), 1); put('err_24', pc(24 * 0.5 / FHC), 1); put('shift_24', 24 * 24 * 0.5 / FHC, 1);
const rLeg = (() => { const sc = SV.drawScene(SV.SIM0.scene, SV.stream(11, 'l05oracle'), { ped: true }); return sc.ped.parts[0].r; })();
function footRowAt(zAxis, x) {
  const sc = SV.drawScene(SV.SIM0.scene, SV.stream(11, 'l05oracle'), { ped: true });
  sc.parts.forEach((p) => { if (p.cls === 'ped') { p.x = x; p.z = zAxis; } });
  const look = SV.drawLook(SV.SIM0.look, sc, SV.stream(11, 'l05look')), ren = SV.render(sc, look, { maps: true });
  let jb = -1;
  for (let j = H - 1; j >= 0 && jb < 0; j--) for (let i = 0; i < W; i++) if (ren.cov[j * W + i] >= 0.5) { jb = j; break; }
  return jb;
}
{
  const trans = {};                       // row -> [lowest and highest front-of-leg depth that reads it]
  const bnd = (zf) => { const k = Math.round(V0 + FHC / zf - 0.25); return Math.abs(zf - FHC / (k + 0.25 - V0)); };   // distance (m) from the nearest row boundary of the law
  let n = 0, mism = 0, worst = 0;
  for (let z = 7.9; z <= 25.0001; z += 0.01) {
    const jb = footRowAt(z, 0), zf = z - rLeg, vf = V0 + FHC / zf, closed = Math.ceil(vf - 0.25) - 1;
    if (z <= 24.5) { n++; if (closed !== jb) { mism++; worst = Math.max(worst, bnd(zf)); } }
    (trans[jb] = trans[jb] || [Infinity, -Infinity]);
    trans[jb][0] = Math.min(trans[jb][0], zf); trans[jb][1] = Math.max(trans[jb][1], zf);
  }
  // the closed form (the foot is in the lowest row whose lower quarter it reaches) is exact up to a thin leg's partial coverage: it can disagree only within 0.15 m of a row boundary
  check(worst < 0.15, 'the foot row of a pedestrian placed at 0.01 m steps equals the closed form ceil(v - 0.25) - 1 except within 0.15 m of a row boundary: ' + mism + ' of ' + n + ' differ, worst ' + worst.toFixed(3) + ' m from a boundary');
  for (const jb of [22, 20, 18, 16, 14]) {
    const lo = FHC / (jb + 1.25 - V0), hi = FHC / (jb + 0.25 - V0), z = FHC / (jb + 0.75 - V0), t = trans[jb];
    check(t && Math.abs(t[0] - lo) < 0.15 && Math.abs(t[1] - hi) < 0.15, 'row ' + jb + ': the brute-force interval ' + (t && t[0].toFixed(2)) + '..' + (t && t[1].toFixed(2)) + ' matches the law ' + lo.toFixed(2) + '..' + hi.toFixed(2) + ' within 0.15 m');
    put('r' + jb + '_z', z, 1); put('r' + jb + '_lo', lo, 1); put('r' + jb + '_hi', hi, 1); put('r' + jb + '_pm', pc((hi - lo) / 2 / z), 1);
  }
  put('edge0', FHC / (18.25 - V0), 2); put('edge1', FHC / (16.25 - V0), 2); put('edge2', FHC / (14.25 - V0), 1);
  const e0 = FHC / (18.25 - V0), e1 = FHC / (16.25 - V0), e2 = FHC / (14.25 - V0);
  check(Math.abs(trans[17][0] - e0) < 0.15 && Math.abs(trans[15][0] - e1) < 0.15 && Math.abs(trans[13][0] - e2) < 0.15, 'the band edges are where the brute-force foot row changes (within 0.15 m)');
  check(Math.abs(F.edge1 - 16) < 0.06, 'the 16 m limit of the program falls on a row boundary (16.05 m)');
  check(trans[13][1] >= 23.9, 'the street\'s farthest pedestrian (axis 24 m, front of the leg 23.8 m) still gives a foot row (row 13 holds depths up to ' + trans[13][1].toFixed(1) + ' m)');
}
put('w16', f0 * 0.5 / 16, 1);

/* ───────────── 2. its own labeller and ruler ───────────── */
const countsUnderSpec = (fr) => fr.scene.ped && fr.area >= Math.max(1, 0.15 * fr.full);
function outline(fr) {
  const out = { ped: null, veh: null };
  if (countsUnderSpec(fr)) { const m = new Uint8Array(HW); let n = 0; for (let q = 0; q < HW; q++) if (fr.cov[q] >= 0.5) { m[q] = 1; n++; } if (n) out.ped = m; }
  if (fr.scene.van) { const m = new Uint8Array(HW); let n = 0; for (let q = 0; q < HW; q++) if (fr.id[q] === fr.scene.van.id) { m[q] = 1; n++; } if (n) out.veh = m; }
  return out;
}
const bandOfReading = (z) => z < F.edge0 ? 0 : z < F.edge1 ? 1 : z < F.edge2 ? 2 : 3;
function readFrame(fr) {                    // the oracle's ruler: scans, not the page's code
  const o = outline(fr); if (!o.ped) return null;
  let jb = -1, jt = H;
  for (let j = H - 1; j >= 0; j--) for (let i = 0; i < W; i++) if (o.ped[j * W + i]) { if (jb < 0) jb = j; jt = j; }
  let step = false;
  if (o.veh) {
    const bot = new Array(W).fill(-1);
    for (let i = 0; i < W; i++) for (let j = H - 1; j >= 0; j--) if (o.veh[j * W + i]) { bot[i] = j; break; }
    for (let j = 0; j < H && !step; j++) for (let i = 0; i < W && !step; i++) if (o.ped[j * W + i]) {
      for (let c = Math.max(0, i - 1); c <= Math.min(W - 1, i + 1) && !step; c++) {
        let touches = false; for (let r = Math.max(0, j - 1); r <= Math.min(H - 1, j + 1); r++) if (o.veh[r * W + c]) touches = true;
        if (touches && bot[c] >= jb) step = true;
      }
    }
  }
  const z = FHC / (jb + 0.75 - V0), area = fr.area;
  return { jb: jb, jt: jt, z: z, step: step, area: area, exam: area >= SV.EXAM.minArea, band: bandOfReading(z), cell: 2 * bandOfReading(z) + (step ? 1 : 0), fr: fr };
}
const truthZ = (fr) => fr.scene.ped.parts[0].z;

const test = SV.real.test(3000), tr = test.map(readFrame);
{
  const ex = test.map((fr, i) => ({ fr: fr, r: tr[i] })).filter((o) => o.r && o.r.exam);
  put('n_exam', ex.length, 0);
  check(ex.length === 1323, 'the exam counts 1,323 pedestrians in the test set (' + ex.length + ')');
  let tp = 0, fp = 0, fn = 0; ex.forEach((o) => { const t = o.fr.mode === 'emerge'; if (o.r.step && t) tp++; else if (o.r.step) fp++; else if (t) fn++; });
  put('touch_tp', tp, 0); put('touch_all', tp + fn, 0); put('touch_fp', fp, 0);
  check(fp === 0 && fn === 0, 'the touch test finds every step-out and calls no other pedestrian (tp ' + tp + ', fp ' + fp + ', fn ' + fn + ')');
  // the groups of lesson section 1 (lab privilege: the street's own record)
  const near_ = ex.filter((o) => o.fr.mode === 'open' && truthZ(o.fr) <= 16), far_ = ex.filter((o) => o.fr.mode === 'open' && truthZ(o.fr) > 16), stp_ = ex.filter((o) => o.fr.mode === 'emerge');
  put('g_near_share', pc(near_.length / ex.length), 1); put('g_far_share', pc(far_.length / ex.length), 1); put('g_step_share', pc(stp_.length / ex.length), 1);
  // the ruler against the street's truth, by band of the reading
  const openEx = ex.filter((o) => o.fr.mode === 'open');
  for (let b = 0; b < 4; b++) { const s = openEx.filter((o) => o.r.band === b); put('zerr_b' + b, sd(s.map((o) => o.r.z - truthZ(o.fr))), 1); }
  put('zbias', -mean(openEx.filter((o) => o.r.band <= 1).map((o) => o.r.z - truthZ(o.fr))), 1);
  check(F.zerr_b0 < F.zerr_b1 && F.zerr_b1 < F.zerr_b2 && F.zerr_b3 < F.zerr_b2, 'the ruler loses resolution with distance (sd of the error rises over the first three bands; the fourth holds only the street\'s last 2 m, 22.2 to 24)');
  // visible fraction
  const A0 = quant(openEx.map((o) => o.r.area * Math.pow(o.r.z / f0, 2)), 0.5), phi = (o) => o.r.area / (A0 * Math.pow(f0 / o.r.z, 2));
  put('A0', A0, 2); put('phi_open', mean(openEx.map(phi)), 2); put('phi_open_sd', sd(openEx.map(phi)), 2); put('phi_step', mean(stp_.map(phi)), 2);
  const xs = stp_.map((o) => Math.min(1.2, phi(o))), ys = stp_.map((o) => o.fr.area / o.fr.full), mx = mean(xs), my = mean(ys);
  put('phi_corr', xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((s, x) => s + (x - mx) * (x - mx), 0) * ys.reduce((s, y) => s + (y - my) * (y - my), 0)), 2);
  check(F.phi_open > 0.85 && F.phi_open < 1.05 && F.phi_step < F.phi_open - 0.1 && F.phi_corr > 0.7, 'the area-based visible fraction reads open pedestrians near 1 and step-outs lower, and tracks the truth');
  // the width of the outline is not a usable ruler for visibility at 16 m: open pedestrians there have outlines 2, 3 or 4 columns wide
  const w16 = openEx.filter((o) => truthZ(o.fr) >= 15 && truthZ(o.fr) <= 17).map((o) => { let u0 = W, u1 = -1; const m = outline(o.fr).ped; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (m[j * W + i]) { u0 = Math.min(u0, i); u1 = Math.max(u1, i); } return u1 - u0 + 1; });
  check(w16.length > 50 && Math.min(...w16) >= 2 && Math.max(...w16) <= 4, 'open pedestrians at 15 to 17 m have outlines 2, 3 or 4 columns wide (' + w16.length + ' of them: ' + [2, 3, 4, 5].map((k) => k + ':' + w16.filter((x) => x === k).length).join(' ') + ')');
  // the height ruler (road not taken), calibrated against the foot row; relative error by true band
  const hpx = (o) => o.r.jb - o.r.jt + 0.5, H0 = mean(openEx.map((o) => hpx(o) * o.r.z / f0)), zh = (o) => f0 * H0 / hpx(o);
  const bandTrue = (z) => z < F.edge0 ? 0 : z < F.edge1 ? 1 : z < F.edge2 ? 2 : 3;
  for (const b of [0, 3]) { const s = openEx.filter((o) => bandTrue(truthZ(o.fr)) === b); put('rel_foot_b' + b, pc(sd(s.map((o) => (o.r.z - truthZ(o.fr)) / truthZ(o.fr)))), 0); put('rel_h_b' + b, pc(sd(s.map((o) => (zh(o) - truthZ(o.fr)) / truthZ(o.fr)))), 0); }
  const hs = openEx.map((o) => o.fr.scene.ped.parts[2].y1); put('h_body', pc(sd(hs) / mean(hs)), 0);
  check(F.rel_h_b0 > F.rel_foot_b0 && F.rel_h_b3 > F.rel_foot_b3, 'the height ruler is worse than the foot row in the nearest and the farthest band');
}

/* ───────────── 3. an independent 12,000-frame sample against the builder's pool ───────────── */
const N12 = 12000, own = [];
for (let i = 0; i < N12; i++) { const fr = SV.sample(SV.REAL, 15500000 + i); own.push({ fr: fr, r: readFrame(fr) }); }
const ownEx = own.filter((o) => o.r && o.r.exam), cnt8 = new Array(8).fill(0); ownEx.forEach((o) => cnt8[o.r.cell]++);
const ownShare = cnt8.map((c) => c / ownEx.length), P = D.pool;
{
  for (let c = 0; c < 8; c++) near(ownShare[c], P.share[c], 0.022, 'cell ' + c + ': own share vs the 40,000-frame pool');
  const q0 = D.q.none.share, cover = (sh, q) => sh.reduce((s, x, c) => s + (q[c] >= 0.01 ? x : 0), 0);
  near(cover(ownShare, q0), P.cover, 0.022, 'coverage: own sample vs pool');
  check(D.q.none.share.slice(4).every((x) => x === 0) && D.q.none.share.filter((x, c) => c % 2 === 1).every((x) => x === 0), 'the naive program draws nothing beyond 16 m and nothing stepping out');
  for (let c = 0; c < 8; c++) { put('p' + c, pc(P.share[c]), 1); put('q' + c, pc(D.q.none.share[c]), 1); }
  put('cover_pool', pc(P.cover), 1); put('beyond_pool', pc(P.beyond), 1); put('step_pool', pc(P.step), 1); put('pool_exam', P.nExam, 0);
  put('cover_truth', pc(P.truth.near), 1); put('beyond_truth', pc(P.truth.far), 1); put('step_truth', pc(P.truth.step), 1);
  put('cover_gap', pc(P.cover - P.truth.near), 1);
  const qp = D.q['dist+emerge'].share; put('q7_pair', pc(qp[7]), 1); put('cover_pair_pool', pc(cover(P.share, qp)), 0);
  check(qp[7] < 0.01 && qp[1] >= 0.01 && qp.every((x, c) => c === 7 || x >= 0.01), 'with the distance range and the step-outs repaired the program fills every cell but the farthest step-outs (' + pc(qp[7]).toFixed(2) + '% of its pedestrians)');
  const tN = ownEx.filter((o) => o.fr.mode === 'open' && truthZ(o.fr) <= 16).length / ownEx.length;       // lab privilege
  near(tN, P.truth.near, 0.022, 'the truth coverage: own sample vs pool');
  check(P.cover > P.truth.near && P.cover - P.truth.near < 0.03, 'the ruler reads the coverage a little high: the pedestrians at 16.0 to 16.25 m sit in the program\'s last row');
  near(P.step, P.truth.step, 0.002, 'the step-out share by the ruler equals the street\'s');
  // outlines a frame, the cost of labelling
  let outl = 0, vans = 0; own.forEach((o) => { const l = outline(o.fr); if (l.ped) outl++; if (l.veh) { outl++; vans++; } });
  put('outl_frame', outl / N12, 1); put('van_share', pc(vans / N12), 0); put('outl_100', 100 * outl / N12, 0);
  put('ped_frame', pc(P.nExam / P.pool), 0); put('ped_frame_x', P.nExam / P.pool, 2);
  near(ownEx.length / N12, P.nExam / P.pool, 0.012, 'exam pedestrians per frame');
  // the whiskers: the percentile bootstrap (200 resamples, rng 7) of blocks of 100 frames contains the pool value in about four draws out of five
  function boot(cells, B, q) {
    const rng = SV.rng(7), n = cells.length, out = [];
    for (let b = 0; b < B; b++) { const c = new Array(8).fill(0); for (let i = 0; i < n; i++) c[cells[Math.floor(rng() * n)]]++; out.push(c.map((x) => x / n)); }
    const stat = (g, p) => { const v = out.map(g).sort((a, b2) => a - b2); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
    return { cells: [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [stat((s) => s[c], 0.1), stat((s) => s[c], 0.9)]), cover: [stat((s) => cover(s, q), 0.1), stat((s) => cover(s, q), 0.9)],
             beyond: [stat((s) => s[4] + s[5] + s[6] + s[7], 0.1), stat((s) => s[4] + s[5] + s[6] + s[7], 0.9)], step: [stat((s) => s[1] + s[3] + s[5] + s[7], 0.1), stat((s) => s[1] + s[3] + s[5] + s[7], 0.9)] };
  }
  global.__boot = boot;
  let hit = 0, K = 0;
  for (let k = 0; k < 120; k++) { const cells = own.slice(k * 100, (k + 1) * 100).filter((o) => o.r && o.r.exam).map((o) => o.r.cell), bb = boot(cells, 200, q0); K++; if (bb.cover[0] <= P.cover && P.cover <= bb.cover[1]) hit++; }
  put('whisk_cover', pc(hit / K), 0);
  check(F.whisk_cover > 62 && F.whisk_cover < 95, 'the 10-90% whiskers hold the pool value in about 80% of 100-frame draws (' + F.whisk_cover + '%)');
}

/* ───────────── 4. counting: (1 - p)^n, the rule of three, the error against n ───────────── */
{
  const fr1 = P.cellFrames[1], pcm = P.share[4] * P.nExam / P.pool;                       // per-frame probabilities of the rarest and of the commonest cell
  put('ln20', Math.log(20), 1); put('one_in_cell', 1 / fr1, 0); put('pf_common', pc(pcm), 1);
  put('n95_common', Math.log(0.05) / Math.log(1 - pcm), 0); put('n95_cell', Math.log(0.05) / Math.log(1 - fr1), 0);
  check(Math.abs(F.n95_cell - 3 / fr1) / F.n95_cell < 0.03 && Math.abs(F.n95_common - 3 / pcm) / F.n95_common < 0.08, 'the rule of three: n = ln 20 / -ln(1 - p) is within a few per cent of 3/p');
  near(fr1, own.filter((o) => o.r && o.r.exam && o.r.cell === 1).length / N12, 0.0025, 'the rarest cell per frame: own sample vs pool');
  put('abs_100', pc(Math.pow(1 - fr1, 100)), 0); put('abs_400', pc(Math.pow(1 - fr1, 400)), 0);
  // simulation of (1 - p)^n with the lab's generator
  const rng = SV.rng(5);
  for (const n of [100, 200, 400]) { let miss = 0; const trials = 4000; for (let t = 0; t < trials; t++) { let seen = false; for (let i = 0; i < n && !seen; i++) if (rng() < fr1) seen = true; if (!seen) miss++; } near(miss / trials, Math.pow(1 - fr1, n), 0.03, '(1 - p)^n by simulation at n = ' + n); }
  // the pool's own blocks: the share of draws with no nearest-band step-out
  for (const n of [100, 400]) near(P.curve[n].noneCell, Math.pow(1 - fr1, n), 0.05, 'the pool\'s blocks of ' + n + ' frames lacking the rarest cell, vs (1 - p)^n');
  const c0 = P.cover, per = P.nExam / P.pool;
  for (const n of [25, 50, 100, 200, 400, 800]) {
    const sdf = Math.sqrt(c0 * (1 - c0) / (per * n)), sdp = P.curve[n].cover.sd;
    put('sdf_' + n, pc(sdf), 1); put('sd_' + n, pc(sdp), 1);
    check(Math.abs(sdf - sdp) / sdp < 0.15, 'the standard deviation of the coverage over draws of ' + n + ' frames matches the binomial formula (' + pc(sdp).toFixed(1) + ' vs ' + pc(sdf).toFixed(1) + ')');
  }
  // the extremes of a sample: the farthest and the nearest open pedestrian read
  const zhi = (blk) => Math.max(...blk.filter((o) => o.r && o.r.exam && !o.r.step).map((o) => o.r.z), 0);
  let cut = 0, Kb = 0; for (let k = 0; k + 50 <= N12; k += 50) { Kb++; if (zhi(own.slice(k, k + 50)) <= 20.5) cut++; }
  put('zhi_cut_50', pc(cut / Kb), 0);
  check(F.zhi_cut_50 >= 5 && F.zhi_cut_50 <= 25, 'with 50 frames the farthest open pedestrian reads 20.3 m or less in a sizeable share of draws');
  near(P.curve[50].zhi.lo, 20.32, 0.06, 'the pool\'s 10th percentile of the farthest reading at n = 50 is the row-14 reading (20.2 m) plus the bias correction');
  check(P.curve[25].zlo.med > 8.9 && P.curve[200].zhi.sd === 0, 'with 25 frames the nearest reading is usually above 9 m; from 200 frames the range is stable');
  put('zlo_25_med', P.curve[25].zlo.med, 1);
}

/* ───────────── 5. the component table, the repair and the sweep: from the builder's data, tied to the series' tables ───────────── */
const mm = (a) => pc(mean(a));
const swap = (c, f) => T.swap[c][f];
put('scene_before', pc(mean(swap('aaaa', 'realMiss')) - mean(swap('baaa', 'realMiss'))), 1);
put('scene_after', pc(mean(swap('abba', 'realMiss')) - mean(swap('bbba', 'realMiss'))), 1);
put('m_abba', mm(swap('abba', 'realMiss')), 1); put('m_bbba', mm(swap('bbba', 'realMiss')), 1);
put('l_abba', mm(swap('abba', 'logsAlarm')), 1); put('l_bbba', mm(swap('bbba', 'logsAlarm')), 1);
put('open_aaaa', mm(swap('aaaa', 'missOpen')), 1); put('open_abba', mm(swap('abba', 'missOpen')), 1); put('open_gain', F.open_aaaa - F.open_abba, 1);
put('step_aaaa', mm(swap('aaaa', 'missEmerge')), 1); put('step_abba', mm(swap('abba', 'missEmerge')), 1);
check(F.step_abba - F.step_aaaa < 1.5 && F.open_gain > 15, 'camera and light repaired the open pedestrians and left the step-outs');
// the builder retrained abba and bbba (the exact stages): the cells of tables.js must be reproduced to the last digit
for (const wh of ['abba', 'bbba']) D.models[wh].realMiss.forEach((v, s) => near(v, T.swap[wh].realMiss[s], 1e-9, wh + ' seed ' + (s + 1) + ': the builder reproduces the table cell'));
{
  const M = D.models, S3 = (a) => a.length;
  check(M.abba.realMiss.length === 3 && M.bbba.realMiss.length === 3, 'three seeds of each exact-stage detector');
  put('g_near_abba', mm(M.abba.near), 1); put('g_far_abba', mm(M.abba.far), 1); put('g_step_abba', mm(M.abba.step), 1);
  put('g_near_bbba', mm(M.bbba.near), 1); put('g_far_bbba', mm(M.bbba.far), 1); put('g_step_bbba', mm(M.bbba.step), 1);
  near(F.g_step_abba, F.step_abba, 0.06, 'the step-out group of the model jobs equals the table\'s missEmerge');
  check(F.g_near_abba < F.g_far_abba && F.g_far_abba < F.g_step_abba + 8 && F.g_near_bbba < F.g_far_bbba, 'both detectors are best on the near open pedestrians and worse beyond');
  put('far_abba', F.g_far_abba, 1); put('far_bbba', F.g_far_bbba, 1); put('step_bbba', F.g_step_bbba, 1);
  // component rows
  const row = (nm) => D.comp[nm], names = { dist: 'dist', emerge: 'emerge', pair: 'dist+emerge', clutter: 'clutter', van: 'van', body: 'body' };
  Object.keys(names).forEach((k) => {
    const c = row(names[k]); check(c.realMiss.length === 3, names[k] + ': three seeds');
    put('m_' + k, mm(c.realMiss), 1); put('g_' + k, F.m_abba - F['m_' + k], 1); put('l_' + k, mm(c.logs), 1); put('far_' + k, mm(c.far), 1); put('step_' + k, mm(c.step), 1);
  });
  put('g_all', F.m_abba - F.m_bbba, 1);
  put('m_pair_clutter', mm(row('dist+emerge+clutter').realMiss), 1); put('m_pvc', mm(row('dist+emerge+van+clutter').realMiss), 1);
  put('g_extra', F.g_pair - F.g_dist - F.g_emerge, 1); put('g_cl_after', F.m_pair - F.m_pair_clutter, 1); put('g_van_after', F.m_pair_clutter - F.m_pvc, 1);
  put('m_pair_range', pc(Math.max(...row('dist+emerge').realMiss) - Math.min(...row('dist+emerge').realMiss)), 1);
  // the claims of the prose
  check(F.g_dist > 3 && F.g_emerge > 1 && F.g_pair > F.g_dist + F.g_emerge + 0.5, 'the distance range and the step-outs compound (' + F.g_dist + ' + ' + F.g_emerge + ' < ' + F.g_pair + ')');
  check(F.g_cl_after > 3 * Math.max(F.g_clutter, 0.5), 'the clutter is worth several times more once the pedestrians are right (' + F.g_clutter + ' alone, ' + F.g_cl_after + ' after)');
  check(Math.abs(F.l_dist - F.l_abba) < 3 && Math.abs(F.l_emerge - F.l_abba) < 3 && Math.abs(F.l_pair - F.l_abba) < 3 && Math.abs(F.l_body - F.l_abba) < 3, 'the meter does not move for the pedestrian settings');
  check(F.l_clutter < F.l_abba - 7 && F.l_van < F.l_abba - 7, 'the meter moves for the clutter and the van');
  check(Math.abs(F.m_van - F.m_abba) < 2.2 && F.g_clutter < 4, 'the van and the clutter alone move the exam little');
  check(F.far_dist < F.far_abba - 5 && F.far_emerge > F.far_abba - 4 && F.step_emerge < F.step_abba - 1 && F.step_dist > F.step_abba - 3, 'a group improves when its own data arrives: the distance range lowers the far open miss, the step-outs the step-out miss');
  // the sweep (one seed): the meter keeps falling past the street's clutter
  const sw = (l) => D.sweep.find((x) => x.lam === l), d1 = D.comp['dist+emerge'];
  put('sw_05_logs', pc(d1.logs[0]), 1); put('sw_05_miss', pc(d1.realMiss[0]), 1);
  [[0.75, '075'], [1, '1'], [1.5, '15'], [2, '2']].forEach(([l, k]) => { put('sw_' + k + '_logs', pc(sw(l).logs), 1); put('sw_' + k + '_miss', pc(sw(l).realMiss), 1); });
  check(F.sw_05_logs > F.sw_075_logs && F.sw_075_logs > F.sw_1_logs && F.sw_1_logs > F.sw_15_logs && F.sw_15_logs > F.sw_2_logs, 'the meter falls as the clutter rises');
  check(F.sw_1_logs > 10.5 && F.sw_2_logs < 10, 'the meter crosses its nominal 10% only beyond the street\'s own clutter rate');
  // the repair from the ruler
  const cal = D.calib; put('calib_bias', cal.bias, 2); put('calib_kappa', cal.kappa, 2);
  const odds = P.step / (1 - P.step); put('e_full', odds / (odds + cal.kappa), 2);
  check(Math.abs(F.e_full - 0.28) < 0.03, 'the matched step-out probability is close to the street\'s 0.28');
  for (const n of [50, 200, 800]) {
    const e = D.est[n]; check(e.realMiss.length === 3, 'estimated program n = ' + n + ': three seeds');
    put('e' + n + '_m', mm(e.realMiss), 1); put('e' + n + '_gap', F['e' + n + '_m'] - F.m_pair, 1);
    put('e' + n + '_zlo', mean(e.zlo), 1); put('e' + n + '_zhi', mean(e.zhi), 1); put('e' + n + '_pe', mean(e.pEmerge), 2);
    if (n === 50) { put('e50_pe_min', Math.min(...e.pEmerge), 2); put('e50_pe_max', Math.max(...e.pEmerge), 2); put('e50_zhi_min', Math.min(...e.zhi), 1); put('e50_zhi_max', Math.max(...e.zhi), 1); put('e50_cut', e.zhi.filter((z) => z <= 20.6).length, 0); }
  }
  check(Math.abs(F.e200_gap) < 3 && Math.abs(F.e800_gap) < 3, 'with 200 and 800 labelled frames the estimated pedestrian settings are within the seed spread of the exact ones');
  // the estimates, re-derived with the oracle's own estimator on the nine labelled samples
  for (const n of [50, 200, 800]) for (let s = 1; s <= 3; s++) {
    const fr = SV.real.labeled(n, SV.SEEDS.labeled + 1000 * (s - 1)), rs = fr.map(readFrame).filter((r) => r && r.exam), open = rs.filter((r) => !r.step), z = open.map((r) => r.z - cal.bias);
    const share = (rs.length - open.length) / rs.length, o = share / (1 - share), pe = o / (o + cal.kappa);
    near(Math.min(...z), D.est[n].zlo[s - 1], 0.006, 'est ' + n + ' sample ' + s + ': nearest open reading'); near(Math.max(...z), D.est[n].zhi[s - 1], 0.006, 'est ' + n + ' sample ' + s + ': farthest open reading');
    near(pe, D.est[n].pEmerge[s - 1], 0.0006, 'est ' + n + ' sample ' + s + ': step-out probability');
  }
  // the exact-stage cells the repair is compared with are the series' cells
  near(F.m_bbba, pc(mean(T.swap.bbba.realMiss)), 0.0501, 'bbba is the table cell');
  // calibration: bias and kappa again, from the oracle's own run of a wide-range program
  {
    const pipe = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'a', look: 'a', sensor: 'a', label: 'a' }); pipe.scene.z = [8, 26]; pipe.scene.pEmerge = 0.3;
    const fr = SV.makeSet(pipe, 3000, 15600000), rs = fr.map(readFrame), err = [], c = new Array(2).fill(0);
    fr.forEach((x, i) => { const r = rs[i]; if (r && r.exam) { c[r.step ? 1 : 0]++; if (x.mode === 'open') err.push(r.z - truthZ(x)); } });
    near(mean(err), cal.bias, 0.12, 'the ruler\'s bias on the program\'s own frames'); const s = c[1] / (c[0] + c[1]);
    near((s / (1 - s)) / (0.3 / 0.7), cal.kappa, 0.1, 'kappa on the program\'s own frames');
  }
}

/* ───────────── 6. one estimated program trained from scratch ───────────── */
{
  const r5 = (x) => +Number(x).toPrecision(5), cal = D.calib, n = 200, s = 1;
  const fr = SV.real.labeled(n, SV.SEEDS.labeled + 1000 * (s - 1)), rs = fr.map(readFrame).filter((r) => r && r.exam), open = rs.filter((r) => !r.step), z = open.map((r) => r.z - cal.bias);
  const share = (rs.length - open.length) / rs.length, o = share / (1 - share), pe = o / (o + cal.kappa);
  const pipe = SV.hybrid(SV.SIM0, SV.REAL, { scene: 'a', look: 'b', sensor: 'b', label: 'a' });
  pipe.scene.z = [Math.min(...z), Math.max(...z)]; pipe.scene.pEmerge = Math.round(1e6 * pe) / 1e6;
  const m0 = SV.train(SV.makeSet(pipe, 1600, SV.SEEDS.train + s * 100000), { seed: s }), model = { dim: m0.dim, w: Array.from(m0.w, r5), mu: Array.from(m0.mu, r5), sd: Array.from(m0.sd, r5) };
  const val = SV.real.val(1500), sV = val.map((x) => SV.score(model, x.x).s), thr = SV.thrAtFPR(sV.filter((_, i) => !val[i].y), 0.1);
  let hits = 0, tot = 0; test.forEach((x) => { if (x.y && x.area >= 6) { tot++; if (SV.score(model, x.x).s > thr) hits++; } });
  near(1 - hits / tot, D.est[200].realMiss[0], 1e-4, 'the estimated program (200 labelled frames, seed 1), trained from scratch: miss rate');
}

/* ───────────── 7. the exit: how often, how many, how badly ───────────── */
{
  let close = 0, emerge = 0, ped = 0; const N = 1000000;
  for (let i = 0; i < N; i++) { const sc = SV.drawScene(SV.REAL.scene, SV.stream(15000000 + i, 'l05oracle-draws')); if (sc.ped) { ped++; if (sc.mode === 'emerge') { emerge++; if (truthZ({ scene: sc }) < 12) close++; } } }
  /* the exact probability of case R (LAB PRIVILEGE: the street's own scene law): P(pedestrian) P(van) P(step-out | van) P(z_van + hz_van + U(0.8, 9) < 12), midpoint quadrature over the two van variables;
     the same integral Lesson 6 uses, so the two lessons quote one frequency */
  const pExact = (() => { const CFG = SV.REAL.scene, v = CFG.van, K = 3000; let acc = 0; for (let i = 0; i < K; i++) { const z = v.z[0] + (i + 0.5) / K * (v.z[1] - v.z[0]); for (let j = 0; j < K; j++) { const hz = v.hz[0] + (j + 0.5) / K * (v.hz[1] - v.hz[0]), u = (12 - z - hz - 0.8) / (9 - 0.8); acc += u <= 0 ? 0 : u >= 1 ? 1 : u; } } return CFG.pPed * CFG.pVan * CFG.pEmerge * acc / (K * K); })();
  put('r_draws', N, 0); put('r_close', D.draws.close, 0); put('r_p', 100 * pExact, 3); put('r_one_in', 1 / pExact, 0); put('r_exp', 1600 * pExact, 1);
  near(close, D.draws.close, 4.5 * Math.sqrt(D.draws.close), 'the close step-outs in 10^6 scene draws: own stream vs the builder\'s');
  near(D.draws.close, N * pExact, 4.5 * Math.sqrt(N * pExact), 'the builder\'s 10^6 scene draws agree with the exact integral of the scene law');
  put('r_100', 100 / pExact, 0); put('r_100k', 100 / pExact / 1000, 1); put('r_accept', emerge / close, 0);
  check(Math.abs(F.r_one_in - 122) < 1, 'one frame in 122 holds a step-out nearer than 12 m (the exact integral; the 1 in 142 of the first draft of the baton was the test set\'s 21 in 3,000)');
  const h = D.models.bbba.held; put('r_h1', h[0], 0); put('r_h2', h[1], 0); put('r_h3', h[2], 0);
  check(h.every((x) => x >= 5 && x <= 22), 'the three training sets hold about thirteen close step-outs');
  // own rejection sampler, the series' seed-1 bbba model and abba model
  function stratum(kind, n, seed0) {
    const out = []; let s = seed0, tries = 0;
    while (out.length < n) { const sc = SV.drawScene(SV.REAL.scene, SV.stream(s, 'scene'), { ped: true, mode: kind }); tries++; if (sc.ped.parts[0].z < 12) out.push(SV.sample(SV.REAL, s, { ped: true, mode: kind })); s++; }
    return { frames: out, tries: tries };
  }
  const cs = stratum('emerge', 500, 15700000), co = stratum('open', 500, 15800000);
  put('r_accept_own', cs.tries / 500, 0);
  const grade = (model, thr, set) => { let n = 0, k = 0; set.forEach((x) => { if (x.y && x.area >= 6) { n++; if (SV.score(model, x.x).s <= thr) k++; } }); return { n: n, miss: k / n }; };
  for (const wh of ['bbba', 'abba']) {
    const m = T.models['swap@' + wh], model = { dim: 110, w: m.w, mu: m.mu, sd: m.sd }, a = grade(model, m.thrReal, cs.frames), b = grade(model, m.thrReal, co.frames);
    near(a.miss, D.models[wh].closeStep[0], 0.09, wh + ': miss on close step-outs, own sample (' + a.n + ') vs the builder\'s seed-1 cell'); near(b.miss, D.models[wh].closeOpen[0], 0.07, wh + ': miss on close open pedestrians, own sample vs the builder\'s');
    check(a.miss > b.miss + 0.25, wh + ': close step-outs are missed far more often than pedestrians as near in the open');
  }
  put('r_miss', mm(D.models.bbba.closeStep), 1); put('r_open', mm(D.models.bbba.closeOpen), 1); put('r_miss_abba', mm(D.models.abba.closeStep), 1); put('r_open_abba', mm(D.models.abba.closeOpen), 1);
  put('r_n', D.models.bbba.nCloseStep[0], 0);
  check(F.r_miss > F.r_open + 30, 'the exact-stage detector misses over 30 points more of the close step-outs than of the close open pedestrians');
}

/* ───────────── the checkpoint ───────────── */
{ const z = FHC / (20.75 - V0), lo = FHC / (21.25 - V0), hi = FHC / (20.25 - V0), p = 0.03 * (P.nExam / P.pool);
  put('ck_z', z, 1); put('ck_lo', lo, 1); put('ck_hi', hi, 1); put('ck_p', p, 4); put('ck_n', Math.log(0.05) / Math.log(1 - p), 0); put('ck_n3', 3 / p, 0); }

/* ───────────── the widget ───────────── */
{
  const page = loadPage(path.join(root, dir, '05_cover_the_cases.html'), { dpr: 2, console: { log() {}, warn() {}, error() {} } });
  check(page.problems.length === 0, 'the page runs clean: ' + page.problems.slice(0, 2).join(' | '));
  const NS = [25, 50, 100, 200, 400, 800], budget = SV.real.labeled(800), br = budget.map(readFrame);
  const progs = { none: 'none', dist: 'dist', emerge: 'emerge', both: 'dist+emerge', street: 'bbba' };
  function expected(n, prog) {
    const cells = br.slice(0, n).filter((r) => r && r.exam).map((r) => r.cell), cnt = new Array(8).fill(0); cells.forEach((c) => cnt[c]++);
    const sh = cnt.map((c) => c / cells.length), q = D.q[prog].share, cov = sh.reduce((s, x, c) => s + (q[c] >= 0.01 ? x : 0), 0), bb = global.__boot(cells, 200, q);
    return { n: cells.length, cov: cov, bb: bb, bey: sh[4] + sh[5] + sh[6] + sh[7], step: sh[1] + sh[3] + sh[5] + sh[7], rare: cnt[1] };
  }
  const pcts = (x) => Math.round(100 * x) + '%';
  function readCov(t) { const m = /^(\d+)% \((\d+)%-(\d+)%\)$/.exec(t); return m ? [+m[1], +m[2], +m[3]] : null; }
  function checkState(label, n, prog) {
    const e = expected(n, prog), got = readCov(page.text('w05-cov'));
    check(got && got[0] === Math.round(100 * e.cov) && got[1] === Math.round(100 * e.bb.cover[0]) && got[2] === Math.round(100 * e.bb.cover[1]), 'widget ' + label + ': coverage readout "' + page.text('w05-cov') + '" vs ' + pcts(e.cov) + ' (' + pcts(e.bb.cover[0]) + '-' + pcts(e.bb.cover[1]) + ')');
    check(page.text('w05-bey') === pcts(e.bey) && page.text('w05-step') === pcts(e.step), 'widget ' + label + ': beyond and step-out readouts "' + page.text('w05-bey') + '", "' + page.text('w05-step') + '"');
    check(page.text('w05-rare') === e.rare + ' (expect ' + (n * P.cellFrames[1]).toFixed(1) + ')', 'widget ' + label + ': nearest-band step-outs "' + page.text('w05-rare') + '"');
    return e;
  }
  page.set('w05-n', 2);
  let e = checkState('n=100', 100, 'none');
  put('w100_exam', e.n, 0); put('w100_cov', pc(e.cov), 0); put('w100_lo', pc(e.bb.cover[0]), 0); put('w100_hi', pc(e.bb.cover[1]), 0); put('w100_bey', pc(e.bey), 0); put('w100_step', pc(e.step), 0); put('w100_rare', e.rare, 0); put('w100_exp', 100 * P.cellFrames[1], 1);
  for (const [k, pr] of [['dist', 'dist'], ['emerge', 'emerge'], ['pair', 'dist+emerge'], ['bbba', 'bbba']]) { page.set('w05-prog', pr); const ee = checkState('n=100, program ' + pr, 100, pr); put('w100_cov_' + k, pc(ee.cov), 0); }
  page.set('w05-prog', 'none');
  page.set('w05-n', 5); e = checkState('n=800', 800, 'none'); put('w800_cov', pc(e.cov), 0); put('w800_lo', pc(e.bb.cover[0]), 0); put('w800_hi', pc(e.bb.cover[1]), 0);
  page.set('w05-n', 0); e = checkState('n=25', 25, 'none'); put('w25_cov', pc(e.cov), 0); put('w25_lo', pc(e.bb.cover[0]), 0); put('w25_hi', pc(e.bb.cover[1]), 0);
  page.set('w05-n', 2);
  // the strip: the first frame of the 300 whose cell is 0, 2, 4, 6, 3, 5; the chosen frame's reading
  const cells = [0, 2, 4, 6, 3, 5], strip = cells.map((c) => { for (let i = 0; i < 300; i++) if (br[i] && br[i].exam && br[i].cell === c) return i; return -1; }).filter((i) => i >= 0);
  check(strip.length === 6, 'the strip finds six frames in the first 300');
  const f3 = br[strip[2]], f5 = br[strip[4]];
  page.set('w05-fr', 2);
  check(page.text('w05-z').indexOf(f3.z.toFixed(1) + ' m (') === 0, 'widget: frame 3 reading "' + page.text('w05-z') + '" vs ' + f3.z.toFixed(1));
  put('w_f3_row', f3.jb, 0); put('w_f3_d', f3.jb + 0.75 - V0, 2); put('w_f3_z', f3.z, 1); put('w_f3_lo', FHC / (f3.jb + 1.25 - V0), 1); put('w_f3_hi', FHC / (f3.jb + 0.25 - V0), 1); put('w_f3_true', truthZ(f3.fr), 1);
  page.set('w05-fr', 4);
  const A0w = quant(br.slice(0, 100).filter((r) => r && r.exam && !r.step).map((r) => r.area * Math.pow(r.z / f0, 2)), 0.5), phi5 = f5.area / (A0w * Math.pow(f0 / f5.z, 2));
  check(f5.step && page.text('w05-z').indexOf(f5.z.toFixed(1) + ' m (') === 0 && page.text('w05-z').indexOf('stepping out') > 0 && page.text('w05-z').indexOf('visible ' + phi5.toFixed(2)) > 0, 'widget: frame 5 reading "' + page.text('w05-z') + '", phi ' + phi5.toFixed(2));
  put('w_f5_phi', phi5, 2);
  page.check('w05-truth', true); page.set('w05-fr', 2); page.set('w05-prog', 'bbba'); page.set('w05-n', 5);
  check(page.problems.length === 0, 'the widget survives the states the prose names: ' + page.problems.slice(0, 2).join(' | '));
}

if (bad) { console.error(bad + ' check(s) failed'); console.error('FACTS ' + JSON.stringify(F)); process.exit(1); }
console.log(JSON.stringify({ facts: F }));
