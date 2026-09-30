/* costs.js — the cost ledger of Lesson 22 (Rust from the Contract Up).
 * UMD, no DOM: the lesson's inline script draws; tools/rust_verify/22_costs.js tests this file in Node.
 *
 * MEASURED: medians in ns published in tools/rust_verify/22_bench.json by tools/rust_verify/22_bench.rs
 * (rustc 1.98.1, --edition 2024 -C opt-level=3, Apple M5, macOS 26.5.2, 2026-09-30; each value is the
 * median of three invocations, each the median of 31 timed runs; uncontended, one thread, one machine).
 * ledger(rps, counts) prices a workload: requests per second x operations per request x ns per operation,
 * as nanoseconds per second, which is also the share of one core (1e9 ns of work per second = 100%).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Costs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var M = {
    sum_iter: 0.0578, sum_index: 0.0588, gather_checked: 0.2579, gather_unchecked: 0.1402,
    vec_push: 1.8337, box_new_drop: 13.7307, rc_clone_drop: 0.9121, arc_clone_drop: 3.3306,
    plain_update: 0.0634, refcell_update: 0.2543, mutex_lock_unlock: 4.1135, atomic_fetch_add: 1.688,
    channel_send_recv: 8.574, generic_call: 0.303, dyn_call: 0.7202, qc_chain: 0.5381
  };
  // One row per class of operation; ns = what one more operation of this class adds.
  var CLASSES = [
    { id: 'bounds', group: 'check', name: 'checked index', ns: M.gather_checked - M.gather_unchecked, lesson: '02',
      advice: 'bounds checks lead: iterate instead of indexing, slice once before the loop, or assert the range (Lesson 14); get_unchecked in an audited unsafe block is the last resort (Lessons 19–20)' },
    { id: 'refcell', group: 'check', name: 'RefCell borrow', ns: M.refcell_update - M.plain_update, lesson: '15',
      advice: 'RefCell flags lead: restructure so the borrow is proven at compile time and &mut does the job (Lesson 15)' },
    { id: 'rc', group: 'design', name: 'Rc clone + drop', ns: M.rc_clone_drop, lesson: '15',
      advice: 'reference counts lead: lend with & instead of cloning a handle (Lesson 15)' },
    { id: 'arc', group: 'design', name: 'Arc clone + drop', ns: M.arc_clone_drop, lesson: '15',
      advice: 'atomic reference counts lead: lend with & inside thread::scope instead of cloning an Arc per task (Lesson 17)' },
    { id: 'mutex', group: 'design', name: 'Mutex lock + unlock', ns: M.mutex_lock_unlock, lesson: '17',
      advice: 'locking leads: lock less often, batch the work, or give each thread its own slot and merge once (Lesson 17)' },
    { id: 'atomic', group: 'design', name: 'atomic fetch_add', ns: M.atomic_fetch_add, lesson: '17',
      advice: 'atomic updates lead: count per thread and add once at the end (Lesson 17)' },
    { id: 'channel', group: 'design', name: 'channel send + recv', ns: M.channel_send_recv, lesson: '17',
      advice: 'channel traffic leads: send batches instead of single items (Lesson 17)' },
    { id: 'dyn', group: 'design', name: 'dyn call (vs generic)', ns: M.dyn_call - M.generic_call, lesson: '13',
      advice: 'dynamic dispatch leads: a generic or an enum makes the call direct (Lessons 12, 13)' },
    { id: 'box', group: 'design', name: 'Box::new + drop', ns: M.box_new_drop, lesson: '03',
      advice: 'allocation leads: reuse buffers, or keep values inline instead of boxing each one (Lessons 03, 13)' },
    { id: 'push', group: 'design', name: 'Vec::push', ns: M.vec_push, lesson: '03',
      advice: 'Vec growth leads: Vec::with_capacity reserves the buffer once (Lesson 03)' }
  ];
  var FREE = [['borrow check', '05–07'], ['lifetimes', '06, 08'], ['Send / Sync bounds', '16'], ['exhaustive match', '09']];
  var RPS_STEPS = [100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000];
  var COUNT_STEPS = [0, 1, 2, 3, 4, 6, 8, 12, 16, 32, 64, 100, 1000, 10000, 100000, 1000000];
  var PRESETS = [
    { id: 'service', name: '§1’s service', rps: 10000,
      counts: { mutex: 2, channel: 2, dyn: 1, box: 2, push: 1 } },
    { id: 'kernel', name: 'table lookups', rps: 1000, counts: { bounds: 1000000 } },
    { id: 'fanout', name: 'Arc fan-out', rps: 100000, counts: { arc: 16, mutex: 1, atomic: 1 } }
  ];

  function ledger(rps, counts) {
    var rows = CLASSES.map(function (c) {
      var n = counts[c.id] || 0, nsps = rps * n * c.ns;
      return { id: c.id, name: c.name, group: c.group, lesson: c.lesson, count: n, nsPerOp: c.ns, nsPerSec: nsps, pctCore: nsps / 1e7 };
    });
    var check = 0, design = 0, perReq = 0, top = null;
    rows.forEach(function (r) {
      if (r.group === 'check') check += r.pctCore; else design += r.pctCore;
      perReq += r.count * r.nsPerOp;
      if (r.nsPerSec > 0 && (!top || r.nsPerSec > top.nsPerSec)) top = r;
    });
    var total = check + design;
    return { rps: rps, rows: rows, checkPct: check, designPct: design, totalPct: total, perRequestNs: perReq,
             nsPerSec: total * 1e7, top: top, topShare: top ? top.pctCore / total : 0 };
  }
  function fmtPct(p) {
    if (p === 0) return '0%';
    if (p < 0.0001) return '< 0.0001%';
    if (p >= 100) return Math.round(p) + '%';
    return String(+p.toPrecision(2)) + '%';
  }
  function fmtNs(ns) { return ns >= 10 ? ns.toFixed(1) + ' ns' : ns.toFixed(2) + ' ns'; }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function verdict(L) {
    if (!L.top) return 'Nothing in this mix is paid at run time: every check it needs was done by the compiler.';
    var cls = CLASSES.filter(function (c) { return c.id === L.top.id; })[0];
    var s = 'At ' + fmtInt(L.rps) + ' requests/s: checks that keep the promise ' + fmtPct(L.checkPct) +
      ' of one core, prices of the design ' + fmtPct(L.designPct) + '; largest line ' + L.top.name + ' (' +
      Math.round(100 * L.topShare) + '% of the bill).';
    if (L.totalPct >= 100) s += ' More than one core: these operations alone need ' + Math.ceil(L.totalPct / 100) + ' cores.';
    else if (L.totalPct < 1) s += ' The whole run-time bill is under 1% of one core.';
    return s + ' Here ' + cls.advice + '.';
  }
  return { MEASURED: M, CLASSES: CLASSES, FREE: FREE, RPS_STEPS: RPS_STEPS, COUNT_STEPS: COUNT_STEPS,
           PRESETS: PRESETS, ledger: ledger, verdict: verdict, fmtPct: fmtPct, fmtNs: fmtNs, fmtInt: fmtInt };
}));
