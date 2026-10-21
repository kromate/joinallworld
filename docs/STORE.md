# Allworld on Google Play — draft readiness checklist

**Status: draft.** This document is a source-based preparation checklist, not proof that an Android package has been reviewed, approved, published, or adopted in production. Confirm every product, privacy, audience, and testing statement against the exact release build and live service before submission. Do not place signing material, private credentials, account details, or personal paths in this repository.

Allworld is an early-beta browser game presented in an Android Trusted Web Activity. Its intended experience is a digital world of real places where players make characters, explore cities and venues, work, travel, make friends, play table games, and find a home. Play availability, feature readiness, and catalogue counts must be checked against the release build and live catalogue on the day of submission.

## 1. App setup and release identity

- **Name:** Allworld.
- **Package name:** `com.joinallworld.app` (confirm it matches the release package).
- **Default listing language:** English (United Kingdom); prepare English (United States) as a separate language listing.
- **App type and category:** choose the current Play Console app/game classification and Games → Simulation only if that remains the best fit for the release build. Reconsider Casual if the actual gameplay warrants it.
- **Price:** set only after confirming the owner’s distribution and monetisation decision. Do not describe the app as free unless that accurately describes the full release and its monetisation.
- **App integrity:** Play App Signing and Digital Asset Links must be configured with the correct certificates for the exact package and verified from the installed Play test build. Never publish certificate secrets or signing instructions here.
- **Wrapper version:** record the actual package version/build code used for each test and submission. If manifest shortcuts or other wrapper configuration changes, prepare a new wrapper version and have the package owner rebuild and sign it.

## 2. Source and review gates

Before submission, confirm all of the following against the candidate release:

- The full-screen Android experience opens the intended production site, with app links verified and no address bar in the installed build.
- The app provides a useful offline/error state and recovers when connectivity returns. Do not claim offline gameplay or cached world content unless tested and implemented.
- Guest play reaches the world without sign-in. If account sign-in is required for any review path, provide working Play reviewer access through Console’s private app-access field; never publish credentials in this document.
- Terms, age declaration and acceptance behavior match the server-enforced sharing rules. Check both an existing account and a guest in a fresh session.
- Report and block controls can be reached from player profiles, direct messages, feed posts, shared pictures, shop pages, and room/voice participant lists. Test each action on controlled test actors in a local or closed-test environment only.
- Account deletion is described on a public web page outside the app. Reconcile the public privacy wording with the actual erasure implementation, retained records, media expiry and support path before submitting.
- App-mode payment restrictions are verified at both the UI and server boundary. Digital goods must not direct users to external payment in the Play app. Physical goods and real-world services may use seller-managed contact/payment only where current policy and the release implementation allow it.
- Store copy and graphics show current, working features. Remove claims for unavailable cities, games, travel modes, commerce, safety outcomes, or account controls.

## 3. Graphics checklist

Google Play’s current preview-asset requirements are described in [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151). Confirm exact upload requirements in Console before preparing final assets.

- **App icon:** 512×512 PNG, 32-bit with alpha, within the current file-size limit. Use the current app mark without ranking, price or platform badges.
- **Feature graphic:** 1024×500 JPEG or 24-bit PNG without alpha. Show the world-to-street idea; keep the focal point away from crop zones; avoid prices, ranking language and unverifiable claims.
- **Phone screenshots:** up to eight current app screenshots for each supported device type. Prepare a coherent sequence: city/world, home, friends/chat, a game, travel, nearby people, a shop, and safety/report controls. Capture only the actual current UI; no fabricated players, reviews, awards, balances or outcomes.
- **Large-screen screenshots:** if distributing to tablets or other large-screen devices, provide the current device-specific minimum set and optimise the actual release experience for those devices.
- **Alt text:** supply accurate, concise descriptions for each uploaded graphic.
- **Promotional video:** optional. Use only approved footage with rights cleared and no financial, earnings, ranking or age-inappropriate claims.

Play notes that listing preview assets may be shown across test tracks. Review their accuracy and test-track visibility before uploading. See the same [preview asset guidance](https://support.google.com/googleplay/android-developer/answer/9866151).

## 4. The listing

### English (United Kingdom)

Title (24/30):

> Allworld: Real City Life

Short description (78/80):

> A social life sim in real cities. Make a home, meet friends and play together.

Full description (1649/4000):

> Build a life in real cities, with a home, friends and a world to explore.
>
> YOUR CITY LIFE
> Allworld is a social life sim set in real places. Choose a character, find a home, furnish your rooms and explore streets, parks and markets. Work towards your own goals and take life at your own pace.
>
> A VIRTUAL WORLD OF REAL PLACES
> Explore 284 real cities. The world atlas covers 243 countries and territories. Start in Lagos, discover Accra or Nairobi, and browse destinations around the world. Travel by road and air, visit local landmarks and make each city part of your story. The atlas shows where you can go next.
>
> FRIENDS, CHAT AND VOICE
> Meet friends in your city or at the Square. Send messages, share pictures and join voice when you choose. Build communities and make plans together. This social life sim lets you decide when to spend time with people and when to explore on your own.
>
> BOARD GAMES AT REAL PLACES
> Sit down for Whot, Ayo or chess at tables around the city. Take a break with board games, try a daily word puzzle or meet a friend for another round. Games are part of your city life, alongside home, work and travel.
>
> LOCAL SHOPS AND SERVICES
> Visit shops for real businesses and services in the virtual world. Browse what they offer and message the seller directly. Allworld does not collect payment for these seller conversations.
>
> PEOPLE AND AI CHARACTERS
> AI characters are clearly labelled. You can report content or players and block unwanted contact. Read Allworld's rules before your first message, post, picture or voice join.
>
> Allworld is for people aged 13 and over. In-game naira and coins have no cash value. Some parts of the world are still in beta.

Catalogue figures were displayed on the live entry page on 20 October 2026: 284 cities, 243 countries and territories. Recheck them on submission day. The minimum age remains a 13+ draft pending the audience decision and legal review.

### Country listings and localisation

Prepare separate country-focused custom store listings for Nigeria, Ghana, Kenya, South Africa, the United Kingdom, and the United States. Each opening line and first screenshot must use a city that is currently open and playable in that market. City files in the source tree are not proof of live availability. Use neutral copy if a suitable live city cannot be verified. Keep English (UK) as the default and use standard spelling and punctuation for English (US) in that language listing.

Candidate first-line city choices, subject to live verification: Lagos; Accra; Nairobi; Cape Town; London; New York. Do not say “other open cities” unless more than one is confirmed open in that market.

### Version 1 release notes draft (≤500 characters)

> Explore a city, make a home, meet people and play together in Allworld. This release brings the world to Android with guest play, city exploration, social features and an offline connection message. Some destinations and features are still in beta.

Use only after the release build supports every feature named above. Replace this with actual release changes if the package differs.

### Category and tags

**Recommended category:** Games → Simulation, because the core loop is building an avatar’s life across cities, homes, work, travel and social play. Confirm the current Console category options and reconsider Casual if it better describes the shipped game.

**Candidate tags:** Simulation, Social, City building, Board games, Role playing. Select only tags available in Console that fit the release build; do not use tags as keyword stuffing.

### Store listing experiment

Run one experiment after the listing has enough traffic to compare variants. Keep all other listing fields fixed and choose the primary Play Console metric before starting.

- **A — City scene:** screenshot 1 shows a current, legible real city or venue with the player character visible.
- **B — Life choice:** screenshot 1 shows the current in-game atlas or city-selection experience, with no extra promotional claim.

Record the experiment dates, exposure and observed outcome. Do not call a winner without sufficient measured data. A separate private working draft may contain localisation and experiment notes; public repository documents must contain no unverified performance claims.

### Search and keyword evidence

Do not claim keyword research or real Play search suggestions unless suggestions were collected and dated from Play Store search. Use relevant words naturally in the listing copy, such as life simulation, virtual world, real cities, avatar, friends, chat, board games, home, and travel. Never include another app’s name or a detached keyword list in public listing text.

## 5. Console forms — prepare from the release build

- **Privacy policy:** `https://joinallworld.com/privacy`. Confirm it is reachable without sign-in and agrees with the current collection, sharing, retention and deletion behavior.
- **Account deletion URL:** `https://joinallworld.com/privacy#delete`. Confirm that the page explains an outside-the-app deletion route, what is erased or retained, actual retention periods where known, and a verified contact route for people unable to sign in. Do not submit until the public wording and erasure code agree.
- **Data safety:** inventory data from Allworld and every configured third-party script/SDK. For each type, record collection, purpose, optionality, sharing, encryption in transit, retention, and deletion availability. Do not infer a value from a development default if the production deployment enables a service.
- **Content rating (IARC):** disclose user-to-user text, voice, public posts, uploaded pictures, relevant political/game content and all monetisation accurately. Board/card games use in-game currency; do not call them real-money gambling unless the release introduces real-money stakes or prizes. Answer every questionnaire prompt from the actual release content; do not aim for a lower rating.
- **Target audience:** provisional default is 13+ and not designed for children. The owner must confirm the target-age decision and review store art/copy for child-directed appeal. The game has social chat, voice and user content.
- **Ads:** source contains player-rented in-world billboard/sea ad placements and boosted business listings labelled “Sponsored”. If either remains visible in the Play build, do not declare “no ads”; either declare the surfaces accurately or verify they are fully suppressed for Play. No third-party ad-network SDK was found in this source review, but that is not the whole ads declaration.
- **Government, news, health and other declarations:** answer “no” only after checking the release features and Console definitions. Political systems in the game are not by themselves proof that the app is a news or government service.
- **App access:** explain that guest play needs no sign-in. Give any reviewer account and entry instructions only through Play Console’s private access form; verify credentials immediately before submission.
- **Contact details:** use an owner-verified support/privacy contact address and test delivery. Do not invent or publish an unverified mailbox.

## 6. Closed testing and production access

Google’s current guidance for new personal developer accounts requires a closed test with at least 12 testers opted in continuously for at least 14 days before applying for production access. Confirm the account type and current Console requirement; see [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465).

Recruit 15–20 genuine testers to allow for dropouts. Share the opt-in link privately, explain that testers should remain opted in for the full continuous period, and ask them to exercise the actual release features. Never fabricate tester accounts, usage, feedback, dates, or install numbers.

A practical 14-day coverage plan:

| Day | Suggested task |
|---|---|
| 1 | Install, open as a guest, choose a character and enter an open city. |
| 2 | Explore a venue and use the map/atlas. |
| 3 | Visit a home and test its available actions. |
| 4 | Try an available work activity and verify in-game currency is described clearly. |
| 5 | Play a shipped board/card game with another tester or a clearly identified game character. |
| 6 | Send a direct text message; test report and block only with consenting test accounts. |
| 7 | Use the public feed and report/block controls on a test post. |
| 8 | If enabled for the track, test picture upload, visibility and report behavior with non-sensitive test material. |
| 9 | If enabled, test voice join, mute/leave and participant card moderation. |
| 10 | Travel to another currently open city. |
| 11 | Browse a shop and test seller messaging; do not make a real payment. |
| 12 | Review privacy, terms, age and account-deletion instructions. |
| 13 | Re-test the most important flows after the test update. |
| 14 | Submit final feedback and confirm the tester remains opted in. |

**Invite text draft:**

> Would you help test Allworld on Android? Join the closed test here: [OPT-IN LINK]. Please stay opted in for 14 days and try the tasks we share. This is a test build; please do not use real payment details or sensitive personal content. Send issues and suggestions through [VERIFIED FEEDBACK CHANNEL].

**One-minute feedback form:**

1. What device and Android version did you use?
2. Which tasks did you complete?
3. What did you expect to happen, and what happened instead?
4. Did you encounter a crash, blocked screen, unclear wording or accessibility issue? Where?
5. Could you find report, block, privacy and account-deletion controls?
6. What should be fixed before production?

**Test log fields:** tester pseudonymous ID; opt-in date/time; device/Android version; app version; tasks attempted; observed issue; feedback source/date; triage owner; fix or decision; fixed build/date; retest result; continuous opt-in confirmation. Keep personal tester contact information outside this repository.

**Production access answers:** draft only after the test. Report the actual recruitment method, continuous opt-in count/dates, feature usage, differences from expected use, feedback themes, changes shipped during testing, remaining issues, intended audience, value proposition, and evidence-based first-year install estimate. Leave blanks until real test data exists. Do not invent numbers or state that an update shipped until verified.

## 7. Review risks and unresolved owner facts

1. **Current status:** all listing and policy responses remain drafts until exact-source checks and Play Console review are complete.
2. **Minimum functionality:** demonstrate useful app behavior beyond an empty web page, deep links, network recovery and the actual shipped game. Do not claim offline play if only an offline notice is available.
3. **Digital payments:** Google Play’s current payments policy applies to digital goods and services. Validate all payment entry points at the client and server boundary for the Android app. Do not expose external payment for digital goods.
4. **User-generated content:** verify the rules acceptance step is enforced before sharing, and that report/block actions cover every UGC surface advertised. Feed replies, live voice incidents and moderation response operations need explicit review if they are not supported by the release.
5. **Account deletion:** the public deletion statement must match the implementation. In particular, review whether posts, messages, uploaded pictures/voice, listings, audits and account identifiers are erased, retained or anonymised. Publish only retention periods supported by actual code/configuration and operational practice.
6. **Audience and age:** the working default is 13+, pending the owner’s target-age choice and policy/legal review. Do not target children or select a child-inclusive audience without completing the applicable family requirements.
7. **Support address:** a contact mailbox has not been verified in source review. The owner must provide an address, verify delivery and approve its publication.
8. **Configured services and promotions:** inspect production environment flags, third-party script behavior, in-world billboards and “Sponsored” business listings before completing Data safety, Ads and analytics answers.
9. **Phone quality:** test the 3D world and core social flows on representative lower-end Android devices. Desktop performance does not establish phone performance.
10. **Changing requirements:** recheck current Play Console forms, target API requirements, content policy and artwork limits immediately before submission.

## 8. Web install and iOS notes

The website can be added to a device’s home screen through supported browsers. Describe this only as an installable website experience; do not imply an iOS App Store app exists unless one is separately released. Confirm the current install prompt and standalone behavior on supported devices.

## Exact moderation taps

| Surface | Report | Block |
|---|---|---|
| Player profile | Phone → People → select player → Report → reason → Send report | Same player card → Block → confirm |
| Direct message | Phone → Messages → conversation → message action → Report | Conversation header → sender card → Block |
| Feed post | Phone → Feed → post → Report → reason → Send | Post author → player card → Block |
| Shared picture | Messages → incoming picture → expand → Report picture | Close picture → sender/header → player card → Block |
| Shop | Phone → Services or Shops → shop → Report shop, or picture → Report picture | Same shop page → Block owner → confirm |
| Voice room | Community → Around you → participant → Report | Same participant card → Block; Leave voice is always available |

A live voice incident is reported against the participant with a description; the game does not secretly record live room audio. Private test fixtures must be used for report and block demonstrations.

## Reviewer email access steps

Use a dedicated verified email address. In any browser open Allworld → Log in → Email and password. New reviewers can choose Create account, follow the verification email and return to sign in; no SMS is required. Verify that the same character returns after signing out and back in, and test Forgotten password. Supply the verified address and password only in the private App access form. Guest Play now needs neither email nor password.

## Candidate app behaviour

Play mode hides external digital checkout, Earn and creator-pool flows, generic seller-payment links, real-earnings prompts, sponsored cards and billboard placements. Physical shop browsing and messaging stay available. Requests marked `X-Allworld-App: play` are refused at the corresponding server payment routes. Rating requests are lazy and disabled unless the public-release build explicitly enables `VITE_PLAY_RATING_PROMPT=on`.

The web manifest includes Map, Messages and Near you shortcuts with 96px icons. The package owner must rebuild the Android shell as version code 2 to package the shortcuts, then test the signed Play-installed build. The website changes alone do not rebuild an Android package.
