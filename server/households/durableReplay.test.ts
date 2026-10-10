/**
 * Request replay across ordinary life changes, with receipts in both formats, on the Node file
 * store and on the Worker SQLite store (node:sqlite, not workerd).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeConsentCommand } from './durableService.ts'
import { executeConsentCommand as executeLegacyCommand } from './legacyService.fixture.ts'
import {
  NOW, hostKinds, lifeFactFor, newTracker, onceContext, openHost, people, portsFor, requestId, rowIds, worldCollection, SECRET,
  type Host,
} from './runtimeFixtures.ts'

const register = { op: 'register', householdId: rowIds.household, homeId: rowIds.home, epoch: 1 }
const descriptor = (n = 1) => ({ id: requestId(n), kind: 'ignored', fingerprint: '' })
const run = (host: Host, command: unknown = register, n = 1, tracker = newTracker()) => executeConsentCommand(onceContext(host.store), portsFor(tracker), descriptor(n), command)
const runLegacy = (host: Host, command: unknown = register, n = 1) => executeLegacyCommand(onceContext(host.store), portsFor(newTracker()), descriptor(n), command)

/** Ordinary movement and settlement of the same life: only the mutable facts change. */
const moveActor = (host: Host) => host.store.transact(db => {
  if (!db.households) throw new Error('fixture households missing')
  db.households.lifeFacts[people.owner.life] = lifeFactFor(people.owner, { revision: 2, recordUpdatedAt: NOW + 5, locationRevision: 2, locatorRevision: 2 })
})
const failure = (status: number, code: string) => (error: unknown): boolean =>
  error instanceof Error && Reflect.get(error, 'status') === status && Reflect.get(error, 'code') === code

async function storedResult(host: Host, n = 1): Promise<unknown> {
  return host.store.read(db => {
    const receipt = db.sessions[SECRET]?.once?.[requestId(n)]
    return receipt ? JSON.parse(JSON.stringify(receipt.result)) : undefined
  })
}

for (const kind of hostKinds) {
  const open = () => openHost(kind, worldCollection({ registered: false }))

  test(`A1 ${kind}: a new success replays after the actor moved and settled, byte for byte`, async () => {
    const host = await open()
    try {
      const first = await run(host)
      assert.equal(first.ok && first.duplicate, false)
      assert.deepEqual(await storedResult(host), { ok: true, operation: 'register', householdId: rowIds.household, actorCharacterId: people.owner.character, actorLifeId: people.owner.life, receiptVersion: 2 })
      await moveActor(host)
      const receipts = await host.receipts(), households = await host.households()
      const tracker = newTracker()
      const replay = await run(host, register, 1, tracker)
      assert.ok(replay.ok && replay.duplicate && replay.events.length === 0)
      assert.deepEqual(replay.ok && replay.receipt, first.ok && first.receipt)
      assert.equal(tracker.homeReads, 0, 'a replay loads no household facts')
      assert.equal(await host.receipts(), receipts)
      assert.equal(await host.households(), households)
    } finally { await host.cleanup() }
  })

  test(`A1 ${kind}: cold reopen, then replay, before and after the actor moved`, async () => {
    const host = await open()
    try {
      await run(host)
      await host.reopen()
      const again = await run(host)
      assert.ok(again.ok && again.duplicate)
      await moveActor(host)
      await host.reopen()
      const moved = await run(host)
      assert.ok(moved.ok && moved.duplicate)
    } finally { await host.cleanup() }
  })

  test(`A1 ${kind}: the same id with a different request conflicts and changes nothing`, async () => {
    const host = await open()
    try {
      await run(host)
      const receipts = await host.receipts(), households = await host.households()
      await assert.rejects(run(host, { ...register, epoch: 2 }), failure(409, 'client_id_conflict'))
      await assert.rejects(run(host, { op: 'close', householdId: rowIds.household, revision: 0, epoch: 1, reason: 'owner_closed' }), failure(409, 'client_id_conflict'))
      await assert.rejects(run(host, { ...register, homeId: rowIds.newInvite }), failure(409, 'client_id_conflict'))
      assert.equal(await host.receipts(), receipts)
      assert.equal(await host.households(), households)
    } finally { await host.cleanup() }
  })

  test(`A1 ${kind}: an old-format receipt with unchanged facts replays unchanged, also after reopen`, async () => {
    const host = await open()
    try {
      const made = await runLegacy(host)
      assert.ok(made.ok && !made.duplicate)
      assert.deepEqual(await storedResult(host), { ok: true, operation: 'register', householdId: rowIds.household, actorCharacterId: people.owner.character, actorLifeId: people.owner.life })
      const receipts = await host.receipts(), households = await host.households()
      const replay = await run(host)
      assert.ok(replay.ok && replay.duplicate && replay.events.length === 0)
      await host.reopen()
      assert.ok((await run(host)).ok)
      assert.equal(await host.receipts(), receipts, 'the old receipt is never rewritten or migrated')
      assert.equal(await host.households(), households)
    } finally { await host.cleanup() }
  })

  test(`A1 ${kind}: an old-format receipt whose facts changed fails closed and stays intact`, async () => {
    const host = await open()
    try {
      await runLegacy(host)
      await moveActor(host)
      const receipts = await host.receipts(), households = await host.households()
      // The old service itself shows the defect: it refuses its own success after the move.
      await assert.rejects(runLegacy(host), failure(409, 'client_id_conflict'))
      await assert.rejects(run(host), failure(409, 'client_id_conflict'))
      await host.reopen()
      await assert.rejects(run(host), failure(409, 'client_id_conflict'))
      assert.equal(await host.receipts(), receipts, 'no migration, deletion or rewrite')
      assert.equal(await host.households(), households)
      // A different request under the old receipt's id is refused as well.
      await assert.rejects(run(host, { ...register, epoch: 2 }), failure(409, 'client_id_conflict'))
      assert.equal(await host.receipts(), receipts)
    } finally { await host.cleanup() }
  })

  test(`A1 ${kind}: an old-format receipt does not answer a changed request`, async () => {
    const host = await open()
    try {
      await runLegacy(host)
      const receipts = await host.receipts()
      await assert.rejects(run(host, { ...register, epoch: 2 }), failure(409, 'client_id_conflict'))
      await assert.rejects(run(host, { ...register, homeId: rowIds.newInvite }), failure(409, 'client_id_conflict'))
      assert.equal(await host.receipts(), receipts)
    } finally { await host.cleanup() }
  })

  test(`A1 ${kind}: a storage error during either probe, or the write, refuses and writes nothing`, async () => {
    const host = await open()
    try {
      await runLegacy(host)
      await moveActor(host)
      const receipts = await host.receipts(), households = await host.households()
      const faulty = (failAt: number) => {
        const base = onceContext(host.store)
        let calls = 0
        return { ctx: { ...base, once: ((...args: Parameters<typeof base.once>) => { calls += 1; if (calls === failAt) throw new Error('injected probe fault'); return base.once(...args) }) as typeof base.once }, calls: () => calls }
      }
      const second = faulty(2)
      await assert.rejects(executeConsentCommand(second.ctx, portsFor(newTracker()), descriptor(), register), /injected probe fault/)
      assert.equal(second.calls(), 2, 'the stable probe conflicted, the legacy probe faulted')
      const first = faulty(1)
      await assert.rejects(executeConsentCommand(first.ctx, portsFor(newTracker()), descriptor(), register), /injected probe fault/)
      assert.equal(first.calls(), 1, 'a fault in the stable probe never reaches the legacy probe')
      assert.equal(await host.receipts(), receipts)
      assert.equal(await host.households(), households)
    } finally { await host.cleanup() }
    // A new request whose receipt write faults leaves neither household nor receipt.
    const fresh = await open()
    try {
      const receipts = await fresh.receipts(), households = await fresh.households()
      const base = onceContext(fresh.store)
      let calls = 0
      const ctx = { ...base, once: ((...args: Parameters<typeof base.once>) => { calls += 1; if (calls === 2) throw new Error('injected write fault'); return base.once(...args) }) as typeof base.once }
      await assert.rejects(executeConsentCommand(ctx, portsFor(newTracker()), descriptor(), register), /injected write fault/)
      assert.equal(calls, 2)
      assert.equal(await fresh.receipts(), receipts)
      assert.equal(await fresh.households(), households)
      assert.ok((await run(fresh)).ok, 'the same request can still be made afterwards')
    } finally { await fresh.cleanup() }
  })

  test(`A1 ${kind}: unknown receipt versions and malformed receipts refuse without fallback`, async () => {
    const host = await open()
    try {
      await run(host)
      const tamper = (change: (result: Record<string, unknown>) => void) => host.store.transact(db => {
        const receipt = db.sessions[SECRET]?.once?.[requestId()]
        if (!receipt || typeof receipt.result !== 'object' || receipt.result === null) throw new Error('fixture receipt missing')
        const copy: Record<string, unknown> = { ...receipt.result }
        change(copy)
        receipt.result = copy
      })
      await tamper(result => { result['receiptVersion'] = 3 })
      const unknown = await host.receipts()
      const refused = await run(host)
      assert.deepEqual(refused, { ok: false, code: 'receipt_version_unsupported' })
      await tamper(result => { delete result['operation'] })
      assert.deepEqual(await run(host), { ok: false, code: 'receipt_authority_mismatch' })
      assert.notEqual(await host.receipts(), unknown, 'only the explicit tamper changed the bytes')
    } finally { await host.cleanup() }
  })
}
