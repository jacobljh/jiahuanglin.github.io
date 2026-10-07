# Synthetic Vision Data — forced-chain rewrite: DESIGN (2026-10-06)

User (2026-10-06): "read the code base, especially the synthetic vision data series; apply linearized thinking; this is not
well written, let's delete and re-write the series; for education; think from first principle, really apply linearized
thinking."  Machinery = `tools/chain` (batons, data-n oracles, validator, qa_layout) exactly as for 3D / WM / robot.
Built aside in `all_lessons/synthetic_vision_new/` and swapped over `synthetic_vision/` on 2026-10-06 (the old 7-lesson series is in git history).
This file is the ORIGINAL design: the lessons as built (and the numbers they measured) are authoritative; where they differ, the lessons win.
Authoring rules for the lessons: `BIBLE.md`; verified external facts: `FACTS.md`; baton single-source tool: `sync_batons.py`.

## What was wrong with the old series (7 lessons, 57-86 KB each)
* essays, not a chain: each lesson is a topic survey ("sensor models" = cameras + ISP + LiDAR + radar + event cameras);
  "why the sequence is linear" is asserted in the index, not forced by measurements.
* widgets illustrate (fake closed-form curves such as synAcc(N)=0.995-0.45/sqrt(N/100)), nothing is computed;
  no oracle, no number is checked; ~20 external claims with no fact list.
* the Blender lesson (86 KB) was never run: `scene.render.engine = "BLENDER_EEVEE_NEXT"` is not a valid engine in the
  installed Blender 5.2.2 LTS (`BLENDER_EEVEE`).  /Applications/Blender.app exists -> the new lesson is EXECUTED.
* inbound claims from other series that the rewrite must keep true or edit (see "Inbound" below).

## First principles (the derivation spine)
F1  A learner reproduces the pattern present in its data; outside the data it extrapolates by inductive bias, which the
    data does not control.  So real performance is decided by how well the *training distribution* stands in for the
    real one where reality lives.
F2  A simulator makes data by sampling a program  scene -> light -> sensor -> label.  The label is a function of the
    scene (free, exact) — exact *with respect to the program's definitions*.
F3  Two kinds of gap: variance (finite N, shrinks with N) and bias (program != world; unchanged by N).
F4  Bias lives in a stage of the pipeline; stages are in causal order, so a downstream gap can only be measured once
    the upstream ones are matched (masking) => the repair order is the pipeline order.
F5  Reality is available only as a small labelled sample plus a large unlabelled one: each kind of real evidence
    identifies a different stage (unlabelled strips -> p(x): coverage, look, sensor; labelled -> p(y|x): contradiction,
    grading; logs -> scene prior; flat-field/clock tests -> sensor/timing; interventions -> consequences).
F6  Labels are definitions: which instant, which surface, which convention.
F7  Decisions need consequences of actions; observation is not intervention; a program can branch.
F8  Whether it worked can only be judged on reality; rare events make that judgement expensive.

## The lab (one world, one reality)
*Street* (Flatland, top-down plane, a 1-D camera): a shuttle (camera at the origin, heading +z), a parked van, clutter
(poles, trees), a far wall, a pedestrian who may stand in the open or step out from behind the van (visible width 0..~10 px).
Signature metric: the **psychometric curve** (detection rate vs visible pedestrian width in px) and its w50; w50 -> metres of
stopping margin (emergence kinematics) -> collision.  Exam: grade on REAL strips, deployed with the operating point chosen on
synthetic validation (all a synthetic-only project has).
Program = stages {Scene, Look, Sensor, Time, Label}.  `SIM0` = the first, naive simulator; `REAL` = the same program with
different parameters/mechanisms in every stage, exposed only as an API (labelled test set, labelled budget, unlabelled logs,
flat-field captures, clock test) — reality is a data source, not inspectable (oracles may peek).
Learner (fixed for the whole series so only the data changes): random conv features (both polarities, several widths) ->
per-pixel logistic head, strip score = max over pixels.  Second learner (small trained net / memorising kNN) only in oracles
as robustness checks and in the leakage lesson.
Engine files: `flatland.js` (copied from computer_vision_3d, for drawing helpers + rng) + `street.js` (SV: world, programs,
renderer, camera/LiDAR, labels, learner, metrics) + per-lesson `lNN_*.js` labs.

## The chain (v1; numbers in batons must be prototyped before they are written)
 1 Free labels, and the wall      learning curve: synthetic error -> 0, real error floors (variance vs bias)
 2 Where the gap lives            pipeline stages; swap test (fix-one / break-one); what each kind of real evidence identifies
 3 Cover the cases                scene program, support, coverage ruler (unlabelled real), (1-p)^N, conditional structure
 4 The rare case                  oversampling, prior shift (logit correction), importance weights/ESS, where to spend renders
 5 Same scene, other pixels       appearance randomisation: nuisance vs signal, cost of invariance, range from unlabelled real
 6 The camera is a measurement    light->electrons->DN, shot/read noise, saturation, photon-transfer calibration, detectability floor
 7 A frame takes time             exposure/readout/LiDAR sweep timestamps, motion blur & shear, label time, bias = f v dt / Z
 8 What the label means           visibility/modal-amodal, depth vs range, coverage-threshold at AA edges, cross-modal consistency
 9 The contract in a real renderer  Blender (EXECUTED, 5.2.x): conventions, passes, K from lens/sensor, id/AA, manifest, headless
10 Replay, checks and leaks       seeds/provenance, invariants (silent-bug bench), lineage splits, leakage grows with model capacity
11 A little reality               calibrate vs fine-tune vs grade with M real labels; mixing; exchange rate; refiners + label drift (toy)
12 What braking changes           logs confound, matched branches, positivity, common random numbers, world-model trajectories
13 Proof                          real-test power for rare events (rule of three), open vs closed loop, sim-as-evaluator validity, final ledger
Parts: Factory (1-2) · Scene (3-4) · Light and sensor (5-8) · Build and trust (9-10) · Reality and action (11-13).

## Inbound (what other series say about this one; keep true or edit at swap time)
* world_models/17: "Sim as a designed data-generating process: synthetic_vision/01–06", "Closed-loop trajectory evaluation: synthetic_vision/07"
* world_models/30: "synthetic_vision/07 owns the closed-loop evaluation harness"; /27: "synthetic_vision/06 ... transfer contract with an explicit label-preservation gate"
* world_models/16: link to 07 (closed-loop harness); /29: link to index (batch generation, no deadline); /02: link to 03 (where a noise model like R comes from); world_models/index sentence
* robot_model_training/11: link to 06 (same gap for rendered images); robot index sentence; computer_vision_3d/12: link to 03 (where a sweep's noise comes from)
* computer_vision/07: link to index; all_lessons/index.html card (7 lessons rows); tools/epub/volumes.py `_p("synthetic_vision", ...)`
* closing seam: robot_model_training/16+ (data economics) and world_models/17+ (training a world model) are the consumers.

## Process rules (from the earlier rewrites)
prototype numerics in node -> oracle -> page with approximate numbers -> validator -> replace by oracle facts -> layout QA;
lead writes exemplars, <=4 concurrent writer agents with token discipline; reading is cheap, agents burn usage; page <= 46 KB;
every checkable number is `<span data-n>`; external facts only from FACTS (cited by name+year, no URLs); no commit.
