# JoinAllworld

An open-source, lightweight browser city-life game. You pick a city on a world map, move between venues, and spend time on activities that change your cash and needs. Lagos is the first city; Ibadan is the second, and cities are meant to become reusable packs rather than one-off builds.

JoinAllworld is original work built in a new repository. No files were copied from the older Allworld project, and no assets or code were extracted from any reference game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test            # rules engine, scenes, client model and Node server suites
npm run first-day   # one scripted new life, start to Saturday rent, with a transcript
npm run two-players # two scripted players: presence, messages, a house visit, a gift, an election
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
- **Starter goals, wishes, stars, perks and a lifetime dream.** Seven starter goals pay cash and a star once each; after them the goal chip becomes a rolling next step. *Observed:* goal titles, the rewards of goals 1–4 and 6, the first three wishes, the first eight perks. *Original:* the rewards of goals 5 and 7, the rest of the wish and perk lists, dream progress formulas and the dream reward. "Make a new friend" completes when you greet one of a venue's regulars or make a friend.
- **A home you furnish.** A grid room sized by the house, Buy mode with nine category tabs, placement with a ghost, move, store and sell, a shared kitchen with ingredients, eleven recipes and a Groceries app. *Observed:* six Comfort items, recipe names and durations, starting ingredients. *Original:* every other price, what star ratings do, grocery prices, the rule that ingredients are used only when a meal finishes.
- **A city to move around.** 22 venues and your home (each with two regulars) on an in-city map with opening hours, a venue card with five travel modes (Danfo selected by default), fares charged at departure, per-mode trip times, roadside events, weather and illness. *Observed:* the venue list, two fare bands, the trek's need cost, one roadside event, one opening time. *Original:* nearly every activity's numbers, all trip times, the cross-lagoon fare band, opening hours, the other roadside events, weather and how illness is caught and cured.
- **Careers.** Fourteen tracks, each with a six-level ladder, a workplace on the map and one paid shift per Lagos day; "Go automatically" commutes to the work spot when the workplace is open. Jobs and Career show the workplace's opening hours with the same label the map uses. *Observed:* entry roles and entry pay, the five-day Tech week, 50% starting performance. *Original:* the whole shift design — the reference shift was never seen — plus pay above entry level, promotion gates and work days. The older Community helper job still works for existing saves, limited to one ₦300 shift every four hours (original).
- **Money.** Weekly rent and the loan instalment are collected on Saturdays (Lagos time) even while you are away, each exactly once, each with a ledger line; missed rent becomes arrears with a late fee. Houses, cars and fixed deposits can be bought in Phone apps. *Observed:* rents, the loan figures, house and car price points. *Original:* how bills are collected, arrears, deposits, fuel costs.
- **Needs, mood and a transaction log.** Six needs fall slowly in real time (never below 10 on their own, and at most four hours' worth while you are away). Mood is one of five words (observed) from thresholds that are original. Every cash change is recorded with its reason and shown in Phone → Bank.
- **A separate life per city**, held on the server. Cash, needs, location and the action in progress are changed only by the server and settled against server time, so an action finishes even if you close the tab.
- **Idempotent actions.** Every action carries a client-generated ID. A repeat returns the recorded outcome instead of charging twice, reusing an ID for a different action is rejected, and IDs older than 24 hours are refused.
- **Device sessions.** A random secret in an `HttpOnly` cookie plus a nickname. This identifies a browser, not a person — it is not an account. Sessions expire, and there is no way to recover one.
- **People.** Every public venue has two regulars (NPCs) you can greet, gist with, joke with, compliment or buy a drink; closeness grows through four tiers. Real players in your venue room are listed from the server's own presence, with truthful Online / Away / Reconnecting / Offline. You can find a player by name, send a friend request, block and report. *Observed:* the five NPC interactions and their tags, Say Hello's +12 Social and +2 Fun, the ₦300 drink, the 60% joke chance, one NPC name and role, a closeness meter that unlocks "Bae" at 40. *Original:* every other name, quote, number, tier and limit, and the whole design of friendships, blocking and reports.
- **Messages.** Direct messages, groups of friends, a house chat, and one **Updates** feed: friend requests, knocks and gifts beside what your own life posts — rent due, paid and missed, loan payments, promotions, illness, and news from the Governor. A message you send shows as sending, then sent or failed with a retry that can never store it twice. *Observed:* the Chats / Updates tabs and the idea of groups. *Original:* everything about how they work.
- **House visits.** Share your house link; a visitor knocks while you are at home; you let them in or not. Up to five guests join your home room, where you see them standing by the door, and share a house chat. A visit ends after 30 minutes, when the guest leaves or is asked to, or when you go out. *Observed:* the link, the knock and the two answers, five guests. *Original:* the rest. Guests do not see the host's furniture yet.
- **Gifts of naira between friends,** deliberately limited: only money earned from work (shift pay and paid gigs — never start cash, the loan, goal rewards or prizes), ₦5,000 a gift, three gifts and ₦10,000 a day, an account at least a day old and a friendship at least an hour old. Debited and credited once, in both ledgers. *Original design:* the reference game's rules were not observed.
- **Family and contacts.** A daily check-in call to four family members (original); "Mummy" as a contact was observed.
- **Governor.** A weekly election on Lagos time: nominations Monday–Wednesday (a ₦2,000 in-game filing fee), one vote per player Thursday–Saturday cast in person at the Polling Unit, and on Sunday the winner takes office for a week and can post announcements that reach every resident's Updates. *Observed:* that a Governor, a Polling Unit and a State House exist, and the State House's empty-state wording. *Original:* the entire mechanism.
- **Neighbours and the Rich List.** Real counts of players and who is online, a directory of homes by district, top balances and top earners of the week; you can hide yourself from either list. *Observed:* that homes appear on the map with an online count. *Original:* the rest.
- **Billboards and sea plots.** Rent one of twelve roadside billboards or a plot in a 16 × 16 patch of sea with in-game naira and put one line of text, a colour and an icon on it. They are drawn on the city map behind its Billboards and Sea layers. *Observed:* "from ₦100 a plot" for 30 days. *Original:* everything else. There are no uploaded images and no links.
- **Daily gem hunt.** Three gems hidden for you each Lagos day; find them by going to the places in the clues, then claim ₦3,000 once. *Observed:* the HUD chip wording and the prize. *Original:* the whole mechanic.
- **Club radio.** In the four club venues a banner shows the shout-out that is "playing" and a button to buy one: a song title and artist as text, queued on server time. No audio is played. *Observed:* the chip and button labels. *Original:* the rest.
- **City map layers.** Billboards, Sea, Neighbours and Gov toggles draw those overlays from the server's own data; with Gov on, the State House opens the Governor sheet.
- **World map, venue scenes and avatars.** A schematic SVG world map (Lagos and Ibadan) and one procedural Three.js scene per venue kind with day, dusk and night lighting. Your avatar wears your saved look and stands at the spot you chose (and takes the spot's pose during an activity); regulars stand at their places with a green dot; real players in your room are drawn from the look the server holds for them with an "@name" tag; you carry a crown. Scenes are static and drawn on demand only: nothing renders while the game is idle, with or without a crowd. Characters do not walk.
- **Community panel and opt-in voice.** Public venues have live presence and text chat; home rooms are private to the host and the guests they have let in. Nothing touches the microphone until you press Join voice; you join muted, and proximity controls who you hear.
- **Settings.** Sound and music preferences saved on the device (the build has no audio yet, and the tab says so), an explanation of what a device session is, and the privacy switches.

### The scripted first day

```sh
npm run first-day
```

Starts the server in-process with a temporary data directory and a controlled clock, then plays one new life over HTTP exactly as the browser does: character creation, the seven starter goals, a cancelled and a completed bath and paid meal, a Tech shift, a trek home, an interrupted nap, a cooked meal, a server restart, an idempotent replay and Saturday billing. Every step asserts the exact wallet and need values and prints one transcript line. The same run is part of `npm test`.

### The scripted two players

```sh
npm run two-players
```

Two device sessions, each with a room socket and a social socket, against the same in-process server and controlled clock: both create a Sim; they see each other at Freedom Park and stop seeing each other the moment one leaves; friend request and accept; a message retried and stored once; a knock, a let-in, the host's home room and house chat, and the end of the visit; a shift's wages and a gift a day later; a declaration for Governor on Monday, a vote at the Polling Unit on Thursday, the winner's announcement in the other player's Updates on Sunday; a sea plot in the public listing; and the gem hunt paid once. It finishes by checking that no cookie secret reached the other player or the social and civic collections. Also part of `npm test`.

## What does not work yet

- **No accounts.** No passwords, sign-in, recovery email or moving a life between devices. An accounts design exists as a separate, unmerged proposal; `server/auth.js` and `server/routes/auth.js` are inert placeholders and Settings has no account section.
- **Moderation is thin.** Players can block and report, and a report is stored with a receipt — but **there is no moderator tool to read or act on reports**, and **no text filtering** of names, chat, messages, slogans, announcements, ad text or song titles beyond length limits, control-character removal and (for civic text) refusing anything that looks like a web address. Run it only among people you trust.
- **Elections are not polls.** A device session is not a verified person. One player can open several sessions; the only brake on sock-puppet voting is that a life must have lived a Lagos day before voting and two before running. Treat results as a game.
- **A house visit is presence and chat.** Guests join the host's home room and the house chat, and the host sees them at the door; guests do not see the host's room or furniture, and the browser offers no voice in a house visit.
- **The community panel and the social features use two sockets.** Venue chat, presence and voice live in the community panel; friends, messages and who-is-here in the Phone and Sim sheets.
- **Enforced character creation, the social features and the civic features are Node-server only.** The Cloudflare adapter serves the core life, action and room protocol; it does not mark new sessions for character creation and has no social or civic routes.
- **The first-day numbers are a mix.** Start cash, starting needs, goal rewards 1–4 and 6, the Danfo and trek costs, the ₦550 meal and Say Hello's effect match what was observed. The shift, the nap rate, skill gains, dream progress and need decay are original, so a session will not match the reference game number for number.
- **Workplaces and the Polling Unit close.** You can only travel to a venue during its opening hours; a gem hidden behind a closed door waits for opening time.
- **No audio.** There is no music or sound effect anywhere; club radio is text.
- **No real money, no uploads, no links.** Everything is paid in in-game naira; there is no top-up. Ads are text, a colour and an icon. Nothing a player types is ever rendered as a link.
- **Voice remains experimental.** Two browser sessions on loopback passed real bidirectional WebRTC transport with a generated tone, mute, leave, and near/mid/far proximity checks. Physical microphones and external networks remain untested. No TURN provider is configured yet, so restrictive networks may fail. The authenticated configuration endpoint supports an injected short-lived credential provider; it never embeds persistent provider secrets in the frontend.
- **Ibadan is a starter.** It has its own server-side life, election, ads and directory and its own venue names, but reuses the Lagos venue structure, map positions, regulars and activities. A proper city-pack format is not finalised.
- **Push notifications, "free will", pets as companions, weather beyond rain, power cuts** and anything else not listed under What works today do not exist.
- **Node storage is one JSON file** on the server's disk, rewritten on every change. The optional Cloudflare adapter uses SQLite Durable Objects; deployment configuration is included in `wrangler.jsonc`.

## The server's surface

HTTP routes (all under the same-origin check and the per-address rate limit; `server/routes/`):

| Area | Routes |
| --- | --- |
| Core | `POST /api/session` · `GET /api/session` · `GET /api/life` · `POST /api/action` · `GET /api/voice-config` |
| Social | `GET /api/social/me` · `POST /api/social/updates/read` · `GET /api/social/people` · `GET /api/social/search` · `GET /api/social/players/:id` · `POST /api/social/players/:id/interact` · `POST /api/social/friends/request` · `POST /api/social/friends/answer` · `POST /api/social/friends/remove` · `POST /api/social/block` · `POST /api/social/unblock` · `POST /api/social/reports` · `GET /api/social/conversations` · `GET /api/social/conversations/:id` · `POST /api/social/conversations/:id/read` · `POST /api/social/messages` · `POST /api/social/groups` · `POST /api/social/groups/:id` · `GET /api/social/house/:host` · `POST /api/social/house/knock` · `POST /api/social/house/answer` · `POST /api/social/house/leave` · `POST /api/social/bae/ask` · `POST /api/social/bae/answer` · `POST /api/social/bae/end` · `POST /api/social/transfers` |
| Civic | `GET /api/civic/pulse` · `GET /api/civic/gov` · `POST /api/civic/gov/run` · `POST /api/civic/gov/vote` · `POST /api/civic/gov/announce` · `GET /api/civic/neighbours` · `GET /api/civic/ads` · `POST /api/civic/ads/rent` · `POST /api/civic/ads/remove` · `GET /api/civic/hunt` · `GET /api/civic/radio` · `POST /api/civic/radio/shoutout` · `GET /api/civic/richlist` · `POST /api/civic/prefs` |
| Accounts | none (`/api/auth/*` is reserved and answers 404) |

WebSocket messages on `/socket` (`server/ws/`):

- Client → server, rooms: `join` (`{ cityId, venueId }`, or `{ cityId, venueId: 'home', hostId }` for an accepted guest), `move`, `voice-state`, `signal`, `chat`.
- Client → server, social: `dm-send`, `dm-read`, `people-list`, `friend-request`, `friend-answer`, `invite-knock`, `invite-answer`.
- Server → client: `presence`, `chat`, `signal`, `error`; `dm`, `dm-sent`, `dm-failed`, `dm-read-ok`, `people`, `people-changed`, `people-presence`, `people-interaction`, `friend-request`, `friend-accepted`, `friend-result`, `invite-knock`, `invite-answer`, `invite-result`, `invite-house`, `social-update`, `social-sync`, `transfer`.

Stored collections in the one data document (`devices.json` on Node): `sessions` (device sessions with their lives per city and action receipts), `archivedLives`, `social` (players, conversations, houses, pending life effects, receipts, reports) and `civic` (preferences and, per city, residents, elections and announcements, ads, hunt counters, radio queues). Only public ids are stored in `social` and `civic`.

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
| `src/venue-world.js` | Thin Three.js host: renders a venue scene on demand only, applies its lighting, disposes it on leaving, and projects name tags |
| `src/scene/` | Procedural geometry: `venue-scenes.js` (one scene per venue kind), `venues-*.js`, `home-scene.js`, `characters.js` (avatars), `crowd.js` (who stands in a scene, from real data), `props.js`, `build.js`, `kit.js` |
| `src/game/social-model.js` | Pure client-side model for messages (outbox, retry) and presence wording |
| `src/world-map.js`, `src/city-map.js` | SVG world map and city picker; the in-city map of venues, drawn on demand |
| `src/community.js` | Room presence, chat and voice |
| `server/server.js` | Node host: HTTP and WebSocket plumbing, static files, server context |
| `server/routes/` | HTTP endpoints. `index.js` is the route registry — **the contract for adding a route**; `core.js` holds session (including the flag that enforces character creation), life, action and voice-config; `social.js` and `civic.js` are thin adapters |
| `server/ws/` | WebSocket message types. `index.js` is the registry; `rooms.js` holds presence, movement, chat, voice state, signalling and the guest rule for Home rooms; `social.js` the social messages |
| `server/social/`, `server/civic/` | The player-to-player rules (friends, messages, houses, gifts, reports, presence) and the shared city rules (elections, ads, radio, residents) |
| `server/protocol.js`, `server/life-service.js` | Validation, idempotency and settlement logic, free of I/O and shared with the Cloudflare adapter |
| `server/store.js` | Serialised JSON file store behind a two-method `transact`/`read` interface |
| `server/auth.js`, `server/routes/auth.js` | Inert placeholders for accounts; device sessions remain the only identity |
| `scripts/first-day.mjs` | The scripted first day (`npm run first-day`), also run by `server/first-day.test.js` |
| `scripts/two-players.mjs` | The scripted two players (`npm run two-players`), also run by `server/two-players.test.js` |
| `**/*.test.js`, `server/test-fixture.js` | `node --test` suites (one per owner under `src/game/`, plus `integration.test.js` for the seams between them) and the shared server fixture |

The only registered placeholders left are the accounts files (`server/auth.js`, `server/routes/auth.js`, `src/ui/panels/account.js`): they mark where a reviewed accounts design would live, not that one exists. [What works today](#what-works-today) is the list of working features.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT). All scene and map geometry is written in code. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.
