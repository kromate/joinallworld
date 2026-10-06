// "Find my city" on the landing: the visitor is told which open city they are in, or the nearest one when they are somewhere that is not
// open yet — and the position never leaves the device: no request, no storage, no event carries it, and the answer holds none.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { cityCatalogueEntry } from '../../../game/cities/registry.ts'
import type { CityPackApi } from '../world/cityPack.ts'
import { CITY_LOCATION_WHY, NO_CITY_LOCATION, findCity } from './findCity.ts'

const at = (latitude: number, longitude: number): Pick<Geolocation, 'getCurrentPosition'> => ({ getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude, longitude } } as GeolocationPosition) })
/** City packs on this device: a position is "inside" a city when it is within `radius` degrees of the pack's own centre. */
function packs(inside: string | null, seen: unknown[] = []): () => Promise<CityPackApi> {
  return async () => ({
    has: () => true,
    load: async (id) => ({ name: id }),
    resolve: (pack, latitude, longitude) => { seen.push([pack.name, latitude, longitude]); return pack.name === inside ? { id: 'x' as never, name: 'Somewhere', sure: true } : null },
  })
}

test('a visitor inside an open city is offered to start there', async () => {
  const seen: unknown[] = []
  const found = await findCity({ geolocation: at(12.0, 8.52), packs: packs('kano', seen) })
  assert.deepEqual([found.kind, found.kind === 'in' ? found.city : null, found.line], ['in', 'kano', 'You are in Kano — start there?'])
  assert.deepEqual(seen[0], ['kano', 12.0, 8.52], 'the position goes to the lookup on this device')
})

test('a visitor whose position no city map claims is offered the nearest open city', async () => {
  const kaduna = cityCatalogueEntry('kaduna')
  assert.ok(kaduna)
  const found = await findCity({ geolocation: at(kaduna.lat, kaduna.lon), packs: packs(null) })
  assert.equal(found.kind, 'near')
  if (found.kind !== 'near') return
  // Every catalogue city is open, so no place is "coming": the nearest open city is the one at this marker.
  assert.deepEqual([found.city, found.place, found.line], ['kaduna', null, 'Allworld is not open where you are yet — start in the nearest open city: Kaduna'])
})

test('a visitor far from every place is told so, and offered the nearest open city', async () => {
  const found = await findCity({ geolocation: at(-33.9, 151.2), packs: packs(null) })
  assert.equal(found.kind, 'near')
  if (found.kind !== 'near') return
  assert.equal(found.place, null)
  assert.match(found.line, /^Allworld is not open where you are yet — start in the nearest open city: /)
  assert.ok(cityCatalogueEntry(found.city)?.open === true)
})

test('no location, a refusal, a timeout: a plain sentence and nothing else', async () => {
  assert.deepEqual(await findCity({ geolocation: undefined }), { kind: 'none', line: NO_CITY_LOCATION })
  for (const code of [1, 2, 3, 9]) {
    const failing = { getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code } as GeolocationPositionError) }
    assert.deepEqual(await findCity({ geolocation: failing, packs: packs(null) }), { kind: 'none', line: CITY_LOCATION_WHY[code] ?? CITY_LOCATION_WHY[2] })
  }
})

test('the position never leaves the device: no request, no storage, no beacon, no answer that holds it', async () => {
  const sent: unknown[] = []
  const real = { fetch: globalThis.fetch, xhr: (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest, beacon: globalThis.navigator?.sendBeacon }
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { sent.push(['storage', key, value]); store.set(key, value) }, removeItem: () => {} }
  Object.assign(globalThis, { fetch: (...args: unknown[]) => { sent.push(['fetch', ...args]); return Promise.reject(new Error('no network in this test')) }, XMLHttpRequest: function Fake() { sent.push(['xhr']) }, localStorage: storage, sessionStorage: storage })
  const events: unknown[] = []
  const listener = (event: Event): void => { events.push(event) }
  const target = globalThis as unknown as { addEventListener?: (type: string, run: (event: Event) => void) => void; dispatchEvent?: (event: Event) => boolean }
  target.addEventListener?.('jaw:track', listener)
  try {
    const lat = 12.0034567, lon = 8.5212345
    for (const inside of ['kano', null]) {
      const found = await findCity({ geolocation: at(lat, lon), packs: packs(inside) })
      const text = JSON.stringify(found)
      assert.ok(!text.includes('12.003') && !text.includes('8.521'), 'the answer holds no coordinates')
      assert.deepEqual(Object.keys(found).sort(), found.kind === 'in' ? ['city', 'kind', 'line', 'name'] : ['city', 'kind', 'line', 'name', 'place'])
    }
    assert.deepEqual(sent, [], 'nothing was fetched, posted or stored')
    assert.deepEqual(events, [], 'no event was sent')
  } finally {
    Object.assign(globalThis, { fetch: real.fetch })
    if (real.xhr === undefined) Reflect.deleteProperty(globalThis, 'XMLHttpRequest'); else Object.assign(globalThis, { XMLHttpRequest: real.xhr })
    Reflect.deleteProperty(globalThis, 'localStorage'); Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

test('the sources of the flow have no way to send a position: no network, no storage, no event, no telemetry', () => {
  for (const file of ['findCity.ts', 'PathIntro.vue', 'pathIntroModel.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const word of ['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'dispatchEvent', 'track(', 'console.']) assert.ok(!source.includes(word), `${file} must not use ${word}`)
  }
  // The position is read only when the visitor taps the button, never when the landing opens.
  const view = readFileSync(new URL('PathIntro.vue', import.meta.url), 'utf8')
  assert.ok(!/onMounted|immediate/.test(view), 'nothing asks for the position on its own')
  assert.match(view, /@click="find"/)
})
