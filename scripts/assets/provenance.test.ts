import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PROVENANCE_FILE, groupOf, measure, problems } from './provenance.ts'
import type { ProvenanceRecord, Row } from './provenance.ts'

const committed = (): ProvenanceRecord => JSON.parse(readFileSync(PROVENANCE_FILE, 'utf8')) as ProvenanceRecord

test('files are grouped by folder, name and whether they carry a texture', () => {
  assert.equal(groupOf('vehicles', 'danfo-far.glb', 1), 'vehicle-generated')
  assert.equal(groupOf('vehicles', 'van-blue.glb', 1), 'vehicle-plain')
  assert.equal(groupOf('street', 'bungalow-mint.glb', 1), 'street-atlas')
  assert.equal(groupOf('street', 'detail-dish.glb', 0), 'street-detail')
  assert.equal(groupOf('street', 'palm-far.glb', 1), 'street-tree')
  assert.equal(groupOf('street', 'home-atlas.jpg', 0), 'street-texture')
})

test('every shipped vehicle and street file has a provenance row, measured as the file is', () => {
  assert.deepEqual(problems(committed(), measure()), [], 'run scripts/assets/provenance.ts')
})

test('every group says where its files came from, how we know, what the terms are and what is left to do', () => {
  const record = committed()
  assert.equal(record.licenceId, 'unverified')
  for (const g of record.groups) for (const k of ['origin', 'evidence', 'terms', 'todo'] as const) assert.ok(g[k].length > 20, `${g.id}.${k}`)
  assert.deepEqual(new Set(record.assets.map((a) => a.group)), new Set(record.groups.map((g) => g.id)), 'no group without files, no file without a group')
})

test('a new file, a changed file and a claimed licence are each a problem', () => {
  const record = committed()
  const rows = measure()
  const extra: Row = { ...rows[0]!, path: 'src/models/vehicles/assets/new.glb' }
  assert.match(problems(record, [...rows, extra]).join('\n'), /new\.glb is shipped but has no provenance row/)
  const changed = rows.map((r, i) => (i === 0 ? { ...r, bytes: r.bytes + 1 } : r))
  assert.match(problems(record, changed).join('\n'), /bytes is/)
  const claimed = { ...record, assets: record.assets.map((a, i) => (i === 0 ? { ...a, licence: 'CC0' as never } : a)) }
  assert.match(problems(claimed, rows).join('\n'), /needs a real manifest/)
  assert.match(problems(record, rows.slice(1)).join('\n'), /no longer shipped/)
})
