# tools/syn_blender — Blender 5.2.2 LTS, headless, for Lesson 8 of "Synthetic Vision Data, from first principles"

Lesson 8 asks whether a renderer we did not write obeys the contract of Lesson 7 (axes, row order, focal length, principal point, pixel centres, shapes, what a pixel holds,
pixel filter, sampler, depth pass, masks, units). These scripts run the same scene descriptions through Blender and record what it returns. Everything else (the closed forms,
the errors, the detector trainings) is node code: `all_lessons/synthetic_vision/l08_blender.js`, `tools/chain/verify/engine/build_l08.js`, the oracle
`tools/chain/verify/syn_08_the_contract_in_a_real_renderer.js`.

## Requirements

* Blender 5.2.2 LTS (macOS: `/Applications/Blender.app/Contents/MacOS/Blender`; the builder reads `$BLENDER` if set). It brings its own Python 3.13 and numpy; nothing is installed into it.
* node 18 or later, for the builder and the oracle.
* Cycles on the CPU. No GPU feature is used. The engine id of the real-time engine in this build is `BLENDER_EEVEE` (`BLENDER_EEVEE_NEXT` is not valid).

## Files

| file | what |
|---|---|
| `build_scene.py` | the library: the settings dict, the scene builder (emission shading of the Street's radiance formula, holdout masks, passes), `save_arrays`. Imported by the scripts below; never run on its own. |
| `exrio.py` | a minimal reader for the OpenEXR files Blender writes here (scanline, single or multipart, codec NONE, ZIPS or ZIP), because Python-side `Render Result.pixels` is empty in background mode: every pass is written to a file and read back. |
| `render_suite.py` | the conformance suite: one analytic scene per clause, each at the default and set (T01 axes, T02 lens, T03 shift, T04 pixel centres, T05 rows, T06 filter, T07 colour, T08 sampler, T09 shapes, T10 depth, T11 masks, T12 units, plus facts about the build). Writes one JSON. |
| `render_frames.py` | a batch of scene descriptions to float32 arrays (radiance, visible coverage, silhouette), one Blender start-up per batch. Writes `prefix.bin` (raw little-endian float32) and `prefix.json` (names, shapes, offsets, the settings used, seconds). |
| `render_cost.py` | what a frame costs: seconds per frame, samples against error, EEVEE. Three parts (`--part timing`, `spp`, `eevee`), one Blender session each. |

## The settings dict

Every convention the lesson tests is a key of `build_scene.DEFAULT` (what Blender, or a builder that does not think, gives) and `build_scene.CONFORM` (what the contract needs):
`axes`, `rows`, `lens`, `fit`, `shift_y`, `placement`, `shading`, `vertices`, `output`, `filter`, `fwidth`, `samples`, `adaptive`, `denoise`, `seed`, `world_sampling`, `mask`, `scale_length`, `res`.
`settings(k, **kw)` returns the first `k` clauses of `CLAUSES` set to the contract and the rest at the default, then applies single-key overrides. `k = 12` is the conforming build,
`k = 0` the build with everything at Blender's default; `--over '{"lens": 50.0, "fit": "AUTO"}'` leaves one clause at its default.

## Commands (run from the repository root)

```sh
BL=/Applications/Blender.app/Contents/MacOS/Blender

# the conformance suite (about 12 s) -> one JSON; --only T03,T05 runs a subset
$BL --background --factory-startup --python tools/syn_blender/render_suite.py -- --out /tmp/suite.json

# a batch of frames: scenes.json is a list of scene descriptions (SV.l08.describe(seed) in node)
$BL --background --factory-startup --python tools/syn_blender/render_frames.py -- \
    --desc scenes.json --out /tmp/prefix --k 12 --want rad,cov,amod
#   --k N          the first N clauses set (12 = all)       --over JSON   single keys applied after --k
#   --want         rad: radiance (N,3,H,W) top row first; cov: visible coverage of the pedestrian by the clause-11 setting; amod: its silhouette alone

# costs, one session per part
for p in timing spp eevee; do
  $BL --background --factory-startup --python tools/syn_blender/render_cost.py -- --desc scenes.json --out /tmp/cost_$p.json --part $p
done
```

Everything the page and the oracle need is produced by the builder, which calls these scripts (one Blender at a time, guarded by a lock directory) and runs the detector trainings:

```sh
node tools/chain/verify/engine/build_l08.js --jobs 2        # every missing job, then the merge: about 25 minutes on a 10-core machine
node tools/chain/verify/engine/build_l08.js --job suite     # -> tools/chain/syn_notes/w08/cache/suite.json
node tools/chain/verify/engine/build_l08.js --job frames    # the 24 scenes in four builds and the two path scenes at k = 0 ... 12
node tools/chain/verify/engine/build_l08.js --job cost      # -> cache/cost.json
node tools/chain/verify/engine/build_l08.js --job train:all_s1   # render in Blender (cached) and train/grade one design; tags are listed in the file's header
node tools/chain/verify/engine/build_l08.js --merge         # rewrites all_lessons/synthetic_vision/l08_data.js (what the page loads)
node tools/chain/verify/engine/build_l08.js --check         # recomputes two cells and re-renders a frame when Blender is installed
node tools/chain/verify/syn_08_the_contract_in_a_real_renderer.js   # the oracle: re-derives every number of the page; re-runs the whole suite and two frames in Blender when it exists
```

## What was measured by running this build, and is easy to get wrong

* A new camera looks down the −Z axis. A level camera that looks along +Y has `rotation_euler = (π/2, 0, 0)`. The Street's frame is left-handed and Blender's world right-handed: the map (x, y, z) → (x, z, y) is a reflection, not a rotation.
* `camera.angle` depends on the lens and the sensor only. `sensor_fit = 'AUTO'` puts the sensor width on the longer side of the frame. `shift_y` is in units of the longer side and positive moves the picture down.
* Python-side image buffers run bottom row first. `Render Result.pixels` is empty headless: write EXR or PNG and load it. Multilayer EXR needs `image_settings.media_type = 'MULTI_LAYER_IMAGE'` before `file_format = 'OPEN_EXR_MULTILAYER'`.
* Cycles' Z pass is the distance along the axis (point-sampled at the pixel centre), Mist is the distance along the ray, nothing hit reads 1e10. The Object Index pass is point-sampled; EEVEE does not deliver it. Cryptomatte and a holdout render give coverage.
  Cryptomatte ids are float32 bit patterns of a hash (convert the manifest's hex hash as the specification says).
* The default pixel filter, Blackman-Harris with width 1.5, is a window that spans twice its width (3 px). `BOX` ignores its width.
* The default colour path (8-bit PNG through AgX) is display-referred; write float EXR.
* With a node-driven sky, Cycles builds an importance map of the world at every change of the scene (0.3 s per render); `world.cycles.sampling_method = 'NONE'` removes it and changes no pixel.
* Cycles is reproducible for a fixed build, machine and settings (one thread and eight give identical pixels; another seed changes the pattern). Hash decoded pixels, not file bytes: EXR files carry time stamps.
* After a Blender update re-run the suite and the oracle: a changed default is exactly the kind of failure the lesson is about.
