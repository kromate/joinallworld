<script setup lang="ts">
// Opt-in birthdays (docs/SMALLER-FEATURES.md): say your month and day, choose whether friends may see it, get a greeting on the day. Nothing is
// public. Fetched when the Gist app opens, never at first paint.
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { MONTHS, dateWords, daysIn, friendsLine, greeting, readBirthday } from './birthdayModel.ts'
import type { BirthdayAnswer } from './birthdayModel.ts'

const { game } = useApp()
const view = ref<BirthdayAnswer | null>(null)
const editing = ref(false), busy = ref(false), failed = ref(false)
const month = ref(1), day = ref(1), share = ref(false)
const offline = computed(() => !game.view.value.connected)
const days = computed(() => daysIn(month.value))
async function load(): Promise<void> {
  try { view.value = readBirthday(await game.fetchJson('/api/world/birthday')); failed.value = false } catch { failed.value = true }
}
onMounted(() => { void load() })
function edit(): void { const mine = view.value?.mine; month.value = mine?.m ?? 1; day.value = mine?.d ?? 1; share.value = mine?.share ?? false; editing.value = true }
async function save(body: object): Promise<void> {
  if (busy.value || offline.value) return
  busy.value = true
  try { view.value = readBirthday(await game.fetchJson('/api/world/birthday', { method: 'POST', body })); editing.value = false; failed.value = false } catch { failed.value = true; game.toast('That could not be saved. Try again.', 'error') } finally { busy.value = false }
}
</script>

<template>
  <section v-if="view || failed" class="birthday" data-gist="birthday" aria-label="Birthday">
    <p v-if="view && greeting(view)" class="birthday-hello" role="status" data-gist="birthday-hello">{{ greeting(view) }}</p>
    <p v-if="view && friendsLine(view.friends)" class="social-note" data-gist="birthday-friends">{{ friendsLine(view.friends) }}</p>
    <template v-if="view && !editing">
      <p class="social-note">
        <template v-if="view.mine">Your birthday: {{ dateWords(view.mine.m, view.mine.d) }}{{ view.mine.share ? ', shown to your friends on the day' : ', private' }}.</template>
        <template v-else>Want a greeting on your birthday? It is optional and never public.</template>
        <button type="button" class="social-btn" @click="edit">{{ view.mine ? 'Change' : 'Add birthday' }}</button>
        <button v-if="view.mine" type="button" class="social-btn" :disabled="busy || offline" @click="save({ clear: true })">Remove</button>
      </p>
    </template>
    <form v-else-if="view" class="birthday-form" @submit.prevent="save({ m: month, d: day, share })">
      <label for="birthday-month" class="sr-only">Month</label>
      <select id="birthday-month" v-model.number="month" class="social-field" @change="day = Math.min(day, days.length)"><option v-for="(name, index) in MONTHS" :key="name" :value="index + 1">{{ name }}</option></select>
      <label for="birthday-day" class="sr-only">Day</label>
      <select id="birthday-day" v-model.number="day" class="social-field"><option v-for="n in days" :key="n" :value="n">{{ n }}</option></select>
      <label class="birthday-share"><input v-model="share" type="checkbox"> Let my friends see it on the day</label>
      <button type="submit" class="social-btn" :disabled="busy || offline">Save</button>
      <button type="button" class="social-btn" @click="editing = false">Cancel</button>
    </form>
    <p v-if="failed && !view" class="ui-error" role="alert">Birthdays could not load. <button type="button" class="social-btn" @click="load">Try again</button></p>
  </section>
</template>

<style scoped>
.birthday { display: grid; gap: 8px; justify-items: start; margin: 0; padding: 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.birthday > * { margin: 0; max-width: 100%; }
.birthday .social-note { margin: 0 !important; }
.birthday .social-note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.birthday .social-note .social-btn { margin: 0; }
.birthday-hello { margin: 0 0 6px; font-weight: 600; }
.birthday-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.birthday-share { flex-basis: 100%; font-size: 13px; }
</style>
