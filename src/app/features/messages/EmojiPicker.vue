<script setup lang="ts">
// A small emoji picker: categories, the ones this device used last, and a search by keyword. Text only (src/app/features/messages/emojiData.ts).
import { computed, ref } from 'vue'
import { EMOJI_CATEGORIES } from './emojiData.ts'

const emit = defineEmits<{ pick: [char: string] }>()
const RECENT_KEY = 'joinallworld-emoji-recent'
const read = (): string[] => { try { const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 24) : [] } catch { return [] } }
const recent = ref<string[]>(read())
const category = ref<string>(recent.value.length ? 'recent' : 'faces')
const query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (q) return EMOJI_CATEGORIES.flatMap((c) => c.emoji).filter((e) => e.words.includes(q)).map((e) => e.char)
  if (category.value === 'recent') return recent.value
  return EMOJI_CATEGORIES.find((c) => c.id === category.value)?.emoji.map((e) => e.char) ?? []
})
function pick(char: string): void {
  recent.value = [char, ...recent.value.filter((item) => item !== char)].slice(0, 24)
  try { globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(recent.value)) } catch { /* recents are for this visit only */ }
  emit('pick', char)
}
</script>

<template>
  <div class="emoji" role="group" aria-label="Emoji">
    <input v-model="query" class="emoji-search" type="search" placeholder="Search emoji" aria-label="Search emoji" autocomplete="off">
    <div v-if="!query" class="emoji-tabs" role="tablist">
      <button v-if="recent.length" type="button" role="tab" :aria-selected="category === 'recent'" aria-label="Recent" @click="category = 'recent'">🕘</button>
      <button v-for="item in EMOJI_CATEGORIES" :key="item.id" type="button" role="tab" :aria-selected="category === item.id" :aria-label="item.label" @click="category = item.id">{{ item.icon }}</button>
    </div>
    <div class="emoji-grid">
      <button v-for="char in shown" :key="char" type="button" :aria-label="char" @pointerdown.prevent @click="pick(char)">{{ char }}</button>
      <p v-if="!shown.length" class="emoji-none">Nothing matches that. Try another word.</p>
    </div>
  </div>
</template>

<style scoped>
.emoji { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1); }
.emoji-search { box-sizing: border-box; width: 100%; min-height: 36px; padding: 6px 12px; border: 1px solid #cfd5d1; border-radius: var(--r-pill); font: inherit; font-size: 14px; }
.emoji-tabs { display: flex; gap: 2px; overflow-x: auto; }
.emoji-tabs button { flex: none; min-width: 36px; min-height: 36px; border: 0; border-radius: 10px; background: none; font-size: 18px; cursor: pointer; }
.emoji-tabs button[aria-selected='true'] { background: var(--c-fill-2); }
.emoji-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); gap: 2px; max-height: 168px; overflow-y: auto; overscroll-behavior: contain; }
.emoji-grid button { min-height: 38px; border: 0; border-radius: 10px; background: none; font-size: 22px; line-height: 1; cursor: pointer; }
.emoji-grid button:hover, .emoji-grid button:focus-visible { background: var(--c-fill-2); outline: none; }
.emoji-none { grid-column: 1 / -1; margin: 6px; font-size: 12px; color: var(--c-muted); }
</style>
