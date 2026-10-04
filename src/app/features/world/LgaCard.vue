<script setup lang="ts">
// THE LOCAL-GOVERNMENT CARD: a self-contained piece of UI, not a panel. It can be mounted anywhere
// a life chooses or changes where it lives (the local government's page, Profile); the mounting
// screen does not know how it works.
//
// What it sends is the ordinary game action 'estate.set-lga' { lga, via }, validated by the server
// and applied once per action id. The free house on a plot is allocated by the server as soon as
// it is saved. "Find my local government" works the position out on this device and sends
// nothing but the id the player confirms (see lgaCardModel.ts).
//
// The list is the control kit's select (ListboxSelect.vue). Every button that sends something
// shows "Saving…" and is disabled while the request is on its way; every disabled button has its
// reason in the text beside it.
import '../../../ui/controls.css'
import { computed, ref, shallowRef, watch } from 'vue'
import type { LgaId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import ListboxSelect from './ListboxSelect.vue'
import { findLga, lgaCardUi as ui } from './lgaCardModel.ts'
import { track, worldChanged } from './worldModel.ts'

withDefaults(defineProps<{
  heading?: string
  /** Kept for the callers that pass it; the card draws the same either way. */
  compact?: boolean
}>(), { heading: 'Where you live', compact: false })
const emit = defineEmits<{ /** The server accepted the choice. */ chosen: [lga: LgaId] }>()

const { game, command } = useApp()
const estate = computed(() => game.view.value.estate)
const offline = computed(() => (game.connected.value ? '' : `${linkWords(game.view.value)?.short ?? 'Offline'} — this needs the server`))
const current = computed(() => (estate.value.placed && estate.value.lga ? estate.value.lga : null))
const guess = computed(() => (!estate.value.placed && !estate.value.lgaConfirmed && estate.value.lga ? estate.value.lga : null))
const blocked = computed(() => (current.value && estate.value.change.blocked ? estate.value.change.blocked : ''))
const showList = computed(() => ui.picking || (!current.value && !ui.found))
const options = computed(() => [{ value: '', label: 'Choose…' }, ...estate.value.lgas.map((item) => ({ value: item.id, label: `${item.name}${current.value && item.levy ? ` · ${money(item.levy)} to move your house` : ''}` }))])

// The list starts on the one just found, or the game's guess; what the player picks stays until one of those changes.
const suggested = (): string => ui.found?.id ?? guess.value?.id ?? ''
const pick = ref(suggested())
watch(suggested, (id) => { pick.value = id })
const select = shallowRef<{ focus(): void } | null>(null)
const setSelect = (el: unknown): void => { select.value = el as { focus(): void } | null }

async function find(): Promise<void> { await findLga(ui, estate.value.city) }
function choosePick(): void { ui.picking = true; ui.found = null; ui.note = '' }

async function send(via: 'device' | 'manual'): Promise<void> {
  if (ui.sending) return
  const wanted = via === 'device' ? ui.found?.id : pick.value
  const lga = estate.value.lgas.find((item) => item.id === wanted)?.id
  if (!lga) { ui.note = 'Choose a local government first.'; return }
  ui.sending = true
  ui.note = ''
  const result = await command('estate.set-lga', { lga, via })
  ui.sending = false
  if (result.ok) {
    Object.assign(ui, { found: null, picking: false, note: '' })
    track('lga_chosen', { method: via === 'device' ? 'device' : 'manual', lga })
    // The server allocates the house now; the maps are told what they cached is stale.
    worldChanged()
    emit('chosen', lga)
  } else ui.note = result.reason || 'That could not be saved. Try again.'
}
</script>

<template>
  <section v-if="estate.lgas.length" class="ui-panel" data-lga-card>
    <h3>{{ heading }}</h3>
    <template v-if="current">
      <p class="world-now"><b>{{ current.name }}</b><small>{{ current.line }}</small></p>
      <p v-if="estate.plot" class="ui-note">Your house: {{ estate.plot.address }}</p>
      <p v-else class="ui-note">Your plot is being set aside…</p>
    </template>
    <p v-else class="ui-note">Pick your local government and a starter house on your own plot there is yours, free. <template v-if="guess">Your home is in {{ guess.name }}.</template></p>

    <div v-if="ui.found" class="world-found" role="status">
      <p>{{ ui.found.sure ? 'You are in' : 'Nearest to you is' }} <b>{{ ui.found.name }}</b>. Is that right?</p>
      <div class="ui-actions">
        <button type="button" class="ui-button is-primary" :class="{ 'is-loading': ui.sending }" :disabled="Boolean(offline || blocked || ui.sending)" @click="send('device')">{{ ui.sending ? 'Saving…' : `Yes, ${ui.found.name}` }}</button>
        <button type="button" class="ui-button" @click="choosePick">No, let me pick</button>
      </div>
    </div>

    <!-- With a home: the change controls first, then the list. Without: the list first, finding it second. -->
    <template v-for="part in (current ? ['actions', 'list'] : ['list', 'actions'])" :key="part">
      <template v-if="part === 'list'">
        <template v-if="showList">
          <div class="ui-labelled">
            <span @click="select?.focus()">Choose from the {{ estate.lgas.length }} local governments of {{ estate.cityName }}</span>
            <ListboxSelect :ref="setSelect" v-model="pick" label="Local government" :options="options" :disabled="Boolean(offline || blocked)" />
          </div>
          <button type="button" class="ui-button is-primary is-block" :class="{ 'is-loading': ui.sending }" :disabled="Boolean(offline || blocked || ui.sending)" @click="send('manual')">{{ ui.sending ? 'Saving…' : current ? 'Move here' : 'This is my local government' }}</button>
        </template>
      </template>
      <template v-else-if="current && !ui.picking && !ui.found">
        <div class="ui-actions">
          <button type="button" class="ui-button" :disabled="Boolean(blocked)" @click="choosePick">Change</button>
          <button type="button" class="ui-button is-quiet" :disabled="Boolean(blocked) || ui.finding" @click="find">{{ ui.finding ? 'Finding…' : 'Find my local government' }}</button>
        </div>
        <p v-if="blocked" class="ui-why">{{ blocked }}</p>
        <p v-else class="ui-note">You can change once every {{ estate.change.cooldownDays }} days. Your house moves with you.</p>
      </template>
      <template v-else-if="!ui.found">
        <div class="ui-cluster is-between">
          <button type="button" class="ui-button is-quiet" :disabled="ui.finding" @click="find"><GameIcon name="compass" inline /><span>{{ ui.finding ? 'Finding…' : 'Find it for me' }}</span></button>
        </div>
        <p class="ui-help">Worked out on this device. Your position is never sent or stored — only the local government you confirm.</p>
      </template>
    </template>

    <p v-if="ui.note" class="ui-why" role="status">{{ ui.note }}</p>
    <p v-if="offline" class="ui-why">{{ offline }}</p>
  </section>
</template>

<style scoped>
.world-now { display: grid; gap: 2px; margin: 0; }
.world-now b { font-size: 17px; }
.world-now small { color: #59616b; font-size: 12px; }
.world-found { display: grid; gap: 8px; padding: 10px; border-radius: 12px; background: #edf4ee; }
.world-found p { margin: 0; }
</style>
