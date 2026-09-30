// Lesson 22 cost ledger: ns per operation for the run-time mechanisms the track priced.
//
//   rustc --edition 2024 -C opt-level=3 -o /tmp/bench22 tools/rust_verify/22_bench.rs && /tmp/bench22
//
// std only.  Every item runs `ops` operations per timed run; each item is warmed up
// (WARMUP runs), then timed RUNS times, and the MEDIAN ns/op is printed.  Every input and
// result goes through std::hint::black_box so the optimizer cannot fold the work away.
// Output: one JSON object on stdout (machine, OS, rustc, flags, load, medians).
// The published numbers are the median of three independent invocations of this program
// (tools/rust_verify/22_costs.js --publish does that and writes 22_bench.json).
// One machine, one configuration, uncontended, single thread: not a law about Rust.
use std::cell::RefCell;
use std::hint::black_box;
use std::process::Command;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

const WARMUP: usize = 5;
const RUNS: usize = 31;

fn median_ns_per_op(ops: usize, mut run: impl FnMut()) -> f64 {
    for _ in 0..WARMUP { run(); }
    let mut t: Vec<f64> = (0..RUNS)
        .map(|_| { let s = Instant::now(); run(); s.elapsed().as_nanos() as f64 / ops as f64 })
        .collect();
    t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    t[RUNS / 2]
}

trait Handler { fn handle(&self, x: u64) -> u64; }
struct Scale(u64);
impl Handler for Scale {
    fn handle(&self, x: u64) -> u64 { x.wrapping_mul(self.0) ^ 0x9e37 }
}
#[inline(never)]
fn run_generic<H: Handler>(h: &H, n: u64) -> u64 {          // static dispatch: inlined
    let mut acc = 0u64;
    for i in 0..n { acc = acc.wrapping_add(h.handle(black_box(i))); }
    acc
}
#[inline(never)]
fn run_dyn(h: &dyn Handler, n: u64) -> u64 {               // dynamic dispatch: a call through the vtable
    let mut acc = 0u64;
    for i in 0..n { acc = acc.wrapping_add(h.handle(black_box(i))); }
    acc
}

fn sh(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd).args(args).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn main() {
    let load_before = sh("sysctl", &["-n", "vm.loadavg"]);
    const N: usize = 1 << 14;                                // 16,384 elements: 64 KiB of u32
    let data: Vec<u32> = (0..N as u32).map(|i| i.wrapping_mul(2654435761) >> 8).collect();
    let mut x = 88172645463325252u64;                        // xorshift: a random index order
    let idx: Vec<u32> = (0..N).map(|_| { x ^= x << 13; x ^= x >> 7; x ^= x << 17; (x % N as u64) as u32 }).collect();
    const PASSES: usize = 200;
    let mut items: Vec<(&str, f64, &str)> = Vec::new();

    // Quality control only (not a ledger item): a dependent xor-and-rotate chain, whose time
    // per step moves with the core's clock, so three invocations can be compared.
    let m = median_ns_per_op(1 << 22, || {
        let mut a = black_box(1u64);
        for i in 0..(1u64 << 22) { a = (a ^ i).rotate_left(7); }
        black_box(a);
    });
    items.push(("qc_chain", m, "one step of a dependent xor-rotate chain (quality control)"));

    // Bounds checks: the optimizer removes the ones it can prove, and keeps the rest.
    let m = median_ns_per_op(N * PASSES, || for _ in 0..PASSES {
        black_box(black_box(&data).iter().map(|&v| v as u64).sum::<u64>());
    });
    items.push(("sum_iter", m, "element of an iterator sum"));
    let m = median_ns_per_op(N * PASSES, || for _ in 0..PASSES {
        let d = black_box(&data);
        let mut s = 0u64;
        for i in 0..d.len() { s += d[i] as u64; }             // provably in bounds
        black_box(s);
    });
    items.push(("sum_index", m, "element of an indexed sum, i in 0..len"));
    let m = median_ns_per_op(N * PASSES, || for _ in 0..PASSES {
        let (d, ix) = (black_box(&data), black_box(&idx));
        let mut s = 0u64;
        for &i in ix { s += d[i as usize] as u64; }           // data-dependent index: checked
        black_box(s);
    });
    items.push(("gather_checked", m, "d[i] with i read from memory, bounds-checked"));
    let m = median_ns_per_op(N * PASSES, || for _ in 0..PASSES {
        let (d, ix) = (black_box(&data), black_box(&idx));
        let mut s = 0u64;
        for &i in ix { s += unsafe { *d.get_unchecked(i as usize) } as u64; }   // measurement only
        black_box(s);
    });
    items.push(("gather_unchecked", m, "the same with get_unchecked (no check)"));

    // Vec::push, amortized over growth from empty (includes reallocations and the final free).
    let m = median_ns_per_op(N * 20, || for _ in 0..20 {
        let mut v: Vec<u64> = Vec::new();
        for i in 0..N as u64 { v.push(black_box(i)); }
        black_box(&v);
    });
    items.push(("vec_push", m, "Vec<u64>::push, amortized from empty"));

    // Box::new + drop: one allocation and one free.
    let k = 1 << 18;
    let m = median_ns_per_op(k, || for i in 0..k as u64 { drop(black_box(Box::new(i))); });
    items.push(("box_new_drop", m, "Box::new(u64) then drop"));

    // Reference counts: Rc (plain increment) vs Arc (atomic increment), clone + drop.
    let rc = Rc::new(5u64);
    let m = median_ns_per_op(1 << 20, || for _ in 0..1 << 20 { drop(black_box(Rc::clone(black_box(&rc)))); });
    items.push(("rc_clone_drop", m, "Rc::clone then drop"));
    let arc = Arc::new(5u64);
    let m = median_ns_per_op(1 << 20, || for _ in 0..1 << 20 { drop(black_box(Arc::clone(black_box(&arc)))); });
    items.push(("arc_clone_drop", m, "Arc::clone then drop, uncontended"));

    // The law checked at run time: a RefCell borrow flag per element, against plain &mut.
    let mut vals = vec![0u64; 1024];
    let m = median_ns_per_op(1024 * 1024, || for _ in 0..1024 {
        for v in black_box(&mut vals).iter_mut() { *v += 1; }
    });
    items.push(("plain_update", m, "*v += 1 for each element, through &mut"));
    let cells: Vec<RefCell<u64>> = (0..1024).map(|_| RefCell::new(0)).collect();
    let m = median_ns_per_op(1024 * 1024, || for _ in 0..1024 {
        for c in black_box(&cells).iter() { *c.borrow_mut() += 1; }
    });
    items.push(("refcell_update", m, "*c.borrow_mut() += 1 for each RefCell element"));

    // Taking turns: an uncontended Mutex, and one atomic read-modify-write.
    let mutex = Mutex::new(0u64);
    let m = median_ns_per_op(1 << 20, || for _ in 0..1 << 20 { *black_box(&mutex).lock().unwrap() += 1; });
    items.push(("mutex_lock_unlock", m, "*m.lock().unwrap() += 1, uncontended"));
    let atomic = AtomicUsize::new(0);
    let m = median_ns_per_op(1 << 20, || for _ in 0..1 << 20 { black_box(&atomic).fetch_add(1, Ordering::SeqCst); });
    items.push(("atomic_fetch_add", m, "AtomicUsize::fetch_add(1, SeqCst), uncontended"));

    // Moving a value through a channel (the capstone's result path), one thread.
    let (tx, rx) = mpsc::channel::<u64>();
    let m = median_ns_per_op(1 << 18, || for i in 0..1 << 18 { tx.send(black_box(i)).unwrap(); black_box(rx.recv().unwrap()); });
    items.push(("channel_send_recv", m, "mpsc send then recv of a u64, one thread"));

    // Dispatch: the same small method, statically (inlined) and through &dyn.
    let s = Scale(3);
    let g = median_ns_per_op(1 << 22, || { black_box(run_generic(black_box(&s), 1 << 22)); });
    items.push(("generic_call", g, "h.handle(x) with H known: inlined"));
    let dynh: &dyn Handler = black_box(&s);
    let d = median_ns_per_op(1 << 22, || { black_box(run_dyn(black_box(dynh), 1 << 22)); });
    items.push(("dyn_call", d, "h.handle(x) through &dyn Handler"));

    let load_after = sh("sysctl", &["-n", "vm.loadavg"]);
    let body: Vec<String> = items.iter().map(|(k, v, u)| format!("    \"{k}\": {{\"ns\": {v:.4}, \"op\": \"{u}\"}}")).collect();
    println!("{{");
    println!("  \"machine\": \"{}\",", sh("sysctl", &["-n", "machdep.cpu.brand_string"]));
    println!("  \"cores\": \"{} ({} performance + {} efficiency)\",", sh("sysctl", &["-n", "hw.ncpu"]),
             sh("sysctl", &["-n", "hw.perflevel0.physicalcpu"]), sh("sysctl", &["-n", "hw.perflevel1.physicalcpu"]));
    println!("  \"os\": \"macOS {}\",", sh("sw_vers", &["-productVersion"]));
    println!("  \"rustc\": \"{}\",", sh("rustc", &["--version"]));
    println!("  \"flags\": \"--edition 2024 -C opt-level=3\",");
    println!("  \"date\": \"{}\",", sh("date", &["-u", "+%Y-%m-%d %H:%M UTC"]));
    println!("  \"method\": \"median of {RUNS} timed runs after {WARMUP} warm-up runs, black_box on inputs and results, one thread\",");
    println!("  \"loadavg_before\": \"{load_before}\",");
    println!("  \"loadavg_after\": \"{load_after}\",");
    println!("  \"items\": {{\n{}\n  }}", body.join(",\n"));
    println!("}}");
}
