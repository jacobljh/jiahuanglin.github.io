// prototype for lesson 12 widget: who walks into court (Priest-Klein style selection)
function Phi(x){
  var t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
  var p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return x>0?1-p:p;
}
function invPhi(p){ var lo=-8,hi=8; for(var i=0;i<80;i++){ var mid=(lo+hi)/2; if(Phi(mid)<p) lo=mid; else hi=mid; } return (lo+hi)/2; }
function grid(n){ var a=[]; for(var i=0;i<n;i++) a.push(invPhi((i+0.5)/n)); return a; }
function run(mu,sigE,cJ,nm,ne,sc){
  sc=sc||1; var zm=grid(nm), ze=grid(ne);
  var wTrial=0,wWin=0,wAll=0,wAllWin=0,mTrial=0;
  for(var a=0;a<nm;a++){ var m=mu+zm[a], pt=Phi(m/sc);
    for(var b=0;b<ne;b++){ var pP=Phi((m+sigE*ze[b])/sc);
      for(var c=0;c<ne;c++){ var pD=Phi((m+sigE*ze[c])/sc);
        wAll++; wAllWin+=pt;
        if(pP-pD>cJ){ wTrial++; wWin+=pt; mTrial+=m; }
      } } }
  return {trial:wTrial/wAll, winTried:wWin/Math.max(wTrial,1e-12), winAll:wAllWin/wAll, mTried: mTrial/Math.max(wTrial,1e-12)};
}
module.exports={Phi:Phi,invPhi:invPhi,run:run};
if(require.main===module){
  function pct(x){ return (x*100).toFixed(1)+'%'; }
  console.log('--- spec checks (31x21x21) vs fine (201x81x81)');
  [[0,1,0.1],[0.8,1,0.1],[-0.8,1,0.1],[0.8,0.4,0.1],[0.8,2,0.1],[0.8,1,0.02],[0.8,1,0.3]].forEach(function(a){
    var r=run(a[0],a[1],a[2],31,21), f=run(a[0],a[1],a[2],201,81);
    console.log('mu='+a[0]+' sig='+a[1]+' c/J='+a[2]+' coarse trial '+pct(r.trial)+' tried '+pct(r.winTried)+' all '+pct(r.winAll)+' | fine trial '+pct(f.trial)+' tried '+pct(f.winTried)+' all '+pct(f.winAll)+' | analytic all '+pct(Phi(a[0]/Math.SQRT2)));
  });
  console.log('--- default search (mu=0.8)');
  [0.4,0.6,0.8,1.0].forEach(function(s){ [0.1,0.2,0.3,0.4,0.5].forEach(function(c){
    var r=run(0.8,s,c,31,21); console.log('sig='+s+' c/J='+c+' trial '+pct(r.trial)+' tried '+pct(r.winTried)+' all '+pct(r.winAll)+' gap '+((r.winTried-r.winAll)*100).toFixed(1)+'pp  mTried '+r.mTried.toFixed(2));
  }); });
}
