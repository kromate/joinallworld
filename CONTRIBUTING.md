# Contributing

Thanks for helping. The project is small and moving quickly, so the most useful contributions are small too.

## Before you start

You need Node.js 22.18 or newer (24 is recommended; `.nvmrc` names it) and npm. No account, key or database: every outside service is optional and off.

```sh
npm install
npm run dev         # the whole game at http://127.0.0.1:5173/
npm run check       # typecheck, build, tests: about a minute and a half
```

`npm run check` must pass before you open a pull request. CI runs the same steps on Node.js 22 and 24.

## Keep changes small and scoped

- One concern per pull request. A bug fix, one activity, one venue — not a rewrite.
- For anything larger (a new city pack, a storage change, a new protocol message), open an issue first and describe the plan.
- Do not add dependencies without discussing it. The client is Vue, Three.js and Vite; the server is Node built-ins and `ws`. Staying lightweight is a feature.
- Match the surrounding code's style rather than reformatting it.

New here? [docs/FIRST-CHANGE.md](docs/FIRST-CHANGE.md) walks through one small change from edit to pull request, and [docs/DEVELOPING.md](docs/DEVELOPING.md) covers running each host, settings, and trying sign-in, mail and two players locally.

## Project map

| You want to change | Look in |
| --- | --- |
| The rules: what an action does to cash, needs, skills, time | `src/life.ts` (the public entry) and `src/game/systems/` (one file per system). `src/game/registry.ts` is the contract for a system |
| Shared content: jobs, food, furniture, cars, traits, goals, missions | `src/game/content/` (plain data) |
| A city: its venues, activities, fares, local governments, links | `src/game/cities/<city>/` (one folder per city; [docs/CITIES.md](docs/CITIES.md)) |
| A screen, sheet or phone app | `src/app/features/<group>/` (Vue components). `src/app/features/panels.ts` is the contract for a panel; `src/app/state/` holds the stores, `src/app/ui/` the base components |
| Shared styles, keyboard shortcuts, the control kit | `src/ui/` (`tokens.css`, `keys.ts`, `controls.ts`) |
| The 3D city map and the atlas | `src/map3d/` (`geo/` is the atlas; [docs/MAP-GEOMETRY.md](docs/MAP-GEOMETRY.md)) |
| The 3D scene you walk in at a venue or at home | `src/scene/` (`venue-scenes.ts` and `venues-*.ts` build one scene per venue kind) and its host `src/venue-world.ts` |
| What the browser sends and mirrors | `src/client.ts` |
| An HTTP endpoint | `server/routes/` (`index.ts` is the registry and the contract for a route) |
| A WebSocket message | `server/ws/` (`index.ts` is the registry) |
| Player-to-player and city-wide rules | `server/social/`, `server/civic/`, `server/growth/`, `server/world/` |
| The hosts | `server/server.ts` (Node) and `deploy/cloudflare-worker.ts` (Worker); what both share is in `server/host-context.ts`, `server/protocol.ts` and `server/life-service.ts` |
| Types of the life, actions, routes and socket frames | `src/types/` and `server/types.ts` |
| Tests | Next to the code, as `*.test.ts`. `server/test-fixture.ts` starts a real server with a clock the test controls |
| Developer commands | `scripts/` (`dev.ts`, `typecheck.ts`, the scripted journeys) |

The full table, file by file, is under [Layout](docs/REFERENCE.md#layout) in the reference.

## The ideas to respect

- **The server decides.** The browser never changes a life. It sends an action (`POST /api/action`), the server applies it with the rules engine and answers with the new state; `src/client.ts` only mirrors that state, and is read-only while offline. A change that grants anything in the browser is wrong even if it looks right on screen.
- **The rules engine is pure.** Code under `src/game/` and `src/life.ts` does no I/O and reads no clock, random source or DOM: the same code runs on the Node server, the Worker and (to display) the browser. Time and randomness are passed in.
- **Exactly once.** Every action carries an id. A repeat of the same id returns the saved answer and applies nothing; the same id with different contents is refused (`server/routes/once.ts`). Anything that moves money or goods goes through that receipt.
- **Cities are data.** A city is one module of rules, content and map data under `src/game/cities/`, checked by a contract test. Keep city-specific facts in the module, never as `if (city === ...)` in shared code. Read [docs/CITIES.md](docs/CITIES.md) and raise an issue before starting a new city.
- **Strict TypeScript everywhere.** `npm run typecheck` (`scripts/typecheck.ts`) checks five projects, each under the globals of the runtime that runs it, and allows no error. Node runs the `.ts` files directly, so only erasable syntax is allowed: no `enum`, no `namespace`, no constructor parameter properties; imports name the file with its `.ts` extension, and types are imported with `import type`. There are no new JavaScript files: a test fails if one appears.
- **Saved data is untrusted.** Loading must tolerate missing, old or malformed values. Every system rebuilds its slice of a life from whatever was saved.
- **Privacy by construction.** The optional "use my location" control turns the device's position into a local government inside the browser; the coordinates are never sent to the server. Chat in venues is not stored. Telemetry, e-mail and push do nothing until an operator configures them and the player agrees. [SECURITY.md](SECURITY.md) lists what is stored and what other players can see: read the section for the area you touch.
- **The first load has a budget.** `src/app/entry.test.ts` fails when the scripts needed to start the game grow past a fixed size. Load what is not needed at once with a dynamic `import()`.

## Tests

Tests use the built-in runner (`node --test`) and live next to the code as `*.test.ts`, in both `src/` and `server/`.

```sh
npm test                                   # everything: about a minute
node --test src/life.test.ts               # one file: under a second
node --test --watch src/life.test.ts       # again on every save
```

Add or update tests whenever you touch:

- **State changes** — cash, needs, location, active actions. Cover the rejected paths (busy, unaffordable, invalid input) as well as the successful one.
- **Idempotency** — anything keyed by an action ID or client message ID. Show that a repeat does not apply twice, and that the same ID with different contents is rejected.
- **Saved data** — loading must tolerate missing, old or malformed values.

Game rules belong in plain modules such as `src/life.ts` that run without a browser, so they can be tested and shared with the server. A rule is tested through the engine (`createLife`, `startActivity`, `advanceLife`); a route or socket message through `server/test-fixture.ts`; a component through its model (the `*Model.ts` file beside it) where it has one.

## Conventions

- Comments say why, and what must stay true; they do not repeat the code. Many files open with a short contract: read it before changing the file.
- Follow the file you are in for semicolons, line length and naming. Nothing reformats the code, and a pull request should not either.
- Wording players read is plain and short. Prices are in naira with the ₦ sign.
- A value that is a guess is marked `beta: true` (see below).
- Commit messages are one plain sentence saying what changed.

## Accessibility

- Every control must work with a keyboard and have an accessible name.
- Use real `<button>`, `<dialog>` and `<meter>` elements before reaching for ARIA.
- Announce results that are not otherwise visible through the existing live region.
- Never rely on colour, sound or 3D position alone to convey state.
- Check the layout on a narrow phone screen.

## Good first changes

Each of these is one file or two, and has a test you can run in seconds.

| Change | Files | Check with |
| --- | --- | --- |
| Add an activity to a venue (worked through in [docs/FIRST-CHANGE.md](docs/FIRST-CHANGE.md)) | `src/game/cities/lagos/venues.ts`, or another city's `content.ts` | `node --test src/life.test.ts src/game/cities/cityContractTest.test.ts` |
| Add or reword a venue's ambient lines or a spot's caption | the same city files | `node --test src/game/cities/wording.test.ts` |
| Add a keyboard shortcut | `src/ui/keys.ts` (the one list of keys; the help sheet reads it) | `node --test src/ui/keys.test.ts` |
| Improve a venue scene: a prop, a light, a better camera start | `src/scene/venue-scenes.ts`, `src/scene/venues-*.ts`, `src/scene/props.ts` | `node --test src/scene/scenes.test.ts`, and look at it at `/src/scene/harness.html?kind=park` under `npm run dev` |
| Improve a line of the help sheet | `src/app/features/help/HelpBody.vue` | `npm run typecheck`, then open Phone, then Help in the game |
| Fix an accessibility gap: a control without a name, a missing announcement | the component under `src/app/features/` | the test file of that feature group, then the keyboard |

## Proposing a change

1. Fork the repository and make a branch from `main`.
2. Make the change with its test. Run `npm run check`.
3. Open a pull request that says what changes and how to see it. One concern per pull request.
4. CI runs the typecheck, the tests and the build on Node.js 22 and 24. A maintainer reviews; releases are made separately by the maintainers.

## Originality

- **No copied code or assets** from the older Allworld project or from any other game — no extracted scripts, models, textures, audio, icons or text.
- Values that are guesses are marked as provisional (`beta: true` in content, or a placeholder note in code, the way `src/life.ts` does). Do not present guesses as verified.
- Only contribute work you have the right to license under MIT. Note the licence of anything third-party you add.

## Keep these out of the repository

- Secrets: keys, tokens, passwords, `.env` files, cookies. `.env.example` holds names and explanations only.
- The server's data directory (`.data/`).
- Private research material: screenshots or recordings of other services, account details, personal data, and raw audit notes. Summarise the finding in the code comment or pull request instead.

## Cities

Lagos, Ibadan, the four cities of Ogun State, Port Harcourt, Abuja and Kano are the first open cities of a world that is meant to grow. If you add or change city content, keep it as data — venues, spots, fares, map positions — rather than city-specific logic, so the next city can reuse it. The module format is described in [docs/CITIES.md](docs/CITIES.md); raise an issue before investing heavily in a new city.

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
