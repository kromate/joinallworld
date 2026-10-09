<script setup lang="ts">
// Chat settings that are the player's own and follow them to every device: who may add them to groups, and whether a mention
// breaks through a muted group.
import { computed, ref } from 'vue'
import { perform } from '../social/useSocial.ts'
import NotifySettings from './NotifySettings.vue'
import type { ChatPrefs, ChatPrefsBody } from '../../../types/social.ts'

const props = defineProps<{ prefs: ChatPrefs }>()
const saving = ref(false), error = ref('')
const optimistic = ref<ChatPrefsBody>({})
const displayed = computed(() => ({ ...props.prefs, ...optimistic.value }))
async function save(body: ChatPrefsBody): Promise<void> {
  if (saving.value) return
  saving.value = true; error.value = ''; optimistic.value = body
  try {
    const result = await perform('/api/social/prefs', body)
    if (!result.ok) error.value = result.reason
  } finally { optimistic.value = {}; saving.value = false }
}
</script>

<template>
  <section class="settings" aria-label="Chat settings" :aria-busy="saving">
    <fieldset :disabled="saving">
      <legend>Who can add me to groups</legend>
      <label><input type="radio" name="groups-from" value="friends" :checked="displayed.groups === 'friends'" @change="save({ groups: 'friends' })"> My friends</label>
      <label><input type="radio" name="groups-from" value="nobody" :checked="displayed.groups === 'nobody'" @change="save({ groups: 'nobody' })"> Nobody</label>
      <p>Someone you have blocked can never add you. If you are added to a group you do not want, you can leave it in one tap from Updates.</p>
    </fieldset>
    <label class="switch"><input type="checkbox" :disabled="saving" :checked="displayed.mentions === 'on'" @change="save({ mentions: ($event.target as HTMLInputElement).checked ? 'on' : 'off' })"> Let a mention reach me even when a group is muted</label>
    <label class="switch"><input type="checkbox" :disabled="saving" :checked="displayed.introductions === 'on'" @change="save({ introductions: ($event.target as HTMLInputElement).checked ? 'on' : 'off' })"> Let regulars offer to introduce me to people I keep bumping into</label>
    <p>Only people who have this on too are ever offered, and only when they are standing in the same place as you. Switching it off deletes what was kept about your visits.</p>
    <fieldset :disabled="saving"><legend>Voice notes</legend><label><input type="checkbox" :checked="displayed.voiceNotes !== 'nobody'" @change="save({ voiceNotes: ($event.target as HTMLInputElement).checked ? 'friends' : 'nobody' })"> Receive voice notes from friends and groups</label><p>Recordings only download when you press play. Turn this off to stop receiving them.</p></fieldset>
    <p v-if="saving" role="status">Saving chat settings…</p>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <NotifySettings :notify="prefs.notify" />
  </section>
</template>

<style scoped>
.settings { min-width: 0; overflow-wrap: anywhere; display: grid; gap: 8px; margin: 8px 0; padding: var(--s-3) var(--s-4); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font-size: 13px; }
fieldset { min-width: 0; display: grid; gap: 4px; margin: 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 4px; font-weight: 700; }
label { display: flex; align-items: center; gap: 8px; min-height: 44px; font-weight: 500; }
input { flex: none; }
.settings-error { color: var(--c-red-dark); }
p { margin: 0; font-size: 12px; line-height: 1.45; color: var(--c-muted); }
</style>
