/* unwind.js — the "Return or unwind?" engine for Lesson 10 (Errors — Result, ? and panic).
 *
 * A configuration describes a call stack main → f1 → … → fN. Each frame holds 0–2 guards
 * (values whose Drop prints "drop NAME"; creating one prints "new NAME"), laid out before or
 * after the frame's one call; one frame fails (or none), in one of four ways:
 *   result  the failing frame gets an Err and every caller forwards it with ?  (a frame may handle it)
 *   unwind  it panics and the default strategy unwinds
 *   abort   it panics under panic = "abort"
 *   exit    it calls std::process::exit(1)
 *
 * U.trace(cfg)   -> { lines, fate, status, reached, created, dropped }  — the predicted run
 * U.toRust(cfg)  -> the complete Rust program that configuration stands for
 * U.frameLines(cfg) -> one source line per frame (what the widget prints)
 *
 * trace() never looks at the Rust text: it applies the drop rules of Lesson 03 directly.
 * tools/rust_verify/10_unwind.js compiles and runs toRust() for hundreds of random
 * configurations and demands that stdout and the exit status equal trace()'s prediction.
 *
 *   cfg = { depth: 3..6, fail: 1..depth (depth+1 = no failure), mode: 'result'|'unwind'|'abort'|'exit',
 *           handler: -1 | 0..depth-1 (result mode: that frame matches on the Err instead of using ?),
 *           layout: [code for main, f1, …, f6] }      codes: see LAYOUTS
 */
(function (root) {
  'use strict';
  var U = {};

  U.FRAMES = [
    { name: 'main',   slots: ['log', 'cfg'] },
    { name: 'serve',  slots: ['conn', 'sess'] },
    { name: 'load',   slots: ['file', 'lock'] },
    { name: 'parse',  slots: ['buf', 'tmp'] },
    { name: 'decode', slots: ['row', 'key'] },
    { name: 'check',  slots: ['span', 'mark'] },
    { name: 'store',  slots: ['page', 'txn'] }
  ];
  // before / after the frame's call: ['bind', slot] | ['pair', slot, slot] | ['temp', slot]
  U.LAYOUTS = {
    '0':  { label: 'no guards',            before: [], after: [] },
    'b':  { label: 'x · call',             before: [['bind', 0]], after: [] },
    'bb': { label: 'x y · call',           before: [['bind', 0], ['bind', 1]], after: [] },
    'ba': { label: 'x · call · y',         before: [['bind', 0]], after: [['bind', 1]] },
    'a':  { label: 'call · x',             before: [], after: [['bind', 0]] },
    'aa': { label: 'call · x y',           before: [], after: [['bind', 0], ['bind', 1]] },
    'p':  { label: '(x, y) · call',        before: [['pair', 0, 1]], after: [] },
    't':  { label: 'let _ = x · call',     before: [['temp', 0]], after: [] }
  };
  U.MODES = ['result', 'unwind', 'abort', 'exit'];
  U.PRESETS = {                                      // the lesson's worked examples
    p1: { depth: 3, fail: 3, mode: 'unwind', handler: -1, layout: ['0', 'b', 'bb', 'b', '0', '0', '0'] },   // §4's program
    p2: { depth: 3, fail: 3, mode: 'result', handler: 1, layout: ['0', 'ba', 'bb', 'b', '0', '0', '0'] },   // serve handles it
    p3: { depth: 3, fail: 3, mode: 'unwind', handler: -1, layout: ['0', 'b', 'p', 't', '0', '0', '0'] }     // pair + let _
  };

  function normal(cfg) {
    var d = Math.max(3, Math.min(6, cfg.depth | 0));
    var f = Math.max(1, Math.min(d + 1, cfg.fail | 0));
    var lay = [];
    for (var i = 0; i <= 6; i++) lay.push(U.LAYOUTS[(cfg.layout || [])[i]] ? cfg.layout[i] : '0');
    var h = (cfg.handler === undefined || cfg.handler === null) ? -1 : +cfg.handler;
    if (!(h >= 0 && h < d)) h = -1;
    return { depth: d, fail: f, mode: U.MODES.indexOf(cfg.mode) >= 0 ? cfg.mode : 'unwind', handler: h, layout: lay };
  }
  U.normal = normal;

  /* ── the core: run the stack by the drop rules, never by reading the Rust text ── */
  // Run frame i; returns 'ok' | 'err' | 'panic' | 'halt'. x collects stdout lines and each guard's fate.
  function runFrame(x, i) {
    var cfg = x.cfg, L = U.LAYOUTS[cfg.layout[i]], s = U.FRAMES[i].slots, live = [], r = 'ok';
    function run(items) {
      items.forEach(function (it) {
        var a = s[it[1]], b = s[it[2]];
        if (it[0] === 'bind') { x.mk(a); live.push([a]); }
        else if (it[0] === 'pair') { x.mk(a); x.mk(b); live.push([a, b]); }  // one binding, two fields
        else { x.mk(a); x.dr(a); }                     // let _ = …: dropped at the end of its statement
      });
    }
    function dropLocals() {                          // reverse declaration order; a tuple's fields in order
      for (var j = live.length - 1; j >= 0; j--) live[j].forEach(x.dr);
    }
    run(L.before);
    if (i === cfg.fail) {
      x.lines.push(U.FRAMES[i].name + ' fails');
      r = cfg.mode === 'result' ? 'err' : cfg.mode === 'unwind' ? 'panic' : 'halt';
    } else if (i < cfg.depth) {
      r = runFrame(x, i + 1);
      if (r === 'err' && cfg.handler === i) { x.lines.push(U.FRAMES[i].name + ' handles the Err'); r = 'ok'; }
    }
    if (r === 'halt') return r;                       // abort / exit: nothing runs again
    if (r !== 'ok') { dropLocals(); return r; }       // ? returns early, unwinding cleans up: the same drops
    run(L.after);
    if (i === 0) x.lines.push('main ends');
    dropLocals();
    return 'ok';
  }
  function trace(cfg0) {
    var x = { cfg: normal(cfg0), lines: [], fate: {}, created: 0, dropped: 0 };
    x.mk = function (n) { x.lines.push('new ' + n); x.fate[n] = { state: 'live' }; x.created++; };
    x.dr = function (n) { x.lines.push('drop ' + n); x.fate[n].state = 'dropped'; x.fate[n].order = ++x.dropped; };
    var r = runFrame(x, 0), m = x.cfg.mode;
    Object.keys(x.fate).forEach(function (k) { if (x.fate[k].state === 'live') x.fate[k].state = 'leaked'; });
    return { lines: x.lines, fate: x.fate, outcome: r, created: x.created, dropped: x.dropped, cfg: x.cfg,
             status: r === 'ok' ? 0 : r === 'err' ? 1 : r === 'panic' ? 101 : (m === 'abort' ? 'SIGABRT' : 1) };
  }
  U.trace = trace;

  /* ── the program a configuration stands for ── */
  function stmts(items, s) {
    return items.map(function (it) {
      if (it[0] === 'bind') return 'let _' + s[it[1]] + ' = guard("' + s[it[1]] + '");';
      if (it[0] === 'pair') return 'let _both = (guard("' + s[it[1]] + '"), guard("' + s[it[2]] + '"));';
      return 'let _ = guard("' + s[it[1]] + '");';
    });
  }
  function frameLines(cfg0) {
    var cfg = normal(cfg0), N = cfg.depth, K = cfg.fail, res = cfg.mode === 'result', out = [];
    for (var i = 0; i <= N; i++) {
      var F = U.FRAMES[i], L = U.LAYOUTS[cfg.layout[i]], body = stmts(L.before, F.slots), call = null;
      if (i === K) call = res ? 'fail("' + F.name + '")?;' : 'fail("' + F.name + '");';
      else if (i < N) {
        var next = U.FRAMES[i + 1].name + '()';
        if (!res) call = next + ';';
        else if (cfg.handler === i) call = 'if ' + next + '.is_err() { println!("' + F.name + ' handles the Err"); }';
        else call = next + '?;';
      }
      if (call) body.push(call);
      body = body.concat(stmts(L.after, F.slots));
      if (i === 0) body.push('println!("main ends");');
      if (res) body.push('Ok(())');
      var sig = 'fn ' + F.name + '()' + (res ? ' -> R' : '');
      out.push(sig + ' { ' + body.join(' ') + ' }');
    }
    return out;
  }
  U.frameLines = frameLines;

  U.HEADER = [
    'struct Guard(&\'static str);',
    'impl Drop for Guard {',
    '    fn drop(&mut self) { println!("drop {}", self.0); }',
    '}',
    'fn guard(name: &\'static str) -> Guard { println!("new {name}"); Guard(name) }'
  ];
  U.FAIL = {
    result: ['#[derive(Debug)]', 'struct Fail;', 'type R = Result<(), Fail>;',
             'fn fail(at: &str) -> R { println!("{at} fails"); Err(Fail) }'],
    unwind: ['fn fail(at: &str) { println!("{at} fails"); panic!("{at} failed"); }'],
    abort:  ['fn fail(at: &str) { println!("{at} fails"); panic!("{at} failed"); }   // built with -C panic=abort'],
    exit:   ['fn fail(at: &str) { println!("{at} fails"); std::process::exit(1); }']
  };
  U.toRust = function (cfg0) {
    var cfg = normal(cfg0);
    return U.HEADER.concat(U.FAIL[cfg.mode], frameLines(cfg)).join('\n') + '\n';
  };

  /* ── view: the readout text and a DOM-free renderer (it only needs a 2D context) ── */
  function tokens(cfg, i) {                            // a frame, left to right: guards, the call, guards
    var L = U.LAYOUTS[cfg.layout[i]], s = U.FRAMES[i].slots, out = [], res = cfg.mode === 'result';
    function add(items) { items.forEach(function (it) { out.push({ kind: it[0], names: it.slice(1).map(function (k) { return s[k]; }) }); }); }
    add(L.before);
    if (i === cfg.fail) out.push({ kind: 'fail', text: 'fail("' + U.FRAMES[i].name + '")' + (res ? '?' : '') });
    else if (i < cfg.depth) {
      var nx = U.FRAMES[i + 1].name + '()';
      out.push({ kind: 'call', text: !res ? nx : cfg.handler === i ? 'if ' + nx + '.is_err()' : nx + '?' });
    }
    add(L.after);
    if (i === 0) out.push({ kind: 'text', text: 'main ends' });
    return out;
  }
  U.neverCreated = function (t) {
    var cfg = t.cfg, out = [];
    for (var i = 0; i <= cfg.depth; i++) {
      var L = U.LAYOUTS[cfg.layout[i]];
      L.before.concat(L.after).forEach(function (it) {
        it.slice(1).forEach(function (k) { var n = U.FRAMES[i].slots[k]; if (!t.fate[n]) out.push(n); });
      });
    }
    return out;
  };
  U.verdict = function (t) {
    var cfg = t.cfg, K = cfg.fail, N = cfg.depth, h = cfg.handler, F = U.FRAMES, at = K <= N ? F[K].name : '', v;
    if (K > N) v = 'No failure: every frame returns normally and drops its live locals in reverse declaration order, innermost frame first. Pick a failing frame: the frames that were entered drop the same guards, in the same order.';
    else if (cfg.mode === 'result') {
      if (t.outcome === 'ok') v = 'Err + ?: ' + at + ' returns Err and each ? below ' + F[h].name + ' returns it again — ordinary returns, each dropping its frame\'s live locals. ' + F[h].name + ' matches on the Err and carries on' + (h > 0 ? ', and so do its callers' : '') + '. Status 0.';
      else v = 'Err + ?: ' + at + ' returns Err and every caller\'s ? returns it again — ordinary returns, each dropping its frame\'s live locals: the same drops unwinding would run. main returns the Err ("Error: Fail" on stderr), status 1.' + (h >= K ? ' (' + F[h].name + ' is not above the failing frame, so it never sees the Err.)' : '');
    } else if (cfg.mode === 'unwind') {
      v = 'panic, unwinding: the cleanup paths drop exactly what the returns would have, innermost frame first; nothing after a failing call runs, so "main ends" is never printed. Panic message on stderr, status 101.';
      if (h >= 0) v += ' A panic carries no value to match on: the handler setting has no effect.';
    } else if (cfg.mode === 'abort') v = 'panic = "abort": the process stops inside ' + at + '. ' + t.created + ' guards created, none dropped: safe (Lesson 03), but no cleanup ran. Ends on SIGABRT.';
    else v = 'process::exit(1): the process ends inside ' + at + '; no frame returns and no destructor runs. ' + t.created + ' created, none dropped. Status 1.';
    var nc = U.neverCreated(t);
    if (nc.length) v += '\nNever created (declared after a call that did not come back): ' + nc.join(', ') + '.';
    return v;
  };
  U.render = function (ctx, t, W, H, C) {
    var cfg = t.cfg, N = cfg.depth, K = cfg.fail, fails = K <= N, mode = cfg.mode, h = cfg.handler, F = U.FRAMES;
    var deepest = fails ? K : N, top = 26, rh = Math.min(48, (H - 52) / (N + 1)), lane = W - 30, B = [], i;
    function font(px, bold) { ctx.font = (bold ? 'bold ' : '') + px + 'px ' + C.mono; }
    function rrect(x, y, w, hh, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
      ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function head(x, y, dir, col) {                   // arrowhead pointing down, up or left
      ctx.fillStyle = col; ctx.beginPath();
      if (dir === 'down') { ctx.moveTo(x - 4, y - 6); ctx.lineTo(x + 4, y - 6); }
      else if (dir === 'up') { ctx.moveTo(x - 4, y + 6); ctx.lineTo(x + 4, y + 6); }
      else { ctx.moveTo(x + 6, y - 4); ctx.lineTo(x + 6, y + 4); }
      ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    }
    function chip(x, cy, name) {                      // a guard: its drop order, or why it has none
      var f = t.fate[name], s = f ? f.state : 'none', w = ctx.measureText(name).width + 14;
      ctx.setLineDash(s === 'none' ? [3, 3] : []); ctx.lineWidth = s === 'none' ? 1 : 1.8;
      ctx.strokeStyle = s === 'dropped' ? C.good : s === 'leaked' ? C.err : C.dim;
      rrect(x, cy - 9, w, 18, 5); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = s === 'none' ? C.dim : s === 'leaked' ? C.err : C.text; ctx.textAlign = 'center'; ctx.fillText(name, x + w / 2, cy);
      if (s !== 'none' && s !== 'live') {
        ctx.fillStyle = s === 'dropped' ? C.good : C.err; ctx.beginPath(); ctx.arc(x + w - 1, cy - 10, 7, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#fff'; font(9, true); ctx.fillText(s === 'dropped' ? String(f.order) : '×', x + w - 1, cy - 9.5); font(11);
      }
      return w;
    }
    font(11); ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    for (i = 0; i <= N; i++) B.push({ x0: 54 + i * 6, x1: lane - 20, y: top + i * rh + 4, h: rh - 8, cy: top + i * rh + rh / 2, entered: i <= deepest, call: 0 });
    B.forEach(function (b, i) {
      ctx.setLineDash(b.entered ? [] : [4, 3]); ctx.strokeStyle = b.entered ? C.own : C.dim; ctx.lineWidth = 1;
      rrect(b.x0, b.y, b.x1 - b.x0, b.h, 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.fillStyle = b.entered ? C.text : C.dim; ctx.fillText(F[i].name, 4, b.cy);
      var x = b.x0 + 10;
      tokens(cfg, i).forEach(function (tk) {
        ctx.textAlign = 'left'; ctx.fillStyle = C.mute;
        if (tk.kind === 'bind') x += chip(x, b.cy, tk.names[0]) + 12;
        else if (tk.kind === 'pair') {
          ctx.fillText('(', x, b.cy); x += 8; x += chip(x, b.cy, tk.names[0]) + 10; x += chip(x, b.cy, tk.names[1]) + 4;
          ctx.fillStyle = C.mute; ctx.textAlign = 'left'; ctx.fillText(')', x, b.cy); x += 14;
        } else if (tk.kind === 'temp') { ctx.fillText('let _ =', x, b.cy); x += ctx.measureText('let _ =').width + 6; x += chip(x, b.cy, tk.names[0]) + 12; }
        else {
          var w = ctx.measureText(tk.text).width;
          ctx.fillStyle = tk.kind === 'fail' ? C.err : tk.kind === 'call' ? (b.entered ? C.own : C.dim) : (t.lines.indexOf('main ends') >= 0 ? C.good : C.dim);
          ctx.fillText(tk.text, x, b.cy);
          if (tk.kind !== 'text') b.call = x + Math.min(w, 26) / 2;
          if (tk.kind === 'fail') { ctx.strokeStyle = C.err; ctx.lineWidth = 1.5; rrect(x - 4, b.cy - 10, w + 8, 20, 4); ctx.stroke(); ctx.lineWidth = 1; }
          x += w + 14;
        }
      });
    });
    for (i = 0; i < deepest; i++) {                   // calls go down the left
      var cx = B[i].call || B[i].x0 + 16;
      ctx.strokeStyle = C.own; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, B[i].cy + 9); ctx.lineTo(cx, B[i + 1].y); ctx.stroke();
      head(cx, B[i + 1].y, 'down', C.own);
    }
    var COL = { ok: C.dim, err: C.shared, unwind: C.excl }, LBL = { ok: 'Ok', err: 'Err', unwind: 'unwind' };
    for (i = deepest - 1; i >= -1; i--) {             // returns come up the right: one hop per frame
      var kind = i >= 0 ? (!fails ? 'ok' : mode === 'unwind' ? 'unwind' : mode !== 'result' ? null : (h >= 0 && h < K && i < h) ? 'ok' : 'err')
                        : ({ ok: 'ok', err: 'err', panic: 'unwind' })[t.outcome];
      if (!kind) break;
      var from = B[i + 1], yTo = i >= 0 ? B[i].cy : 8;
      ctx.strokeStyle = COL[kind]; ctx.lineWidth = kind === 'ok' ? 1.2 : 2; ctx.setLineDash(kind === 'unwind' ? [6, 4] : []);
      ctx.beginPath(); ctx.moveTo(from.x1, from.cy); ctx.lineTo(lane, from.cy); ctx.lineTo(lane, i >= 0 ? yTo : yTo + 6);
      if (i >= 0) ctx.lineTo(B[i].x1 + 7, yTo);
      ctx.stroke(); ctx.setLineDash([]);
      if (i >= 0) head(B[i].x1, yTo, 'left', COL[kind]); else head(lane, yTo, 'up', COL[kind]);
      ctx.fillStyle = COL[kind]; ctx.textAlign = 'right'; font(10); ctx.fillText(LBL[kind], lane - 4, (from.cy + yTo) / 2); font(11);
    }
    ctx.textAlign = 'right'; font(10, true);
    if (fails && mode === 'result' && h >= 0 && h < K) { ctx.fillStyle = C.good; ctx.fillText('handled', B[h].x1 - 4, B[h].y + 8); }
    if (fails && (mode === 'abort' || mode === 'exit')) {
      var bk = B[K]; ctx.strokeStyle = C.err; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(lane - 7, bk.cy - 7); ctx.lineTo(lane + 7, bk.cy + 7); ctx.moveTo(lane + 7, bk.cy - 7); ctx.lineTo(lane - 7, bk.cy + 7); ctx.stroke();
      ctx.lineWidth = 1; ctx.fillStyle = C.err; ctx.fillText((mode === 'abort' ? 'abort' : 'exit(1)') + ': the process ends here', bk.x1 - 4, bk.y + bk.h - 7);
    }
    ctx.textAlign = 'left'; font(10); ctx.fillStyle = C.mute;
    ctx.fillText('process: ' + (typeof t.status === 'number' ? 'status ' + t.status : t.status), 4, 10);
    ctx.fillStyle = C.dim;
    var l1 = 'n = drop order · dashed: never created · red: never dropped', l2 = '↓ call · ↑ return: Ok grey · Err blue · unwinding orange';
    if (ctx.measureText(l1 + ' · ' + l2).width < W - 8) ctx.fillText(l1 + ' · ' + l2, 4, H - 9);
    else { ctx.fillText(l1, 4, H - 18); ctx.fillText(l2, 4, H - 6); }
    font(11);
  };

  root.Unwind = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : this);
