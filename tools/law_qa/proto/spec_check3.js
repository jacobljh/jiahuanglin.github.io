'use strict';
// 13 code vs judge-made, v2: judges see only noisy local signals; legislature sees theta exactly but updates rarely and at a cost
function lcg(seed){ var s=seed>>>0; return function(){ s=(Math.imul(1664525,s)+1013904223)>>>0; return s/4294967296; }; }
function gauss(r){ var u=Math.max(r(),1e-12),v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function sim(sigma,T,K,lambda,sigEta,u,mode,reps,years){
  var tot=0;
  for(var s=0;s<reps;s++){ var r=lcg(1000+s), th=0, rule=0, loss=0;
    for(var t=1;t<=years;t++){ th+=sigma*gauss(r);
      if(mode==='code'||mode==='hybrid'){ if(t%T===0){ rule=th; loss+=K; } }
      if(mode==='case'){ rule+=lambda*(th+sigEta*gauss(r)-rule); loss+=u; }
      if(mode==='hybrid'){ rule+=0.5*lambda*(th+sigEta*gauss(r)-rule); loss+=0.5*u; }
      loss+=(th-rule)*(th-rule); }
    tot+=loss; }
  return tot/reps/years; }
[0.02,0.05,0.1,0.2,0.4,0.8].forEach(function(sg){
  console.log('volatility '+sg+':  code(T=20,K=10) '+sim(sg,20,10,0,0,0,'code',300,200).toFixed(2)+'   case(lambda=.2, sigEta=2, u=.3) '+sim(sg,20,10,0.2,2,0.3,'case',300,200).toFixed(2)+'   hybrid '+sim(sg,20,10,0.2,2,0.3,'hybrid',300,200).toFixed(2));
});
