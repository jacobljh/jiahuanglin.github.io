/* captures.js — the capture analyzer behind Lesson 14's widget ("What does this closure capture?").
 *
 * Model. An enclosing function owns four variables, one of each kind the lesson discusses:
 *     let mut count: i32 = 0;                      // Copy value
 *     let mut report = String::from("ok");         // owning, not Copy
 *     let ages: &Vec<i32> = &data;                 // shared reference (Copy)
 *     let picked: &mut Vec<i32> = &mut chosen;     // exclusive reference (not Copy; binding not `mut`)
 * A closure `let mut f = [move] || { ...lines... };` is a list of lines, each ONE use of one variable:
 * read / mutate / move-out (pass by value to `fn consume<T>(_x: T) {}`).  Domain: a non-Copy
 * variable is never used again in the body after it has been moved out (the widget never builds one).
 *
 * For that closure it computes what rustc computes (differential-tested by tools/rust_verify/14_captures.js):
 *   - each variable's capture mode (shared / unique / exclusive / by value) and captured path (x or *x),
 *   - which of Fn / FnMut / FnOnce the closure implements,
 *   - what the enclosing function may still do with each variable while `f` is alive, as rustc's verdict
 *     (ok or the error code) for: read it, mutate it, move it — then call f(),
 *   - whether `std::thread::spawn(f)` is accepted, and if not the errors (E0373 per borrowed local,
 *     E0597 per referent that would have to live forever),
 *   - the closure's size in bytes, as rustc 1.98.1 lays it out on aarch64 (measured, per case).
 *
 * API:  Captures.VARS, Captures.OPS, Captures.LINE, Captures.ACT, Captures.PRESETS, Captures.CODE
 *       Captures.body({count:'read', report:'move', ...})  -> [{v, op}]   (reads first, then stronger uses)
 *       Captures.analyze({ lines: [{v:'count', op:'read'}, ...], move: false })  -> result (see bottom)
 *       Captures.describe(result, bodyLength)  -> { kpi[4], spawn[], text, conflict }   (the widget's words)
 */
(function (root) {
  'use strict';
  var C = {};

  var VARS = [
    { name: 'count',  cls: 'i32',    copy: true,  ty: 'i32',           decl: 'let mut count: i32 = 0;' },
    { name: 'report', cls: 'String', copy: false, ty: 'String',        decl: 'let mut report = String::from("ok");' },
    { name: 'ages',   cls: 'ref',    copy: true,  ty: '&Vec<i32>',     decl: 'let ages: &Vec<i32> = &data;',          referent: 'data' },
    { name: 'picked', cls: 'mut',    copy: false, ty: '&mut Vec<i32>', decl: 'let picked: &mut Vec<i32> = &mut chosen;', referent: 'chosen' }
  ];
  var BY = {}; VARS.forEach(function (v) { BY[v.name] = v; });
  var OPS = { count: ['read', 'mutate', 'move'], report: ['read', 'mutate', 'move'], ages: ['read', 'move'], picked: ['read', 'mutate', 'move'] };
  // one line of closure body per (variable, use)
  var LINE = {
    count:  { read: 'let c = count + 1;',   mutate: 'count += 1;',      move: 'consume(count);' },
    report: { read: 'let n = report.len();', mutate: "report.push('!');", move: 'consume(report);' },
    ages:   { read: 'let a = ages.len();',                               move: 'consume(ages);' },
    picked: { read: 'let p = picked.len();', mutate: 'picked.push(7);',  move: 'consume(picked);' }
  };
  // what the enclosing function does with the variable while f is still alive (then it calls f())
  var ACT = {
    count:  { read: 'let c2 = count + 1;',   mutate: 'count += 1;',      move: 'consume(count);' },
    report: { read: 'let n2 = report.len();', mutate: "report.push('?');", move: 'consume(report);' },
    ages:   { read: 'let a2 = ages.len();',                                move: 'consume(ages);' },
    picked: { read: 'let p2 = picked.len();', mutate: 'picked.push(9);',  move: 'consume(picked);' }
  };
  var RANK = { none: 0, shared: 1, unique: 2, exclusive: 3, value: 4 };
  var MODE_WORD = { none: 'not captured', shared: 'shared borrow', unique: 'unique borrow', exclusive: 'exclusive borrow', value: 'by value' };

  /* What ONE use in a non-move closure needs from its variable: a mode, and a path —
   * 'var' (the variable itself) or 'deref' (the place behind the reference: *ages, *picked). */
  function need(v, op) {
    if (v.cls === 'i32')     // a Copy value: passing it by value is only a read
      return { mode: op === 'mutate' ? 'exclusive' : 'shared', path: 'var' };
    if (v.cls === 'String')
      return { mode: { read: 'shared', mutate: 'exclusive', move: 'value' }[op], path: 'var' };
    if (v.cls === 'ref')     // ages.len() reads *ages; consume(ages) copies ages itself
      return { mode: 'shared', path: op === 'read' ? 'deref' : 'var' };
    // picked (&mut, binding not mut): read through it, write through it, or give it away
    return { mode: { read: 'shared', mutate: 'unique', move: 'value' }[op], path: op === 'move' ? 'var' : 'deref' };
  }

  /* Each variable is captured in the STRONGEST mode any of its uses needs; a use of the
   * variable itself outranks a use through it (the ancestor path wins). */
  function captures(lines, isMove) {
    var st = {};
    VARS.forEach(function (v) { st[v.name] = { mode: 'none', path: null, line: -1 }; });
    lines.forEach(function (ln, i) {
      var s = st[ln.v];
      var n = isMove ? { mode: 'value', path: 'var' } : need(BY[ln.v], ln.op);  // move: all by value
      if (RANK[n.mode] > RANK[s.mode]) { s.mode = n.mode; s.line = i; }
      if (s.path !== 'var') s.path = n.path;
    });
    return st;
  }

  /* The traits follow from what the BODY does, not from how the captures are held. */
  function traitOf(lines) {
    var once = [], mut = [];
    lines.forEach(function (ln, i) {
      if (ln.op === 'move' && !BY[ln.v].copy) once.push(i);   // gives an owned capture away
      if (ln.op === 'mutate') mut.push(i);                     // changes a capture
    });
    if (once.length) return { trait: 'FnOnce', why: once, Fn: false, FnMut: false, FnOnce: true };
    if (mut.length) return { trait: 'FnMut', why: mut, Fn: false, FnMut: true, FnOnce: true };
    return { trait: 'Fn', why: [], Fn: true, FnMut: true, FnOnce: true };
  }

  /* rustc's verdict when the enclosing function does `act` to v while the closure is alive. */
  function action(v, s, act) {
    if (s.mode === 'none') return 'ok';
    if (v.cls === 'ref') return 'ok';                           // reading or copying a & never conflicts
    if (v.cls === 'i32') {
      if (s.mode === 'value') return 'ok';                      // move closure: it holds its own copy
      if (s.mode === 'shared') return act === 'mutate' ? 'E0506' : 'ok';
      return 'E0503';                                           // any use while mutably borrowed
    }
    if (s.mode === 'value') return 'E0382';                     // moved into the closure
    if (s.mode === 'shared') return act === 'read' ? 'ok' : act === 'mutate' ? 'E0502' : 'E0505';
    if (s.mode === 'unique') return act === 'move' ? 'E0505' : 'E0501';
    return act === 'read' ? 'E0502' : act === 'mutate' ? 'E0499' : 'E0505';   // exclusive
  }

  /* thread::spawn needs F: 'static (+ Send, which every capture here is): nothing borrowed may go. */
  function spawn(st) {
    var errs = [];
    VARS.forEach(function (v) {
      var s = st[v.name];
      if (s.mode === 'none') return;
      if (v.referent) errs.push({ code: 'E0597', name: v.referent });        // it points into a local
      if (s.mode !== 'value' && s.path === 'var') errs.push({ code: 'E0373', name: v.name });
    });
    return { ok: errs.length === 0, errors: errs };
  }

  /* Size on rustc 1.98.1, aarch64: one pointer per borrowed capture, the value itself otherwise. */
  function sizeOf(st) {
    var total = 0, align = 1;
    VARS.forEach(function (v) {
      var s = st[v.name];
      if (s.mode === 'none') return;
      var sz = s.mode !== 'value' ? 8 : v.cls === 'i32' ? 4 : v.cls === 'String' ? 24 : 8;
      var al = sz === 4 ? 4 : 8;
      total += sz; if (al > align) align = al;
    });
    return Math.ceil(total / align) * align;
  }

  function holds(v, s) {
    if (s.mode === 'none') return '';
    if (s.mode === 'value') return v.cls === 'i32' ? 'i32 (a copy)' : v.cls === 'String' ? 'String (moved in)'
      : v.cls === 'ref' ? '&Vec<i32> (a copy of ages)' : '&mut Vec<i32> (moved in)';
    var place = s.path === 'deref' ? '*' + v.name : v.name;
    if (s.mode === 'shared') return '&' + place;
    if (s.mode === 'unique') return 'unique borrow of ' + place;
    return '&mut ' + place;
  }

  function analyze(cfg) {
    var lines = cfg.lines || [], isMove = !!cfg.move;
    var st = captures(lines, isMove), tr = traitOf(lines), vars = {};
    VARS.forEach(function (v) {
      var s = st[v.name], acts = {};
      OPS[v.name].forEach(function (a) { acts[a] = action(v, s, a); });
      vars[v.name] = { mode: s.mode, word: MODE_WORD[s.mode], path: s.path, line: s.line, holds: holds(v, s), actions: acts };
    });
    return { vars: vars, trait: tr.trait, traitWhy: tr.why, implements: { Fn: tr.Fn, FnMut: tr.FnMut, FnOnce: tr.FnOnce },
             spawn: spawn(st), size: sizeOf(st), move: isMove, n: lines.length };
  }

  /* The widget's body: every chosen variable is first read, then (round 2) used in its strongest way. */
  function body(ops) {
    var out = [];
    VARS.forEach(function (v) { var o = ops[v.name]; if (o && o !== 'none') out.push({ v: v.name, op: 'read' }); });
    VARS.forEach(function (v) { var o = ops[v.name]; if (o === 'mutate' || o === 'move') out.push({ v: v.name, op: o }); });
    return out;
  }

  /* The widget's presets (the lesson's worked examples) and a few words per verdict code. */
  function P(c, r, a, p, m) { return { ops: { count: c, report: r, ages: a, picked: p }, move: m }; }
  var PRESETS = { tour: P('mutate', 'move', 'read', 'mutate', false), readers: P('read', 'read', 'read', 'read', false),
    writer: P('mutate', 'read', 'none', 'none', false), consumer: P('none', 'move', 'read', 'none', false),
    copytrap: P('move', 'none', 'move', 'none', false), thread: P('mutate', 'mutate', 'none', 'none', true) };
  var CODE = { E0506: 'assigned while borrowed', E0503: 'used while mutably borrowed', E0502: 'shared and exclusive borrows overlap',
    E0499: 'two exclusive borrows', E0501: 'f needs unique access', E0505: 'moved while borrowed', E0382: 'used after moving into f' };

  /* The widget's words for a result (DOM-free, so the lesson's claims can be checked in Node):
   * the four KPI values, the thread::spawn lines for the canvas, and the readout text. */
  function spawnWhy(e) { return e.code === 'E0373' ? 'E0373 (f borrows ' + e.name + ')' : 'E0597 (' + e.name + ' dies too soon)'; }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function describe(res, total) {
    var nb = 0, nv = 0, codes = {}, out = [], one = res.traitWhy.length === 1;
    var why = (one ? 'line ' : 'lines ') + res.traitWhy.map(function (i) { return i + 1; }).join(', ');
    VARS.forEach(function (v) { var m = res.vars[v.name].mode; if (m === 'value') nv++; else if (m !== 'none') nb++; });
    out.push('f = ' + (res.move ? 'move ' : '') + '|| { ' + res.n + ' of ' + total + ' lines } implements ' +
      (res.trait === 'Fn' ? 'Fn, FnMut and FnOnce: the body only reads its captures'
        : res.trait === 'FnMut' ? 'FnMut and FnOnce, not Fn: ' + why + (one ? ' changes a capture' : ' change captures')
        : 'only FnOnce: ' + why + (one ? ' gives an owned capture away' : ' give owned captures away')));
    VARS.forEach(function (v) {
      var s = res.vars[v.name];
      var acts = OPS[v.name].map(function (a) { var c = s.actions[a]; if (c !== 'ok') codes[c] = 1; return (a === 'move' ? 'move out' : a) + ' ' + c; });
      out.push(pad(v.name, 7) + pad(s.word, 17) + pad(s.mode === 'none' ? '' : 'holds ' + s.holds, 34) + '| ' + acts.join(' · '));
    });
    out.push('size ' + res.size + ' bytes (rustc 1.98.1, aarch64) · thread::spawn(f): ' +
      (res.spawn.ok ? 'accepted' : 'rejected, ' + res.spawn.errors.map(spawnWhy).join(', ')));
    var legend = Object.keys(codes).sort().map(function (c) { return c + ': ' + CODE[c]; });
    if (legend.length) out.push(legend.join(' · '));
    return { kpi: [res.trait, nb + nv ? nb + ' borrowed · ' + nv + ' by value' : 'nothing', res.size + ' bytes', res.spawn.ok ? 'accepted' : 'rejected'],
             spawn: res.spawn.ok ? ['✓ accepted: f owns all it uses'] : res.spawn.errors.map(function (e) { return '✗ ' + spawnWhy(e); }),
             text: out.join('\n'), conflict: legend.length > 0 };
  }

  C.VARS = VARS; C.OPS = OPS; C.LINE = LINE; C.ACT = ACT; C.RANK = RANK; C.MODE_WORD = MODE_WORD; C.PRESETS = PRESETS; C.CODE = CODE;
  C.need = need; C.captures = captures; C.traitOf = traitOf; C.action = action; C.spawn = spawn; C.sizeOf = sizeOf;
  C.analyze = analyze; C.body = body; C.describe = describe;
  root.Captures = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : this);
