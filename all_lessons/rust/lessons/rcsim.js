/* rcsim.js — "Counts, guards, and cycles": the engine for Lesson 15 (smart pointers and interior mutability).
 *
 * An abstract machine for the single-threaded shared-ownership kit. A SCRIPT is a list of operations on
 * values of type Rc<RefCell<Node>>, where Node = { name, next: Option<Rc<..>>, back: Option<Weak<..>> }
 * and Node's Drop prints "drop NAME". Every operation declares a new binding (h1, h2 … strong handles,
 * w1 … Weak handles, g1 … RefCell guards) or drops one:
 *
 *   { k: 'new' }                      h = Rc::new(RefCell::new(Node))        a new allocation A, B, C …
 *   { k: 'clone', t: 'h1' }           h = Rc::clone(&h1)                      strong + 1
 *   { k: 'down',  t: 'h1' }           w = Rc::downgrade(&h1)                  weak + 1
 *   { k: 'up',    t: 'w1' }           h = w1.upgrade()                        Some (strong + 1) or None
 *   { k: 'bor',   t: 'h1' }           g = h1.borrow()                         a reader, or panic
 *   { k: 'mut',   t: 'h1' }           g = h1.borrow_mut()                     the writer, or panic
 *   { k: 'link',  t: 'h1', u: 'h2' }  h1.borrow_mut().next = Some(Rc::clone(&h2))           (strong edge)
 *   { k: 'link',  t: 'h2', u: 'h1', weak: true }  h2.borrow_mut().back = Some(Rc::downgrade(&h1))
 *   { k: 'cut',   t: 'h1' }           h1.borrow_mut().next = None                          (break an edge by hand)
 *   { k: 'drop',  t: 'g1' }           drop(g1)       (any binding)
 *
 * The closing brace ends the scope: every binding still alive is dropped, last declared first.
 *
 *   R.analyze(script) -> { ok, at, code, msg }     the compile-time check (E0505 / E0382), whole text first
 *   R.run(script)     -> { verdict, frames, panicAt, leaked, lines }   the run, frame by frame
 *   R.toRust(script, name) -> { src, lines }        the Rust function the script stands for (oracle input)
 *   R.draw(ctx, W, H, trace, step, script, colors)  paints one frame (canvas context only)
 *   R.mount('w15')                                  wires the lesson's widget (the only DOM-touching part)
 *
 * run() never reads the Rust text: it applies the counting and borrow-flag rules directly.
 * tools/rust_verify/15_rcsim.js compiles and runs toRust() for hundreds of random scripts and demands that
 * the printed transcript equals run().lines line by line (and that the rejected scripts are rejected with
 * the code and on the line analyze() names).
 */
(function (root) {
  'use strict';
  var R = {};
  R.NAMES = 'ABCDE';
  R.MAX_OPS = 14;
  R.MSG_MUT = 'RefCell already borrowed';          // borrow_mut() while any guard is alive
  R.MSG_SHR = 'RefCell already mutably borrowed';  // borrow() while the writer is alive
  var NEEDS = { clone: 'h', down: 'h', bor: 'h', mut: 'h', link: 'h', cut: 'h', up: 'w' };
  var MAKES = { 'new': 'h', clone: 'h', up: 'h', down: 'w', bor: 'g', mut: 'g' };

  function label(op, long, node) {
    var t = op.t, u = op.u;
    switch (op.k) {
      case 'new':   return long ? 'Rc::new(RefCell::new(Node::new(\'' + node + '\')))' : 'Rc::new(' + node + ')';
      case 'clone': return 'Rc::clone(&' + t + ')';
      case 'down':  return 'Rc::downgrade(&' + t + ')';
      case 'up':    return t + '.upgrade()';
      case 'bor':   return t + '.borrow()';
      case 'mut':   return t + '.borrow_mut()';
      case 'drop':  return 'drop(' + t + ')';
      case 'cut':   return long ? t + '.borrow_mut().next = None' : t + '.next = None';
      case 'link':  return op.weak ? (long ? t + '.borrow_mut().back = Some(Rc::downgrade(&' + u + '))' : t + '.back = Rc::downgrade(&' + u + ')')
                                   : (long ? t + '.borrow_mut().next = Some(Rc::clone(&' + u + '))' : t + '.next = Rc::clone(&' + u + ')');
    }
    return '?';
  }
  // Binding names are a pure function of the op kinds: h1, h2 … / w1 … / g1 … in declaration order.
  function names(script) {
    var n = { h: 0, w: 0, g: 0 };
    return script.map(function (op) { var m = MAKES[op.k]; return m ? m + (++n[m]) : null; });
  }
  function nodeOf(script, i) { return R.NAMES[script.slice(0, i).filter(function (o) { return o.k === 'new'; }).length]; }
  R.names = names;
  R.label = function (script, i, long) {             // 'let h2 = Rc::clone(&h1);' (long) or 'h2 = Rc::clone(&h1)'
    var nm = names(script)[i], s = label(script[i], long, nodeOf(script, i));
    return long ? (nm ? 'let ' + nm + ' = ' : '') + s + ';' : (nm ? nm + ' = ' : '') + s;
  };

  /* ───── compile time: the text is checked before anything runs ───── */
  R.analyze = function (script) {
    var nm = names(script), b = {};                 // name -> { kind, dropped, via }
    for (var i = 0; i < script.length; i++) {
      var op = script[i], used = [op.t, op.u].filter(Boolean);
      for (var j = 0; j < used.length; j++) {
        var x = b[used[j]];
        if (!x) return { ok: false, at: i, code: 'bad', msg: used[j] + ' is not declared' };
        if (x.dropped) return { ok: false, at: i, code: 'E0382', msg: (op.k === 'drop' ? 'use' : 'borrow') + ' of moved value: `' + used[j] + '`' };
      }
      if (NEEDS[op.k] && b[op.t].kind !== NEEDS[op.k]) return { ok: false, at: i, code: 'bad', msg: op.k + ' needs a ' + NEEDS[op.k] + ' binding' };
      if (op.k === 'link' && b[op.u].kind !== 'h') return { ok: false, at: i, code: 'bad', msg: 'link needs two strong handles' };
      if (op.k === 'drop') {
        if (b[op.t].kind === 'h') {                 // a guard borrowed through this handle still exists
          for (var k in b) if (b[k].kind === 'g' && b[k].via === op.t && !b[k].dropped)
            return { ok: false, at: i, code: 'E0505', msg: 'cannot move out of `' + op.t + '` because it is borrowed', guard: k };
        }
        b[op.t].dropped = true;
      }
      if (nm[i]) b[nm[i]] = { kind: MAKES[op.k], dropped: false, via: MAKES[op.k] === 'g' ? op.t : null };
    }
    return { ok: true };
  };

  /* ───── run time: counts and the borrow flag ───── */
  function fresh() { return { allocs: [], binds: [], n: { h: 0, w: 0, g: 0 } }; }
  function copy(st) { return JSON.parse(JSON.stringify(st)); }
  function find(st, name) { for (var i = 0; i < st.binds.length; i++) if (st.binds[i].name === name) return st.binds[i]; return null; }
  function bind(st, kind, a, excl, via) { var x = { name: kind + (++st.n[kind]), kind: kind, a: a, live: true, excl: !!excl, via: via || null }; st.binds.push(x); return x; }

  function decStrong(st, a, ev) {                   // one strong owner fewer; at zero the value is dropped
    var A = st.allocs[a];
    if (--A.strong === 0) {
      A.alive = false; ev.push(A.name);            // Node's Drop prints first, then its fields drop:
      var n = A.next, w = A.back; A.next = -1; A.back = -1;
      if (n >= 0) decStrong(st, n, ev);            //   next: an Rc — may cascade
      if (w >= 0) st.allocs[w].weak--;             //   back: a Weak — never drops anything
    }
  }
  function release(st, x, ev) {                     // drop(x) for any live binding
    x.live = false;
    if (x.kind === 'h' && x.a >= 0) decStrong(st, x.a, ev);
    else if (x.kind === 'w') st.allocs[x.a].weak--;
    else if (x.kind === 'g') { if (x.excl) st.allocs[x.a].writer = false; else st.allocs[x.a].readers--; }
  }
  // Operations the machine cannot perform (the widget never offers them; the oracle never generates them).
  function refuse(st, op) {
    if (op.k === 'new' && st.allocs.length >= R.NAMES.length) return 'at most ' + R.NAMES.length + ' allocations';
    var ts = [op.t, op.u].filter(Boolean).map(function (n) { return find(st, n); });
    for (var i = 0; i < ts.length; i++) if (ts[i].kind === 'h' && ts[i].a < 0 && op.k !== 'drop') return ts[i].name + ' is None (the upgrade failed): nothing to use';
    return null;
  }
  // One operation. Returns 'ok' | 'some' | 'none' | { panic: message }.
  function apply(st, op, ev) {
    var t = op.t ? find(st, op.t) : null, A = t && t.a >= 0 ? st.allocs[t.a] : null, u, old;
    switch (op.k) {
      case 'new':   st.allocs.push({ name: R.NAMES[st.allocs.length], strong: 1, weak: 0, readers: 0, writer: false, alive: true, next: -1, back: -1 });
                    bind(st, 'h', st.allocs.length - 1); return 'ok';
      case 'clone': A.strong++; bind(st, 'h', t.a); return 'ok';
      case 'down':  A.weak++;   bind(st, 'w', t.a); return 'ok';
      case 'up':    if (A.strong > 0) { A.strong++; bind(st, 'h', t.a); return 'some'; }
                    bind(st, 'h', -1); return 'none';
      case 'bor':   if (A.writer) return { panic: R.MSG_SHR };
                    A.readers++; bind(st, 'g', t.a, false, t.name); return 'ok';
      case 'mut':   if (A.writer || A.readers > 0) return { panic: R.MSG_MUT };
                    A.writer = true; bind(st, 'g', t.a, true, t.name); return 'ok';
      case 'link':  u = find(st, op.u);
                    if (A.writer || A.readers > 0) return { panic: R.MSG_MUT };   // the temporary borrow_mut() fails
                    if (op.weak) { st.allocs[u.a].weak++; old = A.back; A.back = u.a; if (old >= 0) st.allocs[old].weak--; }
                    else { st.allocs[u.a].strong++; old = A.next; A.next = u.a; if (old >= 0) decStrong(st, old, ev); }
                    return 'ok';
      case 'cut':   if (A.writer || A.readers > 0) return { panic: R.MSG_MUT };
                    old = A.next; A.next = -1; if (old >= 0) decStrong(st, old, ev); return 'ok';
      case 'drop':  release(st, t, ev); return 'ok';
    }
  }

  function stateLine(st) {                          // what the oracle program prints after each step
    return '|' + st.allocs.map(function (A) {
      var s = A.strong, w = s > 0 ? A.weak : 0;
      var c = !A.alive ? 'dropped' : A.writer ? 'excl' : A.readers > 0 ? 'shared' : 'free';
      return ' ' + A.name + ' s=' + s + ' w=' + w + ' ' + c;
    }).join('');
  }

  R.run = function (script) {
    var an = R.analyze(script), st = fresh(), frames = [{ st: copy(st), ev: [], out: null }], lines = [];
    var res = { verdict: 'ok', analysis: an, frames: frames, panicAt: -1, refusedAt: -1, leaked: [], lines: lines, msg: '' };
    if (!an.ok) { res.verdict = 'compile'; res.msg = an.msg; return res; }
    for (var i = 0; i < script.length; i++) {
      var no = refuse(st, script[i]);
      if (no) { res.verdict = 'refused'; res.refusedAt = i; res.msg = no; frames.push({ st: copy(st), ev: [], out: { refused: no } }); return res; }
      var ev = [], out = apply(st, script[i], ev);
      ev.forEach(function (n) { lines.push('drop ' + n); });
      if (out && out.panic) {
        lines.push((i + 1) + ' panic ' + out.panic);
        res.verdict = 'panic'; res.panicAt = i; res.msg = out.panic;
        frames.push({ st: copy(st), ev: ev, out: out });
        break;
      }
      lines.push((i + 1) + ' ' + out); lines.push(stateLine(st));
      frames.push({ st: copy(st), ev: ev, out: out });
    }
    var end = [], order = [];                        // the closing brace (or the early return after a panic)
    for (var j = st.binds.length - 1; j >= 0; j--) if (st.binds[j].live) { order.push(st.binds[j].name); release(st, st.binds[j], end); }
    end.forEach(function (n) { lines.push('drop ' + n); });
    lines.push('end'); lines.push(stateLine(st));
    res.leaked = st.allocs.filter(function (A) { return A.alive; }).map(function (A) { return A.name; });
    frames.push({ st: copy(st), ev: end, out: 'end', order: order });
    return res;
  };

  /* ───── the Rust program a script stands for ───── */
  R.HEADER = [
    '#![allow(unused)]',
    'use std::cell::RefCell;',
    'use std::panic::{catch_unwind, AssertUnwindSafe};',
    'use std::rc::{Rc, Weak};',
    'struct Node { name: char, next: Option<Rc<RefCell<Node>>>, back: Option<Weak<RefCell<Node>>> }',
    'impl Drop for Node { fn drop(&mut self) { println!("drop {}", self.name); } }',
    'type H = Option<Rc<RefCell<Node>>>;',
    'type Obs = Vec<Weak<RefCell<Node>>>;',
    'fn rc(h: &H) -> &Rc<RefCell<Node>> { h.as_ref().unwrap() }',
    'fn node(name: char) -> H { Some(Rc::new(RefCell::new(Node { name, next: None, back: None }))) }',
    'fn why(p: Box<dyn std::any::Any + Send>) -> String {',
    '    if let Some(s) = p.downcast_ref::<String>() { s.clone() } else if let Some(s) = p.downcast_ref::<&str>() { s.to_string() } else { String::from("?") }',
    '}',
    '// one hidden observer Weak per allocation: it reads the counts without owning anything (its own weak is subtracted)',
    'fn show(obs: &Obs) {',
    '    let mut line = String::from("|");',
    '    for (k, w) in obs.iter().enumerate() {',
    '        let s = Weak::strong_count(w);',
    '        let wk = if s > 0 { Weak::weak_count(w) - 1 } else { 0 };',
    '        let c = match w.upgrade() { None => "dropped", Some(r) => if r.try_borrow_mut().is_ok() { "free" } else if r.try_borrow().is_ok() { "shared" } else { "excl" } };',
    '        line.push_str(&format!(" {} s={} w={} {}", (b\'A\' + k as u8) as char, s, wk, c));',
    '    }',
    '    println!("{line}");',
    '}'
  ].join('\n');

  // One Rust line per operation, so a compiler error's line number names the operation.
  R.toRust = function (script, fname) {
    var nm = names(script), out = ['pub fn ' + fname + '(obs: &mut Obs) {'], lines = [], allocs = 0;
    script.forEach(function (op, i) {
      var n = i + 1, ok = ' println!("' + n + ' ok"); show(obs);', s, t = op.t, u = op.u;
      var guard = function (m) { return 'let ' + nm[i] + ' = match catch_unwind(AssertUnwindSafe(|| rc(&' + t + ').' + m + '())) { Ok(g) => g, Err(p) => { println!("' + n + ' panic {}", why(p)); return; } };'; };
      switch (op.k) {
        case 'new':   s = 'let ' + nm[i] + ': H = node(\'' + R.NAMES[allocs++] + '\'); obs.push(Rc::downgrade(rc(&' + nm[i] + ')));' + ok; break;
        case 'clone': s = 'let ' + nm[i] + ': H = Some(Rc::clone(rc(&' + t + ')));' + ok; break;
        case 'down':  s = 'let ' + nm[i] + ' = Rc::downgrade(rc(&' + t + '));' + ok; break;
        case 'up':    s = 'let ' + nm[i] + ': H = ' + t + '.upgrade(); println!("' + n + ' {}", if ' + nm[i] + '.is_some() { "some" } else { "none" }); show(obs);'; break;
        case 'bor':   s = guard('borrow') + ok; break;
        case 'mut':   s = guard('borrow_mut') + ok; break;
        case 'link':  s = 'if let Err(p) = catch_unwind(AssertUnwindSafe(|| { rc(&' + t + ').borrow_mut().' + (op.weak ? 'back = Some(Rc::downgrade(rc(&' + u + ')))' : 'next = Some(Rc::clone(rc(&' + u + ')))') +
                          '; })) { println!("' + n + ' panic {}", why(p)); return; }' + ok; break;
        case 'cut':   s = 'if let Err(p) = catch_unwind(AssertUnwindSafe(|| { rc(&' + t + ').borrow_mut().next = None; })) { println!("' + n + ' panic {}", why(p)); return; }' + ok; break;
        case 'drop':  s = 'drop(' + t + ');' + ok; break;
      }
      lines.push(out.length); out.push('    ' + s);
    });
    out.push('}');
    return { src: out.join('\n'), lines: lines };
  };

  /* ───── presets: the lesson's worked examples ───── */
  R.PRESETS = [
    { id: 'panic', label: '§2 · a reader, then a writer (panics)', script: [{ k: 'new' }, { k: 'clone', t: 'h1' }, { k: 'bor', t: 'h1' }, { k: 'mut', t: 'h2' }] },
    { id: 'owners', label: '§1 · two owners, one drop', script: [{ k: 'new' }, { k: 'clone', t: 'h1' }, { k: 'clone', t: 'h1' }, { k: 'drop', t: 'h3' }, { k: 'drop', t: 'h2' }] },
    { id: 'readers', label: 'readers finish, then the writer', script: [{ k: 'new' }, { k: 'bor', t: 'h1' }, { k: 'bor', t: 'h1' }, { k: 'drop', t: 'g1' }, { k: 'drop', t: 'g2' }, { k: 'mut', t: 'h1' }, { k: 'drop', t: 'g3' }] },
    { id: 'cycle', label: '§5 · a cycle leaks', script: [{ k: 'new' }, { k: 'new' }, { k: 'link', t: 'h1', u: 'h2' }, { k: 'link', t: 'h2', u: 'h1' }] },
    { id: 'weakback', label: '§5 · a Weak back-edge', script: [{ k: 'new' }, { k: 'new' }, { k: 'link', t: 'h1', u: 'h2' }, { k: 'link', t: 'h2', u: 'h1', weak: true }] },
    { id: 'upgrade', label: 'a Weak outlives the value', script: [{ k: 'new' }, { k: 'down', t: 'h1' }, { k: 'drop', t: 'h1' }, { k: 'up', t: 'w1' }] },
    { id: 'e0505', label: 'drop the handle a guard borrows', script: [{ k: 'new' }, { k: 'bor', t: 'h1' }, { k: 'drop', t: 'h1' }] }
  ];

  /* ───── drawing (canvas 2D context only; the page owns the DOM) ───── */
  R.draw = function (ctx, W, H, tr, step, script, C) {
    var nf = tr.frames.length, k = Math.max(0, Math.min(step, nf - 1)), fr = tr.frames[k], st = fr.st;
    var compile = tr.verdict === 'compile', atEnd = !compile && k === nf - 1, stop = Math.max(tr.panicAt, tr.refusedAt);
    var list = W >= 560, LW = list ? Math.min(300, Math.max(210, W * 0.38)) : 0;
    function font(px, bold) { ctx.font = (bold ? 'bold ' : '') + px + 'px ' + C.mono; }
    function fit(s, w) { while (ctx.measureText(s).width > w && s.length > 6) s = s.slice(0, -2); return s; }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (list) {                                     // the script, one line per operation, then the closing brace
      var lh = Math.min(21, (H - 36) / (script.length + 2));
      font(11, true); ctx.fillStyle = C.mute; ctx.fillText('the script', 8, 12);
      script.concat([null]).forEach(function (op, i) {
        var y = 30 + i * lh, isEnd = op === null, cur = !compile && (isEnd ? atEnd : (i === k - 1 && !atEnd));
        var ran = !compile && (isEnd || stop < 0 || i <= stop) && (isEnd ? atEnd : i < k);
        if (cur) { ctx.fillStyle = 'rgba(124,58,237,0.13)'; ctx.fillRect(4, y - lh / 2 + 1, LW - 8, lh - 2); }
        var bad = compile ? i === tr.analysis.at : i === stop, col = bad ? (compile ? C.live : C.err) : (ran || cur) ? C.text : C.dim;
        ctx.fillStyle = col; font(11, cur || bad);
        ctx.fillText(fit(isEnd ? '}  end of scope' : (i + 1) + '  ' + R.label(script, i, false), LW - (bad ? 62 : 14)), 8, y);
        if (bad) { ctx.textAlign = 'right'; font(10, true); ctx.fillText(compile ? '✗ ' + tr.analysis.code : '✗ panic', LW - 8, y); ctx.textAlign = 'left'; }
      });
    }
    var x0 = LW + (list ? 12 : 8), RW = W - x0 - 8;
    font(11, true); ctx.fillStyle = compile ? C.live : C.mute;
    var head = compile ? 'rejected at compile time: nothing runs' : k === 0 ? 'the heap: nothing yet' : atEnd ? 'the heap after }' : 'the heap after step ' + k;
    if (!list && !compile && k > 0 && !atEnd) head += ': ' + R.label(script, k - 1, false);
    ctx.fillText(fit(head, RW), x0, 12);
    if (compile) {                                  // wrap the compiler's words into the panel
      var words = ('error[' + tr.analysis.code + ']: ' + tr.analysis.msg).split(' '), ln = '', y = 60;
      font(12, true);
      words.forEach(function (w) { if (ln && ctx.measureText(ln + ' ' + w).width > RW) { ctx.fillText(ln, x0, y); y += 18; ln = w; } else ln = ln ? ln + ' ' + w : w; });
      ctx.fillText(ln, x0, y);
      font(11); ctx.fillStyle = C.mute;
      ctx.fillText(fit(tr.analysis.code === 'E0505' ? 'the guard ' + tr.analysis.guard + ' still borrows that handle' : 'that name was already dropped', RW), x0, y + 24);
      return;
    }
    var n = Math.max(1, st.allocs.length), gap = 14, bw = Math.min(150, (RW - gap * (n - 1)) / n), by = 84, bh = 96;
    var X = function (a) { return x0 + a * (bw + gap); };
    st.allocs.forEach(function (A, a) {             // one box per allocation: counts, borrow flag, fate
      var x = X(a), leaked = atEnd && A.alive, dead = !A.alive;
      ctx.lineWidth = leaked ? 2.5 : 1.2; ctx.strokeStyle = leaked ? C.err : dead ? C.dim : C.own; ctx.setLineDash(dead ? [4, 3] : []);
      ctx.strokeRect(x, by, bw, bh); ctx.setLineDash([]);
      font(13, true); ctx.fillStyle = dead ? C.dim : C.text; ctx.fillText(A.name, x + 6, by + 13);
      font(9, true); ctx.textAlign = 'right'; ctx.fillStyle = leaked ? C.err : dead ? C.dim : C.good;
      ctx.fillText(leaked ? 'LEAKED' : dead ? (A.weak > 0 ? 'dropped' : 'freed') : 'alive', x + bw - 5, by + 13); ctx.textAlign = 'left';
      font(12); ctx.fillStyle = dead ? C.dim : C.text;
      ctx.fillText(fit('strong ' + A.strong, bw - 10), x + 6, by + 36); ctx.fillText(fit('weak ' + A.weak, bw - 10), x + 6, by + 54);
      var flag = dead ? (A.weak > 0 ? 'kept by Weak' : '') : A.writer ? '1 writer' : A.readers > 0 ? A.readers + ' reader' + (A.readers > 1 ? 's' : '') : 'free';
      ctx.fillStyle = dead ? C.dim : A.writer ? C.excl : A.readers > 0 ? C.shared : C.mute; font(11, !dead && (A.writer || A.readers > 0));
      ctx.fillText(fit(flag, bw - 10), x + 6, by + 78);
    });
    st.allocs.forEach(function (A, a) {             // edges: next (an Rc) solid above, back (a Weak) dashed below
      [['next', A.next, by, -1], ['back', A.back, by + bh, 1]].forEach(function (e) {
        if (e[1] < 0) return;
        var self = a === e[1], xa = X(a) + bw * 0.62, xb = self ? X(a) + bw * 0.3 : X(e[1]) + bw * 0.38, y = e[2];
        var lift = e[3] * (self ? 24 : (e[1] > a ? 16 : 34) + 7 * Math.abs(a - e[1]));   // leftward edges arc higher
        ctx.strokeStyle = e[0] === 'next' ? C.own : C.mute; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.6; ctx.setLineDash(e[0] === 'next' ? [] : [5, 4]);
        ctx.beginPath(); ctx.moveTo(xa, y); ctx.bezierCurveTo(xa, y + lift, xb, y + lift, xb, y); ctx.stroke(); ctx.setLineDash([]);
        var d = e[3] < 0 ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(xb, y); ctx.lineTo(xb - 4, y + 7 * d); ctx.lineTo(xb + 4, y + 7 * d); ctx.closePath(); ctx.fill();
        font(9); ctx.textAlign = 'center'; ctx.fillText(e[0], (xa + xb) / 2, y + lift * 0.75 + 7 * d); ctx.textAlign = 'left';
      });
    });
    var used = {}, cy0 = by + bh + 64, chipW = 30, per = Math.max(1, Math.floor((bw + 4) / (chipW + 4))), hotA = -2;
    if (fr.out && fr.out.panic) st.binds.forEach(function (b) { if (b.name === script[k - 1].t) hotA = b.a; });   // the cell whose flag said no
    st.binds.forEach(function (b) {                 // the names that reach each allocation (live bindings only)
      if (!b.live) return;
      var key = b.a < 0 ? 'none' : b.a, j = used[key] = (used[key] || 0) + 1, x, y;
      if (b.a < 0) { x = x0 + 150 + (j - 1) * (chipW + 4); y = H - 34; }
      else { x = X(b.a) + ((j - 1) % per) * (chipW + 4); y = cy0 + Math.floor((j - 1) / per) * 24; }
      var c = b.kind === 'h' ? C.own : b.kind === 'w' ? C.mute : b.excl ? C.excl : C.shared;
      var hot = b.kind === 'g' && b.a === hotA;
      ctx.strokeStyle = hot ? C.err : c; ctx.lineWidth = hot ? 3 : 1.4; ctx.setLineDash(b.kind === 'w' ? [3, 3] : []);
      if (b.kind === 'g') { ctx.fillStyle = c; ctx.fillRect(x, y - 9, chipW, 18); }
      ctx.strokeRect(x, y - 9, chipW, 18); ctx.setLineDash([]);
      font(11, true); ctx.fillStyle = b.kind === 'g' ? '#fff' : c; ctx.textAlign = 'center'; ctx.fillText(b.name, x + chipW / 2, y); ctx.textAlign = 'left';
    });
    if (used.none) { font(10); ctx.fillStyle = C.mute; ctx.fillText('None (upgrade failed):', x0, H - 34); }
    font(10); ctx.fillStyle = C.dim;
    var legend = '▭ strong handle   ┆▭┆ Weak handle   ■ guard: blue reads, amber writes';
    ctx.fillText(ctx.measureText(legend).width <= RW ? legend : '▭ strong  ┆▭┆ Weak  ■ guard', x0, H - 12);
  };

  /* ───── the page: controls, readout, canvas (only this part touches the DOM; P is the widget id) ───── */
  R.mount = function (P) {
    var cv = document.getElementById(P + '-canvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    function cssv(n, fb) { try { var v = getComputedStyle(document.documentElement).getPropertyValue(n); return (v && v.trim()) || fb; } catch (e) { return fb; } }
    var C = { own: cssv('--own', '#334155'), shared: cssv('--shared', '#2563eb'), excl: cssv('--excl', '#d97706'), err: cssv('--err', '#dc2626'),
              good: cssv('--good', '#16a34a'), live: cssv('--live', '#7c3aed'), mute: cssv('--text-mute', '#5b6573'), dim: cssv('--text-dim', '#94a3b8'),
              text: cssv('--text', '#1f2430'), mono: cssv('--mono', 'monospace') };
    function $(id) { return document.getElementById(P + '-' + id); }
    var stepEl = $('step'), preEl = $('preset'), onEl = $('on'), toEl = $('to');
    var S = { script: [], tr: null, step: 0, note: '' };
    function copyScript(s) { return s.map(function (op) { var o = {}; for (var k in op) o[k] = op[k]; return o; }); }
    function lastState() { var f = S.tr.frames; return f[Math.max(0, f.length - 2)].st; }
    function live(kind) {                                   // live bindings after the last operation that ran
      if (S.tr.verdict === 'compile') return [];
      return lastState().binds.filter(function (b) { return b.live && (kind === 'any' || (b.kind === kind && b.a >= 0)); });
    }
    function choose(sel, kind) {
      var xs = live(kind);
      for (var i = 0; i < xs.length; i++) if (xs[i].name === sel.value) return xs[i];
      return xs.length ? xs[xs.length - 1] : null;
    }
    function fill(sel, xs, fallback) {
      var keep = sel.value; sel.innerHTML = '';
      xs.forEach(function (b) { var o = document.createElement('option'); o.value = b.name; o.textContent = b.name; sel.appendChild(o); });
      var names = xs.map(function (b) { return b.name; });
      sel.value = names.indexOf(keep) >= 0 ? keep : (fallback || '');
    }
    function retrace(jump) {
      S.tr = R.run(S.script);
      var max = S.tr.frames.length - 1;
      stepEl.max = String(max);
      if (jump) S.step = S.tr.panicAt >= 0 ? S.tr.panicAt + 1 : max;
      S.step = Math.max(0, Math.min(max, S.step)); stepEl.value = String(S.step);
      var any = live('any'), strong = live('h');
      fill(onEl, any, any.length ? any[any.length - 1].name : '');
      fill(toEl, strong, strong.length ? strong[0].name : '');
      draw();
    }
    function say(msg) { S.note = msg; draw(); }
    function add(ops) {
      if (S.tr.verdict === 'compile') return say('This script does not compile, so nothing runs: press undo first.');
      if (S.tr.verdict === 'panic') return say('The script already panicked at operation ' + (S.tr.panicAt + 1) + '; nothing after it would run. Press undo first.');
      if (S.script.length + ops.length > R.MAX_OPS) return say('At most ' + R.MAX_OPS + ' operations.');
      S.script = S.script.concat(ops); preEl.value = 'custom'; S.note = ''; retrace(true);
    }
    function onStrong(k) { var t = choose(onEl, 'h'); if (!t) return say('No strong handle is alive: press Rc::new first.'); add([{ k: k, t: t.name }]); }
    function edge(weak) {
      var t = choose(onEl, 'h'), u = choose(toEl, 'h');
      if (!t || !u) return say('An edge needs a strong handle in "on" and one in "to".');
      add([{ k: 'link', t: t.name, u: u.name, weak: weak }]);
    }
    $('new').addEventListener('click', function () {
      if (S.tr.verdict !== 'compile' && lastState().allocs.length >= R.NAMES.length) return say('The simulator holds at most ' + R.NAMES.length + ' allocations.');
      add([{ k: 'new' }]);
    });
    ['clone', 'down', 'bor', 'mut', 'cut'].forEach(function (k) { $('' + k).addEventListener('click', function () { onStrong(k); }); });
    $('up').addEventListener('click', function () { var w = choose(onEl, 'w'); if (!w) return say('No Weak handle is alive: press downgrade first.'); add([{ k: 'up', t: w.name }]); });
    $('drop').addEventListener('click', function () { var x = choose(onEl, 'any'); if (!x) return say('Nothing is alive to drop.'); add([{ k: 'drop', t: x.name }]); });
    $('link').addEventListener('click', function () { edge(false); });
    $('weak').addEventListener('click', function () { edge(true); });
    $('cycle').addEventListener('click', function () {
      var t = choose(onEl, 'h'), u = choose(toEl, 'h');
      if (!t || !u) return say('A cycle needs a strong handle in "on" and one in "to".');
      add(t.a === u.a ? [{ k: 'link', t: t.name, u: u.name }] : [{ k: 'link', t: t.name, u: u.name }, { k: 'link', t: u.name, u: t.name }]);
    });
    $('undo').addEventListener('click', function () { if (!S.script.length) return say('The script is empty.'); S.script.pop(); preEl.value = 'custom'; S.note = ''; retrace(true); });
    preEl.addEventListener('change', function () { var i = parseInt(preEl.value, 10); if (!(i >= 0 && i < R.PRESETS.length)) return; S.script = copyScript(R.PRESETS[i].script); S.note = ''; retrace(true); });
    stepEl.addEventListener('input', function () { S.step = parseInt(stepEl.value, 10) || 0; draw(); });

    function describe(A, fr, atEnd) {
      var g = fr.st.binds.filter(function (b) { return b.live && b.kind === 'g' && b.a === fr.st.allocs.indexOf(A); }).map(function (b) { return b.name; });
      if (!A.alive) return A.name + '  value dropped' + (atEnd ? '' : A.weak > 0 ? ' · weak ' + A.weak + ': the block stays until the last Weak goes' : ' · block freed');
      var flag = A.writer ? '1 writer (' + g.join(' ') + ')' : A.readers ? A.readers + ' reader' + (A.readers > 1 ? 's' : '') + ' (' + g.join(' ') + ')' : 'free';
      return A.name + '  ' + (atEnd ? 'LEAKED · ' : 'alive · ') + 'strong ' + A.strong + ' · weak ' + A.weak + (atEnd ? ': held only by next edges (a cycle)' : ' · flag: ' + flag);
    }
    function draw() {
      var dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
      var W = Math.max(320, r.width), H = Math.max(260, r.height), tr = S.tr, nf = tr.frames.length;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      R.draw(ctx, W, H, tr, S.step, S.script, C);
      var fr = tr.frames[Math.min(S.step, nf - 1)], atEnd = tr.verdict !== 'compile' && S.step === nf - 1, lines = [], nm = R.names(S.script);
      $('step-v').textContent = S.step + ' / ' + (nf - 1);
      var alive = fr.st.allocs.filter(function (A) { return A.alive; }).length, rd = 0, wr = 0;
      fr.st.allocs.forEach(function (A) { rd += A.readers; wr += A.writer ? 1 : 0; });
      $('k1').textContent = tr.verdict === 'compile' ? '—' : alive + ' of ' + fr.st.allocs.length;
      $('k2').textContent = tr.verdict === 'compile' ? '—' : (rd || wr) ? (rd ? rd + ' reader' + (rd > 1 ? 's' : '') : '') + (rd && wr ? ' · ' : '') + (wr ? wr + ' writer' + (wr > 1 ? 's' : '') : '') : 'none';
      $('k3').textContent = tr.verdict === 'compile' ? 'rejected: ' + tr.analysis.code : tr.verdict === 'panic' ? (S.step > tr.panicAt ? 'panicked at ' + (tr.panicAt + 1) : 'panics at ' + (tr.panicAt + 1)) : tr.verdict === 'refused' ? 'refused' : atEnd ? 'ran to }' : 'running';
      $('k4').textContent = !atEnd ? '—' : tr.leaked.length ? tr.leaked.join(', ') : 'none';
      if (tr.verdict === 'compile') {
        var at = tr.analysis.at;
        lines.push('error[' + tr.analysis.code + ']: ' + tr.analysis.msg);
        lines.push('  at operation ' + (at + 1) + ': ' + R.label(S.script, at, true));
        lines.push(tr.analysis.code === 'E0505' ? 'The guard ' + tr.analysis.guard + ' (operation ' + (nm.indexOf(tr.analysis.guard) + 1) + ') borrows that handle until it is dropped, so the handle cannot go first. The whole program is rejected: nothing runs.' : 'That name was already given to drop(), so it no longer exists. Nothing runs.');
      } else {
        lines.push(S.step === 0 ? 'step 0: nothing has run yet' : atEnd ? 'step ' + S.step + ' · }' : 'step ' + S.step + ' · ' + R.label(S.script, S.step - 1, true));
        if (fr.out && fr.out.panic) {
          var op = S.script[S.step - 1], cell = -1;
          fr.st.binds.forEach(function (b) { if (b.name === op.t) cell = b.a; });
          var culprits = fr.st.binds.filter(function (b) { return b.live && b.kind === 'g' && b.a === cell; }).map(function (b) { return b.name + ' (a ' + (b.excl ? 'writer' : 'reader') + ', operation ' + (nm.indexOf(b.name) + 1) + ')'; });
          lines.push('✗ panics: ' + fr.out.panic + ' — still alive on ' + R.NAMES[cell] + ': ' + culprits.join(', ') + '. The message names only this line.');
        } else if (fr.out === 'some') lines.push('upgrade → Some: the value is alive, so the new handle is one more owner.');
        else if (fr.out === 'none') lines.push('upgrade → None: the value was already dropped; the Weak only kept the block.');
        if (fr.out && fr.out.refused) lines.push('refused: ' + fr.out.refused);
        if (atEnd) lines.push((tr.verdict === 'panic' ? 'the panic ends the scope; unwinding drops ' : 'the brace drops ') + (fr.order.length ? fr.order.join(', ') + ' (last declared first)' : 'nothing'));
        if (fr.ev.length) lines.push('values dropped: ' + fr.ev.map(function (n) { return 'drop ' + n; }).join(', '));
        fr.st.allocs.forEach(function (A) { lines.push(describe(A, fr, atEnd && A.alive)); });
        var names = fr.st.binds.filter(function (b) { return b.live; }).map(function (b) { return b.a < 0 ? b.name + '=None' : b.name; });
        if (!atEnd && S.step > 0) lines.push('names alive: ' + (names.length ? names.join(' ') : 'none'));
        if (atEnd) lines.push(tr.leaked.length ? 'leaked: ' + tr.leaked.join(', ') + ' — safe (nothing can reach them), but never dropped' : 'nothing leaked: every value was dropped exactly once');
      }
      if (S.note) lines.push('» ' + S.note);
      var ro = $('read');
      ro.textContent = lines.join('\n');
      ro.className = 'readout ' + (tr.verdict === 'compile' || (fr.out && fr.out.panic) || (atEnd && tr.leaked.length) ? 'err' : 'ok');
    }
    window.addEventListener('resize', draw);
    S.script = copyScript(R.PRESETS[0].script);
    retrace(true);
  };

  root.RcSim = R;
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(typeof window !== 'undefined' ? window : this);
