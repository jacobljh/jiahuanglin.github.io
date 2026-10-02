const path = require('path'), fs = require('fs');
const _R = path.resolve(__dirname, '../../../../all_lessons');
const _dir = n => fs.existsSync(path.join(_R, n + '_new')) ? path.join(_R, n + '_new') : path.join(_R, n);
const FL = require(path.join(_dir('computer_vision_3d'), 'flatland.js'));
let fails = 0;
function ok(name, cond, extra) { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } else console.log('ok  ', name, extra === undefined ? '' : extra); }

// 1. gradient check on a small field
{
  const F = new FL.vol.Field({ x0: -3, x1: 3, z0: -3, z1: 3, nx: 7, nz: 7, nsamp: 20, bg: [1, 1, 1], s0: -1 });
  const rng = FL.rng(5);
  for (let i = 0; i < F.s.length; i++) F.s[i] = -1 + 2 * rng();
  for (let i = 0; i < F.c.length; i++) F.c[i] = 2 * rng() - 1;
  const cams = FL.orbit(3, 6, 0, 0, { f: 56, W: 8 });
  const sc = FL.scenes.statue();
  const views = cams.map(c => ({ cam: c, img: FL.render(sc, c) }));
  const P = views.reduce((a, v) => a + v.cam.W, 0), wgt = 1 / (3 * P);
  const lossFn = (accum) => {
    let L = 0;
    for (const v of views) for (let i = 0; i < v.cam.W; i++) {
      const r = FL.pixelRay(v.cam, i + 0.5);
      const res = F.ray(r.ox, r.oz, r.dx, r.dz, null, [v.img.r[i], v.img.g[i], v.img.b[i]], accum ? wgt : 0);
      L += res.err * wgt;
    }
    return L;
  };
  F.gS.fill(0); F.gC.fill(0); lossFn(true);
  const gS = Float64Array.from(F.gS), gC = Float64Array.from(F.gC);
  let worst = 0, checked = 0;
  for (let k = 0; k < F.s.length; k += 3) {
    const h = 1e-6, s0 = F.s[k]; F.s[k] = s0 + h; const lp = lossFn(false); F.s[k] = s0 - h; const lm = lossFn(false); F.s[k] = s0;
    const num = (lp - lm) / (2 * h);
    if (Math.abs(gS[k]) > 1e-7 || Math.abs(num) > 1e-7) { worst = Math.max(worst, Math.abs(num - gS[k]) / (1e-6 + Math.abs(num))); checked++; }
    const ch = k % 3, id = 3 * k + ch;
    const c0 = F.c[id]; F.c[id] = c0 + h; const lp2 = lossFn(false); F.c[id] = c0 - h; const lm2 = lossFn(false); F.c[id] = c0;
    const num2 = (lp2 - lm2) / (2 * h);
    if (Math.abs(gC[id]) > 1e-7 || Math.abs(num2) > 1e-7) { worst = Math.max(worst, Math.abs(num2 - gC[id]) / (1e-6 + Math.abs(num2))); checked++; }
  }
  ok('Field analytic gradient == finite differences', worst < 1e-4 && checked > 10, `worst rel ${worst.toExponential(2)} over ${checked} params`);
}

// 2. training: held-out PSNR vs number of training views
const sc = FL.scenes.statue();
const R = 6, W = 64, f = 56;
function run(nTrain, steps, opts) {
  opts = opts || {};
  const train = FL.orbit(nTrain, R, 0, 0, { f, W, start: 0.13 });
  const test = FL.orbit(24, R, 0, 0, { f, W, start: 0.13 + Math.PI / 24 * 0.9 });
  const views = train.map(c => ({ cam: c, img: FL.render(sc, c) }));
  const F = new FL.vol.Field({ x0: -3.4, x1: 3.4, z0: -3.4, z1: 3.4, nx: 40, nz: 40, nsamp: 48, bg: sc.bg, s0: -5 });
  const t0 = Date.now(); const hist = [];
  for (let s = 0; s < steps; s++) { const l = F.step(views, { lr: opts.lr || 0.15, jitter: opts.jitter, seed: 3, tv: opts.tv || 0 }); if (s % 25 === 0) hist.push(l.toFixed(4)); }
  const ms = Date.now() - t0;
  // held-out evaluation on views NOT in training
  let ps = 0; const testViews = test.filter((c, i) => true);
  for (const c of testViews) ps += FL.psnr(FL.render(sc, c), F.renderCam(c));
  let tr = 0; for (const v of views) tr += FL.psnr(v.img, F.renderCam(v.cam));
  return { train: tr / views.length, test: ps / testViews.length, ms, hist: hist.join(' '), F };
}
for (const n of [2, 3, 4, 6, 8, 12, 16]) {
  const r = run(n, 150);
  console.log(`views=${String(n).padStart(2)}  train PSNR ${r.train.toFixed(1)}  held-out PSNR ${r.test.toFixed(1)}  (${r.ms} ms / 150 steps)   loss: ${r.hist}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nfield tests passed');
