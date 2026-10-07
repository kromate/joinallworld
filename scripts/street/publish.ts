import { readFile, readdir, mkdir, copyFile, writeFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { parseStreetManifest } from '../../server/street/assets.ts'
import type { ParsedStreetManifest } from '../../server/street/assets.ts'
export interface PreparedStreetStage { city: string; output: string; packs: number; emittedTiles: number; manifestBytes: number; maxPackRaw: number; maxPackBrotli: number }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const versionOk = (value: unknown): value is string => typeof value === 'string' && /^street-v1-[a-z0-9_-]{1,100}$/.test(value)
export async function fileCount(path: string): Promise<number> { try { const entries = await readdir(path, { withFileTypes: true }); let count = 0; for (const entry of entries) count += entry.isDirectory() ? await fileCount(resolve(path, entry.name)) : 1; return count } catch (error) { if (object(error) && error.code === 'ENOENT') return 0; throw error } }
async function optionalManifest(path: string, city: string): Promise<ParsedStreetManifest | null> { try { return parseStreetManifest(JSON.parse(await readFile(path, 'utf8')), city) } catch (error) { if (object(error) && error.code === 'ENOENT') return null; throw error } }
async function atomicText(out: string, target: string, text: string) { const temporary = resolve(out, `manifest-pending-${randomUUID()}.txt`); try { await writeFile(temporary, text); await rename(temporary, resolve(out, target)) } finally { await unlink(temporary).catch(error => { if (!object(error) || error.code !== 'ENOENT') throw error }) } }
/** Local files only. All immutable data is complete before the current pointer switches. */
export async function publishPreparedStages(stages: PreparedStreetStage[], { publicRoot = resolve('public'), distRoot = resolve('dist') }: { publicRoot?: string; distRoot?: string } = {}) {
  const plans: { stage: PreparedStreetStage; out: string; files: Set<string>; version: string; previous: string | null }[] = []
  let oldStreetFiles = 0, futureStreetFiles = 0
  for (const stage of stages) {
    const out = resolve(publicRoot, 'assets/street', stage.city), manifest = parseStreetManifest(JSON.parse(await readFile(resolve(stage.output, 'manifest.txt'), 'utf8')), stage.city), current = await optionalManifest(resolve(out, 'manifest.txt'), stage.city)
    let previous = current && current.version !== manifest.version ? current : null
    if (current?.version === manifest.version) {
      try { const retention: unknown = JSON.parse(await readFile(resolve(out, 'retained.txt'), 'utf8')); if (object(retention) && retention.city === stage.city && retention.current === current.version && versionOk(retention.previous)) previous = await optionalManifest(resolve(out, `manifest-${retention.previous}.txt`), stage.city) } catch (error) { if (!object(error) || error.code !== 'ENOENT') throw error }
    }
    const files = new Set(['manifest.txt', 'retained.txt', `manifest-${manifest.version}.txt`, ...[...manifest.tiles.values()].map(entry => entry.file)])
    if (previous) { files.add(`manifest-${previous.version}.txt`); for (const entry of previous.tiles.values()) files.add(entry.file) }
    oldStreetFiles += await fileCount(out); futureStreetFiles += files.size; plans.push({ stage, out, files, version: manifest.version, previous: previous?.version ?? null })
  }
  const countedAppFiles = await fileCount(publicRoot) - oldStreetFiles + await fileCount(distRoot) - await fileCount(resolve(distRoot, 'assets/street')), worstRetainedStreetFiles = stages.reduce((sum, stage) => sum + 2 * (stage.packs + 1) + 2, 0)
  if (Math.max(futureStreetFiles, worstRetainedStreetFiles) + countedAppFiles >= 20000) throw Error('Prepared streets plus app and retained-version headroom exceed the 20,000 file ceiling')
  for (const plan of plans) {
    await mkdir(plan.out, { recursive: true })
    for (const file of await readdir(plan.stage.output)) if (file !== 'manifest.txt' && plan.files.has(file)) await copyFile(resolve(plan.stage.output, file), resolve(plan.out, file))
    // Retry of an already-current version keeps the previous version recorded below.
    await atomicText(plan.out, 'retained.txt', JSON.stringify({ v: 1, city: plan.stage.city, current: plan.version, previous: plan.previous }))
    await atomicText(plan.out, 'manifest.txt', await readFile(resolve(plan.stage.output, 'manifest.txt'), 'utf8'))
    for (const file of await readdir(plan.out)) if (/^(?:pack|tile)-[a-f0-9]{64}\.txt$/.test(file) || /^manifest-street-v1-[a-z0-9_-]+\.txt$/.test(file)) { if (!plan.files.has(file)) await unlink(resolve(plan.out, file)) }
  }
  return { localAssetsPrepared: true, published: false, cities: stages.map(stage => ({ city: stage.city, logicalTiles: stage.emittedTiles, packs: stage.packs, manifestBytes: stage.manifestBytes, maxPackRaw: stage.maxPackRaw, maxPackBrotli: stage.maxPackBrotli })), currentAndActualRetainedFiles: futureStreetFiles, worstTwoVersionStreetFiles: worstRetainedStreetFiles, conservativelyCountedAppFiles: countedAppFiles, maximumTotalFiles: worstRetainedStreetFiles + countedAppFiles, limit: 20000 }
}
