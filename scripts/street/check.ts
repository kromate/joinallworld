import { checkPrepared } from './check-prepared.ts'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { brotliCompressSync } from 'node:zlib'
import { resolve } from 'node:path'
import { loadCityPack } from '../../src/map3d/regions.ts'
import { registeredCityIds } from '../../src/game/cities/registry.ts'
import { decodeStreetTile, tileGroundAt, tileOf, localPoint } from '../../src/street/frame.ts'
import type { MetrePoint, TileCoord } from '../../src/street/types.ts'

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) }
async function checkProof(city: string) {
  const out = resolve('evidence/street', city), manifest = await readJson(resolve(out, 'manifest.json')), route = await readJson(resolve(out, 'route.json'))
  if (!record(manifest) || typeof manifest.version !== 'string' || manifest.city !== city || !Array.isArray(manifest.tiles) || !record(route) || !Array.isArray(route.points) || !Array.isArray(route.reverse)) throw Error('Invalid proof manifest/route')
  const tiles = new Map<string, ReturnType<typeof decodeStreetTile>>()
  for (const entry of manifest.tiles) { if (!record(entry) || typeof entry.file !== 'string' || !/^[a-z0-9_-]+\.txt$/.test(entry.file) || !record(entry.tile) || typeof entry.tile.x !== 'number' || typeof entry.tile.z !== 'number') throw Error('Invalid tile manifest entry'); const tile: TileCoord = { x: entry.tile.x, z: entry.tile.z }, text = await readFile(resolve(out, entry.file), 'utf8'); if (createHash('sha256').update(text).digest('hex') !== entry.sha256 || brotliCompressSync(text).length > 60000) throw Error('Tile hash/byte budget failed'); tiles.set(`${tile.x}_${tile.z}`, decodeStreetTile(JSON.parse(text), { city, version: manifest.version, tile })) }
  let samples = 0
  for (const path of [route.points, route.reverse]) for (let i = 1; i < path.length; i++) { const a: unknown = path[i - 1], b: unknown = path[i]; if (!record(a) || !record(b) || typeof a.x !== 'number' || typeof a.z !== 'number' || typeof b.x !== 'number' || typeof b.z !== 'number') throw Error('Invalid proof route point'); const start: MetrePoint = { x: a.x, z: a.z }, end: MetrePoint = { x: b.x, z: b.z }, steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z))); for (let at = 0; at <= steps; at++) { const point = { x: start.x + (end.x - start.x) * at / steps, z: start.z + (end.z - start.z) * at / steps }, id = tileOf(point), tile = tiles.get(`${id.x}_${id.z}`); if (!tile || !tileGroundAt(tile, localPoint(point, id))) throw Error(`Unwalkable proof route at ${point.x.toFixed(2)},${point.z.toFixed(2)}`); samples++ } }
  const result = { city, passed: true, tiles: tiles.size, routeSamples: samples, rendererVerified: false }; await writeFile(resolve(out, 'check.json'), JSON.stringify(result, null, 2)); return result
}
async function contracts() {
  const results = []
  for (const city of registeredCityIds()) { const pack = await loadCityPack(city); const valid = Boolean(pack?.frame && pack.frame.unitsPerKm > 0 && pack.roads.every(road => road.points.length >= 2 && road.points.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))) && Object.values(pack.sites).every(point => Number.isFinite(point.x) && Number.isFinite(point.z))); results.push({ city, passed: valid, roads: pack?.roads.length ?? 0, sites: Object.keys(pack?.sites ?? {}).length, note: 'Pack frame/source geometry contract only; no claim of complete walkable coverage.' }) }
  await mkdir(resolve('evidence/street'), { recursive: true }); await writeFile(resolve('evidence/street/contracts.json'), JSON.stringify(results, null, 2)); return { cities: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed) }
}
(process.argv.includes('--prepared') ? checkPrepared(process.argv[3] ?? 'lagos') : process.argv.includes('--contracts') ? contracts() : checkProof(process.argv[2] ?? 'lagos')).then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error); process.exitCode = 1 })
