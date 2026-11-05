// w03 prototype: numerus clausus optimum.  Benefit(K)=R*V*(1-exp(-K/kappa)); cost = T*c*K; NS = Benefit - cost.
var R=1000, kappa=4;
function ben(K,V){ return R*V*(1-Math.exp(-K/kappa)); }
function NS(K,T,c,V){ return ben(K,V) - T*c*K; }
function KstarC(T,c,V){ var a=R*V/(kappa*T*c); return a<=1?1:Math.max(1,kappa*Math.log(a)); }
function KstarI(T,c,V){ var b=1,bv=-1e18,K; for(K=1;K<=60;K++){ var v=NS(K,T,c,V); if(v>bv){bv=v;b=K;} } return b; }
var c=0.02,V=50;
console.log('T, K*cont, K*int, NS(K*), NS(60), loss, NS(1), NS(5), NS(10)');
[1,10,100,1000,1e4,1e5,3e5,1e6].forEach(function(T){
  var ki=KstarI(T,c,V);
  console.log(T, KstarC(T,c,V).toFixed(2), ki, NS(ki,T,c,V).toFixed(0), NS(60,T,c,V).toFixed(0), (NS(ki,T,c,V)-NS(60,T,c,V)).toFixed(0), NS(1,T,c,V).toFixed(0), NS(5,T,c,V).toFixed(0), NS(10,T,c,V).toFixed(0));
});
// threshold T where NS(1)=0 and where K*cont = 1
console.log('T where NS(1)=0:', (ben(1,V)/(c*1)).toFixed(0), ' T where K*cont=1:', (R*V/(kappa*c)).toFixed(0));
// c variations at T=1e5
[0.005,0.01,0.02,0.05,0.1].forEach(function(cc){ var ki=KstarI(1e5,cc,V); console.log('c',cc,'K*',ki,KstarC(1e5,cc,V).toFixed(2),'NS*',NS(ki,1e5,cc,V).toFixed(0)); });
// V variations at T=1e5
[10,25,50,100].forEach(function(vv){ var ki=KstarI(1e5,c,vv); console.log('V',vv,'K*',ki,KstarC(1e5,c,vv).toFixed(2),'NS*',NS(ki,1e5,c,vv).toFixed(0),'NS(60)',NS(60,1e5,c,vv).toFixed(0)); });
// subsets of 11 items
console.log('2^11 =', Math.pow(2,11));
// fraction of max benefit captured at K* for T=1e5
var k=KstarI(1e5,c,V); console.log('share of max benefit at K*', (ben(k,V)/(R*V)).toFixed(3), 'cost', 1e5*c*k);
