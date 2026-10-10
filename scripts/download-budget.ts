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
//   startup      first paint plus the game shell, authored routes and ONE city's rules and content (what src/app/entry.test.ts
//                measures); the figure is the largest over every city, because any of them can be the one played
//   lazy groups  every other chunk, by name without its hash; `city-<id>-<kind>` is one group per kind across cities
//
// Budgets with no artifact yet (base body, clip pack, wardrobe items, street tiles) are listed as "not measured": the file name
// patterns in ASSET_PATTERNS are the convention to change when the asset layout is decided.
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUDGETS, describeBudget, withinBudget } from '../src/budgets.ts'
import type { BudgetName } from '../src/budgets.ts'

/** Files of a build by path under dist/ ('index.html', 'assets/app-AbCd1234.js'). */
export type Dist = ReadonlyMap<string, Uint8Array>

export interface Size { raw: number; gzip: number; brotli: number }

/** Brotli at quality 11 is slow on big chunks and every city's startup shares most of them: a file is measured once. */
const measured = new WeakMap<Uint8Array, Size>()

export function sizeOf(data: Uint8Array): Size {
  const known = measured.get(data)
  if (known) return known
  const size = {
    raw: data.length,
    gzip: gzipSync(data).length,
    brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }).length,
  }
  measured.set(data, size)
  return size
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
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function admittedCountry(city: string): string | null {
  const source = readFileSync(join(REPO_ROOT, 'src/game/cities/foreign-admission.generated.ts'), 'utf8')
  return [...source.matchAll(/\{\s*id:\s*"([^"]+)",\s*countryISO:\s*"([a-z]{2})"\s*\}/g)].find(match => match[1] === city)?.[2] ?? null
}

function foreignStartupAssets(dist: Dist, city: string): string[] | null {
  const country = admittedCountry(city)
  if (!country) return []
  const indexes = [...dist.keys()].filter(name => /^world-country-directory\/index-[\w-]+\.txt$/.test(name))
  if (indexes.length !== 1) return null
  let index: { countries?: readonly { iso2: string; path: string }[] }
  try { index = JSON.parse(text(dist, indexes[0] as string)) as typeof index } catch { return null }
  const entry = index.countries?.find(item => item.iso2.toLowerCase() === country)
  if (!entry) return null
  const shard = `world-country-directory/${entry.path}`
  return dist.has(shard) ? [indexes[0] as string, shard] : null
}

function foreignLoaderChunk(dist: Dist, city: string): string | null {
  const id = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[,\\{])\"?${id}\"?:(?:async)?\\(\\)=>`)
  const matches = [...dist.keys()].filter(name => name.endsWith('.js') && pattern.test(text(dist, name)))
  return matches.length === 1 ? matches[0] as string : null
}

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
    const match = /^assets\/city-([a-z0-9]+(?:-[a-z0-9]+)*)-(rules|content)-[\w-]{8}\.js$/.exec(name)
    if (!match) continue
    const row = count.get(match[1] as string) ?? { rules: 0, content: 0 }
    row[match[2] as 'rules' | 'content'] += 1
    count.set(match[1] as string, row)
  }
  return [...count].filter(([, row]) => row.rules === 1 && row.content === 1).map(([id]) => id).sort()
}

/** First paint plus the emitted shell, authored routes, one city's rules/content and its bootstrap packet when foreign. */
export function startupFiles(dist: Dist, city: string): Set<string> | null {
  const only = (pattern: RegExp): string | null => {
    const found = [...dist.keys()].filter((name) => pattern.test(name))
    return found.length === 1 ? found[0] as string : null
  }
  const parts = [only(/^assets\/startApp-[\w-]{8}\.js$/), only(/^assets\/city-routes-[\w-]{8}\.js$/), only(new RegExp(`^assets/city-${city}-rules-[\\w-]{8}\\.js$`)), only(new RegExp(`^assets/city-${city}-content-[\\w-]{8}\\.js$`))]
  if (parts.some((part) => part === null)) return null
  const foreignAssets = foreignStartupAssets(dist, city)
  if (foreignAssets === null) return null
  const extra = admittedCountry(city) ? foreignLoaderChunk(dist, city) : null
  if (admittedCountry(city) && !extra) return null
  return new Set([...closure(dist, [...pageAssets(text(dist, 'index.html')), ...(parts as string[]), ...(extra ? [extra] : [])]), 'index.html', ...foreignAssets])
}

export function measure(dist: Dist, files: Iterable<string>, only?: RegExp): Size {
  return addSizes([...files].filter((name) => dist.has(name) && (!only || only.test(name))).map((name) => sizeOf(dist.get(name) as Uint8Array)))
}

/** `assets/city-kano-scenes-AbCd1234.js` -> `city-kano-scenes`, with the city folded away: `city-*-scenes`. Other files group by extension. */
export function groupOf(name: string): string {
  const base = name.replace(/^assets\//, '')
  const unhashed = base.replace(/-[\w-]{8}(\.[a-z0-9]+)$/i, '$1')
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
}

export interface Check { budget: BudgetName; measured: number | null; detail: string; status: 'ok' | 'over' | 'not measured' }

const JS = /\.js$/

/** Every named budget this report can measure from the build, in the order they are printed. */
export function checks(dist: Dist, city = 'lagos', requiredCities: readonly string[] = cityIds(dist)): Check[] {
  const found: Omit<Check, 'status'>[] = []
  const add = (budget: BudgetName, measured: number | null, detail: string): void => { found.push({ budget, measured, detail }) }
  const paint = firstPaintFiles(dist)
  const loading = measure(dist, paint, JS), everything = measure(dist, paint)
  add('LOADING_RAW', paint.size ? loading.raw : null, 'first-paint JavaScript')
  add('LOADING_GZIP', paint.size ? loading.gzip : null, 'first-paint JavaScript')
  add('FIRST_PAINT_BROTLI', paint.size ? everything.brotli : null, `${paint.size} files: index.html, stylesheet and JavaScript`)
  const startupIds = [...new Set([city, ...requiredCities])]
  const startups = startupIds.map((id) => { const files = startupFiles(dist, id); if (!files) throw new Error(`Required startup measurement is missing for ${id}`); return { id, js: measure(dist, files, JS), all: measure(dist, files) } })
  const largest = (key: 'raw' | 'gzip' | 'brotli', pick: 'js' | 'all') => startups.reduce<{ id: string; value: number } | null>((best, item) => (!best || item[pick][key] > best.value ? { id: item.id, value: item[pick][key] } : best), null)
  for (const [budget, key, pick] of [['STARTUP_RAW', 'raw', 'js'], ['STARTUP_GZIP', 'gzip', 'js'], ['STARTUP_BROTLI', 'brotli', 'all']] as const) {
    const top = largest(key, pick)
    add(budget, top ? top.value : null, top ? `largest over ${startups.length} cities (${top.id})` : 'no startup chunks in this build')
  }
  const hosts = [...dist.keys()].filter((name) => /^assets\/world-adapter-[\w-]{8}\.js$/.test(name))
  const host = hosts.length === 1 ? measure(dist, hosts) : null
  add('SCENE_HOST_RAW', host?.raw ?? null, 'shared scene chunk (world-adapter)')
  add('SCENE_HOST_GZIP', host?.gzip ?? null, 'shared scene chunk (world-adapter)')
  for (const [budget, { pattern, by }] of Object.entries(ASSET_PATTERNS) as [BudgetName, { pattern: RegExp; by: 'sum' | 'each' }][]) {
    const names = [...dist.keys()].filter((name) => pattern.test(name))
    const sizes = names.map((name) => measure(dist, [name]).brotli)
    add(budget, names.length ? (by === 'sum' ? sizes.reduce((a, b) => a + b, 0) : Math.max(...sizes)) : null, names.length ? `${names.length} file(s) matching ${pattern}` : `no file matches ${pattern}`)
  }
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
  const paint = firstPaintFiles(dist), startup = startupFiles(dist, 'lagos')
  if (!startup) throw new Error('Required startup measurement is missing for lagos')
  lines.push('', `First paint (${paint.size} files) and lagos startup (${startup.size} files): kB raw / gzip / brotli`)
  for (const [label, files] of [['first paint', paint], ['lagos startup', startup]] as const) {
    const size = measure(dist, files)
    lines.push(`${kB(size.raw)} ${kB(size.gzip)} ${kB(size.brotli)}  ${label}`)
  }
  lines.push('', `Lazy groups, largest brotli first (${Math.min(top, groups.length)} of ${groups.length}): kB raw / gzip / brotli, files, largest file`)
  for (const group of groups.slice(0, top)) lines.push(`${kB(group.size.raw)} ${kB(group.size.gzip)} ${kB(group.size.brotli)}  ${group.group.padEnd(32)} ${String(group.files).padStart(3)}  ${group.largest.name} (${kB(group.largest.brotli).trim()} kB)`)
  return lines.join('\n')
}

function main(): number {
  const args = process.argv.slice(2)
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = resolve(root, args.includes('--dist') ? args[args.indexOf('--dist') + 1] ?? 'dist' : 'dist')
  if (!existsSync(join(dir, 'index.html'))) { console.error(`No build at ${dir}: run \`npm run build\` first.`); return 2 }
  const dist = readDist(dir)
  const required = [...readFileSync(join(root, 'src/game/cities/catalogue.generated.ts'), 'utf8').matchAll(/^  \[[\"]([^\"]+)[\"]/gm)].map(match => match[1] as string)
  if (required.length !== 50) throw new Error(`Expected 50 checked-in city bootstrap rows, found ${required.length}`)
  const results = checks(dist, 'lagos', required)
  const lagosStartup = startupFiles(dist, 'lagos')
  if (!lagosStartup) throw new Error('Required startup measurement is missing for lagos')
  const groups = lazyGroups(dist, lagosStartup)
  if (args.includes('--json')) console.log(JSON.stringify({ checks: results, lazyGroups: groups }, null, 2))
  else console.log(formatReport(dist, results, groups, args.includes('--all') ? Infinity : args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) || 30 : 30))
  const over = results.filter((item) => item.status === 'over')
  if (over.length) console.error(`\n${over.length} budget(s) exceeded: ${over.map((item) => item.budget).join(', ')}`)
  return over.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
