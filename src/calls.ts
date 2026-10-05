/**
 * THE CALL CONTROLLER: one-to-one voice calls over the social socket (frames: src/types/calls.ts).
 * It draws nothing. It publishes a plain `CallView` after every change and the Vue layer
 * (src/app/features/calls/) renders that. Everything it needs from the page is injected (`CallsEnv`),
 * so it runs against fakes in tests, as src/community.ts does.
 *
 * CONSENT. Nothing is transmitted and no microphone is opened until the callee has accepted:
 *   caller   call() only sends the invite. After the server says `accepted` the microphone is asked for
 *            from a tap on the call bar ("Tap to start your microphone"), or at once only while the
 *            browser still counts that tap as recent (`userActive`). The connection object and every
 *            session description come after the microphone, so none exists before then.
 *   callee   accept() is called from the Accept tap: it asks for the microphone and only then sends
 *            call-accept. The connection is made when the server confirms `accepted`.
 * Either side can hang up at any moment; a call that ends stops every track and closes the connection.
 *
 * LIFETIME. A ring that is not answered, a declined or cancelled call, a hang-up, a closed socket and
 * a server that lost its memory of calls (an `ended` frame with an empty call id) all end the call
 * locally. A network drop during a call shows "Reconnecting"; the caller restarts the connection after
 * a few seconds, and the call ends if it is not back within the grace period.
 */
import type { CallClientFrame, CallIncomingFrame, CallSignalData, CallSignalKind, CallServerFrame, CallSignalRelayFrame, CallStateFrame } from './types/calls.ts'
import type { PlayerRef } from './types/protocol.ts'
import type { MicrophoneChoice } from './types/community.ts'
import { fetchIceConfig, microphoneFailure } from './voice-config.ts'
import type { IceConfig } from './voice-config.ts'

export type CallPhase = 'idle' | 'calling' | 'ringing' | 'incoming' | 'starting' | 'needs-tap' | 'connecting' | 'connected' | 'reconnecting' | 'ended'
export interface CallView {
  phase: CallPhase
  peer: PlayerRef | null
  role: 'caller' | 'callee' | null
  callId: string
  /** Server time of the end of the ring, for the countdown; null when not ringing. */
  expiresAt: number | null
  /** Browser ms when the audio connected; the timer counts from here. */
  startedAt: number | null
  muted: boolean
  /** Why the last call ended, in plain words; shown while the phase is `ended`. */
  notice: string | null
  /** A problem the player can act on (the microphone was refused, ...), with the call still up. */
  error: string | null
  /** The browser blocked playing the other side's voice until a tap. */
  playBlocked: boolean
  devices: MicrophoneChoice[] | null
  selectedDevice: string
}

/** What the controller needs from the page. */
export interface CallsEnv {
  /** True when the frame was handed to an open socket. */
  send(frame: CallClientFrame): boolean
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  randomId(): string
  /** The browser can capture audio and make a connection. */
  supported(): boolean
  getUserMedia(deviceId: string): Promise<MediaStream>
  listMicrophones(): Promise<MicrophoneChoice[]>
  createPeer(config: RTCConfiguration): RTCPeerConnection
  fetchIce(): Promise<IceConfig>
  createAudio(): HTMLAudioElement
  /** The browser still counts the player's last tap as recent (navigator.userActivation.isActive). */
  userActive(): boolean
}

export const RECONNECT_RESTART_MS = 5000
export const RECONNECT_GRACE_MS = 20000
export const CONNECT_TIMEOUT_MS = 30000
export const ENDED_SHOWN_MS = 4000
const REGRET_MS = 1500

export const NO_CONNECTION_TEXT = 'The call could not connect. Calls need a direct path between two devices, and some networks (work, school, some mobile networks) do not allow it. Try another network.'

/** The browser's own pieces; `send` is the one thing the page must supply. */
export function browserCallsEnv(send: CallsEnv['send']): CallsEnv {
  const nav = (): Navigator | undefined => (typeof navigator === 'undefined' ? undefined : navigator)
  return {
    send,
    now: () => Date.now(),
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    randomId: () => `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    supported: () => Boolean(nav()?.mediaDevices?.getUserMedia) && typeof RTCPeerConnection !== 'undefined',
    getUserMedia: (deviceId) => navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false }),
    async listMicrophones() {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((device) => device.kind === 'audioinput' && device.deviceId)
      return [{ id: '', label: 'System default' }, ...inputs.map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }))]
    },
    createPeer: (config) => new RTCPeerConnection(config),
    fetchIce: () => fetchIceConfig(),
    createAudio: () => { const audio = new Audio(); audio.autoplay = true; return audio },
    userActive: () => nav()?.userActivation?.isActive === true,
  }
}

const ACTIVE: readonly CallPhase[] = ['calling', 'ringing', 'incoming', 'starting', 'needs-tap', 'connecting', 'connected', 'reconnecting']

export function createCallController(env: CallsEnv) {
  let phase: CallPhase = 'idle'
  let peer: PlayerRef | null = null
  let role: 'caller' | 'callee' | null = null
  let callId = '', clientId = ''
  let expiresAt: number | null = null, startedAt: number | null = null
  let muted = false, playBlocked = false
  let notice: string | null = null, error: string | null = null
  let devices: MicrophoneChoice[] | null = null, selectedDevice = ''
  let stream: MediaStream | null = null
  let pc: RTCPeerConnection | null = null
  let audio: HTMLAudioElement | null = null
  let peerReady: Promise<void> = Promise.resolve()
  let chain: Promise<void> = Promise.resolve()
  let candidates: RTCIceCandidateInit[] = []
  let generation = 0
  let abandoned: string | null = null
  const timers = { ring: null as unknown, ended: null as unknown, connect: null as unknown, restart: null as unknown, grace: null as unknown }
  const listeners = new Set<(view: CallView) => void>()

  const active = (): boolean => ACTIVE.includes(phase)
  const nameOf = (): string => peer?.name ?? 'them'
  function view(): CallView {
    return { phase, peer: peer ? { ...peer } : null, role, callId, expiresAt, startedAt, muted, notice, error, playBlocked, devices: devices ? devices.map((item) => ({ ...item })) : null, selectedDevice }
  }
  function emit(): void {
    const next = view()
    for (const listener of [...listeners]) { try { listener(next) } catch { /* the view's own problem */ } }
  }
  function clear(name: keyof typeof timers): void { if (timers[name] !== null) env.clearTimeout(timers[name]); timers[name] = null }
  function clearAll(): void { for (const name of Object.keys(timers) as (keyof typeof timers)[]) clear(name) }

  // ---- ending ---------------------------------------------------------------------------------------------------
  /** What to tell the server when this side leaves: decline while it rings for us, cancel while we ring, else hang up. */
  function leaveFrame(): CallClientFrame | null {
    if (!callId) return null
    if (role === 'callee' && (phase === 'incoming' || phase === 'starting')) return { type: 'call-decline', callId }
    if (role === 'caller' && (phase === 'ringing' || phase === 'calling')) return { type: 'call-cancel', callId }
    return { type: 'call-hangup', callId }
  }
  function release(): void {
    generation++
    clearAll()
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; try { pc.close() } catch { /* already closed */ } }
    pc = null
    if (audio) { audio.srcObject = null; audio = null }
    candidates = []; chain = Promise.resolve(); peerReady = Promise.resolve()
  }
  /** The call is over: stop everything, optionally tell the server, and show `text` for a moment. A null text goes straight to idle. */
  function finish(text: string | null, tell: boolean): void {
    if (tell) { const frame = leaveFrame(); if (frame) env.send(frame) }
    const was = phase
    release()
    muted = false; playBlocked = false; error = null; startedAt = null; expiresAt = null; devices = null
    if (text === null || was === 'idle') { phase = 'idle'; notice = null; peer = null; role = null; callId = ''; clientId = '' }
    else {
      phase = 'ended'; notice = text
      timers.ended = env.setTimeout(() => { timers.ended = null; if (phase === 'ended') { phase = 'idle'; notice = null; peer = null; role = null; callId = ''; clientId = ''; emit() } }, ENDED_SHOWN_MS)
    }
    emit()
  }

  // ---- the connection -------------------------------------------------------------------------------------------
  const candidateData = (candidate: RTCIceCandidate): CallSignalData => ({ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null, usernameFragment: candidate.usernameFragment ?? null })
  const signal = (kind: CallSignalKind, data: CallSignalData): boolean => (callId ? env.send({ type: 'call-signal', callId, kind, data }) : false)

  function onConnectionState(connection: RTCPeerConnection): void {
    if (connection !== pc || !active()) return
    const state = connection.connectionState
    if (state === 'connected') {
      clear('connect'); clear('restart'); clear('grace')
      if (startedAt === null) startedAt = env.now()
      phase = 'connected'; emit()
      if (!devices) void loadDevices(generation)
    } else if (state === 'disconnected' || state === 'failed') {
      if (phase === 'connected' || phase === 'connecting') { phase = 'reconnecting'; emit() }
      if (timers.grace === null) timers.grace = env.setTimeout(() => { timers.grace = null; finish('The connection was lost.', true) }, RECONNECT_GRACE_MS)
      if (role === 'caller' && timers.restart === null) timers.restart = env.setTimeout(() => { timers.restart = null; void restartIce(connection) }, state === 'failed' ? 0 : RECONNECT_RESTART_MS)
    } else if (state === 'closed' && phase !== 'ended') { /* closed by us */ }
  }
  async function restartIce(connection: RTCPeerConnection): Promise<void> {
    if (connection !== pc || role !== 'caller') return
    try {
      const offer = await connection.createOffer({ iceRestart: true })
      await connection.setLocalDescription(offer)
      if (connection === pc && connection.localDescription?.sdp) signal('offer', { sdp: connection.localDescription.sdp })
    } catch { /* the grace timer decides */ }
  }
  /** Make the connection, with the microphone already open. Never called before the callee has accepted. */
  function makePeer(local: MediaStream, myGeneration: number): Promise<void> {
    return (async () => {
      const config = await env.fetchIce()
      if (myGeneration !== generation) return
      const connection = env.createPeer({ iceServers: config.iceServers, iceTransportPolicy: 'all' })
      pc = connection
      local.getTracks().forEach((track) => connection.addTrack(track, local))
      connection.onicecandidate = ({ candidate }) => { if (candidate && connection === pc) signal('ice', candidateData(candidate)) }
      connection.onconnectionstatechange = () => onConnectionState(connection)
      connection.ontrack = ({ streams, track }) => {
        if (connection !== pc) return
        const remote = streams[0] ?? new MediaStream([track])
        audio ??= env.createAudio()
        audio.srcObject = remote
        void audio.play().then(() => { if (playBlocked) { playBlocked = false; emit() } }).catch(() => { playBlocked = true; emit() })
      }
      clear('connect')
      timers.connect = env.setTimeout(() => { timers.connect = null; if (phase === 'connecting' || phase === 'reconnecting') finish(NO_CONNECTION_TEXT, true) }, CONNECT_TIMEOUT_MS)
    })()
  }
  async function loadDevices(myGeneration: number): Promise<void> {
    try {
      const list = await env.listMicrophones()
      if (myGeneration !== generation) return
      devices = list
      if (selectedDevice && !list.some((item) => item.id === selectedDevice)) selectedDevice = ''
      emit()
    } catch { /* the system default is used */ }
  }
  const micWords = (failure: unknown): string => (microphoneFailure(failure) === 'denied' ? 'Microphone permission was denied. Allow the microphone for this site and try again.' : 'No microphone could be opened. Check your device and try again.')

  // ---- what the player does -------------------------------------------------------------------------------------
  /** Ring a player. Opens nothing: the microphone and the connection wait for the answer. */
  function call(target: PlayerRef): boolean {
    if (active()) return false
    clear('ended'); release()
    if (!env.supported()) { peer = { ...target }; phase = 'ended'; notice = 'Calls need a supported browser on HTTPS.'; role = 'caller'; timers.ended = env.setTimeout(() => finish(null, false), ENDED_SHOWN_MS); emit(); return false }
    peer = { ...target }; role = 'caller'; callId = ''; clientId = env.randomId(); notice = null; error = null; abandoned = null
    phase = 'calling'; expiresAt = null; muted = false; startedAt = null
    emit()
    if (!env.send({ type: 'call-invite', to: target.id, clientId })) finish('You are not connected. Try again in a moment.', false)
    return true
  }
  /** The caller gave up, or the callee declined, or either side hung up. */
  function hangup(): void {
    if (!active()) { if (phase === 'ended') finish(null, false); return }
    if (phase === 'calling' && !callId) { abandoned = clientId; finish('Call cancelled.', false); return }
    const text = phase === 'incoming' || (phase === 'starting' && role === 'callee') ? 'Call declined.' : phase === 'ringing' ? 'Call cancelled.' : 'Call ended.'
    finish(text, true)
  }
  /** The Accept tap. Asks for the microphone, and only then tells the server. */
  async function accept(): Promise<void> {
    if (phase !== 'incoming' || role !== 'callee' || !env.supported()) return
    if (expiresAt !== null && env.now() >= expiresAt + REGRET_MS * 4) return
    const mine = ++generation
    const answering = callId
    phase = 'starting'; error = null; emit()
    let local: MediaStream
    try { local = await env.getUserMedia(selectedDevice) } catch (failure) {
      if (mine !== generation || phase !== 'starting') return
      phase = 'incoming'; error = micWords(failure); emit(); return
    }
    if (mine !== generation || phase !== 'starting' || callId !== answering) { local.getTracks().forEach((track) => track.stop()); return }
    stream = local
    if (!env.send({ type: 'call-accept', callId })) finish('You are not connected. Try again in a moment.', false)
  }
  /** Caller, after `accepted`, from a tap: open the microphone, make the connection and send the offer. */
  async function startMicrophone(): Promise<void> {
    if (role !== 'caller' || (phase !== 'needs-tap' && phase !== 'starting') || stream) return
    const mine = ++generation
    phase = 'starting'; error = null; emit()
    let local: MediaStream
    try { local = await env.getUserMedia(selectedDevice) } catch (failure) {
      if (mine !== generation || phase !== 'starting') return
      phase = 'needs-tap'; error = micWords(failure); emit(); return
    }
    if (mine !== generation || phase !== 'starting') { local.getTracks().forEach((track) => track.stop()); return }
    stream = local
    phase = 'connecting'; emit()
    try {
      peerReady = makePeer(local, mine)
      await peerReady
      const connection = pc
      if (mine !== generation || !connection) return
      await connection.setLocalDescription(await connection.createOffer())
      if (mine === generation && connection.localDescription?.sdp) signal('offer', { sdp: connection.localDescription.sdp })
    } catch { if (mine === generation) finish('The call could not be set up. Try again.', true) }
  }
  function toggleMute(): void {
    if (phase !== 'connected' && phase !== 'connecting' && phase !== 'reconnecting') return
    muted = !muted
    stream?.getAudioTracks().forEach((track) => { track.enabled = !muted })
    emit()
  }
  function playAudio(): void {
    void audio?.play().then(() => { playBlocked = false; emit() }).catch(() => { error = 'Audio playback is blocked. Check your browser sound permissions.'; emit() })
  }
  /** Switch microphones during the call; the mute state is kept. */
  async function selectDevice(id: string): Promise<void> {
    selectedDevice = id
    const connection = pc
    if (!stream || !connection) { emit(); return }
    const mine = generation
    try {
      const next = await env.getUserMedia(id)
      if (mine !== generation || connection !== pc) { next.getTracks().forEach((track) => track.stop()); return }
      const track = next.getAudioTracks()[0]
      const sender = connection.getSenders().find((item) => item.track?.kind === 'audio')
      if (!track || !sender) { next.getTracks().forEach((item) => item.stop()); return }
      track.enabled = !muted
      await sender.replaceTrack(track)
      stream.getTracks().forEach((old) => old.stop())
      stream = next; error = null
    } catch (failure) { error = micWords(failure) }
    emit()
  }

  // ---- what the server says -------------------------------------------------------------------------------------
  function onIncoming(frame: CallIncomingFrame): void {
    if (active()) return
    clear('ended'); release()
    peer = { ...frame.from }; role = 'callee'; callId = frame.callId; clientId = ''; expiresAt = frame.expiresAt; notice = null; error = null
    phase = 'incoming'; muted = false
    const wait = Math.max(0, frame.expiresAt - env.now()) + REGRET_MS
    timers.ring = env.setTimeout(() => { timers.ring = null; if (phase === 'incoming') finish(`Missed call from ${nameOf()}.`, false) }, Math.min(wait, 40000))
    emit()
  }
  function onState(frame: CallStateFrame): void {
    // The host lost its memory of calls, or an unknown call was named: whatever this side holds is over.
    if (frame.callId === '' && frame.state === 'ended') { if (active()) finish('The call ended.', false); return }
    if (frame.callId === '') {
      // A refusal to ring: only ever for our own invite, and never says why.
      if (frame.clientId !== clientId || phase !== 'calling') return
      finish(frame.limited ? 'Too many call attempts. Try again in a minute.' : frame.busy ? 'You are already in a call.' : `${nameOf()} can’t be reached right now.`, false)
      return
    }
    // The player cancelled before the server had named the call: it is cancelled the moment it is named.
    if (abandoned !== null && frame.clientId === abandoned && frame.state === 'ringing') { abandoned = null; env.send({ type: 'call-cancel', callId: frame.callId }); return }
    if (phase === 'calling' && frame.clientId === clientId) callId = frame.callId
    if (frame.callId !== callId) return
    switch (frame.state) {
      case 'ringing':
        if (role === 'caller') { phase = 'ringing'; expiresAt = frame.expiresAt ?? null; emit() }
        return
      case 'accepted':
        if (frame.elsewhere) { finish(null, false); return }
        clear('ring'); expiresAt = null
        if (role === 'caller') {
          phase = 'needs-tap'; emit()
          if (env.userActive()) void startMicrophone()
        } else if (stream) {
          phase = 'connecting'; emit()
          peerReady = makePeer(stream, generation).catch(() => { if (active()) finish('The call could not be set up. Try again.', true) })
        } else finish('Call ended.', true)
        return
      case 'declined': finish(role === 'callee' ? 'Call declined.' : `${nameOf()} declined the call.`, false); return
      case 'cancelled': finish(role === 'callee' ? `Missed call from ${nameOf()}.` : 'Call cancelled.', false); return
      case 'timeout': finish(role === 'callee' ? `Missed call from ${nameOf()}.` : `${nameOf()} did not answer.`, false); return
      case 'unreachable': finish(`${nameOf()} can’t be reached right now.`, false); return
      case 'ended': finish('Call ended.', false); return
    }
  }
  function onSignal(frame: CallSignalRelayFrame): void {
    if (!active() || frame.callId !== callId || (phase !== 'connecting' && phase !== 'connected' && phase !== 'reconnecting')) return
    chain = chain.then(async () => {
      await peerReady
      const connection = pc
      if (!connection || frame.callId !== callId) return
      if (frame.kind === 'offer' && role === 'callee' && 'sdp' in frame.data) {
        await connection.setRemoteDescription({ type: 'offer', sdp: frame.data.sdp })
        for (const pending of candidates.splice(0)) await connection.addIceCandidate(pending)
        await connection.setLocalDescription(await connection.createAnswer())
        if (connection.localDescription?.sdp) signal('answer', { sdp: connection.localDescription.sdp })
      } else if (frame.kind === 'answer' && role === 'caller' && 'sdp' in frame.data && connection.signalingState === 'have-local-offer') {
        await connection.setRemoteDescription({ type: 'answer', sdp: frame.data.sdp })
        for (const pending of candidates.splice(0)) await connection.addIceCandidate(pending)
      } else if (frame.kind === 'ice' && 'candidate' in frame.data) {
        const init: RTCIceCandidateInit = { candidate: frame.data.candidate, sdpMid: frame.data.sdpMid ?? null, sdpMLineIndex: frame.data.sdpMLineIndex ?? null, ...(frame.data.usernameFragment ? { usernameFragment: frame.data.usernameFragment } : {}) }
        if (connection.remoteDescription) await connection.addIceCandidate(init)
        else if (candidates.length < 100) candidates.push(init)
      }
    }).catch(() => { if (active()) finish('The call could not be set up. Try again.', true) })
  }

  /** A frame from the social socket (the host passes the call frames only). */
  function handle(frame: CallServerFrame): void {
    if (frame.type === 'call-incoming') onIncoming(frame)
    else if (frame.type === 'call-state') onState(frame)
    else if (frame.type === 'call-signal') onSignal(frame)
  }
  /** The social socket closed: the server ends a player's call when their last socket goes, so this side is over too. */
  function socketClosed(): void { if (active()) finish('The connection was lost.', false) }
  function dismiss(): void { if (phase === 'ended') { clear('ended'); finish(null, false) } else if (error) { error = null; emit() } }
  function destroy(): void { if (active()) finish(null, true); else release(); listeners.clear() }

  return {
    get view(): CallView { return view() },
    subscribe(listener: (next: CallView) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
    call, hangup, accept, startMicrophone, toggleMute, playAudio, selectDevice, handle, socketClosed, dismiss, destroy,
  }
}
export type CallController = ReturnType<typeof createCallController>
