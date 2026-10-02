const path = require('path'), fs = require('fs');
const _R = path.resolve(__dirname, '../../../../all_lessons');
const _dir = n => fs.existsSync(path.join(_R, n + '_new')) ? path.join(_R, n + '_new') : path.join(_R, n);
const CY = require(path.join(_dir('world_models'), 'courtyard.js'));
let fails = 0;
function ok(name, cond, extra) { if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } else console.log('ok  ', name, extra === undefined ? '' : extra); }
const close = (a, b, t) => Math.abs(a - b) <= t;

// 1. free flight matches the analytic solution
{
  const w = CY.world({ gamma: 0.35, W: 1000, H: 1000, curtain: null });
  let s = [10, 10, 2, -1]; const T = 30;
  for (let t = 0; t < T; t++) s = CY.step(w, s, null);
  const time = T * w.dt, d = Math.exp(-w.gamma * time), g = (1 - d) / w.gamma;
  ok('free flight: v = v0 e^(-γt)', close(s[2], 2 * d, 1e-9) && close(s[3], -1 * d, 1e-9), `${s[2].toFixed(6)} vs ${(2 * d).toFixed(6)}`);
  ok('free flight: p = p0 + v0 (1−e^(−γt))/γ', close(s[0], 10 + 2 * g, 5e-3) && close(s[1], 10 - 1 * g, 5e-3), `${s[0].toFixed(5)} vs ${(10 + 2 * g).toFixed(5)}`);
}
// 2. wall bounce
{
  const w = CY.world({ gamma: 0, W: 4, H: 4, curtain: null, e: 0.9, r: 0.1 });
  let s = [3.5, 2, 2, 0]; for (let t = 0; t < 10; t++) s = CY.step(w, s, null);
  ok('wall bounce reverses and shrinks vx by e', close(s[2], -1.8, 1e-9), s[2]);
}
// 3. diamond fork: head-on ball splits up/down by sign of offset
{
  const w = CY.world({ gamma: 0.05, W: 8, H: 5, curtain: null, r: 0.06, diamonds: [{ x: 4.0, y: 2.5, h: 0.55 }], ePost: 1.0 });
  const out = (b) => { let s = [2.0, 2.5 + b, 2.0, 0]; for (let t = 0; t < 16; t++) s = CY.step(w, s, null); return s; };
  const res = [-0.12, -0.06, -0.02, 0.02, 0.06, 0.12].map(b => [b, out(b)[1] - (2.5 + b), out(b)[3]]);
  console.log('   offset → dy, vy just after the fork:', res.map(r => `${r[0]}:${r[1].toFixed(2)}/${r[2].toFixed(2)}`).join('  '));
  ok('fork: positive offset deflects up, negative down', res[5][2] > 0.5 && res[0][2] < -0.5 && res[3][2] > 0 && res[2][2] < 0);
}
// 4. Kalman filter vs truth
{
  const w = CY.world({ gamma: 0.35, dt: 0.1 }), sigV = 0.05, sigO = 0.1, model = CY.kf.axisModel(w, sigV, sigO);
  // MC: simulate the LINEAR system, filter, check mean NIS ≈ 1 and RMSE vs posterior std
  const rng = CY.rng(5); let nis = 0, cnt = 0, se = 0, sv = 0, pp = 0, pv = 0;
  const trials = 400, T = 60;
  for (let tr = 0; tr < trials; tr++) {
    let x = [0, 1.5], st = { x: Float64Array.from([0, 1.0]), P: Float64Array.from([1, 0, 0, 1]) };
    for (let t = 0; t < T; t++) {
      const F = model.F, nx = [F[0] * x[0] + F[1] * x[1] + 0, F[2] * x[0] + F[3] * x[1]];
      const d = Math.exp(-w.gamma * w.dt), g = (1 - d) / w.gamma; const nv = sigV * CY.randn(rng);
      x = [x[0] + g * (x[1] + nv) , d * x[1] + nv]; // process noise enters velocity before propagation
      st = CY.kf.predict(model, st);
      const z = [x[0] + sigO * CY.randn(rng)];
      const up = CY.kf.update(model, st, z); st = { x: up.x, P: up.P };
      if (t > 20) { nis += up.innov[0] * up.innov[0] / up.S[0]; cnt++; se += (st.x[0] - x[0]) ** 2; sv += (st.x[1] - x[1]) ** 2; pp += st.P[0]; pv += st.P[3]; }
    }
  }
  const m = cnt;
  ok('KF innovation consistency (mean NIS ≈ 1)', close(nis / m, 1, 0.08), (nis / m).toFixed(3));
  ok('KF posterior variance matches realised error (pos)', close(se / m / (pp / m), 1, 0.12), `${(se / m).toExponential(2)} vs ${(pp / m).toExponential(2)}`);
  ok('KF posterior variance matches realised error (vel)', close(sv / m / (pv / m), 1, 0.12), `${(sv / m).toExponential(2)} vs ${(pv / m).toExponential(2)}`);
  // open-loop covariance growth during occlusion
  let st = { x: Float64Array.from([0, 1]), P: Float64Array.from([0.01, 0, 0, 0.01]) }; const trace = [];
  for (let t = 0; t < 12; t++) { st = CY.kf.predict(model, st); trace.push(Math.sqrt(st.P[0])); }
  ok('open-loop position std grows monotonically during occlusion', trace.every((v, i) => i === 0 || v > trace[i - 1]), trace.map(v => v.toFixed(3)).join(' '));
}
// 5. MLP gradient check and fit
{
  const net = new CY.MLP([3, 6, 5, 2], 3), x = [0.3, -0.7, 0.5], y = [0.4, -0.2];
  const loss = () => { const o = net.predict(x); return (o[0] - y[0]) ** 2 + (o[1] - y[1]) ** 2; };
  const g = net.zeroGrad(), acts = net.forward(x), o = acts[net.L]; net.backward(acts, [2 * (o[0] - y[0]), 2 * (o[1] - y[1])], g);
  let worst = 0;
  for (let l = 0; l < net.L; l++) for (let i = 0; i < net.W[l].length; i += 3) { const h = 1e-6, w0 = net.W[l][i]; net.W[l][i] = w0 + h; const lp = loss(); net.W[l][i] = w0 - h; const lm = loss(); net.W[l][i] = w0; const num = (lp - lm) / (2 * h); worst = Math.max(worst, Math.abs(num - g.W[l][i]) / (1e-7 + Math.abs(num))); }
  ok('MLP backprop == finite differences', worst < 1e-5, worst.toExponential(2));
  const rng = CY.rng(2), X = [], Y = []; for (let i = 0; i < 300; i++) { const t = (rng() - 0.5) * 6; X.push([t]); Y.push([Math.sin(t)]); }
  const f = new CY.MLP([1, 24, 24, 1], 4), h = f.fit(X, Y, { epochs: 150, lr: 0.01, batch: 32 });
  let mse = 0; for (let i = 0; i < 100; i++) { const t = (rng() - 0.5) * 6; mse += (f.predict([t])[0] - Math.sin(t)) ** 2 / 100; }
  ok('MLP fits sin(x)', mse < 0.01, `test MSE ${mse.toFixed(4)}  (train ${h[0].toFixed(3)} → ${h[h.length - 1].toFixed(4)})`);
}
// 6. MDN gradient and bimodal fit
{
  const K = 2, net = new CY.MLP([1, 8, 3 * K], 9), x = [0.3], y = 0.8;
  const loss = () => CY.mdn.nll(net.predict(x), K, y, new Float64Array(3 * K));
  const g = net.zeroGrad(), acts = net.forward(x), d = new Float64Array(3 * K); CY.mdn.nll(acts[net.L], K, y, d); net.backward(acts, d, g);
  let worst = 0;
  for (let l = 0; l < net.L; l++) for (let i = 0; i < net.W[l].length; i += 2) { const h = 1e-6, w0 = net.W[l][i]; net.W[l][i] = w0 + h; const lp = loss(); net.W[l][i] = w0 - h; const lm = loss(); net.W[l][i] = w0; const num = (lp - lm) / (2 * h); worst = Math.max(worst, Math.abs(num - g.W[l][i]) / (1e-7 + Math.abs(num))); }
  ok('MDN NLL gradient == finite differences', worst < 1e-5, worst.toExponential(2));
  // bimodal data: y = ±1 with prob depending on x
  const rng = CY.rng(8), X = [], Y = [];
  for (let i = 0; i < 800; i++) { const t = (rng() - 0.5) * 2, p = CY.stats.ncdf(t * 3); X.push([t]); Y.push((rng() < p ? 1 : -1) + 0.1 * CY.randn(rng)); }
  const mdn = new CY.MLP([1, 16, 3 * K], 3), mse = new CY.MLP([1, 16, 1], 3);
  mdn.fitMDN(X, Y, K, { epochs: 120, lr: 0.01, batch: 32 }); mse.fit(X, Y.map(v => [v]), { epochs: 120, lr: 0.01, batch: 32 });
  const mix = CY.mdn.mixture(mdn.predict([0]), K), mm = mse.predict([0])[0];
  const mus = Array.from(mix.mu).sort((a, b) => a - b);
  ok('MDN recovers the two modes at x=0 while MSE predicts the mean (~0)', mus[0] < -0.8 && mus[1] > 0.8 && Math.abs(mm) < 0.3, `modes ${mus.map(v => v.toFixed(2))}  weights ${Array.from(mix.pi).map(v => v.toFixed(2))}  MSE→${mm.toFixed(2)}`);
  const dens0 = CY.mdn.density(mdn.predict([0]), K, 0), dens1 = CY.mdn.density(mdn.predict([0]), K, 1);
  ok('MSE mean sits in a density valley', dens0 < 0.2 * dens1, `p(0)=${dens0.toFixed(3)} vs p(1)=${dens1.toFixed(3)}`);
}
// 7. CEM
{
  const r = CY.cem(v => (v[0] - 1.5) ** 2 + (v[1] + 0.5) ** 2, 2, { iters: 8, pop: 60, sd0: 2, seed: 3 });
  ok('CEM minimises a quadratic', close(r.best[0], 1.5, 0.1) && close(r.best[1], -0.5, 0.1), Array.from(r.best).map(v => v.toFixed(3)).join(','));
}
// 8. linalg
{
  const rng = CY.rng(3), n = 200, p = 3, Phi = new Float64Array(n * p), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { for (let j = 0; j < p; j++) Phi[i * p + j] = CY.randn(rng); Y[i] = 2 * Phi[i * p] - 1 * Phi[i * p + 1] + 0.5 * Phi[i * p + 2] + 0.01 * CY.randn(rng); }
  const Wt = CY.la.ridge(Phi, n, p, Y, 1, 1e-6);
  ok('ridge recovers coefficients', close(Wt[0], 2, 0.01) && close(Wt[1], -1, 0.01) && close(Wt[2], 0.5, 0.01), Array.from(Wt).map(v => v.toFixed(3)).join(','));
  const A = [2, 1, 0, 1, 3, 1, 0, 1, 4], e = CY.la.eigSym(A, 3);
  ok('eigSym: Av = λv', e.vals.every((lam, k) => { const v = e.vecs[k]; return [0, 1, 2].every(i => close(A[3 * i] * v[0] + A[3 * i + 1] * v[1] + A[3 * i + 2] * v[2], lam * v[i], 1e-10)); }));
}
// 9. launcher and the fork scene
{
  const w = CY.scenes.plain(), r1 = CY.rng(4), r2 = CY.rng(4), a = CY.launch(w, r1), b = CY.launch(w, r2);
  ok('launch is deterministic and inside its ranges', a.every((v, i) => v === b[i]) && a[0] === 0.5 && a[1] >= 1 && a[1] <= 4 && Math.hypot(a[2], a[3]) >= 2 && Math.hypot(a[2], a[3]) <= 3.0001, a.map(v => v.toFixed(3)).join(','));
  const f = CY.scenes.fork(), run = (b0, T) => { let s = [0.5, 2.5 + b0, 2.4, 0]; for (let t = 0; t < (T || 70); t++) s = CY.step(f, s, null); return s; };
  const up = run(0.12), dn = run(-0.12), nrm = run(0.0);
  ok('fork: |b| = 0.12 slides up / down the faces and ends far from the axis', up[1] > 3.5 && dn[1] < 1.5, `${up[1].toFixed(2)} / ${dn[1].toFixed(2)}`);
  const u40 = run(0.12, 40), d40 = run(-0.12, 40), mx = (u40[0] + d40[0]) / 2, my = (u40[1] + d40[1]) / 2;
  ok('fork: 1.5 s after the hit the average of the two outcomes lies INSIDE the diamond (the mean ball passes through the post)', Math.abs(mx - 4.4) + Math.abs(my - 2.5) < 0.6 && Math.abs(u40[1] - d40[1]) > 1.5, `mean (${mx.toFixed(2)},${my.toFixed(2)}), branches ${u40[1].toFixed(2)} / ${d40[1].toFixed(2)}`);
  ok('fork: a ball aimed exactly at the vertex stalls near it', Math.abs(nrm[1] - 2.5) < 0.2 && nrm[0] < 4.0, nrm.slice(0, 2).map(v => v.toFixed(2)).join(','));
}
// 10. k-means
{
  const rng = CY.rng(9), X = [], truth = [[0, 0], [5, 0], [0, 5]];
  for (let i = 0; i < 300; i++) { const c = truth[i % 3]; X.push([c[0] + 0.3 * CY.randn(rng), c[1] + 0.3 * CY.randn(rng)]); }
  const km = CY.kmeans(X, 3, { seed: 2 }), found = km.centers.map(c => [c[0], c[1]]);
  const okc = truth.every(t => found.some(c => Math.hypot(c[0] - t[0], c[1] - t[1]) < 0.2));
  ok('kmeans recovers three well-separated clusters', okc, found.map(c => c.map(v => v.toFixed(2)).join(',')).join(' | '));
  ok('kmeans.nearest agrees with the assignment', X.every((x, i) => CY.kmeans.nearest(km.centers, x) === km.assign[i]));
}
// 11. RNN: gradient check, memory task, masking
{
  const net = new CY.RNN(2, 5, 2, 3), rng = CY.rng(5), T = 6, seq = { x: [], y: [], m: [] };
  for (let t = 0; t < T; t++) { seq.x.push([rng() - 0.5, rng() - 0.5]); seq.y.push([rng() - 0.5, rng() - 0.5]); seq.m.push(t === 1 ? 0 : 1); }
  const lossOf = () => { const r = net.run(seq.x); let L = 0; for (let t = 0; t < T; t++) if (seq.m[t]) for (let j = 0; j < 2; j++) L += (r.ys[t][j] - seq.y[t][j]) ** 2 / 2; return L; };
  const g = net.zeroGrad(), r0 = net.run(seq.x); const b0 = net.backward(seq, r0, g);
  ok('RNN loss from backward() equals the direct loss', close(b0.loss, lossOf(), 1e-12) && b0.count === T - 1, b0.loss.toFixed(6));
  let worst = 0;
  for (const name of net.names) for (let i = 0; i < net[name].length; i += 2) {
    const h = 1e-6, w0 = net[name][i]; net[name][i] = w0 + h; const lp = lossOf(); net[name][i] = w0 - h; const lm = lossOf(); net[name][i] = w0;
    const num = (lp - lm) / (2 * h); worst = Math.max(worst, Math.abs(num - g[name][i]) / (1e-7 + Math.abs(num)));
  }
  ok('RNN BPTT == finite differences (all five parameter blocks, masked step ignored)', worst < 1e-5, worst.toExponential(2));
  // memory: output the input from 3 steps ago
  const mem = new CY.RNN(1, 12, 1, 4), seqs = [], r2 = CY.rng(8);
  for (let n = 0; n < 200; n++) { const xs = [], ys = []; for (let t = 0; t < 14; t++) { xs.push([r2() * 2 - 1]); ys.push([t >= 3 ? xs[t - 3][0] : 0]); } seqs.push({ x: xs, y: ys, m: ys.map((_, t) => t >= 3 ? 1 : 0) }); }
  const hist = mem.fit(seqs, { epochs: 140, lr: 0.02, batch: 20, seed: 3 });
  ok('RNN learns to recall the input from three steps ago (loss falls by > 20x)', hist[hist.length - 1] < hist[0] / 20, `${hist[0].toFixed(3)} → ${hist[hist.length - 1].toFixed(4)}`);
}
// 12. images of the Courtyard
{
  const w = CY.scenes.plain(), img = CY.img.render(w, [1.5, 3.0, 0, 0]), pw = 24, ph = 15;
  let sx = 0, sy = 0, sm = 0; for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) { const v = img[j * pw + i] - 0.18; if (i < 7 && v > 0.05) { sx += v * (i + 0.5); sy += v * (j + 0.5); sm += v; } }
  ok('image: the ball blob centroid recovers the ball position to < 0.1 px', close(sx / sm / 3, 1.5, 0.05) && close(5 - sy / sm / 3, 3.0, 0.05), `(${(sx / sm / 3).toFixed(3)}, ${(5 - sy / sm / 3).toFixed(3)})`);
  const hid = CY.img.render(w, [3.0, 2.5, 0, 0]), seen = CY.img.render(w, [3.0, 2.5, 0, 0], { seeThrough: true });
  const mx = a => Math.max.apply(null, Array.from(a));
  ok('image: the ball is not drawn behind the curtain (unless seeThrough)', mx(seen) > mx(hid) + 0.3, `${mx(hid).toFixed(2)} vs ${mx(seen).toFixed(2)}`);
  const g2 = CY.img.render(w, [1.5, 3.0, 0, 0], { gain: 2 });
  ok('image: gain scales every pixel', img.every((v, i) => close(g2[i], 2 * v, 1e-6)));
}
console.log(fails ? `\n${fails} FAILED` : '\nall courtyard tests passed');
process.exit(fails ? 1 : 0);
