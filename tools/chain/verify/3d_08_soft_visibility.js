#!/usr/bin/env node
/* Oracle for 3D lesson 08, "Making visibility soft: volume rendering".
 *
 * Independent pieces: (a) the discrete renderer written from the lesson's own equations in a different computational form
 * (T_i = exp(-sum_{j<i} sigma_j delta_j), not a running product of (1-alpha)), checked against a fine quadrature of the
 * continuous integral; (b) derivatives by central finite differences of that independent renderer, against the engine's
 * analytic compositeGrad and against the widget's printed slope; (c) the disc-fitting experiment re-run from scratch.
 * Then the page's widget is driven into each state quoted in "What to try".
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

/* ── independent discrete renderer, one channel or three ── */
function render(sig, col, dl, bg) {
  const n = sig.length, C = [0, 0, 0], w = new Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const Ti = Math.exp(-cum), ai = 1 - Math.exp(-sig[i] * dl[i]);
    w[i] = Ti * ai; for (let c = 0; c < 3; c++) C[c] += w[i] * col[i][c];
    cum += sig[i] * dl[i];
  }
  const Tend = Math.exp(-cum);
  for (let c = 0; c < 3; c++) C[c] += Tend * bg[c];
  return { C, w, Tend };
}

/* ── 1. the discrete form converges to the continuous integral ── */
{
  const sigF = t => 2.2 * Math.exp(-((t - 1.3) ** 2) / 0.08) + 1.1 * Math.exp(-((t - 2.4) ** 2) / 0.05), colF = t => [0.5 + 0.4 * Math.sin(3 * t), 0.3, 0.8 - 0.1 * t];
  const L = 3, M = 400000, h = L / M;
  let opt = 0, I = [0, 0, 0];
  for (let k = 0; k < M; k++) {            // midpoint rule on the continuous formula  C = int T sigma c dt + T(L) bg
    const t = (k + 0.5) * h, s = sigF(t), T = Math.exp(-(opt + 0.5 * s * h)), c = colF(t);
    for (let q = 0; q < 3; q++) I[q] += T * s * c[q] * h;
    opt += s * h;
  }
  const Tend = Math.exp(-opt), bg = [1, 1, 1], cont = I.map((v, q) => v + Tend * bg[q]);
  for (const N of [50, 400]) {
    const sig = [], col = [], dl = [];
    for (let k = 0; k < N; k++) { const t = (k + 0.5) * L / N; sig.push(sigF(t)); col.push(colF(t)); dl.push(L / N); }
    const r = render(sig, col, dl, bg), e = Math.max(...r.C.map((v, q) => Math.abs(v - cont[q])));
    ok('discrete -> continuous, N=' + N, e < (N === 50 ? 2e-2 : 3e-3), e);
    if (N === 400) ok('engine composite == independent form', Math.max(...FL.vol.composite(sig, col, dl, bg).C.map((v, q) => Math.abs(v - r.C[q]))) < 1e-12);
  }
}

/* ── 2. the four-sample table (one channel) ── */
{
  const sig = [0, 0.5, 2, 8], c = [0.9, 0.2, 0.9, 0.4], d = 0.5, a = sig.map(s => 1 - Math.exp(-s * d));
  const T = [1]; for (let i = 0; i < 3; i++) T.push(T[i] * (1 - a[i]));
  const w = a.map((ai, i) => T[i] * ai), Tend = T[3] * (1 - a[3]);
  const C = w.reduce((s, wi, i) => s + wi * c[i], 0) + Tend * 1.0;
  ['1', '2', '3', '4'].forEach((k, i) => { facts['tb_a' + k] = a[i]; facts['tb_t' + k] = T[i]; facts['tb_w' + k] = w[i]; });
  facts.tb_wsum = w.reduce((s, x) => s + x, 0); facts.tb_tend = Tend; facts.tb_C = C;
  ok('weights + leftover = 1', close(facts.tb_wsum + Tend, 1, 1e-12));
  const eng = FL.vol.composite(sig, c.map(v => [v, v, v]), [d, d, d, d], [1, 1, 1]);
  ok('table == engine', close(eng.C[0], C, 1e-12));
}

/* ── 3. the sharp limit ── */
{
  const dz = 0.01, n = 300, red = [0.9, 0.2, 0.2], blue = [0.2, 0.3, 0.9], bg = [1, 1, 1];
  for (const s0 of [1, 10, 100, 1000]) {
    const sig = [], col = [], dl = [];
    let wRed = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * dz, inRed = t >= 1.0 && t < 1.2, inBlue = t >= 2.0 && t < 2.2;
      sig.push(inRed || inBlue ? s0 : 0); col.push(inRed ? red : blue); dl.push(dz);
    }
    const r = render(sig, col, dl, bg);
    for (let k = 0; k < n; k++) { const t = (k + 0.5) * dz; if (t >= 1.0 && t < 1.2) wRed += r.w[k]; }
    facts['lim_e' + s0] = Math.hypot(r.C[0] - red[0], r.C[1] - red[1], r.C[2] - red[2]);
    facts['lim_w' + s0] = wRed;
  }
  ok('limit: error decreases with density', facts.lim_e1 > facts.lim_e10 && facts.lim_e10 > facts.lim_e100 && facts.lim_e1000 < 1e-6);
}

/* ── 4. the derivative: engine vs finite differences vs the closed bracket ── */
{
  const rng = FL.rng(3), n = 24; let worst = 0, worstB = 0;
  for (let trial = 0; trial < 20; trial++) {
    const sig = [], col = [], dl = [];
    for (let k = 0; k < n; k++) { sig.push(4 * rng() * (rng() < 0.4 ? 1 : 0.1)); col.push([rng(), rng(), rng()]); dl.push(0.1 + 0.2 * rng()); }
    const bg = [rng(), rng(), rng()], dL = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    const g = FL.vol.compositeGrad(sig, col, dl, bg, dL), f = FL.vol.composite(sig, col, dl, bg);
    for (let k = 0; k < n; k += 3) {
      const h = 1e-6, s = sig[k];
      sig[k] = s + h; const Cp = render(sig, col, dl, bg).C; sig[k] = s - h; const Cm = render(sig, col, dl, bg).C; sig[k] = s;
      const num = [0, 1, 2].reduce((acc, q) => acc + dL[q] * (Cp[q] - Cm[q]) / (2 * h), 0);
      worst = Math.max(worst, Math.abs(num - g.dsig[k]) / (1e-6 + Math.abs(num)));
      // the bracket from the lesson, evaluated from the independent weights
      const r = render(sig, col, dl, bg);
      let br = 0; for (let q = 0; q < 3; q++) { let hid = r.Tend * bg[q]; for (let i = k + 1; i < n; i++) hid += r.w[i] * col[i][q]; const Tk1 = f.Ts[k + 1]; br += dL[q] * dl[k] * (Tk1 * col[k][q] - hid); }
      worstB = Math.max(worstB, Math.abs(br - g.dsig[k]) / (1e-6 + Math.abs(br)));
    }
  }
  ok('compositeGrad == finite differences', worst < 1e-5, worst);
  ok('compositeGrad == the closed bracket', worstB < 1e-9, worstB);
  facts.grad_check_digits = -Math.log10(Math.max(worst, 1e-16));
}

/* ── 5. the disc experiment, re-implemented ── */
const R0 = 1.0, ORANGE = [0.93, 0.55, 0.2], BG = [1, 1, 1], W = 48, F = 40, RC = 5, NS = 64, SPAN = 4, KAPPA = 6, DT = SPAN / NS;
const CAMS = FL.orbit(6, RC, 0, 0, { f: F, W, start: Math.PI / 6 });
const TRUE = { shapes: [FL.circle(0, 0, R0, ORANGE)], light: [0, 1], amb: 1, bg: BG, far: 20, stepScale: 0.9 };
const PHOTO = CAMS.map(c => FL.render(TRUE, c, { flat: true }));
function Esoft(delta, tau) {
  let e = 0, n = 0;
  for (let v = 0; v < CAMS.length; v++) for (let i = 0; i < W; i++) {
    const r = FL.pixelRay(CAMS[v], i + 0.5), sig = [], col = [], dl = [];
    for (let k = 0; k < NS; k++) {
      const t = RC - SPAN / 2 + (k + 0.5) * DT, x = r.ox + r.dx * t, z = r.oz + r.dz * t, d = Math.hypot(x - delta, z);
      sig.push(KAPPA / (tau * Math.sqrt(2 * Math.PI)) * Math.exp(-((d - R0) ** 2) / (2 * tau * tau))); col.push(ORANGE); dl.push(DT);
    }
    const C = render(sig, col, dl, BG).C, gt = [PHOTO[v].r[i], PHOTO[v].g[i], PHOTO[v].b[i]];
    e += ((C[0] - gt[0]) ** 2 + (C[1] - gt[1]) ** 2 + (C[2] - gt[2]) ** 2) / 3; n++;
  }
  return e / n;
}
function Ehard(delta) {
  let e = 0, n = 0;
  for (let v = 0; v < CAMS.length; v++) for (let i = 0; i < W; i++) {
    const r = FL.pixelRay(CAMS[v], i + 0.5), ox = r.ox - delta, b = ox * r.dx + r.oz * r.dz, disc = b * b - (ox * ox + r.oz * r.oz - R0 * R0);
    const hit = disc >= 0 && -b - Math.sqrt(disc) > 0, C = hit ? ORANGE : BG, gt = [PHOTO[v].r[i], PHOTO[v].g[i], PHOTO[v].b[i]];
    e += ((C[0] - gt[0]) ** 2 + (C[1] - gt[1]) ** 2 + (C[2] - gt[2]) ** 2) / 3; n++;
  }
  return e / n;
}
const dEsoft = (d, tau) => { const h = 1e-5; return (Esoft(d + h, tau) - Esoft(d - h, tau)) / (2 * h); };
facts.opq = 1 - Math.exp(-KAPPA);

// the staircase of the hard renderer
{
  const vals = new Set(); let prev = null, flat = 0, steps = 0;
  for (let k = 0; k <= 3200; k++) {
    const d = -1.6 + k * 0.001, e = Ehard(d); vals.add(e.toFixed(10));
    if (prev !== null) { steps++; if (Math.abs(e - prev) < 1e-12) flat++; }
    prev = e;
  }
  facts.hard_distinct = vals.size; facts.hard_flat_pct = 100 * flat / steps;
}
// optimiser: Adam on delta, exact slope of each renderer (the hard one by a central difference: its slope is 0 on plateaus)
function adam(d0, tau, hard) {
  let d = d0, m = 0, v = 0;
  for (let s = 1; s <= 80; s++) {
    const g = hard ? (Ehard(d + 1e-4) - Ehard(d - 1e-4)) / 2e-4 : dEsoft(d, tau);
    m = 0.9 * m + 0.1 * g; v = 0.999 * v + 0.001 * g * g;
    d -= 0.05 * (m / (1 - Math.pow(0.9, s))) / (Math.sqrt(v / (1 - Math.pow(0.999, s))) + 1e-12);
  }
  return d;
}

// the states quoted in "What to try", through the widget
const page = loadPage(path.join(DIR, '08_soft_visibility_volume_rendering.html'), { dpr: 1 });
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
function setState(tau, delta, pix) { page.set('w08-tau', tau); page.set('w08-delta', delta); if (pix !== undefined) page.set('w08-pix', pix); }
{
  setState(0.15, -1.5, 40);
  const es = Esoft(-1.5, 0.15), gs = dEsoft(-1.5, 0.15), eh = Ehard(-1.5), gh = (Ehard(-1.5 + 1e-4) - Ehard(-1.5 - 1e-4)) / 2e-4;
  ok('widget E soft', close(page.num('w08-es'), es, 6e-4), [page.num('w08-es'), es]);
  ok('widget slope soft (analytic) == finite difference of the independent renderer', close(page.num('w08-gs'), gs, 6e-5), [page.num('w08-gs'), gs]);
  ok('widget E hard', close(page.num('w08-eh'), eh, 6e-4));
  ok('widget slope hard', close(page.num('w08-gh'), gh, 6e-5), [page.num('w08-gh'), gh]);
  facts.d0 = 1.5; facts.es0 = es; facts.gs0 = gs; facts.eh0 = eh; facts.gh0 = gh;
  page.click('w08-go-hard'); const hardEnd = page.num('w08-end'); ok('hard descent does not move', close(hardEnd, -1.5, 0.006), hardEnd);
  page.click('w08-go-soft'); const softEnd = page.num('w08-end'); const mine = adam(-1.5, 0.15, false);
  ok('soft descent ends where the independent optimiser ends', close(softEnd, mine, 0.006), [softEnd, mine]);
  facts.end_soft_015 = Math.abs(mine);
}
{
  setState(0.15, -2.8);
  facts.eh_far = Ehard(-2.8); facts.gs_far = Math.abs(dEsoft(-2.8, 0.15));
  page.click('w08-go-soft'); const e1 = page.num('w08-end'); const mine = adam(-2.8, 0.15, false);
  ok('soft descent from -2.8', close(e1, mine, 0.006), [e1, mine]); facts.end_soft_far = Math.abs(mine);
  page.click('w08-go-hard'); ok('hard descent from -2.8 stays', close(page.num('w08-end'), -2.8, 0.006));
}
for (const [tau, key] of [[0.45, 'end_45'], [0.6, 'end_60']]) {
  setState(tau, -2.8); page.click('w08-go-soft');
  const w = page.num('w08-end'), mine = adam(-2.8, tau, false);
  ok('soft descent tau=' + tau, close(w, mine, 0.006), [w, mine]); facts[key] = tau === 0.45 ? mine : Math.abs(mine);
}
// landscapes: false valleys (local minima with |delta| > 0.5) appear at tau = 0.45, none at 0.15
{
  const far = tau => { const xs = []; for (let d = -3.2; d <= 3.2001; d += 0.05) xs.push([d, Esoft(d, tau)]); let n = 0; for (let k = 1; k < xs.length - 1; k++) if (Math.abs(xs[k][0]) > 0.5 && xs[k][1] < xs[k - 1][1] && xs[k][1] < xs[k + 1][1]) n++; return n; };
  facts.false_015 = far(0.15); facts.false_045 = far(0.45);
  ok('tau=0.15 has no false valley', facts.false_015 === 0, facts.false_015);
  ok('tau=0.45 has false valleys', facts.false_045 >= 1, facts.false_045);
}
// the default pixel (36): the weights sit on the first crossing of the sheet; read the same number off the widget
{
  setState(0.15, -1.5, 36);
  const r = FL.pixelRay(CAMS[1], 36.5), sig = [], col = [], dl = [];
  for (let k = 0; k < NS; k++) {
    const t = RC - SPAN / 2 + (k + 0.5) * DT, x = r.ox + r.dx * t, z = r.oz + r.dz * t, d = Math.hypot(x + 1.5, z);
    sig.push(KAPPA / (0.15 * Math.sqrt(2 * Math.PI)) * Math.exp(-((d - R0) ** 2) / (2 * 0.15 * 0.15))); col.push(ORANGE); dl.push(DT);
  }
  const rr = render(sig, col, dl, BG); let cum = 0; for (let k = 0; k < NS / 2; k++) cum += sig[k] * dl[k];
  const wsum = rr.w.reduce((a, b) => a + b, 0), wback = rr.w.slice(NS / 2).reduce((a, b) => a + b, 0);
  facts.t_mid = Math.exp(-cum); facts.back_share = 100 * wback / wsum;
  ok('widget back-half weight', close(page.num('w08-back'), facts.back_share, 0.0051), [page.num('w08-back'), facts.back_share]);
}
// the derivative table of the four-sample example: closed bracket vs finite differences of the independent renderer
{
  const sig = [0, 0.5, 2, 8], c = [0.9, 0.2, 0.9, 0.4], d = 0.5, mk = s => render(s, c.map(v => [v, v, v]), [d, d, d, d], [1, 1, 1]);
  const base = mk(sig);
  const T = [1]; for (let i = 0; i < 4; i++) T.push(T[i] * Math.exp(-sig[i] * d));
  for (let k = 0; k < 4; k++) {
    const h = 1e-6, sp = sig.slice(), sm = sig.slice(); sp[k] += h; sm[k] -= h;
    const num = (mk(sp).C[0] - mk(sm).C[0]) / (2 * h);
    let hide = base.Tend * 1; for (let i = k + 1; i < 4; i++) hide += base.w[i] * c[i];
    const add = T[k + 1] * c[k], br = d * (add - hide);
    ok('derivative table row ' + (k + 1), close(num, br, 1e-6), [num, br]);
    facts['gr_add' + (k + 1)] = add; facts['gr_hide' + (k + 1)] = hide; facts['gr_' + (k + 1)] = br;
  }
  facts.gr_t4 = 100 * T[3];
  facts.gr_a4 = 100 * (1 - Math.exp(-sig[3] * d));      // sample 4 already stops this share of the light that reaches it
  ok('the gradient signs the prose reads: empty bright sample +, dim sample in front -, dense last sample almost nothing',
     facts.gr_1 > 0 && facts.gr_2 < 0 && facts.gr_3 > 0 && Math.abs(facts.gr_4) < 0.01 && facts.gr_a4 > 95 && close(T[4], Math.exp(-sig.reduce((s, x) => s + x * d, 0)), 1e-12),
     [facts.gr_1, facts.gr_2, facts.gr_3, facts.gr_4, facts.gr_a4]);
  // uniform colour: the bracket is the same for every k
  const cu = [0.6, 0.6, 0.6, 0.6], mku = s => render(s, cu.map(v => [v, v, v]), [d, d, d, d], [1, 1, 1]).C[0];
  const gs = [0, 1, 2, 3].map(k => { const sp = sig.slice(), sm = sig.slice(); sp[k] += 1e-6; sm[k] -= 1e-6; return (mku(sp) - mku(sm)) / 2e-6; });
  ok('uniform colour: derivative identical along the ray', Math.max(...gs) - Math.min(...gs) < 1e-6, gs);
}

/* ── 6. the checkpoint, the counts ── */
{
  const sig = [1, 3, 5], c = [0.2, 0.6, 1.0], d = 0.4, bg = 0.5;
  const a = sig.map(s => 1 - Math.exp(-s * d)), T = [1, 1 - a[0], (1 - a[0]) * (1 - a[1])], w = a.map((x, i) => T[i] * x), Tend = T[2] * (1 - a[2]);
  const C = w.reduce((s, x, i) => s + x * c[i], 0) + Tend * bg;
  const dC = d * (T[1] * c[0] - (w[1] * c[1] + w[2] * c[2]) - Tend * bg);
  facts.ck_a1 = a[0]; facts.ck_a2 = a[1]; facts.ck_a3 = a[2]; facts.ck_t2 = T[1]; facts.ck_t3 = T[2]; facts.ck_w1 = w[0]; facts.ck_w2 = w[1]; facts.ck_w3 = w[2];
  facts.ck_tend = Tend; facts.ck_C = C; facts.ck_dC = dC;
  const pr = [0, 1, 2].map(k => { const h = 1e-6, s2 = sig.slice(); s2[0] = sig[0] + (k === 0 ? h : 0); return 0; });
  void pr;
  const num = (render(sig.map((s, i) => i === 0 ? s + 1e-6 : s), c.map(v => [v, v, v]), [d, d, d], [bg, bg, bg]).C[0] - render(sig.map((s, i) => i === 0 ? s - 1e-6 : s), c.map(v => [v, v, v]), [d, d, d], [bg, bg, bg]).C[0]) / 2e-6;
  ok('checkpoint derivative', close(num, dC, 1e-6), [num, dC]);
}
facts.grid_unk_d = 64 * 64; facts.grid_unk_c = 3 * 64 * 64; facts.grid3 = 512 ** 3;

ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
