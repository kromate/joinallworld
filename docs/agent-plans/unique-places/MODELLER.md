# Modeller brief: compose one place at a time from evidence

You model a short list of real places. Each model is its own composition, built from what the photos and the real outline show.
Read [PLACE-MODEL.md](PLACE-MODEL.md) (the spec and the check loop) and `scripts/places/README.md`, section "Composing a place".
Accepted examples: `scripts/places/models/abuja/national-mosque.json` and `scripts/places/models/abuja/airport.json`.

Work in `/Users/anthonyakpan/work/allworld-unique` and write ONLY `scripts/places/models/<city>/<venueId>.json` for your places, plus
downloads under `/tmp/places-evidence/<city>/`. Never commit, never start Blender yourself (use the shared queue), never edit code.

For each place:

1. **Identity.** Read `scripts/places/briefs/<city>.json` → `places[venueId]` (name, what it is, sources). Read
   `scripts/places/data/facts/<city>.json` → `venues[venueId]` (OSM match quality, footprint, levels, height, roof tags, Wikidata).
2. **Photos.** Use `scripts/places/data/evidence/<city>.json` if it lists photos for the venue. Otherwise find them yourself:
   - the Wikidata P18 image;
   - the Commons category (`https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtype=file&cmtitle=Category:...&format=json`);
   - the Wikipedia article images;
   - a WebSearch for "<name> <city>".
   For Commons images get an 800 px thumb via `prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800`. Download 1–3 exterior photos
   with curl into `/tmp/places-evidence/<city>/` and LOOK at them with Read. Record each photo used in `evidence` with url, licence,
   author, view and what you took from it. Skip interiors, maps and logos. If the photo clearly shows a different building, do not use it.
3. **Compose.** Write the PlaceModelV2 spec from what you SEE:
   - massing (separate `mass` parts for distinct volumes, real proportions);
   - each roof form;
   - wall material and colour as seen (pick hex colours from the photo, not generic greys);
   - window rhythm;
   - every signature element placed where it is in the photo: towers, domes, minarets, canopies, stands, sheds, arcades, signage boards.
   Use `{"osm": true}` for the main footprint when the OSM match is `name` quality or the photo agrees. List parts with
   `python3 scripts/places/blender/parts/list.py` and prefer the most specific part (address as `<file>/<id>` when ids collide).
   Set `camera` to the main photo's viewpoint. Budgets: LOD0 ≤ 20k triangles (aim 8–16k), LOD1 ≤ 4k, LOD2 ≤ 500.
4. **Check.** Run `node --experimental-strip-types scripts/places/render-queue/submit.ts --city <city> --venue <venueId>
   --spec scripts/places/models/<city>/<venueId>.json --photo /tmp/places-evidence/<city>/<file> --wait 180`. View the
   `out/cmp-<city>-<venueId>.png` side-by-side image. Fix the largest differences first: massing, then roof, then colour, then details.
   Use at most 3 rounds, then record `review` {rounds, match close|fair|rough, gaps}.
5. **No photo anywhere.** Use the real OSM outline when it is reliable, plus the brief's facts, and set `verified` to `footprint`.
   With neither, make a modest building that is typical for this city and set `verified` to `text`. Still make it specific to this
   place (its size, its program, its setting); never copy another place's spec.
6. **Validate.** Run `node --experimental-strip-types scripts/places/validate-model.ts scripts/places/models/<city>/<venueId>.json`
   and fix until it passes.

No logos and no legible names: signage is blank boards in the colours of the place. Return per place: verified, match, rounds,
LOD0 triangles, and one line of gaps.

## Shape toolbox (generic parts: use these when no named part has the shape you see)

Do not approximate a real shape with a fixed part. Describe it. All are core parts (`python3 scripts/places/blender/parts/list.py prism` etc. shows every parameter; address as `core/<id>` if another file reuses the id). All honour `at`, `rotDeg`, `on`, LOD 0/1/2 and take an optional top-level `"lod": [0, 1]` to draw a part only at those levels (put a simpler stand-in with `"lod": [2]`, the LOD2 budget is 500).
- `prism`: any plan outline extruded (L-shapes, hexagons, cross-shaped heads, tapering with `topScale`/`topOffset`). Straight prisms also take mass-style `windows`, `windowShape`, `faces`, `pattern`.
- `revolve`: anything round about a vertical axis from an `[r, z, colour]` profile: domes of any profile, drum balconies, flared collars, whole minarets, water towers, stupas. `arcade` cuts arched openings into a straight vertical stretch (count, width, height, sill, shape, depth).
- `loft`: skin between sections at heights (`rect`, `circle`, `ellipse`, `poly`, with `cx`/`cy` offsets): tapering towers, leaning or kinked legs and V-fins, pointed-arch silhouettes (stack rects whose width shrinks with z), twisted forms; `curve: true` bends smoothly.
- `sweep-path`: a section (`rect`/`circle`/`poly`) along `points` or an `arc` (`plane: xy|xz|yz`): cables (`sag`), curved beams and arches (`bulge`, `xz` arc), ring beams (`closed`), handrails, canopy edges, crescents.
- `array`: repeat any part (`of`, a list is fine) along a `line`, an `arc`/circle (`radiusY` for ovals, `facing: outward|centre`) or a `grid`; `vary` interpolates numbers; `lod1Step`/`lod2Step` thin the copies; items take `lod`. A top-level array whose `of` is a `mass` repeats masses. Use it for fins, columns, stand segments, minaret rings, stalls.
- `surface`: roofs and shells from a height function: `folded`, `hypar`, `wave`, `dome-cap`, `conoid`, `fan` (radial folded plates, a negative `rise` makes it rise away from the apex), `heights`, `points`. Remember the camera: a roof falling away from the viewer is seen edge-on.
- `stand`: raked seating seen from outside along a line or an arc/oval (`tiers`, `stepped` soffit, `canopy`, `seatColours` + `blocks`). Arc cost is about rows x edges x stations: raise `facetDeg` and lower `rows` to stay in budget.
- Mass wall `pattern` (object or list, `faces` selects sides): `floors` (alternating colour per storey), `bands`, `fins`, `louvres`, `panels` (cladding grid with 2-3 colours and random `slits`, use windows `none` on that face), `arcade` and `pilotis` (replace the ground storey), `balconies`. Window shape: `windowShape` rect|arched|pointed|round. LOD1 gives flat colour quads, LOD2 only storey colours.
Cost rule of thumb: every cut window, arcade bay or fin costs triangles at LOD0, so spend them where the photo shows them (front) and keep the rest plain. Examples: `scripts/places/fixtures/core-generic/` (`redo-*.json` are full re-compositions of three pilot places).
