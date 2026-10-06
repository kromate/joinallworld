<script setup lang="ts">
// A line chart of one or more series over days, in plain SVG (no chart library): a labelled axis, gaps where a day was not measured, a
// pointer or arrow-key crosshair that names the day and its values, and the same numbers as a table for anyone who cannot use the picture.
import { computed, ref } from 'vue'
import { describe, linePath, niceMax, xAt, yAt } from './chartModel.ts'

export interface Series { name: string; color: string; values: readonly (number | null)[] }
const props = withDefaults(defineProps<{ title: string; labels: readonly string[]; series: readonly Series[]; height?: number; unit?: string }>(), { height: 180, unit: '' })
const box = computed(() => ({ width: 600, height: props.height, left: 38, right: 10, top: 10, bottom: 22 }))
const top = computed(() => niceMax(Math.max(0, ...props.series.flatMap((one) => one.values.map((value) => value ?? 0)))))
const ticks = computed(() => [0, 0.5, 1].map((part) => ({ value: Math.round(top.value * part * 10) / 10, y: yAt(box.value, top.value * part, top.value) })))
const xTicks = computed(() => { const n = props.labels.length; return n ? [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, all) => all.indexOf(v) === i).map((index) => ({ index, x: xAt(box.value, index, n), text: props.labels[index] ?? '', anchor: index === 0 ? 'start' : index === n - 1 ? 'end' : 'middle' })) : [] })
const paths = computed(() => props.series.map((one) => ({ ...one, d: linePath(box.value, one.values, top.value) })))
const at = ref<number | null>(null)
const readout = computed(() => (at.value === null ? '' : `${props.labels[at.value] ?? ''}: ${props.series.map((one) => `${one.name} ${one.values[at.value as number] === null || one.values[at.value as number] === undefined ? 'not measured' : (one.values[at.value as number] as number).toLocaleString('en-GB')}${props.unit}`).join(', ')}`))
function move(event: PointerEvent): void {
  const svg = event.currentTarget as SVGElement, rect = svg.getBoundingClientRect(), n = props.labels.length
  if (!n || rect.width <= 0) return
  const x = ((event.clientX - rect.left) / rect.width) * box.value.width
  at.value = Math.max(0, Math.min(n - 1, Math.round(((x - box.value.left) / (box.value.width - box.value.left - box.value.right)) * (n - 1))))
}
function key(event: KeyboardEvent): void {
  const n = props.labels.length
  if (!n) return
  if (event.key === 'ArrowLeft') at.value = Math.max(0, (at.value ?? n) - 1)
  else if (event.key === 'ArrowRight') at.value = Math.min(n - 1, (at.value ?? -1) + 1)
  else if (event.key === 'Escape') at.value = null
  else return
  event.preventDefault()
}
const label = computed(() => props.series.map((one) => describe(one.name, props.labels, one.values)).join(' '))
</script>

<template>
  <figure class="adm-chart">
    <figcaption>{{ props.title }}<span v-if="props.series.length > 1" class="adm-legend"><i v-for="one in props.series" :key="one.name"><b :style="{ background: one.color }" />{{ one.name }}</i></span></figcaption>
    <svg :viewBox="`0 0 ${box.width} ${box.height}`" role="img" tabindex="0" :aria-label="`${props.title}. ${label} Use the arrow keys to read a day.`" @pointermove="move" @pointerleave="at = null" @keydown="key" @blur="at = null">
      <g class="adm-grid-lines">
        <g v-for="tick in ticks" :key="tick.y"><line :x1="box.left" :x2="box.width - box.right" :y1="tick.y" :y2="tick.y" /><text :x="box.left - 6" :y="tick.y + 3" text-anchor="end">{{ tick.value.toLocaleString('en-GB') }}</text></g>
        <text v-for="tick in xTicks" :key="tick.index" :x="tick.x" :y="box.height - 5" :text-anchor="tick.anchor">{{ tick.text }}</text>
      </g>
      <path v-for="one in paths" :key="one.name" :d="one.d" fill="none" :stroke="one.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      <g v-if="at !== null">
        <line class="adm-cross" :x1="xAt(box, at, props.labels.length)" :x2="xAt(box, at, props.labels.length)" :y1="box.top" :y2="box.height - box.bottom" />
        <template v-for="one in props.series" :key="one.name"><circle v-if="one.values[at] !== null && one.values[at] !== undefined" :cx="xAt(box, at, props.labels.length)" :cy="yAt(box, one.values[at] as number, top)" r="3.5" :fill="one.color" /></template>
      </g>
    </svg>
    <p class="adm-readout" aria-live="polite">{{ readout || ' ' }}</p>
    <details class="adm-table-fallback"><summary>Show as a table</summary>
      <div class="adm-scroll"><table class="adm-table"><thead><tr><th>Day</th><th v-for="one in props.series" :key="one.name">{{ one.name }}</th></tr></thead>
        <tbody><tr v-for="(day, index) in props.labels" :key="day + index"><td>{{ day }}</td><td v-for="one in props.series" :key="one.name">{{ one.values[index] === null || one.values[index] === undefined ? '-' : (one.values[index] as number).toLocaleString('en-GB') }}</td></tr></tbody></table></div>
    </details>
  </figure>
</template>
