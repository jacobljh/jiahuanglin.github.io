// proto/08.js — lesson 08 噪声: take a panel's error apart.  A TOY model (every σ² is a demo value, 示意; no published decomposition is used).
// run: node tools/psy_qa/proto/08.js          (the widget in 08_noise.html implements EXACTLY this algorithm)
//
// Error of one judgment (judge j, case c, occasion t):   e = b + σL·L_j + σP·P_jc + σO·O_jct
//   b   bias shared by all judges (the part that is NOT noise)         L_j  level noise: judge j is harsher / softer than the others
//   P_jc pattern noise: judge × case reaction (stable over time)        O_jct occasion noise: the same judge, same case, another day
// Identity (exact in any sample):  MSE = mean(e)² + var(e) = bias² + noise².
// Three ways to ask (the same number n of answers each):
//   ① one judge, once                       noise² = σL² + σP² + σO²
//   ② n DIFFERENT judges, averaged          noise² = (σL² + σP² + σO²) / n         (independent errors)
//   ③ the SAME judge, n occasions, averaged noise² = σL² + σP² + σO² / n           (only the occasion part shrinks)
// Sample design (the spec: "draws standardised so sample variances equal the sliders", taken to its end): R = 240 rounds × K = 12 cases = N = 2880
// errors per row.  Every random vector is made mean-0 / mean-square-1 and EXACTLY orthogonal to all the others (row-centred + Gram–Schmidt), i.e. the
// "independent judges" assumption is realised exactly in the sample, so the sample MSE equals b² + noise² of the formula to rounding.  Real data would
// wiggle around the formula; that wiggle is NOT modelled.  Seeded with PSY.rng(2008).
var PSY = require('./_psy.js');
var R = 240, K = 12, N = R * K, NS = 16, NP = NS, NO = NS + (NS - 1);
function build() {
  var rng = PSY.rng(2008), g = function () { return PSY.gauss(rng); }, i, j, s, r, k;
  function dot(a, b) { var q = 0, t; for (t = 0; t < a.length; t++) q += a[t] * b[t]; return q; }
  function orth(list) {                                    // modified Gram–Schmidt, each vector scaled to mean-square 1
    var a, b, c;
    for (a = 0; a < list.length; a++) {
      for (b = 0; b < a; b++) { c = dot(list[a], list[b]) / list[a].length; for (i = 0; i < list[a].length; i++) list[a][i] -= c * list[b][i]; }
      c = Math.sqrt(dot(list[a], list[a]) / list[a].length) || 1; for (i = 0; i < list[a].length; i++) list[a][i] /= c;
    }
  }
  var Lz = [], Pz = [], Oz = [], v, m;
  for (s = 0; s < NS; s++) { v = new Float64Array(R); m = 0; for (r = 0; r < R; r++) { v[r] = g(); m += v[r]; } m /= R; for (r = 0; r < R; r++) v[r] -= m; Lz.push(v); }
  orth(Lz);
  function rowvec() { var w = new Float64Array(N); for (r = 0; r < R; r++) { m = 0; for (k = 0; k < K; k++) { w[r * K + k] = g(); m += w[r * K + k]; } m /= K; for (k = 0; k < K; k++) w[r * K + k] -= m; } return w; }
  for (s = 0; s < NP; s++) Pz.push(rowvec());
  for (s = 0; s < NO; s++) Oz.push(rowvec());
  orth(Pz.concat(Oz));                                     // Pz and Oz are the same array objects as in the concat, so they are orthonormalised in place
  return { Lz: Lz, Pz: Pz, Oz: Oz };
}
var D = build();
function run(o) {                                          // o: b, vL, vP, vO (variances), n
  var sL = Math.sqrt(o.vL), sP = Math.sqrt(o.vP), sO = Math.sqrt(o.vO), n = o.n, e = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  var r, k, s, t, i, ln, pn, on, orp;
  for (r = 0; r < R; r++) {
    ln = 0; for (s = 0; s < n; s++) ln += D.Lz[s][r]; ln /= n;
    for (k = 0; k < K; k++) {
      i = r * K + k; pn = 0; on = 0; for (s = 0; s < n; s++) { pn += D.Pz[s][i]; on += D.Oz[s][i]; } pn /= n; on /= n;
      orp = D.Oz[0][i]; for (t = 1; t < n; t++) orp += D.Oz[NS - 1 + t][i]; orp /= n;
      e[0][i] = o.b + sL * D.Lz[0][r] + sP * D.Pz[0][i] + sO * D.Oz[0][i];
      e[1][i] = o.b + sL * ln + sP * pn + sO * on;
      e[2][i] = o.b + sL * D.Lz[0][r] + sP * D.Pz[0][i] + sO * orp;
    }
  }
  function stat(x) { var m = 0, q = 0, v = 0, i; for (i = 0; i < N; i++) { m += x[i]; q += x[i] * x[i]; } m /= N; q /= N; for (i = 0; i < N; i++) v += (x[i] - m) * (x[i] - m); v /= N; return { mean: m, bias2: m * m, noise2: v, mse: q, chk: q - m * m - v }; }
  var S = e.map(stat), V = o.vL + o.vP + o.vO, b2 = o.b * o.b;
  return { s: S, th: [b2 + V, b2 + V / n, b2 + o.vL + o.vP + o.vO / n] };
}
function f(x) { return x.toFixed(2); }
function show(label, o) {
  var q = run(o), names = ['① 一位评委      ', '② n 位不同评委  ', '③ 同一位评委 n 次'];
  console.log(label + '  (b ' + o.b + ', σL² ' + o.vL + ', σP² ' + o.vP + ', σO² ' + o.vO + ', n ' + o.n + ')');
  q.s.forEach(function (s, i) { console.log('  ' + names[i], 'MSE', f(s.mse), '= bias²', f(s.bias2), '+ noise²', f(s.noise2), '| identity gap', s.chk.toExponential(1), '| formula', f(q.th[i])); });
  return q;
}
if (require.main === module) {
  var def = { b: 5, vL: 30, vP: 45, vO: 25, n: 4 };
  show('默认', def);
  [1, 2, 4, 8, 16].forEach(function (n) { var q = run({ b: 5, vL: 30, vP: 45, vO: 25, n: n }); console.log('  n', n, '→ ② MSE', f(q.s[1].mse), ' ③ MSE', f(q.s[2].mse), ' (b² + σ²/n =', f(25 + 100 / n) + ')'); });
  show('没有偏差', { b: 0, vL: 30, vP: 45, vO: 25, n: 4 });
  show('没有偏差，n = 16', { b: 0, vL: 30, vP: 45, vO: 25, n: 16 });
  show('偏差很大', { b: 12, vL: 10, vP: 10, vO: 5, n: 4 });
  show('偏差很大，n = 16', { b: 12, vL: 10, vP: 10, vO: 5, n: 16 });
  show('场合噪声为主', { b: 5, vL: 5, vP: 5, vO: 90, n: 4 });
  show('水平与模式噪声为主', { b: 5, vL: 45, vP: 45, vO: 10, n: 4 });
  show('全零', { b: 0, vL: 0, vP: 0, vO: 0, n: 4 });
}
if (typeof module !== 'undefined') module.exports = { run: run };
