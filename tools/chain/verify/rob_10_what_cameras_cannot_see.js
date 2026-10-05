#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 10 (what cameras cannot see: contact and force).
 * Re-derives every number the lesson quotes with code written separately from insertion_lab.js: the funnel is a polygon and the contact is a nearest-point search over
 * its edges (the engine uses closed-form regions), the arm's spring is solved as a linear equation, the policies and the nearest-demo learner are rewritten (typed
 * arrays, brute force), the error function and the Wilson interval are its own, and the sensor-resolution, ceiling, coverage and first-contact arguments are checked
 * against closed forms.  Only BN.rng / BN.randn (the shared random stream) and the constants IL.P (the world's definition) come from the shared code.  Then it drives
 * the page's widget and checks that what it prints is what the independent computation gives.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const IL = require(path.join(root, dir, 'insertion_lab.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const P = IL.P, DT = P.dt, NS = P.ns, H = DT / NS, SLOPE = P.slope, SIG = Math.hypot(P.sigmaCam, P.sigmaArm);

/* ───── the constants the page states ───── */
check(P.K === 100 && P.kc === 1000 && P.mu === 0.15 && P.b === 1 && P.Flim === 20 && P.Z === 4 && P.z0 === 2 && P.v === 1 && P.T === 30, 'Bench constants: K, kc, mu, b, Flim, Z, z0, v, T');
check(P.sigmaCam === 0.5 && P.sigmaArm === 0.3 && P.sigmaLoad === 5 && P.sigmaF === 0.15 && P.Fpush === 10 && P.fdead === 0.4 && P.Cx === 0.35 && P.cd === 10 && DT === 0.05, 'Bench constants: sensors, load, push, admittance');
check(Math.abs(SLOPE - Math.tan(Math.PI / 6)) < 1e-12, 'the chamfer is 30 degrees');
const CZ = P.v / P.Fpush;

/* ───── mathematics written here ───── */
function erf(x) {                                       // Abramowitz and Stegun 7.1.26
  const s = x < 0 ? -1 : 1, t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const share = (half, s) => erf(half / (s * Math.SQRT2));
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const give = (K, mu) => P.Flim * (Math.sin(Math.PI / 6) - (mu === undefined ? P.mu : mu) * Math.cos(Math.PI / 6)) / K;

/* ───── the funnel as a polygon (u = |x| >= 0, z up); contact = nearest point on the three real edges ───── */
function funnel(c, kcScale) {
  const h0 = c / 2, w = h0 + P.b, s0 = -SLOPE * P.b;
  const poly = [[w + 100, 0], [w, 0], [h0, s0], [h0, -100], [w + 100, -100]];
  return { h0, w, poly, kc: P.kc * (kcScale || 1), segs: [[poly[0], poly[1]], [poly[1], poly[2]], [poly[2], poly[3]]] };
}
function inside(poly, px, pz) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function nearest(seg, px, pz) {
  const [[ax, az], [bx, bz]] = seg, dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return [ax + t * dx, az + t * dz];
}
function contactForce(G, mu, x, z, vx, vz) {
  const sg = x < 0 ? -1 : 1, u = Math.abs(x);
  if (!inside(G.poly, u, z)) return [0, 0];
  let bd = Infinity, bq = null;
  for (const seg of G.segs) { const q = nearest(seg, u, z), d = Math.hypot(q[0] - u, q[1] - z); if (d < bd) { bd = d; bq = q; } }
  const nu = bd > 1e-12 ? (bq[0] - u) / bd : 0, nz = bd > 1e-12 ? (bq[1] - z) / bd : 1, N = G.kc * bd;
  const vt = sg * vx * (-nz) + vz * nu, fr = -mu * N * Math.tanh(vt / P.vreg);        // friction along the tangent (-nz, nu)
  return [sg * (N * nu + fr * (-nz)), N * nz + fr * nu];
}

/* ───── one attempt, written out ───── */
function attempt(G, mu, pol, e0, FL, rn, Kscale, keep) {
  const nT = Math.round(P.T / DT), Kt = pol.K * (Kscale || 1);
  let x = e0, z = P.z0, vx = 0, vz = 0, xc = 0, zc = P.z0, fx = 0, fz = 0, peak = 0, out = 'timeout', steps = nT, first = -1;
  const tr = keep ? [] : null;
  for (let t = 0; t < nT; t++) {
    const u = pol.act({ t, z, d: xc, fx, fz });
    if (tr) tr.push({ x, z, fx, fz, d: xc, u });
    xc += u[0] * DT; zc += u[1] * DT;
    let cf = [0, 0];
    for (let s = 0; s < NS; s++) {
      cf = contactForce(G, mu, x, z, vx, vz);
      const xn = (x * P.cd / H + Kt * (e0 + xc) + FL + cf[0]) / (P.cd / H + Kt), zn = (z * P.cd / H + Kt * zc + cf[1]) / (P.cd / H + Kt);
      vx = (xn - x) / H; vz = (zn - z) / H; x = xn; z = zn;
    }
    const Fm = Math.hypot(cf[0], cf[1]); if (Fm > peak) peak = Fm; if (first < 0 && Fm > 0.5) first = t;
    fx = cf[0] + P.sigmaF * BN.randn(rn); fz = cf[1] + P.sigmaF * BN.randn(rn);
    if (Fm > P.Flim) { out = 'jam'; steps = t + 1; break; }
    if (z <= -P.Z) { out = 'in'; steps = t + 1; break; }
  }
  return { out, steps, time: steps * DT, peak, e0, first, tr };
}
function holes(N, seed, load) {                         // the N holes of an evaluation: the same for every policy
  const rh = BN.rng(seed), out = [];
  for (let k = 0; k < N; k++) { const e0 = SIG * BN.randn(rh), FL = P.sigmaLoad * (load === undefined ? 1 : load) * BN.randn(rh); out.push([e0, FL]); }
  return out;
}
function evaluate(c, polFor, N, seed, o) {
  o = o || {}; const G = funnel(c, o.kcScale), mu = o.mu === undefined ? P.mu : o.mu, rn = BN.rng(seed + 7919), hs = holes(N, seed, o.load), rolls = [];
  let nin = 0, njam = 0, nto = 0, psum = 0, tsum = 0, asum = 0;
  for (let k = 0; k < N; k++) {
    const r = attempt(G, mu, polFor(k), hs[k][0], hs[k][1], rn, o.Kscale, o.keep); rolls.push(r);
    if (r.out === 'in') { nin++; tsum += r.time; } else if (r.out === 'jam') njam++; else nto++;
    psum += r.peak; asum += r.time;
  }
  const ci = wilson(nin, N);
  return { N, succ: nin / N * 100, jam: njam / N * 100, to: nto / N * 100, peak: psum / N, time: nin ? tsum / nin : NaN, attempt: asum / N, lo: ci[0] * 100, hi: ci[1] * 100, rolls };
}

/* ───── policies ───── */
const holdP = (K) => ({ K, act: () => [0, -P.v] });
const yieldP = () => ({ K: P.K, act: (ob) => {
  const uz = Math.max(-P.v, Math.min(P.v, -CZ * (P.Fpush - ob.fz))), f = ob.fx, d = Math.abs(f) < P.fdead ? 0 : f - Math.sign(f) * P.fdead;
  return [P.Cx * d, uz];
} });
const yieldG = (cx, dead) => ({ K: P.K, act: (ob) => {                          // the same rule with another sideways gain or dead band
  const uz = Math.max(-P.v, Math.min(P.v, -CZ * (P.Fpush - ob.fz))), f = ob.fx, d = Math.abs(f) < dead ? 0 : f - Math.sign(f) * dead;
  return [cx * d, uz];
} });
const HB_POS = [1.5, 1.0], HB_FORCE = [1.5, 1.0, 0.6, 1.5];
function thin(rolls, withForce) {                       // keep a frame once the observation has moved half a bandwidth since the last kept frame of its run
  const hb = withForce ? HB_FORCE : HB_POS, X = [], Y = [];
  for (const r of rolls) {
    let last = null;
    for (const s of r.tr) {
      const ob = withForce ? [s.z, s.d, s.fx, s.fz] : [s.z, s.d];
      if (!last || ob.some((v, j) => Math.abs(v - last[j]) > 0.5 * hb[j])) { X.push(ob); Y.push(s.u); last = ob; }
    }
  }
  return { X, Y };
}
function learner(fr, withForce) {                       // kernel-weighted mean of the stored actions, three bandwidths; nearest stored frame beyond that
  const hb = withForce ? HB_FORCE : HB_POS, d = hb.length, n = fr.X.length, X = new Float64Array(n * d), Y = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { for (let j = 0; j < d; j++) X[i * d + j] = fr.X[i][j]; Y[2 * i] = fr.Y[i][0]; Y[2 * i + 1] = fr.Y[i][1]; }
  return { K: P.K, n, act: (ob) => {
    const q = withForce ? [ob.z, ob.d, ob.fx, ob.fz] : [ob.z, ob.d]; let tot = 0, a0 = 0, a1 = 0, best = Infinity, bi = 0;
    for (let i = 0; i < n; i++) {
      let e = 0; for (let j = 0; j < d; j++) { const t = (X[i * d + j] - q[j]) / hb[j]; e += t * t; }
      if (e < best) { best = e; bi = i; }
      if (e <= 9) { const w = Math.exp(-0.5 * e); tot += w; a0 += w * Y[2 * i]; a1 += w * Y[2 * i + 1]; }
    }
    return tot < 1e-12 ? [Y[2 * bi], Y[2 * bi + 1]] : [a0 / tot, a1 / tot];
  } };
}
const demoRuns = (m, seed) => evaluate(1, () => yieldP(), m, seed, { keep: true }).rolls;
const sideOf = (r) => { if (r.first < 0) return 0; return r.tr[Math.min(r.tr.length - 1, r.first)].x > 0 || r.e0 > 0 ? 1 : -1; };

/* ───── the entry: holding a position at one millimetre ───── */
const SEED = 5, NW = 200;
F.sigma_pose = SIG;
const lat = P.K * P.kc / (P.K + P.kc);                  // arm and wall in series, sideways
F.lat_k = lat; F.res_um = P.sigmaF / lat * 1000; F.res_ratio = P.sigmaCam / (P.sigmaF / lat);
F.give100 = give(100); F.give1000 = give(1000); F.give10 = give(10);
F.fx_per_n = Math.sin(Math.PI / 6) - P.mu * Math.cos(Math.PI / 6);
F.f_01 = lat * 0.1;                                     // the force of a 0.1 mm stretch
const cs = [0.2, 0.3, 0.5, 1, 2, 3], tab = {};
for (const c of cs) {
  const st = evaluate(c, () => holdP(P.K), NW, SEED), yi = evaluate(c, () => yieldP(), NW, SEED);
  tab[c] = { st, yi, ceil: share(c / 2 + give(P.K), SIG) * 100, bare: share(c / 2, SIG) * 100, funnel: share(c / 2 + P.b, SIG) * 100 };
  const k = String(c).replace('.', '');
  F['stiff_' + k] = st.succ; F['stiffjam_' + k] = st.jam; F['stiffpk_' + k] = st.peak; F['stifft_' + k] = st.time; F['ceil_' + k] = tab[c].ceil; F['bare_' + k] = tab[c].bare;
  F['yield_' + k] = yi.succ; F['yieldto_' + k] = yi.to; F['yieldpk_' + k] = yi.peak; F['yieldt_' + k] = yi.time; F['funnel_' + k] = tab[c].funnel;
  F['stifflo_' + k] = st.lo; F['stifflhi_' + k] = st.hi;
}
F.stiff_1_lo = tab[1].st.lo; F.stiff_1_hi = tab[1].st.hi;
// the sampling error of 200 holes, and the claims at 2000 holes
const big = {};
for (const c of [0.2, 0.5, 1, 2]) big[c] = { st: evaluate(c, () => holdP(P.K), 2000, 77), yi: evaluate(c, () => yieldP(), 2000, 77) };
for (const c of [0.2, 0.5, 1, 2]) {
  const k = String(c).replace('.', '');
  F['bigstiff_' + k] = big[c].st.succ; F['bigyield_' + k] = big[c].yi.succ;
  check(Math.abs(big[c].st.succ - share(c / 2 + give(P.K), SIG) * 100) < 3, `holding a position reaches the closed-form ceiling at c = ${c} (got ${big[c].st.succ} vs ${share(c / 2 + give(P.K), SIG) * 100})`);
  check(Math.abs(big[c].yi.succ - share(c / 2 + P.b, SIG) * 100) < 3, `yielding reaches the funnel ceiling at c = ${c} (got ${big[c].yi.succ} vs ${share(c / 2 + P.b, SIG) * 100})`);
}
F.samp_se = Math.sqrt(0.68 * 0.32 / NW) * 100;
// what a better camera or a stiffer arm buys: the allowed error for 99 %, and the ceiling at half the error
// the half-width the peg can be off by is c/2 + g (the slack plus the arm's give), so the error allowed for 99 % is (c/2 + g) / 2.576
F.need_1 = (0.5 + give(P.K)) / 2.576; F.need_05 = (0.25 + give(P.K)) / 2.576; F.need_03 = (0.15 + give(P.K)) / 2.576;
F.needx_1 = SIG / F.need_1; F.needx_05 = SIG / F.need_05; F.needx_03 = SIG / F.need_03;
for (const [c, k] of [[1, 'need_1'], [0.5, 'need_05'], [0.3, 'need_03']]) check(Math.abs(share(c / 2 + give(P.K), F[k]) * 100 - 99) < 0.05, `an aim error of ${F[k]} mm gives 99 % at c = ${c}`);
for (const K of [100, 200, 1000]) F['ceilk_' + K] = share(0.25 + give(K), SIG) * 100;   // the closed-form ceiling at c = 0.5 mm for the stiffer arms
F.half_err_1 = share(0.5 + give(P.K), SIG / 2) * 100; F.half_err_03 = share(0.15 + give(P.K), SIG / 2) * 100; F.half_err_03_base = tab[0.3].ceil;
F.ceil_k1000_1 = share(0.5 + give(1000), SIG) * 100; F.ceil_k10_1 = share(0.5 + give(10), SIG) * 100;
check(F.half_err_03 < 60 && F.half_err_1 > 85, 'halving the error does not rescue a 0.3 mm clearance');
// stiffer arms: success and peak force at c = 0.5 across K
for (const K of [100, 200, 1000]) { const r = evaluate(0.5, () => holdP(K), NW, SEED); F['kstiff_' + K] = r.succ; F['kstiffpk_' + K] = r.peak; }
check(Math.abs(F.kstiff_1000 - F.kstiff_100) < 12, 'a stiffer arm moves the ceiling by only a few points');

/* what the footage shows: the camera's own reading of the offset, against the outcome of the attempt (holding a position, c = 1) */
{
  const N = 20000, G = funnel(1), rn = BN.rng(101), hs = holes(N, 101), rc = BN.rng(202), rows = [];
  for (let k = 0; k < N; k++) { const r = attempt(G, P.mu, holdP(P.K), hs[k][0], hs[k][1], rn, 1, false); rows.push({ ok: r.out === 'in', seen: hs[k][0] + P.sigmaCam * BN.randn(rc), e: hs[k][0] }); }
  const prior = rows.filter((r) => r.ok).length / N; let best = 0, bt = 0;
  for (let t = 0; t <= 2.5; t += 0.01) { let right = 0; for (const r of rows) if ((Math.abs(r.seen) < t) === r.ok) right++; if (right / N > best) { best = right / N; bt = t; } }
  F.cam_acc = best * 100; F.cam_prior = prior * 100; F.cam_thr = bt;
  F.cam_mean_ok = mean(rows.filter((r) => r.ok).map((r) => Math.abs(r.e))); F.cam_mean_jam = mean(rows.filter((r) => !r.ok).map((r) => Math.abs(r.e)));
  F.cam_seen_ok = mean(rows.filter((r) => r.ok).map((r) => Math.abs(r.seen))); F.cam_seen_jam = mean(rows.filter((r) => !r.ok).map((r) => Math.abs(r.seen)));
  // the same by integration: success iff |e| < h; the camera reads e + n, n ~ N(0, 0.5^2); rule |reading| < t
  const h = 0.5 + give(P.K); let accI = 0;
  for (let t = 0; t <= 2.5; t += 0.01) {
    let s = 0; const dz = 0.002;
    for (let e = -4; e <= 4; e += dz) {
      const pe = Math.exp(-0.5 * (e / SIG) ** 2) / (SIG * Math.sqrt(2 * Math.PI)), pin = Phi((t - e) / P.sigmaCam) - Phi((-t - e) / P.sigmaCam);
      s += pe * dz * (Math.abs(e) < h ? pin : 1 - pin);
    }
    if (s > accI) accI = s;
  }
  F.cam_acc_int = accI * 100;
  check(Math.abs(F.cam_acc - F.cam_acc_int) < 1.2, `best footage rule: simulation ${F.cam_acc} vs integration ${F.cam_acc_int}`);
  check(F.cam_acc < F.cam_prior + 12 && F.cam_acc > F.cam_prior, 'the camera improves on "always succeeds" by under 12 points (' + F.cam_acc + ' vs ' + F.cam_prior + ')');
}

/* ───── the soft arm: passive compliance, best stiffness on the same holes ───── */
const KS = [2, 3, 5, 10, 20, 50, 100, 200];
for (const load of [1, 0]) for (const c of [0.3, 0.5, 1, 2]) {
  let best = -1, bk = 0; const k = String(c).replace('.', ''), curve = [];
  for (const K of KS) { const r = evaluate(c, () => holdP(K), NW, SEED, { load }); curve.push(r.succ); if (r.succ > best) { best = r.succ; bk = K; } }
  F[(load ? 'soft_' : 'softfree_') + k] = best; F[(load ? 'softK_' : 'softfreeK_') + k] = bk;
  if (load && c === 1) { KS.forEach((K, i) => { F['softc1_K' + K] = curve[i]; }); }
  if (load && c === 0.3) { KS.forEach((K, i) => { F['softc03_K' + K] = curve[i]; }); }
}
F.load_shift_3 = P.sigmaLoad / 3; F.load_shift_100 = P.sigmaLoad / 100; F.soft_drive = 0; // sideways shift of the tip per sigma of load, mm
check(F.soft_03 < F.yield_03 - 20 && F.soft_1 < F.yield_1 - 15, 'with the sideways load the best soft arm stays well below yielding (' + F.soft_03 + ', ' + F.soft_1 + ')');
check(F.softfree_03 > F.soft_03 + 20 && F.softfree_1 > 95, 'without the load a soft arm does almost as well as yielding (' + F.softfree_03 + ', ' + F.softfree_1 + ')');
check(F.soft_1 > F.stiff_1 + 5 && F.soft_03 > F.stiff_03 + 15, 'a soft arm beats a stiff one on the same holes');

/* ───── the move: yield, in numbers ───── */
const G1 = funnel(1), kser = P.K * P.kc / (P.K + P.kc), tauArm = P.cd / P.K;           // a push straight down on a surface: arm and wall in series
{ const kz = P.kc / (1 + SLOPE * SLOPE); F.k_tilt = (1 - P.K * kz / (P.K + kz) / kser) * 100; check(F.k_tilt > 1 && F.k_tilt < 4, 'a 30 degree face lowers the vertical stiffness by about 3 %'); }
F.Cz = CZ; F.k_series = kser; F.g_loop = CZ * kser * DT; F.tau_arm = tauArm; F.J_first = kser * P.v * (DT + tauArm); F.Cx = P.Cx;
F.cm_g = F.g_loop; F.v_safe = 0.5 * P.Flim / (kser * (DT + tauArm));
// the sideways slide of a yielding attempt that touches the chamfer at c = 1: mean speed of the target over frames in contact
{
  const r = evaluate(1, () => yieldP(), 400, SEED, { keep: true }); let sp = [], dur = [], travel = [], fpk = [];
  for (const a of r.rolls) { const cont = a.tr.filter((s) => Math.abs(s.u[0]) > 0.05); if (cont.length > 2) { sp.push(mean(cont.map((s) => Math.abs(s.u[0])))); dur.push(cont.length * DT); travel.push(Math.abs(a.tr[a.tr.length - 1].d)); fpk.push(a.peak); } }
  F.slide_speed = mean(sp); F.slide_time = mean(dur); F.slide_travel = mean(travel); F.slide_n = sp.length; F.slide_share = sp.length / 400 * 100; F.slide_peak = mean(fpk);
  check(F.slide_share > 25 && F.slide_share < 55, 'a third of the attempts at c = 1 touch the funnel');
}
// the force error of the push loop after the first contact, on the flat rim (e0 beyond the funnel): geometric decay
{
  const rn = BN.rng(9), ratios = [];
  for (let k = 0; k < 200; k++) {
    const r = attempt(funnel(1), P.mu, yieldP(), 3 + 0.01 * k, 0, rn, 1, true);   // the measured fz of the trace carries the sensor's noise of 0.15 N
    const fz = r.tr.map((s) => s.fz), i0 = fz.findIndex((v) => v > 2); if (i0 < 0) continue;
    const e = [1, 2, 3].map((j) => fz[i0 + j] - P.Fpush); if (Math.abs(e[0]) > 0.5) ratios.push(Math.abs(e[1]) / Math.abs(e[0]));
  }
  F.decay_ratio = mean(ratios); F.decay_pred = Math.abs(1 - F.g_loop);
  // the stiffness of arm and wall in series, measured statically: descend until the target is 0.2 mm below the flat rim, hold it, and read the settled force
  const rk = BN.rng(19), peaks = [], plan = { K: P.K, act: (ob) => (ob.t < 44 ? [0, -P.v] : [0, 0]) }, statics = [];
  for (let k = 0; k < 40; k++) {
    const r = attempt(funnel(1), P.mu, plan, 3 + 0.01 * k, 0, rk, 1, true); statics.push(mean(r.tr.slice(-50).map((t) => t.fz)) / 0.2);
    peaks.push(attempt(funnel(1), P.mu, yieldP(), 3 + 0.01 * k, 0, rk, 1, false).peak);
  }
  F.k_meas = mean(statics); F.J_peak_max = Math.max(...peaks); F.J_peak_mean = mean(peaks);
  check(Math.abs(F.k_meas - kser) < 4, `the force climbs at the series stiffness: ${F.k_meas} vs ${kser}`);
  check(F.J_peak_max < F.J_first + 1.5 && F.J_peak_mean > 0.5 * F.J_first, `the first reading after contact is at most J = ${F.J_first}: peaks ${F.J_peak_mean} (mean), ${F.J_peak_max} (max)`);
}
F.yield_time_1 = tab[1].yi.time; F.stiff_time_1 = tab[1].st.time;
// how much the sideways gain and the dead band matter (0.3 mm, the same 200 holes)
{
  const names = { a: 0.02, b: 0.1, c: 0.35, d: 1, e: 3 };
  for (const k of Object.keys(names)) { const r = evaluate(0.3, () => yieldG(names[k], P.fdead), NW, SEED); F['cxs_' + k] = r.succ; F['cxj_' + k] = r.jam; F['cxt_' + k] = r.time; }
  check(Math.abs(F.cxs_c - tab[0.3].yi.succ) < 1e-9, 'the sweep reproduces the default gain');
  check(Math.abs(F.cxs_b - F.cxs_c) < 2 && Math.abs(F.cxs_d - F.cxs_c) < 2 && F.cxj_e > 15 && F.cxs_e < F.cxs_c - 20, 'sideways gain 0.1 to 1 changes nothing, 3 jams');
  check(F.cxt_a > F.cxt_c + 1, 'a small sideways gain only costs time');
  for (const dead of [0, 2]) { const r = evaluate(1, () => yieldG(P.Cx, dead), NW, SEED); check(Math.abs(r.succ - tab[1].yi.succ) < 1.01, `dead band ${dead} N gives the same share (${r.succ} vs ${tab[1].yi.succ})`); }
}

/* ───── learning it: demonstrations with and without force ───── */
const DEMO_SEED = 23, MS = [1, 2, 3, 5, 10, 20, 40];
function learnedOn(rolls, withForce) { return learner(thin(rolls, withForce), withForce); }
const wid = {};                                         // the widget's draw of demonstrations
for (const m of MS) { const rolls = demoRuns(m, DEMO_SEED); wid[m] = { rolls, f: evaluate(1, () => learnedOn(rolls, true), NW, SEED), n: evaluate(1, () => learnedOn(rolls, false), NW, SEED), frames: thin(rolls, true).X.length }; }
// the demonstrations' coverage of the funnel's two sides, over 24 independent draws
const SEEDS = []; for (let s = 11; s <= 34; s++) SEEDS.push(s);
const cov = { f: {}, n: {} }, groups = { 0: [], 1: [], 2: [] };
for (const m of [1, 2, 5, 10, 20, 40]) {
  cov.f[m] = []; cov.n[m] = [];
  for (const sd of SEEDS) {
    const rolls = demoRuns(m, sd), sides = new Set(rolls.map(sideOf).filter((s) => s !== 0)), a = evaluate(1, () => learnedOn(rolls, true), NW, SEED);
    cov.f[m].push(a.succ); groups[sides.size].push(a.succ);
    if (m === 5 || m === 40) cov.n[m].push(evaluate(1, () => learnedOn(rolls, false), NW, SEED).succ);
  }
}
for (const m of [1, 2, 5, 10, 20, 40]) F['covmean_' + m] = mean(cov.f[m]);
F.cov_none = mean(groups[0]); F.cov_one = mean(groups[1]); F.cov_both = mean(groups[2]); F.cov_n_none = groups[0].length; F.cov_n_one = groups[1].length; F.cov_n_both = groups[2].length;
F.cov_one_lo = Math.min(...groups[1]); F.cov_one_hi = Math.max(...groups[1]); F.cov_both_lo = Math.min(...groups[2]); F.cov_none_hi = Math.max(...groups[0]);
F.strip_m5 = mean(cov.n[5]); F.strip_m40 = mean(cov.n[40]); F.strip_m5_lo = Math.min(...cov.n[5]); F.strip_m5_hi = Math.max(...cov.n[5]); F.strip_m40_lo = Math.min(...cov.n[40]); F.strip_m40_hi = Math.max(...cov.n[40]);
for (const m of MS) { F['wf_' + m] = wid[m].f.succ; F['wn_' + m] = wid[m].n.succ; F['wframes_' + m] = wid[m].frames; F['wfjam_' + m] = wid[m].f.jam; }
// the closed form: a draw of m demonstrations meets each side with probability 1 - (1 - q)^m
{
  const N = 4000, rolls = evaluate(1, () => yieldP(), N, 303, { keep: true }).rolls; let right = 0, left = 0;
  for (const r of rolls) { const s = sideOf(r); if (s > 0) right++; else if (s < 0) left++; }
  F.q_side = (right + left) / 2 / N; F.q_closed = (1 - share(0.5, SIG)) / 2;
  const s0 = F.cov_none, gain = (F.cov_both - F.cov_none) / 2;
  for (const m of [1, 2, 5, 10, 20, 40]) { F['covmodel_' + m] = s0 + 2 * gain * (1 - Math.pow(1 - F.q_side, m)); }
  F.cov_gain = gain; F.cov_base = s0; F.cov_span = 2 * gain;
  check(Math.abs(F.q_side - F.q_closed) < 0.02, `a given side is touched by ${F.q_side} of the attempts vs the closed form ${F.q_closed}`);
  for (const m of [1, 2, 5, 10, 20]) check(Math.abs(F['covmean_' + m] - F['covmodel_' + m]) < 5, `coverage law at m = ${m}: ${F['covmean_' + m]} vs ${F['covmodel_' + m]}`);
  F.m95 = Math.ceil(Math.log(0.05) / Math.log(1 - F.q_side)); F.p_both_20 = (1 - 2 * Math.pow(1 - F.q_side, 20) + Math.pow(1 - 2 * F.q_side, 20)) * 100; F.p_both_10 = (1 - 2 * Math.pow(1 - F.q_side, 10) + Math.pow(1 - 2 * F.q_side, 10)) * 100;
}
// transfer across clearances: demonstrations at 1 mm, tried at other clearances
{ const rolls = wid[20].rolls, cl = () => learnedOn(rolls, true); for (const c of [0.3, 0.5, 2]) { F['xfer_' + String(c).replace('.', '')] = evaluate(c, cl, NW, SEED).succ; } }
for (const [m, want] of [[1, 1], [5, 1], [10, 2]]) { const got = new Set(wid[m].rolls.map(sideOf).filter((x) => x !== 0)).size; F['wsides_' + m] = got; check(got === want, `the widget's draw of demonstrations touches ${want} side(s) of the funnel at m = ${m} (got ${got})`); }
check(F.cov_none > 55 && F.cov_none < 70 && F.cov_one > 75 && F.cov_one < 86 && F.cov_both > 96, `coverage groups: none ${F.cov_none}, one ${F.cov_one}, both ${F.cov_both}`);
check(F.cov_n_none + F.cov_n_one + F.cov_n_both === 24 * 6, 'every draw is in a coverage group');
check(Math.abs(F.strip_m40 - tab[1].st.succ) < 6 && Math.abs(F.strip_m5 - tab[1].st.succ) < 6, 'without the force channels the clone is the position policy (' + F.strip_m5 + ', ' + F.strip_m40 + ' vs ' + tab[1].st.succ + ')');
check(Math.abs(F.strip_m40 - F.strip_m5) < 3, 'eight times the demonstrations do nothing for the clone without force');
check(wid[40].f.succ > 96 && wid[20].f.succ > 96 && wid[1].f.succ < 90, 'the widget draw: 20 demonstrations with force give > 96, one gives < 90');
check(F.xfer_03 > 90 && F.xfer_2 > 98, 'a clone built at 1 mm works at other clearances');

/* ───── the price: time, protective stops, and a simulator whose contact is stiffer or softer ───── */
const RESET = 20;
F.t_demo = tab[1].yi.time; F.reset = RESET; F.demo_cycle = tab[1].yi.attempt + RESET; F.demo20_min = 20 * F.demo_cycle / 60;
for (const c of [0.5, 0.3]) {
  const k = String(c).replace('.', ''), st = tab[c].st, cycle = st.attempt + RESET;
  F['attempts_h_' + k] = 3600 / cycle; F['jams_h_' + k] = 3600 / cycle * st.jam / 100; F['stop_share_' + k] = st.jam;
}
F.yield_cycle_h_1 = 3600 / (tab[1].yi.attempt + RESET);
const cloneG = learnedOn(wid[20].rolls, true), RH = [1, 2, 2.5, 3, 4];
for (const rho of RH) {
  const k = String(rho).replace('.', ''), e = evaluate(1, () => yieldP(), NW, SEED, { Kscale: rho, kcScale: rho }), c = evaluate(1, () => cloneG, NW, SEED, { Kscale: rho, kcScale: rho }), s = evaluate(1, () => holdP(P.K), NW, SEED, { Kscale: rho, kcScale: rho });
  F['gapx_' + k] = e.succ; F['gapc_' + k] = c.succ; F['gaps_' + k] = s.succ; F['gapcjam_' + k] = c.jam; F['gapcpk_' + k] = c.peak; F['gapxpk_' + k] = e.peak;
  const jr = e.rolls.filter((r) => r.out === 'jam'); if (jr.length) F['gapxjampk_' + k] = mean(jr.map((r) => r.peak));   // the force at which the rule's jams stop (the mean over all attempts hides it)
}
F.rho_star = (P.Flim / (kser * P.v) - tauArm) / DT; F.J_rho2 = kser * P.v * (2 * DT + tauArm); F.J_rho3 = kser * P.v * (3 * DT + tauArm); F.J_rho1 = F.J_first;
{ // where the expert's success passes the midpoint between its two plateaus
  const lo = tab[1].st.succ, hi = F.gapx_1, mid = (lo + hi) / 2; let prev = null, rhoHalf = NaN;
  for (let rho = 1.6; rho <= 3.2; rho += 0.1) { const r = evaluate(1, () => yieldP(), 400, 31, { Kscale: rho, kcScale: rho }).succ; if (prev && prev[1] >= mid && r < mid) { rhoHalf = prev[0] + (prev[1] - mid) / (prev[1] - r) * 0.1; break; } prev = [rho, r]; }
  F.rho_half = rhoHalf; F.rho_mid = mid;
  check(rhoHalf > F.rho_star - 0.5 && rhoHalf < F.rho_star + 0.15, `the cliff is where the first reading reaches the stop: measured ${rhoHalf}, formula ${F.rho_star}`);
}
check(F.gapx_1 > 97 && F.gapc_1 > 97 && F.gapx_2 > 97, 'the policy is fine up to twice the stiffness it was built for');
check(F.gapx_4 < F.gaps_4 + 8 && F.gapc_4 < F.gaps_4 + 8 && F.gapx_4 < 75, 'at four times the stiffness yielding is no better than holding a position (' + F.gapx_4 + ', ' + F.gapc_4 + ' vs ' + F.gaps_4 + ')');
check(F.gapcjam_4 > 25 && F.gapcpk_4 > P.Flim * 0.8, 'the failures are jams at the protective stop');
check(Math.abs((100 - F.gapx_4) - F.slide_share) < 5 && F.gapxjampk_4 > 2 * P.Flim, `at four times the stiffness the attempts that touch the funnel (${F.slide_share} %) end on the stop, far above it (${F.gapxjampk_4} N): failures ${100 - F.gapx_4} %`);
check(Math.abs(F.decay_ratio - F.decay_pred) < 0.25, `the push loop's force error shrinks by about |1 - g| per step (${F.decay_ratio} vs ${F.decay_pred})`);

/* ───── the checkpoint: a 0.4 mm hole, sigma 0.5 mm, give 0.07 mm; a sensor with 0.2 N of noise on 80 N/mm ───── */
{ const half = 0.2 + 0.07; F.ck_half = half; F.ck_share = share(half, 0.5) * 100; F.ck_sig = half / 2.576; F.ck_factor = 0.5 / F.ck_sig; F.ck_res = 0.2 / 80 * 1000; F.ck_ratio = 0.5 / (0.2 / 80); }

/* ───── checks of the prose, asserted ───── */
check(F.stiff_03 < F.stiff_1 && F.stiff_1 < F.stiff_2, 'holding a position: success rises with the clearance');
check(F.yield_02 > 85 && F.yield_1 > 95 && F.yield_2 > 99, 'yielding: above 85 % at 0.2 mm and above 95 % at 1 mm');
check(F.yield_1 - F.stiff_1 > 25 && F.yield_03 - F.stiff_03 > 55, 'yielding gains at least 25 points at 1 mm and 55 at 0.3 mm');
check(F.stiffpk_05 > 10 && F.yieldpk_05 < 10, 'holding a position presses harder than yielding (peak force)');
check(F.res_ratio > 200, 'the force sensor resolves the stretch at least 200 times finer than the camera');
check(F.yield_time_1 > 5.5 && F.yield_time_1 < 7.5, 'about six seconds per yielding insertion');
check(F.give100 > 0.06 && F.give100 < 0.09, 'the stiff arm gives about 0.07 mm at the stop');

/* ───── the widget prints the same numbers ───── */
const html = path.join(root, dir, '10_what_cameras_cannot_see.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const KSL = [2, 3, 5, 10, 20, 50, 100, 200], MSL = [1, 2, 3, 5, 10, 20, 40], RSL = [1, 1.5, 2, 2.5, 3, 4, 6];
  const tol = (id, want, t, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= t)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(2)}`); };
  const setState = (c, pol, K, m, rho) => { pg.set('w10-c', c); pg.set('w10-pol', pol); pg.set('w10-k', KSL.indexOf(K)); pg.set('w10-m', MSL.indexOf(m)); pg.set('w10-rho', RSL.indexOf(rho)); pg.drain(); };
  const probe = (r, tag, exact) => {
    const t1 = exact ? 0.55 : 1.55;
    tol('w10-succ', r.succ, t1, tag + ' success'); tol('w10-jam', r.jam, t1, tag + ' jam'); tol('w10-to', r.to, t1, tag + ' timeout'); tol('w10-peak', r.peak, 0.35, tag + ' peak force');
    if (!isNaN(r.time)) tol('w10-time', r.time, 0.15, tag + ' time');
    const ci = pg.text('w10-ci').match(/[\d.]+/g).map(Number); if (Math.abs(ci[0] - r.lo) > t1 + 0.5 || Math.abs(ci[1] - r.hi) > t1 + 0.5) fail(`${tag} interval: widget ${ci} vs ${r.lo.toFixed(1)}-${r.hi.toFixed(1)}`);
  };
  setState(1, 'pos', 100, 10, 1); probe(tab[1].st, 'default (holds a position, 1 mm)', true);
  tol('w10-ceil', tab[1].ceil, 0.06, 'closed-form ceiling'); tol('w10-funnel', tab[1].funnel, 0.06, 'closed-form funnel ceiling');
  setState(0.3, 'pos', 100, 10, 1); probe(tab[0.3].st, 'position at 0.3', true);
  setState(2, 'pos', 100, 10, 1); probe(tab[2].st, 'position at 2', true);
  setState(1, 'pos', 5, 10, 1); probe(evaluate(1, () => holdP(5), NW, SEED), 'soft tracker 5 N/mm', true);
  setState(0.5, 'pos', 200, 10, 1); probe(evaluate(0.5, () => holdP(200), NW, SEED), 'stiff tracker 200 N/mm', true);
  setState(1, 'yield', 100, 10, 1); probe(tab[1].yi, 'yields at 1 mm', true);
  setState(0.2, 'yield', 100, 10, 1); probe(tab[0.2].yi, 'yields at 0.2 mm', true);
  setState(1, 'learnF', 100, 1, 1); probe(wid[1].f, 'learned with force, 1 demonstration');
  setState(1, 'learnF', 100, 5, 1); probe(wid[5].f, 'learned with force, 5 demonstrations');
  setState(1, 'learnF', 100, 10, 1); probe(wid[10].f, 'learned with force, 10 demonstrations');
  setState(1, 'learnF', 100, 40, 1); probe(wid[40].f, 'learned with force, 40 demonstrations');
  setState(1, 'learnN', 100, 10, 1); probe(wid[10].n, 'learned without force, 10 demonstrations');
  setState(1, 'learnN', 100, 40, 1); probe(wid[40].n, 'learned without force, 40 demonstrations');
  setState(0.3, 'learnF', 100, 20, 1); probe(evaluate(0.3, () => cloneG, NW, SEED), 'learned with force at 0.3 mm (built at 1 mm)');
  setState(1, 'yield', 100, 10, 4); probe(evaluate(1, () => yieldP(), NW, SEED, { Kscale: 4, kcScale: 4 }), 'yields in a world 4x stiffer');
  setState(1, 'learnF', 100, 20, 4); probe(evaluate(1, () => cloneG, NW, SEED, { Kscale: 4, kcScale: 4 }), 'learned with force in a world 4x stiffer');
  setState(1, 'learnF', 100, 20, 2); probe(evaluate(1, () => cloneG, NW, SEED, { Kscale: 2, kcScale: 2 }), 'learned with force in a world 2x stiffer');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
