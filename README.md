# JoinAllworld

An open-source, lightweight browser city-life game. You pick a city on a world map, move between venues, and spend time on activities that change your cash and needs. Lagos is the first city; Ibadan is the second, and cities are meant to become reusable packs rather than one-off builds.

JoinAllworld is original work built in a new repository. No files were copied from the older Allworld project, and no assets or code were extracted from any reference game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test          # rules engine, client model and Node server suites
npm run first-day # one scripted new life, start to Saturday rent, with a transcript
```

### Development

Run the game server and the Vite dev server in two terminals:

```sh
npm run start:server    # API and WebSocket on port 3001
npm run dev             # client on http://127.0.0.1:5173/
```

Vite proxies `/api` and `/socket` to `127.0.0.1:3001`.

### Production build

```sh
npm run build     # writes dist/
npm start         # serves dist/, the API and the WebSocket from one process
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Listening port |
| `DATA_DIR` | `./.data` | Where the server writes its data file (git-ignored) |
| `SESSION_TTL_DAYS` | `30` | Lifetime of a device session |
| `TRUST_PROXY` | unset | Set to `1` behind an HTTPS reverse proxy so the session cookie is marked `Secure` |

The server does not terminate TLS. Read [SECURITY.md](SECURITY.md) before exposing it to anyone.

### Without the server

The client still loads if the server is unreachable, but it is **read-only**: it shows the last state cached in the browser, and no action, travel or city switch is applied. There is no offline play and nothing is granted locally. Use the retry control once the server is back.

## What works today

Each item says whether it follows behaviour observed in a public Lagos city-life game or is an original beta design. "Observed" means a name, price, duration or sequence was seen; it never means the mechanics behind it are known.

- **Character creation.** Look, two traits, a dream, a birth lottery and a starting home, each step confirmed by the server. A new life opened by this client must finish it before anything else is accepted, and the screen cannot be dismissed until then. Lives saved before character creation existed are never asked. *Observed:* the five steps, the option names, one lottery outcome (a ₦60,000 loan repaid at ₦12,000 a week, start cash ₦96,000 in Yaba or ₦76,000 in Mushin) and the starting needs. *Original:* the other three lottery outcomes and their odds, and every trait strength.
- **Starter goals, wishes, stars, perks and a lifetime dream.** Seven starter goals pay cash and a star once each; after them the goal chip becomes a rolling next step. *Observed:* goal titles, the rewards of goals 1–4 and 6, the first three wishes, the first eight perks. *Original:* the rewards of goals 5 and 7, the rest of the wish and perk lists, dream progress formulas and the dream reward. **Interim rule:** "Make a new friend" completes from any social activity at a venue, because people cannot be tapped yet.
- **A home you furnish.** A grid room sized by the house, Buy mode with nine category tabs, placement with a ghost, move, store and sell, a shared kitchen with ingredients, eleven recipes and a Groceries app. *Observed:* six Comfort items, recipe names and durations, starting ingredients. *Original:* every other price, what star ratings do, grocery prices, the rule that ingredients are used only when a meal finishes.
- **A city to move around.** 22 venues and your home on an in-city map with opening hours, a venue card with five travel modes (Danfo selected by default), fares charged at departure, per-mode trip times, roadside events, weather and illness. *Observed:* the venue list, two fare bands, the trek's need cost, one roadside event, one opening time. *Original:* nearly every activity's numbers, all trip times, the cross-lagoon fare band, opening hours, the other roadside events, weather and how illness is caught and cured.
- **Careers.** Fourteen tracks, each with a six-level ladder, a workplace on the map and one paid shift per Lagos day; "Go automatically" commutes to the work spot when the workplace is open. Jobs and Career show the workplace's opening hours with the same label the map uses. *Observed:* entry roles and entry pay, the five-day Tech week, 50% starting performance. *Original:* the whole shift design — the reference shift was never seen — plus pay above entry level, promotion gates and work days. The older Community helper job still works for existing saves, limited to one ₦300 shift every four hours (original).
- **Money.** Weekly rent and the loan instalment are collected on Saturdays (Lagos time) even while you are away, each exactly once, each with a ledger line; missed rent becomes arrears with a late fee. Houses, cars and fixed deposits can be bought in Phone apps. *Observed:* rents, the loan figures, house and car price points. *Original:* how bills are collected, arrears, deposits, fuel costs.
- **Needs, mood and a transaction log.** Six needs fall slowly in real time (never below 10 on their own, and at most four hours' worth while you are away). Mood is one of five words (observed) from thresholds that are original. Every cash change is recorded with its reason and shown in Phone → Bank.
- **A separate life per city**, held on the server. Cash, needs, location and the action in progress are changed only by the server and settled against server time, so an action finishes even if you close the tab.
- **Idempotent actions.** Every action carries a client-generated ID. A repeat returns the recorded outcome instead of charging twice, reusing an ID for a different action is rejected, and IDs older than 24 hours are refused.
- **Device sessions.** A random secret in an `HttpOnly` cookie plus a nickname. This identifies a browser, not a person — it is not an account. Sessions expire, and there is no way to recover one.
- **World map, venue scenes.** A schematic SVG world map (Lagos and Ibadan) and venue scenes built from procedural Three.js geometry, drawn on demand only: nothing renders while the game is idle.
- **Community panel and opt-in voice.** Public venues have live presence and text chat; home rooms are isolated per device identity. Nothing touches the microphone until you press Join voice; you join muted, and proximity controls who you hear.

### The scripted first day

```sh
npm run first-day
```

Starts the server in-process with a temporary data directory and a controlled clock, then plays one new life over HTTP exactly as the browser does: character creation, the seven starter goals, a cancelled and a completed bath and paid meal, a Tech shift, a trek home, an interrupted nap, a cooked meal, a server restart, an idempotent replay and Saturday billing. Every step asserts the exact wallet and need values and prints one transcript line. The same run is part of `npm test`.

## What does not work yet

- **No social system.** Other players appear only in the community panel. There are no NPCs to talk to, no friends, relationships, messages, contacts, family or invitations; those Phone apps and the People tab are placeholders. The friend goal and the friend dream cannot progress the intended way yet.
- **No civic or world layer.** Governor, neighbours, billboards, the rich list, radio and Settings are placeholders that say "Coming soon".
- **Enforced character creation is Node-server only.** The Cloudflare adapter does not yet mark new sessions, so on that deployment creation is offered but can be skipped.
- **The first-day numbers are a mix.** Start cash, starting needs, goal rewards 1–4 and 6, the Danfo and trek costs and the ₦550 meal match what was observed. The shift, the nap rate, skill gains, dream progress and need decay are original, so a session will not match the reference game number for number.
- **Workplaces close.** You can only travel to a workplace during its opening hours. Every track's workplace opens at some time on each of its work days, but a player hired at night must wait.
- **Voice remains experimental.** Two browser sessions on loopback passed real bidirectional WebRTC transport with a generated tone, mute, leave, and near/mid/far proximity checks. Physical microphones and external networks remain untested. No TURN provider is configured yet, so restrictive networks may fail. The authenticated configuration endpoint supports an injected short-lived credential provider; it never embeds persistent provider secrets in the frontend.
- **Ibadan is a starter.** It has its own server-side life and its own venue names, but reuses the Lagos venue structure, map positions and activities. A proper city-pack format is not finalised.
- **Scenes are simple.** Venue scenes are static procedural sets; characters do not walk, and decorative figures are not other players.
- **No accounts.** No passwords, sign-in, account recovery or moving a life between devices.
- **No moderation.** No blocking, reporting or chat filtering.
- **Node storage is one JSON file** on the server's disk. The optional Cloudflare adapter uses SQLite Durable Objects; deployment configuration is included in `wrangler.jsonc`.

### Cloudflare adapter checks

```sh
npm ci --prefix deploy/tooling
npm run build
npm run test:edge
```

The edge suite uses pinned local tooling and the built static files. Running it does not deploy anything.

## Reference behaviour is provisional

Some labels, prices and timings follow what was observed in a public Lagos city-life game. Content under `src/game/content/` marks original beta values with `beta: true` (or lists the original fields under `betaFields`); only unmarked values follow what was observed. Everything else — need decay, travel time, when a paid activity is charged, cancellation rules, the whole work shift, bill collection — is an original beta choice and is flagged as such in the code. Unseen mechanics are not claimed as replicas, and this project does not claim parity with any reference.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/life-main.js` | Client entry: wires the client model, shell, scenes and community panel |
| `src/client.js` | Browser-side mirror of the server-held life and all networking; read-only while offline |
| `src/life.js` | Public entry to the rules engine shared by server, worker and client: `createLife`, `dispatch`, `advanceLife`, `viewLife` |
| `src/game/registry.js` | System registry, event bus and modifiers — **the contract for adding a game system** |
| `src/game/systems/` | One file per system. Core: `core`, `wallet`, `inventory`, `needs`, `skills`, `activities`. Feature systems: `travel`, `health`, `career`, `economy`, `property`, `home`, `onboarding`, `goals`, `social`, `civic`. `index.js` registers them all |
| `src/game/content/` | Plain-data content: venues, travel, jobs, furniture, food, housing, cars, traits, goals, NPCs, civic, health, events |
| `src/game/api.js`, `util.js`, `clock.js` | Core functions feature systems may call, shared helpers, and Lagos wall-clock time with the one opening-hours label |
| `src/game/home-layout.js`, `character-effects.js` | Pure furniture placement rules; trait, lottery and perk effects applied through modifiers |
| `src/ui/shell.js` | HUD, bottom nav, venue panel, Phone, Sim sheet, toasts — **the contract for adding a panel** |
| `src/ui/panels/` | One file per panel (Phone apps, nav panels, HUD chips, Sim tabs, modals). `index.js` registers them all |
| `src/ui/keys.js`, `dom.js`, `tokens.css`, `shell.css` | Keyboard shortcut map, template helpers, shared design tokens, shell styles |
| `src/venue-world.js` | Thin Three.js host: renders a venue scene on demand only |
| `src/scene/` | Procedural geometry: `venue-scenes.js` (one scene per venue kind), `home-scene.js`, `characters.js`, `props.js`, `kit.js` |
| `src/world-map.js`, `src/city-map.js` | SVG world map and city picker; the in-city map of venues, drawn on demand |
| `src/community.js` | Room presence, chat and voice |
| `server/server.js` | Node host: HTTP and WebSocket plumbing, static files, server context |
| `server/routes/` | HTTP endpoints. `index.js` is the route registry — **the contract for adding a route**; `core.js` holds session (including the flag that enforces character creation), life, action and voice-config |
| `server/ws/` | WebSocket message types. `index.js` is the registry; `rooms.js` holds presence, movement, chat, voice state and signalling |
| `server/protocol.js`, `server/life-service.js` | Validation, idempotency and settlement logic, free of I/O and shared with the Cloudflare adapter |
| `server/store.js` | Serialised JSON file store behind a two-method `transact`/`read` interface |
| `server/auth.js`, `server/routes/auth.js` | Inert placeholders for accounts; device sessions remain the only identity |
| `scripts/first-day.mjs` | The scripted first day (`npm run first-day`), also run by `server/first-day.test.js` |
| `**/*.test.js`, `server/test-fixture.js` | `node --test` suites (one per owner under `src/game/`, plus `integration.test.js` for the seams between them) and the shared server fixture |

Some feature files are still registered placeholders (`social`, `civic`, and the panels listed above): they define where a feature will live, not that it exists. [What works today](#what-works-today) is the list of working features.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT). All scene and map geometry is written in code. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.
