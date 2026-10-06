// Prints what the automatic startup downloads, by chunk and by module.
//
//   node --experimental-strip-types scripts/startup-size.ts            the startup chunks and the 40 largest modules in them
//   node --experimental-strip-types scripts/startup-size.ts --top 100  more modules
//   node --experimental-strip-types scripts/startup-size.ts --all      every chunk of the build, not only the startup ones
//   node --experimental-strip-types scripts/startup-size.ts --city kano  startup with another selected city
//
// "Startup" is what src/app/entry.test.ts measures: the entry, game shell, selected city rules and content, authored routes,
// and their static dependencies. The build runs in memory (nothing is written to dist/). A module's size is its share
// of its chunk's minified bytes, in proportion to the length Rollup rendered for it before minification, so the module
// figures are estimates and the chunk figures are exact.
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, Rollup } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) || 40 : 40
const everything = args.includes('--all')
const city = args.includes('--city') ? args[args.indexOf('--city') + 1] : 'lagos'
if (!city || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)) throw new Error('--city requires a city id')

// Static import edges of the source graph, as Rollup resolved them (the browser system swap included).
const edges = new Map<string, readonly string[]>()
const graph: Plugin = { name: 'startup-size:graph', generateBundle() { for (const id of this.getModuleIds()) edges.set(id, this.getModuleInfo(id)?.importedIds ?? []) } }
const result = await build({ root, logLevel: 'silent', plugins: [graph], build: { write: false } })
const outputs = (Array.isArray(result) ? result : [result as Rollup.RollupOutput]).flatMap((item) => item.output)
const chunks = new Map<string, Rollup.OutputChunk>()
for (const item of outputs) if (item.type === 'chunk') chunks.set(item.fileName, item)

const html = outputs.find((item) => item.type === 'asset' && item.fileName === 'index.html')
const page = html && html.type === 'asset' ? String(html.source) : ''
const queue = [...page.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1] as string)
queue.push(...[...chunks.keys()].filter((name) => /^assets\/startApp-[\w-]+\.js$/.test(name)))
for (const prefix of [`city-${city}-rules`, `city-${city}-content`, 'city-routes']) {
  const matches = [...chunks.keys()].filter(name => new RegExp(`^assets/${prefix}-[\\w-]+\\.js$`).test(name))
  if (matches.length !== 1) throw new Error(`Expected one startup chunk for ${prefix}, found ${matches.length}`)
  queue.push(...matches)
}
const startup = new Set<string>()
while (queue.length) {
  const name = queue.pop() as string
  const chunk = chunks.get(name)
  if (!chunk || startup.has(name)) continue
  startup.add(name)
  queue.push(...chunk.imports)
}

const kB = (bytes: number): string => (bytes / 1000).toFixed(1).padStart(8)
const label = (id: string): string => id.includes('node_modules/') ? id.slice(id.lastIndexOf('node_modules/')) : relative(root, id.replace(/\?.*$/, '')) + (id.includes('?') ? id.slice(id.indexOf('?')).replace(/&lang\.\w+$/, '') : '')

// What the startup needs by its own static imports: anything else in a startup chunk was put there by a chunk rule.
const needed = new Set<string>()
const cityRoots = new Set([resolve(root, 'src/game/cities', city, 'index.ts'), resolve(root, 'src/game/cities', city, 'content.ts'), resolve(root, 'src/game/cities/routes.generated.ts')])
const walk = [...edges.keys()].filter((id) => /\/src\/app\/(main|startApp)\.ts$/.test(id) || cityRoots.has(id))
while (walk.length) {
  const id = walk.pop() as string
  if (needed.has(id)) continue
  needed.add(id)
  walk.push(...(edges.get(id) ?? []))
}

interface Row { name: string; chunk: string; bytes: number; needed: boolean }
const modules: Row[] = []
let raw = 0, gzip = 0
console.log(`${everything ? 'Every chunk' : 'Startup chunks'} for ${city} (raw kB, gzip kB)`)
for (const [name, chunk] of [...chunks].filter(([name]) => everything || startup.has(name)).sort((a, b) => b[1].code.length - a[1].code.length)) {
  const bytes = Buffer.byteLength(chunk.code), zipped = gzipSync(chunk.code).length
  if (startup.has(name)) { raw += bytes; gzip += zipped }
  console.log(`${kB(bytes)} ${kB(zipped)}  ${name}${everything && startup.has(name) ? '  (startup)' : ''}`)
  const rendered = Object.values(chunk.modules).reduce((sum, item) => sum + item.renderedLength, 0) || 1
  for (const [id, item] of Object.entries(chunk.modules)) if (item.renderedLength) modules.push({ name: label(id), chunk: name.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, ''), bytes: bytes * item.renderedLength / rendered, needed: !startup.has(name) || needed.has(id) })
}
console.log(`${kB(raw)} ${kB(gzip)}  startup total (${raw} / ${gzip} bytes)`)

const folders = new Map<string, number>()
for (const row of modules) {
  const parts = row.name.split('/')
  const folder = row.name.startsWith('node_modules/') ? parts.slice(0, 2).join('/') : parts.slice(0, Math.min(parts.length - 1, parts[1] === 'app' ? 4 : 3)).join('/')
  folders.set(folder, (folders.get(folder) ?? 0) + row.bytes)
}
console.log('\nBy folder (estimated raw kB)')
for (const [folder, bytes] of [...folders].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${kB(bytes)}  ${folder}`)

const pulled = modules.filter((row) => !row.needed).sort((a, b) => b.bytes - a.bytes)
console.log(`\nIn a startup chunk without a static import from the startup (${kB(pulled.reduce((sum, row) => sum + row.bytes, 0)).trim()} kB): a chunk rule put them there`)
for (const row of pulled) console.log(`${kB(row.bytes)}  ${row.name}  [${row.chunk}]`)

console.log(`\nLargest ${top} modules (estimated raw kB, chunk)`)
for (const row of modules.sort((a, b) => b.bytes - a.bytes).slice(0, top)) console.log(`${kB(row.bytes)}  ${row.name}  [${row.chunk}]`)
