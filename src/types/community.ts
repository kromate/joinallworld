/**
 * Types of the community controller (src/community.ts): the plain state it publishes, and the actions the panel calls. The controller draws nothing; the Vue panel
 * (src/app/features/community/) renders `CommunityState`.
 */
import type { PublicSession } from './protocol.ts'

export interface CommunityRoom { cityId: string; venueId: string }
export interface VoicePosition { x: number; z: number }

/** One member of the room as the server lists it (src/types/protocol.ts PresenceMember, every field optional here). */
export interface RoomMember {
  id: string
  name: string
  enabled?: boolean
  muted?: boolean
  position?: VoicePosition | null
}
/** What the game is told about each member: `position` is null until that member has reported one. */
export interface MemberPlace { id: string; name: string; position: VoicePosition | null }
export interface MembersEvent { self: string | null; members: MemberPlace[] }

export type CommunityLinkStatus = 'online' | 'session-required' | 'connecting' | 'offline'
export interface CommunityStatus { connected: boolean; session: PublicSession | null; status: CommunityLinkStatus }

/** One row of "In this room". */
export interface MemberRow { id: string; label: string; state: string }
/** One chat line. `delivery` is the words under it ("Sending…", "Sent", "Not sent"); `canRetry` shows its Retry button. */
export interface ChatLine { key: string; author: string; body: string; delivery: string; canRetry: boolean }
export interface MicrophoneChoice { id: string; label: string }
/** A received voice the browser would not start by itself: the panel offers a button to play it. */
export interface BlockedPlayback { id: string; name: string }
/** The server refused a chat line you sent: `text` is the sentence to show wherever the player is looking. `seq` grows with each refusal. */
export interface ChatRefusal { seq: number; text: string }

/** The player's group of a public venue: how many are with them, in the venue, in how many groups; `header` is the line the lists lead with. */
export interface GroupView { here: number; total: number; groups: number; cap: number; header: string }
/** One group in "See other groups": a stranger is only a count, a friend is named. */
export interface GroupChoice { id: string; no: number; size: number; open: boolean; mine: boolean; friends: string[] }
export interface GroupList { groups: GroupChoice[]; more: number; total: number }
/** A friend the player could not be placed with: the panel offers one tap to join their group. */
export interface ApartFriend { id: string; name: string; waiting: boolean }

export interface CommunityState {
  room: CommunityRoom
  /** Null in a Home, or on a host that does not split venues into groups. */
  group: GroupView | null
  /** "See other groups" while it is open: null when closed or not read yet. */
  groupList: GroupList | null
  apart: ApartFriend | null
  /** The calm line about being moved (or the first line about chatting with the people around you); cleared by the panel. */
  groupNote: string | null
  /** "Lagos · The Park", or "… · Your home (private)". */
  roomText: string
  privateHome: boolean
  /** The connection pill: "Connecting…", "Connected", "Disconnected", "Room changed" … */
  connection: string
  /** True once a session exists (nickname chosen): the room can be shown. False: show the nickname form. */
  hasSession: boolean
  session: PublicSession | null
  savingName: boolean
  members: MemberRow[]
  memberCount: number
  positionText: string
  walkDisabled: boolean
  voice: {
    on: boolean
    joining: boolean
    muted: boolean
    canJoin: boolean
    joinLabel: string
    muteLabel: string
    status: string
    relayNote: string
    playbackNote: string | null
    /** null: the list has not been read (it is read after microphone permission). */
    devices: MicrophoneChoice[] | null
    selectedDevice: string
    blocked: BlockedPlayback[]
  }
  chat: ChatLine[]
  composeDisabled: boolean
  feedback: string
  canReconnect: boolean
  refusal: ChatRefusal | null
  /** Test-fixture only: the JSON of the synthetic connection's diagnostics (null unless `diagnostics` is on). */
  diagnosticsText: string | null
}

export interface DiagnosticsPeer {
  id: string
  connectionState: string
  inboundPacketsReceived: number
  totalAudioEnergy: number
  outboundPacketsSent: number
  rms: number | null
  gain: number
  playbackMode: 'web-audio' | 'media-element-fallback'
  htmlSinkState: string
  distance: number
  sourceAudioLevel: number | null
  sourceTotalAudioEnergy: number | null
  inboundAudioLevel: number | null
  receiverTracks: { enabled: boolean; muted: boolean; readyState: string }[]
  localCandidateType?: string | null
  remoteCandidateType?: string | null
  statsUnavailable?: boolean
}
export interface DiagnosticsSnapshot {
  voice: boolean
  muted: boolean
  trackCount: number
  liveTrackCount: number
  localTracks: { enabled: boolean; muted: boolean; readyState: string }[]
  playbackContextState: string | null
  position: VoicePosition | null
  relayMode: string | null
  peers: DiagnosticsPeer[]
}

export interface CommunityController {
  /** The state now (a new object after every change). */
  readonly state: CommunityState
  subscribe(listener: (state: CommunityState) => void): () => void
  getSession(): PublicSession | null
  getDiagnostics(): Promise<DiagnosticsSnapshot>
  /** Report where the avatar stands. True when it was sent. */
  moveTo(x: number, z: number): boolean
  join(cityId: string, venueId: string): void
  /** A Walk button. */
  walk(dx: number, dz: number): void
  /** Save the device nickname and connect. Resolves true when the session exists. */
  saveName(name: string): Promise<boolean>
  /** Send a chat line. True when it was accepted into the list (sent now or pending). */
  sendChat(body: string): boolean
  retryMessage(key: string): void
  /** Ask for the venue's groups (shown as `groupList`); close the list. */
  listGroups(): void
  closeGroups(): void
  /** Hop to a group by id, or to a friend's group (it waits for room when full). */
  joinGroup(id: string): void
  joinFriendGroup(friendId: string): void
  clearGroupNote(): void
  /** User gesture only. */
  joinVoice(): Promise<void>
  toggleMute(): void
  leaveVoice(): void
  selectDevice(id: string): void
  playPeer(id: string): void
  reconnect(): void
  destroy(): void
}
