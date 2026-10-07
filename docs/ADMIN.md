# The admin section

An in-game admin section for the people who run Allworld: statistics, finding players, money and other actions, announcements, world tools, moderation and an audit log. It is a screen of the game itself (a lazily loaded chunk that ordinary players never download) over routes under `/api/admin/`.

## Who is an admin

An admin request must come from a session that belongs to a signed-in **account** (a guest is never an admin, on any device) whose **verified address**, trimmed and lower-cased and hashed with SHA-256, matches one of:

- the **founder's hash**: `FOUNDER_EMAIL_SHA256` (the built-in one, or the setting that replaces it; `server/social/founder.ts`). The founder is the **root admin**.
- the comma-separated hashes in **`ADMIN_EMAIL_SHA256S`** (up to 20, 64 hex characters each).

To add an admin: hash their verified address, `printf '%s' 'them@example.com' | tr 'A-Z' 'a-z' | shasum -a 256`, append the 64 characters to `ADMIN_EMAIL_SHA256S` (a Node environment variable, or a Worker secret/binding) and restart or redeploy. No address is kept in the repository. To remove one, delete the hash.

Rights are decided on **every request** from the server's own records (session, then account, then the stored verified address). Nothing the client sends counts, nothing is cached: an account whose address changed, a browser that signed out, or a removed device binding is not an admin on its next request. Every refusal is `404 not_found`, indistinguishable from a route that does not exist. This is separate from the operator guard (`MODERATOR_TOKEN`, `/api/mod/`), which is unchanged; where `/api/mod/` already implements something (reports, mutes, shop moderation, outreach switches, content removal, the update notice) the admin routes call the same service functions.

Only the founder may act on an admin or on the founder (including themselves, for another admin).

## Opening it

On the admin address (below) it is the whole page. In the game, the Phone shows an **Admin** app after the server has answered `GET /api/admin/me` for the signed-in account. Alt + Shift + A opens it too. Sections: Dashboard, Players, Announcements, World, Moderation, Audit. One frame for both: a rail on the left from 900 px wide and tabs along the bottom of a phone, a title and breadcrumbs, a search box that finds a player from anywhere, toasts for what a change did, and a **What just happened** list of this visit's changes with **Undo** where a change can be reversed (a credit is taken back as a debit with the same reason, a debit given back, a mute, suspension or ban lifted; a need, a rename, a message, a note or a sign-out cannot be). It scales with `--ui-zoom` and `--ui-vh` in the game and nothing sits under the Phone frame. Shortcuts: `/` find a player, `g` then `d` `p` `a` `w` `m` `l` for the screens, `?` for the list, in a queue `j` `k` `d` `w` `m`. On the admin address a screen and a player have their own link (`#/players/<id>/money`).

**Players.** Saved filters (everyone, new today, online, signed up, guests, broke, banned, reported), a search that waits for the typing to stop and remembers the last eight searches on this browser, sorting, 15 / 40 / 100 rows, and a bulk bar for up to 20 chosen players: a message or a small credit (at most `ADMIN_GRANT_EACH_MAX`), **all or nothing**, through the same function and so the same per-action, per-target and per-admin limits and receipts as one player at a time, with a token and the number of players typed back (`POST /api/admin/players/bulk`). A player's page is tabs: Overview, Money (the ledger with a filter and the running balance), Social, Places, Sessions, Sanctions, Notes, History, and **As the player sees it** (a read-only summary of their top bar; never their messages, never a way to act as them), with Credit, Message, Mute and Ban pinned above.

## Dashboard

Each number says when it was true; the whole answer is cached 45 seconds. Exact unless noted. The economy snapshot is separate, computed on request, cached ten minutes.

| Number | Source | Cost |
|---|---|---|
| online now, per city | the pulse (live sockets), exact | memory |
| new players today / 7 d, active today | first-party growth metrics, exact | one read of the `growth` collection |
| active 7 d / 30 d | exact for lives under 31 days old, plus a per-day visit count for older lives (an upper bound) | same |
| accounts, guests | account counter, sessions held minus account characters (guests approximate) | key counts |
| sessions and sockets against their caps | host counters | memory |
| businesses open, reports open, mail sent today against the caps | stored counters | the collections |
| admin credits, debits and grants, today and all time | the audit store's totals | the audit collection |
| stored collection sizes, rows written (Worker) | the store's own counters | none |
| economy snapshot: cash in circulation, net of each ledger category today (wages, gigs, stall sales, admin credit and debit, fares, rent …), residents and visitors per city | one pass over stored sessions, at most `ADMIN_SCAN_MAX` | Node: memory. Worker: one read of every session row, no row written |

### History, the funnel and what is exact (`GET /api/admin/history`)

Two sources, both bounded, neither scanned on a read (`server/admin/history.ts`):

- **The growth counters** (kept 400 days): new lives, lives seen each day, sessions, every funnel step and the retention cohorts. Counted by the server as it happens, so **exact**. The funnel shown is: new lives (pressed Play) → arrived in the city → first goal → settled a home → first paid work → came back the next day. "Opened the page" and "made a first friend" are **not measured** on the server and are shown as such; a step is counted on the day it happens, so the steps are not strictly the same people.
- **`adminDaily`** (new, 400 days of 13 whole numbers each, one row on the Worker): the busiest moment of each day (players online at once), accounts, device sessions held, calls placed / connected / via the relay / failed, the hosted guide's requests (and how many the model and the fallback answered), e-mail and push sent, and cash in circulation when it was last measured. Written by the heartbeat while somebody is connected, **at most once every 15 minutes and only when a number changed**; recording starts the first time the server runs this code (`startedOn` says the day) and a day before it shows as a gap, never a zero. The busiest moment is the highest of the samples (a floor); calls and guide requests are the host's own day counters (UTC), taken at the last sample of the Lagos day; cash is sparse (it is only measured when an admin asks for the economy snapshot).

Cost of each dashboard panel: tiles, cities (online, seen, new), system: memory and counters the host keeps, cached 45 s; the walk over followed lives (up to 50,000) behind "back in 7 days" is repeated at most every five minutes; the charts and the funnel: a few hundred additions over counters already in memory; the economy, richest ten, median, social (messages today, groups, pings) and residents/visitors: **one pass over the stored sessions and conversations**, only when asked and cached ten minutes (the page asks once when opened and again every ten minutes, never on the 60-second refresh). Nothing here writes except the 15-minute sample.

The dashboard refreshes itself every minute and shows when its numbers are from. Charts are plain SVG (no chart library) with a text description, arrow-key reading of a day and the same numbers as a table.

Calls placed/connected/failed and relay use are not in this build; a feature that has such counters adds them with `registerAdminStat` (`server/admin/tools.ts`).

## Using admin.<domain>

The admin screens can also be opened on a second address, `admin.joinallworld.com`: a page of their own with nothing of the game in it (no scene, no sound, no companion, no engine; a second build entry, `adminshell.html`, so the game's first download is unchanged).

**How it works.** Both hosts decide with `server/admin/host.ts`. A request is for the admin address when its Host is `ADMIN_HOST` (a plain host name, a setting of the Node host and a variable of the Worker) or, when that is not set, `admin.` plus the host of `PUBLIC_ORIGIN` (else of the site's own origin), without a leading `www.`; `admin.localhost` always counts, so it can be tried on one machine (`http://admin.localhost:<port>`). On that address:

- it answers `GET /api/health`, `GET /api/session`, `/api/account` and `/api/account/...`, `/api/admin/...`, `robots.txt` (everything disallowed), `/assets/...` and the favicon, and for any other `GET` the admin page. **Everything else is a 404** (a wrong method on the page, a 405): no game page, no sockets, no manifest, no sitemap, no link previews, no game routes, and `POST /api/session` is refused, so it cannot make players or be used as a second game origin. Origin checks are the host's own, so a page on any other origin is refused (403) there too. The `/assets/` files are the build's public, hashed files; the admin address does not hide the game's chunks (they hold no secret), it just does not serve its page.
- the page carries `Content-Security-Policy` (the game's policy without the analytics beacon, the telemetry hosts and the sockets, plus the sign-in provider's own hosts), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, a `Permissions-Policy` with the microphone and location off, and HSTS over HTTPS. The game's own address does not serve the admin page (`/adminshell` is a 404 there).
- **its session is its own**: the cookie is `__Host-sid`, host-only by definition, so signing in on the admin address creates and binds a session there through the normal account flow, and signing in or out there never touches the game's. Every address is counted under its own name on this host (`admin:<address>`), so the rate limits (the request limit, the sign-in limit, the admin failure limiter) of the two addresses are separate.
- a signed-in account that is not an admin sees "This area is for Allworld staff" with a link to the game; a browser that is not signed in sees the sign-in (Google, or an e-mail address and password); nobody is ever told whether an address has an account.

The in-game **Admin** entry on the game's address works as before.

**What the owner must do** (nothing in the repository can):

1. **Cloudflare.** Workers & Pages -> `joinallworld-next` -> Settings -> Domains & Routes -> **Add -> Custom domain** -> `admin.joinallworld.com`. Cloudflare creates the DNS record and the certificate itself; nothing else is needed (no code change, no second Worker). Optional: set a Worker variable `ADMIN_HOST` only if the name should be something else; without it the name above is derived from `PUBLIC_ORIGIN` (or the site's own origin).
2. **The identity provider** (Firebase Authentication, the project named by `ACCOUNTS_FIREBASE_PROJECT_ID`). Authentication -> Settings -> **Authorized domains** -> add `admin.joinallworld.com`.
3. **Google sign-in.** In the Google Cloud console for the same project (APIs & Services -> Credentials -> the OAuth 2.0 web client named by `ACCOUNTS_GOOGLE_CLIENT_ID`) add `https://admin.joinallworld.com` under **Authorized JavaScript origins**. Without steps 2 and 3 the Google button will not work on the admin address, **but e-mail and password does** (it needs only step 1, and step 2 if the provider's API key has an HTTP-referrer restriction: add `https://admin.joinallworld.com/*` to it).
4. A new admin address needs no change to who is an admin: the same account, the same `FOUNDER_EMAIL_SHA256` / `ADMIN_EMAIL_SHA256S`.

## Players

Search by display name, public id (the first 8 characters or more), or the **64-character hash of an address** (exact match, admin only). Filters: online, accounts, guests, new, flagged; by city; 40 per page. A search walks the stored sessions once and is limited to the admin read budget. A player's page shows profile (the address masked as `a***@e***.com`), city and place, homes, job, needs, cash and the last 50 ledger lines, shops, friends and invites, sanctions, reports about and by them, recent admin actions on them, devices, and private notes. It refreshes every four seconds, so money arrives live.

Actions (every one needs a fresh `clientId`, writes an audit line, and shows its result):

| Action | Notes | Reason |
|---|---|---|
| credit ₦ | ledger line `Admin credit: <reason>`; not counted as earned from work | required |
| debit ₦ | ledger line `Admin debit: <reason>`; takes at most the balance (never below zero) and says what it took; typed confirmation + token | required |
| heal, set a need | lifts needs below 80 to 80; sets one need 0-100 | optional |
| move | to the city's arrival venue or home; ends a stuck timed action (not a trip between cities) | optional |
| rename | through the name filter | optional |
| mute / lift | the moderation module's mute, 1 minute to 30 days | required |
| suspend / lift | pictures or calls, 1 minute to 30 days (see "Enforcement") | required |
| ban / unban | time-boxed or permanent; signs the account out everywhere and closes its sockets; typed confirmation + token | required |
| sign out everywhere | every browser of the account (a guest session is ended); typed confirmation + token | optional |
| message as founder | a direct message from the founder character, through the text filter | optional |
| private note | admins only; 20 per player | none |

Not built: granting an item or cosmetic (the game has no operator-side grant for them).

### Money limits (named, replaceable by a setting of the same name)

| Setting | Default | Meaning |
|---|---|---|
| `ADMIN_MAX_AMOUNT` | 500000 | most one credit or debit may move |
| `ADMIN_MAX_PER_TARGET_DAY` | 1000000 | most (credits plus debits) all admins together may move on one player per Lagos day |
| `ADMIN_MAX_PER_ADMIN_DAY` | 5000000 | most one admin may move per Lagos day |
| `ADMIN_GRANT_EACH_MAX` | 5000 | most a world grant gives each player |
| `ADMIN_GRANT_TOTAL_DAY` | 1000000 | most world grants give out in all per Lagos day |
| `ADMIN_GRANT_CONFIRM_ABOVE` | 20 | a grant to more players than this needs the typed count and a token |
| `ADMIN_MAIL_CONFIRM_ABOVE` | 50 | an announcement e-mail/push to more people than this needs the typed count |
| `ADMIN_SCAN_MAX` | 20000 | most sessions one economy snapshot reads |

A world grant reaches at most 1000 players at once (narrow it to a city). A value that is not a whole number inside its bounds is ignored.

### Conservation

Money moves only through the rules engine's wallet (server-only actions `wallet.admin`, `needs.admin`, `activity.admin`), so a life's cash is always its starting cash plus its ledger; `npm run economy` and the engine tests hold. An admin credit is a defined faucet and a debit a sink; both are totals in the audit store and on the dashboard, and appear as ledger categories ("Admin credit", "Admin debit").

## Announcements

A title (up to 60 characters) and text (up to 240), through the chat text filter and with no links; an optional button that opens one in-game panel from a fixed list (Map, Missions, Business, Invite); an audience (everyone, one city, online now); sending now or at a time; an expiry (at most 30 days). Stored **once** (collection `adminAnnounce`); nothing is written per player. Delivery: a socket frame to every open socket when it goes out and to every socket that opens while it runs (held in memory); the page keeps what it has seen in that browser and adds an entry to Messages → Updates. "Online now" is sent only to the sockets open at that moment. Optional push and e-mail go through the existing outreach machinery (`server/growth/announce-mail.ts`): players who opted in (e-mail needs "E-mail me about my character" and the Events switch), the operator's switches, `EMAIL_DAILY_CAP`/`PUSH_DAILY_CAP`, quiet hours, the signed unsubscribe link, and the dry-run when no provider is configured. The recipient count is shown first; above `ADMIN_MAIL_CONFIRM_ABOVE` the admin types it to confirm. Mail is sent in claimed batches of 25, so a crash can lose a batch, never repeat one. The list shows each announcement's status and reach.

## World

A grant to everyone online or in a city (reason required, a preview of the count first, typed confirmation above the threshold). Runtime settings (`server/admin/settings.ts`), each defaulting to the environment: the launch bonus (`launchBonus`, `launchBonusAmount`, `launchBonusPlaces`: docs/LAUNCH-BONUS.md), new sessions per address per hour, stored sessions the host takes, pictures in chat (off or friends; it starts at `CHAT_IMAGES`, which is off unless the host sets it, and turning it on needs the typed confirmation) and phone notifications for messages (`chatPush`, starting at `CHAT_PUSH`), both read by their features through `ctx.checks.setting`, and the e-mail and push kill switches (the operator's own function). The "update is coming" notice from a button (`1-15` minutes, or end it): the same banner the signed announcer starts, which keeps working as it was. A time-boxed event flag (double wages) is **not** built: the rules engine has no such notion.

## Moderation

The reports queue with the reported player's quoted messages and the reporter's text; one tap to dismiss, warn (a system message in their Updates) or mute; reported shops (plain name, close); live ads, notices and radio shout-outs per city (remove). Suspend or ban from the player's page. Other features add queues and tools with `registerAdminTool` (`server/admin/tools.ts`), listed by `GET /api/admin/tools`; statistics with `registerAdminStat`; settings with `registerAdminSetting`.

## Government

Admin → World → Government lists every seat that has held an election (holder, treasury, officers and judges, petition, audit warnings), who is in jail, and who serves as police or judge. An operator can **remove an officeholder** for the rest of the term (type their name), **release** a jailed player, or **dismiss** an officer or a judge. Every action needs a reason of at least ten characters, is written to the audit log below, and is also written to the public record (`GET /api/world/records?kind=operator`) with the same reason, so players can read what was done to their government and why. The record is hash-chained: an operator cannot change a past entry. See docs/POLITICS.md.

## Audit log

Append-only, the last 5000 lines (collection `adminAudit`), each `{ n, at, admin account, admin name, action, target, params, before-to-after summary, reason, amount }`, written in the same transaction as the change. Filters by action, admin reference, text; "Older" pages; **Export CSV** is made in the browser (a cell that begins like a formula is quoted so a spreadsheet does not run it). Responses show an admin by a short reference, never the account id.

## What admins cannot do

Act on another admin or the founder (unless they are the founder); move more than the limits above; see an address (only the masked form), a token, a cookie, a device secret or an IP; change anything without a `clientId`, a same-origin page, and (for destructive actions) a confirmation token; edit or delete audit lines; touch a life that is expired, archived or still being created; send a ban or sign-out without a typed confirmation.

## Enforcement of sanctions

- **Ban**: every route (`buildRoutes`, `server/routes/index.ts`) answers 403 `account_banned` with a plain sentence the first time a request resolves a banned session, except under `/api/account/` (signing out). Open sockets are closed when the ban is made and a socket that opens later is refused. A ban is kept under the player's id and, for an account, under the account, so another of its characters is banned too. A **guest** is banned by session: clearing the cookie makes a new guest, which the per-address new-session limits slow down. A guest ban is a deterrent, not a wall.
- **Mute**: the moderation module's own mute.
- **Suspend pictures / calls**: stored and asked for through `ctx.checks.suspended(publicId, 'pictures' | 'calls')`. The features that send pictures and place calls call it before they do: a picture upload is refused with `pictures_blocked` and a call invite answers `unreachable` while the sanction lasts.

## What other features put here (`server/admin/links.ts`)

Through the extension points of `tools.ts` and `settings.ts`: dashboard cards for calls today (placed, connected direct, connected via relay, failed, relay credentials issued, relay configured), for the hosted guide (requests, outcomes, tokens, estimated cost, `companionAi`, and a "Test the AI guide" button that runs the function behind `POST /api/mod/companion-test`, as `POST /api/admin/companion/test`) and for pictures in chat (stored, reported, storage used, switched on or off). Moderation lists reported pictures (`GET /api/admin/moderation/pictures`, the picture itself at `.../pictures/:id`, `POST .../pictures/:id/act` { remove | restore }, `POST .../pictures/player` { player, allowed }), through the same service functions as `/api/mod/pictures` and `POST /api/mod/players/:id/pictures`.

## Security model

Account-based guard decided per request from server records; constant-time hash comparison over every configured hash; refusals are 404; limits per address (`admin-ip:`), per account for reads and writes apart (`admin-r:`, `admin-w:`) and a count of refused attempts per address and in total (`admin-fail:`), all **protected** limiter keys that are never dropped to make room; writes must name this host as their origin (and the host's own cross-site check applies to every `/api/admin/` route); every write is exactly-once (`ctx.once` on the admin's own session) and audited; destructive actions need a typed word and an HMAC token (admin, action, target, parameters, five-minute expiry) from a first request that changed nothing.

## Stored data (all additive, each its own collection; none inside `social`)

| Collection | Holds | Bound |
|---|---|---|
| `adminAudit` | `{ seq, totals, lines }` | last 5000 lines |
| `adminSanctions` | bans, picture and call suspensions, by player and by account | 2000 players, ended ones dropped on the next write |
| `adminAnnounce` | announcements | last 200 |
| `adminSettings` | only values that differ from the environment | the registered settings |
| `adminNotes` | private notes | 20 per player, 2000 players |
| `adminDaily` | `{ first, days: { [lagosDay]: number[13] } }`, one row of whole numbers per Lagos day (`server/admin/history.ts`) | last 400 days; written at most every 15 minutes, only when a number changed |

Also a key `admin-confirm` (made once, in `DATA_DIR/keys` or the Durable Object's `host_keys`) for confirmation tokens, and the growth collection gains nothing new (mail batches keep their cursor in the announcement).

### Worker row cost

Reads write nothing (a read runs on a snapshot; a collection that does not exist is not created by looking). Limiter keys are protected: each admin request writes one to three limiter rows, as the operator guard does. An action writes: the admin's session row (the receipt), the target's session row when it changes a life (credit, debit, needs, move, rename, sign-out), the audit collection (one row, a few once it passes the chunk size), plus for a sanction `adminSanctions` and `moderation`, for a message or notice to the player the `social` collection. A world grant writes one session row per recipient. An announcement writes `adminAnnounce` once to create and once more when it goes out (its reach). A socket that opens reads nothing from storage for announcements. The dashboard reads the growth, social, business and admin collections; a player search reads every session row.


## Unrestricted funds (money an admin sends has no gift limits)

An individual **Admin credit** is, by default, *unrestricted*: the life records it as `social.free` (an additive counter; absent = 0; a life saved before it existed loads unchanged). A gift to another player and a purchase at a player's stall draw on it **first**, and for the part it covers none of these apply: the earned-from-work rule, the ₦5,000 per-gift cap, the gifts-a-day and amount-a-day caps and the minimum-earned rule on the sender's side, and the ₦20,000 daily receive cap on the recipient's side (the unrestricted part is not counted against it and is not blocked by it). Anything beyond the unrestricted amount follows the ordinary rules; when that part would be refused the whole gift is refused and the answer says the exact most that can be sent ("You can send up to ₦X now (₦Y of it has no gift limits)"). Nothing is split behind the player's back.

* **What the recipient of such a gift gets is ordinary money.** It follows the normal rules for them; it is never passed on as unrestricted, so one credit cannot become an unlimited transfer network beyond the person the admin chose and the first gift.
* Cash spent on ordinary things (homes, travel, stalls, upgrades) was always allowed. After any spend the counter is brought down to the cash still held (`free = min(free, cash)`), so nobody keeps an allowance larger than the money they hold.
* At a player's stall the unrestricted part skips the earned-from-work allowance only; the stall's own anti-abuse limits (per day, per visit, the need not already full, one mood per day, buyers behind one address) still apply to the whole price.
* The **launch bonus** is not unrestricted (and not earned from work): it is a faucet to up to 10,000 accounts and must not be funnelled (docs/LAUNCH-BONUS.md).
* A credit has a checkbox, "Restricted: cannot be gifted", for the rare case. A **world grant** ("everyone online …") stays restricted by default because it reaches many players; tick "unrestricted" on the grant form to change that for one grant.
* **Limits on the admin's side.** The founder (the root admin) has no per-action, per-player-per-day or per-admin-per-day money cap: a credit is any whole amount up to a hard bound (₦1,000,000,000,000) that only protects number handling. Other admins (`ADMIN_EMAIL_SHA256S`) keep `ADMIN_MAX_AMOUNT`, `ADMIN_MAX_PER_TARGET_DAY` and `ADMIN_MAX_PER_ADMIN_DAY`. A single credit above ₦10,000,000 asks for a typed confirmation (a typo guard, not a limit). A reason, the audit line, the exactly-once receipt and the ledger line stay, and credits remain a labelled faucet in the dashboard. A debit never takes the balance below zero.

**What this means.** An admin credit is now a way to move unlimited in-game money to any player and, in one gift, on to their friends. Use it knowingly: every one is in the audit log with its amount, target, reason and whether it was restricted.
