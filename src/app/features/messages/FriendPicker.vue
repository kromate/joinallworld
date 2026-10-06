<script setup lang="ts">
// Pick friends to put in a group: a search box, a list that shows a page at a time, and the chosen people as chips. A player with
// thousands of friends (the founder's automatic ones are fetched a page at a time) is searched on the server, never listed whole.
import { computed, ref, watch } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import RowMark from '../../ui/RowMark.vue'
import { call, social, useSocial } from '../social/useSocial.ts'
import type { PlayerRef } from '../../../types/protocol.ts'

const props = defineProps<{ exclude: readonly string[]; max: number; selected: readonly PlayerRef[] }>()
const emit = defineEmits<{ 'update:selected': [people: PlayerRef[]] }>()
const client = useSocial()
const query = ref('')
const page = ref(30)
const found = ref<PlayerRef[]>([])
const searching = ref(false)
const error = ref<string | null>(null)
const me = computed(() => social.me)
const taken = computed(() => new Set([...props.exclude, ...props.selected.map((person) => person.id)]))
// What is already loaded, minus the founder (who cannot be added by an ordinary player) and the people already here.
const local = computed(() => (me.value?.friends ?? []).filter((friend) => !taken.value.has(friend.id) && (me.value?.friendsMore || friend.founder !== true) && friend.name.toLowerCase().includes(query.value.trim().toLowerCase())))
const list = computed(() => {
  const ids = new Set(local.value.map((friend) => friend.id))
  return [...local.value, ...found.value.filter((friend) => !ids.has(friend.id) && !taken.value.has(friend.id))]
})
const room = computed(() => props.max - props.selected.length)
let timer: ReturnType<typeof setTimeout> | null = null
watch(query, (text) => {
  page.value = 30; found.value = []; error.value = null
  if (timer) clearTimeout(timer)
  // A friend not yet loaded is looked up on the server: only for the founder, whose friend list is longer than one answer.
  if (text.trim().length < 2 || !me.value?.friendsMore) return
  timer = setTimeout(async () => {
    searching.value = true
    const result = await call<{ results: PlayerRef[] }>(`/api/social/friends/search?q=${encodeURIComponent(text.trim())}`)
    searching.value = false
    if (result.ok) found.value = result.results; else error.value = result.reason
  }, 250)
})
function add(person: PlayerRef): void { if (room.value > 0) emit('update:selected', [...props.selected, person]) }
function drop(id: string): void { emit('update:selected', props.selected.filter((person) => person.id !== id)) }
</script>

<template>
  <div class="picker">
    <div v-if="selected.length" class="picker-chosen" role="list" aria-label="Chosen">
      <button v-for="person in selected" :key="person.id" type="button" role="listitem" class="picker-chip" :aria-label="`Remove ${person.name}`" @click="drop(person.id)">{{ person.name }} ✕</button>
    </div>
    <input v-model="query" class="picker-search" type="search" name="friend" placeholder="Search your friends" aria-label="Search your friends" autocomplete="off">
    <p v-if="error" class="picker-note is-warn" role="alert">{{ error }}</p>
    <p v-else-if="searching" class="picker-note" role="status">Searching…</p>
    <ul v-if="list.length" class="picker-list" aria-label="Friends">
      <li v-for="friend in list.slice(0, page)" :key="friend.id">
        <RowMark :name="friend.name" :seed="friend.id" />
        <span class="picker-name">{{ friend.name }}</span>
        <BaseButton small :disabled="room <= 0" :reason="room <= 0 ? `A group holds ${max} people.` : null" @click="add(friend)">Add</BaseButton>
      </li>
    </ul>
    <p v-else-if="!searching && !error" class="picker-note">{{ query.trim() ? 'No friend has that name. Only friends can be added.' : (me?.friends.length ? 'Everyone you can add is already chosen.' : 'Groups are for friends. Add a friend first, then make a group.') }}</p>
    <div v-if="list.length > page || (me?.friendsMore?.next && !query.trim())" class="picker-more">
      <BaseButton v-if="list.length > page" small @click="page += 30">Show more</BaseButton>
      <BaseButton v-else small :disabled="social.friendsLoading" @click="client.loadMoreFriends()">{{ social.friendsLoading ? 'Loading…' : 'Load more friends' }}</BaseButton>
    </div>
  </div>
</template>

<style scoped>
.picker { display: grid; gap: 6px; }
.picker-search { box-sizing: border-box; width: 100%; min-height: var(--tap); padding: 8px 14px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); background: #fff; font: inherit; font-size: 14px; }
.picker-chosen { display: flex; flex-wrap: wrap; gap: 6px; }
.picker-chip { min-height: 32px; padding: 0 12px; border: 0; border-radius: 16px; background: #e2f2e7; color: var(--c-green-dark); font: 600 13px var(--font); cursor: pointer; }
.picker-list { display: grid; gap: 2px; max-height: 220px; margin: 0; padding: 0; overflow-y: auto; list-style: none; overscroll-behavior: contain; }
.picker-list li { display: flex; align-items: center; gap: 10px; min-height: 48px; }
.picker-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.picker-note { margin: 4px 2px; font-size: 12px; line-height: 1.45; color: var(--c-muted); }
.picker-note.is-warn { color: var(--c-red); }
.picker-more { display: flex; justify-content: center; }
</style>
