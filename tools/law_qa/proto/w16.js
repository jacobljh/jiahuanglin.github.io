'use strict';
// 16 隐私与同意 —— 原型：告知-同意（A） vs 默认规则（B）
// 每人每份政策：时间成本 c = (L/v/60)*w ；读当且仅当 q*p*H_i > c ；H_i ~ U(0,Hmax]
var p = 0.7, q = 0.2, Hmax = 100, v = 250;
function model(P){
  var c = P.L / v / 60 * P.w;                 // 读一份的时间成本（示意元）
  var Hs = c / (p*q);                          // 临界在乎程度
  var s = Math.max(0, Math.min(1, 1 - Hs/Hmax));
  var Hl = Math.min(Hs, Hmax);
  var unprot = q*Hmax/2;                       // 无任何保护时每人每份的期望损害
  var avoided = p*q*(Hmax*Hmax - Hl*Hl)/(2*Hmax); // 读者因识别而避免的损害
  var dmgA = unprot - avoided;
  var timeA = s * c;
  var totA = dmgA + timeA;
  var dmgB = (1 - P.kappa) * unprot;
  var totB = dmgB + P.cB;
  return {c:c, Hs:Hs, s:s, unprot:unprot, dmgA:dmgA, timeA:timeA, totA:totA, dmgB:dmgB, totB:totB,
    hoursAll: P.n * P.L / v / 60, annA: P.n*dmgA, annAt: P.n*totA, annB: P.n*totB, annDmgB: P.n*dmgB};
}
function breakeven(P){ // 最小的 L 使 totA >= totB（A 随 L 单调不降）
  var lo = 0, hi = 20000, i;
  if (model(Object.assign({}, P, {L: 0})).totA >= model(Object.assign({}, P, {L: 0})).totB) return 0;
  if (model(Object.assign({}, P, {L: hi})).totA < model(Object.assign({}, P, {L: hi})).totB) return Infinity;
  for (i = 0; i < 60; i++){ var mid = (lo+hi)/2; var m = model(Object.assign({}, P, {L: mid})); if (m.totA >= m.totB) hi = mid; else lo = mid; }
  return hi;
}
var base = {n:1000, L:2500, w:50, kappa:0.8, cB:1};
module.exports = {model:model, breakeven:breakeven, base:base};
if (require.main === module){
  console.log('--- sweep L (w=50, kappa=.8, cB=1) ---');
  [200,500,1000,2000,2500,3000,4000,4200,5000,6000,8000].forEach(function(L){
    var m = model(Object.assign({}, base, {L:L}));
    console.log('L='+L+' c='+m.c.toFixed(2)+' H*='+m.Hs.toFixed(1)+' share='+(100*m.s).toFixed(1)+'% dmgA='+m.dmgA.toFixed(3)+' timeA='+m.timeA.toFixed(3)+' totA='+m.totA.toFixed(3)+' | dmgB='+m.dmgB.toFixed(3)+' totB='+m.totB.toFixed(3)+' | hoursAll='+m.hoursAll.toFixed(1));
  });
  // monotonic checks
  var prevS = 2, prevA = -1, okS = true, okA = true, okB = true, B0 = null, L;
  for (L = 0; L <= 8000; L += 50){
    var m2 = model(Object.assign({}, base, {L:L}));
    if (m2.s > prevS + 1e-12) okS = false; prevS = m2.s;
    if (m2.totA < prevA - 1e-12) okA = false; prevA = m2.totA;
    if (m2.dmgA < (L>0? model(Object.assign({}, base, {L:L-50})).dmgA : 0) - 1e-12) okA = false;
    if (B0 === null) B0 = m2.totB; if (Math.abs(m2.totB - B0) > 1e-12 || Math.abs(m2.dmgB - model(Object.assign({}, base, {L:0})).dmgB) > 1e-12) okB = false;
  }
  console.log('share nonincreasing in L:', okS, '| A cost/damage nondecreasing in L:', okA, '| B independent of L:', okB);
  console.log('--- breakeven L for different cB (kappa=.8) ---');
  [0,0.5,1,1.5,2,2.5,3,4].forEach(function(cB){ console.log('cB='+cB+' breakeven L='+breakeven(Object.assign({}, base, {cB:cB})).toFixed(0)); });
  console.log('--- breakeven L for kappa (cB=1.5) ---');
  [0.2,0.4,0.6,0.8,1].forEach(function(k){ console.log('kappa='+k+' breakeven L='+breakeven(Object.assign({}, base, {cB:1.5,kappa:k})).toFixed(0)); });
  console.log('--- wage sensitivity (L=2500) ---');
  [10,25,50,100,200,300].forEach(function(w){ var m = model(Object.assign({}, base, {w:w})); console.log('w='+w+' share='+(100*m.s).toFixed(1)+'% totA='+m.totA.toFixed(2)); });
  console.log('--- presets (cB=1.5) ---');
  var b = Object.assign({}, base, {cB:1.5});
  [{L:500},{L:2500},{L:6000},{L:8000},{L:6000,kappa:0.2}].forEach(function(o){ var P = Object.assign({}, b, o); var m = model(P);
    console.log(JSON.stringify(o)+' share='+(100*m.s).toFixed(1)+'% hoursAll='+m.hoursAll.toFixed(1)+' annDmgA='+m.annA.toFixed(0)+' annTotA='+m.annAt.toFixed(0)+' annTotB='+m.annB.toFixed(0)+' annDmgB='+m.annDmgB.toFixed(0)+' breakeven='+breakeven(P).toFixed(0)); });
}
