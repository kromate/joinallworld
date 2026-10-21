// Every lazily loaded screen goes through lazyComponent(): a light "Loading…" after a short delay, two quiet
// automatic retries (1 s, then 3 s), and if the code still does not arrive a plain message with "Try again".
// A chunk that a new deploy has removed also asks the host whether the app was updated, which offers the
// Reload banner (updateNotice.ts). It never rejects, so a slow network cannot leave a blank box: the screen
// shows up on its own the moment the code lands. (Kept tiny on purpose: it is part of the first download.)
import { defineAsyncComponent, h, reactive } from 'vue'
import type { AsyncComponentLoader, Component } from 'vue'
import { noteChunkFailure } from './updateNotice.ts'

/** A load faster than this never shows a loading line, so quick loads do not flash. */
export const LAZY_SHOW_AFTER_MS = 200
/** After this long without the code the screen says so (it keeps trying and still appears if the code lands). */
export const LAZY_TIMEOUT_MS = 30000
export const LAZY_LOADING_TEXT = 'Loading…'
export const LAZY_FAILED_TEXT = 'Couldn’t load this. Check your connection.'

/** The loading logic without any rendering: one shared load per screen, whatever number of places show it. */
export function createLazyScreen<T>(load: () => Promise<T>) {
  const view = reactive({ failed: false })
  let settle!: (value: T) => void, timer: ReturnType<typeof setTimeout> | undefined, started = 0
  const done = new Promise<T>((resolve) => { settle = resolve })
  const give = (): void => { view.failed = true; void noteChunkFailure() }
  // One attempt, then retries after 1 s and 3 s.
  const go = (tries: number): unknown => load().then((loaded) => { clearTimeout(timer); view.failed = false; settle(loaded) }, () => tries < 2 ? setTimeout(go, tries ? 3000 : 1000, tries + 1) : give())
  const retry = (): void => { clearTimeout(timer); timer = setTimeout(give, LAZY_TIMEOUT_MS); view.failed = false; go(0) }
  return { view, retry, loader: (): Promise<T> => (started++ || retry(), done) }
}

/** Same as defineAsyncComponent(), with the loading line, the retries and the failure message described above. */
export function lazyComponent<T extends Component>(load: AsyncComponentLoader<T>): T {
  const { view, loader, retry } = createLazyScreen<T>(load as () => Promise<T>)
  return defineAsyncComponent({
    loader: loader as AsyncComponentLoader<T>,
    suspensible: false, // inside a Suspense a failure would hang its fallback; this screen speaks for itself
    delay: LAZY_SHOW_AFTER_MS,
    loadingComponent: () => h('p', { role: view.failed ? 'alert' : 'status', style: 'padding:16px;text-align:center' }, view.failed
      ? [`${LAZY_FAILED_TEXT} `, h('button', { type: 'button', class: 'ui-button is-primary', onClick: () => retry() }, 'Try again')]
      : LAZY_LOADING_TEXT),
  })
}
