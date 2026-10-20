# Allworld on the Play Store

Phase 5 of [AD-READY-PLAN.md](AD-READY-PLAN.md). The Android app is the website in a Trusted Web Activity (TWA): a thin Android shell that opens
`https://joinallworld.com` full screen, with no browser bar, once Google has verified that the site and the app belong together. There is no second
codebase. This page is the owner's checklist; the code side is done and waits for a Play account and a signing key.

## What is already in the repository

| Piece | Where | State |
| --- | --- | --- |
| Web manifest with name, description, `id`, scope, `start_url=/?utm_source=pwa`, categories, 192 and 512 icons, maskable 192 and 512 | `server/site-files.ts` (made by code; served at `/manifest.webmanifest` by both hosts) | done |
| Digital Asset Links at `/.well-known/assetlinks.json` | `server/site-files.ts`, both hosts | done; answers 404 until `PLAY_SIGNING_SHA256` is set |
| The in-site install bar ("Add Allworld to your phone") | `src/app/features/start/installPrompt.ts`, `installEvent.ts`, `installPlan.ts` | done |
| Package name | `com.joinallworld.app` (`PLAY_PACKAGE_NAME` in `server/site-files.ts`) | chosen; permanent once uploaded |
| Offline page in the installed app | `public/sw.js` (navigation-only fetch handler, page written in the worker, nothing cached), registered by `src/app/features/start/offlineWorker.ts` only in the installed app | done 20 Oct |
| Android package, version 1.0.0 (code 1) | built 20 Oct on the owner's Mac in `~/allworld-twa` (outside the repository); see "Built on 20 Oct" below | built; not uploaded |

The icons: `public/icons/icon-512.png` is the globe on the brand green with the artwork inside the central 80 percent circle, so the same picture
serves as the maskable icon (`icon-maskable-512.png`, `icon-maskable-192.png`: byte-for-byte copies of the 512 and 192 "any" icons).
There are **no store screenshots** in `public/`, so the manifest lists none (it must not list pictures that do not exist); see "Graphics" below.

## 1. The Play Console account (owner)

1. Create a developer account at <https://play.google.com/console> (a one-time fee of about 25 US dollars). Use the company name if the company will
   own the app (an organisation account asks for a D-U-N-S number; a personal account may have to run a closed test with a minimum number of testers
   for a minimum number of days before production: read the current rule in the Console's "Create app" flow, it has changed before).
2. Create the app: name `Allworld`, default language English (Nigeria or United Kingdom), type App, free.

## 2. Build the Android package

Do this outside the repository (an empty folder, for example `~/allworld-twa`); it holds a signing key that must never be committed.
Either tool makes the same kind of package.

**Bubblewrap (command line, Node and a JDK; it offers to download the Android tools)**

```
npx @bubblewrap/cli init --manifest=https://joinallworld.com/manifest.webmanifest
npx @bubblewrap/cli build
```

`init` reads our manifest and asks for the rest. Answer: application id `com.joinallworld.app`; app name `Allworld`; launcher name `Allworld`; display
`standalone`; orientation `portrait`; theme and background colour `#183b2a`; icon `https://joinallworld.com/icons/icon-512.png`; maskable icon
`https://joinallworld.com/icons/icon-maskable-512.png`; "Include support for Play Billing": no (see the review caveats). It creates a signing key
(`android.keystore`): choose a strong password, and **back up the keystore and the password** in two places; Play can reset an upload key but losing
both is painful. For campaign counting, edit `startUrl` in the generated `twa-manifest.json` to `/?utm_source=play&utm_medium=twa` before `build`, so
Play installs are separate from home-screen installs (`utm_source=pwa`). `build` writes `app-release-bundle.aab` (what Play wants) and a signed `.apk`
(for a phone you hold, `adb install`).

**PWABuilder (browser, no tools)**: <https://www.pwabuilder.com>, enter `https://joinallworld.com`, "Package for stores", Android. Set the package id
to `com.joinallworld.app`, signing key "New", and download the zip: it contains the `.aab`, the keystore and a ready `assetlinks.json` snippet.

### Built on 20 Oct 2026

Built with Bubblewrap 1.27 from `~/allworld-twa/app/twa-manifest.json` (the answers above, `minSdkVersion` **24**: the current Android Browser
Helper refuses 21; `targetSdkVersion` 36; notifications delegation on; fallback to Custom Tabs where Chrome is missing). Output:
`~/allworld-twa/app/app-release-bundle.aab` (upload this) and `app-release-signed.apk` (for `adb install`). The upload key is
`~/allworld-twa/android.keystore`, alias `upload`; its password is in `~/allworld-twa/private/` and in the macOS Keychain
("Allworld Android keystore password"). **Copy the keystore and the password somewhere off this Mac.** Upload key SHA-256:
`E4:7F:AC:23:09:61:C6:F9:CA:20:69:B5:86:FC:14:AE:57:9D:81:85:27:2E:8D:EE:DB:FE:DE:C7:DE:9B:CC:15`.
Bubblewrap's settings are in `~/.bubblewrap/config.json` (Zulu JDK 21; the Android SDK through the link folder `~/allworld-twa/sdk`, because
Bubblewrap wants `sdkmanager` under `<sdk>/bin`). To make version 2: raise `appVersionCode`/`appVersionName` in `twa-manifest.json`, run
`bubblewrap update --skipVersionUpgrade` then `bubblewrap build` from `~/allworld-twa/app` with the two `BUBBLEWRAP_*_PASSWORD` variables set
from the password file. Checked on the Android 15 emulator: installs, opens on the green splash and runs the game (the browser bar shows until
`PLAY_SIGNING_SHA256` is set, as expected).

## 3. Upload, and get the fingerprint into the site

1. Play Console: the app, Testing, Internal testing, create a release, upload the `.aab`. Keep **Play App Signing** on (the default): Google then
   re-signs the app with its own key, and **that** key is the one phones check.
2. Console: Setup, App signing, "App signing key certificate": copy the **SHA-256 certificate fingerprint** (32 pairs of hex digits with colons).
   Also note the "Upload key certificate" SHA-256 (it is the one `keytool -list -v -keystore android.keystore` prints for a build you sideload).
3. Give the site the fingerprint(s) as a **Worker secret** named `PLAY_SIGNING_SHA256`. One value, or both separated by a comma (both is the safest:
   a sideloaded build is signed with the upload key, the Play build with the Play key). Whoever deploys does, from the folder the deploy steps use:
   `wrangler secret put PLAY_SIGNING_SHA256` and pastes the value when asked. The secret is written by nobody into the repository, `wrangler.jsonc`
   or a log; on the Node host it is the environment variable of the same name. Until it is set, or if it is not a valid SHA-256 fingerprint, the
   address answers 404 and nothing false is published.
4. Check: `curl -i https://joinallworld.com/.well-known/assetlinks.json` answers 200 with `content-type: application/json` and the JSON below, and
   <https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://joinallworld.com&relation=delegate_permission/common.handle_all_urls>
   lists the package. The file is:

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.joinallworld.app",
               "sha256_cert_fingerprints": ["AA:BB:...:FF  (the real SHA-256, not this placeholder)"] } }]
```

A placeholder is never served: a value that is not 32 hex pairs gives the 404.
5. Install the internal-test build on an Android phone. **If a browser address bar shows at the top, verification failed**: the fingerprint is
   wrong or missing, or the package name differs. Fix the secret; Android caches the answer, so reinstall the app after fixing it.

## 4. The listing

Text is drawn from `src/entry-variants.ts` (the home row) so the store says what the site says. Lengths are Play's limits.

- **App name (30):** `Allworld`
- **Short description (80):** `A digital world to live in: real places to explore, work, make friends and play.` (80 characters, the home description made shorter)
- **Full description (4000):** open with the home headline and pitch, then the four tiles as lines, then the games:

  > A digital world you can live in. Real-world places to explore: pick a city, move in, work, travel by road and air, and make friends. Free, no download beyond this app.
  >
  > - Live in a real city: real streets and real places, from Lagos to cities across the world.
  > - Work and earn in the game's own money.
  > - Open a shop for your real business: customers visit by link and message you directly. Allworld never holds your money.
  > - Friends, voice and games: Whot, Ayo, chess, Weave, penalties and a word a day, at tables in real places.
  >
  > Your own AI assistant can play too; agent characters are always labelled.

  Replace the number of cities and countries with the live figures on the day of submission (the home page fills `{cities}` and `{countries}` from the
  catalogue; do not copy an old number). **No money claims**: the plan says none until Bachs is live and the creator pool has been through a lawyer
  (`docs/EARN.md`). "Earn" above means the in-game money only; if Play's reviewer could read it as real earnings, say "in-game coins" instead.
- **Category:** Games, then Casual or Simulation (or Social, if you want the people first); tags: simulation, social, world.
- **Contact:** an email and the website `https://joinallworld.com`.

### Graphics (to make: not in the repository)

- App icon, 512x512 32-bit PNG: `public/icons/icon-512.png` (it is an 8-bit palette PNG; re-save it as 32-bit if the Console objects).
- Feature graphic, 1024x500 PNG or JPEG: needs making. `public/og/allworld.jpg` (1200x630, the globe and the lights) is the starting picture.
- Phone screenshots: five real ones, 1080x1920, under `public/store/` (the entry card over the world, Near you, Communities, the character at home in
  3D, the Lagos map), taken from the live build with the screenshot harness and listed in the manifest's `screenshots`. Retake them when the screens change.

### Policy forms

- **Privacy policy URL (required):** `https://joinallworld.com/privacy` (server/privacy-page.ts, served by both hosts, linked from the entry page). It
  states what the code does today; the owner's lawyer reads it before it is filed as the policy, and it changes when the game changes.
- **Data safety:** declare the above: name or nickname, e-mail (optional sign-in), user-generated content (chat, posts, pictures), device or other ids
  (the session id), approximate location (only the city the player confirms), app activity and crash logs (analytics are opt-in). Data is encrypted in
  transit; deletion is available inside the app.
- **Content rating (IARC questionnaire):** the game has user-to-user chat, voice, a public feed and shared pictures: answer "users can interact" and
  "users share content", and that it has moderation (reports, mute and block exist). Violence: none graphic (the "fights and jail" in politics are
  words and a game state: describe them truthfully in the form). Gambling: none with real money (Whot, Ayo, chess and Weave are card and board games
  with the game's own coins). Choose the target age from the answers; the game has no age gate, so do not pick an audience that includes children
  under 13 (Play's Families rules would then apply).
- **Ads:** no. **In-app purchases:** no, until Bachs is live (see below). **News app, COVID, government:** no.

## 5. Review caveats

- **Quality bar for a web wrapper.** Play expects an app that works and is more than a link. A TWA that opens a blank page or a browser error when
  the phone is offline can be refused. Today `public/sw.js` only handles notifications (it deliberately has no fetch handler and caches nothing),
  and showed Chrome's error screen offline. Since 20 Oct the installed app registers the worker, and a page load with no network shows a small
  Allworld page ("You are offline", Try again, and it retries every 10 seconds) answering 200: Chrome's app checks have counted an error status
  there as a crash. Nothing is cached; an ordinary browser tab still has no worker unless notifications are on. A related risk: Chrome only fires the `beforeinstallprompt` that drives our "Add Allworld to your phone" bar on a
  site it counts as installable; if the bar never shows on an Android phone, this is the first thing to check.
- **Lighthouse and the installability check.** Run Lighthouse in Chrome DevTools (performance, accessibility, best practices, SEO) against
  `https://joinallworld.com`, and read DevTools, Application, Manifest: it lists any missing manifest field or icon and says whether the page is
  installable. Fix what it names before upload.
- **Payments.** Play's payments policy makes digital goods sold inside an app go through Play Billing. Boosts, tickets and gig pay by Bachs
  (`docs/EARN.md`, the payments notes) are digital goods in the game: do not turn them on inside the Android app, or take advice first. The build
  above leaves Play Billing out.
- **User-generated content policy.** Play requires in-app reporting and blocking of abusive content and a way to act on reports: the game has
  reports and moderation; be ready to show a reviewer where they are.
- **Target API level.** Play requires new and updated apps to target a recent Android API level each year. Bubblewrap sets it when you build; rebuild
  and upload a new version when Play asks (the site itself needs no change).
- **Links.** Every address of `joinallworld.com` (a share link `/s/<code>`, an invite) opens inside the app once the app is installed and verified.
  `admin.joinallworld.com` is another origin and opens in the browser, which is what we want.
- **Review time.** The first review takes days; later updates are usually faster. Because the app is the website, a site release needs no new upload:
  only a change to the wrapper (name, icon, start address) does.

## 5a. Rejection risks found on 20 Oct (Play help pages, Bubblewrap and PWABuilder issues)

Most likely first. Unverified claims are marked.

1. **Closed test (new personal account).** At least 12 testers opted in for 14 days in a row before production access can be requested;
   recruit 15 to 20 so a dropout does not reset the clock, ask them to really use chat, the feed, uploads and games, and ship at least one
   update during the test. The production-access form asks how testers were found, what they used, what feedback came and what changed:
   answer with numbers and dated changes. (Play Console Help 14151465.)
2. **"Webview spam" / minimum functionality.** Asset Links proves we own the site; also show app features: full screen with no browser bar,
   notifications, the offline page, sharing and deep links. Never call the app "a website" in the listing.
3. **Asset Links.** `assetlinks.json` must carry the **Play App Signing** SHA-256 (and the upload key's) before the Play-installed build is
   tested; reinstall after fixing (Android caches the answer). Keep every page on `joinallworld.com` (another host shows the bar).
4. **Payments.** Inside the app nothing may sell digital goods outside Play Billing or point to a web purchase. Hide buy buttons, prices
   and payment links in the app itself (detect it by `document.referrer` starting `android-app://com.joinallworld.app` on the first page, or by
   `utm_source=play` in the start address, and remember it for the session). **Not built yet.**
5. **User-generated content.** Users accept terms that forbid objectionable content before they first post, chat or upload; report and
   block reachable from profiles, messages, posts and pictures. **There is no terms page and no acceptance step yet.**
6. **Age.** No age gate: set the target audience to 13+ (or 18+) only, keep listing art not child-appealing, and state "13 and over" in the
   terms and at sign-up. **Not built yet.**
7. **Account deletion.** Play wants a web address, outside the app, that tells people how to delete their account; `/privacy` describes it in
   Settings → Account, which works in any browser at joinallworld.com: give `https://joinallworld.com/privacy` as that address and say so there.
8. **Reviewer access.** Guest play needs no sign-in; say so under App access. Phone sign-in by SMS blocks a reviewer: give an e-mail test account.
9. **Money wording.** The game shows "₦" amounts ("claim at least ₦1,000,000 in the game"). A reviewer may read the naira sign as real money;
   say "in-game naira" or "coins" in the listing and consider how the in-app banners read.
10. **Crashes on low-end phones.** Reviewers use varied phones; test the 3D world on a cheap Android before submitting.

## 6. iPhone

A site cannot install itself on iOS. The install bar says "Add Allworld to your phone: tap Share, then Add to Home Screen" once, in Safari on iPhone
and iPad (not inside Instagram, TikTok or other in-app browsers, which cannot add it). An App Store wrapper is a later, larger job
(the plan lists it as not now).

## 7. The install bar, and what is counted

- Chrome fires `beforeinstallprompt` once, early. `src/app/main.ts` keeps it (`installEvent.ts`, a few lines of the first download); nothing is
  shown then. When the scene is up (`startExtras.ts`, `startAfterReady`) a device that has not been asked loads `installPrompt.ts`, waits until the game
  is connected and past onboarding, adds 20 seconds, and shows one bar: **Install** (the browser's own sheet opens) or **Not now**; on iPhone one line
  and **Got it**. The device is marked (`allworld-install-asked` in local storage) the moment the bar shows, whatever the person does, so it never
  returns. Nothing shows inside an installed app or the store build (display mode standalone).
- Counted as analytics events (`install_prompt_shown`, `install_prompt_accepted`, `install_prompt_dismissed`, property `platform`: `prompt` or
  `ios`; they follow the player's analytics choice). The growth source counter (`landed`, `play`, `game`, `stayed`) has a closed list and is not
  changed: installs are measured by these events, by `utm_source=pwa` and `utm_source=play` landings, and by the Play Console's install numbers.
