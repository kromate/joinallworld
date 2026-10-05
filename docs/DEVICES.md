# One character on several devices

A player can have the same character open in more than one place: two tabs of one browser, or a laptop, a phone and a tablet signed in to one account (docs/ACCOUNTS.md: each browser holds its own device binding, and all of them reach one session record). This document says what those devices share, what each keeps to itself, and how they are kept the same.

| What | Where |
| --- | --- |
| The revision, and what counts as a change | `server/life-service.ts` `settleCity`, `server/host-context.ts` `lifeAuthority`, `lifeAnnouncer` |
| The revision in the answers | `server/routes/core.ts` (`GET /api/life`, `POST /api/action`) |
| Calls on several devices | `server/social/calls.ts`, `server/ws/calls.ts` |
| Read state and own changes | `server/social/service.ts`, `server/routes/social.ts`, `server/ws/social.ts` |
| The device's side of the life | `src/client.ts` (`accept`, `lifeChanged`, `wake`) |
| The device's side of a call | `src/calls.ts` (the `elsewhere` phase), `src/app/features/calls/` |
| What the screen does | `src/app/state/devices.ts`, `src/app/state/app.ts` |
| The wire types | `src/types/protocol.ts` `LifeChangedFrame`, `src/types/calls.ts`, `src/types/social.ts` |

## 1. Shared, and per device

**Shared — the server's, the same on every device:** the life (money, needs, health, inventory, job, goals), where the character is (city, venue, a running trip, the house), messages and which of them are read, the updates list and whether it was read, friends, requests, blocks, groups, visits and knocks, who may ring the player, whether the player is in a call, and the account (which browsers are signed in, which character is in play).

**Per device — never pushed from one to another:** which screen is open (the venue, the Map, the Phone and its app, a sheet), the camera, the input mode, sound and the microphone, the tour, the one-time notes a device has shown, and a message being typed.

So when the laptop starts a trip, the phone's scene and trip bar follow it and the phone says once, in a toast, *Continued from your other device.* — and whatever the person has open on the phone stays open. The phone is not taken to the Map because the laptop opened it.

## 2. The life

### The revision

A session record carries `rev`, a number that goes up by one at every settlement of the character (`settleCity`), and so at every request that reads or changes its life. Transactions run one at a time, so two answers made by two requests never carry the same number, and the higher one was made later. `GET /api/life` and `POST /api/action` put it in their answer.

A device keeps the revision of the life it shows. It **never replaces that life with an answer that has a lower revision and was asked for before the newer answer was taken** — two answers that crossed on the way. An answer asked for *afterwards* is taken whatever its number: a server whose data was restored, or a character that came back from the archive, counts from a lower number, and the device must believe it rather than hold on to a life that no longer exists. A new session forgets the held revision. An answer without `rev` (an older server) is taken as before.

### The hint

When a character changes in a way a player would see, every open socket of that character is sent

```
{ "type": "life-changed", "rev": 412, "by": ["1759650000000:6f1c…"] }
```

- **What counts:** an accepted action (from any device, or one the server ran for the player, such as a transfer received), and a settlement whose outcome differs from the one before — money, the ledger, the place, the running action, inventory, job, health, a roadside event, skills, goals, the message — or that changed which city or lives the character has. A poll that only moved the clock is not announced.
- **`rev`** is the revision to have at least. **`by`** lists the ids of the actions that caused it (at most eight); it is absent when no action did.
- **Coalesced:** the frame goes out 40 ms after the first change, one per character, with the highest revision and every cause of that moment. A burst of commands is one or two frames.
- **A hint, not the state.** It is made inside the transaction and sent whether or not the write then succeeded; a device that reads because of it gets what is stored. On the Node host that read waits for the write it could have seen.

A device that receives it:

1. does nothing while one of its own actions is on its way (the answer may already be that change), and looks again when the answer has come;
2. does nothing if it already holds that revision or a later one — which is always the case for the device whose action it was, so nothing is applied twice;
3. otherwise reads `GET /api/life` once, and up to twice more a moment apart if the server had not reached the revision it named;
4. knows the change was made elsewhere when `by` names an action it did not send.

The existing poll (every second during a timed action, once a minute otherwise) is unchanged and is what makes up for a hint that was never delivered.

### Two devices at once

Nothing about this is new: every action runs in one store transaction, after a settlement, under its exactly-once receipt. The second of two actions is judged against the life the first one left: if it is no longer possible it gets its ordinary refusal, with the life as it now is in the answer, and the device shows that life. The same action id from two devices is one action; the second answer says `duplicate`.

### A device that comes back

When the page comes to the front again (`visibilitychange`), when the device is online again, and when its socket opens again after having been open before, the device reads the life at once (`wake`). An action tapped while that read is on its way waits for it and is then sent — about the life the server holds, not about the copy the device had kept. The copy in the browser's storage is replaced by the answer.

## 3. Presence

A player is online while any of their sockets is connected and answering. Closing one of several devices announces nothing and removes the player from nothing: a venue room and a guest's place in a house belong to each socket, and the others keep theirs.

## 4. Calls

A call belongs to the player and is **carried by exactly one socket on each side**: the caller's is the one that sent the invite, the callee's is the one that accepted.

| | |
| --- | --- |
| An incoming call | rings every open socket of the callee, and one that opens while it rings |
| Accept, on any device | that socket carries the call; the others are told `accepted` with `elsewhere`, stop ringing, say *Answered on another device.* for a few seconds and then show *On a call on another device.* |
| Decline, on any device | declines for all |
| The caller cancels, or the ring runs out | every device stops |
| A call placed on one device | the player's other sockets are told `ringing` and then `accepted`, each with `elsewhere`, and show *On a call on another device.* |
| Signalling (offer, answer, candidates) | taken from a carrying socket only, handed to the other side's carrying socket only |
| Cancel or hang up | only from the carrying socket; from another socket of that player it is refused with the error `call_elsewhere` |
| A carrying socket closes | the call is over for everyone, as it is for a player with one device; nothing rings again |
| Any other socket closes or reloads | nothing changes |
| A socket opens during a call | it is told the call is elsewhere (or rings, if the call is still ringing for that player) |
| A second caller | the usual answer, `unreachable`: the player is busy on every device |

The device that shows a call *elsewhere* opens no microphone, makes no connection, offers no button and sends the server nothing about the call. **Only the device that carries the call can end it.** A device that is closed while it only rings does not decline: the others go on ringing.

Consent, blocks, "calls from" and the limits are as before: nothing opens a microphone before the person presses Accept (or, for the caller, taps after the answer) on that device.

**Who may ring you** is the player's setting: a change is sent to every socket of the player.

Calls live in memory. A call keeps the Worker's object awake (a timer), so the object does not sleep under one; if it is replaced, its sockets close and the call ends for both sides, as before.

## 5. Messages, updates, friends

- A message is pushed to every socket of every member, the sender's too (unchanged).
- **Read on one device is read on all:** reading a conversation, or the updates list, sends `social-read` (`{ conv }` with the conversation as it now stands for the reader, or `{ updates: true }`) to every socket of the reader. The others clear the same badge without a request.
- **An own change made elsewhere:** a request by the player that changes their friends, blocks, groups, visits or knocks sends `social-changed` to every socket of that player, and they read the overview again.

## 6. The account

- **Sign out** removes that browser's binding only. The others play on.
- **Sign out everywhere else**, a sign-in that ends earlier bindings, a switch of character and a delete close the sockets concerned with code 4401 (unchanged). A device whose socket is closed with that code now asks at once who it is: if it is signed out, or the account plays another character, it says so in one line, drops the copy of the old life it had kept and starts again.

## 7. Both hosts

The Node server and the Worker run the same code for all of the above. On the Worker a socket's attachment already carries who it is (the session's public identity, its record's key and the cookie it was opened with), so after the object has slept and lost its memory every socket is handed back to the modules and is again counted for presence and reached by pushes. The 40 ms the hint waits is a timer; if the object were replaced inside it the hint would be lost, and the next poll would make up for it.

## 8. What changed in the stored data and on the wire

**Stored:** one optional number, `rev`, on a session record. A record without it reads as 0 and gets it at its next settlement. Nothing else is stored; no table or collection is added. An archived life does not keep it (it starts again at the next settlement, which the device rule above allows for).

**HTTP:** `rev` in the answers of `GET /api/life` and `POST /api/action`.

**Server → client frames, new:** `life-changed { rev, by? }`, `social-read { conv? , updates? }`, `social-changed {}`.

**Server → client frames, changed:** `call-state` with `elsewhere: true` is now also sent with `ringing` and `accepted` to the caller's other sockets and to a socket that opens during a call; `call-incoming` is also sent to a socket that opens while its player is being rung; `call-settings` is sent to every socket of the player when the setting changes.

**Socket errors, new:** `call_elsewhere`.

**No client → server frame is new or changed.**

A client that does not know the new frames ignores them, as the protocol already requires.

## 9. Tests

| | |
| --- | --- |
| The server, one character on three signed-in browsers | `server/devices.test.ts` |
| The Worker | `deploy/devices.edge.test.ts` |
| The device's model of the life | `src/client-devices.test.ts` |
| The device's side of a call | `src/calls.test.ts` (the last four tests), `src/app/features/calls/callsComponents.test.ts` |
| The socket seam | `src/app/features/calls/callsSocket.test.ts` |
| What the screen does | `src/app/state/devices.test.ts` |
