/**
 * THE CALL CONTROLLER: one-to-one voice calls over the social socket (frames: src/types/calls.ts).
 * It draws nothing. It publishes a plain `CallView` after every change and the Vue layer
 * (src/app/features/calls/) renders that. Everything it needs from the page is injected (`CallsEnv`),
 * so it runs against fakes in tests, as src/community.ts does.
 *
 * THE MICROPHONE. Pressing Call and pressing Answer are taps, so the microphone is asked for right then: the caller's
 * permission prompt appears while the phone rings, and the callee's at Answer. A microphone that is open sends nothing
 * on its own: its track stays DISABLED until the audio connection is up (and while the player is muted), and the
 * connection itself is made only after the callee has accepted. If the browser refuses, the player is told which of
 * four things it was (blocked, none found, used by another app, other) and Try again asks once more from a tap. The
 * phase `needs-tap` (button "Tap to talk") is the fallback for a caller whose answer came while the microphone was
 * still missing.
 *
 * THE CONNECTION. After `accepted` each side asks the server for its connection servers (`call-ice`): STUN, plus a
 * relay with short-lived credentials made for this call when the host has one and a limit allows (server/call-relay.ts).
 * Nothing is gathered before that, so no address is revealed before the callee has accepted. Direct paths are preferred;
 * the relay is the automatic fallback. The caller offers; an ICE restart follows `disconnected` and `failed`
 * (Wi-Fi to mobile data), with "Reconnecting" shown, and every wait is bounded: CONNECT_TIMEOUT_MS to connect,
 * RECONNECT_GRACE_MS to recover. A call that cannot connect says why in words (no relay available, or blocked even
 * through the relay), and tells the server only whether it connected directly, through the relay, or not (`call-report`).
 *
 * SEVERAL DEVICES (docs/DEVICES.md). A player's every open device rings. The one that answers, or that placed the call,
 * CARRIES it: the microphone, the connection and the Hang up button are there and nowhere else. Every other device of
 * that player is in the phase `elsewhere`: it shows that the call is on another device ("Answered on another device" for
 * a moment when it had been ringing), opens no microphone, makes no connection, and sends the server nothing about the
 * call, so it cannot end it, by a button or by being closed. It goes quiet when the server says the call is over.
 * A device that is closed while it only rings tells the server nothing either: the other devices go on ringing.
 *
 * LIFETIME. A ring that is not answered, a declined or cancelled call, a hang-up, a closed socket and
 * a server that lost its memory of calls (an `ended` frame with an empty call id) all end the call
 * locally. The ended state keeps the other player and the length of the call for a few seconds (Call again, Message).
 */
import type { CallClientFrame, CallIceFrame, CallIceServer, CallIncomingFrame, CallPath, CallRelayState, CallSignalData, CallSignalKind, CallServerFrame, CallSignalRelayFrame, CallStateFrame } from './types/calls.ts'
import type { PlayerRef } from './types/protocol.ts'
import type { MicrophoneChoice } from './types/community.ts'
import { MIC_HELP, microphoneProblem } from './voice-config.ts'
import type { MicProblem } from './voice-config.ts'

export type CallPhase = 'idle' | 'calling' | 'ringing' | 'incoming' | 'starting' | 'needs-tap' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'elsewhere'
/** How a call ended, for the summary: what the screen offers (Call again, Call back, Try again) follows from it. */
export type CallOutcome = 'ended' | 'missed' | 'declined' | 'cancelled' | 'unanswered' | 'unreachable' | 'busy' | 'limited' | 'failed' | 'lost' | 'mic' | 'error'
export type CallQuality = 'good' | 'weak' | 'reconnecting'
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
  /** Why the last call ended, in plain words, while the phase is `ended`; what to say about a call on another device while it is `elsewhere`. */
  notice: string | null
  /** A problem the player can act on (the microphone was refused, ...), with the call still up. */
  error: string | null
  /** The browser blocked playing the other side's voice until a tap. */
  playBlocked: boolean
  devices: MicrophoneChoice[] | null
  selectedDevice: string
  /** While `ended`: how it ended, and how long the audio was connected (ms; null when it never was). */
  outcome: CallOutcome | null
  duration: number | null
  /** The microphone: not asked for, being asked for, open, or refused (`micProblem` says how). */
  mic: 'none' | 'asking' | 'ready' | 'problem'
  micProblem: MicProblem | null
  /** How loud the player is, 0 (silent or muted) to 5. */
  micLevel: number
  quality: CallQuality | null
  /** Which way the audio goes once connected. */
  path: 'direct' | 'relay' | null
  /** What the host said about the relay for this call (null: not asked yet). */
  relay: CallRelayState | null
  /** Where the other side's voice plays, when the browser lets the player choose. */
  outputs: MicrophoneChoice[] | null
  selectedOutput: string
  /** The screen is kept on during the call (`on`), or this browser cannot (`off`: locking the phone may pause the call). Null before the call connects. */
  awake: 'on' | 'off' | null
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
  createAudio(): HTMLAudioElement
  /** Called inside the Call and Answer taps, so the browser lets this page make sound later (it resumes the audio context). */
  unlockAudio?(): void
  /** Watches the loudness of a stream; returns the stop. `level` is 0 to 1. */
  meter?(stream: MediaStream, level: (value: number) => void): () => void
  /** False when the device has no network. */
  online?(): boolean
  /** The list of audio devices changed (a headset or a Bluetooth device came or went). Returns the stop. */
  onDeviceChange?(run: () => void): () => void
  /** Keeps the screen on; returns the release, or null when the browser cannot. */
  keepAwake?(): (() => void) | null
  listOutputs?(): Promise<MicrophoneChoice[] | null>
  setOutput?(audio: HTMLAudioElement, id: string): Promise<void>
}

export const RECONNECT_RESTART_MS = 3000
export const RESTART_EVERY_MS = 6000
export const RESTART_MAX = 4
export const RECONNECT_GRACE_MS = 30000
export const CONNECT_TIMEOUT_MS = 20000
export const ICE_WAIT_MS = 4000
export const STATS_EVERY_MS = 2000
/** How long the summary of an ended call stays (a call that could not be made or connected stays longer, to be read). */
export const ENDED_SHOWN_MS = 3000
export const ENDED_PROBLEM_MS = 8000
const REGRET_MS = 1500

export const ANSWERED_ELSEWHERE_TEXT = 'Answered on another device.'
export const ELSEWHERE_TEXT = 'On a call on another device.'
export const NO_RELAY_TEXT = 'Could not connect — your networks need a relay that is not available right now.'
export const BLOCKED_TEXT = 'Could not connect — a network in this call blocked the audio, even through the relay. Try another network.'
export const PEER_LOST_TEXT = 'The other side lost connection.'
export const SELF_LOST_TEXT = 'Your connection dropped and the call could not be restored.'
/** Kept for the screens that name the old wording. */
export const NO_CONNECTION_TEXT = NO_RELAY_TEXT
/** Used when the host does not answer `call-ice` in time (an older host). */
export const FALLBACK_ICE: CallIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/** The browser's own pieces; `send` is the one thing the page must supply. */
export function browserCallsEnv(send: CallsEnv['send']): CallsEnv {
  const nav = (): Navigator | undefined => (typeof navigator === 'undefined' ? undefined : navigator)
  let context: AudioContext | null = null
  const audioContext = (): AudioContext | null => {
    if (typeof AudioContext === 'undefined') return null
    try { context ??= new AudioContext() } catch { return null }
    return context
  }
  const sinkable = (audio: HTMLAudioElement | null): audio is HTMLAudioElement & { setSinkId(id: string): Promise<void> } => Boolean(audio) && typeof (audio as { setSinkId?: unknown }).setSinkId === 'function'
  return {
    send,
    now: () => Date.now(),
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    randomId: () => `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    supported: () => Boolean(nav()?.mediaDevices?.getUserMedia) && typeof RTCPeerConnection !== 'undefined',
    getUserMedia: (deviceId) => navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true }, video: false }),
    async listMicrophones() {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((device) => device.kind === 'audioinput' && device.deviceId)
      return [{ id: '', label: 'System default' }, ...inputs.map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }))]
    },
    createPeer: (config) => new RTCPeerConnection(config),
    createAudio: () => { const audio = new Audio(); audio.autoplay = true; return audio },
    unlockAudio() { const audio = audioContext(); if (audio && audio.state === 'suspended') void audio.resume().catch(() => {}) },
    meter(stream, level) {
      const audio = audioContext()
      if (!audio) return () => {}
      try {
        const source = audio.createMediaStreamSource(stream), analyser = audio.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const timer = globalThis.setInterval(() => {
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (const sample of data) { const centred = (sample - 128) / 128; sum += centred * centred }
          level(Math.min(1, Math.sqrt(sum / data.length) * 4))
        }, 150)
        return () => { globalThis.clearInterval(timer); try { source.disconnect() } catch { /* already gone */ } }
      } catch { return () => {} }
    },
    online: () => nav()?.onLine !== false,
    onDeviceChange(run) {
      const devices = nav()?.mediaDevices
      if (!devices?.addEventListener) return () => {}
      devices.addEventListener('devicechange', run)
      return () => devices.removeEventListener('devicechange', run)
    },
    keepAwake() {
      const lock = (nav() as (Navigator & { wakeLock?: { request(kind: 'screen'): Promise<{ release(): Promise<void> }> } }) | undefined)?.wakeLock
      if (!lock) return null
      let held: { release(): Promise<void> } | null = null, wanted = true
      const take = (): void => { if (wanted && document.visibilityState === 'visible') void lock.request('screen').then((sentinel) => { if (wanted) held = sentinel; else void sentinel.release() }).catch(() => {}) }
      document.addEventListener('visibilitychange', take)
      take()
      return () => { wanted = false; document.removeEventListener('visibilitychange', take); void held?.release().catch(() => {}); held = null }
    },
    async listOutputs() {
      if (!sinkable(new Audio())) return null
      const all = await navigator.mediaDevices.enumerateDevices()
      const outputs = all.filter((device) => device.kind === 'audiooutput' && device.deviceId)
      return outputs.length > 1 ? [{ id: '', label: 'System default' }, ...outputs.filter((device) => device.deviceId !== 'default').map((device, index) => ({ id: device.deviceId, label: device.label || `Speaker ${index + 1}` }))] : null
    },
    async setOutput(audio, id) { if (sinkable(audio)) await audio.setSinkId(id) },
  }
}

const ACTIVE: readonly CallPhase[] = ['calling', 'ringing', 'incoming', 'starting', 'needs-tap', 'connecting', 'connected', 'reconnecting']

/** What a statistics report says about the call: which way the audio goes, and how it is doing since the last look. */
export interface CallSample { path: 'direct' | 'relay' | null; rtt: number | null; received: number; lost: number; bytes: number }
export function readStats(report: { forEach(run: (stat: Record<string, unknown>) => void): void }): CallSample {
  const sample: CallSample = { path: null, rtt: null, received: 0, lost: 0, bytes: 0 }
  const byId = new Map<string, Record<string, unknown>>()
  let selected = ''
  report.forEach((stat) => {
    if (typeof stat.id === 'string') byId.set(stat.id, stat)
    if (stat.type === 'transport' && typeof stat.selectedCandidatePairId === 'string') selected = stat.selectedCandidatePairId
    if (stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio')) {
      sample.received += Number(stat.packetsReceived) || 0
      sample.lost += Number(stat.packetsLost) || 0
      sample.bytes += Number(stat.bytesReceived) || 0
    }
  })
  let pair = selected ? byId.get(selected) : undefined
  if (!pair) report.forEach((stat) => { if (!pair && stat.type === 'candidate-pair' && (stat.selected === true || (stat.nominated === true && stat.state === 'succeeded'))) pair = stat })
  if (pair) {
    const local = byId.get(String(pair.localCandidateId)), remote = byId.get(String(pair.remoteCandidateId))
    sample.path = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct'
    if (typeof pair.currentRoundTripTime === 'number') sample.rtt = pair.currentRoundTripTime
  }
  return sample
}

export function createCallController(env: CallsEnv) {
  let phase: CallPhase = 'idle'
  let peer: PlayerRef | null = null
  let role: 'caller' | 'callee' | null = null
  let callId = '', clientId = ''
  let expiresAt: number | null = null, startedAt: number | null = null
  let muted = false, playBlocked = false
  let notice: string | null = null, error: string | null = null
  let outcome: CallOutcome | null = null, duration: number | null = null
  let devices: MicrophoneChoice[] | null = null, selectedDevice = ''
  let outputs: MicrophoneChoice[] | null = null, selectedOutput = ''
  let mic: CallView['mic'] = 'none', micProblem: MicProblem | null = null, micLevel = 0
  let quality: CallQuality | null = null, path: 'direct' | 'relay' | null = null, relay: CallRelayState | null = null
  let awake: 'on' | 'off' | null = null
  let stream: MediaStream | null = null
  let micReady: Promise<MediaStream | null> = Promise.resolve(null)
  let pc: RTCPeerConnection | null = null
  let audio: HTMLAudioElement | null = null
  let peerReady: Promise<void> = Promise.resolve()
  let chain: Promise<void> = Promise.resolve()
  let candidates: RTCIceCandidateInit[] = []
  let epoch = 0
  let abandoned: string | null = null
  let reported = false, restarts = 0, quiet = 0
  let last: CallSample | null = null
  let iceWaiter: ((frame: CallIceFrame) => void) | null = null
  let stopMeter: (() => void) | null = null, stopDevices: (() => void) | null = null, releaseAwake: (() => void) | null = null
  const timers = { ring: null as unknown, ended: null as unknown, connect: null as unknown, restart: null as unknown, grace: null as unknown, stats: null as unknown, ice: null as unknown }
  const listeners = new Set<(view: CallView) => void>()

  const active = (): boolean => ACTIVE.includes(phase)
  const nameOf = (): string => peer?.name ?? 'them'
  const flowing = (): boolean => phase === 'connected' || phase === 'reconnecting'
  function view(): CallView {
    return {
      phase, peer: peer ? { ...peer } : null, role, callId, expiresAt, startedAt, muted, notice, error, playBlocked, devices: devices ? devices.map((item) => ({ ...item })) : null, selectedDevice,
      outcome, duration, mic, micProblem, micLevel, quality, path, relay, outputs: outputs ? outputs.map((item) => ({ ...item })) : null, selectedOutput, awake,
    }
  }
  function emit(): void {
    const next = view()
    for (const listener of [...listeners]) { try { listener(next) } catch { /* the view's own problem */ } }
  }
  function clear(name: keyof typeof timers): void { if (timers[name] !== null) env.clearTimeout(timers[name]); timers[name] = null }
  function clearAll(): void { for (const name of Object.keys(timers) as (keyof typeof timers)[]) clear(name) }
  /** The track carries sound only while the audio is connected and the player is not muted. */
  function applyTracks(): void { stream?.getAudioTracks().forEach((track) => { track.enabled = flowing() && !muted }) }

  // ---- ending ---------------------------------------------------------------------------------------------------
  /** What to tell the server when this side leaves: decline while it rings for us, cancel while we ring, else hang up. */
  function leaveFrame(): CallClientFrame | null {
    if (!callId) return null
    if (role === 'callee' && (phase === 'incoming' || phase === 'starting')) return { type: 'call-decline', callId }
    if (role === 'caller' && (phase === 'ringing' || phase === 'calling')) return { type: 'call-cancel', callId }
    return { type: 'call-hangup', callId }
  }
  function release(): void {
    epoch++
    clearAll()
    stopMeter?.(); stopMeter = null
    stopDevices?.(); stopDevices = null
    releaseAwake?.(); releaseAwake = null
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    stream = null
    if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; try { pc.close() } catch { /* already closed */ } }
    pc = null
    if (audio) { audio.srcObject = null; audio = null }
    iceWaiter = null
    candidates = []; chain = Promise.resolve(); peerReady = Promise.resolve(); micReady = Promise.resolve(null)
    restarts = 0; quiet = 0; last = null; reported = false
  }
  function toIdle(): void {
    phase = 'idle'; notice = null; peer = null; role = null; callId = ''; clientId = ''; outcome = null; duration = null
    mic = 'none'; micProblem = null; micLevel = 0; quality = null; path = null; relay = null; outputs = null; awake = null
  }
  /** The call is over: stop everything, optionally tell the server, and show `text` for a moment. A null text goes straight to idle. */
  function finish(text: string | null, tell: boolean, why: CallOutcome = 'ended'): void {
    if (tell) { const frame = leaveFrame(); if (frame) env.send(frame) }
    const was = phase
    const length = startedAt === null ? null : Math.max(0, env.now() - startedAt)
    release()
    muted = false; playBlocked = false; error = null; startedAt = null; expiresAt = null; devices = null; micLevel = 0; quality = null
    if (text === null || was === 'idle') toIdle()
    else {
      phase = 'ended'; notice = text; outcome = why; duration = length
      timers.ended = env.setTimeout(() => { timers.ended = null; if (phase === 'ended') { toIdle(); emit() } }, why === 'failed' || why === 'mic' || why === 'lost' || why === 'error' ? ENDED_PROBLEM_MS : ENDED_SHOWN_MS)
    }
    emit()
  }

  // ---- the microphone -------------------------------------------------------------------------------------------
  /** Ask for the microphone. Called inside a tap. Resolves to the stream (track disabled), or null with `micProblem` set. */
  function openMic(): Promise<MediaStream | null> {
    const mine = epoch
    mic = 'asking'; micProblem = null; error = null; emit()
    env.unlockAudio?.()
    const opening = (async (): Promise<MediaStream | null> => {
      let local: MediaStream
      try { local = await env.getUserMedia(selectedDevice) } catch (failure) {
        if (mine !== epoch) return null
        micProblem = microphoneProblem(failure); mic = 'problem'; error = MIC_HELP[micProblem]; emit()
        return null
      }
      if (mine !== epoch) { local.getTracks().forEach((track) => track.stop()); return null }
      adopt(local)
      mic = 'ready'; micProblem = null; error = null; emit()
      return local
    })()
    micReady = opening
    return opening
  }
  function adopt(local: MediaStream): void {
    stream = local
    for (const track of local.getAudioTracks()) { track.enabled = false; track.onended = () => { void recoverMic(local) } }
    stopDevices?.(); stopDevices = env.onDeviceChange?.(() => { void onDeviceChange() }) ?? null
  }
  function watchLevel(): void {
    stopMeter?.(); stopMeter = null
    if (!stream || !env.meter) return
    stopMeter = env.meter(stream, (value) => {
      const next = muted || !flowing() ? 0 : Math.min(5, Math.round(value * 5))
      if (next !== micLevel) { micLevel = next; emit() }
    })
  }
  /** The microphone went away mid-call (a headset was unplugged, Bluetooth switched): open the default one and carry on. */
  async function recoverMic(lost: MediaStream): Promise<void> {
    if (stream !== lost || !active()) return
    const mine = epoch, connection = pc
    let next: MediaStream
    try { next = await env.getUserMedia(selectedDevice).catch(() => env.getUserMedia('')) } catch (failure) {
      if (mine === epoch && stream === lost) { micProblem = microphoneProblem(failure); mic = 'problem'; error = 'Your microphone was disconnected. Pick another one, or tap Try again.'; emit() }
      return
    }
    if (mine !== epoch || stream !== lost) { next.getTracks().forEach((track) => track.stop()); return }
    selectedDevice = devices?.some((item) => item.id === selectedDevice) ? selectedDevice : ''
    const track = next.getAudioTracks()[0], sender = connection?.getSenders().find((item) => item.track?.kind === 'audio' || item.track === null)
    if (connection && sender && track) { try { await sender.replaceTrack(track) } catch { /* the call goes on without sound */ } }
    lost.getTracks().forEach((old) => { old.onended = null; old.stop() })
    adopt(next); applyTracks(); mic = 'ready'; micProblem = null; error = null
    if (flowing()) watchLevel()
    emit()
  }
  async function onDeviceChange(): Promise<void> {
    if (!active()) return
    const mine = epoch
    await Promise.all([loadDevices(mine), loadOutputs(mine)])
    const live = stream?.getAudioTracks()[0]
    if (stream && live && live.readyState === 'ended') await recoverMic(stream)
  }
  async function loadDevices(mine: number): Promise<void> {
    try {
      const list = await env.listMicrophones()
      if (mine !== epoch) return
      devices = list
      if (selectedDevice && !list.some((item) => item.id === selectedDevice)) selectedDevice = ''
      emit()
    } catch { /* the system default is used */ }
  }
  async function loadOutputs(mine: number): Promise<void> {
    try {
      const list = (await env.listOutputs?.()) ?? null
      if (mine !== epoch) return
      outputs = list
      if (selectedOutput && list && !list.some((item) => item.id === selectedOutput)) { selectedOutput = ''; if (audio) void env.setOutput?.(audio, '').catch(() => {}) }
      emit()
    } catch { /* the system default is used */ }
  }

  // ---- the connection -------------------------------------------------------------------------------------------
  const candidateData = (candidate: RTCIceCandidate): CallSignalData => ({ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null, usernameFragment: candidate.usernameFragment ?? null })
  const signal = (kind: CallSignalKind, data: CallSignalData): boolean => (callId ? env.send({ type: 'call-signal', callId, kind, data }) : false)
  function tellServer(how: CallPath): void { if (!reported && callId) { reported = true; env.send({ type: 'call-report', callId, path: how }) } }
  const lostText = (): string => (env.online?.() === false ? SELF_LOST_TEXT : PEER_LOST_TEXT)
  const failedConnecting = (): void => { tellServer('failed'); finish(relay === 'on' ? BLOCKED_TEXT : NO_RELAY_TEXT, true, 'failed') }

  /** The connection servers for this call: the host's answer to `call-ice`, or plain STUN when it does not answer in time. */
  function requestIce(): Promise<CallIceServer[]> {
    return new Promise((resolve) => {
      const mine = epoch
      const done = (servers: CallIceServer[], state: CallRelayState | null): void => { clear('ice'); iceWaiter = null; if (mine === epoch) { relay = state; emit() } resolve(servers) }
      iceWaiter = (frame) => done(frame.iceServers, frame.relay)
      timers.ice = env.setTimeout(() => { timers.ice = null; done(FALLBACK_ICE, null) }, ICE_WAIT_MS)
      if (!env.send({ type: 'call-ice', callId })) done(FALLBACK_ICE, null)
    })
  }
  /** Both sides, once the call is accepted and the microphone is open: servers, connection, and (caller) the offer. */
  function beginConnect(local: MediaStream): void {
    const mine = epoch
    phase = 'connecting'; error = null; emit()
    clear('connect')
    timers.connect = env.setTimeout(() => { timers.connect = null; if (phase === 'connecting') failedConnecting() }, CONNECT_TIMEOUT_MS)
    peerReady = (async () => {
      const servers = await requestIce()
      if (mine !== epoch) return
      const connection = env.createPeer({ iceServers: servers, iceTransportPolicy: 'all' })
      pc = connection
      local.getTracks().forEach((track) => connection.addTrack(track, local))
      connection.onicecandidate = ({ candidate }) => { if (candidate && connection === pc) signal('ice', candidateData(candidate)) }
      connection.onconnectionstatechange = () => onConnectionState(connection)
      connection.ontrack = ({ streams, track }) => {
        if (connection !== pc) return
        const remote = streams[0] ?? new MediaStream([track])
        audio ??= env.createAudio()
        audio.srcObject = remote
        if (selectedOutput) void env.setOutput?.(audio, selectedOutput).catch(() => {})
        void audio.play().then(() => { if (playBlocked) { playBlocked = false; emit() } }).catch(() => { playBlocked = true; emit() })
      }
      if (role === 'caller') {
        await connection.setLocalDescription(await connection.createOffer())
        if (mine === epoch && connection.localDescription?.sdp) signal('offer', { sdp: connection.localDescription.sdp })
      }
    })().catch(() => { if (mine === epoch && active()) finish('The call could not be set up. Try again.', true, 'error') })
  }
  function onConnectionState(connection: RTCPeerConnection): void {
    if (connection !== pc || !active()) return
    const state = connection.connectionState
    if (state === 'connected') {
      clear('connect'); clear('restart'); clear('grace')
      restarts = 0
      const first = startedAt === null
      if (first) startedAt = env.now()
      phase = 'connected'; quality = 'good'; applyTracks(); emit()
      if (first) {
        watchLevel()
        releaseAwake = env.keepAwake?.() ?? null
        awake = releaseAwake ? 'on' : 'off'
        void loadDevices(epoch); void loadOutputs(epoch)
        emit()
      }
      void sample(connection, true)
      clear('stats'); timers.stats = env.setTimeout(function tick() { timers.stats = null; if (connection === pc && active()) { void sample(connection, false).then(() => { if (connection === pc && active() && timers.stats === null) timers.stats = env.setTimeout(tick, STATS_EVERY_MS) }) } }, STATS_EVERY_MS)
    } else if (state === 'disconnected' || state === 'failed') {
      if (phase === 'connected') { phase = 'reconnecting'; quality = 'reconnecting'; applyTracks(); emit() }
      else if (phase === 'reconnecting') { quality = 'reconnecting' }
      if (startedAt !== null && timers.grace === null) timers.grace = env.setTimeout(() => { timers.grace = null; finish(lostText(), true, 'lost') }, RECONNECT_GRACE_MS)
      if (role === 'caller' && timers.restart === null && restarts < RESTART_MAX) timers.restart = env.setTimeout(() => { timers.restart = null; void restartIce(connection) }, state === 'failed' ? 0 : RECONNECT_RESTART_MS)
    }
  }
  async function restartIce(connection: RTCPeerConnection): Promise<void> {
    if (connection !== pc || role !== 'caller' || !active() || connection.connectionState === 'connected') return
    restarts++
    const up = (): boolean => connection.connectionState === 'connected'
    try {
      if (connection.signalingState === 'stable') {
        const offer = await connection.createOffer({ iceRestart: true })
        await connection.setLocalDescription(offer)
        if (connection === pc && connection.localDescription?.sdp) signal('offer', { sdp: connection.localDescription.sdp })
      }
    } catch { /* the timers decide */ }
    if (connection === pc && restarts < RESTART_MAX && timers.restart === null && !up()) timers.restart = env.setTimeout(() => { timers.restart = null; void restartIce(connection) }, RESTART_EVERY_MS)
  }
  /** Look at the statistics: which way the audio goes (reported once), and whether it is arriving. */
  async function sample(connection: RTCPeerConnection, first: boolean): Promise<void> {
    if (typeof connection.getStats !== 'function') return
    const mine = epoch
    let now: CallSample
    try { now = readStats(await connection.getStats() as unknown as Parameters<typeof readStats>[0]) } catch { return }
    if (mine !== epoch || connection !== pc || !active()) return
    if (now.path) { path = now.path; if (first || !reported) tellServer(now.path) }
    const before = last
    last = now
    if (before && flowing()) {
      const got = now.received - before.received, lost = now.lost - before.lost
      quiet = got <= 0 ? quiet + 1 : 0
      const next: CallQuality = phase === 'reconnecting' ? 'reconnecting' : quiet >= 2 || (got + lost > 0 && lost / (got + lost) > 0.08) || (now.rtt !== null && now.rtt > 0.8) ? 'weak' : 'good'
      if (next !== quality) quality = next
    }
    emit()
  }

  // ---- what the player does -------------------------------------------------------------------------------------
  /** Ring a player, from the tap on Call. The invite goes out at once and the microphone is asked for while it rings. */
  function call(target: PlayerRef): boolean {
    if (active() || phase === 'elsewhere') return false
    clear('ended'); release()
    if (!env.supported()) { peer = { ...target }; phase = 'ended'; outcome = 'error'; notice = 'Calls need a supported browser on HTTPS.'; role = 'caller'; timers.ended = env.setTimeout(() => finish(null, false), ENDED_PROBLEM_MS); emit(); return false }
    peer = { ...target }; role = 'caller'; callId = ''; clientId = env.randomId(); notice = null; error = null; abandoned = null; outcome = null; duration = null
    phase = 'calling'; expiresAt = null; muted = false; startedAt = null; quality = null; path = null; relay = null; awake = null; outputs = null; micLevel = 0
    emit()
    if (!env.send({ type: 'call-invite', to: target.id, clientId })) { finish('You are not connected. Try again in a moment.', false, 'error'); return true }
    void openMic()
    return true
  }
  /** The caller gave up, or the callee declined, or either side hung up. */
  function hangup(): void {
    if (!active()) { if (phase === 'ended') finish(null, false); return }
    if (phase === 'calling' && !callId) { abandoned = clientId; finish('Call cancelled.', false, 'cancelled'); return }
    if (phase === 'incoming' || (phase === 'starting' && role === 'callee')) { finish('Call declined.', true, 'declined'); return }
    if (phase === 'ringing') { finish('Call cancelled.', true, 'cancelled'); return }
    finish('Call ended.', true, 'ended')
  }
  /** The Answer tap. Asks for the microphone, and only then tells the server. */
  async function accept(): Promise<void> {
    if (phase !== 'incoming' || role !== 'callee' || !env.supported()) return
    if (expiresAt !== null && env.now() >= expiresAt + REGRET_MS * 4) return
    const answering = callId
    phase = 'starting'; emit()
    const local = await openMic()
    if (phase !== 'starting' || callId !== answering) return
    if (!local) { phase = 'incoming'; emit(); return }
    if (!env.send({ type: 'call-accept', callId })) finish('You are not connected. Try again in a moment.', false, 'error')
  }
  /** Try the microphone again, from a tap: "Try again" while it rings, "Tap to talk" once the other side has answered. */
  async function startMicrophone(): Promise<void> {
    env.unlockAudio?.()
    if (role === 'caller' && (phase === 'needs-tap' || phase === 'starting')) {
      const answering = callId
      if (!stream || mic !== 'ready') await openMic()
      if (callId !== answering || (phase !== 'needs-tap' && phase !== 'starting')) return
      if (stream && mic === 'ready') beginConnect(stream); else { phase = 'needs-tap'; emit() }
      return
    }
    if (!active() || mic === 'asking' || (mic === 'ready' && stream)) return
    await openMic()
    if (stream && pc) { const track = stream.getAudioTracks()[0], sender = pc.getSenders().find((item) => item.track?.kind === 'audio'); if (track && sender) { applyTracks(); try { await sender.replaceTrack(track) } catch { /* no sound until the next try */ } } emit() }
  }
  function toggleMute(): void {
    if (!active() || phase === 'incoming') return
    muted = !muted
    applyTracks()
    if (muted) micLevel = 0
    emit()
  }
  function playAudio(): void {
    env.unlockAudio?.()
    void audio?.play().then(() => { playBlocked = false; emit() }).catch(() => { error = 'Audio playback is blocked. Check your browser sound permissions.'; emit() })
  }
  /** Switch microphones during the call; the mute state is kept. */
  async function selectDevice(id: string): Promise<void> {
    selectedDevice = id
    const connection = pc
    if (!stream || !connection) { emit(); return }
    const mine = epoch
    try {
      const next = await env.getUserMedia(id)
      if (mine !== epoch || connection !== pc) { next.getTracks().forEach((track) => track.stop()); return }
      const track = next.getAudioTracks()[0]
      const sender = connection.getSenders().find((item) => item.track?.kind === 'audio')
      if (!track || !sender) { next.getTracks().forEach((item) => item.stop()); return }
      await sender.replaceTrack(track)
      const old = stream
      old.getTracks().forEach((item) => { item.onended = null; item.stop() })
      adopt(next); applyTracks(); error = null; mic = 'ready'; micProblem = null
      if (flowing()) watchLevel()
    } catch (failure) { micProblem = microphoneProblem(failure); error = MIC_HELP[micProblem] }
    emit()
  }
  /** Choose where the other side's voice plays (where the browser allows it). */
  async function selectOutput(id: string): Promise<void> {
    selectedOutput = id
    if (audio) { try { await env.setOutput?.(audio, id) } catch { error = 'That speaker could not be used.' } }
    emit()
  }

  // ---- what the server says -------------------------------------------------------------------------------------
  function onIncoming(frame: CallIncomingFrame): void {
    if (active() || phase === 'elsewhere') return
    clear('ended'); release()
    peer = { ...frame.from }; role = 'callee'; callId = frame.callId; clientId = ''; expiresAt = frame.expiresAt; notice = null; error = null; outcome = null; duration = null
    phase = 'incoming'; muted = false; mic = 'none'; micProblem = null; relay = null; path = null; quality = null; awake = null
    const wait = Math.max(0, frame.expiresAt - env.now()) + REGRET_MS
    timers.ring = env.setTimeout(() => { timers.ring = null; if (phase === 'incoming') finish(`Missed call from ${nameOf()}.`, false, 'missed') }, Math.min(wait, 40000))
    emit()
  }
  /**
   * The call is on another device of this player: it was answered there, or placed there. Whatever this device had begun
   * (the ring, a microphone it was opening) is dropped, and it only shows that the call exists.
   */
  function onElsewhere(frame: CallStateFrame): void {
    if (frame.state !== 'ringing' && frame.state !== 'accepted') return
    if (active() && frame.callId !== callId) return
    const rang = phase === 'incoming' || (phase === 'starting' && role === 'callee')
    const fresh = phase !== 'elsewhere' || frame.callId !== callId
    if (!fresh) return
    clear('ended'); release()
    peer = frame.peer ? { ...frame.peer } : peer
    role = frame.role ?? role; callId = frame.callId; clientId = ''
    muted = false; playBlocked = false; error = null; startedAt = null; expiresAt = null; devices = null; mic = 'none'; micProblem = null
    phase = 'elsewhere'; notice = rang ? ANSWERED_ELSEWHERE_TEXT : ELSEWHERE_TEXT
    if (rang) timers.ended = env.setTimeout(() => { timers.ended = null; if (phase === 'elsewhere') { notice = ELSEWHERE_TEXT; emit() } }, ENDED_SHOWN_MS + 1000)
    emit()
  }
  function onState(frame: CallStateFrame): void {
    // The host lost its memory of calls, or an unknown call was named: whatever this side holds is over.
    if (frame.callId === '' && frame.state === 'ended') { if (active()) finish('The call ended.', false, 'ended'); else if (phase === 'elsewhere') finish(null, false); return }
    if (frame.elsewhere) { onElsewhere(frame); return }
    // The summary of a call that is over is not rewritten by the server's echo of the same ending.
    if (phase === 'ended' && frame.callId === callId) return
    if (frame.callId === '') {
      // A refusal to ring: only ever for our own invite, and never says why.
      if (frame.clientId !== clientId || phase !== 'calling') return
      if (frame.limited) finish('Too many call attempts. Try again in a minute.', false, 'limited')
      else if (frame.busy) finish('You are already in a call.', false, 'busy')
      else finish(`${nameOf()} can’t be reached right now.`, false, 'unreachable')
      return
    }
    // The player cancelled before the server had named the call: it is cancelled the moment it is named.
    if (abandoned !== null && frame.clientId === abandoned && frame.state === 'ringing') { abandoned = null; env.send({ type: 'call-cancel', callId: frame.callId }); return }
    if (phase === 'calling' && frame.clientId === clientId) callId = frame.callId
    if (frame.callId !== callId) return
    // The call on another device is over, however it ended: this device has nothing to say about it.
    if (phase === 'elsewhere') { if (frame.state !== 'ringing' && frame.state !== 'accepted') finish(null, false); return }
    switch (frame.state) {
      case 'ringing':
        if (role === 'caller') { phase = 'ringing'; expiresAt = frame.expiresAt ?? null; emit() }
        return
      case 'accepted':
        clear('ring'); expiresAt = null
        if (role === 'caller') {
          if (stream && mic === 'ready') beginConnect(stream)
          else if (mic === 'asking') {
            // The permission prompt is still open: wait for the answer to it.
            phase = 'starting'; emit()
            const answering = callId
            void micReady.then((local) => { if (callId !== answering || phase !== 'starting') return; if (local) beginConnect(local); else { phase = 'needs-tap'; emit() } })
          } else { phase = 'needs-tap'; emit() }
        } else if (stream) beginConnect(stream)
        else finish('Call ended.', true, 'ended')
        return
      case 'declined': finish(role === 'callee' ? 'Call declined.' : `${nameOf()} declined the call.`, false, 'declined'); return
      case 'cancelled': finish(role === 'callee' ? `Missed call from ${nameOf()}.` : 'Call cancelled.', false, role === 'callee' ? 'missed' : 'cancelled'); return
      case 'timeout': finish(role === 'callee' ? `Missed call from ${nameOf()}.` : `${nameOf()} did not answer.`, false, role === 'callee' ? 'missed' : 'unanswered'); return
      case 'unreachable': finish(`${nameOf()} can’t be reached right now.`, false, 'unreachable'); return
      case 'ended': finish('Call ended.', false, 'ended'); return
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
    }).catch(() => { if (active()) finish('The call could not be set up. Try again.', true, 'error') })
  }
  function onIce(frame: CallIceFrame): void { if (frame.callId === callId && iceWaiter) iceWaiter(frame) }

  /** A frame from the social socket (the host passes the call frames only). */
  function handle(frame: CallServerFrame): void {
    if (frame.type === 'call-incoming') onIncoming(frame)
    else if (frame.type === 'call-state') onState(frame)
    else if (frame.type === 'call-signal') onSignal(frame)
    else if (frame.type === 'call-ice') onIce(frame)
  }
  /** The social socket closed: the server ends a player's call when their last socket goes, so this side is over too. */
  function socketClosed(): void { if (active()) finish(env.online?.() === false ? SELF_LOST_TEXT : 'The connection was lost.', false, 'lost'); else if (phase === 'elsewhere') finish(null, false) }
  /**
   * The page is being closed or put away for good. A device that carries a call, or is placing one, ends it: the other
   * side must not be left ringing and no microphone may stay open. A device that only rings says nothing to the server
   * (the player's other devices go on ringing), and one that shows a call on another device has nothing to end.
   */
  function pageHidden(): void {
    if (phase === 'incoming' || (phase === 'starting' && role === 'callee')) { finish(null, false); return }
    if (active()) hangup()
  }
  function dismiss(): void { if (phase === 'ended') { clear('ended'); finish(null, false) } else if (error) { error = null; emit() } }
  function destroy(): void { if (active()) finish(null, true); else release(); listeners.clear() }

  return {
    get view(): CallView { return view() },
    subscribe(listener: (next: CallView) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
    call, hangup, accept, startMicrophone, toggleMute, playAudio, selectDevice, selectOutput, handle, socketClosed, pageHidden, dismiss, destroy,
  }
}
export type CallController = ReturnType<typeof createCallController>
