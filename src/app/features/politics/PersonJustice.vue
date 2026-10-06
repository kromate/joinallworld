<script setup lang="ts">
// On another player's card: Fight, and what an officeholder or an officer can do about this player (make them an officer, arrest them).
// The server decides all of it; every button says why it is off. Loaded only when a card is opened, and only the first time.
import { computed, onMounted } from 'vue'
import { useApp } from '../../state/app.ts'
import type { JusticeResponse } from '../../../types/politics.ts'
import CivicAction from '../civic/CivicAction.vue'
import { useCivic, useLoaded, useOffline } from '../civic/useCivic.ts'
import { arrestRequest, fightRequest } from './politicsDrafts.ts'
import { arrestWhy, enrolSeats, fightWhy, justiceKey, justicePath, judgeOf, officerOf } from './politicsModel.ts'

const props = defineProps<{ id: string; name: string; together: boolean }>()
const { game } = useApp()
const civic = useCivic()
const offline = useOffline()
const cityId = computed(() => game.view.value.cityId)
const loaded = useLoaded<JusticeResponse>({ key: () => justiceKey(cityId.value), path: () => justicePath(cityId.value), maxAge: 15000 })
const data = computed(() => loaded.item.value.data)
const offence = computed(() => data.value?.offences.find((item) => item.by.id === props.id) ?? null)
const seats = computed(() => enrolSeats(data.value))
const why = computed(() => fightWhy(offline('fight'), data.value?.you ?? null, props.together, game.view.value.now))
onMounted(() => loaded.reload())

function done(result: Record<string, unknown>): void {
  if (result.justice) civic.put(justiceKey(cityId.value), result.justice as JusticeResponse)
  civic.changed()
}
async function fight(): Promise<void> {
  const result = await civic.send('p-fight', '/api/politics/justice/fight', { target: props.id, requestId: civic.requestId(fightRequest, [cityId.value, props.id]) })
  civic.requestDone(fightRequest, result)
  if (result.ok) game.toast(result.code === 'won' ? `You beat ${props.name}. It is on record, and the police may come for you.` : `${props.name} beat you. It is on record, and the police may come for you.`, result.code === 'won' ? 'good' : 'error')
  done(result)
}
async function enrol(tier: string, role: 'police' | 'judge' = 'police'): Promise<void> { done(await civic.send(`p-enrol:${role}:${tier}`, '/api/politics/justice/enrol', { tier, role, player: props.id }, { success: `${props.name} is now ${role === 'judge' ? 'a judge' : 'an officer'}.` })) }
async function dismiss(tier: string, role: 'police' | 'judge' = 'police'): Promise<void> { done(await civic.send(`p-dismiss:${role}:${tier}`, '/api/politics/justice/dismiss', { tier, role, player: props.id }, { success: `${props.name} is no longer ${role === 'judge' ? 'a judge' : 'an officer'}.` })) }
async function arrest(id: string): Promise<void> {
  const result = await civic.send('p-arrest', '/api/politics/justice/arrest', { offence: id, requestId: civic.requestId(arrestRequest, [cityId.value, id]) }, { success: `${props.name} is under arrest.` })
  civic.requestDone(arrestRequest, result)
  done(result)
}
</script>

<template>
  <section v-if="data" class="person-justice" aria-label="Law and order">
    <CivicAction :working="civic.busy('p-fight')" X @click="fight">Fight {{ name }}</CivicAction>
    <CivicAction v-if="offence" primary :working="civic.busy('p-arrest')" :reason="arrestWhy(offline('arrest'), offence)" @click="arrest(offence.id)">Arrest {{ name }}</CivicAction>
    <template v-for="seat in seats" :key="seat.scope">
      <CivicAction v-if="!officerOf(seat, id)" :working="civic.busy(`p-enrol:police:${seat.tier}`)" :reason="offline('enrol') ?? (seat.officers.length >= seat.capacity ? `Your force is full (${seat.capacity}).` : '')" @click="enrol(seat.tier)">Make {{ name }} a {{ seat.title }}’s officer</CivicAction>
      <CivicAction v-else :working="civic.busy(`p-dismiss:police:${seat.tier}`)" :reason="offline('dismiss') ?? ''" @click="dismiss(seat.tier)">Dismiss {{ name }} as an officer</CivicAction>
      <CivicAction v-if="!judgeOf(seat, id)" :working="civic.busy(`p-enrol:judge:${seat.tier}`)" :reason="offline('enrol') ?? (seat.judges.length >= seat.judgeCapacity ? `Your bench is full (${seat.judgeCapacity}).` : '')" @click="enrol(seat.tier, 'judge')">Make {{ name }} a judge</CivicAction>
      <CivicAction v-else :working="civic.busy(`p-dismiss:judge:${seat.tier}`)" :reason="offline('dismiss') ?? ''" @click="dismiss(seat.tier, 'judge')">Dismiss {{ name }} as a judge</CivicAction>
    </template>
  </section>
</template>

<style scoped>
.person-justice { display: flex; flex-wrap: wrap; gap: 4px 0; margin: var(--s-2) 0; }
</style>
