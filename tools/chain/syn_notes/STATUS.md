# STATUS — Synthetic Vision Data rewrite (log; newest last)

## 2026-10-06 session 1 — design + lab prototype (nothing committed; old series still in place)
* Read: old series (7 lessons, essays, fake-curve widgets), tools/chain (validator, oracles, dom_probe), 3D-01 exemplar, robot/WM batons.
* DESIGN.md written (first principles F1-F8, chain v1, inbound list).  Blender 5.2.2 LTS is installed (/Applications/Blender.app/Contents/MacOS/Blender,
  headless works, engine enum is `BLENDER_EEVEE` — the old lesson's `BLENDER_EEVEE_NEXT` is invalid): lesson 9 is EXECUTED.
* Lab prototyped in `all_lessons/synthetic_vision_new/street.js` (+ flatland.js copy for draw helpers).  Proto scripts: `syn_notes/proto/`.
### Findings that shaped the lab (do not re-learn)
1. A 1-D strip lab is ill-posed for recognition (a dark pedestrian == a pole == a tree); even with a LiDAR channel the ceiling was AUC ~0.65-0.73.
   => the lab is 2.5-D: 96x24 RGB images (f=83.1 px, horizon row 9, camera 1.4 m), objects = vertical extrusions (ped = legs+torso+head, tree = trunk+crown).
2. Learner: random conv features + global logistic was too weak (AUC .83 even in an 'easy' world).  A fixed bank of oriented bar/step filters
   (3 widths x 3 heights x 3 channels (lum, R-G, B-(R+G)/2), both polarities, + row prior; DIM=110) + logistic head + ONE round of hard-negative mining
   reaches AUC .994 in the easy world.  Without mining, false alarms pile up on van edges.  Score of an image = max cell logit (stride-2 grid).
3. REAL must not be adversarial: stacking every difficulty gave AUC .70 and a plateau (Bayes/learner limit, not data).  Final REAL = 'mild': clutter 1.0,
   pEmerge .35, z 8-24, sun el 12-65 az +-150, lum .12-1, sensor ev 600 + auto-exposure (target .12, maxGain 8) + blur .7 px + shot/read noise, label rel .15.
   SIM0 = naive: noon, behind-the-camera sun, bright palette, white van, ideal sensor, pEmerge 0, z 8-16, clutter .5.
4. Canonical protocol (N=1600 training images, REAL test 1000..4000, threshold = 5%->(use 10%?) false alarms on pedestrian-free real frames):
   all-SIM0: AUC .619, R6(area>=6 px^2) .208, FA at the training-domain threshold = 100 %.  all-REAL (matched): AUC .782, R6 .474, FA 4.8 %.
   fix-one (only that stage real): scene .240, look .240, sensor .231 (FA 100->51 %).  break-one (real except that stage): scene .277, look .359, sensor .309 (FA 100 %).
   cumulative in pipeline order: .208 -> +scene .240 -> +look .309 -> +sensor .474 -> +label .474  (gaps are MULTIPLICATIVE: masking; increments grow).
   AUC cumulative .619 -> .664 -> .715 -> .782 (smoother, ~additive).
5. Learning curve (SIM0-trained): synthetic miss .85 (N=5) -> .39 (10) -> .09 (40) -> .005 (160) -> 0 (640); real miss stays .72-.94, AUC .58-.63 (floor).
6. Noise needs ev~600 + AE to matter: ev=1500 -> sensor gap small; ev=300 -> too harsh (ceiling .73).
7. Time/label stages: at 96 px the time effects are sub-pixel (f v dt / z = 0.2 px); lesson 7 uses a hi-res crop renderer + an explicit pixel-shift experiment;
   label stage (rel .15 vs kvis 1) shows only in conventions exams (lesson 8).
8. Speed: render 0.8 ms/img, featureMap ~2.5 ms/img, train N=1600 ~40 s (Newton fit dominates), score 3 ms/img.  Sweeps are precomputed tables
   (parallel node processes, 10 cores) + live single trainings (<=160 images ~1-2 s) in widgets.
### Open design questions
* Headline exam: miss rate at 10% false alarms (Caltech 'FPPI 0.1' convention; verify before citing) on pedestrians with >= 6 visible px^2; AUC as the smooth secondary.
* Masking story for lesson 2/3 (early fixes move the exam little; the sensor fix gives the biggest jump when last): keep, it is the honest lesson about attribution.

## 2026-10-06 session 2 — final engine, tests, registration, design decisions
* `street.js` FINAL (v1) written: fixed AE (`ml = ev*mean(rad)/fw`, gain = clamp(target/ml, 1, maxGain)), range = t*sqrt(1+s^2), depth/range/id now from an EXTRA centre ray
  (pixel centre, not a sub-sample), top faces rendered (shoulders of short pedestrians), label-gated cell labels, per-image weights, `SV.exam`, `SV.SEEDS`, `SV.real`.
  `tools/chain/verify/engine/test_street.js` = 30 checks (conventions vs pinhole formulas, sensor flat-field law, exam maths, detector, determinism) — green.
* Registered series `syn` in validate_chain.py (engines=["street.js"], dirname synthetic_vision, next_last index.html), gen_index.py, qa_layout.py.  `all_lessons/synthetic_vision_new/style.css` = 3D sheet with the teal palette.
* Canonical protocol (final): train N=1600 (seeds 1..3), exam = REAL test 3000 frames, threshold = 10% false alarms on REAL val (1500) pedestrian-free frames, miss over pedestrians with >= 6 px^2;
  'carried' = the same detector with the threshold chosen on its own training domain's validation set (operating-point transfer); 'logs' = alarm rate on 1000 unlabelled real frames.  Harness: `proto/canon.js`, jobs `proto/results/jobs2.txt`, output `canon2.jsonl`; `run_jobs.sh jobs P`.
* RESULTS (N=1600, mean of 3 seeds, miss@10%FA): aaaa .803 | fix-one scene .748, look .733, sensor .658, label .803 | cumulative scene+look .683, +sensor .469, +label .471 | break-one: scene .616, look .601, sensor .685, label .469.
  The LABEL stage never matters for the exam when the scene has no emerging pedestrians (labels differ only for partial visibility) and ~0 even with them: it is a MEASUREMENT-VALIDITY stage (definition changes the number you report),
  not a performance stage -> lesson 7 = definitions (modal/amodal, threshold, depth vs range, alignment) with the exam-definition sensitivity shown on one detector.
  SIM0-trained learning curve is flat from N~40: real miss .80 (AUC .60) at N=40 and N=2560; own-domain miss 0.  REAL-trained: .48 at N=1280.  carried-threshold false-alarm rate on real frames: 100% (SIM0) -> 93% (sensor fixed) -> 24% (only scene wrong) -> 9% (all real).
* Chain decision: 12 lessons, time folded into lesson 6 (exposure/readout: f v dt / Z, hi-res crop) and lesson 7 (label time).  Order scene -> look -> sensor -> label justified by (a) support: a case the scene never draws cannot be repaired downstream,
  (b) increments grow downstream (.056, .064, .214): a stage's price is only meaningful once upstream is right (masking/interaction).  Evidence for the sensor (flat fields) is scene-independent; for the look, probe pixels (sky/road, AE-invariant ratios); for the scene, labelled masks + ground-plane geometry z = f*hc/(v_foot - V0).

## 2026-10-06 session 3 — agent infrastructure, wave 1 launched
* Lessons 1-2 DONE and validated (oracles syn_01, syn_02). `flatland.js` copy deleted from the new dir.
* Written: `BIBLE.md` (house rules, lab API, evidence rule, page/widget/oracle/builder/baton protocol), `TEMPLATE.html`, `SPEC_03..06.md`, `evidence.js` (shared: `SV.evidence.logs` with the camera's logged AE gain, `CAMERA` constants, `linear()`); `FACTS.md` filled by a research agent (L03, L04 ready at launch time).
* Look-width probe (lead, seed 1, N=1600, `aaba`-base with scaled look ranges): miss/ownMiss/logsAlarm — s=0 65.1/5.5/52%; .5 60.8/5.7/31%; 1 62.1/6.3/27%; 1.5 64.0/18.2/19%; 2 64.3/18.1/18%; 3 63.3/13.5/19%.  Shallow U in the exam; the program's OWN miss jumps when the range includes unrecoverable frames (lum floor .01) = a label-free stopping rule.  Gain log: SV.evidence.logs(200): median gain 6.0, 33.5% at the cap 8.
* Blender 5.2.2 LTS headless works (`--background --factory-startup`): defaults: engine BLENDER_EEVEE (Cycles also settable: 'CYCLES'), view transform AgX, Cycles pixel filter Blackman-Harris 1.5 px, camera lens 50 mm / sensor 36 mm / fit AUTO, units metric 1.0, res 1920x1080, 8-bit.  Camera looking along +world Y: rotation_euler=(pi/2,0,0); f_px=83.1 at 96 px -> lens = 83.1*36/96 mm (sensor_fit HORIZONTAL); horizon on row 9 needs shift_y = -3/96 (negative shift moves content UP; shift is in units of the larger image dimension); Cycles renders a 96x24 frame in ~0.02 s (+0.5 s start); EEVEE ~2.5 s first render. Probes: syn_notes/proto/blender/probe1.py, probe2.py.
* Wave 1 (writers, in parallel, default model): L3 camera, L4 light, L5 cases, L6 rare case.  Notes under syn_notes/w03..w06.  Each owns its exit baton via sync_batons.py.
* TODO after wave 1: review each lesson myself (forcedness/truth/consistency/size), reconcile seam numbers, then SPEC_07..12 and waves 2-3 (L7-L10, L11-L12); gen_index; final validation; swap; inbound links; memory.

## 2026-10-06 final — shipped
All twelve lessons written, lead-reviewed (REVIEW.md) and validated (`python3 tools/chain/validate_chain.py --series syn --widgets --oracles --final --engines`: 2,795 quoted numbers checked against independent oracles, 12/12 widget pages clean, layout QA clean at 375 and 1100 px). `synthetic_vision_new/` was swapped over `synthetic_vision/`; the master index card (7 -> 12 lessons) and 15 inbound pages were updated (`remap_inbound.py`); the old seven essay lessons are in git history. Seams: `S12-x` hands over to `robot_model_training/16` and `world_models/17`. Rebuild commands per lesson are in each `tools/chain/verify/engine/build_lNN.js` header; Blender runs through `tools/syn_blender/README.md`. The writers' scratch (`w03`..`w12`, `proto/`) is not committed.
