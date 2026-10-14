// proto/02b.js — lesson 02 widget model v2: a lab that tests a mix of true/false hypotheses.
// Inputs: d (effect size when a hypothesis is true), pi (share of tested hypotheses that are true), n (per group), k (outcomes tried; best one reported),
//         stop (add n/2 per group and retest if not significant), S studies simulated (seeded).
// Outputs: significant share; published (significant) mean |d|; exaggeration among true effects; false-discovery share of the published; honest-replication success rate.
'use strict';
function rng(seed){var a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function gauss(r){var u=r()||1e-12,v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function lgamma(x){var c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];var y=x,t=x+5.5;t-=(x+0.5)*Math.log(t);var s=1.000000000190015;for(var j=0;j<6;j++)s+=c[j]/++y;return -t+Math.log(2.5066282746310005*s/x);}
function betacf(a,b,x){var m,m2,aa,c,d,del,h,qab=a+b,qap=a+1,qam=a-1;c=1;d=1-qab*x/qap;if(Math.abs(d)<1e-30)d=1e-30;d=1/d;h=d;for(m=1;m<=100;m++){m2=2*m;aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<1e-30)d=1e-30;c=1+aa/c;if(Math.abs(c)<1e-30)c=1e-30;d=1/d;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<1e-30)d=1e-30;c=1+aa/c;if(Math.abs(c)<1e-30)c=1e-30;d=1/d;del=d*c;h*=del;if(Math.abs(del-1)<3e-7)break;}return h;}
function ibeta(a,b,x){if(x<=0)return 0;if(x>=1)return 1;var bt=Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));return x<(a+1)/(a+b+2)?bt*betacf(a,b,x)/a:1-bt*betacf(b,a,1-x)/b;}
function tcdf(t,df){var x=df/(df+t*t);var p=0.5*ibeta(df/2,0.5,x);return t>0?1-p:p;}
var tcritCache={};
function tcrit(df){if(tcritCache[df])return tcritCache[df];var lo=0,hi=40,i;for(i=0;i<50;i++){var m=(lo+hi)/2;if(2*(1-tcdf(m,df))>0.05)lo=m;else hi=m;}return tcritCache[df]=(lo+hi)/2;}
// one outcome accumulator: groups of n draws; group 2 has mean mu
function mkAcc(r,n,mu){var a={n:0,s1:0,q1:0,s2:0,q2:0};add(a,r,n,mu);return a;}
function add(a,r,m,mu){for(var i=0;i<m;i++){var x=gauss(r),y=gauss(r)+mu;a.s1+=x;a.q1+=x*x;a.s2+=y;a.q2+=y*y;}a.n+=m;}
function stat(a){var n=a.n,m1=a.s1/n,m2=a.s2/n,v1=(a.q1-n*m1*m1)/(n-1),v2=(a.q2-n*m2*m2)/(n-1),sp=Math.sqrt((v1+v2)/2);var se=sp*Math.sqrt(2/n);return{t:(m2-m1)/se,d:(m2-m1)/sp,df:2*n-2};}
function study(r,mu,n,k,stop){
  var acc=[];for(var j=0;j<k;j++)acc.push(mkAcc(r,n,mu));
  function best(){var b=null;for(var j=0;j<k;j++){var s=stat(acc[j]);if(!b||Math.abs(s.t)>Math.abs(b.t))b=s;}return b;}
  var s=best();
  if(stop&&Math.abs(s.t)<tcrit(s.df)){var m=Math.max(1,Math.round(n/2));for(var j=0;j<k;j++)add(acc[j],r,m,mu);s=best();}
  s.sig=Math.abs(s.t)>=tcrit(s.df);return s;
}
function lab(p){
  var r=rng(p.seed||2015),rr=rng((p.seed||2015)+7919),S=p.S||1500;
  var nSig=0,sumAbs=0,nSigTrue=0,sumAbsTrue=0,nSigNull=0,rep=0,hist=[],histPub=[];
  for(var i=0;i<S;i++){
    var isTrue=r()<p.pi,mu=isTrue?p.d:0;
    var s=study(r,mu,p.n,p.k,p.stop);
    hist.push(s.d);
    if(s.sig){nSig++;sumAbs+=Math.abs(s.d);histPub.push(s.d);if(isTrue){nSigTrue++;sumAbsTrue+=Math.abs(s.d);}else nSigNull++;
      var q=study(rr,mu,p.n,1,false);if(q.sig&&Math.sign(q.d)===Math.sign(s.d))rep++;}
  }
  return{sig:nSig/S,pubMean:nSig?sumAbs/nSig:0,exag:(p.d>0&&nSigTrue)?(sumAbsTrue/nSigTrue)/p.d:NaN,fdr:nSig?nSigNull/nSig:0,rep:nSig?rep/nSig:0,hist:hist,histPub:histPub,nSig:nSig};
}
if(require.main===module){
  [{d:.4,pi:.5,n:30,k:1,stop:false},{d:.4,pi:.5,n:30,k:3,stop:true},{d:.4,pi:.5,n:100,k:1,stop:false},{d:.4,pi:.2,n:30,k:1,stop:false},{d:.2,pi:.5,n:30,k:1,stop:false},{d:.5,pi:.8,n:100,k:1,stop:false},{d:.4,pi:0,n:30,k:5,stop:true},{d:.8,pi:.5,n:20,k:1,stop:false}].forEach(function(c){
    c.S=1500;var t0=Date.now();var o=lab(c);
    console.log(JSON.stringify(c).replace(/"/g,''),'| sig',(100*o.sig).toFixed(1)+'%','pub|d|',o.pubMean.toFixed(2),'exag',isNaN(o.exag)?'—':o.exag.toFixed(2)+'x','false-share',(100*o.fdr).toFixed(0)+'%','rep',(100*o.rep).toFixed(0)+'%',(Date.now()-t0)+'ms');
  });
  console.log('tcrit(58)=',tcrit(58).toFixed(4),' tcrit(10)=',tcrit(10).toFixed(4),' tcrit(1000)=',tcrit(1000).toFixed(4));
}
module.exports={lab:lab,tcrit:tcrit};
