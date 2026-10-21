"""Preview renders (EEVEE, atlas applied, soft sun + sky) and the front silhouette mask. Cameras/lights exist only after these calls."""
import math

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

from .core import bounds, lin, rgb


def _engine(sc, prefer):
    ids = {e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items}
    for name in prefer:
        if name in ids:
            sc.render.engine = name
            return name
    return sc.render.engine


def _corners(lo, hi, objs=None):
    if objs:
        pts = []
        for o in objs:
            vs = o.data.vertices
            step = max(1, len(vs) // 2500)
            pts.extend(o.matrix_world @ vs[i].co for i in range(0, len(vs), step))
        return pts
    return [Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def _fit(sc, cam, centre, direction, corners, margin=0.035):
    """Place the camera along `direction` from `centre` far enough that all corners fit, then recentre with lens shift."""
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    lo_d, hi_d = 1.0, 4000.0
    for _ in range(40):
        d = (lo_d + hi_d) / 2
        cam.location = centre + direction * d
        bpy.context.view_layer.update()
        pts = [world_to_camera_view(sc, cam, c) for c in corners]
        fits = all(margin <= p.x <= 1 - margin and margin <= p.y <= 1 - margin for p in pts)
        if fits:
            hi_d = d
        else:
            lo_d = d
    cam.location = centre + direction * hi_d
    cam.data.shift_x = cam.data.shift_y = 0
    bpy.context.view_layer.update()
    pts = [world_to_camera_view(sc, cam, c) for c in corners]
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    cam.data.shift_x, cam.data.shift_y = cx - 0.5, cy - 0.5


def look(sc, centre, lo, span, ground_hex, prefix='pv', samples=24, size_px=768):
    """The shared look for preview and photo-match renders: AgX view transform, Nishita sky with a touch of haze, a warm soft-edged
    sun, ray-traced AO/GI, anisotropic texture filtering and a noise-varied ground that fades into the horizon haze. Returns the
    created objects (caller deletes them after rendering)."""
    try:
        bpy.context.preferences.system.anisotropic_filter = '16'
    except Exception:  # noqa: BLE001
        pass
    for tr in ('AgX', 'Filmic', 'Standard'):
        try:
            sc.view_settings.view_transform = tr
            break
        except TypeError:
            continue
    for lk in ('AgX - Medium High Contrast', 'Medium High Contrast', 'None'):
        try:
            sc.view_settings.look = lk
            break
        except TypeError:
            continue
    sc.view_settings.exposure = 0.2
    sc.render.filter_size = 0.8
    sc.view_settings.gamma = 1.0
    for attr, val in (('taa_render_samples', samples), ('use_raytracing', True), ('use_shadows', True), ('shadow_ray_count', 2),
                      ('shadow_step_count', 6), ('use_gtao', True), ('gtao_distance', max(2.0, span * 0.04)), ('gtao_factor', 1.0),
                      ('fast_gi_distance', max(3.0, span * 0.25)), ('use_fast_gi', True)):
        try:
            setattr(sc.eevee, attr, val)
        except Exception:  # noqa: BLE001
            pass
    # --- sky with haze
    world = bpy.data.worlds.new(prefix + '-world')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    try:
        tcw = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tcw.outputs['Object'], sep.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.clamp = True
        mr.inputs['From Min'].default_value = 0.0
        mr.inputs['From Max'].default_value = 0.55
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (*lin((0.66, 0.78, 0.93)), 1.0)    # hazy horizon
        ramp.color_ramp.elements[1].position = 1.0
        ramp.color_ramp.elements[1].color = (*lin((0.16, 0.42, 0.92)), 1.0)    # zenith
        nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = 0.8
    except Exception as ex:  # noqa: BLE001
        print('[look] sky fallback', repr(ex))
        bg.inputs['Color'].default_value = (*lin((0.70, 0.80, 0.92)), 1.0)
        bg.inputs['Strength'].default_value = 0.85
    sc.world = world
    # --- ground: ground colour with soft large-scale variation, fading to haze with distance
    gm = bpy.data.materials.new(prefix + '-ground')
    gm.use_nodes = True
    gt = gm.node_tree
    bsdf = gt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 1.0
    base = lin(rgb(ground_hex))
    try:
        tc = gt.nodes.new('ShaderNodeTexCoord')
        noise = gt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 0.35 / max(1.0, span / 40.0)
        noise.inputs['Detail'].default_value = 6.0
        mul = gt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs[0].default_value = 0.35
        mul.inputs[7].default_value = (0.8, 0.8, 0.8, 1.0)
        ramp = gt.nodes.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = 0.3
        ramp.inputs['From Max'].default_value = 0.7
        ramp.inputs['To Min'].default_value = 0.78
        ramp.inputs['To Max'].default_value = 1.12
        basec = gt.nodes.new('ShaderNodeRGB')
        basec.outputs[0].default_value = (*base, 1.0)
        tint = gt.nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.blend_type = 'MULTIPLY'
        tint.inputs[0].default_value = 1.0
        vlen = gt.nodes.new('ShaderNodeVectorMath')
        vlen.operation = 'LENGTH'
        dist = gt.nodes.new('ShaderNodeMapRange')
        dist.inputs['From Min'].default_value = 0.0
        dist.inputs['From Max'].default_value = 1.0
        haze = gt.nodes.new('ShaderNodeMix')
        haze.data_type = 'RGBA'
        haze.inputs[7].default_value = (*lin((0.64, 0.74, 0.84)), 1.0)
        fade = max(60.0, span * 4.0)
        dist.inputs['From Min'].default_value = span * 6.0 + 60.0
        dist.inputs['From Max'].default_value = span * 45.0 + 200.0
        dist.inputs['To Min'].default_value = 0.0
        dist.inputs['To Max'].default_value = 0.75
        dist.clamp = True
        gt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
        gt.links.new(noise.outputs['Fac'], ramp.inputs['Value'])
        # variation as grey factor into a multiply with the ground colour
        grey = gt.nodes.new('ShaderNodeCombineColor')
        for ch in ('Red', 'Green', 'Blue'):
            gt.links.new(ramp.outputs['Result'], grey.inputs[ch])
        gt.links.new(basec.outputs[0], tint.inputs[6])
        gt.links.new(grey.outputs['Color'], tint.inputs[7])
        gt.links.new(tc.outputs['Object'], vlen.inputs[0])
        gt.links.new(vlen.outputs['Value'], dist.inputs['Value'])
        gt.links.new(dist.outputs['Result'], haze.inputs[0])
        gt.links.new(tint.outputs[2], haze.inputs[6])
        gt.links.new(haze.outputs[2], bsdf.inputs['Base Color'])
    except Exception as ex:  # noqa: BLE001
        print('[look] ground fallback', repr(ex))
        bsdf.inputs['Base Color'].default_value = (*base, 1.0)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(centre.x, centre.y, lo[2] - 0.04))
    plane = bpy.context.active_object
    plane.scale = (span * 60, span * 60, 1)
    plane.data.materials.append(gm)
    # --- sun: warm, slightly soft, from the front-left and fairly high
    sun_d = bpy.data.lights.new(prefix + '-sun', 'SUN')
    sun_d.energy = 5.0
    sun_d.color = (1.0, 0.95, 0.86)
    sun_d.angle = math.radians(2.5)
    sun = bpy.data.objects.new(prefix + '-sun', sun_d)
    sc.collection.objects.link(sun)
    sun.rotation_euler = (-Vector((-0.6, -0.7, 0.9))).to_track_quat('-Z', 'Y').to_euler()
    return [plane, sun]


def preview(path, objs, size=640, ground_hex='#8d9a7a', azimuth=34.0, elevation=27.0, samples=24):
    """Front 3/4 render of `objs` with the atlas, soft sun, sky light and an AO-ish soft shadow ground."""
    sc = bpy.context.scene
    lo, hi = bounds(objs)
    centre = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
    span = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    eng = _engine(sc, ['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'])
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.film_transparent = False
    extra = look(sc, centre, lo, span, ground_hex, 'pv', samples)
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = 55
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    a, e = math.radians(azimuth), math.radians(elevation)
    direction = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    _fit(sc, cam, centre, direction, _corners(lo, hi, objs))
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    for o in extra + [cam]:
        bpy.data.objects.remove(o, do_unlink=True)


def silhouette(path, objs, size=128):
    """White-on-black front (-Y looking +Y) orthographic silhouette, ground near the bottom, for the distinctness gate."""
    sc = bpy.context.scene
    lo, hi = bounds(objs)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'BW'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.2
    sc.display.shading.light = 'FLAT'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (1, 1, 1)
    sc.display.shading.show_cavity = False
    sc.display.render_aa = 'OFF'
    world = bpy.data.worlds.new('mask-world')
    world.color = (0, 0, 0)
    sc.world = world
    cam_d = bpy.data.cameras.new('mcam')
    cam_d.type = 'ORTHO'
    w, h = hi[0] - lo[0], hi[2] - lo[2]
    cam_d.ortho_scale = max(w, h) * 1.1
    cam = bpy.data.objects.new('mcam', cam_d)
    sc.collection.objects.link(cam)
    cx = (lo[0] + hi[0]) / 2
    cam.location = (cx, lo[1] - 500, lo[2] + cam_d.ortho_scale * 0.5 - cam_d.ortho_scale * 0.05)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
