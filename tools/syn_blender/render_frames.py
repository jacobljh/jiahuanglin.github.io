"""render_frames.py - a batch of scene descriptions -> radiance, coverage (and silhouette) arrays, one Blender start-up per batch.

  Blender --background --factory-startup --python tools/syn_blender/render_frames.py -- --desc scenes.json --out cache/prefix [--k 12] [--over '{"filter":"BLACKMAN_HARRIS","fwidth":1.5}'] [--want rad,cov,amod] [--log file]

scenes.json  a list of scene descriptions (l08_blender.js, describe()).
--k N        the first N clauses of build_scene.CLAUSES are set to the contract, the rest stay at Blender's defaults (N = 12: everything set).
--over JSON  single keys of the settings dict, applied after --k (this is how one defective variant is made).
--want       rad: radiance (N, 3, H, W) planar, top row first;  cov: the pedestrian's visible coverage (N, H, W) by the clause-11 setting (holdout alpha, or the Object Index);
             amod: the pedestrian's silhouette alone (N, H, W).
Output: prefix.bin (raw little-endian float32) + prefix.json (names, shapes, offsets, settings used, seconds)."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import build_scene as B


def main():
    a = B.script_args(); opt = {}
    i = 0
    while i < len(a):
        opt[a[i].lstrip('-')] = a[i + 1]; i += 2
    descs = json.load(open(opt['desc'])); k = int(opt.get('k', 12)); over = json.loads(opt.get('over', '{}')); want = opt.get('want', 'rad,cov').split(',')
    S = B.settings(k, **over); tmp = opt.get('tmp', '/tmp/syn_blender_%d' % os.getpid()); os.makedirs(tmp, exist_ok=True); tmpf = os.path.join(tmp, 'f')
    scn = B.Scene(S); N = len(descs); Hh, Ww = S['res'][1], S['res'][0]
    out = {'rad': np.zeros((N, 3, Hh, Ww), np.float32)}
    if 'cov' in want: out['cov'] = np.zeros((N, Hh, Ww), np.float32)
    if 'amod' in want: out['amod'] = np.zeros((N, Hh, Ww), np.float32)
    ped = lambda p: p['cls'] == 'ped'
    t0 = time.time(); log = open(opt['log'], 'a') if 'log' in opt else None
    for n, d in enumerate(descs):
        scn.load(d); seed = d['seed']
        rad = scn.radiance(tmpf, seed); out['rad'][n] = np.moveaxis(rad, 2, 0)
        if d.get('ped') and ('cov' in want or 'amod' in want):
            if 'cov' in want:
                if S['mask'] == 'holdout_alpha':
                    out['cov'][n] = scn.alpha(tmpf, ped, seed)
                else:
                    r = scn.passes(tmpf); idx = r['parts']['ViewLayer.Object Index']['ViewLayer.Object Index.X']; c = (np.abs(idx - 1.0) < 0.5).astype(np.float32)
                    out['cov'][n] = c[::-1] if S['rows'] == 'bottom_first' else c
            if 'amod' in want: out['amod'][n] = scn.alone(tmpf, ped, seed)
        if log and (n % 100 == 99 or n == N - 1): log.write('%s %d/%d %.1fs\n' % (os.path.basename(opt['out']), n + 1, N, time.time() - t0)); log.flush()
    B.save_arrays(opt['out'], out, {'settings': S, 'k': k, 'over': over, 'n': N, 'seconds': time.time() - t0, 'blender': B.bpy.app.version_string})


main()
