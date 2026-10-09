// The location-confirmed check on the device: one request for the position, the verdict, and what may leave. The position is a
// local value of one function: these tests watch every way out of the page (fetch, sockets, beacons, console, analytics) while a
// whole check runs, and read the sources that touch a position.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadCityContent } from '../../../game/cities/registry.ts'
import { createGame } from '../../state/game.ts'
import { createFakeServer, memoryStorage } from '../../testing/fakeServer.ts'
import { cleanEvent, captureArgs } from '../../../telemetry/clean.ts'
import { scrubEvent, scrubProps, scrubText } from '../../../telemetry/scrub.ts'
import { allowHelp, checkResidence, outcomeText, POSITION_OPTIONS } from './locateModel.ts'
import type { CheckDeps, CheckOutcome } from './locateModel.ts'
import { loadLocateApi } from './locateApi.ts'

await loadCityContent('lagos')
const root = fileURLToPath(new URL('../../../..', import.meta.url))

interface Spot { latitude: number; longitude: number; accuracy: number }
const IKEJA: Spot = { latitude: 6.601838, longitude: 3.351486, accuracy: 25 }
const PARIS: Spot = { latitude: 48.856614, longitude: 2.352222, accuracy: 25 }
/** A device: it answers once with `spot`, or with an error code. It has no watchPosition: calling it would throw. */
function device(answer: Spot | { code: number }) {
  const seen: { calls: number; options: PositionOptions | undefined } = { calls: 0, options: undefined }
  const geolocation = {
    getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null, options?: PositionOptions) {
      seen.calls += 1; seen.options = options
      if ('code' in answer) fail?.({ code: answer.code, message: 'secret place 6.6018,3.3515', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
      else ok({ coords: { ...answer, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: 1 } as unknown as GeolocationPosition)
    },
  }
  return { geolocation, seen }
}
const deps = (answer: Spot | { code: number }, extra: Partial<CheckDeps> = {}) => { const d = device(answer); return { d, deps: { geolocation: d.geolocation, secure: true, ...extra } satisfies CheckDeps } }
const target = { city: 'lagos', lga: 'ikeja' }

test('a device in Ikeja confirms Ikeja; one request, high accuracy off, a short timeout, no watching', async () => {
  const { d, deps: dependencies } = deps(IKEJA)
  assert.equal(await checkResidence(target, dependencies), 'confirmed')
  assert.equal(d.seen.calls, 1)
  assert.deepEqual(d.seen.options, POSITION_OPTIONS)
  assert.equal(POSITION_OPTIONS.enableHighAccuracy, false)
  assert.ok((POSITION_OPTIONS.timeout ?? Infinity) <= 15000 && POSITION_OPTIONS.maximumAge === 0)
})

test('every other outcome has its own kind words and nothing is confirmed', async () => {
  const cases: [string, Spot | { code: number }, Partial<CheckDeps>, CheckOutcome][] = [
    ['another country', PARIS, {}, 'outside'],
    ['ikorodu is not ikeja', { latitude: 6.6194, longitude: 3.5105, accuracy: 30 }, {}, 'outside'],
    ['a vague desktop fix', { ...IKEJA, accuracy: 20000 }, {}, 'inaccurate'],
    ['denied', { code: 1 }, {}, 'denied'],
    ['unavailable', { code: 2 }, {}, 'unavailable'],
    ['timeout', { code: 3 }, {}, 'timeout'],
    ['insecure page', IKEJA, { secure: false }, 'insecure'],
    ['no geolocation', IKEJA, { geolocation: undefined }, 'unsupported'],
  ]
  for (const [name, answer, extra, expected] of cases) {
    const { d, deps: dependencies } = deps(answer, extra)
    assert.equal(await checkResidence(target, dependencies), expected, name)
    if (expected === 'insecure' || expected === 'unsupported') assert.equal(d.seen.calls, 0, `${name}: the browser is never asked`)
  }
  assert.equal(await checkResidence({ city: 'lagos', lga: 'ikeja' }, { ...deps(IKEJA).deps, api: async () => ({ has: () => false, load: async () => null, judge: () => 'inside' }) }), 'no_boundary')
  assert.equal(await checkResidence(target, { ...deps(IKEJA).deps, api: async () => { throw new Error('offline') } }), 'no_boundary')
  assert.match(outcomeText('outside', 'Ikeja'), /Your device places you outside Ikeja right now\. You can try again when you are home\./)
  assert.match(outcomeText('inaccurate', 'Ikeja'), /roughly/)
  for (const outcome of ['confirmed', 'outside', 'inaccurate', 'denied', 'unavailable', 'timeout', 'insecure', 'unsupported', 'no_boundary'] as const) {
    const words = outcomeText(outcome, 'Ikeja')
    assert.ok(words.length > 20 && !/\d+\.\d{3,}/.test(words), outcome)
  }
})

test('the denied help names the way to allow location in the browser the player has', () => {
  const agents: [string, RegExp][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', /aA button/],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', /Permissions/],
    ['Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0', /lock icon/],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', /Site settings/],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', /Safari menu/],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0', /permissions icon/],
  ]
  for (const [agent, pattern] of agents) assert.match(allowHelp(agent), pattern, agent)
  assert.match(allowHelp(''), /site settings/)
})

test('a whole check, watched from every way out of the page: only the one action leaves, and it carries no position', async () => {
  const server = createFakeServer()
  const outgoing: string[] = []
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => { outgoing.push(`${init?.method ?? 'GET'} ${String(input)} ${typeof init?.body === 'string' ? init.body : ''}`); return server.fetch(input, init) }) as typeof globalThis.fetch
  const trips: string[] = []
  const g = globalThis as Record<string, unknown>
  const saved = { WebSocket: g.WebSocket, XMLHttpRequest: g.XMLHttpRequest, console: { ...console } }
  const trap = (name: string) => (...args: unknown[]) => { trips.push(`${name} ${args.map(String).join(' ')}`) }
  g.WebSocket = class { constructor(...args: unknown[]) { trap('WebSocket')(...args) } }
  g.XMLHttpRequest = class { open(...args: unknown[]) { trap('XMLHttpRequest')(...args) } }
  const sendBeacon = Object.getOwnPropertyDescriptor(globalThis.navigator, 'sendBeacon')
  Object.defineProperty(globalThis.navigator, 'sendBeacon', { configurable: true, value: trap('sendBeacon') })
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) console[method] = trap(`console.${method}`)
  const game = createGame({ fetch: wrapped, storage: memoryStorage(), now: () => server.now(), setTimeout: () => 0, clearTimeout: () => {}, toast: () => {} })
  try {
    assert.equal(await game.connect(), true)
    assert.equal((await game.command('estate.set-lga', { lga: 'ikeja', via: 'manual' })).ok || game.state.value.estate.lga === 'ikeja', true)
    const residence = game.view.value.estate.residence
    assert.ok(residence && residence.lga === 'ikeja' && residence.city === 'lagos', 'the main home is Ikeja')
    const before = outgoing.length

    // The device is in Ikeja.
    const inside = device(IKEJA)
    assert.equal(await checkResidence({ city: residence.city, lga: residence.lga }, { geolocation: inside.geolocation, secure: true, api: loadLocateApi }), 'confirmed')
    assert.equal(outgoing.length, before, 'the check itself sends nothing')
    const sent = await game.resend(game.newId(), 'estate.confirm-residence', { lga: residence.lga, ok: true })
    assert.equal(sent.ok, true)
    assert.ok(game.view.value.estate.residence?.confirmed, 'the server recorded it')

    // The device is in Paris: the check says no and nothing at all is sent.
    const away = device(PARIS)
    const mark = outgoing.length
    assert.equal(await checkResidence({ city: residence.city, lga: residence.lga }, { geolocation: away.geolocation, secure: true, api: loadLocateApi }), 'outside')
    assert.equal(outgoing.length, mark, 'a mismatch sends nothing')

    // Everything the page sent while all this ran.
    const actions = outgoing.filter((line) => line.includes('estate.confirm-residence'))
    assert.equal(actions.length, 1)
    const body = JSON.parse(actions[0]!.slice(actions[0]!.indexOf('{'))) as Record<string, unknown>
    assert.deepEqual(body.payload, { lga: 'ikeja', ok: true }, 'the whole payload: the id and a boolean')
    assert.deepEqual(Object.keys(body).sort(), ['actionId', 'cityId', 'payload', 'type'])
    const everything = outgoing.join('\n')
    for (const needle of ['6.60', '3.35', '48.85', '2.35', 'latitude', 'longitude', 'accuracy', 'coords', 'altitude']) assert.ok(!everything.includes(needle), `no "${needle}" in anything sent`)
    assert.deepEqual(trips, [], 'no socket, beacon, XHR or console line while the check ran')
  } finally {
    game.stop()
    g.WebSocket = saved.WebSocket; g.XMLHttpRequest = saved.XMLHttpRequest
    if (sendBeacon) Object.defineProperty(globalThis.navigator, 'sendBeacon', sendBeacon); else Reflect.deleteProperty(globalThis.navigator, 'sendBeacon')
    Object.assign(console, saved.console)
  }
})

test('a position object can never be serialised into an analytics event or an error report', () => {
  const coordinates = Object.create({ get latitude() { return 6.601838 }, get longitude() { return 3.351486 }, get accuracy() { return 25 } }) as object
  const position = { coords: { latitude: 6.601838, longitude: 3.351486, accuracy: 25, altitude: 12.5, heading: 90, speed: 3.25 }, timestamp: 1760000000000 }
  const leaks = (value: unknown): string[] => { const text = JSON.stringify(value) ?? ''; return ['6.6018', '3.3514', '12.5', '3.25', '1760000000000'].filter((needle) => text.includes(needle)) }
  assert.deepEqual(leaks(scrubProps(position)), [])
  assert.deepEqual(scrubProps({ ...position.coords, position, coords: position.coords, geolocation: position, accuracy: 25, altitude: 12.5, heading: 90, speed: 3 }), {})
  assert.deepEqual(scrubProps({ coordinates }), {})
  for (const text of [JSON.stringify(position), `{"latitude":6.601838,"longitude":3.351486,"accuracy":25}`, 'accuracy=25 altitude=12.5', `Error at ${position.coords.latitude}, ${position.coords.longitude}`, String(position.coords.latitude) + ',' + position.coords.longitude]) {
    const clean = scrubText(text)
    assert.ok(!/6\.6018|3\.3514|12\.5/.test(clean), clean)
  }
  assert.deepEqual(leaks(scrubEvent({ name: 'screen_view', props: { screen: 'home', ...position.coords, position } })), [])
  assert.deepEqual(leaks(cleanEvent({ event: 'screen_view', properties: { screen: 'home', position, ...position.coords } })), [])
  assert.deepEqual(leaks(captureArgs({ name: 'screen_view', props: { screen: 'home', position, ...position.coords } })), [])
})

/** Every .ts, .vue and .js source under these folders that is not a test. */
function sources(folder: string): string[] {
  return readdirSync(join(root, folder)).flatMap((entry) => {
    const path = join(root, folder, entry)
    if (entry === 'node_modules' || entry === 'dist') return []
    if (statSync(path).isDirectory()) return sources(join(folder, entry))
    return /\.(ts|vue|js)$/.test(entry) && !/\.test\.(ts|js)$/.test(entry) ? [relative(root, path).split(sep).join('/')] : []
  })
}

test('only the on-device check reads a position, and those files hold no way to send, log or store it', () => {
  // Keep detecting aliased coordinate reads, but don't treat a spread's final
  // dot in `...coords.values()` as a property access.
  const coordinateRead = /(?<!\.)\.coords\b/
  assert.equal(coordinateRead.test('alias.coords.latitude'), true)
  assert.equal(coordinateRead.test('...coords.values()'), false)
  const reading = sources('src').concat(sources('server'), sources('deploy')).filter((file) => {
    const source = readFileSync(join(root, file), 'utf8')
    return /getCurrentPosition|watchPosition|GeolocationPosition|navigator\.geolocation/.test(source) || coordinateRead.test(source)
  })
  assert.deepEqual(reading.sort(), ['src/app/features/locate/locateModel.ts', 'src/app/features/start/findCity.ts', 'src/app/features/world/lgaCardModel.ts'])
  for (const file of reading) {
    const code = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/watchPosition/.test(code), `${file}: the position is never watched`)
    assert.ok(!/\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|postMessage)\b|\.send\(|console\.|captureException|\btrack\(|\.command\(|\.resend\(/.test(code), `${file}: no way out for the position`)
  }
  // The map code that does the arithmetic keeps nothing either.
  for (const file of ['src/map3d/residence.ts']) {
    const code = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|localStorage|sessionStorage|console\.)/.test(code), file)
  }
  // The payload builders: the card sends only the id and a boolean, and the action's server side reads nothing else.
  const card = readFileSync(join(root, 'src/app/features/locate/ResidenceCard.vue'), 'utf8')
  assert.ok(card.includes("{ lga: r.lga, ok: true }") && !/latitude|longitude|coords|accuracy|position/i.test(card.replace(/\/\/.*$/gm, '').replace(/aria-label="[^"]*"/g, '').replace(/position is never[^<'"]*/g, '')))
})
