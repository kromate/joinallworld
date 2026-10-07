# Realism: characters, places and interactions

Status: design spec, not yet implemented. Written on 2026-10-06 against `origin/main` at `b1bfa6f` ("Keep city maps out of the Worker script"). The local `main` checkout is 218 commits behind that revision, so every file path below refers to `origin/main`.

Delivery order, ownership and release rules are in `REALISM-PLAN.md`. Where this document's "Phases" and "Open decisions" sections differ from it, the plan wins.

## Goal

Allworld already places real venues at real coordinates. What still feels artificial is the people. Today a regular stands at one spot all day, says one of two or three fixed lines, offers the same five actions as every other regular, and forgets everything except a closeness number. In the 29 cities built by the city formula (`src/game/cities/formula/content.ts`, `peopleFor`), the regulars are placeholders named "calabar neighbour 1" with lines such as "Welcome. There is room for another neighbour here."

This spec makes the people, places and interactions behave more like a real Nigerian city. It covers 14 features in six phases. Each phase can be shipped and checked on its own.

## Design rules

1. **Deterministic first.** Where an NPC is, what they are doing, the day's city conditions and the weather are derived from `(cityId, npcId, Lagos time, day seed)`. The server, the Worker and the browser compute the same answer without new network traffic or new stored state. Only what the player caused is stored, in the life.
2. **Bounded state.** Each new per-life record has a hard cap and a `sanitize` path, following the existing `social.rel` pattern (`MAX_RELATIONSHIPS`, `MAX_NOTICES`).
3. **Facts are sourced, people are original.** The research rule in `docs/CITY-RESEARCH.md` still applies. Places, dishes, festivals, greetings and dates need a pinned source. Characters are original fiction and are labelled `beta: true` like the Lagos cast. A greeting or dish a character mentions points to a sourced identity fact.
4. **Mechanics are shared, wording is local.** Action ids, effects and limits stay in shared content. A city supplies names, lines, greetings and the local version of an action, as `dreamWording` and `carNicknames` already do.
5. **Keep the HUD quiet.** New information appears in the existing People panel, the venue card, speech bubbles in the scene and Messages → Updates. Nothing adds a permanent HUD element.
6. **Players stay safe.** NPCs never pass on what another real player did. Introductions between real players need consent from both and follow existing blocks and privacy settings.

## Research basis

A research pass on 2026-10-06 checked each claim against sources.

| Claim | Status | Source |
| --- | --- | --- |
| Agents with an observation memory, reflection and planning are judged more believable. Removing any of the three lowers believability. One party invitation spread between agents over two days. | Confirmed | Park et al. 2023, [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) |
| In Second Life, avatars keep real-world distance and gaze norms. Male pairs stand further apart and make less eye contact. Standing closer is offset by looking away. | Confirmed | Yee et al. 2007, [CyberPsychology & Behavior 10](https://nickyee.com/pubs/Yee,%20Bailenson,%20Urbanek,%20Chang%20&%20Merget%20-%20SL%20NonVerbal.pdf) |
| Stardew Valley NPC schedules change with the day of the week, the season and rain. | Confirmed | [Stardew Valley Wiki: schedule data](https://stardewvalleywiki.com/Modding:Schedule_data) |
| Animal Crossing villagers remember the player, gossip about the player's answers, and follow sleep and wake routines that depend on personality. | Confirmed | [TheGamer](https://www.thegamer.com/animal-crossing-new-horizons-villagers-have-memory/), [Nookipedia](https://nookipedia.com/wiki/Normal) |
| The Calabar Carnival is a December event billed as "Africa's Biggest Street Party". The 2025 programme ran from 30 November 2025 to 1 January 2026, and the dates change every year. | Confirmed (dates set per year) | [Wikipedia](https://en.wikipedia.org/wiki/Calabar_Carnival), [CrossRiverWatch 2025 itinerary](https://crossriverwatch.com/2025/12/cross-river-government-unveils-2025-carnival-calabar-trace-of-time-itinerary/) |
| Watt Market, Marina Resort on the Calabar River, the Slave History Museum inside Marina Resort, Duke Town, Tinapa and the Great Kwa River are in or near Calabar. Obudu is several hours away by road. | Confirmed | [Wikivoyage: Calabar](https://en.wikivoyage.org/wiki/Calabar), [Great Kwa River](https://en.wikipedia.org/wiki/Great_Kwa_River) |
| Efik "Mesiere" or "Emesiere" means good morning. "Sosongo" means thank you. "Ete" and "Mma" are placed before a name as a mark of respect. | Partly confirmed: spellings vary, and some sources are Ibibio | [Omniglot: Efik](https://www.omniglot.com/language/phrases/efik.htm), [JNLP article](https://www.jnlp.com.ng/index.php/home/article/download/23/22/29) |
| Edikang Ikong, Afang, Ekpang Nkukwo, Fisherman soup and Abak Atama are Efik or Calabar dishes. | Confirmed. Do not use "Iwuk Edesi" for Fisherman soup, because sources disagree on that name. | [Sugar.ng](https://blog.sugar.ng/content/5-delicacies-efik-cuisine-you-can-add-your-wedding-menu), [The Interview](https://theinterview.ng/2016/10/30/secrets-of-the-efik-kitchen/) |
| Grid power is intermittent, and households and businesses that can afford it run generators. The danfo is the Lagos minibus. Harmattan runs from the end of November to mid-March. | Confirmed | [Nigerian energy supply crisis](https://en.wikipedia.org/wiki/Nigerian_energy_supply_crisis), [Danfo](https://en.wikipedia.org/wiki/Danfo), [Harmattan](https://en.wikipedia.org/wiki/Harmattan) |

Not verified: schedules in The Sims, "Abadie" as an Efik greeting (sources attest it only in Ibibio), and Henshaw Town. Do not use them.

Before any Efik line ships, a native Efik speaker must review its spelling and tone marks. Until then the line is `beta: true` and carries a `note`.

## Shared foundations

Several features need the same two pure helpers. Build these first, in `src/game/world-time.ts`. Neither helper needs THREE or the DOM.

```ts
type TimeBand = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'
timeBand(now: number): TimeBand                     // from lagosTime(now).minuteOfDay
daySeed(cityId: string, day: number): number        // stable hash; the same on every host
citySeason(cityId: string, now: number): { wet: boolean; harmattan: boolean; label: string }
// citySeason reads the existing spec.climate (rainyMonths, dryMonths, harmattan)
```

The NPC definition gets optional fields. Every one is optional, so the Lagos, Ibadan and formula casts keep working before they are filled in.

```ts
interface NpcDefinition {
  // existing: id, venue, name, role, emoji, quotes, at, beta, note
  age?: 'young' | 'adult' | 'elder'
  look?: Partial<Look>                 // body, build, age styling, outfit, fabric, hair; seeded when absent
  routine?: NpcRoutine                 // feature 1
  lines?: NpcLines                     // lines for a time band, a memory or a condition (features 2, 7, 8)
  greeting?: { text: string; meaning: string; identityId: string }   // feature 4; identityId points to a sourced fact
  actions?: readonly string[]          // place-specific action ids (feature 11)
}
```

## Characters

### 1. Daily routines

**Why.** Stardew-style schedules make a town feel inhabited because people are somewhere for a reason.

**Design.** A routine is a short list of blocks. The first block that matches the current time wins, and when nothing matches the regular is "away".

```ts
interface NpcRoutine {
  blocks: readonly { days?: readonly number[]; from: number; to: number; venue: string; at?: string; doing: string; wet?: boolean }[]
}
whereIs(npc, cityId, now): { venue: string; at: string | null; doing: string } | null   // pure
```

`wet: true` marks a block that applies only on a rainy day, and `wet: false` one that applies only on a dry day. Rain comes from the existing weather derivation, so rain moves people indoors.

**Integration.**

- `social.view.here` filters by `whereIs` and no longer reads `npc.venue`.
- `crowd.ts` already receives `npcs` from `view.social.here`, so it needs no change.
- The People panel shows "Usually at Watt Market in the morning" for a regular who is away.

**Constraint.** The city contract must still guarantee at least one regular at every public venue whenever the venue is open. Add a check that samples every hour of a week. A regular with no routine stays at `venue` all day, which is today's behaviour.

**Acceptance.** At 07:00 the Watt Market pepper seller is at the market. At 21:00 she is away, and the panel says when she is usually there.

### 2. Memory facts

**Why.** The Generative Agents ablation shows that memory and reflection carry most of what makes an agent believable. Animal Crossing shows that a few remembered facts are enough to feel personal.

**Design.** Each NPC relationship holds at most 3 facts. A new fact replaces the oldest fact of the same kind first, then the oldest overall.

```ts
type MemoryKind = 'first-met' | 'treated' | 'joke-flopped' | 'job' | 'home-area' | 'away' | 'haggled' | 'respect'
interface MemoryFact { k: MemoryKind; v?: string; day: number }
Relationship.m?: MemoryFact[]   // sanitized: known kind, at most 24 chars of v, finite day, length <= 3
```

Facts are written by the social system's existing `activity.completed` handler and by listeners for `career.*` and `estate.*` events. Lines come from templates such as `{ 'treated': ['You still owe me nothing for that drink last week, {name}.'] }`, with a city override.

When the player greets a regular, `npcSummary.quote` prefers a line for a fact recorded within the last 7 days.

**Acceptance.** Buy Amaka a drink, come back the next day, and her greeting refers to it. A save that carries more than 3 facts, or unknown kinds, is trimmed by `sanitize`.

### 3. Gossip and reputation

**Why.** In Smallville, information spread from agent to agent. In Animal Crossing, villagers gossip about how the player behaves.

**Design.** Gossip is only about the player, and it lives in the player's own life.

```ts
interface Rumour { id: number; kind: 'generous' | 'funny' | 'rude' | 'hardworking' | 'haggler'; venue: string; day: number }
social.rumours: Rumour[]       // cap 8, oldest dropped
```

- A rumour starts after a notable act: a treat, a joke that lands, Throw Shade, a shift completed, or a haggle that succeeds.
- It reaches regulars in the same district one Lagos day later, and the whole city after 3 days. Spread is computed from `day` and the venue's district, so nothing is stored per NPC.
- Reputation per kind is a decayed count. It adjusts `social.gain` and `social.success` through the existing modifier hooks by ±10% at most.
- Regulars who have heard a rumour can say a line such as "Iya Bose says you price market like your life depends on it."

**Acceptance.** Haggle at Watt Market, then the next day a regular at another venue in Calabar Municipal mentions it. A regular in Calabar South does not mention it until day 3.

### 4. A cast for each city, starting with Calabar

**Why.** The formula cast is made of placeholders. A cast that matches the place is the cheapest realism win available.

**Design.**

- Add an optional `cast` array to `CitySpec`, using `CityPersonSeed` plus `age`, `greeting`, `routine` and `look`.
- `peopleFor` uses `spec.cast` when it is present.
- Without a cast, it falls back to a better generator. The generator draws roles from the place kind (market trader, nurse, usher, groundsman, museum guide), lines from the sourced food, craft and industry facts, and names from a reviewed regional name pool kept in `src/game/cities/formula/names.ts`. It never produces a numbered "neighbour" again.
- Calabar is authored first: two regulars for each of its places.
  - Each regular uses a sourced Efik greeting.
  - Each has an age mix that includes elders.
  - Lines refer to sourced facts: Edikang Ikong at Native Delicacies, Afang soup at Chef Green, carnival costume makers, harbour trade, and the goods sold at Watt Market.
- Elders are addressed with "Ete" or "Mma" before their name.

**Acceptance.** No regular in any city has a name that matches `/neighbour \d+/`. Every Calabar line that names a food or festival points to an identity id that the spec's sources support.

### 5. Personal space and attention

**Why.** Yee et al. found that avatars keep real-world distance and gaze norms. When figures ignore those norms, the scene looks robotic.

**Design.** These are client-only scene changes in `src/scene/movement.ts` and `src/venue-world.ts`.

- A regular within 3 m of the player turns their head toward the player, and their body as well if they are standing.
  - The turn has a 2 to 4 second gaze hold, then a glance away. This avoids an unbroken stare.
  - Elders and people who are busy only glance.
- Two regulars talking (feature 12) stand 0.9 to 1.2 m apart, facing each other at an angle.
- The player cannot walk through a standing NPC. Pass-by distance is kept at 0.6 m or more.

**Acceptance.** This is checked visually in the browser by Astra. Frame time must stay within the current budget with 12 people in the crowd.

### 6. Body and age variety

**Why.** Every preset and every NPC is a young, slim adult. Real streets have a mix of builds and ages.

**Design.**

- Add `build: 'slim' | 'average' | 'full'` and `age: 'young' | 'adult' | 'elder'` to the look options in `src/scene/characters.ts`.
  - Build scales the torso, hips and limb girth.
  - Elder adds grey hair, a slight stoop and a slower walk.
- In the creator, the Look step gets a Build row. Age is offered as a style ("Grey hair") so player avatars stay readable.
- NPC looks are seeded from the NPC id with a realistic mix. An explicit `look` in the definition overrides the seed.

**Acceptance.** All existing saved looks render unchanged, because the new fields default to `average` and `adult`. The avatar preview checks still pass.

## Places

### 7. Time of day and season

**Design.**

- Venue `ambient` lines can be keyed by `TimeBand`.
- How many extras a scene draws follows an hourly busyness curve for the venue kind. For example, a market peaks at 08:00 to 11:00 and 16:00 to 18:00, and a viewing centre peaks on evenings and weekends.
- `citySeason` drives harmattan haze (fog colour and density) and the colour of the sky in the wet season.
- All of this reuses the existing scene lighting.

**Acceptance.** The same market shows different numbers of people at 09:00 and 22:00. A Kano scene in January shows haze, and Calabar shows much less, as its climate data says.

### 8. City conditions

**Design.** These are deterministic daily events seeded by `daySeed(cityId, day)`.

```ts
interface CityCondition { id: string; kind: 'power-cut' | 'go-slow' | 'match-night' | 'rain'; from: number; to: number; districts?: string[]; venues?: string[] }
conditionsAt(cityId, now): CityCondition[]   // pure
```

- **Power cut:** lights in the affected district dim. Venues marked `generator: true` keep their lights and add a generator hum. Regulars use lines such as "NEPA has taken light again."
- **Go-slow:** road trips in the affected window take longer, through the existing travel modifier.
- **Match night:** viewing centres fill up and Chidi's football lines come up more often.
- **Rain:** the existing weather rain, now also read by routines.

Every rate is a beta value.

**Acceptance.** Two hosts compute identical conditions for the same city and minute. The venue card shows a one-line notice ("Light is off around Watt Market until 8PM").

### 9. Calabar calendar and landmarks

**Design.**

- Add `CalendarEvent` entries for the Calabar Carnival season. Each year is authored separately with its own sourced dates, because the dates change every year. A parade day spawns costume extras, music and dancing at Millennium Park and along the main road. The `spray` flag stays reserved for owambe events.
- Add Marina Resort and Tinapa only after they have pinned OSM or Wikidata records, through the research pipeline.
- Do not add Obudu as a Calabar venue.

**Acceptance.** In the carnival window the calendar lists the event, and the park scene shows the parade crowd. Outside that window it shows neither.

### 10. Ambient sound for each place

**Design.**

- Each scene kind gets a lazily loaded, looped sound bed: market calls, a church choir on Sunday mornings, crowd noise at a viewing centre, harbour water.
- Condition layers sit on top: rain, generator hum.
- Audio honours the existing sound settings (`soundSettingsModel.ts`), stays outside the entry budget guarded by `src/app/entry.test.ts`, and starts only after the player interacts.
- Audio files must be original or properly licensed, and their attribution goes in `NOTICE.md`.

**Acceptance.** Entry bundle sizes do not change. Muting stops every sound bed.

## Interactions

### 11. Actions that fit the place

**Design.** `NPC_ACTIONS` stays the shared base. The new `PLACE_ACTIONS` add actions by place kind or NPC role.

- **Market:** Haggle. The chance depends on charisma and closeness. A success gives a discount coupon for the next market purchase and records a `haggled` memory.
- **Elder:** Greet with respect. If the player skips it before another action, that elder gives fewer closeness points that day.
- **Hospital or bank:** Join the queue. This is a timed wait that lowers the wait for the next service.
- **Viewing centre:** Argue football.
- **Salon:** Gist under the dryer.
- **Church or mosque:** Greet after the service. This is only available just after a service.

The ids are shared and the labels are local. Calabar's elder greeting uses the sourced Efik greeting text.

**Acceptance.** A market regular offers Haggle and a church regular does not. The daily interaction limit counts these actions too.

### 12. Regulars talking to each other

**Design.**

- Each venue can carry `exchanges`: short scripts of 3 or 4 lines between its two regulars.
- When both regulars are present (feature 1) and the player is within 6 m, speech bubbles play the exchange once per band of time.
- A "Join in" action runs Gist with both regulars and gives each half of the points.

**Acceptance.** Standing near Mama Bisi and Funke at the salon plays their exchange. Join in raises closeness with both of them.

### 13. Regulars introducing real players

**Design.** This is server-side, built on the existing presence listing and friend graph.

- When two real players are in the same venue room and both are at Friend tier with the same regular, the regular can offer "Let me introduce you to {name}".
- The introduction is sent as a friend suggestion, and each player can accept or ignore it.
- It is rate-limited to one per player per Lagos day, and blocked or private players are excluded.
- Guests are not introduced until they have settled in.

**Acceptance.** This is exercised by the existing `two-players` script path. A blocked pair never receives an introduction.

### 14. Consequences that come back later

**Design.**

```ts
interface FollowUp { id: number; npc: string; kind: 'return-favour' | 'tease' | 'missed-you' | 'referral'; due: number }
social.followUps: FollowUp[]   // cap 5; settled when the player next meets that regular on or after `due`
```

| Cause | Consequence |
| --- | --- |
| A treat | Some days later the regular gives a free zobo or drink, or a small discount. |
| A joke that flopped | The regular teases the player at the next meeting. |
| 7 or more days away from a Friend-tier regular | "Where have you been?" |
| A Friend-tier regular who works at a workplace | A job referral notice. |

Rewards are small and use the existing economy API, so they stay within the economy simulation's balance (`npm run economy`).

**Acceptance.** Treat a regular, then advance three days, and the next meeting gives the return favour once and only once.

## Phases

| Phase | Features | Owner and model | Verification |
| --- | --- | --- | --- |
| 0. Base | Move work onto `origin/main` | Astra, with Anthony's approval | `git log` shows `b1bfa6f` or later |
| 1. Cast | 4 and the NPC part of 6 | Terra writes the schema and generator, Luna authors cast text, and Astra reviews the Efik lines | typecheck, city contract suites, a browser look at Calabar |
| 2. Living city | 1, 7, 8 | Sol builds `world-time.ts`, routines and conditions | typecheck, the existing `first-day` and `two-cities` scripts, a browser check at two times of day |
| 3. Memory | 2, 3, 14 | Sol | typecheck, `npm run economy`, a manual life replay |
| 4. Interactions | 11, 12, 13 | Terra for 11 and 12, Sol for 13 (server) | typecheck, `two-players`, a browser check |
| 5. Presentation | 5, the player part of 6, 10 | Terra, with Astra checking the scenes | entry budget, avatar preview, browser check |
| 6. Calabar calendar | 9 | Luna does research, Terra integrates | the city contract and research checker |

## Open decisions

1. Which base to build on: a worktree from `origin/main`, or this checkout fast-forwarded after the local edits to `CONTRIBUTING.md`, `package.json` and `tools/` are handled.
2. Whether to change tests. Schema changes will break some existing contract and snapshot tests, for example the ones that count regulars or compare NPC shapes. The project rule is not to change tests without Anthony's approval.
3. Who reviews the Efik lines (a native speaker) before they lose `beta`.
4. Whether gossip may ever mention another real player. This spec says no.
