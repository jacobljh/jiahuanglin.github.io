const path = require('path'), fs = require('fs');
const _R = path.resolve(__dirname, '../../../../all_lessons');
const _dir = n => fs.existsSync(path.join(_R, n + '_new')) ? path.join(_R, n + '_new') : path.join(_R, n);
const FL = require(path.join(_dir('computer_vision_3d'), 'flatland.js'));
let fails = 0;
function ok(name, cond, extra) { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } else console.log('ok  ', name, extra === undefined ? '' : extra); }
const sc = FL.scenes.statue();
const R = 6, W = 64, f = 56;

// surface samples (the "sparse SfM points"): march rays from a ring of directions and keep first hits
function surfacePoints(n, rng, jitter) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = 2 * Math.PI * i / n + 0.05, ox = 6 * Math.cos(th), oz = 6 * Math.sin(th);
    const tx = (rng() - 0.5) * 3.4, tz = (rng() - 0.5) * 3.4;
    const dx = tx - ox, dz = tz - oz, l = Math.hypot(dx, dz);
    const h = FL.raycast(sc, ox, oz, dx / l, dz / l, 20);
    if (h.hit) pts.push({ x: h.x + jitter * FL.randn(rng), z: h.z + jitter * FL.randn(rng) });
  }
  return pts;
}
// 1. gradient check
{
  const rng = FL.rng(9);
  const pts = surfacePoints(12, rng, 0.1);
  const S = FL.gs.fromPoints(pts, { scale: 0.4, ol: 0.3, bg: sc.bg }, rng);
  for (let k = 0; k < S.K; k++) for (let q = 6; q < 9; q++) S.p[k * 9 + q] = 2 * rng() - 1;
  for (let k = 0; k < S.K; k++) { S.p[k * 9 + 2] = Math.log(0.25 + 0.3 * rng()); S.p[k * 9 + 3] = Math.log(0.15 + 0.3 * rng()); }
  const cams = FL.orbit(3, R, 0, 0, { f, W: 16 });
  const views = cams.map(c => ({ cam: c, img: FL.render(sc, c) }));
  const g = FL.gs.grad(S, views);
  const lossOnly = () => FL.gs.grad(S, views).loss;
  let worst = 0, n = 0;
  for (let k = 0; k < S.K; k += 2) for (let q = 0; q < 9; q++) {
    const idx = k * 9 + q, h = 1e-6 * (1 + Math.abs(S.p[idx])), s0 = S.p[idx];
    S.p[idx] = s0 + h; const lp = lossOnly(); S.p[idx] = s0 - h; const lm = lossOnly(); S.p[idx] = s0;
    const num = (lp - lm) / (2 * h);
    if (Math.abs(num) > 1e-6 || Math.abs(g.grad[idx]) > 1e-6) { worst = Math.max(worst, Math.abs(num - g.grad[idx]) / (1e-5 + Math.abs(num))); n++; }
  }
  ok('Splat analytic gradient == finite differences', worst < 5e-3, `worst rel ${worst.toExponential(2)} over ${n} params`);
}
// 2. fit
function fit(nTrain, K0, steps, opts) {
  opts = opts || {};
  const rng = FL.rng(21);
  const train = FL.orbit(nTrain, R, 0, 0, { f, W, start: 0.13 });
  const test = FL.orbit(24, R, 0, 0, { f, W, start: 0.13 + Math.PI / 24 * 0.9 });
  const views = train.map(c => ({ cam: c, img: FL.render(sc, c) }));
  const pts = opts.random ? Array.from({ length: K0 }, () => ({ x: (rng() - 0.5) * 6, z: (rng() - 0.5) * 6 })) : surfacePoints(K0, rng, 0.08);
  const S = FL.gs.fromPoints(pts, { scale: 0.3, ol: 0.0, bg: sc.bg }, rng);
  const t0 = Date.now(); const log = [];
  for (let s = 0; s < steps; s++) {
    const l = FL.gs.step(S, views, {});
    if (opts.densify && s > 0 && s % 60 === 0 && s < steps * 0.8) { const d = FL.gs.densify(S, { thresh: opts.thr || 3e-4, big: 0.3, maxK: 220, rng }); const pr = FL.gs.prune(S, {}); log.push(`s${s}: +${d.cloned}c +${d.split}s -${pr.removed} → K=${S.K}`); }
    if (s % 50 === 0) log.push('L' + l.toFixed(4));
  }
  const ms = Date.now() - t0;
  let ps = 0; for (const c of test) ps += FL.psnr(FL.render(sc, c), FL.gs.render(S, c));
  let tr = 0; for (const v of views) tr += FL.psnr(v.img, FL.gs.render(S, v.cam));
  return { S, train: tr / views.length, test: ps / test.length, ms, log: log.join(' ') };
}
for (const [label, n, K0, steps, o] of [
  ['surface-init K=40, 12 views, 300 steps', 12, 40, 300, {}],
  ['surface-init K=40, 12 views, +densify', 12, 40, 300, { densify: true }],
  ['random-init  K=40, 12 views, +densify', 12, 40, 300, { random: true, densify: true }],
  ['surface-init K=40, 3 views', 3, 40, 300, {}],
  ['surface-init K=40, 16 views, +densify', 16, 40, 400, { densify: true }],
]) {
  const r = fit(n, K0, steps, o);
  console.log(label.padEnd(44), `train ${r.train.toFixed(1)} held-out ${r.test.toFixed(1)}  K=${r.S.K}  ${r.ms}ms\n    ${r.log}`);
}
console.log(fails ? `\n${fails} FAILED` : '\ngs gradient test passed');
