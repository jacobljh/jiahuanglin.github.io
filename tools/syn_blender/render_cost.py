"""render_cost.py - what a Blender frame costs, and what the cheaper settings do to it (the cost side of Lesson 8).

  Blender --background --factory-startup --python tools/syn_blender/render_cost.py -- --desc scenes.json --out tools/chain/syn_notes/w08/cache/cost_timing.json --part timing
  (parts: timing, spp, eevee; each in its own Blender session, so that no measurement inherits the state of another; the builder merges the three files into cost.json)

Measures on this machine (timings are recorded, not derived): seconds per frame with and without the world's importance map, with the defaults (4096 samples, adaptive sampling, denoiser) and with the contract's
settings; the error of a frame against its own 4096-sample render for 1 ... 512 samples; and EEVEE on the same edge and the same frame: start-up, per-frame seconds, edge profile, passes."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import build_scene as B

TMP = '/tmp/syn_cost_%d/f' % os.getpid(); os.makedirs(os.path.dirname(TMP), exist_ok=True)
FULL = lambda p: True
ped = lambda p: p['cls'] == 'ped'


def timed(fn, n):
    t = time.time()
    for _ in range(n): fn()
    return (time.time() - t) / n


def main():
    a = B.script_args(); opt = {a[i].lstrip('-'): a[i + 1] for i in range(0, len(a), 2)}
    descs = json.load(open(opt['desc'])); d = descs[0]; res = {'blender': B.bpy.app.version_string}; part = opt.get('part', 'all')
    if part in ('all', 'timing'):
        # 1. seconds per frame (radiance + pedestrian alpha), contract settings, with and without the world's importance map; defaults
        def frame_cost(S, reps=5):                      # the best of `reps` passes over six scenes: the machine is shared, and the fastest pass is the one least disturbed
            scn = B.Scene(S); scn.load(descs[0]); scn.radiance(TMP, 1)
            def one():
                for i in range(6):
                    scn.load(descs[i % len(descs)]); scn.radiance(TMP, i)
                    if descs[i % len(descs)]['ped']: scn.alpha(TMP, ped, i)
            return min(timed(one, 1) for _ in range(reps)) / 6
        res['sec_frame'] = {'contract': frame_cost(B.settings(12)), 'world_map_on': frame_cost(B.settings(12, world_sampling='AUTOMATIC')),
                            'defaults': frame_cost(B.settings(12, samples=4096, adaptive=True, denoise=True, world_sampling='AUTOMATIC', seed=0), 3)}
        # does the world's importance map change a pixel?  the first six scenes with the contract's settings, with and without it
        def six(S):
            scn = B.Scene(S); out = []
            for i in range(6):
                scn.load(descs[i]); out.append(scn.radiance(TMP, i))
            return out
        res['world_map_maxdiff'] = float(max(np.abs(x - y).max() for x, y in zip(six(B.settings(12)), six(B.settings(12, world_sampling='AUTOMATIC')))))
    if part in ('all', 'spp'):
        # 2. samples against error: radiance of scene 0 at 1 ... 512 samples against its 4096-sample render with another seed (no adaptive sampling, no denoiser)
        S = B.settings(12, samples=4096); scn = B.Scene(S); scn.load(d); ref = scn.radiance(TMP, 6); curve = {}                       # the reference has its own seed: it must not share its first samples with the renders it judges
        for spp in (1, 2, 4, 8, 16, 32, 64, 128, 256, 512):
            scn.configure(B.settings(12, samples=spp)); scn.load(d); t = time.time(); r = scn.radiance(TMP, 5); sec = time.time() - t; e = np.abs(r - ref)
            curve[str(spp)] = {'rms': float(np.sqrt((e ** 2).mean())), 'mean': float(e.mean()), 'p99': float(np.quantile(e, 0.99)), 'sec': sec}
        res['spp_curve'] = curve
    if part in ('all', 'eevee'):
        # 3. EEVEE: the edge at a pixel boundary (u = 40), the same frame, start-up and per-frame seconds, the passes it delivers
        F, xe = B.F_PX, (40.0 - 48.0) * 10.0 / B.F_PX
        edge = {'seed': 1, 'parts': [{'pid': 0, 'id': 0, 'cls': 'ped', 'role': None, 'kind': 'box', 'x': xe + 30.0, 'z': 10.0, 'hx': 30.0, 'hz': 1e-4, 'y0': 0.0, 'y1': 8.0, 'col': [1.0] * 3, 'stripe': 0.0, 'ph': 0.0, 'win': 0.0}],
                'l': [0.3, 0.8, -0.5], 'amb': 1.0, 'lum': 1.0, 'ground': 0.0, 'skyH': [0.0] * 3, 'skyZ': [0.0] * 3, 'winPhase': 0.0, 'ped': True}
        S = B.settings(12); scn = B.Scene(S); sc = scn.sc; sc.render.engine = 'BLENDER_EEVEE'
        scn.load(edge); t = time.time(); r0 = scn.radiance(TMP, 1); first = time.time() - t
        ev = {'first_sec': first}
        secs = []
        for i in range(6):
            scn.load(descs[i]); t = time.time(); scn.radiance(TMP, 1); secs.append(time.time() - t)
        ev['frame_sec'] = float(min(secs[1:]))
        ev['filter_size_default'] = float(sc.render.filter_size); ev['taa_render_samples'] = int(sc.eevee.taa_render_samples)
        prof = {}
        for fs in (1.5, 1.0, 0.0):
            sc.render.filter_size = fs; scn.load(edge); a = scn.radiance(TMP, 1)[:, :, 0]; prof[str(fs)] = [float(x) for x in a[12, 37:44]]
        ev['edge_profile'] = prof
        sc.render.filter_size = 1.5
        # the same frame as Cycles renders it
        scn.load(d); e1 = scn.radiance(TMP, 1)
        sc.render.engine = 'CYCLES'; scn.configure(B.settings(12, samples=4096)); scn.load(d); c1 = scn.radiance(TMP, 5)
        ev['frame_vs_cycles_mean_abs'] = float(np.abs(e1 - c1).mean()); ev['frame_vs_cycles_p99'] = float(np.quantile(np.abs(e1 - c1), 0.99))
        res['eevee'] = ev
        # EEVEE multilayer passes: does an Object Index part exist?
        sc.render.engine = 'BLENDER_EEVEE'
        try:
            scn.load(d); r = scn.passes(TMP); ev['passes'] = sorted(r['parts'].keys())
        except Exception as ex:
            ev['passes_error'] = str(ex)[:200]
    json.dump(res, open(opt['out'], 'w'))


main()
