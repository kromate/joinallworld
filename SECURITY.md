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
- **There is no recovery.** Authenticated use renews the device session for 30 days. If the cookie is cleared, lost or expired, a browser with a cached life shows an explicit choice before creating a separate new identity. The old life is moved to an archive in the server's data file so it is not destroyed, but no endpoint or tool restores it, and players cannot retrieve it themselves. Do not treat progress as durable.
- Sessions created before the public ID was introduced are archived the same way at server start, so those devices start fresh.
- The cookie is marked `Secure` only when the server itself receives TLS, or when `TRUST_PROXY=1` is set and the proxy sends `X-Forwarded-Proto: https`. Serve over HTTPS.

## Game state

- Cash, needs, location and the action in progress are changed only on the server and advanced by server time. The client displays state and cannot set it.
- When the server is unreachable the client is read-only; it does not apply or queue actions locally.
- Each action carries a client-generated ID with a timestamp. Repeats return the recorded outcome, reuse of an ID with different contents is rejected, and IDs older than 24 hours are refused.
- **Server-only actions.** Some actions are one half of a change whose other half is shared storage (a ballot, an ad slot, a gift between two players, city news). They are declared `serverOnly` in the rules engine and are refused with `server_only` unless the server itself runs them inside the store transaction that writes the other half. The public `POST /api/action` never carries that authority, whatever the request body contains.
- **Social and civic writes are idempotent where money or a one-off outcome is involved:** a message, a group, an interaction, a gift and a radio shout-out carry a client id and are stored once; a knock is accepted once; a vote is counted once; a gem prize is paid once a day.
- **A life still being created is not in the city.** Until a session that must finish character creation has moved in, it cannot join any room, is not registered for messages or search, and is in no directory, list or counter.
- These measures limit casual tampering and double charging. They are covered by the project's tests, not by an external review.

## Requests and hosting

- API and WebSocket requests are checked for a same-origin `Origin` header. Request bodies and socket messages are size-limited, and there are in-memory rate limits and connection caps.
- Rate limits are keyed on the socket's remote address. Behind a reverse proxy every visitor shares one address, so add limiting at the proxy.
- The server does not terminate TLS and listens on all interfaces. Put it behind an HTTPS reverse proxy.
- Limits and chat de-duplication live in memory and reset on restart.

## Home rooms and guests

- A Home room is keyed by its owner's public id. By default only the owner's own sockets can join it.
- **The one exception is an accepted guest.** A visitor knocks (only while the server sees the host connected and at home); the host answers. If let in, the server records the visit — it lasts 30 minutes — and the visitor may then send `join` with `venueId: 'home'` and the host's public id. The room module admits that socket to the host's Home room only if the server's own guest list says the sender is a current, unexpired, unblocked guest of that host in that city **and** the host's stored life is at home. The room key is built from the validated host id, so the message cannot name any other private room; a host id with any other venue, or a malformed one, is refused.
- Membership is re-checked on the same schedule as every venue membership: on the guest's own life reads and actions, and on the host's for the guests in their room. An expired or ended visit is dropped at that check; leaving, being asked to leave or being blocked drops the guest at once; a host who goes out empties the room and the stored visits are closed.
- A guest is an ordinary member of the room: they see its presence and chat, and voice follows the existing rules — off and muted on join, proximity-gated signalling, the same cap. Nothing enables voice for anyone. The game client does not offer voice in a house visit.

## Other players and what they can see

- Other players only ever receive your **public id**, your nickname and, for players in the same venue room, your **look** — eight option ids (body, hair, outfit, fabric and four colours) that the server reads from your stored life and re-validates against the option lists when you join. A client cannot supply a look, and the per-move presence message is unchanged.
- Friends see which venue you are in; strangers see only that you are connected. The Neighbours directory and the Rich List show your name, district and balance unless you hide yourself from them.
- Blocking is mutual in effect: it ends a friendship and a visit and stops messages, friend requests, knocks and gifts between the two players. It does not hide you in a public venue's room or chat.
- **Reports are stored, with up to five of the reported player's recent direct messages as evidence, but no moderator tool exists to read or act on them.** There is **no text filtering** beyond length limits, control-character removal and — for slogans, announcements, ad text and song titles — refusing anything that looks like a web address.
- All player text is escaped when shown. Nothing a player types is rendered as markup or as a link, ads are text plus a colour and icon from fixed lists, and there are no uploaded images.
- Elections are open to **sock-puppet voting**: a device session is not a verified person, and the only mitigation is that a life must have lived one Lagos day to vote and two to run.
- Gifts of in-game naira are limited to money earned from work, per gift, per day and per recipient, to an account at least a day old and a friendship at least an hour old. There is no real money anywhere in the game.

## Stored data

- Sessions, nicknames, game state and archived lives are written to one unencrypted JSON file, `devices.json`, in the data directory (file mode `0600`). It contains the session secrets. Protect and back up that directory yourself, and never commit it.
- The same file holds two more collections. `social`: friends, blocks, conversations and their messages (direct, group and house chats, a bounded history each), house visits, pending gifts, idempotency receipts and reports. `civic`: list preferences and, per city, the residents directory with each resident's last balance, elections and announcements, ads, hunt counters and radio queues. Both identify players by public id only; the session secret is never written to them.
- **Direct, group and house messages are stored in plain text** and can be read by whoever can read the data file. Venue chat is relayed to the room and not written to disk.
- The browser caches the last known game state and nickname in `localStorage` for display, and keeps the sound preferences and which notices you have read there too.

## Chat, presence and location

- Joining a venue room shows your nickname, public ID and voice status to everyone in that room.
- Chat is plain text relayed through the server. It is not end-to-end encrypted. Venue chat has no blocking or filtering; see "Other players" above for what blocking and reporting do.
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
