/**
 * Runtime diagnostics for the consent loader: the real loader and the real reducer, reading
 * persisted household state through the durable same-transaction readers of two real stores
 * (the Node file store and the Worker SQLite store over node:sqlite; not workerd).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceConsent } from './consent.ts'
import { createDurableConsentReads } from './durableReads.ts'
import {
  NOW, hostKinds, loaderUnderTest, newTracker, openHost, people, pairFactFor, pairKeyOf, rowIds, trustedFor, worldCollection,
  type Host, type SystemSpec, type WorldOptions,
} from './runtimeFixtures.ts'
import type { Identity } from './records.ts'

const base = { householdId: rowIds.household, revision: 3, epoch: 1 }
type Case = Readonly<{ name: string; command: unknown; actor: Identity; world?: WorldOptions; system?: SystemSpec; pairQueried: boolean }>
const cases: readonly Case[] = [
  { name: 'register', command: { op: 'register', householdId: rowIds.household, homeId: rowIds.home, epoch: 1 }, actor: people.owner, world: { registered: false }, pairQueried: false },
  { name: 'invite', command: { ...base, op: 'invite', inviteId: rowIds.newInvite, recipient: people.stranger }, actor: people.owner, pairQueried: true },
  { name: 'accept', command: { ...base, op: 'accept', inviteId: rowIds.pendingInvite, membershipId: rowIds.newMembership }, actor: people.invitee, pairQueried: true },
  { name: 'decline', command: { ...base, op: 'decline', inviteId: rowIds.pendingInvite }, actor: people.invitee, pairQueried: false },
  { name: 'cancel', command: { ...base, op: 'cancel', inviteId: rowIds.pendingInvite }, actor: people.owner, pairQueried: false },
  { name: 'expire', command: { ...base, op: 'expire', inviteId: rowIds.pendingInvite }, actor: people.owner, world: { pendingCreatedAt: NOW - 604_800_000 - 5000 }, system: { kind: 'system', subject: people.owner, cause: 'home_retired', evidence: 'home' }, pairQueried: false },
  { name: 'terminate-invitation', command: { ...base, op: 'terminate-invitation', inviteId: rowIds.pendingInvite }, actor: people.owner, system: { kind: 'system', subject: people.invitee, cause: 'blocked', evidence: 'pair' }, pairQueried: false },
  { name: 'leave', command: { ...base, op: 'leave', membershipId: rowIds.membership, memberRevision: 0 }, actor: people.member, pairQueried: false },
  { name: 'revoke', command: { ...base, op: 'revoke', membershipId: rowIds.membership, memberRevision: 0 }, actor: people.owner, pairQueried: false },
  { name: 'terminate', command: { ...base, op: 'terminate', membershipId: rowIds.membership, memberRevision: 0 }, actor: people.owner, system: { kind: 'system', subject: people.member, cause: 'blocked', evidence: 'pair' }, pairQueried: false },
  { name: 'close', command: { ...base, op: 'close', reason: 'owner_closed' }, actor: people.owner, pairQueried: false },
]

async function run(host: Host, command: unknown, actor: Identity, options: { system?: SystemSpec; pairNotLoaded?: boolean } = {}) {
  const tracker = newTracker()
  const load = await loaderUnderTest()
  return host.store.transact(async db => {
    const trusted = trustedFor(db, actor, tracker, options)
    const proof = await trusted.sessionLife()
    const reads = createDurableConsentReads(db, NOW, trusted, proof)
    const loaded = await load(command, reads.transaction)
    return { loaded, result: loaded.ok ? reduceConsent(loaded.command, loaded.view) : undefined, readSet: reads.verifyReadSet(), tracker }
  })
}

for (const kind of hostKinds) {
  test(`INT-001 ${kind}: every operation loads the owner index and the reducer accepts the loaded view`, async t => {
    const problems: string[] = []
    for (const item of cases) {
      const host = await openHost(kind, worldCollection(item.world))
      try {
        const out = await run(host, item.command, item.actor, { system: item.system })
        if (!out.loaded.ok) { problems.push(`${item.name}: load refused ${out.loaded.code}`); continue }
        if (!out.result?.ok) problems.push(`${item.name}: reducer refused ${out.result && !out.result.ok ? out.result.code : 'nothing'}`)
        const owner = out.loaded.view.characters.find(row => row.id === people.owner.character)
        if (owner?.point.state !== (item.name === 'register' ? 'absent' : 'present')) problems.push(`${item.name}: owner index not read from the store`)
        if (!out.readSet) problems.push(`${item.name}: read set not verifiable`)
      } finally { await host.cleanup() }
    }
    assert.deepEqual(problems, [])
    t.diagnostic(`${kind}: ${cases.length} operations`)
  })

  test(`INT-021 ${kind}: an accepted invitation must come back under the id the member names, and is read-protected`, async () => {
    // Correct form: member.inviteId is the key and the id of the accepted row.
    const good = await openHost(kind, worldCollection())
    try {
      const out = await run(good, cases[1]!.command, people.owner)
      assert.equal(out.loaded.ok, true)
    } finally { await good.cleanup() }

    // Mismatched form: the row stored under the member's invite id carries another id but is otherwise consistent.
    const crooked = worldCollection()
    const stored = crooked.invites[rowIds.acceptedInvite]
    assert.ok(stored && typeof stored === 'object')
    crooked.invites[rowIds.acceptedInvite] = { ...stored, id: rowIds.otherKeyInvite }
    const bad = await openHost(kind, crooked)
    try {
      for (const item of cases.filter(c => ['invite', 'accept', 'close', 'leave', 'revoke', 'terminate'].includes(c.name))) {
        const out = await run(bad, item.command, item.actor, { system: item.system })
        assert.equal(out.loaded.ok, false, `${item.name} must refuse a key/id mismatched accepted invitation`)
        if (!out.loaded.ok) assert.equal(out.loaded.code, 'member_invite_crosslink_mismatch')
      }
    } finally { await bad.cleanup() }

    // The supporting accepted-invitation read is part of the transaction read set.
    const guarded = await openHost(kind, worldCollection())
    try {
      const tracker = newTracker()
      const load = await loaderUnderTest()
      const outcome = await guarded.store.transact(async db => {
        const trusted = trustedFor(db, people.owner, tracker)
        const reads = createDurableConsentReads(db, NOW, trusted, await trusted.sessionLife())
        const loaded = await load(cases[1]!.command, reads.transaction)
        const before = reads.verifyReadSet()
        const row = db.households?.invites[rowIds.acceptedInvite]
        if (!row || typeof row !== 'object') throw new Error('fixture invite missing')
        db.households!.invites[rowIds.acceptedInvite] = { ...row, revision: 2 }
        const after = reads.verifyReadSet()
        // Roll the probe write back: nothing from this check may persist.
        throw Object.assign(new Error('probe-rollback'), { loaded: loaded.ok, before, after })
      }).catch((error: unknown) => error)
      assert.ok(outcome instanceof Error && outcome.message === 'probe-rollback')
      assert.equal(Reflect.get(outcome, 'loaded'), true)
      assert.equal(Reflect.get(outcome, 'before'), true)
      assert.equal(Reflect.get(outcome, 'after'), false, 'changing the accepted invitation must invalidate the read set')
      const revision = await guarded.store.read(db => {
        const row = db.households?.invites[rowIds.acceptedInvite]
        return row && typeof row === 'object' ? Reflect.get(row, 'revision') : undefined
      })
      assert.equal(revision, 1)
    } finally { await guarded.cleanup() }
  })

  test(`INT-022 ${kind}: unqueried pair facts are not-loaded; absence only from a real keyed lookup`, async () => {
    for (const item of cases) {
      if (item.pairQueried) continue
      const host = await openHost(kind, worldCollection(item.world))
      try {
        const out = await run(host, item.command, item.actor, { system: item.system })
        assert.equal(out.loaded.ok, true, item.name)
        if (!out.loaded.ok) continue
        const authority = out.loaded.view.authority
        if (authority.kind === 'actor') assert.equal(authority.pair.state, 'not-loaded', `${item.name}: pair was never queried`)
        assert.equal(out.tracker.pairReads, 0, `${item.name}: no pair read is needed`)
      } finally { await host.cleanup() }
    }
    // A pair that was queried and found missing is absent, and the reducer then refuses the friendship-gated operation.
    const missing = await openHost(kind, worldCollection({ pairs: { invitee: 'unqueried-absent' } }))
    try {
      const out = await run(missing, cases[2]!.command, people.invitee)
      assert.equal(out.loaded.ok, true)
      if (out.loaded.ok && out.loaded.view.authority.kind === 'actor') assert.equal(out.loaded.view.authority.pair.state, 'absent')
      assert.equal(out.tracker.pairReads, 1)
      assert.equal(out.result && !out.result.ok ? out.result.code : 'accepted', 'not_authorized')
    } finally { await missing.cleanup() }
    // A pair row that exists is present and carries the stored flags; a block is not friendship.
    const blocked = await openHost(kind, worldCollection({ pairs: { invitee: 'blocked' } }))
    try {
      const out = await run(blocked, cases[2]!.command, people.invitee)
      assert.equal(out.loaded.ok, true)
      if (out.loaded.ok && out.loaded.view.authority.kind === 'actor' && out.loaded.view.authority.pair.state === 'present') assert.equal(out.loaded.view.authority.pair.value.blocked, true)
      else assert.fail('pair should be present')
      assert.equal(out.result && !out.result.ok ? out.result.code : 'accepted', 'not_authorized')
    } finally { await blocked.cleanup() }
    // A trusted reader that could not tell is never turned into absence.
    const unknown = await openHost(kind, worldCollection())
    try {
      const out = await run(unknown, cases[1]!.command, people.owner, { pairNotLoaded: true })
      assert.equal(out.loaded.ok, false)
      if (!out.loaded.ok) assert.equal(out.loaded.code, 'relationship_read_invalid')
    } finally { await unknown.cleanup() }
    assert.equal(pairKeyOf(people.owner, people.invitee), pairKeyOf(people.invitee, people.owner))
    assert.ok(pairFactFor(people.owner, people.invitee, { friends: true, blocked: false }).friends)
  })
}
