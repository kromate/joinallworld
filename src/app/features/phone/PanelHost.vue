<script setup lang="ts">
// Shows one panel's component. Whoever lists panels (the Phone, the Sim sheet, a modal sheet, the
// nav area) uses this. While it is mounted the panel's key hook
// is the one the shell calls for 'key:*' shortcuts and for Esc.
import { onBeforeUnmount, onErrorCaptured, onMounted, ref } from 'vue'
import type { Panel, PanelExposed } from '../../types/panel.ts'
import { useApp } from '../../state/app.ts'
import { PanelBodyLoadError } from '../../state/panelBody.ts'
import { noteChunkFailure } from '../../state/updateNotice.ts'
import SkeletonRows from '../../ui/SkeletonRows.vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ panel: Panel; params?: unknown }>(), { params: undefined })
const { shell } = useApp()
const inner = ref<PanelExposed | null>(null)
const failed = ref(false)
const attempt = ref(0)
const keys = (action: string): boolean => !failed.value && inner.value?.keys?.(action) === true
onErrorCaptured((error) => {
  if (!(error instanceof PanelBodyLoadError)) return
  failed.value = true
  inner.value = null
  void noteChunkFailure()
  return false
})
function retry(): void { inner.value = null; attempt.value += 1; failed.value = false }
const reload = (): void => globalThis.location.reload()
onMounted(() => shell.keyHandlers.set(props.panel.id, keys))
onBeforeUnmount(() => { if (shell.keyHandlers.get(props.panel.id) === keys) shell.keyHandlers.delete(props.panel.id) })
</script>

<template>
  <div v-if="failed" v-bind="$attrs" class="panel-load-error">
    <p role="status">This app could not load. Try again, or reload the page.</p>
    <div class="panel-load-error__actions">
      <button type="button" class="ui-button is-primary" @click="retry">Try again</button>
      <button type="button" class="ui-button" @click="reload">Reload page</button>
    </div>
  </div>
  <Suspense v-else>
    <component :is="panel.component" :key="attempt" ref="inner" v-bind="$attrs" :params="params" />
    <template #fallback><SkeletonRows /></template>
  </Suspense>
</template>

<style scoped>
.panel-load-error { padding: 16px; }
.panel-load-error__actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
