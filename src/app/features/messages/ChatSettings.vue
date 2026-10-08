<script setup lang="ts">
// Chat settings that are the player's own and follow them to every device: who may add them to groups, and whether a mention
// breaks through a muted group.
import { perform } from '../social/useSocial.ts'
import NotifySettings from './NotifySettings.vue'
import type { ChatPrefs } from '../../../types/social.ts'

defineProps<{ prefs: ChatPrefs }>()
const save = (body: object): Promise<unknown> => perform('/api/social/prefs', body)
</script>

<template>
  <section class="settings" aria-label="Chat settings">
    <fieldset>
      <legend>Who can add me to groups</legend>
      <label><input type="radio" name="groups-from" value="friends" :checked="prefs.groups === 'friends'" @change="save({ groups: 'friends' })"> My friends</label>
      <label><input type="radio" name="groups-from" value="nobody" :checked="prefs.groups === 'nobody'" @change="save({ groups: 'nobody' })"> Nobody</label>
      <p>Someone you have blocked can never add you. If you are added to a group you do not want, you can leave it in one tap from Updates.</p>
    </fieldset>
    <label class="switch"><input type="checkbox" :checked="prefs.mentions === 'on'" @change="save({ mentions: ($event.target as HTMLInputElement).checked ? 'on' : 'off' })"> Let a mention reach me even when a group is muted</label>
    <label class="switch"><input type="checkbox" :checked="prefs.introductions === 'on'" @change="save({ introductions: ($event.target as HTMLInputElement).checked ? 'on' : 'off' })"> Let regulars offer to introduce me to people I keep bumping into</label>
    <p>Only people who have this on too are ever offered, and only when they are standing in the same place as you. Switching it off deletes what was kept about your visits.</p>
    <fieldset><legend>Voice notes</legend><label><input type="checkbox" :checked="prefs.voiceNotes !== 'nobody'" @change="save({ voiceNotes: ($event.target as HTMLInputElement).checked ? 'friends' : 'nobody' })"> Receive voice notes from friends and groups</label><p>Recordings only download when you press play. Turn this off to stop receiving them.</p></fieldset>
    <NotifySettings :notify="prefs.notify" />
  </section>
</template>

<style scoped>
.settings { display: grid; gap: 8px; margin: 8px 0; padding: var(--s-3) var(--s-4); border: 1px solid var(--c-line); border-radius: var(--r-md); background: #fff; font-size: 13px; }
fieldset { display: grid; gap: 4px; margin: 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 4px; font-weight: 700; }
label { display: flex; align-items: center; gap: 8px; min-height: 36px; font-weight: 500; }
p { margin: 0; font-size: 12px; line-height: 1.45; color: var(--c-muted); }
</style>
