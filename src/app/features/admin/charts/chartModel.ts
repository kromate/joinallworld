// The arithmetic of the admin charts, without a screen: a round upper limit for an axis, where a value sits, the points of a line with gaps
// where a day was not measured, and the sentence a screen reader gets in place of the picture. Pure, so it is tested without a browser.

/** A round upper limit at or above `max` (1, 2, 5 times a power of ten), at least 1. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(max)), unit = max / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}
export interface Box { width: number; height: number; left: number; right: number; top: number; bottom: number }
/** The x of the i-th of n points and the y of a value inside the plot area. */
export const xAt = (box: Box, index: number, count: number): number => box.left + (count <= 1 ? (box.width - box.left - box.right) / 2 : (index / (count - 1)) * (box.width - box.left - box.right))
export const yAt = (box: Box, value: number, top: number): number => box.height - box.bottom - (value / top) * (box.height - box.top - box.bottom)
/** SVG path data for a line over `values`, lifted at a gap (null): each run of measured days is its own segment. */
export function linePath(box: Box, values: readonly (number | null)[], top: number): string {
  let path = '', open = false
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { open = false; return }
    path += `${open ? 'L' : 'M'}${xAt(box, index, values.length).toFixed(1)} ${yAt(box, value, top).toFixed(1)} `
    open = true
  })
  return path.trim()
}
/** The change from `before` to `now`: a signed number and a word, or null when there is nothing to compare with. */
export function change(now: number, before: number | null): { delta: number; percent: number | null; word: string } | null {
  if (before === null || !Number.isFinite(before)) return null
  const delta = now - before
  return { delta, percent: before === 0 ? null : Math.round((delta / before) * 100), word: delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('en-GB')}${before === 0 ? '' : ` (${delta > 0 ? '+' : '−'}${Math.abs(Math.round((delta / before) * 100))}%)`} vs yesterday` }
}
/** What a chart says to a screen reader: its name, the range and where the last value stands. */
export function describe(name: string, labels: readonly string[], values: readonly (number | null)[]): string {
  const known = values.map((value, index) => ({ value, label: labels[index] ?? '' })).filter((item): item is { value: number; label: string } => item.value !== null)
  if (!known.length) return `${name}: no data yet.`
  const high = known.reduce((a, b) => (b.value > a.value ? b : a)), low = known.reduce((a, b) => (b.value < a.value ? b : a)), last = known[known.length - 1]!
  return `${name}, ${known.length} days from ${known[0]!.label} to ${last.label}. Latest ${last.value.toLocaleString('en-GB')}, highest ${high.value.toLocaleString('en-GB')} on ${high.label}, lowest ${low.value.toLocaleString('en-GB')} on ${low.label}.`
}
