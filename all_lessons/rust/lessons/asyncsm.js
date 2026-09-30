/* asyncsm.js — the "Build the state machine" engine for Lesson 18 (Async — futures as state machines).
 *
 * A program is the body of one argument-less `async fn`, one statement per line:
 *
 *   let x: Buf<N>;   a buffer of N bytes: a struct holding [u8; N], not Copy
 *                    (Rust: `let x = Buf::<N>::new();`)
 *   use x;           read one byte by value — no borrow, no move   (Rust: `read(x.bytes[0]);`)
 *   borrow x;        a shared borrow that ends at once             (Rust: `look(&x);`)
 *   drop x;          move x out; its storage ends                  (Rust: `drop(x);`)
 *   await;           a suspension point, awaiting a 1-byte future  (Rust: `tick().await;`)
 *
 * Whatever is still in scope ends at the closing brace.
 *
 *   SM.parse(text)          -> { stmts, errors }
 *   SM.analyze(stmts)       -> the saved set of every await (backward liveness, Lesson 07), where each
 *                              saved value is stored (the shared prefix, or one state's own bytes), and
 *                              the predicted size_of_val of the future
 *   SM.toRust(stmts, name)  -> the async fn in Rust (SM.PRELUDE defines Buf, read, look, tick)
 *   SM.show(stmt)           -> one statement in the widget's notation
 *   SM.draw(canvas, prog, n)-> draws the first n statements (browser only); returns { n, a: the analysis }
 *   SM.report(prog, a)      -> { text, ok }: the readout lines for an analysis
 *
 * The layout rules reproduce what rustc 1.98.1 did for this family of programs; the real layout is
 * unspecified and may change in any release. tools/rust_verify/18_asyncsm.js compiles random programs
 * and compares size_of_val with SM.analyze(...).size.
 */
(function (root) {
  'use strict';
  var SM = {};
  var TAG = 1;       // the state number: one byte while there are fewer than 256 states
  var AWAITEE = 1;   // the awaited future (Tick holds one bool)
  SM.TAG = TAG; SM.AWAITEE = AWAITEE;

  SM.PRELUDE = [
    'use std::future::Future;',
    'use std::pin::Pin;',
    'use std::task::{Context, Poll};',
    'struct Buf<const N: usize> { bytes: [u8; N] }            // not Copy',
    'impl<const N: usize> Buf<N> { fn new() -> Self { Buf { bytes: [7; N] } } }',
    'fn read(b: u8) { std::hint::black_box(b); }              // a by-value read',
    'fn look<const N: usize>(b: &Buf<N>) { std::hint::black_box(b); }   // a borrow',
    'struct Tick(bool);                                       // ready on the second poll',
    'impl Future for Tick {',
    '    type Output = ();',
    '    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<\'_>) -> Poll<()> {',
    '        if self.0 { return Poll::Ready(()); }',
    '        self.0 = true;',
    '        cx.waker().wake_by_ref();',
    '        Poll::Pending',
    '    }',
    '}',
    'fn tick() -> Tick { Tick(false) }'
  ].join('\n');

  /* ───────────── parsing ───────────── */
  var NAME = '([A-Za-z_][A-Za-z0-9_]*)';
  var FORMS = [
    [new RegExp('^let\\s+' + NAME + '\\s*(?::|=)\\s*Buf\\s*(?:::)?\\s*<\\s*(\\d+)\\s*>(?:\\s*::\\s*new\\s*\\(\\s*\\))?$'), 'let'],
    [new RegExp('^use\\s+' + NAME + '$'), 'use'],
    [new RegExp('^read\\s*\\(\\s*' + NAME + '\\s*\\.\\s*bytes\\s*\\[\\s*0\\s*\\]\\s*\\)$'), 'use'],
    [new RegExp('^borrow\\s+' + NAME + '$'), 'borrow'],
    [new RegExp('^look\\s*\\(\\s*&\\s*' + NAME + '\\s*\\)$'), 'borrow'],
    [new RegExp('^drop\\s*\\(?\\s*' + NAME + '\\s*\\)?$'), 'drop'],
    [/^(?:tick\s*\(\s*\)\s*)?\.?\s*await$/, 'await']
  ];
  var MAX_STMTS = 40;
  function parse(text) {
    var stmts = [], errors = [], state = {};
    String(text).split('\n').forEach(function (raw, li) {
      var s = raw.replace(/\/\/.*$/, '').trim().replace(/;+\s*$/, '').trim();
      if (!s) return;
      var where = 'line ' + (li + 1) + ': ';
      if (stmts.length >= MAX_STMTS) { if (errors.indexOf('at most ' + MAX_STMTS + ' statements') < 0) errors.push('at most ' + MAX_STMTS + ' statements'); return; }
      var hit = null;
      for (var i = 0; i < FORMS.length && !hit; i++) { var m = FORMS[i][0].exec(s); if (m) hit = { op: FORMS[i][1], m: m }; }
      if (!hit) { errors.push(where + 'cannot read "' + s + '"'); return; }
      if (hit.op === 'await') { stmts.push({ op: 'await' }); return; }
      var name = hit.m[1];
      if (hit.op === 'let') {
        var size = +hit.m[2];
        if (state[name]) { errors.push(where + name + ' is declared twice'); return; }
        if (!(size >= 1 && size <= 65536)) { errors.push(where + 'a Buf holds 1..65536 bytes'); return; }
        state[name] = 'live'; stmts.push({ op: 'let', name: name, size: size }); return;
      }
      if (!state[name]) { errors.push(where + name + ' is used before its let'); return; }
      if (state[name] === 'moved') { errors.push(where + name + ' was dropped already (E0382: use of a moved value)'); return; }
      if (hit.op === 'drop') state[name] = 'moved';
      stmts.push({ op: hit.op, name: name });
    });
    return { stmts: stmts, errors: errors };
  }
  function show(s) {
    if (s.op === 'let') return 'let ' + s.name + ': Buf<' + s.size + '>;';
    if (s.op === 'await') return 'tick().await;';
    return s.op + ' ' + s.name + ';';
  }
  function toRust(stmts, fname) {
    var out = ['async fn ' + (fname || 'handler') + '() {'];
    stmts.forEach(function (s) {
      var line = s.op === 'let' ? 'let ' + s.name + ' = Buf::<' + s.size + '>::new();'
        : s.op === 'use' ? 'read(' + s.name + '.bytes[0]);'
        : s.op === 'borrow' ? 'look(&' + s.name + ');'
        : s.op === 'drop' ? 'drop(' + s.name + ');' : 'tick().await;';
      out.push('    ' + line);
    });
    out.push('}');
    return out.join('\n');
  }

  /* ───────────── the analysis ───────────── */
  function sum(xs) { return xs.reduce(function (t, it) { return t + it.size; }, 0); }
  function analyze(stmts) {
    var n = stmts.length, L = {}, names = [], awaits = [];
    stmts.forEach(function (s, i) {
      if (s.op === 'await') { awaits.push(i); return; }
      if (s.op === 'let') { L[s.name] = { name: s.name, size: s.size, def: i, last: -1, borrow: -1, drop: -1 }; names.push(s.name); return; }
      var x = L[s.name]; x.last = i;
      if (s.op === 'borrow' && x.borrow < 0) x.borrow = i;
      if (s.op === 'drop') x.drop = i;
    });
    // ---- layout core
    // Statement i happens at time i; the closing brace is time n. Storage runs from the let to the
    // drop — or to the closing brace if the value is never dropped, or was borrowed (rule 3: rustc
    // assumes a borrowed value may still be in use, so a later move does not end the storage).
    names.forEach(function (v) { var x = L[v]; x.end = (x.drop >= 0 && x.borrow < 0) ? x.drop : n; });
    // Saved across await k: storage still live, and used after k (liveness) or borrowed before k (rule 3).
    function savedAt(x, k) { return x.def < k && k < x.end && (x.last > k || (x.borrow >= 0 && x.borrow < k)); }
    var items = [];                                   // every value the future stores, in source order
    stmts.forEach(function (s, i) {
      if (s.op === 'let' && awaits.some(function (k) { return savedAt(L[s.name], k); }))
        items.push({ name: s.name, size: s.size, lo: L[s.name].def, hi: L[s.name].end, local: true });
      if (s.op === 'await') items.push({ name: 'tick', size: AWAITEE, lo: i, hi: i, local: false });
    });
    var states = awaits.map(function (k) {
      return { at: k, fields: items.filter(function (it) { return it.local ? savedAt(L[it.name], k) : it.lo === k; }) };
    });
    // Rule 1: saved in two or more states -> the prefix every state shares.
    items.forEach(function (it) { it.home = null; it.why = ''; });
    states.forEach(function (st, j) {
      st.fields.forEach(function (it) {
        if (it.home === null) it.home = j;
        else if (it.home !== 'prefix') { it.home = 'prefix'; it.why = 'saved in two or more states'; }
      });
    });
    // Rule 2: two values of different states whose storage overlaps cannot share bytes; rustc moves
    // the one whose storage overlaps more values (on a tie, the later one) to the prefix.
    function overlap(a, b) { return a.lo <= b.hi && b.lo <= a.hi; }
    function degree(a) { return items.filter(function (b) { return overlap(a, b); }).length; }
    items.forEach(function (a) {
      if (a.home === 'prefix') return;
      items.forEach(function (b) {
        if (!overlap(a, b) || b.home === 'prefix' || a.home === b.home) return;
        var loser = degree(a) > degree(b) ? a : b, other = loser === a ? b : a;
        if (loser.home !== 'prefix') { loser.home = 'prefix'; loser.why = 'storage overlaps ' + other.name + ', in another state'; }
      });
    });
    // Last: if at most one state still has bytes of its own, nothing can overlap, so rustc puts all of
    // them in the prefix (with every field byte-aligned, as here, the size is the same either way).
    var owners = {};
    items.forEach(function (it) { if (it.home !== 'prefix') owners[it.home] = true; });
    if (Object.keys(owners).length < 2)
      items.forEach(function (it) { if (it.home !== 'prefix') { it.home = 'prefix'; it.why = 'no other state to overlap with'; } });
    // Size: the state number, the prefix, and the largest state's own bytes.
    var prefix = items.filter(function (it) { return it.home === 'prefix'; });
    var size = TAG + sum(prefix);
    states.forEach(function (st, j) {
      st.own = st.fields.filter(function (it) { return it.home === j; });
      st.size = TAG + sum(prefix) + sum(st.own);
      size = Math.max(size, st.size);
    });
    // ---- end layout core ----
    // Live (Lesson 07's rule, no borrow extension): defined before k and used after it.
    function liveAt(x, k) { return x.def < k && k < x.last; }
    var live = awaits.map(function (k) { return names.reduce(function (t, v) { return t + (liveAt(L[v], k) ? L[v].size : 0); }, 0); });
    return {
      n: n, locals: L, names: names, awaits: awaits, items: items, states: states, prefix: prefix,
      prefixSize: TAG + sum(prefix), size: size,
      largestLive: live.length ? Math.max.apply(null, live) : 0,
      lower: TAG + states.reduce(function (m, st) { return Math.max(m, sum(st.fields)); }, 0),
      savedAt: function (name, k) { return !!L[name] && savedAt(L[name], k); },
      liveAt: function (name, k) { return !!L[name] && liveAt(L[name], k); }
    };
  }

  /* ───────────── the picture and the words (browser only: nothing above touches the DOM) ───────────── */
  function label(it) { return it.local ? it.name : 'tick'; }
  function colors() {
    function cssv(n, fb) { try { var v = root.getComputedStyle(root.document.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; } catch (e) { return fb; } }
    return { shared: cssv('--shared', '#2563eb'), excl: cssv('--excl', '#d97706'), live: cssv('--live', '#7c3aed'), own: cssv('--own', '#334155'),
             err: cssv('--err', '#dc2626'), mute: cssv('--text-mute', '#5b6573'), dim: cssv('--text-dim', '#94a3b8'),
             text: cssv('--text', '#1f2430'), border: cssv('--border', '#dde2ea'), mono: cssv('--mono', 'monospace') };
  }
  // draw(canvas, program, shown): the first `shown` statements of the program, left: storage, live ranges and
  // what each await saves; right: the layout, one row per state. Returns { n, a }: statements drawn and the analysis.
  function draw(cv, prog, shown) {
    var ctx = cv.getContext('2d'), C = colors();
    function clip(s, w) {
      if (ctx.measureText(s).width <= w) return s;
      while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
      return s + '…';
    }
    var all = prog.stmts, n = Math.min(all.length, Math.max(1, shown || all.length));
    var stmts = all.slice(0, n), a = analyze(stmts);
    var dpr = root.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    var W = Math.max(340, r.width), H = Math.max(300, r.height);
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ' + C.mono; ctx.textBaseline = 'middle';

    // ── left: the body, storage and live ranges, saved values at each await ──
    var LW = Math.round(W * 0.5), top = 30, rows = Math.max(1, all.length), rh = Math.min(26, (H - top - 8) / rows);
    var tw = Math.min(166, LW * 0.6), cw = Math.min(28, (LW - tw - 12) / Math.max(1, a.names.length));
    function Y(i) { return top + i * rh + rh / 2; }
    var stateOf = {}; a.awaits.forEach(function (k, j) { stateOf[k] = j + 1; });
    ctx.textAlign = 'left'; ctx.fillStyle = C.mute; ctx.fillText('async fn body', 6, 12);
    a.names.forEach(function (v, j) { ctx.textAlign = 'center'; ctx.fillText(clip(v, 52), tw + 12 + j * cw + cw / 2, j % 2 ? 24 : 12); });   // two rows, so neighbours never collide
    all.forEach(function (s, i) {
      var y = Y(i), inc = i < n;
      if (inc && s.op === 'await') { ctx.fillStyle = 'rgba(37,99,235,0.09)'; ctx.fillRect(2, y - rh / 2 + 1, LW - 4, rh - 2); }
      ctx.textAlign = 'left'; ctx.fillStyle = inc ? C.dim : C.border; ctx.fillText(String(i + 1), 6, y);
      ctx.fillStyle = inc ? C.text : C.dim; ctx.fillText(clip(show(s), tw - 52), 24, y);
      if (inc && s.op === 'await') { ctx.textAlign = 'right'; ctx.fillStyle = C.shared; ctx.fillText('S' + stateOf[i], tw + 4, y); }
    });
    a.names.forEach(function (v, j) {
      var x = tw + 12 + j * cw + cw / 2, L = a.locals[v], yEnd = L.end >= n ? Y(n - 1) + rh / 2 : Y(L.end);
      ctx.strokeStyle = C.dim; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, Y(L.def)); ctx.lineTo(x, yEnd); ctx.stroke();
      if (L.last > L.def) {
        ctx.globalAlpha = 0.4; ctx.strokeStyle = C.live; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(x, Y(L.def)); ctx.lineTo(x, Y(L.last)); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (L.borrow >= 0) {
        ctx.strokeStyle = C.excl; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x + 6, Y(L.borrow)); ctx.lineTo(x + 6, yEnd); ctx.stroke(); ctx.setLineDash([]);
      }
      if (L.drop >= 0) {
        var yd = Y(L.drop); ctx.strokeStyle = C.err; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 4, yd - 4); ctx.lineTo(x + 4, yd + 4); ctx.moveTo(x + 4, yd - 4); ctx.lineTo(x - 4, yd + 4); ctx.stroke();
      }
      var item = a.items.filter(function (it) { return it.local && it.name === v; })[0];
      a.awaits.forEach(function (k) {
        if (!a.savedAt(v, k)) return;
        var col = item && item.home === 'prefix' ? C.own : C.shared;
        ctx.beginPath(); ctx.arc(x, Y(k), 4.5, 0, 6.2832);
        if (a.liveAt(v, k)) { ctx.fillStyle = col; ctx.fill(); }
        else { ctx.strokeStyle = C.excl; ctx.lineWidth = 2; ctx.stroke(); }   // kept only because it was borrowed
      });
    });

    // ── right: the layout, one row per state: # + prefix, then that state's own bytes ──
    var x0 = LW + 14, x1 = W - 8, lab = 24, avail = x1 - x0 - lab - 44;
    var pre = [{ name: '#', size: TAG, tag: true }].concat(a.prefix);
    var rowsR = a.states.length ? a.states.map(function (st, j) { return { name: 'S' + (j + 1), own: st.own }; }) : [{ name: '—', own: [] }];
    var MIN = 14, k = Infinity;
    rowsR.forEach(function (row) { var f = pre.concat(row.own); k = Math.min(k, (avail - f.length * MIN) / Math.max(1, sum(f))); });
    k = Math.max(0, k);
    function wid(it) { return MIN + k * it.size; }
    ctx.textAlign = 'left'; ctx.fillStyle = C.mute; ctx.fillText('rustc 1.98.1 layout', x0, 12);
    var bh = 18, gap = Math.min(44, (H - top - 44) / rowsR.length), end = x0 + lab;
    rowsR.forEach(function (row, ri) {
      var y = top + 6 + ri * gap, x = x0 + lab;
      ctx.textAlign = 'left'; ctx.fillStyle = C.shared; ctx.fillText(row.name, x0, y + bh / 2);
      pre.concat(row.own).forEach(function (it) {
        var w = wid(it), mine = row.own.indexOf(it) >= 0;
        ctx.fillStyle = it.tag ? 'rgba(91,101,115,0.22)' : !it.local ? 'rgba(148,163,184,0.30)' : mine ? 'rgba(37,99,235,0.16)' : 'rgba(51,65,85,0.16)';
        ctx.fillRect(x, y, w, bh);
        ctx.strokeStyle = it.tag ? C.mute : !it.local ? C.dim : mine ? C.shared : C.own; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, bh - 1);
        var t = it.tag ? '#' : it.local ? it.name + ' ' + it.size : 't';
        ctx.textAlign = 'center'; ctx.fillStyle = C.text;
        if (ctx.measureText(t).width < w - 3) ctx.fillText(t, x + w / 2, y + bh / 2);
        x += w;
      });
      ctx.textAlign = 'left'; ctx.fillStyle = C.mute;
      ctx.fillText(String(a.states.length ? a.states[ri].size : a.size), x + 4, y + bh / 2);
      end = Math.max(end, x);
    });
    var preEnd = x0 + lab + pre.reduce(function (t, it) { return t + wid(it); }, 0);
    var yb = top + 6 + rowsR.length * gap;
    ctx.strokeStyle = C.own; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0 + lab, yb); ctx.lineTo(preEnd, yb); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = C.own; ctx.fillText('prefix ' + a.prefixSize + ' B', x0 + lab, yb + 12);
    if (end > preEnd + 4) {
      ctx.strokeStyle = C.shared; ctx.beginPath(); ctx.moveTo(preEnd + 2, yb); ctx.lineTo(end, yb); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillStyle = C.shared; ctx.fillText('own bytes, overlapping', end, yb + 26);
    }
    ctx.setLineDash([4, 3]); ctx.strokeStyle = C.err; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(end + 0.5, top); ctx.lineTo(end + 0.5, yb - 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.fillStyle = C.err; ctx.fillText('size_of_val = ' + a.size + ' B', x1, H - 10);
    return { n: n, a: a };
  }
  // report(program, analysis): the readout text, one line per fact, and whether the program parsed cleanly.
  function report(prog, a) {
    var lines = [];
    if (prog.errors.length) lines.push(prog.errors.map(function (e) { return '✗ ' + e; }).join('\n'));
    if (!a.states.length) lines.push('No await yet: nothing is saved, and the future is its state byte alone (' + a.size + ' B).');
    else {
      var biggest = Math.max.apply(null, a.states.map(function (st) { return sum(st.own); }));
      lines.push(a.states.length + (a.states.length > 1 ? ' states' : ' state') + ': size_of_val = 1 (state) + ' + (a.prefixSize - TAG) +
        ' (prefix) + ' + biggest + ' (largest state\'s own bytes) = ' + a.size + ' B');
      a.states.forEach(function (st, j) {
        lines.push('S' + (j + 1) + ' (line ' + (st.at + 1) + ') saves ' + st.fields.map(function (it) {
          return label(it) + ' ' + it.size + (it.local && !a.liveAt(it.name, st.at) ? ' (not live: kept, it was borrowed)' : '');
        }).join(', ') +
          ' — own bytes: ' + (st.own.length ? st.own.map(function (it) { return label(it) + ' ' + it.size; }).join(', ') : 'none'));
      });
      a.prefix.forEach(function (it) { lines.push('prefix: ' + label(it) + ' ' + it.size + ' B, ' + it.why); });
      var gone = a.names.filter(function (v) { return !a.items.some(function (it) { return it.local && it.name === v; }); });
      if (gone.length) lines.push('never saved (not live at any await): ' + gone.join(', '));
      lines.push('lower bound (state byte + largest state) = ' + a.lower + ' B' + (a.lower === a.size ? ': reached.' : ': rustc spends ' + (a.size - a.lower) + ' B more.'));
    }
    return { text: lines.join('\n'), ok: !prog.errors.length };
  }

  SM.PRESETS = [
    { id: 'handler', label: 'handler: header, then body', text: [
      'let header: Buf<64>;', 'await;', 'use header;', 'drop header;',
      'let body: Buf<1024>;', 'await;', 'use body;'].join('\n') },
    { id: 'kept', label: 'the same, header never dropped', text: [
      'let header: Buf<64>;', 'await;', 'use header;',
      'let body: Buf<1024>;', 'await;', 'use body;'].join('\n') },
    { id: 'both', label: 'both live across one await', text: [
      'let header: Buf<64>;', 'let body: Buf<1024>;', 'await;', 'use header;', 'use body;'].join('\n') },
    { id: 'across', label: 'one buffer across two awaits', text: [
      'let session: Buf<256>;', 'await;', 'let chunk: Buf<32>;', 'await;', 'use chunk;', 'use session;'].join('\n') },
    { id: 'borrowed', label: 'borrowed, then dropped', text: [
      'let header: Buf<64>;', 'borrow header;', 'await;', 'drop header;',
      'let body: Buf<1024>;', 'await;', 'use body;'].join('\n') },
    { id: 'three', label: 'three stages (checkpoint)', text: [
      'let req: Buf<100>;', 'await;', 'use req;', 'let row: Buf<400>;', 'drop req;',
      'await;', 'use row;', 'drop row;', 'let reply: Buf<200>;', 'await;', 'use reply;'].join('\n') }
  ];

  SM.parse = parse; SM.analyze = analyze; SM.toRust = toRust; SM.show = show; SM.draw = draw; SM.report = report;
  root.AsyncSM = SM;
  if (typeof module !== 'undefined' && module.exports) module.exports = SM;
})(typeof window !== 'undefined' ? window : this);
