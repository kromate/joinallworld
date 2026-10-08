<script setup lang="ts">
// One row of a list: a leading mark, a title with a quieter second line, and something at the end
// (an amount, a count, a chevron). `as="button"` makes the whole row a control; put the rows of
// one list inside a ListRows so they share a card.
withDefaults(defineProps<{
  as?: 'div' | 'li' | 'button'
  title: string
  sub?: string
  /** Shown with a tinted background: something new in this row. */
  unread?: boolean
}>(), { as: 'div', sub: '', unread: false })
</script>

<template>
  <component :is="as" class="list-row" :class="{ 'is-unread': unread, 'is-control': as === 'button' }" :type="as === 'button' ? 'button' : undefined">
    <span v-if="$slots.icon" class="list-row-icon"><slot name="icon" /></span>
    <span class="list-row-body"><b>{{ title }}</b><small v-if="sub || $slots.sub"><slot name="sub">{{ sub }}</slot></small></span>
    <span v-if="$slots.end" class="list-row-end"><slot name="end" /></span>
  </component>
</template>

<style scoped>
.list-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; margin: 0; padding: 12px 14px; border: 0; border-bottom: 1px solid var(--c-line); background: none; text-align: left; font: inherit; color: inherit; list-style: none; }
.list-row:last-child { border-bottom: 0; }
.list-row.is-control { cursor: pointer; }
.list-row.is-control:hover { background: var(--c-fill); }
.list-row.is-control:focus-visible { outline: var(--focus); outline-offset: -3px; }
.list-row.is-unread { background: #f3faf5; }
.list-row-icon { flex: none; display: grid; place-items: center; }
.list-row-body { flex: 1; min-width: 0; display: grid; gap: 1px; }
.list-row-body > b { font-size: 15px; font-weight: 650; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row.is-unread .list-row-body > b { font-weight: 700; }
.list-row-body > small { font-size: 13px; line-height: 1.4; color: var(--c-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row-end { flex: none; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
</style>
