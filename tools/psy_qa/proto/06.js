// proto/06.js — lesson 06 widget maths: bias–variance. A flexible rule vs a simple (biased) rule, learning from n examples. (示意 simulation)
// run: node tools/psy_qa/proto/06.js
// World: criterion y = Σ_j β_j x_j + ε,  J cues with pairwise correlation ρ; noise sd chosen so that the best possible model explains R² of the variance.
// Learners see n training cases and then predict 2,000 fresh cases:
//   FULL   : least squares with all J cues, each weight fitted from the n cases (ridge 1e-6 so n ≤ J still returns an answer)
//   TALLY  : "equal weights" = sum of the cues' signs-as-fitted (each cue gets weight ±1 by the sign of its correlation with y), one scale factor fitted
//   ONE    : the single best cue by correlation with y (a take-the-best flavour), slope fitted
// Reported: out-of-sample RMSE averaged over REPS training sets; the decomposition error² = bias² + variance + noise² at the test points.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeGauss(rng) { var spare = null; return function () { if (spare !== null) { var s = spare; spare = null; return s; } var u = 0, v = 0; while (u === 0) u = rng(); v = rng(); var m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v); }; }
function solve(A, b) { // Gaussian elimination with partial pivoting
  var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
  for (var c = 0; c < n; c++) {
    var p = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    var t = M[c]; M[c] = M[p]; M[p] = t;
    for (r = c + 1; r < n; r++) { var f = M[r][c] / M[c][c]; for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  var x = new Array(n).fill(0);
  for (var i = n - 1; i >= 0; i--) { var s = M[i][n]; for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function run(opts) {
  var J = opts.J, rho = opts.rho, R2 = opts.R2, n = opts.n, reps = opts.reps, seed = opts.seed;
  var rr = 1 - 0.75 * (opts.spread == null ? 0.2 : opts.spread), beta = []; for (var j = 0; j < J; j++) beta.push(Math.pow(rr, j));  // true weights β_j = r^j: spread 0 → all equal, spread 1 → one cue dominates
  var rng = mulberry32(seed), g = makeGauss(rng);
  var cov = 0; for (j = 0; j < J; j++) for (var k = 0; k < J; k++) cov += beta[j] * beta[k] * (j === k ? 1 : rho);
  var sigE = Math.sqrt(cov * (1 - R2) / R2);
  function draw() { var z = g(), x = []; for (var j = 0; j < J; j++) x.push(Math.sqrt(rho) * z + Math.sqrt(1 - rho) * g()); var y = sigE * g(); for (j = 0; j < J; j++) y += beta[j] * x[j]; return { x: x, y: y }; }
  var T = 400, test = []; for (var i = 0; i < T; i++) test.push(draw());
  var names = ['FULL', 'TALLY', 'ONE'], sse = { FULL: 0, TALLY: 0, ONE: 0 }, preds = { FULL: [], TALLY: [], ONE: [] };
  names.forEach(function (nm) { for (var i = 0; i < T; i++) preds[nm].push([]); });
  for (var r = 0; r < reps; r++) {
    var tr = []; for (i = 0; i < n; i++) tr.push(draw());
    var my = 0; tr.forEach(function (d) { my += d.y; }); my /= n;
    // FULL
    var A = [], bvec = []; for (j = 0; j < J; j++) { A.push(new Array(J).fill(0)); bvec.push(0); }
    tr.forEach(function (d) { for (var a = 0; a < J; a++) { bvec[a] += d.x[a] * (d.y - my); for (var b = 0; b < J; b++) A[a][b] += d.x[a] * d.x[b]; } });
    for (j = 0; j < J; j++) A[j][j] += 1e-6;
    var w = solve(A, bvec);
    // correlations with y
    var cj = new Array(J).fill(0); tr.forEach(function (d) { for (var a = 0; a < J; a++) cj[a] += d.x[a] * (d.y - my); });
    var sgn = cj.map(function (c) { return c >= 0 ? 1 : -1; });
    var bestj = 0; for (j = 1; j < J; j++) if (Math.abs(cj[j]) > Math.abs(cj[bestj])) bestj = j;
    // TALLY scale
    var sT = 0, sTT = 0, sTy = 0; tr.forEach(function (d) { var t = 0; for (var a = 0; a < J; a++) t += sgn[a] * d.x[a]; sTT += t * t; sTy += t * (d.y - my); });
    var cT = sTy / (sTT + 1e-9);
    var sOO = 0, sOy = 0; tr.forEach(function (d) { sOO += d.x[bestj] * d.x[bestj]; sOy += d.x[bestj] * (d.y - my); });
    var cO = sOy / (sOO + 1e-9);
    for (i = 0; i < T; i++) {
      var d = test[i], pf = my, pt = my, p1 = my;
      for (var a = 0; a < J; a++) { pf += w[a] * d.x[a]; pt += cT * sgn[a] * d.x[a]; }
      p1 += cO * d.x[bestj];
      preds.FULL[i].push(pf); preds.TALLY[i].push(pt); preds.ONE[i].push(p1);
    }
  }
  // errors vs truth f(x) = Σ β x  (noise-free) and vs y
  var out = {};
  names.forEach(function (nm) {
    var bias2 = 0, vari = 0, rmse = 0;
    for (var i = 0; i < T; i++) {
      var f = 0; for (var j = 0; j < J; j++) f += beta[j] * test[i].x[j];
      var m = 0; preds[nm][i].forEach(function (p) { m += p; }); m /= reps;
      var v = 0; preds[nm][i].forEach(function (p) { v += (p - m) * (p - m); }); v /= reps;
      bias2 += (m - f) * (m - f); vari += v;
    }
    bias2 /= T; vari /= T;
    out[nm] = { bias2: bias2, variance: vari, rmse: Math.sqrt(bias2 + vari + sigE * sigE) };
  });
  out.noise = sigE; return out;
}
if (require.main === module) {
  if (process.argv[2] === 'spread') { [0, 0.3, 0.6, 0.9].forEach(function (sp) { console.log('spread', sp); [10, 20, 50, 200].forEach(function (n) { var o = run({ J: 6, rho: 0.4, R2: 0.6, reps: 250, seed: 7, n: n, spread: sp }); console.log('  n=' + n, 'FULL', o.FULL.rmse.toFixed(2), 'TALLY', o.TALLY.rmse.toFixed(2), 'ONE', o.ONE.rmse.toFixed(2)); }); }); process.exit(0); }
  var base = { J: 6, rho: 0.4, R2: 0.5, reps: 300, seed: 2026 };
  console.log('J=6 ρ=.4 R²=.5   (RMSE out of sample; lower is better)');
  [6, 8, 10, 15, 20, 30, 50, 100, 200].forEach(function (n) {
    var o = run(Object.assign({}, base, { n: n }));
    console.log('n=' + String(n).padStart(3), 'FULL', o.FULL.rmse.toFixed(2), '(b²' + o.FULL.bias2.toFixed(2) + ' v' + o.FULL.variance.toFixed(2) + ')', 'TALLY', o.TALLY.rmse.toFixed(2), '(b²' + o.TALLY.bias2.toFixed(2) + ' v' + o.TALLY.variance.toFixed(2) + ')', 'ONE', o.ONE.rmse.toFixed(2), '(b²' + o.ONE.bias2.toFixed(2) + ' v' + o.ONE.variance.toFixed(2) + ')', 'noise', o.noise.toFixed(2));
  });
  console.log('noisier world R²=.2:'); [10, 20, 50, 200].forEach(function (n) { var o = run(Object.assign({}, base, { R2: 0.2, n: n })); console.log('n=' + n, 'FULL', o.FULL.rmse.toFixed(2), 'TALLY', o.TALLY.rmse.toFixed(2), 'ONE', o.ONE.rmse.toFixed(2)); });
  console.log('cleaner world R²=.9:'); [10, 20, 50, 200].forEach(function (n) { var o = run(Object.assign({}, base, { R2: 0.9, n: n })); console.log('n=' + n, 'FULL', o.FULL.rmse.toFixed(2), 'TALLY', o.TALLY.rmse.toFixed(2), 'ONE', o.ONE.rmse.toFixed(2)); });
}
module.exports = { run: run };
