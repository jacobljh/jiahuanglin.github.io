'use strict';
// w13 prototype — 法典 vs 判例：规则追不追得上世界。
// 世界：最合适的规则 θ 每年随机游走，步长 σ。
// 法典：每 T 年（t%T===0 的那一年）立法者看到当年的 θ，把规则改到 θ，付费用 K；损失每年 (θ−规则)²。
// 判例：每年规则向「法官看到的信号 θ+η」移动 λ 比例，η~N(0,σ_η²)；另付每年不确定性成本 u。
//
// 解析式（长期平均）：
//   法典：  C(σ) = σ²·(T−1)/2 + K/T
//   判例：  稳态下 d_t=(1−λ)(d_{t−1}+σε_t)−λη_t，故 Var(d)=[(1−λ)²σ²+λ²σ_η²]/(λ(2−λ))
//           B(σ) = (1−λ)²σ²/(λ(2−λ)) + λσ_η²/(2−λ) + u
// 交叉：(a−c)σ² = e − K/T，其中 a=(T−1)/2, c=(1−λ)²/(λ(2−λ)), e=λσ_η²/(2−λ)+u。

function lcg(seed){ var s=seed>>>0; return function(){ s=(Math.imul(1664525,s)+1013904223)>>>0; return s/4294967296; }; }
function gauss(r){ var u=Math.max(r(),1e-12),v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

function sim(sigma,T,K,lam,sEta,u,reps,years){
  var totC=0,totB=0;
  for(var s=0;s<reps;s++){
    var r=lcg(1000+s), th=0, rc=0, rb=0, lc=0, lb=0;
    for(var t=1;t<=years;t++){
      th+=sigma*gauss(r);
      if(t%T===0){ rc=th; lc+=K; }
      rb+=lam*(th+sEta*gauss(r)-rb); lb+=u;
      lc+=(th-rc)*(th-rc); lb+=(th-rb)*(th-rb);
    }
    totC+=lc; totB+=lb;
  }
  return {code: totC/reps/years, cas: totB/reps/years};
}
function closed(sigma,T,K,lam,sEta,u){
  var a=(T-1)/2, c=(1-lam)*(1-lam)/(lam*(2-lam)), e=lam*sEta*sEta/(2-lam)+u;
  var code=a*sigma*sigma+K/T;
  var lag=c*sigma*sigma, noise=lam*sEta*sEta/(2-lam);
  var cas=lag+noise+u;
  var D0=K/T-e, slope=a-c, star=null;
  if(slope!==0){ var s2=-D0/slope; if(s2>0) star=Math.sqrt(s2); }
  return {code:code, cas:cas, lag:lag, noise:noise, a:a, c:c, e:e, star:star, D0:D0, slope:slope};
}
function line(s){ console.log(s); }

line('== defaults T=20 K=10 lam=0.2 sEta=2 u=0.3 : analytic vs sim(200 seeds x 200y) vs sim(2000 seeds x 400y)');
[0.02,0.05,0.1,0.17,0.2,0.4,0.6,0.8].forEach(function(sg){
  var c=closed(sg,20,10,0.2,2,0.3), s1=sim(sg,20,10,0.2,2,0.3,200,200), s2=sim(sg,20,10,0.2,2,0.3,2000,400);
  line(' sigma='+sg+'  analytic code '+c.code.toFixed(3)+' case '+c.cas.toFixed(3)+'   sim200 code '+s1.code.toFixed(3)+' case '+s1.cas.toFixed(3)+'   sim2000 code '+s2.code.toFixed(3)+' case '+s2.cas.toFixed(3));
});
var c0=closed(0.2,20,10,0.2,2,0.3);
line('crossover (default): sigma*='+c0.star.toFixed(4)+'  a='+c0.a+' c='+c0.c.toFixed(4)+' e='+c0.e.toFixed(4)+' K/T='+(10/20)+' D0='+c0.D0.toFixed(4)+' slope='+c0.slope.toFixed(4));

line('\n== presets');
[
 ['慢 σ=0.05',            0.05,20,0.2,2],
 ['快 σ=0.6',             0.6, 20,0.2,2],
 ['局部 σ_η=3 (σ=0.2)',   0.2, 20,0.2,3],
 ['修法勤、判例慢 T=5 λ=0.05 σ=0.6', 0.6, 5,0.05,2],
 ['default σ=0.2',        0.2, 20,0.2,2]
].forEach(function(p){
  var c=closed(p[1],p[2],10,p[3],p[4],0.3), s=sim(p[1],p[2],10,p[3],p[4],0.3,200,200);
  line(' '+p[0]+': code '+c.code.toFixed(2)+' case '+c.cas.toFixed(2)+' (lag '+c.lag.toFixed(2)+' noise '+c.noise.toFixed(2)+')  winner='+(c.code<c.cas?'法典':'判例')+'  star='+(c.star===null?'none':c.star.toFixed(3))+' slope='+c.slope.toFixed(3)+' D0='+c.D0.toFixed(3)+'   [sim200: '+s.code.toFixed(2)+' / '+s.cas.toFixed(2)+']');
});

line('\n== crossover sigma* as function of params (default K=10,u=0.3,sEta=2)');
[5,10,20,30,40].forEach(function(T){
  var row=' T='+T+':';
  [0.05,0.1,0.2,0.3,0.5].forEach(function(l){
    var c=closed(0.2,T,10,l,2,0.3);
    row+='  lam='+l+'→'+(c.star===null?'—('+(c.D0+c.slope*0.04>0?'判例恒省':'法典恒省')+')':c.star.toFixed(2)+(c.slope>0?'↑判例胜':'↑法典胜'));
  });
  line(row);
});
line('\n== sEta sweep at T=20,lam=0.2,K=10,u=.3');
[0.5,1,1.5,2,2.5,3,4].forEach(function(se){
  var c=closed(0.2,20,10,0.2,se,0.3);
  line(' sEta='+se+' star='+(c.star===null?'none':c.star.toFixed(3))+'  at sigma=.2 code '+c.code.toFixed(2)+' case '+c.cas.toFixed(2));
});
line('\n== edge cases for slider ranges: any NaN/inf?');
var bad=0;
[0.02,0.8].forEach(function(sg){[5,40].forEach(function(T){[0.05,0.5].forEach(function(l){[0.5,4].forEach(function(se){
  var c=closed(sg,T,10,l,se,0.3);
  ['code','cas','lag','noise','a','c','e'].forEach(function(k){ if(!isFinite(c[k])) bad++; });
  if(c.star!==null && !isFinite(c.star)) bad++;
});});});});
line(' non-finite: '+bad);
