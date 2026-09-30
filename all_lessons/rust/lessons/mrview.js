/* mrview.js — canvas views for the MiniRust widgets (Lessons 03-08).
 *
 * Pure drawing: every function takes a <canvas> and plain data produced by minirust.js
 * (MiniRust.run / MiniRust.analyze) and paints it. No layout state is kept between calls, so a
 * widget simply calls draw again whenever a control changes.
 *
 *   MRView.drawRun(canvas, { src, run, step, errors })     the stack / heap machine at event `step`
 *   MRView.drawLoans(canvas, { src, info, focus })         loans as regions over the source lines
 *   MRView.drawFlow(canvas, { src, fn, loans, errors, cursor, showEdges, showLive, table })
 *                                                          Lesson 07: loans in scope, liveness, control-flow arcs, B/A/U
 *   MRView.drawContract(canvas, { grid, si, bi, ci, src, errors })
 *                                                          Lesson 08: one signature, four bodies, three callers — each cell is two checks
 *   MRView.contractGrid / contractRun / contractIndependence / contractInfo   the DOM-free side of that widget
 *   MRView.colors()                                        the track palette read from the page's CSS
 */
(function (root) {
  'use strict';
  var V = {};

  function cssv(n, fb) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; } catch (e) { return fb; }
  }
  V.colors = function () {
    return {
      own: cssv('--own', '#334155'), shared: cssv('--shared', '#2563eb'), excl: cssv('--excl', '#d97706'), moved: cssv('--moved', '#94a3b8'),
      live: cssv('--live', '#7c3aed'), err: cssv('--err', '#dc2626'), good: cssv('--good', '#16a34a'),
      text: cssv('--text', '#1f2430'), mute: cssv('--text-mute', '#5b6573'), dim: cssv('--text-dim', '#94a3b8'),
      border: cssv('--border', '#dde2ea'), bg: cssv('--bg', '#ffffff'), soft: cssv('--bg-soft', '#f4f6fa'), elev: cssv('--bg-elev', '#ffffff'),
      code: cssv('--code-bg', '#f6f8fb'), mono: cssv('--mono', 'ui-monospace, Menlo, monospace')
    };
  };

  function prepare(cv, minH) {
    var dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    var W = Math.max(320, Math.round(r.width || 640)), H = Math.max(minH || 200, Math.round(r.height || 400));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    return { ctx: ctx, W: W, H: H };
  }
  function fit(ctx, s, maxW) {
    s = String(s);
    if (ctx.measureText(s).width <= maxW) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + '…';
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function arrow(ctx, x1, y1, x2, y2, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
    var mx = (x1 + x2) / 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(mx, y1, mx, y2, x2 - 5, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 7, y2 - 3.5); ctx.lineTo(x2 - 7, y2 + 3.5); ctx.closePath(); ctx.fill();
  }

  /* ── the source panel, shared by every view ── */
  var KW = { fn: 1, let: 1, mut: 1, struct: 1, impl: 1, for: 1, in: 1, if: 1, else: 1, while: 1, loop: 1, return: 1, break: 1, continue: 1, pub: 1, self: 1, Self: 1 };
  function drawCodeLine(ctx, C, text, x, y, maxW) {
    // tiny tokenizer: comments dim, strings green, keywords violet, macros blue, the rest text
    var i = 0, out = [];
    while (i < text.length) {
      var c = text[i];
      if (c === '/' && text[i + 1] === '/') { out.push([text.slice(i), C.dim]); break; }
      if (c === '"') { var j = i + 1; while (j < text.length && text[j] !== '"') j++; out.push([text.slice(i, j + 1), C.good]); i = j + 1; continue; }
      if (/[A-Za-z_]/.test(c)) {
        var k = i + 1; while (k < text.length && /[A-Za-z0-9_]/.test(text[k])) k++;
        var w = text.slice(i, k);
        out.push([w, KW[w] ? C.live : (text[k] === '!' ? C.shared : C.text)]); i = k; continue;
      }
      out.push([c, C.text]); i++;
    }
    var cx = x;
    for (var q = 0; q < out.length; q++) {
      var seg = out[q][0], w0 = ctx.measureText(seg).width;
      if (cx + w0 > x + maxW) { ctx.fillStyle = C.dim; ctx.fillText('…', cx, y); break; }
      ctx.fillStyle = out[q][1]; ctx.fillText(seg, cx, y); cx += w0;
    }
  }
  /* paints `lines` in the box; `active` is a 1-based line number (or 0); `marks` maps line -> {color, label} */
  function drawSource(ctx, C, box, lines, active, marks, opts) {
    opts = opts || {};
    var lh = 16, pad = 6, top = box.y + 22, avail = Math.floor((box.h - 26) / lh), gx = opts.gutter || 0;
    ctx.fillStyle = C.bg; rrect(ctx, box.x, box.y, box.w, box.h, 8); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rrect(ctx, box.x + .5, box.y + .5, box.w - 1, box.h - 1, 8); ctx.stroke();
    ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left';
    ctx.fillText(opts.title || 'source', box.x + 8, box.y + 11);
    var first = 0;
    if (lines.length > avail) { first = Math.max(0, Math.min(lines.length - avail, (active || 1) - 1 - Math.floor(avail / 3))); }
    ctx.font = '12px ' + C.mono;
    for (var r = 0; r < avail && first + r < lines.length; r++) {
      var ln = first + r + 1, y = top + r * lh;
      var mk = marks && marks[ln];
      if (ln === active) { ctx.fillStyle = 'rgba(37,99,235,0.13)'; ctx.fillRect(box.x + 3, y - lh / 2, box.w - 6, lh); ctx.fillStyle = C.shared; ctx.fillRect(box.x + 3, y - lh / 2, 3, lh); }
      if (mk && mk.bg) { ctx.fillStyle = mk.bg; ctx.fillRect(box.x + 3, y - lh / 2, box.w - 6, lh); }
      if (mk && mk.color) { ctx.fillStyle = mk.color; ctx.fillRect(box.x + 3, y - lh / 2, 3, lh); }
      ctx.fillStyle = C.dim; ctx.textAlign = 'right'; ctx.fillText(String(ln + (opts.base || 0)), box.x + 26, y); ctx.textAlign = 'left';
      var labW = mk && mk.label ? ctx.measureText(mk.label).width + 10 : 0;
      drawCodeLine(ctx, C, lines[first + r].replace(/\t/g, '  '), box.x + 32 + gx, y, box.w - 38 - gx - labW);
      if (mk && mk.label) { ctx.fillStyle = mk.color || C.err; ctx.textAlign = 'right'; ctx.fillText(mk.label, box.x + box.w - 8, y); ctx.textAlign = 'left'; }
    }
    return { first: first, avail: avail, lh: lh, top: top };
  }
  V._drawSource = drawSource;

  /* ── the machine: stack frames, heap blocks, ownership arrows, output ── */
  V.drawRun = function (cv, o) {
    var P = prepare(cv, 300), ctx = P.ctx, W = P.W, H = P.H, C = V.colors();
    var lines = String(o.src || '').replace(/\s+$/, '').split('\n');
    var run = o.run || { events: [], out: [] };
    var n = run.events.length, step = Math.max(0, Math.min(n, o.step === undefined ? n : o.step));
    var ev = step > 0 ? run.events[step - 1] : null;
    var snap = ev ? ev.snap : { stack: [], heap: [], out: 0 };
    // ── marks on the source: the active event's line, checker errors, move sites
    var marks = {};
    (o.errors || []).forEach(function (e) { if (e.line) marks[e.line] = { color: C.err, label: e.code || 'error', bg: 'rgba(220,38,38,0.07)' }; });
    (o.errors || []).forEach(function (e) {
      (e.moveLines || []).forEach(function (ml) { if (ml && !marks[ml]) marks[ml] = { color: C.excl, label: 'moved here', bg: 'rgba(217,119,6,0.09)' }; });
    });
    var wide = W >= 600;
    var outH = 52, gap = 8;
    var codeBox, stackBox, heapBox, outBox;
    if (wide) {
      var cw = Math.min(440, Math.max(240, Math.round(W * 0.47)));
      codeBox = { x: 6, y: 6, w: cw, h: H - 12 - outH - gap };
      var rx = cw + 6 + gap, rw = W - rx - 6, sh = Math.round((H - 12 - outH - gap * 2) * 0.52);
      stackBox = { x: rx, y: 6, w: rw, h: sh };
      heapBox = { x: rx, y: 6 + sh + gap, w: rw, h: H - 12 - outH - gap * 2 - sh };
    } else {
      var ch = Math.round((H - 12 - outH - gap * 2) * 0.36), hh = H - 12 - outH - gap * 2 - ch;
      codeBox = { x: 6, y: 6, w: W - 12, h: ch };
      var half = Math.round((W - 12 - gap) / 2);
      stackBox = { x: 6, y: 6 + ch + gap, w: half, h: hh };
      heapBox = { x: 6 + half + gap, y: 6 + ch + gap, w: W - 12 - half - gap, h: hh };
    }
    outBox = { x: 6, y: H - 6 - outH, w: W - 12, h: outH };
    drawSource(ctx, C, codeBox, lines, ev ? ev.line : 0, marks, { title: 'source' });

    // ── stack
    function panel(b, title) {
      ctx.fillStyle = C.soft; rrect(ctx, b.x, b.y, b.w, b.h, 8); ctx.fill();
      ctx.strokeStyle = C.border; rrect(ctx, b.x + .5, b.y + .5, b.w - 1, b.h - 1, 8); ctx.stroke();
      ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(title, b.x + 8, b.y + 11);
    }
    panel(stackBox, 'stack — one slot per name'); panel(heapBox, 'heap — blocks that nothing ends by itself');
    var slotH = 21, slotGap = 3, slotPos = {};
    var y = stackBox.y + 24, slotW = stackBox.w - 22 - (wide ? 30 : 10);
    var maxRows = Math.floor((stackBox.h - 28) / (slotH + slotGap));
    // draw the newest frames first when space is short: show innermost frame fully
    var rows = [];
    snap.stack.forEach(function (fr, fi) {
      rows.push({ frame: fr.fn, fi: fi });
      fr.locals.forEach(function (l, li) { rows.push({ l: l, fi: fi, li: li }); });
    });
    var startRow = Math.max(0, rows.length - maxRows);
    if (startRow > 0) { ctx.fillStyle = C.dim; ctx.font = '10px ' + C.mono; ctx.fillText('… ' + startRow + ' more above', stackBox.x + 10, y - 6); y += 4; }
    for (var ri = startRow; ri < rows.length; ri++) {
      var row = rows[ri], sx = stackBox.x + 10;
      if (row.frame !== undefined) {
        ctx.font = 'bold 11px ' + C.mono; ctx.fillStyle = C.mute; ctx.textAlign = 'left';
        ctx.fillText('fn ' + row.frame + '()', sx, y + slotH / 2); y += slotH + slotGap; continue;
      }
      var L = row.l, st = L.st;
      var fill = st === 'live' ? C.bg : C.soft, stroke = st === 'live' ? C.own : (st === 'moved' ? C.moved : C.border);
      ctx.fillStyle = fill; rrect(ctx, sx + 8, y, slotW, slotH, 5); ctx.fill();
      ctx.lineWidth = st === 'live' ? 1.5 : 1.2; ctx.strokeStyle = stroke;
      if (st !== 'live') ctx.setLineDash([4, 3]);
      rrect(ctx, sx + 8 + .5, y + .5, slotW - 1, slotH - 1, 5); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 11px ' + C.mono; ctx.fillStyle = st === 'live' ? C.text : C.moved; ctx.textAlign = 'left';
      var nm = L.name, nmW = ctx.measureText(nm + ' ').width;
      ctx.fillText(nm, sx + 14, y + slotH / 2);
      ctx.font = '11px ' + C.mono;
      var chip = st === 'live' ? '' : (st === 'moved' ? 'moved' : st === 'dropped' ? 'dropped' : st === 'uninit' ? 'uninit' : st);
      if (chip) {
        var cwd = ctx.measureText(chip).width + 10;
        ctx.fillStyle = st === 'moved' ? 'rgba(148,163,184,0.25)' : 'rgba(148,163,184,0.18)'; rrect(ctx, sx + 8 + slotW - cwd - 4, y + 3, cwd, slotH - 6, 4); ctx.fill();
        ctx.fillStyle = C.mute; ctx.textAlign = 'center'; ctx.fillText(chip, sx + 8 + slotW - cwd / 2 - 4, y + slotH / 2); ctx.textAlign = 'left';
      }
      if (L.desc) { ctx.fillStyle = C.mute; ctx.fillText(fit(ctx, L.desc, slotW - nmW - 22 - (chip ? 0 : 0)), sx + 14 + nmW, y + slotH / 2); }
      slotPos[row.fi + ':' + row.li] = { x: sx + 8 + slotW, y: y + slotH / 2, heap: L.heap || [], live: st === 'live' };
      y += slotH + slotGap;
    }
    if (!snap.stack.length) { ctx.font = '11px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(step === 0 ? 'press ▶ or drag the slider' : '(empty)', stackBox.x + 12, stackBox.y + 40); }

    // ── heap
    var blockH = 40, bx = heapBox.x + (wide ? 34 : 16), bw = heapBox.w - (wide ? 34 : 16) - 10, by = heapBox.y + 24, blockPos = {};
    var hrows = Math.floor((heapBox.h - 28) / (blockH + 6));
    var shownHeap = snap.heap.filter(function (b) { return !b.freed; }).concat(snap.heap.filter(function (b) { return b.freed; }).slice(-Math.max(0, hrows - snap.heap.filter(function (b) { return !b.freed; }).length)));
    shownHeap.sort(function (a, b) { return a.id - b.id; });
    shownHeap.forEach(function (b, bi) {
      if (bi >= hrows) return;
      var yy = by + bi * (blockH + 6);
      ctx.fillStyle = b.freed ? C.soft : C.bg; rrect(ctx, bx, yy, bw, blockH, 6); ctx.fill();
      ctx.lineWidth = b.freed ? 1.2 : 1.6; ctx.strokeStyle = b.freed ? C.err : C.own;
      if (b.freed) ctx.setLineDash([5, 3]);
      rrect(ctx, bx + .5, yy + .5, bw - 1, blockH - 1, 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 11px ' + C.mono; ctx.fillStyle = b.freed ? C.err : C.text; ctx.textAlign = 'left';
      ctx.fillText('#' + b.id + '  ' + b.kind + (b.freed ? '   freed' : ''), bx + 8, yy + 13);
      ctx.font = '11px ' + C.mono; ctx.fillStyle = b.freed ? C.dim : C.mute;
      ctx.fillText(fit(ctx, b.desc, bw - 16), bx + 8, yy + 29);
      blockPos[b.id] = { x: bx, y: yy + blockH / 2 };
    });
    var hidden = snap.heap.length - shownHeap.length;
    if (hidden > 0) { ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'right'; ctx.fillText('+' + hidden + ' older freed', heapBox.x + heapBox.w - 8, heapBox.y + 11); }
    if (!snap.heap.length) { ctx.font = '11px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText('(nothing allocated)', heapBox.x + 12, heapBox.y + 40); }
    // ── arrows: owner slot → heap block
    if (wide) {
      Object.keys(slotPos).forEach(function (k) {
        var sp = slotPos[k];
        sp.heap.forEach(function (id) {
          var bp = blockPos[id]; if (!bp) return;
          arrow(ctx, sp.x, sp.y, bp.x, bp.y, sp.live ? C.own : C.moved);
        });
      });
    }

    // ── output strip
    ctx.fillStyle = C.bg; rrect(ctx, outBox.x, outBox.y, outBox.w, outBox.h, 8); ctx.fill();
    ctx.strokeStyle = C.border; rrect(ctx, outBox.x + .5, outBox.y + .5, outBox.w - 1, outBox.h - 1, 8); ctx.stroke();
    ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText('printed so far', outBox.x + 8, outBox.y + 10);
    ctx.font = '12px ' + C.mono; ctx.fillStyle = C.text;
    var printed = run.out.slice(0, snap.out), tail = printed.slice(-3);
    var text = tail.length ? (printed.length > 3 ? '… ' : '') + tail.join('  ·  ') : '(nothing yet)';
    ctx.fillText(fit(ctx, text, outBox.w - 16), outBox.x + 8, outBox.y + 26);
    ctx.font = '11px ' + C.mono; ctx.fillStyle = ev && (ev.k === 'error' || ev.k === 'doublefree') ? C.err : C.mute;
    ctx.fillText(fit(ctx, ev ? ('step ' + step + '/' + n + ' · line ' + ev.line + ' · ' + ev.text) : ('step 0/' + n), outBox.w - 16), outBox.x + 8, outBox.y + 42);
  };

  /* ── loans as bars over the source, and (optionally) extents, a cursor, the law as a table ──
     o = { src, loans:[MiniRust.loans(..) or MiniRust.nesting(..) loans], errors:[MiniRust.check(..).errors],
           extents:[{ name, from, to, role:'owner'|'holder' }]        thin bars: where a variable exists (to may be Infinity)
           lexical:true                                               also draw the block-shaped region of every loan (loan.lexEnd) as a dashed halo
           cursor:<line>                                              a program point, drawn as a band across the source
           matrix:{ title, cols:[labels], rows:[{ label, mut, cells:[text…] }], sel:[row, col] }
           table:{ title, cols:[labels], rows:[[text…]], bad:[bool…] }   }                                          */
  V.drawLoans = function (cv, o) {
    var lines = String(o.src || '').replace(/\s+$/, '').split('\n');
    var errs = o.errors || [];
    // the canvas grows with the program: measure the legend first, then size the canvas, then draw
    var W0 = Math.max(320, Math.round(cv.getBoundingClientRect().width || 640)), C0 = V.colors(), m0 = cv.getContext('2d');
    m0.font = '11px ' + C0.mono;
    var vis0 = (o.loans || []).filter(function (l) { return (!l.ofRef && !l.deref) || l.toCaller || errs.some(function (e) { return e.loanLine === l.line; }); });
    var lgRows = 1, lgx0 = 8;
    function legendText(l) { var r = l.lines || l.region || [], a = r.length ? r[0] : l.line, z = r.length ? r[r.length - 1] : l.line; return (l.mut ? '&mut ' : '&') + l.place + '  lines ' + (a === z ? a : a + '–' + z); }
    vis0.forEach(function (l) {
      var w = m0.measureText(legendText(l)).width + 22;
      if (lgx0 + w > W0 - 6) { lgx0 = 8; lgRows++; }
      lgx0 += w + 8;
    });
    var tb = o.table, mx = o.matrix;
    var need = 6 + (26 + lines.length * 16 + 4) + 10 + (lgRows - 1) * 18 + 24
      + (mx ? 14 + 22 + mx.rows.length * 30 + (mx.caption ? 16 : 0) : 0)
      + (tb ? 16 + 22 + tb.rows.length * 24 : 0) + 10;
    cv.style.height = Math.max(200, need) + 'px';
    var P = prepare(cv, 200), ctx = P.ctx, W = P.W, H = P.H, C = V.colors();
    var marks = {};
    (o.lexErrors || []).forEach(function (e) { if (e.line) marks[e.line] = { color: C.excl, label: (e.code || 'error') + ' · block-shaped', bg: 'rgba(217,119,6,0.08)' }; });
    errs.forEach(function (e) { if (e.line) marks[e.line] = { color: C.err, label: e.code || 'error', bg: 'rgba(220,38,38,0.07)' }; });
    // bookkeeping loans (a macro reading a reference, reborrows through *r) stay hidden unless an error names them or they reach the caller
    var loans = (o.loans || []).filter(function (l) { return (!l.ofRef && !l.deref) || l.toCaller || errs.some(function (e) { return e.loanLine === l.line; }); })
      .sort(function (a, b) { return a.line - b.line || a.id - b.id; });
    function ext(l) { var r = l.lines || l.region || [l.line]; return [r[0] === undefined ? l.line : r[0], r.length ? r[r.length - 1] : l.line]; }
    var exts = (o.extents || []).filter(function (x) { return x.to !== undefined; });
    var laneEnd = [];
    loans.forEach(function (l) {
      var e = ext(l), first = e[0], last = o.lexical && l.lexEnd !== undefined ? Math.max(e[1], l.lexEnd === Infinity ? lines.length : l.lexEnd) : e[1], lane = 0;
      while (lane < laneEnd.length && laneEnd[lane] >= first) lane++;
      laneEnd[lane] = last; l.lane = lane;
    });
    var ne = exts.length, nl = Math.max(1, laneEnd.length), gutter = (ne + nl) * 11 + 4;
    var lh = 16, boxH = 26 + lines.length * lh + 4;
    var box = { x: 6, y: 6, w: W - 12, h: boxH };
    var lay = drawSource(ctx, C, box, lines, o.cursor || 0, marks, { title: o.title || 'source — bars are loans: how long each borrow is still needed', gutter: gutter });
    function yOf(ln) { return lay.top + (ln - 1 - lay.first) * lh; }
    var lx = box.x + 30;
    // variables' extents: thin bars, darker for the owner of a loan
    exts.forEach(function (x, k) {
      var cx = lx + k * 11 + 4, y0 = yOf(x.from) - lh / 2 + 3, y1 = (x.to === Infinity ? yOf(lines.length) + lh / 2 : yOf(x.to) + lh / 2) - 3;
      ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = x.role === 'owner' ? C.own : C.moved;
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1); ctx.stroke();
      ctx.lineCap = 'butt';
    });
    var llx = lx + ne * 11;
    loans.forEach(function (l) {
      var col = l.mut ? C.excl : C.shared, x = llx + l.lane * 11, e = ext(l);
      if (o.lexical && l.lexEnd !== undefined) {           // the block-shaped region: a dashed halo from the borrow to the end of its holder's scope
        var ly1 = l.lexEnd === Infinity ? yOf(lines.length) + lh / 2 - 1 : yOf(l.lexEnd) + lh / 2 - 2;
        ctx.setLineDash([3, 2]); ctx.lineWidth = 1.2; ctx.strokeStyle = col; rrect(ctx, x - 1.5, yOf(l.line) - lh / 2 + 2, 10, ly1 - (yOf(l.line) - lh / 2 + 2), 4); ctx.stroke(); ctx.setLineDash([]);
      }
      var runs = [], run = null;
      (l.lines || l.region || []).forEach(function (ln) { if (run && ln === run[1] + 1) run[1] = ln; else { run = [ln, ln]; runs.push(run); } });
      runs.forEach(function (rg) {
        var y0 = yOf(rg[0]) - lh / 2 + 2, y1 = yOf(rg[1]) + lh / 2 - 2;
        ctx.globalAlpha = 0.22; ctx.fillStyle = col; rrect(ctx, x, y0, 7, y1 - y0, 3); ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1.4; ctx.strokeStyle = col; rrect(ctx, x + .5, y0 + .5, 6, y1 - y0 - 1, 3); ctx.stroke();
      });
      (l.outside || []).forEach(function (ln) {            // the part of the region that lies outside the owner's extent
        ctx.fillStyle = 'rgba(220,38,38,0.65)'; rrect(ctx, x, yOf(ln) - lh / 2 + 2, 7, lh - 4, 2); ctx.fill();
      });
      if (l.toCaller && l.ownerTo !== Infinity) {            // the region continues into the caller
        var yb = (l.lines && l.lines.length ? yOf(l.lines[l.lines.length - 1]) + lh / 2 - 1 : yOf(l.line)), cx2 = x + 3.5;
        ctx.fillStyle = C.err; ctx.beginPath(); ctx.moveTo(cx2 - 4, yb); ctx.lineTo(cx2 + 4, yb); ctx.lineTo(cx2, yb + 6); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 3.5, yOf(l.line), 3.4, 0, 6.283); ctx.fill();          // where the borrow is made
    });
    // conflicts: a red cross where the access meets the loan that is still in force
    errs.forEach(function (e) {
      if (!e.accessLine && !e.line) return;
      var ln = e.accessLine || e.line;
      loans.forEach(function (l) {
        if (l.line !== e.loanLine) return;
        var x = llx + l.lane * 11 + 3.5, y = yOf(ln);
        ctx.strokeStyle = C.err; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
      });
    });
    // the cursor: one program point
    if (o.cursor) {
      var cy = yOf(o.cursor);
      ctx.fillStyle = 'rgba(37,99,235,0.09)'; ctx.fillRect(box.x + 3, cy - lh / 2, box.w - 6, lh);
      ctx.strokeStyle = C.shared; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(box.x + 3, cy); ctx.lineTo(box.x + box.w - 3, cy); ctx.stroke(); ctx.setLineDash([]);
    }
    var y = box.y + box.h + 10;
    // legend
    ctx.font = '11px ' + C.mono; ctx.textAlign = 'left';
    var lgx = 8;
    if (!loans.length) { ctx.fillStyle = C.dim; ctx.fillText('(no borrows in this program)', lgx, y + 6); }
    loans.forEach(function (l) {
      var txt = legendText(l);
      var w = ctx.measureText(txt).width + 22;
      if (lgx + w > W - 6) { lgx = 8; y += 18; }
      ctx.fillStyle = l.mut ? C.excl : C.shared; rrect(ctx, lgx, y, 7, 12, 3); ctx.fill();
      ctx.fillStyle = C.mute; ctx.fillText(txt, lgx + 12, y + 6); lgx += w + 8;
    });
    y += 24;
    // the law as a table
    var m = o.matrix;
    if (m) {
      var rhW = Math.min(112, Math.max(72, Math.round(W * 0.2))), cw = (W - 12 - rhW) / m.cols.length, rowH = 30, hdrH = 22;
      ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left';
      ctx.fillText(m.title || 'while a is still needed, another name…', 8, y + 4); y += 14;
      ctx.textAlign = 'center'; ctx.font = 'bold 11px ' + C.mono;
      m.cols.forEach(function (c, ci) { ctx.fillStyle = C.text; ctx.fillText(fit(ctx, c, cw - 4), 6 + rhW + ci * cw + cw / 2, y + hdrH / 2); });
      y += hdrH;
      m.rows.forEach(function (row, ri) {
        ctx.fillStyle = C.bg; ctx.strokeStyle = C.border; ctx.lineWidth = 1;
        ctx.textAlign = 'left'; ctx.font = 'bold 11px ' + C.mono; ctx.fillStyle = row.mut ? C.excl : C.shared;
        ctx.fillText(fit(ctx, row.label, rhW - 6), 8, y + rowH / 2);
        row.cells.forEach(function (cell, ci) {
          var x = 6 + rhW + ci * cw, bad = cell !== 'ok', sel = m.sel && m.sel[0] === ri && m.sel[1] === ci;
          ctx.fillStyle = bad ? 'rgba(220,38,38,0.10)' : 'rgba(22,163,74,0.10)'; rrect(ctx, x + 2, y + 2, cw - 4, rowH - 4, 5); ctx.fill();
          ctx.lineWidth = sel ? 2.4 : 1; ctx.strokeStyle = sel ? C.text : (bad ? 'rgba(220,38,38,0.35)' : 'rgba(22,163,74,0.35)'); rrect(ctx, x + 2.5, y + 2.5, cw - 5, rowH - 5, 5); ctx.stroke();
          ctx.textAlign = 'center'; ctx.font = (sel ? 'bold ' : '') + '11px ' + C.mono; ctx.fillStyle = bad ? C.err : C.good;
          ctx.fillText(cell, x + cw / 2, y + rowH / 2);
        });
        y += rowH;
      });
      if (m.caption) { ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(fit(ctx, m.caption, W - 16), 8, y + 10); }
    }
    // a plain table: one row per borrow
    if (tb) {
      var wts = tb.widths || tb.cols.map(function () { return 1 / tb.cols.length; }), tx = 6, tw = W - 12, rh = 24;
      ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(tb.title || '', 8, y + 4); y += 14;
      var xs = [tx]; wts.forEach(function (w0, i) { xs.push(xs[i] + w0 * tw); });
      ctx.font = 'bold 11px ' + C.mono; ctx.fillStyle = C.text;
      tb.cols.forEach(function (c, ci) { ctx.fillText(fit(ctx, c, wts[ci] * tw - 8), xs[ci] + 6, y + 10); });
      y += 22;
      tb.rows.forEach(function (row, ri) {
        var bad = tb.bad && tb.bad[ri];
        ctx.fillStyle = bad ? 'rgba(220,38,38,0.09)' : 'rgba(22,163,74,0.08)'; rrect(ctx, tx, y + 1, tw, rh - 2, 5); ctx.fill();
        ctx.font = '11px ' + C.mono;
        row.forEach(function (cell, ci) { ctx.fillStyle = ci === row.length - 1 ? (bad ? C.err : C.good) : C.text; ctx.fillText(fit(ctx, cell, wts[ci] * tw - 10), xs[ci] + 6, y + rh / 2); });
        y += rh;
      });
    }
  };

  /* ── Lesson 07: the program as a flow graph — loans in scope, liveness, control-flow edges, the three points of an error ──
     o = { src, a (MiniRust.flowAll(src)), cursor, showEdges } */
  function span(a) { return a.length ? (a[0] === a[a.length - 1] ? String(a[0]) : a[0] + '–' + a[a.length - 1]) : '—'; }
  function lk(l) { return (l.mut ? '&mut ' : '&') + l.place; }
  V.drawFlow = function (cv, o) {
    var lines = String(o.src || '').replace(/\s+$/, '').split('\n'), A = o.a, fn = A;
    var errs = A.errors.filter(function (e) { return e.loan !== null; });
    var loans = A.vis.slice().sort(function (a, b) { return a.line - b.line || a.id - b.id; });
    var tb = {
      title: 'the test, per loan: does an access meet it while it is in scope?', cols: ['loan', 'held by', 'in scope on lines', 'verdict'], widths: [0.22, 0.24, 0.22, 0.32],
      rows: loans.map(function (l) {
        var e = errs.filter(function (x) { return x.loan === l.id; })[0];
        return [lk(l) + ' @' + l.line, 'held by ' + (l.holders.length ? l.holders.join(', ') : (l.toCaller ? 'the caller' : 'a temporary')), 'in scope ' + span(l.scope) + (l.toCaller ? ' →' : ''),
                e ? '✗ ' + e.code + ' at ' + (e.accessLine || e.line) + ', used again at ' + e.useLine : '✓ nothing meets it'];
      }),
      bad: loans.map(function (l) { return errs.some(function (x) { return x.loan === l.id; }); })
    };
    var W0 = Math.max(320, Math.round(cv.getBoundingClientRect().width || 640)), lh = 18;
    var need = 6 + (28 + lines.length * lh + 4) + 10 + 22 + (tb ? 16 + 22 + tb.rows.length * 24 : 0) + 10;
    cv.style.height = Math.max(240, need) + 'px';
    var P = prepare(cv, 200), ctx = P.ctx, W = P.W, C = V.colors();
    // lanes for the loans
    var laneEnd = [];
    loans.forEach(function (l) {
      var first = l.scope.length ? l.scope[0] : l.line, last = l.scope.length ? l.scope[l.scope.length - 1] : l.line, lane = 0;
      while (lane < laneEnd.length && laneEnd[lane] >= first) lane++;
      laneEnd[lane] = last; l.lane = lane;
    });
    var nl = Math.max(1, laneEnd.length), lanesW = nl * 11 + 4;
    // lanes for the control-flow arcs (short ones inside)
    var arcs = o.showEdges ? (A.arcs || []).slice() : [];
    arcs.sort(function (a, b) { return Math.abs(a.to - a.from) - Math.abs(b.to - b.from); });
    var arcEnd = [];
    arcs.forEach(function (a) {
      var lo = Math.min(a.from, a.to), hi = Math.max(a.from, a.to), k = 0;
      for (;;) { var clash = false; (arcEnd[k] || []).forEach(function (iv) { if (!(hi < iv[0] || lo > iv[1])) clash = true; }); if (!clash) break; k++; }
      (arcEnd[k] = arcEnd[k] || []).push([lo, hi]); a.lane = k;
    });
    var box = { x: 6, y: 6, w: W - 12, h: 28 + lines.length * lh + 4 };
    var liveW = W >= 560 ? 124 : 0, arcsW = arcs.length ? arcEnd.length * 9 + 16 : 0, chipsW = 3 * 15 + 6;
    var codeX = box.x + 6 + lanesW + 30;
    var codeW = box.x + box.w - liveW - arcsW - chipsW - 6 - codeX;
    if (codeW < 150 && liveW) { liveW = 0; codeW = box.x + box.w - arcsW - chipsW - 6 - codeX; }
    if (codeW < 150 && arcsW) { arcsW = 0; arcs = []; codeW = box.x + box.w - liveW - chipsW - 6 - codeX; }
    var liveX = box.x + box.w - liveW - 4, arcX = liveX - arcsW, chipX = arcX - chipsW;
    var top = box.y + 28;
    function yOf(ln) { return top + (ln - 1) * lh + lh / 2; }
    // panel
    ctx.fillStyle = C.bg; rrect(ctx, box.x, box.y, box.w, box.h, 8); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rrect(ctx, box.x + .5, box.y + .5, box.w - 1, box.h - 1, 8); ctx.stroke();
    ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left';
    ctx.fillText(o.title || 'bars: loans in scope · B borrow · A conflicting access · U later use', box.x + 8, box.y + 11);
    if (liveW) ctx.fillText('live on entry', liveX + 8, box.y + 22);
    if (arcsW) ctx.fillText('flow', arcX + 2, box.y + 22);
    if (o.cursor) {
      var cy = yOf(o.cursor);
      ctx.fillStyle = 'rgba(37,99,235,0.10)'; ctx.fillRect(box.x + 3, cy - lh / 2, box.w - 6, lh);
      ctx.fillStyle = C.shared; ctx.fillRect(box.x + 3, cy - lh / 2, 3, lh);
    }
    // the error marks: which line plays B, A, U
    var mk = {};
    function mark(ln, ch, col) { if (!ln) return; var m = mk[ln] = mk[ln] || {}; m[ch] = col; }
    errs.forEach(function (e) {
      var ln = loans.filter(function (l) { return l.id === e.loan; })[0] || loans.filter(function (l) { return l.line === e.loanLine; })[0];
      mark(e.loanLine, 'B', ln ? (ln.mut ? C.excl : C.shared) : C.shared);
      mark(e.accessLine || e.line, 'A', C.err);
      mark(e.useLine, 'U', C.live);
    });
    // lines
    ctx.textAlign = 'left';
    lines.forEach(function (text, i) {
      var ln = i + 1, y = yOf(ln), at = A.at[ln];
      if (errs.some(function (e) { return (e.accessLine || e.line) === ln; })) { ctx.fillStyle = 'rgba(220,38,38,0.07)'; ctx.fillRect(box.x + 3, y - lh / 2, box.w - 6, lh); }
      ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'right'; ctx.fillText(String(ln), codeX - 8, y); ctx.textAlign = 'left';
      ctx.font = '12px ' + C.mono;
      drawCodeLine(ctx, C, text.replace(/\t/g, '  '), codeX, y, codeW);
      var m = mk[ln];
      if (m) { var cx = chipX + 4; ['B', 'A', 'U'].forEach(function (ch) { if (!m[ch]) return; ctx.fillStyle = m[ch]; rrect(ctx, cx, y - 6.5, 13, 13, 3); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px ' + C.mono; ctx.textAlign = 'center'; ctx.fillText(ch, cx + 6.5, y + .5); ctx.textAlign = 'left'; cx += 15; }); }
      if (liveW && at && at.live.length) { ctx.font = (ln === o.cursor ? 'bold ' : '') + '11px ' + C.mono; ctx.fillStyle = C.live; ctx.fillText(fit(ctx, at.live.join(' '), liveW - 6), liveX + 2, y); }
    });
    // control-flow arcs
    if (arcs.length) {
      arcs.forEach(function (a) {
        var x0 = arcX + 3, xl = arcX + 9 + a.lane * 9, y1 = yOf(a.from), y2 = yOf(a.to);
        ctx.strokeStyle = ctx.fillStyle = a.kind === 'back' ? C.live : C.dim; ctx.lineWidth = a.kind === 'back' ? 1.7 : 1.2;
        ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(xl, y1); ctx.lineTo(xl, y2); ctx.lineTo(x0 + 2, y2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x0, y1, 2, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x0 - 1, y2); ctx.lineTo(x0 + 5, y2 - 3.2); ctx.lineTo(x0 + 5, y2 + 3.2); ctx.closePath(); ctx.fill();
      });
    }
    (A.ends || []).forEach(function (ln) {            // a path leaves the function here
      if (ln === lines.length) return;
      ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(arcsW ? '⊣' : '', arcX + 3, yOf(ln));
    });
    // loans in scope: bars in the lanes
    var lx = box.x + 8;
    loans.forEach(function (l) {
      var col = l.mut ? C.excl : C.shared, x = lx + l.lane * 11, runs = [], run = null;
      l.scope.forEach(function (ln) { if (run && ln === run[1] + 1) run[1] = ln; else { run = [ln, ln]; runs.push(run); } });
      runs.forEach(function (rg) {
        var y0 = yOf(rg[0]) - lh / 2 + 2, y1 = yOf(rg[1]) + lh / 2 - 2;
        ctx.globalAlpha = 0.22; ctx.fillStyle = col; rrect(ctx, x, y0, 7, y1 - y0, 3); ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 1.4; ctx.strokeStyle = col; rrect(ctx, x + .5, y0 + .5, 6, y1 - y0 - 1, 3); ctx.stroke();
      });
      if (l.toCaller && l.scope.length) {               // the region continues into the caller
        var yb = yOf(l.scope[l.scope.length - 1]) + lh / 2 - 1, cx2 = x + 3.5;
        ctx.fillStyle = C.err; ctx.beginPath(); ctx.moveTo(cx2 - 4, yb); ctx.lineTo(cx2 + 4, yb); ctx.lineTo(cx2, yb + 6); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 3.5, yOf(l.line), 3.4, 0, 6.283); ctx.fill();
    });
    errs.forEach(function (e) {                          // a red cross where the access meets the loan
      var ln = e.accessLine || e.line;
      loans.forEach(function (l) {
        if (e.loan !== undefined && e.loan !== null ? l.id !== e.loan : l.line !== e.loanLine) return;
        var x = lx + l.lane * 11 + 3.5, y = yOf(ln);
        ctx.strokeStyle = C.err; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
      });
    });
    var y = box.y + box.h + 10;
    ctx.font = '11px ' + C.mono; ctx.textAlign = 'left';
    var lgx = 8;
    if (!loans.length) { ctx.fillStyle = C.dim; ctx.fillText('(no borrow outlives its own line in this program)', lgx, y + 6); }
    loans.forEach(function (l) {
      var r = l.scope, a = r.length ? r[0] : l.line, z = r.length ? r[r.length - 1] : l.line;
      var txt = (l.mut ? '&mut ' : '&') + l.place + '  lines ' + (a === z ? a : a + '–' + z);
      var w = ctx.measureText(txt).width + 22;
      if (lgx + w > W - 6) { lgx = 8; y += 18; }
      ctx.fillStyle = l.mut ? C.excl : C.shared; rrect(ctx, lgx, y, 7, 12, 3); ctx.fill();
      ctx.fillStyle = C.mute; ctx.fillText(txt, lgx + 12, y + 6); lgx += w + 8;
    });
    y += 24;
    if (tb) {
      var wts = tb.widths || tb.cols.map(function () { return 1 / tb.cols.length; }), tx = 6, tw = W - 12, rh = 24;
      ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.fillText(tb.title || '', 8, y + 4); y += 14;
      var xs = [tx]; wts.forEach(function (w0, i) { xs.push(xs[i] + w0 * tw); });
      ctx.font = 'bold 11px ' + C.mono; ctx.fillStyle = C.text;
      tb.cols.forEach(function (c, ci) { ctx.fillText(fit(ctx, c, wts[ci] * tw - 8), xs[ci] + 6, y + 10); });
      y += 22;
      tb.rows.forEach(function (row, ri) {
        var bad = tb.bad && tb.bad[ri];
        ctx.fillStyle = bad ? 'rgba(220,38,38,0.09)' : 'rgba(22,163,74,0.08)'; rrect(ctx, tx, y + 1, tw, rh - 2, 5); ctx.fill();
        ctx.font = '11px ' + C.mono;
        row.forEach(function (cell, ci) { ctx.fillStyle = ci === row.length - 1 ? (bad ? C.err : C.good) : C.text; ctx.fillText(fit(ctx, cell, wts[ci] * tw - 10), xs[ci] + 6, y + rh / 2); });
        y += rh;
      });
    }
  };

  /* the words for one program point: what is live, what is in scope, what each access meets, and which of B, A, U this line is */
  V.flowInfo = function (A, cur) {
    var errs = A.errors.filter(function (e) { return e.loan !== null; }), byId = {};
    A.vis.forEach(function (l) { byId[l.id] = l; });
    var at = A.at[cur], live = at && at.live.length ? at.live.join(', ') : '', sc = at ? at.scope.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id]; }) : [];
    var msg = 'Point: line ' + cur + '.  Live on entry: ' + (live || 'no reference') + '.  Loans in scope: ' + (sc.length ? sc.map(function (l) { return lk(l) + ' (made on line ' + l.line + ')'; }).join(', ') : 'none') + '.';
    var mine = at ? at.acc.filter(function (x) { return x.hits.some(function (h) { return byId[h.loan]; }); }) : [], bad = false;
    mine.forEach(function (x) {
      x.hits.filter(function (h) { return byId[h.loan]; }).forEach(function (h) {
        msg += '\n' + x.text + ' meets ' + lk(byId[h.loan]) + ': ' + (h.code ? h.code + '.' : (x.kind === 'reserve' ? 'ok (reserved: it acts as a shared borrow until the call).' : 'ok.'));
        if (h.code) bad = true;
      });
    });
    if (!mine.length) msg += '\nNothing on this line meets a loan that is in scope.';
    errs.forEach(function (e) {
      var role = [];
      if (e.loanLine === cur) role.push('B, the borrow is made');
      if ((e.accessLine || e.line) === cur) role.push('A, the access the law forbids');
      if (e.useLine === cur) role.push('U, the later use that keeps the loan live');
      if (role.length) msg += '\n' + e.code + ': this line is ' + role.join('; and ') + '  (B ' + e.loanLine + ', A ' + (e.accessLine || e.line) + ', U ' + e.useLine + ').';
    });
    A.errors.forEach(function (e) { if (e.loan === null) msg += '\nrustc: line ' + e.line + ' ' + (e.code || 'error') + ' — ' + e.msg; });
    if (!A.errors.length) msg += '\nNo access meets a loan in scope anywhere: the checker accepts the program.';
    var codes = A.errors.map(function (e) { return e.code || 'error'; }).filter(function (c, i, x) { return x.indexOf(c) === i; });
    return { live: live || 'nothing', scope: sc.length ? sc.map(lk).join(', ') : 'none', passes: String(A.passes), verdict: A.errors.length ? 'no: ' + codes.join(', ') : 'yes', text: msg, bad: bad || A.errors.length > 0 };
  };

  /* ── Lesson 08: one function, checked twice — its body against its signature, its callers against the same signature ──
     The family the widget explores: five signatures x four bodies x three callers.  Everything is computed by MiniRust.check;
     a cell holds the error codes of each half ('' is an error without a code, "lifetime may not live long enough"). */
  V.CONTRACT = {
    sigs: [
      { name: 'unannotated', text: 'fn pick(x: &str, y: &str) -> &str' },
      { name: 'tied to both', text: "fn pick<'a>(x: &'a str, y: &'a str) -> &'a str" },
      { name: 'tied to x', text: "fn pick<'a>(x: &'a str, y: &str) -> &'a str" },
      { name: 'tied to y', text: "fn pick<'a>(x: &str, y: &'a str) -> &'a str" },
      { name: 'tied to nothing', short: 'tied to none', text: "fn pick(x: &str, y: &str) -> &'static str" }
    ],
    bodies: [
      { name: 'x', text: 'x' }, { name: 'y', text: 'y' },
      { name: 'the longer', text: 'if x.len() >= y.len() { x } else { y }' },
      { name: '"none"', text: '"none"' }
    ],
    callers: [
      { name: 'nobody dies early', lines: ['    let a = String::from("long");', '    let b = String::from("short");', '    let r = pick(&a, &b);', '    println!("{}", r);'] },
      { name: 'b dies first', lines: ['    let a = String::from("long");', '    let r;', '    {', '        let b = String::from("short");', '        r = pick(&a, &b);', '    }', '    println!("{}", r);'] },
      { name: 'a dies first', lines: ['    let b = String::from("short");', '    let r;', '    {', '        let a = String::from("long");', '        r = pick(&a, &b);', '    }', '    println!("{}", r);'] }
    ]
  };
  V.contractProgram = function (si, bi, ci) {
    var K = V.CONTRACT;
    return K.sigs[si].text + ' {\n    ' + K.bodies[bi].text + '\n}\n\nfn main() {\n' + K.callers[ci].lines.join('\n') + '\n}\n';
  };
  /* check one program and split the errors by the function that has them: `pick` is the callee, `main` the caller */
  V.contractSplit = function (MR, src) {
    var r = MR.check(src), a = [], b = [];
    r.errors.forEach(function (e) { (e.fn === 'pick' ? a : b).push(e); });
    return { src: src, callee: a, caller: b, all: r.errors, parseError: r.parseError };
  };
  V.contractRun = function (MR, si, bi, ci) { return V.contractSplit(MR, V.contractProgram(si, bi, ci)); };
  /* the table for one caller: cells[signature][body] = { callee: [codes], caller: [codes] } */
  V.contractGrid = function (MR, ci) {
    var K = V.CONTRACT;
    return K.sigs.map(function (s, si) {
      return K.bodies.map(function (b, bi) {
        var r = V.contractRun(MR, si, bi, ci);
        return { callee: r.callee.map(function (e) { return e.code; }), caller: r.caller.map(function (e) { return e.code; }) };
      });
    });
  };
  /* does the other half's code change this half's verdict?  (the row of one signature, over every body and every caller) */
  V.contractIndependence = function (MR, si) {
    var K = V.CONTRACT, calls = {}, bodies = {}, n = 0;
    K.bodies.forEach(function (b, bi) {
      K.callers.forEach(function (c, ci) {
        var r = V.contractRun(MR, si, bi, ci), a = r.callee.map(function (e) { return e.code || 'err'; }).join(','), z = r.caller.map(function (e) { return e.code || 'err'; }).join(',');
        (calls[ci] = calls[ci] || {})[z] = 1; (bodies[bi] = bodies[bi] || {})[a] = 1; n++;
      });
    });
    // the caller's verdict must depend on the caller only; the body's on the body only
    return { programs: n, callerDependsOnBody: K.callers.some(function (c, ci) { return Object.keys(calls[ci]).length > 1; }), bodyDependsOnCaller: K.bodies.some(function (b, bi) { return Object.keys(bodies[bi]).length > 1; }) };
  };

  var TAG = function (codes) { return codes.length ? (codes[0] || '✗') + (codes.length > 1 ? '×' + codes.length : '') : '✓'; };
  V.drawContract = function (cv, o) {
    var K = V.CONTRACT, gap = 8, W0 = Math.max(320, Math.round(cv.getBoundingClientRect().width || 640));
    // the program splits into the callee (everything above `fn main`) and the caller (`fn main` down)
    var all = String(o.src || '').replace(/\s+$/, '').split('\n'), mi = -1;
    all.forEach(function (l, i) { if (mi < 0 && /^fn main\b/.test(l)) mi = i; });
    if (mi < 0) mi = all.length;
    var calleeL = all.slice(0, mi), callerL = all.slice(mi); while (calleeL.length && !calleeL[calleeL.length - 1].trim()) calleeL.pop();
    var sideBySide = W0 >= 640, lh = 16, rh = W0 < 560 ? 30 : 34;
    var tableH = 8 + 28 + 32 + 5 * rh + 10 + 42 + 4;
    var boxH = function (n) { return 26 + lh * Math.max(2, n) + 6; };
    var srcH = sideBySide ? boxH(Math.max(calleeL.length, callerL.length)) : boxH(calleeL.length) + gap + boxH(callerL.length);
    var Htot = 6 + tableH + gap + srcH + 6;
    cv.style.height = Htot + 'px';
    var P = prepare(cv, Htot), ctx = P.ctx, W = P.W, C = V.colors();
    var mBox = { x: 6, y: 6, w: W - 12, h: tableH };
    // ── the table
    ctx.fillStyle = C.bg; rrect(ctx, mBox.x, mBox.y, mBox.w, mBox.h, 8); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; rrect(ctx, mBox.x + .5, mBox.y + .5, mBox.w - 1, mBox.h - 1, 8); ctx.stroke();
    ctx.font = '10px ' + C.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, 'caller: ' + K.callers[o.ci].name + '   ·   each cell is [ body vs signature | call vs signature ]', mBox.w - 16), mBox.x + 8, mBox.y + 12);
    var lw = Math.max(84, Math.min(130, Math.round(mBox.w * 0.2))), cw = Math.floor((mBox.w - 16 - lw) / 4), hx = mBox.x + 8 + lw, hy = mBox.y + 30, fs = cw < 60 ? 9 : 11;
    ctx.textAlign = 'center';
    K.bodies.forEach(function (b, bi) {
      var sel = bi === o.bi;
      ctx.font = (sel ? 'bold ' : '') + fs + 'px ' + C.mono; ctx.fillStyle = sel ? C.shared : C.text;
      ctx.fillText(fit(ctx, b.name, cw - 4), hx + bi * cw + cw / 2, hy + 6);
      if (cw >= 66) { ctx.font = '8px ' + C.mono; ctx.fillStyle = C.dim; ctx.fillText('body | call', hx + bi * cw + cw / 2, hy + 19); }
    });
    K.sigs.forEach(function (sg, si) {
      var y = hy + 30 + si * rh, selR = si === o.si;
      if (selR) { ctx.fillStyle = 'rgba(37,99,235,0.08)'; rrect(ctx, mBox.x + 4, y, mBox.w - 8, rh, 5); ctx.fill(); }
      ctx.textAlign = 'left'; ctx.font = (selR ? 'bold ' : '') + fs + 'px ' + C.mono; ctx.fillStyle = selR ? C.shared : C.text;
      ctx.fillText(fit(ctx, lw < 100 && sg.short ? sg.short : sg.name, lw - 6), mBox.x + 10, y + rh / 2);
      K.bodies.forEach(function (b, bi) {
        var cell = o.grid[si][bi], x = hx + bi * cw + 2, w = cw - 4, h = rh - 4, yy = y + 2;
        var refused = cell.callee.indexOf('E0106') >= 0;
        ctx.textAlign = 'center'; ctx.font = 'bold ' + fs + 'px ' + C.mono;
        if (refused) {
          ctx.fillStyle = 'rgba(148,163,184,0.20)'; rrect(ctx, x, yy, w, h, 4); ctx.fill();
          ctx.fillStyle = C.mute; ctx.fillText('E0106', x + w / 2, yy + h / 2);
        } else {
          [cell.callee, cell.caller].forEach(function (codes, k) {
            var hw = w / 2, hx0 = x + k * hw, bad = codes.length > 0;
            ctx.fillStyle = bad ? 'rgba(220,38,38,0.14)' : 'rgba(22,163,74,0.14)';
            rrect(ctx, hx0, yy, hw, h, 4); ctx.fill();
            if (k === 0) ctx.fillRect(hx0 + hw - 4, yy, 4, h); else ctx.fillRect(hx0, yy, 4, h);
            ctx.fillStyle = bad ? C.err : C.good; ctx.fillText(hw < 34 ? (bad ? '✗' : '✓') : fit(ctx, TAG(codes), hw - 2), hx0 + hw / 2, yy + h / 2);
          });
          ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w / 2, yy); ctx.lineTo(x + w / 2, yy + h); ctx.stroke();
        }
        if (selR && bi === o.bi) { ctx.strokeStyle = C.shared; ctx.lineWidth = 2; rrect(ctx, x, yy, w, h, 4); ctx.stroke(); }
      });
    });
    var ly = hy + 30 + 5 * rh + 12;
    ctx.textAlign = 'left'; ctx.font = '10px ' + C.mono; ctx.fillStyle = C.mute;
    ctx.fillText(fit(ctx, '✓ accepted    ✗ rejected, and the code rustc prints (✗: none)', mBox.w - 16), mBox.x + 8, ly);
    ctx.fillText(fit(ctx, 'E0621, E0597 …  the code, shown when a half is wide enough', mBox.w - 16), mBox.x + 8, ly + 13);
    ctx.fillText(fit(ctx, 'E0106: no contract could be written, so nothing is checked', mBox.w - 16), mBox.x + 8, ly + 26);
    // ── the program, in the two halves the checker treats separately; errors marked on the lines rustc reports
    var marks1 = {}, marks2 = {};
    (o.errors || []).forEach(function (e) {
      if (!e.line) return;
      var mk = { color: C.err, label: e.code || 'error', bg: 'rgba(220,38,38,0.07)' };
      if (e.line <= calleeL.length) marks1[e.line] = mk; else if (e.line > mi) marks2[e.line - mi] = mk;
    });
    var y0 = 6 + tableH + gap, bA, bB;
    if (sideBySide) {
      var wa = Math.round((W - 12 - gap) * 0.53);
      bA = { x: 6, y: y0, w: wa, h: srcH }; bB = { x: 6 + wa + gap, y: y0, w: W - 12 - wa - gap, h: srcH };
    } else {
      bA = { x: 6, y: y0, w: W - 12, h: boxH(calleeL.length) }; bB = { x: 6, y: y0 + bA.h + gap, w: W - 12, h: boxH(callerL.length) };
    }
    drawSource(ctx, C, bA, calleeL, 0, marks1, { title: 'callee · against its own signature' });
    drawSource(ctx, C, bB, callerL, 0, marks2, { title: 'caller · against the signature only', base: mi });
  };

  /* the words for the selected cell */
  V.contractInfo = function (o) {
    var r = o.run, sg = o.sigs && o.sigs.fns && o.sigs.fns.filter(function (f) { return f.name === 'pick'; })[0] || (o.sigs && o.sigs.fns && o.sigs.fns[0]);
    function words(errs) {
      if (!errs.length) return 'accepted';
      var seen = {}, order = [];
      errs.forEach(function (e) { var k = (e.code || 'error') + ' at line ' + e.line + ': ' + e.msg; if (!seen[k]) { seen[k] = 0; order.push(k); } seen[k]++; });
      return order.map(function (k) { return k + (seen[k] > 1 ? ' (×' + seen[k] + ')' : ''); }).join('; ');
    }
    var sigTxt = sg ? (sg.explicit || 'refused: ' + (sg.errs[0] ? sg.errs[0].code : 'E0106')) : '—';
    var refused = sg && sg.rule === 'none';
    var msg;
    if (r.parseError) msg = 'The mini checker cannot read line ' + r.parseError.line + ': ' + r.parseError.msg;
    else if (refused) msg = 'Signature: ' + sg.written + '\nThe three rules cannot complete it (E0106: ' + (sg.errs[0] && sg.errs[0].note || 'missing lifetime specifier') + '). Neither half is checked: there is no contract to check against.';
    else {
      msg = 'Signature, all lifetimes written: ' + sigTxt + (sg && sg.rule ? '  (rule ' + sg.rule + ' completed the output)' : '') + '\nCallee — the body against the signature: ' + words(r.callee) + '.\nCaller — the call against the signature: ' + words(r.caller) + '.';
      if (o.indep) msg += '\nOver the ' + o.indep.programs + ' programs of this row (4 bodies x 3 callers): the caller\'s verdict ' + (o.indep.callerDependsOnBody ? 'CHANGES' : 'never changes') + ' with the body, and the body\'s verdict ' + (o.indep.bodyDependsOnCaller ? 'CHANGES' : 'never changes') + ' with the caller.';
    }
    var codes = function (errs) { return errs.length ? errs.map(function (e) { return e.code || 'error'; }).join(', ') : 'accepted'; };
    if (r.parseError) return { sig: '—', callee: 'cannot read', caller: 'cannot read', indep: '—', text: msg, bad: true };
    return { sig: sigTxt, callee: refused ? 'not checked' : codes(r.callee), caller: refused ? 'not checked' : codes(r.caller), indep: o.indep ? (o.indep.callerDependsOnBody ? 'yes' : 'no') : '—', text: msg, bad: !!(r.all && r.all.length) };
  };

  root.MRView = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : this);
