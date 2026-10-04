# Allworld model library research

Research date: 4 October 2026. Base revision: `c5e803e`. Worktree: `/Users/anthonyakpan/Desktop/JoinAllworld-astra-models`. Branch: `astra/models`.

Immutable research-evidence commit: `594845d80ee3a1d8dec99095aa4a5d927339d809`. This commit contains the map audit probe and observed result, not a model-library implementation.

This handoff answers the request for extensive online research and better free model candidates. It does not deliver the vehicle, avatar, geography, or preview implementations in the wider brief. No downloaded 3D model, image texture, font, npm dependency, or runtime integration was added.

## Recommendation

Keep the procedural implementation as the current baseline. The request to search free models does not by itself settle the brief's explicit ban on importing them. The candidates below are alternatives for review until that rule changes. Converting a downloaded mesh to JavaScript arrays would still be importing a model, not original procedural authorship.

The most useful free starting points are Kenney's Car Kit for coherent generic traffic, Nirmal.Justin's autorickshaw for a keke shape reference, and MPFB for an optional offline character-authoring workflow. Quaternius has useful character and vehicle packs, but its pack labels and current site license need reconciliation before acquisition. For the signature danfo, Nigerian garments, and the requested tiny map LODs, original work remains necessary. None of these listings proves that an asset is better inside Allworld.

The existing avatar already supports body, hair, outfit, fabric, skin, accessories, face, and expression choices. A generic imported character would lose functionality unless it preserves those choices and the existing batch/rig contracts. The source contract was read at the pinned revision, not inferred from marketplace claims.

## Evidence levels

- **Listing** means a creator or provider page states the fact. Counts are advertised, sometimes rounded, and are not measurements of downloaded files.
- **Visual** means I inspected the provider's preview in a browser. It proves the visible shape or presentation only.
- **Measured** means a probe inspected source data directly. This applies to the Natural Earth audit below, not to 3D assets.
- **Unresolved** means the license, free subset, download contents, rig, material count, or performance remains unverified.

The search covered creator packs, specific vehicle listings, human generators, African hair resources, cultural references, and map data. Two `gpt-5.6-luna` workers at medium effort researched vehicles and people separately. The primary agent checked the leading pages, inspected previews, audited map data, and assembled this decision. The people worker had one focused follow-up for licensing and service availability. Token cost and elapsed time per worker were not exposed.

## Free vehicle candidates

Hard triangle ceilings from the brief: map 250, street 1,500, showcase 8,000. An advertised count below a ceiling is only a candidate; materials, moving parts, seat anchors, loading, and memory still need inspection. Unknown counts are not a pass. Unless stated otherwise, free download is advertised but the archive was not downloaded.

| Candidate and source | Published license / access | Count and formats | Allworld assessment |
| --- | --- | --- | --- |
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | CC0; free download with an optional donation | 45 files; per-vehicle triangles and formats not exposed in the inspected page | First generic traffic candidate. Visual review shows consistent compact cars, a taxi, vans, pickups, and service vehicles. Rounded, toy-like proportions fit the direction. It does not solve the signature danfo. |
| [Low Poly Autorickshaw aka TukTuk, Nirmal.Justin](https://sketchfab.com/3d-models/low-poly-autorickshaw-aka-tuktuk-c7c87455ad014b3f9fc8c9fb2d164a61) | CC BY 4.0; free download button observed | About 4,800 triangles, 2,600 vertices; archive contents uninspected | Best specific keke candidate found. Visual review shows an open passenger side, rear bench, canopy, mirrors, and one front wheel. It has Indian branding/plates and textured rendering. Fits the showcase triangle ceiling on paper, not street or map. |
| [Lagos Danfo Bus, Iam_thearchitect](https://sketchfab.com/3d-models/lagos-danfo-bus-41b71827dcc94339b627fb79d9a7adb7) | CC BY 4.0; free download button observed | About 40,900 triangles, 20,400 vertices; creator says parts can be separated in Blender and that glass is absent | Strong Lagos reference, unsuitable unchanged at every tier. Preview shows worn yellow paint and weathered bodywork. That appearance relies on textures. Separate doors, usable rigging, and seat anchors are not established. |
| [Passenger Tricycle / Keke Napep, Flashtech Studio](https://sketchfab.com/3d-models/3d-model-passenger-tricycle-keke-napep-5d3b827310e747a8b5b4079f26ebb221) | Indexed listing says CC Attribution; not acquired | About 262,700 triangles; advertised Blender source/export options | Reference-only candidate. Far above even the showcase ceiling. Rig/export claims are not tested. |
| [Autorikshaw, bhagathartworks](https://sketchfab.com/3d-models/autorikshaw-indian-tuk-tuk-5775d012693741008acff9dad410e92d) | Indexed listing says CC Attribution | About 8,100 triangles, 3,900 vertices | Slightly above showcase and far above the other tiers. Secondary reference, behind Nirmal.Justin's model. |
| [Quaternius Public Transport Pack](https://quaternius.com/packs/publictransport.html) | Pack says CC0; current QAL discrepancy below | 12 vehicles; FBX, OBJ, Blend; counts unknown | Generic bus/transport reference. Do not label a school bus a molue or BRT without changing its actual body and door layout. |
| [Quaternius Cars Pack](https://quaternius.com/packs/cars.html) | Pack says CC0; current QAL discrepancy below | Eight models; FBX, OBJ, Blend; counts unknown | Generic taxi/private-car comparison. [Poly Pizza bundle](https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk) separately lists CC0 and FBX/GLB. Preserve the exact source and license of any acquired version. |
| [Cartoony Purple Motorcycle, AliceCassie](https://poly.pizza/m/j20srJUjpB) | CC0; download control observed | Rounded listing count 1.5k triangles; OBJ/glTF | Closest advertised count to street budget, but 1.5k rounding does not prove <=1,500. Visual review shows a bulky cruiser/chopper shape. A typical commuter okada needs a slimmer frame, different handlebars, passenger seating, and pegs. |
| [Motorcycle, Poly by Google](https://poly.pizza/m/dse64pqMKAR) | Listing says CC Attribution | OBJ/glTF; exact triangles unverified | Additional motorbike candidate. License version, seating, and pivots need inspection. |
| [Bus, Poly by Google](https://poly.pizza/m/4CPpvEmrMoF) | Listing says CC Attribution | OBJ/glTF; exact triangles unverified | Generic bus reference, not verified as a Lagos BRT or molue. |
| [Pickup, Quaternius on Poly Pizza](https://poly.pizza/m/qn4grQgHm8) | Listing says CC0 | Exact triangles and archive contents unverified | Generic pickup candidate, not verified as a Hilux likeness. |
| [Kenney Watercraft Kit](https://kenney.nl/assets/watercraft-kit) | Official pack lists CC0 | Per-vessel triangles unverified | Prefer a coherent kit for generic boats. Exact ferry/canoe coverage and passenger capacity still need inspection. |
| [Quaternius Ships Pack](https://quaternius.com/packs/ships.html) | Pack says CC0; current QAL discrepancy below | Six ships; FBX, OBJ, Blend; counts unknown | Secondary watercraft reference. A ship silhouette does not substitute for a Lagos passenger ferry or a dugout canoe. |
| [Small Airplane, Vojtěch Balák](https://poly.pizza/m/7cvx6ex-xfL) | Listing says CC Attribution | OBJ/glTF; exact triangles unverified | Potential inter-city travel marker. Airliner appearance and the 250-triangle map budget remain unverified. |

No verified free candidate in this research closes the tanker/container-truck, authentic canoe, or complete BRT/molue requirements with proven budgets and animation anchors. Those are explicit gaps, not implied coverage from a pack title.

## People, hair, and environment candidates

Hard avatar triangle ceilings: low 600, medium 2,500, high 25,000. The target is a friendly character about 4.5 heads tall. Counts must include hair, garments, face, hands, accessories, and any extra shadow geometry.

| Candidate and source | License / access | Fit and limitation |
| --- | --- | --- |
| [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | Pack page says CC0. It advertises a free subset of 60–70%, with paid Source extras. QAL discrepancy applies. | Six bodies and 20 hairstyles advertised, average 13k triangles, humanoid rig, FBX/glTF. Preview shows sculpted faces and textured-hair silhouettes, but adult/superhero proportions are much taller and more muscular than the Allworld target. Candidate for high-detail authoring/reference, already over medium before treating the average as a guarantee. Exact free hairstyle/body inventory needs inspection. |
| [MakeHuman MPFB2](https://github.com/makehumancommunity/mpfb2) | [License](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md) separates GPLv3 program code from bundled CC0 graphical assets. Maintainers place no restriction on output made from those assets. | Strongest offline human-authoring alternative. Morphs and rigs provide flexibility, but it is not a finished 4.5-head Lagos character pack. Topology, clothing, and export choices determine cost. Community add-ons need their own license checks. No installation or export was performed. |
| [Kenney Blocky Characters](https://kenney.nl/assets/blocky-characters) | CC0; 20 files and animation advertised | Candidate for deliberately blocky NPCs. It does not establish the sculpted face, flexible joints, Nigerian garments, or low-tier count required here. |
| [Adobe Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Adobe's FAQ allows royalty-free game use and requires an Adobe ID | Animation/rigging service, not proof of suitable Lagos character art. Commercial game use does not make it a CC0 source asset library. Current workflow, rig output, retargeting, and source redistribution were not tested. |
| [Open Source Afro Hair Library](https://afrohairlibrary.org/), including [Rain](https://afrohairlibrary.org/models/rain/) | Custom [BOSS license](https://afrohairlibrary.org/license/), not CC0 | Valuable Black hair reference and potential integrated-work asset source under its terms. Direct public redistribution and mirroring are restricted; other use restrictions also apply. Rain's displayed `0k` count is not credible budget proof. Keep reference-only for this handoff. |
| [Code My Crown, Dove guide](https://www.unilever.com/files/code-my-crown-dove-unilever-guide.pdf) | Educational resource described by [Unilever/Dove](https://www.unilever.com/brands/beauty-wellbeing/dove/); no separate asset redistribution grant verified | Relevant to hairlines, parts, curl masses, locs, cornrows, twists, and fades. Use as modelling education, not as a blanket license for guide images/sculpts. Full PDF inspection was blocked by the research tool's size limit. |
| [Short Dreadlocks, Tiko](https://sketchfab.com/3d-models/short-dreadlocks-toonlow-poly-style-3a7499eae78f4b58b1c7798f1cbc125a) | Indexed description/metadata disagree on CC0 versus CC Attribution; unresolved | About 46.1k triangles in indexed metadata, over the full high-detail avatar budget before adding a body. Reference-only; not an adoption recommendation. |
| [African Female Base Mesh High Poly Sculpt](https://sketchfab.com/3d-models/african-female-base-mesh-high-poly-sculpt-free-790e9124414a4f54ab02531faf2f74b4) | Indexed creator description says CC0; not acquired | About 2.1 million triangles in indexed metadata. Anatomy reference only, unsuitable as runtime geometry. |
| [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html) and [Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) | Free subsets, paid extras; pack CC0 labels/QAL discrepancy | Useful optional background references. City architecture is generic; nature-pack name does not establish Nigerian species. Both involve textures. Counts and selected free contents remain unverified. |
| [Kenney city kits](https://kenney.nl/assets/city-kit-commercial), [roads](https://kenney.nl/assets/city-kit-roads), and [industrial](https://kenney.nl/assets/city-kit-industrial) | CC0 packs | Coherent modular background candidates if imports become allowed. Local kiosks, compound walls, roofs, signage, and streets still require Lagos-specific work. |
| [Poly Haven](https://polyhaven.com/) | [CC0 asset license](https://polyhaven.com/license) | Useful prop/lighting/material reference. Photorealistic scans, image textures, and HDRIs conflict with the present brief and do not become mobile-friendly merely because they are free. |

Ready Player Me is not shortlisted for adoption. Some official branded pages remain readable, but the research did not verify current root-service operation or current commercial terms. Historical licensing and a live marketing page are insufficient grounds for a new dependency.

No researched free pack proves complete coverage of every existing hair/outfit/accessory ID, all three triangle tiers, the 4.5-head proportions, and the required animation contract. In particular, gele, agbada, buba/wrapper, and recognizable fabric systems remain authored work.

## Licensing findings that affect the decision

The [Kenney support page](https://kenney.nl/support) confirms that its asset-page downloads use CC0 and attribution is optional. CC0 is the clearest fit for freely reusable library assets. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) also permits commercial adaptation and redistribution, with credit, the license link, and an indication of changes. An asset's exact license still needs to be recorded; platform-wide assumptions are insufficient.

Quaternius's current [QAL v1.0](https://quaternius.com/license.html), dated 28 August 2026, allows use in finished commercial products but prohibits distributing the assets as standalone assets, including modified versions. Several older pack pages still explicitly say CC0. The site says license changes do not apply retroactively. This handoff records the discrepancy without deciding which terms govern an unacquired archive. Preserve its bundled license and acquisition evidence before selecting it. A reusable public model library and an integrated game are different distribution contexts under QAL.

OSAHL's BOSS terms permit use within larger original works while restricting direct asset distribution and specified uses. Its name does not imply CC0 or unrestricted source redistribution. MPFB's bundled graphical assets have a different license from its program code. These distinctions matter more than a marketplace's “free” label.

NC/editorial-only assets are excluded from the commercial-game shortlist. An example is the indexed [Tricycle by kurtcamarines](https://sketchfab.com/3d-models/tricycle-a1bfcae534604c2588dcb49c9598f979), listed CC BY-NC. Assets with omitted or conflicting licenses remain reference-only pending verification.

## Geography research and measured gap

[Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) explicitly place its vector/raster map data in the public domain. It is a suitable baseline for world/continent outlines, coastlines, and simplified country/state plates. [Admin-1 documentation](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) warns that administrative divisions and codes can be difficult to keep current.

The actual GeoJSON was fetched and inspected at immutable upstream revision `ca96624a56bd078437bca8184e78163e5039ad19`. The raw file was 40,726,851 bytes with SHA-256 `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`. It was processed in memory and not committed.

| Layer | Observed count | Minified country subset, all original properties | Brief requirement | Result |
| --- | --- | --- | --- | --- |
| Nigeria admin-1 | 37 | 234,510 bytes | 36 states + FCT; final chunk <=60,000 bytes | Count matches. Simplification and property removal still required. |
| Kenya admin-1 | 8 | 117,288 bytes | 47 counties; final chunk <=40,000 bytes | Fails coverage: contains former provinces. Do not ship this as counties. |

The Nigeria source spells Nasarawa `Nassarawa` and classifies FCT as `State`. Stable IDs and a reviewed display-name/type mapping are required. Count matching does not validate topology or political accuracy. Nigeria's required structure is also stated by its [National Bureau of Statistics](https://www.nigerianstat.gov.ng/page/about-us/). Kenya's government [county directory](https://kdsp.devolution.go.ke/counties) identifies 47 counties.

Measurements are in `src/models/research/natural-earth-observed.json`. The standard-library probe `src/models/research/audit-natural-earth.py` reproduces the source hash, counts, names, and compact subset sizes. It needs network access, fetches about 41 MB, and has a 90-second overall timeout on this macOS host. Its probe logic was executed during research; no production chunks or geometry were generated.

Other verified data candidates and limitations:

- [geoBoundaries NGA ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/) reports 37 units from GRID3, year 2022, under CC BY 4.0. This is not public domain and does not meet the current data-license rule.
- [geoBoundaries KEN ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/) reports 47 counties, year 2020, with original-source license `Public Domain` and RCMRD/Africa GeoPortal provenance. This is a promising lead, but its broad source link and the collection's licensing need to be reconciled before declaring the downloadable derivative public domain. [geoBoundaries repository](https://github.com/wmgeolab/geoBoundaries) describes collection-level open licenses. No county boundary binary was inspected or adopted.
- [OurAirports data](https://ourairports.com/data/) is public domain and available as CSV. Filter offline for Nigeria/Kenya, keep identifiers and coordinates, and label it game data rather than current navigation information.
- [Natural Earth rivers](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/) provide named generalized centerlines. Niger/Benue selection, joins, and river-mouth continuity still need a data check.
- [Natural Earth roads](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/roads/) documents basic coverage in North America. It is not evidence of a Nigerian highway network. Its full road binary was not audited.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) uses ODbL, not public domain. It is a possible separately approved route-data source, not a silent substitute under this brief.

For public-domain-only highways, a verified source remains unresolved. An original, explicitly schematic city-to-city route can depict travel, but it must not be presented as a measured highway alignment. Lane counts and bridge placement require finer evidence than a generalized world map.

Natural Earth uses [de facto boundaries](https://www.naturalearthdata.com/about/disputed-boundaries-policy/) by default. The model should preserve provenance and separately represent disputed boundaries. It should not present the source's choice as universal political agreement. Country IDs also need a policy for features without usable ISO codes.

The world <=120 kB, Africa <=80 kB, Nigeria <=60 kB, and Kenya <=40 kB figures remain target budgets, not achieved chunk sizes. A later build must simplify shared borders together to avoid gaps, retain small islands deliberately, verify all IDs, and test picking against reviewed interior points. A geometric centroid alone is not always a safe label/pick point in concave or multipart geography.

## Real-world references for original work

These are factual/visual references, not files to ship or designs to trace.

- [MIT Atlas of Popular Transport: Lagos](https://atlasofpopulartransport.mit.edu/lagos) distinguishes danfo, korope, keke, and formal BRT. It describes danfo capacity up to 18 and keke's local-trip role. The underlying mapped GTFS is described as not publicly accessible; the article is not an open route dataset.
- [Bajaj Nigeria three-wheelers](https://www.bajajauto.com/en-ng/three-wheelers) and [RE specifications](https://www.bajajauto.com/three-wheelers/re/specifications) are manufacturer references for silhouette and dimensions. Match the Nigerian model variant before using numbers from another market. The Nigeria CNG brochure was found but not fully read due to its size.
- [The Met's agbada object](https://www.metmuseum.org/art/collection/search/650308) documents a wide-sleeved outer robe worn over other clothes. Model its volume and sleeve opening; painting a normal shirt does not produce that silhouette.
- [V&A cloth reference](https://www.vam.ac.uk/articles/cloth-of-a-continent-africa-fashion) distinguishes adire resist-dye patterns, ankara printed cloth, and aso-oke strip weaving. The procedural material treatment should preserve those differences rather than use one generic multicolour pattern. Reference images remain outside the shipped library.

The local `RESEARCH-DESIGN.md` section 2 calls for warm skin highlights, readable dark tones, and a fill/rim lighting setup. The model brief expressly forbids real-time shadow maps, so that prohibition takes precedence over the design document's shadow suggestion. Face evaluation needs both darkest/lightest skin, day/night, and the actual host lighting.

## Technical acceptance before any adoption

These are proposed checks, not completed results.

1. Record the exact asset URL, creator, file hash, acquired version/date, bundled license, attribution, edits, and redistribution conditions. Confirm which models are actually in a free subset.
2. Inspect the full asset, including child meshes, hidden geometry, material groups, textures, animations, and skeleton. Count triangles after triangulation. Count instanced triangles multiplied by instance count.
3. Produce each required LOD independently. A 4,800-triangle keke can be a showcase candidate while failing map and street. Compression changes transfer/storage cost, not the triangle count of the decoded model.
4. Inspect topology, normals, scale, pivots, seats, doors, wheels, steering, and clothing deformation. Imported skeletons need a deliberate adapter to the existing avatar contract, not a new animation loop.
5. Measure actual render calls/triangles in the host, plus decoded memory, cold download bytes, and frame cost on representative Android hardware. Use [Three.js renderer counters](https://threejs.org/docs/pages/WebGLRenderer.html), with the pinned r180 implementation as the compatibility authority. Marketplace counts are not renderer measurements.
6. Follow [Three.js geometry batching guidance](https://threejs.org/manual/pages/optimize-lots-of-objects.html) and [InstancedMesh documentation](https://threejs.org/docs/pages/InstancedMesh.html). Sharing one material does not merge separate meshes into one draw call. Material groups, transparent passes, and animated parts affect cost. Arbitrary skinned crowds are not made cheap merely by replacing them with `InstancedMesh`.
7. Preserve [render-on-demand](https://threejs.org/manual/pages/rendering-on-demand.html). The host supplies time/progress. Reset every affected transform from its base pose so calling the same time twice, or scrubbing backwards, is deterministic. Avoid allocations in the pose path.
8. Verify [resource disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html) for geometry, materials, textures, skeleton resources, and shared ownership. A headless disposal-event test proves ownership bookkeeping; it does not by itself prove that GPU memory is stable in a browser.

[Khronos glTF guidance](https://www.khronos.org/gltf/) is relevant if model files become permitted. glTF is a delivery format, not a budget guarantee. Image texture compression and imported animation are outside the current procedural-only scope.

There is also an API distinction in the brief: the common new builder wrapper returns `{ object3D, userData }`, but the existing `buildAvatar(kit, look, options)` returns a `THREE.Group` whose `userData` owns `parts`, `top`, and `dispose`. Preserve the legacy return shape for the drop-in function; expose a separately named wrapper if needed. Do not silently wrap the legacy return value.

## Integration requests

1. Resolve whether downloaded models are allowed, and whether that also changes the image-texture ban. Until then, all 3D candidates in this document remain research/reference only.
2. Keep Kenya's eight-province Natural Earth data out of a counties implementation. Verify the 47-county public-domain source lineage, or explicitly relax the data-license rule for a named alternative.
3. Select a verified highway data source or accept visibly schematic travel routes. OSM and geoBoundaries are not automatically public-domain data.
4. Keep `buildAvatar`'s existing return contract and all trait IDs. The generic library wrapper can coexist under a different export.
5. Set explicit draw-call ceilings and scene-wide instance counts before model acceptance. The brief gives triangle limits but no numeric draw-call limits. Decide whether preview lights and blob geometry are included in model counters.
6. Mount a future side-by-side model preview behind the owner's flag. The parity session owns all changes outside this lane. No integration has been performed in this handoff.

## Delivery status

| Unit | State | Evidence / next action |
| --- | --- | --- |
| Online asset and license research | Complete at listing/reference level | Linked candidates, direct source review, and five visual previews: Kenney cars, Nirmal.Justin keke, Lagos danfo, Quaternius people, and AliceCassie motorcycle. |
| Natural Earth coverage audit | Measured | Source hash, Nigeria 37, Kenya 8, raw/filtered byte counts; rerunnable probe included. |
| Imported-model acceptance | Not performed | No model archive downloaded, parsed, retopologized, or rendered in Allworld. |
| Vehicle/people/geo library | Not implemented in this research handoff | Original brief remains the implementation specification. |
| Dev preview, contact sheets, GPU leak checks, Android proof | Not performed | No `models.html`, dev server, or runtime screenshots created. |
| Production/owner integration | Not performed | No merge, rebase, push, or owner-file edits. |

Only new research files inside the assigned lane were added. Full `npm test`, build, and edge suites were not run for this research-only change; there is no runtime code change to verify. The saved probe received syntax validation and the JSON evidence was parsed. No screenshot file is claimed; provider previews were inspected through the browser tool during the research.
