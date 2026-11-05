// spec_check2.js — second round: fixes + remaining widget specs
'use strict';
function line(s){ console.log(s); }
function Phi(x){ var t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
  var p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return x>0?1-p:p; }

// 06 tort with b=20
(function(){
  line('--- 06 tort (b=20)');
  var L=100,p0=0.5,b=20;
  function pacc(x){ return p0/(1+x); } function unit(x){ return x+pacc(x)*L; }
  function bestx(f){ var bx=0,bv=1e9; for(var x=0;x<=40;x+=0.001){ var v=f(x); if(v<bv){bv=v;bx=x;} } return bx; }
  var xs=bestx(unit), us=unit(xs);
  function W(x,a){ return b*a-a*a/2-a*unit(x); }
  var aS=Math.max(0,b-us); line(' social x='+xs.toFixed(2)+' a='+aS.toFixed(2)+' W='+W(xs,aS).toFixed(1));
  var aN=Math.max(0,b-xs); line(' negligence (xd=x*) x='+xs.toFixed(2)+' a='+aN.toFixed(2)+' W='+W(xs,aN).toFixed(1)+'  injuries/yr='+(aN*pacc(xs)).toFixed(2)+' vs social '+(aS*pacc(xs)).toFixed(2));
  var aZ=b; line(' no liability x=0 a='+aZ+' W='+W(0,aZ).toFixed(1));
  [0.5,0.75,1.25,1.5].forEach(function(k){ var xd=xs*k; var x=xd; /* injurer meets exactly the standard */ var a=Math.max(0,b-x); line(' negligence xd='+(k*100)+'% of x*: x='+x.toFixed(2)+' a='+a.toFixed(2)+' W='+W(x,a).toFixed(1)); });
})();

// 07 with adaptation
(function(){
  line('--- 07 prison with adaptation d_t=d0*0.8^(t-1)');
  var h=100,p=0.2,N=1000,w=20,d0=30,cs=25;
  function D(y){ var s=0; for(var t=1;t<=y;t++) s+=d0*Math.pow(0.8,t-1); return s; }
  function sim(y){
    var sanction=p*(w+D(y)); var nund=0,harm=0,gains=0;
    for(var i=0;i<N;i++){ var g=0.8*h*(i+0.5)/N; if(g>=sanction){ nund++; harm+=h; gains+=g; } }
    return {sanction:sanction,det:1-nund/N,cost:(harm-gains)+nund*p*y*cs};
  }
  for(var y=0;y<=12;y+=1){ var r=sim(y); line(' years='+y+' sanction='+r.sanction.toFixed(1)+' deterred '+(r.det*100).toFixed(1)+'% social cost '+r.cost.toFixed(0)); }
})();

// 08 marginal deterrence (p1=.3,p2=.2,m=3)
(function(){
  line('--- 08 marginal deterrence v2');
  var p1=0.3,p2=0.2,m=3,h1=30,h2=200,N=1000;
  function sim(S1,S2){ var n0=0,n1=0,n2=0; for(var i=0;i<N;i++){ var g=60*(i+0.5)/N; var u1=g-p1*S1,u2=g-p2*S2-m; if(u1<=0&&u2<=0) n0++; else if(u1>=u2) n1++; else n2++; } return {n0:n0,n1:n1,n2:n2,harm:n1*h1+n2*(h1+h2)}; }
  [[5,5],[5,60],[20,100],[20,20],[40,40],[40,100],[40,200],[60,60],[60,120]].forEach(function(a){ var r=sim(a[0],a[1]); line(' S1='+a[0]+' S2='+a[1]+': none '+r.n0+' rob '+r.n1+' rob+kill '+r.n2+' harm '+r.harm); });
})();

// 09 Mathews balancing: 5 safeguards
(function(){
  line('--- 09 procedure packages');
  var S=[{n:'书面通知',r:0.30,c:20},{n:'听证',r:0.35,c:200},{n:'律师',r:0.30,c:600},{n:'交叉询问',r:0.30,c:300},{n:'上诉',r:0.30,c:900}];
  function best(e0,L,rate){ var bestv=-1e18,bests=null; for(var m=0;m<32;m++){ var e=e0,c=0; for(var i=0;i<5;i++) if(m>>i&1){ e*=1-S[i].r; c+=S[i].c; } var v=-(e*L*rate)-c; /* expected error loss + cost per case */ if(v>bestv){bestv=v;bests=m;} } return {m:bests,v:bestv}; }
  [[0.2,1000],[0.2,10000],[0.2,100000],[0.2,1000000],[0.05,100000],[0.2,10000000]].forEach(function(a){ var r=best(a[0],a[1],1); var names=[]; for(var i=0;i<5;i++) if(r.m>>i&1) names.push(S[i].n); line(' e0='+a[0]+' stake='+a[1]+' -> '+(names.join('+')||'无')); });
})();

// 13 code vs case law vs hybrid
(function(){
  line('--- 13 code vs judge-made');
  function lcg(seed){ var s=seed>>>0; return function(){ s=(Math.imul(1664525,s)+1013904223)>>>0; return s/4294967296; }; }
  function gauss(r){ var u=Math.max(r(),1e-12),v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
  function sim(sigma,T,K,lambda,u,mode,reps,years){
    var tot=0;
    for(var s=0;s<reps;s++){ var r=lcg(1000+s), th=0, rule=0, loss=0;
      for(var t=1;t<=years;t++){ th+=sigma*gauss(r);
        if(mode==='code'||mode==='hybrid'){ if(t%T===0){ rule=th; loss+=K; } }
        if(mode==='case'||mode==='hybrid'){ rule+=lambda*(th-rule); loss+=u; }
        loss+=(th-rule)*(th-rule); }
      tot+=loss; }
    return tot/reps/years; }
  [[0.1],[0.3],[0.6],[1.0]].forEach(function(a){ var sg=a[0];
    line(' volatility '+sg+':  code(T=20,K=40) '+sim(sg,20,40,0,0,'code',200,200).toFixed(2)+'  case(lambda=.2,u=0.5) '+sim(sg,20,40,0.2,0.5,'case',200,200).toFixed(2)+'  hybrid '+sim(sg,20,40,0.2,0.5,'hybrid',200,200).toFixed(2)); });
})();

// 17 admin review prevention
(function(){
  line('--- 17 admin review');
  function run(cost,lam){
    var Smax=100, N=200, e0=0.3, P=40, tot=0, bestx=0;
    function prof(x){ var e=e0*Math.exp(-x/4); var ch=0; for(var j=0;j<N;j++){ var S=Smax*(j+0.5)/N; if(lam*S*0.8>cost) ch++; } ch/=N; // share who can profitably challenge
      return {e:e,ch:ch,cost:x+e*ch*lam*P}; }
    var bx=0,bv=1e9; for(var x=0;x<=20;x+=0.01){ var v=prof(x).cost; if(v<bv){bv=v;bx=x;} }
    var pr=prof(bx); var harm=pr.e*(1-pr.ch*lam)*Smax/2; // wrongs uncorrected, average stake 50
    return {x:bx,e:pr.e,ch:pr.ch,harm:harm};
  }
  [[2,0.9],[10,0.9],[30,0.9],[60,0.9],[10,0.3],[10,0.0001]].forEach(function(a){ var r=run(a[0],a[1]); line(' challenge cost '+a[0]+' review strength '+a[1]+' -> agency care '+r.x.toFixed(2)+' error '+(r.e*100).toFixed(1)+'% challengers '+(r.ch*100).toFixed(0)+'% uncorrected harm/ case '+r.harm.toFixed(2)); });
})();

// 19 reciprocity threshold
(function(){
  line('--- 19 compliance region');
  function comply(g,b,d,delta,T,m){ var pv=0; for(var t=1;t<=T;t++) pv+=Math.pow(delta,t); return g<=d*b*m*pv; }
  [[10,0.9,1,0.5],[10,0.9,5,0.5],[10,0.9,5,3],[3,0.9,5,3],[3,0.5,5,1],[3,0.5,5,3]].forEach(function(a){ var g=a[0],delta=a[1],T=a[2],m=a[3]; var need=g/(0.7*m*(function(){var s=0;for(var t=1;t<=T;t++)s+=Math.pow(delta,t);return s;})()); line(' gain '+g+' delta '+delta+' punish periods '+T+' partners '+m+' (b=2,d=.7): comply='+comply(g,2,0.7,delta,T,m)+'  min detection prob needed ~'+need.toFixed(2)); });
})();

// 20 funnel
(function(){
  line('--- 20 dispute funnel (logistic retention)');
  function logit(x){ return 1/(1+Math.exp(-x)); }
  function funnel(stake,costs,trust){ var n=1000; var out=[n]; costs.forEach(function(c,i){ n=n*logit((stake-c)/ (0.4*c+1) + trust); out.push(n); }); return out; }
  var costs=[5,20,60,150,300];
  [[100,0],[100,1],[1000,0],[10000,0]].forEach(function(a){ line(' stake '+a[0]+' trust '+a[1]+': '+funnel(a[0],costs,a[1]).map(function(x){return x.toFixed(0);}).join(' > ')); });
})();

// 11 curvy boundary
(function(){
  line('--- 11 curvy purpose boundary');
  function halton(i,b){ var f=1,r=0; while(i>0){ f/=b; r+=f*(i%b); i=Math.floor(i/b);} return r; }
  function truth(a,b){ return b>=0.45+0.25*Math.sin(3*a)?1:0; }
  function text(a,b){ return a>=0.5?1:0; }
  var tests=[]; for(var i=1;i<=1500;i++) tests.push([halton(i+3000,2),halton(i+3000,3)]);
  var tr=0; tests.forEach(function(t){ if(text(t[0],t[1])===truth(t[0],t[1])) tr++; }); line(' text rule acc '+(tr/tests.length).toFixed(3));
  function knn(n,k,noise){ var P=[]; for(var i=1;i<=n;i++){ var a=halton(i,2),b=halton(i,3),y=truth(a,b); if(noise>0&&((i*7919)%1000)/1000<noise) y=1-y; P.push([a,b,y]); } var ok=0;
    tests.forEach(function(t){ var d=P.map(function(p){return [Math.hypot(p[0]-t[0],p[1]-t[1]),p[2]];}).sort(function(x,y){return x[0]-y[0];}).slice(0,Math.min(k,P.length)); var s=0; d.forEach(function(z){s+=z[1];}); if((s*2>d.length?1:0)===truth(t[0],t[1])) ok++; }); return ok/tests.length; }
  [1,3,5,10,20,40,80,160,320].forEach(function(n){ line(' n='+n+' acc '+knn(n,3,0).toFixed(3)+' (10% wrong precedents '+knn(n,3,0.1).toFixed(3)+')'); });
})();
