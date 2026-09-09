/* ============================================================================
   Widget engine. One renderer per lesson, keyed by canvas[data-demo="KEY"].
   Wiring contract (identical to ../world_models/visuals.js):
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

  /* shared source ledger — every figure traceable to FACTS */
  var SRC = [
    { nm: 'web text',            hrs: 0,       tokh: 0,       tok: 15e12, usd: 0.0002, act: 0, con: 0, onp: 0, sem: 1.0, dyn: 0.0, ctl: 0.0 },
    { nm: 'web video',           hrs: 1e9,     tokh: 7.37e6,  tok: 0,     usd: 0.02,   act: 0, con: 0, onp: 0, sem: 1.0, dyn: 0.7, ctl: 0.0 },
    { nm: 'egocentric video',    hrs: 3670,    tokh: 7.37e6,  tok: 0,     usd: 0.5,    act: 0.3, con: 0, onp: 0, sem: 0.9, dyn: 0.8, ctl: 0.2 },
    { nm: 'simulation',          hrs: 1e9,     tokh: 7.37e6,  tok: 0,     usd: 0.02,   act: 1, con: 1, onp: 0, sem: 0.3, dyn: 0.5, ctl: 0.9, unb: 1 },
    { nm: 'pooled robot (OXE)',  hrs: 5000,    tokh: 7.37e6,  tok: 0,     usd: 8,      act: 1, con: 0.1, onp: 0, sem: 0.5, dyn: 1.0, ctl: 0.8 },
    { nm: 'your teleop',         hrs: 350,     tokh: 7.37e6,  tok: 0,     usd: 45,     act: 1, con: 0.3, onp: 0, sem: 0.4, dyn: 1.0, ctl: 1.0 },
    { nm: 'force / tactile',     hrs: 60,      tokh: 3.6e6,   tok: 0,     usd: 55,     act: 1, con: 1, onp: 0, sem: 0.1, dyn: 1.0, ctl: 1.0 },
    { nm: 'on-policy corrections', hrs: 40,    tokh: 7.37e6,  tok: 0,     usd: 60,     act: 1, con: 0.3, onp: 1, sem: 0.3, dyn: 1.0, ctl: 1.0 }
  ];

  function hbars(ctx, f, p, rows, fmt) {
    var n = rows.length, lane = (f.y0 - f.y1) / n;
    for (var i = 0; i < n; i++) {
      var y = f.y1 + lane * (i + 0.5);
      var v = Math.max(0, Math.log(Math.max(1, rows[i][1])) / Math.LN10);
      ctx.fillStyle = rows[i][2];
      ctx.fillRect(f.x0, y - lane * 0.33, Math.max(2, f.X(v) - f.x0), lane * 0.66);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right';
      ctx.fillText(rows[i][0], f.x0 - 7, y);
      ctx.fillStyle = p.text; ctx.textAlign = 'left';
      ctx.fillText(fmt(rows[i][1]), Math.min(f.X(v) + 6, f.x1 - 52), y);
    }
  }

  /* 00 · the two rankings, side by side */
  R['rank'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var by = H.value(w, 'rankby', 'volume');
    var cap = H.value(w, 'capability', 'ctl');
    var cols = [p.cyan, p.cyan, p.accent, p.green, p.amber, p.red, p.red, p.red];
    var rows = [], i;
    for (i = 0; i < SRC.length; i++) {
      var s = SRC[i];
      var vol = s.tok ? s.tok : s.hrs * s.tokh;
      var yield_ = cap === 'sem' ? s.sem : cap === 'dyn' ? s.dyn : s.ctl;
      var val = yield_ / Math.max(1e-4, s.usd);
      if (by === 'value' && s.hrs <= 0) continue;   /* no hours ⇒ no per-hour value */
      if (by === 'volume' && s.unb) continue;       /* unbounded ⇒ not an existing corpus */
      rows.push([s.nm, by === 'volume' ? vol : val, cols[i], vol, val]);
    }
    rows.sort(function (a, b) { return b[1] - a[1]; });
    var f = H.frame(ctx, g.w, g.h, p, { left: 132, xmin: 0, xmax: by === 'volume' ? 17 : 4.2,
      ymin: 0, ymax: 1, xlabel: by === 'volume' ? 'log₁₀ tokens available' : 'log₁₀ useful yield per dollar', top: 12, bottom: 30 });
    hbars(ctx, f, p, rows, by === 'volume' ? fmtN : function (v) { return v.toFixed(v < 1 ? 2 : 0); });
    /* Both rankings are computed over their own correct population, independent of which
       view is displayed: volume over EXISTING corpora (simulation is unbounded, not a corpus;
       text has no hours but does have tokens), value over sources measurable per hour. */
    var volPop = [], valPop = [], finPop = [], k, PRIMARY = 0.5;
    for (k = 0; k < SRC.length; k++) {
      var q = SRC[k];
      var v = q.tok ? q.tok : q.hrs * q.tokh;
      var yq = cap === 'sem' ? q.sem : cap === 'dyn' ? q.dyn : q.ctl;
      if (!q.unb) volPop.push([q.nm, v]);
      /* A source whose yield for this capability is below PRIMARY cannot be its primary
         supplier at any price — a ceiling, not a small number (see lesson 02 §3). */
      if (q.hrs > 0 && yq >= PRIMARY) {
        valPop.push([q.nm, yq / Math.max(1e-4, q.usd), v, q.unb ? 1 : 0]);
        if (!q.unb) finPop.push([q.nm, yq / Math.max(1e-4, q.usd), v]);
      }
    }
    volPop.sort(function (a, b) { return b[1] - a[1]; });
    valPop.sort(function (a, b) { return b[1] - a[1]; });
    finPop.sort(function (a, b) { return b[1] - a[1]; });
    var volTop = volPop[0], valTop = valPop[0], finTop = finPop[0];
    H.metric(w, 'volume', volTop[0]);
    H.metric(w, 'value', valTop[0] + (valTop[3] ? ' (unbounded)' : ''));
    /* the gap that matters: the volume leader against the best FINITE high-value source */
    H.metric(w, 'gap', fmtN(volTop[1] / Math.max(1, finTop[2])) + '× more tokens');
    H.metric(w, 'costgap', (SRC[7].usd / SRC[1].usd).toFixed(0) + '× the price');
    H.metric(w, 'verdict', volTop[0] === valTop[0] ? 'the rankings agree — the solved case'
             : 'largest: ' + volTop[0] + ' · best value: ' + valTop[0]
               + (valTop[3] ? ' (bounded support)' : '') + ' · best finite: ' + finTop[0]);
  };

  /* 01 · the right unit: bytes → tokens → decision bits */
  R['unit'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var res = H.value(w, 'res', 256), fps = H.value(w, 'fps', 8), patch = H.value(w, 'patch', 16);
    var dec = H.value(w, 'decision', 10);
    var tpf = Math.pow(res / patch, 2);
    var tokPerH = tpf * fps * 3600;
    var bytesPerH = res * res * 3 * fps * 3600;
    var decBits = dec * fps * 3600;
    var textTokPerH = 200 * 60;
    var rows = [['raw bytes / hour', bytesPerH, p.cyan],
                ['tokens / hour', tokPerH, p.accent],
                ['text tokens / hour (speech)', textTokPerH, p.amber],
                ['decision-relevant bits / hour', decBits, p.red]];
    var f = H.frame(ctx, g.w, g.h, p, { left: 156, xmin: 0, xmax: 11, ymin: 0, ymax: 1,
      xlabel: 'log₁₀', top: 12, bottom: 30 });
    hbars(ctx, f, p, rows, fmtN);
    H.metric(w, 'tpf', tpf.toFixed(0) + ' tok/frame');
    H.metric(w, 'tokh', fmtN(tokPerH) + ' tok/h');
    H.metric(w, 'density', (tokPerH / textTokPerH).toFixed(0) + '× text');
    H.metric(w, 'waste', (100 * decBits / tokPerH).toFixed(4) + '% decision bits');
    H.metric(w, 'verdict', tokPerH / textTokPerH > 100 ? 'video dominates any token-count ranking'
             : 'coarse enough to compare with text');
  };

  /* 02 · cost per useful bit, per capability */
  R['cpub'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var cap = H.value(w, 'capability', 'ctl');
    var cols = [p.cyan, p.cyan, p.accent, p.green, p.amber, p.red, p.red, p.red];
    var rows = [], i;
    for (i = 0; i < SRC.length; i++) {
      var s = SRC[i];
      if (s.hrs <= 0) continue;            /* text has no "hours" — excluded from a per-hour axis */
      var y = cap === 'sem' ? s.sem : cap === 'dyn' ? s.dyn : cap === 'con' ? s.con : s.ctl;
      if (y <= 0) continue;
      rows.push([s.nm, Math.max(1e-4, s.usd) / y, cols[i]]);
    }
    rows.sort(function (a, b) { return a[1] - b[1]; });
    var f = H.frame(ctx, g.w, g.h, p, { left: 132, xmin: -4, xmax: 3, ymin: 0, ymax: 1,
      xlabel: 'log₁₀ dollars per useful hour (lower is better)', top: 12, bottom: 30 });
    var n = rows.length, lane = (f.y0 - f.y1) / n;
    for (i = 0; i < n; i++) {
      var yy = f.y1 + lane * (i + 0.5);
      var v = Math.log(rows[i][1]) / Math.LN10;
      ctx.fillStyle = rows[i][2];
      var x0 = f.X(-4), x1 = f.X(Math.max(-4, Math.min(3, v)));
      ctx.fillRect(x0, yy - lane * 0.33, Math.max(2, x1 - x0), lane * 0.66);
      ctx.fillStyle = p.mute; ctx.textAlign = 'right'; ctx.fillText(rows[i][0], f.x0 - 7, yy);
      ctx.fillStyle = p.text; ctx.textAlign = 'left';
      ctx.fillText('$' + (rows[i][1] < 0.01 ? rows[i][1].toExponential(1) : rows[i][1].toFixed(2)), Math.min(x1 + 6, f.x1 - 52), yy);
    }
    H.metric(w, 'best', rows[0][0]);
    H.metric(w, 'bestcost', '$' + (rows[0][1] < 0.01 ? rows[0][1].toExponential(1) : rows[0][1].toFixed(2)) + '/h');
    H.metric(w, 'worst', rows[rows.length - 1][0]);
    H.metric(w, 'spread', fmtN(rows[rows.length - 1][1] / Math.max(1e-9, rows[0][1])) + '×');
    H.metric(w, 'verdict', cap === 'sem' ? 'buy semantics from the web — it is nearly free'
             : cap === 'dyn' ? 'sim and pooled robot data carry dynamics cheaply'
             : cap === 'con' ? 'sim is cheapest and contested; otherwise force sensing only'
             : 'simulation is the only cheap source — bounded support is the price');
  };

  /* 03 · the curation funnel */
  R['ocean'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var raw = Math.pow(10, H.value(w, 'raw', 6));
    var dedup = H.value(w, 'dedup', 30) / 100;
    var motion = H.value(w, 'motion', 45) / 100;
    var caption = H.value(w, 'caption', 35) / 100;
    var stages = [
      ['raw crawl', raw, p.cyan],
      ['after de-duplication', raw * (1 - dedup), p.cyan],
      ['after motion / static filter', raw * (1 - dedup) * (1 - motion), p.accent],
      ['after caption-quality filter', raw * (1 - dedup) * (1 - motion) * (1 - caption), p.amber],
      ['with usable hand-object interaction', raw * (1 - dedup) * (1 - motion) * (1 - caption) * 0.12, p.red]
    ];
    var f = H.frame(ctx, g.w, g.h, p, { left: 176, xmin: 0, xmax: Math.max(3, Math.log(raw) / Math.LN10 + 0.4),
      ymin: 0, ymax: 1, xlabel: 'log₁₀ hours surviving', top: 12, bottom: 30 });
    hbars(ctx, f, p, stages, fmtN);
    var fin = stages[4][1];
    H.metric(w, 'raw', fmtN(raw) + ' h');
    H.metric(w, 'kept', fmtN(stages[3][1]) + ' h');
    H.metric(w, 'survival', (100 * stages[3][1] / raw).toFixed(1) + '%');
    H.metric(w, 'usable', fmtN(fin) + ' h');
    H.metric(w, 'tokens', fmtN(fin * 7.37e6) + ' tok');
  };

  /* 04 · egocentric corpora, and the number that gets misquoted */
  R['ego'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var contact = H.value(w, 'contact', 35) / 100;
    var rows = [
      ['Ego4D (all)', 3670, p.accent],
      ['Ego-Exo4D (all cameras)', 1286, p.dim],
      ['Ego-Exo4D (egocentric only)', 221, p.amber],
      ['Ego4D × hand-object frames', 3670 * contact, p.green],
      ['DROID real robot, for scale', 350, p.red]
    ];
    var f = H.frame(ctx, g.w, g.h, p, { left: 178, xmin: 0, xmax: 4.2, ymin: 0, ymax: 1,
      xlabel: 'log₁₀ hours', top: 12, bottom: 30 });
    hbars(ctx, f, p, rows, function (v) { return fmtN(v) + ' h'; });
    H.metric(w, 'ego4d', '3,670 h');
    H.metric(w, 'egoexo', '221 h (not 1,286)');
    H.metric(w, 'usable', fmtN(3670 * contact) + ' h');
    H.metric(w, 'ratio', (3670 * contact / 350).toFixed(1) + '× DROID');
    H.metric(w, 'verdict', contact < 0.2 ? 'most egocentric video is walking, not manipulating'
             : 'a real multiple of all public robot data — but no actions');
  };

  /* 05 · simulation: compute is free, authoring is not */
  R['simcap'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var envs = H.value(w, 'envs', 4096), rate = H.value(w, 'rate', 60);
    var authH = H.value(w, 'author', 8), nsc = H.value(w, 'scen', 200);
    var steps = envs * rate;
    var robotH = steps / rate;
    var authorCost = nsc * authH * 60;
    var computeCost = 0.02 * robotH;
    var f = H.frame(ctx, g.w, g.h, p, { left: 152, xmin: 0, xmax: 7, ymin: 0, ymax: 1,
      xlabel: 'log₁₀ dollars per wall-clock hour of generation', top: 12, bottom: 30 });
    var rows = [['GPU compute', computeCost, p.green],
                ['scenario authoring (amortised over 1 yr)', authorCost / 8760, p.red],
                ['teleoperation, same experience', robotH * 45, p.amber]];
    hbars(ctx, f, p, rows, function (v) { return '$' + fmtN(v); });
    H.metric(w, 'steps', fmtN(steps) + ' steps/s');
    H.metric(w, 'robotdays', (robotH / 24).toFixed(0) + ' robot-days/h');
    H.metric(w, 'authoring', '$' + fmtN(authorCost));
    H.metric(w, 'ratio', fmtN((robotH * 45) / Math.max(0.01, computeCost + authorCost / 8760)) + '× cheaper');
    H.metric(w, 'verdict', authorCost / 8760 > computeCost * 3 ? 'authoring dominates — sim cost is engineering, not GPUs'
             : 'compute-dominated: raise scenario diversity');
  };

  /* 06 · the expensive kernel */
  R['kernel'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var ops = H.value(w, 'ops', 4), days = H.value(w, 'days', 120), cyc = H.value(w, 'cycle', 60);
    var eps = (3600 / cyc) * 6 * days * ops;
    var hrs = eps * (cyc * 0.7) / 3600;
    var rows = [['Open X-Embodiment (1M+ traj)', 1e6, p.amber],
                ['DROID (76k traj)', 76000, p.accent],
                ['BridgeData V2 (~60k traj)', 60000, p.cyan],
                ['your programme', eps, p.green],
                ['V-JEPA 2-AC grounding stage', 62 * 3600 / (cyc * 0.7), p.red]];
    var f = H.frame(ctx, g.w, g.h, p, { left: 176, xmin: 0, xmax: 6.4, ymin: 0, ymax: 1,
      xlabel: 'log₁₀ trajectories', top: 12, bottom: 30 });
    hbars(ctx, f, p, rows, fmtN);
    H.metric(w, 'eps', fmtN(eps) + ' episodes');
    H.metric(w, 'hours', fmtN(hrs) + ' h');
    H.metric(w, 'tokens', fmtN(hrs * 7.37e6) + ' tok');
    H.metric(w, 'vsdroid', (100 * eps / 76000).toFixed(0) + '% of DROID');
    H.metric(w, 'vstext', fmtN(15e12 / Math.max(1, hrs * 7.37e6)) + '× less than 15T');
  };

  /* 07 · action labels as currency: two routes to a grounded hour */
  R['currency'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var U = Math.pow(10, H.value(w, 'unlab', 4.85));
    var teleop = H.value(w, 'teleop', 45);
    var idmCost = H.value(w, 'idmcost', 25000);
    var amax = H.value(w, 'ceiling', 92) / 100;
    var L0 = 250, gam = 0.9, nA = 64, bits = Math.log(nA) / Math.LN2;
    function acc(L) { return amax * (1 - Math.pow(L0 / (L0 + L), gam)); }
    function eff(L) {
      var a = acc(L), e = 1 - a;
      if (e <= 1e-6) return 1;
      var Hb = -a * Math.log(a) / Math.LN2 - e * Math.log(e / (nA - 1)) / Math.LN2;
      return Math.max(0, (bits - Hb) / bits);
    }
    var f = H.frame(ctx, g.w, g.h, p, { left: 58, xmin: 1, xmax: 4.2, ymin: -1.2, ymax: 2.2,
      xlabel: 'log₁₀ labeled hours bought', ylabel: 'log₁₀ $ / grounded h' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], B = [], i, bestL = 10, bv = 1e9;
    for (i = 1; i <= 4.2001; i += 0.03) {
      var L = Math.pow(10, i);
      var direct = teleop;
      var viaIdm = (L * teleop + idmCost) / Math.max(1e-6, L + U * eff(L));
      A.push([i, Math.log(direct) / Math.LN10]);
      B.push([i, Math.log(Math.max(1e-3, viaIdm)) / Math.LN10]);
      if (viaIdm < bv) { bv = viaIdm; bestL = L; }
    }
    H.line(ctx, f, A, p.amber, 2.2, [5, 4]);
    H.line(ctx, f, B, p.accent, 2.6);
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(f.X(Math.log(bestL) / Math.LN10), f.Y(Math.log(Math.max(1e-3, bv)) / Math.LN10), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'dashed: direct teleop   solid: label + pseudo-label', p.mute, p);
    H.metric(w, 'direct', '$' + teleop.toFixed(0) + '/h');
    H.metric(w, 'via', '$' + bv.toFixed(2) + '/h');
    H.metric(w, 'best', fmtN(bestL) + ' labeled h');
    H.metric(w, 'saving', (teleop / Math.max(1e-6, bv)).toFixed(0) + '× cheaper');
    H.metric(w, 'verdict', bv < teleop ? 'pseudo-labelling wins by ' + (teleop / bv).toFixed(0) + '×'
             : 'ocean too small — collect directly');
  };

  /* 08 · the dearest bits: instrument once, then it is free */
  R['dearest'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var rig = H.value(w, 'rig', 3000), months = H.value(w, 'months', 12);
    var hpm = H.value(w, 'hpm', 90);
    var f = H.frame(ctx, g.w, g.h, p, { left: 54, xmin: 0, xmax: 24, ymin: 0, ymax: Math.max(200, hpm * 24 * 1.1),
      xlabel: 'months', ylabel: 'force-hours owned' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], B = [], m;
    for (m = 0; m <= 24; m++) {
      A.push([m, m >= 1 ? (m - 1) * hpm : 0]);
      B.push([m, 0]);
    }
    H.area(ctx, f, A, p.green, .14);
    H.line(ctx, f, A, p.green, 2.6);
    H.line(ctx, f, B, p.red, 2.6);
    ctx.strokeStyle = p.accent; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(f.X(months), f.y1); ctx.lineTo(f.X(months), f.y0); ctx.stroke();
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'green: instrumented at month 1   red: not instrumented', p.mute, p);
    var owned = Math.max(0, (months - 1) * hpm);
    H.metric(w, 'rig', '$' + fmtN(rig));
    H.metric(w, 'owned', fmtN(owned) + ' force-h');
    H.metric(w, 'perhour', owned > 0 ? '$' + (rig / owned).toFixed(2) + '/h' : '—');
    H.metric(w, 'public', '≈ 0 h available publicly');
    H.metric(w, 'verdict', owned > 350 ? 'you now own more force-hours than all public robot data has'
             : 'still accumulating — but the alternative accumulates nothing');
  };

  /* 09 · on-policy data is perishable — optimal retrain cadence */
  R['perish'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var rho = H.value(w, 'rho', 0.82);          /* weekly retention */
    var M = H.value(w, 'rate', 400);            /* corrections per week */
    var ov = H.value(w, 'overhead', 1.0);       /* weeks of retrain overhead */
    var lg = Math.log(1 / rho);
    var f = H.frame(ctx, g.w, g.h, p, { left: 58, xmin: 0.5, xmax: 16, ymin: 0, ymax: 1,
      xlabel: 'retrain interval T (weeks)', ylabel: 'useful corrections absorbed / week' });
    H.grid(ctx, f, p, 4, 4);
    var A = [], T, bt = 1, bv = -1, raw = [];
    for (T = 0.5; T <= 16; T += 0.1) {
      var useful = M * (1 - Math.pow(rho, T)) / lg;
      var perWeek = useful / (T + ov);
      raw.push([T, perWeek]);
      if (perWeek > bv) { bv = perWeek; bt = T; }
    }
    for (T = 0; T < raw.length; T++) A.push([raw[T][0], raw[T][1] / (bv || 1)]);
    H.line(ctx, f, A, p.accent, 2.6);
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(f.X(bt), f.Y(1), 4, 0, 6.2832); ctx.fill();
    H.badge(ctx, f.X(bt) + 8, f.Y(1) - 12, 'T* = ' + bt.toFixed(1) + ' wk', p.accent, p);
    var half = Math.log(0.5) / Math.log(rho);
    var wasted = 1 - (1 - Math.pow(rho, bt)) / (bt * lg);
    H.metric(w, 'half', half.toFixed(1) + ' weeks');
    H.metric(w, 'best', 'T* = ' + bt.toFixed(1) + ' wk');
    H.metric(w, 'absorbed', fmtN(bv) + ' /week');
    H.metric(w, 'wasted', (100 * Math.max(0, wasted)).toFixed(0) + '% depreciated');
    H.metric(w, 'verdict', bt < 2 ? 'retrain almost continuously — this asset rots fast'
             : bt > 10 ? 'slow-moving policy: batch the corrections' : 'retrain every ' + bt.toFixed(0) + ' weeks');
  };

  /* 10 · the allocation problem */
  R['alloc'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var budget = Math.pow(10, H.value(w, 'budget', 5));
    var wWeb = H.value(w, 'web', 20), wSim = H.value(w, 'sim', 25);
    var wTel = H.value(w, 'teleop', 35), wCor = H.value(w, 'corr', 20);
    var sum = wWeb + wSim + wTel + wCor || 1;
    var alloc = [
      { s: SRC[1], sh: wWeb / sum },
      { s: SRC[3], sh: wSim / sum },
      { s: SRC[5], sh: wTel / sum },
      { s: SRC[7], sh: wCor / sum }
    ];
    var sem = 0, dyn = 0, ctl = 0, con = 0, i, hrs = [];
    for (i = 0; i < alloc.length; i++) {
      var h = budget * alloc[i].sh / alloc[i].s.usd;
      var capped = Math.min(h, alloc[i].s.hrs > 0 ? Math.max(alloc[i].s.hrs, h > alloc[i].s.hrs && alloc[i].s.hrs >= 1e8 ? h : alloc[i].s.hrs) : h);
      if (alloc[i].s.hrs < 1e8) capped = alloc[i].s.hrs * (1 + Math.max(0, Math.log(Math.max(1, h / alloc[i].s.hrs))));
      hrs.push(capped);
      sem += capped * alloc[i].s.sem;
      dyn += capped * alloc[i].s.dyn;
      ctl += capped * alloc[i].s.ctl;
      con += capped * alloc[i].s.con;
    }
    function sat(x, k) { return 1 - Math.exp(-x / k); }
    var S = [sat(sem, 3e4), sat(dyn, 2e4), sat(ctl, 900), sat(con, 220)];
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 1, ylabel: 'capability' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, S, [p.cyan, p.accent, p.amber, p.red],
           ['semantics', 'dynamics', 'control', 'contact'], p, function (v) { return v.toFixed(2); });
    var worst = 0;
    for (i = 1; i < 4; i++) if (S[i] < S[worst]) worst = i;
    var names = ['semantics', 'dynamics', 'control', 'contact'];
    H.metric(w, 'sem', S[0].toFixed(2));
    H.metric(w, 'dyn', S[1].toFixed(2));
    H.metric(w, 'ctl', S[2].toFixed(2));
    H.metric(w, 'con', S[3].toFixed(2));
    H.metric(w, 'verdict', 'weakest: ' + names[worst] + ' — buy ' + (worst >= 2 ? 'teleop / corrections' : 'web video or sim'));
  };

  /* 11 · duplicates, and training on your own output */
  R['collapse'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var dup = H.value(w, 'dup', 40) / 100;
    var synth = H.value(w, 'synth', 30) / 100;
    var raw = Math.pow(10, H.value(w, 'raw', 5));
    var f = H.frame(ctx, g.w, g.h, p, { left: 52, xmin: 0, xmax: 10, ymin: 0, ymax: 1,
      xlabel: 'self-training generation', ylabel: 'tail coverage retained' });
    H.grid(ctx, f, p, 5, 4);
    var A = [], B = [], n, lam = 0.55;
    for (n = 0; n <= 10; n++) {
      A.push([n, Math.pow(1 - synth * lam, n)]);
      B.push([n, 1]);
    }
    H.line(ctx, f, B, p.green, 2, [5, 4]);
    H.area(ctx, f, A, p.red, .12);
    H.line(ctx, f, A, p.red, 2.6);
    H.badge(ctx, f.x0 + 6, f.y1 + 12, 'green: fresh real data each generation   red: recycled generations', p.mute, p);
    var eff = raw * (1 - dup);
    var cov3 = Math.pow(1 - synth * lam, 3);
    H.metric(w, 'raw', fmtN(raw) + ' episodes');
    H.metric(w, 'effective', fmtN(eff) + ' effective');
    H.metric(w, 'dupcost', (100 * dup).toFixed(0) + '% duplicated');
    H.metric(w, 'gen3', (100 * cov3).toFixed(0) + '% tail left at gen 3');
    H.metric(w, 'verdict', synth > 0.5 ? 'the rare cases vanish within a few generations'
             : synth > 0.15 ? 'anchor every generation with fresh real data' : 'safe recycling ratio');
  };

  /* 12 · the infrastructure bill: decode starves the GPUs */
  R['infra'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var cams = H.value(w, 'cams', 3), res = H.value(w, 'res', 480);
    var fps = H.value(w, 'fps', 30), comp = H.value(w, 'comp', 20);
    var cores = H.value(w, 'cores', 32);
    var bytesFrame = res * (res * 4 / 3) * 3;
    var rawPerS = bytesFrame * fps * cams;
    var gbPerH = rawPerS * 3600 / 1e9;
    var storedGbH = gbPerH / comp;
    var decPerCore = 200 * Math.pow(480 / res, 2);
    var capacity = cores * decPerCore;
    var demand = 256 * fps * cams / 8;
    var util = Math.min(1, capacity / Math.max(1, demand));
    var f = H.frame(ctx, g.w, g.h, p, { left: 150, xmin: 0, xmax: 5, ymin: 0, ymax: 1,
      xlabel: 'log₁₀ frames per second', top: 12, bottom: 30 });
    var rows = [['decode capacity (' + cores + ' cores)', capacity, util >= 1 ? p.green : p.red],
                ['decode demand (training)', demand, p.accent],
                ['frames written per second', fps * cams, p.cyan]];
    hbars(ctx, f, p, rows, fmtN);
    H.metric(w, 'raw', fmtN(gbPerH) + ' GB/h raw');
    H.metric(w, 'stored', fmtN(storedGbH) + ' GB/h stored');
    H.metric(w, 'yearly', fmtN(storedGbH * 2000 / 1000) + ' TB / 2000 h');
    H.metric(w, 'util', (100 * util).toFixed(0) + '% GPU fed');
    H.metric(w, 'verdict', util < 0.95 ? 'input-bound: ' + Math.ceil(demand / decPerCore) + ' cores needed, or pre-decode'
             : 'pipeline keeps up');
  };

  /* 13 · the honest answer, and what to buy next */
  R['answer'] = function (cv, w, H) {
    var g = H.fit(cv), ctx = g.ctx, p = H.pal(cv);
    var hWeb = Math.pow(10, H.value(w, 'web', 6));
    var hSim = Math.pow(10, H.value(w, 'sim', 4));
    var hTel = Math.pow(10, H.value(w, 'teleop', 2.4));
    var hCon = Math.pow(10, H.value(w, 'contact', 1));
    function sat(x, k) { return 1 - Math.exp(-x / k); }
    /* Simulation substitutes for control well and for contact only up to a ceiling —
       past it the contact model, not the hour count, is the binding limit (lessons 05, 08). */
    var simContactCredit = Math.min(hSim * 0.02, 100);
    var caps = [
      ['semantics', sat(hWeb * 1.0 + hSim * 0.3 + hTel * 0.4, 3e4)],
      ['dynamics',  sat(hWeb * 0.7 + hSim * 0.5 + hTel * 1.0, 2e4)],
      ['control',   sat(hSim * 0.15 + hTel * 1.0, 1500)],
      ['contact',   sat(simContactCredit + hCon * 1.0, 180)]
    ];
    var f = H.frame(ctx, g.w, g.h, p, { ymin: 0, ymax: 1, ylabel: 'capability' });
    H.grid(ctx, f, p, 0, 4);
    H.bars(ctx, f, [caps[0][1], caps[1][1], caps[2][1], caps[3][1]],
           [p.cyan, p.accent, p.amber, p.red],
           ['semantics', 'dynamics', 'control', 'contact'], p, function (v) { return v.toFixed(2); });
    ctx.strokeStyle = p.green; ctx.lineWidth = 1.4;
    if (ctx.setLineDash) ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(f.x0, f.Y(0.7)); ctx.lineTo(f.x1, f.Y(0.7)); ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    H.badge(ctx, f.x0 + 6, f.Y(0.7) - 13, 'usable', p.green, p);
    var totH = hWeb + hSim + hTel + hCon;
    var volShare = 100 * hWeb / totH;
    /* marginal cost to a team that INHERITS a pretrained trunk: web video is effectively free */
    var spendWeb = hWeb * 0.001, spendSim = hSim * 0.02, spendRobot = hTel * 45 + hCon * 55;
    var spend = spendWeb + spendSim + spendRobot;
    var costShare = 100 * spendRobot / Math.max(1e-9, spend);
    var worst = 0, i;
    for (i = 1; i < 4; i++) if (caps[i][1] < caps[worst][1]) worst = i;
    H.metric(w, 'tokens', fmtN(totH * 7.37e6) + ' tok');
    H.metric(w, 'volshare', volShare.toFixed(1) + '% is web video');
    H.metric(w, 'costshare', costShare.toFixed(1) + '% of spend is robot');
    H.metric(w, 'weakest', caps[worst][0] + ' (' + caps[worst][1].toFixed(2) + ')');
    H.metric(w, 'buy', worst === 3 ? 'instrument force — nothing else supplies it'
             : worst === 2 ? 'teleoperation and on-policy corrections'
             : 'web video or sim — both effectively free');
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
    if (a >= 1) return v.toFixed(1);
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
