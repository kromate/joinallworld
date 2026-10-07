import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCityPack } from '../../src/map3d/regions.ts'
import { estateLayout } from '../../src/map3d/estates.ts'
import { loadCityContent } from '../../src/game/cities/registry.ts'
import { createStreetSource, estimatedTileTriangles } from '../../src/street/generate.ts'
import { decodeStreetTile, mapPointToMetres, tileOf, tileWindow, tileKey, MAX_RAW_TILE_BYTES } from '../../src/street/frame.ts'
import { prepareStreet, prepareAllStreets } from './prepare.ts'
import type { StreetManifest, TileCoord } from '../../src/street/types.ts'

/** Proof output only. Publishing hashed .txt tile assets requires a separately reviewed release step. */
export async function generateProof(city = 'lagos', venue = city === 'lagos' ? 'cchub' : undefined) {
  const pack = await loadCityPack(city)
  if (!pack?.frame) throw Error(`No framed CityPack for ${city}`)
  const content = await loadCityContent(city), lga = pack.lgas.find(unit => unit.id === 'lagos-mainland') ?? pack.lgas[0]
  if (!lga) throw Error('No allocated-estate geography in this pack')
  const layout = estateLayout(pack, lga.id), cell = layout?.cells[0]
  if (!cell) throw Error('No estate-zero gate placement')
  const gate = { lga: lga.id, estate: 0, point: mapPointToMetres(pack, cell) }
  const venues = content.venues.filter(place => place.id !== 'home').map(place => place.id)
  const code = await Promise.all([readFile(new URL('../../src/street/generate.ts', import.meta.url), 'utf8'), readFile(new URL('../../src/street/frame.ts', import.meta.url), 'utf8')])
  const version = `street-v1-${createHash('sha256').update(JSON.stringify({ id: pack.id, frame: pack.frame, roads: pack.roads, land: pack.land, water: pack.water, inland: pack.inland, sites: pack.sites, fabric: pack.fabric, gate, venues, code })).digest('hex').slice(0, 16)}`
  const source = createStreetSource(pack, { version, venues, gates: [gate], roadSource: 'authored' })
  const start = `estate:${city}:${lga.id}:0`
  const finish = venue ? `venue:${city}:${venue}` : source.doors.find(door => door.target.kind === 'venue')?.id
  if (!finish) throw Error('No reachable venue approach')
  const route = source.route(start, finish)
  if (!route) throw Error(`Disconnected estate-to-venue route ${start} -> ${finish}`)
  const selected = new Map<string, TileCoord>()
  for (let i = 1; i < route.length; i++) { const a = route[i - 1], b = route[i]; if (!a || !b) continue; const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 64)); for (let at = 0; at <= steps; at++) for (const tile of tileWindow(tileOf({ x: a.x + (b.x - a.x) * at / steps, z: a.z + (b.z - a.z) * at / steps }))) selected.set(tileKey(tile), tile) }
  if (selected.size > 256) throw Error('Proof corridor exceeds its 256-file emission cap; shorten the chosen path')
  const out = resolve('evidence/street', city); await mkdir(out, { recursive: true })
  const manifest: StreetManifest = { v: 1, city, version, tileSize: 128, quantum: 100, groundCell: 2, mapFrame: pack.frame, tiles: [], issues: source.issues, doors: source.doors.filter(door => selected.has(tileKey(tileOf(door.approach)))).map(door => ({ ...door, tile: tileOf(door.approach) })) }
  let totalRaw = 0, totalBrotli = 0, maxBrotli = 0, maxTriangles = 0
  for (const tile of [...selected.values()].sort((a, b) => a.x - b.x || a.z - b.z)) {
    const wire = source.tile(tile), text = JSON.stringify(wire), rawBytes = Buffer.byteLength(text), brotliBytes = brotliCompressSync(text).length, estimatedTriangles = estimatedTileTriangles(wire)
    decodeStreetTile(wire, { city, version, tile })
    if (rawBytes > MAX_RAW_TILE_BYTES || brotliBytes > 60000 || estimatedTriangles > 25000) throw Error(`Tile ${tileKey(tile)} exceeds its byte/recipe budget`)
    const file = `street-${city}-${version}-${tile.x}-${tile.z}.txt`
    await writeFile(resolve(out, file), text)
    manifest.tiles.push({ tile, file, rawBytes, brotliBytes, estimatedTriangles, sha256: createHash('sha256').update(text).digest('hex') }); totalRaw += rawBytes; totalBrotli += brotliBytes; maxBrotli = Math.max(maxBrotli, brotliBytes); maxTriangles = Math.max(maxTriangles, estimatedTriangles)
  }
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(out, 'sparse-index.json'), JSON.stringify({ city, version, tiles: source.tiles }))
  await writeFile(resolve(out, 'route.json'), JSON.stringify({ start, finish, generatedEstateGate: true, points: route, reverse: source.route(finish, start) }, null, 2))
  const summary = { city, version, sparseTiles: source.tiles.length, emittedTiles: manifest.tiles.length, files: manifest.tiles.length + 4, totalRaw, totalBrotli, maxBrotli, maxEstimatedTriangles: maxTriangles, issues: source.issues, route: { start, finish, points: route.length }, output: out, productionAssetsEmitted: false }
  await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2)); return summary
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const full = process.argv.includes('--prepare') || process.argv.includes('--plan'), city = full ? process.argv[3] ?? 'lagos' : process.argv[2] ?? 'lagos', venue = process.argv[3]
  const task = process.argv.includes('--prepare-all') ? prepareAllStreets() : full ? prepareStreet(city, process.argv.includes('--prepare')) : generateProof(city, venue)
  task.then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error); process.exitCode = 1 })
}
