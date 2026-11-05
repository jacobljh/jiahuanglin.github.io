// proto for 09 程序要配多重 — exhaustive search over 2^5 safeguard packages
var S=[{n:'书面通知',r:0.30,c:20},{n:'听证',r:0.35,c:200},{n:'律师',r:0.30,c:600},{n:'交叉询问',r:0.30,c:300},{n:'上诉',r:0.30,c:900}];
function pk(m,e0){ var e=e0,c=0; for(var i=0;i<5;i++) if(m>>i&1){ e*=1-S[i].r; c+=S[i].c; } return {m:m,e:e,c:c}; }
function all(e0,L){ var a=[]; for(var m=0;m<32;m++){ var p=pk(m,e0); p.err=p.e*L; p.tot=p.err+p.c; a.push(p);} a.sort(function(x,y){ return x.tot-y.tot || x.m-y.m; }); return a; }
function nm(m){ var o=[]; for(var i=0;i<5;i++) if(m>>i&1) o.push(S[i].n); return o.join('+')||'无'; }
function line(s){ console.log(s); }
[[0.2,1e3],[0.2,1e4],[0.2,1e5],[0.2,1e6],[0.2,1e7],[0.05,1e5],[0.05,1e3],[0.05,1e4],[0.4,1e3],[0.02,1e5],[0.4,1e5]].forEach(function(a){
  var r=all(a[0],a[1]), b=r[0], z=r.filter(function(x){return x.m===0;})[0], f=r.filter(function(x){return x.m===31;})[0];
  line('e0='+a[0]+' L='+a[1]+' -> best '+nm(b.m)+' e='+(b.e*100).toFixed(2)+'% err='+b.err.toFixed(0)+' c='+b.c+' tot='+b.tot.toFixed(0)+' | none tot='+z.tot.toFixed(0)+' | all tot='+f.tot.toFixed(0)+' | 2nd '+nm(r[1].m)+' '+r[1].tot.toFixed(0));
});
// thresholds in L (e0=0.2): scan log L
function scan(e0){ var prev=-1,out=[]; for(var k=0;k<=400;k++){ var lg=3+4*k/400, L=Math.pow(10,lg); var b=all(e0,L)[0]; if(b.m!==prev){ out.push(lg.toFixed(2)+' (L='+L.toFixed(0)+'): '+nm(b.m)); prev=b.m; } } return out; }
line('--- thresholds e0=0.2'); scan(0.2).forEach(line);
line('--- thresholds e0=0.05'); scan(0.05).forEach(line);
line('--- thresholds e0=0.4'); scan(0.4).forEach(line);
// ties?
var ties=0; for(var e=0.02;e<=0.4001;e+=0.01) for(var lg=3;lg<=7.001;lg+=0.1){ var r=all(e,Math.pow(10,lg)); if(Math.abs(r[0].tot-r[1].tot)<1e-6) ties++; }
line('ties '+ties);
// marginal check: one safeguard at a time
var e=0.2; for(var i=0;i<5;i++){ line(S[i].n+': saves at L=1e3 '+(e*1e3*S[i].r).toFixed(0)+' costs '+S[i].c+'; L=1e4 '+(e*1e4*S[i].r).toFixed(0)+'; L=1e5 '+(e*1e5*S[i].r).toFixed(0)); }
// full vs none at L=1e3, e0=.2
// exact thresholds by bisection on log10 L
function bestAt(e0,lg){ return all(e0,Math.pow(10,lg))[0].m; }
function thresholds(e0){ var out=[],prev=bestAt(e0,3),lo=3; for(var k=1;k<=4000;k++){ var lg=3+4*k/4000; var m=bestAt(e0,lg); if(m!==prev){ var a=3+4*(k-1)/4000,b=lg; for(var j=0;j<50;j++){ var mid=(a+b)/2; if(bestAt(e0,mid)===prev) a=mid; else b=mid; } out.push('L='+Math.pow(10,b).toFixed(0)+' -> '+nm(m)); prev=m; } } return out; }
[0.2,0.05,0.4,0.1].forEach(function(e0){ line('--- exact thresholds e0='+e0); thresholds(e0).forEach(line); });
// slider grid v=30..70: best at e0=0.2
for(var v=30;v<=70;v++){ var L=Math.pow(10,v/10); line('v='+v+' L='+L.toFixed(0)+' best '+nm(all(0.2,L)[0].m)); }
