<script setup lang="ts">
// Home, for a visitor: a life in a city where it has no home. It says where it is and where its home is, and offers what
// a visitor needs, each one tap: a room at a guest house ('estate.lodge'), the way home (the travel card of the home
// city on the atlas), and the two optional ways to have a home here ('estate.set-lga' with `home`): buy one, or move the
// main home. Nothing here has to be done: a visitor may stay a visitor for as long as it likes.
// Shown as the Home tab's sheet (the 'visiting' panel) and at the top of the Houses app.
import '../../../ui/panels/world.css'
import { computed, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useAct } from '../kit/act.ts'
import LgaCard from '../world/LgaCard.vue'
import { linkWords } from './travelBoundary.ts'
import { visitorHome } from './visitorModel.ts'

defineProps<{ params?: unknown }>()
const { game, shell, command, showMapLayer } = useApp()
const { act, pending } = useAct()
const estate = computed(() => game.view.value.estate)
const offline = computed(() => (game.view.value.connected ? '' : `${linkWords(game.view.value)?.short ?? 'Offline'} — this needs the server`))
const model = computed(() => visitorHome(estate.value, offline.value))
/** Which of the two home choices is open: its local-unit picker is shown in place. */
const choosing = ref<'buy' | 'main' | null>(null)

const rest = (): Promise<boolean> => act('lodge', () => command('estate.lodge'))
function goHome(): void {
  const home = estate.value.home
  if (!home) return
  shell.closeSheet()
  showMapLayer('world', { city: home.city })
}
function things(): void { shell.open('city') }
function chosen(): void { choosing.value = null }
// A home was taken here: the life is no longer a visitor, so the visitor's sheet has nothing left to say and closes.
// (In the Houses app this section simply makes way for the house.)
watch(model, (now, was) => { const open = shell.sheet.value; if (was && !now && open?.kind === 'panel' && open.id === 'visiting') shell.closeSheet() })
</script>

<template>
  <section v-if="model" class="world-card visitor-home" data-visitor-home>
    <h3>{{ model.title }}</h3>
    <p class="ui-note">{{ model.line }}</p>
    <div class="visitor-actions">
      <button type="button" class="ui-button is-primary is-block" data-visitor="rest" :disabled="Boolean(model.rest.why) || pending !== null" @click="rest"><GameIcon inline name="home" /><span>{{ model.rest.label }}</span></button>
      <p v-if="model.rest.why" class="ui-why">{{ model.rest.why }}</p>
      <p v-else class="ui-note">A bed and a bath: Energy and Hygiene are restored at once.</p>
      <button v-if="model.home" type="button" class="ui-button is-block" data-visitor="home" @click="goHome"><GameIcon inline name="globe" /><span>{{ model.home.label }}</span></button>
      <button type="button" class="ui-button is-block" data-visitor="things" @click="things"><GameIcon inline name="map" /><span>Things to do in {{ estate.cityName }}</span></button>
    </div>
    <h3>A home here, if you want one</h3>
    <p class="ui-note">You do not need one. You can stay a visitor for as long as you like.</p>
    <div class="visitor-actions">
      <template v-if="choosing !== 'buy'">
        <button type="button" class="ui-button is-block" data-visitor="buy" :disabled="Boolean(offline)" @click="choosing = 'buy'">{{ model.buy.label }}</button>
        <p class="ui-note">{{ model.buy.note }}</p>
      </template>
      <LgaCard v-else home="buy" :heading="`Buy a home in ${estate.cityName}`" compact @chosen="chosen" />
      <template v-if="choosing !== 'main'">
        <button type="button" class="ui-button is-block" data-visitor="main" :disabled="Boolean(model.main.why)" @click="choosing = 'main'">{{ model.main.label }}</button>
        <p :class="model.main.why ? 'ui-why' : 'ui-note'">{{ model.main.why || model.main.note }}</p>
      </template>
      <LgaCard v-else home="main" :heading="model.main.label" compact @chosen="chosen" />
    </div>
  </section>
</template>

<style scoped>
.visitor-home { display: grid; gap: 10px; }
.visitor-actions { display: grid; gap: 8px; }
.visitor-actions p { margin: 0; }
</style>
