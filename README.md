# Allworld

An open-source, lightweight browser city-life game. You pick a city on a world map, move between venues, and spend time on activities that change your cash and needs. Lagos is the first city; Ibadan is the second, and cities are meant to become reusable packs rather than one-off builds.

Allworld (this repository, `joinallworld`) is original work built in a new repository. No files were copied from the earlier Allworld v1 project, and no assets or code were extracted from any reference game.

**Status: early beta, incomplete.** Read [What works today](#what-works-today) and [What does not work yet](#what-does-not-work-yet) before assuming a feature exists.

## Run

Requires Node.js `>=22.12.0`.

```sh
npm install
npm test            # rules engine, scenes, client model and Node server suites
npm run first-day   # one scripted new life, start to Saturday rent, with a transcript
npm run two-players # two scripted players: presence, messages, a house visit, a gift, an election
npm run economy     # scripted lives under six strategies, played through the rules engine: the balance table
npm run load        # N simulated players against an in-process server: latency and file writes
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

The server does not terminate TLS. Read [SECURITY.md](SECURITY.md) before exposing it to anyone.

### Without the server

The client still loads if the server is unreachable, but it is **read-only**: it shows the last state cached in the browser, and no action, travel or city switch is applied. There is no offline play and nothing is granted locally. Use the retry control once the server is back.

## What works today

Each item says whether it follows behaviour observed in a public Lagos city-life game or is an original beta design. "Observed" means a name, price, duration or sequence was seen; it never means the mechanics behind it are known.

- **The screen.** The 3D scene is the centre of the screen. Always on top of it are one top bar (Lagos time, mood, your name, whether your progress is saved — or **Offline · Reconnect**, or **Not saving** with the server's own reason while it reports that it cannot write its data file — and your wallet, which opens the Bank), the six needs as a slim strip of bars, and one goal line. Everything else that used to sit on the scene — weather, your home, the gem hunt, messages, the city switch, "Use my location", Community and help — is behind the **More** button, which carries a badge counting the chips that have something new; something that needs an answer now (a knock at the door, a roadside choice) shows as an alert above the goal line instead. **Clean screen** (the eye, or X) hides all of it except the top bar and the bottom nav. The bottom nav is Home, Buy, Map and Phone; above it the venue panel lists the spots of the place you are in and, once a spot is picked, its activities as cards that say what they cost, give and — when they cannot be started — the one reason why. A trip replaces that panel with a travel view (from, to, how, time left, and what cancelling forfeits: the fare actually paid). Feedback is a toast under the HUD, never more than two at once; a wallet change flashes with its reason. For the first three starter goals a coach line names the next control and can be dismissed for good. Keyboard shortcuts cover the nav, the spots, the activity list, Clean screen, the map and Buy mode (press `?` for the list). Phone apps and Sim tabs are downloaded the first time one is opened. Checked at 390 × 844 and at 1280 × 800. *Original:* the whole layout.
- **Character creation.** Look, two traits, a dream, a birth lottery and a starting home, each step confirmed by the server. A new life opened by this client must finish it before anything else is accepted, and the screen cannot be dismissed until then. Lives saved before character creation existed are never asked. *Observed:* the five steps, the option names, one lottery outcome (a ₦60,000 loan repaid at ₦12,000 a week, start cash ₦96,000 in Yaba or ₦76,000 in Mushin) and the starting needs. *Original:* the other three lottery outcomes and their odds, and every trait strength.
- **Starter goals, wishes, stars, perks and a lifetime dream.** Seven starter goals pay cash and a star once each; after them the goal chip becomes a rolling next step. *Observed:* goal titles, the rewards of goals 1–4 and 6, the first three wishes, the first eight perks. *Original:* the rewards of goals 5 and 7, the rest of the wish and perk lists, dream progress formulas and the dream reward. "Make a new friend" completes when you greet one of a venue's regulars or make a friend.
- **A home you furnish.** A grid room sized by the house, Buy mode with nine category tabs, placement with a ghost, move, store and sell, a shared kitchen with ingredients, eleven recipes and a Groceries app. *Observed:* six Comfort items, recipe names and durations, starting ingredients. *Original:* every other price, what star ratings do, grocery prices, the rule that ingredients are used only when a meal finishes.
- **A city to move around.** 22 venues and your home (each with two regulars) on an in-city map with opening hours, a venue card with five travel modes (Danfo selected by default), fares charged at departure, per-mode trip times, roadside events, weather and illness. *Observed:* the venue list, two fare bands, the trek's need cost, one roadside event, one opening time. *Original:* nearly every activity's numbers, all trip times, the cross-lagoon fare band, opening hours, the other roadside events, weather and how illness is caught and cured.
- **Careers.** Fourteen tracks, each with a six-level ladder, a workplace on the map and one paid shift per Lagos day; "Go automatically" commutes to the work spot when the workplace is open. Jobs and Career show the workplace's opening hours with the same label the map uses. *Observed:* entry roles and entry pay, the five-day Tech week, 50% starting performance. *Original:* the whole shift design — the reference shift was never seen — plus pay above entry level, promotion gates and work days. The older Community helper job still works for existing saves, limited to one ₦300 shift every four hours (original).
- **Money.** Weekly rent and the loan instalment are collected on Saturdays (Lagos time) even while you are away, each exactly once, each with a ledger line; missed rent becomes arrears with a late fee. Houses, cars and fixed deposits can be bought in Phone apps. *Observed:* rents, the loan figures, house and car price points. *Original:* how bills are collected, arrears, deposits, fuel costs.
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

Two device sessions, each with a room socket and a social socket, against the same in-process server and controlled clock: both create a Sim; they see each other at Freedom Park and stop seeing each other the moment one leaves; friend request and accept; a message retried and stored once; a knock, a let-in, the host's home room and house chat, and the end of the visit; a shift's wages and a gift a day later; a declaration for Governor on Monday (refused until the candidate has been paid for work on two different days), a vote at the Polling Unit on Thursday, the winner's announcement in the other player's Updates on Sunday; a sea plot in the public listing; and the gem hunt paid once. It finishes by checking that no cookie secret reached the other player or the social and civic collections. Also part of `npm test`.

## What does not work yet

- **No accounts.** No passwords, sign-in, recovery email or moving a life between devices. An accounts design exists as a separate, unmerged proposal; `server/auth.js` and `server/routes/auth.js` are inert placeholders and Settings has no account section.
- **Moderation is basic.** The text filter is a short list of slurs and threats plus link and contact-detail patterns; it is easy to evade on purpose and does not understand context, images of text or other languages. There is one operator secret, not moderator accounts with roles, no ban (only a time-limited mute from posting text), no appeal flow beyond Report a problem, and no operator screen — the operator uses the JSON routes. Venue chat is not stored, so a report about venue chat carries no evidence. Run a public server only if someone will actually read the reports.
- **Elections are not polls.** A device session is not a verified person. Sock-puppet voting is slowed, not prevented: a voter must have lived a Lagos day and been paid for work on two different days. More than three votes from one network address in an election are still counted by default and only flagged to the operator, because a mobile carrier, a school or a hostel puts many real voters behind one address; an operator can choose to refuse them instead (`VOTE_CAP_MODE=refuse`). Someone willing to play several sessions for two days can vote several times. Treat results as a game.
- **The top of the property ladder is out of reach of wages.** The balance simulation shows the next house and the cheapest car are reachable by working (see `npm run economy`). The fifth house (₦1,500,000 a week) and the dearer cars are not sustainable on any career's pay: their prices follow what was observed, and the income that reaches them in the reference game was never seen.
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
- **Node storage is one JSON file** on the server's disk, rewritten whole and not `fsync`ed. Actions share writes, a poll that produced no outcome does not wait for the disk, and writes are paced by a byte budget (see [Storage and limits](#storage-and-limits)). It will not carry thousands of concurrent players. While the disk cannot be written the game is effectively read-only: requests that would save something answer 503 and change nothing.
- **The Cloudflare adapter is behind the Node server.** The timed request ids, the support and social/civic routes, room re-checks against the stored life and the per-life random salt described below are implemented on the Node server. `deploy/` was not changed with them; do not treat the Worker as equivalent until its owner has ported them. The optional Cloudflare adapter uses SQLite Durable Objects; deployment configuration is included in `wrangler.jsonc`.

## The server's surface

HTTP routes (all under the per-address rate limit, and all except `/api/mod/*` under the same-origin check; `server/routes/`). A refusal may carry a `reason` sentence beside its `error` code:

| Area | Routes |
| --- | --- |
| Core | `GET /api/health` (which build is serving; reads and creates no session) · `POST /api/session` · `GET /api/session` · `GET /api/life` · `POST /api/action` · `GET /api/voice-config` |
| Social | `GET /api/social/me` · `POST /api/social/updates/read` · `GET /api/social/people` · `GET /api/social/search` · `GET /api/social/players/:id` · `POST /api/social/players/:id/interact` · `POST /api/social/friends/request` · `POST /api/social/friends/answer` · `POST /api/social/friends/remove` · `POST /api/social/block` · `POST /api/social/unblock` · `POST /api/social/reports` · `GET /api/social/conversations` · `GET /api/social/conversations/:id` · `POST /api/social/conversations/:id/read` · `POST /api/social/messages` · `POST /api/social/groups` · `POST /api/social/groups/:id` · `GET /api/social/house/:host` · `POST /api/social/house/knock` · `POST /api/social/house/answer` · `POST /api/social/house/leave` · `POST /api/social/bae/ask` · `POST /api/social/bae/answer` · `POST /api/social/bae/end` · `POST /api/social/transfers` |
| Civic | `GET /api/civic/pulse` · `GET /api/civic/gov` · `POST /api/civic/gov/run` · `POST /api/civic/gov/vote` · `POST /api/civic/gov/announce` · `GET /api/civic/neighbours` · `GET /api/civic/ads` · `POST /api/civic/ads/rent` · `POST /api/civic/ads/remove` · `GET /api/civic/hunt` · `GET /api/civic/radio` · `POST /api/civic/radio/shoutout` · `GET /api/civic/richlist` · `POST /api/civic/prefs` |
| Support | `POST /api/support/reports` · `GET /api/support/reports` · `GET /api/support/statement` |
| Operator | `GET /api/mod/overview` · `GET /api/mod/reports` · `GET /api/mod/problems` · `GET /api/mod/mutes` · `GET /api/mod/content` · `GET /api/mod/audit` · `POST /api/mod/reports/:id/dismiss` · `POST /api/mod/problems/:id/status` · `POST /api/mod/mutes` · `POST /api/mod/mutes/:id/lift` · `POST /api/mod/content/remove` — bearer token only, 404 unless `MODERATOR_TOKEN` is set |
| Accounts | none (`/api/auth/*` is reserved and answers 404) |

WebSocket messages on `/socket` (`server/ws/`):

- Client → server, rooms: `join` (`{ cityId, venueId }`, or `{ cityId, venueId: 'home', hostId }` for an accepted guest), `move`, `voice-state`, `signal`, `chat`.
- Client → server, social: `dm-send`, `dm-read`, `people-list`, `friend-request`, `friend-answer`, `invite-knock`, `invite-answer`.
- Server → client: `presence` (built per recipient: players you have blocked, or who blocked you, are left out), `chat`, `signal`, `error` (with a `reason` when the server has one — `text_blocked`, `muted`); `dm`, `dm-sent`, `dm-failed`, `dm-read-ok`, `people`, `people-changed`, `people-presence`, `people-interaction`, `friend-request`, `friend-accepted`, `friend-result`, `invite-knock`, `invite-answer`, `invite-result`, `invite-house`, `social-update`, `social-sync`, `transfer`.

Stored collections in the one data document (`devices.json` on Node): `sessions` (device sessions with their lives per city, action receipts and the receipts of gifts, interactions, groups and paid civic requests), `archivedLives`, `social` (players, conversations, houses, pending life effects, reports), `civic` (preferences and, per city, residents, elections and announcements, ads, hunt counters, radio queues), `moderation` (mutes and the audit trail) and `support` (problem reports). Only public ids are stored outside `sessions`.

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
| Archived lives | one per expired session **that had a life**; a session that never finished character creation is deleted, not archived. Lived lives are never deleted automatically, so this grows with the number of players who ever played |
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

`npm run economy` plays one scripted life per start (every birth-lottery outcome and every home it may choose) and strategy, through the real rules engine on a virtual clock, and prints net worth on days 1, 3, 7, 14 and 30, income by source, costs by kind, the first promotion, whether rent was paid every Saturday, and the day the next house and the cheapest car first became affordable. `src/game/economy.test.js` runs it under `npm test` and asserts the design intent: no money from nothing, every repeatable source capped per day, a diligent career player solvent on every start, gigs never ahead of a career at equal effort, an idle or broke player always able to eat, wash, rest and earn for free, upgrades reachable, nothing overflowing. The numbers are a property of this build's original beta values, not a measurement of any other game.

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
| `server/routes/` | HTTP endpoints. `index.js` is the route registry — **the contract for adding a route**; `core.js` holds session (including the flag that enforces character creation), life, action and voice-config; `social.js` and `civic.js` are thin adapters; `once.js` is the shared receipt helper (not a route module) |
| `server/ws/` | WebSocket message types. `index.js` is the registry; `rooms.js` holds presence, movement, chat, voice state, signalling and the guest rule for Home rooms; `social.js` the social messages |
| `server/social/`, `server/civic/` | The player-to-player rules (friends, messages, houses, gifts, reports, presence) and the shared city rules (elections, ads, radio, residents) |
| `server/protocol.js`, `server/life-service.js` | Validation, idempotency and settlement logic, free of I/O and shared with the Cloudflare adapter |
| `server/moderation/` | `terms.js` (the one list of blocked terms), `text.js` (the text filter), `service.js` (mutes and the audit trail) |
| `server/support/`, `server/routes/support.js` | Problem reports with automatic context, and the server's wallet statement |
| `server/routes/moderation.js` | The operator routes behind `MODERATOR_TOKEN` |
| `server/store.js` | JSON file store behind a two-method `transact`/`read` interface: copy-on-touch transactions, shared durable writes that are undone if they fail, lazy polls, frozen stored state, a write budget |
| `server/routes/once.js` | The exactly-once helper behind `ctx.once`, `ctx.act` and `POST /api/action`: mandatory timed ids, conflicts, expiry, quotas without eviction |
| `src/lazy-load.js` | Loads a late chunk (the community panel) with a truthful state and bounded retries |
| `server/auth.js`, `server/routes/auth.js` | Inert placeholders for accounts; device sessions remain the only identity |
| `scripts/first-day.mjs` | The scripted first day (`npm run first-day`), also run by `server/first-day.test.js` |
| `scripts/two-players.mjs` | The scripted two players (`npm run two-players`), also run by `server/two-players.test.js` |
| `scripts/economy-sim.mjs` | The balance simulation (`npm run economy`); its assertions are `src/game/economy.test.js` |
| `scripts/load.mjs` | The local load test (`npm run load`) |
| `**/*.test.js`, `server/test-fixture.js` | `node --test` suites (one per owner under `src/game/`, plus `integration.test.js` for the seams between them) and the shared server fixture |

The only registered placeholders left are the accounts files (`server/auth.js`, `server/routes/auth.js`, `src/ui/panels/account.js`): they mark where a reviewed accounts design would live, not that one exists. [What works today](#what-works-today) is the list of working features.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Licence

MIT — see [LICENSE](LICENSE).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT). All scene and map geometry is written in code. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.
