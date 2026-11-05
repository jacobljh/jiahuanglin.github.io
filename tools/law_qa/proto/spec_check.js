// spec_check.js — numeric sanity checks of the BIBLE widget specs (run: node tools/law_qa/proto/spec_check.js)
'use strict';
function Phi(x){ // normal cdf (Abramowitz-Stegun)
  var t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
  var p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return x>0?1-p:p;
}
function line(s){ console.log(s); }

// ---------- 00 compliance with conformity (multiple equilibria) ----------
(function(){
  line('--- 00 compliance fixed point');
  function F(x,mu,s){ return 1/(1+Math.exp(-(x-mu)/s)); }
  function run(pS,nu,start,mu,s){ var c=start; for(var i=0;i<400;i++){ c=F(pS+nu*c,mu,s); } return c; }
  // gain g ~ logistic(mu,s): P(comply)=P(g < pS+nu*c)
  [[0,60],[10,60],[20,60],[30,60],[10,0],[10,30]].forEach(function(a){
    line(' pS='+a[0]+' nu='+a[1]+'  start high -> '+run(a[0],a[1],0.99,50,8).toFixed(3)+'   start low -> '+run(a[0],a[1],0.01,50,8).toFixed(3));
  });
})();

// ---------- 01 hawk-dove with court ----------
(function(){
  line('--- 01 hawk-dove');
  function esx(V,C,pF){ return Math.max(0,Math.min(1,(V-2*pF)/C)); }
  var V=4,C=10;
  [0,0.5,1,1.5,2,3].forEach(function(pF){
    var x=esx(V,C,pF); var W=V/2-C*x*x/2;
    // check payoff equality at x
    var piH=x*((V-C)/2-pF)+(1-x)*(V-pF), piD=x*0+(1-x)*V/2;
    line(' pF='+pF+' hawk share='+x.toFixed(3)+' welfare/cap='+W.toFixed(3)+' piH-piD='+(piH-piD).toFixed(4)+' (should be 0 when interior)');
  });
})();

// ---------- 03 numerus clausus optimum ----------
(function(){
  line('--- 03 numerus clausus  K* = kappa*ln(R V /(kappa T c))');
  function Kstar(R,V,T,c,kappa){ var arg=R*V/(kappa*T*c); return arg<=1?1:Math.max(1,kappa*Math.log(arg)); }
  [[1,1],[10,1],[1000,1],[100000,1],[1000000,1]].forEach(function(a){
    line(' T='+a[0]+'  K*='+Kstar(1000,50,a[0],0.02,4).toFixed(1));
  });
})();

// ---------- 05 contract remedies ----------
(function(){
  line('--- 05 remedies');
  var p=60, Cmax=150;
  function v(r){ return 80+40*(1-Math.exp(-r/10)); }
  function pr(x){ return Math.max(0,Math.min(1,x/Cmax)); }
  // social: perform iff c<=v ; W = v^2/(2*Cmax) - r
  function Wsoc(r){ var V=v(r); return pr(V)*V - (V*V/(2*Cmax)) - r; }
  function best(fn){ var b=-1e9,br=0; for(var r=0;r<=40;r+=0.01){ var w=fn(r); if(w>b){b=w;br=r;} } return {r:br,val:b}; }
  var soc=best(Wsoc);
  line(' social optimum r*='+soc.r.toFixed(2)+' W='+soc.val.toFixed(2)+' v='+v(soc.r).toFixed(1));
  // regimes: seller performs iff c <= threshold T(r); buyer's reliance chosen to max own payoff
  var regimes={
    none:{thr:function(r){return p;}, buyer:function(r){ return pr(p)*(v(r)-p) - r; }},
    reliance:{thr:function(r){return p+r;}, buyer:function(r){ return pr(p+r)*(v(r)-p-r); }},
    expectation:{thr:function(r){return v(r);}, buyer:function(r){ return (v(r)-p) - r; }},
    specific:{thr:function(r){return 1e9;}, buyer:function(r){ return (v(r)-p)-r; }}
  };
  Object.keys(regimes).forEach(function(k){
    var R=regimes[k]; var b=best(R.buyer); var th=R.thr(b.r);
    // social welfare given r and seller's perform set c<=th (th may exceed Cmax)
    var thc=Math.min(th,Cmax), V=v(b.r);
    var perf=pr(thc);
    var W=perf*V - (thc*thc/(2*Cmax)) - b.r;
    line(' '+k+': r='+b.r.toFixed(2)+' perform prob='+perf.toFixed(3)+' W='+W.toFixed(2));
  });
})();

// ---------- 06 tort: activity level ----------
(function(){
  line('--- 06 tort regimes');
  var L=100, p0=0.5;
  function pacc(x){ return p0/(1+x); }
  function unit(x){ return x+pacc(x)*L; }
  // B(a)=b*a - a^2/2 -> B'(a)=b-a
  var b=8;
  function bestx(f){ var bx=0,bv=1e9; for(var x=0;x<=40;x+=0.001){ var v=f(x); if(v<bv){bv=v;bx=x;} } return bx; }
  var xs=bestx(unit); var us=unit(xs);
  line(' x*='+xs.toFixed(3)+' unit social cost='+us.toFixed(3));
  function welfare(x,a){ return b*a-a*a/2 - a*unit(x); }
  var aS=Math.max(0,b-us);
  line(' social: x='+xs.toFixed(2)+' a='+aS.toFixed(3)+' W='+welfare(xs,aS).toFixed(3));
  // negligence with due care xd = xs: injurer pays only x per unit, no liability
  var aN=Math.max(0,b-xs); line(' negligence(xd=x*): x='+xs.toFixed(2)+' a='+aN.toFixed(3)+' W='+welfare(xs,aN).toFixed(3));
  // strict liability: pays unit(x) -> same as social
  // no liability: x=0 cost 0 -> a=b
  var a0=b; line(' none: x=0 a='+a0.toFixed(3)+' W='+welfare(0,a0).toFixed(3));
  // negligence with too-low standard
  var xd=xs*0.5; var aL=Math.max(0,b-xd); line(' negligence(xd=0.5x*): x='+xd.toFixed(2)+' a='+aL.toFixed(3)+' W='+welfare(xd,aL).toFixed(3));
})();

// ---------- 07 optimal fine / judgment proof ----------
(function(){
  line('--- 07 judgment proof');
  var h=100, p=0.1; // detection prob 10%
  var N=1000; // would-be wrongdoers, gains g uniform on (0, 0.8h]
  function sim(wealth,fine,years,dPerYear,cs,ce){
    var capped=Math.min(fine,wealth);
    var sanction=p*(capped+dPerYear*years);
    var deterred=0, harm=0, gainUndeterred=0, nund=0;
    for(var i=0;i<N;i++){ var g=0.8*h*(i+0.5)/N; if(g<sanction) deterred++; else { nund++; harm+=h; gainUndeterred+=g; } }
    var cost = (harm-gainUndeterred) + nund*p*years*cs + ce*p*nund;
    return {det:deterred/N, cost:cost, sanction:sanction};
  }
  var R=sim(1e9,h/p,0,0,0,0); line(' unlimited wealth fine h/p=1000: deterred '+R.det.toFixed(3)+' cost '+R.cost.toFixed(1));
  R=sim(100,h/p,0,0,0,0); line(' wealth=100: deterred '+R.det.toFixed(3)+' cost '+R.cost.toFixed(1));
  R=sim(100,h/p,1,40,10,2); line(' wealth=100 + 1y prison(d=40/y,cs=10): deterred '+R.det.toFixed(3)+' cost '+R.cost.toFixed(1));
  R=sim(100,h/p,3,40,10,2); line(' wealth=100 + 3y prison: deterred '+R.det.toFixed(3)+' cost '+R.cost.toFixed(1));
  R=sim(100,h/p,6,40,10,2); line(' wealth=100 + 6y prison: deterred '+R.det.toFixed(3)+' cost '+R.cost.toFixed(1));
})();

// ---------- 08 marginal deterrence ----------
(function(){
  line('--- 08 marginal deterrence');
  var p1=0.3, p2=0.15, m=5, h1=30, h2=200; // p2: kill witness lowers detection
  function sim(S1,S2){
    var N=1000, n0=0,n1=0,n2=0;
    for(var i=0;i<N;i++){ var g=60*(i+0.5)/N; // gain 0..60 (¥k-equivalent units)
      var u0=0, u1=g-p1*S1, u2=g-p2*S2-m;
      if(u1<=0&&u2<=0) n0++; else if(u1>=u2) n1++; else n2++; }
    return {n0:n0,n1:n1,n2:n2,harm:n1*h1+n2*(h1+h2)};
  }
  [[5,5],[5,15],[5,60],[15,15],[30,30],[1,15],[15,60]].forEach(function(a){
    var r=sim(a[0],a[1]); line(' S1='+a[0]+' S2='+a[1]+' -> none '+r.n0+' rob '+r.n1+' rob+kill '+r.n2+' harm '+r.harm);
  });
})();

// ---------- 10 thresholds ----------
(function(){
  line('--- 10 proof standards');
  function simulate(prior,dprime,t){
    var N=4000, tp=0,fp=0,tn=0,fn=0;
    // guilty fraction prior; signal x~N(d,1) guilty, N(0,1) innocent; posterior = prior*LR/(prior*LR+1-prior)
    for(var i=0;i<N;i++){ var q=(i+0.5)/N;
      // guilty case quantile -> x
      var xg=dprime+invPhi(q), xi=invPhi(q);
      [['g',xg],['i',xi]].forEach(function(z){
        var x=z[1]; var LR=Math.exp(dprime*x-dprime*dprime/2); var post=prior*LR/(prior*LR+1-prior);
        var conv=post>=t; var w=(z[0]==='g'?prior:1-prior)/N;
        if(z[0]==='g'){ if(conv) tp+=w; else fn+=w; } else { if(conv) fp+=w; else tn+=w; }
      });
    }
    return {tp:tp,fp:fp,fn:fn,tn:tn};
  }
  function invPhi(p){ // simple bisection
    var lo=-8,hi=8; for(var i=0;i<60;i++){ var mid=(lo+hi)/2; if(Phi(mid)<p) lo=mid; else hi=mid; } return (lo+hi)/2;
  }
  [0.5,0.75,0.91].forEach(function(t){
    var r=simulate(0.5,2.0,t); // d'=2
    line(' prior 0.5 d\'=2 t='+t+'  false convictions '+(r.fp*1000).toFixed(1)+'/1000, false acquittals '+(r.fn*1000).toFixed(1)+'/1000, FA:FC ratio '+(r.fn/Math.max(r.fp,1e-9)).toFixed(2));
  });
  [0.2,0.5,0.8].forEach(function(prior){
    var r=simulate(prior,2.0,0.91);
    line(' t=0.91 prior '+prior+' FC '+(r.fp*1000).toFixed(1)+' FA '+(r.fn*1000).toFixed(1)+' ratio '+(r.fn/Math.max(r.fp,1e-9)).toFixed(2));
  });
  // DNA database trawl: random match prob 1e-6, suspects 1e6
  var prior=1/1e6, lr=1e6; var post=prior*lr/(prior*lr+(1-prior)); line(' trawl: prior 1e-6 LR 1e6 -> posterior '+post.toFixed(3));
})();

// ---------- 12 Priest-Klein ----------
(function(){
  line('--- 12 Priest-Klein selection');
  function invPhi(p){ var lo=-8,hi=8; for(var i=0;i<60;i++){ var mid=(lo+hi)/2; if(Phi(mid)<p) lo=mid; else hi=mid; } return (lo+hi)/2; }
  function run(mu,sigE,cost,J,sCourt){
    var nm=31, ne=21, wtrial=0, wwin=0, wall=0, wallwin=0;
    var ms=[],mw=[],es=[],ew=[];
    for(var i=0;i<nm;i++){ var q=(i+0.5)/nm; ms.push(mu+invPhi(q)); mw.push(1/nm); }
    for(var j=0;j<ne;j++){ var q2=(j+0.5)/ne; es.push(invPhi(q2)); ew.push(1/ne); }
    for(var a=0;a<nm;a++){ var m=ms[a]; var ptrue=Phi(m/sCourt);
      for(var b=0;b<ne;b++) for(var c=0;c<ne;c++){
        var w=mw[a]*ew[b]*ew[c];
        var pP=Phi((m+sigE*es[b])/sCourt), pD=Phi((m+sigE*es[c])/sCourt);
        wall+=w; wallwin+=w*ptrue;
        if((pP-pD)*J>cost){ wtrial+=w; wwin+=w*ptrue; }
      } }
    return {trial:wtrial/wall, winTried:wwin/Math.max(wtrial,1e-12), winAll:wallwin/wall};
  }
  [[0,1.0,0.1],[0.8,1.0,0.1],[-0.8,1.0,0.1],[0.8,0.4,0.1],[0.8,2.0,0.1],[0.8,1.0,0.02],[0.8,1.0,0.3]].forEach(function(a){
    var r=run(a[0],a[1],a[2],1,1); line(' mu='+a[0]+' noise='+a[1]+' cost/J='+a[2]+' -> trial rate '+(r.trial*100).toFixed(1)+'%  win rate among tried '+(r.winTried*100).toFixed(1)+'%  win rate overall '+(r.winAll*100).toFixed(1)+'%');
  });
})();

// ---------- 14 risk shifting ----------
(function(){
  line('--- 14 limited liability');
  function eq(D,hi,lo,pHi,limited){ var pay=function(v){ return limited?Math.max(v-D,0):(v-D); }; return pHi*pay(hi)+(1-pHi)*pay(lo); }
  var D=80;
  line(' safe 105: equity limited '+eq(D,105,105,1,true)+' unlimited '+eq(D,105,105,1,false));
  line(' risky 150/50: equity limited '+eq(D,150,50,0.5,true)+' unlimited '+eq(D,150,50,0.5,false)+'; creditor gets '+(0.5*80+0.5*50));
})();

// ---------- 15 IP term ----------
(function(){
  line('--- 15 IP term');
  var delta=0.08, mean=0;
  function ann(T){ return (1-Math.exp(-delta*T))/delta; }
  // innovations: K_i lognormal quantiles around median Kmed, each pays pi=1 per year
  function innov(T,Kmed,sig,phi){
    var N=2000, W=0, n=0, annInf=1/delta;
    for(var i=0;i<N;i++){ var q=(i+0.5)/N; var z=invPhi(q); var K=Kmed*Math.exp(sig*z);
      if(ann(T)>=K){ n++;
        // protected period: society gets (pi + CS_m)=1.5/yr (less phi*... follow-on loss), after expiry 2/yr
        var Wi=(1.5-phi)*ann(T)+(2-0)*(Math.exp(-delta*T)*annInf)-K; W+=Wi; } }
    return {n:n/N,W:W/N};
  }
  function invPhi(p){ var lo=-8,hi=8; for(var i=0;i<60;i++){ var mid=(lo+hi)/2; if(Phi(mid)<p) lo=mid; else hi=mid; } return (lo+hi)/2; }
  [5,10,15,20,25,30,40,60].forEach(function(T){ var r=innov(T,6,0.6,0.3); line(' T='+T+'  share innovated '+(r.n*100).toFixed(1)+'%  welfare/ potential '+r.W.toFixed(3)); });
})();

// ---------- 11 precedent kNN ----------
(function(){
  line('--- 11 precedent accuracy');
  function halton(i,b){ var f=1,r=0; while(i>0){ f/=b; r+=f*(i%b); i=Math.floor(i/b);} return r; }
  function truth(a,b){ return b>=0.5?1:0; } // purpose decides
  function textRule(a,b){ return a>=0.5?1:0; }
  var tests=[]; for(var i=1;i<=1500;i++) tests.push([halton(i+3000,2),halton(i+3000,3)]);
  function knn(n,k,noise){
    var P=[]; for(var i=1;i<=n;i++){ var a=halton(i,2),b=halton(i,3); var y=truth(a,b); if(noise>0 && ((i*7919)%1000)/1000<noise) y=1-y; P.push([a,b,y]); }
    var ok=0; tests.forEach(function(t){ var d=P.map(function(p){ return [Math.hypot(p[0]-t[0],p[1]-t[1]),p[2]]; }).sort(function(x,y){return x[0]-y[0];}).slice(0,Math.min(k,P.length));
      var s=0; d.forEach(function(z){s+=z[1];}); var pred=s*2>d.length?1:0; if(pred===truth(t[0],t[1])) ok++; });
    return ok/tests.length;
  }
  var tr=0; tests.forEach(function(t){ if(textRule(t[0],t[1])===truth(t[0],t[1])) tr++; });
  line(' text rule accuracy (a>=.5 vs purpose b>=.5): '+(tr/tests.length).toFixed(3));
  [1,3,8,20,60,200].forEach(function(n){ line(' precedents='+n+' k=3 acc='+knn(n,3,0).toFixed(3)+'  with 10% wrong precedents='+knn(n,3,0.1).toFixed(3)); });
})();
