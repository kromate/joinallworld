# Unique places: one location-true model per public place

Status: plan agreed with the owner on 19 October 2026; implementation not started.

## Goal

Every public place in every city gets its own model, true to that place and that city. Lagos's airport must not look like Abuja's
or London's. A lighter version of the same model replaces the generic per-kind building on the city map. Phones download a place's
model only when it is needed and keep it, so a return visit downloads nothing.

## Owner correction (20 October 2026)

Template generators filled from text briefs looked mass-produced. The owner wants every location unique and backed by picture
evidence when available. Final models are per-place compositions (PlaceModelV2, see [PLACE-MODEL.md](PLACE-MODEL.md)) written by an
agent that viewed the photos and the real OSM footprint, then checked against a photo-matched render. Archetype modules become parts
libraries and a fallback only.

## Owner decisions (19 October 2026)

- Realism: higher detail, bigger budget. LOD0 is up to about 15,000–20,000 triangles per place, with lower tiers for weak phones,
  Light mode and the map.
- All models come from Blender scripts. No paid AI 3D service for now. Blender MCP is used to design and inspect generators;
  the bulk run is headless.
- Hosting: the existing R2 bucket `allworld` (binding `MODELS`). Only manifests (ids, hashes, sizes) are committed.
- Scope: the about 6,572 non-home venues plus their map icons. Out of scope: street-mode filler buildings and room prop kits.

## Facts this plan relies on (repo at 7ec83aab5)

- There are 284 cities, 6,856 venues and 6,572 non-home venues. The scene factory owns 6,423 of those venues; 149 are authored
  Nigerian venues. 112 are "(game venue)" placeholders: they get a unique seeded model, but no invented identity.
- Today's scene factory is in `scripts/scene-factory/` and `docs/SCENE-FACTORY.md`. It has 14 shared regional kits plus one hero per
  city (`pack.ts` enforces hero.id === city). Heroes are at most 4,000 triangles and 60,000 bytes, and each embeds its 1024 WebP atlas.
- Budgets live in `src/budgets.ts`: scenery 15,000 triangles, characters 72,000, 60 draw calls. The rule is to raise a cap only with a
  measurement on record, and never to reset a baseline.
- Caching today is the HTTP cache only (`/assets/*` is immutable). `public/sw.js` caches nothing. Neighbor prefetch is limited to 3
  cities and is off for Light mode, Save-Data and 2G.
- On this machine, headless Blender uses about 280 MB per process. Loop many models in one process (about 200 times faster than one
  process per model). Use 3–4 workers.

## Model tiers per place

| Tier | Triangles | Texture | Target size (brotli) | Used for |
|---|---|---|---|---|
| LOD0 | 15k–20k | shared per-city 2K trim/atlas sheet, plus an optional 512 unique decal sheet | 60–100 KB | inside or near the place, capable phones |
| LOD1 | about 4k | the same shared sheet | 15–25 KB | Light mode, weak phones, mid-distance |
| LOD2 | about 500 | palette or vertex colour | 2–4 KB | city map icon |

Uniqueness comes from geometry and parameters, not per-place textures. The shared per-city sheet downloads once.

## Phases

0. Prepare: free disk space (Yarn cache, old DMGs), close memory hogs, install Blender MCP, gltf tooling and rclone, and check the
   R2 credentials.
1. Facts and briefs. A script pulls OSM, Overture and Wikidata data for every venue: footprint, levels, height, roof, materials,
   colour, architect, era. Research agents (Sonnet/Haiku, 6–8 at once, batched by city) then write one `PlaceBriefV1` per venue:
   archetype, footprint, storeys, roof, facade materials and palette, signature features and sources. Never invent names or facts;
   unknown stays unknown.
2. Generators. About 40 archetype generators in `bpy`, built on today's `physical_*.py`, such as airport terminal and tower forms,
   Sahelian, domed and modern mosques, gothic, modern and pentecostal churches, stadium and bowl forms, open, covered and modern
   markets, and so on. Each is driven by a per-city style table plus the brief. Authors iterate with headless renders and Blender MCP.
3. Pilot: all venues in Abuja, Lagos and London, checked in the game at native phone scale, with owner review.
4. Bulk run: 4 looping Blender workers produce LOD0, LOD1 and LOD2, then gltfpack (meshopt) and the atlas step. A distinctness gate
   compares silhouettes within each kind across all cities and regenerates near-duplicates. Reviewers check contact sheets city by
   city.
5. Ship:
   - Recipe and contract changes: per-venue asset references and per-city sheets, replacing the hero-per-city rule.
   - Budget raise with the measurements on record.
   - R2 upload with rclone under content-hash keys, served immutable through the Worker.
   - Service-worker Cache Storage for hashed model URLs, plus `navigator.storage.persist()`.
   - Map icons switched to LOD2.
   - Tests, then release through the existing workflow.

## Open checks

- Whether the Wrangler OAuth on this machine is still valid, and whether an R2 S3 token is available for rclone.
- The Workers static file count (moot if models are on R2).
- Real phone frame time with LOD0 at 20k triangles. Until it is measured, LOD1 is the default on unknown devices.
