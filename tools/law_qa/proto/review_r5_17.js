// r5 independent re-derivation for lesson 17: agency care x vs remedy cost c.
// Independent of the widget: uses a finer S grid (2000 midpoints) + brute-force minimisation of agency cost over x.
const E0=0.3,K=4,RHO=0.8,WID=5;
function sol(c,lam,P,N){
  N=N||2000;
  let pbar=0,harm=0;
  for(let k=0;k<N;k++){const S=100*(k+0.5)/N; const p=1/(1+Math.exp(-(RHO*lam*S-c)/WID)); pbar+=p; harm+=S*(1-RHO*lam*p);}
  pbar/=N;harm/=N;
  // brute-force x minimising x + e(x)*lam*P*pbar over a fine grid (no closed form used)
  let bx=0,bv=1e18;
  for(let i=0;i<=20000;i++){const x=i*0.001; const v=x+E0*Math.exp(-x/K)*lam*P*pbar; if(v<bv-1e-15){bv=v;bx=x;}}
  const e=E0*Math.exp(-bx/K);
  return {pbar,x:bx,e,unc:e*harm,corr:100*e*lam*pbar};
}
function row(lab,c,lam,P){const r=sol(c,lam,P);console.log(lab.padEnd(28),'go='+(r.pbar*100).toFixed(1)+'% x='+r.x.toFixed(2)+' err='+(r.e*100).toFixed(1)+'% unc='+r.unc.toFixed(2)+' corr/100='+r.corr.toFixed(2));}
row('c=2 lam.9 P40',2,0.9,40);row('c=10',10,0.9,40);row('c=30',30,0.9,40);row('c=45',45,0.9,40);row('c=60',60,0.9,40);
row('preset3 c=10 lam.1',10,0.1,40);row('preset4 c=30 P100',30,0.9,100);
// x -> 0 threshold at default
for(let c=30;c<=70;c+=1){const r=sol(c,0.9,40);if(r.x<0.005){console.log('x hits 0 at c=',c,'prev corr=',sol(c-1,0.9,40).corr.toFixed(2),'corr here',r.corr.toFixed(2));break;}}
// corr constancy in interior
console.log('corr 400/P constancy:',[2,10,20,30,40].map(c=>sol(c,0.9,40).corr.toFixed(3)).join(' '),' vs 400/40=10');
console.log('c=0 baseline err:',(sol(0,0.9,40).e*100).toFixed(1));
