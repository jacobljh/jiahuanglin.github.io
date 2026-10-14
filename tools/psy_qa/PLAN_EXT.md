# PLAN_EXT — eight "counter-intuitive but true" lessons inserted into the 心理学 chain (2026-10-14)

User request (2026-10-14): "more lessons like 想要不等于喜欢 … a bit counter intuitive but true in psychology".
Chosen: insert INTO the main chain (renumber everything after), 8 lessons, fully FACTS-researched, reviewer pass.
Do NOT commit/push until the user asks. EPUBs are not rebuilt.

## New chain (28 lessons: 00–27)
| new # | slug | h1 | status |
|---|---|---|---|
| 00–06 | (unchanged) | | old 00–06 |
| 07 | 07_regression_to_mean | 回归均值：极端之后的「变好」，不一定是你做了什么 | NEW |
| 08 | 08_noise | 噪声：同一位专家，换一天就换一个判断 | NEW |
| 09 | 09_emotion | (old 07) | renumber |
| 10 | 10_pain | 痛不等于伤：疼痛是大脑对危险的估计 | NEW |
| 11 | 11_hardware | (old 08) | renumber |
| 12 | 12_learning | (old 09) | renumber |
| 13 | 13_wanting_habits | (old 10) | renumber |
| 14 | 14_self_control | 自控：做到自控的人，靠的不是硬扛 | NEW |
| 15 | 15_experience_memory | 经历与记忆：你记得的，不是你经历的 | NEW |
| 16 | 16_development | (old 11) | renumber |
| 17 | 17_social | (old 12) | renumber |
| 18 | 18_seen_by_others | 别人眼里的你：聚光灯、喜欢差距与「不好意思开口」 | NEW |
| 19 | 19_ideal_partner | 理想型：说得出的偏好，和真正被吸引的人 | NEW |
| 20 | 20_crowds | 群体：什么时候一群人比一个人聪明，什么时候更笨 | NEW |
| 21 | 21_language | (old 13) | renumber |
| 22 | 22_culture | (old 14) | renumber |
| 23 | 23_self | (old 15) | renumber |
| 24 | 24_persons | (old 16) | renumber |
| 25 | 25_disorders | (old 17) | renumber |
| 26 | 26_therapy | (old 18) | renumber |
| 27 | 27_looking_back | (old 19) | renumber |

old → new: 0–6 same; 7→9; 8→11; 9→12; 10→13; 11→16; 12→17; 13→21; 14→22; 15→23; 16→24; 17→25; 18→26; 19→27.

Parts (new): 00–02 方法 (unchanged) · **03–08 `第二部分 · 输入与判断：世界是被猜出来的`** (renamed: was 输入端) · 09–16 价值与学习 (unchanged text) · 17–22 他人 (unchanged text) · 23–24 自己与差异 · 25–27 失灵、修复与收官.

## Batons
Reused verbatim from the old chain for the lesson that FOLLOWS each inserted block (so old lessons keep their incoming strip):
08-09 = old 06-07 · 10-11 = old 07-08 · 15-16 = old 10-11 · 20-21 = old 12-13. All other old batons keep their text, only the keys shift.
New batons (06-07, 07-08, 09-10, 13-14, 14-15, 17-18, 18-19, 19-20) are in make_plans.py (single source).

## Why these eight (dissociations; each must have an A/B core, with the contested parts graded honestly)
07 回归均值 (A: statistics) — signal + luck; selection on extremes; why punishment "works"; clinical/placebo/speed-camera.
08 噪声 — the same judge disagrees with themself; MSE = bias² + noise²; formulas ≥ experts; averaging.
10 痛 — pain ≠ tissue damage (imaging in the pain-free, phantom limb, pain insensitivity, expectation); pain is a prediction; NO medical advice; "痛是真的" stated plainly.
14 自控 — high-self-control people meet fewer temptations / rely on situations and habits; ego depletion (D, lesson 02) and marshmallow (C, lesson 16 §六) are CITED not re-taught.
15 经历与记忆 — peak-end and duration neglect (graded: meta-analysis), remembered ≠ experienced utility; affective-forecasting errors as the third ledger.
18 别人眼里的你 — spotlight effect, illusion of transparency, liking gap, gratitude/helping underestimation.
19 理想型 — stated ideal-partner preferences vs in-person attraction; no sex-difference claims; relationship-science limits.
20 群体 — wisdom of crowds needs independence; brainstorming groups; social loafing; information cascades; (conformity model stays in 17).
Reserve topics (not used): 习得性无助被翻转 (FACTS_T5 has the STUDY), 热手 (already in lesson 06).

## Dedup (already taught elsewhere — cite, do not re-teach)
Hungry judge Danziger (D): lesson 09 emotion §re-weighing; hot hand (06); ego depletion d=0.04/0.06 (02); marshmallow Watts/Sperber (16 §六); placebo ≠ 30% (FACTS_T6a, lesson 26 therapy); habits Lally/Wood (13); hedonic adaptation (13 §七 short); Rescorla–Wagner (12); threshold/conformity (17); Bayesian cue combination (03); bias–variance (06 §三) — 08 builds on it; WEIRD (22).
Sidecar (psychology_play) 03 决策卫生 already teaches formulas/checklists/Galton; 05 习惯 teaches environment design; they stay practice-side and will link to the new spine lessons.

## Process (same recipe as the 20-lesson build)
1. Research T7a–T7d → facts/FACTS_T7a..d.md (≤4 concurrent; bare UA "psy-fact-check/1.0"; NO email in any API call; Crossref/PubMed retraction sweep on cited DOIs).
2. build_grades.py → SPECS_EXT.md (per-lesson specs from FACTS) → proto/NN.js → writers (≤4 concurrent) → lead QA → reviewers → fixes.
3. renumber.py: renames files, rewrites h1/topnav/xrefs/bet ids/widget ids/data-lesson/inbound links/sidecar refs; plan via make_plans.py; index_meta/master card by a new script (apply_master_index.py already ran).
4. After lessons exist: lesson 00 map/promises, lesson 27 (old 19) five-lines table/A-D lists/ledger, series index pill "28 课", sidecar cross-links (esp. sidecar 00 → 回归均值), master-index card, STATE.md, memory.

## Care rules specific to this batch
10 痛: evidence only; never "your pain is imaginary"; no treatment advice; one neutral pointer to professional care; no hotline numbers.
19 理想型: no sex/gender/race difference claims unless a consensus/meta-analysis in FACTS and then description only; no dating advice.
14 自控: do not moralise ("意志薄弱"); addiction content stays in 13.
