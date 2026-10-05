// The community controller (src/community.ts) against a fake socket, fake peer connections and a fake
// microphone. There is no DOM: the controller publishes plain state, and these tests read it. The rules
// kept here are the old panel's: the microphone is off until the player asks, a joined stream starts
// muted, voice stops when the room is revoked or refused, and nothing asks for media on its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { TestContext } from 'node:test'
import { createCommunity } from './community.ts'
import type { CommunityOptions } from './community.ts'
import type { CommunityController, MembersEvent } from './types/community.ts'

const NAMES = ['fetch', 'navigator', 'WebSocket', 'RTCPeerConnection', 'AudioContext', 'location', 'setInterval', 'clearInterval', 'addEventListener', 'removeEventListener'] as const
type Loose = Record<string, any>
const g = globalThis as unknown as Loose
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

class WS {
  static OPEN = 1
  static CONNECTING = 0
  static instances: WS[] = []
  readyState = 0
  sent: Loose[] = []
  onopen: (() => void) | null = null
  onclose: ((event?: { code?: number }) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor() { WS.instances.push(this) }
  send(text: string): void { this.sent.push(JSON.parse(text)) }
  close(code?: number): void { this.readyState = 3; this.onclose?.(code === undefined ? undefined : { code }) }
  open(): void { this.readyState = 1; this.onopen?.() }
  receive(data: Loose, origin = true): void {
    if (origin) (data.members as Loose[] | undefined)?.forEach((member) => { member.position ??= { x: 0, z: 0 } })
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

class PC {
  static all: PC[] = []
  signalingState = 'stable'
  connectionState = 'new'
  closed = false
  localDescription: Loose | null = null
  remoteDescription: Loose | null = null
  lastCandidate: Loose | null = null
  onicecandidate: unknown = null
  ontrack: ((event: Loose) => void) | null = null
  onconnectionstatechange: unknown = null
  config: Loose
  constructor(config: Loose) { this.config = config; PC.all.push(this) }
  addTrack(): void {}
  async createOffer(): Promise<Loose> { return { type: 'offer', sdp: 'offer' } }
  async createAnswer(): Promise<Loose> { return { type: 'answer', sdp: 'answer' } }
  async setLocalDescription(d: Loose): Promise<void> { this.localDescription = { ...d, toJSON: () => d }; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable' }
  async setRemoteDescription(d: Loose): Promise<void> { this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable' }
  async addIceCandidate(c: Loose): Promise<void> { this.lastCandidate = c }
  close(): void { this.closed = true }
}

class FakeAudio {
  muted = false
  volume = 1
  srcObject: unknown = null
  autoplay = false
  playsInline = false
  playCalls = 0
  play(): Promise<void> { this.playCalls++; return Promise.resolve() }
}

/** Replace the browser globals the controller reads; restore them when the test ends. */
function browserFor(t: TestContext, options: { mediaDevices?: Loose; session?: Loose | null } = {}) {
  const originals = new Map(NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const apis: CommunityController[] = []
  t.after(() => {
    try { for (const api of apis) api.destroy() } finally {
      for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete g[name] }
    }
  })
  WS.instances = []
  PC.all = []
  const calls = { voiceConfig: 0 }
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: options.mediaDevices }, configurable: true, writable: true })
  g.location = { protocol: 'http:', host: 'localhost:5173' }
  g.WebSocket = WS
  g.RTCPeerConnection = function () {}
  const session = options.session === undefined ? { id: 'a', name: 'Alex' } : options.session
  g.fetch = async (url: string, init?: Loose) => ({
    ok: url === '/api/voice-config' || session !== null || init?.method === 'POST',
    status: session === null && url === '/api/session' && !init?.method ? 401 : 200,
    json: async () => (url === '/api/voice-config' ? (calls.voiceConfig++, { iceServers: [{ urls: 'stun:test' }], mode: 'stun-only', turnConfigured: false }) : { session }),
  })
  const audios: FakeAudio[] = []
  const start = async (extra: CommunityOptions = {}): Promise<CommunityController> => {
    const api = await createCommunity({ createAudio: () => { const audio = new FakeAudio(); audios.push(audio); return audio as unknown as HTMLAudioElement }, ...extra })
    apis.push(api)
    return api
  }
  return { start, calls, audios }
}
const lastSocket = (): WS => WS.instances.at(-1) as WS
const lastSent = (socket: WS): Loose => socket.sent.at(-1) as Loose

test('community microphone safeguards, spatial playback, and multi-tab venue revocation', async (t) => {
  let mediaCalls = 0, stopped = 0, enumerateCalls = 0
  const constraints: Loose[] = []
  const track = { enabled: true, stop() { stopped++ } }
  const { start, calls, audios } = browserFor(t, {
    mediaDevices: {
      enumerateDevices: async () => { enumerateCalls++; return [{ kind: 'audioinput', deviceId: 'test-mic', label: 'Test microphone' }] },
      getUserMedia: async (options: Loose) => { mediaCalls++; constraints.push(options); return { getTracks: () => [track], getAudioTracks: () => [track] } },
    },
  })
  const statuses: Loose[] = []
  const api = await start({ onStatus: (s) => statuses.push(s) })
  assert.equal(mediaCalls, 0, 'initialization must never request mic')
  assert.deepEqual(api.getSession(), { id: 'a', name: 'Alex' })
  const ws = lastSocket()
  ws.open()
  assert.deepEqual(ws.sent[0], { type: 'join', cityId: 'lagos', venueId: 'park' })
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false, muted: false }] })
  assert.equal(mediaCalls, 0, 'presence must never request mic')
  assert.equal(api.state.voice.on, false, 'the microphone is off by default')
  await api.joinVoice()
  assert.equal(mediaCalls, 1)
  assert.equal(stopped, 0)
  assert.deepEqual(lastSent(ws), { type: 'voice-state', enabled: true, muted: true })
  assert.equal(track.enabled, false, 'join defaults muted')
  assert.equal(enumerateCalls, 1, 'picker only lists devices after permission')
  assert.deepEqual(api.state.voice.devices, [{ id: '', label: 'System default' }, { id: 'test-mic', label: 'Test microphone' }])
  api.toggleMute()
  assert.equal(track.enabled, true, 'explicit unmute enables mic')
  api.selectDevice('test-mic')
  api.join('ibadan', 'library')
  assert.equal(stopped, 1, 'room change stops microphone')
  assert.deepEqual(lastSent(ws), { type: 'join', cityId: 'ibadan', venueId: 'library' })
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false, muted: false }] })
  assert.equal(api.sendChat('Hello'), true)
  const chat = lastSent(ws)
  assert.equal(chat.type, 'chat')
  assert.equal(chat.body, 'Hello')
  assert.ok(chat.clientId)
  ws.receive({ type: 'error', error: 'rate_limited', clientId: chat.clientId })
  assert.equal(api.state.chat[0]?.delivery, 'Not sent')
  assert.equal(api.state.chat[0]?.canRetry, true)
  assert.deepEqual(api.state.refusal, { seq: 1, text: 'Messages are arriving too quickly. Pause briefly before sending more.' }, 'a refused line is published for the host to repeat')
  const sentCount = ws.sent.length
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false, muted: false }] })
  assert.equal(ws.sent.length, sentCount, 'rejected messages never auto retry')
  api.retryMessage(chat.clientId as string)
  assert.equal(lastSent(ws).clientId, chat.clientId, 'manual retry retains dedupe id')
  ws.receive({ type: 'chat', id: 'message1', clientId: chat.clientId, from: { id: 'a', name: 'Alex' }, body: 'Hello', at: 1 })
  assert.equal(api.state.chat.length, 1)
  assert.equal(api.state.chat[0]?.delivery, 'Sent')
  ws.receive({ type: 'chat', id: 'message1', clientId: chat.clientId, from: { id: 'a', name: 'Alex' }, body: 'Hello', at: 1 })
  assert.equal(api.state.chat.length, 1, 'duplicate echo suppressed')
  ws.receive({ type: 'chat', id: 'message2', from: { id: 'b', name: 'Bola' }, body: 'Hi Alex', at: 2 })
  assert.equal(api.state.chat.at(-1)?.author, 'Bola')
  assert.equal(api.state.chat.at(-1)?.delivery, '', 'a message received from another player carries no delivery label')
  await api.joinVoice()
  assert.equal(mediaCalls, 2)
  assert.deepEqual(constraints[1], { audio: { deviceId: { exact: 'test-mic' } }, video: false })
  assert.equal(track.enabled, false)
  g.RTCPeerConnection = PC
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true }, { id: 'b', name: 'Bea', enabled: true }] })
  await tick()
  assert.equal(PC.all.length, 1)
  assert.equal(lastSent(ws).data.description.type, 'offer', 'lower id offers')
  ws.receive({ type: 'signal', from: 'b', data: { candidate: { candidate: 'ice' } } })
  ws.receive({ type: 'signal', from: 'b', data: { description: { type: 'answer', sdp: 'answer' } } })
  await tick()
  assert.equal(PC.all[0]?.remoteDescription?.type, 'answer')
  assert.equal(PC.all[0]?.lastCandidate?.candidate, 'ice')
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true }] })
  assert.equal(PC.all[0]?.closed, true, 'departed peer closes')
  ws.receive({ type: 'signal', from: 'outside', data: { description: { type: 'offer', sdp: 'bad' } } })
  assert.equal(PC.all.length, 1, 'outside-room signal ignored')
  api.destroy()
  assert.equal(stopped, 2, 'destroy stops microphone')
  assert.equal(ws.readyState, 3)
  assert.ok(statuses.some((s) => s.status === 'online' && s.connected && s.session.id === 'a'))
  assert.equal(calls.voiceConfig, 2)
  assert.equal(audios.length, 1)
})

test('synthetic audio: spatial playback, range, diagnostics and an explicit Join gate', async (t) => {
  const { start, calls, audios } = browserFor(t, { mediaDevices: { getUserMedia: async () => { throw new Error('the synthetic mode never captures the microphone') } } })
  let factoryCalls = 0, syntheticStops = 0, diagnosticsCalls = 0, timerCallback: (() => Promise<void>) | null = null, timerCleared = false
  const syntheticTrack = { enabled: true, readyState: 'live', stop() { syntheticStops++; this.readyState = 'ended' } }
  g.setInterval = (callback: () => Promise<void>, delay: number) => { assert.equal(delay, 1000, 'diagnostics sample at most 1Hz'); timerCallback = callback; return 99 }
  g.clearInterval = (id: number) => { if (id === 99) timerCleared = true }
  let contextsClosed = 0, remoteStops = 0, sourceConnections = 0, outputConnections = 0, contextCreations = 0
  g.AudioContext = class {
    destination = { kind: 'destination' }
    state = 'running'
    constructor() { contextCreations++ }
    createMediaStreamSource() { return { connect(target: Loose) { assert.equal(target.kind, 'gain'); sourceConnections++ }, disconnect() {} } }
    createGain() { return { kind: 'gain', gain: { value: 1 }, connect(this: Loose, target: Loose) { if (target.kind === 'analyser') target.inputGain = this; else { assert.equal(target.kind, 'destination'); outputConnections++ } }, disconnect() {} } }
    createAnalyser() { return { kind: 'analyser', fftSize: 512, inputGain: { gain: { value: 1 } } as Loose, getFloatTimeDomainData(this: Loose, samples: Float32Array) { samples.fill(0.25 * this.inputGain.gain.value) }, disconnect() {} } }
    async resume() {}
    async close() { contextsClosed++ }
  }
  g.RTCPeerConnection = PC
  const api = await start({ audioStreamFactory: async () => { factoryCalls++; return { getTracks: () => [syntheticTrack], getAudioTracks: () => [syntheticTrack] } as unknown as MediaStream }, diagnostics: true, onPeerStats() { diagnosticsCalls++ }, iceTransportPolicy: 'relay' })
  const ws = lastSocket()
  ws.open()
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
  assert.equal(factoryCalls, 0, 'synthetic factory gated behind explicit Join')
  assert.equal(contextCreations, 0, 'playback context absent before Join gesture')
  await api.joinVoice()
  await tick()
  assert.equal(factoryCalls, 1)
  assert.equal(syntheticTrack.enabled, false)
  assert.equal(api.state.voice.muteLabel, 'Unmute test audio')
  assert.deepEqual(await api.getDiagnostics(), { voice: true, muted: true, trackCount: 1, liveTrackCount: 1, localTracks: [{ enabled: false, muted: undefined, readyState: 'live' }], playbackContextState: 'running', position: { x: 0, z: 0 }, relayMode: 'stun-only', peers: [] })

  Object.assign(PC.prototype, { getStats: async () => new Map([[1, { kind: 'audio', type: 'inbound-rtp', packetsReceived: 20, totalAudioEnergy: 0.5 }], [2, { kind: 'audio', type: 'outbound-rtp', packetsSent: 30 }], [3, { kind: 'audio', type: 'media-source', audioLevel: 0.2, totalAudioEnergy: 0.8 }]]) as unknown })
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true }, { id: 'b', name: 'Bea', enabled: true }] })
  await tick()
  const remoteTrack = { readyState: 'live', stop() { remoteStops++; this.readyState = 'ended' } }
  ;(PC.all.at(-1) as PC).ontrack?.({ streams: [{ getTracks: () => [remoteTrack] }], track: remoteTrack })
  const measured = await api.getDiagnostics()
  assert.equal(measured.liveTrackCount, 2)
  assert.equal(measured.peers[0]?.rms, 0.25)
  assert.equal(measured.peers[0]?.inboundPacketsReceived, 20)
  assert.equal(measured.peers[0]?.totalAudioEnergy, 0.5)
  assert.equal(measured.peers[0]?.outboundPacketsSent, 30)
  assert.equal(measured.peers[0]?.sourceAudioLevel, 0.2)
  assert.equal(measured.peers[0]?.sourceTotalAudioEnergy, 0.8)
  assert.equal((PC.all.at(-1) as PC).config.iceTransportPolicy, 'relay', 'optional relay policy is passed to actual peer connection')
  assert.equal(sourceConnections, 1, 'source routes once through gain')
  assert.equal(outputConnections, 1, 'gain routes once to destination')
  const routedAudio = audios.at(-1) as FakeAudio
  assert.equal(routedAudio.muted, true)
  assert.ok(routedAudio.srcObject)
  assert.equal(routedAudio.playCalls, 1, 'WebAudio uses one muted decode sink')
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true, position: { x: 0, z: 0 } }, { id: 'b', name: 'Bea', enabled: true, position: { x: 6, z: 0 } }] })
  assert.equal((await api.getDiagnostics()).peers[0]?.gain, 0.5, 'half-range halves receive gain')
  assert.equal((await api.getDiagnostics()).peers[0]?.rms, 0.125, 'post-gain analyser amplitude halves')
  api.walk(2, 0)
  assert.deepEqual(lastSent(ws), { type: 'move', x: 2, z: 0 })
  assert.equal(api.moveTo(0, 0), true)
  assert.deepEqual(lastSent(ws), { type: 'move', x: 0.01, z: 0 }, 'a reported position is never exactly the origin, which means "not reported yet"')
  assert.equal(api.moveTo(40, -40), true)
  assert.deepEqual(lastSent(ws), { type: 'move', x: 20, z: -20 }, 'reports are kept inside the server bounds')
  assert.deepEqual((await api.getDiagnostics()).position, { x: 0, z: 0 }, 'move never optimistically overrides server position')
  const nearPeer = PC.all.at(-1) as PC
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true, position: { x: 0, z: 0 } }, { id: 'b', name: 'Bea', enabled: true, position: { x: 13, z: 0 } }] })
  assert.equal(nearPeer.closed, true, 'out-of-range peer hard closes')
  assert.equal((await api.getDiagnostics()).peers.length, 0)
  const beforeReentry = PC.all.length
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true, position: { x: 0, z: 0 } }, { id: 'b', name: 'Bea', enabled: true, position: { x: 3, z: 0 } }] })
  await tick()
  assert.equal(PC.all.length, beforeReentry + 1, 'range reentry negotiates fresh peer')
  assert.equal((await api.getDiagnostics()).peers[0]?.gain, 0.75)
  const rejectedPeer = PC.all.at(-1) as PC, countBeforeRejected = PC.all.length
  ws.receive({ type: 'error', error: 'peer_out_of_range', to: 'b' })
  assert.equal(rejectedPeer.closed, true)
  assert.equal((await api.getDiagnostics()).peers.length, 0)
  await tick()
  assert.equal(PC.all.length, countBeforeRejected, 'rejection never immediately loops reconnect')
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true, position: { x: 0, z: 0 } }, { id: 'b', name: 'Bea', enabled: true, position: { x: 3, z: 0 } }] })
  await tick()
  assert.equal(PC.all.length, countBeforeRejected + 1, 'fresh authoritative presence retries rejected peer')
  assert.equal(calls.voiceConfig, 1, 'a Join fetches server ICE without persistent credentials')
  assert.equal(diagnosticsCalls, 1)
  await (timerCallback as (() => Promise<void>) | null)?.()
  assert.equal(diagnosticsCalls, 2)
  api.leaveVoice()
  assert.equal(timerCleared, true)
  assert.equal(syntheticStops, 1)
  assert.equal(contextsClosed, 1)
  assert.equal(remoteStops, 1)
  assert.deepEqual(await api.getDiagnostics(), { voice: false, muted: false, trackCount: 0, liveTrackCount: 0, localTracks: [], playbackContextState: null, position: { x: 0, z: 0 }, relayMode: null, peers: [] })
  await (timerCallback as (() => Promise<void>) | null)?.()
  assert.equal(diagnosticsCalls, 2, 'stale diagnostics callback cannot publish after leave')
  api.join('lagos', 'home')
  assert.ok(api.state.roomText.includes('Your home (private)'))
  for (const [city, name] of [['ibadan', 'Ibadan'], ['abeokuta', 'Abeokuta'], ['ota', 'Ota'], ['ijebu-ode', 'Ijebu-Ode'], ['sagamu', 'Sagamu'], ['lagos', 'Lagos']] as const) {
    api.join(city, 'home')
    assert.ok(api.state.roomText.startsWith(`${name} · `), `the room line names ${name}: ${api.state.roomText}`)
  }
  assert.equal(api.state.privateHome, true)
  api.destroy()
})

test('a revoked room stops voice, refuses stale chat, and is restored only by an explicit join with the microphone off', async (t) => {
  const { start, audios } = browserFor(t, { mediaDevices: {} })
  let revokedStops = 0, revokedFactoryCalls = 0, contextsClosed = 0
  g.AudioContext = class { state = 'running'; async resume() {} async close() { contextsClosed++ } createMediaStreamSource() { throw new Error('no spatial graph in this test') } }
  g.RTCPeerConnection = PC
  const revokedTrack = { enabled: true, readyState: 'live', stop() { revokedStops++; this.readyState = 'ended' } }
  const api = await start({ diagnostics: true, audioStreamFactory: async () => { revokedFactoryCalls++; return { getTracks: () => [revokedTrack], getAudioTracks: () => [revokedTrack] } as unknown as MediaStream } })
  const ws = lastSocket()
  ws.open()
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
  await api.joinVoice()
  assert.equal(revokedFactoryCalls, 1)
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true }, { id: 'b', name: 'Bea', enabled: true }] })
  await tick()
  const revokedPeer = PC.all.at(-1) as PC
  api.sendChat('Pending before travel')
  ws.receive({ type: 'error', code: 'venue_mismatch', error: 'venue_mismatch' })
  const snapshot = await api.getDiagnostics()
  assert.equal(snapshot.voice, false)
  assert.equal(snapshot.liveTrackCount, 0)
  assert.equal(snapshot.playbackContextState, null)
  assert.equal(revokedStops, 1)
  assert.equal(revokedPeer.closed, true)
  assert.equal(contextsClosed, 1)
  assert.equal(api.state.voice.canJoin, false)
  assert.equal(api.state.composeDisabled, true)
  assert.equal(api.state.chat.at(-1)?.delivery, 'Not sent: you moved to another place')
  assert.equal(api.state.feedback, 'You moved to another place. Return to the game to reconnect here.')
  assert.equal(api.state.connection, 'Room changed')
  const sentAfterRevocation = ws.sent.length
  await api.joinVoice()
  assert.equal(revokedFactoryCalls, 1, 'revoked Join never reacquires stream')
  assert.equal(api.sendChat('Stale chat'), false)
  assert.equal(ws.sent.length, sentAfterRevocation, 'revoked room rejects stale chat')
  assert.equal(api.moveTo(2, 2), false)
  ws.receive({ type: 'presence', members: [] })
  assert.equal(api.state.voice.canJoin, false, 'presence lacking self cannot renew membership')
  ws.close()
  const socketCount = WS.instances.length
  api.reconnect()
  assert.equal(WS.instances.length, socketCount, 'Reconnect cannot automatically rejoin revoked room')
  api.join('lagos', 'park')
  assert.equal(WS.instances.length, socketCount + 1, 'explicit legitimate room join can reconnect same room')
  const renewed = lastSocket()
  renewed.open()
  renewed.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
  assert.equal(api.state.voice.canJoin, true)
  assert.equal(api.state.connection, 'Connected', 'explicit same-room recovery restores connection label')
  assert.equal(api.state.voice.on, false, 'membership renewal leaves the microphone off')
  assert.equal(revokedFactoryCalls, 1, 'membership renewal never automatically recaptures audio')
  assert.equal(renewed.sent.filter((message) => message.type === 'chat').length, 0, 'stale pending chat never retries after renewed membership')
  assert.equal(audios.length, 1)
})

test('a visit that ended, or a Home room that was refused, never leaves voice on', async (t) => {
  for (const refusal of ['visit_ended', 'not_a_guest']) {
    let stopped = 0
    const track = { enabled: true, stop() { stopped++ } }
    const { start } = browserFor(t, { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } })
    const api = await start()
    const ws = lastSocket()
    ws.open()
    ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
    await api.joinVoice()
    assert.equal(api.state.voice.on, true)
    assert.equal(track.enabled, false)
    ws.receive({ type: 'error', code: refusal, error: refusal })
    assert.equal(api.state.voice.on, false, refusal)
    assert.equal(stopped, 1, `${refusal} stops every track`)
    assert.ok(ws.sent.every((message) => message.type !== 'voice-state' || message.enabled === true || message.muted === false), 'no enabled voice-state is sent on a refusal')
    if (refusal === 'visit_ended') assert.equal(api.state.feedback, 'The visit has ended.')
    api.destroy()
  }
  // The rules themselves stay in the source, so a later edit cannot drop them quietly.
  const source = await readFile(new URL('./community.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(refused === 'not_a_guest'\) leaveVoice\(false\)/)
  assert.match(source, /if \(refused === 'venue_mismatch' \|\| refused === 'visit_ended'\) \{[\s\S]{0,400}?leaveVoice\(false\)/)
})

test('the Worker host heartbeat is answered with heartbeat-ack, and nothing asks for media on its own', async (t) => {
  let mediaCalls = 0
  const { start } = browserFor(t, { mediaDevices: { getUserMedia: async () => { mediaCalls++; throw new Error('must not be asked') } } })
  const api = await start()
  const ws = lastSocket()
  ws.open()
  ws.receive({ type: 'heartbeat' })
  assert.deepEqual(lastSent(ws), { type: 'heartbeat-ack' })
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
  api.walk(2, 0)
  api.sendChat('hi')
  api.toggleMute()
  assert.equal(mediaCalls, 0, 'no media without a gesture')
  assert.ok(ws.sent.every((message) => message.type !== 'voice-state'), 'and no voice-state is ever sent')
})

test('a new device is asked for a nickname before any socket opens', async (t) => {
  const { start } = browserFor(t, { session: null })
  const api = await start()
  assert.equal(api.state.hasSession, false)
  assert.equal(api.state.connection, 'Choose a nickname')
  assert.equal(WS.instances.length, 0)
  assert.equal(await api.saveName('ab'), false)
  assert.equal(api.state.feedback, 'Use a nickname with at least three characters.')
})

test('positions: the game moves the avatar, the room reports everyone back, and none of it touches the microphone', async (t) => {
  let mediaCalls = 0
  const { start } = browserFor(t, { mediaDevices: { getUserMedia: async () => { mediaCalls++; throw new Error('must not be asked') } } })
  const seen: MembersEvent[] = [], steps: number[][] = []
  let walks = true
  const api = await start({ onMembers: (list) => seen.push(list), onStep: (dx, dz) => { steps.push([dx, dz]); return walks } })
  const ws = lastSocket()
  assert.equal(api.moveTo(3, 4), false, 'no room yet: nothing is sent')
  ws.open()
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false, muted: true, position: { x: 0, z: 0 } }, { id: 'b', name: 'Bea', enabled: false, muted: true, position: { x: 6, z: -2 } }] }, false)
  assert.deepEqual(seen.at(-1), { self: 'a', members: [{ id: 'a', name: 'Alex', position: null }, { id: 'b', name: 'Bea', position: { x: 6, z: -2 } }] }, 'the game is told who is here and where; the origin means "not reported yet"')
  assert.equal(api.moveTo(3.25, -4.5), true)
  assert.deepEqual(lastSent(ws), { type: 'move', x: 3.25, z: -4.5 }, 'the scene position is what the room is told')
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false, muted: true, position: { x: 3.25, z: -4.5 } }, { id: 'b', name: 'Bea', enabled: true, muted: false, position: { x: 6, z: -2 } }] }, false)
  assert.deepEqual(seen.at(-1)?.members[0]?.position, { x: 3.25, z: -4.5 })
  assert.match(api.state.positionText, /1 of 1 person in voice is within range/, 'the panel says who is in range of where you stand')
  assert.equal(api.state.walkDisabled, false)
  // The Walk buttons ask the game to walk the avatar; only without a scene do they move the voice position directly.
  const before = ws.sent.length
  api.walk(0, -2)
  api.walk(2, 0)
  assert.deepEqual(steps, [[0, -2], [2, 0]])
  assert.equal(ws.sent.length, before, 'the game walked: the controller itself sent nothing')
  walks = false
  api.walk(-2, 0)
  assert.deepEqual(lastSent(ws), { type: 'move', x: 1.25, z: -4.5 }, 'no scene: the button moves the voice position as before')
  // Revocation empties the list for the game, refuses further moves and never touched the microphone.
  ws.receive({ type: 'error', code: 'venue_mismatch', error: 'venue_mismatch' })
  assert.deepEqual(seen.at(-1), { self: 'a', members: [] }, 'a revoked room has nobody in it')
  assert.equal(api.moveTo(1, 1), false, 'a revoked room accepts no position')
  const sent = ws.sent.length
  api.walk(0, -2)
  assert.equal(ws.sent.length, sent, 'nor does a Walk button reach it')
  assert.equal(mediaCalls, 0, 'positions never ask for the microphone')
  assert.ok(ws.sent.every((message) => message.type !== 'voice-state' || message.enabled === false), 'and never enable voice')
  api.destroy()
  assert.deepEqual(seen.at(-1), { self: 'a', members: [] })
})

test('state is published to subscribers and onChange, and a rejected line carries the server sentence once', async (t) => {
  const { start } = browserFor(t, { mediaDevices: {} })
  let changes = 0
  const api = await start({ onChange: () => { changes++ } })
  let latest = api.state
  const stop = api.subscribe((state) => { latest = state })
  const ws = lastSocket()
  ws.open()
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
  assert.ok(changes > 0)
  assert.equal(latest.memberCount, 1)
  assert.deepEqual(latest.members, [{ id: 'a', label: 'Alex (you)', state: 'Here' }])
  api.sendChat('<b>not html</b>')
  const clientId = lastSent(ws).clientId as string
  ws.receive({ type: 'error', error: 'text_blocked', message: 'That wording is not allowed here.', clientId })
  assert.equal(latest.refusal?.text, 'That wording is not allowed here.')
  assert.equal(latest.chat[0]?.body, '<b>not html</b>', 'user text is data, never markup')
  stop()
})

test('destroy releases everything the controller took: window listeners, timers, socket, tracks, peers and audio elements', async (t) => {
  let localStops = 0, remoteStops = 0, diagnosticsCleared = 0
  const localTrack = { enabled: true, stop() { localStops++ } }
  const remoteTrack = { enabled: true, readyState: 'live', stop() { remoteStops++ } }
  const remote = { getTracks: () => [remoteTrack], getAudioTracks: () => [remoteTrack] }
  const { start, audios } = browserFor(t, { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [localTrack], getAudioTracks: () => [localTrack] }) } })
  const added: [string, unknown][] = [], removed: [string, unknown][] = []
  g.addEventListener = (type: string, handler: unknown) => { added.push([type, handler]) }
  g.removeEventListener = (type: string, handler: unknown) => { removed.push([type, handler]) }
  g.setInterval = () => 77
  g.clearInterval = (id: number) => { if (id === 77) diagnosticsCleared++ }
  g.RTCPeerConnection = PC
  const published: unknown[] = []
  const api = await start({ diagnostics: true })
  api.subscribe((state) => published.push(state))
  assert.ok(added.some(([type]) => type === 'pagehide'), 'the controller listens for the page going away')
  const ws = lastSocket()
  ws.open()
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }, { id: 'b', name: 'Bea', enabled: true }] })
  await api.joinVoice()
  assert.equal(api.state.voice.muted, true, 'the microphone starts muted')
  assert.equal(localTrack.enabled, false)
  ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: true }, { id: 'b', name: 'Bea', enabled: true }] })
  await tick()
  const pc = PC.all[0]
  assert.ok(pc, 'a peer connection was made for the person in range')
  ;(pc.ontrack as (event: Loose) => void)({ streams: [remote], track: remoteTrack })
  const audio = audios[0]
  assert.ok(audio?.srcObject, 'received audio is attached')
  published.length = 0

  api.destroy()
  assert.equal(localStops, 1, 'the microphone track is stopped')
  assert.equal(remoteStops, 1, 'received tracks are stopped')
  assert.equal(pc.closed, true, 'the peer connection is closed')
  assert.equal(pc.ontrack, null); assert.equal(pc.onicecandidate, null); assert.equal(pc.onconnectionstatechange, null)
  assert.equal(audio?.srcObject, null, 'the audio element is released')
  assert.equal(diagnosticsCleared, 1, 'the diagnostics timer is cleared')
  assert.equal(ws.readyState, 3, 'the socket is closed')
  assert.equal(ws.onmessage, null); assert.equal(ws.onclose, null)
  for (const entry of added) assert.ok(removed.some(([type, handler]) => type === entry[0] && handler === entry[1]), `the ${entry[0]} listener is removed`)
  assert.deepEqual(lastSent(ws), { type: 'voice-state', enabled: false, muted: false }, 'the room is told voice is off')
  const after = published.length
  ws.receive({ type: 'presence', members: [] })
  assert.equal(published.length, after, 'nothing is published after destroy')
  assert.equal(api.destroy(), undefined, 'a second destroy does nothing')
})

test('destroy cancels a pending reconnect: no socket is opened afterwards', async (t) => {
  const { start } = browserFor(t, {})
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout
  const timers = new Map<number, () => void>()
  let nextTimer = 1000
  g.setTimeout = (callback: () => void, delay?: number) => { if (!delay) return realSet(callback, delay); timers.set(++nextTimer, callback); return nextTimer }
  g.clearTimeout = (id: number) => { if (timers.has(id)) timers.delete(id); else realClear(id) }
  t.after(() => { g.setTimeout = realSet; g.clearTimeout = realClear })
  const api = await start()
  const ws = lastSocket()
  ws.open()
  ws.close() // the connection drops: a reconnect is scheduled
  assert.equal(timers.size, 1, 'a reconnect is waiting')
  const sockets = WS.instances.length
  api.destroy()
  assert.equal(timers.size, 0, 'destroy clears the reconnect timer')
  assert.equal(WS.instances.length, sockets)
})

test('a socket closed because every connection is taken (1013) says so and keeps trying, however long it takes', async (t) => {
  const { start } = browserFor(t, {})
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout
  const timers = new Map<number, { run: () => void; delay: number }>()
  let nextTimer = 1000
  g.setTimeout = (callback: () => void, delay?: number) => { if (!delay) return realSet(callback, delay); timers.set(++nextTimer, { run: callback, delay }); return nextTimer }
  g.clearTimeout = (id: number) => { if (timers.has(id)) timers.delete(id); else realClear(id) }
  t.after(() => { g.setTimeout = realSet; g.clearTimeout = realClear })
  const api = await start()
  t.after(() => api.destroy())
  const delays: number[] = []
  // More refusals than the five tries an ordinary disconnection gets: the room still tries again, more and more slowly.
  for (let round = 0; round < 8; round++) {
    const ws = lastSocket()
    ws.open(); ws.close(1013)
    assert.match(api.state.feedback, /very busy right now/)
    assert.equal(timers.size, 1, `try ${round + 1} is waiting`)
    const [id, timer] = [...timers][0] as [number, { run: () => void; delay: number }]
    delays.push(timer.delay); timers.delete(id); timer.run()
  }
  assert.ok((delays[0] as number) >= 4000 && (delays[0] as number) <= 6000, `the first wait is about five seconds: ${delays[0]}`)
  assert.ok(delays.slice(3).every((delay) => delay >= 24000 && delay <= 36000), `later waits are about thirty seconds: ${delays.map(Math.round).join(', ')}`)
  // A place opened: the room is connected, and a later refusal starts from the short wait again.
  const ws = lastSocket()
  ws.open(); ws.receive({ type: 'presence', members: [{ id: 'a', name: 'Alex', enabled: false }] })
  assert.equal(api.state.connection, 'Connected')
  ws.close(1013)
  assert.ok(([...timers.values()][0] as { delay: number }).delay <= 6000)
})
