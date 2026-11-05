// r7 review of lesson 18 widget: independent re-derivation of the nested three-tier review model (integer arithmetic, written from the
// prose table, not from the widget's code), compared with the widget over the full slider grid; plus NaN scan and the numbers quoted in the prose.
const h = require('./review_r5_harness.js')('all_lessons/law/lessons/18_constitution_review.html');
// ---- the only thing copied from the widget: the fixed integer hash that assigns "has a lighter alternative" ----
function mix(i){ var x = (i*2654435761 + 0x9e3779b9) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16; return (x >>> 0)/4294967296; }
const POP=[]; let idx=0;
for(let G=1;G<=10;G++)for(let s=1;s<=10;s++)for(let B=1;B<=10;B++){const u1=mix(idx*2+1),u2=mix(idx*2+2);idx++;POP.push({G,sig:s/10,B,alt:u1<0.3,alpha:0.5+0.5*u2});}
console.log('population',POP.length,'with alt',POP.filter(l=>l.alt).length);
// ---- model written from the prose table, floating-point with an epsilon guard instead of integers ----
const EPS=1e-9;
const worthy=(l,m)=>l.G*l.sig-l.B*m>EPS;                 // G*sigma - B*m > 0
const lighter=(l,th)=>l.alt&&l.alpha>=th-EPS;            // exists a lighter means with effect ratio >= th
const balance=(l,m,k)=>l.B*m<=k*l.G*l.sig+EPS;           // B*m <= k*G*sigma
function pass(l,tier,m,k){
  if(tier==='lax') return l.G>0 && l.sig>0.2+EPS;
  if(tier==='prop') return l.sig>0.5+EPS && !lighter(l,0.8) && balance(l,m,k);
  return l.G>=8 && l.sig>=0.8-EPS && !lighter(l,0.7) && balance(l,m,k);
}
const TIERS=['lax','prop','strict'];
function stats(m,k){const out=TIERS.map(()=>({I:0,II:0,pass:0}));let wc=0;for(const l of POP){const w=worthy(l,m);if(w)wc++;TIERS.forEach((t,i)=>{const p=pass(l,t,m,k);if(p)out[i].pass++;if(w&&!p)out[i].I++;if(!w&&p)out[i].II++;});}return {out,wc};}
// nesting check over grid
let nestBad=0,cmpBad=0,nanBad=0,cnt=0;
const RS=[0.125,0.25,0.5,1,2,4,8];
function parseTriple(s){return s.split(' ')[0].split(' / ');}
for(let kt=5;kt<=30;kt+=1)for(let mp=40;mp<=160;mp+=10){
  const m=mp/100,k=kt/10; const st=stats(m,k);
  for(const l of POP){const a=pass(l,'lax',m,k),b=pass(l,'prop',m,k),c=pass(l,'strict',m,k); if((c&&!b)||(b&&!a))nestBad++;}
  // compare with widget
  h.set('w18-k',kt);h.set('w18-m',mp);h.set('w18-r',3);
  const I=h.txt('w18-i').replace(' 部','').split(' / ').map(Number), II=h.txt('w18-ii').replace(' 部','').split(' / ').map(Number);
  for(let i=0;i<3;i++){ if(I[i]!==st.out[i].I||II[i]!==st.out[i].II){cmpBad++; if(cmpBad<6)console.log('MISMATCH k',k,'m',m,'tier',i,'widget',I[i],II[i],'indep',st.out[i].I,st.out[i].II);} }
  const mv=h.txt('w18-mval'); if(!mv.includes('值得的有 '+st.wc+' 部')){cmpBad++;console.log('worthy mismatch',mv,st.wc);}
  cnt++;
}
console.log('grid (k,m) points',cnt,'nesting violations',nestBad,'widget-vs-independent mismatches',cmpBad);
// NaN / undefined scan across all controls
const ids=['w18-kval','w18-mval','w18-rval','w18-lawval','w18-struck','w18-i','w18-ii','w18-tot','w18-best','w18-note'];
for(const kt of [5,15,30])for(const mp of [40,50,100,160])for(const ri of [0,3,6])for(const li of [1,2,3,4,5,6]){h.set('w18-k',kt);h.set('w18-m',mp);h.set('w18-r',ri);h.set('w18-law',li);for(const id of ids){const s=h.txt(id);if(/NaN|undefined|Infinity/.test(s)){nanBad++;console.log('BAD',id,s);}}}
console.log('NaN-ish text',nanBad);
// ---- numbers quoted in prose ----
function show(label,kt,mp,ri){h.set('w18-k',kt);h.set('w18-m',mp);h.set('w18-r',ri);console.log(label,'|',['w18-mval','w18-rval','w18-struck','w18-i','w18-ii','w18-tot','w18-best'].map(i=>h.txt(i)).join(' | '));}
const st0=stats(0.5,1.5);console.log('INDEP default (m=.5,k=1.5): worthy',st0.wc,'I',st0.out.map(o=>o.I).join('/'),'II',st0.out.map(o=>o.II).join('/'),'tot',st0.out.map(o=>o.I+o.II).join('/'));
const lossOf=(st,r)=>st.out.map(o=>r*o.I+o.II).map(x=>Math.round(x)).join('/');
console.log('INDEP loss r=4',lossOf(st0,4),' r=1/8',lossOf(st0,0.125),' r=1',lossOf(st0,1));
const st1=stats(1.0,1.5);console.log('INDEP bad-majority (m=1,k=1.5): worthy',st1.wc,'I',st1.out.map(o=>o.I).join('/'),'II',st1.out.map(o=>o.II).join('/'),'tot',st1.out.map(o=>o.I+o.II).join('/'));
for(const k of [1.0,3.0]){const s=stats(1.0,k);console.log('INDEP m=1 k=',k,'prop II',s.out[1].II,'prop tot',s.out[1].I+s.out[1].II,'strict tot',s.out[2].I+s.out[2].II,'lax tot',s.out[0].I+s.out[0].II);}
h.click('w18-p0');console.log('p0',['w18-mval','w18-rval','w18-i','w18-ii','w18-tot','w18-best'].map(i=>h.txt(i)).join(' | '));
h.click('w18-p1');console.log('p1',['w18-mval','w18-rval','w18-i','w18-ii','w18-tot','w18-best'].map(i=>h.txt(i)).join(' | '));
h.click('w18-p2');console.log('p2',['w18-mval','w18-rval','w18-i','w18-ii','w18-tot','w18-best'].map(i=>h.txt(i)).join(' | '));
h.click('w18-p3');console.log('p3',['w18-mval','w18-rval','w18-i','w18-ii','w18-tot','w18-best'].map(i=>h.txt(i)).join(' | '));
h.set('w18-k',10);console.log('p3 k=1.0',['w18-i','w18-ii','w18-tot'].map(i=>h.txt(i)).join(' | '));
h.set('w18-k',30);console.log('p3 k=3.0',['w18-i','w18-ii','w18-tot'].map(i=>h.txt(i)).join(' | '));
// six named laws
const LAWS=[[3,.9,2,0,0],[6,.7,2,1,.85],[9,.9,3,0,0],[4,.8,7,1,.9],[5,.4,3,0,0],[6,.6,5,0,0]].map(a=>({G:a[0],sig:a[1],B:a[2],alt:!!a[3],alpha:a[4]}));
for(const k of [1.5]){LAWS.forEach((l,i)=>{const w=worthy(l,1);console.log('law',i+1,'G*s-B=',(l.G*l.sig-l.B).toFixed(1),'worthy',w,TIERS.map(t=>pass(l,t,1,k)?'通过':'推翻').join('/'),TIERS.map(t=>pass(l,t,1,k)===w?'对':'错').join('/'));});}
// monotonic checks: I non-decreasing, II non-increasing with strictness at every grid point (implied by nesting)
// how often is total error U-shaped / monotone over the grid at r irrelevant
let u=0,mono=0,other=0;for(let kt=5;kt<=30;kt+=5)for(let mp=40;mp<=160;mp+=10){const s=stats(mp/100,kt/10).out.map(o=>o.I+o.II);if(s[1]<s[0]&&s[1]<s[2])u++;else if(s[0]>s[1]&&s[1]>s[2])mono++;else other++;}
console.log('total-error shape over (k,m) grid: U-shaped',u,'monotone-down',mono,'other',other);
