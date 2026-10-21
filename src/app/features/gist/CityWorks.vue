<script setup lang="ts">
// The city's shared works (docs/SMALLER-FEATURES.md): the one being paid for, a gift in game money, the ones that stand, and for the sitting head
// of the city a button to say which comes next. Loaded on its own (the Gist app fetches it with defineAsyncComponent), never at first paint.
// It reads and writes through the game's own fetch only: importing the civic client would give the build a new chunk shared with every civic app.
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import CivicAction from '../civic/CivicAction.vue'
import { firstInOrder, giftChoices, percentOf, readWorks, worksPath } from './worksModel.ts'
import type { WorksAnswer } from './worksModel.ts'

const { game } = useApp()
const city = computed(() => game.view.value.cityId)
const offline = computed(() => (game.view.value.connected ? '' : 'Reconnect to do this.'))
const works = ref<WorksAnswer | null>(null)
const busy = ref('')
async function load(): Promise<void> {
  const asked = city.value
  try { const read = readWorks(await game.fetchJson(worksPath(asked))); if (asked === city.value) works.value = read } catch { /* the card stays as it was */ }
}
onMounted(() => { void load() })
watch(city, () => { works.value = null; void load() })
watch(() => game.view.value.connected, (up) => { if (up) void load() })
const choices = computed(() => (works.value?.active ? giftChoices(works.value.active, works.value.limits) : []))
// One request id per gift or order, reused when the same thing is sent again after a lost answer, so it is applied once.
const ids = new Map<string, string>()
const idFor = (what: string): string => { let id = ids.get(what); if (!id) { id = game.newId(); ids.set(what, id) } return id }
async function send(tag: string, path: string, body: Record<string, unknown>, thanks: string): Promise<void> {
  if (busy.value || offline.value) return
  busy.value = tag
  const asked = city.value, what = `${path}|${JSON.stringify(body)}`
  try {
    const answer = await game.fetchJson<{ ok?: boolean; reason?: string; works?: unknown }>(path, { method: 'POST', body: { ...body, cityId: asked, requestId: idFor(what) } })
    if (answer.ok) { ids.delete(what); game.toast(thanks, 'good'); const read = readWorks({ ...(answer.works as object), you: { canOrder: works.value?.canOrder === true } }); if (asked === city.value && read) works.value = read; void game.refresh() }
    else game.toast(answer.reason ?? 'That could not be done.', 'error')
  } catch { game.toast('That could not be confirmed. Try the same thing again: it will not be done twice.', 'error') } finally { busy.value = '' }
}
const give = (amount: number): Promise<void> => send('give', '/api/civic/works/give', { amount }, 'Thank you. It counts for the whole city.')
const next = (id: string): Promise<void> => send('order', '/api/civic/works/order', { order: firstInOrder(works.value?.order ?? [], id) }, 'That comes next.')
</script>

<template>
  <section v-if="works && (works.active || works.done.length)" class="city-works" data-works="card" aria-label="City works">
    <h3>City works</h3>
    <div v-if="works.active" class="social-row" data-works="active">
      <div>
        <strong>{{ works.active.label }}</strong>
        <small>{{ works.active.line }} {{ money(works.active.paid) }} of {{ money(works.active.cost) }}.</small>
        <progress :value="percentOf(works.active)" max="100" :aria-label="`${percentOf(works.active)} percent paid`" />
      </div>
      <span class="social-actions">
        <CivicAction v-for="amount in choices" :key="amount" :working="busy === 'give'" :reason="offline" @click="give(amount)">Give {{ money(amount) }}</CivicAction>
      </span>
    </div>
    <p v-if="works.canOrder && works.active" class="social-note">You lead the city: choose what comes next.
      <CivicAction v-for="work in works.later" :key="work.id" :working="busy === 'order'" @click="next(work.id)">{{ work.label }} next</CivicAction>
    </p>
    <ul v-if="works.done.length" class="social-list" data-works="done">
      <li v-for="work in works.done" :key="work.id" class="social-row"><div><strong>{{ work.label }}</strong><small>{{ work.line }}</small></div></li>
    </ul>
  </section>
</template>

<style scoped>
.city-works { margin: 0; padding: 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.city-works h3 { font-size: 16px; margin: 0 0 6px; }
.city-works .social-row { padding: 0; border-bottom: 0; }
.city-works .social-actions { padding-top: 8px; }
.city-works progress { width: 100%; height: 8px; margin-top: 6px; }
.city-works [data-works="active"] { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
</style>
