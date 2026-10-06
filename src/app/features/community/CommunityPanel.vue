<script setup lang="ts">
// The community panel: connection, who is here, nearby voice, room chat. It renders the controller's
// state (src/types/community.ts CommunityState) and calls its actions; it holds no rule of its own.
// Everything a player or the server typed (nicknames, chat lines, the server's sentences) is shown
// as text by Vue's interpolation, never as markup.
//
// The microphone: the Join voice button is the only control that can start it (a user gesture), and
// the controller starts the stream muted. Nothing in this file asks for media.
import { computed, nextTick, ref, watch } from 'vue'
import type { CommunityStore } from './communityStore.ts'
import NpcBadge from '../../ui/NpcBadge.vue'
import '../../../community.css'

const props = defineProps<{ store: Pick<CommunityStore, 'state' | 'controller'> }>()
const s = computed(() => props.store.state.value)
const control = () => props.store.controller()
const nickname = ref('')
const draft = ref('')
const messages = ref<HTMLElement | null>(null)

async function saveName(): Promise<void> { await control()?.saveName(nickname.value) }
function send(): void { if (control()?.sendChat(draft.value)) draft.value = '' }
function chooseDevice(event: Event): void { control()?.selectDevice((event.target as HTMLSelectElement).value) }

// Keep the newest line in view as lines arrive.
watch(() => s.value?.chat.length ?? 0, async () => { await nextTick(); if (messages.value) messages.value.scrollTop = messages.value.scrollHeight })
</script>

<template>
  <section v-if="s" class="community" aria-label="Local community" data-community-panel>
    <header class="community-header">
      <div><span class="community-eyebrow">People nearby</span><h2>Community</h2></div>
      <span class="community-connection" role="status">{{ s.connection }}</span>
    </header>
    <p class="community-room">{{ s.roomText }}</p>

    <form v-if="!s.hasSession" class="community-name" @submit.prevent="saveName">
      <label for="community-nickname">Choose a device nickname</label>
      <div class="community-input-row">
        <input id="community-nickname" v-model="nickname" name="name" required minlength="3" maxlength="24" autocomplete="nickname" placeholder="Your name">
        <button :disabled="s.savingName">Join room</button>
      </div>
      <p>This nickname is saved on this device. It is not a verified identity.</p>
    </form>

    <p v-if="s.privateHome" class="community-private-note">Your home is private to this device session. Public nearby voice and community chat are available at shared venues.</p>
    <div v-if="s.hasSession" class="community-content">
      <div class="community-presence">
        <h3>{{ s.group ? 'Around you' : 'In this room' }} <span class="community-count">{{ s.memberCount }}</span></h3>
        <p v-if="s.group" class="community-group-header" data-group-header>{{ s.group.header }}</p>
        <p v-if="s.groupNote" class="community-group-note" role="status" data-group-note>{{ s.groupNote }} <button type="button" class="community-link" @click="control()?.clearGroupNote()">OK</button></p>
        <p v-if="s.apart" class="community-group-apart" data-group-apart>
          {{ s.apart.name }} is in another part of the venue.
          <button type="button" data-group-join-friend :disabled="s.apart.waiting" @click="control()?.joinFriendGroup(s.apart.id)">{{ s.apart.waiting ? 'Waiting for room…' : `Join ${s.apart.name}'s group` }}</button>
        </p>
        <ul class="community-members" aria-label="Room members">
          <li v-for="member in s.members" :key="member.id"><span>{{ member.label }}</span><small>{{ member.state }}</small></li>
        </ul>
        <div v-if="s.group && s.group.groups > 1" class="community-groups">
          <button v-if="!s.groupList" type="button" data-groups-open @click="control()?.listGroups()">See other groups</button>
          <template v-else>
            <ul class="community-group-list" aria-label="Groups in this place" data-group-list>
              <li v-for="group in s.groupList.groups" :key="group.id">
                <span>Group {{ group.no }}{{ group.mine ? ' (yours)' : '' }} · {{ group.size }} {{ group.size === 1 ? 'person' : 'people' }}<template v-if="group.friends.length"> · {{ group.friends.join(', ') }}</template></span>
                <button v-if="!group.mine" type="button" :disabled="!group.open" :data-group-join="group.id" @click="control()?.joinGroup(group.id)">{{ group.open ? 'Join' : 'Full' }}</button>
              </li>
            </ul>
            <p v-if="s.groupList.more" class="community-position-note">and {{ s.groupList.more }} more groups</p>
            <button type="button" @click="control()?.closeGroups()">Close</button>
          </template>
        </div>
      </div>

      <div v-if="!s.privateHome" class="community-proximity">
        <h3>Nearby voice</h3>
        <p class="community-position" role="status">{{ s.positionText }}</p>
        <p class="community-position-note">Voice follows where your character stands. Walk closer to hear someone: voices fade with distance and stop at 12 steps.</p>
        <div class="community-movement" role="group" aria-label="Walk your character">
          <button type="button" class="community-north" aria-label="Walk two steps away from the entrance" :disabled="s.walkDisabled" @click="control()?.walk(0, -2)">↑ Walk up</button>
          <button type="button" class="community-west" aria-label="Walk two steps left" :disabled="s.walkDisabled" @click="control()?.walk(-2, 0)">← Left</button>
          <button type="button" class="community-south" aria-label="Walk two steps towards the entrance" :disabled="s.walkDisabled" @click="control()?.walk(0, 2)">↓ Down</button>
          <button type="button" class="community-east" aria-label="Walk two steps right" :disabled="s.walkDisabled" @click="control()?.walk(2, 0)">Right →</button>
        </div>
      </div>

      <div v-if="!s.privateHome" class="community-voice">
        <div class="community-voice-top">
          <h3>Voice circle</h3>
          <button v-if="!s.voice.on" class="community-join-voice" type="button" :disabled="!s.voice.canJoin" @click="control()?.joinVoice()">{{ s.voice.joinLabel }}</button>
          <button v-if="s.voice.on" class="community-mute" type="button" :aria-pressed="s.voice.muted" @click="control()?.toggleMute()">{{ s.voice.muteLabel }}</button>
          <button v-if="s.voice.on" class="community-leave-voice" type="button" @click="control()?.leaveVoice()">Leave voice</button>
        </div>
        <p class="community-voice-status" role="status">{{ s.voice.status }}</p>
        <div v-if="s.voice.devices" class="community-device">
          <label for="community-microphone">Microphone</label>
          <select id="community-microphone" aria-label="Microphone device" :value="s.voice.selectedDevice" @change="chooseDevice">
            <option v-for="device in s.voice.devices" :key="device.id" :value="device.id">{{ device.label }}</option>
          </select>
          <small>Device changes apply the next time you join voice.</small>
        </div>
        <p v-if="s.voice.playbackNote" class="community-playback-note">{{ s.voice.playbackNote }}</p>
        <p class="community-network-note">{{ s.voice.relayNote }}</p>
        <div class="community-audio">
          <pre v-if="s.diagnosticsText !== null" class="community-diagnostics" aria-label="Synthetic test connection diagnostics">{{ s.diagnosticsText }}</pre>
          <div v-for="peer in s.voice.blocked" :key="peer.id">
            <button type="button" data-community-play @click="control()?.playPeer(peer.id)">Play audio from {{ peer.name }}</button>
          </div>
        </div>
      </div>

      <div v-if="!s.privateHome" class="community-chat">
        <h3>Room chat</h3>
        <ol ref="messages" class="community-messages" aria-label="Room messages" aria-live="polite" aria-relevant="additions">
          <li v-for="line in s.chat" :key="line.key" :class="{ 'is-npc': line.npc }" :data-npc-line="line.npc ? '' : undefined">
            <div><strong><NpcBadge v-if="line.npc" lead />{{ line.author }}</strong><small v-if="line.delivery">{{ line.delivery }}</small></div>
            <p>{{ line.body }}</p>
            <button v-if="line.canRetry" type="button" data-community-retry-message @click="control()?.retryMessage(line.key)">Retry message</button>
          </li>
        </ol>
        <form class="community-compose" @submit.prevent="send">
          <label class="community-sr-only" for="community-message">Message this room</label>
          <div class="community-input-row">
            <input id="community-message" v-model="draft" maxlength="500" required autocomplete="off" placeholder="Say hello to this room…" :disabled="s.composeDisabled">
            <button :disabled="s.composeDisabled">Send</button>
          </div>
        </form>
      </div>
    </div>

    <div class="community-feedback" role="status">{{ s.feedback }}</div>
    <button v-if="s.canReconnect" class="community-retry" type="button" @click="control()?.reconnect()">Reconnect</button>
  </section>
</template>

<style scoped>
/* A game character's line: tinted, with a dashed rule down its left edge, besides the NPC badge before its name. A real player's line is plain. */
.community-messages li.is-npc { background: var(--c-fill, #eef1ef); border-left: 3px dashed var(--c-faint, #6b737c); padding-left: 10px; }
</style>
