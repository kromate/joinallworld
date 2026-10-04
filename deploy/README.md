# Cloudflare deployment

The edge adapter shares server/protocol.js and server/life-service.js with the Node server. A separate SQLite Durable Object owns the new game's sessions, city state and action receipts. It never binds the original Allworld namespace.

Local checks:

```sh
npm ci
npm ci --ignore-scripts --prefix deploy/tooling
npm run build
npm test
npm run test:edge
node --test deploy/turn-provider.test.mjs
```

Use the reviewed release workflow in kromate/allworld, supplying an exact public kromate/joinallworld main ancestor SHA. It builds without provider secrets, runs core/edge tests, bundles and hashes the Worker and assets, then the protected deployment job rechecks a fixed new-worker configuration. Deploy and public staging default off. No domain routes are included. Roll back public staging exposure by releasing with publish_staging=false; retain the same new namespace to preserve its data.

Sessions use an HttpOnly secret cookie and a separate public peer ID. This is browser-device identity, not a recoverable account. Losing the cookie does not provide automatic access to archived life data. Authentication refreshes expiry; expired IDs are rejected. Accepted action IDs retain their receipt for the full24-hour replay window. At capacity, new actions fail safely rather than dropping live receipts.

Position and voice state are ephemeral WebSocket attachments that survive hibernation; movement does not rewrite wallet state. Chat bodies are not persisted. Minimal dedupe records retain only message IDs, timestamp and a body hash for up to24hours, capped100 per sender/room. An expired open socket is closed at the next check/alarm, with a minute-scale idle check. Current caps are safety bounds, not a tested capacity guarantee.

## Controlled TURN testing

With no test configuration, /api/voice-config returns STUN-only. General public TURN issuance is disabled. User-entered encrypted Worker secrets TURN_API_TOKEN, TURN_KEY_ID and TURN_TEST_PUBLIC_IDS allow at most two explicitly nominated public session IDs to request ten-minute credentials. KeyID is nonsecret but stored with encrypted settings so fixed-config releases preserve it. Never commit credentials or paste them into a conversation.

Requests require an authenticated device and a live room socket, are limited to six/minute/session, and reserve one of eight global daily mint attempts before calling the provider. Failed provider calls consume an attempt. Removing test IDs disables new issuance; already issued credentials may remain usable until expiry. These controls are not a provider dollar or byte cap. Run only the specifically authorized short two-client audio test, then stop tracks and connections. No production relay capacity, physical microphone, or cross-network claim follows from local synthetic tests.

A public workers.dev staging URL is publicly reachable, even when unadvertised. Peer-to-peer WebRTC can expose participant network addresses to peers. The chat is unmoderated. Do not move old apex users until the separate v1 continuity, login, guest-transfer and rollback checks pass.
