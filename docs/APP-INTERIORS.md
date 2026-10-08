# App interiors redesign

8 October 2026. User requested every app interior, including headers, with particular attention to chats, Jobs, Games, leaderboards and charts. This work follows the deployed 3D phone launcher. Deployed from source `cfbc133b36b5d4e8d071bb8223fbfc59e6a33289`; live build and assets were verified.

## Visual evidence and direction

Actual published screenshots were opened and visually inspected in Chrome:

- [Linear Mobile](https://linear.app/mobile): compact inbox rows, clear text hierarchy, and actions that do not compete with the content. [Screenshot](https://static.linear.app/assets/web/mobile/InboxImage%402x.A21B86DC-65CB-4858-8DF5-2781284CAA0D.jpg).
- [Monzo's Home redesign](https://monzo.com/blog/the-new-and-improved-home-screen): a distinctive account summary separated from readable transaction activity. This is a dated 2023 design reference, not a claim about the latest product. [Screenshot](https://images.ctfassets.net/ro61k101ee59/1exTayKHSIJwThEv7MJD2F/b43b1e9be9f94a04f06860ba1234d6aa/01.png?q=75&w=2400).
- [Steam Mobile](https://store.steampowered.com/mobile): game artwork supports visual discovery and makes each game identifiable. [Screenshot](https://store.fastly.steamstatic.com/public/images/mobile/localizedimages/web_hero/web_hero_english.png).
- [WhatsApp's design account](https://www.meta.com/design-at-meta/blog/whatsapp-user-interface-update/): familiar navigation, neutral content surfaces and selective use of color. Read as a supporting design case study.

The three rendered, side-by-side alternatives are in `design/app-directions.html`. They use the same Jobs content: a task directory, a focused career desk and a visual marketplace. The chosen system takes the directory for comparison tasks, focused summaries for money, and visual browsing for games/shopping. These are different information layouts, not recolored copies. Original reference assets are not copied into the product.

Colors: ink #17212f, canvas #f7f8fa, paper #ffffff, muted #526174, action green #176347, finance teal #173d48. App identity comes from the original 3D artwork and purposeful solid accents. Native system sans with a compact readable scale; no new font request. Left-aligned content, aligned amounts, 44px controls, visible keyboard focus, normal sentence case. No decorative blurred gradients or repeated card shadows. Phone hardware and its already accepted home wallpaper remain separate from the app interiors.

## Implementation

- Shared type, surfaces, controls, list rows and section headings improve every app using the common system. Form fields use readable 16px input text.
- Headers use a white toolbar, a 32px 3D app mark, dark title/status text and blue back/expand controls. The previous information-circle fallback in Tables is gone. Header focus is a compact 2px inset outline; keyboard focus remains visible. Profile subpages use the Contacts artwork.
- Jobs becomes a searchable role directory, with an open-workplace filter and native keyboard-accessible details disclosures. All existing pay, schedule, skill, progression, apply/switch and confirmation logic remains.
- Bank has a dedicated game-wallet summary with existing balance and bill facts. Real earnings remain explicitly separate in My Store.
- Games uses an original six-cell rendered 3D cover atlas. Oro gets a daily feature; Chess, Weave, Whot and Penalties have distinct visual entries. Existing launches, practice, sharing and nearby tables remain. Ayo artwork is reserved in the atlas, not represented as a new portable game.
- Messages has clearer tabs, an explicit New message search disclosure and visible form labels. Send money moved to Chat options so the contact name fits; calling stays in the header. Message bubbles and composer controls have stronger contrast.
- Rich List uses ranked rows with full names and aligned amounts rather than a cramped podium. Neighbours has its own illustrated directory header. Civic empty states use less vertical space.
- Health, goals, campus, calls, radio, invitations and billboard surfaces use solid colors in place of ornamental gradients. Actual game-board patterns and avatar lighting are not treated as decorative UI washes.
- Charts size their SVG viewBox to the actual container, keep axis labels readable, format large tick values compactly, distinguish series with line patterns and show isolated data points. Missing observations remain gaps and are named in the table. Table headers are semantic. A zero-count funnel stage has no filled bar.

## Coverage and evidence

Opened all 41 regular phone apps in local Chrome: Messages, Jobs, Bank, Ride; Missions, Groceries, Health, Houses, Goals, My land, My street, Boutique, Cars, Story scenes, Capture, Settings, Stay in touch, Help; Business, My Store, Statement, Rich List, Invest, Career; Contacts, Family, Invite, Bring a friend, People; Chairman, Events, Politics, Neighbours, Tables, Games, Billboards, Gem hunt, Radio, Campus, Report a problem, Community. Community intentionally opens a separate panel.

Initial local identity had an unconfirmed look; a separate disposable `Interior QA` identity was created through normal onboarding on localhost for social/populated checks. The only sent chat was between synthetic local QA players. No real users were messaged and no external subscriptions, age declarations, microphone permissions, or payments were accepted.

Desktop and 390×844 reviews found and corrected the cramped chat header. Chat send/list/actions were exercised. Charts were rendered from the real Vue component with clearly labeled synthetic data, including a missing day and zero-count funnel stage; table disclosure and keyboard readout were exercised. This does not claim a privileged production admin-session review or physical-device thermal testing.

Existing focused checks passed 38/38; five-project typecheck and the first fast build/smoke passed. The selected layouts also passed the full fast check and 38 focused checks. Development-preview cross-app links became inert; an isolated server serving the compiled production assets confirmed Bank → Statement and Games → Chess navigation. A real local chess move (e2 to e4) was applied. The final release includes the battery foreground correction and final CSS cleanup.

## Assets

`src/app/features/games/game-covers.webp`: 1536×1024, 163,734 bytes, loaded only with Games. Generated with the built-in image tool and encoded as WebP quality 82. Prompt: one equal 3×2 atlas of original tactile 3D game art with solid backgrounds, consistent studio light and three-quarter camera; word-puzzle tiles, chess pieces, woven letter board, geometric playing cards, football/goal, and carved Ayo board; no UI or logos. No runtime 3D scene or new image service.

The app icon atlas stays in `src/ui/phone/app-icons.webp`. See PHONE-POLISH.md for its provenance.


## Live release evidence

Cloudflare version `77d0ab82-7f21-4431-9ad9-9d6e8d60740b` received 100% traffic at 13:39:32 UTC on 8 October 2026. Public health reported `joinallworld-cfbc133b36b5d4e8d071bb8223f` at 13:45:31 UTC. CI passed at https://github.com/kromate/joinallworld/actions/runs/37785436555 .

Final startup download: 614,295 raw / 222,576 gzip / 194,713 Brotli bytes, all inside unchanged limits. First-paint Brotli: 35,393 bytes. Worker startup: 175ms (single provider measurement). Sealed package digest: `a8af452aa92b38f9be926ddb6df3e800449d61ce922e43c21ac54a6b74aa9400`. Package guards 17/17, Worker smoke 5/5, focused existing UI/model checks 38/38. Public smoke passed 9 checks / 282 requests / 40 cities in 76.0 seconds. Existing synthetic identity, balance and receipt continuity passed after propagation.

Color contrast measurements: body on canvas 15.26:1; secondary text 5.95:1; chat text 7.21:1; wallet secondary text 9.59:1; blue focus on white 5.17:1. These cover the revised palette pairs, not a blanket accessibility certification for every possible user-generated state.

The live game-cover asset returned HTTP 200 / 163,734 bytes and matched SHA-256 `825926a30e5025f45beafe8d54d7399c06d3ad354a0693fe82540dce965e2370`. Public Games and Bank screens were visually verified after deployment, including 3D header marks, white toolbar, battery contrast and real saved-state content. Public mobile-view document width equaled scroll width; the existing browser zoom was preserved.
