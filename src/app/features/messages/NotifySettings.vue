<script setup lang="ts">
// Phone notifications for messages: whether this phone is set up (the switch itself is on Stay in touch, where the age question and the
// browser's permission are asked), what a notification says, which group messages come through, a pause, quiet hours, and a test.
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { loadPushModule } from '../growth/boundary.ts'
import { pushCard } from '../growth/touchModel.ts'
import { pushKind } from '../growth/touchState.ts'
import { useGrowth } from '../growth/useGrowth.ts'
import { perform } from '../social/useSocial.ts'
import type { NotifyPrefs } from '../../../types/social.ts'

defineProps<{ notify: NotifyPrefs }>()
const { shell, game } = useApp()
const growth = useGrowth()
onMounted(() => {
  void growth.load()
  if (pushKind.value === null) void loadPushModule().then((module) => { pushKind.value = module.pushState() })
})
const card = computed(() => pushCard(growth.state.hello?.consent ?? null, pushKind.value, false))
const devices = computed(() => growth.state.hello?.contact.push.devices ?? 0)
const busy = ref(false)
const save = (body: object): Promise<unknown> => perform('/api/social/notify', body)
async function test(): Promise<void> {
  busy.value = true
  const result = await growth.call<{ ok: true; devices: number }>('/api/growth/push/test', {})
  busy.value = false
  game.toast(result.ok ? 'Test sent. It should show on this phone in a moment.' : result.reason, result.ok ? 'good' : 'error')
}
const words: Record<string, string> = {
  on: 'Notifications are on.',
  intro: 'Notifications are off on this phone.',
  ask: 'Notifications are off on this phone.',
  blocked: 'Notifications are blocked in this browser. To turn them on, open the browser’s site settings for Allworld and allow notifications, then come back here.',
  unsupported: 'This browser cannot show notifications.',
  'needs-install': 'On iPhone and iPad, notifications work only for Allworld added to your Home Screen. In Safari tap Share, then Add to Home Screen, and open Allworld from there.',
}
</script>

<template>
  <section class="notify" aria-label="Message notifications">
    <h4>Notifications for messages</h4>
    <p role="status">{{ words[card] }}<template v-if="card === 'on'"> {{ devices }} {{ devices === 1 ? 'device' : 'devices' }}.</template></p>
    <BaseButton v-if="card === 'intro' || card === 'ask'" small variant="primary" @click="shell.open('touch')">Set up notifications</BaseButton>
    <template v-if="card === 'on'">
      <BaseButton small :disabled="busy" @click="test">Send me a test notification</BaseButton>
      <label><input type="checkbox" :checked="notify.text" @change="save({ text: ($event.target as HTMLInputElement).checked })"> Show the message text in notifications <small>(off: “New message from Joy”)</small></label>
      <label><input type="checkbox" :checked="notify.groups === 'all'" @change="save({ groups: ($event.target as HTMLInputElement).checked ? 'all' : 'mentions' })"> Notify me of every group message <small>(otherwise only when I am mentioned or answered)</small></label>
      <label><input type="checkbox" :checked="notify.quietGroups" @change="save({ quietGroups: ($event.target as HTMLInputElement).checked })"> Keep group messages quiet from 10 pm to 7 am <small>(by this phone’s clock)</small></label>
      <label><input type="checkbox" :checked="notify.quietDm" @change="save({ quietDm: ($event.target as HTMLInputElement).checked })"> Keep direct messages quiet at night too</label>
      <label class="pause">Pause all message notifications
        <select name="pause" :value="notify.pausedUntil ? 'on' : 'off'" @change="save({ pause: ($event.target as HTMLSelectElement).value })">
          <option value="off">{{ notify.pausedUntil ? 'Resume now' : 'Not paused' }}</option>
          <option value="1h">For 1 hour</option>
          <option value="8h">For 8 hours</option>
          <option value="tomorrow">Until tomorrow morning</option>
        </select>
      </label>
    </template>
    <p class="note">A message you are reading never buzzes your phone. Muting a group silences it, except for a mention of you.</p>
  </section>
</template>

<style scoped>
.notify { display: grid; gap: 8px; padding-top: 8px; border-top: 1px solid var(--c-line); font-size: 13px; }
h4 { margin: 0; font-size: 13px; }
p { margin: 0; line-height: 1.45; }
.note { font-size: 12px; color: var(--c-muted); }
label { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-height: 36px; font-weight: 500; }
label small { flex-basis: 100%; padding-left: 26px; color: var(--c-muted); }
.pause { display: grid; gap: 4px; }
.pause select { min-height: var(--tap); padding: 6px 10px; border: 1px solid #cfd5d1; border-radius: var(--r-sm); background: #fff; font: inherit; font-size: 14px; }
</style>
