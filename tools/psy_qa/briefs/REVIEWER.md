# Reviewer brief — 《心理学》 / 《从零学会用脑》 adversarial pass

There is NO applicable Skill — ignore any skill system-reminder. Do not spawn sub-agents.
Repo root: /Users/jacob/Desktop/Interview/jiahuanglin.github.io. You review the lessons in YOUR RANGE only and may edit
only those files under `all_lessons/psychology_new/lessons/` (or `all_lessons/psychology_play/lessons/`). Do not edit the
index, style.css, psy.js, briefs, FACTS, plan json, other lessons, or anything outside those folders.

## Read first
1. `tools/psy_qa/briefs/BIBLE.md` (red lines §0, engine, skeleton, evidence §4, bets §5, widgets §6) and `WRITER.md`.
2. `tools/psy_qa/briefs/SPECS.md`: the sections for your lessons.
3. The FACTS file(s) named in each lesson's SPECS section (`tools/psy_qa/facts/`), INCLUDING the COULD NOT VERIFY list,
   and `facts/GRADES.md`.

## What to do, per lesson (assume the writer made mistakes — your job is to find them)
1. **Fact audit, sentence by sentence.** Every name, date, number, quotation, sample size, effect size, superlative
   (最/第一/唯一/所有) and causal claim must be traceable to a FACTS file. For each untraceable item: cut it, or generalise
   it until it is true without the detail. Anything on a COULD NOT VERIFY list → remove. Keep the FACTS hedges ([~] →
   约/一般认为/range + who says it). Watch for "colour" added from memory: professions, dates, adjectives, motives, and
   "因为…所以…" chains the FACTS file does not make. Where the lesson offers the series' own reading, it must say so (本课的读法).
   **Old-text contamination:** ported paragraphs often keep claims the old series made without a source — check them against
   FACTS, not against your own memory.
2. **Grades.** Every `.ev` badge: right key, right letter (verify checks), and the *sentence next to it* must not claim more than
   the grade allows (an A badge on a mechanism that FACTS grades B is an error; a D result worded as a finding is an error).
   Missing badges: add them where a named study / number lacks one.
3. **Bet.** The bet question must be answerable from the lesson; the truth and tolerance must match FACTS; the reveal must read
   correctly for a right or a wrong guess; no sensitive-number bets.
4. **Care and neutrality** (BIBLE §0.4): no diagnosis or advice, no self-harm method detail, consensus-statement wording for
   group differences, heritability stated as a population statistic, culture/politics flat and sourced.
5. **Chain.** The `.chain` strip and 下一步 callout carry the batons from the plan json verbatim. Cross-refs `第 NN 课《h1》`
   must use the exact h1 and must not promise content the target lesson lacks — grep the target file if it exists.
6. **Widget.** It must compute or measure the mechanism and the interesting behaviour must emerge from the model, not be
   hand-put-in. Re-derive the maths yourself (a few lines of node) and compare with what the widget prints. Every widget number
   quoted in the hint or prose must match: `node tools/psy_qa/kpi.js FILE set:wNN-x=V click:wNN-y`. Layout:
   `node tools/psy_qa/layout.js FILE 320` and `700` → out-of-bounds=0. Labelled 示意 if schematic.
7. **Clarity (first principles, linear).** A reader who has read only the earlier lessons must follow every step. Jargon defined at
   first use. No paragraph that only lists facts without saying what they show. Remove repetition and slogans (「大脑是……的机器」
   used as a conclusion instead of being derived).
8. **Mechanics.** `node tools/psy_qa/verify.js FILE` → errors=0 (sidecar: `--plan lessons_play.json`). Size 24–48 KB. Keep
   `<!-- reviewed:v1 -->` and change it to `<!-- reviewed:v2 -->`.

## Final reply (short)
Per lesson: number of changes by category (facts cut / softened, grades, bet, care, chain, widget, clarity), the 3 most
serious problems you found, and anything you could not fix (needs research or a lead decision).

## Extra checks (added 2026-10-14 after the lead's own audits found these slip types — look for them first)
- **Who found what.** Misattributed or merged findings: a conclusion drawn by three authors written as "两位作者"; a range that belongs to a GROUP of interventions
  quoted as one intervention's effect; the direction of a classification reversed (who was classified first, by what); a sample or comparison
  group swapped (vs usual care / vs inactive control / vs another active treatment). Check every comparison against the FACTS bullet.
- **Superlatives and popularity claims.** 最/唯一/第一/最著名/最大/「常被引用」/「被说歪最多」 need a FACTS source; otherwise cut. "No retraction" must be "no retraction
  mark found" unless FACTS says otherwise. A researcher's own sum (e.g. 268 + 456) must be flagged as such.
- **Promises.** Every forward reference in the lesson ("第 NN 课会…") must be delivered by the target lesson (grep it); every promise ANOTHER lesson made to this one
  (grep `第 NN 课` across the series for your number) must be kept: list the ones you found and whether they are kept. The series index and lesson 00 also make promises
  (e.g. a 「校准记分板」 in lesson 19, "the five questions").
- **Widget text.** Hint, legend, KPI labels and prose must describe what the widget really draws and prints (colour names, which side is "higher", units). Run the
  widget in its default state AND after each preset; re-derive the printed numbers.
- **Care wording** where a reader might be at risk: ONE neutral sentence, no advice, no hotline numbers, no method detail, no ranking of treatments beyond graded evidence.
- **Badges drive lesson 19.** Do not remove or re-letter a badge whose key lesson 19's evidence ledger lists (A: stroop-interference, franco-2014, simmons-2011, szucs-2017,
  osc-2015, inattentional-blindness, change-blindness, loftus-palmer, anchor-explicit, framing, dopamine-rpe, extinction-new, false-belief, correspondence-bias, minimal-group,
  weird-sample-dominance, self-tickle, btae; D: bem-2011, ego-depletion-2016, flashbulb-special, priming-walk, anchor-incidental, facial-feedback-pen, power-pose, hungry-judges,
  serotonin-deficit, dopamine-fasting-resets-dopamine, learning-styles, ten-thousand-hours, spe, thirty-million) without telling the lead; adding badges is fine. The lead re-runs
  `python3 tools/psy_qa/ledger.py --write` after your pass.

## Sidecar lessons (《从零学会用脑》) — additional checks
- Read `briefs/SPECS_PLAY.md` (common block + your lessons' sections) instead of SPECS.md. Verify with `--plan lessons_play.json`; shots with `--play`.
- The 证据卡 table's numbers, populations, durations, critiques and grades must equal the FACTS ledger rows; at least one popular-but-weak technique is graded next to the strong ones.
- The 「本周实验」 callout is a behavioural self-experiment (one change, one outcome the reader does not grade themselves, a baseline, a decision rule written first, a stop/care
  boundary) — not medical advice; sleep and mood lessons carry only the boundary wording FACTS supports.
- Sidecar → spine links use `../../psychology/lessons/…` with the spine lesson's exact h1; no re-teaching of what the spine lesson already covers (grep it).
