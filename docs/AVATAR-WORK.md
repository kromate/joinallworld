# Avatar work: motion, objects and wardrobe

Updated 7 October 2026. Full avatar integration is active in `neighbourhood-life/JoinAllworld`. Earlier handoff records below are historical checkpoints; the current acceptance status follows. No commits, pushes, deployments, dependencies, purchased assets, test edits or budget increases were made.

## Final local avatar handoff

Implementation and visual acceptance are complete for this avatar unit. The main chat owns the integrated build/type/download gate and the rest of the Allworld roadmap; the final integrated build and all unchanged download budgets pass. Startup raw is 608997/609000 bytes (3 bytes of headroom); the real activity-card lazy boundary saved 3798 bytes. Shared scene raw172189/192000 and gzip64032/71000 pass. Evidence: `evidence/street/startup-budget.json` and `/tmp/allworld-lazy-venue-budget.log`. No release, commit, push, dependency installation, test edit or budget increase was performed here.

- Creator, Profile and Boutique support the 23 new wearable choices, authoritative free/paid ownership, conflict handling, purchase/equip/remove, saved appearance and live public-look updates. Real browser purchase debited virtual ₦6,000 once, and mobile profile/reload preserved the full look and remaining ₦70,000.
- Both bodies support short/average/tall, slim/average/broad and adult/mature/elder appearance. The mature/elder GPU upload issue and repeated-change buffer retention were fixed. Close-up browser review passed asleep/awake eyes on both bodies; repeated age changes held two rendered geometries with no errors.
- Home meals, cooking, bucket/shower/tub, bed and hinged-door callers use actual objects and bounded entry/use/rest/exit. Bathing stays clothed beneath the towel and foam. Short/tall visual checks corrected cup placement, shower clearance and pot support height. The pot bottom matches the fixed cooker support within 3e-8 scene units in the checked browser fixture.
- Same-anchor action replacement now exits the old action, enters the new one and stops again. A real browser Eat → Drink snapshot trace covered exit/enter/use/rest; reduced-motion and initial rest identities use the same host boundary. The targeted idle-render regression check passes.
- Actual duplex heel/toe probes: maximum penetration 0.000976 scene units ascending and 0.001724 descending over 160 samples each. Root motion stays on its smooth ramp and leg reach remains bounded. Host speed/phase use walking while on stairs. Short-body ascent and tall-body descent were inspected in Chrome.
- Door callback/cancellation checks pass, with 0.002782 scene-unit maximum vertical wrist gap and negligible horizontal error during grip. Final clearance accounts for body depth so the full body crosses before the leaf closes.
- The real 390×844 game completed a meal and retained its saved wardrobe, cash and connectivity. The two-core fallback completed sleep with zero base-body/clip downloads and no browser errors. It intentionally uses reduced static resting poses; it is not full skinned-animation parity.

Verification evidence is under ignored `evidence/avatar/`. Main artifacts: `remaining-runtime-parent-final.json`, `remaining-handback.md`, `appearance-resource.json`, `live-look-http.json`, `wardrobe-server-contract.mjs`, `final-idle-regression-check.log`, `final-preview-boundary-check.log`, `final-ui-caption-checks.log`, and `final-real-mobile-meal.jpg`. The `final-*` images also include close-up eyes, short/tall shower, tub, meal/cook/sleep and stair frames. `body-presentation-preview.html` and `home-presentation-preview.html` are development-only visual fixtures using actual production rendering code; their camera framing and seeded furniture are not claims of server purchases.

The last broader host/body run passed 37/41 before the extra idle redraw was corrected; its targeted rerun now passes. The remaining three host failures are the already-recorded old speed thresholds at `venue-world.test.ts:216`, `:350`, `:544`; the separate earlier `movement.test.ts:84` threshold is also unchanged. No tests were edited. Focused body asset/pose checks passed 10/10, preview checks 12/12, and UI model checks 24/24 after the final caption change. These overlap earlier runs and are not a summed unique-test count.

The final clip pack is 338,060 raw / 55,111 Brotli bytes, below the existing clip budget. Both base GLB hashes are unchanged. Main fixed served-page WebAssembly/blob decoder policy and proved current-origin body loading; it also owns the frozen exact-header and stories-reader test mismatches. The final startup-reduction result is recorded above. Main continues the broader street lifecycle/roadmap independently; no further avatar edits are required.

Intentional rendering limits: generated garments remain stylized low-poly shells without cloth simulation; large robe/skirt bends can form angular folds. The capability fallback keeps reduced poses and clothed presentation. This pass used desktop/mobile emulation only, as Anthony explicitly requested; no physical-device or production-publication proof is claimed.

## Historical checkpoints

The following records describe earlier implementation states. The final local handoff above supersedes their incomplete-feature notes.

## Current acceptance checkpoint

- Live wardrobe and appearance are connected to the body, creator, Profile, Boutique, saved Look and public LookIds.
- Actual UI guest creation saved turban/kaftan/wristwatch/slippers with tall/broad/mature appearance. Buying Cuban chain deducted exactly virtual ₦6,000 (₦76,000 → ₦70,000); ownership and equip persisted.
- Actual Profile save switched to woman/short/slim/elder, then hijab-drape/abaya; API readback and page reload preserved the complete look with unchanged cash.
- Browser QA caught an invisible-body defect in mature/elder appearance: replacement POSITION had undefined buffer usage because the source is interleaved. The attribute-boundary fix restored exposed skin; mature and elder were rechecked visually.
- Mobile 390×844 Profile rendered the saved coverings. All six appearance tabs share one row with no page overflow. Narrow Profile/Boutique previews now scroll with the options instead of covering controls. Shop labels distinguish base outfit choices, overlayers and bead bracelet/necklace.
- Two-core emulation rendered the saved home avatar with 3,154 scene triangles and idle loop stopped. The new sit trace was interrupted by HMR and is not final acceptance.
- Home → neighbourhood → home completed through real door controls. Full door phase/interrupt trace remains pending.
- Existing onboarding/UI/quick-start checks passed 36/36; UI/quick-start after copy/layout edits passed 33/33. These overlap. The rerun actual-engine diagnostic proves free/paid/conflict validation, one purchase debit, retry rejection without charge, unowned equip rejection, JSON reload and public-validator field preservation.
- Anthony authorized coordination with main chat and explicitly chose emulation only for this pass. He also requested fixing encountered UI issues; main was informed.
- Implementation is serialized to one worker across chats at main's coordination request. Wardrobe Sol owns the current skin/foot-contact slice; home-motion Sol paused at a clean checkpoint with meal hooks removed until real clips land. Main owns final aggregate build/type/size; avatar task must not run a duplicate aggregate.

Evidence under ignored `evidence/avatar/`: `final-profile-mature.jpg`, `final-profile-mobile.jpg`, `final-mobile-saved-coverings.jpg`, `final-fallback-mobile-home.jpg`, `wardrobe-server-contract.mjs`, `final-wardrobe-checks.log`, `final-ui-model-checks.log`, `final-ui-detect.log`, `six-checkpoint.md`.

### Follow-up integration checkpoint

- Parent fixed repeated appearance-selection GPU buffer retention: reuse one morph attribute, avoid geometry writes for height/build-only changes, release current buffers before attribute replacement. Actual body/Three WebGLGeometries lifecycle diagnostic over 60 changes per body held seven tracked buffers and released all on disposal; adult source attribute and original morph bounds are preserved. Evidence: `appearance-resource.json`, `appearance-check.json`.

- Parent reran `live-feet.mjs` with the GLB URL loader: six body/proportion cases, max contact error 0.070789 mm, zero swing/foot-orientation change, exact root preservation, unreachable targets bounded. Actual stair integration is being checked separately.
- Real browser fallback sitting with the saved abaya/hijab reached the chair and returned to idle (3214 scene triangles, loop stopped). Full skinned short/slim/elder body sat with the same long outfit. Evidence: `final-fallback-sit.jpg`, `final-skinned-covering-sit-mid.jpg`.
- 390×844, two reported cores, 4× CPU slowdown, 150 ms network latency and 200000 B/s download: warm-cache Vite development reload reached the world at 14.3 s without alerts and stopped its idle loop. This is development emulation, not a cold production benchmark. Overrides were reset and the QA tab closed before main's Chrome work.
- Offline lazy-control failure was reproduced. Reopening did not recover, so LookEditor now offers a real reload button with explicit unsaved-choice text. Reconnect/reload restored all 23 options without an alert. Source of pointer failures was a pinned preview covering controls inside narrow dialogs even on desktop; Profile and Boutique previews now flow with their forms. PanelHost forwards attrs through Suspense, restoring the Profile FORM's tabpanel role and label.
- Main owns startup optimization: full catalogue/rules were pulled eagerly by engine, while look-ui was already lazy. Its tiny saved-field projection / lazy shop-card split retained the authoritative purchase/ownership diagnostic. Aggregate before that split: build passed; no production type errors; frozen engine.test.ts:339 reader mismatch; startup raw616644/609000 failed. Final budgets remain pending main's run; no caps were raised.
- Main fixed stale public appearance after profile changes. Inspected real Node HTTP + two same-room socket diagnostic proves watcher notification/public-list look change without rejoin, retaining voice and position. Evidence: `live-look-http.json` and `/tmp/allworld-live-look.mjs`.
- Current sole worker is home-motion Sol. It has wired feet, proportional props and presented-action bathing/sleeping state, including original sleep-eye rendering. Meals, shower/tub clips, actual stair fitting and door contact remain in its one coherent completion unit; no visual completion is claimed yet.

## Expanded embodiment work, active 7 October 2026

Current authorization: Anthony directly requested implementation of every remaining item and continuation until verified completion, using Sol and cheaper models. The former stop-after-unit checkpoint is superseded. Keep tests unchanged, preserve concurrent edits, and retain existing budgets. Do not infer deployment or spending permission.

The completed motion repair below is the baseline, not completion of the older roadmap. The user has expanded scope to E-A/B/C. This task now owns avatar/body/character/rig modules, new wardrobe/smart-object modules, and motion/prop animation sections of `home-scene.ts`. The main task owns `venue-world.ts`/world-adapter overall, server/business/trust code, saved life/protocol/home schemas and route registration. The existing 5187 QA fixture must not be reset. No test files or budgets may change.

| Unit | Outcome | State / proof required |
| --- | --- | --- |
| EA0 | Preserve completed gait/pose repairs | Existing baseline below; recheck after integration |
| EB1 | Reusable bounded object lifecycle; chair/bed/door | Chair/bed controller implemented and chair verified through real client; hinged leaf isolated and verified, not mounted pending parent hook |
| EB2 | Bucket/shower/tub modest presentation; cook/eat | Bucket and stove/cooker source/contact unit implemented; actual desktop bucket/cook rendered. Shower/tub expansion and eat/table remain queued |
| EA1 | Foot placement and bounded body variation | Cosmetic geometry/proportion helpers implemented and numerically checked; not integrated into body fitting or saved look. Floor/stair contact extension and reference-phone gate remain open |
| EC1 | Slots, hide/block resolution and actual layered geometry | Pure rules plus generated shared-skeleton geometry implemented; revised silhouettes/fabrics inspected in Chrome. Body/creator/Boutique integration remains a coordinated next unit |
| EC2 | Creator/Boutique user flows | Paths reserved below but no UI edits started. Deferred under usage instruction; persistence and price integration remains parent-owned |

Design direction: compare a reusable prop controller carrying approach/use/exit anchors and bounded state with additional ad-hoc home timers. Prefer the controller, driven by the existing host loop. Compare original generated garments bound to the current 23-bone skeleton with an offline garment-pack pipeline; select only after source/asset inventory and measured triangle/download cost. Runtime animation retargeting is excluded. Appearance age is cosmetic and never affects real-user age verification.

### Current bounded handoff

Prior handoff below is a baseline. Work has resumed: Sol owns body/wardrobe/appearance/preview integration; a second Sol owns home object/door/bath/eat/foot-contact sections. Astra owns integration, UI wiring and browser verification. Shared schema and host sections are pending coordination with the concurrently active main chat. No new UI files have yet been edited.

- **Live home object unit:** `smart-objects/sequence.ts` drives approach/alignment, entry, at most three seconds of use, static rest, and exit through the existing host loop. Chair/bed use no longer holds one still frame for the whole activity. The real-client chair trace recorded 257 active stationary animation frames followed by 162 stationary idle-loop samples while the activity was still running. No poll restart.
- **Bucket and cooking:** offline original 23-bone clips, per-body baking, `workOn` floor anchors, and original pot/spoon/water-scoop props are wired into the home. Props follow the wrist through entry and exit and are hidden on cancellation/settlement. Existing clothes remain on. The first live stove review caught an unnecessarily deep squat; the final low-stove clip uses standing legs and a forward lean. Desktop captures are `embodiment-cook-final.jpg` and `embodiment-bucket-final.jpg` under `evidence/avatar/`. Cooking showed 16 draws / 10,588 triangles; bucket use 15 / 10,540. Both are below existing scene limits. The local API restarted during the first review; retry recovered and the final desktop actions rendered against the connected server. A final 390×844 sampling attempt timed out; the avatar subsequently returned idle, but no completed new mobile visual acceptance is claimed.
- **Focused object proof:** final existing checks passed 59/59; an earlier overlapping run passed 64/64. No test files changed. The final standing-cook correction used only a clips-only rebuild and focused contact/foot/seam checks, not another broad build. Low-stove wrist error is below 0.7 mm for the female body and 7.4 mm for the male; the latter is a bounded reach clamp. Feet match the standing source pose, bucket tracks are unchanged, and both two-second cooking loops have zero measured wrap seam. Prop grip remains attached through entry/use/exit. Static rest retains the last sampled frame.
- **Assets:** the clip pack is now **200,088 raw / 38,521 Brotli bytes**, under the existing 200,000-byte Brotli clip budget. Base bodies are unchanged: male SHA256 `a375403639d688da351b0c87d5a70afa0080dafcf85dbf64b64395ce76e66f7c`, female `ee8b9eb6d7ad2b35abfb026f2997d85384b7484342922cb99503e72462c2c5ad`. `body:build -- --clips-only --gltfpack <existing cli.js>` supports rebuilding only clips with the cached offline packer; no installation/download was needed.
- **Wardrobe renderer unit, not yet a product feature:** 23 canonical wearable IDs, legacy adapters, eleven slot kinds, strict validation and deterministic conflicts are implemented. Original generated garments, hair, jewellery and footwear share the shipped skeleton in one extra mesh/material. Covered body indices are removed conservatively; all face triangles remain. One fit correction batch improved necklines, sleeves, scarf edges and jewellery clearance. The final original cloth-only ankara/adire/asooke shader compiled and rendered in Chrome with no errors; plain bypasses it. Image: `wardrobe-fabric-final.jpg`. Maximum checked combination: **2,716 added triangles, 160,080 geometry typed-array bytes, one added draw**. These are initial stylized shapes, not photoreal cloth or cloth simulation. The renderer is exercised in `scripts/body/wardrobe-preview.html`; it is **not connected to the game body, creator, Boutique or persistence yet**.
- **Appearance helper only:** `body/appearance.ts` and `avatarProportions` provide bounded cosmetic categories and subtle age-appearance face geometry. A parent-run actual-GLB probe measured maximum elder displacement 4.20 mm female / 4.28 mm male and exact adult attribute/index restoration. No real age/DOB/verification data is used. Height/build factors and face changes are **not yet applied in gameplay**; seat, stride, clothing and prop contact must be fitted together before enabling them.
- **Door prototype only:** the isolated original leaf matches the former three boxes, turns around a true hinge, completes once and cancels cleanly. It is not mounted. The parent hook, wall opening, correctly sized leaf and hand-handle contact pass remain required.

Code added for these units: `src/types/avatar.ts`; `src/scene/body/appearance.ts`; `src/scene/smart-objects/{sequence,props,door}.ts`; `src/scene/wardrobe/{catalogue,rules,geometry,renderer}.ts`; and `scripts/body/wardrobe-preview.html`. Existing changes are confined to the owned home motion/prop sections, `body/{skinned,poses,manifest}.ts`, `body/assets/clip-pack.glb`, and `scripts/body/{author-clips,build-body}.ts`, in addition to the earlier completed motion repair.

Focused evidence/contracts: `embodiment-chair-browser.json`, `embodiment-object-runtime.json`, `embodiment-eb2-runtime.json`, `cook-low-standing-metrics.json`, `cook-low-standing-seam.json`, `wardrobe-{numeric,combinations,safety,fabric}.json`, `appearance-check.json`, `object-contract.md`, and `wardrobe-render-contract.md`. These local probes are not new test files or production/device proof. Client checks reported no owned-file errors at their checkpoints; unrelated concurrent server/webpush/type errors remain outside this unit. No final broad build or aggregate size run was repeated after the usage instruction.

Next coordinated integration: create the wardrobe renderer after the base skeleton is ready and before applying appearance changes; preserve its canonical rest fitting, use its boolean failure result without interpreting it as a gender/body reload, and dispose it before the base skeleton. Derive temporary bathing/sleeping presentation from the object sequence's **presented** action through exit, not its target, which becomes null on cancellation. Keep the clothed base on any failure. Height is uniform with build factors: outer scale `(s*height*width, s*height, s*height*depth)`; seat offsets and stride/contact fitting must use those dimensions too. Do not enable variation merely by scaling world Y.

Remaining authorized backlog, now active: creator/Boutique/save/protocol integration; paid/free catalogue decisions; live towel presentation and shower/tub sequences; eating/table use; door hook/opening/handle contact; stair foot correction; appearance fitting in motion and furniture; face/closed-eyelid quality; reference Android/3G performance and production verification. The current exit clips begin from their baked use pose; blending smoothly from an arbitrary interrupted use phase remains a visual-tuning gap. The main task retains the overall older roadmap. No claim of E-A/B/C completion is made.

### Shared avatar integration reservation

Under the latest implementation request, the avatar task now reserves only optional avatar fields in Look/LookIds/Wardrobe/BoutiqueItem and the onboarding wardrobe validation, ownership, purchase and view sections. Existing business/trust/land changes remain untouched. Contracts were recorded above before these surgical edits. Anthony authorized cross-chat coordination; the narrow reservation was sent to the main chat. The host edits are limited to optional beginDoor dispatch with its existing epoch guard and appearance-adjusted gait distance; scene types gain an optional contact sampler.

### Completion checklist for the resumed run

- [x] Live layered wardrobe in world and preview, including capability fallback.
- [x] Creator/Profile/Boutique selection, ownership, purchase/equip, saving/reload and public appearance.
- [x] Height/build/cosmetic-age controls with clothing, furniture, gait and old-save compatibility.
- [x] Hinged doors with a real opening, guarded transition and interruption behavior.
- [x] Eat/table, shower/tub, towel/foam, bounded use and return sequences.
- [x] Stair/floor foot correction, smooth interrupted exits and closed-eye sleep presentation.
- [x] Desktop and narrow browser acceptance through real product paths.
- [x] Focused checks, final integrated build/download gates, and explicit frozen-test incompatibilities recorded.
- [x] Desktop/mobile emulation including slow-data check. Anthony explicitly selected emulation only for this pass; physical Android is outside this acceptance pass.

### Reserved creator/Boutique paths

This avatar task claims these currently unmodified UI files before editing: `src/app/features/start/LookEditor.vue`, `lookModel.ts`, `onboardingModel.ts`, `LookStage.vue`, `lookPreview.ts`, `StepLook.vue`, `creatorModel.ts`, `creatorState.ts`, and `src/app/features/life/BoutiqueApp.vue`, `boutiqueModel.ts`, `boutiqueState.ts`. New wardrobe-control components under the start feature are also owned here. Current resumed UI ownership also includes `src/app/features/start/CreatorApp.vue`, `src/app/features/sim/ProfileTab.vue`, and new `AvatarLayerControls.vue` under the start feature and `src/scene/wardrobe/look.ts`. These are claimed for replace-look event wiring, undo, draft persistence and preview integration. The avatar-only `src/quick-start/look-model.ts` parser is also claimed to preserve validated appearance extensions in new-player drafts. No other app state, panel registration, route or business files are claimed.

### Parent integration contract EB-door, ready for review

Add optional `HostScene.beginDoor(done: () => void): void`. In `walkHomeDoor` retain the existing epoch/location/mode/active-action guard as a completion closure. At arrival, call the scene hook and wake the existing motion loop instead of dispatching immediately. Scenes without it keep the existing dispatch. Reduced motion/no loop invokes begin then `settleCrowd`, completing once. Disposal and intentional walking must cancel a pending presentation so its callback cannot dispatch later. Existing epoch guards remain mandatory. The scene owns hinge/pose presentation, never a server action. The avatar task will implement the home hook and original door-leaf geometry; the main task owns this host change and any exterior door integration.

### Parent integration contract EC-look, exports available

The dedicated `src/types/avatar.ts` module now exports `AvatarWearableId`, `AvatarAppearance`, `AVATAR_WEARABLE_IDS`, and `normalizeAvatarAppearance`. Optional saved/public fields to integrate are `wearables?: AvatarWearableId[]` and `appearance?: AvatarAppearance`, with height `short | average | tall`, build `slim | average | broad`, and cosmetic age appearance `adult | mature | elder`. Existing records omit these fields and retain current visuals. Neither field is real-user age or verification data.

Parent-owned integration points: `Look` and `Wardrobe` in `src/types/life.ts`, public `LookIds` in `src/types/social.ts`, `BoutiqueItem` kind in `src/types/view.ts`, and the validator/sanitize/ownership/view paths in `src/game/systems/onboarding.ts`. Validate new IDs and slot conflicts from the pure catalogue/rules, preserve owned IDs, keep buy/equip server-authoritative, and expose only IDs in presence. Prices and purchase rules remain parent-owned. The pure rule exports are available in `src/scene/wardrobe/rules.ts`: `validateAvatarWearables`, `normalizeAvatarWearables`, `resolveAvatarWearablesForRenderer`, and `hiddenAvatarBodyRegions`. Catalogue data in `catalogue.ts` imports no Three.js. `validateAvatarWearables(value.wearables)` returns `{ ok: true, ids }` or `{ ok: false, code, id?, conflictsWith? }`; reject a failed API write, whereas saved-record sanitization may use `normalizeAvatarWearables`. `normalizeAvatarAppearance(value.appearance)` reconstructs only the three bounded cosmetic fields and drops all other data. Keep new fields optional and avoid making legacy `Required<Wardrobe>` fixtures require an extra property; this task will adapt its owned UI type locally. Test files remain frozen.

Example parent-owned validator/equip steps, after the existing base-look checks:

```ts
const checked = validateAvatarWearables(value.wearables);
if (!checked.ok) return { reason: `Invalid wearable selection: ${checked.code}` };
if (checked.ids.length) look.wearables = checked.ids;
if (value.appearance != null) look.appearance = normalizeAvatarAppearance(value.appearance);
// set-look/equip checks ownership after validation, using the authoritative owned list:
const unowned = (look.wearables ?? []).find(id => !wardrobe.wearables?.includes(id));
if (unowned) return fail(state, 'not_owned', 'That item is not in your wardrobe.');
```

Starter items, prices and purchase actions remain the main task's decision. These snippets are contracts, not edits already made to parent-owned modules. Keep legacy base fields and owned lists; omit empty new arrays for old compact payloads. Appearance selection is cosmetic only and never grants verified-age status.

Local geometry/preview evidence will not be called a completed persisted Boutique feature. Complete source inventory is in ignored `evidence/avatar/wardrobe-inventory.md`.

## Completed motion repair

| File | Result |
| --- | --- |
| `src/scene/body/skinned.ts` | Repeated animated pose requests preserve the transition. Floor and furniture anchors interpolate during sit/lie entry and exit. `place` records the floor destination while seated. |
| `src/scene/characters.ts` | Procedural knees and elbows bend using cached lower-limb vertex and normal ranges in the original six meshes. Geometry is not rebuilt per frame. |
| `src/scene/movement.ts` | Walking is 1.82 scene units/s and jogging 3.92 before avatar scale, equivalent to 1.3 and 2.8 m/s for the 2.45-unit figure. Full-cycle lengths are 1.83 for walking, 3.36 for the skinned jog, and 2.7 for the procedural jog, each scaled with the avatar. |
| `src/venue-world.ts` | Gait phase advances from actual distance, including the last arrival step. Removed the extra root bob; sampled current floor before gait. Bounded get-up finishes before queued walking. Updated crown positions without rebuilding tag DOM. Same-action progress polls no longer stop the arrival route. |
| `src/scene/home-scene.ts` | Activities approach the actual furniture on its floor grid. Both avatar versions use its seat anchor. The fallback uses its existing nonrig seated figure. The crown follows the rendered head through transitions. Standing placement remains separate from furniture placement. |
| `src/scene/body/stand-in.ts` | Walking clears stale seated placement. Current floor drives slope detection, which resets on scene changes. The visible head supplies the outdoor crown anchor. |
| `scripts/body/motion-preview.html` | Standalone local comparison tool with body, pose, phase, cadence, transition and camera controls. Its module is inline in this development HTML, outside runtime scene sources. Default cadence is approximately the repaired walk; 3.25 cycles/s reproduces the old cadence. |

The shared edits are limited to motion/pose sections. Current door handlers, capture, street/visit APIs, lazy builder injection, multi-floor routing/cutaway and readonly visitor options were preserved. Exact pre-edit shared sources are in ignored `evidence/avatar/shared-before/`; the incremental review patch is `evidence/avatar/shared-motion.patch`.

## Root causes resolved

- The host used `dt * 6.5 * PI` as walk phase, producing 3.25 full cycles/s independently of distance. It also added bob on top of the rig's own pelvis motion.
- The procedural gait calculated knee/elbow bends but never applied them to separate lower-limb vertex ranges.
- `sitOn` applied the final seat offset immediately; leaving removed it immediately. At scene scale 1 this produced about 0.45–0.46 units of horizontal jump on the two bodies.
- Repeating `show` for the same animated pose cancelled its transition.
- Home activities used an unrelated logical standing position while only the skinned body interpreted the furniture. The measured bad approach was 5.37 units from the chair; the corrected approach is free floor directly in front of it.
- **Live-only polling defect:** `setState` compared activity objects by reference. Each server progress poll replaced the object, stopped the walker, and discarded the arrival callback. The activity stayed busy while its avatar never reached the sitting pose. Motion now compares semantic kind/id/duration/choice/mode, excluding countdown progress. A cloned-state replay and the real browser both reproduced the failure and confirmed its repair.

## Direct acceptance evidence

Local server: existing port 5184. Final interactive QA used a dedicated origin, `http://avatar-motion.localhost:5184/?diagnostics`, and a new local guest named `Motion Acceptance`. Earlier `localhost` observations were affected by concurrent reloads and possible shared-session activity; they are not the final acceptance record.

- Real three-unit home walk: phase advanced exactly 8.5836 radians, matching `2 * PI * 3 / (1.83 * 1.2)`, with floor Y unchanged at 0.03. Street three-unit walk at scale 1 advanced 10.3003 radians and returned to idle. Browser traces: `shared-walk-after.json`, `shared-street-walk.json`.
- UI home-to-street and street-to-home round trip passed with the same 13-object home. Door and scene APIs remained usable.
- The avatar approached the chair, sat on its seat, and kept the crown above its head. Image: `shared-home-sit.jpg`.
- Real-client chair action and cancellation, including live server polling: 394 samples, 142 transition frames, **zero walking frames during get-up**, then queued walking and a stopped idle loop. Trace: `shared-cancel-exit-final.json`.
- Real bed action reached the mattress and aligned the crown with the lying head. Waking produced 133 get-up frames with **zero walking frames during easing**, then returned to idle. Image: `shared-home-sleep.jpg`; trace: `shared-wake-final.json`.
- At **390×844 with two reported CPU cores**, the capability fallback rendered the saved hoodie and sat on the actual chair. Image: `shared-fallback-mobile-sit.jpg`. This is emulation, not physical-device performance proof.
- Actual host plus shipped body probes measured zero crown projection error through sitting/get-up, unchanged phase while blocked over 60 frames, and no walking before the exit completed. Artifacts: `shared-body-host-probe-final.json`, `shared-poll-before.txt`, `shared-poll-after.json`, `stand-in-runtime-probe.json`.
- Earlier geometry comparison covered 48 static pose/detail/rig combinations: identical world vertices at 1 mm precision and identical triangle counts. Medium example remains 2,140 triangles and six meshes. The two skinned assets remain 9,002 triangles and 23 bones each.
- The standalone motion viewer loaded after moving its script inline and reported no console errors. Temporary debug logging was removed. Browser device overrides were discarded with the QA tabs and viewport configuration reset.

All named evidence files are under ignored `evidence/avatar/`. The first `shared-cancel-exit.json` is the **failed before-poll-fix** trace; use the `-final` file for acceptance. A later outdoor mobile sampling attempt hit the lazy-host loading window and was discarded, not counted as a failed movement result.

## Existing checks and release gates

Tests remain unchanged. Passing focused runs include 54 home/scene/body checks, 16 host invariants, five stand-in checks, and nine host checks after the polling correction. These sets overlap; do not add them into one unique-test count. Logs are `shared-home-checks.log`, `shared-host-current-checks.log`, `shared-stand-in-final-checks.log`, and `shared-poll-host-checks.log`.

Four assertions in the broader existing movement/host run still require the old faster distance over a fixed time: `movement.test.ts:84` and `venue-world.test.ts:216`, `:350`, `:544`. Their directional/loop intent was checked separately, but the literal thresholds conflict with the requested slower human-scale movement. They were not edited or bypassed in the full run. A fifth initial failure, the scene-source animation-loop scan, was fixed by moving the development viewer's script outside scene sources.

`npm run slot -- heavy -- npm run build` passed after the final production motion changes. The combined worktree's download check still fails:

| Gate | Measured | Existing maximum |
| --- | ---: | ---: |
| Startup raw | 609,087 bytes | 609,000 bytes |
| Shared scene raw | 194,930 bytes | 192,000 bytes |
| Shared scene gzip | 73,070 bytes | 71,000 bytes |

First paint, startup gzip/brotli, body and clip-pack budgets passed. Logs: `shared-build.log`, `shared-download-budget.log`. The figures include concurrent neighbourhood/property changes as well as this repair. No limits were raised. **Proposed main-chat integration:** follow the existing lazy neighbourhood-builder pattern for the home builder in the adapter, removing the static `buildHomeScene` import from the shared host while preserving visited-home and loading contracts. That API/chunk split is outside this task's motion-only ownership. Re-measure the complete startup graph after splitting rather than moving bytes to a different eagerly loaded chunk.

The combined `check:fast` stopped at typecheck, before build/smoke. At that checkpoint it reported unrelated errors in `src/game/systems/land.ts:23`, `server/world/land.ts:115` and `:131`, plus frozen `src/types/engine.test.ts:122` and `:339` readers missing the new state shape. No errors were reported in the avatar-owned files. See `shared-check-fast.log`. These files are being worked on by the main task, so recheck its final aggregate; this log is a dated checkpoint. Full suite, Worker, production and physical-device verification were not run here.

## Remaining visual limits

The current skinned wardrobe is mainly a tint on one body mesh. A selected hoodie does not gain a loose hoodie silhouette, and saved hairstyles/accessories are better represented by the procedural avatar. No replacement assets were introduced.

The fallback has a real chair sitting pose but no authored lying or soaking clip. Bed/tub activities use that supported seated pose; low mats/tubs can still look anatomically awkward because dangling chair-style legs are not a floor-sitting pose. Hand contact with buckets, taps, counters and props is not solved by the current static wash/interact clips. This pass preserves those limits rather than claiming contact animation or foot IK. The campus host has its own explicit speed/cadence implementation and was not recalibrated by this venue/home repair.

The fallback's cached vertex updates cost about 0.004 ms per medium pose in a warmed Node benchmark on this Mac; GPU uploads and phone cost remain unmeasured. The existing guest-first flow, saved looks, scene/asset budgets and fallback gate remain intact.

## Ownership handoff

Astra handled integration and interactive QA; GPT-6.1 Sol implemented the motion fixes and numerical probes. GPT-6 Luna built the initial local viewer; review corrected its pose fidelity, controls, animation-loop ownership and framing. The first extra-mesh articulation approach was rejected and replaced to preserve the original mesh budget. Exact tokens, monetary cost and per-agent elapsed time were unavailable.

The earlier motion handoff remains valid. The expanded current object/wardrobe/helper units are also stable at the checkpoint above; main can coordinate their integration and resume shared edits. No external messages or production actions were sent by this avatar task.
