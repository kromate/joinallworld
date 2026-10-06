<script setup lang="ts">
// A group's panel: its people with who runs it, add and remove (the admin), rename, mute and pin for yourself, report, leave.
import { computed, ref, watch } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import RowMark from '../../ui/RowMark.vue'
import FriendPicker from './FriendPicker.vue'
import { perform } from '../social/useSocial.ts'
import type { Conversation, SocialOverview } from '../../../types/social.ts'
import type { PlayerRef } from '../../../types/protocol.ts'

const props = defineProps<{ conv: Conversation; me: SocialOverview }>()
const emit = defineEmits<{ left: []; player: [id: string] }>()
const admin = computed(() => props.conv.owner === props.me.me.id)
const full = computed(() => props.conv.members.length >= props.me.limits.groupSize)
const rename = ref(props.conv.name)
watch(() => props.conv.name, (name) => { rename.value = name })
const adding = ref(false)
const chosen = ref<PlayerRef[]>([])
const reporting = ref(false)
const busy = ref(false)
const path = computed(() => `/api/social/groups/${encodeURIComponent(props.conv.id)}`)
async function run(body: object, good?: string): Promise<boolean> {
  busy.value = true
  const result = await perform(path.value, body, good ?? null)
  busy.value = false
  return result.ok
}
async function addAll(): Promise<void> {
  // One at a time: each is checked by the server on its own, and the first refusal stops the rest with its reason.
  for (const person of chosen.value) if (!(await run({ op: 'add', id: person.id }))) break
  chosen.value = []; adding.value = false
}
async function leave(): Promise<void> { if (await run({ op: 'leave' })) emit('left') }
async function setPref(body: object): Promise<void> { await perform(`/api/social/conversations/${encodeURIComponent(props.conv.id)}/prefs`, body) }
async function report(): Promise<void> {
  reporting.value = false
  await perform('/api/social/reports', { conv: props.conv.id, reason: 'other' }, 'Report received. A moderator will look at this group.')
}
</script>

<template>
  <section class="manage" aria-label="Group">
    <p class="manage-size">{{ conv.members.length }} of {{ me.limits.groupSize }} people ({{ me.limits.groupSize }} people at most)</p>
    <ul class="manage-people">
      <li v-for="member in conv.members" :key="member.id">
        <RowMark :name="member.name" :seed="member.id" />
        <button type="button" class="manage-name" @click="member.id !== me.me.id && emit('player', member.id)">{{ member.name }}<template v-if="member.id === me.me.id"> (you)</template></button>
        <span v-if="member.id === conv.owner" class="manage-role">Admin</span>
        <BaseButton v-if="admin && member.id !== me.me.id" small variant="danger" :disabled="busy" @click="run({ op: 'remove', id: member.id })">Remove</BaseButton>
      </li>
    </ul>
    <template v-if="admin">
      <form class="manage-form" @submit.prevent="run({ op: 'rename', name: rename })">
        <input v-model="rename" name="name" :maxlength="me.limits.groupName" aria-label="Group name" required>
        <BaseButton small type="submit" :disabled="busy">Rename</BaseButton>
      </form>
      <BaseButton v-if="!adding" small :disabled="full" :reason="full ? `This group is full (${me.limits.groupSize} people).` : null" @click="adding = true">Add people</BaseButton>
      <div v-else class="manage-add">
        <FriendPicker v-model:selected="chosen" :exclude="conv.members.map((member) => member.id)" :max="me.limits.groupSize - conv.members.length" />
        <span class="manage-actions"><BaseButton small variant="primary" :disabled="busy || !chosen.length" @click="addAll">Add {{ chosen.length || '' }}</BaseButton><BaseButton small @click="adding = false; chosen = []">Cancel</BaseButton></span>
      </div>
    </template>
    <p v-else class="manage-note">{{ conv.members.find((member) => member.id === conv.owner)?.name ?? 'The admin' }} runs this group and can rename it and change who is in it.</p>
    <label class="manage-switch"><input type="checkbox" :checked="conv.muted === true" @change="setPref({ mute: ($event.target as HTMLInputElement).checked })"> Mute this group <small>(a mention of you still comes through)</small></label>
    <label class="manage-switch"><input type="checkbox" :checked="conv.pinned === true" @change="setPref({ pin: ($event.target as HTMLInputElement).checked })"> Pin to the top of my chats</label>
    <span class="manage-actions">
      <BaseButton small variant="danger" :disabled="busy" @click="leave">Leave group</BaseButton>
      <BaseButton v-if="!reporting" small @click="reporting = true">Report group</BaseButton>
      <template v-else><BaseButton small variant="danger" @click="report">Send report</BaseButton><BaseButton small @click="reporting = false">Cancel</BaseButton></template>
    </span>
  </section>
</template>

<style scoped>
.manage { display: grid; gap: 8px; margin: 8px 12px; padding: var(--s-3) var(--s-4); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font-size: 13px; max-height: 60vh; overflow-y: auto; }
.manage-size, .manage-note { margin: 0; font-size: 12px; color: var(--c-muted); line-height: 1.45; }
.manage-people { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.manage-people li { display: flex; align-items: center; gap: 10px; min-height: 48px; }
.manage-name { flex: 1; min-width: 0; padding: 0; border: 0; background: none; font: 600 14px var(--font); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.manage-role { padding: 2px 8px; border-radius: 10px; background: #e2f2e7; color: var(--c-green-dark); font-size: 11px; font-weight: 700; }
.manage-form { display: flex; gap: 6px; }
.manage-form input { flex: 1; min-width: 0; min-height: var(--tap); box-sizing: border-box; padding: 8px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); font: inherit; font-size: 14px; }
.manage-switch { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-height: 36px; font-weight: 500; }
.manage-switch small { flex-basis: 100%; padding-left: 26px; color: var(--c-muted); }
.manage-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.manage-add { display: grid; gap: 6px; }
</style>
