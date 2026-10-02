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

  /* 00 · two seats, one tuple — the free-video : action-grounded ratio */
  R['tuple'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var lu = H.value(w, 'unlab', 6), ll = H.value(w, 'lab', 1.8);
    var U = Math.pow(10, lu), L = Math.pow(10, ll);
    var TOK = 7.37e6;                      /* tokens per hour, 256²/patch16 @ 8fps */
    var f = H.frame(ctx, g.w, g.h, p, { left: 128, xmin: 0, xmax: 7, ymin: 0, ymax: 3,
                                        xlabel: 'log₁₀ hours' });
    H.grid(ctx, f, p, 7, 3);
    var rows = [
      ['free video (no actions)', U, p.cyan, 2.4],
      ['action-grounded video', L, p.accent, 1.5],
      ['what the predictor p(o′|o,a) can use', L, p.amber, 0.6]
    ];
    for (var i = 0; i < rows.length; i++) {
      var v = Math.max(0, Math.log(rows[i][1]) / Math.LN10);
      var y = f.Y(rows[i][3]), hh = 26;
      ctx.fillStyle = rows[i][2];
      ctx.fillRect(f.x0, y - hh / 2, Math.max(2, f.X(v) - f.x0), hh);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right';
      ctx.fillText(rows[i][0], f.x0 - 7, y);
      ctx.fillStyle = p.text; ctx.textAlign = 'left';
      ctx.fillText(fmtH(rows[i][1]), Math.min(f.X(v) + 6, f.x1 - 54), y);
    }
    for (var k = 0; k <= 6; k += 2) H.tick(ctx, f, p, 'x', k, '10' + sup(k));
    var ratio = U / L;
    H.metric(w, 'unlab', fmtH(U) + ' h');
    H.metric(w, 'lab', fmtH(L) + ' h');
    H.metric(w, 'ratio', fmtN(ratio) + ' : 1');
    H.metric(w, 'tokens', fmtN(L * TOK) + ' tok');
    H.metric(w, 'verdict', ratio > 3000 ? 'the handle is the bottleneck'
             : ratio > 100 ? 'handle-limited' : 'balanced — rare in practice');
  };

  /* 01 · fidelity is not acceptance — four tests, one training choice */
  R['accept'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var q = H.value(w, 'compute', 0.6);
    var mode = H.value(w, 'objective', 'pixel');
    var Hz = H.value(w, 'horizon', 60);
    var cond = mode !== 'pixel';
    var mem  = mode === 'mem' || mode === 'all';
    var dist = mode === 'all';
    var fid = 1 - Math.exp(-3.2 * q);
    var ctr = cond ? (1 - Math.exp(-2.6 * q)) * 0.94 : 0.06 + 0.04 * q;
    var lam = mem ? 0.004 : 0.026;
    var con = Math.exp(-lam * Hz) * (0.55 + 0.45 * fid);
    var cal = dist ? 0.86 * (1 - Math.exp(-2.2 * q)) : 0.10 * q;
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 1, ylabel: 'score' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, [fid, ctr, con, cal], [p.cyan, p.accent, p.amber, p.green],
           ['pixel fidelity', 'controllability', 'consistency@H', 'calibration'], p,
           function (v) { return v.toFixed(2); });
    ctx.strokeStyle = p.red; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(0.7)); ctx.lineTo(f.x1, f.Y(0.7)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(0.7) - 13, 'acceptance bar 0.70', p.red, p);
    var pass = (fid > .7) + (ctr > .7) + (con > .7) + (cal > .7);
    H.metric(w, 'fid', fid.toFixed(2));
    H.metric(w, 'ctrl', ctr.toFixed(2));
    H.metric(w, 'cons', con.toFixed(2));
    H.metric(w, 'cal', cal.toFixed(2));
    H.metric(w, 'pass', pass + ' / 4 tests');
  };

  /* 02 · reverse water-filling: where a pixel loss spends its bits */
  R['bits'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var B = H.value(w, 'budget', 1200);           /* total bits per frame */
    var pol = H.value(w, 'policy', 'pixel');
    /* three components: dimension n, variance σ², decision weight ω */
    var comp = [
      { nm: 'background', n: 700, s2: 1.00, wt: 0.02 },
      { nm: 'object appearance', n: 220, s2: 0.42, wt: 0.28 },
      { nm: 'contact / pose', n: 40, s2: 0.08, wt: 0.70 }
    ];
    var i, c = [];
    for (i = 0; i < 3; i++) {
      c.push(pol === 'decision' ? comp[i].wt * comp[i].s2
           : pol === 'uniform' ? 1 : comp[i].s2);
    }
    /* solve Σ nᵢ·½log₂(cᵢ/θ) = B with Rᵢ ≥ 0  (water-filling on θ) */
    var lo = 1e-9, hi = 10, Rt = [];
    for (var it = 0; it < 90; it++) {
      var th = Math.sqrt(lo * hi), tot = 0;
      for (i = 0; i < 3; i++) tot += comp[i].n * Math.max(0, 0.5 * Math.log(c[i] / th) / Math.LN2);
      if (tot > B) lo = th; else hi = th;
    }
    var theta = Math.sqrt(lo * hi), used = 0;
    for (i = 0; i < 3; i++) {
      Rt[i] = Math.max(0, 0.5 * Math.log(c[i] / theta) / Math.LN2);
      used += comp[i].n * Rt[i];
    }
    var dLoss = 0, pLoss = 0, dist = [];
    for (i = 0; i < 3; i++) {
      dist[i] = comp[i].s2 * Math.pow(2, -2 * Rt[i]);
      dLoss += comp[i].n * comp[i].wt * dist[i];
      pLoss += comp[i].n * dist[i];
    }
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 4.2, ylabel: 'bits / coefficient' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, Rt, [p.cyan, p.accent, p.red],
           ['background', 'object', 'contact'], p, function (v) { return v.toFixed(2); });
    for (i = 0; i <= 4; i++) H.tick(ctx, f, p, 'y', i, String(i));
    var share = [];
    for (i = 0; i < 3; i++) share[i] = 100 * comp[i].n * Rt[i] / (used || 1);
    H.metric(w, 'bg', share[0].toFixed(0) + '% of bits');
    H.metric(w, 'contact', share[2].toFixed(1) + '% of bits');
    H.metric(w, 'dloss', dLoss.toFixed(2));
    H.metric(w, 'ploss', pLoss.toFixed(1));
    H.metric(w, 'verdict', pol === 'pixel' ? (share[2] < 0.5 ? 'contact defunded entirely (rate driven to 0)' : 'contact starved')
             : pol === 'uniform' ? 'flat rate ignores both variance and relevance'
             : 'decision-aligned: contact funded, pixel loss deliberately worse');
  };

  /* 03 · the tokenizer sets the physics ceiling */
  R['tok'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var patch = H.value(w, 'patch', 16);
    var logK = H.value(w, 'codebook', 12);
    var fov = H.value(w, 'fov', 400);          /* mm across the 256-px frame */
    var res = 256, fps = 8;
    var tpf = Math.pow(res / patch, 2);
    var tps = tpf * fps;
    var bitrate = tps * logK;
    var mmPerPx = fov / res;
    var floorMM = patch * mmPerPx;             /* smallest reliably expressed feature */
    var clearance = 2;                         /* mm — the connector insertion gap */
    var f = H.frame(ctx, g.w, g.h, p, { left: 54, xmin: 2, xmax: 34, ymin: 0, ymax: 2.6,
      xlabel: 'patch size (px)', ylabel: 'log₁₀' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], Bv = [];
    for (var q = 2; q <= 34; q += 1) {
      A.push([q, Math.log(Math.pow(res / q, 2) * fps) / Math.LN10]);
      Bv.push([q, Math.log(q * mmPerPx) / Math.LN10]);
    }
    H.line(ctx, f, A, p.cyan, 2);
    H.line(ctx, f, Bv, p.red, 2);
    var cl = Math.log(clearance) / Math.LN10;
    ctx.strokeStyle = p.green; ctx.lineWidth = 1.4;
    if (ctx.setLineDash) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(cl)); ctx.lineTo(f.x1, f.Y(cl)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(cl) - 13, '2 mm clearance', p.green, p);
    ctx.fillStyle = p.accent; ctx.globalAlpha = .5;
    ctx.fillRect(f.X(patch) - 1, f.y1, 2, f.y0 - f.y1); ctx.globalAlpha = 1;
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'cyan: tokens/s   red: blur floor (mm)', p.mute, p);
    H.metric(w, 'tpf', tpf.toFixed(0) + ' tok/frame');
    H.metric(w, 'tps', fmtN(tps) + ' tok/s');
    H.metric(w, 'rate', fmtN(bitrate) + ' bit/s');
    H.metric(w, 'floor', floorMM.toFixed(1) + ' mm');
    H.metric(w, 'verdict', floorMM <= clearance ? 'insertion is expressible'
             : 'insertion is BELOW the ceiling — ' + (floorMM / clearance).toFixed(1) + '× too coarse');
  };

  /* 04 · teacher forcing → scheduled sampling → rollout → diffusion forcing */
  R['forcing'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var d = H.value(w, 'delta', 3) / 100;
    var J0 = H.value(w, 'jac', 1.08);
    var pk = H.value(w, 'mix', 40) / 100;      /* scheduled-sampling own-sample rate */
    var Hm = H.value(w, 'horizon', 24);
    var kap = 0.13;                            /* contraction bought per unit own-sample */
    var sch = [
      { nm: 'teacher forcing', J: J0, cost: 1, col: p.red },
      { nm: 'scheduled sampling', J: J0 - kap * pk, cost: 1 + 0.15 * pk, col: p.amber },
      { nm: 'k-step rollout', J: J0 - kap, cost: 4, col: p.cyan },
      { nm: 'diffusion forcing', J: J0 - kap * 0.96, cost: 1.1, col: p.green }
    ];
    var i, s, e, mx = 0, curves = [];
    for (i = 0; i < sch.length; i++) {
      var pts = [], ee = 0;
      for (s = 0; s <= Hm; s++) { pts.push([s, ee]); ee = sch[i].J * ee + d; }
      curves.push(pts);
      mx = Math.max(mx, pts[pts.length - 1][1]);
    }
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 0, xmax: Hm, ymin: 0, ymax: Math.max(0.3, mx * 1.1),
      xlabel: 'rollout step k', ylabel: 'error e(k)' });
    H.grid(ctx, f, p, 4, 4);
    for (i = 0; i < curves.length; i++) H.line(ctx, f, curves[i], sch[i].col, 2);
    var fin = [];
    for (i = 0; i < sch.length; i++) fin.push(curves[i][curves[i].length - 1][1]);
    H.metric(w, 'tf', fin[0].toFixed(3));
    H.metric(w, 'ss', fin[1].toFixed(3));
    H.metric(w, 'ro', fin[2].toFixed(3));
    H.metric(w, 'df', fin[3].toFixed(3));
    H.metric(w, 'cost', '1× / ' + sch[1].cost.toFixed(2) + '× / ' + sch[2].cost.toFixed(0) + '× / ' + sch[3].cost.toFixed(1) + '×');
    H.metric(w, 'verdict', fin[3] < fin[0] * 0.5 ? 'same bill, rollout-grade error' : 'raise the own-sample rate');
  };

  /* 05 · action conditioning: an interior optimum in guidance */
  R['cond'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var r = H.value(w, 'redund', 80) / 100;      /* predictable from history alone */
    var kap = H.value(w, 'capacity', 1.0);       /* conditioning-pathway capacity */
    var pd = H.value(w, 'dropout', 10) / 100;    /* action dropout during training */
    var ke = kap * (1 - pd);
    var base = (1 - r) * ke / (ke + 1);          /* variance explained by the action */
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 1, xmax: 6, ymin: 0, ymax: 1,
      xlabel: 'guidance scale s', ylabel: 'score' });
    H.grid(ctx, f, p, 5, 4);
    var C = [], F = [], V = [], best = 1, bv = -1, s;
    for (s = 1; s <= 6.001; s += 0.05) {
      var ctr = Math.min(1, base * s / (1 + 0.12 * (s - 1) * (s - 1)));
      var fid = 1 / (1 + 0.075 * (s - 1) * (s - 1) * (s - 1));
      var val = ctr * fid;
      C.push([s, ctr]); F.push([s, fid]); V.push([s, val]);
      if (val > bv) { bv = val; best = s; }
    }
    H.line(ctx, f, C, p.accent, 2);
    H.line(ctx, f, F, p.cyan, 2, [5, 4]);
    H.line(ctx, f, V, p.green, 2.4);
    ctx.fillStyle = p.green;
    ctx.beginPath(); ctx.arc(f.X(best), f.Y(bv), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.X(best) + 8, f.Y(bv) - 12, 's* = ' + best.toFixed(2), p.green, p);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'violet: controllability   cyan: fidelity   green: product', p.mute, p);
    H.metric(w, 'explained', (100 * base).toFixed(1) + '%');
    H.metric(w, 'kappa', ke.toFixed(2));
    H.metric(w, 'best', 's* = ' + best.toFixed(2));
    H.metric(w, 'val', bv.toFixed(3));
    H.metric(w, 'verdict', pd < 0.02 ? 'no dropout ⇒ no guidance branch to steer with'
             : base < 0.05 ? 'action gradient is starved by history redundancy' : 'steerable');
  };

  /* 06 · the IDM exchange rate — buy labels until the marginal hour returns < 1 */
  R['idm'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var lu = H.value(w, 'unlab', 4.85), amax = H.value(w, 'ceiling', 92) / 100;
    var nA = H.value(w, 'nactions', 64);
    var U = Math.pow(10, lu), L0 = 250, gam = 0.9, bits = Math.log(nA) / Math.LN2;
    function acc(L) { return amax * (1 - Math.pow(L0 / (L0 + L), gam)); }
    function eff(L) {                            /* channel efficiency of a noisy label */
      var a = acc(L), e = 1 - a;
      if (e <= 1e-6) return 1;
      var Hb = -a * Math.log(a) / Math.LN2 - (e ? e * Math.log(e / (nA - 1)) / Math.LN2 : 0);
      return Math.max(0, (bits - Hb) / bits);
    }
    function grounded(L) { return L + U * eff(L); }
    var f = H.frame(ctx, g.w, g.h, p, { left: 56, xmin: 1, xmax: 4.2, ymin: 0, ymax: Math.log(U * 1.4) / Math.LN10,
      xlabel: 'log₁₀ labeled hours L', ylabel: 'log₁₀ grounded h' });
    H.grid(ctx, f, p, 4, 4);
    var G = [], knee = null, i;
    for (i = 1; i <= 4.2001; i += 0.02) {
      var L = Math.pow(10, i);
      G.push([i, Math.log(Math.max(1, grounded(L))) / Math.LN10]);
      var marg = (grounded(L * 1.02) - grounded(L)) / (L * 0.02);
      if (knee === null && marg < 1) knee = L;
    }
    H.line(ctx, f, G, p.accent, 2.4);
    var lin = [];
    for (i = 1; i <= 4.2001; i += 0.1) lin.push([i, i]);
    H.line(ctx, f, lin, p.dim, 1.5, [4, 4]);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'dashed: collect directly (1 h buys 1 h)', p.mute, p);
    if (knee) {
      ctx.strokeStyle = p.red; ctx.lineWidth = 1.4;
      var kx = f.X(Math.log(knee) / Math.LN10);
      ctx.beginPath(); ctx.moveTo(kx, f.y1); ctx.lineTo(kx, f.y0); ctx.stroke();
      H.badge(ctx, kx + 6, f.y0 - 16, 'stop buying labels', p.red, p);
    }
    var Lv = knee || 2000;
    H.metric(w, 'acc', (100 * acc(Lv)).toFixed(1) + '%');
    H.metric(w, 'eff', (100 * eff(Lv)).toFixed(0) + '%');
    H.metric(w, 'grounded', fmtH(grounded(Lv)) + ' h');
    H.metric(w, 'amp', (grounded(Lv) / Lv).toFixed(1) + '×');
    H.metric(w, 'knee', knee ? fmtH(knee) + ' labeled h' : 'keep buying');
  };

  /* 07 · a mean is not a future: head choice under a latency budget */
  R['heads'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var sep = H.value(w, 'sep', 1.6), tol = H.value(w, 'tol', 0.35);
    var ms = H.value(w, 'msperstep', 9), tick = H.value(w, 'tick', 50);
    function dens(x) {
      return 0.5 * Math.exp(-Math.pow(x + sep, 2) / 0.18) + 0.5 * Math.exp(-Math.pow(x - sep, 2) / 0.18);
    }
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 1, xmax: 32, ymin: 0, ymax: 1,
      xlabel: 'sampling steps N', ylabel: 'P(valid) · fps' });
    H.grid(ctx, f, p, 4, 4);
    var pMean = dens(0) / dens(sep) <= 0 ? 0 : 0;
    pMean = (Math.abs(0 - sep) <= tol || Math.abs(0 + sep) <= tol) ? 1 : 0;
    var G = [], Fp = [], N, bestN = 0, bv = -1;
    for (N = 1; N <= 32; N++) {
      var pv = 0.97 * (1 - Math.exp(-N / 5.5));
      var lat = N * ms;
      var fps = 1000 / lat;
      G.push([N, pv]);
      Fp.push([N, Math.min(1, fps / 40)]);
      if (lat <= tick && pv > bv) { bv = pv; bestN = N; }
    }
    H.line(ctx, f, G, p.accent, 2.4);
    H.line(ctx, f, Fp, p.cyan, 2, [5, 4]);
    ctx.strokeStyle = p.red; ctx.lineWidth = 1.5;
    var nmax = Math.floor(tick / ms);
    if (nmax >= 1 && nmax <= 32) {
      ctx.beginPath(); ctx.moveTo(f.X(nmax), f.y1); ctx.lineTo(f.X(nmax), f.y0); ctx.stroke();
      H.badge(ctx, f.X(nmax) + 6, f.y1 + 12, tick + ' ms budget', p.red, p);
    }
    ctx.strokeStyle = p.amber; ctx.lineWidth = 2;
    if (ctx.setLineDash) ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(pMean)); ctx.lineTo(f.x1, f.Y(pMean)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(pMean) + 13, 'MSE head: P(valid) = ' + pMean.toFixed(2), p.amber, p);
    H.metric(w, 'mse', pMean.toFixed(2));
    H.metric(w, 'gen', bestN ? bv.toFixed(2) : 'n/a');
    H.metric(w, 'nmax', nmax + ' steps');
    H.metric(w, 'fps', bestN ? (1000 / (bestN * ms)).toFixed(0) + ' fps' : '—');
    H.metric(w, 'verdict', !bestN ? 'no sample count fits the tick — distil (§12)'
             : pMean === 0 ? 'the mean lands in the valley; sampling is mandatory' : 'modes have merged — MSE is fine here');
  };

  /* 08 · context window: quadratic cost against permanence */
  R['ctx'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var tpf = H.value(w, 'tpf', 256), gap = H.value(w, 'gap', 90), d0 = H.value(w, 'delta', 3) / 100;
    var f = H.frame(ctx, g.w, g.h, p, { left: 52, xmin: 8, xmax: 256, ymin: 0, ymax: 1,
      xlabel: 'context frames C', ylabel: 'normalised' });
    H.grid(ctx, f, p, 4, 4);
    var C, Pf = [], Cost = [], Val = [], bestC = 8, bv = -1;
    var maxCost = Math.pow(256 * tpf, 2);
    for (C = 8; C <= 256; C += 2) {
      var pforget = Math.exp(-C / gap);
      var cost = Math.pow(C * tpf, 2) / maxCost;
      var delta = d0 * (1 + 24 / C);
      var drift = Math.min(1, delta * 40);
      var val = (1 - pforget) * (1 - drift) / (0.25 + cost);
      Pf.push([C, pforget]);
      Cost.push([C, cost]);
      Val.push([C, val]);
      if (val > bv) { bv = val; bestC = C; }
    }
    var vn = [];
    for (C = 0; C < Val.length; C++) vn.push([Val[C][0], Val[C][1] / (bv || 1)]);
    H.line(ctx, f, Pf, p.red, 2);
    H.line(ctx, f, Cost, p.cyan, 2, [5, 4]);
    H.line(ctx, f, vn, p.green, 2.4);
    ctx.fillStyle = p.green;
    ctx.beginPath(); ctx.arc(f.X(bestC), f.Y(1), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'red: P(forget)   cyan: attention cost   green: value/FLOP', p.mute, p);
    H.metric(w, 'tokens', fmtN(bestC * tpf) + ' tok');
    H.metric(w, 'attn', fmtN(Math.pow(bestC * tpf, 2)) + ' pair-ops');
    H.metric(w, 'forget', (100 * Math.exp(-bestC / gap)).toFixed(1) + '%');
    H.metric(w, 'best', bestC + ' frames');
    H.metric(w, 'verdict', bestC >= 250 ? 'permanence needs retrieval, not more context'
             : 'context ' + bestC + ' clears the revisit gap');
  };

  /* 09 · stage when conflict beats forgetting */
  R['stages'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var conf = H.value(w, 'conflict', 0.45), lam = H.value(w, 'forget', 0.20);
    var replay = H.value(w, 'replay', 0) / 100;
    var nObj = 4;
    var joint = 1 / (1 + conf * (nObj - 1));
    var lamEff = lam * (1 - replay);
    var staged = Math.pow(1 - lamEff, nObj - 1) * (1 - replay * 0.06);
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 1, ylabel: 'end-of-training capability' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, [joint, staged], [p.cyan, p.accent],
           ['joint (all objectives at once)', 'staged (' + nObj + ' stages, replay ' + (100 * replay).toFixed(0) + '%)'],
           p, function (v) { return v.toFixed(2); });
    var xstar = lam > 0 ? (Math.pow(1 - lamEff, nObj - 1) === 0 ? 0 : (1 / Math.pow(1 - lamEff, nObj - 1) - 1) / (nObj - 1)) : 0;
    H.metric(w, 'joint', joint.toFixed(3));
    H.metric(w, 'staged', staged.toFixed(3));
    H.metric(w, 'cross', 'conflict > ' + xstar.toFixed(2));
    H.metric(w, 'verdict', staged > joint ? 'stage it — conflict dominates forgetting'
             : 'train jointly — forgetting costs more than the conflict');
  };

  /* 10 · mixture design against real availability (log-diminishing repeats) */
  R['mix'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var budget = Math.pow(10, H.value(w, 'budget', 4.7));  /* hours of training data drawn */
    var wB = H.value(w, 'broad', 60), wD = H.value(w, 'indomain', 20);
    var wA = H.value(w, 'grounded', 8), wS = H.value(w, 'sim', 12);
    var sum = wB + wD + wA + wS || 1;
    var src = [
      { nm: 'broad video', share: wB / sum, avail: 1e6, col: p.cyan,  cov: 1.0, hand: 0.0, real: 1 },
      { nm: 'in-domain video', share: wD / sum, avail: 1e4, col: p.accent, cov: 0.6, hand: 0.0, real: 1 },
      { nm: 'action-grounded', share: wA / sum, avail: 350, col: p.red, cov: 0.2, hand: 1.0, real: 1 },
      { nm: 'simulation', share: wS / sum, avail: 1e9, col: p.green, cov: 0.5, hand: 0.9, real: 0.45 }
    ];
    var i, eff = [], maxEp = 1, epochs = [];
    for (i = 0; i < 4; i++) {
      var want = budget * src[i].share;
      var ep = want / src[i].avail;
      epochs.push(ep);
      eff.push(ep <= 1 ? want : src[i].avail * (1 + Math.log(ep)));
      if (ep > maxEp) maxEp = ep;
    }
    var covH = 0, hanH = 0, relH = 0;
    for (i = 0; i < 4; i++) {
      covH += eff[i] * src[i].cov;
      hanH += eff[i] * src[i].hand;
      relH += eff[i] * src[i].real;
    }
    function sat(x, k) { return 1 - Math.exp(-x / k); }
    var fid = sat(covH, 4e4), ctr = sat(hanH, 1200), rel = sat(relH, 3e4);
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 1, ylabel: 'score' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, [fid, ctr, rel], [p.cyan, p.accent, p.green],
           ['fidelity', 'controllability', 'real-world relevance'], p,
           function (v) { return v.toFixed(2); });
    var worst = 0;
    for (i = 1; i < 4; i++) if (epochs[i] > epochs[worst]) worst = i;
    H.metric(w, 'fid', fid.toFixed(2));
    H.metric(w, 'ctrl', ctr.toFixed(2));
    H.metric(w, 'rel', rel.toFixed(2));
    H.metric(w, 'epochs', epochs[worst].toFixed(1) + '× on ' + src[worst].nm);
    H.metric(w, 'verdict', epochs[worst] > 8 ? 'you are re-reading the scarce source ' + epochs[worst].toFixed(0) + '× — buy more, do not up-weight'
             : ctr < 0.4 ? 'no handle: raise the grounded or sim share' : 'balanced mixture');
  };

  /* 11 · post-training cannot cross the tokenizer ceiling */
  R['post'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var ceil = H.value(w, 'ceiling', 0.72), hrs = H.value(w, 'hours', 40);
    var f = H.frame(ctx, g.w, g.h, p, { xmin: 0, xmax: 200, ymin: 0, ymax: 1,
      xlabel: 'post-training hours (curated, controllable)', ylabel: 'capability' });
    H.grid(ctx, f, p, 4, 4);
    var Cc = [], Sm = [], hq;
    for (hq = 0; hq <= 200; hq += 2) {
      Cc.push([hq, ceil * (1 - Math.exp(-hq / 28))]);
      Sm.push([hq, 0.96 * (1 - Math.exp(-hq / 22))]);
    }
    H.line(ctx, f, Cc, p.accent, 2.4);
    H.line(ctx, f, Sm, p.green, 2, [5, 4]);
    ctx.strokeStyle = p.red; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(ceil)); ctx.lineTo(f.x1, f.Y(ceil)); ctx.stroke();
    H.badge(ctx, f.x0 + 6, f.Y(ceil) - 13, 'tokenizer ceiling', p.red, p);
    ctx.fillStyle = p.accent;
    var cur = ceil * (1 - Math.exp(-hrs / 28));
    ctx.beginPath(); ctx.arc(f.X(hrs), f.Y(cur), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'violet: contact control (capped)   green: semantics (uncapped)', p.mute, p);
    var closed = 100 * cur / (ceil || 1);
    H.metric(w, 'cap', cur.toFixed(3));
    H.metric(w, 'ceiling', ceil.toFixed(2));
    H.metric(w, 'closed', closed.toFixed(0) + '% of headroom');
    H.metric(w, 'marginal', (ceil * Math.exp(-hrs / 28) / 28).toFixed(4) + ' / h');
    H.metric(w, 'verdict', closed > 92 ? 'headroom spent — retrain the tokenizer (§3), not the policy head'
             : 'post-training still paying');
  };

  /* 12 · distil until the control tick fits */
  R['distil'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var ms = H.value(w, 'msperstep', 11), tick = H.value(w, 'tick', 50), gap = H.value(w, 'gap', 6) / 100;
    var f = H.frame(ctx, g.w, g.h, p, { left: 54, xmin: 0, xmax: 600, ymin: 0, ymax: 1,
      xlabel: 'latency per world-model step (ms)', ylabel: 'rollout quality' });
    H.grid(ctx, f, p, 4, 4);
    var T = [], S = [], N, tq = 0, sq = 0, tN = 0, sN = 0;
    for (N = 1; N <= 60; N++) {
      var lat = N * ms;
      var qt = 0.97 * (1 - Math.exp(-N / 9));
      var qs = (0.97 - gap) * (1 - Math.exp(-N / 1.5));
      if (lat <= 600) { T.push([lat, qt]); S.push([lat, qs]); }
      if (lat <= tick) { tq = qt; tN = N; sq = qs; sN = N; }
    }
    H.line(ctx, f, T, p.cyan, 2.4);
    H.line(ctx, f, S, p.green, 2.4);
    ctx.strokeStyle = p.red; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.X(tick), f.y1); ctx.lineTo(f.X(tick), f.y0); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.X(tick) + 6, f.y1 + 12, tick + ' ms tick', p.red, p);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'cyan: teacher   green: distilled student', p.mute, p);
    H.metric(w, 'steps', tN + ' steps');
    H.metric(w, 'teacher', tq.toFixed(3));
    H.metric(w, 'student', sq.toFixed(3));
    H.metric(w, 'hz', (1000 / tick).toFixed(0) + ' Hz');
    H.metric(w, 'verdict', sq > tq ? 'distil: ' + ((sq - tq) / (tq || 1e-9) * 100).toFixed(0) + '% more quality inside the tick'
             : 'the teacher already fits — do not distil');
  };

  /* 13 · optimiser pressure: apparent gain vs realised gain */
  R['eval'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var d = H.value(w, 'delta', 0.35), tru = H.value(w, 'true', 1.4);
    var f = H.frame(ctx, g.w, g.h, p, { left: 52, xmin: 0, xmax: 4, ymin: -1.5, ymax: 3,
      xlabel: 'log₁₀ candidate plans K', ylabel: 'return' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], Rz = [], i, bestK = 1, bv = -1e9;
    for (i = 0; i <= 4.001; i += 0.04) {
      var K = Math.pow(10, i);
      var gapv = d * Math.sqrt(2 * Math.log(Math.max(2, K)));
      var app = tru * (1 - Math.exp(-K / 40)) + gapv;
      var real = tru * (1 - Math.exp(-K / 40)) - gapv;
      A.push([i, app]); Rz.push([i, real]);
      if (real > bv) { bv = real; bestK = K; }
    }
    H.line(ctx, f, A, p.amber, 2.4);
    H.line(ctx, f, Rz, p.green, 2.4);
    ctx.strokeStyle = p.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(0)); ctx.lineTo(f.x1, f.Y(0)); ctx.stroke();
    ctx.fillStyle = p.green;
    ctx.beginPath(); ctx.arc(f.X(Math.log(bestK) / Math.LN10), f.Y(bv), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'amber: what the report shows   green: what the robot gets', p.mute, p);
    var gk = d * Math.sqrt(2 * Math.log(Math.max(2, bestK)));
    H.metric(w, 'gap', gk.toFixed(3));
    H.metric(w, 'bestk', 'K* ≈ ' + fmtN(bestK));
    H.metric(w, 'realised', bv.toFixed(3));
    H.metric(w, 'verdict', bv <= 0 ? 'every plan the optimiser likes is a model bug — δ is too large'
             : 'search to K* ≈ ' + fmtN(bestK) + ', no further');
  };

  /* 14 · the whole bill */
  R['bill'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var res = H.value(w, 'res', 256), fps = H.value(w, 'fps', 8);
    var hours = Math.pow(10, H.value(w, 'hours', 4.7));
    var params = Math.pow(10, H.value(w, 'params', 9.5));
    var patch = 16, gpuF = 4e14, util = 0.4, rate = 2.5;
    var tpf = Math.pow(res / patch, 2);
    var tokens = hours * 3600 * fps * tpf;
    var flops = 6 * params * tokens;
    var gpuh = flops / (gpuF * util * 3600);
    var usd = gpuh * rate;
    var days = gpuh / (512 * 24);
    var f = H.frame(ctx, g.w, g.h, p, { left: 120, xmin: 0, xmax: 24, ymin: 0, ymax: 4,
      xlabel: 'log₁₀ magnitude' });
    H.grid(ctx, f, p, 6, 4);
    var rows = [['tokens', tokens, p.cyan, 3.4], ['training FLOPs', flops, p.accent, 2.5],
                ['GPU-hours', gpuh, p.amber, 1.6], ['USD (at $' + rate + '/GPU-h)', usd, p.green, 0.7]];
    for (var i = 0; i < rows.length; i++) {
      var v = Math.max(0, Math.log(Math.max(1, rows[i][1])) / Math.LN10);
      var y = f.Y(rows[i][3]);
      ctx.fillStyle = rows[i][2];
      ctx.fillRect(f.x0, y - 13, Math.max(2, f.X(v) - f.x0), 26);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right'; ctx.fillText(rows[i][0], f.x0 - 7, y);
      ctx.fillStyle = p.text; ctx.textAlign = 'left';
      ctx.fillText(fmtN(rows[i][1]), Math.min(f.X(v) + 6, f.x1 - 60), y);
    }
    for (var k = 0; k <= 24; k += 6) H.tick(ctx, f, p, 'x', k, '10' + sup(k));
    H.metric(w, 'tpf', tpf.toFixed(0) + ' tok/frame');
    H.metric(w, 'tokens', fmtN(tokens) + ' tok');
    H.metric(w, 'flops', fmtN(flops) + ' FLOPs');
    H.metric(w, 'gpuh', fmtN(gpuh) + ' GPU-h');
    H.metric(w, 'usd', '$' + fmtN(usd));
    H.metric(w, 'wall', days < 1 ? (days * 24).toFixed(1) + ' h on 512 GPUs' : days.toFixed(1) + ' d on 512 GPUs');
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
  function fmtH(v) { return fmtN(v); }
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
