// Deep links inside a panel: a panel opened with `{ section: 'x' }` scrolls to the element marked `data-section="x"` and lets it glow for a
// moment, so a button that says "Open Jobs" lands on the list of jobs and not on the top of the app. The element may be drawn after a
// request answers, so it is looked for for a few seconds. Nothing here is in the first download: only panels (lazy chunks) import it.
import { nextTick, watch } from 'vue'

const NAME = /^[a-z][a-z0-9:-]{0,40}$/

/** Bring the element `find` returns into view and make it glow for a moment. It may not be drawn yet, so it is looked for for about three seconds. */
export function pointAt(find: () => HTMLElement | null | undefined, tries = 20): void {
  const element = find()
  if (!element) { if (tries > 0) setTimeout(() => pointAt(find, tries - 1), 150); return }
  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  element.animate?.([{ boxShadow: '0 0 0 4px #e8a643' }, { boxShadow: '0 0 0 4px rgba(232,166,67,0)' }], { duration: 2600, easing: 'ease-out' })
}

/** The `section` a panel was opened with, or ''. */
export const sectionOf = (params: unknown): string => {
  const value = (params as { section?: unknown } | null | undefined)?.section
  return typeof value === 'string' && NAME.test(value) ? value : ''
}

/** In a panel: whenever it is opened with a `section`, point at it. */
export function useSection(params: () => unknown): void {
  watch(params, (now) => { const name = sectionOf(now); if (name) void nextTick(() => pointAt(() => globalThis.document?.querySelector<HTMLElement>(`[data-section="${name}"]`))) }, { immediate: true, flush: 'post' })
}
