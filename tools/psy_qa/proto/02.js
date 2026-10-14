// proto/02.js — lesson 02 widget maths: a lab simulator (true effect d, n per group, outcomes tried k, optional stopping, publish-only-significant)
// run: node tools/psy_qa/proto/02.js
'use strict';
function rng(seed){var a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function gauss(r){var u=r()||1e-12,v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
// regularized incomplete beta (Numerical Recipes betacf) -> Student t CDF
function lgamma(x){var c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];var y=x,t=x+5.5;t-=(x+0.5)*Math.log(t);var s=1.000000000190015;for(var j=0;j<6;j++)s+=c[j]/++y;return -t+Math.log(2.5066282746310005*s/x);}
function betacf(a,b,x){var m,m2,aa,c,d,del,h,qab=a+b,qap=a+1,qam=a-1;c=1;d=1-qab*x/qap;if(Math.abs(d)<1e-30)d=1e-30;d=1/d;h=d;for(m=1;m<=100;m++){m2=2*m;aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<1e-30)d=1e-30;c=1+aa/c;if(Math.abs(c)<1e-30)c=1e-30;d=1/d;h*=d*c;aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;if(Math.abs(d)<1e-30)d=1e-30;c=1+aa/c;if(Math.abs(c)<1e-30)c=1e-30;d=1/d;del=d*c;h*=del;if(Math.abs(del-1)<3e-7)break;}return h;}
function ibeta(a,b,x){if(x<=0)return 0;if(x>=1)return 1;var bt=Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));return x<(a+1)/(a+b+2)?bt*betacf(a,b,x)/a:1-bt*betacf(b,a,1-x)/b;}
function tcdf(t,df){var x=df/(df+t*t);var p=0.5*ibeta(df/2,0.5,x);return t>0?1-p:p;}
function pTwo(t,df){return 2*(1-tcdf(Math.abs(t),df));}
function mean(a){var s=0;for(var i=0;i<a.length;i++)s+=a[i];return s/a.length;}
function sd(a){var m=mean(a),s=0;for(var i=0;i<a.length;i++)s+=(a[i]-m)*(a[i]-m);return Math.sqrt(s/(a.length-1));}
function ttest(x,y){var nx=x.length,ny=y.length,sp=Math.sqrt(((nx-1)*Math.pow(sd(x),2)+(ny-1)*Math.pow(sd(y),2))/(nx+ny-2));var se=sp*Math.sqrt(1/nx+1/ny);var diff=mean(y)-mean(x);var t=diff/se;return{d:diff/sp,t:t,p:pTwo(t,nx+ny-2)};}
function oneStudy(r,d,n,k,stop){
  // k outcomes, each independent N(0,1) vs N(d,1) with the SAME true d; researcher keeps the smallest p (sign ignored if d_obs>0 else still counted)
  var cur=[];for(var j=0;j<k;j++){var x=[],y=[];for(var i=0;i<n;i++){x.push(gauss(r));y.push(gauss(r)+d);}cur.push([x,y]);}
  function best(){var b=null;for(var j=0;j<k;j++){var q=ttest(cur[j][0],cur[j][1]);if(!b||q.p<b.p)b=q;}return b;}
  var res=best();
  if(stop&&res.p>=0.05){var add=Math.max(1,Math.round(n/2));for(var j=0;j<k;j++){for(var i=0;i<add;i++){cur[j][0].push(gauss(r));cur[j][1].push(gauss(r)+d);}}res=best();}
  return res;
}
function lab(d,n,k,stop,S,seed){
  var r=rng(seed),pub=[],all=[],sigAll=0;
  for(var s=0;s<S;s++){var q=oneStudy(r,d,n,k,stop);all.push(q.d);if(q.p<0.05&&q.d>0){pub.push(q);}if(q.p<0.05)sigAll++;}
  // replication: one honest study (k=1, no stopping, same n) per published study
  var rr=rng(seed+991),rep=0,repD=[];
  for(var i=0;i<pub.length;i++){var q=oneStudy(rr,d,n,1,false);repD.push(q.d);if(q.p<0.05&&q.d>0)rep++;}
  return{sig:sigAll/S,pubN:pub.length,pubMeanD:pub.length?mean(pub.map(function(x){return x.d;})):0,repRate:pub.length?rep/pub.length:0,repMeanD:repD.length?mean(repD):0,allMeanD:mean(all)};
}
[[0.2,30,1,false],[0.2,30,1,true],[0.2,30,3,false],[0.0,30,1,false],[0.0,30,3,false],[0.0,30,5,true],[0.4,30,1,false],[0.5,100,1,false],[0.2,200,1,false],[0.1,20,1,false]].forEach(function(c){
  var t0=Date.now();var o=lab(c[0],c[1],c[2],c[3],3000,12345);
  console.log('d='+c[0]+' n='+c[1]+' k='+c[2]+' stop='+c[3]+' | sig '+(100*o.sig).toFixed(1)+'%  published mean d='+o.pubMeanD.toFixed(2)+'  inflation x'+(o.pubMeanD/(c[0]||1)).toFixed(2)+'  replication success '+(100*o.repRate).toFixed(0)+'%  rep mean d='+o.repMeanD.toFixed(2)+'  ('+(Date.now()-t0)+' ms)');
});
// checks of the t cdf: P(|T|>2.0, df=58) ~ 0.0504 ; df=10, t=2.228 -> 0.05
console.log('p(2.0,58)=',pTwo(2.0,58).toFixed(4),'p(2.228,10)=',pTwo(2.228,10).toFixed(4),'p(1.96,1e5)=',pTwo(1.96,100000).toFixed(4));
