# Allworld

![Allworld: a whole world to live in](public/og/allworld.png)

Allworld is an open-source browser game: a digital world of real cities you can live in and travel between. You make a character, pick a city, walk around its venues in 3D, work, eat, make friends, play table games, rent or build a home, vote in your local government, and take the road, the train or a flight to the next city. The aim is the whole world. Today nine cities are open: Lagos, Ibadan, Ogun's cities (Abeokuta, Ota, Ijebu-Ode and Sagamu), Port Harcourt, Abuja and Kano, and more places are opening; the in-game atlas shows the world, then Africa, then Nigeria, with other places marked as coming.

Play it at [joinallworld.com](https://joinallworld.com).

**Status: early beta.** [What works today](docs/REFERENCE.md#what-works-today) and [what does not work yet](docs/REFERENCE.md#what-does-not-work-yet) are listed in the reference.

## Quick start

You need [Node.js](https://nodejs.org/) 22.18 or newer (24 is recommended) and npm. Nothing else: no account, no key, no database.

```sh
git clone https://github.com/kromate/joinallworld.git
cd joinallworld
npm install
npm run dev
```

Open http://127.0.0.1:5173/ and press **Play now**. You are a guest with a new character in Freedom Park, Lagos.

- The page reloads when you save a file, and the game server restarts when its code or the rules change.
- Port taken? `npm run dev -- --port 5180`.
- Your local characters are kept in `.data/` (git-ignored). Delete the folder to start clean.

## What you get

- **The whole game, locally.** The rules engine, the nine open cities, the 3D city maps and venue scenes, chat, friends, houses, elections, table games and the atlas all run on your machine.
- **No outside service.** Sign-in, e-mail, push, analytics and error reporting are off unless you configure them, and the game is complete without them. [`.env.example`](.env.example) lists every setting.
- **Small.** Vue 3, strict TypeScript, Three.js and Vite in the browser; Node's built-ins and `ws` on the server. Node runs the TypeScript directly, so there is no server build step.
- **Tested.** About 1,800 tests on Node's built-in runner, next to the code they cover.

## Before a pull request

```sh
npm run check     # typecheck, build, tests: about a minute and a half
```

## Where to go next

| You want to | Read |
| --- | --- |
| Make your first change in half an hour | [docs/FIRST-CHANGE.md](docs/FIRST-CHANGE.md) |
| Know where things live and what the rules of the codebase are | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Try sign-in, mail, two players or the Worker host locally | [docs/DEVELOPING.md](docs/DEVELOPING.md) |
| See every feature, command, setting and file | [docs/REFERENCE.md](docs/REFERENCE.md) |
| Add or change a city | [docs/CITIES.md](docs/CITIES.md) |
| Run a server for other people | [SECURITY.md](SECURITY.md), then [docs/REFERENCE.md](docs/REFERENCE.md#production-build) |
| Report a vulnerability | [SECURITY.md](SECURITY.md) |

Allworld (this repository, `joinallworld`) is original work. No files, assets or code were copied from the earlier Allworld v1 project or from any other game.

## Licence

MIT — see [LICENSE](LICENSE). Third-party data and dependency licences are listed in [NOTICE.md](NOTICE.md).

Direct dependencies: [Three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [ws](https://github.com/websockets/ws) (MIT), [Vue](https://vuejs.org/) (MIT), and — downloaded by a browser only when telemetry is configured — [@sentry/browser](https://github.com/getsentry/sentry-javascript) (MIT) and [posthog-js](https://github.com/PostHog/posthog-js) (Apache-2.0 and MIT). The server sends telemetry with `fetch` and has no SDK. All scene and city-map geometry is written in code.

### Map data credits

The boundaries of the world and of Africa, the Niger and Benue rivers, Lake Chad and the Kainji reservoir, and the positions of capitals come from [Natural Earth](https://www.naturalearthdata.com/) — public domain ("No permission is needed to use Natural Earth"). Files used, from the `geojson` folder of [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector): `ne_50m_admin_0_countries`, `ne_10m_rivers_lake_centerlines`, `ne_10m_lakes` and `ne_10m_populated_places_simple`. Nigeria's 37 states and Lagos State's 20 local governments come from [geoBoundaries](https://www.geoboundaries.org/) gbOpen, release 9469f09 (ADM1 `NGA-ADM1-27671186` and ADM2 `NGA-ADM2-59680162`, original source GRID3, year 2022) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the Lagos Lagoon is derived from the two (the State outline minus the local governments, which are land only). All of it was simplified (Visvalingam–Whyatt on shared borders, so neighbours still meet exactly), quantised and stored as small modules under `src/map3d/geo/data/`; each records its tolerance in its header, and `npm run geo:boundaries` rebuilds the geoBoundaries parts from the pinned, hash-verified sources. The map geometry rules are in [docs/MAP-GEOMETRY.md](docs/MAP-GEOMETRY.md). Natural Earth borders are its default view and imply no position on any dispute. Roads and flight lines on the map are stylised: lists of real towns joined by straight lines, written from general knowledge. Nothing is fetched from a map service at run time. The client names the DM Sans typeface and falls back to a system sans-serif when it is not installed; nothing is loaded from a font service.
