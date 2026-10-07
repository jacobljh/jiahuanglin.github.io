"""build_scene.py - Lesson 8 of the Synthetic Vision Data track: a scene description (JSON, written by l08_blender.js) -> a Blender scene -> arrays.

Run under Blender only (it imports bpy):  Blender --background --factory-startup --python render_frames.py -- ARGS   (see README.md).

The scene description is in the Street's coordinates (x right, y up, z forward, metres); Blender is Z-up with the camera looking along +Y when its rotation is (90 deg, 0, 0):
the map is (x, y, z) -> (X, Y, Z) = (x, z, y).  Street frames are left-handed and Blender's world is right-handed, so the map is a reflection (det = -1), not a rotation.

Every convention the lesson tests is a key of the settings dict S.  DEFAULT holds the value Blender (or a builder that does not think) gives; CONFORM holds the value the contract needs.
Shading is by emission only: radiance = albedo * lum * (amb + (1 - amb) * max(0, n.l)) * texture, the Street's own formula, evaluated by shader nodes from the geometry normal.
So only conventions differ between the Street renderer and this one, not lighting models.  Nothing here is photorealistic and none of it is meant to be."""
import bpy, math, os, sys, json
import numpy as np

W, H = 96, 24
F_PX, V0, HC = 83.1, 9.0, 1.4
SENSOR = 36.0

DEFAULT = dict(axes='default_camera', rows='bottom_first', lens=50.0, fit='AUTO', shift_y=0.0, filter='BLACKMAN_HARRIS', fwidth=1.5, output='png8_agx',
               samples=4096, adaptive=True, denoise=True, seed=0, world_sampling='AUTOMATIC', placement='base', shading='flat', vertices=32, mask='object_index', scale_length=1.0, res=[96, 24], exr_float=True)
CONFORM = dict(axes='street', rows='top_first', lens=F_PX * SENSOR / 96.0, fit='HORIZONTAL', shift_y=-3.0 / 96.0, filter='BOX', fwidth=1.0, output='exr32',
               samples=64, adaptive=False, denoise=False, seed=-1, world_sampling='NONE', placement='centre', shading='smooth', vertices=32, mask='holdout_alpha', scale_length=1.0, res=[96, 24])
# clause -> the keys that set it; the order is the order the clauses fail in, loudest first (the widget's slider walks it)
CLAUSES = [('axes', ['axes']), ('rows', ['rows']), ('lens', ['lens', 'fit']), ('shift', ['shift_y']), ('centre', []), ('shapes', ['placement', 'shading']), ('output', ['output']),
           ('filter', ['filter', 'fwidth']), ('sampler', ['samples', 'adaptive', 'denoise', 'seed', 'world_sampling']), ('depth', []), ('mask', ['mask']), ('units', [])]


def settings(k=0, **kw):
    """the first k clauses set to the contract, the rest at Blender's defaults; kw overrides single keys"""
    S = dict(DEFAULT)
    for _, keys in CLAUSES[:k]:
        for key in keys:
            S[key] = CONFORM[key]
    S.update(kw)
    return S


def srgb_decode(v):
    v = np.asarray(v, np.float32)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)


# ---------------------------------------------------------------- meshes
def _cyl_mesh(name, n, smooth):
    """radius 1, from z = -1 to z = +1 (the proportions of Blender's own cylinder primitive: depth 2, origin at the centre).  Caps use their own vertices, so smooth shading
    rounds the side without rounding the cap edge."""
    me = bpy.data.meshes.new(name); v, f = [], []
    ang = [2 * math.pi * i / n for i in range(n)]
    for z in (-1.0, 1.0):
        for a in ang:
            v.append((math.cos(a), math.sin(a), z))
    for i in range(n):
        j = (i + 1) % n; f.append((i, j, n + j, n + i))
    for z in (-1.0, 1.0):
        base = len(v)
        for a in ang:
            v.append((math.cos(a), math.sin(a), z))
        idx = list(range(base, base + n)); f.append(tuple(idx) if z > 0 else tuple(reversed(idx)))
    me.from_pydata(v, [], f); me.update()
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons)); me.update()
    return me


def _box_mesh(name):
    me = bpy.data.meshes.new(name)
    v = [(x, y, z) for z in (-1.0, 1.0) for y in (-1.0, 1.0) for x in (-1.0, 1.0)]
    f = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    me.from_pydata(v, [], f); me.update(); me.polygons.foreach_set('use_smooth', [False] * 6); me.update()
    return me


def _plane_mesh(name, half):
    me = bpy.data.meshes.new(name); me.from_pydata([(-half, -half, 0), (half, -half, 0), (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)]); me.update(); return me


# ---------------------------------------------------------------- the emission shader that evaluates the Street's radiance formula
class Paint:
    """one shared material; per-frame constants live in value nodes, per-object ones (albedo, stripe, phase, window) in Object Info and custom properties"""
    def __init__(self):
        m = bpy.data.materials.new('street_paint'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); self.m = m
        N = lambda t: nt.nodes.new(t)
        def val(name):
            n = N('ShaderNodeValue'); n.name = name; return n
        def mat(op, a=None, b=None, c=None):
            n = N('ShaderNodeMath'); n.operation = op
            for i, x in enumerate((a, b, c)):
                if x is None: continue
                if isinstance(x, (int, float)): n.inputs[i].default_value = float(x)
                else: nt.links.new(x, n.inputs[i])
            return n.outputs[0]
        def attr(name):
            n = N('ShaderNodeAttribute'); n.attribute_type = 'OBJECT'; n.attribute_name = name; return n.outputs['Fac']
        geo = N('ShaderNodeNewGeometry'); oi = N('ShaderNodeObjectInfo')
        self.Lx, self.Ly, self.Lz = val('Lx'), val('Ly'), val('Lz'); self.amb, self.omamb, self.lum, self.wph = val('amb'), val('omamb'), val('lum'), val('wph')
        Lv = N('ShaderNodeCombineXYZ')
        for i, n in enumerate((self.Lx, self.Ly, self.Lz)): nt.links.new(n.outputs[0], Lv.inputs[i])
        dot = N('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; nt.links.new(geo.outputs['Normal'], dot.inputs[0]); nt.links.new(Lv.outputs[0], dot.inputs[1])
        mx = mat('MAXIMUM', dot.outputs['Value'], 0.0)
        sh = mat('MULTIPLY_ADD', mx, self.omamb.outputs[0], self.amb.outputs[0])
        sn_ = N('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sn_.inputs[0]); sp_ = N('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sp_.inputs[0])
        az = mat('ARCTAN2', sn_.outputs[1], sn_.outputs[0])                                  # atan2(n_y, n_x) = the Street's atan2(nz, nx)
        t1 = mat('MULTIPLY_ADD', az, 3.0, attr('ph')); t2 = mat('MULTIPLY_ADD', sp_.outputs[2], 6.0, t1)
        mst = mat('MULTIPLY_ADD', mat('SINE', t2), attr('stripe'), 1.0)
        gx = mat('FLOOR', mat('MULTIPLY_ADD', sp_.outputs[0], 1.0 / 1.6, self.wph.outputs[0])); gy = mat('FLOOR', mat('MULTIPLY', sp_.outputs[2], 1.0 / 1.8))
        k = mat('MULTIPLY_ADD', gx, 7.0, mat('MULTIPLY', gy, 13.0)); h = mat('FLOORED_MODULO', k, 4.0); isz = mat('COMPARE', h, 0.0, 0.5)
        mwin = mat('MULTIPLY_ADD', isz, mat('MULTIPLY', attr('win'), -1.0), 1.0)
        I = mat('MULTIPLY', mat('MULTIPLY', mat('MULTIPLY', sh, self.lum.outputs[0]), mst), mwin)
        col = N('ShaderNodeVectorMath'); col.operation = 'SCALE'; nt.links.new(oi.outputs['Color'], col.inputs[0]); nt.links.new(I, col.inputs[3])
        em = N('ShaderNodeEmission'); nt.links.new(col.outputs[0], em.inputs['Color']); o = N('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o.inputs['Surface'])

    def frame(self, L, amb, lum, wph):
        self.Lx.outputs[0].default_value, self.Ly.outputs[0].default_value, self.Lz.outputs[0].default_value = L[0], L[2], L[1]     # Street (x, y, z) -> Blender (X, Y, Z) = (x, z, y)
        self.amb.outputs[0].default_value = amb; self.omamb.outputs[0].default_value = 1.0 - amb; self.lum.outputs[0].default_value = lum; self.wph.outputs[0].default_value = wph


class Sky:
    """the Street's sky: a vertical blend of two colours, el = clamp(6 rho, 0, 1) with rho = tan of the ray above the horizon per unit depth = dz / dy of the ray direction"""
    def __init__(self):
        w = bpy.data.worlds.new('street_sky'); w.use_nodes = True; nt = w.node_tree; nt.nodes.clear(); self.w = w
        N = lambda t: nt.nodes.new(t)
        tc = N('ShaderNodeTexCoord'); sp = N('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sp.inputs[0])
        def mat(op, a, b):
            n = N('ShaderNodeMath'); n.operation = op; nt.links.new(a, n.inputs[0])
            if isinstance(b, (int, float)): n.inputs[1].default_value = float(b)
            else: nt.links.new(b, n.inputs[1])
            return n.outputs[0]
        rho = mat('DIVIDE', sp.outputs[2], sp.outputs[1]); el = mat('MAXIMUM', mat('MINIMUM', mat('MULTIPLY', rho, 6.0), 1.0), 0.0)
        self.dif = N('ShaderNodeCombineXYZ'); self.h = N('ShaderNodeCombineXYZ')
        sc1 = N('ShaderNodeVectorMath'); sc1.operation = 'SCALE'; nt.links.new(self.dif.outputs[0], sc1.inputs[0]); nt.links.new(el, sc1.inputs[3])
        ad = N('ShaderNodeVectorMath'); ad.operation = 'ADD'; nt.links.new(sc1.outputs[0], ad.inputs[0]); nt.links.new(self.h.outputs[0], ad.inputs[1])
        self.lum = N('ShaderNodeValue'); sc2 = N('ShaderNodeVectorMath'); sc2.operation = 'SCALE'; nt.links.new(ad.outputs[0], sc2.inputs[0]); nt.links.new(self.lum.outputs[0], sc2.inputs[3])
        bg = N('ShaderNodeBackground'); nt.links.new(sc2.outputs[0], bg.inputs['Color']); wo = N('ShaderNodeOutputWorld'); nt.links.new(bg.outputs[0], wo.inputs[0])

    def frame(self, skyH, skyZ, lum):
        for i in range(3):
            self.h.inputs[i].default_value = skyH[i]; self.dif.inputs[i].default_value = skyZ[i] - skyH[i]
        self.lum.outputs[0].default_value = lum


# ---------------------------------------------------------------- the scene
class Scene:
    def __init__(self, S):
        self.S = S = dict(S)
        sc = self.sc = bpy.context.scene
        for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
        self.paint, self.sky = Paint(), Sky(); sc.world = self.sky.w
        self.cam_d = bpy.data.cameras.new('cam'); self.cam = bpy.data.objects.new('cam', self.cam_d); sc.collection.objects.link(self.cam); sc.camera = self.cam
        self.mesh_box = _box_mesh('box')
        if S['shading'] == 'flat':          # Blender's own cylinder primitive: 32 vertices by default, flat shading, depth 2, origin at the centre
            self.mesh_cyl = _cyl_mesh('cyl', S['vertices'], False)
        else:
            self.mesh_cyl = _cyl_mesh('cyl', S['vertices'], True)
        self.mesh_ground = _plane_mesh('ground', 1.0e5)
        self.pool = {'box': [], 'cyl': []}; self.used = []
        self.ground = self._obj('ground', self.mesh_ground)
        self.configure(S)

    def _obj(self, name, mesh):
        o = bpy.data.objects.new(name, mesh)
        if not mesh.materials: mesh.materials.append(self.paint.m)
        self.sc.collection.objects.link(o); return o

    def configure(self, S):
        sc, cd = self.sc, self.cam_d
        self.S = S = dict(S)
        W_, H_ = S['res']; sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W_, H_, 100
        sc.render.engine = 'CYCLES'; cy = sc.cycles; cy.device = 'CPU'
        cy.samples = int(S['samples']); cy.use_adaptive_sampling = bool(S['adaptive']); cy.use_denoising = bool(S['denoise']); cy.pixel_filter_type = S['filter']; cy.filter_width = float(S['fwidth'])
        cy.seed = int(max(S['seed'], 0)); cy.max_bounces = 0
        self.sky.w.cycles.sampling_method = S['world_sampling']      # the sky is never a light here (every surface is an emitter): its importance map is 0.3 s of every frame
        cd.sensor_width = SENSOR; cd.lens = float(S['lens']); cd.sensor_fit = S['fit']; cd.shift_y = float(S['shift_y']); cd.shift_x = 0.0; cd.clip_start = 0.01; cd.clip_end = 1.0e6
        self.cam.location = (0.0, 0.0, HC)
        self.cam.rotation_euler = (math.pi / 2, 0.0, 0.0) if S['axes'] in ('street', 'mirrored') else (0.0, 0.0, 0.0)
        sc.unit_settings.scale_length = float(S['scale_length'])
        vs = sc.view_settings
        vs.view_transform = 'AgX' if S['output'] == 'png8_agx' else 'Standard'; vs.look = 'None'
        im = sc.render.image_settings
        if S['output'].startswith('exr'):
            im.file_format = 'OPEN_EXR'; im.color_mode = 'RGBA'; im.color_depth = '32'
        else:
            im.file_format = 'PNG'; im.color_mode = 'RGBA'; im.color_depth = '8'
        sc.render.use_stamp = False; sc.render.use_stamp_render_time = False; sc.render.use_stamp_date = False; sc.render.use_stamp_time = False

    def _take(self, kind):
        pl = self.pool[kind]
        for o in pl:
            if o.hide_render:
                o.hide_render = False; return o
        o = self._obj(kind + str(len(pl)), self.mesh_box if kind == 'box' else self.mesh_cyl); pl.append(o); return o

    def load(self, d, extra_hide=()):
        """place the parts of scene description d; returns the list of (part, object)"""
        S = self.S
        for pl in self.pool.values():
            for o in pl: o.hide_render = True; o.is_holdout = False
        self.paint.frame(d['l'], d['amb'], d['lum'], d['winPhase']); self.sky.frame(d['skyH'], d['skyZ'], d['lum'])
        g = self.ground; g.hide_render = False; g.is_holdout = False; g.color = (d['ground'],) * 3 + (1.0,); g['stripe'] = 0.0; g['ph'] = 0.0; g['win'] = 0.0; g.pass_index = 0
        sgn = -1.0 if S['axes'] == 'mirrored' else 1.0
        self.items = []
        for p in d['parts']:
            if p['kind'] == 'box':
                o = self._take('box'); h = p['y1'] - p['y0']; sx, sy, sz = p['hx'], p['hz'], h / 2
            else:
                o = self._take('cyl'); h = p['y1'] - p['y0']; sx = sy = p['r']; sz = h / 2
            zc = (p['y0'] + p['y1']) / 2 if S['placement'] == 'centre' else p['y0']        # 'base' is a builder that takes the primitive's origin for its base
            o.location = (sgn * p['x'], p['z'], zc); o.scale = (sx, sy, sz); o.rotation_euler = (0.0, 0.0, 0.0)
            o.color = tuple(p['col']) + (1.0,); o['stripe'] = float(p.get('stripe', 0.0)); o['ph'] = float(p.get('ph', 0.0)); o['win'] = float(p.get('win', 0.0))
            o.pass_index = 1 if p['cls'] == 'ped' else (2 if p['cls'] == 'van' else 3); o.is_holdout = False
            self.items.append((p, o))
        return self.items

    # ---- rendering and reading
    def _render(self, path):
        sc = self.sc; sc.render.filepath = path
        bpy.ops.render.render(write_still=True)

    def _read_image(self, path, noncolor=False):
        img = bpy.data.images.load(path, check_existing=False)
        if noncolor: img.colorspace_settings.name = 'Non-Color'
        n = img.size[0] * img.size[1] * img.channels; a = np.empty(n, np.float32); img.pixels.foreach_get(a)
        a = a.reshape(img.size[1], img.size[0], img.channels).copy(); bpy.data.images.remove(img)
        return a                                                       # bottom row first: the order of Blender's buffers

    def radiance(self, tmp, seed=None):
        """the picture as the pipeline reads it: (H, W, 3) float32.  png8_agx: decode the 8-bit PNG as if it were sRGB-encoded radiance (what a script that trusts the picture does)"""
        S = self.S; sc = self.sc; sc.render.film_transparent = False
        for _, o in self.items: o.is_holdout = False
        self.ground.is_holdout = False
        if S['seed'] < 0 and seed is not None: sc.cycles.seed = int(seed) % 2147483647
        ext = '.exr' if S['output'].startswith('exr') else '.png'
        self._render(tmp); a = self._read_image(tmp + ext, noncolor=(ext == '.png'))
        rgb = a[:, :, :3]
        if ext == '.png': rgb = srgb_decode(rgb)
        if S['rows'] == 'top_first': rgb = rgb[::-1]
        return np.ascontiguousarray(rgb)

    def alpha(self, tmp, pick, seed=None):
        """coverage of the objects with pick(part) true, holdout construction: those objects normal, every other object a holdout, world transparent"""
        S = self.S; sc = self.sc; sc.render.film_transparent = True
        for p, o in self.items: o.is_holdout = not pick(p)
        self.ground.is_holdout = True
        if S['seed'] < 0 and seed is not None: sc.cycles.seed = int(seed) % 2147483647
        im = sc.render.image_settings; fmt = (im.file_format, im.color_mode, im.color_depth)
        im.file_format = 'OPEN_EXR'; im.color_mode = 'RGBA'; im.color_depth = '32'
        self._render(tmp); a = self._read_image(tmp + '.exr')[:, :, 3]
        im.file_format, im.color_mode, im.color_depth = fmt
        sc.render.film_transparent = False
        for _, o in self.items: o.is_holdout = False
        self.ground.is_holdout = False
        return np.ascontiguousarray(a[::-1] if S['rows'] == 'top_first' else a)

    def alone(self, tmp, pick, seed=None):
        """the silhouette: only the picked objects are rendered at all (amodal mask)"""
        for p, o in self.items:
            if not pick(p): o.hide_render = True
        self.ground.hide_render = True
        try:
            a = self.alpha(tmp, pick, seed)
        finally:
            for p, o in self.items: o.hide_render = False
            self.ground.hide_render = False
        return a

    def passes(self, tmp):
        """multilayer EXR with Depth, Object Index, Mist, Cryptomatte (object): returns the parts decoded by exrio"""
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import exrio
        sc = self.sc; im = sc.render.image_settings; vl = sc.view_layers[0]; keep = (im.media_type, im.file_format)
        im.media_type = 'MULTI_LAYER_IMAGE'; im.file_format = 'OPEN_EXR_MULTILAYER'; im.color_depth = '32'; im.exr_codec = 'NONE'
        vl.use_pass_z = True; vl.use_pass_object_index = True; vl.use_pass_mist = True; vl.use_pass_cryptomatte_object = True
        sc.render.film_transparent = False
        self._render(tmp); r = exrio.read_exr(tmp + '.exr')
        vl.use_pass_z = vl.use_pass_object_index = vl.use_pass_mist = vl.use_pass_cryptomatte_object = False
        im.media_type = 'IMAGE'; im.file_format = 'OPEN_EXR' if self.S['output'].startswith('exr') else 'PNG'
        self.configure(self.S)
        return r


def save_arrays(prefix, arrays, meta=None):
    """raw little-endian float32 .bin plus a JSON header (node reads it without an EXR parser)"""
    hdr = {'arrays': {}, 'meta': meta or {}}; off = 0
    with open(prefix + '.bin', 'wb') as fh:
        for k, a in arrays.items():
            a = np.ascontiguousarray(a, dtype='<f4'); fh.write(a.tobytes()); hdr['arrays'][k] = {'shape': list(a.shape), 'offset': off}; off += a.nbytes
    json.dump(hdr, open(prefix + '.json', 'w'))


def script_args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
