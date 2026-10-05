# Allworld

Allworld is an open-source, lightweight browser game about a digital world you can live in: explore cities and cultures, work, travel, make friends and play. Today one city, Lagos, is open and playable; the in-game atlas shows the world, then Africa, then Nigeria, with other places marked as coming. You pick a city on the map, travel between venues on a 3D city map, walk around inside them, and spend time on activities that change your cash and needs. Cities are meant to become reusable packs rather than one-off builds.

Allworld (this repository, `joinallworld`) is original work built in a new repository. No files, assets or code were copied from the earlier Allworld v1 project or from any other game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test            # rules engine, scenes, client model, Node server suites and the type conformance tests
npm run typecheck   # vue-tsc over five projects: 0 errors allowed in .ts and .vue, existing JavaScript held to tsconfig/baseline.json
npm run first-day   # one scripted new life, start to Saturday rent, with a transcript
npm run first-minute # one brand-new player: Play → first reward → settling in, timed in server time
npm run new-player  # the merged game end to end: two new players, a house, missions, a share link, Whot, a referral
npm run two-players # two scripted players: presence, messages, a house visit, a gift, an election
npm run economy     # scripted lives under eight strategies (a UNILAG student among them), played through the rules engine: the balance table
npm run load        # N simulated players against an in-process server: latency and file writes
npm run world-load  # the local-government registry at city scale (writes large temporary files and deletes them)
npm ci --ignore-scripts --prefix deploy/tooling && npm run build
npm run test:edge   # the Worker host in Miniflare: conformance, and the whole new-player journey on the Workers runtime
npm run start:worker # the Worker host on this machine (Miniflare, built assets), default http://localhost:8787
```

### Development

Start the complete local game with one command:

```sh
npm run dev             # game, API and WebSocket at http://127.0.0.1:5173/
```

The launcher starts a dedicated API on a free loopback port and connects Vite to it. Set `DEV_PORT` to use a different frontend port. It fails clearly if that port is already occupied and stops both servers when you press Ctrl+C. `npm run start:server` remains available for running the API separately. Two development-only previews are not part of a build: `npm run preview:campus` (the walkable UNILAG campus, `campus.html`) and `npm run preview:models` (the model workshop, `models.html`; see [docs/MODELS.md](docs/MODELS.md)). `voice-test.html` is a development fixture and is not a build input either.

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
| `TRUST_PROXY` | unset | Set to `1` behind **one** trusted HTTPS reverse proxy: the session cookie is marked `Secure`, and rate limits and the vote cap use the right-most `X-Forwarded-For` entry (the address that proxy saw) instead of the proxy's own address |
| `MODERATOR_TOKEN` | unset | Operator secret for `/api/mod/*` (at least 24 characters). Unset or shorter: those routes answer 404. See [Moderating a server](#moderating-a-server) |
| `VOTES_PER_ADDRESS` | `3` | How many votes from one network address in one election before the address is flagged (`0` turns the check off). See SECURITY.md for the trade-off |
| `VOTE_CAP_MODE` | `flag` | `flag`: votes past that number are **counted** and the operator's audit trail gets one line per address. `refuse`: votes past it from a public address are refused. Many real voters share one public address on mobile networks, so `refuse` is opt-in |
| `HEARTBEAT_SECONDS` | `10` | How often every socket is pinged (1–60). A dead connection stops showing as online within this plus 5 s |
| `STORE_WRITE_MB_PER_S` | `50` | Write budget for the data file: after a write of B bytes the next waits B ÷ this |
| `BUILD_ID` | package version | Recorded in problem reports so an operator knows which build a player was on |
| `PUBLIC_ORIGIN` | the request's own host | The game's public address, e.g. `https://play.example`. Written into link previews, and required for e-mail (links in a message must be absolute) |
| `ZEPTOMAIL_AUTH` | unset | The full `Authorization` value of a Zoho ZeptoMail mail agent (`Zoho-enczapikey …`). Unset: e-mail runs in dry-run and nothing is sent. Never commit it |
| `EMAIL_FROM_ADDRESS` | unset | Sender address on a domain verified in ZeptoMail. Unset: dry-run |
| `EMAIL_FROM_NAME` | `Allworld` | Sender display name |
| `EMAIL_CONTACT_LINE` | unset | The sender's postal or contact line printed at the foot of every e-mail |
| `EMAIL_DAILY_CAP` | `500` | Most scheduled e-mails the server sends in one Lagos day |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | made on first use | Web-push keys (base64url). Unset: a pair is generated once and kept in `DATA_DIR/keys/vapid.json`, mode 0600 |
| `VAPID_SUBJECT` | `PUBLIC_ORIGIN` | Contact for push services: a `mailto:` or `https:` address |
| `PUSH_DAILY_CAP` | `5000` | Most scheduled notifications in one Lagos day |
| `WHATSAPP_CHANNEL_URL` | unset | The owner's WhatsApp Channel (`https://whatsapp.com/channel/…`). Set: a "Follow Allworld on WhatsApp" link is shown in Events and Stay in touch. The game uses no WhatsApp API |

The server does not terminate TLS. Read [SECURITY.md](SECURITY.md) before exposing it to anyone.

### Telemetry (off unless configured)

Error monitoring (Sentry) and product analytics (PostHog) are built in and **do nothing until they are configured**. With none of the variables below set, the game makes no request to either service, runs no SDK code and does not download one: the page asks its own server once (`GET /api/telemetry/config`), is told `{ "enabled": false }`, and stops. What is collected, and the player's choice, are described in [SECURITY.md](SECURITY.md#telemetry).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEMETRY_ENV` | unset | `production`, `staging` or `dev`. **Required** once any key below is set; without it telemetry stays off and the server says so in one log line. `dev` stays off too, unless `TELEMETRY_DEBUG=1` |
| `SENTRY_DSN_CLIENT` | unset | DSN of the **browser** Sentry project. Public: it is sent to the browser |
| `SENTRY_DSN_SERVER` | unset | DSN of the **server** Sentry project. Never sent to the browser |
| `POSTHOG_KEY` | unset | The PostHog **project API key** (`phc_…`). Public: it is sent to the browser. A personal API key (`phx_…`) is a secret and is refused |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | PostHog ingestion host. Use `https://eu.i.posthog.com` for a project in the EU cloud |
| `BUILD_ID` | package version | The release every event and error is tagged with (and the release source maps are uploaded for) |
| `TELEMETRY_DEBUG` | unset | `1`: also run on `localhost` / private addresses and with `TELEMETRY_ENV=dev`, and accept `http://` endpoints. For testing the wiring only |
| `TELEMETRY_CONSENT_AT` | `reward` | When the consent sheet is first shown: `reward` (after a new life's first reward — never during the first-minute flow; a returning player a few seconds into the visit, never on arrival) or `landing` (at once). The older value `named` means `reward`. See the note below |
| `TELEMETRY_REPLAY_ON_ERROR` | unset | `1`: opt in to Sentry session replay for sessions that hit an error. All text and inputs are masked and no canvas is recorded. Off by default; its code is a separate chunk that is not downloaded otherwise |
| `TELEMETRY_SLOW_MS` | `1000` | An API request slower than this may be reported as a slow transaction (1 in 5 of them) |

**Production.** Set `TELEMETRY_ENV=production`, the two DSNs, `POSTHOG_KEY` (and `POSTHOG_HOST` for an EU project) and `BUILD_ID` in the server's environment, then switch on the project-side settings listed in SECURITY.md. Nothing is configured at build time, so one build serves every environment.

**Local preview.** Telemetry does not run on `localhost` unless `TELEMETRY_DEBUG=1`. To see exactly what would be sent without any account or key, point the game at the bundled stand-in, which records everything and talks to nobody:

```sh
node scripts/telemetry-capture.ts &          # a local stand-in for Sentry and PostHog on 127.0.0.1:3361
npm run build
TELEMETRY_ENV=dev TELEMETRY_DEBUG=1 BUILD_ID=local \
SENTRY_DSN_CLIENT=http://client@127.0.0.1:3361/11 SENTRY_DSN_SERVER=http://server@127.0.0.1:3361/22 \
POSTHOG_KEY=phc_local_capture POSTHOG_HOST=http://127.0.0.1:3361 npm start
curl -s http://127.0.0.1:3361/__captured      # everything recorded so far
```

**Source maps.** The default `npm run build` writes none: the release package admits no `.map` file. For error reporting, build with `SOURCEMAPS=1`: hidden maps (no reference to them in the served files) are written to `dist-maps/` (git-ignored), never to `dist/`. Before deploying, upload them:

```sh
SOURCEMAPS=1 npm run build
BUILD_ID=<release> SENTRY_AUTH_TOKEN=<token> SENTRY_ORG=<org slug> SENTRY_PROJECT=<browser project slug> npm run sentry:sourcemaps
```

The token comes from the environment and is never written anywhere; `--strip-only` deletes `dist-maps/` without uploading. Maps are never served in any case: the Node server and the Worker answer 404 for `*.map`.

**manifest.webmanifest and sitemap.xml** are made by code (`server/site-files.ts`), served by both hosts, and are not files in `public/`: the release package admits only `html js css svg png jpg jpeg webp ico woff2 txt` assets. The sitemap names the public origin (`PUBLIC_ORIGIN`, else the request's host).

**Release compatibility files.** `deploy/cloudflare-worker.js` and `deploy/cloudflare.test.mjs` are two thin shims over the `.ts` files: the release policy (kromate/allworld) names those paths. They can go when the policy is updated.

**How it fits together.** `src/telemetry/index.ts` is the facade — `track(name, props)`, `screen(name)`, `identify(publicId, traits)`, `setGroup('lga', id)`, `captureError(error, context)`, `setConsent(choice)` — and the only telemetry code in the first download (about 2 kB). It is safe to call anywhere and never throws. Code that should not import it can dispatch a DOM event instead: `window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } }))`. Everything else (`core.js`, the two SDK wrappers, the consent sheet) is fetched as separate chunks after the first scene is drawn, and only if the server says telemetry is configured; the PostHog chunk only after the player chose Accept. Every event name, its properties, when it fires and why is in `src/telemetry/events.ts`. The server side is `server/telemetry/` — `track(publicId, name, props)` and `captureError(error, context)` over a bounded queue sent with plain `fetch`, never on a request's path, flushed on shutdown.

**When the consent sheet is shown.** By default (`reward`) a new player is not asked during the first minute at all: the question comes after their first reward, at least five seconds later, in a quiet moment: no other sheet open, nothing running, the venue screen in front, not while creating a character and not in the seconds after settling in (the reward and the "Make this life yours" offer come first). A returning player is not asked on arrival but a few seconds into the visit, under the same conditions. The question is never shown over another sheet: if the game opens a sheet of its own while the question is still unanswered (an invite, an arrival, a table) the question closes without an answer and is asked again a moment after that sheet has closed — and a sheet that closes only so the next one can open does not trigger it. The first-minute events (`landed`, `named`, `play_tapped`, `arrived`, `first_activity_*`) wait in memory meanwhile and are sent only if the answer is Accept; a visitor who leaves before answering is never counted. `TELEMETRY_CONSENT_AT=landing` asks on first paint instead.

**One catalogue, one source per event.** Every event the game's screens report (`jaw:track`) is listed in `src/telemetry/events.ts` with its properties; a test reads the sources and fails if one is missing or carries a property the catalogue would drop. The first minute and the landing of a link are reported by the quick start, where you live by the world panels, missions/tables/sharing/outreach by the growth panels; telemetry itself derives only what no screen reports (`activity_completed`, `first_travel`, `first_job_shift`, `streak_day`, `event_joined`). The chosen local government is set as a coarse group (`setGroup('lga', id)`).

**Under 18.** The age answer is stored in one place (the growth collection, `POST /api/growth/consent`). "Under 18" switches analytics off as well as e-mail and push: the server forgets any Accept it held, `GET /api/telemetry/config` and `POST /api/telemetry/consent` tell the browser (`under18: true`), and the page announces the answer the moment it is given (`jaw:age`).

**Cloudflare adapter.** `deploy/cloudflare-worker.ts` does not serve `/api/telemetry/*` yet: on the Worker the page is told nothing and telemetry stays off. `server/telemetry/` uses only `fetch` and Web APIs so the Worker can adopt it.

### Without the server

The client still loads if the server is unreachable, but it is **read-only**: it shows the last state cached in the browser, and no action, travel or city switch is applied. There is no offline play and nothing is granted locally. Use the retry control once the server is back.

## What works today

- **The screen.** The 3D scene is the centre of the screen. Always on top of it are one top bar (Lagos time, mood, your name, whether your progress is saved — or the real state of the connection in its own words (**Connecting…**, **No internet**, **Server unreachable**, **Saved life not found**, each with the action that fixes it), or **Not saving** with the server's own reason while it reports that it cannot write its data file — and your wallet, which opens the Bank), the six needs as a slim strip of bars, and one goal line. Everything else that used to sit on the scene — weather, your home, the gem hunt, messages, the country map, Community and help — is behind the **More** button, which carries a badge counting the chips that have something new; something that needs an answer now (a knock at the door, a roadside choice) shows as an alert above the goal line instead. **Clean screen** (the eye, or X) hides all of it except the top bar and the bottom nav. The bottom nav is Home, Buy, Map and Phone; above it the venue panel lists the spots of the place you are in and, once a spot is picked, its activities as cards that say what they cost, give and — when they cannot be started — the one reason why. **One status stack:** everything that is live — the coach line, an activity's progress, a trip — sits bottom-centre, directly above the nav, on every screen size; a trip is shown on the 3D map (your piece moving along the roads) and its card, with time left and Cancel (which says what cancelling forfeits: the fare actually paid), is in that stack. **One play column:** on a very wide screen everything you read or tap stays inside a centred column at most 1600 px wide (the scene and the maps still fill the window). **One line of guidance:** an attention system (`src/ui/attention.ts`) decides the one next step and rings its control; for the first three starter goals a coach line spells it out (and the goal chip and the camera lesson wait while it talks), later goals are only ringed, the map's Go button and the trip card are pointed at the first three times each, and all of it is off on a Clean screen or with Hints switched off (Settings, or the × on the coach line). Feedback is a toast under the HUD, never more than two at once; a finished activity shows what it gave as chips over your avatar, a finished goal adds one toast and a burst of confetti, and a wallet change flashes with its reason (the amount only, under the wallet, on a phone). **One control kit** (`src/ui/controls.css`, `controls.js`): fields, a listbox select, the button hierarchy and layout utilities shared by the panels. Keyboard shortcuts cover the nav, the spots, the activity list, Clean screen, the map and Buy mode (press `?` for the list). Every icon is a glyph of the game's own drawn set; no emoji is used as an icon. Phone apps and Sim tabs are downloaded the first time one is opened. Checked at 390 × 844, 1280 × 800 and 3440 × 1440.
- **Quick start, then settling in.** A new device meets one screen — a suggested name, a quick character (3D preview, Shuffle, five presets, body toggle; the full creator is optional) and Play — and is then standing in Freedom Park as a *guest*, with one line of guidance: "Play a round of Ayo". Two traits, a dream, the birth lottery and where you live are offered afterwards as "Make this life yours": short cards, each confirmed by the server, that can be left and resumed at any point. Until the player settles in, the life plays in public venues only and has no home, no local government and no house: it is in no residents directory, estate or rich list, and missions are not dealt to it. Lives saved before character creation existed are never asked; a life the earlier compulsory flow left half-way resumes as a guest with its choices kept.
- **One home model: everyone gets a house.** Settling in ends with the player choosing their **local government** — found on the device ("Find my local government": the position never leaves the browser, only the id the player confirms) or picked from the twenty of Lagos — and the server allocates a free **starter house** on a plot there (512 estates × 196 plots per local government). The life lives in that house: a furnished 6 × 6 room, **no weekly rent**. The birth lottery still sets the start cash (₦76,000 LAPO Baby, ₦40,000 Civil Servant's Pikin, ₦18,000 Street Smart, ₦200,000 Ajebutter). The rented homes (Mushin, Yaba, Lekki, Ikoyi, Banana Island, with their rents and move-in costs) are the alternative in Phone → Houses: move to one and its Saturday rent starts, move back into your own house for free; the plot stays yours either way. The house can be restyled and upgraded (four larger tiers, priced by how dear land is in that local government, with a weekly ground rent above the starter), is drawn on the city map at its address, and its owner is in the local government's directory. A change of local government is allowed once every seven days. The settle-in rule still accepts the older payload that names a rented home (`{ house }`) from old scripts and the Worker; the game's own client cannot send it — only `{ lga, via, stay }` leave the device (`outgoing()` in `src/client.ts`). At home the venue panel is headed by what the life lives in: "Starter house · Ikeja" for its own house, the rented home's name and district otherwise.
- **Starter goals, wishes, stars, perks and a lifetime dream.** Ten starter goals pay cash and a star once each — Play a round of Ayo → Say hello → Settle in → Eat → Freshen up → Get a job → Buy something → Visit the buka → Make a new friend → Work a shift — and after them the goal line becomes a rolling next step. The first goal completes on the round of Ayo itself (or, for a guest who has gone elsewhere, the free pastime the goal line points at there), never on a shift or a paid gig. The goal line is the one piece of guidance on a guest's screen: every other chip waits behind More, and missions are dealt only once the life has settled in. "Make a new friend" completes when you greet one of a venue's regulars or make a friend.
- **A home you furnish.** A grid room sized by the house, Buy mode with nine category tabs, placement with a ghost, move, store and sell, a shared kitchen with ingredients, eleven recipes and a Groceries app.
- **A city to move around.** 25 venues, the UNILAG campus and your home (each with two regulars) on an in-city map with opening hours, a venue card with five travel modes (Danfo selected by default), fares charged at departure, per-mode trip times, roadside events, weather and illness. The Airport's Travel desk only names the flights that wait for other cities to open; it sells nothing.
- **The University of Lagos campus (Lagos only).** A venue the size of a district at Akoka, Lagos Mainland — on the 3D and the simple map, a trip like any other — walked in its own scene host: ten zones that come into detail as you walk, 45 landmarks, a mini-map, a server-timed shuttle between eight stops (₦50) and twelve regulars. A visitor can walk the discovery trail, play the penalty shoot-out and the Friday quiz and sit at the two Student Union Whot tables (the same table framework as everywhere else). A settled life can apply (₦200, Coding or Charisma level 1), matriculate, register two seven-day semesters (₦1,100 each, a hostel room ₦300), attend lectures in their slots, sit assignments and tests, take one paid campus job a Lagos day and vote in the weekly Student Union election; a guest cannot enrol before settling in. The Campus app in the Phone holds all of it.
- **Two hosts, one game.** The Node server and the Cloudflare Worker build the same server context and run the same route and socket registries, so everything on this list works on both ([The Worker host](#the-worker-host) says what differs).
- **Careers.** Fourteen tracks, each with a six-level ladder, a workplace on the map and one paid shift per Lagos day; "Go automatically" commutes to the work spot when the workplace is open. Jobs and Career show the workplace's opening hours with the same label the map uses. The older Community helper job still works for existing saves, limited to one ₦300 shift every four hours.
- **Money.** Weekly rent (for a life that rents — the own starter house has none) and the loan instalment are collected on Saturdays (Lagos time) even while you are away, each exactly once, each with a ledger line; missed rent becomes arrears with a late fee. Houses, cars and fixed deposits can be bought in Phone apps.
- **A statement that explains the balance.** Every cash change is recorded with its reason and time. The last 60 changes are kept line by line and the last 35 days with activity as daily totals (opening, in, out, closing, and the reasons that moved the most), so a change is still explained after its line has scrolled away. Phone → Statement shows opening balance, every change and closing balance with the arithmetic, and can check itself against the server's own copy. A save whose balance does not match its history gets a visible "Balance correction" line, never a silent difference.
- **Paid gigs, with a daily limit.** Venue activities that pay are limited by a cooldown, a need cost and **eight paid gigs per Lagos day** across the city; a job's shift does not count. The limit exists because the balance simulation showed that touring gigs all day out-earned any career several hundred times over.
- **Needs, mood and a transaction log.** Six needs fall slowly in real time (never below 10 on their own, and at most four hours' worth while you are away). Mood is one of five words, set by thresholds on the needs. Home always offers free food, a free wash and free rest, and the starter job can be worked at any hour, so no player can be left unable to recover.
- **A separate life per city**, held on the server. Cash, needs, location and the action in progress are changed only by the server and settled against server time, so an action finishes even if you close the tab.
- **Retry-safe actions.** Every action carries an ID made of the time and a random UUID. A repeat of the same ID returns the recorded outcome instead of charging twice, reusing an ID for a different action is rejected, and IDs older than 24 hours are refused. This protects a retry of the *same* request; a client that sends the same thing under a new ID has sent two requests. See [Storage and limits](#storage-and-limits) for exactly what is and is not applied once.
- **Device sessions.** A random secret in an `HttpOnly` cookie plus a nickname. This identifies a browser, not a person — it is not an account. Sessions expire, and there is no way to recover one.
- **People.** Every public venue has two regulars (NPCs) you can greet, gist with, joke with, compliment or buy a drink; closeness grows through four tiers. Real players in your venue room are listed from the server's own presence, with truthful Online / Away / Reconnecting / Offline: a connection that stops answering is no longer shown as online after at most 15 seconds. You can find a player by name, send a friend request, block and report. **Blocking works in public venues too:** the two of you are left out of each other's room list, neither receives the other's chat, and voice between you is refused.
- **Moderation.** Every name, chat line, message, group name, slogan, announcement, ad and song title passes a server-side text filter; a refused text is rejected with a reason and never altered. Reports reach an operator, who can dismiss them, mute a player from posting text for a set time, and remove an ad, an announcement or a shout-out, with an audit trail. A mute never touches the player's life or money. There are no moderator accounts: see [Moderating a server](#moderating-a-server).
- **Report a problem.** Phone → Report a problem files a report on the server with a receipt number, with no e-mail or outside account. The server attaches the build, your last ten actions and their results, the last refusal and your last ten wallet lines. The receipt and its status stay visible after a reload.
- **Messages.** Direct messages, groups of friends, a house chat, and one **Updates** feed: friend requests, knocks and gifts beside what your own life posts — rent due, paid and missed, loan payments, promotions, illness, and news from the Governor. A message you send shows as sending, then sent or failed with a retry that reuses the message's client id; the server stores a message once per id for as long as it is among the conversation's last 200 messages.
- **House visits.** Share your house link; a visitor knocks while you are at home; you let them in or not. Up to five guests join your home room, where you see them standing by the door, and share a house chat. A visit ends after 30 minutes, when the guest leaves or is asked to, or when you go out. Guests do not see the host's furniture yet.
- **Gifts of naira between friends,** deliberately limited: only money earned from work (shift pay and paid gigs — never start cash, the loan, goal rewards or prizes), ₦5,000 a gift, three gifts and ₦10,000 a day, an account at least a day old and a friendship at least an hour old. One request id moves the money once, in both ledgers. The gift lands in your friend's life in the city you sent it from if they have one there, otherwise in the life they played most recently; if they have no life anywhere it is refused before you are charged.
- **Family and contacts.** A daily check-in call to four family members, and "Mummy" as a contact.
- **Governor.** A weekly election on Lagos time: nominations Monday–Wednesday (a ₦2,000 in-game filing fee), one vote per player Thursday–Saturday cast in person at the Polling Unit by a life that has been paid for work on at least two different Lagos days, and on Sunday the winner takes office for a week and can post announcements that reach every resident's Updates.
- **Neighbours and the Rich List.** Real counts of residents (a guest who has not settled in is not one) and who is online, a directory of homes by rented district with owners listed apart ("In their own house" — the directory by local government is on the map), top balances and top earners of the week; you can hide yourself from either list.
- **Billboards and sea plots.** Rent one of twelve roadside billboards or a plot in a 16 × 16 patch of sea with in-game naira and put one line of text, a colour and an icon on it. They are drawn on the city map behind its Billboards and Sea layers. There are no uploaded images and no links.
- **Daily gem hunt.** Three gems hidden for you each Lagos day; find them by going to the places in the clues, then claim ₦3,000 once.
- **Club radio.** In the four club venues a banner shows the shout-out that is "playing" and a button to buy one: a song title and artist as text, queued on server time. No audio is played.
- **City map layers.** Billboards, Sea, Neighbours and Gov toggles draw those overlays from the server's own data; with Gov on, the State House opens the Governor sheet.
- **The Phone.** The Phone is drawn as a device: a home screen of apps with badges, a notification shade and an app bar with back. On a wide screen it can be expanded, and apps lay themselves out in columns there. Long rules sit behind a small "How it works" disclosure; costs and deadlines are always on the first line.
- **A 3D city map with visible travel.** The map is a miniature Lagos in Three.js: districts, roads, the lagoon, bridges and a landmark per venue, with labels you can press. A phone opens close on your own piece with **Whole city** and **Find me** buttons; a wide screen opens on the whole city. A trip is your piece travelling the roads in the vehicle you paid for (on foot, okada, keke, danfo, cab or your own car), in real trip time, and the label of the place you arrive at steps aside so it never covers you. Above the city is one zoomable map in three levels — Nigeria with all 36 states and the FCT as extruded plates, Africa with every country, and the world — drawn from real boundaries (Natural Earth, public domain) on an Equal Earth projection written in the code. Lagos State is the only region in colour and the only one that can be entered; every other state, country and continent is grey and marked coming soon, still selectable, and Ibadan, Abuja and Port Harcourt keep their previews and their planned routes with fare and time. Each level's data is fetched the first time it is shown; a searchable list is the alternative to pointing at the map. A player who already has an Ibadan life from an earlier build is recognised from the server's session answer (the list of cities that session has a life in), so it is the same on every device. The map draws on demand: a loop runs only during input, a trip or a short ease, and stops itself. The earlier flat SVG map remains as the fallback where WebGL is not available.
- **Venue scenes you walk in.** One procedural Three.js scene per venue kind with day, dusk and night lighting. Your avatar wears your saved look and walks: arrows or W A S D, a click or tap on the floor, a click on a spot's marker (which walks there and then selects the spot), or the on-screen stick on a touch device. It walks round furniture, round other figures and up the declared way onto raised places (a stage, a walkway), and can never be trapped. The camera orbits all the way round by dragging (`[` `]` and PgUp/PgDn on the keyboard), zooms with the wheel, a pinch or `+` `−`, and `0` recentres; a room hides whichever walls the camera is behind, with what hangs on them. Zoomed in, the camera is held in front of whatever would hide your avatar, or that thing is faded. Regulars stand at their places with a green dot, clear of the spot markers; real players in your room are drawn where they actually stand — your position is sent to the room at most three times a second and only when it changed, and theirs eases between updates — with an "@name" tag; you carry a crown. Nothing renders while the game is idle: frames are drawn only while something moves (input, a walk, a bounded ease) and the loop stops itself, with or without a crowd; with reduced motion asked for, moves are single frames.
- **A 3D character creator.** Character creation and the Boutique show your look on a turning 3D figure as you change it; the same figure, at a lighter detail level, is what the scenes and the map draw.
- **Community panel and opt-in voice.** Public venues have live presence and text chat; home rooms are private to the host and the guests they have let in. Nothing touches the microphone until you press Join voice; you join muted, and proximity — measured from where the avatars stand in the scene — controls who you hear. The panel's Walk buttons are the keyboard way to move.
- **Settings.** Sound and music preferences saved on the device (the build has no audio yet, and the tab says so), an explanation of what a device session is, the privacy switches (directory, rich list, analytics), and "Outside the game": Stay in touch, and the owner's WhatsApp Channel when one is configured (the same link is at the foot of Messages, in Events and in Stay in touch).

- **Missions.** Three daily and three weekly missions (one about your life, one about the city, one about people), dealt from data and completed by ordinary play. A daily mission pays ₦250 and a weekly one ₦1,000, once, when collected; a full set adds stars. A weekly stamp card pays stars for any four days played, and a count of days that only ever goes up. Nothing is lost by missing a day.
- **Events.** A calendar of weekly and dated events on Lagos time (trivia night, club night, owambe, market day, match day, Felabration…), kept as data. Being at the venue and finishing an activity counts as attending. At a party you can spray naira: a sink that pays Social and Fun and nobody receives. "Add to my calendar" makes a calendar file on the phone.
- **Sharing and bringing a friend.** A Share button makes a picture card and a short text for the phone's own share sheet (WhatsApp, X, copy and save as fallbacks). Share links (`/s/<code>`) show a proper preview in chat apps and lead a visitor to the sharer. A friend who arrives through a link and is paid for work on two different Lagos days counts: they get ₦1,000 after their first paid day, the inviter ₦1,500 and two stars, at most five a week and twenty for life. Sharing itself pays nothing.
- **Game tables.** Whot (the Nigerian pack and special cards, with the rules houses differ on as table options) and a penalty shoot-out, at tables in the buka, the park, the rooftop, the viewing centre and the beach. Each table stands in its venue's scene — a table with stools, or a small goal — with a name tag: walk up to it or tap it and the Tables app opens on that table (sit, watch, invite a friend to it); the Phone's Tables app is the list. Sit at a table in the venue you are in, play real players or house bots, watch from anywhere. The server deals, holds every hand and judges every move. There are no stakes: a win against a real player pays ₦150, four times a day; the same two players' games count three times a day.
- **While you were away, and staying in touch.** Returning after three hours shows up to five lines of what is waiting. Outside the game, nothing is sent unless a player who says they are 18 or older switches it on: web-push notifications, and an e-mail digest behind an explicit consent sentence and a confirmation link. One message a day and three a week at most, never at night, slower when they bring no visit, and stopped after four. See [SECURITY.md](SECURITY.md#messages-outside-the-game).
- **Installable.** A web manifest and icons let the game be added to a phone's home screen. The service worker handles notifications only and is registered only for a player who switches them on.

### The scripted first day

```sh
npm run first-day
```

Starts the server in-process with a temporary data directory and a controlled clock, then plays one new life over HTTP exactly as the browser does: the quick start, the ten starter goals (a first activity and a hello in the park, settling in, then the home goals), a cancelled and a completed bath and paid meal, a Tech shift, a trek home, an interrupted nap, a cooked meal, a server restart, an idempotent replay and Saturday billing. Every step asserts the exact wallet and need values and prints one transcript line: 22 steps, final wallet ₦76,400 (a LAPO Baby in the own starter house in Lagos Mainland: ₦76,000 start, ₦8,000 of home goals and ₦2,000 of opening goals, one ₦12,000 loan instalment and no rent). The same run is part of `npm test`.

### The scripted first minute

```sh
npm run first-minute
```

One brand-new player from the landing screen's Play to a settled life, over HTTP against the real server: Play is applied exactly once (a double tap is sent), the first reward lands 13 seconds after landing (9 seconds of server time from the session), settling in is offered and declined, play goes on as a guest (two more activities and a trip; Home is refused with its one-tap explanation), then the player settles in with a local government and `life.started` fires exactly once. The run checks the start-cash line, the house, the plot the server allocated, the loan, furniture and kitchen against a control life settled without the guest minutes, and that a restart of the server returns the identical life. Timings are server time. The same run is part of `npm test`.

### One landing for invite, share and table links

A link may carry three things, and they are read once, in one place (`captureLink` in `src/quick-start/entry.ts`, handled by the landing store, `src/app/features/landing/landingStore.ts`):

- `join=<public id>` (or the house link `/v/<public id>`): the player to stand beside;
- `ref=<share code>`: the share link it came from, attached to the visitor's new life as a referral;
- `table=<table id>`: a game table to open.

A share link is `/s/<code>`: a small page with Open Graph tags and no script (so a chat app's crawler can draw a preview) that sends a person on to `/?join=<sharer>&ref=<code>` (and `&table=<id>` for a table). A **new** visitor then goes through the quick start and: the referral is attached (`POST /api/growth/referral/link` — it pays nobody yet); they are put in the sharer's public venue when the sharer is in one right now (`POST /api/social/join` → `joined`), offered the knock when the sharer is at home, or told the sharer is out, reconnecting or offline; **one banner** says it ("You’re joining Ada … Work a paid shift and you both get a gift.") with no welcome toast beside it; and a table the link named opens in the Tables app. A settled player who opens such a link gets the Invite app on that house and the table. Both gifts wait for the newcomer's paid work on real Lagos days. The funnel events are `invite_opened`, `invite_joined`, `join_landed` and `invite_colocated`.

**Inviting friends.** The HUD bar has an **Invite** button (icon and label on a wide screen, icon only on a phone) that makes the player's own invite link and opens the share sheet: Copy link, the phone's own share sheet where there is one, WhatsApp, Telegram, X, and a QR code drawn locally (`src/ui/qr.ts`, fetched only when asked for). The sheet says what the inviter gets, from the referral rules: when a friend they invite has been paid for work on two different days, they get ₦1,500 and 2 stars in the game (at most 5 a week and 20 for life; nothing for sharing itself or for a friend who never plays), and shows how many friends have joined. At a few natural moments a small chip offers the same: after the first goal, after settling into a home, when a venue room has held only the player for 45 seconds, after winning a table game. Each is offered once, at least 15 minutes apart, never during an activity, never to a guest who has not pressed Play, and each dismissal waits longer (1, 3, then 7 days; three dismissals stop the chip for good). The rule is `src/app/features/growth/inviteNudgeModel.ts`; its memory is kept on the device (`allworld-invite-nudge`). The first screen a friend lands on names who invited them (`GET /api/growth/share/:code`, public). Events: `share_opened`, `share_channel`, `invite_prompt_shown`, `invite_prompt_dismissed`.

### The scripted new player

```sh
npm run new-player
```

The merged game end to end, against the real server on a controlled clock, over HTTP and two real sockets: Ada lands and taps Play (applied once), plays Ayo and is rewarded (a different pastime first does not count), says hello, settles in with a local government picked from the list, is given a starter house on a plot that then appears in that local government's estate listing and directory, eats and freshens up, sees her three daily missions, finishes one and collects it once, goes to the buka and shares the Whot table there. Bola opens the link as a crawler would — the page is checked for its Open Graph tags, an absolute image URL, no script, no cookie — follows it, taps Play and lands in the buka beside Ada with the referral attached and nothing paid. They sit at the table the link named and play a whole game of Whot against each other. The referral then pays: nothing for playing together, ₦1,000 to Bola after his first paid Lagos day (two shifts in one day are one day), ₦1,500 and two stars to Ada after his second, each once. The server is stopped and started on the same data and every life and plot reads back identical. It finishes by checking that no cookie secret, device token or network address was stored or sent. Also part of `npm test`.

### The scripted two players

```sh
npm run two-players
```

Two device sessions, each with a room socket and a social socket, against the same in-process server and controlled clock: both create a Sim; they see each other at Freedom Park and stop seeing each other the moment one leaves; friend request and accept; a message retried and stored once; a knock, a let-in, the host's home room and house chat, and the end of the visit; a shift's wages and a gift a day later; a declaration for Governor on Monday (refused until the candidate has been paid for work on two different days), a vote at the Polling Unit on Thursday, the winner's announcement in the other player's Updates on Sunday; a sea plot in the public listing; and the gem hunt paid once. It finishes by checking that no cookie secret reached the other player or the social and civic collections. Also part of `npm test`.

## What does not work yet

- **No accounts.** No passwords, sign-in, recovery email or moving a life between devices. An accounts design exists as a separate, unmerged proposal; `server/auth.ts` and `server/routes/auth.ts` are inert placeholders and Settings has no account section.
- **Moderation is basic.** The text filter is a short list of slurs and threats plus link and contact-detail patterns; it is easy to evade on purpose and does not understand context, images of text or other languages. There is one operator secret, not moderator accounts with roles, no ban (only a time-limited mute from posting text), no appeal flow beyond Report a problem, and no operator screen — the operator uses the JSON routes. Venue chat is not stored, so a report about venue chat carries no evidence. Run a public server only if someone will actually read the reports.
- **Elections are not polls.** A device session is not a verified person. Sock-puppet voting is slowed, not prevented: a voter must have lived a Lagos day and been paid for work on two different days. More than three votes from one network address in an election are still counted by default and only flagged to the operator, because a mobile carrier, a school or a hostel puts many real voters behind one address; an operator can choose to refuse them instead (`VOTE_CAP_MODE=refuse`). Someone willing to play several sessions for two days can vote several times. Treat results as a game.
- **The top of the property ladder is out of reach of wages.** The balance simulation shows the next house and the cheapest car are reachable by working (see `npm run economy`). The fifth house (₦1,500,000 a week) and the dearer cars are not sustainable on any career's pay: their prices are set above what wages reach.
- **A house visit is presence and chat.** Guests join the host's home room and the house chat, and the host sees them at the door; guests do not see the host's room or furniture, and the browser offers no voice in a house visit.
- **The community panel and the social features use two sockets.** Venue chat, presence and voice live in the community panel; friends, messages and who-is-here in the Phone and Sim sheets.
- **The Worker host has limits of its own.** It runs the whole game, but one Durable Object holds every player, each feature collection is rewritten whole when it changes, and live table games and the telemetry consent answer are kept in memory there as on Node. It has been exercised by the edge suite and a local browser run, not under load and not on Cloudflare's network. See [The Worker host](#the-worker-host).
- **The campus is sparse and its numbers are invented.** Many halls and faculties are simple massing with a sign, the Student Union tables are opened from the Tables app rather than walked up to, pedestrians do not board the shuttle visibly, and the campus leaderboards read every session each time they are asked for. Nothing in it describes real admissions, fees, rooms or jobs.
- **The first-day numbers are provisional.** Start cash, starting needs, goal rewards, the Danfo and trek costs, the ₦550 meal, the shift, the nap rate, skill gains, dream progress and need decay are all provisional and may be retuned (see [Provisional values](#provisional-values)).
- **Workplaces and the Polling Unit close.** You can only travel to a venue during its opening hours; a gem hidden behind a closed door waits for opening time.
- **No audio.** There is no music or sound effect anywhere; club radio is text.
- **No real money, no uploads, no links.** Everything is paid in in-game naira; there is no top-up. Ads are text, a colour and an icon. Nothing a player types is ever rendered as a link.
- **Voice remains experimental.** Two browser sessions on loopback passed real bidirectional WebRTC transport with a generated tone, mute, leave, and near/mid/far proximity checks. Physical microphones and external networks remain untested. No TURN provider is configured yet, so restrictive networks may fail. The authenticated configuration endpoint supports an injected short-lived credential provider; it never embeds persistent provider secrets in the frontend.
- **Ibadan is not open yet.** The atlas shows it, like other places, as coming. The server already holds a starter city for it, with its own life, election, ads and directory and its own venue names, but it reuses the Lagos venue structure, map positions, regulars and activities. A proper city-pack format is not finalised.
- **E-mail is in dry-run until the operator configures it.** Without `ZEPTOMAIL_AUTH`, `EMAIL_FROM_ADDRESS` and `PUBLIC_ORIGIN` the digest is composed and shown as a preview and nothing is sent. With them set it has only been exercised against a fake provider in tests: a first real send must be watched (see SECURITY.md). Web push has been tested against the RFC 8291 vector and a fake push service, not yet on a physical phone.
- **Live table games are in memory.** A server restart ends the games in progress and records nothing for them. A table in the scene is a table (or a goal) and a name tag: nobody is drawn sitting at it, and the cards are in the Tables app.
- **A visitor joins the sharer only while the sharer is online in a public venue.** Otherwise the banner says where they are (at home: Knock; out, reconnecting or offline) and the visitor stays in the park. A table link opens that table for watching; sitting needs your Sim in the table's venue.
- **The first download is 674 kB minified (239 kB gzip), above the 380 kB aimed for.** It is three eager chunks: `app` (182 kB, 68 kB gzip), `vue` (79 kB, 31 kB gzip) and `engine` (413 kB, 140 kB gzip). The landing screen, the character editor, the attention system, the control kit's listbox, the "while you were away" card, the growth client, the maps, the atlas and all telemetry beyond a 2 kB facade are fetched when needed; about 413 kB of what remains is the rules engine and its content tables (venues and their activities alone are 60 kB). They cannot be fetched later as they stand: the browser keeps its copy of the life by passing every state the server sends through the same engine (`createLife` in `src/client.ts`), which validates it against those tables synchronously — a table that has not arrived would make the browser's copy disagree with the server's. Getting lower means a display-only build of the rules, or a client that waits for a venue's table before accepting a state; this build has neither.
- **"Free will", pets as companions, weather beyond rain, power cuts** and anything else not listed under What works today do not exist.
- **Node storage is one JSON file** on the server's disk, rewritten whole and not `fsync`ed. Actions share writes, a poll that produced no outcome does not wait for the disk, and writes are paced by a byte budget (see [Storage and limits](#storage-and-limits)). It will not carry thousands of concurrent players. While the disk cannot be written the game is effectively read-only: requests that would save something answer 503 and change nothing.
- **The model library is mostly a library.** `src/models/` (vehicles, people, buildings and water, world/Africa/Nigeria/Kenya maps) is tested and has a workshop, but the game uses its own avatars, atlas and city build; only the trip vehicles can be switched on, with `?models=vehicles`, and are off by default ([docs/MODELS.md](docs/MODELS.md)).

## The server's surface

Both hosts answer the same routes and socket messages: they are one registry (`server/routes/index.ts`, `server/ws/index.ts`).

HTTP routes (all under the per-address rate limit, and all except `/api/mod/*` under the same-origin check; `server/routes/`). A refusal may carry a `reason` sentence beside its `error` code:

| Area | Routes |
| --- | --- |
| Core | `GET /api/health` (which build is serving; reads and creates no session) · `POST /api/session` · `GET /api/session` · `GET /api/life` · `POST /api/action` · `GET /api/voice-config` |
| Social | `POST /api/social/join` (a new visitor's invite landing) · `GET /api/social/me` · `POST /api/social/updates/read` · `GET /api/social/people` · `GET /api/social/search` · `GET /api/social/players/:id` · `POST /api/social/players/:id/interact` · `POST /api/social/friends/request` · `POST /api/social/friends/answer` · `POST /api/social/friends/remove` · `POST /api/social/block` · `POST /api/social/unblock` · `POST /api/social/reports` · `GET /api/social/conversations` · `GET /api/social/conversations/:id` · `POST /api/social/conversations/:id/read` · `POST /api/social/messages` · `POST /api/social/groups` · `POST /api/social/groups/:id` · `GET /api/social/house/:host` · `POST /api/social/house/knock` · `POST /api/social/house/answer` · `POST /api/social/house/leave` · `POST /api/social/bae/ask` · `POST /api/social/bae/answer` · `POST /api/social/bae/end` · `POST /api/social/transfers` |
| Civic | `GET /api/civic/pulse` · `GET /api/civic/gov` · `POST /api/civic/gov/run` · `POST /api/civic/gov/vote` · `POST /api/civic/gov/announce` · `GET /api/civic/neighbours` · `GET /api/civic/ads` · `POST /api/civic/ads/rent` · `POST /api/civic/ads/remove` · `GET /api/civic/hunt` · `GET /api/civic/radio` · `POST /api/civic/radio/shoutout` · `GET /api/civic/richlist` · `POST /api/civic/prefs` |
| Support | `POST /api/support/reports` · `GET /api/support/reports` · `GET /api/support/statement` |
| Growth | `POST /api/growth/hello` · `POST /api/growth/share` · `GET /api/growth/share/:code` · `POST /api/growth/referral/link` · `POST /api/growth/consent` · `POST /api/growth/email` · `POST /api/growth/email/remove` · `GET /api/growth/push/key` · `POST /api/growth/push/subscribe` · `POST /api/growth/push/unsubscribe` · `POST /api/growth/tables/claim` · `POST /api/growth/client` — and the pages `GET /s/:code` (link preview), `GET`/`POST /e/confirm`, `GET`/`POST /e/unsub` |
| Growth, operator | `GET /api/mod/growth/metrics` · `GET /api/mod/growth/outreach` · `POST /api/mod/growth/outreach/switch` · `POST /api/mod/growth/outreach/run` — bearer token only, 404 unless `MODERATOR_TOKEN` is set |
| Operator | `GET /api/mod/overview` · `GET /api/mod/reports` · `GET /api/mod/problems` · `GET /api/mod/mutes` · `GET /api/mod/content` · `GET /api/mod/audit` · `POST /api/mod/reports/:id/dismiss` · `POST /api/mod/problems/:id/status` · `POST /api/mod/mutes` · `POST /api/mod/mutes/:id/lift` · `POST /api/mod/content/remove` — bearer token only, 404 unless `MODERATOR_TOKEN` is set |
| World | `GET /api/world/me` (your place: local government, plot; allocates the plot of a settled life) · `GET /api/world/city` · `GET /api/world/lga/:id` · `GET /api/world/lga/:id/estates` · `GET /api/world/lga/:id/estate/:estate/houses` · `GET /api/world/lga/:id/people` · `GET /api/world/pulse` (people online now and total visits: `{ online, visits, cities }`) — all read-only; where you live is changed by game actions on `POST /api/action` (`estate.*`, and `onboarding.home { lga }` at settle-in) |
| Campus | `GET /api/campus` (`?city=lagos`: the Student Union election, the weekly boards and the shared goal, from server-saved records) · `POST /api/campus/nominate` · `POST /api/campus/vote` (identity from the stored life; exactly once per action id; the ballot is saved with its receipt) |
| Telemetry | `GET /api/telemetry/config` (what the browser may load: public keys only, or `{ enabled: false }`; creates no session, and reads the caller's only to add `under18: true`) · `POST /api/telemetry/consent` (`{ analytics }`: the player's Accept or Reject, kept in memory; an under-18 player's Accept is not kept) |
| Accounts | none (`/api/auth/*` is reserved and answers 404) |

WebSocket messages on `/socket` (`server/ws/`):

- Client → server, rooms: `join` (`{ cityId, venueId }`, or `{ cityId, venueId: 'home', hostId }` for an accepted guest), `move`, `voice-state`, `signal`, `chat`.
- Client → server, social: `dm-send`, `dm-read`, `people-list`, `friend-request`, `friend-answer`, `invite-knock`, `invite-answer`.
- World: no message types; the world module only counts open sockets per local government ("online now").
- Client → server, tables: `table-list`, `table-watch`, `table-unwatch`, `table-sit`, `table-options`, `table-start`, `table-move`, `table-leave`, `table-again` (server → client: `tables`, `table-state`, `tables-changed`).
- Server → client: `presence` (built per recipient: players you have blocked, or who blocked you, are left out), `chat`, `signal`, `error` (with a `reason` when the server has one — `text_blocked`, `muted`); `dm`, `dm-sent`, `dm-failed`, `dm-read-ok`, `people`, `people-changed`, `people-presence`, `people-interaction`, `friend-request`, `friend-accepted`, `friend-result`, `invite-knock`, `invite-answer`, `invite-result`, `invite-house`, `social-update`, `social-sync`, `transfer`.

Stored collections in the one data document (`devices.json` on Node): `sessions` (device sessions with their lives per city, action receipts and the receipts of gifts, interactions, groups and paid civic requests), `archivedLives`, `social` (players, conversations, houses, pending life effects, reports), `civic` (preferences and, per city, residents, elections and announcements, ads, hunt counters, radio queues), `moderation` (mutes and the audit trail) and `support` (problem reports). Only public ids are stored outside `sessions`. The campus adds `campus` (this week's Student Union election: at most 16 candidates and 2,048 ballots). The growth features add one collection, `growth` (share links, referral records, consent, e-mail contacts and push subscriptions, table ratings and pending results, the outreach log and first-party metrics; its shape and every cap are in `server/growth/data.ts`, `outreach.js` and `metrics.js`), and two key files outside the data file, in `DATA_DIR/keys/` with mode 0600 (`vapid.json`, `growth-signing.json`). The world layer keeps its registry beside the data file, in `DATA_DIR/world/`: one append-only shard file per local government (`lagos.<lga>`: which public id holds which plot, the name shown in the directory, the packed style of the house) and a small summary file; nothing else is stored there. A life itself holds its local government, its plot and its house (`estate`).

Pages outside `/api/` (`ctx.pages`, written by the host itself with fixed headers — no script may run, nothing may frame them, no cookie, no referrer — under the same per-address limit and telemetry hooks as the API): `GET /s/:code` (the link preview), `GET`/`POST /e/confirm` and `GET`/`POST /e/unsub` (the pages a link in an e-mail opens; only the POST does anything). Everything else outside `/api/` is a static file of the build; `*.map` answers 404; the game's own page is served with its default preview image made absolute from `PUBLIC_ORIGIN` (or the request's own host), because link-preview crawlers do not resolve a relative `og:image`.

**What is stored about one player.** In `sessions` (keyed by the cookie secret, which is stored nowhere else): the nickname, the public id, when the session expires, one life per city (cash, needs, the ledger, goals, missions, the look, traits and dream, the birth lottery, the **local government id**, the plot and the house's style and size, friends' ids, and so on — everything the rules engine keeps) and the receipts of recent requests. In `growth`, under the public id: the share links they made, who referred them and whom they referred, up to four salted hashes of device tokens, the **age answer** (`adult` or `minor`) with the two channel switches, an **optional e-mail address** (only after the consent box was ticked; deleted by unsubscribing, by "Delete my address", by an under-18 answer, or after 60 days unseen), **push subscriptions** (a browser vendor's endpoint and two keys; deleted by switching notifications off or when the push service says the subscription is gone), table ratings, and for 31 days a first-day / last-day / funnel-step record for the operator's cohort table. In `social`, `civic`, `moderation` and `support`: what those features need, by public id. In the world registry: the public id, the name and the house. In memory only, never on disk: the analytics choice the browser reported, live table games, and the per-address counters of the rate limits. Never stored: a position (the local government is worked out on the device), an IP address, voice audio, venue chat.

**Every environment variable.** The server reads: `PORT`, `DATA_DIR`, `SESSION_TTL_DAYS`, `TRUST_PROXY`, `MODERATOR_TOKEN`, `VOTES_PER_ADDRESS`, `VOTE_CAP_MODE`, `HEARTBEAT_SECONDS`, `STORE_WRITE_MB_PER_S`, `BUILD_ID`, `PUBLIC_ORIGIN` (the table under [Production build](#production-build)); for messages outside the game, and only through an allowlist (`ctx.env`): `ZEPTOMAIL_AUTH`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_CONTACT_LINE`, `EMAIL_DAILY_CAP`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DAILY_CAP`, `WHATSAPP_CHANNEL_URL`; for telemetry: `TELEMETRY_ENV`, `SENTRY_DSN_CLIENT`, `SENTRY_DSN_SERVER`, `POSTHOG_KEY`, `POSTHOG_HOST`, `TELEMETRY_DEBUG`, `TELEMETRY_CONSENT_AT`, `TELEMETRY_REPLAY_ON_ERROR`, `TELEMETRY_SLOW_MS` (the table under [Telemetry](#telemetry-off-unless-configured)). Build and tooling only, never read by a running server: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (`npm run sentry:sourcemaps`), `DEV_PORT` (`npm run dev`), `CAPTURE_PORT` (`scripts/telemetry-capture.ts`). The Worker's own bindings (`TURN_KEY_ID`, `TURN_API_TOKEN`, `TURN_TEST_PUBLIC_IDS`, `ASSETS`, `JOINALLWORLD`) are in `wrangler.jsonc`. `STORE_MODE` is no longer used. An outside request (`ctx.fetch`: the mail provider, a browser's push service) must be HTTPS, never follows a redirect and is cut off after 15 seconds.

**Consent, in one place.** *E-mail*: an age answer of 18 or older, then an unticked box with the full sentence, then a confirmation e-mail whose link opens a page with a button (a GET confirms nothing). *Push*: the same age answer, the game's own explanation, then the browser's prompt. *Analytics*: one sheet with identical Accept and Reject buttons, shown after the first reward; Do Not Track, Global Privacy Control and an under-18 answer are a Reject. *Error reports* carry no personal data and are not asked about. The exact words are in [SECURITY.md](SECURITY.md).

**Stopping.** `close()`, `SIGINT` and `SIGTERM` follow one order: modules finish what they are sending (so a message is recorded as sent before the store closes and is never sent twice after a restart), the world registry and then the data file are written, and telemetry is flushed last.

### The Worker host

`deploy/cloudflare-worker.ts` builds the same server context as `server/server.ts` (the parts both share are in `server/host-context.ts`) and hands it to the same registries. What is specific to the host:

| | Node (`server/server.ts`) | Worker (`deploy/`) |
| --- | --- | --- |
| Main store | one JSON file, group commit (`server/store.ts`) | SQLite tables of one Durable Object (`sqlite-store.ts`): `sessions`, `action_receipts`, `once_receipts`, `archived_lives`, `collections` + `collection_parts`. One SQL transaction per write, durable before it is acknowledged |
| World shards | one append-only file per local government (`server/world/shards.ts`) | rows of `world_shards` (`sqlite-shards.ts`), through the same store code (`server/world/shard-core.ts`): the same bounded reads, group commit and compaction |
| Keys the server makes (push, link signing) | `DATA_DIR/keys/*.json`, mode 0600 | rows of `host_keys` in the object's own storage |
| Rate limits | in memory | the `rate_limits` table (they survive a sleep) |
| Sockets | `ws`, protocol ping | hibernating WebSockets; what a socket carries is its attachment, and the modules get each socket back (`restore`) when the object wakes. An application `heartbeat` frame is answered by every browser socket with `heartbeat-ack` |
| Heartbeat and housekeeping | a 10 s timer | an alarm: every 10 s while a socket is connected, every 5 minutes otherwise (mail and push that are due, registry tidying) |
| Work after the answer | runs in the process | `ctx.waitUntil` keeps the object up for it |
| Pages `/s/:code`, `/e/*` | written by the host | the Worker sends those paths to the object; same fixed headers |
| The game's own page | default preview image made absolute | the same, from `PUBLIC_ORIGIN` or the request's host |
| Operator routes | bearer token, `MODERATOR_TOKEN` | the same; off unless the `MODERATOR_TOKEN` secret is set |
| Voice relay | `voiceConfigProvider` (none by default) | the bounded two-tester relay test (`turn-provider.ts`) |
| The original Allworld character | — | `/old-character.html` on the apex host only (`legacy-bridge.ts`) |
| Stopping | one shutdown order | nothing to flush: every acknowledged write is already durable |

What does not carry over, or fails closed, on the Worker:

- **One object, one region, one thread.** Every request and socket of every player goes through one Durable Object. There is no capacity claim.
- **Whole-collection writes.** `social`, `civic`, `growth`, `support`, `moderation` and `campus` are each one JSON value, split over rows when larger than 400,000 characters and rewritten whole when they change. That is fine for a pilot and will not scale; sessions, receipts and world shards are per-row.
- **Memory does not last.** Live table games (as on Node across a restart), the analytics consent answer (a forgotten answer means no analytics), the referral module's per-address link counter and the block and mute indexes (reloaded at start) live in memory. A table with someone seated keeps a timer pending so the object is not put to sleep under it; a deploy still ends games in progress.
- **Outside requests cannot be told to fail on a redirect** in the Workers runtime: `ctx.fetch` does not follow one and rejects the answer instead. Anything that is not `https` is refused, and every request is cut off after 15 s.
- **The durability barrier is skipped while the object starts** (nothing can be acknowledged then, and the runtime holds responses until writes are confirmed).
- **A failed durability barrier stops the object's store until it restarts** (`storage: 'failing'` in answers, 503 for writes).
- **`TRUST_PROXY`, `HEARTBEAT_SECONDS`, `SESSION_TTL_DAYS`, `STORE_WRITE_MB_PER_S`, `PORT` and `DATA_DIR` do not apply.** The address is Cloudflare's `CF-Connecting-IP`, kept only as a digest of the address (IPv6: of its /64).

### Storage and limits

How the Node store writes (`server/store.ts`) — there is one store with one set of rules:

- A transaction copies only the sessions it touches. It is applied to the server's memory when it returns and queued for the next write of the file; transactions applied while a write is in flight share the next one.
- **Acknowledged means in the file.** An action, message, gift, purchase, vote or report is answered only after the write that contains it has been renamed into place. That survives a crash of the process. Writes are not `fsync`ed, so it does not necessarily survive a power cut.
- **A failed request changed nothing.** If that write fails (a full disk, a missing directory), every change not yet in the file is undone — the transactions in the failed write and any applied on top of them — and each of those requests is answered `503 storage_unavailable`. The server's memory is then exactly what the file holds. Nothing is written later and nothing is retried in the background; the client retries, and the same action or request id is then applied once.
- **Polls.** A poll whose settlement produced no outcome (no cash moved, nothing finished, nobody arrived, no illness, skill, goal or roadside event changed) is answered from memory and written within one second. If the process dies first, or that write fails, the settlement is simply computed again from the stored state. This is the one case where an answer does not mean "saved", and it carries nothing a player could lose. A poll that did produce an outcome is saved before it is answered.
- **During a write outage** reads keep working (who am I, quiet polls, lists, the operator's read routes, the socket heartbeat and room checks) and every successful answer carries `"storage": "failing"`. Anything that would have to be saved answers 503. The failure is logged once per outage, then at most every 30 seconds with a count.
- **In-memory copies follow the file.** The block index, the mute list and room admission are updated only once the change they reflect is in the file, never for a change that was undone.
- **Rooms follow the saved life.** A player who sets off — a trip, the automatic commute to work, any timed action that moves them — is in no venue: once that departure is saved their sockets leave the room and the voice flag is cleared, whichever request or timer started it. From the moment the departure is computed the socket forwards nothing; the verdict itself is taken from the data file. So a departure whose write failed did not happen and revokes nobody, and the same action id sent again applies it once and then revokes. After every API request of a player who has a socket in a room, successful or not, the server re-checks that player's rooms against the stored lives.
- **Stored state cannot be changed by accident.** Everything applied to the document is frozen; code that holds on to a value from a transaction and tries to change it gets an error instead of silently changing saved data.
- Whole-file writes are paced by a byte budget (`STORE_WRITE_MB_PER_S`). A graceful stop (`SIGTERM`, `SIGINT`) writes whatever is pending.

What is applied exactly once, and what is not:

| Request | Retry key | Guarantee |
| --- | --- | --- |
| `POST /api/action` (every game action, including the gem prize) | `actionId` = `<unix ms>:<uuid>`, mandatory | Applied once per id. Same id, different contents: 409. Older than 24 h or more than 30 s ahead: 409, never run. Receipt kept 24 h in the session; 10,000 per session, then 429 until old ones expire (never evicted early) |
| Gift, player interaction, new group, problem report (`clientId`); shout-out, ad rental, standing for Governor (`requestId`) | `<unix ms>:<uuid>`, mandatory — 400 without it | Same rules through one helper (`server/routes/once.ts`): once per id, 409 on changed contents, 409 `client_id_expired` after 24 h, receipt kept in the player's session for those 24 h and never evicted before. **2,000** unexpired receipts per player (then 429) and **200,000** on the server (then 503), both refused *before* anything is charged, with "try again later" |
| Vote | none | One per player per election: the ballot is the record, written in the same transaction |
| Friend request, knock, Bae, block | none | Repeating one is answered from the stored state and changes nothing |
| Message (`clientId`, any 8–80 character key) | the message itself | Stored once per id while it is among the conversation's last 200 messages; a replay is answered only to someone still in the conversation |

A route module that runs one game action for the caller can use `ctx.command` (`server/routes/core.ts`): session check, settlement, action, an optional same-transaction side write and the receipt are saved together or not at all, and the authority and scope it ran with are part of the receipt, so the id cannot be replayed as an ordinary player action.

Not covered by any of this: a client that sends the same thing under a **new** id has made a second request; the per-minute and per-day limits of each feature are what bound that. An id is a retry key the client chooses — it proves nothing about who sent it or when. A route module can only spend through `ctx.act`, and the host refuses that call unless it is inside a receipt, forwards a request's action id, or names the stored state that makes a repeat harmless.

Every cap on what the data file can hold:

| What | Cap |
| --- | --- |
| Active device sessions | 10,000 (`maxActiveSessions`); further sign-ups get 503 |
| Action receipts per session | 10,000 within the 24-hour action window, then 429 until old ones expire; each stores a fingerprint of at most 96 characters |
| Gift, interaction, group and paid civic receipts | Two allowances counted separately, so interactions can never use up the room money needs: 2,000 unexpired per player and 200,000 on the server for player interactions, and the same again for everything else (gifts, groups, reports, paid civic requests). Each is kept exactly 24 hours from the time in its id and never dropped earlier; a stored result is at most 2 KB |
| Wallet history per life | 60 lines + 35 daily summaries of at most 9 reason groups |
| Archived lives | one per expired session **that had a life**; a session whose quick start was never confirmed (Play never reached the server) is deleted, not archived. Lived lives are never deleted automatically, so this grows with the number of players who ever played |
| Social | 200 friends, 30 pending requests, 200 blocks, 100 conversations and 20 groups per player; 200 messages per conversation; 50 updates per player; 2,000 player reports; 50 pending life effects per player (a gift is never the one dropped) and an unclaimed gift returns to its sender after 7 days; players idle 45 days are forgotten |
| Civic | residents not seen for a session lifetime are dropped (and their list preferences with them); 8 weeks of elections, 30 candidates each; 20 announcements; 12 billboards and 256 sea plots; 20 queued shout-outs per club; vote-address counts and flags for the current election only |
| Moderation | 1,000 audit lines; 5,000 mutes (expired ones are dropped on the next write) |
| Support | 2,000 problem reports (the oldest closed one makes room; if all are open, filing is refused with a reason); 5 open per player; 3 filings an hour per player and 10 per address; 600 characters each |

### Load test (local, one run)

`npm run load` starts an in-process server on a temporary directory and drives it with N simulated players over real HTTP on loopback; each polls `GET /api/life` about once a second and sends an action about every two seconds for ten seconds (`--players N`). Latency is measured around each request; write counts come from the store's own counters. One run per row on one machine (Apple M4 Pro, Node 24.14.1), 4 October 2026, on the store described above:

| Players | Actions answered | Action p50 / p95 | Poll p50 / p95 | File writes | MB written | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 507 | 6.1 / 15.6 ms | 1.6 / 5.4 ms | 503 | 186 | 0 |
| 300 | 1,491 | 20.4 / 36.2 ms | 0.9 / 9.2 ms | 400 | 422 | 0 |
| 500 | 2,478 | 30.4 / 57.8 ms | 0.8 / 12.7 ms | 246 | 432 | 0 |

This says what happened on that machine with young lives and a data file of 0.4–2.2 MB. It is not a capacity claim: a slow disk, a real network, long-lived sessions or a much larger file will behave differently. A single run of the build before undo-on-failed-write and frozen stored state, on the same machine the same day, gave 17.9 / 32.3 ms (actions) and 0.7 / 5.3 ms (polls) at 300 players. One run each cannot show whether those changes cost anything; it shows only that no large difference appeared. The earlier comparison against a store that rewrote the file on every request was removed with that store.

### Moderating a server

Start the server with a long random secret, for example `MODERATOR_TOKEN="$(openssl rand -hex 24)"`. Without it the `/api/mod/*` routes do not exist. Send the token only in the `Authorization` header, over HTTPS:

```sh
M="Authorization: Bearer $MODERATOR_TOKEN"; S=https://your.server
curl -s -H "$M" $S/api/mod/overview                 # open reports, open problems, mutes, store counters
curl -s -H "$M" "$S/api/mod/reports?status=open"    # player reports: reason, text, up to five quoted messages
curl -s -H "$M" "$S/api/mod/problems?status=open"   # problem reports with their automatic context
curl -s -H "$M" "$S/api/mod/content?city=lagos"     # live ads, announcements, shout-outs and the ids to remove them by
curl -s -H "$M" $S/api/mod/audit                    # the last 200 things an operator (or the vote cap) did

J="Content-Type: application/json"
curl -s -H "$M" -H "$J" -d '{"note":"Not against the rules"}' $S/api/mod/reports/R-12/dismiss
curl -s -H "$M" -H "$J" -d '{"id":"<public id>","minutes":60,"reason":"Spam in venue chat","report":"R-13"}' $S/api/mod/mutes
curl -s -H "$M" -H "$J" -d '{}' $S/api/mod/mutes/<public id>/lift
curl -s -H "$M" -H "$J" -d '{"cityId":"lagos","kind":"billboard","slot":"bb-03","reason":"Misleading"}' $S/api/mod/content/remove
curl -s -H "$M" -H "$J" -d '{"cityId":"lagos","kind":"announcement","id":"a4"}' $S/api/mod/content/remove
curl -s -H "$M" -H "$J" -d '{"cityId":"lagos","kind":"radio","venue":"quilox","id":"r9"}' $S/api/mod/content/remove
curl -s -H "$M" -H "$J" -d '{"status":"resolved","note":"That was Saturday rent."}' $S/api/mod/problems/P-7/status
```

A mute lasts from 1 minute to 30 days and stops that public id posting text anywhere; the player is told why and until when, keeps playing, and can still file a problem report. Removing content does not refund it; its owner is told. Every action is written to the audit trail. There is no ban, and nothing an operator can do deletes a life.

### The balance simulation

`npm run economy` plays one scripted life per start and strategy through the real rules engine on a virtual clock. A start is a birth-lottery outcome and a home: **`own`** — the start the game offers a new player, the free starter house in the local government picked at settle-in, with no weekly rent — and every rented home that outcome may choose (the Houses app's alternative, and what the game offered before). Fourteen starts × seven strategies (idle, helper only, career, gigs at equal effort, gigs all day, the best mix, and `social`, which pushes missions, table wins and referrals to their caps). It prints net worth on days 1, 3, 7, 14 and 30, income by source, costs by kind, the first promotion, whether rent was paid every Saturday, and the day the next house (for an owner: the first upgrade of their own house) and the cheapest car first became affordable. `src/game/economy.test.ts` runs it under `npm test` and asserts the design intent: no money from nothing, every repeatable source capped per day, a diligent career player solvent on every start, gigs never ahead of a career at equal effort, an idle or broke player always able to eat, wash, rest and earn for free, the next house and the first car reachable on a sane timescale, and the starter job alone never a way to a car.

Taking the weekly rent out of the start changed one result, and one provisional value was changed for it. With no rent, an Ajebutter on the ₦230,000 start its Mushin home has could buy the cheapest car in 129 days on the starter job alone (the assertion is "not within 150"); the own-house start of that outcome is ₦200,000, which makes it 163 days. Every other value is as it was:

| Start cash in the own starter house (`ownCash`, provisional) | Value | Same outcome in rented Mushin |
| --- | --- | --- |
| LAPO Baby | ₦76,000 | ₦76,000 + ₦2,400 a week |
| Civil Servant's Pikin | ₦40,000 | ₦40,000 + ₦2,400 a week |
| Street Smart | ₦18,000 | ₦18,000 + ₦2,400 a week |
| Ajebutter | **₦200,000** | ₦230,000 + ₦2,400 a week |

| 30 days, career (tech) | Net worth day 30, own house | …rented Mushin | First car, own | …Mushin |
| --- | --- | --- | --- | --- |
| LAPO Baby | ₦143,600 | ₦134,000 | day 59 | day 60 |
| Civil Servant's Pikin | ₦174,200 | ₦164,600 | day 59 | day 61 |
| Street Smart | ₦152,200 | ₦142,600 | day 61 | day 65 |
| Ajebutter | ₦328,800 | ₦349,200 | day 33 | day 31 |

No weekly sink was added to the starter house and nothing else was lowered: for the other three outcomes an owner is ₦9,600 better off after 30 days than a Mushin tenant (the four rents not paid), and the simulation's assertions hold with that. Upgrading the house brings the sink back (ground rent from ₦400 a week).

### Cloudflare adapter checks

```sh
npm ci --ignore-scripts --prefix deploy/tooling
npm run build
npm run test:edge
PORT=8787 npm run start:worker     # play it locally on the Workers runtime
```

The edge suite uses pinned local tooling (Miniflare) and the built static files; running it deploys nothing. Beside the conformance tests (public ids, origin isolation, exactly-once fares, restart durability, hibernation, the relay test, the legacy bridge, SQL failure injection) it plays the combined game on the Workers runtime: quick start → settling in with a local government and its plot → a mission → a share link and its preview page → the invite landing → a whole game of Whot over two sockets → the referral, then a restart; the invitations (house link, friend request, first message, knock and let-in) across a sleep; the UNILAG campus; and the operator surface. `deploy/README.md` and `deploy/RECOVERY-ADAPTER.md` describe the adapter and how to keep its data when upgrading.

## Vue and TypeScript migration

The game players get is `index.html`: one Vue 3 + TypeScript application (`src/app/main.ts`). There is one shell: the old `next.html`, the hand-written shell and panels (`src/ui/shell.js`, `src/ui/panels/`) and the legacy-panel adapter are gone. Every screen is a Vue component under `src/app/features/`, the stores are in `src/app/state/`, and `src/ui/` keeps only what is shared (tokens, controls, attention, keys, the Phone's drawn glyphs).

- **`src/types/`** and **`server/types.ts`** describe the life, the view, every action, event, route and socket frame. Conformance tests (`src/types/*.test.ts`, run by `npm test`) compare them with the running engine and a real server, so a new action, slice, route or frame fails the tests until it is typed.
- **`npm run typecheck`** (also a CI step) allows no error in `.ts` or `.vue`. Whatever JavaScript is left (the server, the engine's remaining modules) is checked in place against a recorded per-file baseline (`tsconfig/baseline.json`) that may only shrink.
- The client, the campus (`src/campus/`), the model library (`src/models/`), the scripts, `deploy/` and `vite.config.ts` are strict TypeScript. `server/` is still JavaScript.

The plan, the order of conversion and the known defects are in [docs/MIGRATION-VUE-TS.md](docs/MIGRATION-VUE-TS.md).

## Provisional values

Content under `src/game/content/` marks provisional values with `beta: true` (or lists them under `betaFields`). Values marked `beta: true` are provisional and may be retuned; the rest are this project's own tuning. Need decay, travel time, when a paid activity is charged, cancellation rules, the whole work shift and bill collection are flagged this way in the code.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/app/main.ts` | Client entry: the Vue application; `src/app/state/app.ts` wires the client model, scenes, telemetry and the community panel |
| `src/client.ts` | Browser-side mirror of the server-held life and all networking; read-only while offline |
| `src/life.ts` | Public entry to the rules engine shared by server, worker and client: `createLife`, `dispatch`, `advanceLife`, `viewLife` |
| `src/game/registry.ts` | System registry, event bus and modifiers — **the contract for adding a game system** |
| `src/game/systems/` | One file per system. Core: `core`, `wallet`, `inventory`, `needs`, `skills`, `activities`. Feature systems: `travel`, `health`, `career`, `economy`, `property`, `home`, `onboarding`, `goals`, `social`, `civic`. `index.js` registers them all |
| `src/game/content/` | Plain-data content: venues, travel, jobs, furniture, food, housing, cars, traits, goals, NPCs, civic, health, events |
| `src/game/api.ts`, `util.js`, `clock.js` | Core functions feature systems may call, shared helpers, and Lagos wall-clock time with the one opening-hours label |
| `src/game/home-layout.ts`, `character-effects.js` | Pure furniture placement rules; trait, lottery and perk effects applied through modifiers |
| `src/app/` | The Vue shell: `App.vue`, `state/` (game, shell, panels, social), `features/` (one folder per screen group: HUD, Phone apps, nav, sheets, Campus, Community), `scene/`, `ui/` (base components) — **`src/app/features/panels.ts` is the contract for adding a panel** |
| `src/ui/` | What the Vue shell shares: `tokens.css`, `shell.css`, the panels' stylesheets (`panels/*.css`), `controls.ts`, `attention.ts`, `keys.ts`, `dom.ts`, `phone/` |
| `src/ui/keys.ts`, `dom.ts`, `tokens.css`, `shell.css` | Keyboard shortcut map, template helpers, shared design tokens (including the play column, `--play-x`), shell styles |
| `src/ui/attention.ts`, `controls.js`, `controls.css` | The attention system (the one next step, the pointer, announcements) and the shared control kit (fields, listbox select, buttons, layout utilities) |
| `src/scene/look.ts`, `reward.js` | Renderer colour and tone mapping, sky, ground and the device tier; the reward chips and confetti |
| `src/app/`, `src/types/`, `server/types.ts`, `tsconfig/`, `scripts/typecheck.ts`, `docs/MIGRATION-VUE-TS.md` | The Vue 3 + TypeScript application and its types: see [Vue and TypeScript migration](#vue-and-typescript-migration) |
| `src/venue-world.ts` | Three.js host for venue and home scenes: walking, the orbit camera, sight lines, spot markers, other players' positions and name tags. Draws only while something moves; idle is zero frames |
| `src/scene/` | Procedural geometry: `venue-scenes.js` (one scene per venue kind), `venues-*.js`, `home-scene.js`, `characters.js` (avatars), `avatar-preview.js` (the creator's turning figure), `avatar-rig.js` (detail level and walk cycle, feature-detected), `crowd.js` (who stands in a scene, from real data), `movement.js` (walk grid, paths, avoidance, position reports), `camera-controls.js`, `camera-collision.js`, `controls.js` (on-screen pad and hint), `motion-loop.js`, `props.js`, `build.js`, `kit.js` |
| `src/map3d/` | The 3D miniature city map: `regions.js` (countries and cities), `cities/` (one data pack per city), `roads.js`, `city-build.js`, `landmarks.js`, `camera.js`, `labels.js`, `overlays.js`, `trip.js`, `actor.js`, `vehicles.js` |
| `src/ui/phone/` | The Phone device, its notification logic, wallpapers, and the drawn glyph set (`icons.js` at first paint, `icons-more.js` with the apps); `src/ui/icon-map.ts` maps game content to glyphs |
| `src/game/social-model.ts` | Pure client-side model for messages (outbox, retry) and presence wording |
| `src/world-map.ts`, `src/city-map.ts` | The door to the atlas for the host; the flat in-city map used where WebGL is not available |
| `src/map3d/geo/` | The atlas (world → Africa → Nigeria): `atlas.js` (the view), `build.js` (plates, ribbons, dots), `projection.js` (Equal Earth), `topo.js` (the compact data form), `pick.js`, `levels.js`, `labels.js`, `routes.js`, `info.js`, and `data/` (one generated module per level) |
| `src/community.ts` | Room presence, chat and voice |
| `server/server.ts` | Node host: HTTP and WebSocket plumbing, static files, server context |
| `server/routes/` | HTTP endpoints. `index.js` is the route registry — **the contract for adding a route**; `core.js` holds session (including the flag that starts a life as a guest of the quick start), life, action and voice-config; `social.js` and `civic.js` are thin adapters; `once.js` is the shared receipt helper (not a route module) |
| `server/ws/` | WebSocket message types. `index.js` is the registry; `rooms.js` holds presence, movement, chat, voice state, signalling and the guest rule for Home rooms; `social.js` the social messages |
| `server/social/`, `server/civic/` | The player-to-player rules (friends, messages, houses, gifts, reports, presence) and the shared city rules (elections, ads, radio, residents) |
| `server/protocol.ts`, `server/life-service.ts` | Validation, idempotency and settlement logic, free of I/O and shared with the Cloudflare adapter |
| `server/moderation/` | `terms.js` (the one list of blocked terms), `text.js` (the text filter), `service.js` (mutes and the audit trail) |
| `server/support/`, `server/routes/support.ts` | Problem reports with automatic context, and the server's wallet statement |
| `server/routes/moderation.ts` | The operator routes behind `MODERATOR_TOKEN` |
| `server/store.ts` | JSON file store behind a two-method `transact`/`read` interface: copy-on-touch transactions, shared durable writes that are undone if they fail, lazy polls, frozen stored state, a write budget |
| `server/routes/once.ts` | The exactly-once helper behind `ctx.once`, `ctx.act` and `POST /api/action`: mandatory timed ids, conflicts, expiry, quotas without eviction |
| `src/lazy-load.ts` | Loads a late chunk (the community panel) with a truthful state and bounded retries |
| `src/telemetry/` | Error monitoring and product analytics, off unless configured. `index.js` is the facade (the only part in the first download); `core.js` (consent, queues, funnel), `sentry.js` / `posthog.js` (the only files that import an SDK), `consent-ui.js` and `what-we-collect.js` (the sheet and its words) are lazy chunks; `events.js` is the event catalogue; `scrub.js`, `clean.js`, `policy.js`, `funnel.js` are the pure rules, shared with the server |
| `server/telemetry/` | The server side: `config.js` (environment), `transport.js` (bounded queue, `fetch` to PostHog's batch API and Sentry's envelope endpoint), `instrument.js` (what routes, socket replies and room snapshots mean as events), `routes.js` (`/api/telemetry/*`) |
| `scripts/sentry-sourcemaps.ts`, `scripts/telemetry-capture.ts` | Source-map upload (`npm run sentry:sourcemaps`); a local stand-in for both services that records what would be sent |
| `server/auth.ts`, `server/routes/auth.ts` | Inert placeholders for accounts; device sessions remain the only identity |
| `src/game/systems/missions.ts`, `events.js`, `growth.js`, `src/game/content/missions.ts`, `calendar.js`, `growth.js` | Missions and the stamp card; event attendance and spraying; the server-only credits for table wins and referral gifts. Content is plain data |
| `src/game/calendar.ts`, `digest.js`, `outreach.js`, `share-model.js` | Pure functions shared by server and client: what is on when; the away card and the weekly digest; when a message may be sent, the address check and the consent wording; what a share says |
| `src/tables/` | Table games. `rules.js` is **the contract for adding a game**; `whot.js`, `penalty.js` are pure rules; `places.js` says where tables stand; `client.js` and `*-board.js` are the browser side |
| `server/growth/`, `server/routes/growth.ts`, `growth-mod.js`, `server/ws/tables.ts` | Share links and the preview page, referral, metrics, the table service, outreach (e-mail through `email/zeptomail.js`, web push in `webpush.js`); their routes, operator routes and socket messages |
| `src/app/features/growth/`, `src/app/features/tables/`, `src/ui/share.ts`, `src/ui/push-client.ts` | The growth apps and chips, the share painter and the push subscription |
| `public/` | `og/allworld.jpg` (link-preview image), `icons/`, `sw.js` (notifications only) |
| `scripts/first-day.ts` | The scripted first day (`npm run first-day`), also run by `server/first-day.test.ts` |
| `scripts/first-minute.ts` | The scripted first minute (`npm run first-minute`), also run by `server/first-minute.test.ts` |
| `src/quick-start/` | The first minute's client logic. In the first download: `model.js` (pure: the landing of a link — `joinIdFrom`, `linkParts`, the banner words — when to offer settling in, the funnel) and `entry.js` (what the device keeps, the one place a link is read, the device token, and the funnel events). Fetched with the landing screen: `look-model.js` (pure: name suggestions, presets, starter looks, the draft) and `draft.js` |
| `scripts/new-player.ts` | The new-player journey (`npm run new-player`), also run by `server/new-player.test.ts` |
| `scripts/world-load.ts` | The world layer's load test (`npm run world-load`) |
| `server/host-context.ts` | What both hosts do the same way when they build the server context: the settings a module may read, the bounded outside request, `ctx.act` under a receipt, session archiving, page headers |
| `src/campus/unilag/`, `src/campus/shared/`, `server/routes/campus.ts`, `src/app/features/campus/` | The UNILAG campus: layout and walk grids, the scene and its own host (`host.ts` behind `world-adapter.ts`), three engine systems (student, community, shuttle), the shared election routes and the Campus app. `campus.html` is its development preview |
| `src/models/`, `models.html` | The procedural model library and its workshop (development only). `integration/flags.ts` is the one place its opt-in flags are read |
| `deploy/` | The Worker host: `cloudflare-worker.ts`, `sqlite-store.ts`, `sqlite-shards.ts`, `legacy-bridge.ts`, `turn-provider.ts`, their tests, `local.ts` (run it on this machine) and pinned tooling |
| `server/world/`, `server/routes/world.ts`, `server/ws/world.ts` | The plot registry: one append-only shard per local government (`shard-core.js` is the store, `shards.js` its file backend; `registry.js`), the service that keeps it in step with the lives and allocates plots (`service.js`), the read-only routes, and the online count per local government |
| `src/game/systems/estate.ts`, `src/game/content/world.ts` | Where a life lives: its local government, its plot, its house (style, tier, upgrades, ground rent), living in it or renting; the twenty local governments, land prices and the estate grid |
| `src/app/features/world/`, `src/map3d/` | The local-government card (and its section of the settle-in Home card), the local-government page and house card, and the 3D city map that draws estates and houses |
| `scripts/two-players.ts` | The scripted two players (`npm run two-players`), also run by `server/two-players.test.ts` |
| `scripts/economy-sim.ts` | The balance simulation (`npm run economy`); its assertions are `src/game/economy.test.ts` |
| `scripts/load.ts` | The local load test (`npm run load`) |
| `**/*.test.js`, `server/test-fixture.ts` | `node --test` suites (one per owner under `src/game/`, plus `integration.test.js` for the seams between them) and the shared server fixture |

The only registered placeholders left are the accounts files (`server/auth.ts`, `server/routes/auth.ts`): they mark where a reviewed accounts design would live, not that one exists. [What works today](#what-works-today) is the list of working features.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE). Third-party data and dependency licences are listed in [NOTICE.md](NOTICE.md).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT), [Vue](https://vuejs.org/) (MIT), and — downloaded by a browser only when telemetry is configured — [@sentry/browser](https://github.com/getsentry/sentry-javascript) (MIT) and [posthog-js](https://github.com/PostHog/posthog-js) (Apache-2.0 and MIT). The server sends telemetry with `fetch` and has no SDK. All scene and city-map geometry is written in code.

### Map data credits

The boundaries of the world, Africa and Nigeria's states, the Niger and Benue rivers, Lake Chad and the Kainji reservoir, and the positions of capitals come from [Natural Earth](https://www.naturalearthdata.com/) — public domain ("No permission is needed to use Natural Earth"). Files used, from the `geojson` folder of [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector): `ne_50m_admin_0_countries`, `ne_10m_admin_1_states_provinces` (the 37 Nigerian units), `ne_10m_rivers_lake_centerlines`, `ne_10m_lakes` and `ne_10m_populated_places_simple`. They were simplified (Visvalingam–Whyatt on shared borders, so neighbours still meet exactly), quantised and stored as three small modules under `src/map3d/geo/data/`; each records its tolerance in its header. Borders are Natural Earth's default view and imply no position on any dispute. Roads and flight lines on the map are stylised: lists of real towns joined by straight lines, written from general knowledge. Nothing is fetched from a map service at run time. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.

## Search and link previews

`index.html` carries the title, description, canonical, Open Graph and Twitter tags and the `VideoGame` / `WebSite` JSON-LD, all written for `https://joinallworld.com`. Both hosts (the Node server and the Worker) rewrite that origin, and the relative `/og/` image paths, to `PUBLIC_ORIGIN` or the request's own host, so previews and canonicals also work on localhost and on a staging host. `public/robots.txt` and `public/sitemap.xml` (the home page only) are copied to `dist/`; the API, share pages (`/s/`) and e-mail pages (`/e/`) are kept out (`Disallow`, `noindex` meta and an `X-Robots-Tag` header). The workshop pages (`campus.html`, `models.html`, `voice-test.html`) are `noindex` and not built. The share image and app icons are drawn by `node --experimental-strip-types scripts/make-og.ts` (headless Chromium from the Playwright cache); rerun it after changing the artwork. `server/seo.test.ts` checks the head, the JSON-LD and the files.
