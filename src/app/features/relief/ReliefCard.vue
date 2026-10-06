<script setup lang="ts">
// "What you can do now": a small chip in the HUD when a player could be stuck (a visitor who cannot pay the way home, hunger or a sickness
// with no money to treat it, no energy with no money for a room). It opens the options as a centred card on a screen with room, and
// as a bottom sheet on a phone. The chip stays while the situation does; the options are what reliefHelp.ts works out.
import '../../../ui/panels/relief.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import ReliefActions from './ReliefActions.vue'
import { helpNow } from './reliefModel.ts'

const { game } = useApp()
const help = computed(() => helpNow(game.state.value, game.cityId.value))
const sheet = ref<HTMLDialogElement | null>(null)
const open = ref(false)
function show(): void { open.value = true }
function hide(): void { open.value = false }
// Asked for by name (the guide's "What can I do?"): open in place when there is something to show.
function asked(event: Event): void { if (help.value) { event.preventDefault(); show() } }
onMounted(() => window.addEventListener('jaw:relief', asked))
onBeforeUnmount(() => window.removeEventListener('jaw:relief', asked))
watch(open, async (now) => {
  await nextTick()
  const dialog = sheet.value
  if (!dialog || typeof dialog.showModal !== 'function') return
  if (now && !dialog.open) { dialog.showModal(); dialog.focus({ preventScroll: true }) }
  else if (!now && dialog.open) dialog.close()
})
// The situation ended (a meal was bought, the way home paid): the sheet goes with it.
watch(help, (now) => { if (!now) open.value = false })
/** A tap on the dimmed page outside the card closes it. */
function backdrop(event: MouseEvent): void { if (event.target === sheet.value) hide() }
</script>

<template>
  <template v-if="help">
    <button type="button" class="relief-chip" aria-haspopup="dialog" :aria-expanded="open" @click="show">
      <span aria-hidden="true"><GameIcon name="coin" :size="18" /></span>
      <span>{{ help.chip }}</span>
    </button>
    <dialog ref="sheet" class="relief-sheet" tabindex="-1" aria-label="What you can do now" @close="open = false" @click="backdrop">
      <section class="relief-card">
        <header><b>{{ help.title }}</b><button type="button" class="relief-close" aria-label="Close" @click="hide">×</button></header>
        <p>{{ help.line }}</p>
        <ReliefActions :help="help" @done="hide" />
      </section>
    </dialog>
  </template>
</template>
