// The first download of index.html: what it may contain, and how big it may be.
//
// 1. Source graph (always runs): follow every STATIC import from src/app/main.ts (through .ts and the
//    <script> of .vue files; `import type` and dynamic import() are not edges). Three.js, the 3D map, the
//    scene hosts, the campus world, the models and the telemetry SDKs must not be reachable that way.
// 2. Build (runs when `npm run build` has produced dist/): the entry chunk and every chunk it statically
//    imports (the modulepreload links) stay inside a size budget.
//
// The loading screen paints without a life, the game shell or a city's content. The selected city loads before the game shell,
// so the shell and the rules engine are reachable from startApp.ts, never from the entry's static graph.
// The rules engine (src/game, src/life.ts) IS part of the startup closure and is meant to be: the shell builds and reads every
// life through it. It has its own chunk (vite.config.ts, `engine`), so a change to the shell does not invalidate it.
// What the browser's engine does NOT carry (the page only reads lives the server has played):
//   - the UNILAG campus rules (student, games, shuttle, curriculum, walk, layout): a chunk of their own, fetched by src/game/campus-gate.ts
//     when a life uses the campus and by the Campus app. The browser registers stand-ins (src/game/systems/browser.ts), which vite.config.ts
//     puts in the place of src/game/systems/index.ts; the walk below makes the same swap.
//   - the player actions, settling and event listeners of every system (src/game/profile.ts: PLAYS is false in the build).
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** `from '…'` / bare `import '…'` of non-type imports and re-exports, in the code of a .ts or in the <script> of a .vue. */
function staticSpecifiers(file: string): string[] {
  let code = readFileSync(file, 'utf8')
  if (file.endsWith('.vue')) code = [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
  code = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  for (const match of code.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    if (match[2]) continue // import type / export type
    found.push(match[4] as string)
  }
  return found
}

function resolveFile(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  // The browser build registers its own systems in place of the full set (vite.config.ts, browserSystems).
  const target = resolve(dirname(from), specifier).replace(/src\/game\/systems\/index\.ts$/, 'src/game/systems/browser.ts')
  return existsSync(target) ? target : null
}

/** Every file reachable from `entry` by static imports, and every bare package it names. */
function graph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>(), packages = new Set<string>(), queue = [entry]
  while (queue.length) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const specifier of staticSpecifiers(file)) {
      const next = resolveFile(file, specifier)
      if (next) queue.push(next)
      else if (!specifier.startsWith('.')) packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0] as string)
    }
  }
  return { files, packages }
}

const reachable = graph(join(root, 'src/app/main.ts'))
const paths = [...reachable.files].map((file) => relative(root, file))
const gameGraph = graph(join(root, 'src/app/startApp.ts'))
const gamePaths = [...gameGraph.files].map((file) => relative(root, file))

test('the first download paints without the game shell, rules engine or city content; the startup closure reads them through the browser system set', () => {
  assert.ok(paths.includes('src/app/BootScreen.vue'))
  assert.ok(paths.includes('src/app/bootstrap.ts'))
  assert.ok(!paths.includes('src/app/App.vue'))
  assert.ok(!paths.includes('src/client.ts'))
  assert.ok(!paths.includes('src/life.ts'))
  assert.deepEqual(paths.filter(path => path.startsWith('src/game/')), [])
  assert.ok(gamePaths.includes('src/app/App.vue') && gamePaths.includes('src/life.ts') && gamePaths.includes('src/client.ts'), `${gamePaths.length} files reached`)
  assert.ok(gamePaths.includes('src/game/systems/browser.ts') && gamePaths.includes('src/campus/unilag/slices.ts') && gamePaths.includes('src/game/campus-gate.ts'), 'the browser registers the campus stand-ins and can fetch the campus rules')
  assert.ok(gamePaths.length > 150, 'the lazy shell still uses the real engine')
})

test('the shared shell does not statically import a city venue or regular catalogue', () => {
  assert.deepEqual(gamePaths.filter(path => /^src\/game\/cities\/[^/]+\/(content|venues|regulars|descriptions)\.ts$/.test(path)), [])
})

test('Three.js, maps, scene hosts, campus world, models and telemetry SDKs remain separate from both entry and shell', () => {
  for (const pkg of ['three', '@sentry/browser', 'posthog-js']) {
    assert.ok(!reachable.packages.has(pkg), `${pkg} must not be in the entry`)
    assert.ok(!gameGraph.packages.has(pkg), `${pkg} must be fetched by a dynamic import()`)
  }
  const forbidden: [string, RegExp][] = [
    ['the 3D map (only the projection maths of the shared frame, which a city module reads for its map origin, is allowed)', /^src\/map3d\/(?!geo\/frame\.ts$)/],
    ['the SVG city map', /^src\/city-map\.ts$/],
    ['the world map', /^src\/world-map\.ts$/],
    ['the venue scene host', /^src\/venue-world\.ts$/],
    ['the scene modules (only the pure walk grid, crowd metadata and type constants are allowed; movement.ts and build.ts are plain code the campus and the scenes share, in a chunk of their own)', /^src\/scene\/(?!walk-grid\.ts$|crowd\.ts$|types\.ts$)/],
    ['the UNILAG campus rules (fetched when a life uses the campus: src/game/campus-gate.ts)', /^src\/campus\/unilag\/(student|games|shuttle|curriculum|walk|layout|register)\.ts$/],
    ['the full system set (the browser registers campus stand-ins: systems/browser.ts)', /^src\/game\/systems\/index\.ts$/],
    ['the share card rules (the share sheet fetches them)', /^src\/game\/share-model\.ts$/],
    ['the look preview and the look tables of the landing (fetched with the landing, by warmLanding)', /^src\/app\/features\/start\/(lookPreview|lookModel)\.ts$/],
    ['a city other than the one being played (its content and map load on demand)', /^src\/game\/cities\/(?!lagos\/)[^/]+\/(content|map)\.ts$/],
    ['the campus scene and hosts', /^src\/campus\/unilag\/(host|scene|world-adapter|preview|landmark|model|characters)[\w-]*\.ts$/],
    ['the campus shared scene code', /^src\/campus\/shared\//],
    ['the models', /^src\/models\//],
    ['the community and voice client', /^src\/community\.ts$/],
    ['the telemetry SDK modules', /^src\/telemetry\/(core|sentry|sentry-replay|posthog|consent-ui)\.ts$/],
    ['the walkthrough and the shortcuts sheet (only the small trigger, the state and the stored "seen" flags are in the first download)', /^src\/app\/features\/tour\/(?!(TourTrigger\.vue|tourState\.ts|tourSeen\.ts)$)/],
    ['the sign-in screens, their store and the provider client (only the panel registration, the small account state, the ways of opening the sheet and the guest bar\'s rules are allowed)', /^src\/app\/features\/account\/(?!(register|accountOpen|accountTrack|shownOnce|accountLite|useAccountLite|guestBarModel)\.ts$)/],
    ['a panel body', /^src\/app\/features\/(?!landing\/|hud\/|nav\/|venue\/|phone\/(PanelHost|SheetHost)\.vue$).*\/[A-Z]\w+(App|Panel|Sheet|Tab|Chip|Modal|Card)\.vue$/],
  ]
  for (const [what, pattern] of forbidden) {
    const hit = [...new Set([...paths, ...gamePaths])].filter((path) => pattern.test(path) && !/\.test\./.test(path))
    // CommunityPanel is fetched by CommunityHost with defineAsyncComponent; the host itself is small and is allowed.
    assert.deepEqual(hit, [], `${what} must not be in the first download`)
  }
})

// ---- the built bundle ------------------------------------------------------------------------------------------------------------
// The automatic startup (entry, Vue, the shell and the engine with the default city) measured on the combined build: 584.8 kB raw / 216.1 kB gzip (586.3 / 216.4 with Ibadan registered: the Ibadan rules and registry entry are the only part of it that is eager).
// (After the city modules alone it was 583.1 / 215.3; before them, on the first-load split, 557.8 / 203.3. About 17 kB of the difference is the eager
// city registry and the Lagos rules and content the engine reads synchronously; the reserved cities' atlas text is about 3 kB of it.) The budget is the measurement plus about 4%.
// The loading screen alone (entry, Vue, the module preload helper) measured 88.1 kB / 35.5 kB; its budget is that plus about 4%.
// With Ogun's four city modules registered (their compact rules, links and the shared reference and job-transfer code) it measures 623.4 kB / 228.7 kB; the budget was that plus about 1.5%.
// With one character on several devices, live friend places and the invite prompts it measured 634.5 kB / 233.1 kB. Three things were then taken out of it:
// the other cities' water, landmarks and map character (a chunk rule had put them in the engine), the walk grid (only the campus rules and the scenes
// read it) and the travel rules the Map and the Ride app use (the page's travel state needs only the starting layers). It measures 597.2 kB / 218.6 kB;
// the budget is that plus 2%. `node --experimental-strip-types scripts/startup-size.ts` prints what is in it, by chunk and by module.
// With Port Harcourt, Abuja and Kano registered it measured 613.1 kB / 222.8 kB: their rules, links and registry entries (about 10 kB) are read at
// startup like every open city's, with the local travel zones, the boat route rule, the seasonal climate and the wording of local units and the
// elected office. Their content, maps, roads, water and scenes are not in it. The budget was not raised for them: what only a lazily fetched screen
// reads was moved out of the modules the startup shares with it (the civic request helpers, the thread, mission, invite, event, bank and social
// lines, the settings list), and it measures 605.6 kB / 219.7 kB. The budget is the one from before the three cities.
const BUDGET = { raw: 609_000, gzip: 223_000 }
// A player who starts in another city also loads that city's own content chunk (venues, regulars, calendar, wording) and nothing else:
// the set of eager chunks for it is the default-city set plus that one chunk, by name, and the default-city budget is unchanged.
const LOADING_BUDGET = { raw: 92_000, gzip: 37_000 }

function eagerChunks(dist: string, additional: readonly string[] = []): string[] {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const queue = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1] as string)
  queue.push(...additional)
  const seen = new Set<string>()
  while (queue.length) {
    const name = queue.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    // Static imports only: `from"./x.js"` and `import"./x.js"`; a dynamic import("./x.js") and the preload map are not.
    const code = readFileSync(join(dist, name), 'utf8')
    for (const match of code.matchAll(/(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g)) queue.push(`assets/${match[1]}`)
  }
  return [...seen]
}

test('the eager JavaScript does not grow and contains only the loading screen and Vue', (t) => {
  const dist = join(root, 'dist')
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'assets'))) { t.diagnostic('no dist/: run `npm run build` to check the bundle'); return }
  const names = eagerChunks(dist)
  const sizes = names.map((name) => { const bytes = readFileSync(join(dist, name)); return { name, raw: bytes.length, gzip: gzipSync(bytes).length } })
  const total = sizes.reduce((sum, item) => ({ raw: sum.raw + item.raw, gzip: sum.gzip + item.gzip }), { raw: 0, gzip: 0 })
  t.diagnostic(sizes.map((item) => `${item.name} ${item.raw} raw ${item.gzip} gzip`).join('; ') + `; total ${total.raw} raw ${total.gzip} gzip`)
  const kinds = names.map((name) => name.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, '')).sort()
  assert.deepEqual(kinds.filter((kind) => kind !== 'preload-helper'), ['app', 'vue'], 'the first download contains no game engine or city content')
  assert.ok(total.raw <= LOADING_BUDGET.raw, `eager JavaScript is ${total.raw} bytes (budget ${LOADING_BUDGET.raw})`)
  assert.ok(total.gzip <= LOADING_BUDGET.gzip, `eager JavaScript is ${total.gzip} bytes gzipped (budget ${LOADING_BUDGET.gzip})`)
  // Three.js, the telemetry SDKs and the scene are chunks of their own, never in the first download.
  const all = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.js'))
  for (const name of all.filter((item) => /^(three|sentry|sentry-replay|posthog|world-adapter)-/.test(item))) assert.ok(!names.includes(`assets/${name}`), `${name} is not eager`)
})

test('automatic game startup, including one selected city, stays within the original first-load budget', (t) => {
  const dist = join(root, 'dist')
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'assets'))) { t.diagnostic('no dist/: run `npm run build` to check the complete startup payload'); return }
  const all = readdirSync(join(dist, 'assets')).filter(name => name.endsWith('.js'))
  const core = all.filter(name => /^startApp-[\w-]+\.js$/.test(name))
  assert.equal(core.length, 1, 'the automatic startup has one deferred game shell')
  const cityChunks = all.filter(name => /^city-.+-content-[\w-]+\.js$/.test(name))
  const defaultNames = eagerChunks(dist, core.map(name => `assets/${name}`))
  const measure = (names: readonly string[]) => names.reduce((sum, name) => {
    const bytes = readFileSync(join(dist, name))
    return { raw: sum.raw + bytes.length, gzip: sum.gzip + gzipSync(bytes).length }
  }, { raw: 0, gzip: 0 })
  const base = measure(defaultNames)
  t.diagnostic(`default city automatic startup: ${base.raw} raw ${base.gzip} gzip bytes`)
  assert.ok(base.raw <= BUDGET.raw, `automatic startup for the default city is ${base.raw} bytes (budget ${BUDGET.raw})`)
  assert.ok(base.gzip <= BUDGET.gzip, `automatic startup for the default city is ${base.gzip} gzip bytes (budget ${BUDGET.gzip})`)
  assert.deepEqual(defaultNames.filter(name => /^assets\/city-/.test(name)), [], 'no city chunk (content, map, roads, water, landmarks) is part of the default startup')
  // Every other city adds its own content chunk and no other chunk.
  assert.ok(cityChunks.length >= 1, 'a non-default city has a content chunk')
  for (const city of cityChunks) {
    const names = eagerChunks(dist, [...core, city].map(name => `assets/${name}`))
    const added = names.filter(name => !defaultNames.includes(name))
    // Ogun's four cities are authored with one shared builder: it is a content chunk of its own, named by file, and is loaded only with an Ogun city.
    const sharedBuilder = ['abeokuta', 'ota', 'ijebu-ode', 'sagamu'].some(id => city.startsWith(`city-${id}-content-`))
    assert.deepEqual(added.filter(name => !(sharedBuilder && /^assets\/city-ogun-content-[\w-]+\.js$/.test(name))), [`assets/${city}`], `a city adds only its own content chunk (${city})`)
    if (sharedBuilder) assert.equal(added.filter(name => /^assets\/city-ogun-content-/.test(name)).length, 1, 'and the one shared Ogun builder')
    const total = measure(names)
    t.diagnostic(`${city} automatic startup: ${total.raw} raw ${total.gzip} gzip bytes`)
  }
})
