// OWNER: social — the limits and the provider contract of server/call-relay.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RELAY_DEFAULTS, cleanRelayServers, createCallRelay, relayLimits } from './call-relay.ts';

const SETTINGS = { TURN_KEY_ID: 'k'.repeat(32), TURN_API_TOKEN: 'synthetic' };
const provider = async (): Promise<Response> => new Response(JSON.stringify({ iceServers: [{ urls: ['turns:turn.example.test:443?transport=tcp'], username: 'u', credential: 'c' }] }), { status: 201 });
const reader = (values: Record<string, string>) => (name: string): string | undefined => values[name];

test('limits come from named settings; anything that is not a whole number uses the default', () => {
  assert.deepEqual(relayLimits(reader({})), RELAY_DEFAULTS);
  assert.deepEqual(relayLimits(reader({ CALL_RELAY_PER_PLAYER_DAY: '5', CALL_RELAY_PER_ADDRESS_HOUR: 'many', CALL_RELAY_DAILY_CEILING: '-1' })), { perPlayerPerDay: 5, perAddressPerHour: RELAY_DEFAULTS.perAddressPerHour, dailyCeiling: RELAY_DEFAULTS.dailyCeiling });
});

test('without both provider settings the relay is off and the provider is never asked', async () => {
  let asked = 0;
  const relay = createCallRelay({ read: reader({ TURN_KEY_ID: SETTINGS.TURN_KEY_ID }), now: () => 0, fetchImpl: async () => { asked++; return provider(); } });
  assert.equal(relay.configured, false);
  assert.deepEqual(await relay.issue('p', 'a'), { relay: 'off' });
  assert.equal(asked, 0);
});

test('per player per day, per address per hour, and the global ceiling; each resets with its own window', async () => {
  let clock = Date.parse('2026-10-06T10:00:00Z');
  const relay = createCallRelay({ read: reader({ ...SETTINGS, CALL_RELAY_PER_PLAYER_DAY: '2', CALL_RELAY_PER_ADDRESS_HOUR: '3', CALL_RELAY_DAILY_CEILING: '4' }), now: () => clock, fetchImpl: provider });
  assert.equal((await relay.issue('one', 'addr')).relay, 'on');
  assert.equal((await relay.issue('one', 'addr')).relay, 'on');
  assert.equal((await relay.issue('one', 'addr')).relay, 'limited', 'player');
  assert.equal((await relay.issue('two', 'addr')).relay, 'on');
  assert.equal((await relay.issue('three', 'addr')).relay, 'limited', 'address');
  clock += 3600000;
  assert.equal((await relay.issue('three', 'addr')).relay, 'on', 'a new hour; the fourth of the day');
  assert.equal((await relay.issue('four', 'other')).relay, 'limited', 'ceiling');
  assert.equal(relay.mintsToday(), 4);
  clock = Date.parse('2026-10-07T00:00:01Z');
  assert.equal(relay.mintsToday(), 0);
  assert.equal((await relay.issue('one', 'addr')).relay, 'on', 'a new day');
});

test('only plain stun/turn servers with credentials are passed on', () => {
  assert.equal(cleanRelayServers([{ urls: 'stun:x' }]), null, 'no relay in it');
  assert.equal(cleanRelayServers([{ urls: 'turn:x' }]), null, 'no credential');
  assert.equal(cleanRelayServers([{ urls: 'javascript:alert(1)', username: 'u', credential: 'c' }]), null);
  assert.deepEqual(cleanRelayServers([{ urls: 'turn:x', username: 'u', credential: 'c', extra: 1 }]), [{ urls: ['turn:x'], username: 'u', credential: 'c' }]);
});
