// proto/04.js — lesson 04 widget maths: flicker change detection as a limited-capacity search (示意 toy)
// run: node tools/psy_qa/proto/04.js
// World: N objects; one changes between picture A and A'. Each cycle = A (240 ms) → blank (80 ms) → A' (240 ms) → blank (80 ms)  (FACTS: Rensink 1997 timing).
// Observer: each cycle attention can compare K objects across the blank (K = "how many objects you can hold across a gap"); it checks
//           objects in random order. Memory-for-scanning: with  = never re-checks an object it already cleared; without = picks K objects afresh each cycle.
//           If the changed object is among the K checked, it is noticed with probability Q (comparison itself is not perfect).
// Transient: with NO blank the change makes a local flash that grabs attention: each cycle the changed object is attended with probability G regardless of search.
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function oneRun(rng, N, K, Q, memory, blank, G) {
  var changed = Math.floor(rng() * N), order = [], i;
  for (i = 0; i < N; i++) order.push(i);
  for (i = N - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
  var ptr = 0;
  for (var cyc = 1; cyc <= 400; cyc++) {
    var checked = [];
    if (!blank && rng() < G) checked.push(changed);          // the transient pulls attention straight to the change
    if (memory) { for (i = 0; i < K && ptr < N; i++) checked.push(order[ptr++]); if (ptr >= N) ptr = 0; }
    else { for (i = 0; i < K; i++) checked.push(Math.floor(rng() * N)); }
    if (checked.indexOf(changed) >= 0 && rng() < Q) return cyc;
  }
  return 400;
}
function stats(N, K, memory, blank, runs, seed) {
  var rng = mulberry32(seed), a = [], s = 0;
  for (var r = 0; r < runs; r++) { var c = oneRun(rng, N, K, 0.9, memory, blank, 0.9); a.push(c); s += c; }
  a.sort(function (x, y) { return x - y; });
  return { mean: s / runs, med: a[Math.floor(runs / 2)], p90: a[Math.floor(runs * 0.9)] };
}
if (require.main === module) {
  [[8, 1, true, true], [8, 1, false, true], [8, 2, true, true], [8, 4, true, true], [12, 1, true, true], [12, 1, false, true], [4, 1, true, true], [8, 1, true, false], [12, 1, false, false]].forEach(function (c) {
    var st = stats(c[0], c[1], c[2], c[3], 4000, 2026), cyc = 0.64;
    console.log('N=' + c[0], 'K=' + c[1], c[2] ? 'memory' : 'no-memory', c[3] ? 'blank' : 'no-blank', '→ mean ' + st.mean.toFixed(2) + ' cycles (' + (st.mean * cyc).toFixed(1) + ' s), median ' + st.med + ', 90th pct ' + st.p90);
  });
  // analytic cross-check for memory-with-certain-detection: (N/K+1)/2 ... and with Q: sequential rounds
}
module.exports = { oneRun: oneRun, stats: stats, mulberry32: mulberry32 };
