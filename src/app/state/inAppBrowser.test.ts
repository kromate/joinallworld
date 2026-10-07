import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TIP_KEY, degradedFeatures, detectInAppBrowser, dismissTip, inAppTip, markInAppBrowser, tipDismissed } from './inAppBrowser.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const SAMPLES: [string, string | null][] = [
  [`${IPHONE} Mobile/15E148 Instagram 330.0.0.20.113`, 'Instagram'],
  ['Mozilla/5.0 (Linux; Android 13; TECNO KG7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]', 'Facebook'],
  [`${IPHONE} Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]`, 'Facebook'],
  ['Mozilla/5.0 (Linux; Android 12; Infinix X669) AppleWebKit/537.36 Chrome/119.0 Mobile Safari/537.36 musical_ly_30.1.0 BytedanceWebview/d8a21c6', 'TikTok'],
  [`${IPHONE} Mobile/15E148 Snapchat/12.80.0.40`, 'Snapchat'],
  ['Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0 Mobile Safari/537.36', 'webview'],
  [`${IPHONE} Mobile/15E148`, 'webview'],
  [`${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1`, null],
  ['Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', null],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1', null],
]

test('in-app browsers are recognised from the user agent; ordinary browsers are not', () => {
  for (const [ua, expected] of SAMPLES) assert.equal(detectInAppBrowser(ua), expected, ua)
  assert.equal(detectInAppBrowser(`${IPHONE} Mobile/15E148`, { standalone: true }), null, 'a home-screen app is not embedded')
})

const works = () => ({ setItem: () => undefined, removeItem: () => undefined })
const blocked = () => { throw new Error('SecurityError') }

test('blocked or missing storage and cookies are reported; working ones are not', () => {
  assert.deepEqual(degradedFeatures({}), [])
  assert.deepEqual(degradedFeatures({ localStorage: works, sessionStorage: works, cookiesEnabled: () => true }), [])
  assert.deepEqual(degradedFeatures({ localStorage: blocked, sessionStorage: () => null, cookiesEnabled: () => false }), ['localStorage', 'sessionStorage', 'cookies'])
  assert.deepEqual(degradedFeatures({ localStorage: () => ({ setItem: blocked, removeItem: () => undefined }) }), ['localStorage'])
})

test('the tip appears only inside an in-app browser that is blocking something', () => {
  const IG = SAMPLES[0]![0], plain = SAMPLES[8]![0]
  assert.equal(inAppTip(IG, { localStorage: works, cookiesEnabled: () => true }), null, 'a working in-app browser is left alone')
  assert.equal(inAppTip(plain, { localStorage: blocked }), null, 'an ordinary browser gets no tip')
  const tip = inAppTip(IG, { localStorage: blocked })
  assert.equal(tip?.app, 'Instagram')
  assert.equal(tip?.title, 'Open in your browser for the best experience.')
  assert.deepEqual(tip?.features, ['localStorage'])
})

test('the page is marked, and a closed tip is remembered where storage works and forgotten where it does not', () => {
  const attrs: Record<string, string> = {}
  const root = { setAttribute: (k: string, v: string) => { attrs[k] = v } }
  assert.equal(markInAppBrowser(root, SAMPLES[4]![0]), 'Snapchat')
  assert.equal(attrs['data-inapp'], 'Snapchat')
  assert.equal(markInAppBrowser(root, SAMPLES[8]![0]), null)
  const raw = new Map<string, string>()
  const store = { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v) } }
  assert.equal(tipDismissed(store), false)
  dismissTip(store)
  assert.equal(raw.get(TIP_KEY), '1'); assert.equal(tipDismissed(store), true)
  const broken = { getItem: blocked, setItem: blocked }
  dismissTip(broken); assert.equal(tipDismissed(broken), false); assert.equal(tipDismissed(null), false)
})
