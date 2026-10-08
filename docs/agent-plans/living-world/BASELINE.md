# Source baseline and ownership

Inspected 8 October 2026 at `9f9bed3616ac43e0989ce42d856490cb57d94dba`. Paths below exist at this snapshot unless explicitly called proposals. File presence proves source availability, not deployed behavior. Recheck every candidate before implementation.

## Existing architecture

The client uses Vue 3, strict TypeScript, Three.js and Vite. Node and the Cloudflare Worker share game and route behavior. Configured sign-in and guest sessions both exist; do not reuse older “no accounts” claims. City counts in older prose differ from later release records, so derive current playable coverage from source and a named runtime rather than copying a number.

Read [CONTRIBUTING.md](../../../CONTRIBUTING.md), [SECURITY.md](../../../SECURITY.md), [DEVELOPING.md](../../DEVELOPING.md), [REFERENCE.md](../../REFERENCE.md), [ACCOUNTS.md](../../ACCOUNTS.md), [STORAGE.md](../../STORAGE.md) and [RELIABILITY-IMPLEMENTATION.md](../../RELIABILITY-IMPLEMENTATION.md) when changing their respective boundaries.

| Boundary | Existing paths and contract |
| --- | --- |
| Rules and events | `src/life.ts`, `src/game/registry.ts`, `src/game/api.ts`, `src/game/systems/`. Pure game rules receive state/context; no browser, network, wall-clock or random-source dependency belongs inside them. |
| Shared content | `src/game/content/`; data definitions are separate from transition logic. |
| HTTP and authority | `server/routes/`, `server/routes/once.ts`, `server/protocol.ts`, `server/life-service.ts`, `server/host-context.ts`. Server authority, current identity and venue permission must be checked for every consequential action. |
| Persistence and hosts | `server/store.ts`, `server/server.ts`, `deploy/cloudflare-worker.ts`. Preserve durable receipts, wallet accounting, current saves and supported host behavior. |
| UI | `src/app/features/`, `src/app/state/`, `src/app/ui/`; use existing panel/store boundaries and lazy loading. |
| World and appearance | `src/game/cities/`, `src/map3d/`, `src/scene/`, `src/venue-world.ts`, `src/models/`. Existing graphics/world owners retain these scopes. |

The current once helper rejects conflicting payloads for the same request ID and persists receipts with the mutation. Its receipt window is bounded. A new long-lived delivery or reservation also needs a persisted business-state transition that prevents settling twice under a new request ID or after receipt expiry. Reuse the helper; do not mistake request deduplication for domain uniqueness.

## Reuse inventory

| Area | Read these paths | What this establishes and what remains proposed |
| --- | --- | --- |
| Missions and starter goals | `src/game/content/missions.ts`, `src/game/systems/missions.ts`, `src/game/content/goals.ts`, `src/game/systems/goals.ts`, `src/app/features/growth/` | Daily/weekly event-driven missions and starter goals exist. Missions carry `OWNER: growth`; goal content carries `OWNER: character`. These are subsystem labels, not identified current agents. Connected qualification/service missions need design and verification. |
| Careers and study | `src/game/content/jobs.ts`, `src/game/content/career-ids.ts`, `src/game/cities/formula/careers.ts`, `src/game/systems/career.ts`, `src/app/features/jobs/` | Existing career state/content should be reused. A general qualification registry is not established by this audit. |
| Vehicles and travel | `src/game/content/cars.ts`, `src/game/systems/travel.ts`, `src/map3d/roads.ts`, `src/map3d/vehicles.ts`, `src/models/vehicles/`, `src/app/features/home/CarsApp.vue` | Vehicle assets, ownership/travel systems exist. They do not prove player steering/braking, road tests, rental permission or delivery driving. |
| Barber and appearance | `src/scene/body/appearance.ts`, `src/app/features/start/CreatorApp.vue`, [AVATAR-WORK.md](../../AVATAR-WORK.md) | Appearance machinery exists. No tracked barber module was located; a consenting service loop remains proposed. Confirm semantic equivalents before adding one. |
| Simulated businesses | `src/game/content/business.ts`, `src/game/business-model.ts`, `src/game/systems/business.ts`, `server/business/service.ts`, `server/routes/business.ts`, [BUSINESS.md](../../BUSINESS.md) | Life-local counters/bag and shared `db.business` shops already exist. Their transaction and stock rules are the starting point for shop deliveries and service work. |
| Civic and fictional justice | `server/civic/`, `server/politics/`, `server/routes/civic.ts`, `server/routes/politics.ts`, `src/types/civic.ts`, [POLITICS.md](../../POLITICS.md) | Elections, political and justice-related code exists. Audit actual powers before extending it; no proposed player role gains operator powers. |
| Fictional medicine | Existing needs/career systems and their tests | No tracked medicine/clinic module was located. Clinical simulation is a later proposal, not an asserted implementation. |
| Real commerce | `server/commerce/goalmatic.ts`, `server/commerce/service.ts`, `server/routes/commerce.ts`, `src/types/commerce.ts`, `src/app/features/commerce/CommerceApp.vue`, [COMMERCE.md](../../COMMERCE.md) | An external adapter and explicit commerce collection exist, separate from simulated Business. Deployed provider delivery and a general goals/tasks API are unverified. |

Read [PROGRESSION-BRIEF.md](../../PROGRESSION-BRIEF.md) for the earlier “Hostel Hustle” proposal, [REALISM.md](../../REALISM.md) for NPC/world plans, and [PARITY-DELIVERY.md](../../PARITY-DELIVERY.md) for phase records. Distinguish their proposals, source checks and release evidence.

Exact tracked searches did not locate “Lost Parcel”, “Opening Shift”, “Signal Trail”, “Community Workshop” or “Lane Dash” at the inspected SHA. Treat those names as historical leads. If another authorized branch contains them, inspect provenance, contracts, tests, licences and compatibility before reuse. Do not infer that they shipped, copy a dirty checkout, or replace current systems wholesale.

## Goalmatic handoff

[COMMERCE.md](../../COMMERCE.md) is the current in-repository commerce design; [the research pack](../../commerce-research-2026-10-07/README.md) and [INTEGRATED-PREVIEW.md](../../INTEGRATED-PREVIEW.md) provide historical contract and consolidation context. Their local paths and old SHAs must be translated into the owning repositories and verified branches with the integration owner.

The existing division is concrete: Allworld owns the listing and game/account relationship; Store Studio/Goalmatic owns catalogue, orders, customer and refund flows; payment providers own settlement. The adapter is the external HTTP boundary. Preserve that division and its explicit consent/account checks.

Before changing integration behavior, obtain the owner's contract version, source SHA, sandbox/read-only probe, identity mapping, scopes, revocation behavior and acceptance evidence. Do not assume a general Goalmatic goals/tasks API exists because commerce or workspace APIs exist. An unavailable owner or API blocks the external activation slice only; local missions can use a mock contract behind an off-by-default flag.

## Initial verification targets

Current scripts in `package.json` include `check:fast`, `check:full`, `test:edge`, `economy`, `first-minute`, `first-day`, `new-player`, `two-players`, `two-cities` and `smoke`. Read [FAST-CHECKS.md](../../FAST-CHECKS.md) before selecting checks and [DEVELOPING.md](../../DEVELOPING.md#working-with-several-agents) before sharing a machine.

Relevant existing tests include `src/game/missions.test.ts`, `src/game/career.test.ts`, `src/game/integration.test.ts`, `src/game/economy.test.ts`, `src/game/conservation.test.ts`, `server/business.test.ts`, `deploy/business.edge.test.ts` and the shared protocol/storage suites. New gameplay needs behavioral tests for the new contracts as well as these regressions. This docs publication adds or runs no gameplay tests and opens no implementation PR.
