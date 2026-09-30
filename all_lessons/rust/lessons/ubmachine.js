/* ubmachine.js — a tiny abstract machine for Lesson 19 ("unsafe — taking the proof back").
 *
 * It runs a short script of raw-pointer operations one step at a time and checks, at every step, the
 * obligation that the step's `unsafe` operation hands to the programmer. At the first step whose
 * obligation is not met it stops and names the rule: an item of the Reference's list of undefined
 * behavior (dangling, misaligned, invalid value) or the stated condition of an unsafe function
 * (`alloc`, `add`, a second `dealloc`). It models allocations (size, alignment, live/freed/dead,
 * which bytes are initialized), raw pointers (allocation, offset, element type) and nothing else:
 * no aliasing rules (the Reference says they are not settled), no threads, no integer-to-pointer casts.
 * Bytes are little-endian, as on the machine the lesson was checked on.
 *
 * The script language is a sliver of Rust, one operation per line:
 *   let a = alloc(8, 4);        heap block of 8 bytes, 4-aligned, uninitialized  -> *mut u8
 *   let p = a.cast::<u32>();    same address, new element type (u8 | u32 | bool | char)
 *   let q = p.add(1);           one ELEMENT further (4 bytes for u32)
 *   let r = q;                  copy a pointer
 *   p.write(7);                 store through a *mut u8 or *mut u32
 *   p.read();                   load (u8 | u32 | bool | char) and print it
 *   dealloc(a);                 free the block (the name alloc returned)
 *   let x = local(5);           a u32 local on the stack; x points to it (*mut u32)
 *   end(x);                     that local's scope ends
 *   let n = null::<u32>();      a null pointer
 *
 * API (no DOM):  UBMachine.parse(text) -> { ops, error }     UBMachine.run(ops) -> result
 *                UBMachine.describe(result, k) -> readout text after step k
 *                UBMachine.summary(result, k) -> KPI / banner strings after step k
 *                UBMachine.PRESETS, UBMachine.preset(id), UBMachine.KINDS, UBMachine.alignGuarantee(align, off)
 * Checked by tools/rust_verify/19_ubmachine.js (hand-derived table, an independent byte-level model,
 * and every script the machine calls defined compiled and run as real Rust).
 */
(function (root) {
  'use strict';
  var TY = { u8: { size: 1, align: 1 }, u32: { size: 4, align: 4 }, bool: { size: 1, align: 1 }, char: { size: 4, align: 4 } };
  var LIM = { ops: 30, allocs: 6, size: 16, add: 64 };
  var RESERVED = ('alloc dealloc local end null let fn if else loop while for in match mut ref type self super crate move return ' +
    'true false as use mod pub impl trait struct enum const static unsafe extern where dyn async await box gen try macro yield ' +
    'do final override priv typeof unsized virtual abstract become break continue std layout read write add cast').split(' ');

  /* What each violation is, which rule it breaks, and the check that would have discharged it. */
  var KINDS = {
    zero:   { title: 'zero-size allocation', rule: "alloc's stated condition: the layout's size must not be zero",
              need: 'ask for at least one byte', safe: 'Vec::new() allocates nothing at all' },
    null:   { title: 'null pointer dereference', rule: 'Reference UB list: a load or store through a dangling pointer (null points into no allocation)',
              need: 'prove the pointer is not null', safe: 'Option<&T>: the type carries that proof (Lesson 09)' },
    uaf:    { title: 'use after free', rule: 'Reference UB list: a load or store through a dangling pointer (its allocation is no longer live)',
              need: 'keep the block alive until the last use', safe: 'one owner plus the borrow checker (Lessons 03–07)' },
    scope:  { title: 'use after scope', rule: 'Reference UB list: a load or store through a dangling pointer (the local it named has ended)',
              need: 'use the pointer only inside the local’s scope', safe: 'a reference cannot outlive its referent (E0597, Lesson 06)' },
    oob:    { title: 'out-of-bounds access', rule: 'Reference UB list: a load or store through a dangling pointer (not all of its bytes lie inside the allocation)',
              need: 'prove offset + size ≤ the block’s size', safe: 'a slice carries its length and checks the index (Lesson 02)' },
    arith:  { title: 'out-of-bounds pointer arithmetic', rule: "add's stated condition: the result must stay inside the allocation (its end counts)",
              need: 'prove the new offset stays in bounds', safe: 'index a slice instead of moving a raw pointer (Lesson 02)' },
    align:  { title: 'misaligned access', rule: 'Reference UB list: a load or store through a place based on a misaligned pointer',
              need: 'prove the address is a multiple of the type’s alignment', safe: 'a reference is always aligned (Lesson 02)' },
    uninit: { title: 'uninitialized read', rule: 'Reference UB list: producing an invalid value (an integer, bool or char must be initialized)',
              need: 'write every byte before reading it', safe: 'definite assignment (Lesson 02)' },
    bool:   { title: 'invalid bool', rule: 'Reference UB list: producing an invalid value (a bool must be 0 or 1)',
              need: 'prove the byte is 0 or 1', safe: 'decide what the byte means: byte != 0, or a match' },
    char:   { title: 'invalid char', rule: 'Reference UB list: producing an invalid value (a char is at most 0x10FFFF and not a surrogate)',
              need: 'prove the number is a Unicode scalar value', safe: 'char::from_u32 returns an Option' },
    double: { title: 'double free', rule: "the allocator's condition: a block is freed once (Lesson 01's double free)",
              need: 'free each block exactly once', safe: 'one owner, one drop (Lesson 03)' }
  };

  var PRESETS = [
    { id: 'overflow', label: 'push one too many (out of bounds)', text:
      'let buf = alloc(12, 4);        // room for three u32\nlet slot = buf.cast::<u32>();\nslot.write(10);\nlet s1 = slot.add(1);\ns1.write(20);\nlet s2 = slot.add(2);\ns2.write(30);\nlet s3 = slot.add(3);          // the end of the block: allowed\ns3.write(40);                  // a fourth u32 in a 12-byte block\ndealloc(buf);',
      note: 'The §1 buffer with one push too many. The add that reaches the end is allowed; the write through it is not.' },
    { id: 'push', label: 'three pushes (defined)', text:
      'let buf = alloc(12, 4);        // room for three u32\nlet slot = buf.cast::<u32>();\nslot.write(10);\nlet s1 = slot.add(1);\ns1.write(20);\nlet s2 = slot.add(2);\ns2.write(30);\ns2.read();\ndealloc(buf);',
      note: 'Every obligation met: each access inside the block, 4-aligned, written before read; the block is freed once.' },
    { id: 'uaf', label: 'use after free', text:
      'let a = alloc(4, 4);\nlet p = a.cast::<u32>();\np.write(7);\np.read();\ndealloc(a);\np.read();                      // p still holds the old address',
      note: 'A raw pointer outlives its block. The checker never saw p; nothing ends it.' },
    { id: 'double', label: 'double free', text:
      'let a = alloc(8, 8);\ndealloc(a);\ndealloc(a);                    // the same block, again',
      note: 'Two frees of one block: the bug ownership exists to rule out.' },
    { id: 'scope', label: 'use after scope', text:
      'let p = local(7);              // a u32 local; p = &raw mut it\np.read();\nend(p);                        // the local\'s scope closes\np.read();',
      note: 'Raw pointers are not tracked, so the pointer escapes the scope that E0597 would have guarded.' },
    { id: 'misalign', label: 'misaligned u32 read', text:
      'let bytes = alloc(8, 4);\nlet w = bytes.cast::<u32>();\nw.write(1);\nlet b1 = bytes.add(1);          // one BYTE in\nlet w1 = b1.cast::<u32>();\nw1.read();',
      note: 'Offset 1 of a 4-aligned block is never a multiple of 4, whatever address the allocator picked.' },
    { id: 'maybe', label: 'alignment only hoped for', text:
      'let raw = alloc(8, 1);          // asked for 1-byte alignment\nlet w = raw.cast::<u32>();\nw.write(5);',
      note: 'The allocator promised 1-byte alignment. On some allocations the write is misaligned; a proof must cover all of them.' },
    { id: 'uninit', label: 'uninitialized read', text:
      'let a = alloc(8, 4);\nlet p = a.cast::<u32>();\np.write(3);\nlet q = p.add(1);\nq.read();                      // bytes 4..8 were never written',
      note: 'alloc hands out uninitialized bytes; reading them as a u32 produces an invalid value.' },
    { id: 'bool', label: 'invalid bool', text:
      'let b = alloc(1, 1);\nb.write(2);\nlet flag = b.cast::<bool>();\nflag.read();                   // a bool must be 0 or 1',
      note: 'The byte is initialized; it is simply not a bool.' },
    { id: 'char', label: 'invalid char (surrogate)', text:
      'let c = alloc(4, 4);\nlet w = c.cast::<u32>();\nw.write(0xD800);\nlet ch = c.cast::<char>();\nch.read();',
      note: '0xD800 is a surrogate: no char has that value.' },
    { id: 'null', label: 'null dereference', text:
      'let n = null::<u32>();         // creating it is safe\nn.read();                      // using it is not',
      note: 'Creating a null raw pointer is safe; reading through it is the obligation.' },
    { id: 'arith', label: 'add past the end', text:
      'let a = alloc(8, 4);\nlet w = a.cast::<u32>();\nlet last = w.add(2);           // the end: allowed\nlet far = w.add(3);            // past the end: already UB',
      note: 'No read happens. add itself promises to stay inside the block (its end counts).' },
    { id: 'leak', label: 'a leak (not UB)', text:
      'let a = alloc(4, 4);\nlet p = a.cast::<u32>();\np.write(1);\np.read();                      // no dealloc: the block leaks',
      note: 'Leaking is not undefined behavior; the Reference lists it among the behaviors not considered unsafe.' }
  ];

  function lowbit(n) { return n & -n; }
  // Largest power of two the address base+off is guaranteed to be a multiple of, given base % align == 0.
  function alignGuarantee(align, off) { return off === 0 ? align : Math.min(align, lowbit(off)); }

  function parseNum(s) { return /^0x/i.test(s) ? parseInt(s.slice(2), 16) : parseInt(s, 10); }
  var NUM = '(0x[0-9a-fA-F]{1,8}|[0-9]{1,10})', ID = '([a-z][a-z0-9_]{0,11})', T4 = '(u8|u32|bool|char)';
  var RX = [
    ['alloc', new RegExp('^let\\s+' + ID + '\\s*=\\s*alloc\\(\\s*' + NUM + '\\s*,\\s*' + NUM + '\\s*\\)$')],
    ['local', new RegExp('^let\\s+' + ID + '\\s*=\\s*local\\(\\s*' + NUM + '\\s*\\)$')],
    ['null', new RegExp('^let\\s+' + ID + '\\s*=\\s*null(?:::<' + T4 + '>)?\\(\\s*\\)$')],
    ['add', new RegExp('^let\\s+' + ID + '\\s*=\\s*' + ID + '\\.add\\(\\s*' + NUM + '\\s*\\)$')],
    ['cast', new RegExp('^let\\s+' + ID + '\\s*=\\s*' + ID + '\\.cast::<' + T4 + '>\\(\\s*\\)$')],
    ['copy', new RegExp('^let\\s+' + ID + '\\s*=\\s*' + ID + '$')],
    ['write', new RegExp('^' + ID + '\\.write\\(\\s*' + NUM + '\\s*\\)$')],
    ['read', new RegExp('^' + ID + '\\.read\\(\\s*\\)$')],
    ['dealloc', new RegExp('^dealloc\\(\\s*' + ID + '\\s*\\)$')],
    ['end', new RegExp('^end\\(\\s*' + ID + '\\s*\\)$')]
  ];

  /* Parse and type-check a script. Errors here are "does not compile", never UB. */
  function parse(text) {
    var ops = [], env = {}, nAlloc = 0, lines = String(text || '').split('\n');
    function fail(ln, msg) { return { ops: ops, error: 'line ' + ln + ': ' + msg }; }
    for (var i = 0; i < lines.length; i++) {
      var src = lines[i].replace(/\/\/.*$/, '').trim().replace(/;\s*$/, '').trim();
      if (!src) continue;
      var kind = null, m = null;
      for (var r = 0; r < RX.length && !m; r++) { m = RX[r][1].exec(src); if (m) kind = RX[r][0]; }
      var ln = i + 1;
      if (!m) return fail(ln, 'not understood: "' + src + '"');
      if (ops.length >= LIM.ops) return fail(ln, 'at most ' + LIM.ops + ' steps');
      var op = { kind: kind, line: ln, src: lines[i].replace(/\/\/.*$/, '').trim() };
      var bind = (kind === 'alloc' || kind === 'local' || kind === 'null' || kind === 'add' || kind === 'cast' || kind === 'copy');
      if (bind && RESERVED.indexOf(m[1]) >= 0) return fail(ln, '"' + m[1] + '" is a reserved name');
      function use(name) { return env[name] || null; }
      if (kind === 'alloc') {
        op.name = m[1]; op.size = parseNum(m[2]); op.align = parseNum(m[3]);
        if ([1, 2, 4, 8, 16].indexOf(op.align) < 0) return fail(ln, 'align must be 1, 2, 4, 8 or 16');
        if (op.size > LIM.size) return fail(ln, 'this machine draws blocks of at most ' + LIM.size + ' bytes');
        if (++nAlloc > LIM.allocs) return fail(ln, 'at most ' + LIM.allocs + ' blocks');
        env[op.name] = { ty: 'u8', origin: 'alloc', at: ops.length };
      } else if (kind === 'local') {
        op.name = m[1]; op.val = parseNum(m[2]);
        if (op.val > 0xFFFFFFFF) return fail(ln, 'the value does not fit a u32');
        if (++nAlloc > LIM.allocs) return fail(ln, 'at most ' + LIM.allocs + ' blocks');
        env[op.name] = { ty: 'u32', origin: 'local', at: ops.length, ended: false };
      } else if (kind === 'null') {
        op.name = m[1]; op.ty = m[2] || 'u8';
        env[op.name] = { ty: op.ty, origin: 'null' };
      } else if (kind === 'add' || kind === 'cast' || kind === 'copy') {
        op.name = m[1]; op.from = m[2];
        var s = use(op.from);
        if (!s) return fail(ln, '"' + op.from + '" is not defined');
        if (kind === 'add') { op.n = parseNum(m[3]); if (op.n > LIM.add) return fail(ln, 'add at most ' + LIM.add); }
        op.ty = kind === 'cast' ? m[3] : s.ty;
        env[op.name] = { ty: op.ty, origin: 'derived' };
      } else if (kind === 'write') {
        op.ptr = m[1]; op.val = parseNum(m[2]);
        var w = use(op.ptr);
        if (!w) return fail(ln, '"' + op.ptr + '" is not defined');
        if (w.ty !== 'u8' && w.ty !== 'u32') return fail(ln, 'write through a *mut u8 or *mut u32 (cast first)');
        if (op.val > (w.ty === 'u8' ? 255 : 0xFFFFFFFF)) return fail(ln, 'the value does not fit a ' + w.ty);
        op.ty = w.ty;
      } else if (kind === 'read') {
        op.ptr = m[1];
        var rd = use(op.ptr);
        if (!rd) return fail(ln, '"' + op.ptr + '" is not defined');
        op.ty = rd.ty;
      } else if (kind === 'dealloc') {
        op.ptr = m[1];
        var d = use(op.ptr);
        if (!d) return fail(ln, '"' + op.ptr + '" is not defined');
        if (d.origin !== 'alloc') return fail(ln, 'dealloc takes the name that alloc returned');
        op.at = d.at;
      } else if (kind === 'end') {
        op.ptr = m[1];
        var e = use(op.ptr);
        if (!e || e.origin !== 'local') return fail(ln, 'end takes the name that local returned');
        if (e.ended) return fail(ln, 'that scope has already ended');
        e.ended = true; op.at = e.at;
      }
      ops.push(op);
    }
    if (!ops.length) return { ops: ops, error: 'the script is empty' };
    return { ops: ops, error: null };
  }

  function snap(allocs, ptrs, order) {
    return {
      allocs: allocs.map(function (a) { return { id: a.id, kind: a.kind, name: a.name, size: a.size, align: a.align, status: a.status, gone: a.gone, init: a.init.slice(), bytes: a.bytes.slice() }; }),
      ptrs: order.map(function (n) { var p = ptrs[n]; return { name: n, alloc: p.alloc, off: p.off, ty: p.ty }; })
    };
  }

  /* Run a parsed script. result.steps[i] is the state after step i+1; result.ub is null or the verdict. */
  function run(ops) {
    var allocs = [], ptrs = {}, order = [], out = [], steps = [], ub = null, byOp = {};
    function bindPtr(name, p) { if (!(name in ptrs)) order.push(name); ptrs[name] = p; }
    function A(id) { return id === null ? null : allocs[id]; }
    function stop(i, kind, detail, extra) { ub = { step: i + 1, kind: kind, detail: detail }; if (extra) for (var k in extra) ub[k] = extra[k]; }
    function access(i, p, ty) {   // the obligations of one load or store, in a fixed order
      var t = TY[ty], a = A(p.alloc), where = { alloc: p.alloc, from: p.off, to: p.off + t.size };
      if (a === null) return stop(i, 'null', 'the pointer is null; a ' + ty + ' needs ' + t.size + ' byte' + (t.size > 1 ? 's' : '') + ' of a live block', where);
      if (a.status === 'freed') return stop(i, 'uaf', 'block ' + a.id + ' was freed at step ' + a.gone, where);
      if (a.status === 'dead') return stop(i, 'scope', 'local ' + a.id + ' ended at step ' + a.gone, where);
      if (p.off + t.size > a.size) return stop(i, 'oob', 'bytes ' + p.off + '..' + (p.off + t.size) + ' of a ' + a.size + '-byte block', where);
      var g = alignGuarantee(a.align, p.off);
      if (g < t.align) {
        var certain = (p.off % Math.min(a.align, t.align)) !== 0;
        where.certain = certain;
        return stop(i, 'align', 'the address is base + ' + p.off + ', base ' + (certain ? 'a multiple of ' + a.align + ', so never a multiple of ' + t.align :
          'only promised to be a multiple of ' + a.align + ', so a multiple of ' + t.align + ' on some allocations and not on others') + '; a ' + ty + ' needs ' + t.align, where);
      }
      return where;
    }
    for (var i = 0; i < ops.length && !ub; i++) {
      var op = ops[i], note = '', touched = null;
      if (op.kind === 'alloc') {
        if (op.size === 0) { stop(i, 'zero', 'alloc(0, ' + op.align + ')'); }
        else {
          var id = allocs.length;
          allocs.push({ id: String.fromCharCode(65 + id), kind: 'heap', name: op.name, size: op.size, align: op.align, status: 'live', gone: 0,
                        init: new Array(op.size).fill(false), bytes: new Array(op.size).fill(0) });
          byOp[i] = id; bindPtr(op.name, { alloc: id, off: 0, ty: 'u8' });
          note = 'block ' + allocs[id].id + ': ' + op.size + ' byte' + (op.size > 1 ? 's' : '') + ', ' + op.align + '-aligned, uninitialized';
        }
      } else if (op.kind === 'local') {
        var lid = allocs.length, v = op.val >>> 0;
        allocs.push({ id: String.fromCharCode(65 + lid), kind: 'stack', name: op.name, size: 4, align: 4, status: 'live', gone: 0,
                      init: [true, true, true, true], bytes: [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255] });
        byOp[i] = lid; bindPtr(op.name, { alloc: lid, off: 0, ty: 'u32' });
        note = 'local ' + allocs[lid].id + ' = ' + v + ' on the stack; ' + op.name + ' points to it';
      } else if (op.kind === 'null') {
        bindPtr(op.name, { alloc: null, off: 0, ty: op.ty }); note = op.name + ' is null (creating it is safe)';
      } else if (op.kind === 'copy' || op.kind === 'cast') {
        var s = ptrs[op.from]; bindPtr(op.name, { alloc: s.alloc, off: s.off, ty: op.kind === 'cast' ? op.ty : s.ty });
        note = op.kind === 'cast' ? 'same address, element type ' + op.ty + ' (cast is safe)' : 'a second name for the same address';
      } else if (op.kind === 'add') {
        var src = ptrs[op.from], bytes = op.n * TY[src.ty].size, a0 = A(src.alloc);
        if (bytes === 0) { bindPtr(op.name, { alloc: src.alloc, off: src.off, ty: src.ty }); note = 'add(0): the same address'; }
        else if (a0 === null) stop(i, 'arith', 'a null pointer points into no block, so no nonzero offset stays inside one', { alloc: null });
        else if (a0.status !== 'live') stop(i, 'arith', 'block ' + a0.id + ' is ' + (a0.status === 'freed' ? 'freed' : 'out of scope') + ': there is no allocation to stay inside', { alloc: src.alloc });
        else if (src.off + bytes > a0.size) stop(i, 'arith', 'offset ' + src.off + ' + ' + op.n + ' × ' + TY[src.ty].size + ' = ' + (src.off + bytes) + ', past the end (' + a0.size + ') of block ' + a0.id, { alloc: src.alloc, from: a0.size, to: src.off + bytes });
        else { bindPtr(op.name, { alloc: src.alloc, off: src.off + bytes, ty: src.ty }); note = '+' + op.n + ' ' + src.ty + ' = +' + bytes + ' byte' + (bytes > 1 ? 's' : '') + ': ' + a0.id + '+' + (src.off + bytes) + (src.off + bytes === a0.size ? ' (the end)' : ''); }
      } else if (op.kind === 'write' || op.kind === 'read') {
        var p = ptrs[op.ptr], t = TY[p.ty], w = access(i, p, p.ty);
        if (!ub) {
          var blk = A(p.alloc); touched = w;
          if (op.kind === 'write') {
            var x = op.val >>> 0;
            for (var b = 0; b < t.size; b++) { blk.bytes[p.off + b] = (x >>> (8 * b)) & 255; blk.init[p.off + b] = true; }
            note = 'wrote ' + op.val + ' to ' + blk.id + '+' + p.off + '..' + (p.off + t.size);
          } else {
            var val = 0, allInit = true;
            for (var c = 0; c < t.size; c++) { if (!blk.init[p.off + c]) allInit = false; val += blk.bytes[p.off + c] * Math.pow(256, c); }
            if (!allInit) stop(i, 'uninit', 'bytes ' + p.off + '..' + (p.off + t.size) + ' of block ' + blk.id + ' are not all written', w);
            else if (p.ty === 'bool' && val > 1) stop(i, 'bool', 'the byte holds ' + val, w);
            else if (p.ty === 'char' && (val > 0x10FFFF || (val >= 0xD800 && val <= 0xDFFF))) stop(i, 'char', 'the four bytes hold 0x' + val.toString(16).toUpperCase(), w);
            else {
              var shown = p.ty === 'bool' ? (val ? 'true' : 'false') : p.ty === 'char' ? 'U+' + ('000' + val.toString(16).toUpperCase()).slice(-Math.max(4, val.toString(16).length)) : String(val);
              out.push(shown); note = 'read ' + p.ty + ' ' + shown;
            }
          }
        }
      } else if (op.kind === 'dealloc') {
        var da = allocs[byOp[op.at]];
        if (da.status === 'freed') stop(i, 'double', 'block ' + da.id + ' was already freed at step ' + da.gone, { alloc: byOp[op.at] });
        else { da.status = 'freed'; da.gone = i + 1; note = 'block ' + da.id + ' freed'; }
      } else if (op.kind === 'end') {
        var la = allocs[byOp[op.at]]; la.status = 'dead'; la.gone = i + 1; note = 'local ' + la.id + ' is gone; ' + op.ptr + ' still holds its address';
      }
      if (ub) { ub.op = op; steps.push({ op: op, ub: true, note: '', touched: ub, outN: out.length, state: snap(allocs, ptrs, order) }); }
      else steps.push({ op: op, ub: false, note: note, touched: touched, outN: out.length, state: snap(allocs, ptrs, order) });
    }
    var leaks = ub ? [] : allocs.filter(function (a) { return a.kind === 'heap' && a.status === 'live'; }).map(function (a) { return a.id; });
    return { ops: ops, steps: steps, ub: ub, out: out, leaks: leaks };
  }

  /* The readout after k steps (k = 0 .. ops.length). */
  function describe(res, k) {
    var n = res.ops.length, lines = [], shown = Math.min(k, res.steps.length);
    for (var i = 0; i < shown; i++) {
      var s = res.steps[i];
      lines.push((i + 1 < 10 ? ' ' : '') + (i + 1) + '  ' + s.op.src + (s.ub ? '   ✗' : '   ✓ ' + s.note));
    }
    var v = res.ub, tail;
    if (v && k >= v.step) {
      var K = KINDS[v.kind];
      tail = 'UB at step ' + v.step + ': ' + K.title + ' — ' + v.detail + '.\nRule broken — ' + K.rule + '.\nThe obligation the unsafe code took on: ' + K.need +
        '. In safe Rust: ' + K.safe + '.' + (v.step < n ? '\n' + (v.step + 1 < n ? 'Steps ' + (v.step + 1) + '–' + n + ' never happen' : 'Step ' + n + ' never happens') + ': after UB the program has no meaning.' : '');
    } else if (k < n) tail = 'Defined so far (' + k + ' of ' + n + ' steps).';
    else tail = 'Defined: every obligation met.' + (res.out.length ? ' Printed: ' + res.out.join(', ') + '.' : '') +
      (res.leaks.length ? ' Leaked: block ' + res.leaks.join(', ') + ' — not UB (the Reference lists leaks as not unsafe).' : '');
    return (lines.length ? lines.join('\n') + '\n\n' : '') + tail;
  }

  function preset(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return PRESETS[0]; }

  /* The widget's KPI and banner strings after k steps (no DOM). */
  function summary(res, k) {
    var n = res.ops.length, m = Math.min(k, res.steps.length), s = m ? res.steps[m - 1] : null, v = res.ub, ub = !!(v && k >= v.step);
    var live = s ? s.state.allocs.filter(function (a) { return a.status === 'live'; }) : [];
    return {
      s: s, ub: ub, step: k + ' / ' + n,
      live: live.length + ' · ' + live.reduce(function (z, a) { return z + a.size; }, 0) + ' B',
      printed: (s ? res.out.slice(0, s.outN) : []).join(', ') || '—',
      verdict: ub ? 'UB · ' + KINDS[v.kind].title : (k < n ? 'defined so far' : 'defined'),
      banner: ub ? '✗ UB at step ' + v.step + ': ' + KINDS[v.kind].title : k < n ? '… defined so far' :
        '✓ defined' + (res.leaks.length ? ' (block ' + res.leaks.join(', ') + ' leaked: not UB)' : ''),
      head: s ? 'after step ' + m + ':  ' + s.op.src : 'before step 1'
    };
  }

  var M = { parse: parse, run: run, describe: describe, summary: summary, preset: preset, alignGuarantee: alignGuarantee,
            KINDS: KINDS, PRESETS: PRESETS, TY: TY, LIM: LIM };
  root.UBMachine = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : this);
