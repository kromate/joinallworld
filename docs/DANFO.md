# Drive a danfo

Phase 1 of [WOW-PLAN.md](WOW-PLAN.md). A job at the motor park: take a danfo (a trotro in Accra, a matatu in Nairobi, a taxi in Kampala,
a daladala in Dar es Salaam) down a real line of the city, stop for people, drop them where they are going and collect the fares in game
naira. Friends can ride along or be the conductor. Every run ends with a card and a clip, and every line has a weekly board.

Game naira only: paid by the game into the life's wallet through the living-world server action. Never real money, never bought, never
withdrawn (see the money rules in [EARN.md](EARN.md) and Phase 0 of the plan).

## What a person sees

1. **Phone → Drive a danfo** (the Money group, on the ride picture), or the short address **joinallworld.com/danfo** (for the advert). The motor park of the player's city: "At Ojota Motor Park",
   the traffic right now, today's earnings against the caps, the city's lines (each with this week's best driver), runs leaving now that
   can be joined, and each line's weekly board.
2. **Drive.** The run opens full screen: the 3D road seen from behind the bus, or the 2D lanes from above on a weak device (a 3D/2D button
   switches; the choice is kept on the device). Phone: ◀ ▶ change lane, Go and Brake pedals. Keyboard: arrows or WASD, space brakes.
3. **The road.** Three lanes, the kerb lane on the side the city drives on (left in Nairobi, Kampala and Dar es Salaam). Saloons, kekes,
   okadas (which cut in), other danfos and trucks; go-slow stretches where everything crawls; potholes that jolt the bus.
4. **Stops.** Every stop has a yellow bay on the kerb lane, a shelter with its name and people waiting. Stand still in the bay for
   1.5 s: people for that stop get off and pay, anyone carried past their stop gets off and pays half, and the waiting get on while there
   are seats (14). Drive past and the waiting are left on the roadside and the people for that stop complain. The road ends at the last
   stop; stop there to finish.
5. **The fare meter** shows fares taken and people aboard; the HUD shows the next stop and its distance, the time and the speed.
6. **The conductor** calls the stops in a speech bubble ("Maryland! Maryland! Enter with your change!"), reacts to hard brakes, crashes,
   potholes, go-slow and okadas, with a gloss for local words ("owa: I am getting off here"). The game's own conductor is labelled AI. A
   player who joined as conductor calls the stops instead (Phone → Drive a danfo → Call the stop); the driver sees those calls with the
   conductor's name.
7. **The end card:** the line, the time, the money, "Best driver on the Ikorodu Road this week" (or the place on the board), passengers
   dropped, fares, bonuses and penalties. **Clip it** replays the last eight seconds in the 2D lanes in the phone-story shape and ends on the
   card; **Share card** is the card as a picture. Both go to Capture, which adds the @handle mark and opens the share sheet.

## The money

| | Amount |
| --- | --- |
| One passenger's fare | ₦150 + ₦80 per stop ridden, at most ₦800 |
| Time bonus | 10% of fares when the run beats the line's target time |
| Crew bonus | ₦150 for each player riding along (up to 4), +10% of fares with a player conductor |
| Penalties | hard brake ₦50, crash ₦200, a stop passed with people for it or waiting at it ₦150 |
| A run | at most ₦18,000 (a typical honest Lagos run makes about ₦9,000–₦11,000) |
| A game day | at most ₦45,000 from danfo work, and 12 paid runs |
| The conductor | collects 15% of the run's fares, counted toward the conductor's own day |

Numbers are in `src/danfo/run.ts` and `src/danfo/routes.ts`. The wallet action refuses any danfo payment above the day cap
(`DANFO_DAY_CAP` in `src/game/systems/living-world.ts`, kept equal to `DAY_CAP` by a test).

## How the server keeps it honest

The browser plays the road; the server decides what a run is worth (`server/danfo/service.ts`).

- **The seed and the traffic are the server's.** A run's seed (who waits where, the traffic, the go-slow) is drawn at the start; the
  traffic level comes from the people out in the city right now (the pulse) and the hour (rush hours 7–10 and 17–21, Lagos time).
- **The server times every stop.** The browser reports only "served" or "passed" for the next stop. The server stamps the time itself and
  refuses a stop reached sooner than the bus's top speed allows (85% of the road at 22 m/s, plus 1.5 s at every stop served before). Such
  a run is void: nothing is paid. Reports must come in order; a repeat of a report already taken is harmless.
- **The server settles from its own record.** At the end it recomputes the fares with the same function the fare meter uses
  (`tally`), from the stops it recorded and the seed it drew. The browser's count of hard brakes and crashes can only take money away.
- **Caps.** Per run, per game day and paid runs per day, as above. A run past 20 minutes is closed.
- **Once.** Starting, finishing and collecting are exactly-once per request id (`ctx.once`); a second finish or collect reports the first.

## Crew

Players in the same city see runs leaving now and can **Ride** (a passenger: the driver earns the crew bonus) or **Be the conductor**
(one per bus). The ride-along view shows the line, the stops passed and the conductor's calls; the conductor's taps pick lines from the
city's conductor bank (no free text reaches another player). After the run the conductor collects their share. Blocked players do not
see each other's runs.

## The weekly board and the gist

Each line has a board for the game week (Monday to Sunday, Lagos time): one row per driver, their best run, ranked by money then time,
20 rows. When a run takes first place from someone else (or is the first of the week), the city's gist gets a line: "Tunde made ₦12,400
on the Ikorodu Road run". Names follow the gist rules: an adult who is not hidden from the directory; otherwise "a resident" in the gist
and "A driver" on the board.

## Lines

| City | Line | Road | Vehicle |
| --- | --- | --- | --- |
| Lagos | Ojota – Obalende | Ikorodu Road | danfo |
| Lagos | Oshodi – Mile 2 | Oshodi–Apapa Expressway | danfo |
| Lagos | CMS – Ajah | Lekki–Epe Expressway | danfo |
| Abuja | Wuse – Mararaba | Nyanya Road | bus |
| Ibadan | Iwo Road – Challenge | the Ring Road | danfo |
| Port Harcourt | Rumuokoro – Mile 1 | Ikwerre Road | bus |
| Accra | Circle – Madina, Circle – Kasoa | the Legon Road, the Winneba Road | trotro |
| Nairobi | Kencom – Karen, Odeon – Githurai 45 | Ngong Road, Thika Road | matatu |
| Kampala | Old Taxi Park – Kiwatule | the Kira Road | taxi |
| Dar es Salaam | Posta – Ubungo | Morogoro Road | daladala |

Stops and distances are rounded from public knowledge of the routes, not a survey; a correction is a change to the line's `version`. A
city with no line says so at its motor park. Adding a line: add it to `DANFO_ROUTES` (5–9 stops, distances increasing); the tests check
the city exists and the run length.

## Conductor lines (BETA)

`src/danfo/conductor.ts` holds one small bank per region in the shape of the talk banks ([TALK-BANKS.md](TALK-BANKS.md)): topics (call,
approach, served, passed, hard brake, crash, bump, go-slow, cut-in, done), a voice and a gloss for every local word. Nigerian cities share
the pidgin bank, Accra has its own, Nairobi, Kampala and Dar es Salaam share a Swahili-flavoured bank, and any other city gets plain words.
The generated talk banks belong to venue regulars and house characters and are hundreds of kilobytes a city, so the conductor does not
load them. Like the talk banks' phrasebook, the phrases await review by fluent speakers.

## Radio

Between the conductor's calls the run shows a "Radio" line in the same bubble when the conductor has been quiet for 20 seconds: a line the city
news ticker posted in the last hour (docs/GIST.md, "The ticker"), or a line about the hour in the city's register. Text only; `src/news/radio.ts`
is fetched at the first quiet stretch of a run.

## Views and devices

- **3D road** (`src/app/features/danfo/roadView3d.ts`): the game's procedural vehicles (`src/models/vehicles`), pooled; instanced lane
  dashes, buildings and people; fog hides the far road. Loaded only when chosen, in its own chunk with three.
- **2D lanes** (`laneView.ts`): a 2D canvas, the view for weak devices and the frames of the clip.
- **Which one:** the street-life device tier (`src/scene/street-life/plan.ts`, the dive's rules): `cut` devices (reduced motion, save
  data, two cores or fewer, under 2 GB) get the lanes; others get 3D when WebGL works and the admin setting `danfo3d` is on. A device
  that cannot keep up (slow frames for about four seconds) is moved to the lanes.
- Nothing of the danfo code is in the first download: the panel's metadata is one line; the app, the road and the views load when opened.

## Admin settings

- `danfoOpen` (on): the motor park is open. Off, nobody can start a run.
- `danfo3d` (on): the 3D road is offered. Off, everyone drives the 2D lanes.

## API

`server/routes/danfo.ts`, types in `src/types/danfo.ts`: `GET /api/danfo/park?city=`, `POST /api/danfo/start`, `POST /api/danfo/stop`,
`POST /api/danfo/finish`, `POST /api/danfo/abandon`, `GET /api/danfo/run?id=`, `POST /api/danfo/join`, `POST /api/danfo/leave`,
`POST /api/danfo/shout`, `POST /api/danfo/collect`, `GET /api/danfo/board?route=`.

Storage: the `danfo` collection (keyed: runs, active, riding, days, boards). A run is kept for a day after it starts. Permanent erasure
removes a player's runs as driver, their crew places and calls, their days and their board rows (`forgetDanfoPlayers`).

## Measures

Telemetry events: `danfo_run` (start, end with the money and the line), `danfo_clip` (clip or card shared to Capture), `danfo_crew`
(passenger or conductor). Runs per day and per person, clips shared from runs, and the day-7 return of people who drove come from these.

## Tests

- `src/danfo/danfo.test.ts`: the lines, the road scale, the people at the stops, traffic, the tally and its caps, a careful driver
  completing every line no faster than the server allows, passing stops, hard brakes, crashes, the conductor banks, the weekly board.
- `src/app/features/danfo/runModel.test.ts`: the view choice, controls, the conductor's moments, the clip frames, the card.
- `server/danfo.test.ts`: the park, a too-fast run voided, an honest run settled from the server's record and paid once, the board,
  the gist line, the last stop, the day cap, leaving, a conductor's calls and share, erasure.

## Not yet

- A passenger player watches the run as a progress strip, not on the road itself.
- The 3D road is a straight road with the line's stops, not the city's real street geometry.
- Phase 8's group trips (a crew booking one danfo to travel together) are separate.
