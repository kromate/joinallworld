<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { createProgressLoader } from './progress-loader.ts'

const { game } = useApp()
const active = computed(() => Boolean(game.state.value.activeAction))
const scope = computed(() => `${game.session.value?.id ?? ''}|${game.cityId.value}`)
const attempt = ref(0)
const loadRenderer = createProgressLoader(async () => (await import('./RunningActionProgress.vue')).default)
const loading = defineComponent({ setup: () => () => h('p', { role: 'status' }, 'Loading current activity…') })
const failed = defineComponent({ setup: () => () => h('div', { role: 'alert', class: 'life-progress-load-error' }, [
  h('p', 'Activity controls could not load. Your activity is still saved. Try again when your connection is ready.'),
  h('button', { type: 'button', class: 'ui-button', onClick: () => { attempt.value++ } }, 'Try loading activity controls again'),
]) })
const renderer = computed(() => {
  attempt.value
  return defineAsyncComponent({ loader: loadRenderer, loadingComponent: loading, errorComponent: failed, delay: 0 })
})
</script>

<template>
  <component v-if="active" :is="renderer" :key="`${scope}:${attempt}`" />
</template>
