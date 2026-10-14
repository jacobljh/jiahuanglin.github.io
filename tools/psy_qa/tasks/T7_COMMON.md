# T7 common instructions (read after briefs/RESEARCH.md; they override it where they differ)

**Context.** The 《心理学》 series (20 lessons) is being extended by 8 "counter-intuitive but true" lessons inserted into the chain
(new total 28; see tools/psy_qa/PLAN_EXT.md for the new numbering; your task file uses the NEW lesson numbers). Everything in the
existing FACTS files (tools/psy_qa/facts/FACTS_*.md) is already verified and graded and the lesson writers may use it. **Before
researching an item, grep the existing FACTS files for it**; if it is already there with a STUDY/GRADE block, do NOT re-create the
STUDY block (it would create a duplicate key) — instead add a one-line pointer `- SEE FACTS_T6a STUDY "<name>" (already graded X)`
and spend your effort on what is missing. Existing coverage you must not duplicate: regression to the mean (Galton 1886, def,
Barnett 2005 → FACTS_T6a §00-C, FACTS_T1 §02); noise definition, Grove 2000, Dawes, Galton's ox 1907, Mellers 2014, Danziger
"hungry judge" (D) → FACTS_T6a §03 and FACTS_T3a; ego depletion (D) and marshmallow (Watts 2018 / Sperber 2024) → FACTS_T1 /
FACTS_T3b §11; habits/Lally → FACTS_T3b §10; placebo (Hróbjartsson & Gøtzsche) → FACTS_T6a; learned helplessness → FACTS_T5;
partner touch/pain buffering (Coan, Che 2018) → FACTS_T6c; anchoring/hot hand → FACTS_T1 §06.

**Privacy (hard rule).** NEVER put any email address into any API call, URL, script, header or file: no `mailto=` parameter for Crossref /
OpenAlex / Unpaywall / Europe PMC, no email in the User-Agent. Use the bare User-Agent `psy-fact-check/1.0`. If an API wants an email,
use a different source (pubmed.ncbi.nlm.nih.gov, ncbi.nlm.nih.gov/pmc, doi.org landing pages, publisher pages).

**Tools budget.** WebSearch quotas ran out in earlier waves — prefer direct fetches of PubMed / PMC / publisher abstract pages / DOI
landing pages / OSF / the authors' own pages. Open the page for anything load-bearing. Write your file EARLY and append.

**Retraction / erratum sweep (mandatory, last step).** For every DOI/PMID you cite, check retraction/correction status (PubMed record
"Retracted Publication"/"Erratum in", publisher page, Crossref work record WITHOUT mailto). Read any correction notice that exists and
use the corrected numbers; list in a section `## RETRACTION / ERRATUM SWEEP` each item checked and the outcome; anything you
could not check goes there too as "not checked". Pay particular attention to any paper with D. Ariely, F. Gino, B. Wansink, or other
authors with known data problems — avoid them as the sole source for any claim, and if cited, say what the status is.

**What the lesson writers need from each lesson (give it explicitly, as sub-sections):**
1. `### Core evidence` — 6–12 STUDY blocks (graded A–D with the named replication/meta-analysis) for the lesson's central claim and its main boundary conditions. Include the NEGATIVE evidence honestly (failed replications, small meta-analytic effects).
2. `### Myths and corrections` — popular claims about this topic that are false/overstated ([✗]) and what the primary sources actually say; also classics that are better than their reputation.
3. `### Bet candidates` — 3 candidate pre-lesson bets: a question whose answer is a [V] number or pick, mildly surprising, NOT contested/sensitive, with the exact truth, tolerance advice, source and grade. The lead picks one.
4. `### Widget constants` — the numbers a deterministic toy-model widget needs (published parameters, ranges, sample sizes), each with a source; and say clearly which numbers do NOT exist in the literature (so the widget labels them 示意).
5. `### Boundary` — 3–6 bullets: where the lesson's main idea stops working / what is still disputed (feeds the 「这个模型的边界」 paragraph).
6. `### Ledger rows` — 6–10 one-line rows `| id | claim | key number | population | grade |` for lesson 27's evidence ledger.
7. `## COULD NOT VERIFY` — a write-ban list (banned numbers/names), exactly as in the brief.
Keep the whole file at ≈ 150–260 bullets. Chinese names beside terms (e.g. 回归均值). Never use 他/她 for people in any Chinese you write.
