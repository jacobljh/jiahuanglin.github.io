# tools/chain — forced-chain lesson series

Machinery for lesson tracks written as a *forced chain*: every lesson is the single move that resolves the problem the
previous lesson created, and hands the next problem on in a verbatim sentence (the **baton**). Used by
`computer_vision_3d` (3D Vision), `world_models` (World Models), `robot_model_training` and `embodied_training_data`
(and, with its own copy of the idea, `rust`).

| file | job |
|---|---|
| `batons_<s>.json` | the series plan: lessons, parts, and every baton sentence `S<n>-<n+1>` (series keys `3d`, `wm`, `rob`, `dat`) |
| `validate_chain.py` | structure, batons (end of lesson *n* = start of *n+1* = index table), page budget 20–48 KB, widgets, oracles, release gate |
| `dom_probe.js` | runs every widget script of a page under a DOM stub (deterministic: `Math.random`/`Date` are poisoned) |
| `verify/<s>_NN_*.js` | one **oracle** per lesson: re-derives every quoted number independently and drives the page; prints `{"facts":{…}}` last |
| `verify/engine/test_*.js` | regression tests of the shared engines (`flatland.js`, `geom3.js`, `courtyard.js`, `bench.js`) |
| `gen_index.py` | fills `<!-- GEN:TOC -->` and `<!-- GEN:DERIVE -->` in a series `index.html` from the batons file |
| `qa_layout.py` + `qa_layout.html` | headless-Chrome layout QA: overlapping canvas text, text off the canvas, NaN text, sideways page scroll |

## Everyday commands (repository root)

```bash
python3 tools/chain/validate_chain.py --series wm --only 05 --widgets --oracles   # one lesson
python3 tools/chain/validate_chain.py --series 3d --widgets --oracles --final --engines   # release gate for a series
python3 tools/chain/qa_layout.py --series wm --index                                # layout at 375 px and 1100 px
python3 tools/chain/gen_index.py --series wm                                        # refresh the index tables
```

`--all` means *every* series that has a batons file (3d and wm; rob and dat once their plans exist), not "all checks" — name the series you mean.
The release gate (`--final`) additionally wants `<!-- reviewed:v1 -->` before `</body>` in every lesson, an oracle for every
lesson and a valid index. Oracles take 5 s–3 min each (WM 08, 15 and 16 are the slow ones).

## The number contract

Every checkable number in prose is `<span data-n="key">12.3</span>`. The lesson's oracle prints the same key in its
`facts`; the validator requires the shown digits to equal the fact rounded to the digits shown (avoid values that sit on a
`.5` tie). A claim that has no oracle is a claim nobody has checked: add the check, not the number.
External facts (papers, systems, dates) come only from the series' fact list, are cited by name and year, and carry no URLs.

## Widgets

One `.widget`, one `<canvas>`, the first `input[type=range]` is the main experiment, the layout switches on
`cv.style.height` for narrow screens, and the "Show the core JS" listing must be lines that exist in the page script or the
private engine (≥ 6 lines). Engines: `flatland.js`/`geom3.js` (3D), `courtyard.js` (World Models), `bench.js` (robot/data);
a lesson may add a private engine `lNN_*.js`.

## Writing a series (what worked)

1. Plan: batons and parts first; a baton whose number is a prediction must be prototyped in node before it is written down.
2. Per lesson: prototype the numerics → oracle → page with approximate numbers → validator → replace digits by oracle facts →
   check in a browser at desktop width and at 375 px.
3. Build next to the old track in `<dir>_new/`, review every lesson (forcedness, truth, clarity, consistency, size ≤ 46 KB),
   run the release gate, then swap the directories and fix inbound links (`grep -r "<old dir>/"` over `all_lessons/`,
   the master `all_lessons/index.html` cards, and `tools/epub/volumes.py`, which is keyed by directory name).
4. Do the cross-series seams last: the closing baton of one series is the opening of the next (3D `S14-x` = WM `S00-01`; WM
   `S16-x` opens `world_model_training/00`; robot `S15-x` = data `S00-01`).
