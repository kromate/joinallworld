<script setup lang="ts">
// A bounded loading state; the existing landing and game mount after their city's data arrives.
import '../ui/tokens.css'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Component, ShallowRef } from 'vue'
import { noteBootResult } from './bootstrap.ts'
import type { LoadedGame } from './bootstrap.ts'
import { BOOT_WORDS, bootStage, nextStageIn, startFresh, takeAutoReload } from './state/bootWatch.ts'
import { isChunkLoadError, noteChunkFailure, updateAvailable } from './state/updateNotice.ts'

const props = defineProps<{ load: () => Promise<LoadedGame> }>()
const game: ShallowRef<Component | null> = shallowRef(null)
const busy = ref(false)
const failed = ref(false)
const stage = ref(bootStage(performance.now()))
const clearing = ref(false)
let frame: number | null = null
let timer: number | null = null
let stageTimer: number | null = null
let disposed = false

// Counted from when the page began loading, so a slow download of the first script counts too.
function watchStage(): void {
  stage.value = bootStage(performance.now())
  const wait = nextStageIn(performance.now())
  if (wait !== null && !disposed) stageTimer = window.setTimeout(watchStage, wait)
}

// Only while the page is still opening: a reload in the middle of a game would lose what the player was typing.
function reloadOnce(): boolean {
  let memory: Storage | null = null
  try { memory = window.sessionStorage } catch { /* blocked: no automatic reload */ }
  if (!takeAutoReload(memory, Date.now())) return false
  window.location.reload()
  return true
}

async function open(): Promise<void> {
  if (busy.value || game.value) return
  busy.value = true
  failed.value = false
  try {
    const loaded = await props.load()
    if (disposed) return
    game.value = loaded.default
    noteBootResult(false)
    await nextTick()
    if (!disposed) loaded.ready()
  } catch (error) {
    if (disposed) return
    game.value = null
    failed.value = true
    noteBootResult(true)
    if (isChunkLoadError(error) && reloadOnce()) return
    if (isChunkLoadError(error)) await noteChunkFailure()
  } finally { busy.value = false }
}

onMounted(() => {
  watchStage()
  // Yield one paint before starting the imports; this is not an idle render loop.
  frame = window.requestAnimationFrame(() => { timer = window.setTimeout(() => { void open() }, 0) })
})
onBeforeUnmount(() => {
  disposed = true
  if (frame !== null) window.cancelAnimationFrame(frame)
  if (timer !== null) window.clearTimeout(timer)
  if (stageTimer !== null) window.clearTimeout(stageTimer)
})
// A failed module import stays rejected in the browser module cache until navigation.
const reload = (): void => { window.location.reload() }
// Clears this site's service worker and cached files, never localStorage or cookies (the guest identity lives there), then reloads.
async function fresh(): Promise<void> {
  if (clearing.value) return
  clearing.value = true
  await startFresh({ serviceWorker: navigator.serviceWorker, caches: typeof caches === 'undefined' ? undefined : caches })
  window.location.reload()
}
</script>

<template>
  <component :is="game" v-if="game" />
  <main v-else class="boot-screen" aria-labelledby="boot-title" :aria-busy="busy">
    <section class="boot-content">
      <h1 id="boot-title">Allworld</h1>
      <p class="boot-lead">A whole world to live in.</p>
      <div v-if="failed" role="alert">
        <p v-if="updateAvailable">Allworld has been updated. Reload to continue.</p>
        <p v-else>Allworld couldn't finish loading. Check your connection, then try again.</p>
        <button v-if="updateAvailable" type="button" @click="reload">Reload</button>
        <button v-else type="button" @click="reload">Try again</button>
      </div>
      <template v-else>
        <p class="boot-status" role="status">{{ stage === 'loading' ? BOOT_WORDS.loading : BOOT_WORDS.slow }}</p>
        <template v-if="stage === 'fresh'">
          <p class="boot-note">{{ BOOT_WORDS.freshNote }}</p>
          <button type="button" :disabled="clearing" @click="fresh">{{ clearing ? BOOT_WORDS.clearing : BOOT_WORDS.fresh }}</button>
        </template>
      </template>
    </section>
  </main>
</template>

<style scoped>
.boot-screen { position: fixed; inset: 0; display: grid; place-items: center; overflow: auto; padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom)); box-sizing: border-box; background: var(--c-canvas); color: var(--c-ink); font: 16px/1.5 var(--font); }
.boot-content { width: min(100%, 32rem); margin: auto; text-align: center; }
h1 { margin: 0; color: var(--c-green-dark); font-size: clamp(2rem, 8vw, 3rem); line-height: 1.15; letter-spacing: -.03em; }
.boot-lead { margin: 12px 0 32px; font-size: 20px; }
.boot-status { color: var(--c-muted); }
.boot-note { margin: 12px 0 0; color: var(--c-muted); font-size: 14px; }
button { min-height: var(--tap); margin-top: 12px; padding: 10px 22px; border: 0; border-radius: var(--r-pill); background: var(--c-green-dark); color: var(--c-surface-solid); font: inherit; font-weight: 700; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
button:hover { background: var(--c-night); }
button:focus-visible { outline: var(--focus); outline-offset: 4px; }
</style>
