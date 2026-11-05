// compare widget vs independent solver over the whole slider grid
const h=require('./review_r5_harness.js')('all_lessons/law/lessons/05_contract.html');
function v(r,G){return 80+G*(1-Math.exp(-r/10));}
function P(x,C){return Math.min(Math.max(x/C,0),1);}
function E(x,C){var y=Math.min(Math.max(x,0),C);return y*y/(2*C);}
function Wf(r,t,G,C){return P(t,C)*v(r,G)-E(t,C)-r;}
function best(f){var b=-1e18,br=0;for(var i=0;i<=40000;i++){var r=i*0.002,x=f(r);if(x>b){b=x;br=r;}}return br;}
let bad=0,n=0,worstW=0;
for(const p of [30,35,40,45,50,55,60,65,70,75,80]) for(const C of [100,110,120,130,140,150,160,170,180,190,200]) for(const G of [10,20,30,40,50,60,70,80]){
  h.set('w05-price',p);h.set('w05-cmax',C);h.set('w05-gain',G);
  const U=[r=>P(p,C)*(v(r,G)-p)-r, r=>P(p+r,C)*(v(r,G)-p-r), r=>(v(r,G)-p)-r, r=>(v(r,G)-p)-r];
  const T=[r=>p,r=>p+r,r=>v(r,G),r=>1e9];
  const rs=best(r=>Wf(r,v(r,G),G,C));const Ws=Wf(rs,v(rs,G),G,C);
  for(let k=0;k<4;k++){
    h.click('w05-p'+k);
    const r=best(U[k]),t=T[k](r),W=Wf(r,t,G,C);
    const txtW=parseFloat(h.txt('w05-kw')),txtR=parseFloat(h.txt('w05-kr')),perf=parseFloat(h.txt('w05-kperf'));
    n++;
    const dW=Math.abs(txtW-W);worstW=Math.max(worstW,dW);
    if(dW>0.02||Math.abs(txtR-r)>0.1||Math.abs(perf-P(t,C)*100)>0.1){bad++;if(bad<15)console.log('MISMATCH',{p,C,G,k,widget:[txtR,perf,txtW],mine:[r.toFixed(2),(P(t,C)*100).toFixed(1),W.toFixed(2)]});}
    const all=['w05-kr','w05-kperf','w05-kw','w05-kgap','w05-kmis','w05-note'].map(i=>h.txt(i)).join(' ');
    if(/NaN|undefined|Infinity/.test(all)){console.log('BAD TEXT',p,C,G,k,all);bad++;}
  }
}
console.log('checked',n,'states; mismatches',bad,'max |dW|',worstW.toFixed(4));
