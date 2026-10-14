# Writer brief — one lesson of 《心理学》 (spine) or 《从零学会用脑》 (sidecar)

There is NO applicable Skill — ignore any skill system-reminder. Do not spawn sub-agents. Write exactly ONE file
(NN/slug/h1 from the plan json) and, if the spec says so, ONE prototype `tools/psy_qa/proto/<id>.js`:
  - spine:   `all_lessons/psychology_new/lessons/NN_slug.html`       plan: `tools/psy_qa/lessons.json`
  - sidecar: `all_lessons/psychology_play/lessons/NN_slug.html`      plan: `tools/psy_qa/lessons_play.json`
Do not edit any other file (not the index, not style.css/psy.js, not other lessons, not the briefs, not FACTS).
Repo root: /Users/jacob/Desktop/Interview/jiahuanglin.github.io

## Read first (in this order, fully)
1. `tools/psy_qa/briefs/BIBLE.md` — red lines, engine, skeleton, evidence discipline, bets, widget conventions, dedup, QA.
2. `tools/psy_qa/briefs/SPECS.md` — YOUR lesson's section (content order, which FACTS sections, the bet, the widget model and its constants).
3. Exemplars — copy their structure, tone and density: `all_lessons/psychology_new/lessons/02_evidence.html` (and the
   lessons the spec names as models). `tools/psy_qa/briefs/TEMPLATE.html` is the bare skeleton.
4. Your FACTS file section(s) under `tools/psy_qa/facts/`, INCLUDING the COULD NOT VERIFY (write-ban) list at the end of
   the file, and `tools/psy_qa/facts/GRADES.md` (the table of evidence keys you may badge).
5. The plan json — your incoming baton (`"NN-1→NN"` key, written "MM-NN") and outgoing baton must appear VERBATIM in the
   `.chain` strip and the 下一步 callout.
6. If your lesson ports an old one (BIBLE §2 "ports from"): read the old file in `all_lessons/psychology/lessons/` for
   structure and good explanations ONLY. Every fact you keep must be re-found in FACTS. Several old claims are wrong
   (the lead's fact-check found e.g. a misattributed Seth quotation); FACTS wins whenever it disagrees.

## Hard rules
- **FACTS-only.** Every name, date, number, quotation, sample size, effect size and causal claim must be traceable to a FACTS
  file. Do NOT add colour from memory. If a sentence needs a fact that is not in FACTS, cut or generalise the sentence.
  Keep every hedge the FACTS item carries ([~] → 约 / 一般认为 / give the range and who says it). Write-ban items are banned
  even if you "know" them.
- **Badges.** Every named study / quantified result gets `<span class="ev ev-X" data-k="KEY">X</span>` using a key from
  `GRADES.md` with exactly that grade. Say in plain words what happened afterwards (replication, meta-analysis, retraction).
  A D-grade result is taught as a cautionary tale, never as a finding. ≥ 3 badges per lesson from 03 on.
- **The bet** (BIBLE §5): one `.bet` box right after 本课路线, exactly as the spec defines it; the reveal has a badge and
  works whether the guess was right or wrong.
- **Mental-health / sensitive content** (BIBLE §0.4): evidence only, no advice, no method details, consensus statements for
  group differences, one neutral sentence pointing to professional care in 17–19 and wherever a reader might be at risk.
- No 他/她/他们/她们 for people (use names, roles, 「你」「人们」「我们」「对方」「此人」). No LaTeX. Second person, linear,
  short sentences. Explain each term at first use (中文＋English).
- **One widget that COMPUTES or MEASURES the lesson's mechanism** (BIBLE §6): vanilla JS IIFE, `var`, no Math.random/Date
  (use `PSY.rng`), ids prefixed `wNN-`, `PSY.fit` canvas, narrower layout under ~560 px, labelled 示意 where schematic.
  Prototype the maths in node first; the numbers your prose or hint quotes must be what the widget really shows
  (check with kpi.js). If the spec's model is degenerate, fix the model and report what you changed.
- Fixed section pattern: 5–8 numbered h2 sections (一、二、…), one of them `X、动手：…`, one 「这个模型的边界」 paragraph,
  a `回到主线` callout, then 常见误解 (4–6 items, each myth corrected from FACTS), 一句话带走, 下一步 (not in 19), the
  lesson-nav footer, `<!-- reviewed:v1 -->`.
- Cross-refs inside the series: `第 NN 课《exact h1》`; sibling refs per BIBLE §8 with links; cite, don't re-teach.
- Size 24–46 KB.

## QA before you finish (must all pass)
```
node tools/psy_qa/verify.js all_lessons/psychology_new/lessons/NN_slug.html      # errors=0   (sidecar: add --plan lessons_play.json)
node tools/psy_qa/kpi.js all_lessons/psychology_new/lessons/NN_slug.html set:wNN-x=V click:wNN-y   # every quoted number
node tools/psy_qa/layout.js all_lessons/psychology_new/lessons/NN_slug.html 320   # and 700, after each state; out-of-bounds=0
```
Then re-read your file once against FACTS, sentence by sentence, and fix anything untraceable.

## Final reply (short)
File path; size; the widget's default KPI values; the bet's question and truth; a list of facts you WANTED but could not
use because they were missing from FACTS (the lead may research them); anything in the spec you changed and why.
