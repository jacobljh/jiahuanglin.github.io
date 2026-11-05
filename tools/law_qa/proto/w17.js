// w17 prototype: 起诉成本与机关的小心
// usage: node tools/law_qa/proto/w17.js
'use strict';
var E0 = 0.3, K = 4, RHO = 0.8, W = 5, N = 400;
function logi(z){ return 1/(1+Math.exp(-z)); }
// hard=true reproduces the BIBLE spec (hard threshold, harm uses mean stake 50)
function solve(c, lam, P, hard){
  var i, s, p, pbar = 0, harm = 0, mean = 0;
  for(i = 0; i < N; i++){
    s = 100*(i+0.5)/N;
    p = hard ? (RHO*lam*s > c ? 1 : 0) : logi((RHO*lam*s - c)/W);
    pbar += p/N;
    harm += s*(1 - RHO*lam*p)/N;
    mean += s/N;
  }
  var Q = lam*P*pbar;
  var x = Math.max(0, K*Math.log(E0*Q/K));
  var e = E0*Math.exp(-x/K);
  var unc = hard ? e*(1 - pbar*lam)*50 : e*harm;
  return {c:c, lam:lam, P:P, pbar:pbar, Q:Q, x:x, e:e, unc:unc, suits:100*e*pbar, corr:100*e*pbar*lam, harmPerErr:harm};
}
function row(r){ return 'c='+r.c+' lam='+r.lam+' P='+r.P+'  x='+r.x.toFixed(2)+' e='+(100*r.e).toFixed(1)+'% pbar='+(100*r.pbar).toFixed(0)+'% Q='+r.Q.toFixed(2)+' unc='+r.unc.toFixed(2)+' suits/100='+r.suits.toFixed(1)+' corrections/100='+r.corr.toFixed(1); }
if(require.main === module){
  console.log('--- spec (hard threshold, mean-stake 50) ---');
  [2,10,30,60].forEach(function(c){ console.log(row(solve(c,0.9,40,true))); });
  console.log('--- smoothed, exact harm ---');
  [0,2,10,30,45,60,100].forEach(function(c){ console.log(row(solve(c,0.9,40,false))); });
  console.log('--- lambda sweep at c=10 ---');
  [0,0.1,0.2,0.3,0.5,0.9,1].forEach(function(l){ console.log(row(solve(10,l,40,false))); });
  console.log('--- P sweep at c=10 ---');
  [0,10,20,40,60,100].forEach(function(P){ console.log(row(solve(10,0.9,P,false))); });
  // monotonic check over c grid
  var prev = null, ok = true, k;
  for(k = 0; k <= 100; k++){ var r = solve(k,0.9,40,false); if(prev){ if(r.x > prev.x + 1e-9 || r.e < prev.e - 1e-9 || r.pbar > prev.pbar + 1e-9 || r.unc < prev.unc - 1e-9) ok = false; } prev = r; }
  console.log('monotone in c (x down, e up, pbar down, unc up):', ok);
}
module.exports = {solve: solve};
