# JoinAllworld

An open-source, lightweight browser city-life game. You pick a city on a world map, move between venues, and spend time on activities that change your cash and needs. Lagos is the first city; Ibadan is the second, and cities are meant to become reusable packs rather than one-off builds.

JoinAllworld is original work built in a new repository. No files were copied from the older Allworld project, and no assets or code were extracted from any reference game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test          # node --test: life model, persistence and server suites
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

- **World map.** A schematic SVG map with pan, zoom, rotate and keyboard controls, and pins for Lagos and Ibadan. An optional button uses browser geolocation to suggest the nearer city.
- **Venue view** built from procedural Three.js geometry — no downloaded models or textures.
- **A separate life per city**, held on the server. Cash, needs, location and the action in progress are changed only by the server and settled against server time, so an action finishes even if you close the tab.
- **One complete activity:** Chill under the trees (11 seconds, energy +4, fun +10), plus paid travel between two venues (trek, keke, danfo, okada, cab).
- **Idempotent actions.** Every action carries a client-generated ID. A repeat returns the recorded outcome instead of charging twice, and reusing an ID for a different action is rejected.
- **Device sessions.** A random secret in an `HttpOnly` cookie plus a nickname. This identifies a browser, not a person — it is not an account. Sessions expire, and there is no way to recover one.
- **Community panel.** Each venue is a room with live presence and text chat. You can only join the room for the venue your character is actually in.
- **Opt-in voice.** Nothing touches the microphone until you press Join voice and grant permission. You join muted, can choose an input device, and up to eight people can be in voice per room.

## What does not work yet

- **Voice is unverified.** The code path exists, but audio between two real clients has not yet been proven. It is peer-to-peer, needs HTTPS (or `localhost`), and has no TURN relay, so it can fail on restrictive or mobile networks. Treat it as experimental.
- **Ibadan is a starter.** It has its own server-side life and its own venue names, but reuses the Lagos venue structure and activities. A proper city-pack format — venues, spots, map layout and fares as data — is not finalised.
- **Very little content.** One venue has no activities, and most activities at the other are listed but disabled.
- **No accounts.** No passwords, sign-in, account recovery or moving a life between devices.
- **No moderation.** No blocking, reporting or chat filtering.
- Jobs, homes, skills, property, elections and interiors are not implemented.
- **Storage is one JSON file** on the server's disk. A separate deployment target with different storage is being developed and is not part of this tree.

## Reference behaviour is provisional

Some labels, prices and timings follow what was observed in a public Lagos city-life game. Only values marked as observed in `src/life.js` are treated as verified; everything else — starting cash, starting needs, travel time, cancellation rules — is a placeholder and is flagged as such in the code. Unseen mechanics are not claimed as replicas, and this project does not claim parity with any reference.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/life-main.js` | Client entry |
| `src/life.js` | Life rules shared by client and server: venues, activities, travel |
| `src/life-ui.js`, `src/venue-world.js` | Interface and the Three.js venue scene |
| `src/world-map.js` | SVG world map and city picker |
| `src/community.js` | Room presence, chat and voice |
| `server/server.js` | HTTP API, static files, WebSocket rooms |
| `server/protocol.js`, `server/life-service.js` | Validation and life-settlement logic, kept free of I/O |
| `server/store.js` | Serialised JSON file store |
| `src/*.test.js`, `server/*.test.js` | `node --test` suites |

`prototype.html`, `src/main.js`, `src/game.js`, `src/world.js`, `src/persistence.js` and `src/style.css` are an early experiment from the start of this build. They are not the production entry, are not included in `npm run build`, and may be removed.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT). All scene and map geometry is written in code. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; only the early experiment's stylesheet loads it from Google Fonts (SIL Open Font License).
