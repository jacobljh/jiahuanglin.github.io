'use strict';
// regression tests for all_lessons/robot_model_training_new/bench.js  (run: node test_bench.js)
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '../../../../all_lessons');
const BN = require(path.join(root, fs.existsSync(path.join(root, 'robot_model_training_new/bench.js')) ? 'robot_model_training_new' : 'robot_model_training', 'bench.js'));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, t) => Math.abs(a - b) <= t;
// rng
{ const r = BN.rng(1), r2 = BN.rng(1); ok(r() === r2() && r() === r2(), 'rng deterministic'); }
// kinematics
{ const q = [0.7, 1.1], p = BN.arm.fk(q), q2 = BN.arm.ik(p, 1); ok(near(q[0], q2[0], 1e-9) && near(q[1], q2[1], 1e-9), 'ik(fk(q)) = q on the + elbow branch');
  const J = BN.arm.jac(q), e = 1e-6, pa = BN.arm.fk([q[0] + e, q[1]]), fd = [(pa[0] - p[0]) / e, (pa[1] - p[1]) / e]; ok(near(J[0], fd[0], 1e-5) && near(J[2], fd[1], 1e-5), 'jacobian column 1 = finite difference');
  const u = BN.arm.dls(J, [0.1, 0.05], 1e-8), v = [J[0] * u[0] + J[1] * u[1], J[2] * u[0] + J[3] * u[1]]; ok(near(v[0], 0.1, 1e-6) && near(v[1], 0.05, 1e-6), 'dls solves J u = v'); }
// plant
{ const pl = BN.plant({ dt: 0.05 }); pl.reset([0, 0]); pl.step([1, -1]); ok(near(pl.q[0], 0.05, 1e-12) && near(pl.q[1], -0.05, 1e-12), 'kinematic plant: q += dt u');
  const pd = BN.plant({ delay: 2 }); pd.reset([0, 0]); pd.step([1, 0]); pd.step([1, 0]); ok(pd.q[0] === 0, 'delay of 2 steps: nothing moves for two commands'); pd.step([1, 0]); ok(pd.q[0] > 0, '...then it does'); }
// stats
{ const w = BN.stats.wilson(8, 10); ok(near(w[0], 0.4902, 2e-3) && near(w[1], 0.9433, 2e-3), 'wilson 8/10 = [0.490, 0.943]');
  const f = BN.stats.linfit([1, 2, 3], [2, 4, 6]); ok(near(f.slope, 2, 1e-12), 'linfit slope');
  const l = BN.stats.logslope([1, 10, 100], [1, 100, 10000]); ok(near(l.slope, 2, 1e-9), 'logslope of y = x^2 is 2'); }
// expert reliability
{ const w = BN.slalom.world(5), r = BN.rng(2); let okc = 0; for (let k = 0; k < 50; k++) { const ro = BN.rollout(w, BN.expertPolicy(w), r, { noise: 0.05, jit: 0.01 }); if (ro.done && !ro.coll) okc++; } ok(okc === 50, 'expert completes the 5-post slalom 50/50 under noise 0.05 rad/s (got ' + okc + ')'); }
// the nearest-demo policy: copy fidelity high, success decays with course length; DAgger recovers
{
  const H = [0.02, 0.02], build = (w, nDemo, seed) => { const nw = new BN.NW(H), r = BN.rng(seed); BN.demos(w, nDemo, r, { jit: 0.01 }).forEach(ro => { for (let t = 0; t < ro.A.length; t++) nw.add(ro.S[t], BN.slalom.expertAct(w, ro.S[t])); }); return nw; };
  const res = [];
  for (const n of [1, 3, 5]) { const w = BN.slalom.world(n), nw = build(w, 20, 1); const e = BN.evaluate(w, () => (q) => nw.predict(q), 200, 5, { noise: 0.05, jit: 0.01 }); res.push(e.succ); console.log('   n=' + n + ' BC success ' + e.succ.toFixed(2)); }
  ok(res[0] > res[2] + 0.15, 'BC success falls with the course length (n=1 ' + res[0].toFixed(2) + ' > n=5 ' + res[2].toFixed(2) + ' + 0.15)');
  const w = BN.slalom.world(5), nw = build(w, 20, 1), rd = BN.rng(21);
  for (let it = 0; it < 6; it++) for (let i = 0; i < 5; i++) { const ro = BN.rollout(w, (q) => nw.predict(q), rd, { noise: 0.05, jit: 0.01 }); ro.S.forEach(s => nw.add(s, BN.slalom.expertAct(w, s))); }
  const e2 = BN.evaluate(w, () => (q) => nw.predict(q), 200, 5, { noise: 0.05, jit: 0.01 }); console.log('   DAgger(6 rounds) success ' + e2.succ.toFixed(2));
  ok(e2.succ > res[2] + 0.25, 'DAgger lifts the 5-post success well above BC');
}
// determinism of a full evaluation
{ const w = BN.slalom.world(3), mk = () => { const nw = new BN.NW([0.02, 0.02]); BN.demos(w, 10, BN.rng(4)).forEach(ro => { for (let t = 0; t < ro.A.length; t++) nw.add(ro.S[t], BN.slalom.expertAct(w, ro.S[t])); }); return BN.evaluate(w, () => (q) => nw.predict(q), 60, 9, { noise: 0.05 }).succ; }; ok(mk() === mk(), 'evaluation is deterministic'); }
// RFF ridge and MLP fit a smooth function
{ const X = [], Y = [], r = BN.rng(3); for (let i = 0; i < 300; i++) { const x = [2 * r() - 1, 2 * r() - 1]; X.push(x); Y.push([Math.sin(3 * x[0]) * x[1]]); }
  const m = new BN.RFF(2, 1, 120, 0.5, 1e-3, 5); m.add(X, Y); let se = 0; for (let i = 0; i < 100; i++) { const x = [2 * r() - 1, 2 * r() - 1]; se += Math.pow(m.predict(x)[0] - Math.sin(3 * x[0]) * x[1], 2); } ok(se / 100 < 0.01, 'RFF ridge fits sin(3x)y (mse ' + (se / 100).toFixed(4) + ')');
  const net = new BN.MLP([2, 16, 16, 1], 2); net.fit(X, Y, { epochs: 60, lr: 0.01, batch: 32, seed: 1 }); se = 0; for (let i = 0; i < 100; i++) { const x = [2 * r() - 1, 2 * r() - 1]; se += Math.pow(net.predict(x)[0] - Math.sin(3 * x[0]) * x[1], 2); } ok(se / 100 < 0.02, 'MLP fits sin(3x)y (mse ' + (se / 100).toFixed(4) + ')'); }
process.exit(fails ? 1 : 0);
