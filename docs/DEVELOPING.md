# Developing locally

How to run the game on your machine in each of its forms, and how to try the optional parts without any outside service. The quick start is in the [README](../README.md); the rules of the codebase are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## The three ways to run it

| Command | What runs | When to use it |
| --- | --- | --- |
| `npm run dev` | Vite in front of the Node game server, at http://127.0.0.1:5173/ | Almost always. The page reloads on save; the game server restarts when a file it loads changes |
| `npm run build` then `npm start` | The built page, the API and the WebSocket from one Node process, at http://localhost:3001/ | To check the production build, sizes and headers |
| `npm run build` then `npm run start:worker` | The same game on the Worker host (Miniflare), at http://localhost:8787/ | Only when you change `deploy/**` or something both hosts share (`server/host-context.ts`, `server/protocol.ts`, `server/life-service.ts`, a route or socket module) |

`npm run dev -- --port 5180` (or `DEV_PORT`), `PORT` for the other two. Each one says in one line what to do when its port is taken. Local characters live in `.data/` (git-ignored); delete it to start clean. The Worker host keeps its data in a temporary folder unless `DATA_DIR` is set.

The Worker host needs its own pinned tooling, installed once (about 215 MB, kept apart from the game's dependencies on purpose):

```sh
npm ci --ignore-scripts --prefix deploy/tooling
npm run build
npm run start:worker
npm run test:edge       # the Worker host's own tests, about two minutes
```

Nothing here deploys anything. Releases are made by a reviewed workflow outside this repository ([deploy/README.md](../deploy/README.md)). Telling players an update is coming (a signed announcement, no server secret) is described there too, under "Announcing an update".

## Settings

The game needs none. [`.env.example`](../.env.example) lists every setting with one line each; the tables in [REFERENCE.md](REFERENCE.md#commands-and-settings) say more.

To use some, copy `.env.example` to `.env` (git-ignored), uncomment what you need and pass the file:

```sh
npm run dev -- --env .env
node --env-file=.env server/server.ts          # the built game
```

No file is read unless you name it. It is read by Node's own parser, never by a shell, and a variable already set in your environment wins. Never commit a settings file with real values.

## Optional features, locally

Everything below is off by default, and the game is complete without it.

### Sign-in

Accounts are off locally: with no `ACCOUNTS_*` setting the page shows no sign-in and everybody is a guest, which is how most of the game is built and tested. There is no fake sign-in in the running game, by design: the only code that can mint a token is test support (`server/accounts/test-tokens.ts`), which nothing in the game imports.

- To work on account rules, use the tests: `node --test server/auth.test.ts server/accounts/token.test.ts`. They start a real server with a stand-in provider that signs tokens with keys made in the test, so every path (sign-up, a second device, setting a character aside, sign-out) runs without a provider.
- To see the real sign-in screens, create your own project with the identity provider, put its public web settings in `.env` (`ACCOUNTS_FIREBASE_PROJECT_ID`, `ACCOUNTS_FIREBASE_API_KEY`) and run `npm run dev -- --env .env`. [ACCOUNTS.md](ACCOUNTS.md) has the design.

### E-mail and push

Without mail settings, e-mail is in dry-run: a message is composed and kept as a preview, and nothing leaves your machine. To read the previews, give the local server an operator token (any 24 or more characters) in `.env`:

```sh
MODERATOR_TOKEN=local-only-moderator-token-1
```

```sh
npm run dev -- --env .env
curl -s -H "Authorization: Bearer local-only-moderator-token-1" http://127.0.0.1:5173/api/mod/growth/outreach
```

The answer has the last ten previews and the log (it says `dry-run`). When a player asks for the confirmation e-mail in dry-run, their own screen shows the confirmation link instead. Push keys are made on first use and kept under `.data/keys/`. [COMEBACK-MAIL.md](COMEBACK-MAIL.md) describes the scheduled messages.

### Telemetry

Off, and it does not run on `localhost` unless `TELEMETRY_DEBUG=1` is set as well. To see exactly what would be sent, run the bundled stand-in, which records everything and talks to nobody: see "Local preview" under [Telemetry](REFERENCE.md#telemetry-off-unless-configured).

### Two players on one machine

A player is a browser session (one cookie). Two tabs of the same browser are the same character, so use two browser profiles: a normal window and a private window, or two different browsers, both on http://127.0.0.1:5173/. Put both characters in the same venue to see presence, chat, friend requests and table games.

The scripted version, with no browser at all, is `npm run two-players`.

### Several cities

All nine open cities run locally. Open the Map, press **World map** to reach the atlas, then choose an open city and one of its routes; the fare is charged once, at departure. `npm run two-cities` plays Lagos to Ibadan and back against a real server. City content is data: [CITIES.md](CITIES.md).

### Development-only pages

Served by `npm run dev` only, never built:

- http://127.0.0.1:5173/src/scene/harness.html?kind=park&time=night&crowd=8 shows one venue scene on its own, with buttons for every kind and time of day.
- `npm run preview:models` is the model workshop ([MODELS.md](MODELS.md)); `npm run preview:campus` is the walkable campus ([CAMPUS-UNILAG.md](CAMPUS-UNILAG.md)).

## Tests

```sh
npm test                                   # everything under src/ and server/: about a minute
node --test src/life.test.ts               # one file: under a second
node --test --watch src/life.test.ts       # run it again on every save
node --test --test-name-pattern="Chill" src/life.test.ts
npm run typecheck                          # about 10 seconds
npm run check                              # typecheck, build, tests: what a pull request must pass
```

Typechecks run one project at a time. `npm test` and `npm run test:edge` run one test file at a time. Run builds and browser checks separately on a machine shared with other work.

A few tests read the built page in `dist/` (the first-load size budget, the release rules). They are skipped when there is no build and run against whatever build is there, so `npm run check` builds first.

Scripted journeys print a transcript and are useful when you change the rules: `npm run first-minute`, `npm run first-day`, `npm run new-player`, `npm run two-players`, `npm run two-cities`, `npm run economy`.

A running copy can be checked in about a minute with `npm run smoke -- <origin>` (the origin defaults to `http://127.0.0.1:5173`; `npm start` and `npm run start:worker` print theirs). It reads the health answer and build id, the page with its security headers and every asset and script it references, makes one guest named "Zz Test", loads its life and the world pulse, opens the socket and waits for the counts frame, sends one harmless action and repeats its id to see it answered as a duplicate, and fetches the content and map chunk of every open city. It makes a few dozen requests, prints one line per check and a PASS summary, and exits non-zero with a single FAIL line at the first problem. Against `npm run dev` the security headers and the built chunks are not there, so those two checks are skipped.

## Working with several agents

Many agents can work in separate git worktrees of this repository at once, and a build, a full test run or a typecheck each takes a gigabyte or more, so those commands wait their turn in machine-wide "slots". `npm run slot -- <heavy|server|browser> [--wait-ms N] -- <command...>` runs the command once a slot of that kind is free (at most 3 `heavy`, 2 `server`, 1 `browser` at a time; change a limit with `AGENT_SLOT_HEAVY`, `AGENT_SLOT_SERVER` or `AGENT_SLOT_BROWSER`), prints a line such as `waiting for heavy slot (3/3 busy: ...)` while it waits, passes the command's output and exit code through, and gives the slot back when the command ends or is interrupted. `npm run check:slot`, `test:slot`, `build:slot` and `typecheck:slot` are the same commands as `check`, `test`, `build` and `typecheck` inside a `heavy` slot, and `npm run slot -- status` lists who holds what. The locks are files in `agent-slots/` inside the repository's shared git directory (`git rev-parse --git-common-dir`), so every worktree sees the same ones; a lock whose process is gone is reclaimed by the next caller. Running a single test file with `node --test` needs no slot.

## When something does not start

| You see | Do |
| --- | --- |
| `Allworld needs Node.js 22.18 or newer` | Install a newer Node.js; with a version manager, `nvm install` in this folder reads `.nvmrc` |
| `The dependencies are not installed yet` | `npm install` |
| `port 5173 is already in use` | Stop the other copy, or `npm run dev -- --port 5180` |
| `There is no built page in dist/` | `npm run build`, or use `npm run dev` |
| `The Worker tooling (Miniflare) is not installed` | `npm ci --ignore-scripts --prefix deploy/tooling` |
| The page says it is not connected | The game server stopped: read the terminal. Saving the file that broke it starts it again |
