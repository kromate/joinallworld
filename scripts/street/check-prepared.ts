import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { constants, brotliCompressSync } from 'node:zlib'
import { resolve } from 'node:path'
import { parseStreetManifest, parseStreetManifestPointer, createStreetAssets } from '../../server/street/assets.ts'
import { decodeImmutableStreetTile, MAX_RAW_TILE_BYTES, tileGroundAt, localPoint, globalPoint } from '../../src/street/frame.ts'
import { estimatedTileTriangles } from '../../src/street/generate.ts'
import type { WireStreetTile } from '../../src/street/types.ts'

/** All emitted immutable tiles, streamed one at a time; no browser, renderer or geography download. */
export async function checkPrepared(city: string) {
  const out = resolve('public/assets/street', city), text = await readFile(resolve(out, 'manifest.txt'), 'utf8'), value: unknown = JSON.parse(text);
  const target = parseStreetManifestPointer(value, city);
  const logicalText = target === null ? text : await readFile(resolve(out, `manifest-${target}.txt`), 'utf8');
  const manifest = parseStreetManifest(JSON.parse(logicalText), city);
  if (target !== null && manifest.version !== target) throw Error('Current street pointer version mismatch');
  if (Buffer.byteLength(text) > 4 * 1024 * 1024 || Buffer.byteLength(logicalText) > 4 * 1024 * 1024) throw Error('Manifest exceeds bridge limit')
  const immutable = await readFile(resolve(out, `manifest-${manifest.version}.txt`), 'utf8'); if (immutable !== logicalText) throw Error('Current and versioned manifest differ')
  const assets = createStreetAssets({ async readManifest(_city, version) { return JSON.parse(await readFile(resolve(out, version ? `manifest-${version}.txt` : 'manifest.txt'), 'utf8')) }, readTile: (_city, _version, file) => readFile(resolve(out, file), 'utf8') })
  const packs = new Set<string>()
  const doors = new Set<string>(); let maxRaw = 0, maxBrotli = 0, maxTriangles = 0, totalRaw = 0, totalBrotli = 0
  for (const entry of manifest.tiles.values()) {
    const value = await assets.tile(city, manifest.version, entry.tile), body = JSON.stringify(value.wire), raw = Buffer.byteLength(body), compressed = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length
    if (createHash('sha256').update(body).digest('hex') !== entry.sha256 || raw > MAX_RAW_TILE_BYTES || compressed > 60000) throw Error(`Street tile hash/byte check failed: ${entry.file}`)
    if (!packs.has(entry.file)) { const packed = await readFile(resolve(out, entry.file), 'utf8'); if (Buffer.byteLength(packed) > MAX_RAW_TILE_BYTES || brotliCompressSync(packed, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length > 60000) throw Error('Pack byte cap failed'); packs.add(entry.file) }
    const tile = decodeImmutableStreetTile(value.wire, { city, version: manifest.version, tile: entry.tile })
    // Reconstruct typed wire from the validated tile rather than trusting JSON's inferred any.
    const checked: WireStreetTile = { v: 1, city, version: manifest.version, tile: [entry.tile.x, entry.tile.z], ground: [...tile.ground], roads: tile.roads.map(road => ({ ...road, width: Math.round(road.width * 100), points: road.points.flatMap(p => [Math.round(p.x * 100), Math.round(p.z * 100)]) })), buildings: tile.buildings.map(building => ({ ...building, height: Math.round(building.height * 100), footprint: building.footprint.flatMap(p => [Math.round(p.x * 100), Math.round(p.z * 100)]) })), doors: tile.doors.map(door => ({ ...door, at: [Math.round(door.at.x * 100), Math.round(door.at.z * 100)], approach: [Math.round(door.approach.x * 100), Math.round(door.approach.z * 100)] })) }
    const triangles = estimatedTileTriangles(checked); if (triangles > 25000) throw Error(`Triangle budget failed: ${entry.file}`)
    for (const door of tile.doors) { const indexed = manifest.doors.get(door.id); if (!indexed || doors.has(door.id) || JSON.stringify(indexed.target) !== JSON.stringify(door.target) || Math.hypot(globalPoint(door.approach, entry.tile).x - indexed.approach.x, globalPoint(door.approach, entry.tile).z - indexed.approach.z) > 0.015 || !tileGroundAt(tile, localPoint(indexed.approach, entry.tile))) throw Error(`Door identity/approach failed: ${door.id}`); doors.add(door.id) }
    maxRaw = Math.max(maxRaw, raw); maxBrotli = Math.max(maxBrotli, compressed); maxTriangles = Math.max(maxTriangles, triangles); totalRaw += raw; totalBrotli += compressed
  }
  if (doors.size !== manifest.doors.size) throw Error('Manifest references a door absent from immutable tiles')
  const result = { city, version: manifest.version, passed: true, tiles: manifest.tiles.size, packs: packs.size, doors: doors.size, maxRaw, maxBrotli, maxEstimatedTriangles: maxTriangles, totalRaw, totalBrotli, manifestBytes: Buffer.byteLength(text), source: 'Local prepared static files; no deployment or complete road survey claim.' }
  await writeFile(resolve('evidence/street', `${city}-prepared-check.json`), JSON.stringify(result, null, 2)); return result
}
