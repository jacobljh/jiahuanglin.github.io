/* price_lab.js — lesson 2's private engine: what an hour of each source costs, and what a useful hour costs.
 *
 * It reads the assumptions of ledger.js (LG.assume, or a copy of it that the reader has moved) and the exchange rates of its table, and builds the layouts ledger:
 *   price p   dollars per motion hour.  The own robot's hour is a KEPT hour (lesson 1's own curve counts kept demonstrations, and the Bench's scripted expert never fails, so the
 *             operator's slips are an assumption and sit in the price).  Every other source is priced per ATTEMPTED hour, because its exchange rate is measured per attempted hour:
 *             the Bench measures what its discards cost (footage keeps 41 of 64 attempts) and the rate already contains it, so a discard is paid for once.
 *   rate rho  own hours replaced per attempted hour of the source at the operating point (own layouts, attempted layouts): the table of ledger.js.
 *   cost c    p / rho, dollars per useful (own-equivalent) hour; infinite when rho <= 0: the source sells no useful hour at any price.
 * Two rankings follow: by p (the invoice) and by c (what it buys).  PL.flips finds, for every assumption, the factor that would reverse a pair of the second ranking.
 * PL.readouts turns one state of the widget (assumptions, operating point, simulator gap) into the twelve strings it prints; PL.draw paints the two rankings and the two columns.
 * Deterministic and instant: it is arithmetic on a table.
 */
(function (root) {
'use strict';
var LG = root.LG || require('./ledger.js');
var BN = root.BN || (typeof require === 'function' ? require('./bench.js') : null);
var PL = {};

PL.SIMS = ['sim0.001', 'sim0.003', 'sim0.01', 'sim0.03', 'simH0.03'];
PL.NAMES = { own: 'own robot', twin: 'twin arm', old: 'older arm', video: 'footage', sim: 'simulator' };
PL.SHORT = { 'sim0.001': 'sim, gap 0.1 %', 'sim0.003': 'sim, gap 0.3 %', 'sim0.01': 'sim, gap 1 %', 'sim0.03': 'sim, gap 3 %', 'simH0.03': 'sim, 3 % hand' };
PL.SPACE = { twin: 'hand', old: 'hand', video: 'hand', 'sim0.001': 'joint', 'sim0.003': 'joint', 'sim0.01': 'joint', 'sim0.03': 'joint', 'simH0.03': 'hand' };

/* dollars per motion hour of one source; key: own, twin, old, video, sim, corr, force, force0 (the force task without the rig) */
PL.price = function (key, a) {
  var arm = a.arm_cost / a.arm_life_h, own = (a.wage_per_h + arm) / (a.duty * (1 - a.discard));
  switch (key) {
    case 'own': return own;
    case 'twin': case 'old': return a.curate_per_h;
    case 'video': return (a.video_wage_per_h + a.track_per_h) / a.video_duty;
    case 'sim': return a.gpu_per_h / a.sim_speed + a.scene_weeks * a.week_cost / a.scene_uses_h + a.calib_h * own / a.scene_uses_h;
    case 'corr': return (a.wage_per_h + arm) / a.sup_duty;
    case 'force': return (a.wage_per_h + arm + a.force_rig_cost / a.arm_life_h) / (a.force_duty * (1 - a.discard));
    case 'force0': return (a.wage_per_h + arm) / (a.force_duty * (1 - a.discard));
  }
  return NaN;
};

/* the exchange rate of a source at (base own layouts, m attempted layouts): the table of ledger.js; the own robot is the unit */
PL.index = function (m) { return LG.TABLE.layouts.M.indexOf(m); };
PL.rate = function (key, base, m) { return key === 'own' ? 1 : LG.rate(key, base, PL.index(m)); };
/* the same rate with the 95 % interval of the success pushed through the inversion of the own curve (the own curve's own noise is not included) */
PL.rateCI = function (key, base, m) {
  if (key === 'own') return [1, 1];
  var o = LG.TABLE.layouts.src[key], c = LG.ownCurve(PL.SPACE[key]), i = PL.index(m);
  return [(LG.ownEquivalent(c, o.lo[base][i]) - base) / m, (LG.ownEquivalent(c, o.hi[base][i]) - base) / m];
};
PL.cost = function (p, rho) { return rho > 0 ? p / rho : Infinity; };

/* the layouts ledger: five sources, the simulator at the chosen gap.  Each row has its price, rate, cost per useful hour and the interval of that cost */
PL.ledger = function (a, base, m, sim) {
  var rows = ['own', 'twin', 'old', 'video', sim].map(function (k) {
    var g = k === sim ? 'sim' : k, p = PL.price(g, a), rho = PL.rate(k, base, m), ci = PL.rateCI(k, base, m);
    return { key: g, src: k, name: g === 'sim' ? PL.SHORT[k] : PL.NAMES[g], p: p, rho: rho, c: PL.cost(p, rho), clo: PL.cost(p, ci[1]), chi: PL.cost(p, ci[0]), none: !(rho > 0) };
  });
  return { rows: rows, byPrice: rows.slice().sort(function (x, y) { return x.p - y.p; }), byCost: rows.slice().sort(function (x, y) { return x.c - y.c; }) };
};
PL.get = function (L, key) { return L.rows.filter(function (r) { return r.key === key; })[0]; };

/* the duty cycle at which the own hour costs what a useful hour of footage costs: below it footage is the cheaper way to buy an own hour */
PL.breakEvenDuty = function (a, base, m) {
  return (a.wage_per_h + a.arm_cost / a.arm_life_h) / (1 - a.discard) / PL.get(PL.ledger(a, base, m, 'sim0.01'), 'video').c;
};

/* the cost ranking over the sources that sell a useful hour, for assumptions a and fixed rates rho = [own, twin, old, video, sim] */
PL.rank = function (a, rho) {
  var keys = ['own', 'twin', 'old', 'video', 'sim'];
  return keys.map(function (k, i) { return { k: k, c: PL.cost(PL.price(k, a), rho[i]) }; }).filter(function (r) { return isFinite(r.c); })
    .sort(function (x, y) { return x.c - y.c; }).map(function (r) { return r.k; }).join(' < ');
};
/* for each assumption, the smallest factor, up or down, that changes the cost ranking; shares such as duty cannot pass 1 */
PL.LIMIT = { duty: 1, discard: 0.99, video_duty: 1, force_duty: 1, sup_duty: 1 };
PL.flips = function (a, base, m, sim) {
  var rho = ['own', 'twin', 'old', 'video', sim].map(function (k) { return PL.rate(k, base, m); }), ref = PL.rank(a, rho), out = [], k, dir, f, t, lo, hi, it, b;
  var moved = function (key, d, g) { t = Object.assign({}, a); t[key] = d > 0 ? a[key] * g : a[key] / g; return t[key] <= (PL.LIMIT[key] || Infinity) && PL.rank(t, rho) !== ref; };
  for (k in a) {
    for (dir = -1; dir <= 1; dir += 2) {
      hi = 0; lo = 1;
      for (it = 1; it <= 150 && !hi; it++) { f = Math.pow(10, 3 * it / 150); if (moved(k, dir, f)) hi = f; else lo = f; }
      if (!hi) continue;
      for (b = 0; b < 40; b++) { f = Math.sqrt(lo * hi); if (moved(k, dir, f)) hi = f; else lo = f; }
      out.push({ key: k, dir: dir, factor: hi, value: dir > 0 ? a[k] * hi : a[k] / hi });
    }
  }
  return out.sort(function (x, y) { return x.factor - y.factor; });
};

/* the text of the twelve readouts of the widget for one state of the assumptions */
PL.FLIPNAME = { duty: 'duty cycle', wage_per_h: 'operator wage', video_wage_per_h: 'footage wage', curate_per_h: 'curation', discard: 'own discards', arm_cost: 'robot cell', arm_life_h: 'cell life',
  scene_weeks: 'authoring weeks', week_cost: 'week cost', scene_uses_h: 'scene uses', gpu_per_h: 'GPU price', sim_speed: 'simulation speed',
  video_duty: 'footage duty cycle', track_per_h: 'tracking compute', calib_h: 'calibration hours' };
PL.readouts = function (a, base, m, sim) {
  var L = PL.ledger(a, base, m, sim), vid = PL.get(L, 'video'), live = L.byCost.filter(function (r) { return !r.none; }), lo = live[0], hi = live[live.length - 1], fl = PL.flips(a, base, m, sim)[0];
  var $ = PL.money, c = function (k) { return $(PL.get(L, k).c); };
  return { L: L, text: {
    pown: $(PL.get(L, 'own').p), pvid: '$' + vid.p.toFixed(2), cvid: $(vid.c), civid: isFinite(vid.chi) ? $(vid.clo) + '–' + $(vid.chi).slice(1) : $(vid.clo) + ' or more',
    cold: c('old'), ctwin: c('twin'), csim: c('sim'), cheap: $(lo.c) + ' · ' + PL.NAMES[lo.key], dear: $(hi.c) + ' · ' + PL.NAMES[hi.key], bed: PL.breakEvenDuty(a, base, m).toFixed(2),
    flip: fl ? (PL.FLIPNAME[fl.key] || fl.key) + (fl.dir > 0 ? ' × ' : ' ÷ ') + fl.factor.toFixed(2) : 'none within 1000×', cdbl: $(LG.price('video', a) / vid.rho) } };
};

/* the two columns that no borrowed hour carries: the cheap hours reach a ceiling, the supplier of the column is one source with its own price */
PL.columns = function (a) {
  var T = LG.TABLE, mx = function (v) { return Math.max.apply(null, v); };
  return [
    { col: 'contact', title: 'a task that needs force', rows: [{ name: 'no force channels', p: PL.price('force0', a), cap: mx(T.contact.noForce.s), lack: true }, { name: 'with force channels', p: PL.price('force', a), cap: mx(T.contact.withForce.s) }] },
    { col: 'recovery', title: 'a task that needs recovery', rows: [{ name: 'calm demonstrations', p: PL.price('own', a), cap: mx(T.recover.calm.s), lack: true }, { name: 'corrections', p: PL.price('corr', a), cap: mx(T.recover.corr.s) }] }
  ];
};

/* ───────────── drawing: two sorted lists joined by one line per source, and the two columns below ───────────── */
PL.COLOR = function (key) { var C = BN.C; return { own: C.ink, twin: C.teal, old: C.cyan, video: C.amber, sim: C.purple }[key] || C.mute; };
PL.money = function (v) { return !isFinite(v) ? 'none' : v < 1 ? '$' + v.toFixed(2) : v < 1000 ? '$' + v.toFixed(1) : '$' + Math.round(v); };
PL.money2 = function (v) { return v < 1000 ? '$' + v.toFixed(2) : '$' + Math.round(v); };
PL.hatch = function (ctx, x, y, w, h, color) {
  var k;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (k = -h; k < w; k += 5) { ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); ctx.stroke(); }
  ctx.restore(); ctx.strokeStyle = color; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
};
PL.draw = function (cv, L, cols) {
  var D = BN.draw, C = BN.C, narrow = (cv.clientWidth || 640) < 600, wantH = narrow ? 510 : 320;
  if (cv.style.height !== wantH + 'px') cv.style.height = wantH + 'px';
  var s = D.setup(cv), ctx = s.ctx, W = s.w, pad = 8, nameW = narrow ? 92 : 104, valW = 54, rh = narrow ? 24 : 32, gap = narrow ? 0 : Math.max(60, Math.round(W * 0.14)), L0 = -1, L1 = 3;
  var pw = narrow ? W - 2 * pad : Math.round((W - 2 * pad - gap) / 2), bw = pw - nameW - valW, ys = {};
  var at = function (v) { return Math.max(0, Math.min(1, (Math.log(v) / Math.LN10 - L0) / (L1 - L0))); };
  function list(x0, y0, title, order, which) {
    var top = y0 + 26;
    D.text(ctx, title, x0, y0 + 6, C.ink, 11, 'left', 700);
    [-1, 0, 1, 2, 3].forEach(function (e) {
      var px = x0 + nameW + (e - L0) / (L1 - L0) * bw;
      D.line(ctx, px, top - 3, px, top + order.length * rh, C.grid, 1); D.mono(ctx, e === 3 ? '$1k' : '$' + Math.pow(10, e), px, top - 10, C.mute, 9, 'center');
    });
    order.forEach(function (r, i) {
      var y = top + i * rh, v = which === 'p' ? r.p : r.c, x1 = x0 + nameW + at(isFinite(v) ? v : 1000) * bw, up = L.byPrice.indexOf(r) - i, mark = which === 'c' && narrow && !r.none && up !== 0 ? (up > 0 ? ' ▲' : ' ▼') : '';
      ys[which + r.src] = y + rh / 2;
      D.text(ctx, r.name + mark, x0, y + rh / 2, C.ink, narrow ? 10 : 11, 'left', 500);
      if (r.none && which === 'c') { PL.hatch(ctx, x0 + nameW, y + 5, bw, rh - 10, C.red); D.mono(ctx, 'none', x0 + nameW + bw + 4, y + rh / 2, C.red, 10, 'left'); }
      else { ctx.fillStyle = PL.COLOR(r.key); ctx.fillRect(x0 + nameW, y + 5, Math.max(1, x1 - x0 - nameW), rh - 10); D.mono(ctx, (which === 'p' ? PL.money2(v) : PL.money(v)) + (v > 1000 ? ' ▸' : ''), x1 + 4, y + rh / 2, C.ink, 10, 'left'); }
    });
    return top + order.length * rh;
  }
  var endA = list(pad, 4, 'ranked by price ($ per motion hour)', L.byPrice, 'p'), endB;
  if (narrow) endB = list(pad, endA + 6, 'ranked by cost per useful hour (price ÷ rate)', L.byCost, 'c');
  else {
    endB = list(pad + pw + gap, 4, 'ranked by cost per useful hour (price ÷ rate)', L.byCost, 'c');
    L.rows.forEach(function (r) {
      var moved = L.byPrice.indexOf(r) !== L.byCost.indexOf(r) || r.none;
      ctx.save(); ctx.globalAlpha = moved ? 0.95 : 0.4; D.line(ctx, pad + pw + 4, ys['p' + r.src], pad + pw + gap - 4, ys['c' + r.src], PL.COLOR(r.key), moved ? 2.4 : 1.4); ctx.restore();
    });
  }
  var y0 = Math.max(endA, endB) + 22, cw = narrow ? W - 2 * pad : Math.round((W - 2 * pad - 24) / 2), lw = narrow ? 120 : 128;
  cols.forEach(function (c, k) {
    var x0 = narrow ? pad : pad + k * (cw + 24), yy = narrow ? y0 + k * (2 * rh + 44) : y0, bx = x0 + lw, bwd = cw - lw - valW;
    D.text(ctx, c.title, x0, yy + 6, C.ink, 11, 'left', 700);
    c.rows.forEach(function (r, i) {
      var y = yy + 20 + i * (rh + 8), x1 = bx + at(r.p) * bwd;
      D.text(ctx, r.name, x0, y + rh / 2 - 7, C.ink, 10, 'left', 500);
      D.mono(ctx, PL.money(r.p) + '/h, best ' + r.cap.toFixed(3), x0, y + rh / 2 + 6, r.lack ? C.red : C.mute, 9, 'left');
      if (r.lack) { PL.hatch(ctx, bx, y + 4, bwd, rh - 8, C.red); D.mono(ctx, 'none', bx + bwd + 4, y + rh / 2, C.red, 10, 'left'); }
      else { ctx.fillStyle = c.col === 'contact' ? C.red : C.green; ctx.fillRect(bx, y + 4, Math.max(1, x1 - bx), rh - 8); D.mono(ctx, PL.money(r.p), x1 + 4, y + rh / 2, C.ink, 10, 'left'); }
    });
  });
};
root.PL = PL;
if (typeof module !== 'undefined' && module.exports) module.exports = PL;
})(typeof window !== 'undefined' ? window : globalThis);
