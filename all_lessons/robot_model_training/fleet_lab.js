/* fleet_lab.js — lesson 20's private engine: a fleet of robots as a source of corrections, and what it costs to supervise.
 *
 * THE BENCH'S FLEET.  Robots work the five-post course of lessons 1 to 3 and 19 (one attempt is one run, 9.3 s of motion, under the gust of 0.05).  A supervisor steps in only on an attempt that would
 * end in a post: the attempt is run once to find the stray that ends in the post (the first step more than TOL = 2.5 cm from the path after the cup was last within BACK = 1 cm of it), and run
 * again with a person called at that step (if the post is still hit at the same stray, the person was too late: the attempt is lost, and whatever they drove is still labelled).  The person takes REACT = 6 steps (0.3 s, lesson 3's assumption) to reach the controls, the clone keeps driving meanwhile, then the person drives
 * with the expert's command, and only those frames are labelled, until the cup is within BACK of the path, and hands back.  A failure that comes within REACT steps of the stray cannot be
 * prevented (late: nothing is labelled).  A lineage: clone g is the nearest-demo regressor of lesson 1 trained on the 20 calm demonstrations and every frame labelled in generations 0..g-1
 * (retraining is storing, and old corrections keep their value: lesson 19); generation g runs attempts until B = 10 failing attempts have been supervised; clone g is scored on 1000 unassisted
 * runs.  TABLE holds four lineages (attempt seeds 1000000 (L + 1) + counter), measured by FL.lineage and re-derived by a separate implementation in the lesson's oracle.
 *
 * THE LEDGER LINE.  Per attempt a person would take v = wage x 9.3 s of work; the robot costs r = (arm cost per hour) / (attempts per hour); a failing attempt (share p = 1 - s) costs c = wage x tau /
 * (3600 x duty): tau seconds of a supervisor, who is paid for tau / duty because duty is the share of their time spent correcting (their utilisation).  Net per attempt v - r - p c.
 * CURVE: the failure share after n failing attempts have been supervised is the pooled table read by interpolation.  K is the task-size factor of lesson 18:
 * K times the failures are needed, in generations K times as long; prices and rates are unchanged.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var DL = root.DL || require('./dagger_lab.js');
var LG = root.LG || require('./ledger.js');
var FL = {};
FL.W = DL.WA; FL.REACT = 6; FL.TOL = DL.TOL; FL.BACK = DL.BACK; FL.B = 10; FL.NG = 40; FL.NEV = 1000; FL.EVSEED = 5; FL.MAXPASS = 8;
FL.HOURS = 8;                                       // working hours a robot has in a day (an assumption of this lesson)
FL.TAU = 20;                                        // supervisor seconds that one failing attempt costs (an assumption of this lesson; the Bench measures only the driving)

/* ───────────── the Bench's fleet ───────────── */
FL.stock = function () { var X = [], Y = []; BN.demos(FL.W, DL.DEMOS, BN.rng(1), { noise: 0, jit: DL.JIT }).forEach(function (ro) { for (var t = 0; t < ro.A.length; t++) { X.push(ro.S[t]); Y.push(ro.A[t]); } }); return { X: X, Y: Y }; };
FL.clone = function (X, Y) { var nw = new BN.NW(DL.H); for (var i = 0; i < X.length; i++) nw.add(X[i], Y[i]); return nw; };
FL.evaluate = function (nw, N, seed) { return BN.evaluate(FL.W, function () { return function (q) { return DL.predict(nw, q); }; }, N, seed, { noise: DL.GUST, jit: DL.JIT }); };
/* one run of the clone from attempt seed `seed`; at each step in `starts` (ascending) a person is called: the clone drives for REACT more steps, then the person drives (labelled) until the cup is within BACK of the path */
FL.run = function (nw, seed, starts) {
  var mode = 0, cnt = 0, idx = 0, fresh = [], dur = [], cur = 0;
  var ro = BN.rollout(FL.W, function (q, t) {
    var dev = BN.slalom.dev(FL.W, BN.arm.fk(q, FL.W.body));
    if (mode === 0 && idx < starts.length && t >= starts[idx]) { mode = 1; cnt = 0; cur = 0; idx++; }
    if (mode === 1) { cnt++; cur++; if (cnt > FL.REACT) mode = 2; }
    if (mode === 2 && dev < FL.BACK) { mode = 0; dur.push(cur); }
    if (mode === 2) { cur++; var a = BN.slalom.expertAct(FL.W, q); fresh.push([q, a]); return a; }
    return DL.predict(nw, q);
  }, BN.rng(seed), { noise: DL.GUST, jit: DL.JIT });
  if (mode !== 0) dur.push(cur);
  return { ro: ro, fresh: fresh, dur: dur };
};
/* the step at which the stray that ended in a post began: the first step above TOL after the cup was last within BACK of the path */
FL.strayStart = function (ro) {
  var t = Math.min(ro.steps, ro.dev.length) - 1, low = 0;
  for (; t >= 0; t--) if (ro.dev[t] < FL.BACK) { low = t; break; }
  for (t = low; t < ro.dev.length; t++) if (ro.dev[t] > FL.TOL) return t;
  return -1;
};
/* one attempt of a robot whose supervisor knows which runs fail: takeovers, whether a failure came too late to prevent, and the frames driven */
FL.attempt = function (nw, seed) {
  var starts = [], r, late = false, passes = 0;
  for (;;) {
    r = FL.run(nw, seed, starts); passes++;
    if (!r.ro.coll) break;
    var st = FL.strayStart(r.ro);
    if (st < 0 || starts.indexOf(st) >= 0 || r.ro.steps - st <= FL.REACT || passes > FL.MAXPASS) { late = true; break; }
    starts.push(st);
  }
  return { failed: starts.length > 0 || late, takeovers: starts.length, late: late, fresh: r.fresh, dur: r.dur };
};
/* a lineage of clones; row g: the clone's success on NEV runs, then the generation it collects: attempts, failing attempts, late ones, takeovers, labelled frames, steps of takeover (reaction + driving) */
FL.lineage = function (L, o) {
  o = o || {}; var B = o.B || FL.B, NG = o.NG === undefined ? FL.NG : o.NG, NEV = o.NEV || FL.NEV, D = FL.stock(), X = D.X, Y = D.Y, out = [], seed = 1000000 * (L + 1), n = 0, g;
  for (g = 0; g <= NG; g++) {
    var nw = FL.clone(X, Y), ev = FL.evaluate(nw, NEV, FL.EVSEED), rec = { n: n, s: ev.succ, att: 0, fail: 0, late: 0, take: 0, frames: 0, steps: 0 };
    if (g < NG) {
      var nx = [], ny = [];
      while (rec.fail < B) {
        var a = FL.attempt(nw, ++seed); rec.att++; if (a.failed) rec.fail++; if (a.late) rec.late++;
        rec.take += a.takeovers; rec.frames += a.fresh.length; a.dur.forEach(function (d) { rec.steps += d; });
        a.fresh.forEach(function (f) { nx.push(f[0]); ny.push(f[1]); });
      }
      for (var i = 0; i < nx.length; i++) { X.push(nx[i]); Y.push(ny[i]); }
      n += rec.fail;
    }
    out.push(rec);
  }
  return out;
};

/*TABLE:BEGIN*/
FL.TABLE = {"B":10,"nev":1000,"lin":[
[{"n":0,"s":0.635,"att":19,"fail":10,"late":1,"take":10,"frames":280,"steps":350},{"n":10,"s":0.749,"att":58,"fail":10,"late":0,"take":11,"frames":278,"steps":355},{"n":20,"s":0.825,"att":64,"fail":10,"late":1,"take":12,"frames":286,"steps":370},{"n":30,"s":0.898,"att":86,"fail":10,"late":1,"take":11,"frames":275,"steps":352},{"n":40,"s":0.95,"att":196,"fail":10,"late":2,"take":10,"frames":233,"steps":303},{"n":50,"s":0.958,"att":235,"fail":10,"late":1,"take":11,"frames":247,"steps":324},{"n":60,"s":0.957,"att":298,"fail":10,"late":1,"take":10,"frames":249,"steps":319},{"n":70,"s":0.971,"att":292,"fail":10,"late":1,"take":10,"frames":257,"steps":327},{"n":80,"s":0.974,"att":671,"fail":10,"late":3,"take":11,"frames":229,"steps":306},{"n":90,"s":0.986,"att":573,"fail":10,"late":5,"take":9,"frames":150,"steps":213},{"n":100,"s":0.982,"att":574,"fail":10,"late":3,"take":11,"frames":253,"steps":330},{"n":110,"s":0.982,"att":285,"fail":10,"late":2,"take":10,"frames":211,"steps":281},{"n":120,"s":0.98,"att":822,"fail":10,"late":4,"take":10,"frames":207,"steps":277},{"n":130,"s":0.982,"att":444,"fail":10,"late":3,"take":10,"frames":207,"steps":277},{"n":140,"s":0.99,"att":584,"fail":10,"late":7,"take":10,"frames":118,"steps":188},{"n":150,"s":0.99,"att":724,"fail":10,"late":5,"take":10,"frames":186,"steps":256},{"n":160,"s":0.989,"att":649,"fail":10,"late":6,"take":10,"frames":149,"steps":219},{"n":170,"s":0.991,"att":2090,"fail":10,"late":4,"take":10,"frames":176,"steps":246},{"n":180,"s":0.992,"att":1307,"fail":10,"late":7,"take":9,"frames":125,"steps":188},{"n":190,"s":0.996,"att":1053,"fail":10,"late":3,"take":10,"frames":224,"steps":294},{"n":200,"s":0.989,"att":1912,"fail":10,"late":4,"take":9,"frames":179,"steps":242},{"n":210,"s":0.994,"att":1952,"fail":10,"late":5,"take":9,"frames":193,"steps":256},{"n":220,"s":0.992,"att":1374,"fail":10,"late":5,"take":10,"frames":158,"steps":228},{"n":230,"s":0.996,"att":2754,"fail":10,"late":7,"take":10,"frames":105,"steps":175},{"n":240,"s":0.994,"att":2256,"fail":10,"late":7,"take":10,"frames":137,"steps":207},{"n":250,"s":0.997,"att":2139,"fail":10,"late":7,"take":10,"frames":123,"steps":193},{"n":260,"s":0.997,"att":1987,"fail":10,"late":5,"take":11,"frames":179,"steps":256},{"n":270,"s":0.997,"att":1901,"fail":10,"late":5,"take":10,"frames":184,"steps":254},{"n":280,"s":0.995,"att":3175,"fail":10,"late":5,"take":10,"frames":185,"steps":255},{"n":290,"s":0.996,"att":2402,"fail":10,"late":7,"take":10,"frames":133,"steps":203},{"n":300,"s":0.995,"att":3742,"fail":10,"late":7,"take":10,"frames":118,"steps":188},{"n":310,"s":0.996,"att":1468,"fail":10,"late":5,"take":10,"frames":161,"steps":231},{"n":320,"s":0.995,"att":2423,"fail":10,"late":6,"take":10,"frames":173,"steps":243},{"n":330,"s":0.996,"att":2715,"fail":10,"late":6,"take":10,"frames":153,"steps":223},{"n":340,"s":0.997,"att":2715,"fail":10,"late":6,"take":10,"frames":141,"steps":211},{"n":350,"s":0.996,"att":3470,"fail":10,"late":7,"take":10,"frames":147,"steps":217},{"n":360,"s":0.996,"att":2759,"fail":10,"late":8,"take":10,"frames":130,"steps":200},{"n":370,"s":0.997,"att":2331,"fail":10,"late":8,"take":10,"frames":135,"steps":205},{"n":380,"s":0.998,"att":2589,"fail":10,"late":4,"take":10,"frames":218,"steps":288},{"n":390,"s":0.994,"att":1713,"fail":10,"late":6,"take":10,"frames":174,"steps":244},{"n":400,"s":0.998,"att":0,"fail":0,"late":0,"take":0,"frames":0,"steps":0}],
[{"n":0,"s":0.635,"att":28,"fail":10,"late":0,"take":11,"frames":274,"steps":351},{"n":10,"s":0.786,"att":49,"fail":10,"late":0,"take":10,"frames":248,"steps":318},{"n":20,"s":0.825,"att":58,"fail":10,"late":2,"take":10,"frames":208,"steps":278},{"n":30,"s":0.871,"att":88,"fail":10,"late":1,"take":10,"frames":309,"steps":379},{"n":40,"s":0.933,"att":182,"fail":10,"late":2,"take":10,"frames":211,"steps":281},{"n":50,"s":0.947,"att":312,"fail":10,"late":0,"take":10,"frames":260,"steps":330},{"n":60,"s":0.965,"att":159,"fail":10,"late":2,"take":10,"frames":236,"steps":306},{"n":70,"s":0.968,"att":348,"fail":10,"late":2,"take":11,"frames":244,"steps":321},{"n":80,"s":0.978,"att":643,"fail":10,"late":3,"take":10,"frames":227,"steps":297},{"n":90,"s":0.988,"att":956,"fail":10,"late":5,"take":10,"frames":159,"steps":229},{"n":100,"s":0.986,"att":828,"fail":10,"late":4,"take":11,"frames":202,"steps":279},{"n":110,"s":0.987,"att":702,"fail":10,"late":3,"take":10,"frames":198,"steps":268},{"n":120,"s":0.995,"att":958,"fail":10,"late":5,"take":10,"frames":157,"steps":227},{"n":130,"s":0.988,"att":774,"fail":10,"late":1,"take":10,"frames":217,"steps":287},{"n":140,"s":0.991,"att":1729,"fail":10,"late":5,"take":10,"frames":151,"steps":221},{"n":150,"s":0.992,"att":1030,"fail":10,"late":4,"take":10,"frames":183,"steps":253},{"n":160,"s":0.993,"att":1653,"fail":10,"late":4,"take":10,"frames":180,"steps":250},{"n":170,"s":0.991,"att":2343,"fail":10,"late":6,"take":10,"frames":143,"steps":213},{"n":180,"s":0.991,"att":1687,"fail":10,"late":2,"take":10,"frames":263,"steps":333},{"n":190,"s":0.995,"att":1579,"fail":10,"late":4,"take":9,"frames":186,"steps":249},{"n":200,"s":0.995,"att":1971,"fail":10,"late":4,"take":10,"frames":206,"steps":276},{"n":210,"s":0.995,"att":2999,"fail":10,"late":8,"take":10,"frames":98,"steps":168},{"n":220,"s":0.99,"att":2681,"fail":10,"late":4,"take":10,"frames":189,"steps":259},{"n":230,"s":0.997,"att":1846,"fail":10,"late":3,"take":10,"frames":220,"steps":290},{"n":240,"s":0.996,"att":1711,"fail":10,"late":7,"take":10,"frames":140,"steps":210},{"n":250,"s":0.995,"att":1657,"fail":10,"late":7,"take":10,"frames":125,"steps":195},{"n":260,"s":0.994,"att":3132,"fail":10,"late":6,"take":10,"frames":170,"steps":240},{"n":270,"s":0.998,"att":2060,"fail":10,"late":5,"take":10,"frames":135,"steps":205},{"n":280,"s":0.993,"att":1653,"fail":10,"late":6,"take":10,"frames":144,"steps":214},{"n":290,"s":0.997,"att":4894,"fail":10,"late":4,"take":10,"frames":173,"steps":243},{"n":300,"s":0.995,"att":2809,"fail":10,"late":6,"take":10,"frames":142,"steps":212},{"n":310,"s":0.996,"att":2565,"fail":10,"late":8,"take":10,"frames":99,"steps":169},{"n":320,"s":0.996,"att":2697,"fail":10,"late":8,"take":10,"frames":77,"steps":147},{"n":330,"s":0.996,"att":3716,"fail":10,"late":7,"take":10,"frames":152,"steps":222},{"n":340,"s":0.996,"att":4216,"fail":10,"late":8,"take":10,"frames":84,"steps":154},{"n":350,"s":0.997,"att":2449,"fail":10,"late":5,"take":10,"frames":180,"steps":250},{"n":360,"s":0.997,"att":3573,"fail":10,"late":6,"take":10,"frames":149,"steps":219},{"n":370,"s":0.993,"att":1386,"fail":10,"late":6,"take":10,"frames":150,"steps":220},{"n":380,"s":0.997,"att":3836,"fail":10,"late":7,"take":10,"frames":113,"steps":183},{"n":390,"s":0.998,"att":3529,"fail":10,"late":9,"take":9,"frames":74,"steps":137},{"n":400,"s":0.997,"att":0,"fail":0,"late":0,"take":0,"frames":0,"steps":0}],
[{"n":0,"s":0.635,"att":18,"fail":10,"late":1,"take":10,"frames":208,"steps":278},{"n":10,"s":0.729,"att":28,"fail":10,"late":2,"take":12,"frames":278,"steps":362},{"n":20,"s":0.858,"att":47,"fail":10,"late":1,"take":11,"frames":253,"steps":330},{"n":30,"s":0.886,"att":91,"fail":10,"late":0,"take":10,"frames":237,"steps":307},{"n":40,"s":0.943,"att":194,"fail":10,"late":3,"take":10,"frames":175,"steps":245},{"n":50,"s":0.936,"att":136,"fail":10,"late":0,"take":10,"frames":234,"steps":304},{"n":60,"s":0.964,"att":347,"fail":10,"late":2,"take":10,"frames":231,"steps":301},{"n":70,"s":0.974,"att":308,"fail":10,"late":2,"take":10,"frames":258,"steps":328},{"n":80,"s":0.974,"att":413,"fail":10,"late":3,"take":9,"frames":193,"steps":256},{"n":90,"s":0.979,"att":754,"fail":10,"late":3,"take":9,"frames":219,"steps":282},{"n":100,"s":0.989,"att":519,"fail":10,"late":2,"take":10,"frames":215,"steps":285},{"n":110,"s":0.985,"att":987,"fail":10,"late":3,"take":9,"frames":194,"steps":257},{"n":120,"s":0.988,"att":835,"fail":10,"late":2,"take":10,"frames":274,"steps":344},{"n":130,"s":0.989,"att":633,"fail":10,"late":6,"take":9,"frames":130,"steps":193},{"n":140,"s":0.985,"att":891,"fail":10,"late":5,"take":9,"frames":183,"steps":246},{"n":150,"s":0.988,"att":1311,"fail":10,"late":6,"take":10,"frames":147,"steps":217},{"n":160,"s":0.989,"att":1325,"fail":10,"late":4,"take":9,"frames":159,"steps":222},{"n":170,"s":0.991,"att":1747,"fail":10,"late":5,"take":10,"frames":163,"steps":233},{"n":180,"s":0.994,"att":2138,"fail":10,"late":6,"take":10,"frames":133,"steps":203},{"n":190,"s":0.994,"att":1197,"fail":10,"late":5,"take":10,"frames":196,"steps":266},{"n":200,"s":0.994,"att":1506,"fail":10,"late":3,"take":10,"frames":194,"steps":264},{"n":210,"s":0.994,"att":3014,"fail":10,"late":6,"take":10,"frames":148,"steps":218},{"n":220,"s":0.996,"att":2849,"fail":10,"late":4,"take":10,"frames":191,"steps":261},{"n":230,"s":0.994,"att":2493,"fail":10,"late":5,"take":10,"frames":162,"steps":232},{"n":240,"s":0.996,"att":2206,"fail":10,"late":8,"take":10,"frames":96,"steps":166},{"n":250,"s":0.996,"att":3728,"fail":10,"late":7,"take":10,"frames":137,"steps":207},{"n":260,"s":0.996,"att":1963,"fail":10,"late":5,"take":10,"frames":174,"steps":244},{"n":270,"s":0.996,"att":2934,"fail":10,"late":7,"take":10,"frames":137,"steps":207},{"n":280,"s":0.993,"att":3095,"fail":10,"late":5,"take":10,"frames":183,"steps":253},{"n":290,"s":0.993,"att":1654,"fail":10,"late":7,"take":10,"frames":132,"steps":202},{"n":300,"s":0.995,"att":1915,"fail":10,"late":10,"take":9,"frames":68,"steps":131},{"n":310,"s":0.995,"att":2843,"fail":10,"late":7,"take":10,"frames":107,"steps":177},{"n":320,"s":0.998,"att":2231,"fail":10,"late":8,"take":10,"frames":95,"steps":165},{"n":330,"s":0.998,"att":2254,"fail":10,"late":6,"take":10,"frames":142,"steps":212},{"n":340,"s":0.997,"att":2269,"fail":10,"late":8,"take":10,"frames":88,"steps":158},{"n":350,"s":0.993,"att":2936,"fail":10,"late":8,"take":10,"frames":87,"steps":157},{"n":360,"s":0.993,"att":4340,"fail":10,"late":6,"take":9,"frames":143,"steps":206},{"n":370,"s":0.994,"att":3097,"fail":10,"late":9,"take":10,"frames":78,"steps":148},{"n":380,"s":0.994,"att":4413,"fail":10,"late":4,"take":10,"frames":234,"steps":304},{"n":390,"s":0.996,"att":3234,"fail":10,"late":7,"take":9,"frames":105,"steps":168},{"n":400,"s":0.996,"att":0,"fail":0,"late":0,"take":0,"frames":0,"steps":0}],
[{"n":0,"s":0.635,"att":17,"fail":10,"late":0,"take":10,"frames":248,"steps":318},{"n":10,"s":0.715,"att":38,"fail":10,"late":1,"take":10,"frames":253,"steps":323},{"n":20,"s":0.816,"att":67,"fail":10,"late":1,"take":9,"frames":205,"steps":268},{"n":30,"s":0.88,"att":77,"fail":10,"late":1,"take":10,"frames":267,"steps":337},{"n":40,"s":0.908,"att":78,"fail":10,"late":1,"take":10,"frames":238,"steps":308},{"n":50,"s":0.941,"att":122,"fail":10,"late":0,"take":10,"frames":269,"steps":339},{"n":60,"s":0.963,"att":202,"fail":10,"late":6,"take":10,"frames":116,"steps":186},{"n":70,"s":0.953,"att":283,"fail":10,"late":3,"take":10,"frames":185,"steps":255},{"n":80,"s":0.975,"att":338,"fail":10,"late":1,"take":10,"frames":228,"steps":298},{"n":90,"s":0.978,"att":339,"fail":10,"late":3,"take":10,"frames":230,"steps":300},{"n":100,"s":0.981,"att":521,"fail":10,"late":4,"take":10,"frames":205,"steps":275},{"n":110,"s":0.988,"att":1269,"fail":10,"late":4,"take":10,"frames":162,"steps":232},{"n":120,"s":0.987,"att":767,"fail":10,"late":1,"take":10,"frames":228,"steps":298},{"n":130,"s":0.987,"att":845,"fail":10,"late":3,"take":10,"frames":261,"steps":331},{"n":140,"s":0.99,"att":783,"fail":10,"late":3,"take":11,"frames":229,"steps":306},{"n":150,"s":0.988,"att":788,"fail":10,"late":3,"take":10,"frames":217,"steps":287},{"n":160,"s":0.992,"att":1291,"fail":10,"late":5,"take":10,"frames":169,"steps":239},{"n":170,"s":0.991,"att":1784,"fail":10,"late":5,"take":10,"frames":176,"steps":246},{"n":180,"s":0.992,"att":2149,"fail":10,"late":5,"take":11,"frames":208,"steps":285},{"n":190,"s":0.993,"att":1225,"fail":10,"late":7,"take":9,"frames":139,"steps":202},{"n":200,"s":0.993,"att":1898,"fail":10,"late":5,"take":9,"frames":157,"steps":220},{"n":210,"s":0.994,"att":1196,"fail":10,"late":5,"take":10,"frames":185,"steps":255},{"n":220,"s":0.992,"att":1692,"fail":10,"late":5,"take":10,"frames":170,"steps":240},{"n":230,"s":0.989,"att":2522,"fail":10,"late":5,"take":10,"frames":154,"steps":224},{"n":240,"s":0.994,"att":2728,"fail":10,"late":9,"take":10,"frames":81,"steps":151},{"n":250,"s":0.99,"att":1816,"fail":10,"late":5,"take":11,"frames":192,"steps":269},{"n":260,"s":0.997,"att":1836,"fail":10,"late":6,"take":10,"frames":159,"steps":229},{"n":270,"s":0.994,"att":1976,"fail":10,"late":7,"take":9,"frames":139,"steps":202},{"n":280,"s":0.994,"att":3317,"fail":10,"late":5,"take":10,"frames":179,"steps":249},{"n":290,"s":0.997,"att":1785,"fail":10,"late":6,"take":10,"frames":157,"steps":227},{"n":300,"s":0.996,"att":3179,"fail":10,"late":7,"take":10,"frames":140,"steps":210},{"n":310,"s":0.996,"att":1752,"fail":10,"late":8,"take":10,"frames":110,"steps":180},{"n":320,"s":0.994,"att":983,"fail":10,"late":8,"take":10,"frames":106,"steps":176},{"n":330,"s":0.994,"att":2593,"fail":10,"late":3,"take":10,"frames":242,"steps":312},{"n":340,"s":0.993,"att":2671,"fail":10,"late":7,"take":10,"frames":119,"steps":189},{"n":350,"s":0.994,"att":2075,"fail":10,"late":6,"take":10,"frames":152,"steps":222},{"n":360,"s":0.994,"att":3623,"fail":10,"late":8,"take":9,"frames":113,"steps":176},{"n":370,"s":0.995,"att":4333,"fail":10,"late":9,"take":10,"frames":78,"steps":148},{"n":380,"s":0.994,"att":2043,"fail":10,"late":7,"take":10,"frames":126,"steps":196},{"n":390,"s":0.996,"att":4241,"fail":10,"late":7,"take":10,"frames":134,"steps":204},{"n":400,"s":0.996,"att":0,"fail":0,"late":0,"take":0,"frames":0,"steps":0}]]};
/*TABLE:END*/

/* ───────────── the learning curve: the failure share of the policy against the failing attempts supervised, pooled over the four lineages (the table's own points, read by interpolation) ───────────── */
FL.pooled = function () {
  var T = FL.TABLE, G = T.lin[0].length, n = [], p = [], i, g;
  for (g = 0; g < G; g++) { var m = 0; for (i = 0; i < T.lin.length; i++) m += T.lin[i][g].s; n.push(T.lin[0][g].n); p.push(1 - m / T.lin.length); }
  return { n: n, p: p };
};
FL.P = FL.TABLE ? FL.pooled() : null;
FL.p = function (n) {                                                                     // geometric interpolation between the grid points n = 0, 10, 20, ... 400
  var P = FL.P, i = Math.max(0, Math.min(P.p.length - 2, Math.floor(n / FL.B))), f = Math.max(0, Math.min(1, (n - i * FL.B) / FL.B));
  return P.p[i] * Math.pow(P.p[i + 1] / P.p[i], f);
};
FL.nOf = function (p) {                                                                   // the n at which the policy fails a share p of its attempts (0 when p is the first clone's or worse)
  var P = FL.P, i;
  for (i = 0; i < P.p.length - 1; i++) if (P.p[i + 1] <= p) return i * FL.B + FL.B * Math.log(Math.min(1, p / P.p[i])) / Math.log(P.p[i + 1] / P.p[i]);
  return Infinity;
};

/* ───────────── the ledger line of one attempt ───────────── */
FL.econ = function (tau, a) {
  a = a || LG.assume;
  var T = LG.UNIT.secPerDemo, per = 3600 / T, v = a.wage_per_h * T / 3600, r = a.arm_cost / a.arm_life_h / per, c = a.wage_per_h * tau / (3600 * a.sup_duty);
  var pStar = Math.min(1, (v - r) / c);
  return { perHour: per, v: v, r: r, c: c, tau: tau, duty: a.sup_duty, pStar: pStar, sStar: 1 - pStar };
};
FL.net = function (E, p) { return E.v - E.r - p * E.c; };                                 // dollars per attempt of a policy that fails a share p of them
FL.crew = function (E, p) { return p * E.perHour * E.tau / (3600 * E.duty); };            // supervisors per robot: failures an hour x seconds each / (3600 x utilisation)

/* ───────────── the fleet over generations ───────────── */
FL.sim = function (o) {
  var E = FL.econ(o.tau, o.assume), per = E.perHour * FL.HOURS * o.F, n = FL.nOf(1 - o.s0), days = 0, cash = 0, rows = [], g = 0, take = null;
  while (n <= FL.NMAX) {
    var p = FL.p(n), att = o.K * FL.B / p, net = att * (E.v - E.r) - o.K * FL.B * E.c;
    rows.push({ n: n, p: p, att: att, d0: days, c0: cash, d1: days + att / per, c1: cash + net, net: net });
    if (take === null && net > 0) take = g;
    days += att / per; cash += net; n += FL.B; g++;
  }
  return { E: E, rows: rows, take: take, deficit: Math.max(0, take === null ? -cash : -rows[take].c0), perDay: per };
};
FL.NMAX = 400;                                                                            // the lineages end at n = 400 failing attempts: the curve is not extended beyond

/* days and cash when the policy first reaches success s (after the generation that gets it there) */
FL.reach = function (S, s) {
  for (var g = 0; g < S.rows.length; g++) { var nx = S.rows[g].n + FL.B; if (1 - FL.p(nx) >= s) return { g: g, days: S.rows[g].d1, cash: S.rows[g].c1 }; }
  return null;
};

root.FL = FL;
if (typeof module !== 'undefined' && module.exports) module.exports = FL;
})(typeof window !== 'undefined' ? window : globalThis);
