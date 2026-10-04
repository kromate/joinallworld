/**
 * THE COMMUNITY CONTROLLER: the room socket, presence and positions, room chat and nearby voice.
 * It draws nothing. It publishes a plain `CommunityState` (src/types/community.ts) after every
 * change (the `onChange` option and `subscribe`), and the Vue panel (src/app/features/community/)
 * renders that. The rules are the old panel's, unchanged:
 *
 * WHERE YOU STAND IS ONE THING. The room's `presence` carries each member's position, and the voice
 * rules below (who is `nearby`, the gain, which peers exist) read those positions and nothing else.
 * The position itself comes from the game: the shell passes the avatar's place in the venue
 * scene to moveTo(x, z), and reads everyone's place back through onMembers to draw them in the scene.
 *   onMembers({ self, members: [{ id, name, position: { x, z } | null }] })   after every presence
 *       message and whenever the list empties (disconnect, room change, revocation, destroy).
 *       `position` is null until that member has reported one (the server's origin means "not yet").
 *   venueName(venueId, cityId) -> the venue's name in that city, for the room line (the panel itself knows only three).
 *   onStep(dx, dz) -> true when the game walked the avatar by that much (the four "Walk" buttons are the
 *       keyboard-accessible way to move without the scene). When it is absent or returns false -- the
 *       scene could not be drawn -- the buttons move the voice position directly, as before.
 *
 * PRIVACY. Nothing here touches the microphone or an AudioContext except joinVoice(), which the panel
 * calls from the Join voice button only. The microphone is OFF by default; a joined stream starts
 * with its tracks disabled (muted); leaveVoice() is the one way out and stops every track; a room that
 * is revoked (`venue_mismatch`, `visit_ended`) or refused (`not_a_guest`) stops voice.
 */
import type { PublicSession } from './types/protocol.ts'
import type {
  BlockedPlayback, ChatLine, CommunityController, CommunityLinkStatus, CommunityRoom, CommunityState, DiagnosticsPeer,
  DiagnosticsSnapshot, MemberRow, MicrophoneChoice, MembersEvent, CommunityStatus, RoomMember, VoicePosition,
} from './types/community.ts'

/** What the controller is given. (Here, not in src/types: it names browser types, which the engine project does not have.) */
export interface CommunityOptions {
  cityId?: string
  venueId?: string
  onStatus?: (status: CommunityStatus) => void
  /** After every presence message and whenever the list empties (disconnect, room change, revocation, destroy). */
  onMembers?: (event: MembersEvent) => void
  /** Called with the new state after every change. */
  onChange?: (state: CommunityState) => void
  /** The venue's name in that city, for the room line. */
  venueName?: ((venueId: string, cityId: string) => string) | null
  /** The game walked the avatar by (dx, dz): true when it did. Absent or false: the Walk buttons move the voice position directly. */
  onStep?: ((dx: number, dz: number) => boolean) | null
  /** Test fixture: a synthetic stream instead of the microphone (voice-test.html). */
  audioStreamFactory?: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null
  diagnostics?: boolean
  onPeerStats?: (snapshot: DiagnosticsSnapshot) => void
  iceTransportPolicy?: 'all' | 'relay'
  /** The element a received voice plays through (never attached to the page). Default: new Audio(). */
  createAudio?: () => HTMLAudioElement
}

const VOICE_RADIUS = 12
const SPACE_BOUND = 20

/** A frame from the room socket, as far as this module reads it. */
type Incoming =
  | { type: 'heartbeat' }
  | { type: 'presence'; members?: RoomMember[] }
  | { type: 'chat'; id: string; clientId?: string; from?: PublicSession; body: string }
  | { type: 'signal'; from: string; data?: unknown }
  | { type: 'error'; error?: string; code?: string; message?: string; clientId?: string; to?: string }

interface SignalPayload { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
interface IceConfig { iceServers: RTCIceServer[]; expiresAt: number | null; turnConfigured?: boolean; mode?: string }
interface Peer {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  name: string
  playVisible: boolean
  gain: number
  htmlSinkState: string
  candidates: RTCIceCandidateInit[]
  chain: Promise<void>
  remoteStream?: MediaStream
  audioSource?: MediaStreamAudioSourceNode | null
  gainNode?: GainNode | null
  analyser?: AnalyserNode | null
  audioSamples?: Float32Array<ArrayBuffer>
}
interface PendingMessage { body: string; sent: boolean; failed: boolean; line: ChatLine }
interface Browser {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
  RTCPeerConnection?: typeof RTCPeerConnection
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}
const browser = (): Browser => globalThis as unknown as Browser

export async function createCommunity(options: CommunityOptions = {}): Promise<CommunityController> {
  const { cityId = 'lagos', venueId = 'park', onStatus = () => {}, onMembers = () => {}, onChange = null, onStep = null, venueName = null, audioStreamFactory = null, diagnostics = false, onPeerStats = () => {}, iceTransportPolicy = 'all', createAudio = () => new Audio() } = options

  let room: CommunityRoom = { cityId, venueId }
  let session: PublicSession | null = null
  let socket: WebSocket | null = null
  let members: RoomMember[] = []
  let stream: MediaStream | null = null
  let destroyed = false, connected = false, roomReady = false, roomRevoked = false, voice = false, muted = false, joiningVoice = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0, voiceGeneration = 0, selectedDevice = ''
  let diagnosticsTimer: ReturnType<typeof setInterval> | null = null
  let iceConfig: IceConfig | null = null
  let iceConfigRequest: Promise<IceConfig> | null = null
  let playbackContext: AudioContext | null = null

  // What the panel shows (see CommunityState). Text that depends on more than one variable is stored when it is worked out.
  let connection = 'Connecting…', roomText = '', privateHome = false, feedbackText = '', canReconnect = false, composeDisabled = false
  let positionText = 'Waiting for your place in the venue…', walkDisabled = true, voiceText = 'Your microphone is off. Join voice to request access.'
  let relayNote = 'Relay availability is checked when you join voice. Microphone starts muted.'
  let playbackNote: string | null = null, devices: MicrophoneChoice[] | null = null, savingName = false
  let memberRows: MemberRow[] = [], refusal: CommunityState['refusal'] = null, refusalSeq = 0, lineCounter = 0
  let diagnosticsText: string | null = diagnostics ? '' : null
  const chat: ChatLine[] = []

  const sourceLabel = audioStreamFactory ? 'Test audio' : 'Microphone'
  const rejectedPeers = new Set<string>()
  const peers = new Map<string, Peer>()
  const pending = new Map<string, PendingMessage>()
  const seen = new Set<string>()
  const listeners = new Set<(state: CommunityState) => void>()
  const cleanups: (() => void)[] = []

  // ---- state out ---------------------------------------------------------------------------------------------
  function snapshot(): CommunityState {
    return {
      room: { ...room }, roomText, privateHome, connection, hasSession: Boolean(session), session: session ? { ...session } : null, savingName,
      members: memberRows.map((row) => ({ ...row })), memberCount: members.length, positionText, walkDisabled,
      voice: {
        on: voice, joining: joiningVoice, muted, canJoin: !joiningVoice && roomReady,
        joinLabel: joiningVoice ? (audioStreamFactory ? 'Preparing test audio…' : 'Requesting microphone…') : (audioStreamFactory ? 'Join test audio' : 'Join voice'),
        muteLabel: muted ? (audioStreamFactory ? 'Unmute test audio' : 'Unmute mic') : (audioStreamFactory ? 'Mute test audio' : 'Mute mic'),
        status: voiceText, relayNote, playbackNote, devices: devices ? devices.map((device) => ({ ...device })) : null, selectedDevice,
        blocked: [...peers].filter(([, peer]) => peer.playVisible).map(([id, peer]): BlockedPlayback => ({ id, name: peer.name })),
      },
      chat: chat.map((line) => ({ ...line })), composeDisabled, feedback: feedbackText, canReconnect, refusal, diagnosticsText,
    }
  }
  function emit(): void {
    if (!onChange && !listeners.size) return
    const next = snapshot()
    try { onChange?.(next) } catch { /* the panel's own problem */ }
    for (const listener of [...listeners]) { try { listener(next) } catch { /* likewise */ } }
  }
  const listen = (target: Browser, event: string, handler: () => void): void => {
    target.addEventListener?.(event, handler)
    cleanups.push(() => target.removeEventListener?.(event, handler))
  }
  const feedback = (message: string): void => { feedbackText = message; emit() }
  const report = (label: string): void => {
    connection = label
    const status: CommunityLinkStatus = label === 'Connected' ? 'online' : label === 'Choose a nickname' ? 'session-required' : /Connecting|Reconnecting/.test(label) ? 'connecting' : 'offline'
    emit()
    onStatus({ connected, session: session ? { ...session } : null, status })
  }
  const send = (message: object): boolean => {
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }
  function labelRoom(): void {
    privateHome = room.venueId === 'home'
    // The game names the venue (venueName(venueId, cityId) -> its label in that city); without it, the three names this panel always knew.
    let named: string | null = null
    try { named = typeof venueName === 'function' ? venueName(room.venueId, room.cityId) : null } catch { named = null }
    const place = privateHome ? 'Your home (private)' : typeof named === 'string' && named ? named : room.venueId === 'library' ? 'Library' : room.venueId === 'club' ? 'Club' : 'Park'
    roomText = `${room.cityId === 'ibadan' ? 'Ibadan' : 'Lagos'} · ${place}`
    emit()
  }
  labelRoom()

  // ---- positions ---------------------------------------------------------------------------------------------
  function validPosition(member: RoomMember | null | undefined): VoicePosition | null {
    const position = member?.position
    return position && Number.isFinite(position.x) && Number.isFinite(position.z) ? position : null
  }
  const selfMember = (): RoomMember | undefined => members.find((person) => person.id === session?.id)
  function distanceTo(member: RoomMember | null | undefined): number {
    const self = validPosition(selfMember()), other = validPosition(member)
    return self && other ? Math.hypot(self.x - other.x, self.z - other.z) : Infinity
  }
  function nearby(member: RoomMember | null | undefined): boolean {
    return room.venueId !== 'home' && Boolean(member) && !rejectedPeers.has(member?.id ?? '') && Boolean(member?.enabled) && member?.id !== session?.id && distanceTo(member) < VOICE_RADIUS
  }
  function moveTo(x: number, z: number): boolean {
    if (!roomReady || room.venueId === 'home' || !Number.isFinite(x) || !Number.isFinite(z)) return false
    // The UNILAG campus is walked in campus coordinates: the server checks them against its walkable ground (server/protocol.ts).
    if (room.venueId === 'unilag') return send({ type: 'move', x, z })
    const mx = Math.max(-SPACE_BOUND, Math.min(SPACE_BOUND, x)), mz = Math.max(-SPACE_BOUND, Math.min(SPACE_BOUND, z))
    // Exactly the origin means "not reported yet" (see reported()): a player standing there reports a hair beside it.
    return send({ type: 'move', x: mx === 0 && mz === 0 ? 0.01 : mx, z: mz })
  }
  /** A "Walk" button: the game walks the avatar (its new place comes back through moveTo); without a scene the voice position moves directly. */
  function walk(dx: number, dz: number): void {
    if (!roomReady || room.venueId === 'home') return
    let walked = false
    try { walked = typeof onStep === 'function' && onStep(dx, dz) === true } catch { walked = false }
    if (walked) return
    const self = validPosition(selfMember())
    if (self) moveTo(self.x + dx, self.z + dz)
  }
  /** The origin is where the server puts everyone on joining: it means "has not reported a position yet". */
  function reported(member: RoomMember): VoicePosition | null {
    const position = validPosition(member)
    return position && (room.venueId === 'unilag' || position.x !== 0 || position.z !== 0) ? { x: position.x, z: position.z } : null
  }
  /** Tell the game who is here and where each one stands. Never throws into the room code. */
  function announce(): void {
    try { onMembers({ self: session?.id ?? null, members: members.map((member) => ({ id: member.id, name: member.name, position: reported(member) })) }) } catch { /* the game's own problem */ }
  }
  function renderPosition(): void {
    const self = validPosition(selfMember())
    const inVoice = members.filter((member) => member.enabled && member.id !== session?.id)
    const near = inVoice.filter((member) => distanceTo(member) < VOICE_RADIUS).length
    positionText = !self ? 'Waiting for your place in the venue…'
      : inVoice.length ? `${near} of ${inVoice.length} ${inVoice.length === 1 ? 'person' : 'people'} in voice ${near === 1 && inVoice.length === 1 ? 'is' : 'are'} within range of where you stand.`
        : 'Nobody else is in voice here yet.'
    // On the campus the avatar is walked in its own scene (its place arrives through moveTo): the four buttons would move the voice position alone.
    walkDisabled = !roomReady || !self || room.venueId === 'unilag'
  }
  function renderMembers(): void {
    memberRows = members.map((member) => ({
      id: member.id,
      label: `${member.name}${member.id === session?.id ? ' (you)' : ''}`,
      state: member.enabled ? `${member.muted ? 'Mic muted' : 'In voice'}${member.id !== session?.id ? distanceTo(member) < VOICE_RADIUS ? ' · near' : ' · out of range' : ''}` : 'Here',
    }))
    renderPosition()
    emit()
    announce()
  }

  // ---- voice -------------------------------------------------------------------------------------------------
  async function ensureVoiceConfig(generation: number): Promise<boolean> {
    const expired = iceConfig?.expiresAt && Date.now() >= iceConfig.expiresAt
    if (iceConfig && !expired) return true
    if (!iceConfigRequest) {
      iceConfigRequest = fetch('/api/voice-config').then(async (response): Promise<IceConfig> => {
        if (!response.ok) throw new Error('Voice configuration unavailable')
        const config = await response.json() as { iceServers?: RTCIceServer[]; expiresAt?: number | string | null; turnConfigured?: boolean; mode?: string }
        if (!Array.isArray(config.iceServers) || !config.iceServers.length) throw new Error('Voice configuration unavailable')
        const expiresAt = config.expiresAt ? (typeof config.expiresAt === 'number' ? config.expiresAt : Date.parse(config.expiresAt)) : null
        if (expiresAt && expiresAt <= Date.now()) throw new Error('Voice relay credentials expired')
        return { ...config, iceServers: config.iceServers, expiresAt }
      }).catch(() => { throw new Error('Voice configuration unavailable') }).finally(() => { iceConfigRequest = null })
    }
    const config = await iceConfigRequest
    if (destroyed || generation !== voiceGeneration) return false
    iceConfig = config
    relayNote = config.turnConfigured ? 'TURN relay configured. Nearby voice can use the relay when a direct connection is unavailable.' : 'Direct-only voice (STUN): no TURN relay is available yet. Restrictive networks may fail to connect.'
    emit()
    return true
  }
  function voiceStatus(): void {
    if (!voice) {
      voiceText = audioStreamFactory ? (joiningVoice ? 'Preparing synthetic audio…' : 'Synthetic test audio is off. Join test audio to start.') : joiningVoice ? 'Waiting for microphone permission…' : 'Your microphone is off. Join voice to request access.'
      emit()
      return
    }
    const active = [...peers.values()].filter((peer) => peer.pc.connectionState === 'connected').length
    const failed = [...peers.values()].some((peer) => ['failed', 'disconnected'].includes(peer.pc.connectionState))
    voiceText = `${sourceLabel} ${muted ? 'muted.' : 'on.'} ${failed ? 'A peer connection has been interrupted; leave and rejoin to retry.' : active ? `Connected to ${active} ${active === 1 ? 'person' : 'people'}.` : peers.size ? 'Connecting to nearby people…' : 'No one in voice is within 12 steps. Walk closer to someone in the venue.'}`
    emit()
  }
  function closePeer(id: string): void {
    const peer = peers.get(id)
    if (!peer) return
    peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null
    peer.pc.close(); peer.remoteStream?.getTracks().forEach((track) => track.stop())
    peer.audioSource?.disconnect(); peer.gainNode?.disconnect(); peer.analyser?.disconnect()
    peer.audio.srcObject = null; peers.delete(id)
  }
  function closePlaybackContext(): void {
    const context = playbackContext
    playbackContext = null
    context?.close().catch(() => {})
  }
  /** The one way out of joining or being in voice: stops every track, closes every peer and the playback context. */
  function leaveVoice(notify = true): void {
    voiceGeneration++
    if (diagnosticsTimer !== null) clearInterval(diagnosticsTimer)
    diagnosticsTimer = null; joiningVoice = false; voice = false; muted = false
    stream?.getTracks().forEach((track) => track.stop())
    stream = null; iceConfig = null
    for (const id of [...peers.keys()]) closePeer(id)
    closePlaybackContext()
    if (notify) send({ type: 'voice-state', enabled: false, muted: false })
    if (diagnostics) diagnosticsText = JSON.stringify({ voice: false, muted: false, trackCount: 0, liveTrackCount: 0, peers: [] }, null, 2)
    voiceStatus()
  }
  function setPeerGain(id: string, peer: Peer): void {
    const gain = Math.max(0, 1 - distanceTo(members.find((member) => member.id === id)) / VOICE_RADIUS)
    peer.gain = gain
    if (peer.gainNode) peer.gainNode.gain.value = gain
    else peer.audio.volume = gain
  }
  function signal(id: string, data: SignalPayload): void { if (voice && nearby(members.find((member) => member.id === id))) send({ type: 'signal', to: id, data }) }
  function makePeer(id: string): Peer | null {
    const existing = peers.get(id)
    if (existing) return existing
    if (!voice || !stream || id === session?.id) return null
    const member = members.find((person) => person.id === id)
    if (!member || !nearby(member) || !iceConfig) return null
    const pc = new RTCPeerConnection({ iceServers: iceConfig.iceServers, iceTransportPolicy: iceTransportPolicy === 'relay' ? 'relay' : 'all' })
    const audio = createAudio()
    audio.autoplay = true; (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    audio.volume = Math.max(0, 1 - distanceTo(member) / VOICE_RADIUS)
    const peer: Peer = { pc, audio, name: member.name, playVisible: false, gain: audio.volume, htmlSinkState: 'idle', candidates: [], chain: Promise.resolve() }
    peers.set(id, peer)
    stream.getTracks().forEach((track) => pc.addTrack(track, stream as MediaStream))
    pc.onicecandidate = ({ candidate }) => { if (candidate) signal(id, { candidate: candidate.toJSON() }) }
    pc.onconnectionstatechange = voiceStatus
    pc.ontrack = ({ streams, track }) => {
      const remoteStream = streams[0] || new MediaStream([track])
      peer.remoteStream = remoteStream; audio.muted = Boolean(playbackContext); audio.srcObject = remoteStream
      const startMutedSink = (): void => {
        audio.muted = true
        audio.play().then(() => { if (peers.get(id) === peer) peer.htmlSinkState = 'playing' }).catch(() => {
          if (peers.get(id) !== peer) return
          peer.htmlSinkState = 'blocked'; peer.playVisible = true; feedback('Tap the audio button to enable received audio playback.')
        })
      }
      if (peer.gainNode) { startMutedSink(); return }
      if (playbackContext && !peer.audioSource) {
        try {
          peer.audioSource = playbackContext.createMediaStreamSource(remoteStream)
          peer.gainNode = playbackContext.createGain(); peer.gainNode.gain.value = peer.gain
          peer.audioSource.connect(peer.gainNode); peer.gainNode.connect(playbackContext.destination)
          if (diagnostics) {
            peer.analyser = playbackContext.createAnalyser(); peer.analyser.fftSize = 512
            peer.audioSamples = new Float32Array(peer.analyser.fftSize); peer.gainNode.connect(peer.analyser)
          }
          audio.muted = true; peer.playVisible = false; startMutedSink()
          return
        } catch {
          peer.audioSource?.disconnect(); peer.gainNode?.disconnect(); peer.analyser?.disconnect()
          peer.audioSource = null; peer.gainNode = null; peer.analyser = null
          playbackNote = 'Spatial playback is unavailable for this connection. Browser audio volume is a fallback and may not fade reliably on every device; the distance cutoff still applies.'
          emit()
        }
      }
      audio.muted = false
      audio.play().catch(() => { peer.playVisible = true; feedback('Tap the audio button to hear a person in your voice circle.') })
    }
    return peer
  }
  function peerOperation(id: string, operation: (peer: Peer) => Promise<void>): void {
    const peer = makePeer(id)
    if (!peer) return
    peer.chain = peer.chain.then(async () => { if (peers.get(id) === peer) await operation(peer) }).catch(() => {
      if (voice && peers.get(id) === peer) { feedback('A voice connection could not be established. Leave and rejoin voice to retry.'); voiceStatus() }
    })
  }
  async function syncPeers(): Promise<void> {
    if (!voice) return
    let eligible = new Set(members.filter(nearby).map((member) => member.id))
    for (const id of [...peers.keys()]) if (!eligible.has(id)) closePeer(id)
    for (const [id, peer] of peers) setPeerGain(id, peer)
    const generation = voiceGeneration
    try { if ([...eligible].some((id) => !peers.has(id)) && !await ensureVoiceConfig(generation)) return } catch { feedback('Relay configuration could not be refreshed. New voice connections are paused.'); return }
    if (!voice || generation !== voiceGeneration) return
    eligible = new Set(members.filter(nearby).map((member) => member.id))
    for (const id of eligible) {
      if (peers.has(id)) continue
      const peer = makePeer(id)
      if (peer && session && session.id < id) {
        peerOperation(id, async ({ pc }) => {
          await pc.setLocalDescription(await pc.createOffer())
          if (pc.localDescription) signal(id, { description: pc.localDescription.toJSON() })
        })
      }
    }
    voiceStatus()
  }
  async function receiveSignal(message: { from: string; data?: unknown }): Promise<void> {
    if (!voice || !nearby(members.find((member) => member.id === message.from))) return
    const generation = voiceGeneration
    try { if (!peers.has(message.from) && !await ensureVoiceConfig(generation)) return } catch { feedback('Voice configuration could not be refreshed.'); return }
    if (!voice || generation !== voiceGeneration || !nearby(members.find((member) => member.id === message.from))) return
    const data = message.data as SignalPayload | null | undefined
    if (!data || typeof data !== 'object') return
    peerOperation(message.from, async (peer) => {
      const { pc } = peer
      if (data.description) {
        const description = data.description
        if (!['offer', 'answer'].includes(description.type)) return
        // Only the lower session id offers, so both sides cannot negotiate at once.
        if (description.type === 'offer' && session && message.from > session.id) return
        if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') return
        await pc.setRemoteDescription(description)
        for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate)
        if (description.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer())
          if (pc.localDescription) signal(message.from, { description: pc.localDescription.toJSON() })
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate)
        else if (peer.candidates.length < 100) peer.candidates.push(data.candidate)
      }
    })
  }

  // ---- chat --------------------------------------------------------------------------------------------------
  function appendChat(message: { body: string; from?: PublicSession }, delivery = 'Sent', key?: string): ChatLine {
    const line: ChatLine = { key: key ?? `line-${++lineCounter}`, author: message.from?.name || session?.name || '', body: message.body, delivery, canRetry: false }
    chat.push(line)
    while (chat.length > 80) chat.shift()
    emit()
    return line
  }
  function retryPending(): void {
    if (!roomReady) return
    for (const [clientId, message] of pending) {
      if (message.sent || message.failed) continue
      message.sent = send({ type: 'chat', body: message.body, clientId }); message.line.delivery = 'Sending…'
    }
    emit()
  }
  function receive(event: { data: unknown }): void {
    let message: Incoming | null
    try { message = JSON.parse(String(event.data)) as Incoming | null } catch { return }
    if (!message || typeof message !== 'object') return
    // The Worker host cannot ping a hibernating socket: it asks, and the answer proves this connection is alive.
    if (message.type === 'heartbeat') { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat-ack' })); return }
    if (message.type === 'presence') {
      const wasRevoked = roomRevoked
      members = message.members || []
      if (roomRevoked && !members.some((member) => member.id === session?.id)) return
      roomRevoked = false
      if (wasRevoked) feedbackText = ''
      if (connected && members.some((member) => member.id === session?.id)) connection = 'Connected'
      composeDisabled = false
      rejectedPeers.clear(); roomReady = true; renderMembers(); retryPending(); void syncPeers(); voiceStatus()
    } else if (message.type === 'chat') {
      if (seen.has(message.id)) return
      seen.add(message.id)
      if (seen.size > 100) { const oldest = seen.values().next(); if (!oldest.done) seen.delete(oldest.value) }
      const local = message.clientId ? pending.get(message.clientId) : undefined
      if (local && message.clientId && message.from?.id === session?.id) { local.line.delivery = 'Sent'; local.line.canRetry = false; pending.delete(message.clientId); emit() }
      else appendChat(message)
    } else if (message.type === 'signal') void receiveSignal(message)
    else if (message.type === 'error') {
      const refused = message.error || message.code
      // The server refused a Home room this socket asked for: whatever else is true, no microphone stays open on a refusal.
      if (refused === 'not_a_guest') leaveVoice(false)
      // The room is gone for this socket -- the life left the venue, or a house visit ended: voice stops with it.
      if (refused === 'venue_mismatch' || refused === 'visit_ended') {
        roomRevoked = true; roomReady = false; members = []; rejectedPeers.clear()
        if (reconnectTimer !== null) clearTimeout(reconnectTimer)
        reconnectTimer = null; canReconnect = false
        leaveVoice(false); renderMembers()
        for (const pendingMessage of pending.values()) {
          pendingMessage.line.delivery = refused === 'visit_ended' ? 'Not sent: the visit ended' : 'Not sent: you moved to another place'
          pendingMessage.line.canRetry = false
        }
        pending.clear(); composeDisabled = true
        connection = 'Room changed'
        feedback(refused === 'visit_ended' ? 'The visit has ended.' : 'You moved to another place. Return to the game to reconnect here.')
        return
      }
      const rejected = message.clientId ? pending.get(message.clientId) : undefined
      if (rejected) { rejected.failed = true; rejected.sent = false; rejected.line.delivery = 'Not sent'; rejected.line.canRetry = true }
      if (message.error === 'peer_out_of_range') {
        const out = message.to ? [message.to] : [...peers].filter(([, peer]) => peer.pc.connectionState !== 'connected').map(([id]) => id)
        for (const id of out) { rejectedPeers.add(id); closePeer(id) }
        voiceStatus(); return
      }
      if (message.error === 'voice_room_full') { leaveVoice(); feedbackText = 'This voice circle is full. Try joining when someone leaves.' }
      else if (message.error === 'rate_limited') feedbackText = 'Messages are arriving too quickly. Pause briefly before sending more.'
      else feedbackText = message.message || 'The room could not process that action.'
      // A refused chat line: the sentence the server sent is repeated by the host (a toast), from this state.
      if (rejected) refusal = { seq: ++refusalSeq, text: feedbackText }
      emit()
    }
  }

  // ---- the socket --------------------------------------------------------------------------------------------
  function connect(): void {
    if (destroyed || roomRevoked || !session || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    roomReady = false; canReconnect = false; report(attempts ? 'Reconnecting…' : 'Connecting…'); voiceStatus()
    const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`)
    socket = current
    current.onopen = () => { if (destroyed || socket !== current) return; connected = true; attempts = 0; report('Connected'); if (!roomRevoked) send({ type: 'join', ...room }) }
    current.onmessage = (event) => { if (!destroyed && socket === current) receive(event) }
    current.onclose = () => {
      if (destroyed || socket !== current) return
      socket = null; connected = false; roomReady = false; members = []; renderMembers(); leaveVoice(false)
      for (const message of pending.values()) { message.sent = false; if (!message.failed) message.line.delivery = 'Pending reconnection' }
      report('Disconnected')
      if (roomRevoked) { canReconnect = false; feedback('You moved to another place. Return to the game to reconnect here.'); return }
      if (attempts < 5) { const delay = Math.min(1000 * 2 ** attempts, 15000); attempts++; reconnectTimer = setTimeout(connect, delay) }
      else { canReconnect = true; feedback('The room is offline. Reconnect when the server is available.') }
    }
    current.onerror = () => report('Connection unavailable')
  }

  // ---- joining voice: the only place a microphone is asked for ---------------------------------------------------
  async function joinVoice(): Promise<void> {
    if (!roomReady || room.venueId === 'home' || joiningVoice || voice) return
    if ((!audioStreamFactory && !navigator.mediaDevices?.getUserMedia) || !browser().RTCPeerConnection) { feedback('Voice needs a supported browser on localhost or HTTPS.'); return }
    const generation = ++voiceGeneration
    joiningVoice = true; feedbackText = ''; voiceStatus()
    let resumePlayback: Promise<void>
    const Context = browser().AudioContext || browser().webkitAudioContext
    playbackNote = null
    if (Context) {
      try {
        const context = new Context()
        playbackContext = context
        resumePlayback = context.resume().then(() => { if (context.state && context.state !== 'running') throw new Error('Playback suspended') })
      } catch { resumePlayback = Promise.reject(new Error('Playback unavailable')) }
    } else resumePlayback = Promise.reject(new Error('WebAudio unsupported'))
    try {
      try { await resumePlayback } catch {
        if (destroyed || generation !== voiceGeneration) return
        closePlaybackContext()
        playbackNote = 'This browser cannot use spatial WebAudio playback. Browser audio volume is a fallback and may not fade reliably on every device; the distance cutoff still applies.'
      }
      if (destroyed || generation !== voiceGeneration) return
      if (!await ensureVoiceConfig(generation) || !roomReady) return
      const constraints: MediaStreamConstraints = { audio: selectedDevice ? { deviceId: { exact: selectedDevice } } : true, video: false }
      const acquired = await (audioStreamFactory ? audioStreamFactory(constraints) : navigator.mediaDevices.getUserMedia(constraints))
      acquired.getAudioTracks().forEach((track) => { track.enabled = false })
      if (destroyed || generation !== voiceGeneration || !roomReady) { acquired.getTracks().forEach((track) => track.stop()); return }
      stream = acquired; voice = true; muted = true; joiningVoice = false
      stream.getAudioTracks().forEach((track) => { track.onended = () => { if (voice) { leaveVoice(); feedback('Microphone access ended. Join voice to try again.') } } })
      send({ type: 'voice-state', enabled: true, muted: true }); void syncPeers(); voiceStatus()
      if (!audioStreamFactory) void loadMicrophones(generation)
      if (diagnostics) { void updateDiagnostics(generation); diagnosticsTimer = setInterval(() => updateDiagnostics(generation), 1000) }
    } catch (error) {
      if (generation !== voiceGeneration || destroyed) return
      const failure = error as { name?: string; message?: string } | null
      leaveVoice(false)
      feedback(failure?.name === 'NotAllowedError' ? 'Microphone permission was denied. You can still use room chat.' : failure?.message?.includes('configuration') || failure?.message?.includes('credentials') ? 'Voice connection settings are unavailable. Try joining again when the relay service is ready.' : 'No microphone could be opened. Check your device and try again.')
    }
  }
  async function getDiagnostics(): Promise<DiagnosticsSnapshot> {
    const peerStats = await Promise.all([...peers].map(async ([id, peer]): Promise<DiagnosticsPeer> => {
      const result: DiagnosticsPeer = { id, connectionState: peer.pc.connectionState, inboundPacketsReceived: 0, totalAudioEnergy: 0, outboundPacketsSent: 0, rms: null, gain: peer.gain, playbackMode: peer.gainNode ? 'web-audio' : 'media-element-fallback', htmlSinkState: peer.htmlSinkState, distance: distanceTo(members.find((member) => member.id === id)), sourceAudioLevel: null, sourceTotalAudioEnergy: null, inboundAudioLevel: null, receiverTracks: peer.remoteStream?.getAudioTracks?.().map((track) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState })) || [] }
      try {
        if (peer.analyser && peer.audioSamples) {
          peer.analyser.getFloatTimeDomainData(peer.audioSamples)
          result.rms = Math.sqrt(peer.audioSamples.reduce((sum, value) => sum + value * value, 0) / peer.audioSamples.length)
        }
        const stats = await peer.pc.getStats()
        let selectedPairId: string | null = null
        stats.forEach((stat) => { if (stat.type === 'transport' && stat.selectedCandidatePairId) selectedPairId = stat.selectedCandidatePairId })
        if (!selectedPairId) stats.forEach((stat) => { if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') selectedPairId = stat.id })
        const pair = selectedPairId ? stats.get(selectedPairId) : null
        if (pair) { result.localCandidateType = stats.get(pair.localCandidateId)?.candidateType || null; result.remoteCandidateType = stats.get(pair.remoteCandidateId)?.candidateType || null }
        stats.forEach((stat) => {
          if (stat.kind !== 'audio' && stat.mediaType !== 'audio') return
          if (stat.type === 'media-source') { if (Number.isFinite(stat.audioLevel)) result.sourceAudioLevel = stat.audioLevel; if (Number.isFinite(stat.totalAudioEnergy)) result.sourceTotalAudioEnergy = stat.totalAudioEnergy }
          if (stat.type === 'inbound-rtp') { result.inboundPacketsReceived += stat.packetsReceived || 0; result.totalAudioEnergy += stat.totalAudioEnergy || 0; if (Number.isFinite(stat.audioLevel)) result.inboundAudioLevel = stat.audioLevel }
          if (stat.type === 'outbound-rtp') result.outboundPacketsSent += stat.packetsSent || 0
        })
      } catch { result.statsUnavailable = true }
      return result
    }))
    const live = (tracks: MediaStreamTrack[] | undefined): number => tracks?.filter((track) => track.readyState !== 'ended').length || 0
    const localTracks = stream?.getAudioTracks().map((track) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState })) || []
    const trackCount = live(stream?.getTracks())
    const remoteTrackCount = [...peers.values()].reduce((count, peer) => count + live(peer.remoteStream?.getTracks()), 0)
    return { voice, muted, trackCount, liveTrackCount: trackCount + remoteTrackCount, localTracks, playbackContextState: playbackContext?.state || null, position: validPosition(selfMember()), relayMode: iceConfig?.mode || null, peers: peerStats }
  }
  async function updateDiagnostics(generation: number): Promise<void> {
    const result = await getDiagnostics()
    if (destroyed || !voice || generation !== voiceGeneration) return
    diagnosticsText = JSON.stringify(result, null, 2); emit(); onPeerStats(result)
  }
  async function loadMicrophones(generation: number): Promise<void> {
    if (!navigator.mediaDevices.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      if (destroyed || generation !== voiceGeneration) return
      const inputs = all.filter((device) => device.kind === 'audioinput' && device.deviceId)
      devices = [{ id: '', label: 'System default' }, ...inputs.map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }))]
      if (selectedDevice && !inputs.some((device) => device.deviceId === selectedDevice)) selectedDevice = ''
      emit()
    } catch { feedback('Microphone choices could not be listed. You can still use the system microphone.') }
  }

  // ---- what the panel's controls do ----------------------------------------------------------------------------------
  function toggleMute(): void {
    if (!voice) return
    muted = !muted
    stream?.getAudioTracks().forEach((track) => { track.enabled = !muted })
    send({ type: 'voice-state', enabled: voice, muted }); voiceStatus()
  }
  function selectDevice(id: string): void { selectedDevice = id; if (voice) feedback('Leave and rejoin voice to use the selected microphone.'); else emit() }
  function playPeer(id: string): void {
    const peer = peers.get(id)
    if (!peer) return
    peer.audio.play().then(() => { peer.htmlSinkState = 'playing'; peer.playVisible = false; emit() }).catch(() => feedback('Audio playback is blocked. Check your browser sound permissions.'))
  }
  function reconnect(): void { if (roomRevoked) return; attempts = 0; feedbackText = ''; connect() }
  function sendChat(text: string): boolean {
    if (roomRevoked) return false
    const body = text.trim()
    if (!body) return false
    if (pending.size >= 25) { feedback('Wait for pending messages to send before adding more.'); return false }
    const clientId = crypto.randomUUID()
    const line = appendChat({ body, from: session ?? undefined }, roomReady ? 'Sending…' : 'Pending reconnection', clientId)
    const sent = roomReady && send({ type: 'chat', body, clientId })
    pending.set(clientId, { body, line, sent, failed: false })
    feedback('')
    return true
  }
  function retryMessage(key: string): void {
    const rejected = pending.get(key)
    if (destroyed || !rejected) return
    rejected.failed = false; rejected.sent = false; rejected.line.delivery = roomReady ? 'Sending…' : 'Pending reconnection'
    rejected.line.canRetry = false; retryPending()
  }
  async function saveName(text: string): Promise<boolean> {
    const name = text.trim()
    if (name.length < 3) { feedback('Use a nickname with at least three characters.'); return false }
    savingName = true; emit()
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!response.ok) throw new Error('Session unavailable')
      const result = await response.json() as { session: PublicSession }
      if (destroyed) return false
      session = result.session; feedbackText = ''; emit(); connect()
      return true
    } catch { feedback('Could not save your device nickname. Check the local server and try again.'); return false } finally { savingName = false; emit() }
  }
  function join(nextCityId: string, nextVenueId: string): void {
    if (destroyed || (!roomRevoked && room.cityId === nextCityId && room.venueId === nextVenueId)) return
    leaveVoice(!roomRevoked); roomRevoked = false; composeDisabled = false
    room = { cityId: nextCityId, venueId: nextVenueId }; roomReady = false; members = []
    for (const message of pending.values()) { message.line.delivery = 'Not delivered: room changed'; message.line.canRetry = false }
    pending.clear(); seen.clear(); rejectedPeers.clear(); chat.length = 0; renderMembers(); labelRoom()
    feedbackText = ''
    if (connected) send({ type: 'join', ...room }); else connect()
    voiceStatus()
  }
  function destroy(): void {
    if (destroyed) return
    destroyed = true
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    leaveVoice()
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.close(); socket = null }
    cleanups.forEach((remove) => remove())
    members = []; memberRows = []; announce(); emit(); listeners.clear()
  }

  listen(browser(), 'pagehide', () => leaveVoice())
  try {
    const response = await fetch('/api/session')
    if (response.ok) { const result = await response.json() as { session: PublicSession }; session = result.session; connect() }
    else report(response.status === 401 ? 'Choose a nickname' : 'Server unavailable')
  } catch { report('Server unavailable'); feedback('Start the local community server to join a room.') }
  voiceStatus(); renderPosition(); emit()
  return {
    get state() { return snapshot() },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSession() { return session ? { ...session } : null },
    getDiagnostics, moveTo, join, walk, saveName, sendChat, retryMessage, joinVoice, toggleMute,
    leaveVoice: () => leaveVoice(), selectDevice, playPeer, reconnect, destroy,
  }
}
