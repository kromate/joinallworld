# Real-life value: earn, sell, learn and get hired in Allworld

Status: design, 7 October 2026. Nothing below is implemented. This is Phase R in `REALISM-PLAN.md`.

Research was desk research only. No lawyer has reviewed it. Web search returned no results and the primary sites (Roblox, ARCON) blocked direct fetches while this was written, so nothing here was verified online. Figures marked [?] are unverified and must be checked against a primary source before they appear in product copy, ads or legal text.

## Why players would switch

Lagos Life, PH Lifestyle and SF Life sell attention inside the game: billboards, plots and stats. None of them pays players or helps them in real life. The money only goes one way.

Allworld can be the place where a Nigerian's real life gets better because they play:

- A tailor gets customers.
- A developer gets a gig.
- A student finishes a class with a badge they can show an employer.

These benefits stay after the game session ends. They also give players something to come back to every day that a rival game cannot copy just by adding more content.

The demand is large, and so is the trust problem:

- About 83% of Nigerian consumers have bought directly through social media, and about half report a financial scam in the past year (Visa Stay Secure survey) [?].
- Buyers have no way to tell an honest vendor from a scammer. That gap is the product.

Allworld does not try to be a payment app. It tries to be the most trusted place to find a real person who sells, teaches or hires, and to meet them in a world that feels like home.

## What the market teaches

| Model | What happened | Lesson |
| --- | --- | --- |
| Roblox DevEx | Creators cash out earned Robux at about $0.0038 each, with a 30,000 Robux minimum. Bought Robux cannot be cashed out [?]. | A payout scheme works when it pays only from real revenue, through KYC, and only to creators. |
| VRChat creator economy | Payouts go through a licensed partner (Tilia), and bought credits cannot be cashed out [?] | Never hold the money yourself. |
| Fortnite creator pay | Paid from a fixed share of real revenue, by engagement [?] | Pay from a revenue pool, never by printing currency. |
| Axie and the Nigerian scholar guilds, CBEX (₦1.3T reported lost), MMM | Earnings ran on new deposits and collapsed. | Never sell "earn" as an investment. Never sell a cashable token. |
| Lagos Life | About 1.2M players [?]. Sells billboards (₦50k per week), sea plots and stats ads [?]. No cash-out, no jobs, no verified shops. Had an exploit and a reset [?]. | Players will pay for visibility. Nobody yet offers them real outcomes. |
| Selar | Paid out more than ₦4B to over 150k Nigerian creators in 2023 [?] | Nigerians already sell skills and digital goods online. Link to the tools they use. |
| Jiji | SmileID checks, but scams persist [?] | An ID check alone is not trust. Complaint history and reporting matter too. |
| Fiverr and Upwork | Nigerian freelancers are paid through Payoneer or Grey [?] | Cross-border sellers bring their own payout rails. |
| ALX Africa | More than 205k learners [?] | Free, credentialed learning with a cohort draws big numbers. |

No competitor offers a combination of verified shops, gigs and skill badges.

## Features, ranked

| ID | Feature | What it does | Money level |
| --- | --- | --- | --- |
| RV1 | Verified stalls | A player's real business gets a stall in their district and on the city market street. The stall shows photos, prices in naira and a verification badge. It links out to the seller's WhatsApp, Instagram, Selar, Paystack page or website, through a warning screen. Allworld never takes the payment. | L0 |
| RV2 | Skills Passport | A profile of skills with an "open to work" flag. Every skill is marked either self-claimed or verified, with links to issuers such as ALX, Coursera or a GitHub profile. Other players see it when they tap the character. | L0 |
| RV3 | Gig board | Posts by verified employers, with a district and a pay range. Any post asking the worker for a fee is blocked. Contact details are shown only after both sides agree. Reporting is one tap. | L0 |
| RV4 | Live classes at UNILAG | Verified instructors run a scheduled class in a real room. Attendance and a short check earn a badge for the Passport. There are no payments inside the room. Builds on `src/campus/unilag/`. | L0 |
| RV5 | Skill swap | "I teach you Canva, you teach me Excel." Both sides confirm the swap happened. Gives reputation, not money. | L0 |
| RV6 | District notice board | A physical board in each district for lost-and-found, events and wanted ads. Posting is rate-limited, organic only and never paid (see L1). | L0 |
| RV7 | Seller analytics and share card | Shows stall visits counted as unique signed-in players, link taps and saves. A share card to post on WhatsApp and Instagram brings new players in. | L0 |
| RV8 | Learning quests | Quests finished on outside sites (ALX, freeCodeCamp, Google Skillshop), verified by the issuer's public certificate URL. | L0 |
| RV9 | Co-working café | A quiet place for focus sessions with friends: a timer, "do not disturb" and a shared table. A brand could later sponsor it (L1). | L0 |
| RV10 | Meetups | Real-world meetups in public venues, for groups only and for players 18 or older. They need an organiser with a verified ID. | L0 |
| RV11 | Referral perks | One level only. The reward is cosmetic or a free stall boost, never cash. | L0 |
| RV12 | Escrowed gig pay | Pay for a gig through a licensed escrow partner. Allworld is never the payee. | L3, later |

Ship order:

1. The trust layer (below).
2. RV1 with RV7. Sellers bring their own customers, and every share card is free marketing.
3. RV2.
4. RV3 with RV6.
5. RV4 with RV8.
6. RV5, RV9, RV10 and RV11.
7. RV12, only after L3 is cleared.

## The trust layer (ships before any feature)

**Verification tiers**

| Tier | How | Badge |
| --- | --- | --- |
| T0 | An account that has been claimed | None |
| T1 | Phone number confirmed by OTP | "Phone confirmed" |
| T2 | ID check through a provider such as SmileID or Dojah. Allworld stores only the result and a reference; never a BVN, NIN or ID image. | "ID verified" |
| T3 | Business checked by a CAC lookup, or a visit by a trusted local partner | "Business verified" |

Stalls need T1. Gig posts and classes need T2. Meetups need T2 and age 18 or over.

**Rules every feature follows:**

- **No fees from workers or students.** The text filter blocks gig posts that ask for a registration fee, "processing fee", training fee or deposit, and reports are reviewed first.
- **Complaint counts are public.** A stall or employer shows how many upheld reports it has received in the last 90 days. A third upheld report hides the listing until a person reviews it.
- **A warning screen before every outside link.** It shows the domain, the seller's tier, the complaint count and "Never pay before you see the goods or meet in a public place." Links are restricted to an allow-list of domain patterns: wa.me, instagram.com, selar.com, paystack.shop, flutterwave.com, tiktok.com, x.com, linkedin.com, github.com and verified seller websites. A raw link a user types into chat or a post is not allowed.
- **The vendor-link exception to chat blocking.** Reliability lane L7 (PR #4) blocks links and phone numbers in chat. That stays. Stall and gig pages are the only places a link or a WhatsApp number may appear, and only through structured fields shown behind the warning screen.
- **Report and hide.** Every stall, gig, class, notice and passport has a one-tap report with reasons: scam, fee request, fake item, abuse, under 18. Hiding takes effect for the reporter at once.
- **No home addresses, anywhere.** Errands and meetups use public pickup points: a bank hall, mall, school gate or motor park. In March 2025 a Lagos vendor was reportedly abducted after a delivery [?].
- **Age.** Commerce, gigs, meetups and any money level from L2 up are 18+. Guests can browse stalls and classes, but cannot post, contact or verify.

## Money ladder

Each level opens only when its trigger is met and Anthony signs off. Production runs L0 only until then.

| Level | What | Trigger before opening | Main rules (desk research) |
| --- | --- | --- | --- |
| L0 | No money moves through Allworld. Stalls link out; classes and gigs are free to post. | Trust layer live | NDPA 2023 and the GAID 2025 data rules: consent, a privacy notice, minimal data and a DPO contact. Notice boards must be organic: they carry no paid ads. |
| L1 | Paid visibility: billboard and stall boosts, plus brand sponsorship of venues | A registered CAC company, a VAT registration, and a lawyer's note on ARCON | ARCON is reported to require vetting of every advert before it is shown, online too (Federal High Court ruling of 30 April 2025 and a May 2025 directive), with fees of roughly ₦7,500–₦100,000 and fines up to ₦1M [?]. The ad template therefore needs an ARCON approval reference field and a takedown control. No betting, loan or investment adverts. FCCPC consumer rules apply. |
| L2 | Buy coins for cosmetics and boosts | L1 cleared, plus Paystack or Flutterwave approval for virtual goods | Coins cannot be cashed out or transferred. No loot boxes. VAT at 7.5% (Nigeria Tax Act, in force 1 January 2026) [?]. A published refund policy. 18+ to buy, or a parent's approval flow. |
| L3 | Player-to-player sales and escrowed gig pay | A lawyer signs off on SCUML, FCCPC and escrow | Allworld is never the payee. Sellers use subaccounts with a payment gateway, which does the KYC. Settlement is delayed or held in escrow, with a dispute path. |
| L4 | Payouts to creators | CBN and SEC advice in writing | No coin-to-naira exchange. A wallet that can be cashed out is probably e-money and needs a licence. Under ISA 2025 s.357, digital assets count as securities [?]. Gambling is regulated by each state since the November 2024 Supreme Court ruling [?]. Any payout must come from real revenue (ads or sales), go through a licensed provider, and need a TIN or NIN. |

Sellers abroad use their own Payoneer, Grey or Wise accounts. Allworld only links to them.

## Red lines

- No coin or token that can be cashed out or traded.
- No multi-level referrals and no cash for referrals.
- No loot boxes, raffles or paid chance of any kind.
- Allworld never holds users' money.
- No home addresses, and no direct messages that skip report and hide.
- No "earn while you play" marketing that sounds like an investment.

## What to reuse and what is new

**Reuse:**

| Existing code | Use |
| --- | --- |
| `server/business/service.ts`, `docs/BUSINESS.md` | In-game shops already store only public ids and names. A verified stall is an in-game business with a verified owner, plus outside-link fields. |
| `src/campus/unilag/{curriculum,content,games,scene}.ts` | Rooms and course structure for live classes and badges. |
| `server/moderation/{service,terms,text}.ts` | Report reasons, the fee-request filter and the domain allow-list. |
| `src/game/content/civic-ads.ts` | Billboards already in the world. RV6 notices and L1 adverts use the same slots, with the ARCON field added. |
| PR #4 chat filtering | Stays as it is. The vendor-link exception lives only in the structured fields. |

**New:**

- `server/trust/` for tiers, provider results, complaint counts and the link allow-list.
- `server/stalls/`, `server/passport/`, `server/gigs/`, `server/notices/` and `server/classes/`.
- The link warning screen.
- A stall 3D prop on a shared, instanced market-stall model. It loads only near the stall, so stalls add nothing to the bytes at first load.
- Feature flags in `src/models/integration/flags.ts`: `stalls`, `passport`, `gigs`, `notices` and `classes`. They are turned on through `?models=` in staging before anything opens in production.

**Budgets:** none of this may change the first-load or ready bytes. Every panel loads through a dynamic import when it opens, and stall photos are lazy WebP images of at most 60 KB each.

## Questions for a Nigerian lawyer

1. With links out only (L0), is Allworld an "e-commerce platform" under the FCCPC rules? What disclosures are needed?
2. For L1, does Allworld need an ARCON practitioner registration as the publisher, or does each advertiser carry the vetting? What should the takedown control and approval record look like?
3. Do in-game billboards sold to brands count as advertising "exposure" that needs vetting, when the ad is shown only inside a game?
4. For L2, is a non-cashable, non-transferable coin outside CBN e-money rules? What VAT applies to digital goods sold to Nigerians from a Nigerian company?
5. For L3, does the gateway subaccount model avoid SCUML registration for Allworld? Which escrow partners are licensed?
6. Under NDPA and GAID, which verification results may we keep, and for how long?
7. Are we liable for meetups and errands set up through the platform, and what limits should the terms of use carry?

## Sources

Desk research, not verified online: web search returned no results and primary sites (Roblox, ARCON) blocked direct fetches during this session.

Reported but not checked, marked [?] above: the Visa Stay Secure figures, the Roblox DevEx rate and minimum, the ARCON ruling, directive, fees and fines, the Lagos Life figures, Selar's payout totals, VRChat and Fortnite payout details, ALX learner numbers, Jiji and SmileID, the Lagos vendor abduction, the VAT details of the Nigeria Tax Act, ISA 2025 s.357, and the 2024 Supreme Court gambling ruling. Check each one before it appears in product copy or legal text.
