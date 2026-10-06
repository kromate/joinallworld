# Location-confirmed badge

An optional badge that says a player's own device placed them in the local government they live in. It is not a location feature.

## What is checked, and where

The player presses "Confirm where I live with my device's location", reads two lines of explanation and presses "Check now". The page then asks the browser for a position **once** (`getCurrentPosition`, high accuracy off, 10 second timeout, no watching, nothing in the background). On the device, the position is tested against the real boundary of the player's **main-home** local government (`src/map3d/residence.ts`, using the same boundary data and projection as the maps, `docs/MAP-GEOMETRY.md`). Only that city's boundary data is loaded, and only at this moment.

- A position inside the boundary confirms.
- A position outside it but within `BORDER_TOLERANCE_M` (1,500 m), or within the accuracy radius the device reported, also confirms: consumer location is imprecise near borders.
- A fix worse than `MAX_ACCURACY_M` (5,000 m) is never used, even if it falls inside (a desktop located by its network address is often kilometres wrong). The player is told why.
- Anything else is refused on the device with a kind message, and **nothing is sent**.

The position is a local value of one function. It is not stored, logged, put in an error report or analytics event, or sent. Tests watch fetch, sockets, beacons, the console and the telemetry scrubbers during a full check, and scan the sources for anything else that reads a position.

## What leaves the device

Only after a match, one ordinary game action:

```json
{ "type": "estate.confirm-residence", "payload": { "lga": "ikeja", "ok": true }, "actionId": "<ms>:<uuid>", "cityId": "lagos" }
```

No coordinates, accuracy, GPS timestamp or distance. The action id makes it exactly-once. It is limited to 5 per player per day (a stored long-window key on both hosts).

## What is stored

One optional field on the life's estate slice, absent by default: `estate.confirmed?: { lga: LgaId, at: Ms }` (the main-home local government id and the **server's** clock). Lives saved before the badge existed load unchanged. The server checks only that `lga` is the player's current main-home local government.

It ends when any of these happens: the player switches the badge off (the field is deleted; coming back needs a fresh check); 90 days pass (`CONFIRMATION_DAYS`); the main home moves to another city or its local government changes. The badge then disappears and the card quietly offers a new check. It belongs to the character, so it follows the account across devices; the check itself runs on whichever device presses the button. Guests who have settled in can use it.

## Who sees what

The badge reads "Lives in <Local Government> · confirmed by their device"; on cards and lists it is a small pin-with-tick and the name. The name of a player's local government is already public: players are listed in the directory of the local government they live in (`GET /api/world/lga/:id/people`) unless they chose to be hidden. So a listed player shows the name, and a player hidden from directories shows only a plain "Location-confirmed", to everyone. Nothing is shown about distance, direction, "nearby" or a last position, and nothing changes as the person moves.

It appears on the player card, People, Messages headers, Neighbours (with an optional "Location-confirmed only" filter), governor candidates and shop owner lines. It never gates anything: voting, standing for office and every other feature work without it. There is no reward for confirming.

## What it does not prove

The check runs on the player's device, so the server cannot verify it. A determined person can fake it: a browser developer tool or an extension can report any position, a phone can run a location spoofing app, and anyone can ask a friend to press the button. It says a device claimed to be in the area at some moment in the last 90 days. It is not an identity check, no document was looked at, and the game does not know where anyone is. That is why the wording says "confirmed by their device".

## Why the game never receives coordinates

Receiving them would make the game a store of where its players are. The design avoids that: the test runs where the position already is, the boundary data comes to the device rather than the position going to the server, and the one message back is a local-government id the player already chose plus a yes. The `Permissions-Policy` header allows geolocation for the page itself only (`geolocation=(self)`), and the telemetry scrubbers refuse position-like properties and numbers.
