const path = require('path'), fs = require('fs');
const _R = path.resolve(__dirname, '../../../../all_lessons');
const _dir = n => fs.existsSync(path.join(_R, n + '_new')) ? path.join(_R, n + '_new') : path.join(_R, n);
const FL = require(path.join(_dir('computer_vision_3d'), 'flatland.js'));
const SH = FL.shape;
const rng = FL.rng(17);
const probe = Array.from({ length: 72 }, (_, i) => -Math.PI + 2 * Math.PI * (i + 0.5) / 72);
const half = 80 * Math.PI / 180, sigma = 0.01;
const priors = { broad: SH.prior('broad'), smooth: SH.prior('smooth', { s0: 0.12, p: 1 }), learned: SH.prior('learned') };
function trial(th, alphas, kind) {
  const meas = SH.measure(th, alphas, 9, half, sigma, rng);
  const post = SH.posterior(meas.phis, meas.y, sigma, priors[kind]);
  const prof = SH.profile(post, probe);
  let eS = 0, nS = 0, eU = 0, nU = 0, sdU = 0, cov = 0, covU = 0;
  probe.forEach((p, i) => { const truth = SH.radius(th, p), err = prof.mean[i] - truth, seen = SH.seen(p, alphas, half);
    if (seen) { eS += err * err; nS++; } else { eU += err * err; nU++; sdU += prof.std[i]; if (Math.abs(err) <= 2 * prof.std[i]) covU++; } if (Math.abs(err) <= 2 * prof.std[i]) cov++; });
  return { rmseS: Math.sqrt(eS / Math.max(1, nS)), rmseU: nU ? Math.sqrt(eU / nU) : 0, sdU: nU ? sdU / nU : 0, covU: nU ? covU / nU : 1, cov: cov / probe.length, nU };
}
// in-family test shapes (averaged over 60)
for (const views of [[0], [0, Math.PI / 2], [0, 2 * Math.PI / 3, 4 * Math.PI / 3], [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]]) {
  const row = {};
  for (const kind of ['broad', 'smooth', 'learned']) {
    let rU = 0, rS = 0, sd = 0, c = 0, nU = 0; const T = 60;
    for (let t = 0; t < T; t++) { const th = SH.sampleFamily(FL.rng(1000 + t)); const r = trial(th, views, kind); rU += r.rmseU; rS += r.rmseS; sd += r.sdU; c += r.covU; nU = r.nU; }
    row[kind] = `unseen RMSE ${(rU / T).toFixed(3)} (post.std ${(sd / T).toFixed(3)}, 2σ-cover ${(c / T * 100).toFixed(0)}%) seen ${(rS / T).toFixed(3)}`;
  }
  console.log(`${views.length} view(s), unseen probes=${trial(SH.sampleFamily(FL.rng(5)), views, 'smooth').nU}/72:`);
  for (const k in row) console.log('   ', k.padEnd(8), row[k]);
}
// out-of-family shape: a square-ish bump (k=4 strong, k=2 negative) the family never makes
const ood = new Float64Array(10); ood[6] = -0.12; ood[7] = 0.05; ood[2] = -0.09; ood[8] = 0.07;
console.log('OOD shape, 2 views [0, 90°]:');
for (const kind of ['smooth', 'learned']) { const r = trial(ood, [0, Math.PI / 2], kind); console.log('   ', kind.padEnd(8), `unseen RMSE ${r.rmseU.toFixed(3)}  seen RMSE ${r.rmseS.toFixed(3)}  post.std ${r.sdU.toFixed(3)}  2σ-cover ${(r.covU * 100).toFixed(0)}%`); }
// the statue's own coefficients
const st = SH.fromHarmonics(FL.scenes.statue().shapes[0].harm);
console.log('statue θ =', Array.from(st).map(v => v.toFixed(3)).join(' '));
for (const kind of ['smooth', 'learned']) { const r = trial(st, [0], kind); console.log('   statue, 1 view,', kind.padEnd(8), `unseen RMSE ${r.rmseU.toFixed(3)} post.std ${r.sdU.toFixed(3)}`); }
// round-trip harmonics
const back = SH.fromHarmonics(SH.harmonics(st)); console.log('harmonics round trip max err', Math.max(...Array.from(back).map((v, i) => Math.abs(v - st[i]))).toExponential(2));
// shape → blob radius agrees
const blob = FL.blob(0, 0, 1, SH.harmonics(st), [1, 0, 0]); console.log('blob vs radius at φ=0.7:', FL.blobRadius(blob, 0.7).toFixed(6), SH.radius(st, 0.7).toFixed(6));
