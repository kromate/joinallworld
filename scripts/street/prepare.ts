import { createHash } from 'node:crypto'
import { constants, brotliCompressSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadCityPack } from '../../src/map3d/regions.ts'
import { estateLayout } from '../../src/map3d/estates.ts'
import { loadCityContent } from '../../src/game/cities/registry.ts'
import { createStreetSource, estimatedTileTriangles } from '../../src/street/generate.ts'
import { decodeImmutableStreetTile, mapPointToMetres, tileOf, tileKey, tileGroundAt, MAX_RAW_TILE_BYTES } from '../../src/street/frame.ts'
import { publishPreparedStages } from './publish.ts'
import type { EstateGateSeed, StreetManifest, StreetPack } from '../../src/street/types.ts'

export async function fullStreetSource(city: string) {
  const pack = await loadCityPack(city), content = await loadCityContent(city)
  if (!pack?.frame) throw Error(`No framed city pack: ${city}`)
  const gates: EstateGateSeed[] = [], supported: { lga: string; count: number }[] = []
  for (const lga of pack.lgas) { const layout = estateLayout(pack, lga.id); supported.push({ lga: lga.id, count: layout?.cells.length ?? 0 }); layout?.cells.forEach((cell, estate) => gates.push({ lga: lga.id, estate, point: mapPointToMetres(pack, cell) })) }
  const venues = content.venues.filter(place => !['home', 'neighbourhood', 'city-street'].includes(place.id)).map(place => place.id)
  const code = await Promise.all(['generate', 'frame'].map(name => readFile(new URL(`../../src/street/${name}.ts`, import.meta.url), 'utf8')))
  const version = `street-v1-${createHash('sha256').update(JSON.stringify({ pack: { id: pack.id, frame: pack.frame, roads: pack.roads, land: pack.land, water: pack.water, inland: pack.inland, sites: pack.sites, fabric: pack.fabric }, gates, venues, estatePortals: true, code })).digest('hex').slice(0, 16)}`
  const source = createStreetSource(pack, { version, venues, gates, roadSource: 'authored', estatePortals: true })
  return { pack, source, supported, gates, venues }
}
/** Local publication preparation only: no provider, upload, deployment or runtime geography. */
export async function prepareStreet(city: string, emit = false) {
  const { pack, source, supported, gates, venues } = await fullStreetSource(city)
  const doorIds = new Set(source.doors.map(door => door.id)), missingGates = gates.filter(seed => !doorIds.has(`estate:${city}:${seed.lga}:${seed.estate}`))
  const plan = { city, version: source.version, sparseTiles: source.tiles.length, supported, gates: gates.length, acceptedGates: gates.length - missingGates.length, venues: venues.length, acceptedVenues: source.doors.filter(door => door.target.kind === 'venue').length, missingGates, issues: source.issues, portals: { count: source.portals?.length ?? 0, crossLga: source.portals?.filter(portal => portal.crossLga) ?? [] }, publication: false }
  if (!emit) return { ...plan, kind: 'plan' as const }
  if (missingGates.length) throw Error(`${city}: ${missingGates.length} supported virtual estate gates are disconnected; refusing incomplete full publication`)
  const out = resolve('evidence/street/prepared-stage', city), evidence = resolve('evidence/street'); await mkdir(out, { recursive: true }); await mkdir(evidence, { recursive: true })
  const manifest: StreetManifest = { v: 1, city, version: source.version, tileSize: 128, quantum: 100, groundCell: 2, mapFrame: pack.frame!, tiles: [], doors: source.doors.map(door => ({ ...door, tile: tileOf(door.approach) })), issues: source.issues }
  let raw = 0, brotli = 0, maxRaw = 0, maxBrotli = 0, maxTriangles = 0, maxPackRaw = 0, maxPackBrotli = 0
  let bundle: StreetPack = { v: 1, city, version: source.version, tiles: [] }
  const packRefs: StreetManifest['tiles'] = [], files = new Set<string>()
  async function flushPack() {
    if (!bundle.tiles.length) return
    const text = JSON.stringify(bundle), size = Buffer.byteLength(text), compressed = brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length, hash = createHash('sha256').update(text).digest('hex'), file = `pack-${hash}.txt`
    if (size > MAX_RAW_TILE_BYTES || compressed > 60000) throw Error('Packed street file exceeds byte limits')
    await writeFile(resolve(out, file), text); files.add(file); for (const ref of packRefs) { ref.file = file; ref.packSha256 = hash; manifest.tiles.push(ref) }
    maxPackRaw = Math.max(maxPackRaw, size); maxPackBrotli = Math.max(maxPackBrotli, compressed); bundle = { v: 1, city, version: source.version, tiles: [] }; packRefs.length = 0
  }
  for (const tile of source.tiles) {
    const wire = source.tile(tile), text = JSON.stringify(wire), rawBytes = Buffer.byteLength(text), brotliBytes = brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length, estimatedTriangles = estimatedTileTriangles(wire)
    const decoded = decodeImmutableStreetTile(wire, { city, version: source.version, tile })
    for (const door of decoded.doors) if (!tileGroundAt(decoded, door.approach)) throw Error(`Door approach is blocked after fabrication: ${door.id}`)
    if (rawBytes > MAX_RAW_TILE_BYTES || brotliBytes > 60000 || estimatedTriangles > 25000) throw Error(`${city} tile ${tile.x}_${tile.z} exceeds byte/triangle caps`)
    const sha256 = createHash('sha256').update(text).digest('hex'), item = { key: tileKey(tile), wire }
    if (bundle.tiles.length >= 4 || Buffer.byteLength(JSON.stringify({ ...bundle, tiles: [...bundle.tiles, item] })) > MAX_RAW_TILE_BYTES) await flushPack()
    bundle.tiles.push(item); packRefs.push({ tile, file: '', rawBytes, brotliBytes, sha256, estimatedTriangles, packKey: item.key })
    raw += rawBytes; brotli += brotliBytes; maxRaw = Math.max(maxRaw, rawBytes); maxBrotli = Math.max(maxBrotli, brotliBytes); maxTriangles = Math.max(maxTriangles, estimatedTriangles)
  }
  await flushPack()
  const text = JSON.stringify(manifest), manifestBytes = Buffer.byteLength(text)
  if (manifestBytes > 4 * 1024 * 1024) throw Error(`${city} manifest exceeds current read-only bridge 4 MiB cap: ${manifestBytes}`)
  await writeFile(resolve(out, `manifest-${source.version}.txt`), text)
  // The complete immutable set is in place before switching the current pointer.
  await writeFile(resolve(out, 'manifest.txt'), text)
  const result = { ...plan, kind: 'prepared' as const, publication: false, localAssetsPrepared: false, staged: true, output: out, emittedTiles: manifest.tiles.length, packs: files.size, raw, brotli, maxRaw, maxBrotli, maxPackRaw, maxPackBrotli, maxEstimatedTriangles: maxTriangles, manifestBytes, files: files.size + 2, provenance: 'Existing authored roads/sites; generated building fabric and virtual-estate portals. Virtual estates are not cadastral parcels.' }
  await writeFile(resolve(evidence, `${city}-prepared.json`), JSON.stringify(result, null, 2)); return result
}

export async function prepareAllStreets() {
  const results = [await prepareStreet('lagos', true), await prepareStreet('ibadan', true)]
  const stages = results.map(stage => { if (stage.kind !== 'prepared') throw Error('Street preparation did not produce a staged set'); return stage })
  const result = await publishPreparedStages(stages)
  await writeFile(resolve('evidence/street/prepared-assets.json'), JSON.stringify(result, null, 2)); return result
}
