<script setup lang="ts">
// The turn clock of a board: one bar that starts where the turn's time really is and runs out with
// it. One CSS animation, no script while a player thinks. A new key (another move, another start
// point) makes a new bar, which is what restarts the animation. Off under reduced motion.
defineProps<{
  /** Seconds the bar takes to run out. */
  seconds: number
  /** Where it starts, '0.00' to '1.00' of the full width. */
  from: string
  /** The number of moves made: what the bar belongs to. */
  n: number
  /** A new value restarts the animation. */
  restart: string
}>()
</script>

<template>
  <div class="wh-clock" aria-hidden="true"><i :key="restart" :style="{ animationDuration: `${seconds}s`, '--from': from }" :data-n="n" /></div>
</template>

<style scoped>
.wh-clock { height: 5px; border-radius: 99px; background: rgba(255, 255, 255, .2); overflow: hidden; }
.wh-clock i { display: block; height: 100%; background: #e8a643; transform-origin: left; animation: wh-run linear forwards; }
@keyframes wh-run { from { transform: scaleX(var(--from, 1)); } to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .wh-clock i { animation: none; } }
</style>
