// proto for lesson 20 widget: 纠纷漏斗 (示意). Same maths as the widget script.
// run: node tools/law_qa/proto/w20.js
function sg(z){ return 1/(1+Math.exp(-z)); }
function Phi(x){ var t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return x>0?1-p:p; }
function qnorm(p){ var lo=-6,hi=6,m,i; for(i=0;i<60;i++){ m=(lo+hi)/2; if(Phi(m)<p) lo=m; else hi=m; } return (lo+hi)/2; }
var M=15, ZS=[], j; for(j=0;j<M;j++) ZS.push(qnorm((j+0.5)/M));
var FIX=[210,170,60,90,140,180,300];          // fixed friction per station (示意单位)
var PROP=[0,0,0,0.02,0.03,0.04,0.08];         // part that grows with the stake
var SLOPE=1.2, GAP=0.06, SD=1.0;
var STAKES=[100,150,200,300,500,700,1000,1500,2000,3000,5000,7000,10000];
var FEES=[0.2,0.3,0.5,0.7,1,1.5,2,3,5];
function cohort(S,f,tr,add){
  var cost=[],k; for(k=0;k<7;k++) cost.push(f*(FIX[k]+PROP[k]*S)+((add&&add[k])||0));
  var Ct=cost[4]+cost[5];
  var H=sg(SLOPE*Math.log(Ct/(GAP*S)));            // share who settle before trial
  var lam=1-Math.pow(1-H,1/3);                      // per-station hazard at stations 3,4,5
  var n=1, rows=[];
  for(k=0;k<7;k++){
    var w=sg((S-cost[k])/(0.4*cost[k]+1)+tr);
    var pass=n*w, lost=n-pass, st=0;
    if(k>=2&&k<=4){ st=pass*lam; pass-=st; }
    rows.push({inn:n,out:pass,lost:lost,settled:st}); n=pass;
  }
  return rows;
}
function run(Smed,f,tr,add){
  var rows=[],k,i; for(k=0;k<7;k++) rows.push({out:0,lost:0,settled:0});
  var jm=0,jw=0;
  for(i=0;i<M;i++){
    var S=Smed*Math.exp(SD*ZS[i]), c=cohort(S,f,tr,add);
    for(k=0;k<7;k++){ rows[k].out+=c[k].out*1000/M; rows[k].lost+=c[k].lost*1000/M; rows[k].settled+=c[k].settled*1000/M; }
    jw+=c[5].out; jm+=c[5].out*Math.log(S/Smed);
  }
  var drop=0,settle=0; for(k=0;k<6;k++){ drop+=rows[k].lost; settle+=rows[k].settled; }
  return {rows:rows, drop:drop, settle:settle, judged:rows[5].out, end:rows[6].out, tail:rows[6].lost, selMult: jw>0?Math.exp(jm/jw):1};
}
function round3(a,b,c){ var v=[a,b,c],fl=v.map(Math.floor),rem=1000-fl[0]-fl[1]-fl[2],idx=[0,1,2].sort(function(x,y){return (v[y]-fl[y])-(v[x]-fl[x]);}),t; for(t=0;t<rem;t++) fl[idx[t]]++; return fl; }
module.exports={run:run,round3:round3,STAKES:STAKES,FEES:FEES,ZS:ZS};
if(require.main===module){
  function fmt(r){ return r.rows.map(function(x){return x.out.toFixed(0);}).join(' ')+' | judged '+r.judged.toFixed(1)+' settle '+r.settle.toFixed(1)+' drop '+r.drop.toFixed(1)+' tail '+r.tail.toFixed(1)+' sel×'+r.selMult.toFixed(2)+' sum '+(r.judged+r.settle+r.drop).toFixed(3); }
  console.log('default S300 f1 tr0 :',fmt(run(300,1,0)));
  console.log('small  S100        :',fmt(run(100,1,0)));
  console.log('large  S3000       :',fmt(run(3000,1,0)));
  console.log('distrust tr-2      :',fmt(run(300,1,-2)));
  var b=run(300,1,0), a=run(300,1,0,{4:100}), c=run(300,1,0,{0:50,1:50});
  var rb=round3(b.judged,b.settle,b.drop), ra=round3(a.judged,a.settle,a.drop), rc=round3(c.judged,c.settle,c.drop);
  console.log('base',rb,'filing+100',ra,'delta',ra.map(function(x,i){return x-rb[i];}),'front+100',rc,'delta',rc.map(function(x,i){return x-rb[i];}));
  // invariants
  var bad=0;
  STAKES.forEach(function(S){ FEES.forEach(function(f){ [-2,-1,-0.5,0,0.5,1,2].forEach(function(t){ [0,40,100,300].forEach(function(d){
    var r=run(S,f,t,{4:d}), r2=run(S,f,t,{0:d/2,1:d/2});
    [r,r2].forEach(function(q){ var s=q.judged+q.settle+q.drop; if(Math.abs(s-1000)>1e-6||!isFinite(s)) bad++; for(var k=1;k<6;k++){ if(q.rows[k].out>q.rows[k-1].out+1e-9) bad++; } });
  }); }); }); });
  console.log('invariant violations:',bad);
}

// ---- why the BIBLE §5-20 model was replaced: literal spec = logistic((S-c)/(0.4c+1)+trust) per stage, costs 5,20,60,150,300 (one stake, no settlement exit)
function specLiteral(S,costs,f,tr){ var n=1000,k; for(k=0;k<costs.length;k++){ var c=costs[k]*f; n*=sg((S-c)/(0.4*c+1)+tr); } return n; }
if(require.main===module){
  var base=[5,20,60,150,300], b=specLiteral(300,base,1,0), a=base.slice(), c=base.slice(); a[0]*=5; c[3]*=5;
  console.log('spec-literal S=300: reach judgment',b.toFixed(1),'| front cost x5 ->',specLiteral(300,a,1,0).toFixed(1),'| filing cost x5 ->',specLiteral(300,c,1,0).toFixed(1));
  console.log('spec-literal S=500/1000/3000 reach judgment:',[500,1000,3000].map(function(S){return specLiteral(S,base,1,0).toFixed(0);}).join(' / '),'(of 1000: no pyramid, no settlement)');
}
