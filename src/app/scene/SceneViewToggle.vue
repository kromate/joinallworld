<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useApp } from '../state/app.ts'
import { onViewPreferencesChange, readViewPreferences, setViewPreferences } from '../../scene/first-person/preferences.ts'

const FirstPersonJourney = defineAsyncComponent(() => import('./FirstPersonJourney.vue'))

const props = defineProps<{ hostRevision: number }>()
const { scene, shell, game } = useApp()
const first = ref(readViewPreferences().mode === 'first')
const loading = ref(false), error = ref(''), failed = ref(false), suspended = ref(false)
const active = computed(() => first.value && !loading.value && !failed.value && !suspended.value)
const buttonLabel = computed(() => {
  if (loading.value) return 'Loading first person view'
  if (suspended.value) return 'Third person view active on campus. Turn off first person preference'
  if (failed.value && first.value) return 'First person view failed to load. Reload to retry'
  return first.value ? 'First person view active. Switch to third person view' : 'Third person view active. Switch to first person view'
})
const buttonTitle = computed(() => suspended.value ? 'Turn off first person preference' : failed.value && first.value ? 'Reload to retry first person view' : first.value ? 'Switch to third person view' : 'Switch to first person view')
const menuText = computed(() => {
  if (loading.value) return 'Loading first-person view…'
  if (suspended.value) return 'Paused on campus. It will resume when you leave.'
  if (failed.value && first.value) return 'Unavailable. Reload to retry.'
  return active.value ? 'On · switch to third person' : 'Off · switch to first person'
})
let revision = 0, gone = false
async function apply(): Promise<void> {
  const mine = ++revision, host = scene.venue.value
  first.value = readViewPreferences().mode === 'first'
  error.value = ''; failed.value = false; suspended.value = false
  if (!host) { loading.value = false; return }
  if (!first.value || game.mode.value !== 'venue') { loading.value = false; host.setView(null); return }
  loading.value = true
  try {
    const { createFirstPerson } = await import('../../scene/first-person/controller.ts')
    if (gone || mine !== revision || host !== scene.venue.value) return
    const supported = host.setView(context => createFirstPerson(context, () => !shell.sheet.value && game.mode.value === 'venue'))
    if (!supported && host.host) { suspended.value = true; error.value = 'Campus uses third person. First person will resume when you leave.' }
  } catch {
    if (!gone && mine === revision) { host.setView(null); failed.value = true; error.value = 'First person could not load. Reload to retry.' }
  } finally { if (!gone && mine === revision) loading.value = false }
}
const stop = onViewPreferencesChange(() => {
  if (first.value !== (readViewPreferences().mode === 'first')) void apply()
})
function toggle(): void {
  if (failed.value && first.value) { window.location.reload(); return }
  if (!setViewPreferences({ mode: first.value ? 'third' : 'first' })) error.value = 'This view is kept for this visit; device storage is unavailable.'
}
watchEffect(() => {
  scene.viewChoice.value = scene.venue.value && !gone ? {
    label: buttonLabel.value,
    title: buttonTitle.value,
    text: menuText.value,
    pressed: active.value,
    busy: loading.value,
    error: error.value || null,
    toggle,
  } : null
})
watch(scene.venue, () => { void apply() })
watch(() => props.hostRevision, () => { void apply() })
watch(game.mode, () => { void apply() })
watch(shell.sheet, () => { scene.venue.value?.update() })
onMounted(() => { void apply() })
onBeforeUnmount(() => { gone = true; revision++; stop(); scene.viewChoice.value = null; scene.venue.value?.setView(null) })
</script>

<template>
  <FirstPersonJourney v-if="first && game.mode.value === 'map' && game.state.value.activeAction" />
</template>
