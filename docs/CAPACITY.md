# Capacity

How many players one server takes, what stops it, what a player sees when it is full, and what comes after. The numbers
were measured on one machine with `npm run capacity`; they compare builds and find what grows with player count. They are
not a promise about production.

## The shape of the server

Every request and every socket of every player is handled by one single-threaded host: one Node process, or in
production one Cloudflare Durable Object with SQLite storage (`deploy/`). There is one copy of the world, so nothing has
to be kept in step between servers, and one thread, so one slow request delays everybody.

Three things grow with players, and they are different numbers:

| What grows | With | Typical size |
| --- | --- | --- |
| Open sockets, room member lists, heartbeat answers | players **connected now** | 2 sockets a page |
| Session rows, receipts, archived lives | devices that played in the last **30 days** | 6 KB a young life, more with history |
| The `social`, `civic` and `growth` collections | players who came by in the last **45–60 days** | `social`: 1.3–1.9 KB a player before long conversations |

The last line is the one that binds first. Each of those collections is ONE JSON value: on the Worker host a request that
touches it reads it whole, parses it, and (unless it only read) turns it back into text to see what changed. The cost of
one social or civic request is therefore in proportion to everyone who came by in the last weeks, not to who is online.

## The caps

Five numbers, the same on both hosts (`server/host-context.ts` `capacityConfig`). Four are settings: an environment
variable on Node, a variable or secret of the Worker. A value that is not a whole number inside its bounds is ignored
with one log line.

| Setting | Default | Bounds | Counts | At the cap |
| --- | --- | --- | --- | --- |
| `MAX_ACTIVE_SESSIONS` | 10,000 | 1 – 5,000,000 | stored device sessions (every device that played within a session lifetime, connected or not) | A **new** visitor's start is answered `503 device_capacity` with a sentence and `Retry-After: 30`. The landing screen says "The world is full right now…", keeps the name and character on the device, and sends the start again by itself after about 10, 20, 40 and then every 60 seconds. Anyone who already has a session is unaffected. A session that ran out frees its place the next time one is asked for |
| `MAX_SOCKETS` | 4,000 | 2 – 32,000 | open sockets in all (2,000 open pages) | The new socket is opened and closed at once with code `1013` and the reason `socket_capacity`. The room panel says the world is busy and tries again after about 5, 10, 20 and then every 30 seconds for as long as it takes. The game itself (polls and actions) goes on. Nobody connected is dropped |
| `SOCKETS_PER_ADDRESS` | 32 | 2 – 32,000 | open sockets of one network address (IPv6: one /64). Node does not count private and loopback addresses | Refused outright (Node: 403; Worker: `503 socket_capacity`). The page shows "Disconnected" and retries with its ordinary back-off |
| `NEW_SESSIONS_PER_ADDRESS` | 300 | 1 – 100,000 | new sessions one network address made in the last hour (IPv6: one /64). Node does not count private and loopback addresses | A **new** visitor's start is answered `429 rate_limited` with a sentence, `retryAfter` (seconds left of the hour) and a `Retry-After` header. The landing screen says that too many new players started from this network, that a shared Wi-Fi or mobile network counts as one, how many minutes to wait, and that nothing is lost; it tries again by itself when the wait is over. Anyone who already has a session is unaffected |
| — | 8 | fixed | open sockets of one session | Refused outright, as above |

`GET /api/mod/overview` shows how full the host is: `capacity.sessions { held, most }`, `capacity.sockets { open, most }`
and `store.collections` (JSON characters stored per collection).

**Why 300 new sessions an hour and not fewer.** The limit exists so that one address cannot take every place: at 300 an
hour it still needs more than a day to fill the default 10,000. But one address is often many people. A campus network
and a mobile carrier both put hundreds or thousands of users behind one public address, and a link shared in a lecture
hall or a class group brings them in the same few minutes; 60 an hour turned the sixty-first of them away for up to an
hour. If a launch at one campus is planned, raise it for that day; if abuse from one address is seen, lower it.

**Do not raise `MAX_ACTIVE_SESSIONS` on the Worker host before the collections are stored per entry** (see
[What comes next](#what-comes-next)). Sessions are rows and could be many more; the collections that grow with them cannot.

## Every other limit

| Area | Limit | Where | What a player sees |
| --- | --- | --- | --- |
| Session lifetime | 30 days from last use (Node: `SESSION_TTL_DAYS`); a signed-in device at most 90 days | `server/protocol.ts` | the "Saved life not found" notice; a lived life is archived, not deleted |
| Requests | Node: 600 a minute per address. Worker: 600 a minute per session, 60 a minute per address without one, 600 a minute per address for pages | hosts | 429 `rate_limited` |
| Request body | 8,192 bytes; an action's payload 2,048 | hosts, `server/protocol.ts` | 413 / 400 |
| Socket | 16,384 bytes a frame; 600 frames a minute per player; 60 upgrades a minute per address; 5 moves a second | hosts, `server/ws/rooms.ts` | an `error` frame (Node closes the socket on the frame limit) |
| What a socket carries through a sleep (Worker) | 2,000 bytes | `deploy/cloudflare-worker.ts` | the look and the last moves are left out |
| Room | **no limit on members**; 8 in voice; chat 500 characters, 30 lines a minute; a signal 12,000 characters | `server/ws/rooms.ts` | `voice_room_full`, `rate_limited` |
| Home | 5 guests; a knock waits 60 s; a visit lasts 30 minutes | `server/social/service.ts` | a sentence |
| Social | 200 friends, 30 pending requests, 200 blocks, 100 conversations, 20 groups of 12, 200 messages a conversation, 50 updates, 50 pending gifts and effects, 2,000 reports; 240 requests a minute; forgotten after 45 idle days | `server/social/service.ts` `LIMITS` | a sentence naming the limit |
| Live location | a tick every 250 ms; 200 players read per tick; 200 friends per watcher; 30 `live-watch` a minute | `server/social/live.ts` `LIVE` | later frames |
| Calls | 8 a minute per caller, 3 per pair; 200 candidates a call | `server/social/calls.ts` | `rate_limited` |
| Receipts | 10,000 action receipts per session per 24 h; 2,000 per player and 200,000 in all for other exactly-once writes (twice: money and interactions) | `server/routes/once.ts` | 429 `receipt_quota`, 503 `receipts_full`, both before anything is charged |
| Rate-limit keys | 10,000 short, 10,000 long, 20,000 protected | `server/limiter.ts` | none: a full table forgets the keys that expire soonest (protected keys are refused instead) |
| Growth | 50,000 players, 20,000 share links, 20 links a day; 500 e-mails a day (`EMAIL_DAILY_CAP`), 5,000 notifications a day (`PUSH_DAILY_CAP`) | `server/growth/data.ts`, `outreach.ts` | the message is not sent that day |
| Civic | 20 announcements, 12 billboards, 256 sea plots, 30 candidates, 20 shout-outs a club | `server/civic/` | a sentence |
| Moderation, support | 1,000 audit lines, 5,000 mutes; 2,000 problem reports, 5 open per player | `server/moderation/`, `server/support/` | a sentence |
| Room voice relay test (Worker) | 8 credentials a day, two nominated players | `deploy/turn-provider.ts` | `relay_test_limit` |
| Call relay (both hosts) | 30 credentials per player a day, 120 per address an hour, 3000 a day in all (`CALL_RELAY_*`) | `server/call-relay.ts` | the call carries on with STUN only (`relay: limited`) |
| Storage (Worker) | a collection is split into rows of 400,000 characters; a lazy change is written within 10 minutes | `deploy/sqlite-store.ts` | none |
| Storage (Node) | one file, written whole; 50 MB a second (`STORE_WRITE_MB_PER_S`) | `server/store.ts` | slower answers to actions as the file grows |

## What one open page asks for

Measured from the real page in a headless browser, three minutes at rest:

- 4 HTTP requests a minute: `GET /api/world/pulse` twice, `GET /api/life` once, `GET /api/civic/pulse` once;
- 2 sockets; on the Worker host each answers the heartbeat every 10 s: 12 frames a minute to the host, 12 from it.

So one connected player-hour at rest is about 240 requests and 720 heartbeat answers, plus the rows it writes (about 6
an hour; an action writes 3). A player as busy as the test's (an action every 30 s, a step every 10 s, a chat line and a
look at the phone every two minutes) wrote about 530 rows an hour.

### What that costs on the platform

From the platform's documentation as understood when this was written. **Check the current pricing and limits pages
before relying on any of it.**

| Item | Included in the paid plan | Beyond it |
| --- | --- | --- |
| Worker requests | 10 million a month | $0.30 a million |
| Durable Object requests (20 incoming socket frames count as one) | 1 million a month | $0.15 a million |
| Durable Object duration (128 MB for as long as the object is in memory) | 400,000 GB-s a month | $12.50 a million GB-s |
| SQLite rows written | 50 million a month | $1.00 a million |
| SQLite rows read | 25 billion a month | $0.001 a million |
| SQLite storage | 5 GB | $0.20 a GB-month |

- **Duration** does not grow with players: the one object is in memory while anyone is connected, which is at most
  0.128 GB × 86,400 s = 11,059 GB-s a day, 331,776 a 30-day month — inside what is included.
- **A connected hour at rest** is about 240 Worker requests, 276 Durable Object requests and 6 rows: about $0.00012
  beyond the included amounts. A thousand players connected for an hour is about 12 cents.
- **A busy hour** as simulated is about 390 Worker requests, 450 Durable Object requests and 530 rows: about $0.0007,
  three quarters of it rows written.
- **A daily player** who is connected half an hour, half of it busy, is about $0.0002 a day: ten thousand of them, about
  $60 a month beyond the plan.

Limits of one Durable Object, on the same footing: 32,768 hibernating sockets; 128 MB of memory; 30 s of CPU per request
or frame unless configured higher; 10 GB of SQLite storage; 2 MB a row; about 1,000 requests a second as a soft limit. The
game reaches its own limits long before the socket and storage limits; the memory limit is the one the whole-collection
design can reach (a 10 MB collection is several times that while it is being parsed).

## Room groups

A public venue's room is split into **groups** (`server/ws/groups.ts` holds the rules, `server/ws/rooms.ts` the state and the
sending, `src/game/roomGroups.ts` the numbers). A player sees, hears (chat, the voice circle) and is sent moves from their
group only; the venue still tells everyone a truthful total.

| Setting | Default | Meaning |
|---|---|---|
| `ROOM_GROUP_TARGET` | 12 | strangers are placed in the fullest group below this |
| `ROOM_GROUP_MAX` | 16 | a player who hops in by choice; friends are kept together up to this plus 2 |
| `ROOM_GROUP_MIN` | 4 | a group below this is merged into another at the next join or leave in the venue |

Placement, in order: the group of the person they came to be with (a ping join, or a friend named in the join); the group
with the most of their mutual friends (the founder's automatic friendship does not count); the group they were in a minute
ago; the fullest group below the target; a new group. A block is never a reason to be placed anywhere. A friend whose group is
past the maximum plus two is named ("in another part of the venue") with a one-tap join that waits for room.
A merge moves a small group whole, never a seated player, and never splits a voice circle, a recent conversation or two
friends standing together. Home rooms (a host and at most 5 guests), game tables and calls are not grouped.

Everything is in memory: nothing is stored, no row is written by room traffic, and a Worker that slept puts each socket back
in the group it carried (the group id is in the socket's attachment). A page that joins with `deltas: true` gets one
`presence` snapshot (with `counts`) and then `presence-delta` frames; moves are gathered and sent at most about eight times a
second per group. A page that does not know groups is sent its group's whole list as the room. The venue total is sent to
each group once per heartbeat, only when it changed. `GET /api/social/people` lists the caller's group and carries `here`,
`total`, `groups`.

Measured at 1,000 players in one venue (`server/room-groups-load.test.ts`): a step in which everybody moves once is about
0.8 MB in all (about 800 bytes a player), and no page is told of more than 18 members. The whole-room list would be one
list of 121 KB to every page on each of the 1,000 moves, 121 GB.

Still sized by everyone, not by a group: the heartbeat sweep walks every socket (every 10 seconds); a venue's tables are
listed whole (a venue has a handful); the live friend places and the neighbours directory were already capped.

## What was measured

`npm run capacity -- --host worker|node --steps 250,500,1000` (see the head of `scripts/capacity.ts` for the method and
what it does not show). Each simulated player is one open page: a session, a life, friendships, two sockets, the polls
above, and activity. The host runs as its own process; latency is request sent → answer parsed; CPU is the host
process's own. One machine (Apple M4 Pro), loopback, one run per row, 40–60 s per step.

**Worker host, busy players** (an action every 30 s, a step every 10 s, half of them in eight public venues):

| Players | Before: action p50 / p95 | Before: host CPU | After: action p50 / p95 / p99 | After: poll p50 / p95 | After: host CPU | CPU per request or frame |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 4 / 13 ms | 0.07 core | — | — | — | 1.71 ms before |
| 250 | 6 / 616 ms | 0.33 | 3 / 17 / 44 ms | 3 / 19 ms | 0.10 | 2.97 → 0.97 ms |
| 500 | 6,934 / 11,610 ms | 0.91 | 4 / 14 / 29 ms | 3 / 12 ms | 0.22 | 4.56 → 1.04 ms |
| 1,000 | half the sockets refused (cap 1,024) | — | 6 / 41 / 62 ms | 5 / 33 ms | 0.59 | 1.39 ms |
| 1,500 | — | — | 3,020 / 12,291 ms | 3,104 / 10,695 ms | 0.89 | saturated |

At 1,000 the host was sending 46 MB of room member lists a second, at 1,500 it tried to send 115 MB. The JavaScript heap it
held after a collection stayed between 12 and 44 MB throughout: what a request allocates while it parses a collection, not
what the host keeps, is what approaches the memory limit.

**Worker host, players mostly at rest** (an action every 3 minutes, a step a minute, 30% in public venues):

| Players | Action p50 / p95 / p99 | Poll p50 / p95 | Host CPU | Rows per player-hour | `social` stored |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 3 / 28 / 86 ms | 2 / 16 ms | 0.21 core | 113 | 1.2 MB |
| 2,000 | 5 / 121 / 247 ms | 3 / 97 ms | 0.56 | 141 | 2.6 MB |
| 3,000 | 1,454 / 4,143 ms | 1,472 / 3,663 ms | 0.99 | 135 | 4.1 MB |

**Node host, busy players** (an action waits for the whole data file to be written):

| Players | Before: action p50 / p95 | After: action p50 / p95 | After: poll p50 / p95 | After: host CPU | Data file |
| --- | --- | --- | --- | --- | --- |
| 250 | 18 / 56 ms | 16 / 59 ms | 2 / 9 ms | 0.15 core | 2.1 MB |
| 500 | 68 / 123 ms | 72 / 143 ms | 1 / 22 ms | 0.30 | 4.4 MB |
| 1,000 | 182 / 1,452 ms, half the sockets refused | 166 / 379 ms | 7 / 135 ms | 0.67 | 8.8 MB |
| 1,500 | — | 3,994 / 21,716 ms | 1,064 / 13,489 ms | 1.05 | 13.2 MB |

### What was found, in the order it stopped the host

1. **Every socket's state was rewritten after every request and frame** (Worker). What a socket carries through a sleep
   was serialised for all sockets each time: 65% of the host's CPU at 400 players. Now a socket is written when a field
   of it is assigned (`deploy/cloudflare-worker.ts` `wrap`, `saveSockets`). This alone moved the knee from under 500
   players to over 1,000.
2. **Finding one player's sockets walked all sockets** — on every push, every "is this player online", every request's
   room check, every action's membership check, and once per resident on every civic check-in. Both hosts now keep the
   sockets by player, by session and by address.
3. **Listing or counting the sessions read and parsed every session** (Worker): a new visitor cost time in proportion to
   everyone stored — 13 ms at 100 sessions, 250 ms at 1,000. The key listing now reads keys only, and start-up finds
   expired sessions by their stored expiry instead of reading every record.
4. **A room's member list was turned into text once per member.** It is now made once per change. The list itself is
   still sent whole to everyone in the room on every step anyone takes: 43 MB a second at 1,000 busy players. A room has
   no member limit. *(Both are now fixed: see "Room groups" below.)*
5. **Telling a player's friends that they connected read the whole `social` collection, per socket.** Arrivals and
   departures that come while such a read is on its way now share the next one, and when reads take long the next waits
   a little (`server/ws/social.ts`). Before, a wave of reconnecting pages was 55% of the host's time and kept it down.
6. **The answer to a heartbeat looked up its stored session six times a minute per socket.** Now once a minute; every
   other frame is still checked every time.

What is left, and is now most of the host's time at the knee (65% at 3,000 players at rest): parsing and re-serialising
the whole `social` and `civic` collections on every request that touches them. A look at the phone took 7 ms with 1.2 MB
of `social` stored and 18 ms with 2.6 MB, on an idle host.

Other work that still grows with everyone stored, not yet changed:

- `GET /api/campus` reads every stored session (the campus leaderboards are computed from the lives);
- a player search and the hourly housekeeping walk every social player;
- finding expired sessions without an index on the expiry reads the session table's rows (not their contents) once a
  minute and on each new session;
- on Node, every write is the whole data file.

## What to promise

On the machine above, after these changes, the Worker host stayed comfortable (95% of answers under 60 ms) with 1,000
busy players or about 2,000 players mostly at rest. Before, it stopped between 250 and 500. Production CPUs are slower
than that machine and nothing here models a real network, so halve it: **about 500 busy players, or 1,000 mostly at rest,
connected at once**, and **about 5,000 players who came by in the last six weeks** before a look at the phone costs more
than 50 ms of the one thread. The second number is the one to watch: `store.collections.social` in the operator's
overview, and the Durable Object's CPU time and memory in the platform's dashboard.

## What comes next

In order. Each step is worth doing by itself.

1. **Store the big collections per entry.** Done in code, off by default: `social`, `growth`, `civic` and `business` can be kept
   as a root and one row per player, conversation, resident or shop, read and written like sessions are, so a request costs what
   it touches. The move, the rollout (shadow, switch, way back, safety copy) and the measurements are in
   [STORAGE.md](STORAGE.md). Until the switch is made on the live store this step is not complete, and `MAX_ACTIVE_SESSIONS`
   should not be raised.
2. **One socket per page.** The game socket and the social socket carry disjoint message types and are already served
   by the same handlers; one connection halves the sockets, the heartbeat frames and the session renewals.
3. **Rooms of bounded size.** Done: see "Room groups" below.
4. **An index for what the campus and the search read**, kept by the modules that own them.
5. **One object per city.** Only when one thread is no longer enough after the steps above — on the measurements here,
   somewhere above 3,000 players connected at once.

### One object per city, in outline

Cities are already isolated in the data: a life belongs to one city, a character is in one city at a time
(`server/character.ts`), rooms, civic state and the world registry are keyed by city (`docs/CITIES.md`).

- **A city object** per open city holds what only that city reads: its lives, its venue rooms and sockets, its civic
  collection, its registry shards, its live-location counts, its tables.
- **A small global object** holds what is about a person, not a place: accounts and device bindings, the session
  directory (which city a session's character is in), friendships, conversations, blocks, calls in progress, invites,
  referral and outreach state, the rate limits that must hold across cities.
- **The Worker** routes a request to the city in its `cityId`, and a socket to the city the session directory names.
- **Travel between cities** is a hand-over: the origin object settles the life, writes a signed, single-use transfer
  record and marks the life departed in the same transaction; the destination applies the record exactly once (the
  record's id is a receipt, as an action id is) and confirms; the origin then drops its copy. Until the confirmation the
  origin can still restore the life, so a failure at any point loses nothing and duplicates nothing.
- **What crosses cities** goes through the global object: a friend's place (each city publishes changed spots to it, as
  it now marks them for the live tick), messages and updates, a call's signalling, the founder's friendships, an invite
  that lands in another city, and the atlas's per-city online counts (each city reports its own number).
- **Migration** copies each stored session to the object of its character's city and the collections to their new
  homes while the single object stays the source of truth, compares, then switches the routing; the single object is
  kept read-only until the new ones have run for a release.

This is weeks of work with real risk in the hand-over and the migration. It does not make one crowded city faster: a
city that outgrows one thread needs step 3, or districts as objects, which the registry's per-local-government shards
already suggest.
