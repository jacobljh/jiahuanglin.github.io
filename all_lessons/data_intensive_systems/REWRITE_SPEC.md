# Data-Intensive Systems — Lesson Rewrite Spec

Goal: rewrite each thin (~95-line) lesson in `data_intensive_systems/lessons/` into a
deep, **linearized**, mechanism-first lesson meeting the site gold standard set by
`agentic_systems/lessons/04_routing.html` and the CV/k8s/system-design tracks.

The current lessons are correct in arc but too short for linear self-study: they state
conclusions without building them, skip worked numbers, and don't define jargon at first
use. Make them teach, not summarize.

## Target reader
Knows backend/ML basics (processes, memory, a SQL query, gradient descent) but NOT the
internals of distributed data systems. So: a hash table, a B-tree at a hand-wave, and
"a server can crash" are fair game; but **every distributed-data / DB-internals term must
be defined at first use** — quorum, write amplification, linearizability, fencing token,
CDC, watermark, materialized view, vector clock, etc.

## Track angle
The data substrate beneath reliable **ML products**. Wherever a concrete example helps,
prefer ML-infra framings: feature stores, model/checkpoint registries, training-data
lakehouses, vector DBs / RAG indexes, serving caches, event logs for labels. Keep them as
*illustrations*, not the whole lesson — the mechanisms are general.

## Source grounding
Original educational synthesis **inspired by** Martin Kleppmann, *Designing Data-Intensive
Applications* (DDIA). Do NOT reproduce its prose/figures. Each lesson opens with a
`callout source-note` naming the DDIA chapter(s) it draws its arc from. Lesson→chapter map:

| File | Lesson topic | DDIA chapter |
|---|---|---|
| 00_orientation | Orientation / the design space | Preface + Part intros |
| 01_reliability_scalability_maintainability | Reliability, Scalability, Maintainability | Ch.1 |
| 02_data_models | Relational / Document / Graph | Ch.2 |
| 03_query_languages_access_patterns | Declarative vs imperative; access-pattern design | Ch.2 |
| 04_encoding_schema_evolution | Encoding, schemas, backward/forward compat | Ch.4 |
| 05_storage_engines_logs_btrees | Append log, hash index, WAL, B-tree | Ch.3 |
| 06_storage_engines_lsm_columnar | LSM/SSTable, compaction, columnar/OLAP | Ch.3 |
| 07_replication_leader_lag_failover | Leader/follower, lag, read-your-writes, failover | Ch.5 |
| 08_replication_quorums_conflicts | Multi-leader, leaderless, quorum w+r>n, conflicts | Ch.5 |
| 09_partitioning_rebalancing | Hash/range partitioning, hot keys, rebalancing | Ch.6 |
| 10_transactions_isolation | ACID, isolation levels & anomalies | Ch.7 |
| 11_partial_failures_clocks_fencing | Partial failure, unreliable clocks, fencing tokens | Ch.8 |
| 12_consistency_causality_linearizability | Consistency models, causality, linearizability | Ch.9 |
| 13_consensus_coordination | Total-order broadcast, consensus, coordination svc | Ch.9 |
| 14_batch_processing | MapReduce, joins, materialization, recompute | Ch.10 |
| 15_stream_processing | Logs, CDC, event time, windows, exactly-once | Ch.11 |
| 16_derived_data_capstone | Derived data, lambda/kappa, end-to-end correctness | Ch.12 |

If unsure of a DDIA chapter number, cite by topic name, not a wrong number. Known
mis-cite traps: replication = Ch.5 (NOT 6); partitioning = Ch.6; transactions = Ch.7;
distributed troubles/clocks = Ch.8; consistency+consensus are BOTH Ch.9; batch = Ch.10;
stream = Ch.11; future/derived-data = Ch.12.

## Required structure (per lesson, in order)
1. `<head>`: keep `<link rel="stylesheet" href="style.css">` (already extended with gold
   components). NO extra inline `<style>` is needed unless you add a widget that wants
   bespoke layout — the shared `style.css` already defines `.kicker .topic-grid .topic-card
   .lesson-grid .lesson-card .mini-flow .prompt-list .callout(.ok/.warn/.bad/.source-note)
   .ascii .widget .kpi-grid .dist-canvas .math`.
2. `<header class="topnav">` breadcrumb. Crumb shows the 2-digit file number + short title.
   **step-pill numbering is N+1 of 17**: file `00`→`lesson 1 / 17`, file `05`→`lesson 6 / 17`,
   file `16`→`lesson 17 / 17`. (The current files say `/ 16` — that is WRONG, fix it.)
   Include a `~NN min` read estimate.
3. `<p class="kicker">` — the DDIA part this belongs to: "Part I · Foundations of data
   systems" (00–06), "Part II · Distributed data" (07–13), "Part III · Derived data" (14–16).
4. `<h1>` full title.
5. `<p class="subtitle">` — a **narrative bridge** that recalls what the previous lesson
   established and states the new pressure this lesson answers. (Lesson 00 bridges from the
   neighboring tracks instead.)
6. `<div class="callout source-note">` — DDIA chapter grounding (see map).
7. `<div class="callout">` **Linear position** — `<strong>Prerequisite:</strong>` (which prior
   lessons, by capability) and `<strong>New capability:</strong>` (what you can do after).
8. `<div class="callout">` **The plan** — number the moves the lesson will make (3–6 moves).
9. Numbered body sections `<h2>1 · …</h2>`, `<h2>2 · …</h2>`, … Each builds the next.
   - Build mechanisms, don't just name them. If you say "compaction", show what it does.
   - **≥1 worked numeric example** with real numbers (latency budget, quorum arithmetic,
     replication lag, write-amp factor, partition skew, window lateness…). Show the math.
   - **≥1 ASCII diagram** (`<div class="ascii">…</div>`) of the mechanism or data flow.
   - Define every DB/distributed term at first use, inline.
   - Use `.topic-grid`/`.topic-card` for "the N options and what each costs" comparisons,
     and plain `<table>` for trade-off tables (Choice / Buys / Costs).
10. Optional **interactive widget** — include a `<canvas>` + sliders ONLY where there is a
    genuine quantitative knob the reader should feel (strongly encouraged for 01 tail
    latency, 06 read/write/space amplification, 07 replication lag vs staleness, 08 quorum
    w+r vs n, 09 partition skew/hot-key, 12 consistency-vs-latency). If there is no real
    knob, DO NOT add a fake widget — use ASCII + a worked number instead. Widget JS goes in
    a `<script>` before `</body>`; follow the pattern in `04_routing.html` (devicePixelRatio
    scaling, re-render on input). Keep it self-contained and dependency-free.
11. Two-column `<div class="lesson-grid">` with a **Failure modes** card and an
    **Implementation / decision checklist** card (`<div class="lesson-card"><h3>…</h3><ul>…`).
12. `<h2>Checkpoint exercise</h2>` — a `callout` "Try it" with a concrete design task.
13. `<h2>Where this points next</h2>` — prose hand-off naming the next lesson's pressure.
14. `<div class="callout ok">` **Takeaway** — dense one-paragraph synthesis.
15. `<h2>Interview prompts</h2>` — `<ul class="prompt-list">` of 5–7 questions, each with a
    short answer in `<em>(§N — …)</em>` pointing at the section that answers it.
16. `<footer class="lesson-nav">` prev/next (existing links are correct; keep titles synced).
17. Do NOT add the `<!-- reviewed:v1 -->` marker — the review pass adds it.

## Hard rules
- **NO LaTeX.** There is no math renderer on the site. Inside `<span class="math">` use plain
  text: write `1,000,000` and `w + r > n` and `τ`, NEVER `1{,}000{,}000` or `\frac`. Literal
  braces render literally. `.math` is just a monospace span.
- Numbers must be self-consistent and arithmetically correct in worked examples.
- Cross-links must point at real files in this folder (filenames below). Teach a concept
  once at its home lesson and link to it elsewhere; don't re-derive.
- Keep it static + accessible; the only JS allowed is a self-contained widget script.
- Length target ~180–320 lines, matching the gold standard — depth, not padding.

## Filenames in this folder (for cross-links)
00_orientation.html · 01_reliability_scalability_maintainability.html ·
02_data_models.html · 03_query_languages_access_patterns.html ·
04_encoding_schema_evolution.html · 05_storage_engines_logs_btrees.html ·
06_storage_engines_lsm_columnar.html · 07_replication_leader_lag_failover.html ·
08_replication_quorums_conflicts.html · 09_partitioning_rebalancing.html ·
10_transactions_isolation.html · 11_partial_failures_clocks_fencing.html ·
12_consistency_causality_linearizability.html · 13_consensus_coordination.html ·
14_batch_processing.html · 15_stream_processing.html · 16_derived_data_capstone.html

## Teach-once anchors (link, don't re-derive)
- The **ordered durable log / WAL** is introduced in 05; 06 (LSM), 07 (replication log),
  15 (CDC/event log), 16 reference it.
- **Replication lag & read-your-writes** home = 07; 12 builds linearizability on top.
- **Quorum w + r > n** home = 08.
- **Partitioning / shard key** home = 09; referenced by 07/08 and 14/15 shuffle.
- **Isolation anomalies** home = 10.
- **Clocks / fencing tokens** home = 11; used by 12/13.
- **Linearizability** home = 12; **consensus / total-order broadcast** home = 13.
