# Lagos Life research and Allworld parity plan

> Historical source comparison only: the source audit used the dirty Desktop checkout at f115424c. Its gap classifications must be rechecked against current integrated source before implementation. Current delivery and production receipts are in [PARITY-DELIVERY.md](../PARITY-DELIVERY.md). See [SOURCE-ARCHIVE.md](SOURCE-ARCHIVE.md) for accepted overrides and remaining research coverage.

Research date: 8 October 2026, Africa/Lagos. Target checkout: `/Users/anthonyakpan/Desktop/JoinAllworld`. Research only; no game code, tests, deployment, or production configuration changed.

## Result

Allworld has a substantial base, but it does not have complete parity with the observed Lagos Life announcements. Its strongest overlaps are text chat, groups, calls, house visits, avatar customization, furniture placement, careers, daily/weekly missions, shared table games, fixed deposits, advertising placements, and some campus systems. The largest gaps are rich messaging, player work contracts, company simulation, playable additional cities, shared households, family progression, a social feed, and scheduled public activities.

These classifications describe the current local source. The checkout already contains substantial unrelated modified and untracked work. A file, type, venue model, or document is not proof that the complete feature is playable or released.

Read the detailed deliverables:

1. [Author-announced features and Allworld gaps](./lagos-life-feature-catalogue-2026-10-08.md).
2. [Player requests and complaints](./lagos-life-player-requests-2026-10-08.md). This groups repeated requests and retains specific source links.
3. [Source audit with implementation evidence](./lagos-life-source-audit-2026-10-08.md).
4. [Implementation sequence, dependencies, acceptance criteria, and performance targets](./lagos-life-implementation-plan-2026-10-08.md).
5. Original local Chrome capture. This is a raw research record, containing duplicates, adverts, and truncated UI text. It is not a clean feature list.

## Exact comparison with the linked post

The [8 October chat announcement](https://x.com/Shalom_HeyEliy/status/2108119951014055940) is an author claim. I did not independently operate these features in Lagos Life.

| Announced behavior | Allworld source finding | Work required |
|---|---|---|
| Hold, talk, release voice notes | Missing. Calls and proximity voice are different features. | Recording, cancel/review/send, upload lifecycle, playback, duration limits, membership checks, retention, and reporting. |
| Message reactions | Missing from the message contract. | Bounded reaction set, one idempotent reaction per player/type, removal, counts, and realtime deltas. |
| Swipe to reply | Missing. | Durable reply reference and excerpt, accessible reply button, optional gesture, and deletion behavior. |
| Forward messages | Missing. | Conversation picker, attribution, permission checks, bounded forwarding, and unavailable/deleted-source behavior. |
| Edit messages | Missing for sent messages. | Author-only revisions, server acknowledgement, edited indicator, and moderation of edits. |
| Delete for everyone | Missing. Deleting a failed local outbox entry is not equivalent. | Authorized tombstones propagated to every member, with reply/forward behavior defined. |
| Chats and Groups tabs | Partial. Groups exist; the current tabs are Chats and Updates. | Separate group filter/tab while preserving Updates and unread state. |
| Block scammers and illegal sellers | Partial. Blocking, reports, moderation, and some content restrictions exist. | Define and enforce scam/marketplace abuse rules; do not imply existing generic filtering proves this claim. |

Evidence: `src/types/social.ts:59-90`, `src/app/features/messages/MessagesApp.vue:248-310`, and `server/social/service.ts:80`. Current source limits include groups of 12, 100 conversations, and 50 messages per page. Lagos Life's older announcement claimed groups of 50 and another claimed a 200-chat list. Increasing a limit needs bounded fan-out and history handling, not just changing a constant.

## Highest-value player feedback

The recurring complaints affect the ability to play, not only the feature count:

- **Loading and heat.** Players report map lag, black screens, expensive crowded scenes, and phones overheating. [Map lag](https://x.com/g01den5/status/2108123267013734632), [heat](https://x.com/iamfrostnick/status/2107409550907486378).
- **Account and save recovery.** Users report failed reset delivery, questions they cannot answer, device switching losing progress, and login loops. Do not copy balance/date-based recovery questions merely for parity. [Recovery questions](https://x.com/Temi_010/status/2107869636973015067), [device switch](https://x.com/_ladytola/status/2107871939465282031).
- **Money correctness.** A notification may claim a transfer arrived while the balance does not change; sales and investments can appear to lose money. Receipt, ledger, balance, and notification must agree. [Transfer discrepancy](https://x.com/Dolaxo_xo/status/2108090951734620570), [sale proceeds](https://x.com/HYe2791/status/2107494918117793831).
- **Usable work flows.** Job search, direct hiring, rehiring, bulk restocking, and decorating without losing the session matter more than another menu icon. [Job filters](https://x.com/Adejoswal/status/2107461393309999429), [restock all](https://x.com/VeraPaul_/status/2107821626595402159), [chat interrupts decorating](https://x.com/only1_oriola/status/2107451845279117728).
- **A home that behaves like a home.** Players want visible sitting, sleeping, bathing, shared activities, movable wall decorations, furniture colors, lights, wardrobes, pets, and cars in their garage. [Shared actions and decor](https://x.com/mide_2209/status/2106641783111262711), [camera and crowd space](https://x.com/marluvstare/status/2106668549599043967).
- **Reasons to keep playing.** Requests include real multiplayer games, tournaments, meaningful missions, degrees unlocking careers, and more ways to earn legally. [University progression](https://x.com/kumoriRaver/status/2108126685774156212), [actual multiplayer](https://x.com/scaredrims/status/2106648326212919405).
- **Privacy and harassment controls.** Players ask for DM requests, reporting, and limits on old house-chat visibility for new visitors. [Harassment reporting](https://x.com/molarah26/status/2107414054914392204), [house history](https://x.com/wildassneega/status/2107861610417049614).

Players disagree about the economy. Some ask to remove transfer limits; others ask to restrict gifts because easy trillions remove progression. Both are recorded. The proposed response is to simulate earnings, costs, transfers, and abuse before choosing policy, while retaining server-authoritative balances. [Remove limits](https://x.com/Itshunchosz/status/2108120988491903174), [preserve progression](https://x.com/kumoriRaver/status/2106694171360964613).

## Recommended implementation order

| Phase | Deliverable | Reason for its position |
|---|---|---|
| P0 | Recovery, durable save/ledger correctness, truthful city gates, compact HUD, and measured mobile performance | Later features cannot compensate for lost progress or an unresponsive game. |
| P1 | Rich chat, group filtering, search, privacy, money requests, and bounded media | Closest gap to the linked announcement and a foundation for cooperation. |
| P2 | Better furniture editing, contextual actions/outfits, cameras, visible pets and cars | Makes existing homes and avatars useful before adding more simulation. |
| P3 | In-game shops, companies, escrow gigs, professional search, and decorator previews | Creates player-to-player work with explicit payment and permission boundaries. |
| P4 | Playable city modules, preserved residences, shared transport, and campus-to-career progression | Expands content after state and asset loading are controlled. |
| P5 | Cohabitation, weddings/family progression, household staff, and shared activities | Requires reliable invitations, household permissions, and state transitions. |
| P6 | Social feed, events, competitions, useful governance, and fictional court systems | Depends on durable social and economy systems; must have playable outcomes. |
| P7 | Property markets, simulated loans/stocks/haulage, richer creative ads, and further economy depth | Adds balance and abuse complexity; introduce after measuring the preceding phases. |

Every observed missing family maps to this plan or to an explicit product decision. Requests for real-money cashout, unrestricted gambling, explicit adult content, or involuntary destruction of another player's assets are recorded as requests, not silently approved scope. A consensual fictional alternative can be designed where appropriate. The roadmap's recommendations do not change Allworld's product policy by themselves.

## Performance acceptance

No speed or frame-rate benchmark was run during this research. The following are proposed acceptance targets, not achieved results:

- Keep new optional systems out of the first download. Load city assets on arrival, phone features on open, and media on demand.
- Record a cold-entry baseline on a named midrange Android device and network profile. Reject more than a 5% regression in time until playable. Establish an absolute target from the measured baseline rather than hiding a slow baseline behind a percentage.
- Target p95 frame time of at most 33.3 ms on that device; record p99 stalls as well. Measure the map, home, crowded venue, and phone overlays separately.
- Run a sustained 15-minute crowded-scene session for heat, memory growth, and frame degradation. A short desktop test cannot establish mobile smoothness.
- Keep chat pages at 50 records, virtualize long lists, use incremental updates, and cap media size, voice-note duration, particles, visible avatars, and room fan-out.
- Stop hidden scene rendering and unnecessary panel polling. Resume from current authoritative state when visible again.
- Inspect the actual scene assets, texture sizes, draw calls, network payloads, and stored-state size before opening another city or increasing room capacity.

## Research coverage and remaining limits

I used the signed-in local Chrome browser and scrolled the author's timeline from 8 October back to the 1 October launch. I read announcements and expanded selected release discussions. I separately read 109 unique replies exposed under the supplied post and 395 exposed replies under [the dedicated feature-request post](https://x.com/Shalom_HeyEliy/status/2106637093044715721).

Additional discussions reviewed included the company, shops, landlord, bank, travel, money-request, help, reliability, earlier chat, gig work, decorator, feed, stadium, household staff, car dealership, parking, UNILAG, family, casino, and account-recovery posts. Most were scrolled to X's visible reply boundary or its recommendations section. Some exposed fewer replies than their displayed reply count. Advertisements and recommendations are excluded from the findings.

This is **not an exhaustive review of every comment on every similar post**. X's ranked view, collapsed reply branches, probable-spam sections that did not reveal additional results, and some truncated posts prevent that claim. The author timeline was reviewed, but the comments under every older release, city milestone, and promotional post were not individually exhausted. A browser-tool timeout interrupted the later court/cohabitation/nightlife batch; its unreturned results are not counted as reviewed. The recovered nightlife page confirmed complaints about wealth-based price multipliers, resale values, and paid shout-out visibility, but its entire reply tree was not audited.

For exhaustive follow-through, continue with the full reply trees of [court](https://x.com/Shalom_HeyEliy/status/2106819380180865226), [cohabitation](https://x.com/Shalom_HeyEliy/status/2106819426808893938), [nightlife](https://x.com/Shalom_HeyEliy/status/2107067820638879853), [city launch](https://x.com/Shalom_HeyEliy/status/2107244922290012303), and [original launch](https://x.com/Shalom_HeyEliy/status/2105541070486470749), then the remaining source-linked announcements. Record each sort order, expansion, unavailable reply, and terminal boundary. Do not infer “all comments read” from the reply counter or from reaching the first bottom.

The source audit covered this checkout only. Earlier memory indicated city work elsewhere; that does not prove those changes are integrated here. Before implementation, reconcile active work with the owners of the existing dirty commerce, reliability, campus, and city work. Do not duplicate or overwrite it.

Research delegation used Luna for bounded source and catalogue work. The primary agent performed Chrome research, chose the sequence, and checked the artifacts and key source claims. Token and monetary cost were not available; no cost-saving measurement is claimed.
