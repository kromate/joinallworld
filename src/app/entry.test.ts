// The first download of index.html: what it may contain, and how big it may be.
//
// 1. Source graph (always runs): follow every STATIC import from src/app/main.ts (through .ts and the
//    <script> of .vue files; `import type` and dynamic import() are not edges). Three.js, the 3D map, the
//    scene hosts, the campus world, the models and the telemetry SDKs must not be reachable that way.
// 2. Build (runs when `npm run build` has produced dist/): the entry chunk and every chunk it statically
//    imports (the modulepreload links) stay inside a size budget.
//
// The rules engine (src/game, src/life.ts) IS reachable and is meant to be: the shell builds and reads every
// life through it. It has its own chunk (vite.config.ts, `engine`), so a change to the shell does not
// invalidate it. Making it lazy needs the shell to paint without a life; see docs/MIGRATION-VUE-TS.md.
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

test('the first download reaches the shell and the rules engine, and sees them through the same files as before', () => {
  assert.ok(paths.includes('src/app/App.vue') && paths.includes('src/life.ts') && paths.includes('src/client.ts'), `${paths.length} files reached`)
  assert.ok(paths.includes('src/game/systems/browser.ts') && paths.includes('src/campus/unilag/slices.ts') && paths.includes('src/game/campus-gate.ts'), 'the browser registers the campus stand-ins and can fetch the campus rules')
  assert.ok(paths.length > 150, 'the walk really followed the imports')
})

test('Three.js, the maps, the scene hosts, the campus world, the models and the telemetry SDKs are not statically reachable from the entry', () => {
  for (const pkg of ['three', '@sentry/browser', 'posthog-js']) assert.ok(!reachable.packages.has(pkg), `${pkg} must be fetched by a dynamic import()`)
  const forbidden: [string, RegExp][] = [
    ['the 3D map', /^src\/map3d\//],
    ['the SVG city map', /^src\/city-map\.ts$/],
    ['the world map', /^src\/world-map\.ts$/],
    ['the venue scene host', /^src\/venue-world\.ts$/],
    ['the scene modules (only the small crowd.ts and the types are allowed; movement.ts and build.ts are plain code the campus and the scenes share, in a chunk of their own)', /^src\/scene\/(?!crowd\.ts$|types\.ts$)/],
    ['the UNILAG campus rules (fetched when a life uses the campus: src/game/campus-gate.ts)', /^src\/campus\/unilag\/(student|games|shuttle|curriculum|walk|layout|register)\.ts$/],
    ['the full system set (the browser registers campus stand-ins: systems/browser.ts)', /^src\/game\/systems\/index\.ts$/],
    ['the share card rules (the share sheet fetches them)', /^src\/game\/share-model\.ts$/],
    ['the look preview and the look tables of the landing (fetched with the landing, by warmLanding)', /^src\/app\/features\/start\/(lookPreview|lookModel)\.ts$/],
    ['the campus scene and hosts', /^src\/campus\/unilag\/(host|scene|world-adapter|preview|landmark|model|characters)[\w-]*\.ts$/],
    ['the campus shared scene code', /^src\/campus\/shared\//],
    ['the models', /^src\/models\//],
    ['the community and voice client', /^src\/community\.ts$/],
    ['the telemetry SDK modules', /^src\/telemetry\/(core|sentry|sentry-replay|posthog|consent-ui)\.ts$/],
    ['the walkthrough and the shortcuts sheet (only the small trigger, the state and the stored "seen" flags are in the first download)', /^src\/app\/features\/tour\/(?!(TourTrigger\.vue|tourState\.ts|tourSeen\.ts)$)/],
    ['a panel body', /^src\/app\/features\/(?!landing\/|hud\/|nav\/|venue\/|phone\/(PanelHost|SheetHost)\.vue$).*\/[A-Z]\w+(App|Panel|Sheet|Tab|Chip|Modal|Card)\.vue$/],
  ]
  for (const [what, pattern] of forbidden) {
    const hit = paths.filter((path) => pattern.test(path) && !/\.test\./.test(path))
    // CommunityPanel is fetched by CommunityHost with defineAsyncComponent; the host itself is small and is allowed.
    assert.deepEqual(hit, [], `${what} must not be in the first download`)
  }
})

// ---- the built bundle ------------------------------------------------------------------------------------------------------------
// Measured on the build of this change (raw bytes / gzip): app 203.1 kB / 74.8, vue 85.6 / 33.8, engine 263.9 / 93.0; total 552.7 / 201.6.
// (The shell grew with the online count, the Invite button, the tour's trigger and the call controller's loader; the QR encoder, the share sheet,
// the call controller and the tour itself load on demand.) Budget: that + ~5%.
const BUDGET = { raw: 580_000, gzip: 212_000 }

function eagerChunks(dist: string): string[] {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const queue = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1] as string)
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

test('the eager JavaScript of index.html stays inside its budget, and is only the shell, Vue and the engine', (t) => {
  const dist = join(root, 'dist')
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'assets'))) { t.diagnostic('no dist/: run `npm run build` to check the bundle'); return }
  const names = eagerChunks(dist)
  const sizes = names.map((name) => { const bytes = readFileSync(join(dist, name)); return { name, raw: bytes.length, gzip: gzipSync(bytes).length } })
  const total = sizes.reduce((sum, item) => ({ raw: sum.raw + item.raw, gzip: sum.gzip + item.gzip }), { raw: 0, gzip: 0 })
  t.diagnostic(sizes.map((item) => `${item.name} ${item.raw} raw ${item.gzip} gzip`).join('; ') + `; total ${total.raw} raw ${total.gzip} gzip`)
  const kinds = names.map((name) => name.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, '')).sort()
  assert.deepEqual(kinds, ['app', 'engine', 'vue'], 'the first download is the entry, the framework and the engine, and nothing else')
  assert.ok(total.raw <= BUDGET.raw, `eager JavaScript is ${total.raw} bytes (budget ${BUDGET.raw})`)
  assert.ok(total.gzip <= BUDGET.gzip, `eager JavaScript is ${total.gzip} bytes gzipped (budget ${BUDGET.gzip})`)
  // Three.js, the telemetry SDKs and the scene are chunks of their own, never in the first download.
  const all = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.js'))
  for (const name of all.filter((item) => /^(three|sentry|sentry-replay|posthog|world-adapter)-/.test(item))) assert.ok(!names.includes(`assets/${name}`), `${name} is not eager`)
})
