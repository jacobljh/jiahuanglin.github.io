#!/usr/bin/env python3
import os, re, sys

D = "/Users/jacob/Desktop/Interview/jiahuanglin.github.io/all_lessons/data_intensive_systems/lessons"

# (newnum, newfile, title, part_kicker_or_None, oldfile_or_None)
SEQ = [
 (0,"00_orientation.html","Orientation: The Spine and “Where Is Truth?”",None,"00_orientation.html"),
 (1,"01_data_models.html","Data Models: Relational, Document, and Graph","Part 1 · A single truthful copy","02_data_models.html"),
 (2,"02_query_languages_access_patterns.html","Query Languages and Access-Pattern Design","Part 1 · A single truthful copy","03_query_languages_access_patterns.html"),
 (3,"03_storage_engines_logs_btrees.html","Storage Engines I: Logs, Hash Indexes, and B-Trees","Part 1 · A single truthful copy","05_storage_engines_logs_btrees.html"),
 (4,"04_storage_engines_lsm_columnar.html","Storage Engines II: LSM-Trees and Columnar Storage","Part 1 · A single truthful copy","06_storage_engines_lsm_columnar.html"),
 (5,"05_encoding_schema_evolution.html","Encoding, Schemas, Compatibility, and Migrations","Part 2 · Meaning over time","04_encoding_schema_evolution.html"),
 (6,"06_reliability_scalability_slos.html","Reliability, Scalability, SLOs, and Tail Latency","Part 3 · Demand","01_reliability_scalability_maintainability.html"),
 (7,"07_indexes_caches_serving.html","Indexes, Caches, and Serving Under Demand","Part 3 · Demand",None),
 (8,"08_replication_leader_lag_failover.html","Replication I: Leaders, Followers, Lag, and Failover","Part 4 · Redundancy","07_replication_leader_lag_failover.html"),
 (9,"09_replication_quorums_conflicts.html","Replication II: Quorums, Leaderless, and Conflicts","Part 4 · Redundancy","08_replication_quorums_conflicts.html"),
 (10,"10_local_first_offline_sync.html","Local-First and Offline Sync","Part 4 · Redundancy",None),
 (11,"11_partitioning_rebalancing.html","Partitioning, Hot Keys, and Rebalancing","Part 5 · Distribution","09_partitioning_rebalancing.html"),
 (12,"12_multitenancy_routing_sharding_ops.html","Multitenancy, Request Routing, and Sharding Operations","Part 5 · Distribution",None),
 (13,"13_transactions_isolation.html","Transactions and Isolation","Part 6 · Invariants under concurrency","10_transactions_isolation.html"),
 (14,"14_messaging_idempotency_transaction_boundary.html","Messaging, Idempotency, and the Transaction Boundary","Part 6 · Invariants under concurrency",None),
 (15,"15_partial_failures_clocks_fencing.html","Partial Failure, Unreliable Clocks, and Fencing","Part 7 · Failure","11_partial_failures_clocks_fencing.html"),
 (16,"16_consistency_causality_linearizability.html","Consistency, Causality, and Linearizability","Part 7 · Failure","12_consistency_causality_linearizability.html"),
 (17,"17_consensus_coordination_verification.html","Consensus, Coordination, and Verification","Part 7 · Failure","13_consensus_coordination.html"),
 (18,"18_batch_processing.html","Batch Processing: Dataflow Engines, Joins, and Recompute","Part 8 · Derived history","14_batch_processing.html"),
 (19,"19_stream_processing.html","Stream Processing: Logs, CDC, Windows, and Stream Joins","Part 8 · Derived history","15_stream_processing.html"),
 (20,"20_derived_data_correctness.html","Derived Data: Keeping Views Correct","Part 9 · Derived views","16_derived_data_capstone.html"),
 (21,"21_analytics_query_execution.html","Analytics and Query-Execution Internals","Part 9 · Derived views",None),
 (22,"22_search_vector_indexes_rag.html","Search, Vector Indexes, and RAG","Part 9 · Derived views",None),
 (23,"23_feature_stores_ml_pipelines.html","Feature Stores and ML Data Pipelines","Part 9 · Derived views",None),
 (24,"24_cloud_native_storage.html","Cloud-Native Storage as a Subsystem","Part 10 · Cloud / AI systems",None),
 (25,"25_law_regulation_ethics.html","Law, Regulation, and Ethics as Architecture Input","Part 11 · Correctness & society",None),
 (26,"26_current_ddia_2nd_edition.html","Current DDIA: What the 2nd Edition Adds","Part 11 · Correctness & society","25_current_ddia_2nd_edition.html"),
 (27,"27_production_systems_atlas.html","Production Systems Atlas","Part 12 · Applied & interviews","17_production_systems_atlas.html"),
 (28,"28_failure_timelines_and_drills.html","Failure Timelines and Quantitative Drills","Part 12 · Applied & interviews","18_failure_timelines_and_drills.html"),
 (29,"29_case_social_timeline.html","Case: Social Home Timeline","Part 12 · Applied & interviews","19_case_twitter_timeline.html"),
 (30,"30_case_global_profile_store.html","Case: Global Profile Store","Part 12 · Applied & interviews","20_case_global_profile_store.html"),
 (31,"31_case_feature_store.html","Case: ML Feature Store","Part 12 · Applied & interviews","21_case_feature_store.html"),
 (32,"32_case_search_index_no_dual_write.html","Case: Search Index Without Dual Writes","Part 12 · Applied & interviews","22_case_search_index_no_dual_write.html"),
 (33,"33_case_model_registry.html","Case: Model Registry","Part 12 · Applied & interviews","23_case_model_registry.html"),
 (34,"34_case_metrics_dashboard.html","Case: Metrics / Observability Dashboard","Part 12 · Applied & interviews","24_case_metrics_dashboard.html"),
]
N = len(SEQ)
DENOM = N  # 35
# href remap: old filename -> new filename
href_map = {}
for (num,newf,title,part,oldf) in SEQ:
    if oldf:
        href_map[oldf] = newf

def two(n): return f"{n:02d}"

def short_crumb(newf):
    # crumb label kept generic from title's first words is risky; reuse existing crumb text where possible.
    return None

def gen_footer(i):
    num,newf,title,part,oldf = SEQ[i]
    # prev
    if i == 0:
        prev_href, prev_dir, prev_ttl = "index.html","&larr; Back to index","Data-Intensive Systems &mdash; full syllabus"
    else:
        p = SEQ[i-1]
        prev_href, prev_dir, prev_ttl = p[1],"&larr; Previous", f"{two(p[0])} &middot; {p[2]}"
    # next
    if i == N-1:
        next_href, next_dir, next_ttl = "index.html","Back to index &rarr;","Data-Intensive Systems &mdash; full syllabus"
    else:
        nx = SEQ[i+1]
        next_href, next_dir, next_ttl = nx[1],"Next &rarr;", f"{two(nx[0])} &middot; {nx[2]}"
    return (f'<footer class="lesson-nav">\n'
            f'  <a href="{prev_href}"><span class="dir">{prev_dir}</span><span class="ttl">{prev_ttl}</span></a>\n'
            f'  <a class="next" href="{next_href}"><span class="dir">{next_dir}</span><span class="ttl">{next_ttl}</span></a>\n'
            f'</footer>')

def remap_hrefs(text):
    pat = re.compile(r'href="(' + "|".join(re.escape(k) for k in href_map) + r')"')
    return pat.sub(lambda m: f'href="{href_map[m.group(1)]}"', text)

def set_pill(text, i):
    num = SEQ[i][0]
    def repl(m):
        mins = m.group("min")
        return f'<span class="step-pill">lesson {num+1} / {DENOM}{mins}</span>'
    new, n = re.subn(r'<span class="step-pill">lesson \d+ / \d+(?P<min>[^<]*)</span>', repl, text)
    return new

def set_title_num(text, i):
    num = SEQ[i][0]
    return re.sub(r'<title>\d+\s*&middot;', f'<title>{two(num)} &middot;', text, count=1)

def set_crumb_num(text, i):
    num = SEQ[i][0]
    # breadcrumb last crumb like: <span class="crumb">09 &middot; partitioning</span>
    return re.sub(r'(<span class="crumb">)\d+(\s*&middot;)', lambda m: f'{m.group(1)}{two(num)}{m.group(2)}', text, count=1)

def set_kicker(text, part):
    if part is None:
        return text
    return re.sub(r'<p class="kicker">.*?</p>', f'<p class="kicker">{part}</p>', text, count=1, flags=re.S)

def set_footer(text, i):
    return re.sub(r'<footer class="lesson-nav">.*?</footer>', lambda m: gen_footer(i), text, count=1, flags=re.S)

STUB = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{num2} &middot; {title}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="topnav"><div class="inner"><a class="crumb-link" href="../../index.html">all_lessons</a><span class="crumb">/</span><a class="crumb-link" href="index.html">data_intensive_systems</a><span class="crumb">/</span><span class="crumb">{num2} &middot; {crumb}</span><span class="step-pill">lesson {pillN} / {denom} &middot; ~15 min</span></div></header>
<main>
<p class="kicker">{part}</p>
<h1>{title}</h1>
<p class="subtitle">STUB — to be authored by the content wave.</p>
<!-- NEW LESSON STUB: author full gold-standard content here. -->
{footer}
</main>
</body>
</html>
"""

def main():
    # read old contents first
    old_contents = {}
    for (num,newf,title,part,oldf) in SEQ:
        if oldf:
            p = os.path.join(D, oldf)
            with open(p, encoding="utf-8") as f:
                old_contents[oldf] = f.read()
    # delete all existing lesson html (00-25 era) to avoid stale leftovers
    for fn in os.listdir(D):
        if re.match(r'\d\d_.*\.html$', fn):
            os.remove(os.path.join(D, fn))
    # write new files
    crumbs = {  # short crumb labels
     0:"orientation",1:"data models",2:"query languages",3:"logs & B-trees",4:"LSM & columnar",
     5:"encoding & evolution",6:"reliability & SLOs",7:"indexes & caches",8:"replication I",
     9:"replication II",10:"local-first",11:"partitioning",12:"multitenancy & ops",13:"transactions",
     14:"messaging boundary",15:"partial failure & clocks",16:"consistency",17:"consensus & verification",
     18:"batch",19:"stream",20:"derived data",21:"analytics execution",22:"search & vector",
     23:"feature stores & ML",24:"cloud storage",25:"law & ethics",26:"current DDIA",
     27:"production atlas",28:"failures & drills",29:"case: timeline",30:"case: profile store",
     31:"case: feature store",32:"case: no dual write",33:"case: model registry",34:"case: metrics"}
    for i,(num,newf,title,part,oldf) in enumerate(SEQ):
        if oldf:
            t = old_contents[oldf]
            t = remap_hrefs(t)
            t = set_pill(t, i)
            t = set_title_num(t, i)
            t = set_crumb_num(t, i)
            t = set_kicker(t, part)
            t = set_footer(t, i)
            with open(os.path.join(D, newf), "w", encoding="utf-8") as f:
                f.write(t)
        else:
            stub = STUB.format(num2=two(num), title=title, crumb=crumbs[num],
                               pillN=num+1, denom=DENOM, part=part, footer=gen_footer(i))
            with open(os.path.join(D, newf), "w", encoding="utf-8") as f:
                f.write(stub)
    print("wrote", N, "lessons")

main()
