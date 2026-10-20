// What a player downloads, from an existing dist/: the size of the first paint, of the automatic startup and of every lazy
// chunk group, checked against the named budgets in src/budgets.ts. Exits 1 when a budget that can be measured is exceeded.
//
//   node --experimental-strip-types scripts/download-budget.ts               report + check ./dist
//   node --experimental-strip-types scripts/download-budget.ts --dist path   another build output
//   node --experimental-strip-types scripts/download-budget.ts --top 100     list more lazy groups (default 30; --all lists every one)
//   node --experimental-strip-types scripts/download-budget.ts --json        the same as JSON, every group
//
// It reads dist/ and never builds: run `npm run build` first. Sizes are of the files as emitted; brotli is quality 11, the best
// a CDN can do, so the figure is a ceiling on what is sent.
//
//   first paint  index.html, the stylesheet and script tags it names, and every chunk those import statically (the preload set)
//   startup      first paint plus the game shell and ONE city's rules and content, with everything they import statically (what
//                src/app/entry.test.ts measures); the figure is the largest over every city, because any of them can be the one played.
//                The world city network (`city-network`: every city's catalogue facts, land components and routes) is not in it: a
//                resident's startup does without it and the page fetches it when idle after the game is ready (src/game/cities/registry.ts);
//                it is reported with the lazy groups, and a static import of it from startup would put it back in the closure.
//   lazy groups  every other chunk, by name without its hash; `city-<id>-<kind>` is one group per kind across cities
//
// Budgets with no artifact yet (base body, clip pack, wardrobe items, street tiles) are listed as "not measured": the file name
// patterns in ASSET_PATTERNS are the convention to change when the asset layout is decided.
import { createHash } from 'node:crypto'
import { inventory } from './native-character-assets.mjs'
import { brotliCompress, brotliCompressSync, constants, gzip, gzipSync } from 'node:zlib'
import { promisify } from 'node:util'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUDGETS, describeBudget, withinBudget } from '../src/budgets.ts'
import type { BudgetName } from '../src/budgets.ts'
import { CITY_CONTENT_ASSETS } from '../src/game/cities/content-assets.generated.ts'
import type { CityContentAssetManifestRow } from '../src/game/cities/content-asset.ts'

/** Files of a build by path under dist/ ('index.html', 'assets/app-AbCd1234.js'). */
export type Dist = ReadonlyMap<string, Uint8Array>

export interface Size { raw: number; gzip: number; brotli: number }

/** Brotli at quality 11 is slow on big chunks and every city's startup shares most of them: a file is measured once. */
const measured = new WeakMap<Uint8Array, Size>()

/**
 * The bytes a compressor measures: the file with every chunk hash in it replaced by zeros of the same length. A chunk names the
 * chunks it imports by their hashed file names, so a change to any lazy chunk changes those names in the untouched startup files, and
 * seven random hex characters compress a little better or worse each time: the startup brotli figure moved by up to about 150 bytes
 * between builds with identical raw sizes. Zeroing the hashes keeps the raw size exact and makes the compressed figures a property
 * of the code alone.
 */
export function stableBytes(data: Uint8Array): Uint8Array {
  const text = Buffer.from(data).toString('latin1')
  const stable = text.replace(/-[0-9a-f]{7}(?=\.(?:m?js|css|json|woff2?|png|webp|svg|glb|wasm)\b)/g, '-0000000')
  return stable === text ? data : Buffer.from(stable, 'latin1')
}

export function sizeOf(data: Uint8Array): Size {
  const known = measured.get(data)
  if (known) return known
  const stable = stableBytes(data)
  const size = {
    raw: data.length,
    gzip: gzipSync(stable).length,
    brotli: brotliCompressSync(stable, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: stable.length } }).length,
  }
  measured.set(data, size)
  return size
}

const brotliAsync = promisify(brotliCompress), gzipAsync = promisify(gzip)

/** Measures every file of a build up front on Node's worker threads, largest first, so the release step is not one core compressing
 *  hundreds of megabytes in turn; sizeOf then reads the results. The numbers are the same as sizeOf's own. */
export async function measureAll(dist: Dist): Promise<void> {
  const queue = [...dist.values()].filter(data => !measured.has(data)).sort((a, b) => b.length - a.length)
  const worker = async (): Promise<void> => {
    for (let data = queue.shift(); data; data = queue.shift()) {
      const stable = stableBytes(data)
      const [gz, br] = await Promise.all([gzipAsync(stable), brotliAsync(stable, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: stable.length } })])
      measured.set(data, { raw: data.length, gzip: gz.length, brotli: br.length })
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
}

export function addSizes(sizes: readonly Size[]): Size {
  return sizes.reduce((sum, item) => ({ raw: sum.raw + item.raw, gzip: sum.gzip + item.gzip, brotli: sum.brotli + item.brotli }), { raw: 0, gzip: 0, brotli: 0 })
}

export function readDist(dir: string): Dist {
  const files = new Map<string, Uint8Array>()
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.set(relative(dir, path).split('\\').join('/'), readFileSync(path))
    }
  }
  walk(dir)
  return files
}

const text = (dist: Dist, name: string): string => Buffer.from(dist.get(name) ?? new Uint8Array()).toString('utf8')

/** Static imports of a built chunk: `from"./x.js"` and `import"./x.js"`, not `import("./x.js")` and not the preload map. */
export function staticImports(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g)].map((match) => `assets/${match[1]}`)
}

/** The assets index.html names in a script or link tag (stylesheet, modulepreload, entry). */
export function pageAssets(html: string): string[] {
  return [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1] as string)
}

/** `roots` and every chunk they import statically. */
export function closure(dist: Dist, roots: readonly string[]): Set<string> {
  const seen = new Set<string>(), queue = [...roots]
  while (queue.length) {
    const name = queue.pop() as string
    if (seen.has(name) || !dist.has(name)) continue
    seen.add(name)
    if (name.endsWith('.js')) queue.push(...staticImports(text(dist, name)))
  }
  return seen
}

export function firstPaintFiles(dist: Dist): Set<string> {
  const files = closure(dist, pageAssets(text(dist, 'index.html')))
  if (dist.has('index.html')) files.add('index.html')
  return files
}

/** The ids of the cities that have exactly one rules chunk and one content chunk. */
export function cityIds(dist: Dist): string[] {
  const count = new Map<string, { rules: number; content: number }>()
  for (const name of dist.keys()) {
    const match = /^assets\/city-([a-z0-9]+(?:-[a-z0-9]+)*)-(rules|content)-[\w-]{7}\.js$/.exec(name)
    if (!match) continue
    const row = count.get(match[1] as string) ?? { rules: 0, content: 0 }
    row[match[2] as 'rules' | 'content'] += 1
    count.set(match[1] as string, row)
  }
  return [...count].filter(([, row]) => row.rules === 1 && row.content === 1).map(([id]) => id).sort()
}

/** First paint plus the shell and one city's rules and content, and their static imports; null when the build lacks one of them. */
export function startupFiles(dist: Dist, city: string): Set<string> | null {
  const only = (pattern: RegExp): string | null => {
    const found = [...dist.keys()].filter((name) => pattern.test(name))
    return found.length === 1 ? found[0] as string : null
  }
  const parts = [only(/^assets\/startApp-[\w-]{7}\.js$/), only(new RegExp(`^assets/city-${city}-rules-[\\w-]{7}\\.js$`)), only(new RegExp(`^assets/city-${city}-content-[\\w-]{7}\\.js$`))]
  if (parts.some((part) => part === null)) return null
  return closure(dist, [...pageAssets(text(dist, 'index.html')), ...(parts as string[])]).add('index.html')
}

export function measure(dist: Dist, files: Iterable<string>, only?: RegExp): Size {
  return addSizes([...files].filter((name) => dist.has(name) && (!only || only.test(name))).map((name) => sizeOf(dist.get(name) as Uint8Array)))
}

/** `assets/city-kano-scenes-AbCd1234.js` -> `city-kano-scenes`, with the city folded away: `city-*-scenes`. Other files group by extension. */
export function groupOf(name: string): string {
  const base = name.replace(/^assets\//, '')
  const unhashed = base.replace(/-[\w-]{7}(\.[a-z0-9]+)$/i, '$1')
  const city = /^city-(?!routes\b)(?!content-builder\b).+?-(rules|content|map|scenes(?:-[ab])?)\.js$/.exec(unhashed)
  if (/\.js$/.test(unhashed)) return city ? `city-*-${city[1]}` : unhashed.replace(/\.js$/, '')
  return `*${unhashed.includes('.') ? unhashed.slice(unhashed.lastIndexOf('.')) : ''} files`
}

export interface Group { group: string; files: number; size: Size; largest: { name: string; brotli: number } }

/** Everything in `dist` that is not in `loaded`, grouped, largest brotli first. */
export function lazyGroups(dist: Dist, loaded: ReadonlySet<string>): Group[] {
  const groups = new Map<string, Group>()
  for (const [name, data] of dist) {
    if (loaded.has(name)) continue
    const size = sizeOf(data), key = groupOf(name)
    const group = groups.get(key) ?? { group: key, files: 0, size: { raw: 0, gzip: 0, brotli: 0 }, largest: { name, brotli: 0 } }
    group.files += 1
    group.size = addSizes([group.size, size])
    if (size.brotli >= group.largest.brotli) group.largest = { name, brotli: size.brotli }
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.size.brotli - a.size.brotli)
}

/** Where the files of the realism assets will be found once they exist. 'sum': the pack's total; 'each': the largest single file. */
export const ASSET_PATTERNS: Partial<Record<BudgetName, { pattern: RegExp; by: 'sum' | 'each' }>> = {
  BASE_BODY_BROTLI: { pattern: /(^|\/)base-body[^/]*\.(glb|gltf|bin)$/, by: 'each' },
  CLIP_PACK_BROTLI: { pattern: /(^|\/)clip-pack[^/]*\.(glb|gltf|bin|json)$/, by: 'sum' },
  WARDROBE_ITEM_BROTLI: { pattern: /(^|\/)wardrobe\/[^/]+\.(glb|gltf)$/, by: 'each' },
  STREET_TILE_BROTLI: { pattern: /(^|\/)(street-)?tiles?\/[^/]+\.(glb|gltf|bin)$/, by: 'each' },
  CITY_SCENE_RECIPES_BYTES: { pattern: /^assets\/recipe-city-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{7}\.js$/, by: 'each' },
  TALK_INDEX_BYTES: { pattern: /^assets\/talk-banks\/index\.json$/, by: 'each' },
  TALK_CITY_PACK_BYTES: { pattern: /^assets\/talk-banks\/[a-z][a-z0-9-]*-[a-f0-9]{64}\.json$/, by: 'each' },
  SCENE_KIT_BROTLI: { pattern: /^assets\/scene-factory\/kits\/[a-z][a-z0-9-]*-[a-f0-9]{64}\.glb$/, by: 'each' },
  HERO_BROTLI: { pattern: /^assets\/scene-factory\/heroes\/[a-z][a-z0-9-]*-[a-f0-9]{64}\.glb$/, by: 'each' },
}

export interface Check { budget: BudgetName; measured: number | null; detail: string; status: 'ok' | 'over' | 'not measured' }

const JS = /\.js$/

export interface CityDownloadMeasurement { city: string; bytes: number; files: readonly string[] }

const CITY_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SHA256 = /^[a-f0-9]{64}$/

/** Join only exact city IDs from the generated content manifest, recipe filenames and Talk index. */
export function combinedCityDownloads(dist: Dist, contentRows: readonly CityContentAssetManifestRow[] = CITY_CONTENT_ASSETS): CityDownloadMeasurement[] {
  const contentIds = new Set<string>(), content = new Map<string, { path: string; bytes: number }>()
  for (const row of contentRows) {
    const expectedPath = `/assets/cities/${row.id}.${row.sha256}.json`
    if (!CITY_ID.test(row.id) || !SHA256.test(row.sha256) || row.path !== expectedPath || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || contentIds.has(row.id)) {
      throw new Error(`Invalid or duplicate city content manifest row: ${row.id}`)
    }
    contentIds.add(row.id)
    const distPath = row.path.slice(1), data = dist.get(distPath)
    if (data) {
      if (data.byteLength !== row.bytes) throw new Error(`City content byte mismatch for ${row.id}: manifest ${row.bytes}, dist ${data.byteLength}`)
      content.set(row.id, { path: distPath, bytes: data.byteLength })
    }
  }
  for (const path of dist.keys()) {
    if (!path.startsWith('assets/cities/')) continue
    const match = /^assets\/cities\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.([a-f0-9]{64})\.json$/.exec(path)
    if (!match || !contentIds.has(match[1] as string) || content.get(match[1] as string)?.path !== path) throw new Error(`Unknown or ambiguous city content asset: ${path}`)
  }

  const recipes = new Map<string, { path: string; bytes: number }>()
  for (const [path, data] of dist) {
    if (!path.startsWith('assets/recipe-city-')) continue
    const match = /^assets\/recipe-city-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-([a-f0-9]{7})\.js$/.exec(path)
    const city = match?.[1]
    if (!city || !contentIds.has(city) || recipes.has(city)) throw new Error(`Unknown, duplicate, or ambiguous city recipe: ${path}`)
    recipes.set(city, { path, bytes: data.byteLength })
  }

  const talk = new Map<string, { path: string; bytes: number }>()
  const indexPath = 'assets/talk-banks/index.json', indexBytes = dist.get(indexPath)
  const talkPaths = [...dist.keys()].filter(path => path.startsWith('assets/talk-banks/') && path !== indexPath)
  if (indexBytes) {
    let parsed: unknown
    try { parsed = JSON.parse(Buffer.from(indexBytes).toString('utf8')) as unknown }
    catch { throw new Error('Invalid Talk asset index JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Talk asset index envelope')
    const index = parsed as Record<string, unknown>
    if (Object.keys(index).length !== 3 || index.schema !== 'allworld-talk-index' || index.version !== 1 || !Array.isArray(index.cities)) throw new Error('Invalid Talk asset index envelope')
    for (const value of index.cities) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Talk city reference')
      const row = value as Record<string, unknown>
      const city = row.city
      if (Object.keys(row).length !== 5 || typeof city !== 'string' || !CITY_ID.test(city) || !contentIds.has(city) || talk.has(city)
        || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256) || row.path !== `/assets/talk-banks/${city}-${row.sha256}.json`
        || typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes <= 0
        || typeof row.banks !== 'number' || !Number.isSafeInteger(row.banks) || row.banks <= 0 || row.banks > 10_000) throw new Error(`Unknown, duplicate, or ambiguous Talk city reference: ${String(city)}`)
      const path = (row.path as string).slice(1), data = dist.get(path)
      if (!data || data.byteLength !== row.bytes) throw new Error(`Missing or mismatched indexed Talk pack for ${city}`)
      talk.set(city, { path, bytes: data.byteLength })
    }
    for (const path of talkPaths) if (![...talk.values()].some(row => row.path === path)) throw new Error(`Unindexed Talk pack: ${path}`)
  } else if (talkPaths.length) throw new Error(`Talk city packs exist without ${indexPath}`)

  const cities = new Set([...content.keys(), ...recipes.keys(), ...talk.keys()])
  return [...cities].sort().map(city => {
    const files = [content.get(city)?.path, recipes.get(city)?.path, talk.get(city)?.path].filter((path): path is string => !!path)
    const bytes = (content.get(city)?.bytes ?? 0) + (recipes.get(city)?.bytes ?? 0) + (talk.get(city)?.bytes ?? 0)
    return { city, bytes, files }
  })
}

/** Every named budget this report can measure from the build, in the order they are printed. */
export function checks(dist: Dist, city = 'lagos', contentRows: readonly CityContentAssetManifestRow[] = CITY_CONTENT_ASSETS): Check[] {
  const found: Omit<Check, 'status'>[] = []
  const add = (budget: BudgetName, measured: number | null, detail: string): void => { found.push({ budget, measured, detail }) }
  const paint = firstPaintFiles(dist)
  const loading = measure(dist, paint, JS), everything = measure(dist, paint)
  add('LOADING_RAW', paint.size ? loading.raw : null, 'first-paint JavaScript')
  add('LOADING_GZIP', paint.size ? loading.gzip : null, 'first-paint JavaScript')
  add('FIRST_PAINT_BROTLI', paint.size ? everything.brotli : null, `${paint.size} files: index.html, stylesheet and JavaScript`)
  const startups = [...new Set([city, ...cityIds(dist)])].flatMap((id) => { const files = startupFiles(dist, id); return files ? [{ id, js: measure(dist, files, JS), all: measure(dist, files) }] : [] })
  const largest = (key: 'raw' | 'gzip' | 'brotli', pick: 'js' | 'all') => startups.reduce<{ id: string; value: number } | null>((best, item) => (!best || item[pick][key] > best.value ? { id: item.id, value: item[pick][key] } : best), null)
  for (const [budget, key, pick] of [['STARTUP_RAW', 'raw', 'js'], ['STARTUP_GZIP', 'gzip', 'js'], ['STARTUP_BROTLI', 'brotli', 'all']] as const) {
    const top = largest(key, pick)
    add(budget, top ? top.value : null, top ? `largest over ${startups.length} cities (${top.id})` : 'no startup chunks in this build')
  }
  const hosts = [...dist.keys()].filter((name) => /^assets\/world-adapter-[\w-]{7}\.js$/.test(name))
  const host = hosts.length === 1 ? measure(dist, hosts) : null
  add('SCENE_HOST_RAW', host?.raw ?? null, 'shared scene chunk (world-adapter)')
  add('SCENE_HOST_GZIP', host?.gzip ?? null, 'shared scene chunk (world-adapter)')
  const fxChunks = [...dist.keys()].filter((name) => /^assets\/fx-[\w-]{7}\.js$/.test(name))
  const fx = fxChunks.length === 1 ? measure(dist, fxChunks) : null
  add('FX_RAW', fx?.raw ?? null, 'lazy fx chunk (weather, particles, post-processing, feel)')
  add('FX_GZIP', fx?.gzip ?? null, 'lazy fx chunk (weather, particles, post-processing, feel)')
  for (const [budget, { pattern, by }] of Object.entries(ASSET_PATTERNS) as [BudgetName, { pattern: RegExp; by: 'sum' | 'each' }][]) {
    const names = [...dist.keys()].filter((name) => pattern.test(name))
    const metric = BUDGETS[budget].unit === 'raw bytes' ? 'raw' : 'brotli'
    const sizes = names.map((name) => measure(dist, [name])[metric])
    add(budget, names.length ? (by === 'sum' ? sizes.reduce((a, b) => a + b, 0) : Math.max(...sizes)) : null, names.length ? `${names.length} file(s) matching ${pattern}` : `no file matches ${pattern}`)
  }
  const cityDownloads = combinedCityDownloads(dist, contentRows)
  const largestCity = cityDownloads.reduce<CityDownloadMeasurement | null>((best, row) => !best || row.bytes > best.bytes ? row : best, null)
  add('CITY_CONTENT_RECIPE_TALK_BYTES', largestCity?.bytes ?? null, largestCity ? `largest city ${largestCity.city}: ${largestCity.files.join(', ')}` : 'no city content, recipe or Talk assets in this build')
  return found.map((item) => ({ ...item, status: item.measured === null ? 'not measured' : withinBudget(BUDGETS[item.budget], item.measured) ? 'ok' : 'over' }))
}

const kB = (bytes: number): string => (bytes / 1000).toFixed(1).padStart(8)

export function formatReport(dist: Dist, results: readonly Check[], groups: readonly Group[], top = 30): string {
  const lines: string[] = ['Download budgets (src/budgets.ts)']
  for (const item of results) {
    const budget = BUDGETS[item.budget]
    const measured = item.measured === null ? '       -' : String(item.measured).padStart(8)
    lines.push(`${item.status === 'over' ? 'OVER' : item.status === 'ok' ? 'ok  ' : 'n/a '} ${item.budget.padEnd(22)} ${measured}  budget ${describeBudget(budget)}${budget.status === 'provisional' ? ' [provisional]' : ''}  ${item.detail}`)
  }
  const paint = firstPaintFiles(dist), startup = startupFiles(dist, 'lagos') ?? new Set<string>()
  lines.push('', `First paint (${paint.size} files) and lagos startup (${startup.size} files): kB raw / gzip / brotli`)
  for (const [label, files] of [['first paint', paint], ['lagos startup', startup]] as const) {
    const size = measure(dist, files)
    lines.push(`${kB(size.raw)} ${kB(size.gzip)} ${kB(size.brotli)}  ${label}`)
  }
  lines.push('', `Lazy groups, largest brotli first (${Math.min(top, groups.length)} of ${groups.length}): kB raw / gzip / brotli, files, largest file`)
  for (const group of groups.slice(0, top)) lines.push(`${kB(group.size.raw)} ${kB(group.size.gzip)} ${kB(group.size.brotli)}  ${group.group.padEnd(32)} ${String(group.files).padStart(3)}  ${group.largest.name} (${kB(group.largest.brotli).trim()} kB)`)
  return lines.join('\n')
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = resolve(root, args.includes('--dist') ? args[args.indexOf('--dist') + 1] ?? 'dist' : 'dist')
  if (!existsSync(join(dir, 'index.html'))) { console.error(`No build at ${dir}: run \`npm run build\` first.`); return 2 }
  const dist = readDist(dir)
  await measureAll(dist)
  const results = checks(dist)
  const over = results.filter((item) => item.status === 'over')
  if (over.length) {
    if (args.includes('--json')) console.log(JSON.stringify({ checks: results, lazyGroups: [], nativeAssets: { status: 'not run', reason: 'An earlier download budget failed' } }, null, 2))
    else console.log(formatReport(dist, results, [], 0))
    console.error(`\n${over.length} budget(s) exceeded: ${over.map((item) => item.budget).join(', ')}. Lazy asset inventory was not run.`)
    return 1
  }
  const groups = lazyGroups(dist, startupFiles(dist, 'lagos') ?? firstPaintFiles(dist))
  const native = await inventory(root, dir, (url, sha256) => {
    const bytes = dist.get(url.slice(1))
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error(`Native asset changed during measurement: ${url}`)
    return sizeOf(bytes)
  })
  const nativeAssets = { pass: native.pass, resources: native.rows.length, totals: native.totals, defaults: native.defaults.map(({body, totals}) => ({body, totals})), conflicts: native.conflicts.length, errors: native.errors.length, extras: native.extras.length, overBudget: native.checks.filter(check => !check.pass).length }
  if (args.includes('--json')) console.log(JSON.stringify({ checks: results, lazyGroups: groups, nativeAssets }, null, 2))
  else {
    console.log(formatReport(dist, results, groups, args.includes('--all') ? Infinity : args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) || 30 : 30))
    console.log(JSON.stringify(nativeAssets, null, 2))
  }
  if (native.errors.length) console.error(JSON.stringify(native.errors))
  return !native.pass ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code }).catch(error => { console.error(error); process.exitCode = 1 })
