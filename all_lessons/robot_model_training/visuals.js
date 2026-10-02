/* ============================================================================
   Widget engine. One renderer per lesson, keyed by canvas[data-demo="KEY"].
   Wiring contract (shared by the three training tracks):
     controls   <input type=range data-role="X" data-suffix="%">  |  <select data-role="X">
     echoes     <span class="val" data-value="X">
     readouts   <div class="v" data-metric="Y">
     buttons    <button data-set-role="X" data-set-value="v">
   Every renderer must set EVERY data-metric in its widget. Deterministic only:
   no Math.random, no Date — use lcg().
   ========================================================================== */
(function () {
  'use strict';

  var R = {};

  /* ---- wiring ------------------------------------------------------------ */
  function ownerWidget(el) {
    var n = el;
    while (n && n.parentNode) {
      n = n.parentNode;
      var c = n.className;
      if (typeof c === 'string' && c.indexOf('widget') >= 0) return n;
    }
    return el.parentNode;
  }
  function value(w, role, fb) {
    var el = w.querySelector('[data-role="' + role + '"]');
    if (!el) return fb;
    if (el.tagName === 'SELECT') return el.value;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : fb;
  }
  function syncValues(w) {
    var ins = w.querySelectorAll('input[data-role]');
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], role = el.getAttribute('data-role');
      var out = w.querySelector('.val[data-value="' + role + '"]');
      if (out) out.textContent = el.value + (el.getAttribute('data-suffix') || '');
    }
  }
  function metric(w, name, txt) {
    var el = w.querySelector('[data-metric="' + name + '"]');
    if (el) el.textContent = txt;
  }
  function css(cv, name, fb) {
    try {
      var v = getComputedStyle(cv).getPropertyValue(name);
      v = v && v.trim ? v.trim() : v;
      return v ? v : fb;
    } catch (e) { return fb; }
  }
  function pal(cv) {
    return {
      accent: css(cv, '--accent', '#5b3fd6'),
      cyan:   css(cv, '--cyan', '#0891b2'),
      amber:  css(cv, '--amber', '#d97706'),
      green:  css(cv, '--green', '#15935a'),
      red:    css(cv, '--red', '#dc3f55'),
      text:   css(cv, '--text', '#20202a'),
      mute:   css(cv, '--text-mute', '#626273'),
      dim:    css(cv, '--text-dim', '#9a98aa'),
      soft:   css(cv, '--accent-soft', '#ece8ff'),
      border: css(cv, '--border', '#deddea')
    };
  }

  /* ---- canvas ------------------------------------------------------------ */
  function fit(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 820, h = cv.clientHeight || 250;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    return { ctx: ctx, w: w, h: h };
  }
  function lcg(seed) {
    var s = seed | 0 || 1;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  /* ---- tiny plot helpers ------------------------------------------------- */
  /* frame: returns a mapper for a plot box with axes drawn. */
  function frame(ctx, w, h, p, o) {
    o = o || {};
    var L = o.left == null ? 46 : o.left, Rr = o.right == null ? 14 : o.right;
    var T = o.top == null ? 16 : o.top, B = o.bottom == null ? 30 : o.bottom;
    var x0 = L, x1 = w - Rr, y0 = h - B, y1 = T;
    ctx.strokeStyle = p.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    var xmin = o.xmin || 0, xmax = o.xmax == null ? 1 : o.xmax;
    var ymin = o.ymin || 0, ymax = o.ymax == null ? 1 : o.ymax;
    function X(v) { return x0 + (v - xmin) / (xmax - xmin || 1) * (x1 - x0); }
    function Y(v) { return y0 - (v - ymin) / (ymax - ymin || 1) * (y0 - y1); }
    if (o.xlabel) { ctx.fillStyle = p.mute; ctx.textAlign = 'center'; ctx.fillText(o.xlabel, (x0 + x1) / 2, h - 9); }
    if (o.ylabel) {
      ctx.save(); ctx.translate(11, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = p.mute; ctx.textAlign = 'center'; ctx.fillText(o.ylabel, 0, 0); ctx.restore();
    }
    return { X: X, Y: Y, x0: x0, x1: x1, y0: y0, y1: y1, xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax };
  }
  function grid(ctx, f, p, nx, ny) {
    ctx.strokeStyle = p.border; ctx.globalAlpha = .45; ctx.lineWidth = 1;
    var i;
    for (i = 1; i <= (ny || 4); i++) {
      var y = f.y0 + (f.y1 - f.y0) * i / (ny || 4);
      ctx.beginPath(); ctx.moveTo(f.x0, y); ctx.lineTo(f.x1, y); ctx.stroke();
    }
    for (i = 1; i <= (nx || 0); i++) {
      var x = f.x0 + (f.x1 - f.x0) * i / nx;
      ctx.beginPath(); ctx.moveTo(x, f.y1); ctx.lineTo(x, f.y0); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function line(ctx, f, pts, color, width, dash) {
    if (!pts.length) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width || 2;
    if (dash && ctx.setLineDash) ctx.setLineDash(dash);
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = f.X(pts[i][0]), y = f.Y(pts[i][1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  function area(ctx, f, pts, color, alpha) {
    if (!pts.length) return;
    ctx.save(); ctx.globalAlpha = alpha == null ? .16 : alpha; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(f.X(pts[0][0]), f.Y(0));
    for (var i = 0; i < pts.length; i++) ctx.lineTo(f.X(pts[i][0]), f.Y(pts[i][1]));
    ctx.lineTo(f.X(pts[pts.length - 1][0]), f.Y(0)); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function bars(ctx, f, vals, colors, labels, p, fmt) {
    var n = vals.length, gapf = .26;
    var bw = (f.x1 - f.x0) / n;
    for (var i = 0; i < n; i++) {
      var cx = f.x0 + bw * (i + .5), wd = bw * (1 - gapf);
      var y = f.Y(vals[i]);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(cx - wd / 2, Math.min(y, f.y0), wd, Math.abs(f.y0 - y));
      ctx.fillStyle = p.text; ctx.textAlign = 'center';
      ctx.fillText(fmt ? fmt(vals[i]) : String(vals[i]), cx, Math.min(y, f.y0) - 9);
      if (labels && labels[i]) { ctx.fillStyle = p.mute; ctx.fillText(labels[i], cx, f.y0 + 13); }
    }
  }
  function tick(ctx, f, p, side, v, txt) {
    ctx.fillStyle = p.mute;
    if (side === 'y') { ctx.textAlign = 'right'; ctx.fillText(txt, f.x0 - 6, f.Y(v)); }
    else { ctx.textAlign = 'center'; ctx.fillText(txt, f.X(v), f.y0 + 13); }
  }
  function badge(ctx, x, y, txt, color, p) {
    ctx.save(); ctx.font = '10px ' + '-apple-system, sans-serif';
    var w = ctx.measureText ? (ctx.measureText(txt).width || txt.length * 5.4) : txt.length * 5.4;
    ctx.fillStyle = color; ctx.globalAlpha = .14; ctx.fillRect(x, y - 8, w + 12, 16);
    ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(txt, x + 6, y); ctx.restore();
  }

  var H = { value: value, metric: metric, pal: pal, fit: fit, lcg: lcg, frame: frame,
            grid: grid, line: line, area: area, bars: bars, tick: tick, badge: badge };


  /* ======================= RENDERERS ======================= */

  /* 00 · the asymmetry: a policy authors its own test set */
  R['seat'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var eps = H.value(w, 'eps', 3) / 100, T = H.value(w, 'horizon', 200);
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 0, xmax: T, ymin: 0, ymax: 1,
      xlabel: 'step t', ylabel: 'P(still on the data manifold)' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], B = [], t, area = 0;
    for (t = 0; t <= T; t++) {
      var pr = Math.pow(1 - eps, t);
      A.push([t, pr]); B.push([t, 1]); area += pr;
    }
    H.area(ctx, f, A, p.accent, .14);
    H.line(ctx, f, A, p.accent, 2.4);
    H.line(ctx, f, B, p.cyan, 2, [5, 4]);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'cyan: a supervised learner   violet: a policy', p.mute, p);
    var onFrac = area / (T + 1), off = 1 - onFrac;
    var half = Math.log(0.5) / Math.log(1 - eps);
    H.metric(w, 'end', Math.pow(1 - eps, T).toFixed(4));
    H.metric(w, 'off', (100 * off).toFixed(1) + '%');
    H.metric(w, 'half', half.toFixed(0) + ' steps');
    H.metric(w, 'verdict', off > 0.75 ? 'most of the episode is off-distribution'
             : off > 0.3 ? 'the tail of the episode is untrained territory' : 'stays near the demos');
  };

  /* 01 · action discretisation: a resolution floor, like the blur floor */
  R['aspace'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var range = H.value(w, 'range', 100);      /* ± mm of the delta-pose action */
    var logB = H.value(w, 'bins', 8);          /* bits of discretisation */
    var clear = H.value(w, 'clear', 2);        /* mm clearance */
    var fctl = H.value(w, 'rate', 50);
    var B = Math.pow(2, logB);
    var res = 2 * range / B;
    var f = H.frame(ctx, g.w, g.h, p, { left: 54, xmin: 4, xmax: 14, ymin: -1.2, ymax: 2.4,
      xlabel: 'bits per action dimension', ylabel: 'log₁₀ mm' });
    H.grid(ctx, f, p, 5, 4);
    var C = [], b;
    for (b = 4; b <= 14; b += 0.25) C.push([b, Math.log(2 * range / Math.pow(2, b)) / Math.LN10]);
    H.line(ctx, f, C, p.accent, 2.4);
    var cl = Math.log(clear) / Math.LN10;
    ctx.strokeStyle = p.green; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(cl)); ctx.lineTo(f.x1, f.Y(cl)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(cl) - 13, 'clearance ' + clear + ' mm', p.green, p);
    ctx.fillStyle = p.amber; ctx.globalAlpha = .55;
    ctx.fillRect(f.X(logB) - 1, f.y1, 2, f.y0 - f.y1); ctx.globalAlpha = 1;
    var need = Math.ceil(Math.log(2 * range / clear) / Math.LN2);
    H.metric(w, 'bins', B.toFixed(0) + ' bins');
    H.metric(w, 'res', res.toFixed(2) + ' mm');
    H.metric(w, 'need', need + ' bits');
    H.metric(w, 'speed', (res * fctl / 1000).toFixed(2) + ' m/s min step');
    H.metric(w, 'verdict', res <= clear ? 'action grid resolves the clearance'
             : 'action grid is ' + (res / clear).toFixed(1) + '× too coarse — needs ' + need + ' bits');
  };

  /* 02 · THE theorem: BC compounds quadratically, DAgger does not */
  R['compound'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var eps = H.value(w, 'eps', 2) / 100, T = H.value(w, 'horizon', 200), k = H.value(w, 'chunk', 1);
    /* log-log: on these axes εT is a line of slope 1 and εT²/2 a line of slope 2,
       so the exponent IS the slope — and nothing saturates off the top of the plot. */
    var f = H.frame(ctx, g.w, g.h, p, { left: 56, xmin: 0, xmax: 3, ymin: -4, ymax: 3,
      xlabel: 'log₁₀ horizon T', ylabel: 'log₁₀ expected failures' });
    H.grid(ctx, f, p, 3, 7);
    var I = [], Q = [], K = [], t, lx;
    for (lx = 0; lx <= 3.001; lx += 0.05) {
      var tt = Math.pow(10, lx);
      I.push([lx, Math.log(eps * tt) / Math.LN10]);
      Q.push([lx, Math.log(eps * tt * tt / 2) / Math.LN10]);
      K.push([lx, Math.log(eps * tt * tt / (2 * k)) / Math.LN10]);
    }
    H.line(ctx, f, Q, p.red, 2.6);
    if (k > 1) H.line(ctx, f, K, p.amber, 2.2, [6, 3]);
    H.line(ctx, f, I, p.green, 2.6);
    /* the "failure is certain" line at 1 expected failure */
    ctx.strokeStyle = p.text; ctx.lineWidth = 1.2;
    if (ctx.setLineDash) ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(0)); ctx.lineTo(f.x1, f.Y(0)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(0) - 13, 'one expected failure', p.text, p);
    ctx.strokeStyle = p.accent; ctx.lineWidth = 1.6;
    var tx = f.X(Math.min(3, Math.log(T) / Math.LN10));
    ctx.beginPath(); ctx.moveTo(tx, f.y1); ctx.lineTo(tx, f.y0); ctx.stroke();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'red slope 2 = BC   green slope 1 = on-policy', p.mute, p);
    for (var yy = -4; yy <= 3; yy += 2) H.tick(ctx, f, p, 'y', yy, '10' + sup(yy));
    var bc = eps * T * T / 2, da = eps * T, ck = eps * T * T / (2 * k);
    function ff(v) { return v >= 100 ? fmtN(v) : v.toFixed(3); }
    H.metric(w, 'bc', ff(bc));
    H.metric(w, 'chunk', ff(ck));
    H.metric(w, 'dagger', ff(da));
    var tBC = Math.sqrt(2 / eps), tOP = 1 / eps;
    H.metric(w, 'ratio', tBC.toFixed(0) + ' vs ' + tOP.toFixed(0) + ' steps');
    H.metric(w, 'verdict', bc < 1 ? 'horizon short enough for plain BC'
             : da < 1 ? 'BC already fails; on-policy training still finishes — buy corrections'
             : 'at this ε neither survives ' + T + ' steps: cloning caps out at ' + tBC.toFixed(0)
               + ', on-policy at ' + tOP.toFixed(0));
  };

  /* 03 · action chunking has an interior optimum */
  R['chunk'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var eps = H.value(w, 'eps', 2) / 100, T = H.value(w, 'horizon', 200);
    var lam = H.value(w, 'disturb', 0.6), fctl = H.value(w, 'rate', 50);
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 1, xmax: 120, ymin: 0, ymax: 1,
      xlabel: 'chunk length k (steps)', ylabel: 'success' });
    H.grid(ctx, f, p, 4, 4);
    var Sc = [], Fc = [], Fr = [], k, bk = 1, bv = -1;
    for (k = 1; k <= 120; k++) {
      var fcomp = Math.min(1, eps * T * T / (2 * k));
      var freact = 1 - Math.exp(-lam * k / fctl);
      var s = (1 - fcomp) * (1 - freact);
      Sc.push([k, s]); Fc.push([k, 1 - fcomp]); Fr.push([k, 1 - freact]);
      if (s > bv) { bv = s; bk = k; }
    }
    H.line(ctx, f, Fc, p.cyan, 2, [5, 4]);
    H.line(ctx, f, Fr, p.amber, 2, [5, 4]);
    H.line(ctx, f, Sc, p.accent, 2.6);
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(f.X(bk), f.Y(bv), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.X(bk) + 8, f.Y(bv) - 12, 'k* = ' + bk, p.accent, p);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'cyan: 1−compounding   amber: 1−missed disturbance', p.mute, p);
    H.metric(w, 'best', 'k* = ' + bk);
    H.metric(w, 'dur', (1000 * bk / fctl).toFixed(0) + ' ms');
    H.metric(w, 'succ', bv.toFixed(3));
    H.metric(w, 'k1', ((1 - Math.min(1, eps * T * T / 2)) * (1 - (1 - Math.exp(-lam / fctl)))).toFixed(3));
    H.metric(w, 'verdict', bk <= 2 ? 'disturbances dominate — chunk barely helps'
             : bk >= 115 ? 'open-loop is fine here; the world is quiet' : 'chunk ' + (1000 * bk / fctl).toFixed(0) + ' ms, then re-plan');
  };

  /* 04 · teleoperation throughput and its bill */
  R['teleop'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var epLen = H.value(w, 'eplen', 40), reset = H.value(w, 'reset', 20);
    var ops = H.value(w, 'ops', 4), days = H.value(w, 'days', 60);
    var rate = H.value(w, 'cost', 30);
    var perHour = 3600 / (epLen + reset);
    var hoursPerDay = 6;
    var eps = perHour * hoursPerDay * days * ops;
    var interact = eps * epLen / 3600;
    var opHours = hoursPerDay * days * ops;
    var usd = opHours * rate;
    var f = H.frame(ctx, g.w, g.h, p, { left: 130, xmin: 0, xmax: 6.5, ymin: 0, ymax: 3.2,
      xlabel: 'log₁₀' });
    H.grid(ctx, f, p, 6, 3);
    var rows = [['episodes collected', eps, p.accent, 2.6],
                ['hours of interaction', interact, p.cyan, 1.75],
                ['operator-hours', opHours, p.amber, 0.9],
                ['labour cost (USD)', usd, p.green, 0.15]];
    for (var i = 0; i < rows.length; i++) {
      var v = Math.max(0, Math.log(Math.max(1, rows[i][1])) / Math.LN10);
      var y = f.Y(rows[i][3]);
      ctx.fillStyle = rows[i][2];
      ctx.fillRect(f.x0, y - 12, Math.max(2, f.X(v) - f.x0), 24);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right'; ctx.fillText(rows[i][0], f.x0 - 7, y);
      ctx.fillStyle = p.text; ctx.textAlign = 'left';
      ctx.fillText(fmtN(rows[i][1]), Math.min(f.X(v) + 6, f.x1 - 56), y);
    }
    ctx.strokeStyle = p.red; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([4, 4]);
    var dx = f.X(Math.log(76000) / Math.LN10);
    ctx.beginPath(); ctx.moveTo(dx, f.y1); ctx.lineTo(dx, f.y0); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, dx + 6, f.y0 - 14, 'DROID: 76k traj', p.red, p);
    for (var kk = 0; kk <= 6; kk += 2) H.tick(ctx, f, p, 'x', kk, '10' + sup(kk));
    H.metric(w, 'rate', perHour.toFixed(1) + ' ep/h');
    H.metric(w, 'eps', fmtN(eps) + ' episodes');
    H.metric(w, 'hours', fmtN(interact) + ' h');
    H.metric(w, 'usd', '$' + fmtN(usd));
    H.metric(w, 'frac', (100 * eps / 76000).toFixed(1) + '% of DROID');
  };

  /* 05 · split the budget: more demos vs on-policy corrections */
  R['dagger'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var budget = H.value(w, 'budget', 20000), T = H.value(w, 'horizon', 200);
    var e0 = H.value(w, 'e0', 8) / 100;
    var N0 = 1500, beta = 0.55, M0 = 2500;
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 0, xmax: 100, ymin: 0, ymax: 1,
      xlabel: 'share of budget spent on on-policy corrections (%)', ylabel: 'expected failure' });
    H.grid(ctx, f, p, 4, 4);
    var Fl = [], phi, bp = 0, bv = 2;
    for (phi = 0; phi <= 100; phi += 1) {
      var Nd = budget * (1 - phi / 100), Mc = budget * (phi / 100);
      var eps = e0 * Math.pow(N0 / (N0 + Nd), beta);
      var cov = 1 - Math.exp(-Mc / M0);
      var fail = Math.min(1, (1 - cov) * eps * T * T / 2 + cov * eps * T);
      Fl.push([phi, fail]);
      if (fail < bv) { bv = fail; bp = phi; }
    }
    H.line(ctx, f, Fl, p.accent, 2.6);
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(f.X(bp), f.Y(bv), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.X(bp) + 8, f.Y(bv) - 12, 'φ* = ' + bp + '%', p.accent, p);
    var all = Fl[0][1];
    H.metric(w, 'best', bp + '% corrections');
    H.metric(w, 'fail', bv.toFixed(3));
    H.metric(w, 'alldemo', all.toFixed(3));
    H.metric(w, 'gain', all > 0 ? (100 * (all - bv) / all).toFixed(0) + '% fewer failures' : '—');
    H.metric(w, 'verdict', bp >= 60 ? 'buy corrections, not demonstrations'
             : bp <= 5 ? 'still demo-limited — collect breadth first' : 'mix: breadth then corrections');
  };

  /* 06 · pooling bodies: transfer against action-space interference */
  R['xembo'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var sigma = H.value(w, 'shared', 65) / 100, conf = H.value(w, 'conflict', 0.35);
    var head = H.value(w, 'head', 'shared');
    var perBody = H.value(w, 'perbody', 300);
    var f = H.frame(ctx, g.w, g.h, p, { left: 50, xmin: 1, xmax: 24, ymin: 0, ymax: 1,
      xlabel: 'embodiments pooled', ylabel: 'capability on your body' });
    H.grid(ctx, f, p, 4, 4);
    var Sh = [], Pb = [], n, bn = 1, bv = -1;
    for (n = 1; n <= 24; n++) {
      var pooled = perBody * n;
      var useful = perBody + sigma * (pooled - perBody);
      var base = 1 - Math.exp(-useful / 2600);
      var interf = conf * (n - 1) / (1 + conf * (n - 1));
      var sh = base * (1 - interf);
      var pb = base;
      Sh.push([n, sh]); Pb.push([n, pb]);
      var cur = head === 'shared' ? sh : pb;
      if (cur > bv) { bv = cur; bn = n; }
    }
    H.line(ctx, f, Sh, p.amber, 2.4, head === 'shared' ? null : [5, 4]);
    H.line(ctx, f, Pb, p.accent, 2.4, head === 'shared' ? [5, 4] : null);
    ctx.fillStyle = head === 'shared' ? p.amber : p.accent;
    ctx.beginPath(); ctx.arc(f.X(bn), f.Y(bv), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'amber: one shared action head   violet: per-embodiment head', p.mute, p);
    H.metric(w, 'pooled', fmtN(perBody * bn) + ' h');
    H.metric(w, 'useful', fmtN(perBody + sigma * (perBody * bn - perBody)) + ' h');
    H.metric(w, 'best', bn + ' embodiments');
    H.metric(w, 'cap', bv.toFixed(3));
    H.metric(w, 'verdict', head === 'shared' && bn < 22 ? 'shared head saturates at ' + bn + ' — split the head'
             : 'pool everything you can reach');
  };

  /* 07 · what transfers from video of another body */
  R['human'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var hrs = Math.pow(10, H.value(w, 'hours', 3.56));
    var ret = H.value(w, 'retarget', 55) / 100;
    var caps = [
      { nm: 'task semantics', k: 300, gate: 1.0, col: p.green },
      { nm: 'affordance / where', k: 900, gate: 1.0, col: p.cyan },
      { nm: 'subgoal sequence', k: 1500, gate: 0.85, col: p.accent },
      { nm: 'kinematic trajectory', k: 4000, gate: ret, col: p.amber },
      { nm: 'contact forces', k: 4000, gate: 0.0, col: p.red }
    ];
    var vals = [], cols = [], labs = [], i;
    for (i = 0; i < caps.length; i++) {
      vals.push(caps[i].gate * (1 - Math.exp(-hrs / caps[i].k)));
      cols.push(caps[i].col);
      labs.push(caps[i].nm);
    }
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 1, ylabel: 'transferred' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, vals, cols, labs, p, function (v) { return v.toFixed(2); });
    H.metric(w, 'hours', fmtN(hrs) + ' h');
    H.metric(w, 'sem', vals[0].toFixed(2));
    H.metric(w, 'traj', vals[3].toFixed(2));
    H.metric(w, 'force', vals[4].toFixed(2));
    H.metric(w, 'verdict', vals[4] === 0 ? 'forces do not transfer at any scale — instrument a body'
             : 'check the retargeting gate');
  };

  /* 08 · compliance beats precision at the millimetre scale */
  R['contact'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var clear = H.value(w, 'clear', 2), sig = H.value(w, 'sigma', 3);
    var cham = H.value(w, 'chamfer', 4), stiff = H.value(w, 'stiff', 40);
    function erf(x) {
      var s = x < 0 ? -1 : 1; x = Math.abs(x);
      var t = 1 / (1 + 0.3275911 * x);
      var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return s * y;
    }
    function P(halfwidth) { return erf(halfwidth / (sig * Math.SQRT2)); }
    var comply = 1 / (1 + stiff / 20);
    var capture = clear + cham * comply;
    var pPos = P(clear), pImp = P(capture);
    var force = stiff * Math.min(sig, cham) * 0.5;
    var f = H.frame(ctx, g.w, g.h, p, { left: 50, xmin: 0, xmax: 8, ymin: 0, ymax: 1,
      xlabel: 'positioning error σ (mm)', ylabel: 'P(insertion succeeds)' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], B = [], s2;
    for (s2 = 0.2; s2 <= 8; s2 += 0.1) {
      A.push([s2, erf(clear / (s2 * Math.SQRT2))]);
      B.push([s2, erf(capture / (s2 * Math.SQRT2))]);
    }
    H.line(ctx, f, A, p.red, 2.4);
    H.line(ctx, f, B, p.green, 2.4);
    ctx.fillStyle = p.accent; ctx.globalAlpha = .5;
    ctx.fillRect(f.X(sig) - 1, f.y1, 2, f.y0 - f.y1); ctx.globalAlpha = 1;
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'red: stiff position control   green: compliant', p.mute, p);
    H.metric(w, 'ppos', pPos.toFixed(3));
    H.metric(w, 'pimp', pImp.toFixed(3));
    H.metric(w, 'capture', capture.toFixed(1) + ' mm');
    H.metric(w, 'force', force.toFixed(1) + ' N');
    H.metric(w, 'verdict', force > 40 ? 'too stiff — this jams or breaks the part'
             : pImp > pPos * 1.3 ? 'compliance buys ' + ((pImp / Math.max(pPos, 1e-6))).toFixed(1) + '× the success rate'
             : 'precision already sufficient');
  };

  /* 09 · dynamics randomisation: width against calibration */
  R['simdr'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var off = H.value(w, 'offset', 0.30);
    var cal = H.value(w, 'calib', 'off');
    var mu = cal === 'on' ? off * 0.15 : off;
    var f = H.frame(ctx, g.w, g.h, p, { left: 50, xmin: 0.02, xmax: 1.2, ymin: 0, ymax: 1,
      xlabel: 'randomisation width w (relative)', ylabel: 'real-world success' });
    H.grid(ctx, f, p, 4, 4);
    var S = [], Sc = [], x, bx = 0.02, bv = -1;
    for (x = 0.02; x <= 1.2; x += 0.01) {
      var cover = Math.exp(-(mu * mu) / (2 * x * x));
      var sharp = 1 / (1 + x / 0.32);
      var s = cover * sharp;
      var coverU = Math.exp(-(off * off) / (2 * x * x));
      S.push([x, s]); Sc.push([x, coverU * sharp]);
      if (s > bv) { bv = s; bx = x; }
    }
    H.line(ctx, f, Sc, p.dim, 1.8, [5, 4]);
    H.line(ctx, f, S, p.accent, 2.6);
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(f.X(bx), f.Y(bv), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.X(bx) + 8, f.Y(bv) - 12, 'w* = ' + bx.toFixed(2), p.accent, p);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'dashed: uncalibrated centre', p.mute, p);
    H.metric(w, 'mu', mu.toFixed(3));
    H.metric(w, 'best', 'w* = ' + bx.toFixed(2));
    H.metric(w, 'succ', bv.toFixed(3));
    H.metric(w, 'cover', Math.exp(-(mu * mu) / (2 * bx * bx)).toFixed(3));
    H.metric(w, 'verdict', cal === 'off' && off > 0.25 ? 'identify the parameter first — width is paying for a wrong centre'
             : 'randomise ±' + (100 * bx).toFixed(0) + '% around the calibrated value');
  };

  /* 10 · RL as the residual, priced in real samples */
  R['resid'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var prior = H.value(w, 'prior', 0.55), afford = H.value(w, 'afford', 5);
    var f = H.frame(ctx, g.w, g.h, p, { left: 50, xmin: 2, xmax: 9, ymin: 0, ymax: 1,
      xlabel: 'log₁₀ environment steps', ylabel: 'task success' });
    H.grid(ctx, f, p, 4, 4);
    var Bc = [], Sc = [], Ft = [], i, sAff = 0, fAff = 0;
    for (i = 2; i <= 9.001; i += 0.05) {
      var n = Math.pow(10, i);
      Bc.push([i, prior]);
      var scratch = 0.95 / (1 + Math.pow(10, (7.4 - i) * 1.1));
      var ft = prior + (0.95 - prior) / (1 + Math.pow(10, (5.6 - i) * 1.1));
      Sc.push([i, scratch]); Ft.push([i, ft]);
      if (Math.abs(i - afford) < 0.03) { sAff = scratch; fAff = ft; }
    }
    H.line(ctx, f, Bc, p.amber, 2, [5, 4]);
    H.line(ctx, f, Sc, p.red, 2.4);
    H.line(ctx, f, Ft, p.green, 2.6);
    ctx.strokeStyle = p.accent; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(f.X(afford), f.y1); ctx.lineTo(f.X(afford), f.y0); ctx.stroke();
    H.badge(ctx, f.X(afford) + 6, f.y1 + 12, 'what you can afford', p.accent, p);
    H.badge(ctx, f.x0 + 6, f.y0 - 14, 'amber: BC only   red: RL from scratch   green: BC then RL', p.mute, p);
    H.metric(w, 'bc', prior.toFixed(2));
    H.metric(w, 'scratch', sAff.toFixed(3));
    H.metric(w, 'finetune', fAff.toFixed(3));
    H.metric(w, 'gain', (fAff - prior).toFixed(3));
    H.metric(w, 'verdict', sAff < prior ? 'from scratch is worse than the prior at this budget'
             : 'scratch has caught up — the prior no longer pays');
  };

  /* 11 · frequency decoupling: the chunk must cover the reasoning gap */
  R['arch'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var vlmMs = H.value(w, 'vlm', 320), expMs = H.value(w, 'expert', 12);
    var fctl = H.value(w, 'rate', 50), k = H.value(w, 'chunk', 50);
    var fVlm = 1000 / vlmMs;
    var need = Math.ceil(fctl / fVlm);
    var f = H.frame(ctx, g.w, g.h, p, { left: 54, xmin: 0, xmax: 2000, ymin: 0, ymax: 3.4,
      xlabel: 'time (ms)' });
    ctx.strokeStyle = p.border; ctx.lineWidth = 1;
    var lanes = [['VLM reasoning pass', vlmMs, p.accent, 2.6],
                 ['action expert', expMs, p.cyan, 1.7],
                 ['emitted chunk covers', 1000 * k / fctl, p.green, 0.8]];
    for (var i = 0; i < lanes.length; i++) {
      var y = f.Y(lanes[i][3]);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right'; ctx.fillText(lanes[i][0], f.x0 - 7, y);
      var t = 0, n = 0;
      while (t < 2000 && n < 60) {
        var wpx = Math.max(2, f.X(t + lanes[i][1]) - f.X(t));
        ctx.fillStyle = lanes[i][2];
        ctx.globalAlpha = n % 2 ? .55 : .9;
        ctx.fillRect(f.X(t), y - 11, wpx - 1, 22);
        t += lanes[i][1]; n++;
      }
      ctx.globalAlpha = 1;
    }
    var covered = 1000 * k / fctl >= vlmMs;
    H.badge(ctx, f.x0 + 6, f.y1 + 10, covered ? 'chunk spans the reasoning gap' : 'GAP: controller starves between passes',
            covered ? p.green : p.red, p);
    for (var kk = 0; kk <= 2000; kk += 500) H.tick(ctx, f, p, 'x', kk, String(kk));
    H.metric(w, 'fvlm', fVlm.toFixed(1) + ' Hz');
    H.metric(w, 'need', need + ' steps');
    H.metric(w, 'have', k + ' steps');
    H.metric(w, 'cover', (1000 * k / fctl).toFixed(0) + ' ms');
    H.metric(w, 'verdict', covered ? 'hierarchy closes: ' + fVlm.toFixed(1) + ' Hz thinking, ' + fctl + ' Hz acting'
             : 'chunk must be ≥ ' + need + ' steps or the arm stalls');
  };

  /* 12 · co-training keeps the language the fine-tune would erase */
  R['stage2'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var co = H.value(w, 'cotrain', 0) / 100, steps = H.value(w, 'steps', 30);
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 0, xmax: 100, ymin: 0, ymax: 1,
      xlabel: 'fine-tuning steps (thousands)', ylabel: 'capability' });
    H.grid(ctx, f, p, 4, 4);
    var Tk = [], Lg = [], i, tAt = 0, lAt = 0;
    for (i = 0; i <= 100; i += 1) {
      var task = 0.94 * (1 - Math.exp(-i / 18)) * (1 - 0.25 * co);
      var lang = 0.92 * (co + (1 - co) * Math.exp(-i / 26));
      Tk.push([i, task]); Lg.push([i, lang]);
      if (i === Math.round(steps)) { tAt = task; lAt = lang; }
    }
    H.line(ctx, f, Tk, p.accent, 2.6);
    H.line(ctx, f, Lg, p.green, 2.6);
    ctx.strokeStyle = p.amber; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(f.X(steps), f.y1); ctx.lineTo(f.X(steps), f.y0); ctx.stroke();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'violet: robot task   green: retained language grounding', p.mute, p);
    H.metric(w, 'task', tAt.toFixed(3));
    H.metric(w, 'lang', lAt.toFixed(3));
    H.metric(w, 'prod', (tAt * lAt).toFixed(3));
    H.metric(w, 'verdict', co < 0.05 && lAt < 0.4 ? 'language grounding erased — co-train or lose "put the red one away"'
             : 'both retained');
  };

  /* 13 · the power wall: what 20 real trials can actually detect */
  R['power'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var n = H.value(w, 'n', 20), p0 = H.value(w, 'p0', 70) / 100;
    var z = 1.959964, zb = 0.841621;
    function wilson(k, nn) {
      var ph = k / nn;
      var den = 1 + z * z / nn;
      var c = (ph + z * z / (2 * nn)) / den;
      var hw = z / den * Math.sqrt(ph * (1 - ph) / nn + z * z / (4 * nn * nn));
      return [Math.max(0, c - hw), Math.min(1, c + hw)];
    }
    var ci = wilson(Math.round(p0 * n), n);
    var f = H.frame(ctx, g.w, g.h, p, { left: 50, xmin: 5, xmax: 400, ymin: 0, ymax: 1,
      xlabel: 'real-robot trials per arm (n)', ylabel: 'effect size' });
    H.grid(ctx, f, p, 4, 4);
    var M = [], Wl = [], Wu = [], nn;
    for (nn = 5; nn <= 400; nn += 2) {
      var mde = (z + zb) * Math.sqrt(2 * p0 * (1 - p0) / nn);
      var c2 = wilson(Math.round(p0 * nn), nn);
      M.push([nn, Math.min(1, mde)]);
      Wl.push([nn, c2[0]]); Wu.push([nn, c2[1]]);
    }
    H.line(ctx, f, Wu, p.dim, 1.6, [4, 4]);
    H.line(ctx, f, Wl, p.dim, 1.6, [4, 4]);
    H.line(ctx, f, M, p.red, 2.6);
    ctx.strokeStyle = p.accent; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(f.X(n), f.y1); ctx.lineTo(f.X(n), f.y0); ctx.stroke();
    ctx.strokeStyle = p.green; ctx.lineWidth = 1.4;
    if (ctx.setLineDash) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(0.10)); ctx.lineTo(f.x1, f.Y(0.10)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(0.10) - 13, 'a 10-point improvement', p.green, p);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'red: minimum detectable effect   dashed: 95% Wilson band', p.mute, p);
    var mdeN = (z + zb) * Math.sqrt(2 * p0 * (1 - p0) / n);
    var need = Math.ceil(2 * p0 * (1 - p0) * Math.pow((z + zb) / 0.10, 2));
    H.metric(w, 'ci', (100 * ci[0]).toFixed(0) + '–' + (100 * ci[1]).toFixed(0) + '%');
    H.metric(w, 'width', (100 * (ci[1] - ci[0])).toFixed(0) + ' pts');
    H.metric(w, 'mde', (100 * mdeN).toFixed(0) + ' pts');
    H.metric(w, 'need', fmtN(need) + ' trials');
    H.metric(w, 'rule3', (300 / n).toFixed(1) + '% (0 fails)');
  };

  /* 14 · the whole programme */
  R['program'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var tasks = H.value(w, 'tasks', 40), perTask = H.value(w, 'pertask', 120);
    var corr = H.value(w, 'corr', 35) / 100, simH = Math.pow(10, H.value(w, 'sim', 5));
    var eps = tasks * perTask;
    var demos = eps * (1 - corr), corrections = eps * corr;
    var opHours = eps / 45;
    var usd = opHours * 30 + simH * 0.02;
    var evalTrials = tasks * 100;
    var evalHours = evalTrials * 60 / 3600;
    var f = H.frame(ctx, g.w, g.h, p, { left: 138, xmin: 0, xmax: 6.5, ymin: 0, ymax: 4.4,
      xlabel: 'log₁₀' });
    H.grid(ctx, f, p, 6, 4);
    var rows = [['demonstrations', demos, p.accent, 3.8],
                ['on-policy corrections', corrections, p.amber, 3.0],
                ['simulated hours', simH, p.green, 2.2],
                ['operator-hours', opHours, p.cyan, 1.4],
                ['evaluation trials', evalTrials, p.red, 0.6]];
    for (var i = 0; i < rows.length; i++) {
      var v = Math.max(0, Math.log(Math.max(1, rows[i][1])) / Math.LN10);
      var y = f.Y(rows[i][3]);
      ctx.fillStyle = rows[i][2];
      ctx.fillRect(f.x0, y - 11, Math.max(2, f.X(v) - f.x0), 22);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right'; ctx.fillText(rows[i][0], f.x0 - 7, y);
      ctx.fillStyle = p.text; ctx.textAlign = 'left';
      ctx.fillText(fmtN(rows[i][1]), Math.min(f.X(v) + 6, f.x1 - 54), y);
    }
    for (var kk = 0; kk <= 6; kk += 2) H.tick(ctx, f, p, 'x', kk, '10' + sup(kk));
    H.metric(w, 'eps', fmtN(eps) + ' episodes');
    H.metric(w, 'ophours', fmtN(opHours) + ' op-h');
    H.metric(w, 'usd', '$' + fmtN(usd));
    H.metric(w, 'evaltrials', fmtN(evalTrials) + ' trials');
    H.metric(w, 'evalweeks', (evalHours / 40).toFixed(1) + ' robot-weeks');
    H.metric(w, 'frac', (100 * eps / 76000).toFixed(0) + '% of DROID');
  };

  /* ---- number formatting ------------------------------------------------- */
  function fmtN(v) {
    if (!isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e15) return (v / 1e15).toFixed(1) + 'P';
    if (a >= 1e12) return (v / 1e12).toFixed(1) + 'T';
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (a >= 10) return v.toFixed(0);
    return v.toFixed(2);
  }
  function sup(n) {
    var m = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(n).split('').map(function (c) { return m[c] || c; }).join('');
  }
  /* ---- boot -------------------------------------------------------------- */
  function boot() {
    var cvs = document.querySelectorAll('canvas[data-demo]');
    for (var i = 0; i < cvs.length; i++) {
      (function (cv) {
        var key = cv.getAttribute('data-demo');
        var fn = R[key];
        if (!fn) return;
        var w = ownerWidget(cv);
        var draw = function () { syncValues(w); try { fn(cv, w, H); } catch (e) {} };
        var ctl = w.querySelectorAll('input,select');
        for (var j = 0; j < ctl.length; j++) {
          ctl[j].addEventListener('input', draw);
          ctl[j].addEventListener('change', draw);
        }
        var bs = w.querySelectorAll('button[data-set-role]');
        for (var k = 0; k < bs.length; k++) {
          (function (b) {
            b.addEventListener('click', function () {
              var t = w.querySelector('[data-role="' + b.getAttribute('data-set-role') + '"]');
              if (t) { t.value = b.getAttribute('data-set-value'); }
              draw();
            });
          })(bs[k]);
        }
        window.addEventListener('resize', draw);
        draw();
      })(cvs[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
