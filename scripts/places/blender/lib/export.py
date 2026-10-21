"""GLB export (no lights, cameras, extras; +Y up) and a minimal GLB reader for reports."""
import json
import struct

import bpy


def export_glb(path, objs):
    """Export `objs` (mesh objects) to a GLB. The 'trim' material is exported WITHOUT its image (the game binds the one global
    atlas); POSITION, NORMAL, TEXCOORD_0 and COLOR_0 are written. Blender +Z up becomes glTF +Y up (the -Y facade faces +Z)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
        export_image_format='NONE', export_vertex_color='ACTIVE', export_texcoords=True, export_normals=True,
        export_materials='EXPORT',
    )


def read_glb_json(path):
    data = open(path, 'rb').read()
    n = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + n])
