<script setup lang="ts">
// One HUD chip, whichever kind it is: an existing panel through LegacyPanel, or a Vue component.
// A chip that shows nothing says so (`rendered` with empty = true) and takes no room in the HUD.
// A Vue chip simply renders nothing; the wrapper watches for it, as LegacyPanel does for markup.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Panel } from '../../types/panel.ts'
import { isVuePanel } from '../../types/panel.ts'
import LegacyPanel from '../../legacy/LegacyPanel.vue'

defineProps<{ panel: Panel }>()
const emit = defineEmits<{ rendered: [empty: boolean] }>()

const box = ref<HTMLElement | null>(null)
let watcher: MutationObserver | null = null
const report = (): void => { emit('rendered', !box.value?.firstElementChild) }
onMounted(() => {
  if (!box.value) return
  report()
  watcher = new MutationObserver(report)
  watcher.observe(box.value, { childList: true, subtree: true })
})
onBeforeUnmount(() => { watcher?.disconnect(); watcher = null })
</script>

<template>
  <div v-if="isVuePanel(panel)" ref="box" :data-panel="panel.id"><Suspense><component :is="panel.component" /></Suspense></div>
  <LegacyPanel v-else :panel="panel" @rendered="emit('rendered', $event)" />
</template>
