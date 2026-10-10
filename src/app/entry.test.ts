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
//   - the player actions, settling and event listeners of every system, and what completes, cancels or settles a timed action
//     (src/game/profile.ts: PLAYS is false in the build).
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { STARTUP_RAW, STARTUP_GZIP, LOADING_RAW, LOADING_GZIP } from '../budgets.ts'

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
  assert.deepEqual(gamePaths.filter(path => /^src\/game\/cities\/[^/]+\/(?:index|rules|content|venues|regulars|descriptions)\.ts$/.test(path)), [])
})

test('each generated catalogue row has one checked-in Node and Worker loader', () => {
  const catalogue = readFileSync(join(root, 'src/game/cities/catalogue.generated.ts'), 'utf8').split('\n').filter((line) => /^  \["/.test(line))
  const loaders = readFileSync(join(root, 'src/game/cities/loaders.generated.ts'), 'utf8').split('\n').filter((line) => /^  async\(\)/.test(line))
  assert.equal(loaders.length, catalogue.length, 'one lazy loader per compact catalogue row')
  for (let index = 0; index < catalogue.length; index += 1) {
    const id = catalogue[index]?.match(/^  \["([^"]+)"/)?.[1] ?? `row ${index}`
    assert.match(loaders[index] ?? '', new RegExp(`import\\("\\./${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/index\\.ts"\\)`))
  }
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
    ['the companion (its loader, 3D model and stage, brain, director, chat and tours are all fetched after the first frame; nothing of it is in the first download)', /^src\/app\/features\/companion\//],
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
// With the travel changes (the level bar, one main home, guest houses), the capacity messages and players' businesses merged it measured 622.5 kB /
// 225.9 kB. The budget was not raised: the capacity sentences left the landing model that carries the character presets, the completion of every
// timed action became play-only (the campus rules with it, so the wallet's writers left the engine), and what only a lazily fetched screen reads
// was moved to files of its own (the people and map-list sentences, the advert choices, Ping's wording, the campus trail). It measures 604.8 kB / 219.5 kB.
const BUDGET = { raw: STARTUP_RAW.value, gzip: STARTUP_GZIP.value }
// A player loads the shared shell, authored route table, and exactly one city's rules and content. Unopened cities contribute
// only their compact catalogue row and loader thunk to that startup closure.
const LOADING_BUDGET = { raw: LOADING_RAW.value, gzip: LOADING_GZIP.value }

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

/** One emitted JSON-compatible array literal, including nested arrays and quoted brackets. */
function arrayLiteralAt(code: string, start: number): string {
  let depth = 0, quote = '', escaped = false
  for (let index = start; index < code.length; index += 1) {
    const char = code[index] ?? ''
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '[') depth += 1
    else if (char === ']' && --depth === 0) return code.slice(start, index + 1)
  }
  throw new Error(`Unclosed emitted array at byte ${start}`)
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

test('automatic startup keeps Nigeria eager and admits foreign bootstrap only for the selected city', (t) => {
  const dist = join(root, 'dist')
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'assets'))) { t.diagnostic('no dist/: run `npm run build` to check the complete startup payload'); return }
  const all = readdirSync(join(dist, 'assets')).filter(name => name.endsWith('.js'))
  const one = (pattern: RegExp, label: string): string => {
    const found = all.filter(name => pattern.test(name))
    assert.equal(found.length, 1, label)
    return found[0] ?? ''
  }
  const shell = one(/^startApp-[\w-]+\.js$/, 'the automatic startup has one deferred game shell')
  const routes = one(/^city-routes-[\w-]+\.js$/, 'the automatic startup has one lazy authored-route table')
  const homewardRules = one(/^homeward-rules-[\w-]+\.js$/, 'recovery reader and planner have one conditional chunk')
  const panelBodies = one(/^panelBodies-[\w-]+\.js$/, 'unopened app body loaders have one conditional chunk')
  const facts = readFileSync(join(root, 'src/game/cities/trusted-city-facts.generated.ts'), 'utf8')
  const nigeria = readFileSync(join(root, 'src/game/cities/nigeria-catalogue.generated.ts'), 'utf8')
  const rows = [...nigeria.matchAll(/^  \[([^\n]+)\],$/gm)].map(match => JSON.parse(`[${match[1]}]`) as [string, string, string, string, number, number, 0 | 1])
  assert.equal(rows.length, 40, 'the eager Nigeria catalogue has exactly 40 cities')
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rulesFor = (id: string) => one(new RegExp(`^city-${escaped(id)}-rules-[\\w-]+\\.js$`), `${id} has one lazy rules chunk`)
  const contentFor = (id: string) => one(new RegExp(`^city-${escaped(id)}-content-[\\w-]+\\.js$`), `${id} has one lazy content chunk`)
  const common = eagerChunks(dist, [`assets/${shell}`, `assets/${routes}`])
  const commonCode = common.map(name => readFileSync(join(dist, name), 'utf8')).join('\n')
  assert.match(nigeria, /NIGERIA_CITY_LOADERS/)
  assert.match(facts, /TRUSTED_CITY_FACTS_ROWS/)
  for (const row of rows) {
    const id = row[0]
    const rules = rulesFor(id), content = contentFor(id)
    assert.ok(commonCode.includes(JSON.stringify(id)), `${id} remains in the eager Nigeria catalogue`)
    assert.ok(commonCode.includes(`./${rules}`), `${id} has an eager loader reference to its lazy rules chunk`)
    const names = eagerChunks(dist, [`assets/${shell}`, `assets/${routes}`, `assets/${rules}`, `assets/${content}`])
    assert.ok(names.includes(`assets/${routes}`) && names.includes(`assets/${rules}`) && names.includes(`assets/${content}`), `${id} startup includes its rules, content and authored routes`)
    assert.ok(!names.includes(`assets/${homewardRules}`), `${id} does not preload conditional recovery rules`)
    assert.ok(!names.includes(`assets/${panelBodies}`), `${id} does not preload unopened app bodies`)
    assert.deepEqual(names.filter(name => /\/city-.+-(?:rules|content)-[\w-]+\.js$/.test(name) && !name.includes(`city-${id}-`) && !/\/city-(?:formula|ogun)-rules-/.test(name) && !/\/city-(?:ogun-)?content-builder-/.test(name) && !/\/city-ogun-content-/.test(name) && !/\/city-formula-content-/.test(name)), [], `${id} does not load another city's rules or content`)
    assert.deepEqual(names.filter(name => /\/city-.+-map-[\w-]+\.js$/.test(name)), [], `${id} does not load a map at startup`)
    const total = names.reduce((sum, name) => { const bytes = readFileSync(join(dist, name)); return { raw: sum.raw + bytes.length, gzip: sum.gzip + gzipSync(bytes).length } }, { raw: 0, gzip: 0 })
    t.diagnostic(`${id} automatic startup: ${total.raw} raw ${total.gzip} gzip bytes`)
    assert.ok(total.raw <= BUDGET.raw, `automatic startup for ${id} is ${total.raw} bytes (budget ${BUDGET.raw})`)
    assert.ok(total.gzip <= BUDGET.gzip, `automatic startup for ${id} is ${total.gzip} bytes (budget ${BUDGET.gzip})`)
  }
  const foreignIds = ['accra', 'algiers', 'lome', 'nairobi', 'yaounde', 'abidjan', 'addis-ababa', 'cape-town', 'cotonou', 'dakar']
  for (const id of foreignIds) {
    rulesFor(id); contentFor(id)
    const loaderRow = new RegExp(`(?:^|[,\\{])\\s*["']?${escaped(id)}["']?\\s*:\\s*(?:async)?\\(\\)\\s*=>`)
    assert.ok(!loaderRow.test(commonCode), `${id} has no eager rule loader`)
    const rowChunks = all.filter(name => loaderRow.test(readFileSync(join(dist, 'assets', name), 'utf8')))
    assert.equal(rowChunks.length, 1, `${id} has one emitted lazy loader row`)
    assert.ok(!common.includes(`assets/${rowChunks[0]}`), `${id}'s loader map is outside the common startup closure`)
  }
  assert.ok(!commonCode.includes('foreign-loaders.generated'), 'the foreign loader map stays outside the eager closure')
  assert.ok(!common.some(name => /country-directory|foreign-loaders/.test(name)), 'foreign directory metadata stays outside the common startup')
  const admission = readFileSync(join(root, 'src/game/cities/foreign-admission.generated.ts'), 'utf8')
  const dakarCountry = admission.match(/id: "dakar", countryISO: "([a-z]{2})"/)?.[1]
  assert.equal(dakarCountry, 'sn', 'selected Dakar uses Senegal bootstrap')
})
