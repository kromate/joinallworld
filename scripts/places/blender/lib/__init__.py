"""Allworld unique-places Blender library. `import lib` from an archetype (the worker puts scripts/places/blender on sys.path).

See scripts/places/README.md for the API summary. Everything is in metres, +Z up, ground at z = 0, main facade facing -Y."""
from .core import (ATLAS_DIR, Builder, bounds, count_triangles, jitter, lin, mat, mix, pick, reset, rgb, shade, slots, tint, to_hex)
from .shapes import (Footprint, Seg, box, box_c, cap, cylinder, footprint, fp_H, fp_L, fp_T, fp_U, fp_cross, fp_oval, fp_polygon,
                     fp_rect, fp_ring, fp_round, prism, stair_box, steps, sweep)
from .facade import Look, cornice, facade, look, parapet, seg_box, walls
from .roofs import (barrel, cone, dome, flat_roof, gable, hip, mansard, multi_dome, pitch_rise, pyramidal, roof, roof_profile, sawtooth,
                    shed, stepped, tensile)
from .elements import (beam, blob, canopy_curved, canopy_flat, car, colonnade, column, forecourt, ground, lamp, obox, portico,
                       roof_shell, sign_board, tower, tree)
from .generic import (area2, array_placements, ccw2, extrude_profile, loft, path_points, prism_solid, revolve, shell, skin, stations_arc,
                      stations_line, surface_grid, sweep_path)
from .patterns import build_walls, normalise as normalise_patterns, storey_bounds
from .export import export_glb, read_glb_json
from .render import preview, silhouette

ALL_FEATURES = [
    'control-tower', 'jet-bridge', 'curved-canopy', 'flat-canopy', 'colonnade', 'portico', 'pediment', 'arcade', 'dome', 'onion-dome',
    'minaret', 'spire', 'bell-tower', 'clock-tower', 'buttresses', 'rose-window', 'stained-glass', 'pagoda-roof', 'stupa', 'toron-beams',
    'pinnacles', 'crenellation', 'courtyard', 'atrium-glass', 'balcony-bands', 'brise-soleil', 'louvres', 'pilotis', 'podium',
    'setback-tiers', 'crown', 'mast', 'helipad', 'floodlights', 'stand-roof', 'scoreboard', 'ring-roof', 'stalls', 'sheds', 'umbrellas',
    'kiosk', 'gate', 'fence-wall', 'fountain', 'statue', 'obelisk', 'pavilion', 'bandstand', 'steps', 'terrace', 'pier', 'platform-canopy',
    'rail-tracks', 'bus-bays', 'flags', 'signage-board', 'red-cross-sign', 'ambulance-bay', 'car-park', 'solar-panels', 'water-tank',
    'chimney', 'flare-stack', 'storage-tanks', 'ramparts', 'cannon', 'arches', 'mosaic', 'relief-pattern', 'painted-mural', 'awning',
    'roof-terrace', 'neon-strip',
]
