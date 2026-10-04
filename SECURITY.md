# Security

JoinAllworld is early software. This page describes what the code does and where its limits are, so you can decide whether it fits your use. Nothing here is a guarantee, and the project has not had an independent security audit.

## Reporting a vulnerability

Please report privately rather than in a public issue.

- If the repository's **Security** tab offers **Report a vulnerability**, use it.
- If it does not, open an issue that says only that you have a security report and ask a maintainer for a private channel. Do not include details, proof-of-concept code or affected data in the issue.

There is no bug bounty and no guaranteed response time. Only the latest `main` is supported.

## Device sessions are not accounts

- A session is a random secret stored in an `HttpOnly`, `SameSite=Lax` cookie, plus a nickname of 3–24 characters. There are no passwords, email addresses or verification.
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
- These measures limit casual tampering and double charging. They are covered by the project's tests, not by an external review.

## Requests and hosting

- API and WebSocket requests are checked for a same-origin `Origin` header. Request bodies and socket messages are size-limited, and there are in-memory rate limits and connection caps.
- Rate limits are keyed on the socket's remote address. Behind a reverse proxy every visitor shares one address, so add limiting at the proxy.
- The server does not terminate TLS and listens on all interfaces. Put it behind an HTTPS reverse proxy.
- Limits and chat de-duplication live in memory and reset on restart.

## Stored data

- Sessions, nicknames, game state and archived lives are written to one unencrypted JSON file, `devices.json`, in the data directory (file mode `0600`). It contains the session secrets. Protect and back up that directory yourself, and never commit it.
- Chat is relayed to the room and not written to disk.
- The browser caches the last known game state and nickname in `localStorage` for display.

## Chat, presence and location

- Joining a venue room shows your nickname, public ID and voice status to everyone in that room.
- Chat is plain text relayed through the server. It is not end-to-end encrypted, and there are no moderation, blocking or reporting tools yet.
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
