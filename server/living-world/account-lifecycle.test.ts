// HTTP account lifecycle coverage for living-world privacy continuity.
// All identities are fake-provider fixtures; no real provider or account data is used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, snapshot } from '../test-fixture.ts'
import { fakeProvider, makeKey, claimsFor, signToken } from '../accounts/test-tokens.ts'
import type { FixtureOptions } from '../test-fixture.ts'
import type { Look } from '../../src/types/life.ts'
import { PROGRAMMES } from '../../src/campus/unilag/curriculum.ts'
import type { AssessmentResponse } from '../../src/types/living-world-assessment.ts'

const PROJECT = 'allworld-test-project'
const ENV = {
  ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
  ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000',
  ACCOUNTS_GOOGLE_CLIENT_ID: '1234567890-testclient.apps.googleusercontent.com',
}
const BARBER = '/api/living-world/barber'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Json = Record<string, unknown>
type Guest = { cookie: string; id: string; name: string }
type AccountHarness = Awaited<ReturnType<typeof accountHarness>>
type LivingWorldView = { version: 1; actors: Array<Record<string, unknown>> }

async function accountHarness(t: Parameters<typeof fixture>[0], options: FixtureOptions = {}) {
  const key = await makeKey('account-lifecycle-test-key')
  const provider = fakeProvider([key])
  const f = await fixture(t, {
    env: ENV,
    fetch: (url, init) => provider.fetch(url, init as { body?: unknown }),
    ...options,
  })
  const call = (path: string, body?: unknown, cookie?: string | null): Promise<Response> => fetch(f.base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: f.base,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let minted = 0
  const token = (subject: string): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), {
    subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted,
  }))
  const state = async (cookie: string) => await (await call('/api/account', undefined, cookie)).json() as { csrf: string | null }
  const change = async (path: string, body: Json, cookie: string): Promise<Response> => call(path, { ...body, csrf: (await state(cookie)).csrf }, cookie)
  const proved = async (path: string, body: Json, cookie: string, subject: string): Promise<Response> =>
    change(path, { ...body, idToken: await token(subject) }, cookie)
  async function guest(name: string): Promise<Guest> {
    const created = await f.request('/api/session', { name, onboarding: true })
    assert.equal(created.status, 200)
    const body = await created.json() as { session?: { id?: string } }
    const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const id = body.session?.id ?? ''
    assert.ok(cookie && id)
    await f.request('/api/life?city=lagos', null, cookie)
    const action = await f.action(cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })
    assert.equal(action.code, 'playing')
    return { cookie, id, name }
  }
  async function signIn(subject: string, cookie: string) {
    const response = await change('/api/account/sign-in', { idToken: await token(subject) }, cookie)
    return {
      status: response.status,
      body: await response.json() as Json & { error?: string; outcome?: string; character?: { id: string; name: string }; parked?: { id: string } | null },
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    }
  }
  const stored = async () => {
    await f.flush()
    return JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as Json
  }
  const barberRow = async (publicId: string): Promise<Record<string, unknown> | null> => f.server.store.read(db => {
    const root = (db as unknown as { livingWorld?: { barber?: Record<string, unknown> } }).livingWorld
    const row = root?.barber?.[publicId]
    return row === undefined ? null : snapshot(row as Record<string, unknown>)
  })
  return { f, provider, call, token, state, change, proved, guest, signIn, stored, barberRow }
}

async function startPausedBarber(a: AccountHarness, guest: Guest): Promise<Record<string, unknown>> {
  const startResponse = await a.f.request(`${BARBER}/start`, {
    cityId: 'lagos', lessonId: 'basic', requestId: a.f.id(),
  }, guest.cookie)
  const started = await startResponse.json() as { ok: boolean; session?: { sessionId: string; revision: number; nextSequence: number }; error?: string }
  assert.equal(started.ok, true, started.error)
  assert.ok(started.session)
  a.f.advance(100)
  const inputResponse = await a.f.request(`${BARBER}/input`, {
    cityId: 'lagos', sessionId: started.session.sessionId, revision: started.session.revision,
    sequence: started.session.nextSequence, frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }],
  }, guest.cookie)
  const input = await inputResponse.json() as { ok: boolean; session?: { sessionId: string; revision: number; practice: unknown }; error?: string }
  assert.equal(input.ok, true, input.error)
  assert.ok(input.session)
  const pauseResponse = await a.f.request(`${BARBER}/pause`, {
    cityId: 'lagos', sessionId: input.session.sessionId, revision: input.session.revision, requestId: a.f.id(),
  }, guest.cookie)
  const paused = await pauseResponse.json() as { ok: boolean; session?: { status: string }; error?: string }
  assert.equal(paused.ok, true, paused.error)
  assert.equal(paused.session?.status, 'paused')
  const row = await a.barberRow(guest.id)
  assert.ok(row)
  return row
}

function omitAccount(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value)
  delete copy.account
  return copy
}
function cookieValue(cookie: string): string {
  const equals = cookie.indexOf('=')
  return equals < 0 ? cookie : cookie.slice(equals + 1).split(';')[0] ?? ''
}
function accountIdFromStored(db: Json): string {
  const accounts = db.accounts as Record<string, { id: string }> | undefined
  const account = Object.values(accounts ?? {})[0]
  assert.ok(account?.id)
  return account.id
}
test('justice training receipts survive guest adoption and keep-as-guest deletion without leaking answers', async t => {
  const a = await accountHarness(t), guest = await a.guest('Justice trainee')
  const path = '/api/living-world/justice-practice'
  const begun = await (await a.f.request(path + '/start', { cityId: 'lagos', requestId: a.f.id() }, guest.cookie)).json() as { ok: boolean; revision: number }
  assert.equal(begun.ok, true)
  const input = await (await a.f.request(path + '/step', { cityId: 'lagos', requestId: a.f.id(), expectedRevision: begun.revision,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy' } }, guest.cookie)).json() as { ok: boolean; revision: number }
  assert.equal(input.ok, true)
  const readRow = () => a.f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, Record<string, unknown>> }).justicePractice[guest.id]!))
  const before = await readRow()
  const linked = await a.signIn('UidJustice', guest.cookie)
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.character?.id], [200, 'linked', guest.id])
  const adopted = await readRow()
  assert.equal(adopted.account, accountIdFromStored(await a.stored()))
  assert.deepEqual(omitAccount(adopted), omitAccount(before))
  const exported = await a.proved('/api/account/export', {}, linked.cookie, 'UidJustice')
  assert.equal(exported.status, 200)
  const summary = await exported.json() as { livingWorld: { actors: { justicePractice: unknown }[] } }
  assert.deepEqual(summary.livingWorld.actors[0]?.justicePractice, { status: 'present', progress: { scenarioVersion: 1,
    phase: 'inspect-initial', revision: 1, trainingComplete: false, updatedAt: before.updatedAt } })
  assert.doesNotMatch(JSON.stringify(summary.livingWorld), /dispatch-copy|reasonEvidenceIds|requestId|receipts/)
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, linked.cookie, 'UidJustice')
  assert.equal(deleted.status, 200)
  const guestCookie = deleted.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.ok(guestCookie)
  assert.deepEqual(await readRow(), before)
  const current = await (await a.f.request(path + '?city=lagos', null, guestCookie)).json() as { ok: boolean; revision: number }
  assert.deepEqual([current.ok, current.revision], [true, 1])
})

test('registered logic-lab progress survives account adoption and keep-as-guest deletion without exposing answers', async t => {
  const a = await accountHarness(t), guest = await a.guest('Logic learner')
  assert.equal((await a.f.action(guest.cookie, { type: 'onboarding.traits', payload: { traits: ['musical', 'clean-pikin'] } })).code, 'traits_saved')
  assert.equal((await a.f.action(guest.cookie, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } })).code, 'dream_saved')
  assert.equal((await a.f.action(guest.cookie, { type: 'onboarding.lottery' })).code, 'rolled')
  assert.equal((await a.f.action(guest.cookie, { type: 'onboarding.home', payload: { lga: 'ikeja', stay: true } })).code, 'life_started')
  // Position/eligibility only: all enrollment and lab progress use production HTTP actions.
  await a.f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === guest.id)
    assert.ok(session?.cities.lagos)
    const life = session.cities.lagos.state
    life.location = 'unilag'; life.spot = 'senate'; life.skills.coding = Math.max(life.skills.coding, 100)
  })
  assert.equal((await a.f.action(guest.cookie, { type: 'unilag.apply', payload: { programme: 'computer' } })).code, 'admitted')
  assert.equal((await a.f.action(guest.cookie, { type: 'unilag.matriculate' })).code, 'matriculated')
  const courses = PROGRAMMES.computer.semesters[0]!.courses.map(course => course.id)
  assert.equal((await a.f.action(guest.cookie, { type: 'unilag.register-semester', payload: { courses } })).code, 'registered')
  assert.equal((await a.f.action(guest.cookie, { type: 'spot', payload: { id: PROGRAMMES.computer.spot } })).code, 'selected')
  const path = '/api/living-world/assessment'
  const begun = await (await a.f.request(path + '/start', { cityId: 'lagos', requestId: a.f.id() }, guest.cookie)).json() as AssessmentResponse
  assert.equal(begun.ok, true)
  const input = await (await a.f.request(path + '/step', { cityId: 'lagos', requestId: a.f.id(), expectedRevision: begun.revision,
    operation: { kind: 'probe', a: false, b: true } }, guest.cookie)).json() as AssessmentResponse
  assert.deepEqual([input.ok, input.revision, input.assignmentMark], [true, 2, null])
  const readRow = () => a.f.server.store.read(db => snapshot((db.livingWorld as { assessments: Record<string, Record<string, unknown>> }).assessments[guest.id]!))
  const before = await readRow()
  const linked = await a.signIn('UidLogic', guest.cookie)
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.character?.id], [200, 'linked', guest.id])
  const adopted = await readRow()
  assert.equal(adopted.account, accountIdFromStored(await a.stored()))
  assert.deepEqual(omitAccount(adopted), omitAccount(before), 'same-character adoption changes only the bound owner')
  const current = await (await a.f.request(path + '?city=lagos', null, linked.cookie)).json() as AssessmentResponse
  assert.deepEqual([current.ok, current.revision, current.practice, current.assignmentMark], [true, 2, input.practice, null])
  const exported = await a.proved('/api/account/export', {}, linked.cookie, 'UidLogic')
  assert.equal(exported.status, 200)
  const summary = await exported.json() as { livingWorld: { actors: { assessments: unknown }[] } }
  assert.deepEqual(summary.livingWorld.actors[0]?.assessments, { status: 'present', progress: { courseId: 'cpe-101', attempts: [
    { semester: 1, startDay: begun.term!.startDay, phase: 'inspect', revision: 2, score: null },
  ], updatedAt: before.updatedAt } })
  assert.doesNotMatch(JSON.stringify(summary.livingWorld), /counterexample|initialMask|verificationMask|repairGate|lastOperation|actorId/)
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, linked.cookie, 'UidLogic')
  assert.equal(deleted.status, 200)
  const cookie = deleted.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.ok(cookie)
  assert.deepEqual(await readRow(), before)
  const guestCurrent = await (await a.f.request(path + '?city=lagos', null, cookie)).json() as AssessmentResponse
  assert.deepEqual([guestCurrent.ok, guestCurrent.revision, guestCurrent.practice, guestCurrent.assignmentMark], [true, 2, input.practice, null])
})

test('guest adoption, parked-character switch, and keep-as-guest deletion retain only the chosen character progress', async t => {
  const a = await accountHarness(t)
  const ada = await a.guest('Ada')
  const adaBefore = await startPausedBarber(a, ada)
  const linked = await a.signIn('UidAda', ada.cookie)
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.character?.id], [200, 'linked', ada.id])
  assert.notEqual(linked.cookie, ada.cookie, 'sign-in rotates the session cookie')
  const accountId = accountIdFromStored(await a.stored())
  const adaAdopted = await a.barberRow(ada.id)
  assert.ok(adaAdopted)
  assert.equal(adaAdopted.account, accountId)
  assert.deepEqual(omitAccount(adaAdopted), omitAccount(adaBefore), 'adoption changes only the strict barber owner field')

  const bola = await a.guest('Bola')
  const bolaBefore = await startPausedBarber(a, bola)
  const parked = await a.signIn('UidAda', bola.cookie)
  assert.deepEqual([parked.status, parked.body.outcome, parked.body.character?.id, parked.body.parked?.id], [200, 'parked', ada.id, bola.id])
  const bolaParked = await a.barberRow(bola.id)
  assert.ok(bolaParked)
  assert.equal(bolaParked.account, accountId)
  assert.deepEqual(omitAccount(bolaParked), omitAccount(bolaBefore), 'parking keeps the character-keyed lesson unchanged')

  const selected = await a.proved('/api/account/character', { use: bola.id }, parked.cookie, 'UidAda')
  assert.equal(selected.status, 200)
  assert.deepEqual((await selected.json() as { character: { id: string; name: string } }).character, { id: bola.id, name: bola.name })
  const restored = await a.barberRow(bola.id)
  assert.deepEqual(restored, bolaParked, 'a proven switch restores the same parked character progress and receipts')
  const current = await (await a.f.request(`${BARBER}?city=lagos`, null, parked.cookie)).json() as { session?: { publicId?: string; status?: string } }
  assert.equal(current.session?.status, 'paused', 'the restored paused lesson is readable under the selected character')

  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, parked.cookie, 'UidAda')
  assert.deepEqual([deleted.status, (await deleted.json() as { kept: boolean }).kept], [200, true])
  const guestCookie = deleted.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.ok(guestCookie && guestCookie !== parked.cookie)
  const guestRow = await a.barberRow(bola.id)
  assert.ok(guestRow)
  assert.equal(guestRow.account, null)
  assert.deepEqual(omitAccount(guestRow), omitAccount(bolaParked), 'keep-as-guest preserves the current paused practice exactly')
  assert.equal(await a.barberRow(ada.id), null, 'the set-aside character’s living-world row is erased with the deleted account')
})

test('account export proves ownership and emits strict active and parked living-world summaries only', async t => {
  const a = await accountHarness(t)
  const active = await a.guest('Active')
  const activeBefore = await startPausedBarber(a, active)
  const linked = await a.signIn('UidExport', active.cookie)
  assert.equal(linked.body.outcome, 'linked')
  const parked = await a.guest('Parked')
  const parkedBefore = await startPausedBarber(a, parked)
  const parkedInAccount = await a.signIn('UidExport', parked.cookie)
  assert.equal(parkedInAccount.body.outcome, 'parked')
  const unrelated = await a.guest('Unrelated')
  const unrelatedBefore = await startPausedBarber(a, unrelated)
  const allBefore = await a.f.server.store.read(db => snapshot((db as unknown as { livingWorld: unknown }).livingWorld))

  const missingProof = await a.change('/api/account/export', {}, parkedInAccount.cookie)
  assert.deepEqual([missingProof.status, (await missingProof.json() as { error: string }).error], [401, 'invalid_token'])
  const wrongActor = await a.proved('/api/account/export', {}, parkedInAccount.cookie, 'UidDifferent')
  assert.deepEqual([wrongActor.status, (await wrongActor.json() as { error: string }).error], [403, 'account_mismatch'])
  assert.deepEqual(await a.f.server.store.read(db => snapshot((db as unknown as { livingWorld: unknown }).livingWorld)), allBefore,
    'missing fresh proof and another account’s valid identity leave progress unchanged')

  const ownerToken = await a.token('UidExport')
  const response = await a.change('/api/account/export', { idToken: ownerToken }, parkedInAccount.cookie)
  assert.equal(response.status, 200)
  const exported = await response.json() as Json & { livingWorld: LivingWorldView }
  assert.deepEqual(Object.keys(exported.livingWorld).sort(), ['actors', 'version'])
  assert.equal(exported.livingWorld.version, 1)
  assert.deepEqual(exported.livingWorld.actors.map(actor => actor.publicId), [active.id, parked.id])
  assert.equal(exported.livingWorld.actors.some(actor => actor.publicId === unrelated.id), false)
  for (const actor of exported.livingWorld.actors) {
    assert.deepEqual(Object.keys(actor).sort(), ['barber', 'driving', 'publicId', 'qualification', 'starterRental'])
    const barber = actor.barber as Record<string, unknown>
    assert.deepEqual(Object.keys(barber).sort(), ['progress', 'status'])
    const progress = barber.progress as Record<string, unknown>
    assert.deepEqual(Object.keys(progress).sort(), ['lessons', 'starterTool'])
    assert.deepEqual(Object.keys(progress.lessons as object).sort(), ['advanced', 'basic'])
    for (const lesson of Object.values(progress.lessons as Record<string, Record<string, unknown>>)) {
      assert.deepEqual(Object.keys(lesson).sort(), ['earnedAt', 'revision', 'status', 'styleId'])
    }
  }
  const text = JSON.stringify(exported)
  const rowsBeforeExport = (allBefore as { barber: Record<string, unknown> }).barber
  const stored = await a.stored()
  const dbAccountId = accountIdFromStored(stored)
  const storedAccount = Object.values(stored.accounts as Record<string, { sessionKey?: string }>)[0]
  const privateValues = [
    'UidExport', dbAccountId, ownerToken, ...ownerToken.split('.'), ENV.ACCOUNTS_FIREBASE_API_KEY,
    cookieValue(parkedInAccount.cookie), cookieValue(active.cookie), cookieValue(parked.cookie), cookieValue(unrelated.cookie),
    'sessionKey', 'sessionId', 'lastPacket', 'frames', 'accountId', 'privateToken',
  ]
  if (storedAccount?.sessionKey) privateValues.push(storedAccount.sessionKey)
  for (const secret of privateValues) assert.equal(text.includes(secret), false, `export omits private value ${secret}`)
  for (const row of [activeBefore, parkedBefore, unrelatedBefore]) {
    const lesson = row.lessons as Record<string, { sessionId: string; lastPacket: unknown }>
    assert.equal(text.includes(lesson.basic!.sessionId), false)
    assert.equal(text.includes(JSON.stringify(lesson.basic!.lastPacket)), false)
  }
  assert.deepEqual(await a.barberRow(active.id), rowsBeforeExport[active.id], 'active owned row stays exact across export')
  assert.deepEqual(await a.barberRow(parked.id), rowsBeforeExport[parked.id], 'parked owned row stays exact across export')
  assert.deepEqual(await a.barberRow(unrelated.id), unrelatedBefore)
})

test('delete with erase true removes only the account’s proven IDs across known programme maps', async t => {
  const a = await accountHarness(t)
  const active = await a.guest('EraseActive')
  await startPausedBarber(a, active)
  const linked = await a.signIn('UidErase', active.cookie)
  assert.equal(linked.body.outcome, 'linked')
  const parked = await a.guest('EraseParked')
  await startPausedBarber(a, parked)
  const signedWithParked = await a.signIn('UidErase', parked.cookie)
  assert.equal(signedWithParked.body.outcome, 'parked')
  const unrelated = await a.guest('EraseUnrelated')
  await startPausedBarber(a, unrelated)

  // Fixture-only programme records exercise the same character-keyed erasure maps. They are not claims of driving completion or an earned qualification.
  await a.f.server.store.transact(db => {
    const livingWorld = (db as unknown as { livingWorld: Record<string, unknown> }).livingWorld
    const ids = [active.id, parked.id, unrelated.id]
    livingWorld.driving = Object.fromEntries(ids.map(id => [id, { fixtureOnly: 'driving continuity; no course result claimed' }]))
    livingWorld.qualifications = Object.fromEntries(ids.map(id => [id, { fixtureOnly: 'qualification continuity; no qualification earned' }]))
    livingWorld.rentals = Object.fromEntries(ids.map(id => [id, { fixtureOnly: 'rental erasure; no permission earned or vehicle allocated' }]))
    livingWorld.futureSlice = { [unrelated.id]: { preserve: true } }
  })
  const before = await a.f.server.store.read(db => snapshot((db as unknown as { livingWorld: Record<string, unknown> }).livingWorld))
  const unrelatedBefore = await a.barberRow(unrelated.id)
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: true }, signedWithParked.cookie, 'UidErase')
  assert.deepEqual([deleted.status, (await deleted.json() as { kept: boolean }).kept], [200, false])
  const after = await a.f.server.store.read(db => snapshot((db as unknown as { livingWorld: Record<string, unknown> }).livingWorld))
  for (const slice of ['driving', 'qualifications', 'barber', 'rentals']) {
    const beforeRows = before[slice] as Record<string, unknown>
    const afterRows = after[slice] as Record<string, unknown>
    assert.equal(Object.hasOwn(afterRows, active.id), false, `${slice} active data is erased`)
    assert.equal(Object.hasOwn(afterRows, parked.id), false, `${slice} parked data is erased`)
    assert.deepEqual(afterRows[unrelated.id], beforeRows[unrelated.id], `${slice} unrelated actor remains exact`)
  }
  assert.deepEqual(after.futureSlice, before.futureSlice, 'unknown future programme data remains untouched')
  assert.deepEqual(await a.barberRow(unrelated.id), unrelatedBefore)
})

test('account export includes living-world progress from its own expired archive without claiming a live character', async t => {
  const a = await accountHarness(t)
  const player = await a.guest('ArchivedActive')
  await startPausedBarber(a, player)
  const signed = await a.signIn('UidArchive', player.cookie)
  assert.equal(signed.body.outcome, 'linked')
  const adoptedBarber = await a.barberRow(player.id)
  assert.ok(adoptedBarber)

  await a.f.server.store.transact(db => {
    const account = Object.values(db.accounts ?? {}).find(item => item.subject === 'UidArchive')
    assert.ok(account?.sessionKey)
    const record = db.sessions[account.sessionKey]
    assert.ok(record)
    record.expiresAt = a.f.now() - 1
  })
  // Creating an unrelated ordinary session invokes the production expiry archiver.
  const trigger = await a.f.device('ArchiveTrigger')
  const archived = await a.f.server.store.read(db => snapshot(db.archivedLives?.[player.id]))
  assert.equal(archived?.publicId, player.id)
  assert.equal((archived as { account?: string } | undefined)?.account, undefined, 'the session expiry archive carries no account marker')
  assert.ok(await a.barberRow(player.id), 'the character-keyed row remains available by its proven archive identity')

  const exportToken = await a.token('UidArchive')
  const response = await a.change('/api/account/export', { idToken: exportToken }, signed.cookie)
  assert.equal(response.status, 200)
  const body = await response.json() as { livingWorld?: LivingWorldView; character?: unknown }
  assert.deepEqual(body.livingWorld?.actors.map(actor => actor.publicId), [player.id])
  assert.equal(body.character, null, 'the account export does not pretend the expired session is currently live')
  const archivedExport = JSON.stringify(body.livingWorld)
  for (const secret of ['sessionId', 'lastPacket', 'frames', cookieValue(trigger.cookie)]) assert.equal(archivedExport.includes(secret), false)
  assert.deepEqual(await a.barberRow(player.id), adoptedBarber, 'exporting an archived character does not mutate its programme progress')

  const restored = await a.signIn('UidArchive', signed.cookie)
  assert.deepEqual([restored.status, restored.body.outcome, restored.body.character?.id], [200, 'restored', player.id])
  const state = await (await a.call('/api/account', undefined, restored.cookie)).json() as { character?: { id: string } | null }
  assert.equal(state.character?.id, player.id, 'the same proved account restores the expired active character')
  const restoredBarber = await a.barberRow(player.id)
  assert.ok(restoredBarber)
  assert.equal(restoredBarber.account, accountIdFromStored(await a.stored()))
  assert.deepEqual(omitAccount(restoredBarber), omitAccount(adoptedBarber), 'archive restoration preserves the same barber progress and receipts')
  const barberState = await (await a.f.request(`${BARBER}?city=lagos`, null, restored.cookie)).json() as { session?: { status?: string } }
  assert.equal(barberState.session?.status, 'paused', 'the restored account can read its saved paused lesson')
})

test('keep-as-guest deletion erases orphan programme data but refuses a conflicting foreign archive unchanged', async t => {
  const a = await accountHarness(t)
  const player = await a.guest('OrphanProgress')
  await startPausedBarber(a, player)
  const signed = await a.signIn('UidOrphan', player.cookie)
  assert.equal(signed.body.outcome, 'linked')

  await a.f.server.store.transact(db => {
    const account = Object.values(db.accounts ?? {}).find(item => item.subject === 'UidOrphan')
    assert.ok(account?.sessionKey)
    delete db.sessions[account.sessionKey]
    account.sessionKey = null
    if (db.archivedLives) delete db.archivedLives[player.id]
  })
  const orphanDelete = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, signed.cookie, 'UidOrphan')
  assert.deepEqual([orphanDelete.status, (await orphanDelete.json() as { kept: boolean }).kept], [200, false],
    'without a returnable session/archive the account does not keep orphan programme progress as a guest')
  assert.equal(await a.barberRow(player.id), null)

  const conflicted = await a.guest('ConflictedArchive')
  await startPausedBarber(a, conflicted)
  const owner = await a.signIn('UidConflict', conflicted.cookie)
  assert.equal(owner.body.outcome, 'linked')
  await a.f.server.store.transact(db => {
    const account = Object.values(db.accounts ?? {}).find(item => item.subject === 'UidConflict')
    assert.ok(account?.sessionKey)
    const row = (db.livingWorld as { barber: Record<string, { account: string | null }> }).barber[conflicted.id]
    assert.ok(row)
    row.account = 'foreign-account-owner'
    delete db.sessions[account.sessionKey]
    account.sessionKey = null
    db.archivedLives ??= {}
    db.archivedLives[conflicted.id] = { publicId: conflicted.id, name: conflicted.name, cities: {}, archivedAt: a.f.now(), account: 'foreign-account-owner' }
  })
  const before = await a.f.server.store.read(db => snapshot({
    row: (db.livingWorld as { barber: Record<string, unknown> }).barber[conflicted.id],
    archive: db.archivedLives?.[conflicted.id],
  }))
  const refused = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, owner.cookie, 'UidConflict')
  assert.notEqual(refused.status, 200, 'a foreign archive conflict fails closed instead of treating the indexed ID as this account’s actor')
  assert.deepEqual(await a.f.server.store.read(db => snapshot({
    row: (db.livingWorld as { barber: Record<string, unknown> }).barber[conflicted.id],
    archive: db.archivedLives?.[conflicted.id],
  })), before, 'the conflicting foreign actor and archive remain unchanged')
})

test('keep-as-guest deletion refuses a foreign or malformed barber owner without changing a live account', async t => {
  const a = await accountHarness(t)
  for (const mode of ['foreign-owner', 'malformed-owner'] as const) {
    const player = await a.guest(`Delete-${mode}`)
    await startPausedBarber(a, player)
    const signed = await a.signIn(`Uid-${mode}`, player.cookie)
    assert.equal(signed.body.outcome, 'linked')
    await a.f.server.store.transact(db => {
      const row = (db.livingWorld as { barber: Record<string, Record<string, unknown>> }).barber[player.id]
      assert.ok(row)
      if (mode === 'foreign-owner') row.account = 'different-verified-account'
      else row.account = { invalid: true }
    })
    const before = await a.f.server.store.read(db => {
      const account = Object.values(db.accounts ?? {}).find(item => item.subject === `Uid-${mode}`)
      const session = account?.sessionKey ? db.sessions[account.sessionKey] : undefined
      return snapshot({
        account,
        session,
        devices: db.accountDevices,
        barber: (db.livingWorld as { barber: Record<string, unknown> }).barber[player.id],
      })
    })
    const refused = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, signed.cookie, `Uid-${mode}`)
    assert.notEqual(refused.status, 200, `${mode} cannot be detached as a guest with a conflicting barber row`)
    assert.equal(refused.headers.get('set-cookie'), null, 'a refused delete does not rotate or clear the browser cookie')
    assert.deepEqual(await a.f.server.store.read(db => {
      const account = Object.values(db.accounts ?? {}).find(item => item.subject === `Uid-${mode}`)
      const session = account?.sessionKey ? db.sessions[account.sessionKey] : undefined
      return snapshot({
        account,
        session,
        devices: db.accountDevices,
        barber: (db.livingWorld as { barber: Record<string, unknown> }).barber[player.id],
      })
    }), before, 'account, active session, bindings, and the conflicting programme row roll back together')
    assert.equal((await a.f.request('/api/life?city=lagos', null, signed.cookie)).status, 200, 'the account remains usable after refusal')
  }
})

test('guest adoption refuses a conflicting barber owner without creating an account or rotating identity', async t => {
  const a = await accountHarness(t)
  for (const mode of ['foreign-owner', 'malformed-owner'] as const) {
    const player = await a.guest(`Adopt-${mode}`)
    await startPausedBarber(a, player)
    await a.f.server.store.transact(db => {
      const row = (db.livingWorld as { barber: Record<string, Record<string, unknown>> }).barber[player.id]
      assert.ok(row)
      if (mode === 'foreign-owner') row.account = 'different-verified-account'
      else row.account = { invalid: true }
    })
    const before = await a.f.server.store.read(db => snapshot({
      session: db.sessions[cookieValue(player.cookie)],
      accounts: db.accounts,
      devices: db.accountDevices,
      barber: (db.livingWorld as { barber: Record<string, unknown> }).barber[player.id],
    }))
    const refused = await a.signIn(`Uid-Adopt-${mode}`, player.cookie)
    assert.notEqual(refused.status, 200, `${mode} row cannot be adopted into a new account`)
    assert.equal(refused.cookie, '', 'a refused adoption issues no new account cookie')
    assert.deepEqual(await a.f.server.store.read(db => snapshot({
      session: db.sessions[cookieValue(player.cookie)],
      accounts: db.accounts,
      devices: db.accountDevices,
      barber: (db.livingWorld as { barber: Record<string, unknown> }).barber[player.id],
    })), before, 'the guest session and malformed/foreign record remain unchanged')
    assert.equal((await a.f.request('/api/life?city=lagos', null, player.cookie)).status, 200, 'the guest keeps the same playable session')
  }
})

test('proven parked-character switch refuses a foreign barber row and preserves both characters', async t => {
  const a = await accountHarness(t)
  const active = await a.guest('SwitchActive')
  await startPausedBarber(a, active)
  const signed = await a.signIn('UidSwitchConflict', active.cookie)
  assert.equal(signed.body.outcome, 'linked')
  const parked = await a.guest('SwitchParked')
  await startPausedBarber(a, parked)
  const bound = await a.signIn('UidSwitchConflict', parked.cookie)
  assert.equal(bound.body.outcome, 'parked')
  await a.f.server.store.transact(db => {
    const row = (db.livingWorld as { barber: Record<string, Record<string, unknown>> }).barber[parked.id]
    assert.ok(row)
    row.account = 'different-verified-account'
  })
  const before = await a.f.server.store.read(db => {
    const account = Object.values(db.accounts ?? {}).find(item => item.subject === 'UidSwitchConflict')
    const session = account?.sessionKey ? db.sessions[account.sessionKey] : undefined
    return snapshot({
      account,
      session,
      devices: db.accountDevices,
      activeArchive: db.archivedLives?.[active.id],
      parkedArchive: db.archivedLives?.[parked.id],
      activeBarber: (db.livingWorld as { barber: Record<string, unknown> }).barber[active.id],
      parkedBarber: (db.livingWorld as { barber: Record<string, unknown> }).barber[parked.id],
    })
  })
  const refused = await a.proved('/api/account/character', { use: parked.id }, bound.cookie, 'UidSwitchConflict')
  assert.notEqual(refused.status, 200, 'the account cannot switch into a parked character with a conflicting programme owner')
  assert.deepEqual(await a.f.server.store.read(db => {
    const account = Object.values(db.accounts ?? {}).find(item => item.subject === 'UidSwitchConflict')
    const session = account?.sessionKey ? db.sessions[account.sessionKey] : undefined
    return snapshot({
      account,
      session,
      devices: db.accountDevices,
      activeArchive: db.archivedLives?.[active.id],
      parkedArchive: db.archivedLives?.[parked.id],
      activeBarber: (db.livingWorld as { barber: Record<string, unknown> }).barber[active.id],
      parkedBarber: (db.livingWorld as { barber: Record<string, unknown> }).barber[parked.id],
    })
  }), before, 'failed switch leaves account, active character, parked archive, and both programme rows unchanged')
})


test('character-bound starter permission survives adoption and parking; account deletion removes only discarded IDs', async t => {
  const a = await accountHarness(t)
  const ada = await a.guest('PermissionAda'), bola = await a.guest('PermissionBola'), other = await a.guest('PermissionOther')
  // Retained permission fixtures test account continuity only. No course pass, earned permission or car allocation is claimed.
  const grant = (publicId: string) => ({ version: 1, revision: 1, generation: 0, trip: null, entitlement: {
    actor: publicId, resourceId: 'marina-starter-sedan', scope: 'district-driving', qualificationId: 'district-driving',
    qualificationVersion: 1, issuedAt: a.f.now(), status: 'active',
  } })
  const before = Object.fromEntries([ada, bola, other].map(player => [player.id, grant(player.id)]))
  await a.f.server.store.transact(db => {
    const root = (db as unknown as { livingWorld?: Record<string, unknown> }).livingWorld ?? {}
    root.rentals = snapshot(before)
    ;(db as unknown as { livingWorld: Record<string, unknown> }).livingWorld = root
  })
  const rows = () => a.f.server.store.read(db => snapshot((db as unknown as { livingWorld: { rentals: Record<string, unknown> } }).livingWorld.rentals))
  const linked = await a.signIn('UidPermission', ada.cookie)
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.character?.id], [200, 'linked', ada.id])
  assert.deepEqual(await rows(), before, 'same public character permission needs no account-owner rewrite')
  const parked = await a.signIn('UidPermission', bola.cookie)
  assert.deepEqual([parked.status, parked.body.outcome, parked.body.parked?.id], [200, 'parked', bola.id])
  assert.deepEqual(await rows(), before)
  const selected = await a.proved('/api/account/character', { use: bola.id }, parked.cookie, 'UidPermission')
  assert.equal(selected.status, 200)
  assert.deepEqual(await rows(), before)
  const exported = await a.proved('/api/account/export', {}, parked.cookie, 'UidPermission')
  assert.equal(exported.status, 200)
  const view = await exported.json() as { livingWorld: { actors: Array<{ publicId: string; starterRental: { status: string; progress?: Record<string, unknown> } }> } }
  assert.deepEqual(view.livingWorld.actors.map(actor => actor.publicId).sort(), [ada.id, bola.id].sort())
  for (const actor of view.livingWorld.actors) {
    assert.equal(actor.starterRental.status, 'present')
    assert.deepEqual(Object.keys(actor.starterRental.progress ?? {}).sort(), ['issuedAt', 'qualificationId', 'resourceId', 'revision', 'scope', 'status', 'version'])
    assert.ok(!JSON.stringify(actor.starterRental).match(/trip|actor|account|fingerprint|receipt|custody/i))
  }
  assert.deepEqual(await rows(), before, 'export is point-read and leaves all retained rows intact')
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, parked.cookie, 'UidPermission')
  assert.deepEqual([deleted.status, (await deleted.json() as { kept: boolean }).kept], [200, true])
  assert.deepEqual(await rows(), { [bola.id]: before[bola.id], [other.id]: before[other.id] },
    'discarded parked character is erased; retained guest and unrelated actor preserve their exact permissions')
})

test('active clerk decisions survive actual guest adoption and keep-as-guest deletion without a new reward', async t => {
  const a = await accountHarness(t), guest = await a.guest('Clerk')
  const path = '/api/living-world/clerk'
  const begun = await (await a.f.request(path + '/start', { cityId: 'lagos', requestId: a.f.id() }, guest.cookie)).json() as { ok: boolean; revision: number }
  assert.equal(begun.ok, true)
  const input = await (await a.f.request(path + '/step', { cityId: 'lagos', requestId: a.f.id(), revision: begun.revision,
    stepId: 'inspect_receipt', evidenceId: 'receipt' }, guest.cookie)).json() as { ok: boolean; revision: number }
  assert.equal(input.ok, true)
  const readRow = () => a.f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, Record<string, unknown>> }).clerk[guest.id]!))
  const before = await readRow()
  const linked = await a.signIn('UidClerk', guest.cookie)
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.character?.id], [200, 'linked', guest.id])
  const adopted = await readRow()
  assert.equal(adopted.account, accountIdFromStored(await a.stored()))
  assert.deepEqual(omitAccount(adopted), omitAccount(before))
  const exported = await a.proved('/api/account/export', {}, linked.cookie, 'UidClerk')
  assert.equal(exported.status, 200)
  const summary = await exported.json() as { livingWorld: { actors: { clerk: unknown }[] } }
  assert.deepEqual(summary.livingWorld.actors[0]?.clerk, { status: 'present', progress: { scenarioVersion: 1,
    step: 'inspect_dispatch', revision: 1, claimed: false, updatedAt: before.updatedAt } })
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, linked.cookie, 'UidClerk')
  assert.equal(deleted.status, 200)
  const guestCookie = deleted.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.ok(guestCookie)
  assert.deepEqual(await readRow(), before)
  const current = await (await a.f.request(path + '?city=lagos', null, guestCookie)).json() as { ok: boolean; revision: number; claimed: boolean }
  assert.deepEqual([current.ok, current.revision, current.claimed], [true, 1, false])
})
