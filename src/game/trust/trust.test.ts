import test from 'node:test'
import assert from 'node:assert/strict'
import { atLeast, lineParts, NEW_ACCOUNT_COOLDOWN_MS, outboundLink, postBlock, screenFee, TRUST_TIERS } from './index.ts'
import type { PosterFacts } from './index.ts'

const FEE_REQUESTS = [
  'Pay 5k to register',
  'pay N5,000 to apply for the job',
  'Registration na 2k',
  'registration fee is ₦3,500, send am to my account',
  'Kindly pay your processing fee before you resume',
  'you go first pay 3k',
  'You go pay 2k before you start work',
  'send 3k for the form',
  'drop 2k first make I hold the slot',
  'Training fee: 10k',
  'Pay a small refundable deposit to secure the job',
  'deposit of 5000 naira and the phone is yours',
  'Send me money b4 delivery',
  'Abeg transfer the upfront fee',
  'pay 1500 to get the job',
  'Only 2k activation fee and you start earning',
  'pay before you see am, no wahala',
]
const DOUBLING = [
  'Double your money in 7 days',
  'Your money go double sharp sharp',
  'invest 10k get 20k',
  'Invest N50,000 and receive N100,000 next week',
  '30% weekly returns guaranteed',
  'forex investment with account manager, DM',
  'Bitcoin profit every day',
  'guaranteed returns, no risk',
  'flip 5k to 50k',
]
const FINE = [
  'No registration fee, just come',
  'Never pay before you see the goods',
  'Dont pay anybody before delivery o',
  'The job is fee-free',
  'registration is free',
  'How much is the JAMB registration fee?',
  'JAMB registration fee is 6200 this year',
  'I paid my school fees yesterday',
  'The shoe na 5k, you go pay when e reach',
  'Pay on delivery only',
  'This bag cost 12k',
  'Registration fee: none',
  'I lost money to a forex scam',
  'I go double back to the market',
  'Who wan play ludo?',
  'beware of anyone asking for a deposit',
  'my phone na 3 years old',
  'that deposit thing is a scam',
]

test('the no-fee filter refuses fee requests in English and Pidgin', () => {
  for (const text of FEE_REQUESTS) assert.equal(screenFee(text)?.code, 'fee_request', text)
})
test('the no-fee filter refuses money-doubling offers', () => {
  for (const text of DOUBLING) assert.equal(screenFee(text)?.code, 'money_doubling', text)
})
test('warnings, prices and school fees pass the no-fee filter', () => {
  for (const text of FINE) assert.equal(screenFee(text), null, text)
})
test('a refusal says why in a plain sentence', () => {
  assert.match(screenFee('pay 2k to register', { what: 'Your stall name' })?.reason ?? '', /^Your stall name was not sent: .*nobody pays to apply/)
})

test('only allow-listed https links pass', () => {
  const allowed = ['https://wa.me/2348012345678', 'wa.me/2348012345678', 'https://www.instagram.com/ada.bakes', 'instagram.com/ada.bakes', 'selar.co/abc', 'https://selar.com/abc',
    'https://paystack.com/pay/ada-cakes', 'paystack.shop/ada', 'https://flutterwave.com/pay/ada', 'https://flutterwave.com/store/ada']
  for (const text of allowed) assert.ok(outboundLink(text), text)
  const refused = ['http://wa.me/234801', 'https://wa.me.evil.ng/x', 'https://evilwa.me/x', 'https://bit.ly/abc', 'https://paystack.com/', 'https://paystack.com/careers', 'https://flutterwave.com/',
    'https://user:pw@instagram.com/x', 'https://instagram.com:8443/x', 'javascript:alert(1)', 'https://xn--instagram-abc.com', 'https://1.2.3.4/x', 'ftp://wa.me/1', 'wa.me /x', '',
    'https://paystack.com/pay/../careers', 'https://paystack.com/pay/%2E%2e/careers', 'https://wa.me\\@evil.com/x', 'https://wa.me/x"onclick=1']
  for (const text of refused) assert.equal(outboundLink(text), null, text)
  assert.deepEqual(outboundLink('https://WWW.Instagram.com/ada.'), { url: 'https://www.instagram.com/ada', host: 'instagram.com', site: 'Instagram' })
})
test('a chat line splits into text and allowed links', () => {
  const parts = lineParts('Order here: wa.me/2348012345678 or evil.com/x')
  assert.deepEqual(parts.map((part) => [part.text, part.link?.host ?? null]), [['Order here: ', null], ['wa.me/2348012345678', 'wa.me'], [' or evil.com/x', null]])
})

test('tiers rank in order and gate posting', () => {
  assert.deepEqual([...TRUST_TIERS], ['guest', 'claimed', 'phone', 'id', 'business'])
  assert.ok(atLeast('business', 'id') && atLeast('phone', 'phone') && !atLeast('claimed', 'phone'))
  const now = 10 * NEW_ACCOUNT_COOLDOWN_MS
  const facts = (over: Partial<PosterFacts>): PosterFacts => ({ tier: 'id', adult: true, accountAt: 0, held: false, now, ...over })
  assert.equal(postBlock('stall', facts({ tier: 'guest' }))?.code, 'account_required')
  assert.equal(postBlock('stall', facts({ tier: 'claimed' }))?.code, 'verification_required')
  assert.match(postBlock('stall', facts({ tier: 'claimed' }))?.reason ?? '', /coming soon/)
  assert.equal(postBlock('stall', facts({ tier: 'phone' })), null)
  assert.equal(postBlock('gig', facts({ tier: 'phone' }))?.code, 'verification_required')
  assert.equal(postBlock('class', facts({})), null)
  assert.equal(postBlock('meetup', facts({ adult: null }))?.code, 'age_required')
  assert.equal(postBlock('meetup', facts({ adult: false }))?.code, 'adults_only')
  assert.equal(postBlock('meetup', facts({})), null)
  assert.equal(postBlock('gig', facts({ held: true }))?.code, 'listings_held')
  const fresh = postBlock('stall', facts({ tier: 'phone', accountAt: now - 3600000 * 2.5 }))
  assert.equal(fresh?.code, 'account_too_new')
  assert.match(fresh?.reason ?? '', /22 hours/)
})
