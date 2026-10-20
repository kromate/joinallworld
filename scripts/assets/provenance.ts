// Provenance for the shipped models and textures that did not come through the pack pipeline (fetch-pack.ts, prepare.ts) and that
// no other page in the repository accounts for: the vehicle models and the street set. The record is
// scripts/assets/provenance/meshy.json, in the shape of a pack manifest (docs/ASSET-PIPELINE.md, "The manifest") with the licence
// word `unverified` where the terms have not been read, and a `groups` list that says what is known about each kind of file.
//
//   node --experimental-strip-types scripts/assets/provenance.ts [--check]    (no flag: rewrite the file lists and measurements)
//
// `groups` is written by hand; `assets` (bytes, triangles, SHA-256) is measured from the files, so the check fails when a file
// is added, removed or changed without its record. It is a separate folder from manifests/ on purpose: budget.ts and credits.ts
// read every manifest there as a CC0, CC BY or own pack, and these files are none of those yet. When a group's terms are read and
// are CC0, CC BY or ours, its files move to a real manifest and the credits list them.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glbImages, glbJson, trianglesOf } from './glb.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PROVENANCE_FILE = join(repo, 'scripts', 'assets', 'provenance', 'meshy.json')

export type GroupId = 'vehicle-generated' | 'vehicle-plain' | 'street-atlas' | 'street-detail' | 'street-tree' | 'street-texture'

/** The folders this record covers, and the group of each file in them. Pure: a file's name and what it holds decide. */
export function groupOf(dir: 'vehicles' | 'street', name: string, images: number): GroupId {
  if (dir === 'vehicles') return /^(pickup|van)-/.test(name) ? 'vehicle-plain' : 'vehicle-generated'
  if (name === 'home-atlas.jpg') return 'street-texture'
  if (name === 'palm-far.glb') return 'street-tree'
  return images === 0 ? 'street-detail' : 'street-atlas'
}
const FOLDERS = { vehicles: 'src/models/vehicles/assets', street: 'src/scene/street/assets' } as const

export interface Group { id: GroupId; origin: string; evidence: string; terms: string; todo: string }
export interface Row { path: string; licence: 'unverified' | 'owned (Meshy paid output)'; group: GroupId; kind: 'vehicle' | 'prop' | 'texture'; bytes: number; triangles?: number; sha256: string }
export interface ProvenanceRecord { format: 1; pack: 'meshy'; name: string; kind: 'generated'; page: string; author: string; licenceId: 'unverified'; fetched: string; groups: Group[]; assets: Row[] }

/** Measure every file of the two folders. */
export function measure(root = repo): Row[] {
  const rows: Row[] = []
  for (const dir of ['vehicles', 'street'] as const) {
    const folder = join(root, FOLDERS[dir])
    for (const name of readdirSync(folder).filter((n) => /\.(glb|jpg)$/.test(n)).sort()) {
      const bytes = readFileSync(join(folder, name))
      const model = name.endsWith('.glb')
      const json = model ? glbJson(bytes) : null
      const group = groupOf(dir, name, model ? glbImages(bytes).length : 0)
      rows.push({
        path: `${FOLDERS[dir]}/${name}`, licence: 'unverified', group, kind: !model ? 'texture' : dir === 'vehicles' ? 'vehicle' : 'prop',
        bytes: bytes.length, ...(json ? { triangles: trianglesOf(json) } : {}), sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
  }
  return rows
}

/** Problems with a record against the files, as plain sentences (empty when it is right). */
export function problems(record: ProvenanceRecord, measured: readonly Row[]): string[] {
  const out: string[] = []
  const ids = new Set(record.groups.map((g) => g.id))
  const groupsById = new Map(record.groups.map((g) => [g.id, g]))
  for (const g of record.groups) for (const k of ['origin', 'evidence', 'terms', 'todo'] as const) if (!g[k]) out.push(`group ${g.id} has no ${k}`)
  const have = new Map(record.assets.map((a) => [a.path, a]))
  for (const m of measured) {
    const a = have.get(m.path)
    if (!a) { out.push(`${m.path} is shipped but has no provenance row`); continue }
    if (!ids.has(a.group)) out.push(`${m.path}: group ${a.group} is not described`)
    // 'owned (Meshy paid output)' is the one other value: the owner confirmed on 20 Oct 2026 that the account was paid, so the generated files are
    // Allworld's with no credit owed (the group's terms say so). Anything else needs a real manifest (docs/ASSET-PIPELINE.md), not this record.
    if (a.licence !== 'unverified' && !(a.licence === 'owned (Meshy paid output)' && groupsById.get(a.group)?.terms.startsWith('Owned by Allworld'))) out.push(`${m.path}: licence ${a.licence} needs a real manifest (docs/ASSET-PIPELINE.md), not this record`)
    for (const k of ['group', 'bytes', 'triangles', 'sha256'] as const) if (a[k] !== m[k]) out.push(`${m.path}: ${k} is ${String(a[k])}, the file has ${String(m[k])}`)
  }
  const real = new Set(measured.map((m) => m.path))
  for (const a of record.assets) if (!real.has(a.path)) out.push(`${a.path} has a provenance row but is no longer shipped`)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const record = JSON.parse(readFileSync(PROVENANCE_FILE, 'utf8')) as ProvenanceRecord
  const rows = measure()
  if (process.argv.includes('--check')) {
    const bad = problems(record, rows)
    for (const p of bad) console.error(`PROBLEM ${p}`)
    if (bad.length) process.exit(1)
    console.log(`provenance: ${rows.length} files recorded`)
  } else {
    writeFileSync(PROVENANCE_FILE, `${JSON.stringify({ ...record, assets: rows }, null, 2)}\n`)
    console.log(`provenance: ${rows.length} rows written; read the group notes before committing`)
  }
}
