import assert from 'node:assert/strict'
import { driver, object } from './cityJourney.ts'
import type { JourneyDevice, JourneyHost } from './cityJourney.ts'

/**
 * The location-confirmed badge played against a real host (docs/LOCATION.md): two players in Ikeja. The first confirms with the
 * one action the device sends, `estate.confirm-residence { lga, ok: true }`, which is exactly-once; the second sees the badge by
 * name; a player hidden from directories shows only a generic tick; the daily limit holds; switching off removes it at once.
 * The same run is used on the Node server (server/residence.test.ts) and on the Worker (deploy/residence.edge.test.ts).
 */
export interface ResidenceResult { sent: Record<string, unknown>; stored: Record<string, unknown> | null; limitedAfter: number }

export async function residenceJourney(host: Pick<JourneyHost, 'now' | 'request' | 'elapse'>): Promise<ResidenceResult> {
  const { id, life, action, start } = driver(host)
  const ada = await start('Ada', 'lagos', 'ikeja')
  const kunle = await start('Kunle', 'lagos', 'agege')

  const badges = async (viewer: JourneyDevice, ids: string[]): Promise<Record<string, unknown>> => {
    const response = await host.request('/api/world/badges', { ids }, viewer.cookie)
    const answer = object(await response.json())
    assert.equal(response.status, 200, JSON.stringify(answer))
    return object(answer.badges)
  }
  const send = async (device: JourneyDevice, type: string, payload: object, actionId = id()): Promise<Record<string, unknown> & { status: number }> => {
    const response = await host.request('/api/action', { cityId: 'lagos', type, payload, actionId }, device.cookie)
    return { ...object(await response.json()), status: response.status }
  }
  const estate = async (device: JourneyDevice): Promise<Record<string, unknown>> => object(object(await life(device, 'lagos')).estate)

  // Nothing yet; and a request without a session or with bad ids is refused.
  assert.deepEqual(await badges(kunle, [ada.id]), {})
  assert.equal((await host.request('/api/world/badges', { ids: [ada.id] })).status, 401)
  for (const ids of [['not an id'], Array.from({ length: 41 }, () => ada.id), 'ada', [5]]) assert.equal((await host.request('/api/world/badges', { ids }, kunle.cookie)).status, 400)

  // The wrong local government is refused and records nothing.
  const wrong = await send(ada, 'estate.confirm-residence', { lga: 'agege', ok: true })
  assert.deepEqual([wrong.ok, wrong.code], [false, 'not_main_home'])
  assert.equal((await estate(ada)).confirmed, undefined)

  // The one action the device sends. A repeat of the same request changes nothing.
  const body = { lga: 'ikeja', ok: true }
  const actionId = id()
  const first = await send(ada, 'estate.confirm-residence', body, actionId)
  assert.deepEqual([first.ok, first.code], [true, 'residence_confirmed'])
  const stored = object((await estate(ada)).confirmed)
  assert.deepEqual(Object.keys(stored).sort(), ['at', 'lga'], 'the record is the id and the server clock')
  assert.equal(stored.lga, 'ikeja')
  const again = await send(ada, 'estate.confirm-residence', body, actionId)
  assert.deepEqual([again.ok, again.duplicate], [true, true])
  assert.deepEqual(object((await estate(ada)).confirmed), stored)

  // Another player sees the badge by name; an unrelated player's id gives nothing.
  assert.deepEqual(await badges(kunle, [ada.id, kunle.id]), { [ada.id]: { lga: 'ikeja', name: 'Ikeja' } })
  assert.deepEqual(await badges(ada, [ada.id]), { [ada.id]: { lga: 'ikeja', name: 'Ikeja' } })

  // Hidden from directories: only the generic tick. Listed again: the name is back.
  assert.equal((await host.request('/api/civic/prefs', { directory: false }, ada.cookie)).status, 200)
  assert.deepEqual(await badges(kunle, [ada.id]), { [ada.id]: { lga: null, name: null } })
  assert.equal((await host.request('/api/civic/prefs', { directory: true }, ada.cookie)).status, 200)
  assert.deepEqual(await badges(kunle, [ada.id]), { [ada.id]: { lga: 'ikeja', name: 'Ikeja' } })

  // Five a day, then a refusal that says why.
  // (The refused attempt above and the confirmation count; the repeat of a request does not.)
  let limitedAfter = 2
  for (; limitedAfter < 5; limitedAfter++) assert.equal((await send(ada, 'estate.confirm-residence', body)).status, 200)
  const sixth = await send(ada, 'estate.confirm-residence', body)
  assert.deepEqual([sixth.status, sixth.error], [429, 'residence_rate_limited'])
  assert.match(String(sixth.reason), /tomorrow/)

  // Off: the stored record is deleted and the other player's view changes with no other step.
  const off = await send(ada, 'estate.unconfirm-residence', {})
  assert.deepEqual([off.ok, off.code], [true, 'residence_removed'])
  assert.equal('confirmed' in (await estate(ada)), false)
  assert.deepEqual(await badges(kunle, [ada.id]), {})
  return { sent: body, stored, limitedAfter }
}
