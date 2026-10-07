// OWNER: politics — the public record on the Node host: written as things happen, open to anyone, sealed, and the state and national
// election news that reaches every resident. The pure parts are in server/records/records.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { QUORUM } from '../src/game/content/politics.ts';
import { GENESIS, verifyChain } from '../src/records/chain.ts';
import type { RecordsProof, RecordsResponse } from '../src/types/records.ts';
import { DAY, harness } from './testing/politicsHarness.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

const open = async (base: string, path: string): Promise<RecordsResponse & { status: number; error?: string }> => { const response = await fetch(base + path); return { ...(await response.json() as RecordsResponse), status: response.status }; };

test('the record is open to anyone, starts empty, and grows as parties are founded and terms end', { timeout: 90000 }, async (t) => {
  const { f, post, get, player, elect } = await harness(t);
  const empty = await open(f.base, '/api/world/records');
  assert.deepEqual([empty.status, empty.entries, empty.before, empty.count, empty.head], [200, [], null, 0, GENESIS]);
  const ada = await player('Ada'), governor = await player('Governor');
  assert.equal((await post('/api/politics/party/found', { cityId: 'lagos', name: 'Green Hands', motto: 'Plant more', colour: 'green', requestId: f.id() }, ada)).code, 'founded');
  const first = await open(f.base, '/api/world/records');
  assert.deepEqual(first.entries.map((entry) => [entry.kind, entry.scope, entry.facts.party]), [['party', 'world', 'Green Hands']]);
  assert.match(first.entries[0]?.title ?? '', /^Ada founded the Green Hands: “Plant more”$/);

  // A state Governor won last week; the news reaches a resident of the city, once, as Updates.
  await elect(governor, 'state:lagos', QUORUM.state);
  await get('/api/civic/pulse?city=lagos', ada);
  await post('/api/civic/pulse', {}, ada);
  const pulse = await get('/api/civic/pulse?city=lagos', ada) as unknown as { notices: { id: string; title: string }[] };
  assert.ok(pulse.notices.some((notice) => notice.id.startsWith('state-result-') && /Winner is the new Governor of Lagos State/.test(notice.title)), JSON.stringify(pulse.notices.map((notice) => notice.title)));
  const life = (await get('/api/life?city=lagos', ada)).state;
  assert.equal(life?.social.notices.filter((notice) => notice.text.includes('Elected with')).length ?? 0, 1, 'told once, in Updates');

  // The term is not in the record while it runs; a week later it is, and only once.
  assert.equal((await open(f.base, '/api/world/records?kind=term')).entries.length, 0);
  f.advance(8 * DAY);
  await get('/api/civic/pulse?city=lagos', ada);
  await get('/api/civic/pulse?city=lagos', ada);
  const terms = await open(f.base, '/api/world/records?kind=term');
  assert.equal(terms.entries.length, 1);
  assert.match(terms.entries[0]?.title ?? '', /^Governor Winner \(independent\) held Lagos State for the week of \d{4}-\d{2}-\d{2}, elected with 10 of 10 votes\.$/);
  f.advance(DAY);
  await get('/api/civic/pulse?city=lagos', ada);
  assert.equal((await open(f.base, '/api/world/records?kind=term')).entries.length, 1, 'written once');
});

test('pages go back through the record, can be filtered, are sealed, and bad questions are refused', { timeout: 90000 }, async (t) => {
  const { f, post, player } = await harness(t);
  const secrets: string[] = [];
  for (let index = 0; index < 5; index++) { const device = await player(`Founder${'abcde'[index]}`); secrets.push(device.cookie.slice(4)); assert.equal((await post('/api/politics/party/found', { cityId: 'lagos', name: `Party ${'ABCDE'[index]}ab`, motto: 'Together', colour: 'green', requestId: f.id() }, device)).code, 'founded'); }
  const all = await open(f.base, '/api/world/records?limit=5');
  assert.deepEqual(all.entries.map((entry) => entry.n), [5, 4, 3, 2, 1]);
  const two = await open(f.base, '/api/world/records?limit=2');
  assert.deepEqual([two.entries.map((entry) => entry.n), two.before], [[5, 4], 4]);
  const next = await open(f.base, `/api/world/records?limit=2&before=${two.before}`);
  assert.deepEqual(next.entries.map((entry) => entry.n), [3, 2]);
  assert.equal((await open(f.base, '/api/world/records?kind=ruling')).entries.length, 0);
  assert.equal((await open(f.base, '/api/world/records?scope=world')).entries.length, 5);
  for (const bad of ['kind=nonsense', 'scope=%3Cscript%3E', 'limit=0', 'limit=1000', 'before=-3', 'before=abc']) assert.equal((await open(f.base, `/api/world/records?${bad}`)).status, 400, bad);

  // The seal the page checks, and the proof of the head.
  assert.equal(verifyChain([...all.entries].reverse()).ok, true);
  const proof = await (await fetch(`${f.base}/api/world/records/proof`)).json() as RecordsProof;
  assert.deepEqual([proof.algorithm, proof.count, proof.head, proof.genesis], ['sha256', 5, all.entries[0]?.hash, GENESIS]);
  assert.equal(all.head, proof.head);
  const response = await fetch(`${f.base}/api/world/records`);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30');
  for (const secret of secrets) assert.ok(!JSON.stringify(all).includes(secret), 'no session secret in the record');
});
