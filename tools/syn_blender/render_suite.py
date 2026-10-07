"""render_suite.py - the conformance suite: one analytic scene per clause of the contract, rendered by Blender with the clause at its default and set.

  Blender --background --factory-startup --python tools/syn_blender/render_suite.py -- --out tools/chain/syn_notes/w08/cache/suite.json

Every scene is flat emission (amb = 1, lum = 1: radiance = albedo), so what is measured is geometry, sampling and encoding, not lighting.  The script only RECORDS what Blender returned
(small arrays: a row, a column, a few patches); the closed-form truth and the error of each test are computed by l08_blender.js (and re-derived by the oracle).
Each test is a function t_NN returning {variant name: {array name: nested list}} plus facts about Blender (the values measured by running it)."""
import sys, os, json, time, math, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import build_scene as B

F, V0, HC = B.F_PX, B.V0, B.HC
TMP = '/tmp/syn_suite_%d/f' % os.getpid(); os.makedirs(os.path.dirname(TMP), exist_ok=True)
FULL = lambda p: True


def desc(parts, sky=0.0, ground=0.0, ped=True, **kw):
    d = {'seed': 1, 'parts': parts, 'l': [0.3, 0.8, -0.5], 'amb': 1.0, 'lum': 1.0, 'ground': ground, 'skyH': [sky] * 3, 'skyZ': [sky] * 3, 'winPhase': 0.0, 'ped': ped}
    d.update(kw); return d


def box(x, z, hx, hz, y0=0.0, y1=3.0, col=1.0, cls='ped', pid=0):
    return {'pid': pid, 'id': pid, 'cls': cls, 'role': None, 'kind': 'box', 'x': x, 'z': z, 'hx': hx, 'hz': hz, 'y0': y0, 'y1': y1, 'col': list(col) if isinstance(col, (list, tuple)) else [col] * 3, 'stripe': 0.0, 'ph': 0.0, 'win': 0.0}


def cyl(x, z, r, y0=0.0, y1=3.0, col=1.0, cls='ped', pid=0):
    return {'pid': pid, 'id': pid, 'cls': cls, 'role': None, 'kind': 'cyl', 'x': x, 'z': z, 'r': r, 'y0': y0, 'y1': y1, 'col': [col] * 3, 'stripe': 0.0, 'ph': 0.0, 'win': 0.0}


def rnd(a, nd=6):
    return np.round(np.asarray(a, np.float64), nd).tolist()


def scene_for(S):
    return B.Scene(S)


def rad(scn, d, seed=1, ch=0):
    scn.load(d); a = scn.radiance(TMP, seed); return a if ch is None else a[:, :, ch]


def alpha(scn, d, pick=FULL, seed=1):
    scn.load(d); return scn.alpha(TMP, pick, seed)


# ------------------------------------------------------------------ the tests
def t01_axes():
    """a post at x = +2 m, z = 10 m (right of centre) and one at x = -2 m, z = 5 m (left, nearer and so wider): where do they land?"""
    d = desc([box(2.0, 10.0, 0.15, 0.15, col=(0.0, 1.0, 0.0), pid=0), box(-2.0, 5.0, 0.15, 0.15, col=(1.0, 0.0, 0.0), pid=1)]); out = {}      # the right post is green, the left one red
    for v in ('default_camera', 'street', 'mirrored'):
        scn = scene_for(B.settings(12, axes=v)); a = rad(scn, d, ch=None); out[v] = {'red': rnd(a[:, :, 0]), 'green': rnd(a[:, :, 1])}
    return out


def t02_lens():
    """two slabs facing the camera at z = 10 m, the left one red with its right edge at x = -1.5 m, the right one green with its left edge at x = +1.5 m: the edges are 3 f / 10 pixels apart"""
    def slabs(x0, w=30.0):
        return desc([box(-x0 - w, 10.0, w, 1e-4, y0=0.0, y1=8.0, col=(1.0, 0.0, 0.0), pid=0), box(x0 + w, 10.0, w, 1e-4, y0=0.0, y1=8.0, col=(0.0, 1.0, 0.0), pid=1)])
    out = {}
    for name, kw in (('default', dict(lens=50.0, fit='AUTO')), ('set', {})):
        a = rad(scene_for(B.settings(12, **kw)), slabs(1.5), ch=None); out[name] = {'red': rnd(a[:, :, 0]), 'green': rnd(a[:, :, 1])}
    # the same lens in a portrait frame, 24 wide and 96 tall (the principal point is then at the middle of the frame): slabs at x = -0.8 and +0.8
    for name, fit in (('portrait_auto', 'AUTO'), ('portrait_horizontal', 'HORIZONTAL')):
        S = B.settings(12, fit=fit, res=[24, 96], shift_y=0.0); a = rad(scene_for(S), slabs(0.8), ch=None); out[name] = {'red': rnd(a[:, :, 0]), 'green': rnd(a[:, :, 1])}
    return out


def t03_shift():
    """sky above, ground below, nothing else: the boundary is the horizon, at the principal point's row"""
    d = desc([], sky=1.0, ground=0.0, ped=False); out = {}
    for name, kw in (('default', dict(shift_y=0.0)), ('set', {})):
        out[name] = {'rad': rnd(rad(scene_for(B.settings(12, **kw)), d))}
    return out


def t04_centre():
    """a vertical edge at u = 40.25 (a slab facing the camera, covering everything to its right): the sum of its row is 96 - 40.25"""
    xe = (40.25 - 48.0) * 10.0 / F; out = {}
    d = desc([box(xe + 30.0, 10.0, 30.0, 1e-4, y0=0.0, y1=8.0, pid=0)])
    out['set'] = {'rad': rnd(rad(scene_for(B.settings(12)), d))}
    return out


def t05_rows():
    d = desc([], sky=1.0, ground=0.0, ped=False); out = {}
    for name, kw in (('default', dict(rows='bottom_first')), ('set', {})):
        out[name] = {'rad': rnd(rad(scene_for(B.settings(12, **kw)), d))}
    return out


def t06_filter():
    """the edge-spread function: a step at u = 40 + k/16, k = 0..15, seen through each pixel filter; only the pixels 36..45 of the middle row are kept"""
    out = {}
    for name, (ft, fw) in (('bh15', ('BLACKMAN_HARRIS', 1.5)), ('bh10', ('BLACKMAN_HARRIS', 1.0)), ('gauss15', ('GAUSSIAN', 1.5)), ('box10', ('BOX', 1.0)), ('box15', ('BOX', 1.5))):
        scn = scene_for(B.settings(12, filter=ft, fwidth=fw, samples=256)); rows = []
        for k in range(16):
            xe = (40.0 + k / 16.0 - 48.0) * 10.0 / F
            rows.append(rad(scn, desc([box(xe + 30.0, 10.0, 30.0, 1e-4, y0=0.0, y1=8.0, pid=0)]))[12, 34:47])
        out[name] = {'esf': rnd(rows)}
    # a sliver 0.5 px wide centred in pixel 60: total area and peak, box against the default
    for name, (ft, fw) in (('bh15', ('BLACKMAN_HARRIS', 1.5)), ('box10', ('BOX', 1.0))):
        scn = scene_for(B.settings(12, filter=ft, fwidth=fw, samples=256)); hx = 0.5 * 10.0 / (2 * F)
        a = rad(scn, desc([box((60.5 - 48.0) * 10.0 / F, 10.0, hx, 1e-4, y0=0.0, y1=8.0, pid=0)]))
        out[name]['sliver'] = rnd(a[12, 55:66])
    return out


def t07_colour():
    """a flat frame of known radiance, through each output: what the pipeline reads back as radiance"""
    out = {}
    for name, o in (('png8_agx', 'png8_agx'), ('png8_standard', 'png8_standard'), ('exr32', 'exr32')):
        vals = []
        for r in (0.02, 0.05, 0.18, 0.5, 0.95):
            S = B.settings(12, output=o)
            scn = scene_for(S); d = desc([], sky=r, ground=r, ped=False); scn.load(d); a = scn.radiance(TMP, 1)
            vals.append([float(a[:, :, c].mean()) for c in range(3)] + [float(a[:, :, 0].std())])
        out[name] = {'patches': rnd(vals, 7)}
    return out


def t08_sampler():
    """an edge at u = 40.25 and a 0.3 px sliver at 60.4..60.7, rendered with the settings left at their defaults and with each one set; plus determinism checks"""
    xe = (40.25 - 48.0) * 10.0 / F; hx = 0.3 * 10.0 / (2 * F); xs = (20.55 - 48.0) * 10.0 / F
    d = desc([box(xe + 30.0, 10.0, 30.0, 1e-4, y0=0.0, y1=8.0, pid=0), box(xs, 10.0, hx, 1e-4, y0=0.0, y1=8.0, col=1.0, pid=1)])      # the sliver covers u 20.4 .. 20.7
    out, facts = {}, {}
    variants = (('set', {}), ('default', dict(samples=4096, adaptive=True, denoise=True, world_sampling='AUTOMATIC', seed=0)), ('denoise_only', dict(denoise=True)), ('adaptive_only', dict(adaptive=True, samples=4096)),
                ('spp1', dict(samples=1)), ('spp4', dict(samples=4)), ('spp16', dict(samples=16)), ('spp256', dict(samples=256)), ('spp1024', dict(samples=1024)))
    for name, kw in variants:
        S = B.settings(12, **kw); scn = scene_for(S); scn.load(d); t0 = time.time(); a = scn.radiance(TMP, 1)[:, :, 0]; dt = time.time() - t0
        scn.load(d); t1 = time.time(); a = scn.radiance(TMP, 1)[:, :, 0]; dt2 = time.time() - t1
        out[name] = {'rad': rnd(a[12]), 'sec': round(dt2, 4)}
    # determinism under the conforming settings: same twice, other seed, one thread against all
    S = B.settings(12); scn = scene_for(S); scn.load(d)
    a1 = scn.radiance(TMP, 1); a2 = scn.radiance(TMP, 1); a3 = scn.radiance(TMP, 2)
    scn.sc.render.threads_mode = 'FIXED'; scn.sc.render.threads = 1; a4 = scn.radiance(TMP, 1); scn.sc.render.threads = 8; a5 = scn.radiance(TMP, 1); scn.sc.render.threads_mode = 'AUTO'
    h = lambda a: hashlib.sha1(np.ascontiguousarray(a).tobytes()).hexdigest()[:12]
    facts['same_twice_maxdiff'] = float(np.abs(a1 - a2).max()); facts['other_seed_maxdiff'] = float(np.abs(a1 - a3).max()); facts['one_thread_maxdiff'] = float(np.abs(a1 - a4).max()); facts['eight_threads_maxdiff'] = float(np.abs(a1 - a5).max())
    facts['hash_a1'] = h(a1); facts['hash_a2'] = h(a2)
    # the same under the defaults (adaptive sampling and the denoiser on): is it reproducible?
    S = B.settings(12, samples=4096, adaptive=True, denoise=True, world_sampling='AUTOMATIC', seed=0); scn = scene_for(S); scn.load(d)
    b1 = scn.radiance(TMP, 1); b2 = scn.radiance(TMP, 1)
    facts['default_same_twice_maxdiff'] = float(np.abs(b1 - b2).max())
    out['facts'] = facts
    return out


def t09_shapes():
    out = {}
    # (a) a pedestrian-like cylinder, radius 0.25 m, 0 .. 1.7 m, at x = 0, z = 10: which rows does it cover?
    d = desc([cyl(0.0, 10.0, 0.25, 0.0, 1.7, pid=0)])
    for name, pl in (('base', 'base'), ('centre', 'centre')):
        out['placement_' + name] = {'col': rnd(alpha(scene_for(B.settings(12, placement=pl)), d)[:, 48])}
    # (b) shading: a wide cylinder lit by the Street's formula; row 12, the Street renders the reference
    p = cyl(0.0, 12.0, 1.5, 0.0, 3.0, col=0.8, pid=0); p['cls'] = 'tree'
    d = desc([p], sky=0.0, ground=0.3, ped=False, l=[0.6, 0.5, -0.62], amb=0.3, lum=0.9)
    for name, sh in (('flat', 'flat'), ('smooth', 'smooth')):
        S = B.settings(12, shading=sh); scn = scene_for(S); scn.load(d); a = scn.radiance(TMP, 1)
        out['shading_' + name] = {'row': rnd(a[11, :, 0]), 'desc': d}
    # (c) polygon count: a cylinder of radius 2 m at z = 15 seen through 8, 16, 32 and 128 sides
    d = desc([cyl(0.0, 15.0, 2.0, 0.0, 3.0, pid=0)])
    for nv in (8, 16, 32, 128):
        out['vertices_%d' % nv] = {'row': rnd(alpha(scene_for(B.settings(12, vertices=nv, samples=1024)), d)[12])}
    return out


def t10_depth():
    """the Depth and Mist passes of a ground plane and a wall at z = 20"""
    d = desc([box(0.0, 20.0, 90.0, 0.05, y0=0.0, y1=8.0, cls='wall', pid=0)], ped=False); out = {}
    scn = scene_for(B.settings(12)); scn.load(d); r = scn.passes(TMP)
    z = r['parts']['ViewLayer.Depth']['ViewLayer.Depth.Z']; m = r['parts']['ViewLayer.Mist']['ViewLayer.Mist.Z']
    w = scn.sky.w.mist_settings
    out['set'] = {'z': rnd(z, 5), 'mist': rnd(m, 6), 'mist_start': w.start, 'mist_depth': w.depth, 'mist_falloff': w.falloff}
    # what the passes hold where nothing is hit: a frame with the sky above a ground plane, the top-left pixel (the Street's depth and range read 0 there)
    scn.load(desc([], sky=1.0, ground=0.0, ped=False)); r = scn.passes(TMP)
    out['sky'] = {'z': float(r['parts']['ViewLayer.Depth']['ViewLayer.Depth.Z'][0, 0]), 'mist': float(r['parts']['ViewLayer.Mist']['ViewLayer.Mist.Z'][0, 0])}
    return out


def t11_masks():
    """three slivers, each a thin slab facing the camera at z = 20: A covers u 40.1..40.4 (misses the pixel centre), B 60.4..60.7 (contains it), C 20.35..22.65 (2.3 px wide)"""
    z = 20.0; xs = lambda u: (u - 48.0) * z / F; parts = []
    for i, (u0, u1) in enumerate(((40.1, 40.4), (60.4, 60.7), (20.35, 22.65))):
        parts.append(box((xs(u0) + xs(u1)) / 2, z, (xs(u1) - xs(u0)) / 2, 1e-4, y0=0.0, y1=3.0, pid=i))
    d = desc(parts); out = {}
    S = B.settings(12); scn = scene_for(S); scn.load(d)
    out['holdout_alpha'] = {'cov': rnd(scn.alpha(TMP, FULL, 1))}
    r = scn.passes(TMP)
    idx = r['parts']['ViewLayer.Object Index']['ViewLayer.Object Index.X']; out['object_index'] = {'cov': rnd((np.abs(idx - 1.0) < 0.5).astype(np.float32))}
    # cryptomatte: three layers of (id, coverage, id, coverage); sum the coverage of the ids of the three slabs
    meta = r['meta']; man = None
    for k, v in meta.items():
        if k[1].endswith('/manifest'): man = json.loads(v)
    def f32(h):                                    # the Cryptomatte specification's hash -> float32 bit pattern (the exponent is kept away from 0 and 255)
        h = int(h, 16); m = h & 0x7FFFFF; e = min(max((h >> 23) & 255, 1), 254); return np.uint32(((h >> 31) << 31) | (e << 23) | m)
    names = {o.name for _, o in scn.items}; ids = {f32(man[n]) for n in names if n in man}
    cov = np.zeros((24, 96), np.float64)
    for part in ('ViewLayer.CryptoObject00', 'ViewLayer.CryptoObject01', 'ViewLayer.CryptoObject02'):
        c = {k.split('.')[-1]: v for k, v in r['parts'][part].items()}
        for idc, cc in (('r', 'g'), ('b', 'a')):
            bits = np.ascontiguousarray(c[idc]).view(np.uint32)
            for i in ids: cov += np.where(bits == i, c[cc], 0.0)
    out['cryptomatte'] = {'cov': rnd(cov)}
    out['facts'] = {'crypto_manifest_names': sorted(man.keys())[:8], 'crypto_ids': len(ids)}
    return out


def t12_units():
    d = desc([box(0.0, 10.0, 90.0, 0.05, y0=0.0, y1=8.0, cls='wall', pid=0)], ped=False); out = {}
    for name, sl in (('metre', 1.0), ('centimetre', 0.01)):
        scn = scene_for(B.settings(12, scale_length=sl)); scn.load(d); r = scn.passes(TMP)
        z = r['parts']['ViewLayer.Depth']['ViewLayer.Depth.Z']; out[name] = {'z_centre': float(z[10, 48]), 'scale_length': sl}
    return out


def t13_facts():
    """facts about Blender itself, read from the running build"""
    import bpy
    f = {'version': bpy.app.version_string, 'engine_default': 'BLENDER_EEVEE'}
    sc = bpy.context.scene
    f['engines'] = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    bpy.ops.mesh.primitive_cylinder_add(); c = bpy.context.object; ms = c.data
    zs = [v.co.z for v in ms.vertices]; xs = [v.co.x for v in ms.vertices]
    f['cylinder_primitive'] = {'vertices': len(ms.vertices) // 2, 'z_min': min(zs), 'z_max': max(zs), 'x_max': max(xs), 'flat': not any(p.use_smooth for p in ms.polygons)}
    bpy.ops.mesh.primitive_cube_add(); cb = bpy.context.object; f['cube_primitive'] = {'extent': max(v.co.x for v in cb.data.vertices) - min(v.co.x for v in cb.data.vertices)}
    return f


TESTS = [('T01', t01_axes), ('T02', t02_lens), ('T03', t03_shift), ('T04', t04_centre), ('T05', t05_rows), ('T06', t06_filter), ('T07', t07_colour), ('T08', t08_sampler),
         ('T09', t09_shapes), ('T10', t10_depth), ('T11', t11_masks), ('T12', t12_units)]


def main():
    a = B.script_args(); opt = {a[i].lstrip('-'): a[i + 1] for i in range(0, len(a), 2)}
    only = opt.get('only', '').split(',') if opt.get('only') else None
    res = {}; t0 = time.time()
    for name, fn in TESTS:
        if only and name not in only: continue
        t = time.time(); res[name] = fn(); res[name + '_sec'] = round(time.time() - t, 2)
        print('SUITE', name, round(time.time() - t, 1), 's', flush=True)
    if not only or 'F' in only: res['blender'] = t13_facts()
    res['blender_version'] = B.bpy.app.version_string; res['seconds'] = round(time.time() - t0, 1)
    json.dump(res, open(opt['out'], 'w'))


main()
