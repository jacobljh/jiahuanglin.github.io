# Data-Intensive Systems — Expansion Spec (Part IV + detail-gap patches)

Extends REWRITE_SPEC.md. Same gold standard, same hard rules (NO LaTeX / no `{,}`,
plain commas; balanced HTML; cross-links resolve; jargon defined at first use; faithful to
Kleppmann's *Designing Data-Intensive Applications*, DDIA). Read REWRITE_SPEC.md and the
reference `agentic_systems/lessons/04_routing.html` first.

The track grows from 17 → 26 lessons. Existing lessons 00–16 keep their numbers; the new
Part IV files are 17–25. **step-pill numbering stays N+1 but the denominator becomes / 26.**
(A central pass updates 00–16 from `/ 17` to `/ 26`; new files author their pill directly.)

## New Part IV · Applied lessons (files + pills + kicker "Part IV · Applied")
| File | Title | step-pill |
|---|---|---|
| 17_production_systems_atlas.html | Production Systems Atlas: where real databases sit in the design space | lesson 18 / 26 |
| 18_failure_timelines_and_drills.html | Failure Timelines and Quantitative Drills | lesson 19 / 26 |
| 19_case_twitter_timeline.html | Interview Case: Twitter / social timeline | lesson 20 / 26 |
| 20_case_global_profile_store.html | Interview Case: Global profile store | lesson 21 / 26 |
| 21_case_feature_store.html | Interview Case: ML feature store | lesson 22 / 26 |
| 22_case_search_index_no_dual_write.html | Interview Case: Search index from Postgres without dual writes | lesson 23 / 26 |
| 23_case_model_registry.html | Interview Case: Model registry | lesson 24 / 26 |
| 24_case_metrics_dashboard.html | Interview Case: Metrics / observability dashboard | lesson 25 / 26 |
| 25_current_ddia_2nd_edition.html | Current DDIA: what the 2nd edition adds (and the ethics chapter) | lesson 26 / 26 |

Footer nav chain: 16 next → 17; 17 prev←16 next→18; … 24 prev←23 next→25; 25 prev←24
next → index.html (last lesson). (A central pass fixes lesson 16's footer "next" which
currently points at index.html.)

## Lesson 17 — Production Systems Atlas
Reference lesson: place each real system at its coordinates in the design space the track
already taught (storage engine, replication model, partitioning, consistency, txn model,
read/write profile). Cover, with a comparison table per family and 1–2 sentences of "what
it optimizes / what it gives up", cross-linking the home lesson for each axis:
- Relational OLTP: **PostgreSQL vs MySQL** (B-tree/heap storage L05; single-leader repl L07;
  serializable/SSI vs default isolation L10).
- Wide-column / Dynamo lineage: **Cassandra / DynamoDB / Riak** (LSM L06; leaderless quorum
  L08; hash partitioning L09; tunable consistency).
- Bigtable lineage: **Bigtable / HBase** (LSM SSTable L06; range partitioning L09;
  single-row atomicity).
- Log / streaming: **Kafka vs Pulsar** (partitioned log L15; replication; ordering; Pulsar's
  segment/broker split). **Kinesis** brief.
- In-memory: **Redis** (data structures; persistence AOF/RDB = WAL L05; single-thread; cluster
  hash slots L09; replication L07).
- Search: **Elasticsearch / OpenSearch** (inverted index, Lucene segments ≈ LSM L06; primary–
  replica shards L07/L09; near-real-time; not a system of record).
- Batch/stream compute: **Spark vs Flink** (L14/L15; micro-batch vs true streaming;
  checkpointing).
Include a single master comparison table (system × {storage, replication, partitioning,
consistency, best-fit workload}). End with the "pick by the access pattern + the invariant"
rule. A widget is optional (skip — a table teaches this best).

## Lesson 18 — Failure Timelines and Quantitative Drills
Two halves.
(A) **Failure timelines** — each as an ASCII time-ordered diagram (t0…tN, actors as rows),
the root cause, the user-visible symptom, and the fix, cross-linking the home lesson:
  1. Failover with lost writes (async repl, leader dies before replicating — L07).
  2. Stale reads after leader change / read-your-writes break (L07/L12).
  3. CDC consumer crash + offset replay / backlog (L15).
  4. Rebalance storm (adding nodes triggers mass movement; hash-mod-N — L09).
  5. Cache stampede / thundering herd (key expiry → all miss → DB overload) + fixes
     (request coalescing, jittered TTL, stale-while-revalidate).
  6. Dual-write divergence (write DB + cache/index separately, one fails — L16) → log-driven fix.
(B) **Quantitative drills** — each a named formula + a worked number the reader can redo:
QPS & p99 latency budget (Little's Law: concurrency = throughput × latency); fan-out
amplification (tail, from L01); partition count sizing (target GB or QPS per partition);
storage growth (rows/day × size × replication × retention); compaction bandwidth (write rate
× write-amp, from L06); replication lag (write rate vs follower apply rate); CDC backlog &
catch-up time (backlog / (consume−produce)); reprocessing/replay time (log size / throughput).
Give each drill a one-line formula and a concrete plug-in. This lesson is a "lab" — heavy on
numbers and ASCII, no widget needed.

## Lessons 19–24 — Interview Cases (shared template)
Each is a full senior-interview walkthrough. Required sections (numbered):
1. **The prompt** (one paragraph) + **functional/non-functional requirements** and the
   clarifying questions a strong candidate asks first.
2. **Back-of-envelope sizing** (a quantitative drill: users, QPS read/write, fan-out,
   storage, p99 budget — real numbers).
3. **Design walk** — build it from the track's mechanisms, cross-linking each (storage L05/06,
   replication L07/08, partitioning L09, txn L10, consistency L12, log/CDC L15, derived L16).
   ≥1 ASCII architecture diagram.
4. **Failure timeline** — one concrete failure for this system and its mitigation.
5. **Answer rubric** — a `lesson-grid` (or table) with FOUR explicit buckets:
   **Good answer** (baseline), **Better answer** (senior signal), **Red flags**
   (what sinks a candidate), **Likely follow-ups** (the interviewer's next probes).
6. **Takeaway** + a couple of **Interview prompts** with answers.
Case specifics:
- **19 Twitter/social timeline**: fan-out-on-write vs on-read, the celebrity hot-key problem
  (L09), home-timeline cache, push/pull hybrid; sizing on follower fan-out.
- **20 Global profile store**: multi-region, read-your-writes (L07/L12), low-latency local
  reads, conflict handling for concurrent edits (L08); CAP/PACELC trade.
- **21 ML feature store**: online (low-latency point lookup) vs offline (batch training-set
  build) consistency, point-in-time correctness / no label leakage (L14/L15), train–serve
  skew (L04), CDC freshness.
- **22 Search index from Postgres without dual writes**: the dual-write trap (L16), CDC/
  outbox/logical-decoding → stream → indexer (L15), idempotent upserts, reindex/backfill,
  eventual-consistency lag budget. This is the flagship "don't dual-write" case.
- **23 Model registry**: system of record for model artifacts + metadata, immutability/
  versioning, atomic "promote to prod" (linearizable pointer — L12/L13), audit/lineage, rollback.
- **24 Metrics/observability dashboard**: high-cardinality time-series ingest, columnar/rollup
  storage (L06), downsampling, hot recent vs cold historical, approximate aggregates,
  write-heavy fan-in; query p99.

## Lesson 25 — Current DDIA (2nd edition)
Frame: the 1st-edition arc (this track) still holds; the 2nd edition (O'Reilly, Feb 2026,
~672 pp) adds/expands topics. Cover each briefly with "what it is, why it matters now, where
it extends our track", cross-linking:
cloud/serverless data architecture (separation of storage & compute); GraphQL (vs REST,
over-/under-fetching — extends L03/L04); event sourcing & CQRS (extends L15/L16); vector
embeddings & vector search (ANN indexes; extends L02/L06/L16 — ML/RAG tie); durable execution
(workflow engines, Temporal-style — extends L13/L16); local-first / offline sync (CRDTs,
extends L08); multitenancy & sharding for SaaS (extends L09); formal methods & testing
(TLA+, deterministic simulation, property/fault-injection testing — extends L11/L13);
and a dedicated **ethics** chapter (privacy, surveillance/tracking, bias & accountability,
data as power — extends L16's correctness-and-ethics section). Make clear this is a signpost
to "current DDIA," not a reproduction. No widget.

## Detail-gap patches to EXISTING lessons (surgical depth, do NOT bloat; keep structure)
Add the missing DDIA detail to its home lesson, plus — where it fits naturally — a compact
**Production systems** comparison note and/or a **quantitative drill**. Do NOT touch step-pills
(a central pass renumbers). Keep edits surgical; net growth modest.
- **02 data_models**: add the data-model/query **history** — hierarchical/network (CODASYL)
  model, why relational won, and the graph-query languages (**Cypher, SPARQL, Datalog**) with a
  tiny Datalog example and how recursive/many-to-many queries motivate them.
- **03 query_languages**: connect declarative querying to **Datalog** (rules) as a third point
  beyond SQL and MapReduce; note the genealogy (Datalog → modern graph queries).
- **04 encoding**: deepen **message-passing dataflow** (REST vs RPC, the actor model, message
  brokers) and **rolling upgrades** (staged deploy, why both backward+forward compat needed at
  once); keep Avro writer/reader-schema + schema registry crisp.
- **06 storage II**: add **analytics schemas** — star & snowflake schema, fact vs dimension
  tables, **data cubes / materialized aggregates**, and warehouse-vs-OLTP modeling — as the
  natural companion to columnar storage. Mention Parquet/ORC, Redshift/BigQuery, Bigtable/HBase.
- **11 distributed trouble**: add **clock-synchronization accuracy** (NTP vs PTP vs Google
  **TrueTime**/Spanner uncertainty interval) and **formal system models** (synchronous /
  partial-synchronous / asynchronous timing models; crash-stop / crash-recovery / **Byzantine**
  fault models and the 3f+1 boundary).
- **12 consistency**: deepen **sequence-number ordering and logical clocks** — Lamport
  timestamps (total order consistent with causality, with tie-break), version vectors
  (causal/partial order), and why a single leader assigning sequence numbers gives a cheap
  total order; lead into total-order broadcast.
- **13 consensus**: deepen **2PC** (coordinator log, in-doubt participants, why it blocks; a
  word on 3PC) and the **total-order-broadcast ⇄ consensus** equivalence (each implementable
  from the other), with sequence numbers as the bridge from L12.
- **14 batch**: deepen **reduce-side / sort-merge joins** (the shuffle, secondary sort, skew/
  hot-key handling) vs map-side joins; add **HDFS / distributed filesystem** (blocks,
  replication, data locality, "bring compute to data"); and **iterative graph processing**
  (Pregel / bulk-synchronous-parallel, why MapReduce is poor at iteration).
- **15 stream**: add explicit **stream joins** — stream-stream (windowed join, both sides
  buffered by time), stream-table (enrichment via a changelog-maintained table), table-table
  (materialized-view join) — and why time/window choice makes stream joins subtle.
- **16 derived data**: expand the **ethics/correctness** close — **timeliness vs integrity**
  (integrity = no corruption/loss, usually non-negotiable; timeliness = freshness, often
  relaxable), **privacy, tracking/surveillance, bias & accountability**, data as power, and the
  engineer's responsibility. Tie to the new lesson 25 ethics signpost.
