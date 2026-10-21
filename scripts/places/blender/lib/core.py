"""Core of the places library: scene reset, colour helpers, the trim atlas material and the `Builder` mesh accumulator.

Conventions (binding for every archetype, see scripts/places/README.md):
  metres; +Z up in Blender (the glTF exporter writes +Y up); ground at z = 0; the main facade faces -Y (towards the camera);
  x runs left to right as seen from the camera. Polygons are given counter-clockwise seen from above (+Z) for solids.
  A face's visible side is the side its points wind counter-clockwise towards (right-hand rule); back faces are culled.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ATLAS_DIR = Path(__file__).resolve().parents[2] / 'atlas'
_slots = None


def slots():
    global _slots
    if _slots is None:
        _slots = json.loads((ATLAS_DIR / 'slots.json').read_text())
    return _slots


# ---------------------------------------------------------------------------------------------------------------- colour
def rgb(hexstr):
    """'#rrggbb' -> sRGB floats 0..1. Anything unparseable becomes mid grey."""
    try:
        h = hexstr.lstrip('#')
        if len(h) == 3:
            h = ''.join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except Exception:
        return (0.5, 0.5, 0.5)


def to_hex(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(v * 255)))) for v in c)


def lin(c):
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def shade(hexstr, f):
    """Multiply a colour by f (f<1 darker, f>1 lighter)."""
    return to_hex(tuple(min(1.0, v * f) for v in rgb(hexstr)))


def mix(a, b, t=0.5):
    ca, cb = rgb(a), rgb(b)
    return to_hex(tuple(x + (y - x) * t for x, y in zip(ca, cb)))


def jitter(hexstr, rng, amount=0.06):
    """A slightly different brightness of the same colour (rng is the job's seeded Random)."""
    return shade(hexstr, 1.0 + rng.uniform(-amount, amount))


def pick(rng, options, default='#c8c8c8'):
    return rng.choice(options) if options else default


# ---------------------------------------------------------------------------------------------------------------- scene
def reset():
    """An empty scene with metric units. Call between jobs (data from the previous job is discarded)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    return sc


def mat(slot=None):
    """The ONE shared material 'trim' (global atlas x COLOR_0). `slot` is accepted for readability only: slots are chosen per
    face through the Builder (`slot=` arguments), never per material, so a model always has exactly one material / draw call."""
    m = bpy.data.materials.get('trim')
    if m:
        return m
    m = bpy.data.materials.new('trim')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)  # factor 1 in the export (texture is not embedded)
    bsdf.inputs['Roughness'].default_value = 0.9
    for name in ('Specular IOR Level', 'Specular'):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 0.15
    img = bpy.data.images.load(str(ATLAS_DIR / 'trim.webp'), check_existing=True)
    img.colorspace_settings.name = 'sRGB'
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'COLOR_0'
    mixn = nt.nodes.new('ShaderNodeMix')
    mixn.data_type = 'RGBA'
    mixn.blend_type = 'MULTIPLY'
    mixn.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mixn.inputs[6])
    nt.links.new(vc.outputs['Color'], mixn.inputs[7])
    nt.links.new(mixn.outputs[2], bsdf.inputs['Base Color'])
    m.use_backface_culling = True
    return m


def tint(obj, hexstr, mode='set'):
    """Paint every corner of an object's COLOR_0 one colour ('set') or multiply what is there ('multiply')."""
    c = lin(rgb(hexstr))
    attr = obj.data.color_attributes.get('COLOR_0') or obj.data.color_attributes.new('COLOR_0', 'FLOAT_COLOR', 'CORNER')
    for d in attr.data:
        if mode == 'multiply':
            old = d.color
            d.color = (old[0] * c[0], old[1] * c[1], old[2] * c[2], 1.0)
        else:
            d.color = (c[0], c[1], c[2], 1.0)
    obj.data.color_attributes.active_color = attr
    obj.data.color_attributes.render_color_index = list(obj.data.color_attributes).index(attr)
    return obj


# ---------------------------------------------------------------------------------------------------------------- geometry maths
def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    l = math.sqrt(_dot(a, a))
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 1.0)


def newell(pts):
    nx = ny = nz = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return (nx, ny, nz)


def _clean(pts, eps=1e-5):
    out = []
    for p in pts:
        p = (float(p[0]), float(p[1]), float(p[2]))
        if out and abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) + abs(p[2] - out[-1][2]) < eps:
            continue
        out.append(p)
    while len(out) > 1 and abs(out[0][0] - out[-1][0]) + abs(out[0][1] - out[-1][1]) + abs(out[0][2] - out[-1][2]) < eps:
        out.pop()
    return out


def _clip(poly, k, val, keep_ge):
    """Sutherland-Hodgman against u (k=3) or v (k=4) >= val (or <= val); records are (x, y, z, u, v)."""
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        ina = a[k] >= val if keep_ge else a[k] <= val
        inb = b[k] >= val if keep_ge else b[k] <= val
        if ina:
            out.append(a)
        if ina != inb:
            t = (val - a[k]) / (b[k] - a[k])
            out.append(tuple(a[j] + (b[j] - a[j]) * t for j in range(5)))
    return out


def _uv_area(poly):
    s = 0.0
    for i, a in enumerate(poly):
        b = poly[(i + 1) % len(poly)]
        s += a[3] * b[4] - b[3] * a[4]
    return abs(s) / 2


class Builder:
    last = None
    """Accumulates faces (positions, trim-atlas UVs, per-face colour) and turns them into one Blender mesh object.

    `detail` is 0 (LOD0), 1 (LOD1) or 2 (LOD2). At 2 the builder is 'flat': every face is mapped to the plain slot and keeps only
    its colour, so LOD2 is vertex-colour only. Helper functions in the library read `b.detail` to simplify their own geometry.
    """

    def __init__(self, name='place', detail=0):
        self.name = name
        self.detail = detail
        self.flat = detail >= 2
        self.verts = []
        self.faces = []
        self.uv = []       # per face: list of (u, v) in Blender atlas UV space
        self.cols = []     # per face: linear rgb
        self.smooth = []   # per face: bool
        self.layer = []    # per face: 0 = building, 1 = site (ground, trees, cars, lamps)
        self._layer = 0
        self.tris = 0
        self.label = 'main'
        self.by_label = {}
        Builder.last = self

    def section(self, label):
        """Name the part being built; the worker reports triangles per label (find what blows a budget)."""
        self.label = label

    def site(self):
        """Context manager: faces added inside go to the 'site' object (ground pad, trees, cars...), kept apart from the building
        so the silhouette mask and bounds checks look at the building only. Both objects share the one 'trim' material."""
        outer = self

        class _Ctx:
            def __enter__(self_):
                self_.prev = outer._layer
                outer._layer = 1

            def __exit__(self_, *a):
                outer._layer = self_.prev
        return _Ctx()

    # -- slots -----------------------------------------------------------------------------------------------------
    def _rect(self, slot):
        info = slots()['slots'].get(slot)
        if info is None:
            info = slots()['slots']['plain']
        size = slots()['size']
        x, y, w, h = info['px']
        return info, (x / size, 1 - (y + h) / size, (x + w) / size, 1 - y / size)

    # -- faces -----------------------------------------------------------------------------------------------------
    def face(self, pts, slot='plain', col=None, smooth=False, uvs=None, mode=None, scale=1.0):
        """Add one polygon (>=3 points, 3D, counter-clockwise seen from the visible side).

        slot: a key of atlas/slots.json (plain-render, brick, glass-curtain ...). col: '#hex' tint (COLOR_0).
        Planar UVs are projected from the face plane and tiled at the slot's real-world tile size (the polygon is cut at tile
        borders so a 60 m wall still has crisp brick). Glazing slots map the whole polygon onto the whole slot ('fit');
        trim strips tile along u and fit v. mode='tile'|'fit'|'fitv' overrides. uvs: optional per-point (u, v) in TILE units
        (metres / tileM) when the caller knows better (curved surfaces)."""
        pts = _clean(pts)
        if len(pts) < 3:
            return
        n = newell(pts)
        nl = math.sqrt(_dot(n, n))
        if nl < 1e-8:
            return
        n = (n[0] / nl, n[1] / nl, n[2] / nl)
        if self.flat:
            info, r = self._rect('plain')
            cu, cv = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
            c = col if col else ('#2c3b48' if slot.startswith('glass') else '#d0d0d0')
            self._emit(pts, [(cu, cv)] * len(pts), c, smooth)
            return
        info, r = self._rect(slot)
        kind = info['kind']
        if mode is None:
            mode = 'fit' if kind == 'glazing' else ('fitv' if kind == 'trim' else 'tile')
        tu, tv = info['tileM'][0] * scale, info['tileM'][1] * scale
        if uvs is None:
            if abs(n[2]) > 0.85:
                t, s = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
            else:
                t = _norm(_cross((0.0, 0.0, 1.0), n))
                s = _cross(n, t)
            uvs = [(_dot(p, t) / tu, _dot(p, s) / tv) for p in pts]
        recs = [(p[0], p[1], p[2], q[0], q[1]) for p, q in zip(pts, uvs)]
        c = col if col else '#ffffff'
        if mode in ('fit', 'fitv'):
            us, vs = [q[3] for q in recs], [q[4] for q in recs]
            u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
            if mode == 'fit':
                recs = [(q[0], q[1], q[2], (q[3] - u0) / max(u1 - u0, 1e-6), (q[4] - v0) / max(v1 - v0, 1e-6)) for q in recs]
            else:
                recs = [(q[0], q[1], q[2], q[3], (q[4] - v0) / max(v1 - v0, 1e-6)) for q in recs]
        if mode in ('fit',):
            self._emit_recs(recs, r, c, smooth)
            return
        # tile: cut the polygon at integer u (and, for 'tile', v) lines
        us = [q[3] for q in recs]
        vs = [q[4] for q in recs]
        i0, i1 = math.floor(min(us) + 1e-6), math.ceil(max(us) - 1e-6)
        j0, j1 = (math.floor(min(vs) + 1e-6), math.ceil(max(vs) - 1e-6)) if mode == 'tile' else (0, 1)
        if i1 - i0 <= 1 and j1 - j0 <= 1:
            self._emit_recs([(q[0], q[1], q[2], q[3] - i0, q[4] - j0) for q in recs], r, c, smooth)
            return
        if (i1 - i0) * (j1 - j0) > 4000:  # absurdly large: stretch rather than explode
            self._emit_recs([(q[0], q[1], q[2], (q[3] - i0) / (i1 - i0), (q[4] - j0) / (j1 - j0)) for q in recs], r, c, smooth)
            return
        for i in range(i0, i1):
            strip = _clip(_clip(recs, 3, i, True), 3, i + 1, False) if len(recs) else []
            if len(strip) < 3:
                continue
            for j in range(j0, j1):
                cell = strip if mode == 'fitv' else _clip(_clip(strip, 4, j, True), 4, j + 1, False)
                if len(cell) < 3 or _uv_area(cell) < 1e-5:
                    continue
                self._emit_recs([(q[0], q[1], q[2], q[3] - i, q[4] - j) for q in cell], r, c, smooth)

    def _emit_recs(self, recs, r, col, smooth):
        recs = [q for k, q in enumerate(recs) if k == 0 or abs(q[0] - recs[k - 1][0]) + abs(q[1] - recs[k - 1][1]) + abs(q[2] - recs[k - 1][2]) > 1e-6]
        if len(recs) < 3:
            return
        pts = [(q[0], q[1], q[2]) for q in recs]
        uvs = [(r[0] + min(max(q[3], 0.0), 1.0) * (r[2] - r[0]), r[1] + min(max(q[4], 0.0), 1.0) * (r[3] - r[1])) for q in recs]
        self._emit(pts, uvs, col, smooth)

    def _emit(self, pts, uvs, col, smooth):
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.uv.append(uvs)
        self.cols.append(lin(rgb(col)))
        self.smooth.append(smooth)
        self.layer.append(self._layer)
        self.tris += len(pts) - 2
        self.by_label[self.label] = self.by_label.get(self.label, 0) + len(pts) - 2

    def facing(self, pts, hint, slot='plain', col=None, **kw):
        """Like face(), but flips the winding if needed so the visible side points along `hint` (a 3D direction)."""
        pts = _clean(pts)
        if len(pts) < 3:
            return
        if _dot(newell(pts), hint) < 0:
            pts = pts[::-1]
        self.face(pts, slot, col, **kw)

    def shared_grid(self, grid, slot, col, smooth=True, uvs=None, wrap=False, scale=1.0):
        """Quads between a 2D list of 3D points grid[i][j] (shared vertices, so `smooth` gives averaged normals).
        Each quad is (i,j) -> (i+1,j) -> (i+1,j+1) -> (i,j+1); its visible side is (row direction x column direction), i.e.
        order rows and columns so that cross product points out. wrap=True closes the grid round (row last joins row 0).
        uvs[i][j] optional (u, v) in tile units; default is metres along the grid divided by the slot's tile size."""
        rows, cols = len(grid), len(grid[0])
        nrows = rows - 1 if wrap else rows
        start = len(self.verts)
        for i in range(nrows):
            for j in range(cols):
                self.verts.append(tuple(float(x) for x in grid[i][j]))
        vid = lambda i, j: start + (i % nrows) * cols + j
        info, r = self._rect('plain' if self.flat else slot)
        ti = slots()['slots'].get(slot, slots()['slots']['plain'])
        tu, tv = ti['tileM'][0] * scale, ti['tileM'][1] * scale
        c = lin(rgb(col if col else ('#d0d0d0' if self.flat else '#ffffff')))
        if uvs is None and not self.flat:
            uvs = [[None] * cols for _ in range(rows)]
            du = [0.0] * rows
            for i in range(1, rows):
                du[i] = du[i - 1] + sum(math.dist(grid[i][j], grid[i - 1][j]) for j in range(cols)) / cols
            for i in range(rows):
                dv = 0.0
                for j in range(cols):
                    if j:
                        dv += math.dist(grid[i][j], grid[i][j - 1])
                    uvs[i][j] = (du[i] / tu, dv / tv)
        for i in range(rows - 1):
            corners = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            for j in range(cols - 1):
                cs = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                keep = []
                for (a, bb) in cs:
                    p = grid[a][bb]
                    if keep and math.dist(p, grid[keep[-1][0]][keep[-1][1]]) < 1e-6:
                        continue
                    keep.append((a, bb))
                if len(keep) > 1 and math.dist(grid[keep[0][0]][keep[0][1]], grid[keep[-1][0]][keep[-1][1]]) < 1e-6:
                    keep.pop()
                if len(keep) < 3:
                    continue
                if self.flat:
                    cu, cv = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
                    fuv = [(cu, cv)] * len(keep)
                else:
                    u0 = math.floor(min(uvs[a][bb][0] for a, bb in keep) + 1e-6)
                    v0 = math.floor(min(uvs[a][bb][1] for a, bb in keep) + 1e-6)
                    fuv = []
                    for a, bb in keep:
                        uu = min(max(uvs[a][bb][0] - u0, 0.0), 1.0)
                        vv = min(max(uvs[a][bb][1] - v0, 0.0), 1.0)
                        fuv.append((r[0] + uu * (r[2] - r[0]), r[1] + vv * (r[3] - r[1])))
                self.faces.append(tuple(vid(a, bb) for a, bb in keep))
                self.uv.append(fuv)
                self.cols.append(c)
                self.smooth.append(smooth)
                self.layer.append(self._layer)
                self.tris += len(keep) - 2
                self.by_label[self.label] = self.by_label.get(self.label, 0) + len(keep) - 2

    # -- output ------------------------------------------------------------------------------------------------------
    def objects(self, name=None, collection=None):
        """Mesh objects for everything built: [building] plus [site] when any site faces exist (named '<name>-site')."""
        name = name or self.name
        out = []
        for layer, nm in ((0, name), (1, name + '-site')):
            idx = [i for i, l in enumerate(self.layer) if l == layer]
            if not idx:
                continue
            out.append(self._make(nm, idx, collection))
        return out

    def to_object(self, name=None, collection=None):
        """Single object holding every face (building + site); prefer objects()."""
        return self._make(name or self.name, list(range(len(self.faces))), collection)

    def _make(self, name, idx, collection=None):
        remap = {}
        verts = []
        faces = []
        for i in idx:
            f = []
            for v in self.faces[i]:
                if v not in remap:
                    remap[v] = len(verts)
                    verts.append(self.verts[v])
                f.append(remap[v])
            faces.append(tuple(f))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        uv = mesh.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', [x for i in idx for p in self.uv[i] for x in p])
        attr = mesh.color_attributes.new('COLOR_0', 'FLOAT_COLOR', 'CORNER')
        colours = []
        for i in idx:
            c = self.cols[i]
            colours.extend((c[0], c[1], c[2], 1.0) * len(self.faces[i]))
        attr.data.foreach_set('color', colours)
        mesh.color_attributes.active_color = attr
        mesh.color_attributes.render_color_index = 0
        sm = [self.smooth[i] for i in idx]
        if any(sm):
            mesh.polygons.foreach_set('use_smooth', sm)
        mesh.update()
        mesh.materials.append(mat())
        obj = bpy.data.objects.new(name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


def count_triangles(objs):
    total = 0
    for o in objs:
        total += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return total


def bounds(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    return lo, hi
