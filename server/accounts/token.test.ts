// OWNER: accounts — ID token verification (server/accounts/token.ts) against keys made here. No test reaches a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_RETRY_AFTER_MS, KeysUnavailable, TOKEN_KEYS_URL, TokenError, createTokenVerifier } from './token.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './test-tokens.ts';
import type { TokenRefusal } from './token.ts';

const PROJECT = 'allworld-test-project';
const START = 1_800_000_000_000;
async function setup(options: { maxAge?: number } = {}) {
  const key = await makeKey('key-1');
  const provider = fakeProvider([key], options);
  let time = START;
  const verifier = createTokenVerifier({ projectId: PROJECT, fetch: provider.fetch, now: () => time });
  return { key, provider, verifier, now: () => time, advance: (ms: number) => { time += ms; } };
}
const refused = (refusal: TokenRefusal) => (error: unknown): boolean => error instanceof TokenError && error.refusal === refusal;

test('a valid token proves the subject, the verified address and the provider — and nothing else is returned', async () => {
  const f = await setup();
  const identity = await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { subject: 'UidOfAda0001', email: 'ada@example.com' })));
  const { digest, ...proved } = identity;
  assert.deepEqual(proved, { subject: 'UidOfAda0001', email: 'ada@example.com', emailVerified: true, provider: 'password', issuedAt: START, authAt: START, expiresAt: START + 3600000 });
  assert.match(digest, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { provider: 'google.com' })))).provider, 'google');
  assert.equal((await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { verified: false })))).emailVerified, false, 'an unverified address is reported as such, for the caller to refuse');
  assert.equal((await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { email_verified: 'true' })))).emailVerified, false, 'only the boolean true counts as verified');
});

test('expired, stale, future, wrong audience and wrong issuer are each refused', async () => {
  const f = await setup(), at = Math.floor(f.now() / 1000);
  const token = (extra: Record<string, unknown>) => signToken(f.key, claimsFor(PROJECT, f.now(), extra));
  await assert.rejects(f.verifier.verify(await token({ exp: at - 1 })), refused('expired'));
  await assert.rejects(f.verifier.verify(await token({ exp: at })), refused('expired'), 'a token is expired AT its expiry');
  await assert.rejects(f.verifier.verify(await token({ iat: at - 301 })), refused('stale'), 'issued more than five minutes ago');
  await assert.rejects(f.verifier.verify(await token({ auth_time: at - 3601 })), refused('stale'), 'the person signed in more than an hour ago');
  await assert.rejects(f.verifier.verify(await token({ iat: at + 61 })), refused('not_yet_valid'));
  await assert.rejects(f.verifier.verify(await token({ auth_time: at + 61 })), refused('not_yet_valid'));
  assert.ok(await f.verifier.verify(await token({ iat: at + 30 })), 'a clock half a minute ahead is allowed');
  await assert.rejects(f.verifier.verify(await token({ aud: 'another-project' })), refused('audience'));
  await assert.rejects(f.verifier.verify(await token({ aud: [PROJECT] })), refused('audience'), 'the audience is the project id itself, not a list holding it');
  await assert.rejects(f.verifier.verify(await token({ iss: 'https://securetoken.google.com/another-project' })), refused('issuer'));
  await assert.rejects(f.verifier.verify(await token({ iss: 'https://accounts.google.com' })), refused('issuer'), 'a Google sign-in token is not this project’s ID token');
  for (const missing of ['exp', 'iat', 'auth_time']) await assert.rejects(f.verifier.verify(await token({ [missing]: undefined })), refused('malformed'), missing);
  // A token that was good becomes stale, then expired, as time passes.
  const good = await token({});
  assert.ok(await f.verifier.verify(good));
  f.advance(301000); await assert.rejects(f.verifier.verify(good), refused('stale'));
  f.advance(3600000); await assert.rejects(f.verifier.verify(good), refused('expired'));
});

test('subject, provider and address must be what an account can be made of', async () => {
  const f = await setup();
  const token = (extra: Record<string, unknown>) => signToken(f.key, claimsFor(PROJECT, f.now(), extra));
  for (const sub of ['', 'has space', 'x'.repeat(129), 42, '__proto__/..']) await assert.rejects(f.verifier.verify(await token({ sub })), refused('subject'), String(sub));
  for (const provider of ['anonymous', 'custom', 'phone', 'facebook.com']) await assert.rejects(f.verifier.verify(await token({ firebase: { sign_in_provider: provider } })), refused('provider'), provider);
  await assert.rejects(f.verifier.verify(await token({ firebase: undefined })), refused('provider'));
  const nameless = claimsFor(PROJECT, f.now()); delete nameless.email;
  await assert.rejects(f.verifier.verify(await signToken(f.key, nameless)), refused('email'), 'no address at all');
  for (const email of ['', 'no-at-sign', 'two@@example.com', 'spa ce@example.com', `${'a'.repeat(250)}@example.com`]) await assert.rejects(f.verifier.verify(await token({ email })), refused('email'), String(email));
});

test('a bad signature, a changed payload, another key and another algorithm are refused before any claim is read', async () => {
  const f = await setup(), stranger = await makeKey('key-1'); // same key id, a different key
  const claims = claimsFor(PROJECT, f.now());
  await assert.rejects(f.verifier.verify(await signToken(stranger, claims)), refused('signature'), 'signed by a key that only claims the same id');
  await assert.rejects(f.verifier.verify(await signToken(f.key, claims, { tamper: { sub: 'SomeoneElse0001' } })), refused('signature'), 'the payload was changed after signing');
  await assert.rejects(f.verifier.verify(await signToken(f.key, claims, { tamper: { email_verified: true, email: 'victim@example.com' } })), refused('signature'));
  const good = await signToken(f.key, claims), [head, body, signature] = good.split('.') as [string, string, string];
  await assert.rejects(f.verifier.verify(`${head}.${body}.${signature.slice(0, -4)}AAAA`), refused('signature'));
  await assert.rejects(f.verifier.verify(`${head}.${body}.`), refused('malformed'));
  for (const alg of ['none', 'HS256', 'RS512', 'PS256', undefined]) await assert.rejects(f.verifier.verify(await signToken(f.key, claims, { header: { alg } })), refused('algorithm'), String(alg));
  // An unsigned token that names "none", and an HMAC "signed" with the public key, are the classic forgeries: both stop at the algorithm.
  const none = `${btoa(JSON.stringify({ alg: 'none', kid: 'key-1' })).replace(/=+$/, '')}.${body}.AAAA`;
  await assert.rejects(f.verifier.verify(none), refused('algorithm'));
  await assert.rejects(f.verifier.verify(await signToken(f.key, claims, { header: { kid: undefined } })), refused('malformed'));
  for (const junk of [undefined, null, 42, '', 'a.b.c', 'not a token at all', `${'a'.repeat(80)}.${'b'.repeat(80)}`, `${good}.extra`, `${head}.!!!.${signature}`, 'x'.repeat(5000)]) await assert.rejects(f.verifier.verify(junk), refused('malformed'), String(junk).slice(0, 20));
  // A wrong audience under a bad signature is reported as the signature: nothing in an unverified token is believed.
  await assert.rejects(f.verifier.verify(await signToken(stranger, claimsFor('another-project', f.now()))), refused('signature'));
});

test('keys are fetched once and kept for their cache lifetime, then fetched again', async () => {
  const f = await setup({ maxAge: 600 });
  const token = () => signToken(f.key, claimsFor(PROJECT, f.now()));
  await f.verifier.verify(await token()); await f.verifier.verify(await token()); await f.verifier.verify(await token());
  assert.equal(f.provider.keyFetches, 1, 'one fetch serves every verification inside the lifetime');
  assert.deepEqual(f.provider.requests.map(request => request.url), [TOKEN_KEYS_URL]);
  assert.equal(f.verifier.cache().expiresAt, START + 600000);
  f.advance(599000); await f.verifier.verify(await token()); assert.equal(f.provider.keyFetches, 1);
  f.advance(2000); await f.verifier.verify(await token()); assert.equal(f.provider.keyFetches, 2, 'past the lifetime the keys are read again');
  // Concurrent verifications of a cold cache share one request.
  const cold = await setup();
  await Promise.all(await Promise.all([1, 2, 3, 4].map(async () => cold.verifier.verify(await signToken(cold.key, claimsFor(PROJECT, cold.now()))))));
  assert.equal(cold.provider.keyFetches, 1);
});

test('the cache lifetime is bounded: never under a minute, never over a day, and a minute when the provider names none', async () => {
  for (const [maxAge, life] of [[0, 60000], [5, 60000], [3600, 3600000], [999999999, 86400000]] as const) {
    const f = await setup({ maxAge });
    await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now())));
    assert.equal(f.verifier.cache().expiresAt - START, life, `max-age=${maxAge}`);
  }
});

test('key rotation: an unknown key id triggers one refetch, no more than once a minute; a withdrawn key stops verifying', async () => {
  const f = await setup({ maxAge: 3600 }), next = await makeKey('key-2');
  await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now())));
  // The provider starts signing with a new key the cache has not seen.
  f.provider.keys = [f.key, next];
  await assert.rejects(f.verifier.verify(await signToken(next, claimsFor(PROJECT, f.now()))), refused('unknown_key'), 'inside the first minute the keys are not asked for again');
  assert.equal(f.provider.keyFetches, 1);
  f.advance(61000);
  assert.ok(await f.verifier.verify(await signToken(next, claimsFor(PROJECT, f.now()))), 'after a minute the unknown key id is looked up');
  assert.equal(f.provider.keyFetches, 2);
  // A flood of tokens naming keys that do not exist cannot make the server hammer the provider.
  for (let i = 0; i < 5; i++) await assert.rejects(f.verifier.verify(await signToken(await makeKey(`ghost-${i}`), claimsFor(PROJECT, f.now()))), refused('unknown_key'));
  assert.equal(f.provider.keyFetches, 2);
  // The old key is withdrawn: once the cached set has run out, tokens signed with it are refused.
  f.provider.keys = [next];
  f.advance(3600000);
  await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), refused('unknown_key'));
  assert.ok(await f.verifier.verify(await signToken(next, claimsFor(PROJECT, f.now()))));
});

test('keys that cannot be fetched are "unavailable", not a verdict on the token — and expired keys are not used meanwhile', async () => {
  const f = await setup({ maxAge: 60 });
  f.provider.down = true;
  await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), error => error instanceof KeysUnavailable);
  f.provider.down = false;
  await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), error => error instanceof KeysUnavailable, 'a fetch that has just failed is not repeated at once');
  f.advance(KEY_RETRY_AFTER_MS);
  assert.ok(await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), 'after the pause the next attempt fetches again');
  f.advance(61000); f.provider.down = true;
  await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), error => error instanceof KeysUnavailable, 'keys past their lifetime are not trusted while the provider is unreachable');
  // A reply that is not a key set, or holds no usable key, is unavailable too.
  for (const reply of [new Response('not json', { status: 200 }), new Response('{"keys":[]}', { status: 200 }), new Response('{"keys":[{"kty":"EC","kid":"x"}]}', { status: 200 }), new Response('{}', { status: 500 }), new Response('x'.repeat(40000), { status: 200 })]) {
    const verifier = createTokenVerifier({ projectId: PROJECT, fetch: async () => reply, now: () => START });
    await assert.rejects(verifier.verify(await signToken(f.key, claimsFor(PROJECT, START))), error => error instanceof KeysUnavailable);
  }
});

test('errors carry no part of the token', async () => {
  const f = await setup();
  const token = await signToken(f.key, claimsFor(PROJECT, f.now(), { aud: 'another-project', email: 'secret-address@example.com' }));
  const error = await f.verifier.verify(token).then(() => null, (thrown: unknown) => thrown as Error);
  assert.ok(error instanceof TokenError);
  assert.equal(error.message, 'ID token refused: audience');
  for (const part of [...token.split('.'), 'secret-address']) assert.ok(!JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes(part));
});

/** The 64 characters of base64url, in value order. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
test('a token has exactly ONE spelling: every re-encoding of the same bytes is refused, so "used once" cannot be respelled around', async () => {
  const f = await setup();
  const token = await signToken(f.key, claimsFor(PROJECT, f.now()));
  const [head, body, signature] = token.split('.') as [string, string, string];
  const good = await f.verifier.verify(token);
  // A 2,048-bit signature is 256 bytes: 342 characters, the last of which carries two bits of data and four that mean nothing.
  assert.equal(signature.length, 342);
  const last = ALPHABET.indexOf(signature.at(-1) as string);
  assert.equal(last % 16, 0, 'the canonical spelling leaves the four spare bits zero');
  const respelled = Array.from({ length: 16 }, (_, spare) => `${head}.${body}.${signature.slice(0, -1)}${ALPHABET[last + spare]}`);
  assert.equal(respelled[0], token);
  let variants = 0;
  for (const variant of respelled.slice(1)) { await assert.rejects(f.verifier.verify(variant), refused('malformed'), `trailing bits ${variant.at(-1)}`); variants += 1; }
  assert.equal(variants, 15, 'the fifteen other spellings of the same signature bytes');
  // Padding, the standard alphabet's characters and whitespace are other spellings too.
  const others = [`${token}=`, `${token}==`, `${head}.${body}.${signature}%3D`, `${head}=.${body}.${signature}`, `${head}.${body}=.${signature}`, ` ${token}`, `${token} `, `${token}\n`, `${head}.${body}.\n${signature}`, `${head}.${body}.${signature.slice(0, 100)}\n${signature.slice(100)}`, `${head}. ${body}.${signature}`,
    `${head}.${body}.${signature.replace(/-/g, '+').replace(/_/g, '/')}`];
  for (const variant of others) if (variant !== token) await assert.rejects(f.verifier.verify(variant), refused('malformed'), JSON.stringify(variant.slice(-12)));
  // The header and the payload are held to the same rule (their last character has spare bits too, depending on length).
  for (const [name, part] of [['header', head], ['payload', body]] as const) {
    const spare = part.length % 4 === 2 ? 16 : part.length % 4 === 3 ? 4 : 1;
    const at = ALPHABET.indexOf(part.at(-1) as string);
    for (let n = 1; n < spare; n++) {
      const changed = `${part.slice(0, -1)}${ALPHABET[at - (at % spare) + ((at % spare) + n) % spare]}`;
      const variant = name === 'header' ? `${changed}.${body}.${signature}` : `${head}.${changed}.${signature}`;
      await assert.rejects(f.verifier.verify(variant), error => error instanceof TokenError, `${name} respelled`);
    }
  }
  // What a used token is remembered by comes from the signed content: the same for the same token, different for any other.
  assert.equal((await f.verifier.verify(token)).digest, good.digest);
  assert.notEqual((await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { n: 2 })))).digest, good.digest);
  assert.notEqual((await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { subject: 'SomeoneElse0001' })))).digest, good.digest);
});

test('a token of a tenant of the project is refused: its users are not this game’s', async () => {
  const f = await setup();
  for (const tenant of ['tenant-a', '', null, 0]) await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { firebase: { sign_in_provider: 'password', tenant } }))), refused('provider'), JSON.stringify(tenant));
  assert.ok(await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { firebase: { sign_in_provider: 'password' } }))));
});

test('a provider that cannot be reached is not asked again for every token: one attempt per pause, however many arrive', async () => {
  const f = await setup({ maxAge: 3600 });
  f.provider.down = true;
  for (let i = 0; i < 50; i++) await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now(), { n: i }))), error => error instanceof KeysUnavailable);
  assert.equal(f.provider.requests.length, 1, 'fifty tokens, one request');
  f.advance(KEY_RETRY_AFTER_MS - 1);
  await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), error => error instanceof KeysUnavailable); assert.equal(f.provider.requests.length, 1);
  f.advance(1);
  await assert.rejects(f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))), error => error instanceof KeysUnavailable); assert.equal(f.provider.requests.length, 2);
  // An unknown key id while the provider is down: the refetch it would trigger is held back too.
  f.provider.down = false; f.advance(KEY_RETRY_AFTER_MS);
  assert.ok(await f.verifier.verify(await signToken(f.key, claimsFor(PROJECT, f.now()))));
  f.provider.down = true; f.advance(61000);
  const before = f.provider.requests.length;
  for (let i = 0; i < 20; i++) await f.verifier.verify(await signToken(await makeKey(`ghost-${i}`), claimsFor(PROJECT, f.now()))).catch(() => {});
  assert.equal(f.provider.requests.length, before + 1);
});
