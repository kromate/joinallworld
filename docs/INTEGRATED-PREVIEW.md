# Combined local preview

This branch combines the implemented work from the neighbourhood chat, avatar chat, commerce chat and UNILAG chat for local testing. It is not a production release or completion of the remaining roadmap.

## Local branches

| Repository | Branch | Local location | Commit |
| --- | --- | --- | --- |
| Allworld | `codex/allworld-integrated-preview` | `/Users/anthonyakpan/.codex/worktrees/neighbourhood-life/JoinAllworld` | Code checkpoint `38293297`; later documentation commits may follow |
| Goalmatic | `codex/allworld-integrated-preview` | `/Users/anthonyakpan/Desktop/go/gm` | `b41a1add` |
| Store Studio | `codex/allworld-integrated-preview` | `/Users/anthonyakpan/Desktop/mini/apps/store-studio` | `441152e` |

The Allworld preview is `http://127.0.0.1:5184/`, served from the worktree above. No remote branch, pull request or deployment was created by this consolidation.

## What to try

1. Open `/unilag`. A fresh guest can choose **Explore UNILAG** and start at Main Gate. Existing players receive the usual travel choice.
2. At home, open **Upgrade & manage home**, or **Phone → Houses**. Check upgrade cost, build time and the savings shortfall.
3. Use the front door, visit the street, and return home. **Phone → My land**, **Story scenes** and **Capture** remain available.
4. Open **Phone → Business** for simulated businesses and **Phone → My Store** for real commerce. Real commerce requires the provider configuration described in `COMMERCE.md`; it is not a second game wallet.
5. Open the map, choose a destination, change travel mode, and switch between city and world views.

## Sources and preservation

- Neighbourhood: `01a115e4-c2fc-7300-a97c-d9d0dedf9e91`.
- Avatar: `01a11602-5b0a-7b40-9517-eaad55171e97`.
- Commerce: `01a11666-877d-7f63-a99e-6037ab86c2fd`.
- UNILAG: `01a116da-ee60-7353-be52-224472c41142`.

Commerce and UNILAG were authored in the old primary checkout at `f115424`, 318 commits behind this worktree's `57bde97` baseline. Their changes are ported onto the newer game rather than replacing newer files wholesale. The older checkout remains intact. Its unrelated `CONTRIBUTING.md`, package and tools changes are excluded.

Real commerce uses `server/commerce`, `/api/commerce`, `db.commerce` and the `commerce` Phone panel. Existing simulated businesses keep their original `business` namespace and game-money behavior. Goalmatic and Store Studio require separate companion commits because they are separate Git repositories. Their unrelated working-tree changes were preserved and excluded from these commits, including mixed-file hunks.

Before integration, dirty files, binary patches and staged patches were backed up under `/var/folders/3x/y9y7vtp934q97zk_sl810lj40000gn/T/allworld-consolidation-56vtdb3r`. SHA-256 comparison confirmed that the older Allworld, Goalmatic and Store Studio working files were unchanged after selective companion staging and commits.

A later final comparison found new wallet-effect, life-command and socket-budget work appearing in the older primary checkout. Those later changes were left untouched and are outside the four-chat snapshot consolidated here. The Goalmatic and Store Studio working files still matched their backups exactly. Their unrelated uncommitted changes remain available on disk.

## Verification record

- Exact staged Goalmatic backend snapshot: full TypeScript check passed (`/tmp/allworld-companion-core-types.log`).
- Exact staged Store Studio snapshot: production build passed (`/tmp/allworld-companion-store-build.log`).
- Allworld combined production build: passed. All measured download limits passed: startup 608,810/609,000 raw bytes, 220,128/223,000 gzip and 192,542/195,600 Brotli. Headroom is small; no limit was raised.
- Full typecheck: not green. It reports the unchanged `src/types/engine.test.ts:339` reader expectation missing the new stories state. No new source errors were reported. Existing tests remain unchanged.
- Selected existing quick-start, bootstrap, game-state, campus-student and campus-game checks: 37/37 passed (`/tmp/allworld-consolidation-focused.log`). This is not a claim that the full suite passes.
- Commerce consolidation: six domain/route/store/account checks passed, preserving native business data and excluding grants/PKCE from export. Providers were synthetic; no real transaction or connection was made.
- UNILAG: generator, five focused entry/navigation/appearance checks and mapped-data preservation passed. All 875 footprints and 194 roads remain. Six shuttle stops have sourced locations. The integrated campus uses a human-scale avatar and distance-based gait.
- Campus rendering: maximum 56,797 triangles and 30 draws over 13 checked locations with 12 peers, within the original 60,000/60/12 limits. Far geometry is simpler; nearby details remain. Stationary campus peers use static geometry while preserving their looks.
- Map loading: four actual Vue lifecycle checks passed for demand loading, early navigation intent, reuse and retry. The commerce callback flow was unchanged.
- Built-browser checks: fresh UNILAG guest entry, an activity and its existing introductory reward, mobile walk controls, My Store's honest configuration state, independent native Business, home upgrade costs, a free map trip, home door round trip, map reopening and world-level navigation passed. Campus diagnostics showed 53,775 triangles/22 draws and a stopped idle loop. Checked consoles had no errors.
- Evidence is local under ignored `evidence/`: `commerce-consolidation.json`, `campus-consolidation.json`, `campus-lod-check.json`, `map-demand-check.json`, `combined-campus-browser.json`, and the combined mobile screenshots. Build/type/budget logs are `/tmp/allworld-integrated-c4-*.log` and `/tmp/allworld-consolidation-final-types.log`.

Unresolved campus landmark locations and interpreted building heights remain documented; this is not a claim of a finished replica. Frozen movement and campus-stop expectations from earlier checks also remain in the feature handoffs. Real Firebase phone, Dojah, Goalmatic channel and payment-provider acceptance still require their configured environments.

The feature-specific records remain [neighbourhood work](NEIGHBOURHOOD-PLAN.md), [avatar acceptance](AVATAR-WORK.md), [commerce configuration](COMMERCE.md) and [UNILAG fidelity](unilag-data/FIDELITY.md). The broader roadmap is not complete merely because its implemented work has been consolidated. Provider credentials, hosted payment/verification acceptance and deployment remain separate from this local preview.
