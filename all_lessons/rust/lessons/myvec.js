/* myvec.js — a model of Lesson 20's MyVec<T> on an allocation table, with fault injection.
 *
 * The machine keeps allocations (slots that hold a value token or nothing), value tokens (owned by a
 * vec, moved out, or dropped) and MyVec headers (ptr, cap, len). Each MyVec method below is transliterated
 * from the lesson's Rust source; a mutant changes one line of it. Every raw-memory primitive checks its own
 * precondition (undefined behavior halts the machine: after UB the program has no meaning). After every
 * operation, and at every panic before unwinding, the four invariants are checked on every live header;
 * after the final drop, leaks are listed (a leak is safe, not UB). No DOM code: Node can run all of it.
 *
 * API:
 *   MyVec.parse(text)          -> { ops: [...], errors: [...] }
 *   MyVec.run(ops, mutantId)   -> { frames, results, flagged, firstBad, firstUB, leaks }
 *   MyVec.check(m, v)          -> [[invariant 1-4, reason], ...] for one header
 *   MyVec.view(run, step)      -> what the widget shows at one step: rows of slots, chips, verdict, log
 *   MyVec.MUTANTS, MyVec.PRESETS, MyVec.UB, MyVec.INV
 * Oracle: tools/rust_verify/20_myvec.js (rustc runs the real MyVec against std::Vec; an independent
 * reference interpreter judges every mutant).
 */
(function (root) {
  'use strict';
  var MV = {};

  MV.MUTANTS = [
    { id: 'correct', label: 'correct MyVec', line: 'the program of §3 with its insert, remove, truncate and clone' },
    { id: 'nogrow', label: 'push forgets to grow', line: 'push without `if self.len == self.cap { self.grow(); }`' },
    { id: 'nocopy', label: 'grow forgets to copy', line: 'grow_to without `ptr::copy_nonoverlapping(..)`' },
    { id: 'lenfirst', label: 'len += 1 before the write', line: 'push and clone do `len += 1` before `ptr::write`' },
    { id: 'popkeep', label: 'pop forgets len -= 1', line: 'pop reads slot len - 1 and leaves len alone' },
    { id: 'nofree', label: 'Drop forgets to free', line: 'Drop without its `dealloc`' },
    { id: 'shallow', label: '#[derive(Clone)] instead of clone', line: 'the derived clone copies ptr, cap and len: two owners of one buffer' },
    { id: 'shift1', label: 'insert shifts one slot too many', line: 'insert: `ptr::copy(.., self.len - i + 1)`' },
    { id: 'publen', label: 'pub len', line: 'the field is `pub len`: code outside the module may write it' }
  ];
  MV.INV = { 1: 'len ≤ cap', 2: 'slots 0..len hold values it owns', 3: 'slots len..cap are spare', 4: 'ptr is its own cap-slot buffer' };
  MV.UB = {   // kind: [what happened, the family it belongs to]
    dangling:   ['a write through the dangling pointer: nothing is allocated', 'out of bounds'],
    oob:        ['an access outside the allocation', 'out of bounds'],
    uaf:        ['an access to a freed buffer', 'use-after-free'],
    uninit:     ['a T read from a slot never written', 'uninitialized read'],
    dropped:    ['a value used after it was dropped', 'use-after-free'],
    doubledrop: ['a value dropped twice', 'double free'],
    doublefree: ['a buffer freed twice', 'double free'],
    badfree:    ['a free of memory never allocated', 'invalid free']
  };
  MV.PRESETS = [
    { id: 'tour', label: 'tour: grow, pop, insert, remove, clone, truncate', mutant: 'correct', script: 'push a; push b; push c; pop; insert 0 x; remove 1; clone; truncate 1' },
    { id: 'nogrow', label: 'push into a full buffer', mutant: 'nogrow', script: 'push a; push b' },
    { id: 'nocopy', label: 'the second growth', mutant: 'nocopy', script: 'push a; push b; push c' },
    { id: 'lenfirst', label: 'clone meets a panicking clone()', mutant: 'lenfirst', script: 'push a; push !; push c; clone' },
    { id: 'popkeep', label: 'pop, then push', mutant: 'popkeep', script: 'push a; push b; pop; push c' },
    { id: 'nofree', label: 'fill, then drop', mutant: 'nofree', script: 'push a; push b; push c' },
    { id: 'shallow', label: 'clone, then keep using v', mutant: 'shallow', script: 'push a; push b; clone; push c' },
    { id: 'shift1', label: 'insert with one free slot', mutant: 'shift1', script: 'push a; push b; push c; insert 1 x' },
    { id: 'publen', label: 'a caller writes len', mutant: 'publen', script: 'push a; push b; len = 4' }
  ];

  /* ───────── the script language: push a · pop · insert 1 x · remove 0 · truncate 2 · clone · len = 3 ───────── */
  MV.parse = function (text) {
    var ops = [], errors = [];
    String(text || '').split(/[;\n]/).forEach(function (raw) {
      var s = raw.trim(), m;
      if (!s) return;
      if ((m = /^push\s+([a-z!])$/.exec(s))) ops.push({ k: 'push', x: m[1] });
      else if (s === 'pop') ops.push({ k: 'pop' });
      else if ((m = /^insert\s+(\d+)\s+([a-z!])$/.exec(s))) ops.push({ k: 'insert', i: +m[1], x: m[2] });
      else if ((m = /^remove\s+(\d+)$/.exec(s))) ops.push({ k: 'remove', i: +m[1] });
      else if ((m = /^truncate\s+(\d+)$/.exec(s))) ops.push({ k: 'truncate', i: +m[1] });
      else if (s === 'clone') ops.push({ k: 'clone' });
      else if ((m = /^(?:v\.)?len\s*=\s*(\d+)$/.exec(s))) ops.push({ k: 'setlen', i: Math.min(+m[1], 64) });
      else errors.push('cannot read "' + s + '"');
    });
    if (ops.length > 16) { errors.push('only the first 16 operations run'); ops = ops.slice(0, 16); }
    return { ops: ops, errors: errors };
  };
  MV.opText = function (o) {
    return o.k === 'push' ? 'v.push(' + o.x + ')' : o.k === 'pop' ? 'v.pop()' : o.k === 'insert' ? 'v.insert(' + o.i + ', ' + o.x + ')'
         : o.k === 'remove' ? 'v.remove(' + o.i + ')' : o.k === 'truncate' ? 'v.truncate(' + o.i + ')' : o.k === 'clone' ? 'v.clone()'
         : 'v.len = ' + o.i;
  };

  /* ───────── the machine: allocations, value tokens, MyVec headers ───────── */
  var HALT = { halt: true };
  function Panic(msg) { this.msg = msg; }
  function Machine(mut) { this.mut = mut; this.heap = [null]; this.toks = []; this.vecs = []; this.ub = null; this.bad = null; this.step = 0; this.ev = []; this.cshot = null; }
  var P = Machine.prototype;
  P.log = function (s) { this.ev.push(s); };
  P.stop = function (kind, text, at) { this.ub = { kind: kind, text: text, step: this.step, at: at || null }; throw HALT; };
  P.tok = function (name) { var t = { id: this.toks.length, name: name, st: 'arg' }; this.toks.push(t); return t; };
  P.alloc = function (n) { var a = { id: this.heap.length, n: n, cells: [], live: true }; for (var i = 0; i < n; i++) a.cells.push(null); this.heap.push(a); return a.id; };
  P.cell = function (p, i, what) {                       // the slot a raw pointer names, or UB
    if (p === 0) this.stop('dangling', what + ' slot ' + i + ' through the dangling pointer (cap is 0: nothing allocated)', { p: 0, i: i });
    var a = this.heap[p];
    if (!a.live) this.stop('uaf', what + ' slot ' + i + ' of A' + p + ', which was already freed', { p: p, i: i });
    if (i < 0 || i >= a.n) this.stop('oob', what + ' slot ' + i + ' of A' + p + ', which has ' + a.n + ' slot' + (a.n === 1 ? '' : 's'), { p: p, i: i });
    return a;
  };
  P.write = function (p, i, t) { this.cell(p, i, 'ptr::write to').cells[i] = t; t.st = 'vec'; };   // drops nothing
  P.peek = function (p, i) {                              // a typed read through &T: must be a live value
    var t = this.cell(p, i, 'a read of').cells[i];
    if (!t) this.stop('uninit', 'a read of slot ' + i + ' of A' + p + ': nothing was ever written there', { p: p, i: i });
    if (t.st === 'dropped') this.stop('dropped', 'a read of slot ' + i + ' of A' + p + ': its value ' + t.name + ' was already dropped', { p: p, i: i });
    return t;
  };
  P.read = function (p, i) { var t = this.peek(p, i); t.st = 'out'; return t; };                 // ptr::read moves it out
  P.copy = function (p, from, q, to, n) {                 // ptr::copy: moves bits, overlap-safe, produces no value
    var tmp = [], k;
    for (k = 0; k < n; k++) tmp.push(this.cell(p, from + k, 'ptr::copy from').cells[from + k]);
    for (k = 0; k < n; k++) this.cell(q, to + k, 'ptr::copy to').cells[to + k] = tmp[k];
  };
  P.free = function (p) {
    if (p === 0) this.stop('badfree', 'dealloc of the dangling pointer: it was never allocated');
    if (!this.heap[p].live) this.stop('doublefree', 'dealloc of A' + p + ', which was already freed', { p: p, i: -1 });
    this.heap[p].live = false;
  };
  P.drop = function (t) { if (t.st === 'dropped') this.stop('doubledrop', t.name + ' is dropped a second time'); t.st = 'dropped'; };
  P.header = function (name) { var v = { name: name, ptr: 0, cap: 0, len: 0 }; this.vecs.push(v); return v; };
  P.gone = function (v) { this.vecs = this.vecs.filter(function (w) { return w !== v; }); };

  /* ───────── the four invariants of one header: the core of the widget ───────── */
  function check(m, v) {
    var bad = [], a = v.ptr ? m.heap[v.ptr] : null, mine = {}, i, t, why;
    var others = m.vecs.filter(function (w) { return w !== v && w.ptr && w.ptr === v.ptr; });
    if (v.len > v.cap) bad.push([1, 'len is ' + v.len + ' but cap is ' + v.cap]);
    for (i = 0; i < v.len; i++) {                          // I2: every slot in 0..len holds a value it owns
      t = a && a.live && i < a.n ? a.cells[i] : null;
      why = !a || !a.live || i >= a.n ? 'is outside any live buffer' : !t ? 'was never written'
          : t.st === 'dropped' ? 'holds ' + t.name + ', already dropped' : t.st !== 'vec' ? 'holds ' + t.name + ', moved out'
          : mine[t.id] ? 'holds ' + t.name + ' twice' : others.some(function (w) { return i < w.len; }) ? 'holds ' + t.name + ', also owned by ' + others[0].name : '';
      if (why) { bad.push([2, 'slot ' + i + ' ' + why]); break; }
      mine[t.id] = true;
    }
    for (i = v.len; a && a.live && i < Math.min(v.cap, a.n); i++) {   // I3: no spare slot is still owed a drop
      t = a.cells[i];
      if (t && t.st === 'vec' && !mine[t.id]) { bad.push([3, 'spare slot ' + i + ' still holds ' + t.name + ', which nobody will drop']); break; }
    }
    if (v.cap === 0 ? v.ptr !== 0 : !(a && a.live && a.n === v.cap)) bad.push([4, 'ptr is not a live buffer of ' + v.cap + ' slots']);
    else if (others.length) bad.push([4, 'A' + a.id + ' is also held by ' + others[0].name]);   // I4: its own buffer
    return bad;
  }
  MV.check = check;
  P.checkpoint = function (where) {
    var self = this;
    this.vecs.forEach(function (v) {
      var b = check(self, v);
      if (b.length && !self.bad) self.bad = { step: self.step, vec: v.name, n: b[0][0], why: b[0][1], where: where };
    });
  };

  /* ───────── MyVec, transliterated from the lesson's Rust (a mutant changes one line) ───────── */
  function growTo(m, v, n) {
    var p = m.alloc(n);
    if (v.cap !== 0) {
      if (m.mut !== 'nocopy') m.copy(v.ptr, 0, p, 0, v.len);        // ptr::copy_nonoverlapping(old, new, len)
      m.free(v.ptr);                                                // dealloc(old, Layout::array::<T>(cap))
    }
    m.log(v.name + ': grow ' + v.cap + ' → ' + n + (v.cap ? ', A' + v.ptr + ' → A' + p : ', allocate A' + p));
    v.ptr = p; v.cap = n;
  }
  function grow(m, v) { growTo(m, v, v.cap === 0 ? 1 : 2 * v.cap); }
  function push(m, v, x) {
    if (m.mut !== 'nogrow' && v.len === v.cap) grow(m, v);
    if (m.mut === 'lenfirst') { v.len += 1; m.write(v.ptr, v.len - 1, x); }
    else { m.write(v.ptr, v.len, x); v.len += 1; }
  }
  function pop(m, v) {
    if (v.len === 0) return null;
    if (m.mut === 'popkeep') return m.read(v.ptr, v.len - 1);
    v.len -= 1;
    return m.read(v.ptr, v.len);
  }
  function insert(m, v, i, x) {
    if (i > v.len) { m.drop(x); throw new Panic('insertion index ' + i + ' > len ' + v.len); }
    if (v.len === v.cap) grow(m, v);
    m.copy(v.ptr, i, v.ptr, i + 1, v.len - i + (m.mut === 'shift1' ? 1 : 0));
    m.write(v.ptr, i, x);
    v.len += 1;
  }
  function remove(m, v, i) {
    if (i >= v.len) throw new Panic('removal index ' + i + ' ≥ len ' + v.len);
    v.len -= 1;
    var x = m.read(v.ptr, i);
    m.copy(v.ptr, i + 1, v.ptr, i, v.len - i);
    return x;
  }
  function dropVec(m, v) {                                          // impl Drop: pop until empty, then free
    for (var t; (t = pop(m, v));) m.drop(t);
    if (m.mut !== 'nofree' && v.cap !== 0) m.free(v.ptr);
    m.gone(v);
  }
  function slice(m, v) {                                            // Deref: slice::from_raw_parts(ptr, len)
    if (v.len === 0) return;
    if (v.ptr === 0) m.stop('dangling', 'a slice of ' + v.len + ' values over the dangling pointer', { p: 0, i: 0 });
    var a = m.heap[v.ptr];
    if (!a.live) m.stop('uaf', 'a slice over A' + a.id + ', which was already freed', { p: a.id, i: 0 });
    if (v.len > a.n) m.stop('oob', 'a slice of ' + v.len + ' values over A' + a.id + ', which has ' + a.n + ' slots', { p: a.id, i: a.n });
  }
  function cloneVec(m, v) {
    var out = m.header('c');
    if (m.mut === 'shallow') { out.ptr = v.ptr; out.cap = v.cap; out.len = v.len; return out; }   // field-wise copy
    if (v.len > 0) growTo(m, out, v.len);
    slice(m, v);                                                    // for x in self.iter()
    for (var i = 0; i < v.len; i++) {
      var x = m.peek(v.ptr, i);
      if (m.mut === 'lenfirst') out.len += 1;
      if (x.name === '!') {                                         // T::clone panics; unwinding drops `out`
        m.log('clone() of ! panics: unwinding drops the partial copy c');
        m.checkpoint('the panic inside clone');
        m.cshot = snapVec(m, out);
        dropVec(m, out);
        throw new Panic('clone() of ! panicked');
      }
      var y = m.tok(x.name);
      m.write(out.ptr, m.mut === 'lenfirst' ? out.len - 1 : out.len, y);
      if (m.mut !== 'lenfirst') out.len += 1;
    }
    return out;
  }
  function names(m, v) { var a = m.heap[v.ptr], s = ''; for (var i = 0; i < v.len; i++) s += a.cells[i].name; return s; }

  function exec(m, v, o) {
    var t, c, s;
    switch (o.k) {
      case 'push': push(m, v, m.tok(o.x)); return '';
      case 'pop': t = pop(m, v); if (!t) return '-'; m.drop(t); return t.name;       // the popped value ends here
      case 'insert': insert(m, v, o.i, m.tok(o.x)); return '';
      case 'remove': t = remove(m, v, o.i); m.drop(t); return t.name;
      case 'truncate': while (v.len > o.i) { t = pop(m, v); if (t) m.drop(t); } return '';
      case 'clone':
        c = cloneVec(m, v);
        m.checkpoint('v.clone() returned');
        m.cshot = snapVec(m, c);
        s = names(m, c);
        dropVec(m, c);                                              // the temporary copy ends with the statement
        m.log('the copy c is dropped at the end of the statement');
        return s;
      case 'setlen':
        if (m.mut !== 'publen') { m.log('does not compile: E0616, field `len` is private (the line is skipped)'); return 'E0616'; }
        v.len = o.i; return '';
    }
    return '';
  }

  /* ───────── snapshots, the run ───────── */
  function snapVec(m, v) {
    var a = v.ptr ? m.heap[v.ptr] : null, cells = [];
    if (a) a.cells.forEach(function (t) { cells.push(t ? { name: t.name, st: t.st, id: t.id } : null); });
    return { name: v.name, ptr: v.ptr, cap: v.cap, len: v.len, n: a ? a.n : 0, live: a ? a.live : false, cells: cells, inv: check(m, v) };
  }
  function frame(m, v, label, res) {
    var f = { step: m.step, label: label, res: res, ev: m.ev.slice(), ub: m.ub && m.ub.step === m.step ? m.ub : null,
              v: snapVec(m, v), c: m.cshot, bad: m.bad && m.bad.step === m.step ? m.bad : null,
              freed: m.heap.filter(function (a) { return a && !a.live; }).map(function (a) { return 'A' + a.id; }) };
    m.cshot = null;
    return f;
  }
  MV.run = function (ops, mutId) {
    var m = new Machine(mutId || 'correct'), frames = [], results = [], leaks = [], k;
    var v = m.header('v');
    m.checkpoint('MyVec::new()');
    frames.push(frame(m, v, 'let mut v = MyVec::new()', ''));
    for (k = 0; k < ops.length && !m.ub; k++) {
      m.step = k + 1; m.ev = [];
      var res = '';
      try { res = exec(m, v, ops[k]); }
      catch (e) {
        if (e instanceof Panic) { res = 'panic'; m.log('panicked: ' + e.msg + ' (the script catches it and goes on)'); }
        else if (e !== HALT) throw e;
      }
      m.vecs = m.vecs.filter(function (w) { return w === v; });   // a copy never outlives its statement
      if (!m.ub) m.checkpoint('after ' + MV.opText(ops[k]));
      frames.push(frame(m, v, MV.opText(ops[k]), res));
      results.push(res);
    }
    if (!m.ub) {
      m.step = ops.length + 1; m.ev = [];
      try { dropVec(m, v); } catch (e) { if (e !== HALT) throw e; }
      if (!m.ub) {
        m.heap.forEach(function (a) { if (a && a.live) leaks.push('buffer A' + a.id + ' is never freed'); });
        m.toks.forEach(function (t) { if (t.st !== 'dropped') leaks.push(t.name + ' is never dropped'); });
      }
      var f = frame(m, v, 'drop(v)', '');
      f.dropped = !m.ub; f.leaks = leaks;
      frames.push(f);
    }
    return { frames: frames, results: results, leaks: leaks, firstBad: m.bad, firstUB: m.ub,
             flagged: !!(m.bad || m.ub || leaks.length), mutant: m.mut };
  };

  /* ───────── what the widget shows for one step: rows of slots, chips, the verdict, the log ───────── */
  function row(s, f) {
    var slots = [], owned = {}, i, t, kind, at = f.ub && f.ub.at;
    var bad2 = s.inv.filter(function (x) { return x[0] === 2; })[0], firstBad = bad2 ? +/slot (\d+)/.exec(bad2[1])[1] : -1;
    var w = Math.min(16, Math.max(s.n, s.len));
    for (i = 0; i < w; i++) {
      t = i < s.n ? s.cells[i] : null;
      if (i >= s.n) kind = 'outside';
      else if (!s.live) kind = 'freed';
      else if (i < s.len) { kind = firstBad >= 0 && i >= firstBad ? 'bad' : 'own'; if (t) owned[t.id] = true; }
      else kind = t && t.st === 'vec' && !owned[t.id] ? 'lost' : 'spare';
      slots.push({ i: i, name: t ? t.name : '', kind: kind });
    }
    if (at && at.p === s.ptr && at.i >= w && at.i < 16) slots.push({ i: at.i, name: '', kind: 'outside' });
    if (at && at.p === s.ptr) slots.forEach(function (x) { if (x.i === at.i) x.hit = true; });
    return { head: s.name + ': ptr ' + (s.ptr ? 'A' + s.ptr + (s.live ? '' : ' (freed)') : 'dangling') + ' · cap ' + s.cap + ' · len ' + s.len,
             len: Math.min(s.len, w), slots: slots };
  }
  MV.view = function (R, k) {
    var f = R.frames[k], bad = R.firstBad && R.firstBad.step <= k ? R.firstBad : null, ub = R.firstUB && R.firstUB.step <= k ? R.firstUB : null;
    var rows = [row(f.v, f)], lines = [], j, g, verdict;
    if (f.c) rows.push(row(f.c, f));
    var inv = f.dropped ? null : [1, 2, 3, 4].map(function (n) { return { n: n, ok: !f.v.inv.some(function (x) { return x[0] === n; }) }; });
    if (f.ub) verdict = ['UB: ' + MV.UB[f.ub.kind][0] + ' (' + MV.UB[f.ub.kind][1] + ')', 'err'];
    else if (f.dropped && f.leaks.length) verdict = ['no UB, but a leak, which is safe: ' + f.leaks.join('; '), 'warn'];
    else if (bad) verdict = ['I' + bad.n + ' broken at step ' + bad.step + ': the damage is only a matter of time', 'err'];
    else verdict = [f.dropped ? 'dropped cleanly: every value dropped once, every buffer freed' : 'all four invariants hold', 'ok'];
    for (j = 1; j <= k; j++) {
      g = R.frames[j];
      lines.push(j + '  ' + g.label + (g.res ? '  →  ' + g.res : ''));
      g.ev.forEach(function (e) { lines.push('     ' + e); });
    }
    if (bad) lines.push('', 'First broken invariant: I' + bad.n + ' (' + MV.INV[bad.n] + ') in ' + bad.vec + ', ' + bad.where + ': ' + bad.why + '.');
    if (ub) lines.push((bad ? '' : '\n') + 'Undefined behavior at step ' + ub.step + ': ' + ub.text + ' (' + MV.UB[ub.kind][1] + '). The model stops here.');
    if (f.dropped && f.leaks.length) lines.push('', 'Leaked: ' + f.leaks.join('; ') + '. Safe, but the drop obligation is not met.');
    var mu = MV.MUTANTS.filter(function (x) { return x.id === R.mutant; })[0];
    lines.push('', 'Mutant: ' + (mu ? mu.line : '?') + '.');
    return { rows: rows, inv: inv, verdict: verdict, freed: f.freed, lines: lines, bad: !!(ub || bad),
             kpi: [f.v.len + ' / ' + f.v.cap, bad ? 'I' + bad.n + ' at step ' + bad.step : '—', ub ? MV.UB[ub.kind][1] + ', step ' + ub.step : 'none',
                   f.dropped ? String(f.leaks.length) : '—'],
             title: 'step ' + k + '  ' + f.label + (f.res ? '  →  ' + f.res : '') };
  };
  MV._internal = { Machine: Machine };
  root.MyVec = MV;
  if (typeof module !== 'undefined' && module.exports) module.exports = MV;
})(typeof window !== 'undefined' ? window : this);
