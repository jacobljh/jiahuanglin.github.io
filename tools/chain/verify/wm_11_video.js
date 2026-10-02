#!/usr/bin/env node
/* Oracle for World Models lesson 11, "Pixels: the world model becomes a video model".
 *
 * The experiment lives in l11_video.js (global L11): the Courtyard with a long screen, 24 x 15 pictures, a tokenizer (3 x 3 patches, k-means codebook of C codes), and a video model that is
 * a lookup of recorded windows.  This oracle
 *   (1) re-derives the picture and token arithmetic from the renderer's definition (the ball is an additive Gaussian blob; deleting it costs 10 log10(360/E) dB) and the real-picture counts;
 *   (2) re-computes the rate-distortion table with its OWN pipeline (patches, nearest code by brute force, decode, PSNR, the ball read from the decoded picture) and compares it with L11.rate;
 *       checks that the k-means codebooks are what they claim (every training patch is coded by its nearest code; inertia falls with C), the C^(-1/2) law of the ball's floor, the share of
 *       bits spent on tokens that carry nothing about the ball, the velocity error of two pictures against sqrt(2) floor / dt and of W pictures against the least-squares formula,
 *       and the glare band of lesson 3 (PSNR, floor, how many token grids one ball position produces);
 *   (3) re-implements the model's candidate search by brute force on dense token grids (own tokenisation of every recorded picture, own distances, own pattern rule) and compares the sets
 *       the engine finds; checks the chain rule (the probability of a picture is the product of its token-by-token conditionals, and equals what the sampler produces), the 2K/(K+1) law for
 *       the cost of sampling against the pixel mean, and replays free-running generations with the independent search;
 *   (4) measures the four ways to draw (pixel mean, greedy token, independent token, token by token), the controllability of the model told / not told the action, the forgetting curve over
 *       the window (the widget's 30 launches and 120 launches), and the budget arithmetic of the lesson;
 *   (5) drives the page's own widget into the states the prose describes and compares what it prints.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
globalThis.CY = require(path.join(DIR, 'courtyard.js'));
const CY = globalThis.CY;
const L = require(path.join(DIR, 'l11_video.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const K = L.C;                      // constants of the experiment
const T = K.T, NP = K.NP;

/* ── 0. what is in a picture ── */
const WORLD = CY.world({ curtain: [2.2, 3.8] });
const pic = (s, noBall) => CY.img.render(WORLD, s, { sigma: 1.5, ball: noBall ? 0 : 0.8 });
facts.pix = 24 * 15; facts.state_numbers = 4; facts.pix_per_state = facts.pix / 4; facts.tokens_per_picture = (24 / 3) * (15 / 3); facts.patch_numbers = 9;
{ // the ball is an additive blob: picture - picture without the ball = 0.8 exp(-r^2 / 2 sigma^2) at the pixel centres
  const rng = CY.rng(3); let worst = 0, E = 0, nE = 0;
  for (let n = 0; n < 300; n++) {
    const s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 0, 0]; if (s[0] > 2.2 && s[0] < 3.8) continue;
    const a = pic(s), b = pic(s, true), bx = s[0] * 3, by = (5 - s[1]) * 3; let e = 0;
    for (let j = 0; j < 15; j++) for (let i = 0; i < 24; i++) { const blob = 0.8 * Math.exp(-((i + 0.5 - bx) ** 2 + (j + 0.5 - by) ** 2) / (2 * 1.5 * 1.5)); worst = Math.max(worst, Math.abs(a[j * 24 + i] - b[j * 24 + i] - blob)); e += blob * blob; }
    E += e; nE++;
  }
  ok('the ball is an additive Gaussian blob (max deviation < 1e-6)', worst < 1e-6, worst);
  facts.ball_energy = E / nE;                                   // sum of squared brightness of the blob, averaged over positions (interior positions: the blob is whole)
  facts.ball_del_psnr = 10 * Math.log10(facts.pix / facts.ball_energy);
  const e0 = (() => { const s = [6.0, 2.5, 0, 0], a = pic(s), b = pic(s, true); let e = 0; for (let i = 0; i < 360; i++) e += (a[i] - b[i]) ** 2; return e; })();
  ok('closed form of the blob energy: pi sigma^2 peak^2 = ' + (Math.PI * 2.25 * 0.64).toFixed(3), close(e0, Math.PI * 2.25 * 0.64, 0.02), e0);
  facts.ball_energy_closed = Math.PI * 1.5 * 1.5 * 0.8 * 0.8;
}
// real pictures (lesson 10 counts them: 256 x 256 RGB, patches of 16, 8 frames per second)
facts.real_numbers = 256 * 256 * 3; facts.real_tokens = (256 / 16) * (256 / 16); facts.real_tokens_per_s = facts.real_tokens * 8; facts.real_tokens_per_hour = facts.real_tokens_per_s * 3600; facts.real_tokens_per_hour_m = facts.real_tokens_per_hour / 1e6;
facts.real_ratio = facts.real_numbers / facts.real_tokens;     // numbers per token (a token stands for 16 x 16 x 3)

/* ── 1. the tokenizer, with its own pipeline ── */
const GX = 8, GY = 5;
function patchesOf(img) { const out = []; for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) { const p = new Float64Array(9); let k = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) p[k++] = img[(gy * 3 + j) * 24 + gx * 3 + i]; out.push(p); } return out; }
function nnIdx(cen, v) { let b = 0, bd = Infinity; for (let k = 0; k < cen.length; k++) { let s = 0; for (let u = 0; u < 9; u++) { const t = v[u] - cen[k][u]; s += t * t; } if (s < bd) { bd = s; b = k; } } return b; }
const encO = (cb, img) => patchesOf(img).map(p => nnIdx(cb.cen, p));
function decO(cb, tok) { const img = new Float64Array(360); tok.forEach((t, g) => { const gx = g % GX, gy = (g / GX) | 0; let k = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) img[(gy * 3 + j) * 24 + gx * 3 + i] = cb.cen[t][k++]; }); return img; }
const bgImg = pic([0.2, 2.5, 0, 0], true);
function readO(cb, tok, ref) {       // the ball read from the decoded picture: centroid of the positive part of (decoded - decoded background), metres
  const a = decO(cb, tok), b = decO(cb, ref || encO(cb, bgImg)); let sw = 0, sx = 0, sy = 0, n = 0;
  for (let g = 0; g < NP; g++) if (tok[g] !== (ref || encO(cb, bgImg))[g]) n++;
  if (!n) return null;
  for (let j = 0; j < 15; j++) for (let i = 0; i < 24; i++) { const v = a[j * 24 + i] - b[j * 24 + i]; if (v > 0) { sw += v; sx += v * (i + 0.5); sy += v * (j + 0.5); } }
  return sw < 1e-9 ? null : { x: sx / sw / 3, y: 5 - sy / sw / 3, n };
}
const psnrO = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return 10 * Math.log10(1 / (s / a.length)); };
const testStates = []; for (let i = 0; i < 200; i++) { const rng = CY.rng(7000 + i); let s = CY.launch(WORLD, rng, { speed: [2.6, 2.6] }); const tt = Math.floor(rng() * 30); for (let t = 0; t < tt; t++) s = CY.step(WORLD, s, null); testStates.push(s); }
const hiddenO = s => s[0] > 2.2 && s[0] < 3.8;
const rate = {};
for (const C of K.CS) {
  const cb = L.codebook(C), ps = [], errs = [], toks = []; let lost = 0, nv = 0;
  for (const s of testStates) {
    const img = pic(s), tok = encO(cb, img); ps.push(psnrO(decO(cb, tok), img));
    if (hiddenO(s)) continue; nv++;
    const rb = readO(cb, tok); if (!rb) { lost++; errs.push(3); continue; } toks.push(rb.n); errs.push(Math.min(3, Math.hypot(rb.x - s[0], rb.y - s[1])));
  }
  rate[C] = { psnr: ps.reduce((a, b) => a + b, 0) / ps.length, floor: med(errs), tokens: toks.reduce((a, b) => a + b, 0) / nv, lost: lost / nv, bits: 40 * Math.log2(C) };
  const e = L.rate(C);
  ok('L11.rate(' + C + ') equals the independent pipeline', close(e.psnr, rate[C].psnr, 1e-4) && close(e.floor, rate[C].floor, 1e-5) && close(e.tokens, rate[C].tokens, 1e-9) && close(e.bits, rate[C].bits, 1e-9), [e, rate[C]]);
  facts['rate_bits_' + C] = rate[C].bits; facts['rate_psnr_' + C] = rate[C].psnr; facts['rate_floor_' + C] = 100 * rate[C].floor; facts['rate_tok_' + C] = rate[C].tokens;
}
ok('PSNR rises with the codebook at every step', K.CS.every((C, i) => i === 0 || rate[C].psnr > rate[K.CS[i - 1]].psnr), K.CS.map(C => rate[C].psnr));
ok('with one code the ball is lost, with 4 or more it is found in every visible picture', rate[1].lost === 1 && K.CS.every(C => C < 4 || rate[C].lost === 0), K.CS.map(C => rate[C].lost));
ok('the floor is not monotone at the small end: C = 4 locates the ball better than C = 8, and the ball is lost in 20-50 % of pictures at C = 2', rate[4].floor < rate[8].floor && rate[2].lost > 0.2 && rate[2].lost < 0.5, [rate[4].floor, rate[8].floor, rate[2].lost]);
facts.lost_c2_pct = 100 * rate[2].lost;
{ // the codebooks are what they claim: every distinct training patch is coded by its nearest code, and the weighted inertia falls with C
  const ts = L.trainSet(0); let prev = Infinity, okI = true;
  for (const C of K.CS) {
    const cb = L.codebook(C); let inertia = 0, wsum = 0;
    ts.X.forEach((x, i) => { let bd = Infinity; for (let k = 0; k < cb.K; k++) { let s = 0; for (let u = 0; u < 9; u++) { const t = x[u] - cb.cen[k][u]; s += t * t; } bd = Math.min(bd, s); } inertia += bd * ts.wt[i]; wsum += ts.wt[i]; });
    if (!(inertia <= prev + 1e-9)) okI = false; prev = inertia;
    facts['inertia_' + C] = inertia / wsum;
  }
  ok('k-means inertia (weighted) is non-increasing in C', okI);
  facts.train_patches = ts.wt.reduce((a, b) => a + b, 0); facts.train_distinct = ts.X.length;
  // 25 Lloyd steps are enough: one more assignment + mean step changes the weighted inertia by under 2 %, and every centre is (nearly) the weighted mean of the patches nearest to it
  let worstGain = 0;
  for (const C of K.CS) {
    const cb = L.codebook(C), asg = ts.X.map(x => nnIdx(cb.cen, x)), sum = cb.cen.map(() => new Float64Array(9)), cnt = new Float64Array(cb.K);
    ts.X.forEach((x, i) => { cnt[asg[i]] += ts.wt[i]; for (let u = 0; u < 9; u++) sum[asg[i]][u] += ts.wt[i] * x[u]; });
    const inertia = cen => ts.X.reduce((a, x, i) => { let s = 0; for (let u = 0; u < 9; u++) s += (x[u] - cen[asg[i]][u]) ** 2; return a + s * ts.wt[i]; }, 0);
    const moved = sum.map((v, k) => (cnt[k] > 0 ? Array.from(v, z => z / cnt[k]) : Array.from(cb.cen[k])));
    const i0 = inertia(cb.cen), i1 = inertia(moved); worstGain = Math.max(worstGain, (i0 - i1) / i0);
  }
  ok('k-means: one more Lloyd step gains under 2 % in every codebook', worstGain < 0.02, worstGain); facts.kmeans_extra_step_gain_pct = 100 * worstGain;
}
{ // the fast tokenizer equals the full path (the engine), on random states and four codebooks
  const rng = CY.rng(5); let bad = 0, n = 0;
  for (const C of [4, 16, 64, 128]) { const cb = L.codebook(C); for (let i = 0; i < 300; i++) { const s = [0.2 + 7.6 * rng(), 0.2 + 4.6 * rng(), 0, 0], a = encO(cb, pic(s)), b = L.encodeState(cb, s); n++; for (let g = 0; g < NP; g++) if (a[g] !== b[g]) { bad++; break; } } }
  ok('encodeState == full-picture tokens (1200 random positions)', bad === 0, bad); facts.fast_path_bad = bad;
}
// the scaling law of the floor: the ball's position lives on a 2-D family, so the error falls like C^(-1/2) (while the codes still go to the ball)
facts.floor_ratio_16_64 = rate[16].floor / rate[64].floor; facts.floor_ratio_64_128 = rate[64].floor / rate[128].floor; facts.floor_ratio_8_16 = rate[8].floor / rate[16].floor; facts.floor_ratio_32_128 = rate[32].floor / rate[128].floor;
{ const xs = [16, 32, 64].map(C => Math.log(C)), ys = [16, 32, 64].map(C => Math.log(rate[C].floor)), mx = xs.reduce((a, b) => a + b) / 3, my = ys.reduce((a, b) => a + b) / 3; facts.floor_slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); }
ok('between C = 16 and 64 the floor falls by about 2 (slope near -1/2)', close(facts.floor_slope, -0.5, 0.2), facts.floor_slope);
ok('beyond C = 64 it flattens', facts.floor_ratio_64_128 < 1.3, facts.floor_ratio_64_128);
facts.bits_idle_pct_16 = 100 * (1 - rate[16].tokens / 40); facts.bits_idle_pct_64 = 100 * (1 - rate[64].tokens / 40);
facts.sensor_cm = 10;
// a token floor behaves like a sensor of lesson 1: the velocity read from two pictures has error sqrt(2) * sigma / dt; from W pictures (least squares) sqrt(12) sigma / (dt sqrt(W (W^2 - 1)))
{
  const DT = 0.1;
  for (const C of [16, 64]) {
    const cb = L.codebook(C), r2 = [], r4 = [], r8 = [];
    for (let i = 0; i < 120; i++) {
      const c = L.examClip(i), t = 7;
      for (const [W, arr] of [[2, r2], [4, r4], [8, r8]]) {
        const pts = []; for (let k = t - W + 1; k <= t; k++) { const rb = readO(cb, encO(cb, pic(c.s[k]))); if (rb) pts.push([k, rb.x, rb.y]); }
        if (pts.length < W) continue;
        const n = pts.length; let sk = 0, sx = 0, sy = 0, skk = 0, skx = 0, sky = 0;
        for (const p of pts) { sk += p[0]; sx += p[1]; sy += p[2]; skk += p[0] * p[0]; skx += p[0] * p[1]; sky += p[0] * p[2]; }
        const den = n * skk - sk * sk, vx = (n * skx - sk * sx) / den / DT, vy = (n * sky - sk * sy) / den / DT;
        arr.push(Math.hypot(vx - c.s[t][2], vy - c.s[t][3]));
      }
    }
    facts['vel2_' + C] = med(r2); facts['vel4_' + C] = med(r4); facts['vel8_' + C] = med(r8);
    facts['vel2_pred_' + C] = Math.SQRT2 * rate[C].floor / DT;                     // independent errors at the two pictures: sqrt(2) times the median radial floor, over dt
    const f = rate[C].floor; for (const W of [4, 8]) facts['vel' + W + '_pred_' + C] = f * Math.sqrt(12) / (DT * Math.sqrt(W * (W * W - 1)));
    facts['vel2_ratio_' + C] = facts['vel2_' + C] / facts['vel2_pred_' + C];
  }
  ok('two pictures: measured velocity error is within 30 % below the independent-error prediction (C = 16)', facts.vel2_ratio_16 > 0.65 && facts.vel2_ratio_16 < 1.05, facts.vel2_ratio_16);
  ok('two pictures: same at C = 64', facts.vel2_ratio_64 > 0.65 && facts.vel2_ratio_64 < 1.05, facts.vel2_ratio_64);
  ok('more pictures help: 4 pictures beat 2 by 2.5x or more at C = 16', facts.vel2_16 / facts.vel4_16 > 2.5, [facts.vel2_16, facts.vel4_16]);
  facts.vel2_16_over_4 = facts.vel2_16 / facts.vel4_16;
  facts.lesson1_vel_err = Math.SQRT2 * 0.1 / 0.1;                                  // lesson 1: two readings of sigma 10 cm
}
{ // the glare band of lesson 3 at nu = 1: total variance, the ball's share, PSNR, floor, how many token grids one ball position makes
  const rng = CY.rng(31); let totC = 0;
  const imgs = [], noball = [];
  for (let i = 0; i < 200; i++) { const s = testStates[i], cx = 0.5 + 7 * rng(); const g = { cx, nu: 1 }; imgs.push(L.render(s, { glare: g })); noball.push(L.render(s, { glare: g, noBall: true })); }
  const varOf = arr => { const m = new Float64Array(360); arr.forEach(a => a.forEach((v, i) => m[i] += v / arr.length)); let t = 0; arr.forEach(a => a.forEach((v, i) => t += (v - m[i]) ** 2 / arr.length)); return t; };
  const vt = varOf(imgs), vn = varOf(noball); facts.glare_var_total = vt; facts.glare_ball_share_pct = 100 * (vt - vn) / vt;
  const cleanImgs = testStates.map(s => pic(s)); const vc = varOf(cleanImgs); facts.clean_var_total = vc;
  for (const C of [16, 64]) {
    const cb = L.codebook(C, 1), ps = [], errs = []; let nv = 0, lost = 0;
    for (let i = 0; i < 200; i++) {
      const s = testStates[i], ta = encO(cb, imgs[i]), tb = encO(cb, noball[i]); ps.push(psnrO(decO(cb, ta), imgs[i]));
      if (hiddenO(s)) continue; nv++; const rb = readO(cb, ta, tb); if (!rb) { lost++; errs.push(3); continue; } errs.push(Math.min(3, Math.hypot(rb.x - s[0], rb.y - s[1])));
    }
    facts['glare_psnr_' + C] = ps.reduce((a, b) => a + b, 0) / ps.length; facts['glare_floor_' + C] = 100 * med(errs); facts['glare_lost_' + C] = lost / nv;
  }
  facts.glare_psnr_drop_16 = facts.rate_psnr_16 - facts.glare_psnr_16;
  // one ball position (x = 1.5, y = 2.5) under 200 glare positions: how many different token grids?
  const cb = L.codebook(64, 1), seen = new Set(); const r2 = CY.rng(41);
  for (let i = 0; i < 200; i++) seen.add(encO(cb, L.render([1.5, 2.5, 0, 0], { glare: { cx: 0.5 + 7 * r2(), nu: 1 } })).join(','));
  facts.glare_distinct_grids = seen.size;
  ok('the glare band wrecks the PSNR (by more than 8 dB at C = 16) and barely moves the ball floor at C = 16', facts.glare_psnr_drop_16 > 8 && Math.abs(facts.glare_floor_16 - facts.rate_floor_16) < 5, [facts.glare_psnr_drop_16, facts.glare_floor_16, facts.rate_floor_16]);
}

{ // lesson 3's picture at nuisance level 1 (band 0.4 m wide, peak 0.8, centre drawn at random in every picture, global gain 1 + 0.1 N(0,1)): how much of the pixel variance is the ball?
  const wr = CY.world({}), N = 3000;
  const frames = nu => { const r = CY.rng(11), out = []; for (let i = 0; i < N; i++) { let x, y; do { x = 0.3 + 7.4 * r(); y = 0.3 + 4.4 * r(); } while (CY.occluded(wr, [x, y, 0, 0])); const cx = r() * 7 + 0.5, g = 1 + 0.1 * nu * CY.randn(r); out.push(CY.img.render(wr, [x, y, 0, 0], { sigma: 1.5, band: nu > 0 ? { cx, width: 0.4, amp: 0.8 * nu } : null, gain: g })); } return out; };
  const tv = F => { const mean = new Float64Array(360); F.forEach(f => f.forEach((v, k) => { mean[k] += v / F.length; })); let sum = 0; F.forEach(f => f.forEach((v, k) => { sum += (v - mean[k]) ** 2 / F.length; })); return sum; };
  const vb = tv(frames(0)), vf = tv(frames(1)); facts.l3_var_ball = vb; facts.l3_var_total = vf; facts.l3_ball_share = 100 * vb / vf; facts.l3_nuis_share = 100 - facts.l3_ball_share;
  ok('lesson 3 picture at nuisance level 1: the ball is about 19 % of the pixel variance', Math.round(facts.l3_ball_share) === 19, facts.l3_ball_share);
}

/* ── 2. the model, with its own search ── */
const C0 = 32, cb0 = L.codebook(C0), co0 = L.corpus(cb0), M = co0.M;
const dist2 = (cb, a, b) => cb.D[a * cb.K + b];
// own dense tokens of every recorded picture (full pictures, own encoder)
const corpusTok = []; for (let m = 0; m < M; m++) { const c = L.clip(1000 + m); corpusTok.push(c.s.map(s => Uint8Array.from(encO(cb0, pic(s))))); }
const bg0 = Uint8Array.from(encO(cb0, bgImg));
const hasBall = tok => { for (let g = 0; g < NP; g++) if (tok[g] !== bg0[g]) return true; return false; };
const corpusBall = corpusTok.map(row => row.map(tok => (hasBall(tok) ? 1 : 0)));      // does picture t of recorded clip m show any token other than the background's?
const corpusAct = []; for (let m = 0; m < M; m++) corpusAct.push(L.clip(1000 + m).a);
{ // the sparse engine corpus stores exactly the tokens that differ from the background
  let bad = 0; for (let m = 0; m < M; m += 7) for (let t = 0; t <= T; t++) { const a = L.frameOf(cb0, co0, m, t), b = corpusTok[m][t]; for (let g = 0; g < NP; g++) if (a[g] !== b[g]) { bad++; break; } }
  ok('the engine corpus equals the independently tokenised recorded pictures', bad === 0, bad);
}
function bruteNearest(frames, acts, W, Kn, told) {       // frames: dense token grids (oldest first, last = most recent), acts same length; own pattern rule, own distances
  const n = frames.length;
  const qpat = []; for (let i = 0; i < W; i++) { const q = n - 1 - i; qpat.push(q >= 0 && hasBall(frames[q]) ? 1 : 0); }
  const group = [], all = [];
  for (let m = 0; m < M; m++) for (let t = 0; t < T; t++) {
    let same = true; for (let i = 0; i < W; i++) { const tc = t - i, b = tc >= 0 ? corpusBall[m][tc] : 0; if (b !== qpat[i]) { same = false; break; } }
    all.push([m, t]); if (same) group.push([m, t]);
  }
  const ids = group.length ? group : all, d = [];
  for (const [m, t] of ids) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const tc = t - i, q = n - 1 - i, a = q >= 0 ? frames[q] : bg0, b = tc >= 0 ? corpusTok[m][tc] : bg0;
      for (let g = 0; g < NP; g++) s += dist2(cb0, a[g], b[g]);
      if (told) { const aq = q >= 0 ? acts[q] : 0, ac = tc >= 0 ? corpusAct[m][tc] : 0; if (aq !== ac) s += 1e3; }
    }
    d.push(s);
  }
  const sorted = d.slice().sort((x, y) => x - y), thr = sorted[Math.min(Kn, d.length) - 1], tied = []; ids.forEach(([m, t], j) => { if (d[j] <= thr + 1e-9) tied.push([m, t, d[j]]); });
  const step = Math.max(1, tied.length / K.CAP), out = []; let take = 0;
  tied.forEach((e, idx) => { if (idx >= take) { out.push(e); take += step; } });
  return { cand: out, nTied: tied.length, groupSize: ids.length, thr };
}
function trueCtx(c, t, W) { const frames = [], acts = []; for (let i = t - W + 1; i <= t; i++) { frames.push(i < 0 ? bg0 : Uint8Array.from(encO(cb0, pic(c.s[i])))); acts.push(i < 0 ? 0 : c.a[i]); } return { frames, acts }; }
{ // candidate sets: engine vs brute force, on contexts of nudged and nudge-free clips, for several windows, told and not told
  let bad = 0, n = 0, worstD = 0;
  for (const [ci, W, told] of [[0, 4, true], [1, 8, false], [2, 12, true], [3, 16, false], [3, 16, true], [4, 20, true], [5, 2, false], [6, 6, true]]) {
    const c = L.demoClip(ci), t = c.tout - 1 - (ci % 3), ctx = L.context(cb0, c, t, W), eng = L.nearest(cb0, co0, ctx, W, K.KNN, told), tc = trueCtx(c, t, W), br = bruteNearest(tc.frames, tc.acts, W, K.KNN, told);
    n++; const a = eng.m.map((m, i) => m + ':' + eng.t[i]).join(','), b = br.cand.map(e => e[0] + ':' + e[1]).join(',');
    if (a !== b) { bad++; console.error('candidate sets differ', ci, W, told, a.slice(0, 60), '|', b.slice(0, 60)); }
    eng.d.forEach((d, i) => { if (br.cand[i]) worstD = Math.max(worstD, Math.abs(d - br.cand[i][2])); });
  }
  ok('engine candidate windows == brute-force windows (8 contexts)', bad === 0, bad); ok('their distances agree to 1e-9', worstD < 1e-9, worstD); facts.cand_checked = n;
}
{ // the codebook distance between two pictures is the squared distance between their decoded pictures
  const rng = CY.rng(8); let worst = 0;
  for (let i = 0; i < 200; i++) { const m = Math.floor(rng() * M), t1 = Math.floor(rng() * T), t2 = Math.floor(rng() * T); const a = corpusTok[m][t1], b = corpusTok[(m + 1) % M][t2]; let s = 0; for (let g = 0; g < NP; g++) s += dist2(cb0, a[g], b[g]); const da = decO(cb0, a), db = decO(cb0, b); let e = 0; for (let q = 0; q < 360; q++) e += (da[q] - db[q]) ** 2; worst = Math.max(worst, Math.abs(s - e)); }
  ok('sum of codebook distances == squared distance of decoded pictures', worst < 1e-9, worst);
}
// the chain rule: probability of a picture = product of its token-by-token conditionals = (candidates showing it) / (candidates)
{
  const c = L.demoClip(3), ctx = L.context(cb0, c, c.tout - 1, 16), cand = L.nearest(cb0, co0, ctx, 16, K.KNN, false), grids = cand.m.map((m, i) => L.nextTokens(cb0, co0, cand, i)), n = grids.length;
  const key = g => Array.from(g).join(','), cnt = {}; grids.forEach(g => { cnt[key(g)] = (cnt[key(g)] || 0) + 1; });
  let worstP = 0; for (const g of grids) { let p = 1, live = grids.slice(); for (let q = 0; q < NP; q++) { const match = live.filter(h => h[q] === g[q]); p *= match.length / live.length; live = match; } worstP = Math.max(worstP, Math.abs(p - cnt[key(g)] / n)); }
  ok('chain rule: the product of the token conditionals equals the share of candidates showing the picture', worstP < 1e-12, worstP);
  const rng = CY.rng(77), freq = {}, N = 4000; for (let i = 0; i < N; i++) { const o = L.rule(cb0, co0, cand, 'chain', rng); freq[key(o.tok)] = (freq[key(o.tok)] || 0) + 1; }
  let worstF = 0; for (const k in cnt) worstF = Math.max(worstF, Math.abs((freq[k] || 0) / N - cnt[k] / n)); for (const k in freq) if (!cnt[k]) worstF = 9;
  ok('the token-by-token sampler produces exactly the candidates, in proportion (4000 draws, tolerance 0.03)', worstF < 0.03, worstF);
  facts.chain_n_cand = n; facts.chain_distinct = Object.keys(cnt).length;
}
// how much does sampling cost against the pixel mean?  E|x_j - y|^2 = 2 s^2, E|mean_K - y|^2 = (1 + 1/K) s^2 when the truth y is one more draw from the same distribution
{
  const rng = CY.rng(5); for (const Kk of [3, 9]) { let a = 0, b = 0; const N = 400000; for (let i = 0; i < N; i++) { const y = CY.randn(rng); let m = 0, x1 = 0; for (let j = 0; j < Kk; j++) { const x = CY.randn(rng); m += x / Kk; if (j === 0) x1 = x; } a += (x1 - y) ** 2; b += (m - y) ** 2; } ok('2K/(K+1) law, K = ' + Kk, close(a / b, 2 * Kk / (Kk + 1), 0.03), [a / b, 2 * Kk / (Kk + 1)]); }
  facts.cost_ratio_k3 = 2 * 3 / (3 + 1); facts.cost_db_k3 = 10 * Math.log10(facts.cost_ratio_k3); facts.cost_db_inf = 10 * Math.log10(2);
}

/* ── 3. four ways to draw ── */
const RULES = ['mean', 'greedy', 'alone', 'chain'];
function ruleTable(W, told, N) {
  const rng = CY.rng(5), st = {}; RULES.forEach(r => { st[r] = { ball: 0, none: 0, pieces: 0, smear: 0, mse: 0, notData: 0 }; });
  for (let i = 0; i < N; i++) {
    const l = L.launchOf(6000 + i), base = L.simulate(l.s0, 0, 0), c = L.simulate(l.s0, 1 + (i % 2), base.tin + 2), ctx = L.context(cb0, c, c.tout - 1, W), cand = L.nearest(cb0, co0, ctx, W, K.KNN, told), truth = pic(c.s[c.tout]);
    const grids = cand.m.map((m, j) => Array.from(L.nextTokens(cb0, co0, cand, j)).join(','));
    for (const r of RULES) {
      const o = L.rule(cb0, co0, cand, r, rng), img = o.img || L.decode(cb0, o.tok), b = L.blobs(cb0, img, 0.1), kind = L.kindOf(b);
      st[r][kind]++; let e = 0; for (let q = 0; q < 360; q++) e += (img[q] - truth[q]) ** 2 / 360; st[r].mse += e / N;
      if (o.tok && !grids.includes(Array.from(o.tok).join(','))) st[r].notData++;
    }
  }
  return st;
}
const RT = { untold: ruleTable(16, false, 90), told: ruleTable(16, true, 90) };
for (const [lab, st] of Object.entries(RT)) for (const r of RULES) { const s = st[r]; for (const k of ['ball', 'none', 'pieces', 'smear']) facts['rule_' + lab + '_' + r + '_' + k] = s[k]; facts['rule_' + lab + '_' + r + '_psnr'] = 10 * Math.log10(1 / s.mse); facts['rule_' + lab + '_' + r + '_mse'] = s.mse; facts['rule_' + lab + '_' + r + '_notdata'] = s.notData; }
facts.rule_mse_ratio_untold = RT.untold.chain.mse / RT.untold.mean.mse; facts.rule_mse_ratio_told = RT.told.chain.mse / RT.told.mean.mse;
facts.rule_db_gap_untold = 10 * Math.log10(facts.rule_mse_ratio_untold);
ok('untold: token by token draws one ball far more often than the other rules', RT.untold.chain.ball > RT.untold.alone.ball + 15 && RT.untold.chain.ball > RT.untold.greedy.ball + 15 && RT.untold.chain.ball > RT.untold.mean.ball + 15, ['mean', 'greedy', 'alone', 'chain'].map(r => RT.untold[r].ball));
ok('untold: greedy deletes the ball in many contexts', RT.untold.greedy.none >= 25, RT.untold.greedy.none);
ok('untold: independent tokens break the ball into pieces in many contexts', RT.untold.alone.pieces >= 15, RT.untold.alone.pieces);
ok('untold: the pixel mean never beats the sharp samples on pieces/smears (it is blurred)', RT.untold.mean.smear + RT.untold.mean.pieces >= 30, RT.untold.mean.smear + RT.untold.mean.pieces);
ok('the pixel mean has the smallest squared error; a token-by-token draw costs about 2K/(K+1)', facts.rule_mse_ratio_untold > 1.2 && facts.rule_mse_ratio_untold < 1.8, facts.rule_mse_ratio_untold);
ok('token by token never draws a picture that is not one of the candidates', RT.untold.chain.notData === 0 && RT.told.chain.notData === 0, [RT.untold.chain.notData, RT.told.chain.notData]);
facts.rule_n = 90;
facts.alone_notdata_pct = 100 * RT.untold.alone.notData / 90; facts.greedy_notdata_pct = 100 * RT.untold.greedy.notData / 90;

/* ── 4. controllability ── */
function ctlStats(W, told, N, seed) {
  const rng = CY.rng(seed); let bt = 0, nb = 0, wn = 0, nw = 0, tt = 0, er = 0, ne = 0, miss = 0, nd = 0;
  for (let i = 0; i < N; i++) {
    const s0 = L.launchOf(6000 + i).s0, wi = L.whatIf(cb0, co0, s0, W, told, seed + i), r = L.control(wi);
    if (!isNaN(r.between)) { bt += r.between; nb++; } if (!isNaN(r.within)) { wn += r.within; nw++; } tt += r.trueBetween; if (!isNaN(r.err)) { er += r.err; ne++; } miss += r.missing; nd += 6;
  }
  return { between: bt / nb, within: wn / nw, trueBetween: tt / N, err: er / ne, miss: miss / nd };
}
const CT = { told: ctlStats(16, true, 60, 3000), untold: ctlStats(16, false, 60, 3000), told4: ctlStats(4, true, 60, 3000) };
for (const [lab, r] of Object.entries(CT)) { facts['ctl_' + lab + '_between'] = r.between; facts['ctl_' + lab + '_within'] = r.within; facts['ctl_' + lab + '_ratio'] = r.between / r.within; facts['ctl_' + lab + '_err'] = r.err; facts['ctl_' + lab + '_miss_pct'] = 100 * r.miss; }
facts.ctl_true_between = CT.told.trueBetween;
ok('told: the drawn heights differ between actions about as much as the true ones do (within 25 %)', Math.abs(CT.told.between / CT.told.trueBetween - 1) < 0.25, [CT.told.between, CT.told.trueBetween]);
ok('told: draws of the same action agree 5x better than draws of different actions', CT.told.between / CT.told.within > 5, CT.told.between / CT.told.within);
ok('not told: between-action spread is no larger than the within-action spread (ratio < 1.4)', CT.untold.between / CT.untold.within < 1.4, CT.untold.between / CT.untold.within);
ok('told, but a 4-picture window has already forgotten the nudge: ratio < 2', CT.told4.between / CT.told4.within < 2, CT.told4.between / CT.told4.within);
ok('told: the draws are much closer to the true ball than not told', CT.told.err < 0.5 * CT.untold.err, [CT.told.err, CT.untold.err]);

/* ── 5. the forgetting exam: the widget's protocol (120 nudge-free launches), what changes it, and an independent replay ── */
const NEX = 120, exam = {}; facts.n_exam = NEX;
for (const W of K.WS) {
  const r = L.forgetting(cb0, co0, W, NEX); exam[W] = r;
  facts['forget_' + W] = 100 * r.p; facts['drawn_' + W] = 100 * r.drawn;
  for (const h of [9, 10]) { const b = r.byH[h]; facts['forget_' + W + '_h' + h] = 100 * b.ok / b.n; facts['n_h' + h] = b.n; }
  ok('byH adds up to the total (W = ' + W + ')', r.byH[9].n + r.byH[10].n === NEX && r.byH[9].ok + r.byH[10].ok === Math.round(r.p * NEX), r.byH);
}
{ const hs = []; for (let i = 0; i < NEX; i++) { const c = L.examClip(i); hs.push(c.tout - c.tin); } facts.hidden_min = Math.min(...hs); facts.hidden_max = Math.max(...hs); facts.tin = L.examClip(0).tin; facts.last_seen = facts.tin - 1; facts.tout_min = facts.hidden_min + facts.tin; facts.tout_max = facts.hidden_max + facts.tin; facts.hidden_s_min = facts.hidden_min / 10; facts.hidden_s_max = facts.hidden_max / 10; facts.w16_seconds = 16 / 10; facts.courtyard_fps = 10; facts.courtyard_tokens_per_s = 40 * 10; }
ok('forgetting: a short window forgets (W <= 4: under 15 % right)', [1, 2, 4].every(W => facts['forget_' + W] < 15), [1, 2, 4].map(W => facts['forget_' + W]));
ok('forgetting: a window that reaches back past the screen remembers (W >= 14: over 65 %)', [14, 16, 20].every(W => facts['forget_' + W] > 65), [14, 16, 20].map(W => facts['forget_' + W]));
ok('forgetting: the transition sits between W = 8 and W = 12', facts.forget_8 < 25 && facts.forget_12 > 50, [facts.forget_8, facts.forget_12]);
ok('forgetting: non-decreasing in W up to noise (steps of at most 3 points backwards)', K.WS.every((W, i) => i === 0 || facts['forget_' + W] >= facts['forget_' + K.WS[i - 1]] - 3), K.WS.map(W => facts['forget_' + W]));
ok('forgetting: a ball is drawn even when the window has forgotten it (W = 8: some ball in 2/3 or more of the launches, right in under 25 %)', facts.drawn_8 > 66 && facts.forget_8 < 25, [facts.drawn_8, facts.forget_8]);
facts.forget_cross_w = K.WS.find(W => facts['forget_' + W] >= 50);
// time away: a window of 10 reaches the last picture of the ball for a screen that hides it 9 pictures, not 10
ok('time away: at W = 10 the ball hidden 9 pictures is found much more often than the ball hidden 10', facts.forget_10_h9 - facts.forget_10_h10 > 20, [facts.forget_10_h9, facts.forget_10_h10]);
ok('time away: at W = 12 and above the two durations are within 20 points', [12, 14, 16, 20].every(W => Math.abs(facts['forget_' + W + '_h9'] - facts['forget_' + W + '_h10']) < 20), [12, 14, 16, 20].map(W => [facts['forget_' + W + '_h9'], facts['forget_' + W + '_h10']]));
ok('time away: at W = 8 neither duration is found (both under 25 %)', facts.forget_8_h9 < 25 && facts.forget_8_h10 < 25, [facts.forget_8_h9, facts.forget_8_h10]);
// the same exam with the true pictures in the window (one draw at the picture where the ball comes out): feeding the model its own draws is not what makes it forget
facts.tf_n = NEX;
for (const W of K.WS) {
  const rng = CY.rng(21); let okc = 0, dr = 0;
  for (let i = 0; i < NEX; i++) {
    const c = L.examClip(i), ctx = L.context(cb0, c, c.tout - 1, W), cand = L.nearest(cb0, co0, ctx, W, K.KNN, true), o = L.rule(cb0, co0, cand, 'chain', rng), rb = L.readBall(cb0, o.tok), st = c.s[c.tout];
    if (rb) { dr++; if (Math.hypot(rb.x - st[0], rb.y - st[1]) < K.TOL) okc++; }
  }
  facts['tf_' + W] = 100 * okc / NEX; facts['tf_drawn_' + W] = 100 * dr / NEX;
}
ok('true pictures in the window: same staircase (W <= 8 under 25 %, W >= 14 over 65 %)', [1, 2, 4, 6, 8].every(W => facts['tf_' + W] < 25) && [14, 16, 20].every(W => facts['tf_' + W] > 65), K.WS.map(W => facts['tf_' + W]));
// what moves the step and what moves the top: the step sits where the window reaches the last sighting; the height is how well the model knows the physics (recorded clips)
for (const [M2, key] of [[150, 'forget_m150_w16'], [2400, 'forget_m2400_w16']]) { const co2 = L.corpus(cb0, M2, 1000); facts[key] = 100 * L.forgetting(cb0, co2, 16, NEX).p; }
facts.forget_m600_w16 = facts.forget_16;
ok('more recorded clips raise the top of the staircase (W = 16): 150 < 600 < 2400', facts.forget_m150_w16 + 10 < facts.forget_m600_w16 && facts.forget_m600_w16 + 5 < facts.forget_m2400_w16, [facts.forget_m150_w16, facts.forget_m600_w16, facts.forget_m2400_w16]);
facts.corpus_windows = M * T;
// the same exam, replayed with the independent search (8 launches x 3 windows), same random numbers: every drawn picture and the verdict
{
  let bad = 0, n = 0, badOk = 0, nOk = 0;
  for (const W of [4, 12, 16]) for (let i = 0; i < 8; i++) {
    const c = L.examClip(i), t0 = c.tin - 1, steps = c.tout - t0, rngA = CY.rng(500 + i), rngB = CY.rng(500 + i), rngC = CY.rng(500 + i);
    const gen = L.generate(cb0, co0, c, t0, W, steps, { told: true, rule: 'chain', rng: rngA });
    const tc = trueCtx(c, t0, W); let frames = tc.frames.slice(), acts = tc.acts.slice(), last = null;
    for (let k = 0; k < steps; k++) {
      const br = bruteNearest(frames, acts, W, K.KNN, true), grids = br.cand.map(([m, t]) => corpusTok[m][t + 1]);
      let live = grids.map((g, j) => j), tok = new Uint8Array(NP);
      for (let p = 0; p < NP; p++) { const pick = live[Math.min(live.length - 1, Math.floor(rngB() * live.length))]; tok[p] = grids[pick][p]; live = live.filter(j => grids[j][p] === tok[p]); }
      n++; for (let p = 0; p < NP; p++) if (tok[p] !== gen[k].tok[p]) { bad++; break; }
      frames.push(tok); acts.push(t0 + k + 1 < T ? c.a[t0 + k + 1] : 0); if (frames.length > W) { frames.shift(); acts.shift(); } last = tok;
    }
    const rb = readO(cb0, last), st = c.s[c.tout], okO = !!rb && Math.hypot(rb.x - st[0], rb.y - st[1]) < 0.5, r = L.reappear(cb0, co0, c, W, rngC);
    nOk++; if (okO !== r.ok) badOk++;
  }
  ok('free-running generation with the independent search draws the same pictures (' + n + ' steps)', bad === 0, bad); facts.replay_steps = n;
  ok('and reaches the same verdict (ball right within 0.5 m) in all ' + nOk + ' runs', badOk === 0, badOk);
}

/* ── 6. budgets ── */
facts.window_tokens_16 = 16 * 40; facts.window_pairs_16 = (16 * 40) ** 2; facts.window_pairs_4 = (4 * 40) ** 2; facts.window_pairs_ratio_4_16 = facts.window_pairs_16 / facts.window_pairs_4; facts.window_pairs_160 = (160 * 40) ** 2;
facts.window_pairs_ratio_10x = (160 * 40) ** 2 / (16 * 40) ** 2;
facts.real_pairs_1s = (24 * facts.real_tokens) ** 2; facts.real_pairs_60s = (60 * 24 * facts.real_tokens) ** 2; facts.real_pairs_ratio = facts.real_pairs_60s / facts.real_pairs_1s; facts.real_tokens_60s = 60 * 24 * facts.real_tokens; facts.real_tokens_1s = 24 * facts.real_tokens;
facts.frame_ms_24 = 1000 / 24; facts.frame_ms_20 = 1000 / 20; facts.frame_ms_21 = 1000 / 21; facts.pass_ms_gamengen = 1000 / 20 / 4; facts.pass_ms_dreamer4 = 1000 / 21 / 4; facts.pass_ms_24_4 = 1000 / 24 / 4; facts.pass_ms_24_3 = 1000 / 24 / 3;
facts.ar_passes_courtyard = 40; facts.ar_passes_real = facts.real_tokens;
facts.ar_vs_k4 = facts.pass_ms_24_4 / (facts.frame_ms_24 / facts.real_tokens);          // a denoiser pass (K = 4 per frame) against a token pass (256 per frame), both filling the 24 FPS frame time
ok('a denoiser pass at K = 4 may take 256/4 = 64 times as long as a token pass', Math.abs(facts.ar_vs_k4 - 64) < 1e-9, facts.ar_vs_k4);
facts.wham_px_per_token = 300 * 180 / 540;
{ // checkpoint: 128 x 128 RGB pictures, 8 x 8 patches, 1024 codes, window of 24 pictures, 20 FPS, 4 passes
  const tokens = (128 / 8) * (128 / 8); facts.ck_tokens = tokens; facts.ck_bits = tokens * Math.log2(1024); facts.ck_window_tokens = 24 * tokens; facts.ck_pairs = (24 * tokens) ** 2; facts.ck_pass_ms = 1000 / 20 / 4; facts.ck_numbers = 128 * 128 * 3; facts.ck_ratio = 128 * 128 * 3 * 8 / facts.ck_bits;
}
facts.courtyard_bits_16 = 40 * 4; facts.n_codes = 32;
facts.ar_ms_per_token_24 = facts.frame_ms_24 / 256; facts.pass_ms_diamond = 100 / 3; facts.dreamer4_ctx_frames = 9.6 * 20; facts.ex_window_tokens = facts.dreamer4_ctx_frames * 256; facts.ex_pairs_192 = facts.ex_window_tokens ** 2; facts.grids_log10 = 40 * Math.log10(32); facts.bits_idle_pct_32 = 100 * (1 - rate[32].tokens / 40); facts.bits_idle_32 = 200 * (1 - rate[32].tokens / 40);
facts.rate_psnr_gain_64_128 = facts.rate_psnr_128 - facts.rate_psnr_64;
for (const r of RULES) for (const lab of ['untold', 'told']) facts['rule_' + lab + '_' + r + '_ghost'] = facts['rule_' + lab + '_' + r + '_pieces'] + facts['rule_' + lab + '_' + r + '_smear'];
facts.real_pairs_1s_m = facts.real_pairs_1s / 1e6; facts.real_pairs_60s_bn = facts.real_pairs_60s / 1e9; facts.window_pairs_160_m = facts.window_pairs_160 / 1e6; facts.ex_pairs_192_bn = facts.ex_pairs_192 / 1e9; facts.ck_pairs_m = facts.ck_pairs / 1e6; facts.ck_window_s = 24 / 20;
facts.window_pairs_res2 = (16 * 160) ** 2; facts.window_pairs_res2_ratio = facts.window_pairs_res2 / facts.window_pairs_16; facts.tokens_res2 = 4 * 40; facts.window_pairs_res2_m = facts.window_pairs_res2 / 1e6;

// the state the page opens in (clip 3: nudged up while hidden; C = 32, W = 16): what the widget's readouts say about the two settings of the told/not-told switch
const DEF = {};
for (const told of [false, true]) {
  const ki = 3, clip = L.demoClip(ki), s0 = L.launchOf(5000 + ki).s0, t0 = clip.tin - 1;
  const gen = L.generate(cb0, co0, clip, t0, 16, 14, { told, rule: 'chain', rng: CY.rng(1000 + ki) }), rb = L.readBall(cb0, gen[clip.tout - t0 - 1].tok), st = clip.s[clip.tout];
  const ctl = L.control(L.whatIf(cb0, co0, s0, 16, told, 3000 + ki));
  DEF[told ? 'told' : 'untold'] = { between: ctl.between, within: ctl.within, gen: rb ? Math.hypot(rb.x - st[0], rb.y - st[1]) : NaN };
  facts['default_' + (told ? 'told' : 'untold') + '_between'] = ctl.between; facts['default_' + (told ? 'told' : 'untold') + '_within'] = ctl.within; facts['default_' + (told ? 'told' : 'untold') + '_gen'] = rb ? Math.hypot(rb.x - st[0], rb.y - st[1]) : -1;
}
{ const c = L.demoClip(3); facts.demo_hidden = c.tout - c.tin; facts.demo_ka = c.ka; facts.demo_tin = c.tin; facts.demo_tout = c.tout; facts.demo_nudge_step = c.ka; }

// short names for the facts the page quotes most (rule_untold_X_Y = u_X_Y; rate_floor_C = fl_C; rate_psnr_C = ps_C; rate_tok_C = tk_C), so that the page's markup stays small
for (const k of Object.keys(facts)) { let a = null; if (k.startsWith('rule_untold_')) a = 'u_' + k.slice(12); else if (k.startsWith('rate_floor_')) a = 'fl_' + k.slice(11); else if (k.startsWith('rate_psnr_')) a = 'ps_' + k.slice(10); else if (k.startsWith('rate_tok_')) a = 'tk_' + k.slice(9); if (a) facts[a] = facts[k]; }

/* ── 7. the page's own widget ── */
const PAGE = path.join(DIR, '11_video_world_models.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; }, click() {} };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
const cIdx = C => K.CS.indexOf(C), wIdx = W => K.WS.indexOf(W);
function setW(Cn, W, told, clip) { page.set('w11-c', cIdx(Cn)); page.set('w11-w', wIdx(W)); page.set('w11-told', told ? 'yes' : 'no'); page.set('w11-clip', clip); }
if (HAVE_PAGE) {
  // the default state (C = 32, W = 16, not told, clip 3): tokenizer readouts equal the independent pipeline, the four draws equal the independent classification
  setW(32, 16, false, 3);
  ok('widget: bits per picture (C = 32)', close(page.num('w11-bits'), rate[32].bits, 0.51), page.text('w11-bits'));
  ok('widget: PSNR (C = 32)', close(page.num('w11-psnr'), rate[32].psnr, 0.051), [page.text('w11-psnr'), rate[32].psnr]);
  ok('widget: ball floor in cm (C = 32)', close(page.num('w11-floor'), 100 * rate[32].floor, 0.051), [page.text('w11-floor'), 100 * rate[32].floor]);
  ok('widget: tokens that carry the ball (C = 32)', close(page.num('w11-tok'), rate[32].tokens, 0.051), [page.text('w11-tok'), rate[32].tokens]);
  for (const C of [1, 8, 128]) { page.set('w11-c', cIdx(C)); ok('widget: PSNR at C = ' + C, close(page.num('w11-psnr'), rate[C].psnr, 0.051), [page.text('w11-psnr'), rate[C].psnr]); if (C === 1) ok('widget: C = 1 loses the ball', /lost/.test(page.text('w11-floor')), page.text('w11-floor')); else ok('widget: floor at C = ' + C, close(page.num('w11-floor'), 100 * rate[C].floor, 0.051), [page.text('w11-floor'), 100 * rate[C].floor]); }
  setW(32, 16, false, 3);
  {
    const c = L.demoClip(3), ctx = trueCtx(c, c.tout - 1, 16), br = bruteNearest(ctx.frames, ctx.acts, 16, K.KNN, false), rng = CY.rng(2000 + 3);
    // the engine's own draws use seed 2000 + clip; the rules consume the generator in the order mean, greedy, alone, chain
    const grids = br.cand.map(([m, t]) => corpusTok[m][t + 1]), kinds = {};
    const blobsO = (img) => { const ref = decO(cb0, bg0), seen = new Uint8Array(360); let n = 0, peak = 0; for (let j = 0; j < 15; j++) for (let i = 0; i < 24; i++) { if (seen[j * 24 + i] || img[j * 24 + i] - ref[j * 24 + i] <= 0.1) continue; const st = [[i, j]]; seen[j * 24 + i] = 1; let size = 0, pk = 0; while (st.length) { const [x, y] = st.pop(); size++; pk = Math.max(pk, img[y * 24 + x] - ref[y * 24 + x]); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if (a < 0 || b < 0 || a >= 24 || b >= 15 || seen[b * 24 + a] || img[b * 24 + a] - ref[b * 24 + a] <= 0.1) continue; seen[b * 24 + a] = 1; st.push([a, b]); } } if (size >= 2) { n++; peak = Math.max(peak, pk); } } return n === 0 ? 'none' : n === 1 ? (peak >= 0.4 ? 'ball' : 'smear') : 'pieces'; };
    const dd = grids.map(g => decO(cb0, g)), mean = new Float64Array(360); dd.forEach(a => a.forEach((v, i) => mean[i] += v / dd.length)); kinds.mean = blobsO(mean);
    const greedy = new Uint8Array(NP); for (let p = 0; p < NP; p++) { const cnt = {}; grids.forEach(g => { cnt[g[p]] = (cnt[g[p]] || 0) + 1; }); let best = -1, bt = bg0[p]; for (const tk in cnt) if (cnt[tk] > best || (cnt[tk] === best && +tk === bg0[p])) { best = cnt[tk]; bt = +tk; } greedy[p] = bt; } kinds.greedy = blobsO(decO(cb0, greedy));
    const alone = new Uint8Array(NP); for (let p = 0; p < NP; p++) alone[p] = grids[Math.min(grids.length - 1, Math.floor(rng() * grids.length))][p]; kinds.alone = blobsO(decO(cb0, alone));
    let live = grids.map((g, j) => j); const chain = new Uint8Array(NP); for (let p = 0; p < NP; p++) { const pick = live[Math.min(live.length - 1, Math.floor(rng() * live.length))]; chain[p] = grids[pick][p]; live = live.filter(j => grids[j][p] === chain[p]); } kinds.chain = blobsO(decO(cb0, chain));
    const want = 'mean: ' + kinds.mean + ' · greedy: ' + kinds.greedy + ' · alone: ' + kinds.alone + ' · chain: ' + kinds.chain;
    ok('widget: the four draws (default clip) equal the independent re-draw: ' + want, page.text('w11-check') === want, [page.text('w11-check'), want]);
    facts.default_kinds_ok = page.text('w11-check') === want ? 1 : 0;
    ok('widget: the default untold clip has a mean that is not one ball, a greedy draw that deletes it and a token-by-token draw that has one', kinds.mean !== 'ball' && kinds.greedy === 'none' && kinds.chain === 'ball', kinds);
  }
  // told: the four draws agree (all show a ball); the readout for between / within
  page.set('w11-told', 'yes'); ok('widget: told, every rule draws a ball in the default clip', page.text('w11-check') === 'mean: ball · greedy: ball · alone: ball · chain: ball', page.text('w11-check'));
  { const t = page.text('w11-ctl'), m = /between ([\d.]+) m . same ([\d.]+) m/.exec(t); ok('widget: between / within (told)', !!m && close(+m[1], DEF.told.between, 0.0051) && close(+m[2], DEF.told.within, 0.0051), [t, DEF.told]); ok('widget: ball drawn where it comes out (told)', close(page.num('w11-gen'), DEF.told.gen, 0.0051), [page.text('w11-gen'), DEF.told.gen]); }
  page.set('w11-told', 'no');
  { const t = page.text('w11-ctl'), m = /between ([\d.]+) m . same ([\d.]+) m/.exec(t); ok('widget: between / within (not told)', !!m && close(+m[1], DEF.untold.between, 0.0051) && close(+m[2], DEF.untold.within, 0.0051), [t, DEF.untold]); ok('widget: ball drawn where it comes out (not told)', close(page.num('w11-gen'), DEF.untold.gen, 0.0051), [page.text('w11-gen'), DEF.untold.gen]); }
  page.set('w11-w', wIdx(4)); ok('widget: a window of 4 (not told) draws no ball where the ball comes out', page.text('w11-gen') === 'no ball drawn', page.text('w11-gen')); page.set('w11-w', wIdx(16));
  { const t = page.text('w11-win'); ok('widget: window cost for W = 16', /640 tokens/.test(t) && /409,600/.test(t), t); page.set('w11-w', wIdx(4)); ok('widget: window cost for W = 4', /160 tokens/.test(page.text('w11-win')) && /25,600/.test(page.text('w11-win')), page.text('w11-win')); page.set('w11-w', wIdx(16)); }
  // the forgetting readout: Measure computes the exam for the current codebook (one window per tick)
  page.click('w11-measure');
  ok('widget: Measure finished', /measured for C = 32/.test(page.text('w11-msg')), page.text('w11-msg'));
  for (const W of [4, 8, 10, 12, 16, 20]) { page.set('w11-w', wIdx(W)); ok('widget: share drawn right at W = ' + W + ' (120 launches)', close(page.num('w11-fg'), facts['forget_' + W], 0.51), [page.text('w11-fg'), facts['forget_' + W]]); }
  page.set('w11-w', wIdx(10));
  { const t = page.text('w11-fh'), m = /(\d+) % · (\d+) %/.exec(t); ok('widget: split by hidden time at W = 10', !!m && close(+m[1], facts.forget_10_h9, 0.51) && close(+m[2], facts.forget_10_h10, 0.51), [t, facts.forget_10_h9, facts.forget_10_h10]); }
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
