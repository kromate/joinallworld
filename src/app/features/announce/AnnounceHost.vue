<script setup lang="ts">
// Mounted once in App.vue and tiny on purpose: the banner and the store behind it are fetched when the first announcement arrives.
import { defineAsyncComponent, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { onCallFrame } from '../social/useSocial.ts'
import type { AnnounceFrame } from '../../../types/announce.ts'

const { game } = useApp()
const wanted = ref(false)
onCallFrame((frame) => {
  if (frame.type !== 'announce') return
  wanted.value = true
  void import('./announceStore.ts').then((store) => store.receiveAnnounce(frame as AnnounceFrame, game.view.value.cityId, game.view.value.now))
})
const AnnounceBanner = defineAsyncComponent(() => import('./AnnounceBanner.vue'))
</script>

<template>
  <AnnounceBanner v-if="wanted" />
</template>
