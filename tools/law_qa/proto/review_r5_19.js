// r5 independent re-derivation for lesson 19: comply iff g <= d*b*m*sum_{t=1..T} delta^t. Brute-force the PV by explicit summation, not the closed form.
const B=2;
function pvLoss(d,m,T,delta){ let s=0; for(let t=1;t<=T;t++) s+=Math.pow(delta,t); return d*B*m*s; }
function S(T,delta){ let s=0; for(let t=1;t<=T;t++) s+=Math.pow(delta,t); return s; }
function closed(T,delta){ return delta*(1-Math.pow(delta,T))/(1-delta); }
console.log('closed vs explicit sum:', [[3,.9],[10,.9],[3,.5],[10,.5],[10,.95],[3,.3]].map(([T,d])=>S(T,d).toFixed(4)+'/'+closed(T,d).toFixed(4)).join('  '));
console.log('inf sums: .9->',(0.9/0.1).toFixed(2),' .5->',(0.5/0.5).toFixed(2));
const presets={bilateral:[4,.7,.9,3,1],multi:[4,.7,.9,3,4],long:[4,.7,.95,10,1],myopic:[4,.7,.3,3,4]};
for(const [k,[g,d,l,T,m]] of Object.entries(presets)){
  const loss=pvLoss(d,m,T,l), critD=g/(B*m*S(T,l)), minM=Math.ceil(g/(d*B*S(T,l))-1e-9);
  console.log(k.padEnd(10),'loss',loss.toFixed(3),'comply',g<=loss,'critD',(critD*100).toFixed(2)+'%','minM',minM);
}
console.log('crit g (d=.7,m=1): delta .5 T3/T10 =',pvLoss(.7,1,3,.5).toFixed(3),pvLoss(.7,1,10,.5).toFixed(3),' delta .9 T3/T10 =',pvLoss(.7,1,3,.9).toFixed(3),pvLoss(.7,1,10,.9).toFixed(3));
// is the claim "m scales linearly" and "bars are arithmetic"?
console.log('bars (preset1 d=.7 delta=.9 T=3): ',[1,2,3,4,5,6].map(m=>pvLoss(.7,m,3,.9).toFixed(2)).join(' '));
