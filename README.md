# Allworld

An open-source, lightweight browser city-life game. You pick a city on the country map, travel between venues on a 3D city map, walk around inside them, and spend time on activities that change your cash and needs. Lagos is the first city; Ibadan is the second, and cities are meant to become reusable packs rather than one-off builds.

Allworld (this repository, `joinallworld`) is original work built in a new repository. No files were copied from the earlier Allworld v1 project, and no assets or code were extracted from any reference game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test            # rules engine, scenes, client model and Node server suites
npm run first-day   # one scripted new life, start to Saturday rent, with a transcript
npm run first-minute # one brand-new player: Play → first reward → settling in, timed in server time
npm run new-player  # the merged game end to end: two new players, a house, missions, a share link, Whot, a referral
npm run two-players # two scripted players: presence, messages, a house visit, a gift, an election
npm run economy     # scripted lives under six strategies, played through the rules engine: the balance table
npm run load        # N simulated players against an in-process server: latency and file writes
npm run world-load  # the local-government registry at city scale (writes large temporary files and deletes them)
```

### Development

Start the complete local game with one command:

```sh
npm run dev             # game, API and WebSocket at http://127.0.0.1:5173/
```

The launcher starts a dedicated API on a free loopback port and connects Vite to it. Set `DEV_PORT` to use a different frontend port. It fails clearly if that port is already occupied and stops both servers when you press Ctrl+C. `npm run start:server` remains available for running the API separately.

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
| `TELEMETRY_CONSENT_AT` | `reward` | When the consent sheet is first shown: `reward` (after a new life's first reward — never during the first-minute flow; a returning player at their first state) or `landing` (at once). The older value `named` means `reward`. See the note below |
| `TELEMETRY_REPLAY_ON_ERROR` | unset | `1`: opt in to Sentry session replay for sessions that hit an error. All text and inputs are masked and no canvas is recorded. Off by default; its code is a separate chunk that is not downloaded otherwise |
| `TELEMETRY_SLOW_MS` | `1000` | An API request slower than this may be reported as a slow transaction (1 in 5 of them) |

**Production.** Set `TELEMETRY_ENV=production`, the two DSNs, `POSTHOG_KEY` (and `POSTHOG_HOST` for an EU project) and `BUILD_ID` in the server's environment, then switch on the project-side settings listed in SECURITY.md. Nothing is configured at build time, so one build serves every environment.

**Local preview.** Telemetry does not run on `localhost` unless `TELEMETRY_DEBUG=1`. To see exactly what would be sent without any account or key, point the game at the bundled stand-in, which records everything and talks to nobody:

```sh
node scripts/telemetry-capture.mjs &          # a local stand-in for Sentry and PostHog on 127.0.0.1:3361
npm run build
TELEMETRY_ENV=dev TELEMETRY_DEBUG=1 BUILD_ID=local \
SENTRY_DSN_CLIENT=http://client@127.0.0.1:3361/11 SENTRY_DSN_SERVER=http://server@127.0.0.1:3361/22 \
POSTHOG_KEY=phc_local_capture POSTHOG_HOST=http://127.0.0.1:3361 npm start
curl -s http://127.0.0.1:3361/__captured      # everything recorded so far
```

**Source maps.** `npm run build` writes hidden source maps (no reference to them in the served files). Before deploying, upload them and remove them from `dist/`:

```sh
BUILD_ID=<release> SENTRY_AUTH_TOKEN=<token> SENTRY_ORG=<org slug> SENTRY_PROJECT=<browser project slug> npm run sentry:sourcemaps
```

The token comes from the environment and is never written anywhere; `--strip-only` deletes the maps without uploading. Maps are never served in any case: the Node server answers 404 for `*.map`, and `public/.assetsignore` keeps them out of the Worker's assets.

**How it fits together.** `src/telemetry/index.js` is the facade — `track(name, props)`, `screen(name)`, `identify(publicId, traits)`, `setGroup('lga', id)`, `captureError(error, context)`, `setConsent(choice)` — and the only telemetry code in the first download (about 2 kB). It is safe to call anywhere and never throws. Code that should not import it can dispatch a DOM event instead: `window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } }))`. Everything else (`core.js`, the two SDK wrappers, the consent sheet) is fetched as separate chunks after the first scene is drawn, and only if the server says telemetry is configured; the PostHog chunk only after the player chose Accept. Every event name, its properties, when it fires and why is in `src/telemetry/events.js`. The server side is `server/telemetry/` — `track(publicId, name, props)` and `captureError(error, context)` over a bounded queue sent with plain `fetch`, never on a request's path, flushed on shutdown.

**When the consent sheet is shown.** By default (`reward`) a new player is not asked during the first minute at all: the question comes after their first reward, at least five seconds later, when no other sheet is open and nothing is running (the reward and the "Make this life yours" offer come first). The first-minute events (`landed`, `named`, `play_tapped`, `arrived`, `first_activity_*`) wait in memory meanwhile and are sent only if the answer is Accept; a visitor who leaves before answering is never counted. `TELEMETRY_CONSENT_AT=landing` asks on first paint instead.

**One catalogue, one source per event.** Every event the game's screens report (`jaw:track`) is listed in `src/telemetry/events.js` with its properties; a test reads the sources and fails if one is missing or carries a property the catalogue would drop. The first minute and the landing of a link are reported by the quick start, where you live by the world panels, missions/tables/sharing/outreach by the growth panels; telemetry itself derives only what no screen reports (`activity_completed`, `first_travel`, `first_job_shift`, `streak_day`, `event_joined`). The chosen local government is set as a coarse group (`setGroup('lga', id)`).

**Under 18.** The age answer is stored in one place (the growth collection, `POST /api/growth/consent`). "Under 18" switches analytics off as well as e-mail and push: the server forgets any Accept it held, `GET /api/telemetry/config` and `POST /api/telemetry/consent` tell the browser (`under18: true`), and the page announces the answer the moment it is given (`jaw:age`).

**Cloudflare adapter.** `deploy/cloudflare-worker.js` does not serve `/api/telemetry/*` yet: on the Worker the page is told nothing and telemetry stays off. `server/telemetry/` uses only `fetch` and Web APIs so the Worker can adopt it.

### Without the server

The client still loads if the server is unreachable, but it is **read-only**: it shows the last state cached in the browser, and no action, travel or city switch is applied. There is no offline play and nothing is granted locally. Use the retry control once the server is back.

## What works today

Each item says whether it follows behaviour observed in a public Lagos city-life game or is an original beta design. "Observed" means a name, price, duration or sequence was seen; it never means the mechanics behind it are known.

- **The screen.** The 3D scene is the centre of the screen. Always on top of it are one top bar (Lagos time, mood, your name, whether your progress is saved — or the real state of the connection in its own words (**Connecting…**, **No internet**, **Server unreachable**, **Saved life not found**, each with the action that fixes it), or **Not saving** with the server's own reason while it reports that it cannot write its data file — and your wallet, which opens the Bank), the six needs as a slim strip of bars, and one goal line. Everything else that used to sit on the scene — weather, your home, the gem hunt, messages, the country map, Community and help — is behind the **More** button, which carries a badge counting the chips that have something new; something that needs an answer now (a knock at the door, a roadside choice) shows as an alert above the goal line instead. **Clean screen** (the eye, or X) hides all of it except the top bar and the bottom nav. The bottom nav is Home, Buy, Map and Phone; above it the venue panel lists the spots of the place you are in and, once a spot is picked, its activities as cards that say what they cost, give and — when they cannot be started — the one reason why. A trip is shown on the 3D map (your piece moving along the roads) with a progress chip and Cancel, which says what cancelling forfeits: the fare actually paid. Feedback is a toast under the HUD, never more than two at once; a wallet change flashes with its reason. For the first three starter goals a coach line names the next control and can be dismissed for good. Keyboard shortcuts cover the nav, the spots, the activity list, Clean screen, the map and Buy mode (press `?` for the list). Every icon is a glyph of the game's own drawn set; no emoji is used as an icon. Phone apps and Sim tabs are downloaded the first time one is opened. Checked at 390 × 844 and at 1280 × 800. *Original:* the whole layout.
- **Quick start, then settling in.** A new device meets one screen — a suggested name, a quick character (3D preview, Shuffle, five presets, body toggle; the full creator is optional) and Play — and is then standing in Freedom Park as a *guest*, with one line of guidance: "Play a round of Ayo". Two traits, a dream, the birth lottery and where you live are offered afterwards as "Make this life yours": short cards, each confirmed by the server, that can be left and resumed at any point. Until the player settles in, the life plays in public venues only and has no home, no local government and no house: it is in no residents directory, estate or rich list, and missions are not dealt to it. Lives saved before character creation existed are never asked; a life the earlier compulsory flow left half-way resumes as a guest with its choices kept. *Observed:* the steps, the option names, one lottery outcome (a ₦60,000 loan repaid at ₦12,000 a week, start cash ₦96,000 in Yaba or ₦76,000 in Mushin) and the starting needs. *Original:* the quick start itself, the other three lottery outcomes and their odds, every trait strength.
- **One home model: everyone gets a house.** Settling in ends with the player choosing their **local government** — found on the device ("Find my local government": the position never leaves the browser, only the id the player confirms) or picked from the twenty of Lagos — and the server allocates a free **starter house** on a plot there (512 estates × 196 plots per local government). The life lives in that house: a furnished 6 × 6 room, **no weekly rent**. The birth lottery still sets the start cash (₦76,000 LAPO Baby, ₦40,000 Civil Servant's Pikin, ₦18,000 Street Smart, ₦200,000 Ajebutter). The rented homes (Mushin, Yaba, Lekki, Ikoyi, Banana Island, with their observed rents and move-in costs) are the alternative in Phone → Houses: move to one and its Saturday rent starts, move back into your own house for free; the plot stays yours either way. The house can be restyled and upgraded (four larger tiers, priced by how dear land is in that local government, with a weekly ground rent above the starter), is drawn on the city map at its address, and its owner is in the local government's directory. A change of local government is allowed once every seven days. *Original:* all of it.
- **Starter goals, wishes, stars, perks and a lifetime dream.** Ten starter goals pay cash and a star once each — Play a round of Ayo → Say hello → Settle in → Eat → Freshen up → Get a job → Buy something → Visit the buka → Make a new friend → Work a shift — and after them the goal line becomes a rolling next step. The first goal completes on the round of Ayo itself (or, for a guest who has gone elsewhere, the free pastime the goal line points at there), never on a shift or a paid gig. The goal line is the one piece of guidance on a guest's screen: every other chip waits behind More, and missions are dealt only once the life has settled in. *Observed:* the titles and rewards of the seven home goals (rewards of five of them), the first three wishes, the first eight perks. *Original:* the three opening goals and their rewards, the rewards of "Make a new friend" and "Work a shift", the rest of the wish and perk lists, dream progress formulas and the dream reward. "Make a new friend" completes when you greet one of a venue's regulars or make a friend.
- **A home you furnish.** A grid room sized by the house, Buy mode with nine category tabs, placement with a ghost, move, store and sell, a shared kitchen with ingredients, eleven recipes and a Groceries app. *Observed:* six Comfort items, recipe names and durations, starting ingredients. *Original:* every other price, what star ratings do, grocery prices, the rule that ingredients are used only when a meal finishes.
- **A city to move around.** 24 venues and your home (each with two regulars) on an in-city map with opening hours, a venue card with five travel modes (Danfo selected by default), fares charged at departure, per-mode trip times, roadside events, weather and illness. *Observed:* the venue list, two fare bands, the trek's need cost, one roadside event, one opening time. *Original:* nearly every activity's numbers, all trip times, the cross-lagoon fare band, opening hours, the other roadside events, weather and how illness is caught and cured; and the whole of the Airport (Ikeja) and the Refinery (Lekki Free Zone) — their spots, activities, hours and scenes. The Airport's Travel desk only names the flights that wait for other cities to open; it sells nothing.
- **Careers.** Fourteen tracks, each with a six-level ladder, a workplace on the map and one paid shift per Lagos day; "Go automatically" commutes to the work spot when the workplace is open. Jobs and Career show the workplace's opening hours with the same label the map uses. *Observed:* entry roles and entry pay, the five-day Tech week, 50% starting performance. *Original:* the whole shift design — the reference shift was never seen — plus pay above entry level, promotion gates and work days. The older Community helper job still works for existing saves, limited to one ₦300 shift every four hours (original).
- **Money.** Weekly rent (for a life that rents — the own starter house has none) and the loan instalment are collected on Saturdays (Lagos time) even while you are away, each exactly once, each with a ledger line; missed rent becomes arrears with a late fee. Houses, cars and fixed deposits can be bought in Phone apps. *Observed:* rents, the loan figures, house and car price points. *Original:* how bills are collected, arrears, deposits, fuel costs.
- **A statement that explains the balance.** Every cash change is recorded with its reason and time. The last 60 changes are kept line by line and the last 35 days with activity as daily totals (opening, in, out, closing, and the reasons that moved the most), so a change is still explained after its line has scrolled away. Phone → Statement shows opening balance, every change and closing balance with the arithmetic, and can check itself against the server's own copy. A save whose balance does not match its history gets a visible "Balance correction" line, never a silent difference. *Original:* all of it.
- **Paid gigs, with a daily limit.** Venue activities that pay are limited by a cooldown, a need cost and **eight paid gigs per Lagos day** across the city; a job's shift does not count. The limit exists because the balance simulation showed that touring gigs all day out-earned any career several hundred times over. *Original:* the limit and every gig's numbers.
- **Needs, mood and a transaction log.** Six needs fall slowly in real time (never below 10 on their own, and at most four hours' worth while you are away). Mood is one of five words (observed) from thresholds that are original. Home always offers free food, a free wash and free rest, and the starter job can be worked at any hour, so no player can be left unable to recover.
- **A separate life per city**, held on the server. Cash, needs, location and the action in progress are changed only by the server and settled against server time, so an action finishes even if you close the tab.
- **Retry-safe actions.** Every action carries an ID made of the time and a random UUID. A repeat of the same ID returns the recorded outcome instead of charging twice, reusing an ID for a different action is rejected, and IDs older than 24 hours are refused. This protects a retry of the *same* request; a client that sends the same thing under a new ID has sent two requests. See [Storage and limits](#storage-and-limits) for exactly what is and is not applied once.
- **Device sessions.** A random secret in an `HttpOnly` cookie plus a nickname. This identifies a browser, not a person — it is not an account. Sessions expire, and there is no way to recover one.
- **People.** Every public venue has two regulars (NPCs) you can greet, gist with, joke with, compliment or buy a drink; closeness grows through four tiers. Real players in your venue room are listed from the server's own presence, with truthful Online / Away / Reconnecting / Offline: a connection that stops answering is no longer shown as online after at most 15 seconds. You can find a player by name, send a friend request, block and report. **Blocking works in public venues too:** the two of you are left out of each other's room list, neither receives the other's chat, and voice between you is refused. *Observed:* the five NPC interactions and their tags, Say Hello's +12 Social and +2 Fun, the ₦300 drink, the 60% joke chance, one NPC name and role, a closeness meter that unlocks "Bae" at 40. *Original:* every other name, quote, number, tier and limit, and the whole design of friendships, blocking and reports.
- **Moderation.** Every name, chat line, message, group name, slogan, announcement, ad and song title passes a server-side text filter; a refused text is rejected with a reason and never altered. Reports reach an operator, who can dismiss them, mute a player from posting text for a set time, and remove an ad, an announcement or a shout-out, with an audit trail. A mute never touches the player's life or money. There are no moderator accounts: see [Moderating a server](#moderating-a-server). *Original:* all of it.
- **Report a problem.** Phone → Report a problem files a report on the server with a receipt number, with no e-mail or outside account. The server attaches the build, your last ten actions and their results, the last refusal and your last ten wallet lines. The receipt and its status stay visible after a reload. *Original:* all of it.
- **Messages.** Direct messages, groups of friends, a house chat, and one **Updates** feed: friend requests, knocks and gifts beside what your own life posts — rent due, paid and missed, loan payments, promotions, illness, and news from the Governor. A message you send shows as sending, then sent or failed with a retry that reuses the message's client id; the server stores a message once per id for as long as it is among the conversation's last 200 messages. *Observed:* the Chats / Updates tabs and the idea of groups. *Original:* everything about how they work.
- **House visits.** Share your house link; a visitor knocks while you are at home; you let them in or not. Up to five guests join your home room, where you see them standing by the door, and share a house chat. A visit ends after 30 minutes, when the guest leaves or is asked to, or when you go out. *Observed:* the link, the knock and the two answers, five guests. *Original:* the rest. Guests do not see the host's furniture yet.
- **Gifts of naira between friends,** deliberately limited: only money earned from work (shift pay and paid gigs — never start cash, the loan, goal rewards or prizes), ₦5,000 a gift, three gifts and ₦10,000 a day, an account at least a day old and a friendship at least an hour old. One request id moves the money once, in both ledgers. The gift lands in your friend's life in the city you sent it from if they have one there, otherwise in the life they played most recently; if they have no life anywhere it is refused before you are charged. *Original design:* the reference game's rules were not observed.
- **Family and contacts.** A daily check-in call to four family members (original); "Mummy" as a contact was observed.
- **Governor.** A weekly election on Lagos time: nominations Monday–Wednesday (a ₦2,000 in-game filing fee), one vote per player Thursday–Saturday cast in person at the Polling Unit by a life that has been paid for work on at least two different Lagos days, and on Sunday the winner takes office for a week and can post announcements that reach every resident's Updates. *Observed:* that a Governor, a Polling Unit and a State House exist, and the State House's empty-state wording. *Original:* the entire mechanism.
- **Neighbours and the Rich List.** Real counts of residents (a guest who has not settled in is not one) and who is online, a directory of homes by rented district with owners listed apart ("In their own house" — the directory by local government is on the map), top balances and top earners of the week; you can hide yourself from either list. *Observed:* that homes appear on the map with an online count. *Original:* the rest.
- **Billboards and sea plots.** Rent one of twelve roadside billboards or a plot in a 16 × 16 patch of sea with in-game naira and put one line of text, a colour and an icon on it. They are drawn on the city map behind its Billboards and Sea layers. *Observed:* "from ₦100 a plot" for 30 days. *Original:* everything else. There are no uploaded images and no links.
- **Daily gem hunt.** Three gems hidden for you each Lagos day; find them by going to the places in the clues, then claim ₦3,000 once. *Observed:* the HUD chip wording and the prize. *Original:* the whole mechanic.
- **Club radio.** In the four club venues a banner shows the shout-out that is "playing" and a button to buy one: a song title and artist as text, queued on server time. No audio is played. *Observed:* the chip and button labels. *Original:* the rest.
- **City map layers.** Billboards, Sea, Neighbours and Gov toggles draw those overlays from the server's own data; with Gov on, the State House opens the Governor sheet.
- **The Phone.** The Phone is drawn as a device: a home screen of apps with badges, a notification shade and an app bar with back. On a wide screen it can be expanded, and apps lay themselves out in columns there. Long rules sit behind a small "How it works" disclosure; costs and deadlines are always on the first line. *Original:* the whole device.
- **A 3D city map with visible travel.** The map is a miniature Lagos in Three.js: districts, roads, the lagoon, bridges and a landmark per venue, with labels you can press. A phone opens close on your own piece with **Whole city** and **Find me** buttons; a wide screen opens on the whole city. A trip is your piece travelling the roads in the vehicle you paid for (on foot, okada, keke, danfo, cab or your own car), in real trip time, and the label of the place you arrive at steps aside so it never covers you. Above the city is one zoomable map in three levels — Nigeria with all 36 states and the FCT as extruded plates, Africa with every country, and the world — drawn from real boundaries (Natural Earth, public domain) on an Equal Earth projection written in the code. Lagos State is the only region in colour and the only one that can be entered; every other state, country and continent is grey and marked coming soon, still selectable, and Ibadan, Abuja and Port Harcourt keep their previews and their planned routes with fare and time. Each level's data is fetched the first time it is shown; a searchable list is the alternative to pointing at the map. A player who already has an Ibadan life from an earlier build is recognised from the server's session answer (the list of cities that session has a life in), so it is the same on every device. The map draws on demand: a loop runs only during input, a trip or a short ease, and stops itself. The earlier flat SVG map remains as the fallback where WebGL is not available.
- **Venue scenes you walk in.** One procedural Three.js scene per venue kind with day, dusk and night lighting. Your avatar wears your saved look and walks: arrows or W A S D, a click or tap on the floor, a click on a spot's marker (which walks there and then selects the spot), or the on-screen stick on a touch device. It walks round furniture, round other figures and up the declared way onto raised places (a stage, a walkway), and can never be trapped. The camera orbits all the way round by dragging (`[` `]` and PgUp/PgDn on the keyboard), zooms with the wheel, a pinch or `+` `−`, and `0` recentres; a room hides whichever walls the camera is behind, with what hangs on them. Zoomed in, the camera is held in front of whatever would hide your avatar, or that thing is faded. Regulars stand at their places with a green dot, clear of the spot markers; real players in your room are drawn where they actually stand — your position is sent to the room at most three times a second and only when it changed, and theirs eases between updates — with an "@name" tag; you carry a crown. Nothing renders while the game is idle: frames are drawn only while something moves (input, a walk, a bounded ease) and the loop stops itself, with or without a crowd; with reduced motion asked for, moves are single frames.
- **A 3D character creator.** Character creation and the Boutique show your look on a turning 3D figure as you change it; the same figure, at a lighter detail level, is what the scenes and the map draw.
- **Community panel and opt-in voice.** Public venues have live presence and text chat; home rooms are private to the host and the guests they have let in. Nothing touches the microphone until you press Join voice; you join muted, and proximity — measured from where the avatars stand in the scene — controls who you hear. The panel's Walk buttons are the keyboard way to move.
- **Settings.** Sound and music preferences saved on the device (the build has no audio yet, and the tab says so), an explanation of what a device session is, the privacy switches (directory, rich list, analytics), and "Outside the game": Stay in touch, and the owner's WhatsApp Channel when one is configured (the same link is at the foot of Messages, in Events and in Stay in touch).

- **Missions.** Three daily and three weekly missions (one about your life, one about the city, one about people), dealt from data and completed by ordinary play. A daily mission pays ₦250 and a weekly one ₦1,000, once, when collected; a full set adds stars. A weekly stamp card pays stars for any four days played, and a count of days that only ever goes up. Nothing is lost by missing a day. *Original:* all of it.
- **Events.** A calendar of weekly and dated events on Lagos time (trivia night, club night, owambe, market day, match day, Felabration…), kept as data. Being at the venue and finishing an activity counts as attending. At a party you can spray naira: a sink that pays Social and Fun and nobody receives. "Add to my calendar" makes a calendar file on the phone. *Original.*
- **Sharing and bringing a friend.** A Share button makes a picture card and a short text for the phone's own share sheet (WhatsApp, X, copy and save as fallbacks). Share links (`/s/<code>`) show a proper preview in chat apps and lead a visitor to the sharer. A friend who arrives through a link and is paid for work on two different Lagos days counts: they get ₦1,000 after their first paid day, the inviter ₦1,500 and two stars, at most five a week and twenty for life. Sharing itself pays nothing. *Original.*
- **Game tables.** Whot (the Nigerian pack and special cards, with the rules houses differ on as table options) and a penalty shoot-out, at tables in the buka, the park, the rooftop, the viewing centre and the beach. Each table stands in its venue's scene — a table with stools, or a small goal — with a name tag: walk up to it or tap it and the Tables app opens on that table (sit, watch, invite a friend to it); the Phone's Tables app is the list. Sit at a table in the venue you are in, play real players or house bots, watch from anywhere. The server deals, holds every hand and judges every move. There are no stakes: a win against a real player pays ₦150, four times a day; the same two players' games count three times a day. *Original.*
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

A link may carry three things, and they are read once, in one place (`captureLink` in `src/quick-start/entry.js`, handled by `landJoin` in `src/life-main.js`):

- `join=<public id>` (or the house link `/v/<public id>`): the player to stand beside;
- `ref=<share code>`: the share link it came from, attached to the visitor's new life as a referral;
- `table=<table id>`: a game table to open.

A share link is `/s/<code>`: a small page with Open Graph tags and no script (so a chat app's crawler can draw a preview) that sends a person on to `/?join=<sharer>&ref=<code>` (and `&table=<id>` for a table). A **new** visitor then goes through the quick start and: the referral is attached (`POST /api/growth/referral/link` — it pays nobody yet); they are put in the sharer's public venue when the sharer is in one right now (`POST /api/social/join` → `joined`), offered the knock when the sharer is at home, or told the sharer is out, reconnecting or offline; **one banner** says it ("You’re joining Ada … Work a paid shift and you both get a gift.") with no welcome toast beside it; and a table the link named opens in the Tables app. A settled player who opens such a link gets the Invite app on that house and the table. Both gifts wait for the newcomer's paid work on real Lagos days. The funnel events are `invite_opened`, `invite_joined`, `join_landed` and `invite_colocated`.

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

- **No accounts.** No passwords, sign-in, recovery email or moving a life between devices. An accounts design exists as a separate, unmerged proposal; `server/auth.js` and `server/routes/auth.js` are inert placeholders and Settings has no account section.
- **Moderation is basic.** The text filter is a short list of slurs and threats plus link and contact-detail patterns; it is easy to evade on purpose and does not understand context, images of text or other languages. There is one operator secret, not moderator accounts with roles, no ban (only a time-limited mute from posting text), no appeal flow beyond Report a problem, and no operator screen — the operator uses the JSON routes. Venue chat is not stored, so a report about venue chat carries no evidence. Run a public server only if someone will actually read the reports.
- **Elections are not polls.** A device session is not a verified person. Sock-puppet voting is slowed, not prevented: a voter must have lived a Lagos day and been paid for work on two different days. More than three votes from one network address in an election are still counted by default and only flagged to the operator, because a mobile carrier, a school or a hostel puts many real voters behind one address; an operator can choose to refuse them instead (`VOTE_CAP_MODE=refuse`). Someone willing to play several sessions for two days can vote several times. Treat results as a game.
- **The top of the property ladder is out of reach of wages.** The balance simulation shows the next house and the cheapest car are reachable by working (see `npm run economy`). The fifth house (₦1,500,000 a week) and the dearer cars are not sustainable on any career's pay: their prices follow what was observed, and the income that reaches them in the reference game was never seen.
- **A house visit is presence and chat.** Guests join the host's home room and the house chat, and the host sees them at the door; guests do not see the host's room or furniture, and the browser offers no voice in a house visit.
- **The community panel and the social features use two sockets.** Venue chat, presence and voice live in the community panel; friends, messages and who-is-here in the Phone and Sim sheets.
- **The quick start, local governments and houses, the social, civic and growth features, tables and telemetry are Node-server only.** The Cloudflare adapter serves the core life, action and room protocol. It does not mark new sessions as guests of the quick start (its lives are offered character creation and never restricted), allocates no plots (it has no `/api/world/*` and no registry, so a life settled there keeps a local government and no address), and has no social, civic, growth, operator or telemetry routes, no `table-*` socket messages and no preview pages (`/s/<code>` serves the game's own page there, whose landing still reads the code). See [What the Worker does not have](#what-the-worker-does-not-have).
- **The first-day numbers are a mix.** Start cash, starting needs, goal rewards 1–4 and 6, the Danfo and trek costs, the ₦550 meal and Say Hello's effect match what was observed. The shift, the nap rate, skill gains, dream progress and need decay are original, so a session will not match the reference game number for number.
- **Workplaces and the Polling Unit close.** You can only travel to a venue during its opening hours; a gem hidden behind a closed door waits for opening time.
- **No audio.** There is no music or sound effect anywhere; club radio is text.
- **No real money, no uploads, no links.** Everything is paid in in-game naira; there is no top-up. Ads are text, a colour and an icon. Nothing a player types is ever rendered as a link.
- **Voice remains experimental.** Two browser sessions on loopback passed real bidirectional WebRTC transport with a generated tone, mute, leave, and near/mid/far proximity checks. Physical microphones and external networks remain untested. No TURN provider is configured yet, so restrictive networks may fail. The authenticated configuration endpoint supports an injected short-lived credential provider; it never embeds persistent provider secrets in the frontend.
- **Ibadan is a starter.** It has its own server-side life, election, ads and directory and its own venue names, but reuses the Lagos venue structure, map positions, regulars and activities. A proper city-pack format is not finalised.
- **E-mail is in dry-run until the operator configures it.** Without `ZEPTOMAIL_AUTH`, `EMAIL_FROM_ADDRESS` and `PUBLIC_ORIGIN` the digest is composed and shown as a preview and nothing is sent. With them set it has only been exercised against a fake provider in tests: a first real send must be watched (see SECURITY.md). Web push has been tested against the RFC 8291 vector and a fake push service, not yet on a physical phone.
- **Live table games are in memory.** A server restart ends the games in progress and records nothing for them. A table in the scene is a table (or a goal) and a name tag: nobody is drawn sitting at it, and the cards are in the Tables app.
- **A visitor joins the sharer only while the sharer is online in a public venue.** Otherwise the banner says where they are (at home: Knock; out, reconnecting or offline) and the visitor stays in the park. A table link opens that table for watching; sitting needs your Sim in the table's venue.
- **The first download is 444 kB minified (155 kB gzip), above the 380 kB aimed for.** The landing screen, the character editor, the "while you were away" card, the growth client and all telemetry beyond a 2 kB facade are fetched when needed; what remains is the rules engine and its content, which the browser needs to draw every view. Getting lower means a display-only build of the rules, which this build does not have.
- **"Free will", pets as companions, weather beyond rain, power cuts** and anything else not listed under What works today do not exist.
- **Node storage is one JSON file** on the server's disk, rewritten whole and not `fsync`ed. Actions share writes, a poll that produced no outcome does not wait for the disk, and writes are paced by a byte budget (see [Storage and limits](#storage-and-limits)). It will not carry thousands of concurrent players. While the disk cannot be written the game is effectively read-only: requests that would save something answer 503 and change nothing.
- **The Cloudflare adapter is behind the Node server.** The timed request ids, the support and social/civic routes, room re-checks against the stored life and the per-life random salt described below are implemented on the Node server. `deploy/` was not changed with them; do not treat the Worker as equivalent until its owner has ported them. The optional Cloudflare adapter uses SQLite Durable Objects; deployment configuration is included in `wrangler.jsonc`.

## The server's surface

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
| World | `GET /api/world/me` (your place: local government, plot; allocates the plot of a settled life) · `GET /api/world/city` · `GET /api/world/lga/:id` · `GET /api/world/lga/:id/estates` · `GET /api/world/lga/:id/estate/:estate/houses` · `GET /api/world/lga/:id/people` — all read-only; where you live is changed by game actions on `POST /api/action` (`estate.*`, and `onboarding.home { lga }` at settle-in) |
| Telemetry | `GET /api/telemetry/config` (what the browser may load: public keys only, or `{ enabled: false }`; creates no session, and reads the caller's only to add `under18: true`) · `POST /api/telemetry/consent` (`{ analytics }`: the player's Accept or Reject, kept in memory; an under-18 player's Accept is not kept) |
| Accounts | none (`/api/auth/*` is reserved and answers 404) |

WebSocket messages on `/socket` (`server/ws/`):

- Client → server, rooms: `join` (`{ cityId, venueId }`, or `{ cityId, venueId: 'home', hostId }` for an accepted guest), `move`, `voice-state`, `signal`, `chat`.
- Client → server, social: `dm-send`, `dm-read`, `people-list`, `friend-request`, `friend-answer`, `invite-knock`, `invite-answer`.
- World: no message types; the world module only counts open sockets per local government ("online now").
- Client → server, tables: `table-list`, `table-watch`, `table-unwatch`, `table-sit`, `table-options`, `table-start`, `table-move`, `table-leave`, `table-again` (server → client: `tables`, `table-state`, `tables-changed`).
- Server → client: `presence` (built per recipient: players you have blocked, or who blocked you, are left out), `chat`, `signal`, `error` (with a `reason` when the server has one — `text_blocked`, `muted`); `dm`, `dm-sent`, `dm-failed`, `dm-read-ok`, `people`, `people-changed`, `people-presence`, `people-interaction`, `friend-request`, `friend-accepted`, `friend-result`, `invite-knock`, `invite-answer`, `invite-result`, `invite-house`, `social-update`, `social-sync`, `transfer`.

Stored collections in the one data document (`devices.json` on Node): `sessions` (device sessions with their lives per city, action receipts and the receipts of gifts, interactions, groups and paid civic requests), `archivedLives`, `social` (players, conversations, houses, pending life effects, reports), `civic` (preferences and, per city, residents, elections and announcements, ads, hunt counters, radio queues), `moderation` (mutes and the audit trail) and `support` (problem reports). Only public ids are stored outside `sessions`. The growth features add one collection, `growth` (share links, referral records, consent, e-mail contacts and push subscriptions, table ratings and pending results, the outreach log and first-party metrics; its shape and every cap are in `server/growth/data.js`, `outreach.js` and `metrics.js`), and two key files outside the data file, in `DATA_DIR/keys/` with mode 0600 (`vapid.json`, `growth-signing.json`). The world layer keeps its registry beside the data file, in `DATA_DIR/world/`: one append-only shard file per local government (`lagos.<lga>`: which public id holds which plot, the name shown in the directory, the packed style of the house) and a small summary file; nothing else is stored there. A life itself holds its local government, its plot and its house (`estate`).

Pages outside `/api/` (`ctx.pages`, written by the host itself with fixed headers — no script may run, nothing may frame them, no cookie, no referrer — under the same per-address limit and telemetry hooks as the API): `GET /s/:code` (the link preview), `GET`/`POST /e/confirm` and `GET`/`POST /e/unsub` (the pages a link in an e-mail opens; only the POST does anything). Everything else outside `/api/` is a static file of the build; `*.map` answers 404; the game's own page is served with its default preview image made absolute from `PUBLIC_ORIGIN` (or the request's own host), because link-preview crawlers do not resolve a relative `og:image`.

**What is stored about one player.** In `sessions` (keyed by the cookie secret, which is stored nowhere else): the nickname, the public id, when the session expires, one life per city (cash, needs, the ledger, goals, missions, the look, traits and dream, the birth lottery, the **local government id**, the plot and the house's style and size, friends' ids, and so on — everything the rules engine keeps) and the receipts of recent requests. In `growth`, under the public id: the share links they made, who referred them and whom they referred, up to four salted hashes of device tokens, the **age answer** (`adult` or `minor`) with the two channel switches, an **optional e-mail address** (only after the consent box was ticked; deleted by unsubscribing, by "Delete my address", by an under-18 answer, or after 60 days unseen), **push subscriptions** (a browser vendor's endpoint and two keys; deleted by switching notifications off or when the push service says the subscription is gone), table ratings, and for 31 days a first-day / last-day / funnel-step record for the operator's cohort table. In `social`, `civic`, `moderation` and `support`: what those features need, by public id. In the world registry: the public id, the name and the house. In memory only, never on disk: the analytics choice the browser reported, live table games, and the per-address counters of the rate limits. Never stored: a position (the local government is worked out on the device), an IP address, voice audio, venue chat.

**Every environment variable.** The server reads: `PORT`, `DATA_DIR`, `SESSION_TTL_DAYS`, `TRUST_PROXY`, `MODERATOR_TOKEN`, `VOTES_PER_ADDRESS`, `VOTE_CAP_MODE`, `HEARTBEAT_SECONDS`, `STORE_WRITE_MB_PER_S`, `BUILD_ID`, `PUBLIC_ORIGIN` (the table under [Production build](#production-build)); for messages outside the game, and only through an allowlist (`ctx.env`): `ZEPTOMAIL_AUTH`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_CONTACT_LINE`, `EMAIL_DAILY_CAP`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DAILY_CAP`, `WHATSAPP_CHANNEL_URL`; for telemetry: `TELEMETRY_ENV`, `SENTRY_DSN_CLIENT`, `SENTRY_DSN_SERVER`, `POSTHOG_KEY`, `POSTHOG_HOST`, `TELEMETRY_DEBUG`, `TELEMETRY_CONSENT_AT`, `TELEMETRY_REPLAY_ON_ERROR`, `TELEMETRY_SLOW_MS` (the table under [Telemetry](#telemetry-off-unless-configured)). Build and tooling only, never read by a running server: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (`npm run sentry:sourcemaps`), `DEV_PORT` (`npm run dev`), `CAPTURE_PORT` (`scripts/telemetry-capture.mjs`). The Worker's own bindings (`TURN_KEY_ID`, `TURN_API_TOKEN`, `TURN_TEST_PUBLIC_IDS`, `ASSETS`, `JOINALLWORLD`) are in `wrangler.jsonc`. `STORE_MODE` is no longer used. An outside request (`ctx.fetch`: the mail provider, a browser's push service) must be HTTPS, never follows a redirect and is cut off after 15 seconds.

**Consent, in one place.** *E-mail*: an age answer of 18 or older, then an unticked box with the full sentence, then a confirmation e-mail whose link opens a page with a button (a GET confirms nothing). *Push*: the same age answer, the game's own explanation, then the browser's prompt. *Analytics*: one sheet with identical Accept and Reject buttons, shown after the first reward; Do Not Track, Global Privacy Control and an under-18 answer are a Reject. *Error reports* carry no personal data and are not asked about. The exact words are in [SECURITY.md](SECURITY.md).

**Stopping.** `close()`, `SIGINT` and `SIGTERM` follow one order: modules finish what they are sending (so a message is recorded as sent before the store closes and is never sent twice after a restart), the world registry and then the data file are written, and telemetry is flushed last.

### What the Worker does not have

`deploy/cloudflare-worker.js` serves the core routes (`/api/health`, `/api/session`, `/api/life`, `/api/action`, `/api/voice-config`) and the room protocol on `/socket`, with the same rules engine. It does **not** have: the quick start's guest sessions (`POST /api/session { onboarding: true }` is not marked there, so its lives are offered character creation and never restricted); `/api/world/*` and the plot registry (settling in with a local government works in the rules, but no plot is allocated and nothing is listed); `/api/social/*` including the invite landing `POST /api/social/join`; `/api/civic/*`; `/api/support/*`; `/api/growth/*`, the pages `/s/:code` and `/e/*`, e-mail and push; `/api/mod/*`; `/api/telemetry/*` (the page is told nothing, so telemetry stays off); the `table-*`, social and world socket modules; the absolute preview image (its static page keeps the site-relative `/og/allworld.jpg`); and the one shutdown order. Its owner must port each before the Worker can be called equivalent; until then a share link opened on the Worker lands on the game's own page, whose landing still reads `join`, `ref` and `table` from the address but has no route to answer them.


### Storage and limits

How the Node store writes (`server/store.js`) — there is one store with one set of rules:

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
| Gift, player interaction, new group, problem report (`clientId`); shout-out, ad rental, standing for Governor (`requestId`) | `<unix ms>:<uuid>`, mandatory — 400 without it | Same rules through one helper (`server/routes/once.js`): once per id, 409 on changed contents, 409 `client_id_expired` after 24 h, receipt kept in the player's session for those 24 h and never evicted before. **2,000** unexpired receipts per player (then 429) and **200,000** on the server (then 503), both refused *before* anything is charged, with "try again later" |
| Vote | none | One per player per election: the ballot is the record, written in the same transaction |
| Friend request, knock, Bae, block | none | Repeating one is answered from the stored state and changes nothing |
| Message (`clientId`, any 8–80 character key) | the message itself | Stored once per id while it is among the conversation's last 200 messages; a replay is answered only to someone still in the conversation |

A route module that runs one game action for the caller can use `ctx.command` (`server/routes/core.js`): session check, settlement, action, an optional same-transaction side write and the receipt are saved together or not at all, and the authority and scope it ran with are part of the receipt, so the id cannot be replayed as an ordinary player action.

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

`npm run economy` plays one scripted life per start and strategy through the real rules engine on a virtual clock. A start is a birth-lottery outcome and a home: **`own`** — the start the game offers a new player, the free starter house in the local government picked at settle-in, with no weekly rent — and every rented home that outcome may choose (the Houses app's alternative, and what the game offered before). Fourteen starts × seven strategies (idle, helper only, career, gigs at equal effort, gigs all day, the best mix, and `social`, which pushes missions, table wins and referrals to their caps). It prints net worth on days 1, 3, 7, 14 and 30, income by source, costs by kind, the first promotion, whether rent was paid every Saturday, and the day the next house (for an owner: the first upgrade of their own house) and the cheapest car first became affordable. `src/game/economy.test.js` runs it under `npm test` and asserts the design intent: no money from nothing, every repeatable source capped per day, a diligent career player solvent on every start, gigs never ahead of a career at equal effort, an idle or broke player always able to eat, wash, rest and earn for free, the next house and the first car reachable on a sane timescale, and the starter job alone never a way to a car.

Taking the weekly rent out of the start changed one result, and one original beta value was changed for it. With no rent, an Ajebutter on the ₦230,000 start its Mushin home has could buy the cheapest car in 129 days on the starter job alone (the assertion is "not within 150"); the own-house start of that outcome is ₦200,000, which makes it 163 days. Every other value is as it was:

| Start cash in the own starter house (`ownCash`, original beta) | Value | Same outcome in rented Mushin |
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
| `src/venue-world.js` | Three.js host for venue and home scenes: walking, the orbit camera, sight lines, spot markers, other players' positions and name tags. Draws only while something moves; idle is zero frames |
| `src/scene/` | Procedural geometry: `venue-scenes.js` (one scene per venue kind), `venues-*.js`, `home-scene.js`, `characters.js` (avatars), `avatar-preview.js` (the creator's turning figure), `avatar-rig.js` (detail level and walk cycle, feature-detected), `crowd.js` (who stands in a scene, from real data), `movement.js` (walk grid, paths, avoidance, position reports), `camera-controls.js`, `camera-collision.js`, `controls.js` (on-screen pad and hint), `motion-loop.js`, `props.js`, `build.js`, `kit.js` |
| `src/map3d/` | The 3D miniature city map: `regions.js` (countries and cities), `cities/` (one data pack per city), `roads.js`, `city-build.js`, `landmarks.js`, `camera.js`, `labels.js`, `overlays.js`, `trip.js`, `actor.js`, `vehicles.js` |
| `src/ui/phone/` | The Phone device, its notification logic, wallpapers, and the drawn glyph set (`icons.js` at first paint, `icons-more.js` with the apps); `src/ui/icon-map.js` maps game content to glyphs |
| `src/game/social-model.js` | Pure client-side model for messages (outbox, retry) and presence wording |
| `src/world-map.js`, `src/city-map.js` | The door to the atlas for the host; the flat in-city map used where WebGL is not available |
| `src/map3d/geo/` | The atlas (world → Africa → Nigeria): `atlas.js` (the view), `build.js` (plates, ribbons, dots), `projection.js` (Equal Earth), `topo.js` (the compact data form), `pick.js`, `levels.js`, `labels.js`, `routes.js`, `info.js`, and `data/` (one generated module per level) |
| `src/community.js` | Room presence, chat and voice |
| `server/server.js` | Node host: HTTP and WebSocket plumbing, static files, server context |
| `server/routes/` | HTTP endpoints. `index.js` is the route registry — **the contract for adding a route**; `core.js` holds session (including the flag that starts a life as a guest of the quick start), life, action and voice-config; `social.js` and `civic.js` are thin adapters; `once.js` is the shared receipt helper (not a route module) |
| `server/ws/` | WebSocket message types. `index.js` is the registry; `rooms.js` holds presence, movement, chat, voice state, signalling and the guest rule for Home rooms; `social.js` the social messages |
| `server/social/`, `server/civic/` | The player-to-player rules (friends, messages, houses, gifts, reports, presence) and the shared city rules (elections, ads, radio, residents) |
| `server/protocol.js`, `server/life-service.js` | Validation, idempotency and settlement logic, free of I/O and shared with the Cloudflare adapter |
| `server/moderation/` | `terms.js` (the one list of blocked terms), `text.js` (the text filter), `service.js` (mutes and the audit trail) |
| `server/support/`, `server/routes/support.js` | Problem reports with automatic context, and the server's wallet statement |
| `server/routes/moderation.js` | The operator routes behind `MODERATOR_TOKEN` |
| `server/store.js` | JSON file store behind a two-method `transact`/`read` interface: copy-on-touch transactions, shared durable writes that are undone if they fail, lazy polls, frozen stored state, a write budget |
| `server/routes/once.js` | The exactly-once helper behind `ctx.once`, `ctx.act` and `POST /api/action`: mandatory timed ids, conflicts, expiry, quotas without eviction |
| `src/lazy-load.js` | Loads a late chunk (the community panel) with a truthful state and bounded retries |
| `src/telemetry/` | Error monitoring and product analytics, off unless configured. `index.js` is the facade (the only part in the first download); `core.js` (consent, queues, funnel), `sentry.js` / `posthog.js` (the only files that import an SDK), `consent-ui.js` and `what-we-collect.js` (the sheet and its words) are lazy chunks; `events.js` is the event catalogue; `scrub.js`, `clean.js`, `policy.js`, `funnel.js` are the pure rules, shared with the server |
| `server/telemetry/` | The server side: `config.js` (environment), `transport.js` (bounded queue, `fetch` to PostHog's batch API and Sentry's envelope endpoint), `instrument.js` (what routes, socket replies and room snapshots mean as events), `routes.js` (`/api/telemetry/*`) |
| `scripts/sentry-sourcemaps.mjs`, `scripts/telemetry-capture.mjs` | Source-map upload (`npm run sentry:sourcemaps`); a local stand-in for both services that records what would be sent |
| `server/auth.js`, `server/routes/auth.js` | Inert placeholders for accounts; device sessions remain the only identity |
| `src/game/systems/missions.js`, `events.js`, `growth.js`, `src/game/content/missions.js`, `calendar.js`, `growth.js` | Missions and the stamp card; event attendance and spraying; the server-only credits for table wins and referral gifts. Content is plain data |
| `src/game/calendar.js`, `digest.js`, `outreach.js`, `share-model.js` | Pure functions shared by server and client: what is on when; the away card and the weekly digest; when a message may be sent, the address check and the consent wording; what a share says |
| `src/tables/` | Table games. `rules.js` is **the contract for adding a game**; `whot.js`, `penalty.js` are pure rules; `places.js` says where tables stand; `client.js` and `*-board.js` are the browser side |
| `server/growth/`, `server/routes/growth.js`, `growth-mod.js`, `server/ws/tables.js` | Share links and the preview page, referral, metrics, the table service, outreach (e-mail through `email/zeptomail.js`, web push in `webpush.js`); their routes, operator routes and socket messages |
| `src/ui/panels/missions.js`, `events.js`, `refer.js`, `touch.js`, `tables.js`, `away-chip.js`, `tables-chip.js`, `growth-client.js`, `src/ui/share.js`, `push-client.js` | The growth apps and chips, the share painter and the push subscription |
| `public/` | `og/allworld.jpg` (link-preview image), `manifest.webmanifest`, `icons/`, `sw.js` (notifications only) |
| `scripts/first-day.mjs` | The scripted first day (`npm run first-day`), also run by `server/first-day.test.js` |
| `scripts/first-minute.mjs` | The scripted first minute (`npm run first-minute`), also run by `server/first-minute.test.js` |
| `src/quick-start/` | The first minute's client logic. In the first download: `model.js` (pure: the landing of a link — `joinIdFrom`, `linkParts`, the banner words — when to offer settling in, the funnel) and `entry.js` (what the device keeps, the one place a link is read, the device token, and the funnel events). Fetched with the landing screen: `look-model.js` (pure: name suggestions, presets, starter looks, the draft) and `draft.js` |
| `scripts/new-player.mjs` | The new-player journey (`npm run new-player`), also run by `server/new-player.test.js` |
| `scripts/world-load.mjs` | The world layer's load test (`npm run world-load`) |
| `server/world/`, `server/routes/world.js`, `server/ws/world.js` | The plot registry: one append-only shard per local government (`shards.js`, `registry.js`), the service that keeps it in step with the lives and allocates plots (`service.js`), the read-only routes, and the online count per local government |
| `src/game/systems/estate.js`, `src/game/content/world.js` | Where a life lives: its local government, its plot, its house (style, tier, upgrades, ground rent), living in it or renting; the twenty local governments, land prices and the estate grid |
| `src/ui/panels/lga-card.js`, `world-panels.js`, `src/map3d/` | The local-government card (and its section of the settle-in Home card), the local-government page and house card, and the 3D city map that draws estates and houses |
| `scripts/two-players.mjs` | The scripted two players (`npm run two-players`), also run by `server/two-players.test.js` |
| `scripts/economy-sim.mjs` | The balance simulation (`npm run economy`); its assertions are `src/game/economy.test.js` |
| `scripts/load.mjs` | The local load test (`npm run load`) |
| `**/*.test.js`, `server/test-fixture.js` | `node --test` suites (one per owner under `src/game/`, plus `integration.test.js` for the seams between them) and the shared server fixture |

The only registered placeholders left are the accounts files (`server/auth.js`, `server/routes/auth.js`, `src/ui/panels/account.js`): they mark where a reviewed accounts design would live, not that one exists. [What works today](#what-works-today) is the list of working features.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT), and — downloaded by a browser only when telemetry is configured — [@sentry/browser](https://github.com/getsentry/sentry-javascript) (MIT) and [posthog-js](https://github.com/PostHog/posthog-js) (Apache-2.0 and MIT). The server sends telemetry with `fetch` and has no SDK. All scene and city-map geometry is written in code.

### Map data credits

The boundaries of the world, Africa and Nigeria's states, the Niger and Benue rivers, Lake Chad and the Kainji reservoir, and the positions of capitals come from [Natural Earth](https://www.naturalearthdata.com/) — public domain ("No permission is needed to use Natural Earth"). Files used, from the `geojson` folder of [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector): `ne_50m_admin_0_countries`, `ne_10m_admin_1_states_provinces` (the 37 Nigerian units), `ne_10m_rivers_lake_centerlines`, `ne_10m_lakes` and `ne_10m_populated_places_simple`. They were simplified (Visvalingam–Whyatt on shared borders, so neighbours still meet exactly), quantised and stored as three small modules under `src/map3d/geo/data/`; each records its tolerance in its header. Borders are Natural Earth's default view and imply no position on any dispute. Roads and flight lines on the map are stylised: lists of real towns joined by straight lines, written from general knowledge. Nothing is fetched from a map service at run time. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.
