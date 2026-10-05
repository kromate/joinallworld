// The call controller (src/calls.ts) against a fake socket, fake connections and a fake microphone, with a clock the test
// moves. The rules kept here: no microphone and no connection before the callee accepts, the Accept tap is what asks the
// callee's browser for the microphone, the caller learns nothing about why a call could not ring, and every end of a call
// stops every track.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ANSWERED_ELSEWHERE_TEXT, CONNECT_TIMEOUT_MS, ELSEWHERE_TEXT, ENDED_SHOWN_MS, NO_CONNECTION_TEXT, RECONNECT_GRACE_MS, RECONNECT_RESTART_MS, createCallController } from './calls.ts'
import type { CallsEnv } from './calls.ts'
import type { CallClientFrame, CallInviteFrame } from './types/calls.ts'

type Loose = Record<string, unknown>

class FakeTrack { enabled = true; stopped = false; kind = 'audio'; stop(): void { this.stopped = true } }
class FakeStream { tracks = [new FakeTrack()]; getTracks(): FakeTrack[] { return this.tracks }; getAudioTracks(): FakeTrack[] { return this.tracks } }
class FakePeer {
  connectionState = 'new'
  signalingState = 'stable'
  localDescription: { sdp: string } | null = null
  remoteDescription: Loose | null = null
  added: unknown[] = []
  candidates: unknown[] = []
  closed = false
  offers: Loose[] = []
  onicecandidate: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: (() => void) | null = null
  sender = { track: new FakeTrack(), replaced: null as unknown, replaceTrack: async (track: unknown) => { this.sender.replaced = track } }
  addTrack(track: unknown): void { this.added.push(track) }
  getSenders(): unknown[] { return [this.sender] }
  async createOffer(options?: Loose): Promise<Loose> { this.offers.push(options ?? {}); return { type: 'offer', sdp: options?.iceRestart === true ? 'offer-restart' : 'offer-sdp' } }
  async createAnswer(): Promise<Loose> { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(description: Loose): Promise<void> { this.localDescription = { sdp: String(description.sdp) }; this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable' }
  async setRemoteDescription(description: Loose): Promise<void> { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable' }
  async addIceCandidate(candidate: unknown): Promise<void> { this.candidates.push(candidate) }
  close(): void { this.closed = true }
  state(next: string): void { this.connectionState = next; this.onconnectionstatechange?.() }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function rig(options: { active?: boolean; deny?: boolean; unsupported?: boolean; connected?: boolean } = {}) {
  let clock = 1000
  const timers: { at: number; run: () => void; id: number }[] = []
  let next = 0
  const sent: CallClientFrame[] = []
  const streams: FakeStream[] = []
  const peers: FakePeer[] = []
  const state = { deny: options.deny ?? false, active: options.active ?? false, socketOpen: options.connected ?? true, media: 0, configReads: 0 }
  const env: CallsEnv = {
    send: (frame) => { if (!state.socketOpen) return false; sent.push(frame); return true },
    now: () => clock,
    setTimeout: (run, ms) => { const id = ++next; timers.push({ at: clock + ms, run, id }); return id },
    clearTimeout: (handle) => { const index = timers.findIndex((timer) => timer.id === handle); if (index >= 0) timers.splice(index, 1) },
    randomId: () => `client-${++next}`,
    supported: () => !options.unsupported,
    getUserMedia: async () => { state.media++; if (state.deny) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); const stream = new FakeStream(); streams.push(stream); return stream as unknown as MediaStream },
    listMicrophones: async () => [{ id: '', label: 'System default' }, { id: 'usb', label: 'USB' }],
    createPeer: () => { const peer = new FakePeer(); peers.push(peer); return peer as unknown as RTCPeerConnection },
    fetchIce: async () => { state.configReads++; return { iceServers: [{ urls: 'stun:stun.example.test' }], expiresAt: null } },
    createAudio: () => ({ srcObject: null, play: () => Promise.resolve() }) as unknown as HTMLAudioElement,
    userActive: () => state.active,
  }
  const controller = createCallController(env)
  const advance = async (ms: number): Promise<void> => {
    clock += ms
    for (;;) { const due = timers.filter((timer) => timer.at <= clock).sort((a, b) => a.at - b.at)[0]; if (!due) break; timers.splice(timers.indexOf(due), 1); due.run() }
    await flush()
  }
  const invite = (): CallInviteFrame => { const frame = sent.find((item): item is CallInviteFrame => item.type === 'call-invite'); if (!frame) throw new Error('No invite was sent'); return frame }
  const lastSent = (type: string): CallClientFrame | undefined => [...sent].reverse().find((frame) => frame.type === type)
  const types = (): string[] => sent.map((frame) => frame.type)
  return { controller, env, state, sent, streams, peers, advance, lastSent, invite, types, now: () => clock }
}
const BOLA = { id: 'bola-id', name: 'Bola' }
const ADA = { id: 'ada-id', name: 'Ada' }

/** Ring Bola, have the server confirm, and return the call id. */
function ringing(r: ReturnType<typeof rig>): string {
  assert.equal(r.controller.call(BOLA), true)
  const invite = r.invite()
  r.controller.handle({ type: 'call-state', callId: 'call-1', state: 'ringing', role: 'caller', peer: BOLA, clientId: invite.clientId, expiresAt: r.now() + 30000 })
  return 'call-1'
}

test('calling only sends the invite: no microphone and no connection before the callee accepts', async () => {
  const r = rig()
  ringing(r)
  await flush()
  assert.deepEqual(r.types(), ['call-invite'])
  assert.deepEqual([r.controller.view.phase, r.controller.view.peer?.name], ['ringing', 'Bola'])
  assert.deepEqual([r.state.media, r.peers.length, r.state.configReads], [0, 0, 0])
  await r.advance(25000)
  assert.deepEqual([r.state.media, r.peers.length], [0, 0], 'still nothing while it rings')
})

test('after accepted, the caller needs a tap for the microphone; the offer comes only after it', async () => {
  const r = rig()
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  assert.equal(r.controller.view.phase, 'needs-tap')
  assert.deepEqual([r.state.media, r.peers.length], [0, 0], 'no microphone without a tap')
  await r.controller.startMicrophone()
  await flush()
  assert.equal(r.state.media, 1)
  assert.equal(r.peers.length, 1)
  assert.deepEqual(r.peers[0]?.added.length, 1)
  assert.deepEqual(r.lastSent('call-signal'), { type: 'call-signal', callId: id, kind: 'offer', data: { sdp: 'offer-sdp' } })
  assert.equal(r.controller.view.phase, 'connecting')
})

test('when the browser still counts the tap as recent, the caller starts at once', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  assert.equal(r.state.media, 1)
  assert.equal(r.lastSent('call-signal')?.type, 'call-signal')
})

test('a refused microphone keeps the caller on the call bar with a plain message and no connection', async () => {
  const r = rig({ deny: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await r.controller.startMicrophone()
  assert.equal(r.controller.view.phase, 'needs-tap')
  assert.match(r.controller.view.error ?? '', /Microphone permission was denied/)
  assert.deepEqual([r.peers.length, r.types().includes('call-signal')], [0, false])
  r.controller.hangup()
  assert.equal(r.lastSent('call-hangup')?.type, 'call-hangup')
})

test('an incoming call shows the caller and opens nothing; Accept asks for the microphone, then tells the server', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  assert.deepEqual([r.controller.view.phase, r.controller.view.peer?.name, r.controller.view.role], ['incoming', 'Ada', 'callee'])
  assert.deepEqual([r.state.media, r.peers.length, r.sent.length], [0, 0, 0])
  const pending = r.controller.accept()
  assert.equal(r.controller.view.phase, 'starting')
  await pending
  assert.equal(r.state.media, 1)
  assert.deepEqual(r.sent, [{ type: 'call-accept', callId: 'in-1' }])
  assert.equal(r.peers.length, 0, 'the connection waits for the server to confirm')
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'accepted', role: 'callee', peer: ADA })
  await flush()
  assert.equal(r.peers.length, 1)
  assert.equal(r.controller.view.phase, 'connecting')
  // The caller's offer is answered, and candidates that come early wait for the description.
  r.controller.handle({ type: 'call-signal', callId: 'in-1', kind: 'ice', data: { candidate: 'c1' } })
  r.controller.handle({ type: 'call-signal', callId: 'in-1', kind: 'offer', data: { sdp: 'their-offer' } })
  await flush()
  assert.deepEqual(r.lastSent('call-signal'), { type: 'call-signal', callId: 'in-1', kind: 'answer', data: { sdp: 'answer-sdp' } })
  assert.equal(r.peers[0]?.candidates.length, 1)
  r.peers[0]?.state('connected')
  assert.equal(r.controller.view.phase, 'connected')
  assert.ok(r.controller.view.startedAt !== null)
})

test('a refused microphone on Accept leaves the call ringing and sends nothing', async () => {
  const r = rig({ deny: true })
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  await r.controller.accept()
  assert.equal(r.controller.view.phase, 'incoming')
  assert.match(r.controller.view.error ?? '', /Allow the microphone/)
  assert.deepEqual(r.sent, [])
  r.controller.hangup()
  assert.deepEqual(r.sent, [{ type: 'call-decline', callId: 'in-1' }])
  assert.equal(r.controller.view.notice, 'Call declined.')
})

test('a call that ends while the microphone prompt is open stops the new tracks', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  const pending = r.controller.accept()
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'cancelled', role: 'callee' })
  await pending
  assert.equal(r.streams[0]?.tracks[0]?.stopped, true)
  assert.deepEqual(r.sent, [])
  assert.match(r.controller.view.notice ?? '', /Missed call from Ada/)
})

test('an unanswered incoming call dismisses itself at its expiry', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  await r.advance(30000)
  assert.equal(r.controller.view.phase, 'incoming')
  await r.advance(2000)
  assert.equal(r.controller.view.phase, 'ended')
  assert.match(r.controller.view.notice ?? '', /Missed call from Ada/)
  await r.advance(ENDED_SHOWN_MS)
  assert.equal(r.controller.view.phase, 'idle')
})

test('the caller is told only that the person cannot be reached, whatever the cause', async () => {
  {
    const r = rig()
    r.controller.call(BOLA)
    r.controller.handle({ type: 'call-state', callId: '', state: 'unreachable', clientId: r.invite().clientId })
    assert.equal(r.controller.view.notice, 'Bola can’t be reached right now.')
  }
  const r = rig()
  r.controller.call(BOLA)
  r.controller.handle({ type: 'call-state', callId: '', state: 'unreachable', clientId: r.invite().clientId, limited: true })
  assert.match(r.controller.view.notice ?? '', /Too many call attempts/)
})

test('cancelling before the server names the call cancels it as soon as it is named', async () => {
  const r = rig()
  r.controller.call(BOLA)
  const invite = r.invite()
  r.controller.hangup()
  assert.equal(r.controller.view.phase, 'ended')
  r.controller.handle({ type: 'call-state', callId: 'late', state: 'ringing', role: 'caller', clientId: invite.clientId })
  assert.deepEqual(r.lastSent('call-cancel'), { type: 'call-cancel', callId: 'late' })
})

test('the caller cancels a ringing call; a declined or unanswered call reads plainly', async () => {
  const r = rig()
  const id = ringing(r)
  r.controller.hangup()
  assert.deepEqual(r.lastSent('call-cancel'), { type: 'call-cancel', callId: id })
  for (const [state, text] of [['declined', 'Bola declined the call.'], ['timeout', 'Bola did not answer.']] as const) {
    const again = rig()
    const call = ringing(again)
    again.controller.handle({ type: 'call-state', callId: call, state, role: 'caller' })
    assert.equal(again.controller.view.notice, text)
  }
})

test('hanging up an accepted call tells the server and stops every track and the connection', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  r.peers[0]?.state('connected')
  r.controller.hangup()
  assert.deepEqual(r.lastSent('call-hangup'), { type: 'call-hangup', callId: id })
  assert.equal(r.streams[0]?.tracks[0]?.stopped, true)
  assert.equal(r.peers[0]?.closed, true)
  assert.equal(r.controller.view.phase, 'ended')
})

test('the peer hanging up, a closed socket and a server that forgot calls all end the call locally', async () => {
  const build = async () => { const r = rig({ active: true }); const id = ringing(r); r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA }); await flush(); r.peers[0]?.state('connected'); return { r, id } }
  const a = await build(); a.r.controller.handle({ type: 'call-state', callId: a.id, state: 'ended', role: 'caller' })
  assert.deepEqual([a.r.controller.view.notice, a.r.streams[0]?.tracks[0]?.stopped], ['Call ended.', true])
  const b = await build(); b.r.controller.socketClosed()
  assert.deepEqual([b.r.controller.view.phase, b.r.streams[0]?.tracks[0]?.stopped, b.r.types().includes('call-hangup')], ['ended', true, false])
  const c = await build(); c.r.controller.handle({ type: 'call-state', callId: '', state: 'ended' })
  assert.deepEqual([c.r.controller.view.phase, c.r.peers[0]?.closed], ['ended', true])
  const idle = rig(); idle.controller.handle({ type: 'call-state', callId: '', state: 'ended' })
  assert.equal(idle.controller.view.phase, 'idle')
})

test('frames about another call are ignored, and a second incoming call does not replace the one in progress', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  r.controller.handle({ type: 'call-incoming', callId: 'other', from: ADA, expiresAt: r.now() + 30000 })
  r.controller.handle({ type: 'call-state', callId: 'other', state: 'ended' })
  r.controller.handle({ type: 'call-signal', callId: 'other', kind: 'answer', data: { sdp: 'x' } })
  await flush()
  assert.deepEqual([r.controller.view.callId, r.controller.view.peer?.name, r.peers[0]?.remoteDescription], [id, 'Bola', null])
})

test('mute turns the microphone track off and on without ending the call', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  r.peers[0]?.state('connected')
  r.controller.toggleMute()
  assert.deepEqual([r.controller.view.muted, r.streams[0]?.tracks[0]?.enabled], [true, false])
  r.controller.toggleMute()
  assert.deepEqual([r.controller.view.muted, r.streams[0]?.tracks[0]?.enabled], [false, true])
})

test('a dropped connection shows reconnecting; the caller restarts it, and the call ends after the grace period', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  const peer = r.peers[0] as FakePeer
  peer.state('connected')
  peer.state('disconnected')
  assert.equal(r.controller.view.phase, 'reconnecting')
  await r.advance(RECONNECT_RESTART_MS)
  assert.deepEqual(peer.offers.at(-1), { iceRestart: true })
  assert.deepEqual(r.lastSent('call-signal'), { type: 'call-signal', callId: id, kind: 'offer', data: { sdp: 'offer-restart' } })
  peer.state('connected')
  assert.equal(r.controller.view.phase, 'connected')
  peer.state('disconnected')
  await r.advance(RECONNECT_GRACE_MS)
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.lastSent('call-hangup')?.type], ['ended', 'The connection was lost.', 'call-hangup'])
})

test('a call that never connects ends with the network explanation', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  await r.advance(CONNECT_TIMEOUT_MS)
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice], ['ended', NO_CONNECTION_TEXT])
  assert.equal(r.streams[0]?.tracks[0]?.stopped, true)
})

test('answered on another device: this one stops ringing, says so for a moment, then only shows the call; an unsupported browser says so before ringing', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'accepted', role: 'callee', peer: ADA, elsewhere: true })
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.controller.view.peer?.name, r.sent.length], ['elsewhere', ANSWERED_ELSEWHERE_TEXT, 'Ada', 0])
  await r.advance(ENDED_SHOWN_MS + 10)
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice], ['elsewhere', ELSEWHERE_TEXT])
  // The ring's own timer is gone with the ring: nothing calls it a missed call later.
  await r.advance(40000)
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice], ['elsewhere', ELSEWHERE_TEXT])
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'ended', role: 'callee', peer: ADA })
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.sent.length], ['idle', null, 0], 'over: nothing is said, nothing was ever sent')
  const old = rig({ unsupported: true })
  assert.equal(old.controller.call(BOLA), false)
  assert.match(old.controller.view.notice ?? '', /supported browser/)
  assert.equal(old.sent.length, 0)
})

test('switching microphone replaces the track and keeps the mute state', async () => {
  const r = rig({ active: true })
  const id = ringing(r)
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  r.peers[0]?.state('connected')
  await flush()
  assert.equal(r.controller.view.devices?.length, 2)
  r.controller.toggleMute()
  await r.controller.selectDevice('usb')
  assert.equal(r.streams.length, 2)
  assert.deepEqual([r.streams[0]?.tracks[0]?.stopped, r.streams[1]?.tracks[0]?.enabled, r.peers[0]?.sender.replaced === r.streams[1]?.tracks[0]], [true, false, true])
})

test('an invite that cannot be sent says so and opens nothing', async () => {
  const r = rig({ connected: false })
  r.controller.call(BOLA)
  assert.match(r.controller.view.notice ?? '', /not connected/)
  assert.deepEqual([r.state.media, r.peers.length], [0, 0])
})

// ---- one player, several devices (docs/DEVICES.md) ----

test('a device that shows a call on another device opens nothing and can end nothing: no microphone, no connection, no frame, whatever is pressed or closed', async () => {
  const r = rig({ active: true })
  // The call was placed on another device of this player.
  r.controller.handle({ type: 'call-state', callId: 'out-1', state: 'ringing', role: 'caller', peer: BOLA, elsewhere: true })
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.controller.view.role], ['elsewhere', ELSEWHERE_TEXT, 'caller'])
  r.controller.handle({ type: 'call-state', callId: 'out-1', state: 'accepted', role: 'caller', peer: BOLA, elsewhere: true })
  await flush()
  assert.equal(r.controller.view.phase, 'elsewhere', 'the other side answering does not make this device start a microphone')
  r.controller.handle({ type: 'call-signal', callId: 'out-1', kind: 'answer', data: { sdp: 'x' } })
  r.controller.hangup(); r.controller.dismiss(); r.controller.pageHidden()
  await r.controller.accept(); await r.controller.startMicrophone(); r.controller.toggleMute()
  await flush()
  assert.deepEqual([r.sent.length, r.state.media, r.peers.length, r.controller.view.phase], [0, 0, 0, 'elsewhere'])
  assert.equal(r.controller.call(ADA), false, 'the player is in a call: this device cannot place another')
  // A second caller is the server's business (it answers them busy); a stray incoming frame does not replace the call.
  r.controller.handle({ type: 'call-incoming', callId: 'in-9', from: ADA, expiresAt: r.now() + 30000 })
  assert.equal(r.controller.view.callId, 'out-1')
  // The socket drops: this device simply stops showing it; when it is back the server says again what is going on.
  r.controller.socketClosed()
  assert.deepEqual([r.controller.view.phase, r.sent.length], ['idle', 0])
  r.controller.handle({ type: 'call-state', callId: 'out-1', state: 'accepted', role: 'caller', peer: BOLA, elsewhere: true })
  assert.equal(r.controller.view.phase, 'elsewhere')
  r.controller.destroy()
  assert.equal(r.sent.length, 0)
})

test('a device closed while it only rings does not decline for the player; one that carries or places a call ends it', async () => {
  const ringingOnly = rig()
  ringingOnly.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: ringingOnly.now() + 30000 })
  ringingOnly.controller.pageHidden()
  assert.deepEqual([ringingOnly.controller.view.phase, ringingOnly.sent.length], ['idle', 0], 'the other devices go on ringing')
  const placing = rig()
  const id = ringing(placing)
  placing.controller.pageHidden()
  assert.deepEqual(placing.lastSent('call-cancel'), { type: 'call-cancel', callId: id })
  const carrying = rig()
  carrying.controller.handle({ type: 'call-incoming', callId: 'in-2', from: ADA, expiresAt: carrying.now() + 30000 })
  await carrying.controller.accept()
  carrying.controller.handle({ type: 'call-state', callId: 'in-2', state: 'accepted', role: 'callee', peer: ADA })
  await flush()
  carrying.controller.pageHidden()
  assert.deepEqual(carrying.lastSent('call-hangup'), { type: 'call-hangup', callId: 'in-2' })
  assert.equal(carrying.streams[0]?.tracks[0]?.stopped, true, 'and its microphone is closed')
})

test('pressing Accept here while another device answers first: the microphone this device was opening is closed and it shows the call elsewhere', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  const accepting = r.controller.accept()
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'accepted', role: 'callee', peer: ADA, elsewhere: true })
  await accepting
  await flush()
  assert.deepEqual([r.controller.view.phase, r.types(), r.peers.length], ['elsewhere', [], 0])
  assert.ok(r.streams.every((stream) => stream.tracks.every((track) => track.stopped)), 'no microphone stays open')
})
