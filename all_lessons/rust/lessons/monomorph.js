/* monomorph.js — a miniature monomorphization collector, the engine of Lesson 12's widget (w12).
 *
 * A program is a set of generic functions — each with type parameters and the calls its body makes
 * (callee + type arguments written over the caller's parameters) — plus main's calls with concrete
 * types. collect() does the collector's job: start from main; every request fn::<concrete args> that
 * has not been stamped out yet becomes a new copy, and the calls in its body are requested in turn,
 * with the copy's types substituted for the parameters. A request for a copy that already exists is
 * a reuse. A function that recurs on its own chain of requests more than `limit` times is reported
 * the way rustc 1.98.1 reports it ("reached the recursion limit while instantiating"); rustc's
 * default limit is 128 (the crate's recursion_limit), observed in Lesson 12 §3.
 *
 * Differential-tested against rustc: tools/rust_verify/12_mono.js compiles random programs whose
 * generic bodies print std::any::type_name, runs them, and compares the copies that ran.
 *
 * API (everything except mount() is DOM-free, so Node can run it):
 *   Mono.parse("Vec<(A, i32)>") -> type AST          Mono.show(ast) -> "Vec<(A, i32)>"
 *   Mono.collect(prog, {limit}) -> { instances, requests, error }
 *        prog = { fns: { name: { params: ['T'], calls: [{ fn, args: ['Vec<T>'], back }] } },
 *                 main: [{ fn, args: ['i32'] }] }
 *   Mono.preset(id, k)          -> the preset program with main using the first k of Mono.TYPES
 *   Mono.cost(result)           -> { bytes, bodies, ms, missing }   (measured table below)
 *   Mono.describe(result, id, k)-> readout lines
 *   Mono.draw(ctx, W, H, result, step, C)   the canvas picture (2D context only)
 *   Mono.mount(document, window)            wires the lesson's #w12 controls, KPIs and readout
 */
(function (root) {
  'use strict';
  var M = {};

  /* ───────────── types ───────────── */
  function tokenize(s) {
    var out = [], re = /\s*(&[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|[<>(),])/y, i = 0, m;
    while (i < s.length) {
      re.lastIndex = i; m = re.exec(s);
      if (!m) { if (/^\s*$/.test(s.slice(i))) break; throw new Error('bad type near: ' + s.slice(i)); }
      out.push(m[1]); i = re.lastIndex;
    }
    return out;
  }
  function parse(s) {
    var t = tokenize(s), p = 0;
    function ty() {
      var x = t[p++];
      if (x === '(') {
        var items = [];
        while (t[p] !== ')') { items.push(ty()); if (t[p] === ',') p++; else break; }
        if (t[p++] !== ')') throw new Error('expected ) in ' + s);
        return { k: 't', items: items };
      }
      if (!x || !/^&?[A-Za-z_]/.test(x)) throw new Error('bad type: ' + s);
      if (t[p] === '<') {
        p++; var args = [];
        while (t[p] !== '>') { args.push(ty()); if (t[p] === ',') p++; else break; }
        if (t[p++] !== '>') throw new Error('expected > in ' + s);
        return { k: 'a', n: x, args: args };
      }
      return { k: 'n', n: x };
    }
    var r = ty();
    if (p !== t.length) throw new Error('trailing input in ' + s);
    return r;
  }
  function show(t) {
    if (t.k === 'n') return t.n;
    if (t.k === 'a') return t.n + '<' + t.args.map(show).join(', ') + '>';
    return '(' + t.items.map(show).join(', ') + (t.items.length === 1 ? ',' : '') + ')';
  }
  function subst(t, env) {
    if (t.k === 'n') return env[t.n] || t;
    if (t.k === 'a') return { k: 'a', n: t.n, args: t.args.map(function (a) { return subst(a, env); }) };
    return { k: 't', items: t.items.map(function (a) { return subst(a, env); }) };
  }
  var cache = {};
  function T(s) { return cache[s] || (cache[s] = parse(s)); }

  /* ───────────── the collector ───────────── */
  // Depth-first worklist from main: reuse a copy that exists, else stamp it out and
  // request its body's calls with the copy's types substituted in.
  function collect(prog, opts) {
    var limit = opts && opts.limit != null ? opts.limit : 128;
    var seen = {}, instances = [], requests = [], depth = {}, error = null;
    function visit(fn, args, from, back) {
      if (error) return;
      var key = fn + '::<' + args.map(show).join(', ') + '>';
      var fresh = !seen[key];
      requests.push({ from: from, to: key, fresh: fresh, back: !!back });
      if (!fresh) return;                            // reuse
      var d = depth[fn] || 0;                        // fn's count on this chain
      if (d > limit) { error = { at: key, fn: fn, depth: d }; return; }
      var inst = { key: key, fn: fn, args: args.map(show), parent: from,
                   level: from === 'main' ? 1 : seen[from].level + 1 };
      seen[key] = inst; instances.push(inst);
      var def = prog.fns[fn], env = {};
      def.params.forEach(function (p, i) { env[p] = args[i]; });
      depth[fn] = d + 1;
      def.calls.forEach(function (c) {               // substitute, then request
        visit(c.fn, c.args.map(function (a) { return subst(T(a), env); }), key, c.back);
      });
      depth[fn] = d;
    }
    prog.main.forEach(function (c) { visit(c.fn, c.args.map(T), 'main', false); });
    return { instances: instances, requests: requests, error: error, main: prog.main };
  }

  /* ───────────── the preset programs (their Rust source is in the lesson) ───────────── */
  var TYPES = ['i32', 'f64', 'char', 'String', 'u8', '&str'];
  var FNS = {
    largest: { params: ['T'], calls: [] },
    show:    { params: ['T'], calls: [] },
    summary: { params: ['T'], calls: [{ fn: 'largest', args: ['T'] }, { fn: 'show', args: ['T'] }] },
    pair:    { params: ['A', 'B'], calls: [{ fn: 'show', args: ['A'] }, { fn: 'show', args: ['B'] }] },
    wrap:    { params: ['T'], calls: [] },
    nested:  { params: ['T'], calls: [{ fn: 'wrap', args: ['T'] }, { fn: 'wrap', args: ['Vec<T>'] },
                                      { fn: 'show', args: ['Vec<Vec<T>>'] }] },
    count:   { params: ['T'], calls: [{ fn: 'count', args: ['T'], back: true }] },
    nest:    { params: ['T'], calls: [{ fn: 'nest', args: ['Vec<T>'], back: true }] }
  };
  var PRESETS = {
    largest: { root: 'largest', label: 'largest, called directly',
               note: 'One definition, one copy per type main uses.' },
    summary: { root: 'summary', label: 'summary calls two helpers',
               note: 'Each copy of summary requests its own largest and show, at its own T.' },
    pair:    { root: 'pair', label: 'pair shares a helper', second: 'i32',
               note: 'Every pair requests show::<i32>; it is stamped out once and reused.' },
    nested:  { root: 'nested', label: 'types grow inside a body',
               note: 'The bodies request Vec<T> and Vec<Vec<T>>: copies at types main never wrote.' },
    count:   { root: 'count', label: 'recursion at the same type',
               note: 'The recursive call requests count::<T> again: it already exists, so the worklist ends.' },
    nest:    { root: 'nest', label: 'recursion at a growing type',
               note: 'Every copy requests nest::<Vec<T>>, a type never seen before: the worklist never empties.' }
  };
  function preset(id, k) {
    var p = PRESETS[id];
    return { fns: FNS, main: TYPES.slice(0, k).map(function (t) {
      return { fn: p.root, args: p.second ? [t, p.second] : [t] };
    }) };
  }

  /* ───────────── measured cost table ─────────────
   * Bytes of machine code per copy: rustc 1.98.1, --edition 2024 --crate-type lib -C opt-level=3
   * -C codegen-units=1 --emit=obj, aarch64-apple-darwin (Apple M5), 2026-09-30; every generic fn
   * #[inline(never)] so each copy stays a separate symbol; size = distance to the next symbol
   * (nm -n -C). ALIAS: two names at one address — identical code, one body in the object file.
   * Identical code is not always merged: the String, &str, f64 and u8 copies of count are the same
   * two instructions (mov x0, x1; ret) at four separate addresses.
   * MS_PER_COPY: (148.7 ms − 23.9 ms) / 128 — median of 21 compiles of a crate with 128 copies of
   * largest over [u8; 1] … [u8; 128], minus the same crate with none (-C opt-level=3, same flags;
   * the program that measured it is in the lesson, §5). One machine; an estimate, not a law. */
  var BYTES = {
    'largest::<i32>': 80, 'largest::<f64>': 80, 'largest::<char>': 80, 'largest::<String>': 136, 'largest::<u8>': 80, 'largest::<&str>': 144,
    'show::<i32>': 60, 'show::<f64>': 60, 'show::<char>': 60, 'show::<String>': 60, 'show::<u8>': 60, 'show::<&str>': 60,
    'summary::<i32>': 136, 'summary::<f64>': 136, 'summary::<char>': 136, 'summary::<String>': 136, 'summary::<u8>': 136, 'summary::<&str>': 136,
    'pair::<i32, i32>': 212, 'pair::<f64, i32>': 212, 'pair::<char, i32>': 212, 'pair::<String, i32>': 212, 'pair::<u8, i32>': 212, 'pair::<&str, i32>': 212,
    'wrap::<i32>': 84, 'wrap::<f64>': 84, 'wrap::<char>': 84, 'wrap::<String>': 228, 'wrap::<u8>': 88, 'wrap::<&str>': 88,
    'wrap::<Vec<i32>>': 320, 'wrap::<Vec<f64>>': 320, 'wrap::<Vec<char>>': 320, 'wrap::<Vec<String>>': 228, 'wrap::<Vec<u8>>': 308, 'wrap::<Vec<&str>>': 320,
    'show::<Vec<Vec<i32>>>': 60, 'show::<Vec<Vec<f64>>>': 60, 'show::<Vec<Vec<char>>>': 60, 'show::<Vec<Vec<String>>>': 60, 'show::<Vec<Vec<u8>>>': 60, 'show::<Vec<Vec<&str>>>': 60,
    'nested::<i32>': 236, 'nested::<f64>': 236, 'nested::<char>': 236, 'nested::<String>': 368, 'nested::<u8>': 224, 'nested::<&str>': 236,
    'count::<i32>': 8, 'count::<f64>': 8, 'count::<char>': 8, 'count::<String>': 8, 'count::<u8>': 8, 'count::<&str>': 8
  };
  var ALIAS = { 'wrap::<Vec<i32>>': 'wrap::<Vec<char>>', 'count::<i32>': 'count::<char>' };
  var MS_PER_COPY = 0.975;

  function cost(res) {
    if (res.error) return { bytes: null, bodies: null, ms: null, missing: 0 };
    var bodies = {}, bytes = 0, missing = 0, n = 0;
    res.instances.forEach(function (i) {
      var b = ALIAS[i.key] || i.key;
      if (!(i.key in BYTES)) { missing++; return; }
      if (bodies[b]) return;
      bodies[b] = true; n++; bytes += BYTES[b];
    });
    return { bytes: bytes, bodies: n, ms: Math.round(res.instances.length * MS_PER_COPY * 10) / 10, missing: missing };
  }

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function shortKey(key) {                              // nest::<Vec<Vec<…>>> for the huge ones
    var m = /^(\w+)::<(Vec<)+/.exec(key);
    if (!m) return key;
    var levels = (key.match(/Vec</g) || []).length;
    return levels > 3 ? m[1] + '::<Vec<…' + levels + ' levels…>>' : key;
  }

  function describe(res, id, k) {
    var p = PRESETS[id], lines = [];
    var mainTypes = {};
    res.main.forEach(function (c) { c.args.forEach(function (a) { mainTypes[a] = true; }); });
    lines.push('main uses ' + k + ' type' + (k > 1 ? 's' : '') + ': ' + TYPES.slice(0, k).join(', '));
    var fromMain = res.requests.filter(function (r) { return r.from === 'main'; }).length;
    var reuse = res.requests.filter(function (r) { return !r.fresh; }).length;
    if (res.error) {
      lines.push('requests: ' + res.requests.length + ', each one a type never seen before');
      lines.push('rustc stops: reached the recursion limit while instantiating ' + shortKey(res.error.at));
      lines.push('(' + res.error.fn + ' was already ' + res.error.depth + ' deep in its own chain; the limit is 128)');
      if (k > 1) lines.push('rustc reports this one error and aborts: the other ' + (k - 1) + ' call' + (k > 2 ? 's' : '') + ' from main never get that far');
    } else {
      var c = cost(res);
      lines.push('requests: ' + res.requests.length + ' (' + fromMain + ' from main, ' + (res.requests.length - fromMain) +
                 ' from bodies); ' + reuse + ' reuse a copy already stamped out');
      var fresh = {};
      res.instances.forEach(function (i) { i.args.forEach(function (a) { if (!mainTypes[a]) fresh[a] = true; }); });
      var ft = Object.keys(fresh);
      if (ft.length) lines.push('types main never wrote: ' + ft.join(', '));
      lines.push('copies: ' + res.instances.map(function (i) { return i.key; }).join(', '));
      lines.push('machine code: ' + fmt(c.bytes) + ' B in ' + c.bodies + ' bod' + (c.bodies === 1 ? 'y' : 'ies') +
                 (c.bodies < res.instances.length ? ' (' + (res.instances.length - c.bodies) + ' shares an address with an identical copy)' : ''));
      lines.push('compile time: ≈ ' + c.ms + ' ms (' + res.instances.length + ' × ' + MS_PER_COPY + ' ms measured per copy)');
    }
    lines.push(p.note);
    return lines;
  }
  function kpis(res) {                                  // the four KPI cards, as text
    var c = cost(res), reuse = res.requests.filter(function (q) { return !q.fresh; }).length;
    return [res.error ? 'no end' : String(res.instances.length), res.requests.length + ' (' + reuse + ')',
            res.error ? 'rejected' : fmt(c.bytes) + ' B', res.error ? '—' : '≈ ' + c.ms + ' ms'];
  }
  function stepLine(res, step) {
    if (step <= 0) return 'step 0 / ' + res.requests.length + ': nothing requested yet';
    var r = res.requests[step - 1];
    var what = res.error && r.to === res.error.at ? 'recursion limit — rejected'
             : r.fresh ? 'new copy' : 'reuse of an existing copy';
    return 'step ' + step + ' / ' + res.requests.length + ': ' + r.from + ' requests ' + shortKey(r.to) + ' → ' + what;
  }

  /* ───────────── canvas picture (pure 2D-context drawing) ───────────── */
  function draw(ctx, W, H, res, step, C) {
    ctx.clearRect(0, 0, W, H);
    var reqs = res.requests.slice(0, step), cur = reqs[reqs.length - 1];
    var byKey = {};
    res.instances.forEach(function (i) { byKey[i.key] = i; });
    var shown = [], isShown = {};
    reqs.forEach(function (r) { if (r.fresh && byKey[r.to] && !isShown[r.to]) { isShown[r.to] = true; shown.push(byKey[r.to]); } });
    var failed = res.error && cur && cur.to === res.error.at;
    // visible columns: collapse long chains to the first three levels, a gap, and the last level
    var levels = [];
    shown.forEach(function (i) { if (levels.indexOf(i.level) < 0) levels.push(i.level); });
    levels.sort(function (a, b) { return a - b; });
    var gap = false;
    if (levels.length > 5) { levels = levels.slice(0, 3).concat([levels[levels.length - 1]]); gap = true; }
    var cols = [0].concat(levels), ncols = cols.length + (failed ? 1 : 0) + (gap ? 1 : 0);
    var left = 8, mainW = 44, top = 14, bottom = 26;
    var colW = (W - left - mainW - 16) / Math.max(1, ncols - 1);
    function colX(level) {
      var j = cols.indexOf(level);
      if (j < 0) return -1;
      if (gap && j === cols.length - 1) j += 1;
      return j === 0 ? left : left + mainW + 12 + (j - 1) * colW;
    }
    var rowsIn = {}, pos = {};
    shown.forEach(function (i) {
      if (cols.indexOf(i.level) < 0) return;
      rowsIn[i.level] = (rowsIn[i.level] || 0) + 1;
    });
    var maxRows = 1;
    Object.keys(rowsIn).forEach(function (l) { maxRows = Math.max(maxRows, rowsIn[l]); });
    var rowH = Math.min(30, (H - top - bottom) / maxRows), boxH = Math.min(20, rowH - 3);
    var fill = {};
    shown.forEach(function (i) {
      var x = colX(i.level);
      if (x < 0) return;
      var r = fill[i.level] = (fill[i.level] || 0) + 1;
      pos[i.key] = { x: x, y: top + (r - 0.5) * rowH, w: colW - 14 };
    });
    pos.main = { x: left, y: top + 0.5 * (H - top - bottom), w: mainW };
    ctx.font = Math.max(9, Math.min(11.5, boxH - 6)) + 'px ' + C.mono;
    ctx.textBaseline = 'middle';
    function edge(a, b, dashed, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dashed ? [4, 3] : []);
      ctx.beginPath();
      if (a === b) {                                     // a copy requesting itself: a loop
        ctx.arc(a.x + a.w - 6, a.y - boxH / 2, 7, Math.PI, 2 * Math.PI);
      } else {
        var x0 = a.x + a.w, x1 = b.x, xm = (x0 + x1) / 2;
        if (x1 <= x0) { x0 = a.x + a.w / 2; x1 = b.x + b.w / 2; xm = (x0 + x1) / 2; }
        ctx.moveTo(x0, a.y); ctx.bezierCurveTo(xm, a.y, xm, b.y, x1, b.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    reqs.forEach(function (r) {
      var a = pos[r.from], b = pos[r.to], hot = r === cur;
      if (!a || !b) return;
      edge(a, b, !r.fresh, hot ? C.excl : (r.fresh ? C.live : C.shared), hot ? 2.6 : (r.fresh ? 1.3 : 1.1));
    });
    function box(p, label, stroke, bg, textColor) {
      ctx.fillStyle = bg; ctx.strokeStyle = stroke; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.rect(p.x, p.y - boxH / 2, p.w, boxH); ctx.fill(); ctx.stroke();
      var s = label;
      while (s.length > 4 && ctx.measureText(s).width > p.w - 8) s = s.slice(0, -2);
      ctx.fillStyle = textColor; ctx.textAlign = 'left';
      ctx.fillText(s === label ? s : s + '…', p.x + 4, p.y);
    }
    box(pos.main, 'main', C.text, C.bg, C.text);
    shown.forEach(function (i) {
      var p = pos[i.key];
      if (!p) return;
      var hot = cur && cur.to === i.key;
      box(p, shortKey(i.key), hot ? C.excl : C.good, C.bg, C.text);
    });
    if (gap) {
      var gx = left + mainW + 12 + (cols.length - 2) * colW + colW / 2 - 8;
      ctx.fillStyle = C.mute; ctx.textAlign = 'center'; ctx.fillText('…', gx, pos.main.y);
    }
    if (failed) {
      var last = shown[shown.length - 1], fp = { x: left + mainW + 12 + (ncols - 2) * colW, y: pos[last.key] ? pos[last.key].y : pos.main.y, w: colW - 14 };
      if (pos[last.key]) edge(pos[last.key], fp, false, C.err, 2.2);
      box(fp, '✗ ' + shortKey(res.error.at), C.err, C.bg, C.err);
    }
    ctx.textAlign = 'right'; ctx.fillStyle = C.dim;
    ctx.fillText('— new copy   - - reuse of a copy   ✗ recursion limit', W - 8, H - 10);
    ctx.textAlign = 'left';
    ctx.fillText('step ' + reqs.length + ' / ' + res.requests.length, left, H - 10);
  }

  /* ───────────── wiring for the lesson page: the only function here that touches the DOM ───────────── */
  function mount(doc, win) {
    function $(id) { return doc.getElementById(id); }
    var cv = $('w12-canvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    function cssv(n, fb) { try { var v = win.getComputedStyle(doc.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; } catch (e) { return fb; } }
    var C = { good: cssv('--good', '#16a34a'), err: cssv('--err', '#dc2626'), shared: cssv('--shared', '#2563eb'),
              excl: cssv('--excl', '#d97706'), live: cssv('--live', '#7c3aed'), text: cssv('--text', '#1f2430'),
              mute: cssv('--text-mute', '#5b6573'), dim: cssv('--text-dim', '#94a3b8'), bg: cssv('--bg', '#ffffff'),
              mono: cssv('--mono', 'monospace') };
    var kEl = $('w12-k'), progEl = $('w12-prog'), stepEl = $('w12-step'), st = { res: null, id: 'pair', k: 3 };
    function recompute() {
      st.k = Math.max(1, Math.min(6, +kEl.value || 1));
      st.id = PRESETS[progEl.value] ? progEl.value : 'pair';
      st.res = collect(preset(st.id, st.k));
      stepEl.max = String(st.res.requests.length);
      stepEl.value = stepEl.max;
      redraw();
    }
    function redraw() {
      var res = st.res, n = res.requests.length, step = Math.round(+stepEl.value);
      step = isNaN(step) ? n : Math.max(0, Math.min(n, step));
      var dpr = win.devicePixelRatio || 1, r = cv.getBoundingClientRect();
      var W = Math.max(320, r.width), H = Math.max(260, r.height);
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, W, H, res, step, C);
      kpis(res).forEach(function (v, i) { $('w12-k' + (i + 1)).textContent = v; });
      $('w12-k-v').textContent = String(st.k);
      $('w12-step-v').textContent = step + ' / ' + n;
      var rd = $('w12-read');
      rd.textContent = describe(res, st.id, st.k).join('\n') + '\n' + stepLine(res, step);
      rd.className = 'readout ' + (res.error ? 'err' : 'ok');
    }
    kEl.addEventListener('input', recompute);
    progEl.addEventListener('change', recompute);
    stepEl.addEventListener('input', redraw);
    $('w12-s3').addEventListener('click', function () { progEl.value = 'pair'; kEl.value = '3'; recompute(); });
    win.addEventListener('resize', redraw);
    recompute();
  }

  M.mount = mount;
  M.parse = parse; M.show = show; M.subst = subst; M.collect = collect;
  M.TYPES = TYPES; M.FNS = FNS; M.PRESETS = PRESETS; M.preset = preset;
  M.BYTES = BYTES; M.ALIAS = ALIAS; M.MS_PER_COPY = MS_PER_COPY; M.cost = cost;
  M.describe = describe; M.kpis = kpis; M.stepLine = stepLine; M.draw = draw; M.fmt = fmt; M.shortKey = shortKey;
  root.Mono = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : this);
