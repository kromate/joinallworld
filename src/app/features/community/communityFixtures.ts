// Fixtures for the Community tests only: a complete CommunityState and a controller that records what it was asked.
import type { CommunityOptions } from '../../../community.ts'
import type { CommunityController, CommunityState } from '../../../types/community.ts'

export function communityState(patch: Partial<CommunityState> = {}): CommunityState {
  return {
    room: { cityId: 'lagos', venueId: 'park' }, group: null, groupList: null, apart: null, groupNote: null, roomText: 'Lagos · The Park', privateHome: false, connection: 'Connected',
    hasSession: true, session: { id: 'a', name: 'Alex' }, savingName: false,
    members: [{ id: 'a', label: 'Alex (you)', state: 'Here' }, { id: 'b', label: 'Bea <b>', state: 'In voice · near' }], memberCount: 2,
    positionText: 'Nobody else is in voice here yet.', walkDisabled: false,
    voice: {
      on: false, joining: false, muted: false, canJoin: true, joinLabel: 'Join voice', muteLabel: 'Mute mic',
      status: 'Your microphone is off. Join voice to request access.', relayNote: 'Relay availability is checked when you join voice. Microphone starts muted.',
      playbackNote: null, devices: null, selectedDevice: '', blocked: [],
    },
    chat: [], composeDisabled: false, feedback: '', canReconnect: false, refusal: null, diagnosticsText: null,
    ...patch,
  }
}

/** A controller that does nothing but remember its calls. `options` is what createCommunity was given. */
export interface FakeController extends CommunityController {
  options: CommunityOptions
  calls: string[]
  destroyed: boolean
  current: CommunityState
}
export function fakeController(options: CommunityOptions, initial: CommunityState = communityState()): FakeController {
  const calls: string[] = []
  const self: FakeController = {
    options, calls, destroyed: false, current: initial,
    get state() { return self.current },
    subscribe: () => () => {},
    getSession: () => ({ id: 'a', name: 'Alex' }),
    getDiagnostics: () => Promise.reject(new Error('not in this fake')),
    moveTo(x, z) { calls.push(`moveTo ${x},${z}`); return true },
    join(city, venue) { calls.push(`join ${city},${venue}`) },
    walk(dx, dz) { calls.push(`walk ${dx},${dz}`) },
    saveName: async (name) => { calls.push(`saveName ${name}`); return true },
    sendChat(body) { calls.push(`sendChat ${body}`); return true },
    retryMessage(key) { calls.push(`retryMessage ${key}`) },
    listGroups() { calls.push('listGroups') }, closeGroups() { calls.push('closeGroups') }, joinGroup(id) { calls.push(`joinGroup ${id}`) },
    joinFriendGroup(id) { calls.push(`joinFriendGroup ${id}`) }, clearGroupNote() { calls.push('clearGroupNote') },
    joinVoice: async () => { calls.push('joinVoice') },
    toggleMute() { calls.push('toggleMute') },
    leaveVoice() { calls.push('leaveVoice') },
    selectDevice(id) { calls.push(`selectDevice ${id}`) },
    playPeer(id) { calls.push(`playPeer ${id}`) },
    reconnect() { calls.push('reconnect') },
    destroy() { self.destroyed = true; calls.push('destroy'); options.onMembers?.({ self: 'a', members: [] }) },
  }
  return self
}
