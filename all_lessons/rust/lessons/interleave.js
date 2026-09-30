/* interleave.js — an exhaustive interleaving explorer for tiny concurrent programs (Lesson 17).
 *
 * A program is 1-3 threads; each thread is a list of indivisible steps over shared integer
 * variables, mutexes and unbounded FIFO channels:
 *
 *   load x        r := x              (the thread's own register for x)
 *   store x       x := r + 1          (the second half of x += 1)
 *   fetch_add x   x := x + 1          (one indivisible read-modify-write)
 *   lock A        wait until A is free, then hold it   (holding A already: waits forever)
 *   unlock A      release A
 *   send c 1      push 1 onto channel c   (never blocks, like mpsc::channel)
 *   recv c s      wait until c is non-empty, pop v, s := s + v
 *
 * explore() enumerates EVERY schedule (every order in which the threads' steps can happen)
 * by a memoized depth-first search over states (program counters, memory, registers, lock
 * owners, queued messages).  It returns the exact set of final outcomes with the number of
 * schedules that produce each, whether a deadlock (no thread can move, some unfinished) is
 * reachable, the shortest schedule that reaches one, and a witness schedule per outcome.
 * One global order of steps is exactly the model SeqCst atomics promise (FACTS E92).
 * Cross-checked against an independent BFS enumerator and against real runs of compiled
 * Rust by tools/rust_verify/17_interleave.js.
 *
 * API:
 *   Interleave.parse(["lock A; load x; store x; unlock A", "..."], n)  -> prog  (throws on bad input)
 *   Interleave.explore(prog)             -> { schedules, states, outcomes:[{key,count,witness}], sequential,
 *                                             deadlock:{count, shortest:[t..] | null}, truncated }
 *   Interleave.replay(prog, schedule)    -> { steps:[{t, text, note}], blocked:[{t, text}] }
 *   Interleave.endings(result)           -> { list:[{label, sched, count, dead?, seq?}], start }   (witnesses to page through)
 *   Interleave.report(prog, result, w)   -> { text, bad, kpis, replay }                          (the readout, in words)
 *   Interleave.PRESETS                   -> [{ id, name, threads:[text, ...], note }]
 */
(function (root) {
  'use strict';
  var IL = {};
  var DEAD = 'deadlock';
  var LIMIT_STEPS = 24, LIMIT_TOTAL = 40, LIMIT_STATES = 400000;

  /* ───────────── parsing and validation ───────────── */
  var KIND = { load: 'v', store: 'v', fetch_add: 'v', lock: 'm', unlock: 'm', send: 'c', recv: 'c' };
  var NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

  function parseBody(text, who) {
    var out = [];
    String(text || '').split(/[;\n]+/).forEach(function (raw) {
      var w = raw.trim().split(/\s+/).filter(Boolean);
      if (!w.length) return;
      var op = w[0] === 'add' ? 'fetch_add' : w[0];
      if (!KIND[op]) throw new Error(who + ': unknown step "' + raw.trim() + '" (use load, store, fetch_add, lock, unlock, send, recv)');
      var want = op === 'send' ? [2, 3] : op === 'recv' ? [3, 3] : [2, 2];
      if (w.length < want[0] || w.length > want[1]) throw new Error(who + ': "' + raw.trim() + '" — ' + (op === 'recv' ? 'write recv c s (s receives the value)' : op === 'send' ? 'write send c or send c 2' : 'write ' + op + ' NAME'));
      if (!NAME.test(w[1]) || (op === 'recv' && !NAME.test(w[2]))) throw new Error(who + ': bad name in "' + raw.trim() + '"');
      var s = { op: op, name: w[1] };
      if (op === 'send') { s.val = w.length === 3 ? parseInt(w[2], 10) : 1; if (!(s.val >= 0 && s.val <= 9)) throw new Error(who + ': send a value from 0 to 9'); }
      if (op === 'recv') s.dst = w[2];
      out.push(s);
    });
    return out;
  }

  /* texts: one string per thread (blank strings are skipped); n: iterations per thread (the body repeats n times) */
  function parse(texts, n) {
    n = Math.max(1, Math.min(4, n | 0 || 1));
    var bodies = [], kinds = {}, vars = [], mutexes = [], chans = [], sends = {}, recvs = {};
    function declare(name, kind, who) {
      if (kinds[name] && kinds[name] !== kind) throw new Error(who + ': "' + name + '" is used both as a ' + WORD[kinds[name]] + ' and as a ' + WORD[kind]);
      if (!kinds[name]) { kinds[name] = kind; (kind === 'v' ? vars : kind === 'm' ? mutexes : chans).push(name); }
    }
    texts.forEach(function (tx, i) {
      if (!String(tx || '').trim()) return;
      var who = 'T' + (bodies.length + 1), body = parseBody(tx, who), loaded = {}, held = {};
      body.forEach(function (s) {
        declare(s.name, KIND[s.op], who);
        if (s.op === 'recv') declare(s.dst, 'v', who);
        if (s.op === 'load') loaded[s.name] = true;
        if (s.op === 'store' && !loaded[s.name]) throw new Error(who + ': store ' + s.name + ' before any load ' + s.name + ' (store writes the loaded value + 1)');
        if (s.op === 'lock') held[s.name] = true;
        if (s.op === 'unlock') { if (!held[s.name]) throw new Error(who + ': unlock ' + s.name + ' without holding it (only a guard can unlock, and only its owner has the guard)'); delete held[s.name]; }
        if (s.op === 'send') sends[s.name] = (sends[s.name] || 0) + 1;
        if (s.op === 'recv') recvs[s.name] = (recvs[s.name] || 0) + 1;
      });
      var still = Object.keys(held);
      if (still.length) throw new Error(who + ': ends while holding ' + still.join(', ') + ' — a guard is dropped by the end of its scope, so add unlock ' + still[0]);
      bodies.push(body);
    });
    if (!bodies.length) throw new Error('no threads: write at least one step');
    Object.keys(recvs).forEach(function (c) {
      if ((sends[c] || 0) < recvs[c]) throw new Error('channel ' + c + ': more recv than send — the extra recv would find every Sender gone and get Err(RecvError); keep recv ≤ send');
    });
    var threads = bodies.map(function (b) { var e = []; for (var k = 0; k < n; k++) e = e.concat(b); return e; });
    var total = 0;
    threads.forEach(function (th, i) { total += th.length; if (th.length > LIMIT_STEPS) throw new Error('T' + (i + 1) + ' has ' + th.length + ' steps after repetition; the limit is ' + LIMIT_STEPS); });
    if (total > LIMIT_TOTAL) throw new Error(total + ' steps in all; the limit is ' + LIMIT_TOTAL);
    vars.sort(); mutexes.sort(); chans.sort();
    var ix = function (list) { var o = {}; list.forEach(function (x, i) { o[x] = i; }); return o; };
    var vi = ix(vars), mi = ix(mutexes), ci = ix(chans);
    threads = threads.map(function (th) {
      return th.map(function (s) {
        var k = KIND[s.op], c = { op: s.op, name: s.name, i: k === 'v' ? vi[s.name] : k === 'm' ? mi[s.name] : ci[s.name] };
        if (s.op === 'send') c.val = s.val;
        if (s.op === 'recv') { c.dst = s.dst; c.j = vi[s.dst]; }
        return c;
      });
    });
    return { threads: threads, bodies: bodies, n: n, vars: vars, mutexes: mutexes, chans: chans };
  }
  var WORD = { v: 'variable', m: 'mutex', c: 'channel' };

  /* ───────────── semantics: one indivisible step ───────────── */
  function initial(p) {
    var T = p.threads.length, V = p.vars.length, reg = [];
    for (var t = 0; t < T; t++) reg.push(zeros(V));
    return { pc: zeros(T), mem: zeros(V), reg: reg, own: fill(p.mutexes.length, -1), q: p.chans.map(function () { return []; }) };
  }
  function zeros(n) { return fill(n, 0); }
  function fill(n, x) { var a = []; for (var i = 0; i < n; i++) a.push(x); return a; }
  function clone(s) {
    return { pc: s.pc.slice(), mem: s.mem.slice(), reg: s.reg.map(function (r) { return r.slice(); }), own: s.own.slice(), q: s.q.map(function (x) { return x.slice(); }) };
  }
  function enabled(p, s, t) {
    var st = p.threads[t][s.pc[t]];
    if (!st) return false;
    if (st.op === 'lock') return s.own[st.i] === -1;        // free; a mutex you already hold never is
    if (st.op === 'recv') return s.q[st.i].length > 0;      // a message is waiting
    return true;
  }
  function step(p, s, t) {
    var st = p.threads[t][s.pc[t]], n = clone(s);
    switch (st.op) {
      case 'load': n.reg[t][st.i] = n.mem[st.i]; break;
      case 'store': n.mem[st.i] = n.reg[t][st.i] + 1; break;
      case 'fetch_add': n.mem[st.i] += 1; break;
      case 'lock': n.own[st.i] = t; break;
      case 'unlock': n.own[st.i] = -1; break;
      case 'send': n.q[st.i].push(st.val); break;
      case 'recv': n.mem[st.j] += n.q[st.i].shift(); break;
    }
    n.pc[t]++;
    return n;
  }
  function key(s) {
    return s.pc.join(',') + '|' + s.mem.join(',') + '|' + s.reg.map(function (r) { return r.join(','); }).join(';') + '|' + s.own.join(',') + '|' + s.q.map(function (x) { return x.join(','); }).join(';');
  }
  function outcomeKey(p, s) {
    if (!p.vars.length) return 'done';
    return p.vars.map(function (v, i) { return v + '=' + s.mem[i]; }).join(' ');
  }

  /* ───────────── exploration: every schedule, memoized ───────────── */
  function explore(p) {
    var T = p.threads.length, memo = new Map(), truncated = false;
    function visit(s) {
      var k = key(s), hit = memo.get(k);
      if (hit) return hit;                              // same state, same future
      if (memo.size >= LIMIT_STATES) { truncated = true; return { c: {}, first: {}, dd: Infinity, dt: -1 }; }
      var node = { c: {}, first: {}, dd: Infinity, dt: -1 }, moved = false, done = true;
      for (var t = 0; t < T; t++) {
        if (s.pc[t] < p.threads[t].length) done = false;
        if (!enabled(p, s, t)) continue;                // waiting for a held lock or an empty channel
        moved = true;
        var sub = visit(step(p, s, t));                   // every enabled thread may go next
        for (var o in sub.c) {
          node.c[o] = (node.c[o] || 0) + sub.c[o];        // schedules through this child
          if (!(o in node.first)) node.first[o] = t;      // lexicographically first witness
        }
        if (sub.dd + 1 < node.dd) { node.dd = sub.dd + 1; node.dt = t; }
      }
      if (!moved) {                                       // nobody can move: the schedule ends
        var out = done ? outcomeKey(p, s) : DEAD;
        node.c[out] = 1;
        if (!done) node.dd = 0;                           // unfinished threads, all blocked
      }
      memo.set(k, node);
      return node;
    }
    var s0 = initial(p), root = visit(s0), total = 0, outs = [];
    Object.keys(root.c).forEach(function (o) {
      total += root.c[o];
      if (o !== DEAD) outs.push({ key: o, count: root.c[o], witness: follow(p, s0, memo, o) });
    });
    outs.sort(function (a, b) { return cmpOutcome(a.key, b.key); });
    var dl = root.c[DEAD] ? { count: root.c[DEAD], shortest: shortest(p, s0, memo) } : { count: 0, shortest: null };
    return { schedules: total, states: memo.size, outcomes: outs, deadlock: dl, sequential: sequential(p), truncated: truncated };
  }
  function follow(p, s, memo, o) {
    var path = [];
    for (;;) { var nd = memo.get(key(s)); if (!nd || !(o in nd.first)) return path; path.push(nd.first[o]); s = step(p, s, nd.first[o]); }
  }
  function shortest(p, s, memo) {
    var path = [];
    for (;;) { var nd = memo.get(key(s)); if (!nd || nd.dd === 0 || nd.dt < 0) return path; path.push(nd.dt); s = step(p, s, nd.dt); }
  }
  /* T1 runs to completion, then T2, then T3: the answer with no concurrency at all (null if it blocks) */
  function sequential(p) {
    var s = initial(p);
    for (var t = 0; t < p.threads.length; t++) {
      while (s.pc[t] < p.threads[t].length) { if (!enabled(p, s, t)) return null; s = step(p, s, t); }
    }
    return outcomeKey(p, s);
  }
  function cmpOutcome(a, b) {
    var na = a.match(/-?\d+/g) || [], nb = b.match(/-?\d+/g) || [];
    for (var i = 0; i < Math.max(na.length, nb.length); i++) { var d = (+na[i] || 0) - (+nb[i] || 0); if (d) return d; }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* ───────────── replay a schedule, for the lanes and the readout ───────────── */
  function describe(p, s, t) {
    var st = p.threads[t][s.pc[t]];
    switch (st.op) {
      case 'load': return { text: 'load ' + st.name, note: 'reads ' + st.name + ' = ' + s.mem[st.i] };
      case 'store': return { text: 'store ' + st.name, note: 'writes ' + st.name + ' = ' + (s.reg[t][st.i] + 1) };
      case 'fetch_add': return { text: 'fetch_add ' + st.name, note: st.name + ': ' + s.mem[st.i] + ' → ' + (s.mem[st.i] + 1) };
      case 'lock': return { text: 'lock ' + st.name, note: 'takes ' + st.name };
      case 'unlock': return { text: 'unlock ' + st.name, note: 'releases ' + st.name };
      case 'send': return { text: 'send ' + st.name, note: 'queues ' + st.val + ' on ' + st.name };
      case 'recv': return { text: 'recv ' + st.name, note: st.dst + ' += ' + s.q[st.i][0] };
    }
    return { text: st.op, note: '' };
  }
  function replay(p, sched) {
    var s = initial(p), steps = [];
    sched.forEach(function (t) { var d = describe(p, s, t); steps.push({ t: t, text: d.text, note: d.note }); s = step(p, s, t); });
    var blocked = [];
    for (var t = 0; t < p.threads.length; t++) {
      var st = p.threads[t][s.pc[t]];
      if (!st || enabled(p, s, t)) continue;
      if (st.op === 'lock') blocked.push({ t: t, text: 'waits for ' + st.name + (s.own[st.i] === t ? ', which it already holds' : ' (held by T' + (s.own[st.i] + 1) + ')') });
      else blocked.push({ t: t, text: 'waits for a message on ' + st.name });
    }
    return { steps: steps, blocked: blocked, final: s };
  }

  /* ───────────── the result in words (the widget's readout; testable in Node) ───────────── */
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function steps(k) { return k + ' step' + (k === 1 ? '' : 's'); }
  /* the witnesses a reader can page through: the deadlock first (if any), then every answer;
     start at the deadlock, else at the rarest answer that differs from the sequential one */
  function endings(r) {
    var list = [], start = 0, best = -1;
    if (r.deadlock.count) list.push({ label: DEAD, sched: r.deadlock.shortest, count: r.deadlock.count, dead: true });
    r.outcomes.forEach(function (o) { list.push({ label: o.key, sched: o.witness, count: o.count, seq: o.key === r.sequential }); });
    if (!r.deadlock.count) {
      list.forEach(function (w, i) { if (!w.seq && (best < 0 || w.count < list[best].count)) best = i; });
      start = Math.max(0, best);
    }
    return { list: list, start: start };
  }
  function report(p, r, w) {
    var dl = r.deadlock, outs = r.outcomes, rp = replay(p, w.sched);
    var lines = p.bodies.map(function (b, i) {
      return 'T' + (i + 1) + ': ' + b.map(function (s) { return s.op + ' ' + s.name + (s.op === 'send' ? ' ' + s.val : s.op === 'recv' ? ' ' + s.dst : ''); }).join('; ') + (p.n > 1 ? '   ×' + p.n : '');
    });
    lines.push('', fmt(r.schedules) + ' interleavings over ' + fmt(r.states) + ' distinct states' + (r.truncated ? ' (search stopped early: too many states)' : '') + '.');
    lines.push('endings: ' + outs.map(function (o) { return o.key + ' in ' + fmt(o.count); }).concat(dl.count ? ['deadlock in ' + fmt(dl.count)] : []).join(', ') +
               '   (one thread after another: ' + (r.sequential || 'it blocks') + ')');
    lines.push('shown: ' + (rp.steps.length ? rp.steps.map(function (s) { return 'T' + (s.t + 1) + ' ' + s.text + ' (' + s.note + ')'; }).join(' → ') : 'no step can run') +
               (w.dead ? ' → ' + rp.blocked.map(function (b) { return 'T' + (b.t + 1) + ' ' + b.text; }).join('; ') : ''));
    var good = outs.filter(function (o) { return o.key === r.sequential; })[0], verdict;
    if (dl.count) verdict = 'DEADLOCK: ' + fmt(dl.count) + ' of ' + fmt(r.schedules) + ' interleavings end with every unfinished thread waiting; the shortest takes ' + steps(dl.shortest.length) + '.';
    else if (outs.length > 1) verdict = 'RACE CONDITION: ' + outs.length + ' different answers' + (good ? '; only ' + fmt(good.count) + ' of ' + fmt(r.schedules) + ' interleavings give ' + good.key : '') + '. No data race: every step is one indivisible access.';
    else verdict = 'ONE ANSWER: all ' + fmt(r.schedules) + ' interleavings end with ' + outs[0].key + '.';
    lines.push('', verdict);
    return { text: lines.join('\n'), bad: !!dl.count || outs.length > 1, replay: rp,
             kpis: [fmt(r.schedules), fmt(r.states), String(outs.length), dl.count ? 'yes · ' + steps(dl.shortest.length) : 'no'] };
  }

  IL.PRESETS = [
    { id: 'a', name: '(a) x += 1 as load + store', threads: ['load x; store x', 'load x; store x'],
      note: 'Every step is atomic — no data race — yet an update can be lost.' },
    { id: 'b', name: '(b) x += 1 as fetch_add', threads: ['fetch_add x', 'fetch_add x'],
      note: 'One indivisible read-modify-write per increment.' },
    { id: 'c', name: '(c) x += 1 under a Mutex', threads: ['lock m; load x; store x; unlock m', 'lock m; load x; store x; unlock m'],
      note: 'The same two steps, but nobody can run them while the other holds m.' },
    { id: 'd', name: '(d) two locks, opposite order', threads: ['lock A; lock B; fetch_add x; unlock B; unlock A', 'lock B; lock A; fetch_add x; unlock A; unlock B'],
      note: 'A transfer A→B and a transfer B→A, each locking its source first.' },
    { id: 'e', name: '(e) two locks, one global order', threads: ['lock A; lock B; fetch_add x; unlock B; unlock A', 'lock A; lock B; fetch_add x; unlock B; unlock A'],
      note: 'Both transfers lock A before B.' },
    { id: 'f', name: '(f) producer → consumer channel', threads: ['send c 1', 'recv c s'],
      note: 'T1 sends, T2 receives; the value moves, nobody shares it.' },
    { id: 'g', name: '(g) recv while holding a lock', threads: ['lock m; recv c s; unlock m', 'lock m; send c 1; unlock m'],
      note: 'T1 waits for a message while holding the lock the sender needs.' }
  ];

  IL.parse = parse; IL.explore = explore; IL.replay = replay; IL.endings = endings; IL.report = report; IL.fmt = fmt; IL.DEAD = DEAD;
  IL._internal = { initial: initial, enabled: enabled, step: step, key: key, outcomeKey: outcomeKey };
  root.Interleave = IL;
  if (typeof module !== 'undefined' && module.exports) module.exports = IL;
})(typeof window !== 'undefined' ? window : this);
