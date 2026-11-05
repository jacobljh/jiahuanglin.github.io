// w02.js — prototype + independent re-derivation of the lesson-02 widget model (run: node tools/law_qa/proto/w02.js)
// Model: per application, rule = k*H^2 + 0.1 ; standard = k*sigma^2 + c_adj ; one-off: K_R = 60, K_S = 5 ; k = 1.
'use strict';
var KR = 60, KS = 5, K = 1, FIX = 0.1;
function unit(N, H, s, c){
  var sr = K*H*H + FIX, ss = K*s*s + c;
  var tr = KR + N*sr, ts = KS + N*ss;
  var nstar = sr < ss ? (KR - KS)/(ss - sr) : null;
  return {sr: sr, ss: ss, tr: tr, ts: ts, nstar: nstar};
}
function show(label, N, H, s, c){
  var u = unit(N, H, s, c);
  console.log(label + ' N=' + N + ' H=' + H + ' sigma=' + s + ' c=' + c + ' | per-use rule ' + u.sr.toFixed(2) + ' std ' + u.ss.toFixed(2) +
    ' | TC rule ' + u.tr.toFixed(2) + ' std ' + u.ts.toFixed(2) + ' | N* ' + (u.nstar === null ? 'none' : u.nstar.toFixed(2)) +
    ' | cheaper: ' + (u.tr < u.ts ? 'rule' : 'standard'));
}
// independent check of N*: bisection on TC_R(N) - TC_S(N)
function nstarBisect(H, s, c){
  var f = function(N){ var u = unit(N, H, s, c); return u.tr - u.ts; };
  var lo = 1, hi = 1e7;
  if (f(hi) >= 0) return null;
  var i; for (i = 0; i < 200; i++){ var m = (lo + hi)/2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi)/2;
}
show('default  ', 100, 0.8, 0.7, 1.0);
show('rare tech', 8, 0.8, 0.7, 1.0);
show('highway  ', 1000, 0.4, 0.7, 1.0);
show('messy    ', 1000, 1.6, 0.7, 1.0);
console.log('bisect N* default = ' + nstarBisect(0.8, 0.7, 1.0).toFixed(2) + '; highway ' + nstarBisect(0.4, 0.7, 1.0).toFixed(2) + '; H=1.6 -> ' + nstarBisect(1.6, 0.7, 1.0));
// H critical: rule can ever win iff H^2 + 0.1 < sigma^2 + c
console.log('Hcrit default = ' + Math.sqrt(0.7*0.7 + 1.0 - FIX).toFixed(4));
[1.0, 1.1, 1.2, 1.3].forEach(function(H){ var u = unit(100, H, 0.7, 1.0); console.log(' H=' + H + ' rule/use ' + u.sr.toFixed(2) + ' N* ' + (u.nstar === null ? 'none' : u.nstar.toFixed(1))); });
// sweeping N at H=1.6: rule never wins on [1, 1e6]
var wins = 0, n; for (n = 1; n <= 1e6; n *= 1.1) if (unit(n, 1.6, 0.7, 1.0).tr < unit(n, 1.6, 0.7, 1.0).ts) wins++;
console.log('H=1.6: rule wins at ' + wins + ' of the sampled N in [1,1e6] (should be 0)');

// ---- deterministic situations: unit-variance, zero-mean z (normal quantiles), shuffled by an LCG ----
function Phi(x){
  var t = 1/(1 + 0.2316419*Math.abs(x)), d = 0.3989423*Math.exp(-x*x/2);
  var p = d*t*(0.3193815 + t*(-0.3565638 + t*(1.781478 + t*(-1.821256 + t*1.330274))));
  return x > 0 ? 1 - p : p;
}
function invPhi(p){ var lo = -8, hi = 8, i; for (i = 0; i < 80; i++){ var m = (lo + hi)/2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi)/2; }
var Z = [], i; for (i = 0; i < 100; i++) Z.push(invPhi((i + 0.5)/100));
var mean = Z.reduce(function(a, b){ return a + b; }, 0)/100;
var v = Z.reduce(function(a, b){ return a + (b - mean)*(b - mean); }, 0)/100;
Z = Z.map(function(z){ return (z - mean)/Math.sqrt(v); });
console.log('z: min ' + Z[0].toFixed(3) + ' max ' + Z[99].toFixed(3) + ' mean ' + (Z.reduce(function(a, b){ return a + b; }, 0)/100).toExponential(2) + ' var ' + (Z.reduce(function(a, b){ return a + b*b; }, 0)/100).toFixed(6));
var seed = 20250102; function lcg(){ seed = (seed*1664525 + 1013904223) % 4294967296; return seed/4294967296; }
function shuffle(a){ var b = a.slice(), j, t, k; for (j = b.length - 1; j > 0; j--){ k = Math.floor(lcg()*(j + 1)); t = b[j]; b[j] = b[k]; b[k] = t; } return b; }
var S = shuffle(Z), E = shuffle(Z);
// MSE check: rule mismatch H^2, standard noise sigma^2
[0.4, 0.8, 1.6].forEach(function(H){
  var mse = 0, j; for (j = 0; j < 100; j++) mse += (H*S[j])*(H*S[j]); console.log(' H=' + H + ' mean-square mismatch of one fixed line = ' + (mse/100).toFixed(4) + ' (want ' + (H*H).toFixed(4) + ')');
});
var corr = 0, j; for (j = 0; j < 100; j++) corr += S[j]*E[j]; console.log('corr(S,E) = ' + (corr/100).toFixed(3));
