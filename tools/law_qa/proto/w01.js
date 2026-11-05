// w01.js — prototype of the lesson-01 widget model (hawk-dove with a court). run: node tools/law_qa/proto/w01.js
'use strict';
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
// payoffs (V resource, C fight cost, pF = p*F expected fine for acting as hawk)
function piH(x, V, C, pF){ return x*((V - C)/2 - pF) + (1 - x)*(V - pF); }
function piD(x, V, C, pF){ return x*0 + (1 - x)*V/2; }
function xstar(V, C, pF){ return clamp((V - 2*pF)/C, 0, 1); }
function welfare(x, V, C){ return V/2 - C*x*x/2; }          // fines are transfers, not counted
// brute-force welfare from the pairing probabilities, to re-derive V/2 - C x^2/2
function welfareBrute(x, V, C){
  return x*x*((V - C)/2) + 2*x*(1 - x)*(V/2) + (1 - x)*(1 - x)*(V/2);
}
function traj(V, C, pF, p, x0, T, n){
  var out = [], x = x0, i, t = 0, dtOut = T/n;
  var S = Math.abs(V/2 - pF) + C/2 + 1;
  var m = Math.max(1, Math.ceil(S*dtOut/0.2)), dt = dtOut/m, j;
  out.push({t: 0, x: x, f: p*x});
  for(i = 1; i <= n; i++){
    for(j = 0; j < m; j++){ x += dt*x*(1 - x)*(V/2 - pF - x*C/2); x = clamp(x, 0, 1); }
    out.push({t: i*dtOut, x: x, f: p*x});
  }
  return out;
}
function show(label, V, C, p, F, k){
  var pF = p*F, x = xstar(V, C, pF), W = welfare(x, V, C), cost = k*p*x, fines = 100*p*x;
  var d = piH(x, V, C, pF) - piD(x, V, C, pF);
  var tr = traj(V, C, pF, p, 0.5, 20, 200);
  console.log(label + '  pF=' + pF.toFixed(2) + ' x*=' + x.toFixed(3) + ' W=' + W.toFixed(3) + ' (brute ' + welfareBrute(x, V, C).toFixed(3) + ')'
    + ' cost=' + cost.toFixed(3) + ' net=' + (W - cost).toFixed(3) + ' fines/100=' + fines.toFixed(1) + '  piH-piD@x*=' + d.toFixed(4)
    + '  x(20)=' + tr[tr.length - 1].x.toFixed(4) + ' f(20)=' + tr[tr.length - 1].f.toFixed(4));
}
console.log('--- spec check V=4,C=10');
[0, 0.5, 1, 1.5, 2, 3].forEach(function(pF){ show('pF=' + pF, 4, 10, 1, pF, 1); });
console.log('--- presets (k=1)');
show('没有法庭        ', 4, 10, 0,   10, 1);
show('常来但罚得轻    ', 4, 10, 0.8, 1,  1);
show('难得来但罚得重  ', 4, 10, 0.1, 20, 1);
show('刚好够 p=.5 F=4 ', 4, 10, 0.5, 4,  1);
console.log('--- no-court average vs formula (V/2)(1-V/C)');
console.log((4/2)*(1 - 4/10), welfare(0.4, 4, 10));
console.log('--- court that does not pay (k=5, p=1, F=1)');
show('k=5', 4, 10, 1, 1, 5);
console.log('--- V>=C degenerate');
show('V=8,C=6 no court', 8, 6, 0, 10, 1);
show('V=8,C=6 pF=3', 8, 6, 1, 3, 1);
console.log('--- extreme stiffness');
var t = traj(10, 20, 20, 1, 0.5, 20, 200); console.log(t[1].x, t[10].x, t[200].x);
// ESS check: x* interior is stable? derivative of (piH-piD) in x is -C/2 < 0 -> stable. verify numerically at x*=0.4
(function(){ var V = 4, C = 10, pF = 0, xs = xstar(V, C, pF); var e = 1e-3;
  console.log('piH-piD at x*-e, x*, x*+e:', (piH(xs - e, V, C, pF) - piD(xs - e, V, C, pF)).toFixed(4), (piH(xs, V, C, pF) - piD(xs, V, C, pF)).toFixed(4), (piH(xs + e, V, C, pF) - piD(xs + e, V, C, pF)).toFixed(4)); })();
// all-dove is not stable without a court: hawk mutant payoff vs dove payoff at x=0
console.log('x=0: piH=' + piH(0, 4, 10, 0) + ' piD=' + piD(0, 4, 10, 0));
// with court threshold: at x=0, piH - piD = V/2 - pF
console.log('threshold pF=V/2:', 4/2);
