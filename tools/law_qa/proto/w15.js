// w15 prototype: 保护期该多长 — re-derivation of the BIBLE §5 lesson-15 model.
// usage: node tools/law_qa/proto/w15.js
// Model (per potential innovation i; cost K_i ~ LogNormal(median Kmed, sigma)):
//   A(T) = (1 - e^{-dT})/d              PV of exclusive profit (pi = 1/yr) over T years
//   invest iff A(T) >= K_i              => share F(T) = Phi( ln(A/Kmed) / sigma )
//   society, per innovation made:       (1.5 - phi) * A(T) + 2 * e^{-dT}/d - K_i
//        (1.5 = profit 1 + consumer surplus 0.5 under linear demand with zero marginal cost;
//         2.0 = full surplus once free; phi = per-year drag from blocked follow-on innovation)
//   W(T) = F*[(1.5-phi)A + 2e^{-dT}/d] - E[K; K<=A],  E[K; K<=A] = Kmed e^{s^2/2} Phi((ln(A/Kmed) - s^2)/s)
function Phi(x){ var t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
  var p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return x>0?1-p:p; }
function invPhi(p){ var lo=-8,hi=8; for(var i=0;i<80;i++){ var mid=(lo+hi)/2; if(Phi(mid)<p) lo=mid; else hi=mid; } return (lo+hi)/2; }
function A(T,d){ return (1-Math.exp(-d*T))/d; }
function closed(T,d,Km,s,phi){
  var a=A(T,d), F=Phi(Math.log(a/Km)/s);
  var EK=Km*Math.exp(s*s/2)*Phi((Math.log(a/Km)-s*s)/s);
  var W=F*((1.5-phi)*a+2*Math.exp(-d*T)/d)-EK;
  return {F:F,W:W,a:a,EK:EK};
}
function quant(T,d,Km,s,phi){
  var N=2000,Wt=0,n=0,a=A(T,d);
  for(var i=0;i<N;i++){ var K=Km*Math.exp(s*invPhi((i+0.5)/N)); if(a>=K){ n++; Wt+=(1.5-phi)*a+2*Math.exp(-d*T)/d-K; } }
  return {F:n/N,W:Wt/N};
}
console.log('--- spec table (d=.08,Kmed=6,s=.6,phi=.3): closed vs quantile(2000)');
[5,10,15,20,25,30,40,60].forEach(function(T){
  var c=closed(T,0.08,6,0.6,0.3), q=quant(T,0.08,6,0.6,0.3);
  console.log('T='+T+'  closed F='+(c.F*100).toFixed(2)+'% W='+c.W.toFixed(3)+'   quant F='+(q.F*100).toFixed(2)+'% W='+q.W.toFixed(3));
});
function peak(d,Km,s,phi){
  var best=-1e18,bt=0; for(var T=0.5;T<=60.0001;T+=0.5){ var w=closed(T,d,Km,s,phi).W; if(w>best){best=w;bt=T;} } return {T:bt,W:best};
}
console.log('--- peaks');
var P=[['default',0.08,6,0.6,0.3],['pharma K=14 s=.8',0.08,14,0.8,0.3],['pharma K=14 s=.6',0.08,14,0.6,0.3],['pharma K=20',0.08,20,0.6,0.3],['software K=2 d=.18',0.18,2,0.6,0.3],['fashion K=.3',0.08,0.3,0.6,0.3],['fashion K=.2',0.08,0.2,0.6,0.3],
 ['default phi=0',0.08,6,0.6,0],['default phi=.6',0.08,6,0.6,0.6],['default d=.03',0.03,6,0.6,0.3],['default d=.2',0.2,6,0.6,0.3],['K=3',0.08,3,0.6,0.3],['K=10',0.08,10,0.6,0.3]];
P.forEach(function(p){ var pk=peak(p[1],p[2],p[3],p[4]); var c20=closed(20,p[1],p[2],p[3],p[4]), c40=closed(40,p[1],p[2],p[3],p[4]);
  console.log(p[0]+': peak T='+pk.T+' W='+pk.W.toFixed(2)+' | T=20 F='+(c20.F*100).toFixed(1)+'% W='+c20.W.toFixed(2)+' | 20->40 dF='+((c40.F-c20.F)*100).toFixed(1)+'pp dW='+(c40.W-c20.W).toFixed(2)); });
console.log('--- doubling at various T (default)');
[5,10,15,20,25,30].forEach(function(T){ var a=closed(T,0.08,6,0.6,0.3),b=closed(2*T,0.08,6,0.6,0.3); console.log('T='+T+'->'+(2*T)+' dF='+((b.F-a.F)*100).toFixed(1)+'pp dW='+(b.W-a.W).toFixed(2)); });
console.log('--- share of perpetual PV: 1-e^{-dT}');
[10,20,30,40,60].forEach(function(T){ console.log('T='+T+' '+((1-Math.exp(-0.08*T))*100).toFixed(1)+'%  e^{-dT}='+Math.exp(-0.08*T).toFixed(4)); });
console.log('--- asymptotes: F(inf) =', (Phi(Math.log(12.5/6)/0.6)*100).toFixed(1)+'%');
