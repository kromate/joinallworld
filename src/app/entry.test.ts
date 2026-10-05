// The first download of index.html: what it may contain, and how big it may be.
//
// 1. Source graph (always runs): follow every STATIC import from src/app/main.ts (through .ts and the
//    <script> of .vue files; `import type` and dynamic import() are not edges). Three.js, the 3D map, the
//    scene hosts, the campus world, the models and the telemetry SDKs must not be reachable that way.
// 2. Build (runs when `npm run build` has produced dist/): the entry chunk and every chunk it statically
//    imports (the modulepreload links) stay inside a size budget.
//
// The loading screen paints without a life. The selected city loads before the full game shell;
// the rules engine is reachable from that shell, but never from the entry's static graph.
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
  const target = resolve(dirname(from), specifier)
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

test('the first download paints without the game shell, rules engine or city content', () => {
  assert.ok(paths.includes('src/app/BootScreen.vue'))
  assert.ok(paths.includes('src/app/bootstrap.ts'))
  assert.ok(!paths.includes('src/app/App.vue'))
  assert.ok(!paths.includes('src/client.ts'))
  assert.ok(!paths.includes('src/life.ts'))
  assert.deepEqual(paths.filter(path => path.startsWith('src/game/')), [])
  assert.ok(gamePaths.includes('src/app/App.vue') && gamePaths.includes('src/life.ts') && gamePaths.includes('src/client.ts'))
  assert.ok(gamePaths.length > 150, 'the lazy shell still uses the real engine')
})

test('the shared shell does not statically import a city venue or regular catalogue', () => {
  assert.deepEqual(gamePaths.filter(path => /^src\/game\/cities\/[^/]+\/(content|venues|regulars)\.ts$/.test(path)), [])
})

test('Three.js, maps, scene hosts, campus world, models and telemetry SDKs remain separate from both entry and shell', () => {
  for (const pkg of ['three', '@sentry/browser', 'posthog-js']) {
    assert.ok(!reachable.packages.has(pkg), `${pkg} must not be in the entry`)
    assert.ok(!gameGraph.packages.has(pkg), `${pkg} must be fetched by a dynamic import()`)
  }
  const forbidden: [string, RegExp][] = [
    ['the 3D map', /^src\/map3d\//],
    ['the SVG city map', /^src\/city-map\.ts$/],
    ['the world map', /^src\/world-map\.ts$/],
    ['the venue scene host', /^src\/venue-world\.ts$/],
    ['the scene modules (only the pure walk grid, crowd metadata and type constants are allowed)', /^src\/scene\/(?!walk-grid\.ts$|crowd\.ts$|types\.ts$)/],
    ['the campus scene and hosts', /^src\/campus\/unilag\/(host|scene|world-adapter|preview|landmark|model|characters)[\w-]*\.ts$/],
    ['the campus shared scene code', /^src\/campus\/shared\//],
    ['the models', /^src\/models\//],
    ['the community and voice client', /^src\/community\.ts$/],
    ['the telemetry SDK modules', /^src\/telemetry\/(core|sentry|sentry-replay|posthog|consent-ui)\.ts$/],
    ['a panel body', /^src\/app\/features\/(?!landing\/|hud\/|nav\/|venue\/|phone\/(PanelHost|SheetHost)\.vue$).*\/[A-Z]\w+(App|Panel|Sheet|Tab|Chip|Modal|Card)\.vue$/],
  ]
  for (const [what, pattern] of forbidden) {
    const hit = [...new Set([...paths, ...gamePaths])].filter((path) => pattern.test(path) && !/\.test\./.test(path))
    // CommunityPanel is fetched by CommunityHost with defineAsyncComponent; the host itself is small and is allowed.
    assert.deepEqual(hit, [], `${what} must not be in the first download`)
  }
})

// ---- the built bundle ------------------------------------------------------------------------------------------------------------
// The pre-module first-download baseline, measured including every static dependency.
const BUDGET = { raw: 673_651, gzip: 238_877 }

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
  assert.deepEqual(kinds, ['app', 'vue'], 'the first download contains no game engine or city content')
  assert.ok(total.raw <= BUDGET.raw, `eager JavaScript is ${total.raw} bytes (budget ${BUDGET.raw})`)
  assert.ok(total.gzip <= BUDGET.gzip, `eager JavaScript is ${total.gzip} bytes gzipped (budget ${BUDGET.gzip})`)
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
  // Every city loads its own content; the shell closure alone is checked as well.
  for (const city of [null, ...cityChunks]) {
    const names = eagerChunks(dist, [...core, ...(city ? [city] : [])].map(name => `assets/${name}`))
    const total = names.reduce((sum, name) => {
      const bytes = readFileSync(join(dist, name))
      return { raw: sum.raw + bytes.length, gzip: sum.gzip + gzipSync(bytes).length }
    }, { raw: 0, gzip: 0 })
    t.diagnostic(`${city ?? 'default city'} automatic startup: ${total.raw} raw ${total.gzip} gzip bytes`)
    assert.ok(total.raw <= BUDGET.raw, `automatic startup for ${city ?? 'default city'} is ${total.raw} bytes (baseline ${BUDGET.raw})`)
    assert.ok(total.gzip <= BUDGET.gzip, `automatic startup for ${city ?? 'default city'} is ${total.gzip} gzip bytes (baseline ${BUDGET.gzip})`)
  }
})
