/* traitsolver.js — a miniature Rust trait solver, shared by the widgets in lessons 11, 12, 16 and 21.
 *
 * It answers "does type T implement trait Tr?" by proof search over a small database of impl rules
 * (a positive rule lists the sub-goals it needs; a negative rule gives a reason), and returns the
 * proof tree — or, on failure, the chain of "required for X to implement Y" down to the culprit.
 *
 * It models the standard library's rules for Send, Sync, Copy, Clone, Debug, Display, Default,
 * PartialEq, Eq, PartialOrd, Ord and Hash over the common std types plus user structs
 * (env.structs). It is differential-tested against rustc (tools/test_traitsolver.js).
 *
 * API:
 *   TraitSolver.parse("Arc<Mutex<Vec<i32>>>")           -> type AST (throws on bad input)
 *   TraitSolver.show(ast)                                -> canonical string
 *   TraitSolver.solve("Send", ast, env)                  -> { ok, tree, why }
 *      env = { structs: { Name: { params:['T'], fields:['Rc<T>','i32'], derives:['Clone'], unsafeImpls:{Send:true} } } }
 *   TraitSolver.TRAITS                                   -> list of supported trait names
 */
(function (root) {
  'use strict';
  var TS = {};

  /* ───────────── parsing ───────────── */
  function tokenize(s) {
    var toks = [], i = 0, m;
    var re = /\s*(->|::|[<>(),;&*\[\]+]|'[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|[0-9]+)/y;
    while (i < s.length) {
      re.lastIndex = i; m = re.exec(s);
      if (!m) { if (/^\s*$/.test(s.slice(i))) break; throw new Error('unexpected character at ' + i + ': ' + s.slice(i, i + 8)); }
      toks.push(m[1]); i = re.lastIndex;
    }
    return toks;
  }
  function parse(src) {
    var t = tokenize(src), p = 0;
    function peek() { return t[p]; }
    function eat(x) { if (t[p] !== x) throw new Error('expected ' + x + ' but found ' + (t[p] || 'end')); p++; }
    function typeList(close) {
      var out = [];
      while (peek() !== close) {
        if (peek() && peek()[0] === "'") { p++; if (peek() === ',') p++; continue; } // lifetime argument: ignored
        out.push(ty()); if (peek() === ',') p++; else break;
      }
      return out;
    }
    function ty() {
      var x = peek();
      if (x === '&') { p++; if (peek() && peek()[0] === "'") p++; var mut = false; if (peek() === 'mut') { p++; mut = true; } return { k: 'ref', mut: mut, to: ty() }; }
      if (x === '*') { p++; var m2 = peek() === 'mut'; p++; return { k: 'ptr', mut: m2, to: ty() }; }
      if (x === '(') { p++; var items = typeList(')'); eat(')'); return { k: 'tuple', items: items }; }
      if (x === '[') { p++; var el = ty(); if (peek() === ';') { p++; var n = t[p++]; eat(']'); return { k: 'array', elem: el, n: n }; } eat(']'); return { k: 'slice', elem: el }; }
      if (x === 'fn') { p++; eat('('); var ps = typeList(')'); eat(')'); var ret = null; if (peek() === '->') { p++; ret = ty(); } return { k: 'fn', params: ps, ret: ret }; }
      if (x === 'dyn') { p++; var b = []; b.push(t[p++]); while (peek() === '+') { p++; b.push(t[p++]); } return { k: 'dyn', bounds: b }; }
      if (x && /^[A-Za-z_]/.test(x)) {
        var segs = [t[p++]];
        while (peek() === '::') { p++; segs.push(t[p++]); }
        var name = segs[segs.length - 1];
        if (name === 'Weak') { var pre = segs[segs.length - 2]; name = pre === 'sync' ? 'sync::Weak' : 'rc::Weak'; }
        var args = [];
        if (peek() === '<') { p++; args = typeList('>'); eat('>'); }
        return { k: 'path', name: name, args: args };
      }
      throw new Error('cannot parse type near ' + (x || 'end'));
    }
    var r = ty();
    if (p < t.length) throw new Error('trailing tokens after type: ' + t.slice(p).join(' '));
    return r;
  }
  function show(a) {
    switch (a.k) {
      case 'path': return a.name + (a.args.length ? '<' + a.args.map(show).join(', ') + '>' : '');
      case 'ref': return '&' + (a.mut ? 'mut ' : '') + show(a.to);
      case 'ptr': return '*' + (a.mut ? 'mut ' : 'const ') + show(a.to);
      case 'tuple': return '(' + a.items.map(show).join(', ') + (a.items.length === 1 ? ',' : '') + ')';
      case 'array': return '[' + show(a.elem) + '; ' + a.n + ']';
      case 'slice': return '[' + show(a.elem) + ']';
      case 'fn': return 'fn(' + a.params.map(show).join(', ') + ')' + (a.ret ? ' -> ' + show(a.ret) : '');
      case 'dyn': return 'dyn ' + a.bounds.join(' + ');
    }
    return '?';
  }
  function subst(a, map) {
    if (a.k === 'path') { if (!a.args.length && map[a.name]) return map[a.name]; return { k: 'path', name: a.name, args: a.args.map(function (x) { return subst(x, map); }) }; }
    if (a.k === 'ref' || a.k === 'ptr') return { k: a.k, mut: a.mut, to: subst(a.to, map) };
    if (a.k === 'tuple') return { k: 'tuple', items: a.items.map(function (x) { return subst(x, map); }) };
    if (a.k === 'array') return { k: 'array', elem: subst(a.elem, map), n: a.n };
    if (a.k === 'slice') return { k: 'slice', elem: subst(a.elem, map) };
    if (a.k === 'fn') return { k: 'fn', params: a.params.map(function (x) { return subst(x, map); }), ret: a.ret ? subst(a.ret, map) : null };
    return a;
  }

  /* ───────────── the rule database ───────────── */
  var INTS = 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize'.split(' ');
  var FLOATS = ['f32', 'f64'];
  var ATOMICS = 'AtomicBool AtomicI8 AtomicI16 AtomicI32 AtomicI64 AtomicIsize AtomicU8 AtomicU16 AtomicU32 AtomicU64 AtomicUsize'.split(' ');
  var OWNING = 'Vec VecDeque Option Box HashSet BTreeSet BinaryHeap LinkedList HashMap BTreeMap Result'.split(' ');
  var TRAITS = ['Send', 'Sync', 'Copy', 'Clone', 'Debug', 'Display', 'Default', 'PartialEq', 'Eq', 'PartialOrd', 'Ord', 'Hash'];
  TS.TRAITS = TRAITS;

  var WHY = {
    rc: 'Rc keeps its reference count in a plain, non-atomic integer, so two threads touching it could corrupt the count',
    ptr: 'a raw pointer carries no promise about what it points to or who else can reach it',
    cell: 'Cell/RefCell allow mutation through a shared reference with no synchronization, so two threads could mutate at once',
    guard: 'a lock guard must be released by the thread that took the lock',
    recv: 'a Receiver is single-consumer: sharing it between threads would allow concurrent receives',
    dyn: 'a trait object only implements a marker trait if the trait-object type says so (dyn Trait + Send)',
    unsized: 'the type is unsized, so it can only be used behind a pointer'
  };

  function isScalar(n) { return INTS.indexOf(n) >= 0 || FLOATS.indexOf(n) >= 0 || n === 'bool' || n === 'char'; }
  function P(name) { return { k: 'path', name: name, args: [] }; }
  function yes(rule, needs) { return { ok: true, rule: rule, needs: needs || [] }; }
  function no(why) { return { ok: false, why: why }; }
  function all(trait, list, rule) { return yes(rule, list.map(function (x) { return [trait, x]; })); }

  /* returns {ok, rule, needs} | {ok:false, why}   (needs = [[trait, type], ...]) */
  function rule(trait, a, env) {
    var n = a.k === 'path' ? a.name : null, args = a.args || [];
    // user structs -------------------------------------------------------------------------
    if (n && env && env.structs && env.structs[n]) {
      var s = env.structs[n], map = {};
      (s.params || []).forEach(function (pn, i) { if (args[i]) map[pn] = args[i]; });
      var fields = s.fields.map(function (f) { return subst(parse(f), map); });
      if (trait === 'Send' || trait === 'Sync') {
        if (s.unsafeImpls && s.unsafeImpls[trait]) return yes('unsafe impl ' + trait + ' for ' + n, []);
        return all(trait, fields, n + ' is ' + trait + ' when every field is ' + trait);
      }
      if ((s.derives || []).indexOf(trait) < 0) {
        // derive(PartialOrd) needs PartialEq etc. are the user's job; here: no derive => no impl
        return no(n + ' does not derive or implement ' + trait);
      }
      if (trait === 'Default' || trait === 'Clone' || trait === 'Copy' || trait === 'Debug' || trait === 'PartialEq' || trait === 'Eq' || trait === 'PartialOrd' || trait === 'Ord' || trait === 'Hash')
        return all(trait, fields, '#[derive(' + trait + ')] on ' + n + ' needs every field to be ' + trait);
      return no(n + ' does not implement ' + trait);
    }
    // marker traits ------------------------------------------------------------------------
    if (trait === 'Send' || trait === 'Sync') {
      var S = trait === 'Send';
      if (a.k === 'path') {
        if (isScalar(n) || n === 'str' || n === 'String' || ATOMICS.indexOf(n) >= 0 || n === 'JoinHandle') return yes(n + ' is ' + trait + ' (no interior sharing hazards)');
        if (OWNING.indexOf(n) >= 0 || n === 'PhantomData') return all(trait, args, n + '<..> is ' + trait + ' when its parameters are');
        if (n === 'rc::Weak' || n === 'Rc') return no(WHY.rc);
        if (n === 'Arc' || n === 'sync::Weak') return yes('Arc<T> is ' + trait + ' only when T is Send + Sync', [['Send', args[0]], ['Sync', args[0]]]);
        if (n === 'Cell' || n === 'RefCell' || n === 'UnsafeCell') return S ? yes(n + '<T> is Send when T is Send', [['Send', args[0]]]) : no(WHY.cell);
        if (n === 'Mutex') return yes('Mutex<T> is ' + trait + ' when T is Send (the lock supplies the exclusion)', [['Send', args[0]]]);
        if (n === 'RwLock') return S ? yes('RwLock<T> is Send when T is Send', [['Send', args[0]]]) : yes('RwLock<T> is Sync when T is Send + Sync', [['Send', args[0]], ['Sync', args[0]]]);
        if (n === 'MutexGuard' || n === 'RwLockReadGuard' || n === 'RwLockWriteGuard') return S ? no(WHY.guard) : yes(n + '<T> is Sync when T is Sync', [['Sync', args[0]]]);
        if (n === 'Sender' || n === 'SyncSender') return yes(n + '<T> is ' + trait + ' when T is Send', [['Send', args[0]]]);
        if (n === 'Receiver') return S ? yes('Receiver<T> is Send when T is Send', [['Send', args[0]]]) : no(WHY.recv);
        return no('unknown type ' + n + ' (not in the solver database)');
      }
      if (a.k === 'ref') return a.mut ? yes('&mut T is ' + trait + ' when T is ' + trait, [[trait, a.to]]) : (S ? yes('&T is Send only when T is Sync', [['Sync', a.to]]) : yes('&T is Sync when T is Sync', [['Sync', a.to]]));
      if (a.k === 'ptr') return no(WHY.ptr);
      if (a.k === 'tuple') return all(trait, a.items, 'a tuple is ' + trait + ' when every element is');
      if (a.k === 'array' || a.k === 'slice') return all(trait, [a.elem], 'an array/slice is ' + trait + ' when its element type is');
      if (a.k === 'fn') return yes('fn pointers are ' + trait);
      if (a.k === 'dyn') return a.bounds.indexOf(trait) >= 0 ? yes('the trait object is declared ' + trait) : no(WHY.dyn);
    }
    // Copy / Clone -------------------------------------------------------------------------
    if (trait === 'Copy') {
      if (a.k === 'path') {
        if (isScalar(n) || n === 'PhantomData') return yes(n + ' is Copy (plain bits)');
        if (n === 'Option') return all('Copy', args, 'Option<T> is Copy when T is Copy');
        if (n === 'Result') return all('Copy', args, 'Result<T, E> is Copy when both are Copy');
        if (n === 'str') return no(WHY.unsized);
        if (OWNING.indexOf(n) >= 0 || n === 'String' || n === 'Rc' || n === 'Arc' || n === 'Cell' || n === 'RefCell' || n === 'Mutex' || n === 'RwLock' || n === 'rc::Weak' || n === 'sync::Weak' || ATOMICS.indexOf(n) >= 0)
          return no(n + ' owns a resource (or is not plain bits), so a bitwise copy would create a second owner');
        return no('unknown type ' + n);
      }
      if (a.k === 'ref') return a.mut ? no('&mut T is exclusive: copying it would create two exclusive names') : yes('&T is Copy');
      if (a.k === 'ptr' || a.k === 'fn') return yes('pointers are Copy');
      if (a.k === 'tuple') return all('Copy', a.items, 'a tuple is Copy when every element is');
      if (a.k === 'array') return all('Copy', [a.elem], 'an array is Copy when its element is');
      return no(WHY.unsized);
    }
    if (trait === 'Clone') {
      if (a.k === 'path') {
        if (isScalar(n) || n === 'String' || n === 'PhantomData' || n === 'Rc' || n === 'Arc' || n === 'rc::Weak' || n === 'sync::Weak' || n === 'Sender' || n === 'SyncSender') return yes(n + ' is Clone' + (n === 'Rc' || n === 'Arc' ? ' (bumps the reference count)' : ''));
        if (OWNING.indexOf(n) >= 0) return all('Clone', args, n + '<..> is Clone when its parameters are');
        if (n === 'RefCell') return all('Clone', args, 'RefCell<T> is Clone when T is Clone');
        if (n === 'Cell') return all('Copy', args, 'Cell<T> is Clone when T is Copy');
        if (n === 'str') return no(WHY.unsized);
        return no(n + ' cannot be cloned (it owns a unique resource)');
      }
      if (a.k === 'ref') return a.mut ? no('&mut T is exclusive and cannot be cloned') : yes('&T is Clone');
      if (a.k === 'ptr' || a.k === 'fn') return yes('pointers are Clone');
      if (a.k === 'tuple') return all('Clone', a.items, 'a tuple is Clone when every element is');
      if (a.k === 'array') return all('Clone', [a.elem], 'an array is Clone when its element is');
      return no(a.k === 'dyn' ? 'a trait object is unsized and not Clone' : WHY.unsized);
    }
    // the comparison / formatting / default traits ------------------------------------------
    var isFloat = a.k === 'path' && FLOATS.indexOf(n) >= 0;
    var isPrim = a.k === 'path' && (isScalar(n) || n === 'String' || n === 'str');
    if (trait === 'Display') {
      if (isPrim) return yes(n + ' implements Display');
      if (a.k === 'ref') return all('Display', [a.to], '&T is Display when T is');
      if (a.k === 'path' && (n === 'Box' || n === 'Rc' || n === 'Arc' || n === 'MutexGuard' || n === 'RwLockReadGuard' || n === 'RwLockWriteGuard')) return all('Display', args, n + '<T> is Display when T is');
      return no((a.k === 'path' ? n : a.k) + ' has no Display (only Debug): Display is for user-facing text and is opt-in');
    }
    if (trait === 'Default') {
      if (a.k === 'path' && (isScalar(n) || n === 'String' || n === 'PhantomData' || ATOMICS.indexOf(n) >= 0)) return yes(n + ' has a Default');
      if (a.k === 'path' && (n === 'rc::Weak' || n === 'sync::Weak')) return yes('Weak::new() is the Default (a Weak that points at nothing)');
      if (a.k === 'ptr') return yes('a raw pointer has a Default (null)');
      if (a.k === 'path' && (n === 'Vec' || n === 'VecDeque' || n === 'Option' || n === 'HashMap' || n === 'HashSet' || n === 'BTreeMap' || n === 'BTreeSet' || n === 'BinaryHeap' || n === 'LinkedList')) return yes(n + ' has a Default (empty)');
      if (a.k === 'path' && (n === 'Box' || n === 'Rc' || n === 'Arc' || n === 'Cell' || n === 'RefCell' || n === 'Mutex' || n === 'RwLock')) return all('Default', args, n + '<T> is Default when T is');
      if (a.k === 'tuple') return all('Default', a.items, 'a tuple is Default when every element is');
      if (a.k === 'array') return all('Default', [a.elem], 'an array is Default when its element is (up to length 32)');
      if (a.k === 'ref' && ((a.to.k === 'path' && a.to.name === 'str') || a.to.k === 'slice')) return yes('a reference to str or a slice has a Default (empty)');
      return no((a.k === 'path' ? n : a.k) + ' has no Default');
    }
    if (trait === 'Debug' || trait === 'PartialEq' || trait === 'Eq' || trait === 'PartialOrd' || trait === 'Ord' || trait === 'Hash') {
      var t = trait;
      if (a.k === 'path') {
        if (isPrim) {
          if (isFloat && (t === 'Eq' || t === 'Ord' || t === 'Hash')) return no(n + ' has NaN, which is not equal to itself, so it is not ' + t);
          return yes(n + ' implements ' + t);
        }
        if (n === 'JoinHandle') return t === 'Debug' ? yes('JoinHandle implements Debug') : no('JoinHandle has no ' + t);
        if (ATOMICS.indexOf(n) >= 0) return t === 'Debug' ? yes(n + ' implements Debug') : no(n + ' has no ' + t);
        if (n === 'PhantomData') return yes('PhantomData implements ' + t);
        if (n === 'Vec' || n === 'VecDeque' || n === 'Option' || n === 'Box' || n === 'Rc' || n === 'Arc' || n === 'LinkedList') return all(t, args, n + '<..> is ' + t + ' when its parameter is');
        if (n === 'BTreeSet' || n === 'BTreeMap') return all(t, args, n + '<..> is ' + t + ' when its parameters are');
        if (n === 'BinaryHeap') return t === 'Debug' ? all(t, args, 'BinaryHeap<T> is Debug when T is') : no('BinaryHeap has no ' + t);
        if (n === 'Result') return all(t, args, 'Result<T, E> is ' + t + ' when both are');
        if (n === 'HashMap') return (t === 'Debug' || t === 'PartialEq' || t === 'Eq') ? yes('HashMap<K, V> is ' + t + ' when its parameters are', args.map(function (x, i) { return [(t === 'Debug' ? 'Debug' : (i === 0 ? 'Eq' : t)), x]; }).concat(t === 'Debug' ? [] : [['Hash', args[0]]])) : no('HashMap has no ' + t + ' (its iteration order is unspecified)');
        if (n === 'HashSet') return (t === 'Debug' || t === 'PartialEq' || t === 'Eq') ? yes('HashSet<T> is ' + t + ' when T is', t === 'Debug' ? [['Debug', args[0]]] : [['Eq', args[0]], ['Hash', args[0]]]) : no('HashSet has no ' + t + ' (its iteration order is unspecified)');
        if (n === 'RefCell') return (t === 'Hash') ? no('RefCell has no Hash (its contents can change)') : all(t, args, 'RefCell<T> is ' + t + ' when T is');
        if (n === 'Cell') return (t === 'Debug' || t === 'PartialEq' || t === 'Eq' || t === 'PartialOrd' || t === 'Ord') ? yes('Cell<T> is ' + t + ' when T is Copy + ' + t, [['Copy', args[0]], [t, args[0]]]) : no('Cell has no ' + t);
        if (n === 'Mutex' || n === 'RwLock') return t === 'Debug' ? all(t, args, n + '<T> is Debug when T is') : no(n + ' has no ' + t + ' (comparing would need to take the lock)');
        if (n === 'MutexGuard' || n === 'RwLockReadGuard' || n === 'RwLockWriteGuard') return t === 'Debug' ? all(t, args, n + ' is Debug when T is') : no(n + ' has no ' + t);
        if (n === 'Sender' || n === 'SyncSender' || n === 'Receiver') return t === 'Debug' ? yes(n + ' implements Debug') : no(n + ' has no ' + t);
        if (n === 'rc::Weak' || n === 'sync::Weak') return t === 'Debug' ? yes('Weak implements Debug') : no('Weak has no ' + t);
        return no('unknown type ' + n);
      }
      if (a.k === 'ref') return all(t, [a.to], '&T is ' + t + ' when T is');
      if (a.k === 'ptr') return yes('raw pointers implement ' + t + ' (comparing addresses)');
      if (a.k === 'tuple') return all(t, a.items, 'a tuple is ' + t + ' when every element is');
      if (a.k === 'array' || a.k === 'slice') return all(t, [a.elem], 'an array/slice is ' + t + ' when its element is');
      if (a.k === 'fn') return (t === 'Debug' || t === 'PartialEq' || t === 'Eq' || t === 'Hash' || t === 'PartialOrd' || t === 'Ord') ? yes('fn pointers implement ' + t) : no('no ' + t);
      if (a.k === 'dyn') return (t === 'Debug' && a.bounds.indexOf('Debug') >= 0) ? yes('declared Debug') : no('a trait object only has ' + t + ' if the trait says so');
    }
    return no('trait ' + trait + ' is not in the solver database');
  }

  /* ───────────── proof search ───────────── */
  function solve(trait, ast, env, depth) {
    depth = depth || 0;
    var goal = show(ast) + ': ' + trait;
    if (depth > 40) return { ok: false, tree: { goal: goal, ok: false, kids: [] }, why: 'recursion limit' };
    var r = rule(trait, ast, env || {});
    if (!r.ok) return { ok: false, why: r.why, tree: { goal: goal, ok: false, reason: r.why, kids: [] } };
    var kids = [], ok = true, why = null;
    for (var i = 0; i < r.needs.length; i++) {
      var sub = solve(r.needs[i][0], r.needs[i][1], env, depth + 1);
      kids.push(sub.tree);
      if (!sub.ok && ok) { ok = false; why = sub.why; }
    }
    return { ok: ok, why: why, tree: { goal: goal, ok: ok, rule: r.rule, kids: kids } };
  }
  /* the failure chain, outermost first: ["Arc<RefCell<i32>>: Send", "RefCell<i32>: Sync", ... reason] */
  function chain(tree) {
    var out = [], node = tree;
    while (node) {
      out.push(node.goal);
      var bad = null;
      for (var i = 0; i < node.kids.length; i++) if (!node.kids[i].ok) { bad = node.kids[i]; break; }
      if (!bad) { if (node.reason) out.push(node.reason); break; }
      node = bad;
    }
    return out;
  }
  function render(tree, indent) {
    indent = indent || '';
    var line = indent + (tree.ok ? '✓ ' : '✗ ') + tree.goal + (tree.rule ? '   — ' + tree.rule : '') + (tree.reason ? '   — ' + tree.reason : '');
    var lines = [line];
    tree.kids.forEach(function (k) { lines.push(render(k, indent + '   ')); });
    return lines.join('\n');
  }

  TS.parse = parse; TS.show = show; TS.chain = chain; TS.render = render;
  TS.solve = function (trait, ast, env) { if (typeof ast === 'string') ast = parse(ast); return solve(trait, ast, env || {}, 0); };
  root.TraitSolver = TS;
  if (typeof module !== 'undefined' && module.exports) module.exports = TS;
})(typeof window !== 'undefined' ? window : this);
