# JoinAllworld

An open-source, lightweight browser city-life game. You pick a city on a world map, move between venues, and spend time on activities that change your cash and needs. Lagos is the first city; Ibadan is the second, and cities are meant to become reusable packs rather than one-off builds.

JoinAllworld is original work built in a new repository. No files were copied from the older Allworld project, and no assets or code were extracted from any reference game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test          # rules engine, client model and Node server suites
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

- **World map.** A schematic SVG map with pan, zoom, rotate and keyboard controls, and dot markers for Lagos and Ibadan. An optional button uses browser geolocation to suggest the nearer city.
- **Venue view** built from procedural Three.js geometry — no downloaded models or textures.
- **A separate life per city**, held on the server. Cash, needs, location and the action in progress are changed only by the server and settled against server time, so an action finishes even if you close the tab.
- **Home and park activities:** Chill (11 seconds, energy +4, fun +10), Garri (5 seconds, hunger +20), Bath (6 seconds, hygiene +25), and Nap (15 seconds, energy +2 per second). Home amounts are explicit beta choices where the exact general formula was not observed. Nap retains accrued energy when stopped. Home travel uses free trek; other transport options have preview fares.
- **Community helper job.** Apply in Phone → Jobs, go straight to the community desk, and work a 20-second shift for ₦300. Requires Energy and Hunger of at least 20; completion uses 10 Energy and 5 Hunger. Cancellation gives no reward. These are original beta rules, not a reproduced career schedule.
- **Needs, mood and a transaction log.** Six needs fall slowly in real time (never below 10 on their own, and at most four hours' worth while you are away). Mood is derived from needs and feelings. Every cash change is recorded with its reason and shown in Phone → Bank.
- **Idempotent actions.** Every action carries a client-generated ID. A repeat returns the recorded outcome instead of charging twice, and reusing an ID for a different action is rejected.
- **Device sessions.** A random secret in an `HttpOnly` cookie plus a nickname. This identifies a browser, not a person — it is not an account. Sessions expire, and there is no way to recover one.
- **Community panel.** Public venues have live presence and text chat; home rooms are isolated per device identity. You can only join the room for the venue your character is actually in.
- **Opt-in voice.** Nothing touches the microphone until you press Join voice and grant permission. You join muted, can choose an input device, and up to eight people can be in voice per room. A separate venue-space map controls proximity: voices fade with distance and disconnect at 12 virtual units. These positions do not move the decorative scene characters.

## What does not work yet

- **Voice remains experimental.** Two browser sessions on loopback passed real bidirectional WebRTC transport with a generated tone, mute, leave, and near/mid/far proximity checks. Physical microphones and external networks remain untested. No TURN provider is configured yet, so restrictive networks may fail. The authenticated configuration endpoint supports an injected short-lived credential provider; it never embeds persistent provider secrets in the frontend.
- **Ibadan is a starter.** It has its own server-side life and its own venue names, but reuses the Lagos venue structure and activities. A proper city-pack format — venues, spots, map layout and fares as data — is not finalised.
- **Very little content.** One venue has no activities, and most activities at the other are listed but disabled.
- **No accounts.** No passwords, sign-in, account recovery or moving a life between devices.
- **No moderation.** No blocking, reporting or chat filtering.
- Skills exist in the rules engine but nothing in the game grants skill experience yet. Purchasable property and elections are not implemented; only the starter Community helper job is available. Most Phone apps and Sim tabs are placeholders. The home is a starter interior, not a property market.
- **Node storage is one JSON file** on the server's disk. The optional Cloudflare adapter uses SQLite Durable Objects; deployment configuration is included in `wrangler.jsonc`.

### Cloudflare adapter checks

```sh
npm ci --prefix deploy/tooling
npm run build
npm run test:edge
```

The edge suite uses pinned local tooling and the built static files. Running it does not deploy anything.

## Reference behaviour is provisional

Some labels, prices and timings follow what was observed in a public Lagos city-life game. Content under `src/game/content/` marks original beta values with `beta: true`; only unmarked values follow what was observed. Everything else — starting cash, starting needs, need decay, travel time, when a paid activity is charged, cancellation rules — is an original beta choice and is flagged as such in the code. Unseen mechanics are not claimed as replicas, and this project does not claim parity with any reference.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/life-main.js` | Client entry: wires the client model, shell, scenes and community panel |
| `src/client.js` | Browser-side mirror of the server-held life and all networking; read-only while offline |
| `src/life.js` | Public entry to the rules engine shared by server, worker and client: `createLife`, `dispatch`, `advanceLife`, `viewLife` |
| `src/game/registry.js` | System registry, event bus and modifiers — **the contract for adding a game system** |
| `src/game/systems/` | One file per system. Core: `core`, `wallet`, `inventory`, `needs`, `skills`, `activities`. Feature systems: `travel`, `health`, `career`, `economy`, `property`, `home`, `onboarding`, `goals`, `social`, `civic`. `index.js` registers them all |
| `src/game/content/` | Plain-data content: venues, travel, jobs, furniture, food, housing, cars, traits, goals, NPCs, civic, health, events |
| `src/game/api.js`, `util.js`, `clock.js` | Core functions feature systems may call, shared helpers, and Lagos wall-clock time |
| `src/ui/shell.js` | HUD, bottom nav, venue panel, Phone, Sim sheet, toasts — **the contract for adding a panel** |
| `src/ui/panels/` | One file per panel (Phone apps, nav panels, HUD chips, Sim tabs, modals). `index.js` registers them all |
| `src/ui/keys.js`, `dom.js`, `tokens.css`, `shell.css` | Keyboard shortcut map, template helpers, shared design tokens, shell styles |
| `src/venue-world.js` | Thin Three.js host: renders a venue scene on demand only |
| `src/scene/` | Procedural geometry: `venue-scenes.js` (one scene per venue kind), `home-scene.js`, `characters.js`, `props.js`, `kit.js` |
| `src/world-map.js`, `src/city-map.js` | SVG world map and city picker; in-city map (placeholder) |
| `src/community.js` | Room presence, chat and voice |
| `server/server.js` | Node host: HTTP and WebSocket plumbing, static files, server context |
| `server/routes/` | HTTP endpoints. `index.js` is the route registry — **the contract for adding a route**; `core.js` holds session, life, action and voice-config |
| `server/ws/` | WebSocket message types. `index.js` is the registry; `rooms.js` holds presence, movement, chat, voice state and signalling |
| `server/protocol.js`, `server/life-service.js` | Validation, idempotency and settlement logic, free of I/O and shared with the Cloudflare adapter |
| `server/store.js` | Serialised JSON file store behind a two-method `transact`/`read` interface |
| `server/auth.js`, `server/routes/auth.js` | Inert placeholders for accounts; device sessions remain the only identity |
| `**/*.test.js`, `server/test-fixture.js` | `node --test` suites and the shared server fixture |

Many feature files are registered placeholders: they define where a feature will live, not that it exists. [What works today](#what-works-today) is the list of working features.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT). All scene and map geometry is written in code. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.
