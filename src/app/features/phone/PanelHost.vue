<script setup lang="ts">
// Shows one panel's component. Whoever lists panels (the Phone, the Sim sheet, a modal sheet, the
// nav area) uses this. While it is mounted the panel's key hook
// is the one the shell calls for 'key:*' shortcuts and for Esc.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Panel, PanelExposed } from '../../types/panel.ts'
import { useApp } from '../../state/app.ts'
import SkeletonRows from '../../ui/SkeletonRows.vue'

const props = withDefaults(defineProps<{ panel: Panel; params?: unknown }>(), { params: undefined })
const { shell } = useApp()
const inner = ref<PanelExposed | null>(null)
const keys = (action: string): boolean => inner.value?.keys?.(action) === true
onMounted(() => shell.keyHandlers.set(props.panel.id, keys))
onBeforeUnmount(() => { if (shell.keyHandlers.get(props.panel.id) === keys) shell.keyHandlers.delete(props.panel.id) })
</script>

<template>
  <Suspense>
    <component :is="panel.component" ref="inner" :params="params" />
    <template #fallback><SkeletonRows /></template>
  </Suspense>
</template>
