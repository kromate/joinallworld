import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-fixture.ts'
import coreRoutes from './routes/core.ts'
import { characterCity, fileCharacter } from './character.ts'
import type { ActionRequest, TimedId } from '../src/types/protocol.ts'
import type { LifeState } from '../src/types/life.ts'
import type { Db, RouteContext, RouteHandler, RouteKey, SessionRecord } from './types.ts'

interface Reply { status: number; ok?: boolean; code?: string; error?: string; duplicate?: boolean; rev?: number; state?: LifeState }
const reply = async (response: Response): Promise<Reply> => ({ ...(await response.json() as Omit<Reply, 'status'>), status: response.status })
const sessionOf = (db: Db, publicId: string): SessionRecord => {
  const session = Object.values(db.sessions).find((entry) => entry.publicId === publicId)
  if (!session) throw new Error('session missing')
  return session
}

const authorityProbe = (ctx: RouteContext): Record<RouteKey, RouteHandler> => ({
  'POST /api/probe/action-authority': async request => {
    const body = await request.json()
    return { body: await ctx.command(request, {
      actionId: body.actionId as TimedId,
      cityId: body.cityId as ActionRequest['cityId'],
      type: 'travel',
      payload: { id: 'library', mode: 'cab' },
    }, { internal: true, scope: 'probe.action-authority' }) }
  },
})

test('public action receipt wins first: a moved retry replays it against the current life without running twice', async t => {
  const memberships: unknown[][] = []
  const f = await fixture(t, { wsModules: [() => ({ lifecycle: {
    validateMemberships(secret: string | undefined, cityId: string, state: LifeState, publicId?: string) { memberships.push([typeof secret, cityId, state.estate.city, publicId]) },
  } })] })
  const ada = await f.device('Ada')
  await f.request('/api/life?city=lagos', null, ada.cookie)
  const body = { actionId: f.id(), cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'cab' } }
  const first = await reply(await f.request('/api/action', body, ada.cookie))
  assert.deepEqual([first.status, first.ok, first.code, first.state?.cash], [200, true, 'started', 4600])

  await f.server.store.transact(db => {
    const session = sessionOf(db, ada.id), from = characterCity(session)
    if (from !== 'lagos') throw new Error('expected Lagos character')
    const entry = session.cities[from]
    if (!entry) throw new Error('life missing')
    entry.state.estate.city = 'ibadan'
    fileCharacter(session, from, f.now())
    session.rev = (session.rev ?? 0) + 1
  })
  memberships.length = 0
  const retry = await reply(await f.request('/api/action', body, ada.cookie))
  assert.deepEqual([retry.status, retry.ok, retry.code, retry.duplicate, retry.state?.estate.city, retry.state?.cash], [200, true, 'started', true, 'ibadan', 4600])
  assert.equal(retry.rev, await f.server.store.read(db => sessionOf(db, ada.id).rev ?? 0), 'the replay carries the current character revision')
  assert.deepEqual(memberships, [['string', 'ibadan', 'ibadan', ada.id]], 'membership validation receives the actual current city and life')
})

test('moved retry wins first: its refused receipt fences a late original after return and rejects payload or authority conflicts', async t => {
  const f = await fixture(t, { routes: [coreRoutes, authorityProbe] })
  const ada = await f.device('Ada')
  await f.request('/api/life?city=lagos', null, ada.cookie)
  const move = async (to: 'lagos' | 'ibadan') => f.server.store.transact(db => {
    const session = sessionOf(db, ada.id), from = characterCity(session)
    if (!from) throw new Error('character city missing')
    const entry = session.cities[from]
    if (!entry) throw new Error('life missing')
    entry.state.estate.city = to
    fileCharacter(session, from, f.now())
    session.rev = (session.rev ?? 0) + 1
  })
  await move('ibadan')
  const body = { actionId: f.id(), cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'cab' } }
  const refused = await reply(await f.request('/api/action', body, ada.cookie))
  assert.deepEqual([refused.status, refused.ok, refused.code, refused.duplicate, refused.state?.estate.city, refused.state?.cash], [200, false, 'city_moved', undefined, 'ibadan', 5000])
  assert.equal(refused.rev, await f.server.store.read(db => sessionOf(db, ada.id).rev ?? 0))

  await move('lagos')
  const lateOriginal = await reply(await f.request('/api/action', body, ada.cookie))
  assert.deepEqual([lateOriginal.status, lateOriginal.ok, lateOriginal.code, lateOriginal.duplicate, lateOriginal.state?.estate.city, lateOriginal.state?.cash], [200, false, 'city_moved', true, 'lagos', 5000])
  assert.equal(lateOriginal.rev, await f.server.store.read(db => sessionOf(db, ada.id).rev ?? 0))
  assert.equal((await reply(await f.request('/api/action', { ...body, payload: { id: 'park', mode: 'cab' } }, ada.cookie))).error, 'action_id_conflict')
  assert.equal((await reply(await f.request('/api/probe/action-authority', { actionId: body.actionId, cityId: 'lagos' }, ada.cookie))).error, 'action_id_conflict')
})
