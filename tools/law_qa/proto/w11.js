// w11.js — prototype + re-derivation for 课 11 「公园里不许有车」
// run: node tools/law_qa/proto/w11.js
'use strict';
function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
function g(a) { return 0.45 + 0.25 * Math.sin(3 * a); }
function truth(a, b) { return b >= g(a) ? 1 : 0; }
function text(a, b) { return a >= 0.5 ? 1 : 0; }

// 1. analytic area of the prohibited region: ∫0^1 (1 - g(a)) da
var areaProhibited = 1 - (0.45 + 0.25 * (1 - Math.cos(3)) / 3);
console.log('analytic prohibited share', areaProhibited.toFixed(4), ' => always-allow accuracy', (1 - areaProhibited).toFixed(4));
// analytic text-rule accuracy: a>=.5 says prohibit; correct when b>=g(a) on right half, b<g(a) on left half
var accR = 0, accL = 0, N = 200000, i;
for (i = 0; i < N; i++) { var a = (i + 0.5) / N; var pr = 1 - g(a); if (a >= 0.5) accR += pr / N; else accL += (1 - pr) / N; }
console.log('analytic text-rule accuracy', (accR + accL).toFixed(4));

function tests(off, m) { var T = []; for (var j = 1; j <= m; j++) T.push([halton(off + j, 2), halton(off + j, 3)]); return T; }
function precedents(n, noise) {
  var P = [];
  for (var j = 1; j <= n; j++) {
    var a = halton(j, 2), b = halton(j, 3), y = truth(a, b);
    var flip = ((j * 7919) % 1000) / 1000 < noise;
    P.push([a, b, flip ? 1 - y : y, flip ? 1 : 0, y]);
  }
  return P;
}
function predict(P, a, b, k) {
  if (P.length === 0) return text(a, b);
  var kk = Math.min(k, P.length), best = [], j;
  for (j = 0; j < P.length; j++) {
    var d = (P[j][0] - a) * (P[j][0] - a) + (P[j][1] - b) * (P[j][1] - b);
    if (best.length < kk) { best.push([d, P[j][2]]); best.sort(function (x, y) { return x[0] - y[0]; }); }
    else if (d < best[kk - 1][0]) { best[kk - 1] = [d, P[j][2]]; best.sort(function (x, y) { return x[0] - y[0]; }); }
  }
  var s = 0; for (j = 0; j < kk; j++) s += best[j][1];
  return s * 2 > kk ? 1 : 0;
}
function acc(n, noise, off, k) {
  var T = tests(off, 1500), P = precedents(n, noise), ok = 0, dis = 0;
  T.forEach(function (t) { var p = predict(P, t[0], t[1], k), tr = truth(t[0], t[1]); if (p === tr) ok++; if (p !== text(t[0], t[1])) dis++; });
  return { acc: ok / T.length, dis: dis / T.length };
}
var T0 = tests(3000, 1500), tr = 0;
T0.forEach(function (t) { if (text(t[0], t[1]) === truth(t[0], t[1])) tr++; });
console.log('text rule accuracy on batch 0:', (tr / T0.length).toFixed(3));
var NL = [0, 1, 2, 3, 4, 5, 7, 10, 14, 20, 28, 40, 57, 80, 113, 160, 226, 320];
NL.forEach(function (n) {
  var c = acc(n, 0, 3000, 3), d = acc(n, 0.10, 3000, 3), e = acc(n, 0.30, 3000, 3);
  console.log('n=' + n + '  clean ' + c.acc.toFixed(3) + '  disagree-with-text ' + c.dis.toFixed(3) + '   10% wrong ' + d.acc.toFixed(3) + '   30% wrong ' + e.acc.toFixed(3));
});
// other batches (换一批)
[3000, 4500, 6000, 7500].forEach(function (off) { var T = tests(off, 1500), t2 = 0; T.forEach(function (t) { if (text(t[0], t[1]) === truth(t[0], t[1])) t2++; }); console.log('batch off=' + off + ' text acc ' + (t2 / T.length).toFixed(3) + '  n=40 ' + acc(40, 0, off, 3).acc.toFixed(3) + '  n=320 ' + acc(320, 0, off, 3).acc.toFixed(3)); });
// k sensitivity (just a sanity check that k=3 isn't a knife-edge)
[1, 3, 5, 7].forEach(function (k) { console.log('k=' + k + ' n=40 ' + acc(40, 0, 3000, k).acc.toFixed(3) + ' n=320 ' + acc(320, 0, 3000, k).acc.toFixed(3) + ' | 10% wrong n=40 ' + acc(40, 0.1, 3000, k).acc.toFixed(3) + ' n=320 ' + acc(320, 0.1, 3000, k).acc.toFixed(3)); });
// how many precedents get flipped at each n for noise .1
[10, 40, 80, 320].forEach(function (n) { var P = precedents(n, 0.1), f = 0; P.forEach(function (p) { f += p[3]; }); console.log('n=' + n + ' flipped at 10% = ' + f); });
[10, 40, 80, 320].forEach(function (n) { var P = precedents(n, 0.3), f = 0; P.forEach(function (p) { f += p[3]; }); console.log('n=' + n + ' flipped at 30% = ' + f); });

// ---- noise cost sign check: clean - noisy over all n and noise 1..30
(function(){
  var neg = [], worst = 0;
  NL.forEach(function(n){ var c = acc(n, 0, 3000, 3).acc; for (var q = 1; q <= 30; q++){ var d = acc(n, q/100, 3000, 3).acc; var diff = c - d; if (diff < -0.0005) neg.push(n + '@' + q + ':' + (diff*100).toFixed(1)); if (diff > worst) worst = diff; } });
  console.log('noisy better than clean at:', neg.length, neg.slice(0, 20).join(' '));
  console.log('worst loss', (worst*100).toFixed(1));
  // disagreement: who is right
  [5, 10, 40, 320].forEach(function(n){ var T = tests(3000, 1500), P = precedents(n, 0), dis = 0, right = 0; T.forEach(function(t){ var p = predict(P, t[0], t[1], 3); if (p !== text(t[0], t[1])) { dis++; if (p === truth(t[0], t[1])) right++; } }); console.log('n=' + n + ' disagree ' + (dis/1500).toFixed(3) + ' precedent right in ' + (right/dis).toFixed(3)); });
})();
