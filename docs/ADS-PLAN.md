# Ads plan: paid acquisition for Allworld

Written 21 October 2026 from the live first-party numbers, the earlier growth research (`~/Documents/Allworld-notes/RESEARCH-GROWTH.md`,
`growth/`), what has already been tried, and a research pass over 2026 ad-platform practice. It follows `docs/AD-READY-PLAN.md` (the
landing pages, clips, store and measurement that plan built) and says how to spend money on them. Every figure from outside sources is
tagged: **[S]** platform or regulator document, **[V]** vendor or agency blog (directional only), **[F]** our own first-party data.

## 1. Where we stand (the numbers that decide the plan)

From `GET /api/mod/growth/metrics?days=60`, read 21 October [F]:

| Measure | Value | What it means for ads |
| --- | --- | --- |
| New lives a day | 40–44 on 5–6 Oct (launch), 1–14 a day since 8 Oct | Organic reach has run out; nothing new arrives without a push |
| Landed → Play (direct visitors) | 73 of 259 (28%) | The entry page converts; the proxy event for optimisation can be **Play** |
| Still there ten minutes later | 53 of 259 landings (20%) | "Stayed" is the quality signal to compare campaigns on |
| Day-1 return (all cohorts since 4 Oct) | 32 of 202 (16%) | Below the mobile median of ~20%; below the market target of 30% set in RESEARCH-GROWTH |
| Day-7 return | 8 of 171 (4.7%) | Around the mobile median (~4%); the target was 8% |
| First goal finished | 60 of 202 onboarded (30%) | The first session still loses most people before the loop lands |
| `client.webgl-missing` | 79 signals in 425 sessions (~19%) | One visitor in five arrives on a browser that cannot draw the world (Opera Mini, old Androids) |
| Activation per campaign | counted only since 19 Oct; 1 of 304 "direct" landings so far, 2 under `unknown` | The Phase 7 line works but needs the attribution fix in §5.2 before it is trusted |

**What has been tried, and what it did** [F]:

- **The launch (5–7 Oct)**: ~115 new lives in three days, all `direct`, with 53 invite shares made and 32 share pages opened. WhatsApp
  sharing of the plain link is the only thing that has produced numbers so far. Day-7 of that cohort: 7 of 129 (5%).
- **naijaindie referral** (a community listing): 6 landed, 4 pressed Play. The best landed→play of any source, tiny volume.
- **Organic posts on the owner's own accounts (12 Oct)**: the Instagram players reel reached 469 views and 30 likes in a week and sent
  **one** visitor; the business reel 61 views, one visitor; both TikToks under 10 views. Organic posting from small accounts does not
  move the game. (`growth/ads/DAILY.md`)
- **Community posts** (wimbiz, nsbc, cape-chamber, melanin-gamers): one landing each, no Play.
- **Paid**: nothing yet. The 12–16 Oct agent recommended keeping spend off until attribution was verified; attribution is now live and
  counting (`sources`, `campaigns`, `activation`, `returns`).

**The honest reading.** Ads will buy landings cheaply (Nigeria is one of the cheapest ad markets in the world, §2), and the entry page
turns a quarter of them into players. The leak is after that: D1 16%, D7 under 5%. So the plan buys traffic in small, measured amounts
from the start (to learn which audience and creative convert, and because the social world needs people in it to retain anyone), and
only scales when the per-campaign D7 line on the Admin dashboard justifies it. Buying volume before that would pay for players who leave.

## 2. Platforms: what to use, in what order

Audience sizes in Nigeria, 2025–26 (DataReportal / Kolsquare, adults 18+): TikTok 47.8M, Facebook 38M, YouTube ~27–33M, Snapchat
~19.6M, Instagram 10M, X 7M and shrinking [S/V]. Cost: Meta CPM in Nigeria about **$1–2** against $15–23 in the US and UK [V]; TikTok
usually a little cheaper than Meta for casual games [V]; Snapchat global app-install CPM ~$23 [V], no Nigeria figure found.

| Rank | Platform | Why | Objective to buy | Start |
| --- | --- | --- | --- | --- |
| 1 | **Meta (Instagram Reels + Facebook Reels/Feed)** | Largest share of gaming ad impressions in 2026 (~69% of social gaming impressions, up from 54% [V]); best conversion tooling for a **web** destination (Conversions API, custom conversions); cheapest reliable reach in Nigeria; the diaspora is on Instagram. | *Sales/Conversions* objective on a **website** event (our `play` or `stayed` event via CAPI, §5), **not** Traffic. Advantage+ placements minus Audience Network. | Week 1 |
| 2 | **TikTok** | The biggest adult audience in Nigeria; 9:16 clips (Phase 2) are native to it; cheaper CPM; the competitor category spread there organically. | *Website conversions* with the Events API (`ttclid`), optimise for "Complete registration" mapped to our `play`. Smart+ Web only after 50+ conversions a week. | Week 2 |
| 3 | **Google Search** (tiny) | Since 1 October 2026 the "Lagos life game" category is searched for daily after the competitor's viral launch (2M+ players reported in press [V]). Intent is high and Nigerian CPCs are cents. | *Search* campaign, exact and phrase keywords, website landing `/street/lagos/yaba` and `/`, bid cap, no display expansion. | Week 1 |
| 4 | **Google App campaigns (Android)** | Once the Play listing is public, "Install" converts better than a web link for Android Nigeria (88% Android [S]). Google Play records installs from ad clicks with no SDK in the app [S]; in-app events would need Firebase, which the TWA does not have, so judge it on installs + our web `play|twa` source line. | *App installs* → later *in-app actions* when a Firebase-free signal exists. | After Play is live |
| 5 | **YouTube Shorts via Demand Gen** | Large Nigerian audience, vertical video reuse; optimises on micro-conversions (page views, sign-ups) [S]. | Demand Gen, Shorts-only channel control, conversion = `play`. | Month 2 |
| 6 | **Snapchat** | 19.6M Nigerians, mostly 18–24; nobody in the category is there yet. | Website conversions with Snap's Conversions API. | Month 2–3, one test |
| — | X, Reddit | X is shrinking in Nigeria; Reddit has almost no Nigerian reach (diaspora subreddits only). Reddit's own org posts were the 12 Oct plan. | Organic only. | — |

**Why not Audience Network.** It is where accidental clicks and click fraud concentrate, especially inside third-party game apps [V];
Meta's own policy forbids placements that invite accidental clicks [S]. Exclude it from every ad set; keep Instagram Reels, Facebook
Reels, Feed and Stories.

## 3. Audiences and geography

Two slices, kept in separate campaigns so budgets and results never mix.

### 3.1 Nigeria (80% of the first budget)

- **Who**: 18–34, Android, English. Interest layering is only a hint to Meta's delivery now [V]; use Advantage+ audience with the
  starting hints *Nollywood, Afrobeats, Big Brother Naija, The Sims / life simulation games, Roblox, Lagos*. One ad set per creative
  angle, not per interest.
- **Where**: Lagos, Abuja, Ibadan, Port Harcourt, Kano first (the open cities with the most content); then national. Add **Accra** and
  **Nairobi** in month 2 (both cities are open; CPMs are Nigeria-level).
- **Devices**: Android 10+ only. One in five visitors cannot draw the world (§1); Meta cannot target by GPU, but excluding Android 9 and
  below removes most of them. The street page already falls back to a still picture and Play never waits on the dive, so a weak phone
  still gets a game.
- **Time**: Nigerian social use peaks 8–10 am and **6–9 pm WAT**, with weekends heavier [V, weak]. Data is bought at the start of the
  month and after pay day (25th–5th). Run **dayparting 17:00–23:00 WAT plus Saturday and Sunday all day** in the first fortnight, then
  compare against always-on. Avoid the month's last week for scaling.

### 3.2 Diaspora: UK, US, Canada (20%)

- **Who**: 22–45, with the hints *Nigeria, Lagos, Nollywood, Afrobeats, Jollof rice, Nigerian Pidgin, Naija*. Check whether the behaviour
  *Expats (Nigeria)* still exists in your Ads Manager; it was used successfully in an academic recruitment study across Canada, the UK and
  the US [S], but Meta trims behaviours every year and I could not confirm it for 2026. If it is gone, country + the hints above + a
  lookalike of our Nigerian players' sessions (once CAPI has sent 1,000 events) is the replacement.
- **Cost**: CPM here is ten times Nigeria's [V], so one landing costs roughly $0.50–1.50 instead of $0.05–0.15. Judge it on *stayed*
  and D7, never on landings.
- **Time**: 18:00–23:00 local time in each country (three separate ad sets for the three time zones). Peak season is **late November to
  Christmas**: that is when "Visit home" and the December words on `/visit/lagos` are strongest (§6).

## 4. Creative: what to make and how to test it

The research is unanimous on one thing: the hook decides. TikTok's own guidance: the proposition inside the first 3 seconds, the hook
inside 6, 5–10 words of text per second at most [S]. Agency playbooks for game ads converge on: a mechanic that resolves on screen in
0–3 s, the payoff by 3–7 s, real footage in the middle, the button at the end [V]. Creator-style ("UGC") vertical video beats polished
spots on cold traffic in almost every report [V]. Creative fatigues in about three weeks [V].

**The one asset we have that nobody else has:** the dive from space to a real street (Phase 1). Every first-wave video opens on it.

### 4.1 First wave: nine videos, three angles × three hooks

All 9:16, 15–24 s, Nigerian English or Pidgin voice, captions burned in, the mark `joinallworld.com` in the corner, recorded from the
real game (Capture, Phase 2). No stock footage, no claims about money.

| Angle | Landing | Hook A (0–3 s) | Hook B | Hook C |
| --- | --- | --- | --- | --- |
| **Your street is in it** | `/street/lagos/<place>` (Yaba, Ikeja, Surulere) | Dive from space lands on Yaba: "This is Yaba. Inside a game." | A finger on a phone: "Find my street" → the camera dives to it | Street-level walk past a real landmark, then up to the map: "the whole city is here" |
| **People are in it** | `/` or `/square` | Two characters talking on a street with voice; a third walks up | "Join Yaba Peeps" tap → a room full of people | An AI resident says hello and names the time and weather in Lagos (labelled as AI) |
| **Visit home** (diaspora) | `/visit/lagos` | London rain → a tap → a Lagos street at sunset | "Call your mother's character" (a call UI) | The November/December words: "Detty December starts here" |

Hold the politics advert (`/politics`, "Become governor of Lagos this week") back: Meta's social-issues-and-elections policy disapproves
ads it reads as being about an election unless the advertiser is authorised and carries a "Paid for by" disclaimer [S], and Nigeria's
own elections are in January–February 2027. Run it organically or test it last, framed clearly as a game ("win the game's weekly
election"), and expect to appeal.

### 4.2 The testing rule

- One `utm_content` per video (`street-a`, `street-b`, …); `utm_campaign` per angle and country (`street-ng-oct`, `visit-uk-nov`);
  `utm_source` = `instagram`/`facebook`/`tiktok`/`google`; `utm_medium=paid`. The dashboard then shows landed → play → stayed →
  activation → D7 per video without any other tool.
- A video gets **$5–8 of spend** and then is judged on two numbers: hook rate (3-second views ÷ impressions, from the platform; keep
  above 25% on TikTok, 20% on Meta [V]) and **landed→play** (ours; the entry page's own baseline is 28%). Cut the bottom third; make two
  new variants of the winner's hook each week.
- Start every campaign with 3 videos, never 1 (Advantage+ needs choice [V]).
- Three weeks is the fatigue clock: a winner is remade (new first 3 seconds, same body) before week four.

## 5. Implementation: what to build before the first naira is spent

Everything below lives in the repo; nothing requires a third-party script in the page, so the Content-Security-Policy (`script-src
'self'`), the consent sheet and the privacy page's promise ("no advertising based on your data") stay true. The platforms get
**aggregate conversion signals** keyed by their own click id, never a player id.

### 5.1 Click ids on landing (half a day)

`src/quick-start/entry.ts` already keeps the four `utm_` words in `sessionStorage` (`aw-src`). Extend it to keep, for this session only,
`fbclid`, `ttclid` and `gclid` (and `wbraid`/`gbraid` for Google). `src/app/features/growth/attribution.ts` already posts `landed`,
`play`, `game`, `stayed` to `POST /api/growth/source`; add the click id to that body. The server cleans it as it cleans the words
(`src/game/attribution.ts`: a new `cleanClickId`, `[A-Za-z0-9_.-]{1,255}`). Nothing else about the visit is sent.

### 5.2 Server-side conversion events (two days)

A new `server/growth/adsignal.ts`, called from the `source` route when an event arrives with a click id, sending one event to the
platform that owns that id:

| Platform | Endpoint | Our event → theirs | Identifier | Notes |
| --- | --- | --- | --- | --- |
| Meta Conversions API | `graph.facebook.com/v21.0/<pixel_id>/events` | `landed`→`ViewContent`, `play`→`CompleteRegistration`, `stayed`→`Lead` (custom) | `fbc` = `fb.1.<ms>.<fbclid>`, plus client IP and user agent from the request | Server-only setups score lower on Event Match Quality than pixel+server [V]; we accept that rather than load Meta's script. Each event carries an `event_id` so a later pixel can deduplicate. |
| TikTok Events API | `business-api.tiktok.com/open_api/v1.3/event/track/` | `play`→`CompleteRegistration`, `stayed`→`SubmitForm` | `ttclid` in `context.ad.callback`, IP, UA | |
| Google Ads | Offline conversion import (sheet or API) | `play`, `stayed` with the `gclid` and time | `gclid` | Exported from the metrics store as a daily CSV the owner uploads; no Google tag on the page. |

Secrets as Worker secrets (`META_PIXEL_ID`, `META_CAPI_TOKEN`, `TIKTOK_PIXEL_ID`, `TIKTOK_EVENTS_TOKEN`), as `BACHS_API_KEY` is held.
Events go out `keepalive`, after the response, never on the request path. A failure is counted (`adsignal.failed.<platform>`) and dropped.
Privacy page: one new sentence under Technical records ("if you arrive from an advert, the advert platform is told that its link was
opened and played, by the link's own id; nothing about you").

**Fix in the same change**: the activation report has an `unknown|unknown|unknown` row with activations but no landings. `noteActivated`
is reading a source the life did not store at hello. Store `src` at the first hello for every life (not only when words exist), and count
`direct` otherwise, so the activation and D7 columns on the Admin dashboard carry the same labels as `sources`.

### 5.3 Cost in the dashboard (one day)

The Admin dashboard already shows landed, Play, activation and D7 per campaign. Add a small admin setting `adSpend` (a list of
`{campaign, day, amount, currency}` the owner types in from the platform once a week) and three derived columns: **cost per Play**,
**cost per stayed**, **cost per D7 return**. That is the whole measurement stack; no MMP, no third-party dashboard.

### 5.4 Pre-flight on the landing pages (half a day)

- Every advert address must answer under 1.5 s on a 4G phone with the card visible (Phase 1 measured 0.6 s to Play on the street page).
  Re-run `npm run test:smoke` after any change to `src/quick-start`.
- The `/street/lagos/<place>` previews, `/visit/lagos` and `/` each get a fresh 1200×630 link picture from the real game (the ad
  platforms show it in link previews and in Facebook Feed ads).
- Deep links from the TWA: `/street/...` must open inside the installed app (the manifest's scope already covers it; verify once on the
  emulator).

### 5.5 Owner's accounts and the parts code cannot do

| Item | Why | Notes |
| --- | --- | --- |
| Meta Business portfolio, Pixel/Dataset id, CAPI token | §5.2 | Create the dataset in Events Manager, no script needed; create the token under *Settings → Conversions API*. |
| TikTok Ads Manager (Nigeria), Pixel id + Events API token | §5.2 | Available to Nigerian businesses [V]; set the account currency to USD. |
| Google Ads account; conversion actions `play`, `stayed` as *Import → Other data sources → Clicks* | §5.2 | |
| **A dollar card** | Nigerian naira cards are routed to international gateways and declined or capped at $20/month [V]; Meta, TikTok and Google all bill in USD | A virtual USD card (Grey, Figo, etc.) or a UK/US card. Meta adds 7.5% VAT on Nigerian ad accounts. |
| **ARCON vetting of Nigeria-facing adverts** | ARCON's mandate over online ads was upheld by the Federal High Court (April 2025) and it began fining online businesses ₦1m for unvetted digital ads in March 2026 [S/V] | Vet the nine first-wave videos (about ₦7,500 each at the 2023 normal rate; confirm today's). Diaspora adverts aimed at the UK/US/Canada are not Nigeria-facing. Do this before the Nigeria campaigns go live; the diaspora campaign can start first if vetting is slow. |
| A lawyer's one-line reading of `/privacy` after the §5.2 sentence | NDPA/GAID 2025 | Already pending from the Play work. |

## 6. Timing: the calendar

| When | What | Why |
| --- | --- | --- |
| **Week of 27 Oct** | Build §5 (three to four agent-days), record the nine videos, open the accounts, submit ARCON vetting | The category is hot *now* after the competitor's 1 October launch; every week of delay is lost attention |
| **3–16 Nov (Wave 1)** | Nigeria Meta `street` + `people` angles, Google Search; TikTok from 10 Nov; $10–15 a day total | Learn the hooks and the landed→play per video; exit learning on `play` within a week (§7) |
| **17–30 Nov (Wave 2)** | Keep the two best videos per angle; start **Visit home** on Meta UK/US/CA at $5 a day; first ARCON-vetted creative on TikTok | The diaspora books December travel and calls home more; our December words switch on automatically on 1 Dec |
| **1–31 Dec** | Detty December: `/detty` and `/visit/{lagos,accra,abuja}` carry the season's words; raise the diaspora budget to match Nigeria's; weekends and 25–31 Dec heaviest | The one season when a Nigerian social game has a reason to exist to every Nigerian abroad; Calabar Carnival 26–30 Dec is in the events calendar |
| **Jan 2027** | Pull all Nigeria spend to a floor from 9–20 Jan (presidential election 16 Jan): CPMs rise, ad review tightens, SIEP flags spike | Never run the governor advert in that window |
| **Feb 2027 onward** | Google App campaigns on Android once the Play listing is public and version 2 is live; Nairobi and Accra city campaigns; YouTube Shorts test | Second platform wave only after the Admin D7 column shows a campaign at or above 8% |

Daily pattern throughout: dayparting 17:00–23:00 WAT in Nigeria, weekends all day; local evenings for the diaspora (§3).

## 7. Budget and the optimisation rules

The owner's spend tolerance is small (AI spend is capped at $2 a day), so the plan is built for **$300–450 in the first month** and
scales only on evidence.

| | Nigeria | Diaspora | Search |
| --- | --- | --- | --- |
| Daily, Wave 1 | $8 (Meta) + $5 (TikTok from week 2) | 0 | $2 |
| Daily, Wave 2 | $10 | $5 | $2 |
| Expected landings a day at $1.50 CPM and 1.5% CTR [V] | 80–130 | 4–8 | 10–20 |
| Expected Play a day at 28% [F] | 25–35 | 1–2 | 4–6 |
| Events a week on `play` | ~200 | ~10 | ~35 |

**Rules, in order of importance**

1. **Optimise for `play`, not clicks or landings.** Clicks buy clicks [V]. Meta's own developer guidance wants about 50 optimisation
   events per ad set per 7 days to leave the learning phase [S]; at these budgets `play` reaches that in Nigeria within days, `stayed`
   would not. Once a campaign makes 50+ `stayed` a week, switch its optimisation to `stayed`. Diaspora ad sets will stay in "learning
   limited" at $5 a day; that is acceptable for a test, read them on `stayed` by hand.
2. **One campaign per country slice, Advantage+ campaign budget on, three ad sets at most** (one per angle), so the 50-event threshold
   is pooled at campaign level [V].
3. **Do not touch a campaign for 5 days** after a change; edits to budget, audience or creative restart learning [S/V]. Scale by
   +20% at a time, at most twice a week [V].
4. **Judge on cost per stayed and the D7 column, never on CPM or CPC.** A Nigeria video that costs under **$0.40 per stayed** player
   and lands a cohort at D7 ≥ 8% gets doubled; one above $1.00 per stayed is cut, whatever its click rate.
5. **Cap frequency at 2 a week** on Meta (Reach & frequency is not available at this size, so use the Advantage+ default and watch
   the frequency column; above 3, add creative or widen the audience).
6. **Exclude Audience Network and in-stream video** on Meta; on TikTok, turn off Pangle and the Global App Bundle.
7. **Check landed→play per `utm_content` every morning** on the Admin dashboard. A video whose landed→play is under half the page's
   organic 28% is sending the wrong people (or an accidental-click placement); pause it the same day.
8. **Retention gates the scale.** If the paid cohorts' D1 stays under 20% after Wave 1, stop scaling and spend the next sprint on the
   first sixty seconds (Phase 6 notes, the owner's five-strangers test) instead. The social world only pays back when people meet
   people; buying ten strangers into an empty street is money lost twice.

## 8. What "working" looks like, and when to stop

| Signal after four weeks | Decision |
| --- | --- |
| Cost per stayed ≤ $0.40 (NG) and a campaign D7 ≥ 8% | Double the Nigeria budget monthly; open Accra, Nairobi; start App campaigns |
| Cost per stayed ≤ $0.40 but D7 < 5% | Hold spend at the test level; fix the first session; retest in two weeks |
| Cost per stayed > $1.00 across all videos | Stop paid; the creative or the landing is wrong, not the audience; remake the hooks |
| Diaspora cost per stayed ≤ $3 and D7 ≥ 8% | Keep it, grow it through December, shrink it in January |

## 9. Decisions for the owner

1. Approve the first-month budget: about **$300–450**, dollar card needed.
2. Google Search keywords on the category name ("lagos life game", "nigeria life simulator") touch the competitor's name. Our rule is
   never to name it in public text; a keyword is not public text, ad copy would be clean. Yes or no?
3. ARCON vetting first (two to three weeks, a fee per creative) or diaspora-first while it is pending?
4. Server-side signals only (recommended, no third-party script, the privacy promise holds) or also Meta's pixel behind the consent
   sheet for better match quality?
5. The nine videos: recorded by an agent from the game with a synthetic Pidgin voice, or by a Nigerian creator (nano creators quote
   roughly ₦65,000–₦390,000 a video [V]; one real face would help the "people are in it" angle)?

## 10. Not in this plan, on purpose

Influencer deals above nano size, App Store (iOS) ads, offline or OOH, any "earn money" claim, the governor advert before February 2027,
and any purchase of installs from incentivised networks (they poison the D7 line this whole plan rests on).

## Sources

Platform and regulator documents: TikTok creative best practices (ads.tiktok.com/help/article/creative-best-practices); Meta
developer guidance on learning (developers.meta.com, "minimum of 50 events over a 7-day period"); Meta Ads about Social Issues,
Elections or Politics (transparency.meta.com/policies/ad-standards/siep-advertising/siep); Meta Audience Network policy
(developers.facebook.com/docs/audience-network/optimization/best-practices/an-policy); Google Ads mobile app conversion tracking
(support.google.com/google-ads/answer/6100665); Google Demand Gen (developers.google.com/google-ads/api/docs/discovery/overview);
DataReportal Digital 2026: Nigeria; Soehl, Chen & Erlich 2026, targeted Facebook ads for Nigerians at home and abroad
(doi.org/10.1177/00491241241266634); LawPavilion on ARCON's vetting mandate and the April 2025 Federal High Court ruling.

Vendor and press (directional): FoxData, Mistplay, GameBiz Consulting and Semnexus on 2026 CPI and channel share; Adamigo, Stackmatix,
Adligator and Grey on Nigeria CPM/CPC and paying for ads from Nigeria; Spendfigo on card declines; BusinessDay on ARCON fines (March
2026); Leadership, Vanguard and Condia on the competitor's October 2026 launch; Jon Loomer and ClickCease on Audience Network quality;
Growth Gems, RevenueCat and Cometly on proxy-event optimisation; Kolsquare on 2026 African platform reach; Elev8or on Nigerian creator
rates; Liftoff on IMVU's growth (cross-platform, acquisition + retention together, in-app hooks).
