# Data-Intensive Systems — Full Re-Sequence to the Linear Spine (35 lessons, 00–34)

The track is reordered into the 11-step spine + an applied part. step-pill = N+1 of 35.
Inline cross-references in prose (e.g. "lesson 09", "L05", "(lessons 07–08)") and hrefs
must use the NEW numbers/filenames below. Hrefs are remapped centrally; prose numbers are
fixed by the content-wave agents using this table.

## Old filename → New filename (and new pill)
| New # | New file | Title | Part | From |
|---|---|---|---|---|
| 00 | 00_orientation.html | Orientation: the spine and "Where is truth?" | (Orientation) | old 00 (rewrite) |
| 01 | 01_data_models.html | Data Models: Relational, Document, and Graph | 1 · A single truthful copy | old 02 |
| 02 | 02_query_languages_access_patterns.html | Query Languages and Access-Pattern Design | 1 · A single truthful copy | old 03 |
| 03 | 03_storage_engines_logs_btrees.html | Storage Engines I: Logs, Hash Indexes, and B-Trees | 1 · A single truthful copy | old 05 |
| 04 | 04_storage_engines_lsm_columnar.html | Storage Engines II: LSM-Trees and Columnar Storage | 1 · A single truthful copy | old 06 |
| 05 | 05_encoding_schema_evolution.html | Encoding, Schemas, Compatibility, and Migrations | 2 · Meaning over time | old 04 |
| 06 | 06_reliability_scalability_slos.html | Reliability, Scalability, SLOs, and Tail Latency | 3 · Demand | old 01 |
| 07 | 07_indexes_caches_serving.html | Indexes, Caches, and Serving Under Demand | 3 · Demand | NEW |
| 08 | 08_replication_leader_lag_failover.html | Replication I: Leaders, Followers, Lag, and Failover | 4 · Redundancy | old 07 |
| 09 | 09_replication_quorums_conflicts.html | Replication II: Quorums, Leaderless, and Conflicts | 4 · Redundancy | old 08 |
| 10 | 10_local_first_offline_sync.html | Local-First and Offline Sync | 4 · Redundancy | NEW |
| 11 | 11_partitioning_rebalancing.html | Partitioning, Hot Keys, and Rebalancing | 5 · Distribution | old 09 |
| 12 | 12_multitenancy_routing_sharding_ops.html | Multitenancy, Request Routing, and Sharding Operations | 5 · Distribution | NEW |
| 13 | 13_transactions_isolation.html | Transactions and Isolation | 6 · Invariants under concurrency | old 10 |
| 14 | 14_messaging_idempotency_transaction_boundary.html | Messaging, Idempotency, and the Transaction Boundary | 6 · Invariants under concurrency | NEW |
| 15 | 15_partial_failures_clocks_fencing.html | Partial Failure, Unreliable Clocks, and Fencing | 7 · Failure | old 11 |
| 16 | 16_consistency_causality_linearizability.html | Consistency, Causality, and Linearizability | 7 · Failure | old 12 |
| 17 | 17_consensus_coordination_verification.html | Consensus, Coordination, and Verification | 7 · Failure | old 13 |
| 18 | 18_batch_processing.html | Batch Processing: Dataflow Engines, Joins, and Recompute | 8 · Derived history | old 14 |
| 19 | 19_stream_processing.html | Stream Processing: Logs, CDC, Windows, and Stream Joins | 8 · Derived history | old 15 |
| 20 | 20_derived_data_correctness.html | Derived Data: Keeping Views Correct | 9 · Derived views | old 16 |
| 21 | 21_analytics_query_execution.html | Analytics and Query-Execution Internals | 9 · Derived views | NEW |
| 22 | 22_search_vector_indexes_rag.html | Search, Vector Indexes, and RAG | 9 · Derived views | NEW |
| 23 | 23_feature_stores_ml_pipelines.html | Feature Stores and ML Data Pipelines | 9 · Derived views | NEW |
| 24 | 24_cloud_native_storage.html | Cloud-Native Storage as a Subsystem | 10 · Cloud / AI systems | NEW |
| 25 | 25_law_regulation_ethics.html | Law, Regulation, and Ethics as Architecture Input | 11 · Correctness & society | NEW |
| 26 | 26_current_ddia_2nd_edition.html | Current DDIA: What the 2nd Edition Adds | 11 · Correctness & society | old 25 |
| 27 | 27_production_systems_atlas.html | Production Systems Atlas | 12 · Applied & interviews | old 17 |
| 28 | 28_failure_timelines_and_drills.html | Failure Timelines and Quantitative Drills | 12 · Applied & interviews | old 18 |
| 29 | 29_case_social_timeline.html | Case: Social Home Timeline (the canonical NFR case) | 12 · Applied & interviews | old 19 |
| 30 | 30_case_global_profile_store.html | Case: Global Profile Store | 12 · Applied & interviews | old 20 |
| 31 | 31_case_feature_store.html | Case: ML Feature Store | 12 · Applied & interviews | old 21 |
| 32 | 32_case_search_index_no_dual_write.html | Case: Search Index Without Dual Writes | 12 · Applied & interviews | old 22 |
| 33 | 33_case_model_registry.html | Case: Model Registry | 12 · Applied & interviews | old 23 |
| 34 | 34_case_metrics_dashboard.html | Case: Metrics / Observability Dashboard | 12 · Applied & interviews | old 24 |

## Old→New number quick map (for fixing prose references)
old00→00, old01→06, old02→01, old03→02, old04→05, old05→03, old06→04, old07→08,
old08→09, old09→11, old10→13, old11→15, old12→16, old13→17, old14→18, old15→19,
old16→20, old17→27, old18→28, old19→29, old20→30, old21→31, old22→32, old23→33,
old24→34, old25→26.

## The "Where is truth?" artifact (add to EVERY lesson)
A compact `callout` near the end of each lesson, before the Takeaway:
`<div class="callout"><div class="label">Where is truth?</div>` then name, for this lesson's
mechanism: the **system of record**, the **copies / derived views**, the **freshness budget**,
the **owner**, the **deletion path**, the **reconciliation/repair path**, and the **evidence it
is correct**. Keep it concrete to the lesson's topic (e.g., for replication: SoR = leader,
copies = followers, freshness = lag budget, reconciliation = re-sync from log, evidence =
checksums/anti-entropy).
