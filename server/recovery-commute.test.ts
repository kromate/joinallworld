import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fixture } from './test-fixture.ts';
const { WebSocket } = await import('ws');

for (const trigger of ['apply-job', 'get-settlement']) test(`commute departure revokes old room: ${trigger}`, async t => {
  let clock = trigger === 'apply-job' ? Date.UTC(2026, 0, 5, 9) : Date.UTC(2026, 0, 5, 6);
  const f = await fixture(t, { now: () => clock });
  const a = await f.device('Commuter Probe');
  const b = await f.device('Peer Probe');
  const connect = async device => {
    const ws = new WebSocket(f.base.replace('http', 'ws') + '/socket', { headers: { Cookie: device.cookie, Origin: f.base } });
    const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await once(ws, 'open'); t.after(() => ws.terminate());
    return { ws, messages };
  };
  const waitMessage = (peer, predicate) => new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => { const match = peer.messages.find(predicate); if (match) return resolve(match);
      if (Date.now() - start > 1000) return reject(Error('Protocol response timeout'));
      setTimeout(check, 5); };
    check();
  });
  const apply = () => f.request('/api/action', { actionId: `${clock}:${randomUUID()}`, cityId: 'lagos', type: 'apply-job', payload: { id: 'tech' } }, a.cookie).then(r => r.json());
  if (trigger === 'get-settlement') {
    const hired = await apply(); assert.equal(hired.ok, true); assert.equal(hired.state.activeAction, null);
  }
  const pa = await connect(a), pb = await connect(b);
  pa.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  await waitMessage(pa, m => m.type === 'presence');
  pb.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  await waitMessage(pb, m => m.type === 'presence' && m.members.length === 2);
  pa.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: false }));
  await waitMessage(pb, m => m.type === 'presence' && m.members.some(x => x.id === a.id && x.enabled));
  pa.messages.length = 0; pb.messages.length = 0;
  let outcome;
  if (trigger === 'apply-job') outcome = await apply();
  else { clock = Date.UTC(2026, 0, 5, 9); outcome = await (await f.request('/api/life?city=lagos', null, a.cookie)).json(); }
  assert.equal(outcome.state.activeAction?.kind, 'commute', 'precondition: actual commute started');
  assert.equal(outcome.state.location, 'park');
  // Peer request is a response barrier and supplies a fresh authoritative roster.
  pb.ws.send(JSON.stringify({ type: 'voice-state', enabled: false, muted: true }));
  const presence = await waitMessage(pb, m => m.type === 'presence');
  const revoked = pa.messages.some(m => m.type === 'error' && m.code === 'venue_mismatch');
  const stillMember = presence.members.some(m => m.id === a.id);
  const stillVoiceEnabled = presence.members.some(m => m.id === a.id && m.enabled);
  pa.messages.length = 0;
  pa.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  const joinReply = await waitMessage(pa, m => m.type === 'error' || m.type === 'presence');
  const joinRefused = joinReply.type === 'error' && joinReply.code === 'venue_mismatch';
  const observed = { revoked, stillMember, stillVoiceEnabled, joinRefused };
  console.log(JSON.stringify({ trigger, location: outcome.state.location, action: outcome.state.activeAction, ...observed,
    scope: 'two real WebSockets, voice-state only; no WebRTC or microphone' }));
  pa.ws.terminate(); pb.ws.terminate();
  assert.deepEqual(observed, { revoked: true, stillMember: false, stillVoiceEnabled: false, joinRefused: true });
});
