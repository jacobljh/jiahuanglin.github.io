const h=require('./review_r5_harness.js')('all_lessons/law/lessons/19_international_law.html');
const B=2;function S(T,d){let s=0;for(let t=1;t<=T;t++)s+=Math.pow(d,t);return s;}
let n=0,bad=0;
for(const g of [0,0.5,1,2,4,8,12,20]) for(const d of [0,5,25,50,70,100]) for(const l of [30,50,70,90,95,99]) for(const T of [1,3,5,10]) for(const m of [1,2,4,6]){
  h.set('w19-g',g);h.set('w19-d',d);h.set('w19-l',l);h.set('w19-t',T);h.set('w19-m',m);
  const dd=d/100,ll=l/100,s=S(T,ll),loss=dd*B*m*s,ok=g<=loss+1e-9;
  const res=h.txt('w19-res'),cg=parseFloat(h.txt('w19-cg')),glt=h.txt('w19-gl');
  n++;
  const all=['w19-gl','w19-res','w19-cg','w19-cd','w19-mm','w19-note'].map(i=>h.txt(i)).join(' ');
  if(/NaN|undefined|Infinity/.test(all)){bad++;console.log('BAD TEXT',{g,d,l,T,m},all);}
  if(Math.abs(cg-loss)>0.006||(ok!==/^遵守/.test(res))){bad++;if(bad<10)console.log('MISMATCH',{g,d,l,T,m},res,cg,loss.toFixed(3));}
  // min partners check
  const mm=h.txt('w19-mm'); const need=g<=0?1:(dd<=0?99:Math.max(1,Math.ceil(g/(dd*B*s)-1e-9)));
  const expect=need<=6?need+' 个':'6 个也不够';
  if(mm!==expect){bad++;if(bad<10)console.log('MM MISMATCH',{g,d,l,T,m},mm,expect);}
  // critical d check
  const cd=h.txt('w19-cd'); const cD=g<=0?0:g/(B*m*s); const ecd=cD>1?('约 '+Math.round(cD*100)+'%（超过 100%，必被发现也压不住）'):(Math.round(cD*100)+'%');
  if(cd!==ecd){bad++;if(bad<10)console.log('CD MISMATCH',{g,d,l,T,m},cd,ecd);}
}
console.log('states',n,'bad',bad);
