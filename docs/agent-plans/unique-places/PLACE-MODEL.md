# PlaceModelV2: one hand-composed model per place, backed by evidence

Owner direction (20 October 2026): every location is unique and backed by picture evidence when available. Archetype templates
filled from text are NOT acceptable as the final model. Each place gets its own composition, written by an agent that has looked at
the evidence, and checked against a photo when one exists.

## Evidence first

For each place, gather before modelling (never commit images; keep downloads under /tmp/places-evidence/<city>/):
1. Photos: Wikidata P18 / Commons image (`scripts/places/data/evidence/<city>.json` lists them with licence), the Commons category,
   the Wikipedia article images, then a web image search for the place name + city. View 1–3 photos with the Read tool. Record each photo
   used: URL, licence/author when known, which view (front/side/aerial/street), and what was taken from it.
2. Real footprint: `scripts/places/data/facts/<city>.json` → `osm.footprint` (local metres, centred) when `match.quality` is `name`, or
   when it is `containing` and the photo agrees. Also levels/height/roof tags.
3. Text facts from the brief in `scripts/places/briefs/<city>.json` (identity, era, style, sources).

`verified` is `photo` only if the model was compared to a photo of THIS place; `footprint` if only the real outline was used; `text`
otherwise. Never invent: no evidence means a modest, plausible building for the city, and `verified: "text"`.

## Spec (`scripts/places/models/<city>/<venueId>.json`)

```json
{
  "schema": "allworld-place-model", "version": 2, "city": "abuja", "venueId": "airport",
  "verified": "photo|footprint|text",
  "evidence": [
    {"kind": "photo", "url": "https://commons.wikimedia.org/wiki/File:...", "licence": "CC BY-SA 4.0", "author": "...",
     "view": "front", "used": "terminal massing, canopy curve, glazing rhythm, colours"},
    {"kind": "osm", "ref": "way/123456", "used": "footprint"}
  ],
  "camera": {"yawDeg": 35, "pitchDeg": 12, "fovDeg": 50},   // matches the main photo, for the comparison render
  "parts": [
    {"type": "mass", "id": "main", "footprint": {"rect": [120, 40]} , "at": [0, 0], "rotDeg": 0, "z0": 0,
     "height": 18, "storeys": 3,
     "wall": {"material": "glass-curtain", "colour": "#cfd8dc", "windows": "curtain", "windowRatio": 0.7,
              "faces": {"front": "curtain", "back": "plain"}, "bands": "#e0e0e0", "plinth": 0.4},
     "roof": {"form": "curved", "colour": "#b0b8bf", "material": "metal-sheet", "rise": 6, "overhang": 4}},
    {"type": "mass", "id": "wing", "footprint": {"polygon": [[-10, 0], [10, 0], [10, 8], [-10, 8]]}, "at": [70, 10], "...": "..."},
    {"type": "mass", "id": "osm", "footprint": {"osm": true, "scale": 1.0}, "...": "the real OSM outline"},
    {"type": "dome", "at": [0, 0, 18], "params": {"radius": 12, "profile": "onion", "drum": 3, "colour": "#d4af37", "finial": true}},
    {"type": "minaret", "at": [-30, -20, 0], "params": {"height": 60, "style": "pencil", "colour": "#f5f0e6", "balconies": 2}},
    {"type": "canopy", "at": [0, -26, 0], "params": {"width": 100, "depth": 10, "height": 7, "form": "curved", "colour": "#dddddd"}}
  ],
  "site": {"ground": "laterite", "forecourt": "parking", "trees": [{"kind": "palm", "at": [-40, -35]}], "extent": [140, 100]}
}
```

- Coordinates: metres, +x right and +y away from the camera (main facade faces -y), z up, ground z = 0. `at` is the part's origin.
- `type` is `mass` or any id in the PARTS registry (`scripts/places/blender/parts/__init__.py`; list with
  `python3 scripts/places/blender/parts/list.py`). Unknown parameters are reported, never silently invented.
- Every place is composed individually: part count, placement and proportions come from the evidence, not from a template.
- Budgets and export rules stay as in CONTRACT.md (LOD0 ≤ 20k, LOD1 ≤ 4k, LOD2 ≤ 500 triangles; one material `trim`; no images).

## Check loop (per place)

1. Write the spec, then submit it to the shared render queue (`scripts/places/render-queue/`, see README) — agents never start their own
   Blender. You get back `<venueId>.png` (standard view) and `<venueId>.photo.png` (rendered with `camera` to match the photo).
2. View the photo and `.photo.png` side by side. Fix massing, proportions, roof, colours, signature parts. At most 3 rounds.
3. Record in the spec `review`: {"rounds": n, "match": "close|fair|rough", "gaps": "what still differs"}.
