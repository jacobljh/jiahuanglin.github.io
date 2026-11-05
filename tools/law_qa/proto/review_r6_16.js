// r6 independent re-derivation of lesson 16 (consent widget): discrete simulation over a fine grid of users, no closed form.
var q=0.2,p=0.7,Hmax=100,v=250;
function run(n,L,w,kappa,cB){
  var c=L/v*w/60, N=200000, read=0, dmgA=0, timeA=0;
  for(var i=0;i<N;i++){
    var H=(i+0.5)/N*Hmax;            // user's stake, uniform on (0,Hmax]
    var reads = q*p*H > c;            // read iff expected gain > time cost
    if(reads){ read++; timeA+=c; dmgA+= q*(1-p)*H; }   // reader: bad clause (prob q) slips through with prob 1-p
    else { dmgA+= q*H; }                               // non-reader eats q*H
  }
  var dmgB=(1-kappa)*q*Hmax/2;        // B: share kappa of bad clauses banned, independent of reading
  return {share:read/N, c:c, A_dmg:n*dmgA/N, A_tot:n*(dmgA+timeA)/N, B_tot:n*(dmgB+cB), hours:n*L/v/60};
}
function f(o){return Object.keys(o).map(function(k){return k+'='+(+o[k]).toFixed(2);}).join(' ');}
console.log('typical L=2500:',f(run(1000,2500,50,0.8,2.5)));
console.log('short  L=500 :',f(run(1000,500,50,0.8,2.5)));
console.log('long   L=6000:',f(run(1000,6000,50,0.8,2.5)));
console.log('weak   L=500,k=.2:',f(run(1000,500,50,0.2,2.5)));
// n only scales totals (read decision per policy independent of n)
var a=run(100,2500,50,0.8,2.5),b=run(2000,2500,50,0.8,2.5);
console.log('n=100 share',a.share.toFixed(4),' n=2000 share',b.share.toFixed(4),' A_tot ratio',(b.A_tot/a.A_tot).toFixed(3),'(expect 20)');
// breakeven
function be(kappa,cB,w){ w=w||50; var lo=0,hi=8000;
  function d(L){var r=run(1,L,w,kappa,cB);return r.A_tot-r.B_tot;}
  if(d(0)>=0) return 0; if(d(8000)<0) return -1;
  for(var i=0;i<40;i++){var m=(lo+hi)/2; if(d(m)>=0) hi=m; else lo=m;} return hi; }
console.log('breakeven k=.8:',be(0.8,2.5).toFixed(1),' k=.4:',be(0.4,2.5).toFixed(1),' k=.2:',be(0.2,2.5));
console.log('L where nobody reads (w=50):', (q*p*Hmax*v*60/50).toFixed(0),'words');
console.log('hours n=1000 L=2500:',(1000*2500/250/60).toFixed(1));
console.log('c at L=2500:',(2500/250*50/60).toFixed(3),' Hstar=',(2500/250*50/60/(p*q)).toFixed(2));
console.log('mcdonald checks: 781e9/221e6=',(781e9/221e6).toFixed(1),' 201/40=',(201/40).toFixed(2),' 244/40=',(244/40).toFixed(2),' 244*221e6=',(244*221e6/1e9).toFixed(1),'e9 h; 2514/250=',(2514/250).toFixed(2),'min');
