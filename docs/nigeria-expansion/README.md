# Continue the Nigeria expansion

**Active checkpoint.** Read [MAP.md](MAP.md) first and continue from the current six-city research batch. Phase 0 is already live; do not repeat it or restart research from scratch. This checkpoint remains usable if the current session ends.

Research has resumed. Uyo, Calabar, Enugu, Makurdi and Asaba now have provisional exact-coordinate candidate lists (24, 30, 26, 26 and 24 records); these are not valid all-roles CitySpecs. Benin's surface is ready while its spec worker continues, and Enugu surface generation is the current heavy job. The per-city gaps and ignored curation notes are tracked in [MAP.md](MAP.md).

## Objective and current priority

Open at least one playable city in each of Nigeria's 36 states plus FCT. Phase 0 is already live. The next release must contain these six cities:

1. Uyo — Akwa Ibom
2. Calabar — Cross River
3. Enugu — Enugu
4. Makurdi — Benue
5. Asaba — Delta
6. Benin City — Edo

The South-West draft batch (Akure, Ado-Ekiti, Osogbo, Ile-Ife) was superseded by this priority. Preserve it for later. Its drafts and prepared sources are copied under `.cache/nigeria-handoff/south-west-backlog/` and `.cache/nigeria-handoff/research/`.

Use the existing `cities/nigeria` worktree. Never edit the primary checkout. No additional repository, submodule, stacked branch, force push or rollback. Read `CONTRIBUTING.md`, `docs/DEVELOPING.md` and `docs/CAPACITY.md` as well as the city/map documents.

## First concrete next steps

1. Inspect the fresh named-place caches in `.cache/nigeria-handoff/research/pinned-pois/`. They came from the exact pinned national OSM file in a successful six-city pass. Many earlier apparent gaps were narrow-query failures, not missing places. Filter programmatically; do not paste thousands of raw records into a prompt.
2. Curate public facilities and resolve the required-kind gaps. These caches include roads, settlements and other raw evidence: **they are not venue lists**. `localUnitIds` describes the emitted coordinate; `intersectsLocalUnitIds` describes the whole way. A crossing road can have no coordinate ownership inside the city.
3. Cross-check current names and functions against independent identity sources, and map-check five selected venues per city. Keep uncertainties explicit. Do not pad a list to reach the minimum.
4. Choose and document each playable LGA footprint. Makurdi and Calabar surfaces already exist. Generate remaining source surfaces sequentially once their footprints are justified.
5. Build the first actual modern CitySpec from reviewed facts, with the required 20–30 real places. No city in this batch has a valid spec yet. Supply all pinned source paths, byte counts and hashes, then run the generator and offline check.
6. Test, inspect real screenshots, integrate, announce, publish and verify the entire batch before starting another. Do not publish one city from the six early.

## Important research corrections

- Never use a city-centre node as a landmark, hospital, terminal or other venue. Never borrow a coordinate from another feature.
- A named road is not a motor park. A hotel is not automatically nightlife. A university department or research institute is not automatically a separate college/university.
- Generic OSM labels, old bank names and uncertain services need review. A mapped facility can host a service only with evidence of that service; do not invent a salon or polling booth.
- Polling-information offices may be represented as such; do not claim that they are actual polling stations without evidence.
- Coordinates must come from exact OSM records or Wikidata P625. Geocoder text is a discovery lead, not a substitute for the referenced feature. Never move a point to make a boundary check pass.
- Cache minimally: remove contributor identities, contact details, unrelated text and exploratory failed responses before committing. Some current research files still need this cleanup.
- Market specialties, food, craft, industry, population tiers and climate seasons also need sources. Do not map a distinct local commodity to an unrelated shared stock product merely to obtain a discount.
- `1–3` tertiary institutions means one can suffice. Markets are limited to three and heritage/museum/landmark records to three by the current schema.
- No conflict or politics in city content, no real private individuals, and respectful quiet worship scenes. Preserve canonical public place names.

### Specific unresolved issues

- Uyo's earlier broad successful query covered only `(5.00,7.90,5.06,7.98)` and selected `amenity`; it omitted shop/office/healthcare/tourism/leisure and alternate-name keys. Do not treat that search as complete. The pinned spatial audit puts AKTC Park in Itu. Keep airport inclusion conditional on a justified footprint and verified facility status.
- Calabar still needs defensible mosque, salon, polling-information, eatery and motor-park records. Generic markets need independent names. National Museum Calabar has Wikidata `Q111889271`; distinguish it from the Slave History Museum. Exclude an operational prison from heritage recommendations unless its public museum/relic identity is proven.
- Makurdi had no successful broad Overpass response; one attempted box was even west of the actual city. Its 14-record inventory is incomplete. Use the new pinned-file cache instead. Verify current university names and airport service status.
- Asaba's “Niger River at Asaba” point is in Onitsha North and is excluded from the Asaba footprint. Do not restore or shift it. Several named hospitals/church/heritage/terminal leads have identity evidence but no accepted coordinate yet.
- Benin's old Central Hospital way `499729830` is stale-risk after relocation/demolition reports. The replacement proposed as UBTH, way `791290850` at `6.3139332,5.6255876`, is **not approved**: reconcile it with the institution's actual campus/address before use. National Veterinary Research Institute is not counted as tertiary without proof. Trim the fourth heritage candidate and extra market rather than exceeding schema limits.

## Geographic tools and existing inputs

The pinned national PBF and ADM caches are already in `.cache/geo`. The committed ADM1 source is `scripts/geo/sources/nigeria-adm1-9469f09.geojson`. Do not redownload or repin casually.

The lightweight GIS environment is available at `.cache/geo/venv` with `osmium4.3.1` and `shapely2.1.2`. Recreate or verify it as described in `.cache/nigeria-handoff/LOCAL.md` if needed.

```sh
.cache/geo/venv/bin/python scripts/geo/extract-named-places.py --self-check
.cache/geo/venv/bin/python scripts/geo/extract-named-places.py   --config .cache/nigeria-handoff/priority-batch-poi-config.json   --output-dir .cache/nigeria-handoff/research/pinned-pois
```

The named-place pass already succeeded: about 22 seconds, 2.29 GB peak RSS, 133 MB process footprint. Do not rerun unless the configuration or extractor changes. It uses native name-key filtering, a temporary file-backed node index, and canonical way `center` records. Relations are explicitly unsupported; use targeted records for those. The utility is syntax/self-check/full-scan verified but remains uncommitted and has not yet gone through the whole release gate.

Surface generation (one at a time):

```sh
.cache/geo/venv/bin/python scripts/geo/extract-city-osm.py   --city-id <id> --state-id <state-id> --state-source-name '<exact ADM1 name>'   --local-unit '<id>=<exact ADM2 name>'
```

Repeat `--local-unit` as needed. Existing current-batch surfaces:

- Makurdi: 385,520 bytes; SHA-256 `009956df3a6020e09673ed9daa7cbae9520108833da19f32dbc5fd598b8f8b0d`.
- Calabar: 204,195 bytes; SHA-256 `3ae0916ac6d2d9398ecd3876a99e2c82e1f24afaf9c09a378e75bb775c1f5565`.

Each surface scan took about 6–7 minutes and roughly 2.2 GB peak RSS. The raw inputs stay as source data; only generated TypeScript map modules are shipped as assets.

## Generate and verify

```sh
node --experimental-strip-types scripts/city/build-city.ts <id>
node --experimental-strip-types scripts/city/build-city.ts <id> --check
```

Generation updates the local catalogue/loaders automatically. Edit the spec and sources, never generated output. Registry-driven checks must include every new city: bounds/LGA/dry-land ownership, duplicate points, overlap, full life journey, cold reload, relief, markets/tables, scenes and startup growth.

Take and inspect actual city-map screenshots at 390×844 and 1440×900, plus arrival, market and one landmark. The local runtime and the live site are separate proofs. The provided harness location is in the ignored local runbook. CUA IAB works in the **parent chat**, not a subagent; previous subagent “browser unavailable” messages did not mean that the user's browser was disabled. Follow current model/UI instructions. Native Terminal is blocked by Computer Use; do not bypass it. Ordinary command tools work.

After final rebase, run all gates with the build present:

```sh
npm run typecheck
npm run build
npm test
npm run test:edge
npm run two-cities
npm run economy
```

Keep them sequential. The package already defaults typecheck/tests to serial execution. Use unique log names per commit, since stale files from an earlier failed command chain can otherwise look like current successes. Do not raise the 609,000 raw / 223,000 gzip startup budget or the approximately150-byte per-city growth limit.

## Release sequence

The original task authorizes these releases to the named project. Honor any later user constraints. Always fetch and rebase first; stop if a conflict is in a file you did not write. No force push. Announce using the helper in `.cache/nigeria-handoff/LOCAL.md`, then:

```sh
git push origin HEAD:main
gh workflow run joinallworld-release.yml -R kromate/allworld --ref main   -f source_sha=<full-40-character-commit> -f deploy=true -f publish_staging=false
```

Monitor the exact run. If a job is cancelled specifically because the runner was not acquired, rerun only failed jobs. Confirm the live build with `curl https://joinallworld.com/api/health`, then use one guest named `Zz Test` for the batch to enter every new city and complete a trip into it. Do not overwrite an existing person's life. Phase 0 used one live test guest whose home is Abeokuta South and whose last verified location is Sagamu Interchange, cash15,500; its IAB session may persist. Treat it only as a test guest if identity is visibly confirmed.

Deployments are fix-forward only. The asset allowlist is html/js/css/svg/png/jpg/jpeg/webp/ico/woff2/txt; no maps, audio or JSON/GeoJSON assets. Never commit keys or `.env` files, and never read the signing key directly.

## Preserve these constraints

- One unpublished batch at a time. Research may be parallel; generation/integration/release must stay coordinated.
- The owner allowed six lightweight city research workers to speed up this batch. No recursive fan-out. Keep heavy scans/builds/tests/browser sessions to one at a time on the 24 GB machine.
- No changes to saved-life shape, existing homes, money, businesses or the original nine cities. Stop before any required data-loss/storage-format change or new monetary cost.
- Do not touch accounts/sign-in, payments, mail, Messages, calls, admin, companion, table-game mechanics or sound.
- Player device coordinates never leave the device. Static city/venue coordinates are allowed.
- Strict TypeScript: no `any` or suppression escapes. No private machine paths, personal/worker names, email addresses or secrets in public source.
- Stop only owned servers/browser processes by PID; no `pkill`/`killall`. Delete owned temporary profiles/folders. Preserve pinned source caches and research evidence.

## Phase 0 evidence and known limits

Local checks on the published commit: 2,586 tests passed, four existing intentional skips;104 edge tests passed; typecheck, build, travel and economy passed. Measured production startup:593,131 raw /218,744 gzip. Actual emitted catalogue+loader rows were88–132 bytes per city.

Local visual proof: Sagamu home selection, both map sizes, arrival park, market, heritage scene, travel to Abeokuta, reload, return to the original home and reload. A real UI regression was found and fixed: cold city choices cached an empty LGA list. See `homeCityModel.ts`, `StepHome.vue`, and the regression in `startComponents.test.ts`.

Live proof: health matched the published commit; Zz Test settled in Abeokuta, travelled into Sagamu, and reloaded there with the correct balance and no console errors. Screenshots, logs and report are in `.cache/nigeria-handoff/`.

Sagamu regeneration uses an explicit legacy recipe, preserving its 15 public venues plus home, including existing fictional venues. It is not a newly researched modern spec. Current-main baseline:98,108 bytes, SHA-256 `3a8a67dd52babbf7b78817e6379bf43b149adb0dc7a3714d90af89891c80bbb2`.

Two existing Lagos–Ijebu-Ode and Lagos–Sagamu seams remain pinned by exact polygon hashes; new cities get no overlap exception. Some existing phone venue labels clip near viewport edges, while the full place list works. Country-scale state markers and Ogun's city choices were inspected on a phone. Modern parametric variants passed rendering-budget checks, but no new modern city has yet completed generation or visual acceptance.

After every city batch, report cities/counts/sources/uncertainties/decisions, sizes, visual versus automated evidence and rough edges. After the final batch, report all36 states plus FCT, total venues, average city payload, ranked roughness and next steps for signature scenes and other African countries.
