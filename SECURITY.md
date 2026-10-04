# Security

JoinAllworld is early software. This page describes what the code does and where its limits are, so you can decide whether it fits your use. Nothing here is a guarantee, and the project has not had an independent security audit.

## Reporting a vulnerability

Please report privately rather than in a public issue.

- If the repository's **Security** tab offers **Report a vulnerability**, use it.
- If it does not, open an issue that says only that you have a security report and ask a maintainer for a private channel. Do not include details, proof-of-concept code or affected data in the issue.

There is no bug bounty and no guaranteed response time. Only the latest `main` is supported.

## Device sessions are not accounts

- A session is a random secret stored in an `HttpOnly`, `SameSite=Lax` cookie, plus a nickname of 3–24 characters. There are no passwords, email addresses or verification. **Accounts are not included**: an accounts design is a separate proposal that has not been merged, and nothing in this build authenticates a person.
- **Anyone who obtains the cookie is that device.** The secret is never sent to other players: presence, chat and voice signalling use a separate public ID.
- Nicknames are not unique or reserved. A name is not proof of identity.
- **Sessions expire.** The default lifetime is 30 days (`SESSION_TTL_DAYS`), renewed on authenticated use. Open connections are closed when the session expires.
- **There is no recovery.** Authenticated use renews the device session for 30 days. If the cookie is cleared, lost or expired, a browser with a cached life shows an explicit choice before creating a separate new identity. The old life is moved to an archive in the server's data file so it is not destroyed, but no endpoint or tool restores it, and players cannot retrieve it themselves. Do not treat progress as durable. A session that expires without ever having finished character creation has no life to keep and is deleted rather than archived.
- Sessions created before the public ID was introduced are archived the same way at server start, so those devices start fresh.
- The cookie is marked `Secure` only when the server itself receives TLS, or when `TRUST_PROXY=1` is set and the proxy sends `X-Forwarded-Proto: https`. Serve over HTTPS.

## Game state

- Cash, needs, location and the action in progress are changed only on the server and advanced by server time. The client displays state and cannot set it.
- When the server is unreachable the client is read-only; it does not apply or queue actions locally.
- Each action carries a client-generated ID with a timestamp. Repeats return the recorded outcome, reuse of an ID with different contents is rejected, and IDs older than 24 hours are refused.
- **Server-only actions.** Some actions are one half of a change whose other half is shared storage (a ballot, an ad slot, a gift between two players, city news). They are declared `serverOnly` in the rules engine and are refused with `server_only` unless the server itself runs them inside the store transaction that writes the other half. The public `POST /api/action` never carries that authority, whatever the request body contains.
- **Social and civic writes are idempotent where money or a one-off outcome is involved:** a message, a group, an interaction, a gift and a radio shout-out carry a client id and are stored once; a knock is accepted once; a vote is counted once; a gem prize is paid once a day.
- **A life still being created is not in the city.** Until a session that must finish character creation has moved in, it cannot join any room, is not registered for messages or search, and is in no directory, list or counter.
- **What "saved" means.** An action, message, gift, purchase or report is written to the data file before the server answers it. A poll (`GET /api/life`) whose settlement produced an outcome — cash moved, a timed action finished, the player arrived — is written before it is answered too. A poll that only moved the clock is answered from memory and written within one second; after a crash such a settlement is computed again from the stored state. Nothing a player was shown as an outcome can be taken back by a crash. If a write fails (a full disk), the request is answered with an error and nothing is acknowledged, but the change stays in the server's memory and is written when writes work again; an action retried with the same id is then answered with its recorded outcome rather than applied twice. Writes are not `fsync`ed, as before: "on disk" means written and renamed, which survives a process crash but not necessarily a power cut.
- **The wallet explains itself.** Every cash change is a ledger line with a reason and a time. The statement (`GET /api/support/statement`, Phone → Statement) gives opening balance, every kept change, closing balance and whether the arithmetic holds. If a stored balance ever disagrees with its own history, the server adds a visible "Balance correction" line instead of leaving the difference unexplained.
- **Earning is bounded.** Each repeatable source of money has a daily cap or a cost: one paid career shift per Lagos day, eight paid gigs per Lagos day, one gem prize, one found wallet, capped deposit interest, capped gifts. `src/game/economy.test.js` and `src/game/conservation.test.js` check that cash always equals what the life started with plus the sum of its ledger, under scripted strategies and under seeded random play.
- These measures limit casual tampering and double charging. They are covered by the project's tests, not by an external review.

## Requests and hosting

- API and WebSocket requests are checked for a same-origin `Origin` header. Request bodies and socket messages are size-limited, and there are in-memory rate limits and connection caps. The one exception to the origin check is the operator surface `/api/mod/*`, which authenticates with a bearer token in a header (see "Moderation" below).
- Rate limits are keyed on the network address. Directly connected, that is the socket's remote address. With `TRUST_PROXY=1` it is the **right-most** `X-Forwarded-For` entry — the address your one trusted proxy saw; anything a client put further left is ignored, so the header cannot be used to dodge a limit. Set `TRUST_PROXY=1` only when a proxy you control is the only way to reach the server: otherwise a client could write that header itself. Without it, behind a proxy every visitor shares the proxy's address, so add limiting at the proxy.
- The server does not terminate TLS and listens on all interfaces. Put it behind an HTTPS reverse proxy.
- Limits and chat de-duplication live in memory and reset on restart.

## Home rooms and guests

- A Home room is keyed by its owner's public id. By default only the owner's own sockets can join it.
- **The one exception is an accepted guest.** A visitor knocks (only while the server sees the host connected and at home); the host answers. If let in, the server records the visit — it lasts 30 minutes — and the visitor may then send `join` with `venueId: 'home'` and the host's public id. The room module admits that socket to the host's Home room only if the server's own guest list says the sender is a current, unexpired, unblocked guest of that host in that city **and** the host's stored life is at home. The room key is built from the validated host id, so the message cannot name any other private room; a host id with any other venue, or a malformed one, is refused.
- Membership is re-checked on the same schedule as every venue membership: on the guest's own life reads and actions, and on the host's for the guests in their room. An expired or ended visit is dropped at that check; leaving, being asked to leave or being blocked drops the guest at once; a host who goes out empties the room and the stored visits are closed.
- **Expiry is also bounded by time.** On every heartbeat (10 seconds by default) the server re-checks each socket that is visiting a Home room against the guest list. A visit that has run out, or whose host is no longer at home, ends then — at most one heartbeat after it should, even if neither the guest nor the host sends anything — and the stored visit is closed.
- A guest is an ordinary member of the room: they see its presence and chat, and voice follows the existing rules — off and muted on join, proximity-gated signalling, the same cap. Nothing enables voice for anyone. The game client does not offer voice in a house visit.

## Other players and what they can see

- Other players only ever receive your **public id**, your nickname and, for players in the same venue room, your **look** — eight option ids (body, hair, outfit, fabric and four colours) that the server reads from your stored life and re-validates against the option lists when you join. A client cannot supply a look, and the per-move presence message is unchanged.
- Friends see which venue you are in; strangers see only that you are connected. The Neighbours directory and the Rich List show your name, district and balance unless you hide yourself from them.
- Blocking is mutual in effect: it ends a friendship and a visit and stops messages, friend requests, knocks and gifts between the two players. **It also applies in public venues:** the server builds each player's room list for that player and leaves the other out, does not deliver either one's venue chat to the other, and refuses voice signalling between them with the same answer it gives for someone who is not in the room. Everyone else in the venue still sees and hears both, and nothing tells either player that the other is there: one's movement sends the other no frame at all. One shared limit remains — the venue's cap of eight voice participants counts everyone, so a blocked pair can still fill it for each other. Who blocks whom is held in memory for this, loaded when the server starts.
- **Presence has a freshness bound.** Every socket is pinged every 10 seconds (`HEARTBEAT_SECONDS`). A connection that dies without closing stops counting as online once a ping has gone unanswered for 5 seconds — so within 15 seconds it reads "reconnecting" rather than "online", is not listed in a venue, and cannot be knocked on as if at home. It is closed at the next beat (at most 20 seconds) and reads "offline" 20 seconds after that. Friend lists and player cards carry `seenAt`, the server time that connection was last heard from.
- All player text is escaped when shown. Nothing a player types is rendered as markup or as a link, ads are text plus a colour and icon from fixed lists, and there are no uploaded images.
- Elections are open to **sock-puppet voting**: a device session is not a verified person. The friction is deliberate and account-free, and it slows abuse rather than preventing it:
  - one vote per device session, cast in person at the Polling Unit;
  - the voting life must have lived a Lagos day **and been paid for work (a shift or a gig) on at least two different Lagos days** — a puppet has to be played on two separate days, not merely left to age. Running for office needs the same plus the filing fee;
  - a **soft cap of `VOTES_PER_ADDRESS` votes (default 3) per network address per election**. The trade-off is plain: a low cap blocks one person with many browsers, and also blocks a household, a school or a hostel behind one address; a high cap does neither. So the cap is configurable, a refused voter is told exactly why and that it was not counted, and the operator's audit trail records it (one line per address). When the address is loopback or in a private range the server is seeing a *shared* address — a proxy without `TRUST_PROXY`, or a LAN — and refusing there would silence real voters, so those votes are **counted and logged**, not refused. Addresses are never stored: the ballot keeps a salted hash per address, for the current election only. A hash of an IPv4 address can be reversed by anyone holding the data file and the salt, so treat it as pseudonymous, not anonymous. A VPN or mobile data defeats the cap.
- Gifts of in-game naira are limited to money earned from work, per gift, per day and per recipient, to an account at least a day old and a friendship at least an hour old. There is no real money anywhere in the game.

## Moderation

There are no moderator accounts. Whoever holds the server's `MODERATOR_TOKEN` is the operator.

- **Off by default.** Without `MODERATOR_TOKEN` — or with one shorter than 24 characters — every `/api/mod/*` path answers 404, like a route that does not exist.
- **Header-only bearer token.** `Authorization: Bearer <token>` on every request. It is never read from a cookie, a query string or a body, so it does not end up in URLs or access logs of well-behaved proxies. Apart from the environment variable it was started with, the server keeps only a SHA-256 digest of it, compares digests in constant time, never logs it and never writes it to the data file. A device session cookie gives no access.
- **Not tied to an origin, on purpose.** A browser never attaches an `Authorization` header by itself, so these routes cannot be driven by a cross-site request; that is why they work from `curl` without an `Origin`. No CORS headers are sent, so a page on another origin cannot read a response either.
- **Rate limited per address:** 60 authenticated requests a minute, and — counted separately — 10 requests without the right token per 10 minutes, after which such requests from that address get 429 until the window passes. A valid token is never locked out by someone else's failures or by tokenless requests.
- The token must be 24 to 512 printable ASCII characters without spaces (what a Bearer header can carry); anything else leaves the feature off, with a warning at start-up that does not print it.
- **What an operator can read:** player reports (reason, the reporter's text, up to five of the reported player's direct messages to the reporter), problem reports with their automatic context, active mutes, live ads, announcements and shout-outs, and the audit trail. Nothing returned contains a session secret. Direct messages other than that evidence are not exposed by any route.
- **What an operator can do:** dismiss a report; set a problem report's status and note; mute a public id from posting text for 1 minute to 30 days; lift a mute; remove an ad, an announcement or a shout-out. Each writes an audit line with the time, the target and the address it came from; the last 1,000 are kept.
- **A mute is not a ban and deletes nothing.** It stops venue chat, messages, group names, slogans, announcements, ads, shout-outs and renaming until it ends. The player keeps their session, life, money and belongings, can still play, read, vote and receive messages, is told the reason and the end time, and can still file a problem report. No operator action archives, edits or deletes a life.
- **Text filter.** Every text another player can read is checked on the server: nicknames (on creation and rename), venue chat, direct, group and house messages, group names, slogans, announcements, ad text, song titles and artists. The list (`server/moderation/terms.js`) is short and conservative — slurs, telling someone to harm themselves, sexual content about children — and is matched on whole words after folding case, accents, look-alike digits, spaced-out letters and stretched letters. Nicknames, group names and every civic line also refuse links, phone numbers, e-mail addresses and handles on other apps. A refused text is **rejected with a reason and never altered**: nothing is starred out or delivered in part. It is a seatbelt, not a moderator — easy to evade deliberately, blind to context and to most languages.
- **Problem reports.** Any player can file one from inside the game; no outside account exists or is needed. The stored report holds the public id, name, category, text and context built field by field from the server's copy of the life (build, city, cash, location, running action, last message, last ten actions with result codes, last ten wallet lines). It cannot contain the session secret, and a test checks that it does not. Three filings an hour per player, ten per address, five open at a time.
- **Limits of all this.** One shared secret means no per-moderator accountability: the audit trail records an address, not a person. There is no ban for a player who makes new sessions, and a muted player can create a new session and keep talking until that one is muted too. Venue chat is not stored, so reports about it arrive without evidence.

## Stored data

- Sessions, nicknames, game state and archived lives are written to one unencrypted JSON file, `devices.json`, in the data directory (file mode `0600`). It contains the session secrets. Protect and back up that directory yourself, and never commit it.
- The same file holds four more collections. `social`: friends, blocks, conversations and their messages (direct, group and house chats, a bounded history each), house visits, pending gifts, idempotency receipts and reports. `civic`: list preferences and, per city, the residents directory with each resident's last balance, elections and announcements (with a salted hash per voting address for the current election), ads, hunt counters and radio queues. `moderation`: mutes and the audit trail, including the address each operator request came from. `support`: problem reports with their context. All four identify players by public id only; the session secret is never written to them.
- Every collection is capped; the caps are listed in the README under "Storage and limits". Archived lives of players who actually played are the one thing never deleted automatically.
- **Direct, group and house messages are stored in plain text** and can be read by whoever can read the data file. Venue chat is relayed to the room and not written to disk.
- The browser caches the last known game state and nickname in `localStorage` for display, and keeps the sound preferences and which notices you have read there too.

## Chat, presence and location

- Joining a venue room shows your nickname, public ID and voice status to everyone in that room.
- Chat is plain text relayed through the server. It is not end-to-end encrypted. Venue chat passes the text filter and the sender's mute state, and is not delivered between two players of whom either has blocked the other; see "Other players" and "Moderation" above.
- The optional "use my location" control asks the browser for your position and uses it in the browser to suggest a city. The position is not sent to the server.

## Voice

**Voice has not yet been verified with real audio between two clients.** Treat it as experimental.

- **Opt-in.** The microphone is not requested until you press Join voice. The browser asks for permission and requires HTTPS or `localhost`. You join muted and unmute yourself. Leaving voice, changing room or closing the page stops the microphone.
- **Peer-to-peer.** Audio goes directly between browsers, not through the JoinAllworld server, which only relays connection setup messages between people in the same room. As a consequence, **people you connect to can learn your IP address**, and with it your approximate location and network provider. Do not enable voice if that is unacceptable.
- **Third-party STUN.** To find a route between browsers, the client contacts a public STUN server operated by Google (`stun.l.google.com`). That server sees your IP address, not your audio. Self-hosters can change it in `src/community.js`.
- **No relay.** The project does not run or pay for a TURN server. On some mobile, corporate or carrier-grade NAT networks, calls will not connect.
- **No recording by the project.** The server never receives audio and the project's code does not record it. Nothing stops another participant from recording on their own device.

## Out of scope

- Denial of service against a self-hosted instance with no proxy-level limits.
- Impersonation by nickname, which is a documented limitation above.
- Issues that require access to the server's data directory or the user's own browser profile.
