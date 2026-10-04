# Moving Allworld to Vue 3 and TypeScript

The game is plain JavaScript today. It is being moved to Vue 3 single-file components and
TypeScript in steps, and it ships at every step. This document is the plan: what exists now, the
conventions, the order, how each step is checked, and what everyone working on the code has to do
in the meantime.

Steps 0 and 1 are done on `parity/vue-ts`. Steps 2 to 8 start at the freeze point
([below](#the-freeze-point)).

## What exists now

| Piece | Where | State |
|---|---|---|
| Tooling | `tsconfig.base.json`, `tsconfig/*.json`, `scripts/typecheck.mjs`, `vite.config.js` | Done |
| Types for the engine, the protocol and the server | `src/types/*.ts`, `server/types.ts` | Done, as new files |
| Type check of the existing JavaScript | `tsconfig/baseline.json` | Running, against a baseline |
| The Vue shell | `next.html` → `src/app/` | Playable beside the existing shell, from the landing screen of a new device on (the quick start). Invite, share and table links are handled only by the existing shell |
| Adapter for existing panels | `src/app/legacy/LegacyPanel.vue`, `src/app/state/panels.ts` | Done |
| Converted screens | Bank, Messages, Report a problem, the top bar, the needs strip | Done as new files |
| Converted engine modules | `src/game/clock.ts`, `src/game/systems/wallet.ts` | Twins of the `.js`, held equal by tests |

`index.html` still starts `src/life-main.js`. No existing source file has been renamed or
rewritten. Three existing files were edited: `package.json`, `vite.config.js` (the Vue plugin and
the second entry) and `.github/workflows/ci.yml` (the typecheck step).

## Tooling

### Commands

```sh
npm run typecheck   # vue-tsc --noEmit over five projects, against the baseline
npm test            # node --test, .js and .ts test files together
npm run build       # index.html, next.html and voice-test.html
```

### Type-check projects

Each project checks the files it owns under the globals of the runtime that executes them, so a
DOM call in the engine or a Node call in code the Worker runs is an error.

| Project | Files | Globals |
|---|---|---|
| `engine` | `src/game/**`, `src/life.js`, `src/types/**` | ES2023 only: no DOM, no Node |
| `client` | the rest of `src/` | DOM, Vite |
| `server` | `server/**`, `scripts/**`, `vite.config.js` | Node |
| `worker` | `deploy/*.js`, `server/protocol.js`, `server/life-service.js` | Cloudflare Workers |
| `test` | `*.test.js`, `*.test.ts`, `deploy/*.test.mjs` | Node and DOM |

`tsconfig.json` at the root is for editors only: one program over the whole tree.

The options match the owner's other project: `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`.
`allowJs` and `checkJs` are added for the transition.

### The baseline

New `.ts` and `.vue` code must be clean: one error fails the run.

Existing JavaScript is checked in place and starts with a recorded number of errors per file and
per error code. The run fails when a file has more errors of a code than recorded, and says when it
has fewer.

| Project | Files with errors | Errors | "No annotations yet" | Other |
|---|---|---|---|---|
| engine | 25 | 1,389 | 1,256 | 133 |
| client | 94 | 5,479 | 4,339 | 1,140 |
| server | 34 | 1,707 | 1,411 | 296 |
| worker | 4 | 127 | 110 | 17 |
| test | 60 | 4,167 | 1,681 | 2,486 |
| **total** | **217** | **12,869** | **8,797** | **4,072** |

"No annotations yet" is the implicit-`any` family (TS7xxx). The other errors were read for real
defects; the findings are in [Defects the type checker found](#defects-the-type-checker-found).
The rest are artifacts of inference on untyped code, and each disappears when its file gets types.

```sh
node scripts/typecheck.mjs --summary        # the table above
node scripts/typecheck.mjs --list           # every baselined error that is not "no annotations"
node scripts/typecheck.mjs --list TS2339    # one code
node scripts/typecheck.mjs --update         # record the current state
```

The baseline only shrinks, with one exception: a merge of untyped JavaScript from a sibling branch
adds errors nobody could have avoided. Record them with `--update` in the merge commit and say so.

### TypeScript in Node, Vite and the Worker

One rule makes all three agree: **write the real extension in every import** (`./clock.ts`,
`./client.js`, `./BankApp.vue`).

- **Node.** Node 22.18 and later, and Node 24, strip types by default. Node 22.12 to 22.17 need
  `--experimental-strip-types`, so `npm test` passes it; newer versions accept the flag and ignore
  it. Checked on 24.14.1 after the merge of the quick start, the world and growth: 756 tests, 752
  pass, 4 skipped (22.12.0 was last checked before that merge). Node only strips, so
  files it runs use erasable syntax: no `enum`, no parameter properties, no namespaces
  (`erasableSyntaxOnly` enforces it).
- **Vite** compiles `.ts` and `.vue` with no configuration beyond the Vue plugin.
- **The Worker.** Checked with a throwaway Worker that imports `clock.ts`, `wallet.ts`,
  `src/types/actions.ts` and `src/life.js`: `wrangler deploy --dry-run` from `deploy/tooling`
  (wrangler 4.147.0) bundled it with no configuration. Nothing in `deploy/` was changed.
- **A sibling `.ts` wins in the type checker.** For `import './clock.js'` TypeScript reads
  `clock.ts` if it exists; Node, Vite and esbuild load `clock.js`. That is how the two twins give
  their JavaScript callers types today. It also means: never add a `.ts` next to a `.js` of the
  same name unless it is that module's twin and a test holds the two equal.

### Dependencies added

| Package | Version | Why |
|---|---|---|
| `vue` | 3.5.41 | The UI framework (runtime dependency) |
| `typescript` | 6.0.3 | The compiler behind `vue-tsc` |
| `vue-tsc` | 3.3.11 | Type-checks `.vue` files and templates |
| `@vitejs/plugin-vue` | 6.0.8 | Compiles single-file components |
| `@types/node` | 24.19.0 | Node types for the server and tests |
| `@types/three` | 0.180.0 | Matches the installed `three` |
| `@types/ws` | 8.18.2 | Types for the server's sockets |
| `@cloudflare/workers-types` | 5.20261004.1 | The Worker project's globals |

Versions match the owner's other project where it uses the same package. Vite stays at 7: the other
project is on 8, which changes the bundler under four other branches; do that upgrade by itself
after the freeze. There is no UI kit, no CSS framework, no state library and no test framework.

## Target layout

```
next.html → index.html at step 8
src/
  app/                  the Vue application
    main.ts  App.vue
    state/              stores: game.ts, shell.ts, panels.ts, toasts.ts, app.ts (wiring)
    ui/                 base components and format.ts
    features/<area>/    one folder per screen: BankApp.vue, bankModel.ts, …
    scene/              components that own a canvas: ScenePane.vue, MapPane.vue
    legacy/             LegacyPanel.vue and the typed boundary to JavaScript (deleted at step 8)
    types/              client and panel contracts
    testing/            fakeServer.ts
  game/                 the rules engine (.ts after step 2)
  types/                engine, protocol, social, civic, support types
  scene/ map3d/         Three.js modules (.ts after step 7)
server/                 the Node server (.ts after step 3); types.ts
deploy/                 the Worker (the deploy owner's)
```

At step 8 `src/ui/` is empty and removed, `src/app/legacy/` is deleted, and the types in
`src/types/` that describe one module move into that module.

## Conventions

They follow the owner's other project, so the two read as one author's.

- **Files.** Components are `PascalCase.vue` with multi-word names (`BankApp`, `HudBar`,
  `BaseButton`). Modules are `camelCase.ts`. A screen's logic that needs no DOM lives beside it as
  `<name>Model.ts`, where `node --test` reaches it.
- **Components.** `<script setup lang="ts">`, then `<template>`, then `<style scoped>`. A header
  comment says what the component is for. Two-space indent, single quotes, no semicolons.
- **Props and emits** are typed with the type-only forms: `defineProps<{ … }>()`,
  `withDefaults(…)`, `defineEmits<{ close: [by: 'escape' | 'backdrop'] }>()`. Document a prop where
  its name does not say it all.
- **Styles** are scoped and use the tokens in `src/ui/tokens.css`. No hard-coded colours where a
  token exists. No animation that runs by itself; one-shot feedback only, off under
  `prefers-reduced-motion`.
- **Stores.** Vue's own reactivity, no library. A store is a module that builds its state from
  `ref`, `shallowRef`, `reactive` and `computed` and returns it from a `create…()` function, with
  one shared instance behind a `use…()` function. `createGame()` takes its `fetch`, storage and
  clock as arguments, which is what lets the tests run it against a fake server.
- **Server state is replaced, never mutated.** `game.state` is a `shallowRef`; each accepted
  answer assigns a new object. Components read it and call `command()`.
- **Composables** are named `use…` and return refs. A composable that creates a timer, a listener,
  an observer or a Three.js object releases it in `onBeforeUnmount`.
- **Imports** carry their extension. Only `src/app/legacy/` imports a `.js` module.
- **Text.** The game is "Allworld" wherever a player reads it. Text a player typed is rendered as
  text (`{{ }}`), never with `v-html`. `v-html` is used in one place, `GameIcon`, for the icon
  set's own static SVG.

### Pinia or not

Not warranted. The game has one authoritative state object that arrives whole from the server and
is replaced whole; there is no client-side mutation to track, no cross-store dependency graph and
no need for devtools time travel over it. The four stores here are about 500 lines together. The
owner's other project also uses plain modules. Revisit only if stores start importing each other
in cycles.

### Router or not

Not now. The existing shell has no URLs for its screens (one `?venue=` deep link and the invite
path), and adding real routes changes behaviour: back button, shared links, the Worker's
single-page fallback. `shell.sheet` and `game.mode` are already the two values a router would
drive. Add `vue-router` as its own step after step 8, mapping `/phone/bank` and `/map` onto them.

## The steps

Sizes are non-test source lines today. Estimates are working days for one engineer with the
checks below, not calendar time.

| Step | What | Size | Estimate | Risk |
|---|---|---|---|---|
| 0 | Tooling, types, baseline | done | — | — |
| 1 | Vue shell, adapter, pilots | done | — | — |
| 2 | Engine and protocol to `.ts` | 37 files, 7,800 lines | 4–5 days | Medium |
| 3 | Server to `.ts` | 29 files, 5,200 lines, plus 6 scripts | 4–5 days | Medium |
| 4 | Client transport to `.ts` | 3 files, about 800 lines | 2 days | Medium |
| 5 | Shell switch: Vue shell becomes `index.html` | the chrome still on legacy CSS | 3–4 days | High |
| 6 | Panels to SFCs, group by group | 53 files, 4,100 lines | 10–12 days | Low each |
| 7 | Scenes and maps | 34 files, 11,100 lines | 6–8 days | High |
| 8 | Community (chat and voice), then delete the adapter | 1 file, 495 lines | 3–4 days | Highest |

About 32 to 40 working days in all. Steps 2 and 3 can run in parallel with step 5, and step 6
splits across people by panel group.

### Step 2: engine and protocol

**Files.** `src/game/util.js`, `clock.js`, `registry.js`, `api.js`, `home-layout.js`,
`character-effects.js`, `social-model.js`; `src/game/content/*.js`; `src/game/systems/*.js`;
`src/life.js`; then `server/protocol.js` and `server/life-service.js`.

**Why first.** Three runtimes import them: the browser, the Node server and the Worker. Their
types flow into everything else, and until they are real the server and the client are typed
against hand-written descriptions.

**How.** One file at a time, renamed with `git mv` so history follows, in dependency order:
`util`, `clock`, `registry`, content tables, core systems (`core`, `wallet`, `inventory`, `needs`,
`skills`, `activities`), feature systems, `life`. For `clock` and `wallet` the twin replaces the
`.js` and its parity test is deleted. Each system's slice type moves from `src/types/life.ts` into
the system file and is re-exported from there. Importers change `./x.js` to `./x.ts` in the same
commit.

**Verified by.** `npm test` (the engine tests are the safety net: conservation, economy,
first-day), `npm run typecheck` with the engine project's baseline at zero, `npm run test:edge`,
and the three scripted runs.

### Step 3: server

**Files.** `server/store.js`, `auth.js`, `routes/*`, `ws/*`, `social/*`, `civic/*`,
`moderation/*`, `support/*`, `server.js`, `test-fixture.js`; `scripts/*.mjs`.

**How.** `npm start` becomes `node server/server.ts`. Raise `engines.node` to `>=22.18.0` in the
same change (the other project's floor), so no flag is needed to start the server. Records and
contracts move out of `server/types.ts` into the modules that own them.

**Verified by.** `npm test` (the server suite), `npm run first-day`, `npm run two-players`,
`npm run economy`, `npm run load`, and the security properties in `SECURITY.md` re-read against
the diff.

### Step 4: client transport

**Files.** `src/client.js`, `src/lazy-load.js`, then `src/ui/panels/social-client.js`.

**How.** `client.js` becomes `src/app/state/client.ts` with the contract in
`src/app/types/client.ts` as its own types; `src/client.test.js` becomes its test unchanged in
behaviour. `social-client.js` becomes a reactive store (`src/app/state/social.ts`): `social.me`,
the threads and the outbox become refs, which removes the `legacyTick` counter the Vue Messages app
reads today. Fix the session-change reset at the same time (defect C3 below).

**Verified by.** `src/client.test.js` passing against the port, `src/app/state/game.test.ts`, a
two-browser message exchange.

### Step 5: the shell switch

The Vue shell becomes what `index.html` serves; `src/life-main.js` and `src/ui/shell.js` are kept
one release behind `legacy.html`, then deleted.

**Before the switch** the Vue shell must host everything the existing one does. Missing today:

- the community panel (presence, venue chat, voice), and with it other players' positions in the
  scene. Until step 8 it is hosted the way everything else is: the existing module, mounted by a
  thin `CommunityPane.vue` that loads it with the existing bounded retry.
- the shell chrome that still takes its layout from `src/ui/shell.css` (the HUD column, the venue
  panel, the nav, the phone device): its rules move into the components.

**Verified by.** Every scripted browser check in "How each step is verified", old and new shell
side by side at 390×844 and 1280×800, and the idle frame counter.

### Step 6: panels

One panel group at a time, each its own change, in this order:

1. `money`: Jobs, Groceries, Ride, Houses, Boutique, Cars, Invest (Bank is done)
2. `trust`: Statement (Report a problem is done)
3. `sim`: Profile, Needs, Skills, People, Person, Career, Settings
4. `social`: Contacts, Family, Invite, and the inbox chip
5. `civic`: Governor, State House, Neighbours, Billboards, Rich List, Radio
6. eager panels: Health, Goals, Hunt, City, Session, Map and its roadside prompt
7. `start`: character creation and the account landing (the largest; it embeds an avatar preview)
8. Buy mode (it drives the home scene: do it with step 7)

**How a panel converts.** See [From HTML strings to components](#from-html-strings-to-components).

**Verified by.** For each panel: its model test, its component test, a side-by-side screenshot
with `?legacy=<id>`, and the keyboard pass (Tab order, Esc, focus after an action).

### Step 7: scenes and maps

**Files.** `src/scene/**`, `src/venue-world.js`, `src/map3d/**`, `src/city-map.js`,
`src/world-map.js`.

**How.** The modules are converted to TypeScript as they are: factory functions that own a
renderer. They are not rewritten as components. `ScenePane.vue` and `MapPane.vue` already wrap
them; a `useVenueScene()` composable takes over what `src/app/state/app.ts` does by hand today
(state, player, crowd, insets). The scene handle types in `src/app/legacy/scene.ts` become the
modules' own.

**The rule that must survive.** No render loop while idle. A component never asks for a frame of
its own accord; it forwards state, and the host draws only when something changed. The existing
tests assert it (`src/venue-world.test.js`, "RELEASE GATE: idle → zero frames") and they move with
the code.

**Verified by.** The scene tests, `?diagnostics` frame count flat over ten idle seconds and across
two polls and a phone open and close, and a visual pass of every venue kind.

### Step 8: community, then clean-up

`src/community.js` last and by itself. See [Community](#community-chat-and-voice).

Then: delete `src/app/legacy/`, `src/ui/`, `tsconfig/baseline.json` and the baseline logic in
`scripts/typecheck.mjs`; turn off `allowJs`; rename `next.html` to `index.html`.

## From HTML strings to components

There is no flag day. The Vue shell lists panels from one registry
(`src/app/state/panels.ts`), and a panel in it is one of two kinds:

- an **existing panel** `{ id, title, placement, render(state, view, api) → html, bind, keys }`,
  shown by `LegacyPanel.vue`;
- a **Vue panel**, registered with `definePanel({ id, title, placement, group, badge, component })`.

Both carry the same static metadata, so the Phone grid, the Sim tabs and the HUD slots never ask
which kind they have. A Vue panel with the id of an existing panel takes its place in the same
position. `?legacy=bank,messages` (or `?legacy=all`) keeps the existing ones, for comparison.

`LegacyPanel.vue` keeps every promise the existing shell makes to a panel:

- `render()` runs when the state changes and the DOM is written only when the string differs;
- `bind(root, api, params)` runs after each write;
- a `live: false` panel is redrawn only when it asks;
- `api.refresh()` redraws synchronously, because panels look their new elements up on the next line;
- `data-action`, `data-open` and `data-close` work on any element;
- a lazy panel shows a skeleton while its group loads and a retry when it failed;
- a panel that throws shows one line and leaves the shell standing.

### Converting one panel

1. Move what needs no DOM into `features/<area>/<name>Model.ts` with a test: counts, wording,
   which reason disables a button.
2. Write `features/<area>/<Name>.vue`. Module-level UI state (`let draft`, `const basket`) becomes
   a reactive object in the model or a `…State.ts` file, so it still survives closing the sheet.
3. Replace hand-kept DOM state with bindings. `v-model` removes "save and restore the caret";
   keyed lists remove "restore the scroll position"; a native `<details>` simply stays open.
4. Give every server call a pending state: the control that was pressed says so and cannot be
   pressed twice. The answer changes the numbers, never the press.
5. Add it to `features/panels.ts` with `definePanel` and `defineAsyncComponent`.
6. Compare with `?legacy=<id>` at both sizes, then delete the old file and its CSS, and its line
   in `src/ui/panels/index.js`.

### What the pilots showed

- **Bank** (read-only data and two actions): a third less code once the string building is gone.
  "Paying…" on the pressed button is new.
- **Messages** (live data, optimistic sends): the outbox logic was already pure and was reused
  unchanged. The work was the boundary: the social client is not reactive, so the component reads
  a counter that the client's `refresh()` bumps, and must copy what it reads on each bump: the
  client changes its objects in place, and a computed that returns the same object again notifies
  nobody. A thread stayed on "Loading messages…" until that was done. It goes away at step 4.
- **Report a problem** (a form): the panel's `redraw()` that saved and restored focus and caret
  is not needed at all. Focus is moved on purpose instead: to the text field on an error, to the
  receipt on success.
- **The scoped-style catch.** Existing CSS has id selectors such as `#life-dialog p` that outrank
  a scoped class. Inside the dialog, avoid bare `p` and `h3` where size matters, or mark the rule
  as the base components do. This ends when the dialog's own rules move into `BaseSheet`.

## Lazy loading and chunks

The existing split is kept and extended:

- **Three.js** stays its own chunk, fetched after the HUD is on screen (`ScenePane` imports the
  scene host with a dynamic `import()` in `onMounted`).
- **Maps** are fetched the first time the Map opens or a trip starts (`MapPane`).
- **Panel groups** stay one chunk per group for existing panels. A Vue panel is
  `defineAsyncComponent(() => import('./BankApp.vue'))`: one chunk per panel, with shared base
  components hoisted by the bundler. When a whole group is converted, group its panels again with
  one dynamic import of a group module if the request count matters more than the bytes.
- **The Phone, the Sim sheet and Help** are async components: fetched on first open.
- **Entry size.** Measured on this branch (minified, gzip in brackets):

  | Entry | JavaScript on first load |
  |---|---|
  | Existing shell before this work | `app` 374.8 kB (131.0 kB), one file |
  | Existing shell now | `app` 45.4 kB + shared 329.5 kB = 374.9 kB (131.4 kB) |
  | Vue shell | `next` 138.3 kB + shared 329.5 kB = 467.8 kB (166.8 kB) |

  The existing entry is the same bytes in two files, because the two entries share one chunk. The
  Vue shell costs 93 kB more today: Vue's runtime is about 65 kB of it and the shell's own code the
  rest. It carries both systems at once; the shared chunk shrinks as `shell.js`, `dom.js` and the
  eager panels are deleted. Keep a budget: the Vue entry must not grow past 480 kB before step 5
  and must be under the existing 375 kB at step 8.

## Accessibility and focus

The existing shell manages focus by hand. In Vue most of it is the platform's, and the rest is
explicit and small.

- **Sheets** are one modal `<dialog>` (`BaseSheet.vue`). `showModal()` traps focus, makes the page
  inert, and `close()` returns focus to the control that opened the sheet. Checked: opening the
  Phone from the nav and closing it returns focus to the Phone button.
- **Esc** is handled at the key and run by `SheetHost`, which decides what it closes: the panel in
  front first (a chat goes back to its list), then the phone one level (app → home screen), then
  the sheet. A browser lets only one Esc in a row be refused by a dialog, so this cannot be left
  to the dialog's `cancel` event; that event still serves the back gesture.
- **A sheet that must be completed** (`locked`) refuses Esc and the backdrop, says why, and is put
  back if the browser closes it anyway.
- **Views inside the phone** are made unreachable with `inert`, not just hidden. Focus follows the
  view: the back button on entering an app, the app's icon on returning.
- **After an action**, focus goes somewhere on purpose: the invalid field, the confirmation, the
  row that was just left. Never to nothing.
- **Tabs** are real tab lists: arrow keys move, one tab stop.
- **Live regions.** Toasts are `role="status"`; a form error is `role="alert"`; a chat thread is
  `aria-live="polite"`.
- **A disabled control says why** as its tooltip and beside it in text.
- **Icons** are `aria-hidden`; a control that is only an icon has an `aria-label`.
- Check each converted screen at 390 px and by keyboard alone.

## Community: chat and voice

`src/community.js` is 495 lines in one closure with about twenty variables whose correctness is
their order. It handles the microphone. It is ported last, alone, and in two moves.

1. **Port it as it is.** Same structure, same DOM, types added, the existing test
   (`src/community.test.js`) passing unchanged. No restructuring in the same change.
2. **Then tighten the types** so the privacy rules cannot be broken by a later edit:
   - voice state is a union `off | joining { generation } | on { stream, muted, generation }`;
     a stream exists only in `on`, and `on` is only built from a stream whose tracks are already
     disabled;
   - `voice-state` messages are derived from that union, so "enabled" cannot be sent without a
     stream;
   - one function is the only way out of `joining` or `on`: it stops tracks, closes peers and the
     audio context, and bumps the generation;
   - every async continuation takes the generation it started in and checks it;
   - signalling is only callable with an `on` state and a member in range;
   - the room is `{ kind: 'home' } | { kind: 'venue' }` and voice accepts only `venue`.

The review of the existing module found no path that leaves a live or unmuted track. That is the
bar the port has to hold. Until this step the Vue shell hosts the existing module unchanged; today
it does not load it at all, so nothing in the Vue shell can reach the microphone.

## How each step is verified

Every step, before it is merged:

```sh
npm run typecheck      # clean; the baseline does not grow
npm test               # all pass
npm run build
npm run test:edge
npm run first-day && npm run two-players && npm run economy
```

In a browser, with a private server (`PORT=3330 DATA_DIR=<temp> node server/server.js`) and the
headless harness, old and new shell at 390×844 and 1280×800:

- create a life, see the scene, open the phone, open each converted screen;
- start an activity and cancel it; travel from the map and arrive;
- two players: a message arrives live, shows a badge, is answered, and the other player sees it;
- file a report with an empty text (refused, focus in the field), then for real (receipt, and the
  server has it);
- Esc through chat → list → home screen → closed; focus is on a control after each;
- `?diagnostics`: the frame count is the same before and after ten idle seconds, two polls, and a
  phone open and close.

Component tests (`src/app/components.test.ts`) compile each SFC with the project's Vite
configuration and render it with `vue/server-renderer` against the real store and a fake server
that runs the real rules. They assert markup: words, roles, labels, disabled controls and their
reasons. They add no dependency. They cannot click or measure; logic is tested in the model files
and focus in the browser run. If that proves too thin by step 6, add `@vue/test-utils` and
`happy-dom` then, with that reason.

## Defects the type checker found

Found while reading the 4,072 baselined errors that are not "no annotations yet", and while
deriving the types. None is fixed on this branch (no existing file is edited); they are for the
steps named.

### Real defects

| # | Where | What | Severity | Step |
|---|---|---|---|---|
| C1 | `src/community.js:42` | `roomLabel()` knows four venue ids, one of which does not exist; every other venue is headed "Park" in the panel where voice is joined | Medium | 8 |
| C2 | `src/ui/panels/messages.js:22`, `social-client.js:187` | `S.openConv` is cleared only by going back; closing the sheet inside a chat leaves it set, so the next message is marked read with no toast or badge. Fixed in the Vue Messages app | Medium | 6 |
| C3 | `src/ui/panels/social-client.js:20`, `src/life-main.js:51` | Social state was never reset on a session change. Since fixed in the JavaScript (`life-main.js` `sessionChanged` → `resetSocial`); the Vue shell (`src/app/state/app.ts`) does not make that call yet | Medium | 4 |
| C4 | `src/ui/panels/social-client.js:234` | After the reconnect attempts run out the socket stays off until the player presses Reconnect, though the game itself reconnected | Low–medium | 4 |
| C5 | `src/life-main.js:382` | `pagehide` destroys the community panel but keeps the reference; a page restored from the back/forward cache has an empty panel until reload | Low–medium | 5 |
| W1 | `deploy/cloudflare-worker.js:158` | Room membership is revalidated with `kind === 'travel'`, so a commuting life stays in its room. `server/protocol.js` forbids that comparison | Medium | deploy owner |
| W2 | `deploy/cloudflare-worker.js:318` | Venue chat on the Worker has no text filter and no mute | Medium | deploy owner |
| S1 | `server/server.js:394,420` | The `to` echo on signal errors compares a public id with the cookie secret, so it is always true | Low | 3 |
| E1 | `src/life.js:108`, `systems/onboarding.js` (`INBOUND`) | The onboarding veto also blocked server-only actions. Since fixed for the deliveries TO a life (a gift or friendship, a referral gift, a table result pass the hold); every other server-only action is still vetoed like a player's | Low | 2 |
| E2 | `content/events.js:120`, `systems/goals.js:236` | Two unrelated "startup funded" mechanisms; the event one emits has no listener | Medium | 2 |
| E3 | `systems/home.js:146` | Moving furniture without `rot` resets its rotation to 0 | Low | 2 |
| S2 | `server/civic/elections.js:25` | `week` is written and then overwritten by the spread in three returns (dead code) | Low | 3 |
| C6 | `src/community.js:438` | Chat ids use `crypto.randomUUID()`, absent on plain-HTTP LAN origins; `client.js` has a fallback for exactly this | Medium | 8 |
| C7 | `src/community.js:447` | Its nickname form posts no `onboarding: true`, so a life made there is never a guest of the quick start (it starts settled, with creation only offered) | Low | 8 |
| C8 | `src/ui/panels/radio.js:17` | `inClub` compares `kind !== 'travel'` instead of `isDeparting` | Low | 6 |

### Latent (wrong only for inputs nobody produces today)

| Where | What |
|---|---|
| `src/life.js:44` | `MIGRATIONS[version++](input)` assumes one migration per version; bumping `STATE_VERSION` alone makes every older save throw |
| `server/routes/civic.js:260` | Two clock reads around a term end can make `announce()` dereference a null governor |
| `server/ws/social.js:110` | The `dm-send` catch sends any thrown message as `code`, past the machine-code filter |
| `server/server.js:236` | Any `ENOENT` from a route becomes an unlogged `404 build_required` |
| `src/life-main.js:295` | A location change while the community panel is being created starts it in the old room |
| `src/community.js:273` | Presence frames carry no room key; a late frame from the previous room is accepted |
| `src/community.js:315` | After `peer_out_of_range` one side may never re-offer |
| `src/ui/panels/messages.js:220` | `openThread(ui.open)` after an `await` can request `/conversations/null` |
| `src/client.js:115` | A JSON `null` body throws a bare `TypeError` |
| `systems/travel.js:268` | `state.travel[outcome.once] = true` writes a key named by content; only `funded` survives a reload |

### Inconsistencies recorded in the types

Marked `// INCONSISTENT:` where they occur. The larger ones: weekly rent is written in three
tables (`housing.js`, `economy.js`, `traits.js`); two mood scales describe one score; two
different `CAR_MODE` and two different `HOME_SPOTS` exports; the Worker and the Node server
disagree on the health body, the voice-config error codes and what a session contains.

## What the deploy owner must change

Nothing now. `deploy/**` and `wrangler.jsonc` are untouched and `npm run test:edge` passes.

- **Step 2.** `deploy/cloudflare-worker.js` imports `../server/protocol.js`,
  `../server/life-service.js` and `../src/life.js`: change the three specifiers to `.ts` in the
  same commit that renames them. No bundler configuration is needed (checked with wrangler
  4.147.0). The edge test does the same for its imports.
- **Assets.** `dist/` now also holds `next.html`. With
  `not_found_handling: single-page-application` it is served at `/next.html`. To keep the preview
  off a public host, exclude it at release or leave it; it talks to the same API.
- **Step 5.** `index.html` starts the Vue shell. Nothing to change in the Worker.
- **Type-check the Worker.** The `worker` project already does, against
  `@cloudflare/workers-types`. Converting the Worker file itself to `.ts` is the deploy owner's
  call; set `main` to the `.ts` file when it happens.
- **Defects W1 and W2** above are in the Worker and are the deploy owner's to fix.
- **CI** now runs `npm run typecheck`. The release workflow should too.

## Rules for work that lands before the freeze

Four branches are changing the JavaScript now. Until the freeze:

1. **Keep editing the existing `.js` files as you do.** Do not convert a file you are working in.
2. **A new engine, server or shared module may be `.ts`** if it is imported with its real
   extension and uses erasable syntax only. A new file imported by the Worker may be `.ts` too.
3. **A new panel**: write it the existing way if it must show in `index.html` today. If it only
   needs the Vue shell, write it as a Vue panel with `definePanel`.
4. **Never add a `.ts` beside a `.js` of the same name.** The type checker would read it instead.
5. **After merging into a branch that has this tooling**, run `npm run typecheck`. Fix errors in
   `.ts` and `.vue`. For JavaScript errors that came with the merge, run
   `node scripts/typecheck.mjs --update` and commit the baseline with the merge.
6. **If `src/types/engine.test.ts` or `protocol.test.ts` fails after your change, that is the
   point**: you added an action, a state key, a view key, a route or a frame. Add it to the type
   it names. The merge of `parity/owner` into this branch tripped two (the session's `cities`, the
   beta looks) and each was a two-line fix.
7. **If you change what a panel in `features/panels.ts` shows** (Bank, Messages, Report a
   problem), say so: the Vue version has to follow. After the `parity/owner` merge it took one
   commit to bring the three up to date.
8. **Do not change the panel contract, `createClient`'s options, or the scene host's public
   methods** without saying so: the Vue shell is typed against them.

## The freeze point

Steps 2 to 8 rename and rewrite existing files, so they cannot run under four moving branches.

**The freeze is the moment `parity/owner`, `parity/world-scale`, the design branch and the
missions and mini-games branch are merged into one combined build that passes every check above.**
From that commit:

1. merge it into `parity/vue-ts`, follow the conformance tests, re-record the baseline;
2. no branch edits `src/game/**`, `server/protocol.js` or `server/life-service.js` until step 2
   lands (about a week);
3. after that, each step freezes only the files it names, and says so the day before.

`parity/vue-ts` already contains `parity/owner` at `c5e803e`.

## Decisions for the owner

| Decision | Recommendation |
|---|---|
| Pinia, or plain reactive modules | Plain modules. Reasons above |
| A router | Not until after step 8, as its own change |
| `node --test`, or Vitest | Keep `node --test`. 756 tests run with no dependency, and the SFC tests work through Vite's own loader. Vitest earns its place only if DOM interaction tests are wanted |
| DOM test dependencies | Not yet. Revisit at step 6 |
| Vite 7 or 8 | Stay on 7 until the freeze, then upgrade alone |
| `engines.node` | Raise to `>=22.18.0` at step 3 |
| `next.html` on the public host | Leave it out of public releases until step 5 |
| `@cloudflare/workers-types`, or generated `wrangler types` | The package now; switch to the generated file (the other project's way) if the deploy owner prefers |
| When to freeze | When the four branches are merged and green |
