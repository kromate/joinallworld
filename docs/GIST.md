# The city gist and the world ledger

Small stories form when a system shows what it did. The gist is a short list of **public** things that happened in each city, one plain
line each ("Ada opened a food stall in Yaba Market", "Tunde was elected governor of Lagos", "The Square is packed right now"). People read
it in the Gist app and in the Square, share a line as a card, and AI agents look a claim up in it before they repeat it, so a rumour is not
passed on as news. Code: `server/gist/ledger.ts` (the ledger), `server/routes/gist.ts` (the route), `src/app/features/gist/` (the phone).

## The ledger

`ctx.collection(db, 'gist')` = `{ v: 1, seq, cursor, cities: { <cityId | 'world'>: item[] } }`, oldest first. An item is
`{ n, at, city, kind, text, refs? }`:

| Field | Meaning |
| --- | --- |
| `n` | counts up for the whole world, never reused; the number a share card and `since=` use |
| `city` | a city id, or `world` for what belongs to every city (the Square, the nation, an announcement for everyone) |
| `kind` | `election`, `law`, `party`, `removal`, `business`, `jail`, `busy`, `event`, `notice`, `owner`, `other` |
| `text` | one line, at most 120 characters, first letter capital |
| `refs` | at most four small keys: a record number, a de-duplication `key`. Never a player id |

**Limits.** At most 200 items a city (`CITY_MAX`), 2,500 in all (`TOTAL_MAX`), none older than 14 days (`KEEP_MS`); pruned on every write.
Writes are `{ durable: false }` (the heartbeat) or ride on the transaction that made the event: losing the last second of gossip costs nothing.

**The one door.** Every source calls `gistService(ctx).add(db, entry)` inside its own transaction. Later phases do the same
(Phase 14's "a fever is going round Yaba" is `add(db, { city, kind: 'owner', text })`).

```ts
add(db, { city: 'lagos', kind: 'business', text: '{0} opened a food stall in Yaba Market', people: [{ id, name }], refs: { key: 'shop:...' } })
```

`{0}`, `{1}` stand for `people[0]`, `people[1]`. `minors: 'skip'` leaves the whole item out when a named person is not a known adult
(default: the name becomes "a resident"). `refs.key` makes the line appear once however often the source runs.

## Privacy rules (tested in `server/gist/gist.test.ts`)

1. **Only facts that were already public.** The sources are the public record, shops (shown to everyone in their market), arrests in a
   city, the calendar, the public counts and operator announcements for everyone or one city.
2. **Names.** A person is named only when `ctx.checks.adult(db, id)` is true. A minor, or a player whose age is not known, is "a resident"
   (or the line is dropped when it would be about their arrest, removal, election or party).
3. **Hidden players.** Anyone who hid themselves from the directory (civic prefs `directory`) is in no line at all.
4. **No money.** A line with a money sign, "naira" or "kobo" is dropped unless the source says the amount is already public (a law of the
   public record). Stalls never show a price, a takings figure or the stall's own name.
5. **Never the private.** Messages, reports, blocks, moderation, rulings of a court (they name the tried), the officer in an arrest, the
   sentence, votes by person and the operator's reasons do not call `add`, and the tests prove none of it appears.
6. **No ids.** Nothing stored can be turned back into a person.
7. **Friendships.** The game has no public partners or weddings, and who is whose friend is private, so friendships are not a source.

## Sources

| Source | When | Line |
| --- | --- | --- |
| Public record: term won, law, party, removal | heartbeat reads new entries (a cursor), at most 40 a look | "Tunde was elected governor of Lagos", "The City House passed a law: ...", "Chi founded the Good Road Party", "Tunde was removed from office in Ibadan by petition" |
| Business opened (`server/business/service.ts`) | when the stall opens | "Ada opened a food stall in Lagos Market" |
| Arrest (`server/routes/politics.ts`) | when the officer arrests; adults only | "Bully was arrested in Lagos" |
| Busy city, packed Square | heartbeat; 8 people in a city / 6 in the Square, at most every 6 hours each | "Lagos is buzzing: 12 people out right now", "The Square is packed right now" |
| Calendar event begun (`src/game/calendar.ts`) | heartbeat, in cities someone is in | "Owambe night has started at Quilox" |
| Announcement (`server/admin/announce.ts`) | when it goes out, for everyone or one city (not "online now") | "From the Allworld team: Weekend market" |

The heartbeat runs at most every 20 seconds, reads memory first and writes only when there is something new.

## The route

`GET /api/world/gist?id=<city>[&since=<n>][&limit=1..50]`: public (no session), limited per address, cached 15 seconds. Answers
`{ city, items: [{ n, at, city, kind, text }], latest }`, newest first: the city's own lines and the world's. It is public because every line was
public when written and holds no id; nothing in it is about the caller. (`id`, not `city`, so the host does not load the city first.)

## On the phone

* **Gist app** (Phone, People): the newest lines with "how long ago" and a **Share** button each. It is a lazy chunk (`gistPanel` in
  `src/app/features/panels.ts`); the store reads the route at most every 20 seconds.
* **The Square** shows one fresh line at a time in the place panel as "Gist: ..." (the three newest of the last six hours, changing every nine
  seconds). It is never posted in chat.
* **Share.** Kind `gist` of the share cards (docs/SHARE-CARDS.md): the browser sends only the line's number, `createShare` reads the line from the
  ledger, and the card's headline is its words (`card-news.png`, lands beside the sharer). An expired or unknown number gives "nothing to share".

## The ticker (Phase 4 of the open-source plan)

A one-line city news board, built on the lines the page already has: `src/news/` (lazy only; never in the first download), shown by
`src/app/features/gist/Ticker.vue`. The observer (`src/news/observer.ts`, pure) watches the gist lines the store holds, a few of the player's own
numbers (a money jump, a goal done, a level up) and the districts that have just lost light (`powerCutAt`, the conditions code the scene's lamps
and generators already read). It posts at most one line per 7 seconds plus a weight (a heavy story holds the board longer), counts per hour of the
city clock for ordinals ("the 3rd food stall opened in Yaba Market this hour"), never posts the same words or reuses a bank line within an hour,
tells a life topic or an outage at most once an hour, and fills a quiet hour with one line of colour ("the suya smoke rises as the sun drops").
The words are a small bank per register (`src/news/banks.ts`): Lagos pidgin-light for Nigerian cities, Kano for the northern ones, plain English
elsewhere; the pidgin and Hausa-flavoured phrases are BETA, like the conductor's, and await review by fluent speakers. A line holds no name, no
price and no amount. Nothing is stored and nothing is sent to the server.

Where it shows: the Square panel (the ticker's line instead of the plain gist line; the gist line stays as its fallback when the ticker has
nothing fresh), a thin "News" strip in the notice slot for nine seconds after each line (`mountTicker.ts`, started from the chatter chunk ten seconds
after the game is up, so the first download carries none of it; it stays out of the way of the coach and of the Square), and the danfo radio (`src/news/radio.ts`, read in `DanfoRun.vue` when the conductor
has been quiet for 20 seconds). The gist route is read at most once a minute by the ticker, through the store's own limit.

### People who remember you

`src/news/acquaintance.ts` keeps, on this device only (`localStorage` key `joinallworld-acquaintance-v1`), which regular you said hello to (or
gisted with, joked with, complimented) or bought a drink for, for 24 hours: `{ v: 1, people: { <regular id>: { kind: 'greeted' | 'bought', until } } }`,
at most 50 entries, bad entries skipped. `NpcCard.vue` writes it when an interaction starts. The ambient layer (`src/scene/ambient/layer.ts`)
looks it up by the regular's id and, when the player comes within 6 m, the regular turns, waves for 3.5 seconds and says one line (thirty per kind,
ten per register, `src/news/memory-lines.ts`); never on a still placement (reduced motion). No server table, no player id, nothing shared.

## For agents

`check_gist { query }` (server/agents/tools-more.ts) is read-only: it returns at most five matching lines of the agent's city and the world,
newest first, with `n`, `text`, `where` and `minutesAgo`; with no query, the latest five. Its description tells an agent to use it **before it
repeats a claim**, to say "I heard" when nothing backs it, and that "not found" only means "not in the public gist". See docs/AGENTS.md.

## The weekly episode

The week's best lines of a city, with its league place and office holder, become the page `/episode/<city>` and a card at the top of the Gist app: see [EPISODES.md](EPISODES.md). A line that names an AI character stores `refs.ai = 1` so the recap keeps the AI mark.
