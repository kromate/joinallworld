<script setup lang="ts">
// One HUD chip: a Vue component. A chip that shows nothing says so (`rendered` with empty = true) and
// takes no room in the HUD. A chip simply renders nothing; the wrapper watches for it.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Panel } from '../../types/panel.ts'

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
  <div ref="box" :data-panel="panel.id"><Suspense><component :is="panel.component" /></Suspense></div>
</template>
