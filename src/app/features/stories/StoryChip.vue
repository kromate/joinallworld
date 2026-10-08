<script setup lang="ts">
import '../../../ui/controls.css'
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { social } from '../social/useSocial.ts'
import { neighbourhood } from '../neighbourhood/neighbourhoodStore.ts'
import { isDeparting } from '../../../life.ts'
import type { VisitStory } from '../../../types/visit.ts'

const { game, shell, command } = useApp()
const pending = ref(''), note = ref('')
const visiting = computed(() => social.me?.visiting ?? null)
const story = computed<VisitStory | null>(() => {
  if (visiting.value) return neighbourhood.home?.host.id === visiting.value.host.id ? neighbourhood.home.story ?? null : null
  const run = game.state.value.stories.running, moment = run?.content.moments[run.step]
  return run && moment && game.state.value.location === 'home' && !isDeparting(game.state.value) ? { title: run.content.title, description: run.content.description, moment, step: run.step, total: run.content.moments.length, revision: run.revision } : null
})
const ready = computed(() => game.connected.value && !game.saving.value && !pending.value)
async function advance(end = false): Promise<void> {
  if (!ready.value || visiting.value) return
  pending.value = end ? 'end' : 'next'; note.value = ''
  try { const result = end ? await command('stories.end') : await command('stories.next'); if (!result.ok) note.value = result.reason ?? 'The scene could not advance. Try again.' }
  finally { pending.value = '' }
}
</script>

<template>
  <section v-if="story && game.mode.value === 'venue'" class="story-chip" aria-label="Current scene">
    <div class="story-chip-heading"><strong>{{ story.title }}</strong><small>Moment {{ story.step + 1 }}/{{ story.total }}</small></div>
    <details open class="story-chip-prompt"><summary>{{ story.moment.title }}</summary><p>{{ story.moment.prompt }}</p></details>
    <div v-if="!visiting" class="story-chip-actions">
      <button type="button" class="ui-button" :disabled="!ready" @click="advance()">{{ pending === 'next' ? 'Advancing…' : story.step + 1 === story.total ? 'Finish scene' : 'Next moment' }}</button>
      <button type="button" class="ui-button" :disabled="!ready" @click="advance(true)">{{ pending === 'end' ? 'Ending…' : 'End scene' }}</button>
      <button type="button" class="ui-button" @click="shell.open('invite')">Invite friends</button>
    </div>
    <small v-else>{{ visiting.host.name }} directs this scene.</small>
    <p v-if="note" role="status">{{ note }}</p>
  </section>
</template>

<style scoped>
.story-chip { padding: 10px 12px; border: 1px solid var(--c-line); border-radius: var(--r-sm); background: var(--c-surface); color: var(--c-ink); max-width: min(520px, 100%); box-sizing: border-box; box-shadow: var(--e-1); }
.story-chip-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.story-chip-prompt { margin-top: 6px; }
.story-chip-prompt summary { cursor: pointer; font-weight: 600; }
.story-chip-prompt p { margin: 6px 0 0; max-height: 5.5em; overflow-y: auto; white-space: pre-wrap; }
.story-chip-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.story-chip-actions .ui-button { min-height: 44px; padding: 7px 10px; }
.story-chip > small { display: block; margin-top: 6px; }
</style>
