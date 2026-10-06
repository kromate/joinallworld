// The call controller (src/calls.ts) against a fake socket, fake connections and a fake microphone, with a clock the test
// moves. The rules kept here: no microphone and no connection before the callee accepts, the Accept tap is what asks the
// callee's browser for the microphone, the caller learns nothing about why a call could not ring, and every end of a call
// stops every track.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ANSWERED_ELSEWHERE_TEXT, BLOCKED_TEXT, CONNECT_TIMEOUT_MS, ELSEWHERE_TEXT, ENDED_PROBLEM_MS, ENDED_SHOWN_MS, FALLBACK_ICE, ICE_WAIT_MS, NO_RELAY_TEXT, PEER_LOST_TEXT, RECONNECT_GRACE_MS, RECONNECT_RESTART_MS, RESTART_MAX, SELF_LOST_TEXT, STATS_EVERY_MS, createCallController, readStats } from './calls.ts'
import type { CallsEnv } from './calls.ts'
import type { CallClientFrame, CallInviteFrame, CallRelayState } from './types/calls.ts'

type Loose = Record<string, unknown>

class FakeTrack { enabled = true; stopped = false; kind = 'audio'; readyState = 'live'; onended: (() => void) | null = null; stop(): void { this.stopped = true } }
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
  config: Loose = {}
  onicecandidate: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: (() => void) | null = null
  stats: Loose[] = []
  sender = { track: new FakeTrack(), replaced: null as unknown, replaceTrack: async (track: unknown) => { this.sender.replaced = track } }
  addTrack(track: unknown): void { this.added.push(track) }
  getSenders(): unknown[] { return [this.sender] }
  async getStats(): Promise<{ forEach(run: (stat: Loose) => void): void }> { return { forEach: (run) => this.stats.forEach(run) } }
  async createOffer(options?: Loose): Promise<Loose> { this.offers.push(options ?? {}); return { type: 'offer', sdp: options?.iceRestart === true ? 'offer-restart' : 'offer-sdp' } }
  async createAnswer(): Promise<Loose> { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(description: Loose): Promise<void> { this.localDescription = { sdp: String(description.sdp) }; this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable' }
  async setRemoteDescription(description: Loose): Promise<void> { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable' }
  async addIceCandidate(candidate: unknown): Promise<void> { this.candidates.push(candidate) }
  close(): void { this.closed = true }
  state(next: string): void { this.connectionState = next; this.onconnectionstatechange?.() }
}
/** Statistics as a browser reports them: a selected pair of the given kinds of candidate, and one inbound audio stream. */
const statsOf = (local: string, remote: string, received = 100, lost = 0, rtt = 0.05): Loose[] => [
  { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
  { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: rtt },
  { id: 'L', type: 'local-candidate', candidateType: local }, { id: 'R', type: 'remote-candidate', candidateType: remote },
  { id: 'I', type: 'inbound-rtp', kind: 'audio', packetsReceived: received, packetsLost: lost, bytesReceived: received * 80 },
]

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function rig(options: { deny?: string; unsupported?: boolean; connected?: boolean; relay?: CallRelayState | 'silent'; offline?: boolean } = {}) {
  let clock = 1000
  const timers: { at: number; run: () => void; id: number }[] = []
  let next = 0
  const sent: CallClientFrame[] = []
  const streams: FakeStream[] = []
  const peers: FakePeer[] = []
  const state = { deny: options.deny ?? '', socketOpen: options.connected ?? true, media: 0, unlocked: 0, relay: options.relay ?? 'off', offline: options.offline ?? false, level: null as ((value: number) => void) | null, deviceChange: null as (() => void) | null, awake: true, awakeReleased: 0, outputs: null as { id: string; label: string }[] | null, sink: '' }
  const env: CallsEnv = {
    send: (frame) => {
      if (!state.socketOpen) return false
      sent.push(frame)
      if (frame.type === 'call-ice' && state.relay !== 'silent') {
        const relay = state.relay
        queueMicrotask(() => controller.handle({ type: 'call-ice', callId: frame.callId, relay, iceServers: relay === 'on' ? [{ urls: ['turn:relay.example.test:3478?transport=udp', 'turns:relay.example.test:443?transport=tcp'], username: 'u', credential: 'c' }] : [{ urls: 'stun:stun.example.test' }] }))
      }
      return true
    },
    now: () => clock,
    setTimeout: (run, ms) => { const id = ++next; timers.push({ at: clock + ms, run, id }); return id },
    clearTimeout: (handle) => { const index = timers.findIndex((timer) => timer.id === handle); if (index >= 0) timers.splice(index, 1) },
    randomId: () => `client-${++next}`,
    supported: () => !options.unsupported,
    getUserMedia: async () => { state.media++; if (state.deny) throw Object.assign(new Error('refused'), { name: state.deny }); const stream = new FakeStream(); streams.push(stream); return stream as unknown as MediaStream },
    listMicrophones: async () => [{ id: '', label: 'System default' }, { id: 'usb', label: 'USB' }],
    createPeer: (config) => { const peer = new FakePeer(); peer.config = config as unknown as Loose; peers.push(peer); return peer as unknown as RTCPeerConnection },
    createAudio: () => ({ srcObject: null, play: () => Promise.resolve() }) as unknown as HTMLAudioElement,
    unlockAudio: () => { state.unlocked++ },
    meter: (_stream, level) => { state.level = level; return () => { state.level = null } },
    online: () => !state.offline,
    onDeviceChange: (run) => { state.deviceChange = run; return () => { state.deviceChange = null } },
    keepAwake: () => (state.awake ? () => { state.awakeReleased++ } : null),
    listOutputs: async () => state.outputs,
    setOutput: async (_audio, id) => { state.sink = id },
  }
  const controller = createCallController(env)
  const advance = async (ms: number): Promise<void> => {
    const target = clock + ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      clock = Math.max(clock, due.at); timers.splice(timers.indexOf(due), 1); due.run(); await flush()
    }
    clock = target
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
/** The call was placed, answered, and its connection object made. */
async function accepted(r: ReturnType<typeof rig>): Promise<{ id: string; peer: FakePeer }> {
  const id = ringing(r)
  await flush()
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  return { id, peer: r.peers[0] as FakePeer }
}
async function connected(r: ReturnType<typeof rig>): Promise<{ id: string; peer: FakePeer }> {
  const call = await accepted(r)
  call.peer.state('connected')
  await flush()
  return call
}

test('pressing Call sends the invite and asks for the microphone at once; the track stays off and no connection exists while it rings', async () => {
  const r = rig()
  ringing(r)
  await flush()
  assert.deepEqual(r.types(), ['call-invite'])
  assert.deepEqual([r.controller.view.phase, r.controller.view.peer?.name, r.controller.view.mic], ['ringing', 'Bola', 'ready'])
  assert.deepEqual([r.state.media, r.state.unlocked, r.peers.length], [1, 1, 0])
  assert.equal(r.streams[0]?.tracks[0]?.enabled, false, 'nothing can be sent early')
  await r.advance(25000)
  assert.deepEqual([r.state.media, r.peers.length, r.types()], [1, 0, ['call-invite']], 'still no connection, no addresses, nothing asked of the host')
})

test('after accepted: servers are asked for, the connection is made with them, the offer goes out; the microphone opens once', async () => {
  const r = rig({ relay: 'on' })
  const { id, peer } = await accepted(r)
  assert.deepEqual(r.types(), ['call-invite', 'call-ice', 'call-signal'])
  assert.deepEqual(r.lastSent('call-signal'), { type: 'call-signal', callId: id, kind: 'offer', data: { sdp: 'offer-sdp' } })
  assert.equal(r.state.media, 1)
  assert.equal(peer.added.length, 1)
  assert.equal(r.controller.view.phase, 'connecting')
  assert.equal(r.controller.view.relay, 'on')
  const urls = ((peer.config.iceServers as { urls: string[] }[]).flatMap((server) => server.urls))
  assert.ok(urls.some((url) => url.startsWith('turns:')) && urls.some((url) => url.startsWith('turn:')), 'udp and tls variants are all handed over')
  assert.equal(peer.config.iceTransportPolicy, 'all', 'direct paths are preferred; the relay is the fallback')
})

test('a host that does not answer call-ice in time gets plain STUN, and the call goes on', async () => {
  const r = rig({ relay: 'silent' })
  const id = ringing(r)
  await flush()
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  assert.equal(r.peers.length, 0)
  await r.advance(ICE_WAIT_MS)
  assert.deepEqual(r.peers[0]?.config.iceServers, FALLBACK_ICE)
  assert.equal(r.controller.view.relay, null)
})

test('nothing is gathered or sent before accept, and a rejected invite never reaches the microphone result', async () => {
  const r = rig()
  r.controller.call(BOLA)
  r.controller.handle({ type: 'call-state', callId: '', state: 'unreachable', clientId: r.invite().clientId })
  await flush()
  assert.equal(r.controller.view.phase, 'ended')
  assert.ok(r.streams.every((stream) => stream.tracks.every((track) => track.stopped)), 'the microphone is closed when the call cannot ring')
  assert.deepEqual([r.peers.length, r.types()], [0, ['call-invite']])
})

test('a caller whose answer comes while the permission prompt is still open waits for it, then connects', async () => {
  const r = rig()
  let allow: (stream: MediaStream) => void = () => {}
  r.env.getUserMedia = () => new Promise<MediaStream>((resolve) => { allow = resolve })
  const id = ringing(r)
  assert.equal(r.controller.view.mic, 'asking')
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  assert.equal(r.controller.view.phase, 'starting')
  allow(new FakeStream() as unknown as MediaStream)
  await flush()
  assert.equal(r.controller.view.phase, 'connecting')
  assert.equal(r.peers.length, 1)
})

test('the microphone is refused at Call: the call keeps ringing with specific help; Try again asks once more from a tap', async () => {
  const cases: [string, string, RegExp][] = [['NotAllowedError', 'denied', /blocked/i], ['NotFoundError', 'no-device', /No microphone was found/], ['NotReadableError', 'in-use', /another app/], ['SomethingError', 'failed', /could not be opened/]]
  for (const [name, problem, words] of cases) {
    const r = rig({ deny: name })
    ringing(r)
    await flush()
    assert.deepEqual([r.controller.view.phase, r.controller.view.mic, r.controller.view.micProblem], ['ringing', 'problem', problem], name)
    assert.match(r.controller.view.error ?? '', words)
    assert.deepEqual(r.types(), ['call-invite'])
    r.state.deny = ''
    await r.controller.startMicrophone()
    assert.deepEqual([r.controller.view.mic, r.controller.view.error], ['ready', null], 'retry works')
  }
})

test('a caller whose microphone is still missing when the callee answers gets "Tap to talk" (needs-tap); the tap connects', async () => {
  const r = rig({ deny: 'NotAllowedError' })
  const id = ringing(r)
  await flush()
  r.controller.handle({ type: 'call-state', callId: id, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  assert.equal(r.controller.view.phase, 'needs-tap')
  assert.deepEqual([r.peers.length, r.types().includes('call-signal')], [0, false])
  r.state.deny = ''
  await r.controller.startMicrophone()
  await flush()
  assert.equal(r.controller.view.phase, 'connecting')
  assert.equal(r.peers.length, 1)
  assert.equal(r.lastSent('call-signal')?.type, 'call-signal')
  const stuck = rig({ deny: 'NotAllowedError' })
  const other = ringing(stuck)
  await flush()
  stuck.controller.handle({ type: 'call-state', callId: other, state: 'accepted', role: 'caller', peer: BOLA })
  await flush()
  await stuck.controller.startMicrophone()
  assert.deepEqual([stuck.controller.view.phase, stuck.controller.view.micProblem], ['needs-tap', 'denied'], 'still refused: still asks')
  stuck.controller.hangup()
  assert.equal(stuck.lastSent('call-hangup')?.type, 'call-hangup')
})

test('an incoming call shows the caller and opens nothing; Answer asks for the microphone, then tells the server', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  assert.deepEqual([r.controller.view.phase, r.controller.view.peer?.name, r.controller.view.role], ['incoming', 'Ada', 'callee'])
  assert.deepEqual([r.state.media, r.peers.length, r.sent.length], [0, 0, 0])
  const pending = r.controller.accept()
  assert.equal(r.controller.view.phase, 'starting')
  await pending
  assert.equal(r.state.media, 1)
  assert.equal(r.state.unlocked, 1)
  assert.deepEqual(r.sent, [{ type: 'call-accept', callId: 'in-1' }])
  assert.equal(r.peers.length, 0, 'the connection waits for the server to confirm')
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'accepted', role: 'callee', peer: ADA })
  await flush()
  assert.equal(r.peers.length, 1)
  assert.equal(r.controller.view.phase, 'connecting')
  assert.deepEqual(r.types(), ['call-accept', 'call-ice'])
  // The caller's offer is answered, and candidates that come early wait for the description.
  r.controller.handle({ type: 'call-signal', callId: 'in-1', kind: 'ice', data: { candidate: 'c1' } })
  r.controller.handle({ type: 'call-signal', callId: 'in-1', kind: 'offer', data: { sdp: 'their-offer' } })
  await flush()
  assert.deepEqual(r.lastSent('call-signal'), { type: 'call-signal', callId: 'in-1', kind: 'answer', data: { sdp: 'answer-sdp' } })
  assert.equal(r.peers[0]?.candidates.length, 1)
  assert.equal(r.streams[0]?.tracks[0]?.enabled, false, 'silent until connected')
  r.peers[0]?.state('connected')
  assert.equal(r.controller.view.phase, 'connected')
  assert.equal(r.streams[0]?.tracks[0]?.enabled, true, 'and sending once connected')
  assert.ok(r.controller.view.startedAt !== null)
})

test('a refused microphone on Answer leaves the call ringing with help and sends nothing; Decline then declines', async () => {
  const r = rig({ deny: 'NotAllowedError' })
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  await r.controller.accept()
  assert.equal(r.controller.view.phase, 'incoming')
  assert.match(r.controller.view.error ?? '', /Microphone blocked/)
  assert.deepEqual(r.sent, [])
  r.state.deny = ''
  await r.controller.accept()
  assert.deepEqual(r.sent, [{ type: 'call-accept', callId: 'in-1' }], 'the second press works')
  const again = rig({ deny: 'NotAllowedError' })
  again.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: again.now() + 30000 })
  await again.controller.accept()
  again.controller.hangup()
  assert.deepEqual(again.sent, [{ type: 'call-decline', callId: 'in-1' }])
  assert.deepEqual([again.controller.view.notice, again.controller.view.outcome], ['Call declined.', 'declined'])
})

test('a call that ends while the microphone prompt is open stops the new tracks', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  const pending = r.controller.accept()
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'cancelled', role: 'callee' })
  await pending
  assert.equal(r.streams[0]?.tracks[0]?.stopped, true)
  assert.deepEqual(r.sent, [])
  assert.deepEqual([r.controller.view.notice, r.controller.view.outcome], ['Missed call from Ada.', 'missed'])
})

test('an unanswered incoming call becomes a missed call at its expiry, and the summary goes away by itself', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  await r.advance(30000)
  assert.equal(r.controller.view.phase, 'incoming')
  await r.advance(2000)
  assert.deepEqual([r.controller.view.phase, r.controller.view.outcome, r.controller.view.peer?.name], ['ended', 'missed', 'Ada'])
  assert.match(r.controller.view.notice ?? '', /Missed call from Ada/)
  await r.advance(ENDED_SHOWN_MS)
  assert.equal(r.controller.view.phase, 'idle')
})

test('the caller is told only that the person cannot be reached, whatever the cause; limits and busy have their own words', async () => {
  const cases: [Record<string, true>, RegExp, string][] = [[{}, /can’t be reached/, 'unreachable'], [{ limited: true }, /Too many call attempts/, 'limited'], [{ busy: true }, /already in a call/, 'busy']]
  for (const [extra, words, outcome] of cases) {
    const r = rig()
    r.controller.call(BOLA)
    r.controller.handle({ type: 'call-state', callId: '', state: 'unreachable', clientId: r.invite().clientId, ...extra })
    assert.match(r.controller.view.notice ?? '', words)
    assert.equal(r.controller.view.outcome, outcome)
  }
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

test('the caller cancels a ringing call; declined, unanswered and cancelled calls read plainly and carry an outcome', async () => {
  const r = rig()
  const id = ringing(r)
  await flush()
  r.controller.hangup()
  assert.deepEqual(r.lastSent('call-cancel'), { type: 'call-cancel', callId: id })
  assert.equal(r.controller.view.outcome, 'cancelled')
  assert.ok(r.streams.every((stream) => stream.tracks.every((track) => track.stopped)), 'the microphone opened at Call is closed again')
  for (const [state, text, outcome] of [['declined', 'Bola declined the call.', 'declined'], ['timeout', 'Bola did not answer.', 'unanswered']] as const) {
    const again = rig()
    const call = ringing(again)
    again.controller.handle({ type: 'call-state', callId: call, state, role: 'caller' })
    assert.deepEqual([again.controller.view.notice, again.controller.view.outcome], [text, outcome])
  }
})

test('hanging up a connected call stops every track and the connection, and keeps the person and the length for the summary', async () => {
  const r = rig()
  const { id, peer } = await connected(r)
  await r.advance(252000)
  r.controller.hangup()
  assert.deepEqual(r.lastSent('call-hangup'), { type: 'call-hangup', callId: id })
  assert.equal(r.streams[0]?.tracks[0]?.stopped, true)
  assert.equal(peer.closed, true)
  assert.deepEqual([r.controller.view.phase, r.controller.view.outcome, r.controller.view.duration, r.controller.view.peer?.name], ['ended', 'ended', 252000, 'Bola'])
  r.controller.handle({ type: 'call-state', callId: id, state: 'ended', role: 'caller' })
  assert.equal(r.controller.view.duration, 252000, 'the server echo of the same ending leaves the summary alone')
  assert.equal(r.state.awakeReleased, 1)
  // "Call again" from the summary rings the same person.
  assert.equal(r.controller.call(BOLA), true)
  assert.equal(r.controller.view.phase, 'calling')
})

test('the peer hanging up, a closed socket and a server that forgot calls all end the call locally', async () => {
  const a = rig(); const one = await connected(a); a.controller.handle({ type: 'call-state', callId: one.id, state: 'ended', role: 'caller' })
  assert.deepEqual([a.controller.view.notice, a.streams[0]?.tracks[0]?.stopped], ['Call ended.', true])
  const b = rig(); await connected(b); b.controller.socketClosed()
  assert.deepEqual([b.controller.view.phase, b.streams[0]?.tracks[0]?.stopped, b.types().includes('call-hangup')], ['ended', true, false])
  const c = rig(); await connected(c); c.controller.handle({ type: 'call-state', callId: '', state: 'ended' })
  assert.deepEqual([c.controller.view.phase, c.peers[0]?.closed], ['ended', true])
  const idle = rig(); idle.controller.handle({ type: 'call-state', callId: '', state: 'ended' })
  assert.equal(idle.controller.view.phase, 'idle')
})

test('frames about another call are ignored, and a second incoming call does not replace the one in progress', async () => {
  const r = rig()
  const { id } = await accepted(r)
  r.controller.handle({ type: 'call-incoming', callId: 'other', from: ADA, expiresAt: r.now() + 30000 })
  r.controller.handle({ type: 'call-state', callId: 'other', state: 'ended' })
  r.controller.handle({ type: 'call-signal', callId: 'other', kind: 'answer', data: { sdp: 'x' } })
  r.controller.handle({ type: 'call-ice', callId: 'other', relay: 'on', iceServers: [] })
  await flush()
  assert.deepEqual([r.controller.view.callId, r.controller.view.peer?.name, r.peers[0]?.remoteDescription], [id, 'Bola', null])
})

test('mute silences the track, shows at once, survives reconnecting, and the level reads zero while muted', async () => {
  const r = rig()
  const { peer } = await connected(r)
  const track = r.streams[0]?.tracks[0] as FakeTrack
  assert.equal(track.enabled, true)
  r.state.level?.(0.8)
  assert.equal(r.controller.view.micLevel, 4)
  r.controller.toggleMute()
  assert.deepEqual([r.controller.view.muted, track.enabled, r.controller.view.micLevel], [true, false, 0])
  r.state.level?.(0.9)
  assert.equal(r.controller.view.micLevel, 0)
  peer.state('disconnected'); peer.state('connected')
  assert.equal(track.enabled, false, 'still muted after the connection came back')
  r.controller.toggleMute()
  assert.deepEqual([r.controller.view.muted, track.enabled], [false, true])
})

test('a dropped connection shows Reconnecting; the caller restarts ICE on a schedule; recovery goes back to connected', async () => {
  const r = rig()
  const { id, peer } = await connected(r)
  peer.signalingState = 'stable'
  peer.state('disconnected')
  assert.deepEqual([r.controller.view.phase, r.controller.view.quality], ['reconnecting', 'reconnecting'])
  await r.advance(RECONNECT_RESTART_MS)
  assert.deepEqual(peer.offers.at(-1), { iceRestart: true })
  assert.deepEqual(r.lastSent('call-signal'), { type: 'call-signal', callId: id, kind: 'offer', data: { sdp: 'offer-restart' } })
  peer.signalingState = 'stable'
  peer.state('connected')
  assert.equal(r.controller.view.phase, 'connected')
  assert.equal(r.controller.view.quality, 'good')
})

test('a connection that does not come back ends within the grace period: the other side lost connection, or yours dropped', async () => {
  for (const [offline, text] of [[false, PEER_LOST_TEXT], [true, SELF_LOST_TEXT]] as const) {
    const r = rig()
    const { peer } = await connected(r)
    r.state.offline = offline
    peer.state('disconnected')
    await r.advance(RECONNECT_GRACE_MS - 1)
    assert.equal(r.controller.view.phase, 'reconnecting')
    await r.advance(1)
    assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.controller.view.outcome, r.lastSent('call-hangup')?.type], ['ended', text, 'lost', 'call-hangup'])
    assert.ok(peer.offers.filter((offer) => offer.iceRestart === true).length <= RESTART_MAX, 'restarts are bounded')
  }
})

test('failed (not just disconnected) restarts ICE at once', async () => {
  const r = rig()
  const { peer } = await connected(r)
  peer.signalingState = 'stable'
  peer.state('failed')
  await r.advance(1)
  assert.deepEqual(peer.offers.at(-1), { iceRestart: true })
})

test('a call that never connects ends within 20 seconds and says which kind of problem it was', async () => {
  const none = rig({ relay: 'off' })
  await accepted(none)
  await none.advance(CONNECT_TIMEOUT_MS - 1)
  assert.equal(none.controller.view.phase, 'connecting')
  await none.advance(1)
  assert.deepEqual([none.controller.view.phase, none.controller.view.notice, none.controller.view.outcome], ['ended', NO_RELAY_TEXT, 'failed'])
  assert.match(NO_RELAY_TEXT, /relay that is not available right now/)
  assert.deepEqual(none.lastSent('call-report'), { type: 'call-report', callId: 'call-1', path: 'failed' })
  assert.equal(none.streams[0]?.tracks[0]?.stopped, true)
  for (const state of ['limited', 'error'] as const) {
    const r = rig({ relay: state })
    await accepted(r)
    await r.advance(CONNECT_TIMEOUT_MS)
    assert.equal(r.controller.view.notice, NO_RELAY_TEXT, state)
  }
  const relayed = rig({ relay: 'on' })
  await accepted(relayed)
  await relayed.advance(CONNECT_TIMEOUT_MS)
  assert.equal(relayed.controller.view.notice, BLOCKED_TEXT, 'the relay was on and it still did not connect')
  await relayed.advance(ENDED_PROBLEM_MS)
  assert.equal(relayed.controller.view.phase, 'idle', 'a problem stays up longer than a plain ending, then goes')
})

test('the route is reported once: direct, or through the relay; quality turns weak on loss and back', async () => {
  const direct = rig()
  const one = await accepted(direct)
  one.peer.stats = statsOf('host', 'srflx')
  one.peer.state('connected'); await flush()
  assert.deepEqual([direct.controller.view.path, direct.lastSent('call-report')], ['direct', { type: 'call-report', callId: 'call-1', path: 'direct' }])
  const relayed = rig({ relay: 'on' })
  const two = await accepted(relayed)
  two.peer.stats = statsOf('relay', 'host')
  two.peer.state('connected'); await flush()
  assert.deepEqual([relayed.controller.view.path, relayed.sent.filter((frame) => frame.type === 'call-report').length], ['relay', 1])
  await relayed.advance(STATS_EVERY_MS)
  assert.equal(relayed.sent.filter((frame) => frame.type === 'call-report').length, 1, 'once only')
  // Packets arrive but a tenth are lost: weak. Then clean: good.
  two.peer.stats = statsOf('relay', 'host', 200, 20); await relayed.advance(STATS_EVERY_MS)
  assert.equal(relayed.controller.view.quality, 'weak')
  two.peer.stats = statsOf('relay', 'host', 400, 20); await relayed.advance(STATS_EVERY_MS)
  assert.equal(relayed.controller.view.quality, 'good')
  // Nothing arriving for two looks is weak too.
  await relayed.advance(STATS_EVERY_MS * 2)
  assert.equal(relayed.controller.view.quality, 'weak')
})

test('readStats finds the selected pair and the inbound audio, whichever side is the relay', () => {
  const sample = readStats({ forEach: (run) => statsOf('host', 'relay', 50, 5, 0.3).forEach(run) })
  assert.deepEqual(sample, { path: 'relay', rtt: 0.3, received: 50, lost: 5, bytes: 4000 })
  assert.equal(readStats({ forEach: () => {} }).path, null)
})

test('the microphone going away mid-call (a headset or Bluetooth device switching) does not drop the call: a new track replaces it', async () => {
  const r = rig()
  const { peer } = await connected(r)
  const first = r.streams[0] as FakeStream
  first.tracks[0]!.readyState = 'ended'
  first.tracks[0]!.onended?.()
  await flush()
  assert.equal(r.streams.length, 2)
  assert.equal(peer.sender.replaced, r.streams[1]?.tracks[0])
  assert.deepEqual([r.controller.view.phase, r.controller.view.mic, r.streams[1]?.tracks[0]?.enabled], ['connected', 'ready', true])
  r.state.deviceChange?.()
  await flush()
  assert.equal(r.controller.view.phase, 'connected')
  assert.equal(r.controller.view.devices?.length, 2)
  // If no microphone can be had, the call stays up and says what to do.
  r.env.getUserMedia = async () => { throw Object.assign(new Error('gone'), { name: 'NotFoundError' }) }
  r.streams[1]!.tracks[0]!.onended?.()
  await flush()
  assert.deepEqual([r.controller.view.phase, r.controller.view.micProblem], ['connected', 'no-device'])
})

test('the screen is kept on during the call where the browser can, and the player is told where it cannot', async () => {
  const yes = rig(); await connected(yes)
  assert.equal(yes.controller.view.awake, 'on')
  const no = rig(); no.state.awake = false; await connected(no)
  assert.equal(no.controller.view.awake, 'off')
})

test('speakers: the choice is offered when the browser has several, remembered, and applied to the voice', async () => {
  const r = rig()
  r.state.outputs = [{ id: '', label: 'System default' }, { id: 'bt', label: 'Headset' }]
  await connected(r)
  r.peers[0]?.ontrack && (r.peers[0].ontrack as (event: unknown) => void)({ streams: [{}], track: {} })
  assert.equal(r.controller.view.outputs?.length, 2)
  await r.controller.selectOutput('bt')
  assert.deepEqual([r.state.sink, r.controller.view.selectedOutput], ['bt', 'bt'])
})

test('the voice being blocked by the browser is shown and one tap plays it', async () => {
  const r = rig()
  let allowed = false
  r.env.createAudio = () => ({ srcObject: null, play: () => (allowed ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'))) }) as unknown as HTMLAudioElement
  const { peer } = await connected(r)
  ;(peer.ontrack as (event: unknown) => void)({ streams: [{}], track: {} })
  await flush()
  assert.equal(r.controller.view.playBlocked, true)
  allowed = true
  r.controller.playAudio()
  await flush()
  assert.equal(r.controller.view.playBlocked, false)
})

test('answered on another device: this one stops ringing, says so for a moment, then only shows the call; an unsupported browser says so before ringing', async () => {
  const r = rig()
  r.controller.handle({ type: 'call-incoming', callId: 'in-1', from: ADA, expiresAt: r.now() + 30000 })
  r.controller.handle({ type: 'call-state', callId: 'in-1', state: 'accepted', role: 'callee', peer: ADA, elsewhere: true })
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.controller.view.peer?.name, r.sent.length], ['elsewhere', ANSWERED_ELSEWHERE_TEXT, 'Ada', 0])
  await r.advance(ENDED_SHOWN_MS + 1010)
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
  const r = rig()
  const { peer } = await connected(r)
  assert.equal(r.controller.view.devices?.length, 2)
  r.controller.toggleMute()
  await r.controller.selectDevice('usb')
  assert.equal(r.streams.length, 2)
  assert.deepEqual([r.streams[0]?.tracks[0]?.stopped, r.streams[1]?.tracks[0]?.enabled, peer.sender.replaced === r.streams[1]?.tracks[0]], [true, false, true])
})

test('an invite that cannot be sent says so and opens nothing', async () => {
  const r = rig({ connected: false })
  r.controller.call(BOLA)
  assert.match(r.controller.view.notice ?? '', /not connected/)
  assert.deepEqual([r.state.media, r.peers.length], [0, 0])
})

// ---- one player, several devices (docs/DEVICES.md) ----

test('a device that shows a call on another device opens nothing and can end nothing: no microphone, no connection, no frame, whatever is pressed or closed', async () => {
  const r = rig()
  // The call was placed on another device of this player.
  r.controller.handle({ type: 'call-state', callId: 'out-1', state: 'ringing', role: 'caller', peer: BOLA, elsewhere: true })
  assert.deepEqual([r.controller.view.phase, r.controller.view.notice, r.controller.view.role], ['elsewhere', ELSEWHERE_TEXT, 'caller'])
  r.controller.handle({ type: 'call-state', callId: 'out-1', state: 'accepted', role: 'caller', peer: BOLA, elsewhere: true })
  await flush()
  assert.equal(r.controller.view.phase, 'elsewhere', 'the other side answering does not make this device start a microphone')
  r.controller.handle({ type: 'call-signal', callId: 'out-1', kind: 'answer', data: { sdp: 'x' } })
  r.controller.hangup(); r.controller.dismiss(); r.controller.pageHidden()
  await r.controller.accept(); await r.controller.startMicrophone(); r.controller.toggleMute(); await r.controller.selectOutput('x')
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
