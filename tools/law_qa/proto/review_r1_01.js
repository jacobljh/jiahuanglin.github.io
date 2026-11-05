// r1 review: re-derive lesson 01 hawk-dove numbers independently
function xs(V,C,pF){return Math.max(0,Math.min(1,(V-2*pF)/C));}
function W(x,V,C){return V/2-C*x*x/2;}
// brute-force replicator check: payoff equality and welfare via explicit pairing
function avg(x,V,C,pF){
  var piH = x*((V-C)/2-pF)+(1-x)*(V-pF), piD=(1-x)*V/2;
  return {piH:piH,piD:piD,avgPay:x*piH+(1-x)*piD + 0 + x*pF}; // add back fines (transfer)
}
[[4,10,0],[4,10,0.5],[4,10,1],[4,10,1.5],[4,10,2],[4,10,0.8]].forEach(function(a){
  var x=xs(a[0],a[1],a[2]), r=avg(x,a[0],a[1],a[2]);
  console.log('pF',a[2],'x*',x.toFixed(3),'piH',r.piH.toFixed(3),'piD',r.piD.toFixed(3),'W',W(x,a[0],a[1]).toFixed(3),'avgPay(no fine)',r.avgPay.toFixed(3));
});
// trajectory x(t) for pF=V/2, dx/dt = x(1-x)(V/2-pF - xC/2); 20 time units, x0=.5
function traj(V,C,pF,p){
  var x=0.5, dt=0.0005, out=[];
  for(var t=0;t<=20+1e-9;t+=dt){ if(Math.abs(t-Math.round(t))<dt/2) out.push([Math.round(t),x]); x+=dt*x*(1-x)*(V/2-pF-x*C/2);}
  return out;
}
var t=traj(4,10,2); console.log('pF=2 traj', t.filter(function(a){return a[0]%5==0}).map(function(a){return a[0]+':'+a[1].toFixed(3)}).join(' '));
t=traj(4,10,0.8); console.log('pF=.8 traj', t.filter(function(a){return a[0]%5==0}).map(function(a){return a[0]+':'+a[1].toFixed(3)}).join(' '));
