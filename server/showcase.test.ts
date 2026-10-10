import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await preloadCityContent('lagos');
// OWNER: showcase — showcase shops on the Node host: who may publish, what may be written, the links, slots, photos, the
// lifecycle and the operator's review, the contact release, reports, and what an account delete takes with it.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { emailHash } from './social/founder.ts';
import { createServer } from './server.ts';
import { SHOWCASE } from '../src/types/showcase.ts';
import type { ShowcaseCollection, ShowcaseShop } from '../src/types/showcase.ts';
import { jpeg, shopBody, toBase64 } from './testing/showcasePictures.ts';
import { pruneContacts } from './showcase/data.ts';
import { createFileImages } from './social/image-files.ts';
import { keepAlways } from './showcase/image-files.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const PROJECT = 'allworld-test-project', FOUNDER = 'founder.test@example.com', OPERATOR = 'operator-token-for-tests-0123456789';
const DAY = 86400000;
type Json = Record<string, any>;
async function setup(t: TestContext, env: Json = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const f = await fixture(t, { moderatorToken: OPERATOR, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', FOUNDER_EMAIL_SHA256: emailHash(FOUNDER), NEW_SESSIONS_PER_ADDRESS: '1000', ...env }, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }) });
  const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Json> => {
    const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Origin: f.base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get('content-type') ?? '';
    return type.includes('json') ? { status: res.status, ...(await res.json() as object) } : { status: res.status, type, bytes: new Uint8Array(await res.arrayBuffer()) };
  };
  let minted = 0;
  const guest = async (name: string): Promise<Device> => { const d = await f.device(name); await f.request('/api/life?city=lagos', null, d.cookie); return d; };
  const token = (address: string) => signToken(key, claimsFor(PROJECT, f.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }));
  async function account(address: string, name: string): Promise<Device> {
    const d = await guest(name);
    const { csrf } = await call('/api/account', undefined, d.cookie);
    const res = await fetch(f.base + '/api/account/sign-in', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json', Cookie: d.cookie }, body: JSON.stringify({ idToken: await token(address), csrf }) });
    assert.equal(res.status, 200);
    return { ...d, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? d.cookie };
  }
  const adult = async (d: Device) => assert.equal((await call('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, d.cookie)).ok, true);
  const founder = await account(FOUNDER, 'Founder');
  const check = async (d: Device) => assert.equal((await call(`/api/admin/trust/players/${d.id}/act`, { clientId: f.id(), action: 'verify', tier: 'phone', reason: 'met in person' }, founder.cookie)).ok, true);
  const op = (path: string, body?: unknown) => call(`/api/mod/showcase${path}`, body, undefined, { Authorization: `Bearer ${OPERATOR}` });
  /** A seller who may publish: an account, an adult, phone checked, and a day old. */
  async function seller(address: string, name: string): Promise<Device> { const d = await account(address, name); await adult(d); await check(d); return d; }
  const ready = () => f.advance(DAY + 1);
  const save = (d: Device, over: Json = {}, revision = 0) => call('/api/showcase/mine', { clientId: f.id(), expectedRevision: revision, ...shopBody(over) }, d.cookie);
  const upload = (d: Device, data = jpeg(2000), type = 'image/jpeg') => call('/api/showcase/mine/photos', { clientId: f.id(), type, data: toBase64(data) }, d.cookie);
  const post = (d: Device, path: string, body: Json = {}) => call(path, { clientId: f.id(), ...body }, d.cookie);
  const rev = async (d: Device): Promise<number> => (await call('/api/showcase/mine', undefined, d.cookie)).shop?.revision ?? 0;
  const edit = async (d: Device, over: Json = {}) => save(d, over, await rev(d));
  const stored = <T>(read: (c: ShowcaseCollection) => T): Promise<T> => f.server.store.read((db) => JSON.parse(JSON.stringify(read(db.showcase ?? { v: 1, seq: 0, shops: {}, owners: {}, contacts: {} }))) as T);
  /** A shop with its minimum photos, submitted and approved. */
  async function live(d: Device, over: Json = {}): Promise<string> {
    const made = await save(d, over); assert.equal(made.ok, true, JSON.stringify(made));
    for (let i = 0; i < SHOWCASE.photosMin; i += 1) assert.equal((await upload(d, jpeg(2000 + i))).ok, true);
    assert.equal((await post(d, '/api/showcase/mine/submit')).status, 'review');
    assert.equal((await op('', { action: 'approve', shop: made.id })).status, 'live');
    return made.id as string;
  }
  return { f, call, rev, edit, guest, account, adult, check, founder, op, seller, ready, save, upload, post, stored, live, token, key };
}

test('who may publish: a guest, an unchecked adult, an undeclared adult, a minor, a new account and a held seller are each refused with a reason', async (t) => {
  const s = await setup(t);
  const g = await s.guest('Guest');
  assert.equal((await s.save(g)).error, 'account_required');
  assert.equal((await s.call('/api/showcase/mine', undefined, g.cookie)).error, 'account_required');
  const ada = await s.account('ada@example.com', 'Ada');
  assert.equal((await s.save(ada)).error, 'adult_self_declaration_required', 'an adult\'s own word is needed');
  assert.equal((await s.call('/api/showcase/mine', undefined, ada.cookie)).blocked, 'adult_self_declaration_required');
  await s.adult(ada);
  assert.equal((await s.save(ada)).error, 'verification_required', 'phone checked tier');
  await s.check(ada);
  assert.equal((await s.save(ada)).error, 'account_too_new', 'the 24 hour wait');
  const kid = await s.account('kid@example.com', 'Kid');
  assert.equal((await s.call('/api/growth/consent', { cityId: 'lagos', age: 'minor' }, kid.cookie)).ok, true);
  assert.equal((await s.save(kid)).error, 'adults_only');
  s.ready();
  const made = await s.save(ada);
  assert.deepEqual([made.ok, made.code, made.revision, made.status], [true, 'created', 1, 'draft']);
  // Three upheld complaints hold the seller: no more edits and the shop leaves the directory.
  await s.f.server.store.transact((db) => { const trust = (db.trust ??= { v: 1, players: {}, reviewed: {}, reports: [], seq: 0 }); for (let i = 0; i < 3; i += 1) trust.reports.push({ id: `T-${i}`, about: ada.id, aboutName: 'Ada', by: `x${i}`, reason: 'scam', note: '', at: s.f.now(), status: 'upheld', decided: s.f.now() }); });
  assert.equal((await s.save(ada, {}, 1)).error, 'listings_held');
  assert.equal((await s.call('/api/showcase/mine', undefined, ada.cookie)).blocked, 'listings_held');
});

test('every text a seller writes is screened: a link, a phone number, a handle, an address and a fee request are each refused in every field', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  const bad: [string, string][] = [['visit www.adabraids.com', 'links_not_allowed'], ['call 08012345678 now', 'contact_not_allowed'], ['ig: adabraids', 'contact_not_allowed'], ['I am at 12 Allen Avenue', 'home_address_not_allowed'], ['pay 5k registration fee', 'fee_request']];
  const fields: [string, (text: string) => Json][] = [
    ['name', (text) => ({ name: `Ada ${text}`.slice(0, 40) })], ['sign', (text) => ({ sign: text.slice(0, 24) })], ['about', (text) => ({ about: text })],
    ['label', (text) => ({ services: [{ label: text.slice(0, 40), priceNaira: 1000, note: '' }] })], ['note', (text) => ({ services: [{ label: 'Braids', priceNaira: 1000, note: text.slice(0, 80) }] })],
  ];
  for (const [name, make] of fields) for (const [text, code] of bad) {
    const refused = await s.save(ada, make(text));
    assert.equal(refused.error, code, `${name}: ${text}`);
  }
  assert.equal((await s.stored((c) => Object.keys(c.shops).length)), 0, 'nothing was saved');
  assert.equal((await s.save(ada, { phone: '08012345678' })).error, 'unsupported_shop_field');
  assert.equal((await s.save(ada, { fee: 5000 })).error, 'unsupported_shop_field');
  assert.equal((await s.save(ada, { services: [{ label: 'Braids', priceNaira: 100000001, note: '' }] })).error, 'invalid_shop');
  assert.equal((await s.save(ada, { services: [{ label: 'Braids', priceNaira: 12.5, note: '' }] })).error, 'invalid_shop');
  assert.equal((await s.save(ada, { name: 'Hi' })).error, 'invalid_shop');
  assert.equal((await s.save(ada, { category: 'casino' })).error, 'invalid_shop');
  assert.equal((await s.save(ada, { venue: 'park' })).error, 'market_required');
  assert.equal((await s.save(ada, { city: 'atlantis' })).error, 'invalid_city');
  assert.equal((await s.save(ada, { hours: [null, null] })).error, 'invalid_shop');
});

test('outside links: only allow-listed hosts of the right kind, normalised, and the pay link is optional', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  for (const url of ['https://paystack.com/pay/ada', 'https://evil.example/wa', 'https://wa.me.evil.ng/1', 'http://wa.me/234', 'javascript:alert(1)', 'https://selar.co/ada']) assert.equal((await s.save(ada, { chat: { url } })).error, 'chat_link_not_allowed', url);
  for (const url of ['https://wa.me/2348012345678', 'https://instagram.com/adabraids']) assert.equal((await s.save(ada, { chat: { url } }, (await s.call('/api/showcase/mine', undefined, ada.cookie)).shop?.revision ?? 0)).ok, true, url);
  for (const url of ['https://wa.me/2348012345678', 'https://instagram.com/ada', 'https://paystack.com/admin', 'https://evil.example/pay']) assert.equal((await s.save(ada, { pay: { url } }, 2)).error, 'pay_link_not_allowed', url);
  assert.equal((await s.save(ada, { chat: { url: 'https://wa.me/2348012345678', kind: 'instagram' } }, 2)).error, 'chat_link_not_allowed', 'a kind that does not match the host');
  assert.equal((await s.save(ada, { pay: null }, 2)).ok, true);
  const mine = await s.call('/api/showcase/mine', undefined, ada.cookie);
  assert.deepEqual([mine.shop.chat, mine.shop.pay], [{ url: 'https://wa.me/2348012345678', kind: 'whatsapp' }, null]);
  assert.equal((await s.save(ada, { pay: { url: 'selar.co/ada/tailoring' } }, 3)).ok, true);
  assert.deepEqual((await s.call('/api/showcase/mine', undefined, ada.cookie)).shop.pay, { url: 'https://selar.co/ada/tailoring', kind: 'selar' });
});

test('slots are unique per market, first come first served, and capped', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'), bola = await s.seller('bola@example.com', 'Bola'), chi = await s.seller('chi@example.com', 'Chi'); s.ready();
  assert.equal((await s.save(ada, { slot: 5 })).ok, true);
  assert.equal((await s.call('/api/showcase/mine', undefined, ada.cookie)).shop.slot, 5);
  assert.equal((await s.save(bola, { slot: 5 })).error, 'slot_taken');
  assert.equal((await s.save(bola, { slot: 99 })).error, 'invalid_shop');
  assert.equal((await s.save(bola)).ok, true);
  assert.equal((await s.call('/api/showcase/mine', undefined, bola.cookie)).shop.slot, 1, 'the lowest free slot');
  // Fill the rest of the market; the last seller finds it full.
  await s.f.server.store.transact((db) => {
    const collection = (db.showcase ??= { v: 1, seq: 100, shops: {}, owners: {}, contacts: {} });
    const taken = new Set(Object.values(collection.shops).map((shop) => shop.slot));
    let n = 100;
    for (let slot = 1; slot <= SHOWCASE.slotsPerVenue; slot += 1) if (!taken.has(slot)) { n += 1; const id = `SC-${n}`; collection.shops[id] = { ...(Object.values(collection.shops)[0] as ShowcaseShop), id, owner: `filler-${n}`, slot, photos: [] }; }
  });
  assert.equal((await s.save(chi)).error, 'market_full');
  // Editing keeps your slot; removing frees it.
  assert.equal((await s.save(ada, { name: 'Ada Braids Two' }, 1)).ok, true);
  assert.equal((await s.call('/api/showcase/mine', undefined, ada.cookie)).shop.slot, 5);
  assert.equal((await s.post(ada, '/api/showcase/mine/remove')).code, 'removed');
  assert.equal((await s.save(chi, { slot: 5 })).ok, true);
});

test('photos: parsed and rewritten, capped in size and count, limited per day, kept in a store of their own, and read by the right people', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  assert.equal((await s.upload(ada)).error, 'no_shop', 'a shop first');
  await s.save(ada);
  const odd = await s.upload(ada, new TextEncoder().encode('not a picture at all'), 'image/jpeg');
  assert.deepEqual([odd.ok, odd.code], [false, 'picture_rejected']);
  assert.equal((await s.upload(ada, jpeg(500), 'image/png')).code, 'picture_rejected', 'the bytes must be what the browser says');
  assert.equal((await s.call('/api/showcase/mine/photos', { clientId: s.f.id(), type: 'image/jpeg', data: 'not base64!' }, ada.cookie)).error, 'invalid_picture');
  const big = await s.upload(ada, jpeg(160000));
  assert.deepEqual([big.ok, big.code], [false, 'picture_rejected'], '150 kB each');
  const first = await s.upload(ada, jpeg(140000)); assert.equal(first.ok, true);
  const exif = jpeg(3000, { exif: true });
  const second = await s.upload(ada, exif); assert.equal(second.ok, true);
  const body = await s.call(`/api/showcase/photo/${second.photo}`, undefined, ada.cookie);
  assert.equal(body.status, 200); assert.equal(body.type.startsWith('image/jpeg'), true);
  assert.ok(!Buffer.from(body.bytes).includes(Buffer.from('Exif')), 'metadata is dropped');
  for (let i = 0; i < SHOWCASE.photosMax - 2; i += 1) assert.equal((await s.upload(ada, jpeg(1000 + i))).ok, true);
  assert.equal((await s.upload(ada)).error, 'photo_limit', 'six at most');
  const photos = (await s.call('/api/showcase/mine', undefined, ada.cookie)).shop.photos as Json[];
  assert.equal(photos.length, 6);
  // Ten uploads a day, however many are removed.
  for (let i = 0; i < 4; i += 1) { await s.post(ada, '/api/showcase/mine/photos/remove', { photo: photos[i]!.id }); assert.equal((await s.upload(ada, jpeg(900 + i))).ok, true, `upload ${i}`); }
  assert.equal((await s.call('/api/showcase/mine', undefined, ada.cookie)).uploadsLeft, 0);
  await s.post(ada, '/api/showcase/mine/photos/remove', { photo: photos[4]!.id });
  assert.equal((await s.upload(ada)).error, 'upload_limit');
  s.f.advance(DAY);
  assert.equal((await s.upload(ada)).ok, true, 'the next day');
  // Where the bytes are: a folder of their own, none of them in the chat picture folder.
  assert.ok((await readdir(join(s.f.dir, 'showcase-images'))).some((name) => name.endsWith('.img')));
  const chatFiles = await readdir(join(s.f.dir, 'chat-images')).catch(() => [] as string[]);
  assert.equal(chatFiles.length, 0);
  // The chat picture route does not serve them, and a stranger cannot read a photo before approval.
  const bola = await s.account('bola@example.com', 'Bola');
  assert.equal((await s.call(`/api/social/images/${second.photo}`, undefined, ada.cookie)).status, 404);
  assert.equal((await s.call(`/api/showcase/photo/${second.photo}`, undefined, bola.cookie)).status, 404, 'not public before approval');
  assert.equal((await s.call(`/api/showcase/photo/${second.photo}`)).status, 404);
  assert.equal((await s.call('/api/showcase/photo/zz')).status, 404);
});

test('the chat picture trim cannot reach showcase photos, and a full store refuses a new photo instead of deleting an old one', async (t) => {
  // A ceiling of a fifth of a megabyte: one photo of 150 kB fits, a second does not.
  const s = await setup(t, { SHOWCASE_IMAGES_MAX_MB: '0.2' });
  const ada = await s.seller('ada@example.com', 'Ada'), bola = await s.seller('bola@example.com', 'Bola'); s.ready();
  await s.save(ada); await s.save(bola);
  const one = await s.upload(ada, jpeg(140000)); assert.equal(one.ok, true);
  const refused = await s.upload(bola, jpeg(140000));
  assert.deepEqual([refused.status, refused.error], [503, 'picture_store_full']);
  assert.equal((await s.call(`/api/showcase/photo/${one.photo}`, undefined, ada.cookie)).status, 200, 'the old photo is still there');
  // The folders are apart, and the showcase wrapper never evicts what the chat store would drop.
  const folder = await mkdtemp(join(tmpdir(), 'showcase-trim-'));
  try {
    const chat = createFileImages(join(folder, 'chat')), shown = keepAlways(createFileImages(join(folder, 'showcase')));
    const picture = jpeg(500), facts = { id: 'a'.repeat(32), conv: 'SC-1', at: 1, size: picture.length, type: 'jpeg' as const };
    await chat.put(facts, picture); await shown.put(facts, picture);
    assert.deepEqual(await chat.trim(1e12, 0), [facts.id], 'the chat store drops anything old or over its ceiling, whatever the conversation');
    assert.deepEqual(await shown.trim(1e12, 0), [], 'the showcase store drops nothing');
    assert.ok(await shown.get(facts.id));
  } finally { await rm(folder, { recursive: true, force: true }); }
  const files = await readdir(join(s.f.dir, 'showcase-images'));
  assert.equal(files.filter((name) => name.endsWith('.img')).length, 1);
});

test('the lifecycle: draft, review, live; name, chat and pay changes go back to review; the pay change notice lasts seven days', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'), bola = await s.account('bola@example.com', 'Bola'); s.ready();
  const made = await s.save(ada); const id = made.id as string;
  assert.equal((await s.post(ada, '/api/showcase/mine/submit')).error, 'photos_needed');
  for (let i = 0; i < 3; i += 1) await s.upload(ada, jpeg(1000 + i));
  assert.equal((await s.call(`/api/showcase/${id}`, undefined, bola.cookie)).error, 'shop_unavailable', 'a draft is not public');
  assert.equal((await s.post(ada, '/api/showcase/mine/submit')).status, 'review');
  assert.equal((await s.call(`/api/showcase/${id}`, undefined, bola.cookie)).error, 'shop_unavailable', 'nor is one in review');
  assert.equal((await s.call('/api/showcase/directory')).shops.length, 0);
  const queue = await s.op('');
  assert.deepEqual(queue.queue.map((item: Json) => [item.id, item.status]), [[id, 'review']]);
  assert.ok(queue.queue[0].chat.includes('wa.me'), 'the operator sees the destinations');
  assert.equal((await s.op('', { action: 'approve', shop: id })).status, 'live');
  assert.equal((await s.op('', { action: 'approve', shop: id })).error, 'not_in_review');
  const page = await s.call(`/api/showcase/${id}`);
  assert.equal(page.shop.name, 'Ada Braids'); assert.equal(page.shop.photos.length, 3, 'photos are public once approved');
  assert.equal(page.shop.priceLabel, 'Seller’s price, paid outside Allworld'); assert.equal(page.shop.payNotice, null);
  // Other edits are live at once.
  const edited = await s.edit(ada, { about: 'New about text for the shop, still plain.', services: [{ label: 'Cornrows', priceNaira: 9000, note: '' }] });
  assert.equal(edited.status, 'live');
  assert.equal((await s.call(`/api/showcase/${id}`)).shop.serviceList[0].label, 'Cornrows');
  // A new photo after approval is public at once.
  const added = await s.upload(ada, jpeg(1500));
  assert.equal((await s.call(`/api/showcase/photo/${added.photo}`)).status, 200);
  // A changed name returns to review and leaves the page until approved.
  const renamed = await s.edit(ada, { name: 'Ada Hair Studio', about: 'New about text for the shop, still plain.', services: [{ label: 'Cornrows', priceNaira: 9000, note: '' }] });
  assert.equal(renamed.status, 'review');
  assert.equal((await s.call(`/api/showcase/${id}`)).error, 'shop_unavailable');
  await s.op('', { action: 'approve', shop: id });
  const same = { about: 'New about text for the shop, still plain.', services: [{ label: 'Cornrows', priceNaira: 9000, note: '' }], name: 'Ada Hair Studio' };
  // The chat link, then the pay link, each back to review.
  assert.equal((await s.edit(ada, { ...same, chat: { url: 'https://instagram.com/adahair' } })).status, 'review'); await s.op('', { action: 'approve', shop: id });
  const pay = await s.edit(ada, { ...same, chat: { url: 'https://instagram.com/adahair' }, pay: { url: 'https://selar.co/ada' } });
  assert.equal(pay.status, 'review'); await s.op('', { action: 'approve', shop: id });
  assert.equal((await s.call(`/api/showcase/${id}`)).shop.payNotice, 'Payment details changed recently');
  s.f.advance(7 * DAY - 1000);
  assert.equal((await s.call(`/api/showcase/${id}`)).shop.payNotice, 'Payment details changed recently', 'still inside seven days');
  s.f.advance(2000);
  assert.equal((await s.call(`/api/showcase/${id}`)).shop.payNotice, null, 'then gone');
  // Hiding by the seller and by an operator.
  assert.equal((await s.post(ada, '/api/showcase/mine/hide', { hidden: true })).status, 'hidden');
  assert.equal((await s.call(`/api/showcase/${id}`, undefined, bola.cookie)).error, 'shop_unavailable');
  assert.equal((await s.post(ada, '/api/showcase/mine/hide', { hidden: false })).status, 'live');
  assert.equal((await s.op('', { action: 'hide', shop: id, reason: 'checking a complaint' })).status, 'held');
  assert.equal((await s.post(ada, '/api/showcase/mine/hide', { hidden: false })).error, 'shop_held');
  assert.equal((await s.edit(ada, same)).error, 'shop_held');
  assert.equal((await s.op('', { action: 'restore', shop: id })).status, 'live');
  assert.equal((await s.op('', { action: 'bogus', shop: id })).error, 'invalid_action');
  assert.equal((await s.op('', { action: 'approve', shop: 'SC-999' })).error, 'unknown_shop');
});

test('the operator routes answer only with the token', async (t) => {
  const s = await setup(t);
  assert.equal((await s.call('/api/mod/showcase')).status, 401);
  assert.equal((await s.call('/api/mod/showcase', { action: 'approve', shop: 'SC-1' })).status, 401);
  assert.equal((await s.call('/api/mod/showcase/photo/' + 'a'.repeat(32))).status, 401);
  assert.equal((await s.op('')).status, 200);
  const audit = await s.f.server.store.read((db) => (db.moderation?.audit ?? []).map((line) => line.action));
  assert.ok(Array.isArray(audit));
});

test('no link is in the directory, a card or a shop page; go gives it to a signed-in adult, once per request, ten a day', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  const id = await s.live(ada);
  const guest = await s.guest('Guest'), minor = await s.account('kid@example.com', 'Kid'), buyer = await s.account('bola@example.com', 'Bola'), other = await s.account('chi@example.com', 'Chi');
  await s.call('/api/growth/consent', { cityId: 'lagos', age: 'minor' }, minor.cookie); await s.adult(buyer); await s.adult(other);
  const listing = await s.call('/api/showcase/directory?city=lagos&category=salon&q=braids');
  assert.equal(listing.shops.length, 1); assert.equal(listing.shops[0].id, id);
  for (const url of [JSON.stringify(listing), JSON.stringify(await s.call(`/api/showcase/${id}`)), JSON.stringify(await s.call(`/api/showcase/${id}`, undefined, buyer.cookie))]) {
    assert.ok(!/wa\.me|paystack|2348012345678|adabraids|https?:/i.test(url), url);
  }
  assert.equal(listing.shops[0].pay, true); assert.equal(listing.shops[0].from, 6000);
  // Browse by filters and search (name, sign, a service).
  assert.equal((await s.call('/api/showcase/directory?q=knotless')).shops.length, 1);
  assert.equal((await s.call('/api/showcase/directory?q=by%20ada')).shops.length, 1);
  assert.equal((await s.call('/api/showcase/directory?category=tailor')).shops.length, 0);
  assert.equal((await s.call('/api/showcase/directory?city=ibadan')).shops.length, 0);
  assert.equal((await s.call('/api/showcase/directory?after=nope')).error, 'invalid_cursor');
  // go: who may.
  assert.equal((await s.post(guest, `/api/showcase/${id}/go`, { kind: 'chat' })).error, 'account_required');
  assert.equal((await s.post(minor, `/api/showcase/${id}/go`, { kind: 'chat' })).error, 'adult_self_declaration_required');
  assert.equal((await s.post(ada, `/api/showcase/${id}/go`, { kind: 'chat' })).error, 'own_shop');
  const clientId = s.f.id();
  const first = await s.call(`/api/showcase/${id}/go`, { clientId, kind: 'chat' }, buyer.cookie);
  assert.deepEqual([first.status, first.link.url, first.link.site, first.requiresWarning, first.kind, first.badge.id], [200, 'https://wa.me/2348012345678', 'WhatsApp', true, 'chat', ada.id]);
  assert.ok(first.warning);
  const again = await s.call(`/api/showcase/${id}/go`, { clientId, kind: 'chat' }, buyer.cookie);
  assert.equal(again.duplicate, true); assert.equal(again.link.url, first.link.url);
  assert.equal(await s.stored((c) => Object.keys(c.contacts).length), 1, 'one contact event');
  const pay = await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'pay' });
  assert.equal(pay.link.url, 'https://paystack.com/pay/adabraids');
  const events = await s.stored((c) => Object.values(c.contacts));
  assert.deepEqual(events.map((event) => [event.shop, event.buyer, event.kind]), [[id, buyer.id, 'chat'], [id, buyer.id, 'pay']]);
  assert.equal((await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'mail' })).error, 'invalid_shop');
  for (let i = 0; i < SHOWCASE.goPerDay - 2; i += 1) assert.equal((await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'chat' })).status, 200);
  assert.equal((await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'chat' })).error, 'go_limit');
  assert.equal((await s.post(other, `/api/showcase/${id}/go`, { kind: 'chat' })).status, 200, 'the limit is per buyer');
  s.f.advance(DAY + 1);
  assert.equal((await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'chat' })).status, 200, 'and per day');
  // Events older than ninety days are pruned, and the oldest go first past the cap.
  const pile: ShowcaseCollection = { v: 1, seq: 0, shops: {}, owners: {}, contacts: {} };
  const now = 1000 * DAY;
  for (let i = 0; i < SHOWCASE.contacts; i += 1) pile.contacts[`SG-${i}`] = { id: `SG-${i}`, shop: 'SC-1', buyer: 'x', kind: 'chat', at: now - (i % 50) * DAY };
  pile.contacts['SG-old'] = { id: 'SG-old', shop: 'SC-1', buyer: 'x', kind: 'chat', at: now - 91 * DAY };
  pruneContacts(pile, now);
  assert.equal(pile.contacts['SG-old'], undefined);
  assert.ok(Object.keys(pile.contacts).length < SHOWCASE.contacts);
});

test('reports: a report goes to the trust queue, and two distinct reports hide one photo until an operator decides', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  const id = await s.live(ada);
  const [one, two, three] = [await s.account('b1@example.com', 'Bella'), await s.account('b2@example.com', 'Chidi'), await s.account('b3@example.com', 'Dayo')];
  const photo = ((await s.call(`/api/showcase/${id}`)).shop.photos as Json[])[0]!.id as string;
  assert.equal((await s.post(await s.guest('Guesty'), `/api/showcase/${id}/report`, { reason: 'scam' })).error, 'account_required');
  assert.equal((await s.post(ada, `/api/showcase/${id}/report`, { reason: 'scam' })).error, 'shop_unavailable', 'not your own');
  assert.equal((await s.post(one, `/api/showcase/${id}/report`, { reason: 'rude' })).error, 'invalid_reason');
  assert.equal((await s.post(one, `/api/showcase/${id}/report`, { reason: 'scam', photo: 'f'.repeat(32) })).error, 'unknown_photo');
  const first = await s.post(one, `/api/showcase/${id}/report`, { reason: 'scam', photo });
  assert.equal(first.ok, true); assert.equal(first.hidden, undefined);
  assert.equal((await s.call(`/api/showcase/photo/${photo}`)).status, 200);
  await s.post(one, `/api/showcase/${id}/report`, { reason: 'scam', photo });
  assert.equal((await s.call(`/api/showcase/photo/${photo}`)).status, 200, 'the same person twice is one report');
  const second = await s.post(two, `/api/showcase/${id}/report`, { reason: 'scam', photo });
  assert.equal(second.hidden, true);
  assert.equal((await s.call(`/api/showcase/photo/${photo}`)).status, 404, 'hidden for everyone');
  assert.equal((await s.call(`/api/showcase/photo/${photo}`, undefined, three.cookie)).status, 404);
  assert.equal((await s.call(`/api/showcase/photo/${photo}`, undefined, ada.cookie)).status, 200, 'the owner still sees it');
  assert.equal((await s.call(`/api/showcase/${id}`)).shop.photos.length, 2);
  const queue = await s.op('');
  assert.deepEqual(queue.queue[0].hiddenPhotos, [photo]);
  assert.equal((await s.call(`/api/mod/showcase/photo/${photo}`, undefined, undefined, { Authorization: `Bearer ${OPERATOR}` })).status, 200, 'the operator can look at it');
  assert.equal((await s.op('', { action: 'photo-restore', shop: id, photo })).code, 'photo-restore');
  assert.equal((await s.call(`/api/showcase/photo/${photo}`)).status, 200);
  await s.post(one, `/api/showcase/${id}/report`, { reason: 'scam', photo }); await s.post(two, `/api/showcase/${id}/report`, { reason: 'scam', photo });
  assert.equal((await s.op('', { action: 'photo-remove', shop: id, photo })).code, 'photo-remove');
  assert.equal((await s.call(`/api/showcase/photo/${photo}`, undefined, ada.cookie)).status, 404, 'removed for good');
  assert.equal(((await s.call('/api/showcase/mine', undefined, ada.cookie)).shop.status), 'draft', 'under the minimum it is a draft again');
  const trust = await s.f.server.store.read((db) => db.trust?.reports.length ?? 0);
  assert.ok(trust >= 2, 'reports reached the trust queue');
});

test('deleting an account removes the shop, its photos and its contact events; the export carries the seller\'s own shop', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  const id = await s.live(ada);
  const buyer = await s.account('bola@example.com', 'Bola'); await s.adult(buyer);
  await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'chat' });
  const csrf = (await s.call('/api/account', undefined, ada.cookie)).csrf;
  const exported = await s.call('/api/account/export', { idToken: await s.token('ada@example.com'), csrf }, ada.cookie);
  assert.equal(exported.showcase.shops.length, 1); assert.equal(exported.showcase.shops[0].chat.url, 'https://wa.me/2348012345678');
  assert.ok(!JSON.stringify(exported.showcase).includes('reports'));
  const files = (await readdir(join(s.f.dir, 'showcase-images'))).filter((name) => name.endsWith('.img'));
  assert.equal(files.length, 3);
  const gone = await s.call('/api/account/delete', { idToken: await s.token('ada@example.com'), csrf, confirm: 'delete', erase: true }, ada.cookie);
  assert.equal(gone.status, 200, JSON.stringify(gone));
  assert.deepEqual(await s.stored((c) => [Object.keys(c.shops).length, Object.keys(c.contacts).length, Object.keys(c.owners).length]), [0, 0, 0]);
  assert.equal((await readdir(join(s.f.dir, 'showcase-images'))).filter((name) => name.endsWith('.img')).length, 0, 'the picture files are gone');
  assert.equal((await s.call('/api/showcase/directory')).shops.length, 0);
});

test('a restart keeps shops, photos, the upload count and contact events (Node host, real file store)', async (t) => {
  const s = await setup(t);
  const ada = await s.seller('ada@example.com', 'Ada'); s.ready();
  const id = await s.live(ada);
  const buyer = await s.account('bola@example.com', 'Bola'); await s.adult(buyer);
  await s.post(buyer, `/api/showcase/${id}/go`, { kind: 'chat' });
  await s.f.flush();
  const saved = JSON.parse(await readFile(join(s.f.dir, 'devices.json'), 'utf8')) as { showcase?: ShowcaseCollection };
  assert.ok(saved.showcase, 'saved in the data file');
  assert.equal(Object.keys(saved.showcase.shops).length, 1); assert.equal(Object.keys(saved.showcase.contacts).length, 1);
  assert.ok(!JSON.stringify(saved.showcase.shops).includes('"reports":["'), 'no reporter on a clean shop');
  // Reopen the same folder with a new server: the shop page and a photo are served again.
  const second = await createServer({ dataDir: s.f.dir, now: () => s.f.now(), sessionTtlMs: 2592000000, moderatorToken: OPERATOR, env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' } });
  second.listen(0, '127.0.0.1'); await new Promise((done) => second.once('listening', done));
  t.after(async () => { second.closeAllConnections(); await new Promise<void>((done) => second.close(() => done())); await second.store.close?.().catch(() => {}); });
  const address = second.address(); if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;
  const page = await (await fetch(`${base}/api/showcase/${id}`)).json() as Json;
  assert.equal(page.shop?.name, 'Ada Braids'); assert.equal(page.shop.photos.length, 3);
  const photo = await fetch(`${base}/api/showcase/photo/${page.shop.photos[0].id}`);
  assert.equal(photo.status, 200);
  assert.equal(((await (await fetch(`${base}/api/showcase/directory`)).json()) as Json).shops.length, 1);
});
