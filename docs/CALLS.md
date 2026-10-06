# One-to-one voice calls

How a call connects, what the host needs for it to work on mobile data, the limits, and how to check that it does.
Rooms' voice circles are separate (`GET /api/voice-config`) and are not described here.

## How a call connects

1. The caller taps Call. The invite goes out and the microphone is asked for at once, so the permission prompt appears
   while the phone rings. The microphone track stays **disabled** until the audio is connected (and while muted).
2. The callee taps Answer, which asks for their microphone, and only then accepts. Nothing is gathered, sent or revealed
   before the accept: no connection object exists, no candidate is sent.
3. After `accepted`, each side asks the host for its connection servers over the social socket (`call-ice`). The answer
   (`call-ice`) is STUN plus, when the relay is on and a limit allows, **relay servers (UDP, TCP and TLS on 443) with
   credentials made for this call and this player**, valid one hour. The API token never leaves the host.
4. The caller offers, the callee answers, candidates trickle over the socket. Direct paths win; the relay is the automatic
   fallback (`iceTransportPolicy: all`).
5. `disconnected` or `failed` shows "Reconnecting…" and the caller restarts ICE (after 3 s, then every 6 s, at most 4
   times). Waits are bounded: 20 s to connect, 30 s to recover.
6. When connected, each side reads `getStats` every 2 s: the route (direct or relay), packet loss, round trip. The route
   is reported once per call to the host (`call-report`), which only counts it.

Why a call on mobile data needs the relay: carrier networks often put many phones behind one address and refuse
unsolicited inbound packets, so two devices cannot reach each other directly. Only a relay both can reach connects them.

## Settings (both hosts)

| Setting | Meaning | Default |
|---|---|---|
| `TURN_KEY_ID`, `TURN_API_TOKEN` | the relay provider's key (Cloudflare Realtime TURN). Both present = relay on | unset = off, STUN only |
| `CALL_RELAY_PER_PLAYER_DAY` | credentials one player may be given per UTC day | 30 |
| `CALL_RELAY_PER_ADDRESS_HOUR` | credentials one network address may be given per hour | 120 |
| `CALL_RELAY_DAILY_CEILING` | credentials the whole host gives out per UTC day | 3000 |

A call takes two credentials (one per side); a restart that needs fresh servers takes one more, at most three per side per
call. When a limit is reached the call is not refused: it carries on with STUN only and, if it then cannot connect, the
player is told "Could not connect — your networks need a relay that is not available right now." The old
`TURN_TEST_PUBLIC_IDS` / eight-a-day cap now belongs only to the room-voice test endpoint.

On the Worker the daily count is kept in the Durable Object's own storage (table `call_relay_budget`), so the ceiling
holds across restarts; the per-player and per-address counts are in memory. On Node everything is in memory.

### Cost

Audio is Opus at about 32-40 kbit/s each way, roughly 0.6 MB per minute of relayed call for both directions together.
At Cloudflare's published rate (1000 GB a month free, then about 0.05 USD per GB; check the current price list, this is
from memory) the defaults bound the host to 1500 relayed calls a day. Ten minutes each would be about 9 GB a day:
inside the free allowance for 100+ days a month and under 0.50 USD a day beyond it. Not every credential becomes relayed
traffic: calls that connect directly use none.

## How to check that the relay is on

`curl https://<origin>/api/health` and read the boolean `relay`. `true` means both `TURN_KEY_ID` and `TURN_API_TOKEN` are
set on that host. It cannot say the key is valid; for that read the operator overview
(`GET /api/mod/overview`, bearer token), field `calls`:

```
calls: { relay, placed, connectedDirect, connectedViaRelay, failedToConnect, relayMintsToday, relayLimits }
```

All counts are for the current UTC day, with no names or ids. Many `failedToConnect` and no `connectedViaRelay` with
`relay: true` means the key is wrong or the provider is refusing; `relayMintsToday` near the ceiling means the limit is
what players are hitting.

## Sounds

Synthesised with the Web Audio API (no audio files): ringback for the caller, a different ring (and vibration on phones)
for the callee, short tones for connected, ended, declined and failed. The level is the shared `calls` sound level
(`src/audio/settings.ts`; the speaker button and Settings change it). Sound starts only after a tap on the page; a ring
that arrives earlier waits for the first touch and the card says so. A notification is shown for a hidden page only if the
player already allowed notifications. The call state is also announced to the game's sound system through the window
event `jaw:call-active` (`detail`: boolean).

## Screens

Call card (ringing, incoming, connecting), a draggable pill during the call, a summary for three seconds (eight when a
call failed), and one quiet line on devices that do not carry the call (docs/DEVICES.md). A missed call leaves a line in
Messages, Updates ("Missed call from …").
