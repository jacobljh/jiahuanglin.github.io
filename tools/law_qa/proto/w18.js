// w18 prototype: 三种审查强度。 node tools/law_qa/proto/w18.js
// 1000 部虚构法律：G∈1..10，σ=s/10 (s∈1..10)，B∈1..10（再乘 m）。全部用整数比较，避开浮点边界。
function mix(i){ var x=(i*2654435761+0x9e3779b9)>>>0; x^=x>>>16; x=Math.imul(x,0x85ebca6b)>>>0; x^=x>>>13; x=Math.imul(x,0xc2b2ae35)>>>0; x^=x>>>16; return (x>>>0)/4294967296; }
var ALT_SHARE=0.3;
var POP=(function(){ var L=[],i=0,G,s,B; for(G=1;G<=10;G++)for(s=1;s<=10;s++)for(B=1;B<=10;B++){ var u1=mix(i*2+1),u2=mix(i*2+2); i++; L.push({G:G,s:s,B:B,alt:u1<ALT_SHARE,al:0.5+0.5*u2}); } return L; })();
// 规则（kt = 10k，mp = 100m，全是整数）
function worthy(l,mp){ return 10*l.G*l.s > l.B*mp; }            // Gσ − B·m > 0
function bal(l,mp,kt){ return l.B*mp <= kt*l.G*l.s; }            // B·m ≤ k·Gσ
function altHit(l,th){ return l.alt && l.al >= th; }
var RV=[
  function(l,mp,kt){ return l.G>0 && l.s>2; },
  function(l,mp,kt){ return l.s>5 && !altHit(l,0.8) && bal(l,mp,kt); },
  function(l,mp,kt){ return l.G>=8 && l.s>=8 && !altHit(l,0.7) && bal(l,mp,kt); }
];
function stats(mp,kt){
  var out=[0,1,2].map(function(){return {pass:0,I:0,II:0};}), w=0;
  POP.forEach(function(l){ var wt=worthy(l,mp); if(wt)w++; for(var v=0;v<3;v++){ var p=RV[v](l,mp,kt); if(p)out[v].pass++; if(wt&&!p)out[v].I++; if(!wt&&p)out[v].II++; } });
  out.forEach(function(o){ o.tot=o.I+o.II; }); out.worthy=w; return out;
}
module.exports={POP:POP,RV:RV,stats:stats,worthy:worthy,bal:bal,altHit:altHit};
if(require.main===module){
  function show(mp,kt){ var s=stats(mp,kt); console.log('m='+mp/100+' k='+kt/10+' worthy='+s.worthy+' | '+s.map(function(o,i){return ['宽松','比例','严格'][i]+' pass'+o.pass+' I'+o.I+' II'+o.II+' tot'+o.tot;}).join(' | ')); return s; }
  // 嵌套与单调性：对整个 (k,m) 网格检查
  var viol=0,cnt=0,U=0,minAt=[0,0,0];
  for(var mp=40;mp<=160;mp+=10)for(var kt=5;kt<=30;kt++){
    cnt++;
    POP.forEach(function(l){ var a=RV[0](l,mp,kt),b=RV[1](l,mp,kt),c=RV[2](l,mp,kt); if((c&&!b)||(b&&!a)) viol++; });
    var s=stats(mp,kt);
    if(!(s[0].I<=s[1].I&&s[1].I<=s[2].I&&s[0].II>=s[1].II&&s[1].II>=s[2].II)) console.log('MONO FAIL',mp,kt);
    if(s[1].tot<s[0].tot&&s[1].tot<s[2].tot) U++;
    var mi=0; s.forEach(function(o,i){ if(o.tot<s[mi].tot) mi=i; }); minAt[mi]++;
  }
  console.log('grid points',cnt,'nest violations',viol,'U-shaped (middle lowest total)',U,'argmin total by level',minAt.join('/'));
  show(100,15); show(100,10); show(100,30); show(100,5); show(40,15); show(160,15);
  // 加权最省
  var s=stats(100,15), R=[1/8,1/4,1/2,1,2,4,8];
  R.forEach(function(r){ var w=s.map(function(o){return r*o.I+o.II;}); var b=0; w.forEach(function(x,i){ if(x<w[b]) b=i; }); console.log('r='+r+' w='+w.map(function(x){return x.toFixed(1);}).join(' / ')+' best='+['宽松','比例','严格'][b]); });
  var s3=stats(100,30); R.forEach(function(r){ var w=s3.map(function(o){return r*o.I+o.II;}); var b=0; w.forEach(function(x,i){ if(x<w[b]) b=i; }); console.log('k=3 r='+r+' w='+w.map(function(x){return x.toFixed(1);}).join(' / ')+' best='+['宽松','比例','严格'][b]); });
}
