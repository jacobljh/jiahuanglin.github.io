// compare widget vs independent solver over grid of (c,lambda,P)
const h=require('./review_r5_harness.js')('all_lessons/law/lessons/17_administrative_law.html');
const E0=0.3,K=4,RHO=0.8,WID=5;
function sol(c,lam,P){const N=2000;let pbar=0,harm=0;for(let k=0;k<N;k++){const S=100*(k+0.5)/N;const p=1/(1+Math.exp(-(RHO*lam*S-c)/WID));pbar+=p;harm+=S*(1-RHO*lam*p);}pbar/=N;harm/=N;
 let bx=0,bv=1e18;for(let i=0;i<=20000;i++){const x=i*0.001;const v=x+E0*Math.exp(-x/K)*lam*P*pbar;if(v<bv-1e-15){bv=v;bx=x;}}
 const e=E0*Math.exp(-bx/K);return{pbar,x:bx,e,unc:e*harm,corr:100*e*lam*pbar};}
let n=0,bad=0,wx=0,we=0,wu=0;
for(const c of [0,1,2,5,10,20,30,45,60,80,100]) for(const l of [0,5,10,30,50,90,100]) for(const P of [0,5,20,40,100]){
  h.set('w17-c',c);h.set('w17-l',l);h.set('w17-pp',P);
  const r=sol(c,l/100,P);
  const tx=parseFloat(h.txt('w17-x')),te=parseFloat(h.txt('w17-e')),tu=parseFloat(h.txt('w17-h')),tp=parseFloat(h.txt('w17-pb')),tn=parseFloat(h.txt('w17-n'));
  n++;wx=Math.max(wx,Math.abs(tx-r.x));we=Math.max(we,Math.abs(te-r.e*100));wu=Math.max(wu,Math.abs(tu-r.unc));
  if(Math.abs(tx-r.x)>0.02||Math.abs(te-r.e*100)>0.1||Math.abs(tu-r.unc)>0.03||Math.abs(tp-r.pbar*100)>0.6||Math.abs(tn-r.corr)>0.06){bad++;if(bad<10)console.log('MISMATCH',{c,l,P},[tx,te,tu,tp,tn],[r.x.toFixed(2),(r.e*100).toFixed(1),r.unc.toFixed(2),(r.pbar*100).toFixed(1),r.corr.toFixed(1)]);}
  const all=['w17-x','w17-e','w17-pb','w17-h','w17-n','w17-note'].map(i=>h.txt(i)).join(' ');
  if(/NaN|undefined|Infinity/.test(all)){console.log('BAD TEXT',c,l,P,all);bad++;}
}
console.log('states',n,'bad',bad,'max dx',wx.toFixed(4),'de',we.toFixed(4),'dunc',wu.toFixed(4));
