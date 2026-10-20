// Every lazily loaded screen goes through lazyComponent(): a light "Loading…" after a short delay, two quiet
// automatic retries (1 s, then 3 s), and if the code still does not arrive a plain message with "Try again"
// (and "Reload page" when the failure looks like a chunk that a new deploy has removed). It never rejects,
// so a slow network cannot leave a blank box: the screen shows up on its own the moment the code lands.
import { defineAsyncComponent, h, reactive } from 'vue'
import type { AsyncComponentLoader, Component } from 'vue'
import { createLazyLoader } from '../../lazy-load.ts'
import { isChunkLoadError, noteChunkFailure } from './updateNotice.ts'

/** A load faster than this never shows a loading line, so quick loads do not flash. */
export const LAZY_SHOW_AFTER_MS = 200
/** After this long without the code the screen says so (it keeps trying and still appears if the code lands). */
export const LAZY_TIMEOUT_MS = 30000
export const LAZY_LOADING_TEXT = 'Loading…'
export const LAZY_FAILED_TEXT = 'Couldn’t load this. Check your connection.'

/** The loading logic without any rendering: one shared load per screen, whatever number of places show it. */
export function createLazyScreen<T>(load: () => Promise<T>) {
  const view = reactive({ failed: false, stale: false })
  let timer: ReturnType<typeof setTimeout> | undefined, settle: (value: T) => void, lastError: unknown = null
  const done = new Promise<T>((resolve) => { settle = resolve })
  const arm = (): void => { clearTimeout(timer); timer = setTimeout(() => { view.failed = true }, LAZY_TIMEOUT_MS) }
  const piece = createLazyLoader<T>(() => load().catch((error: unknown) => { lastError = error; throw error }), {
    delays: [1000, 3000], // the first retry after 1 s, the second after 3 s
    onState({ status }) {
      if (status === 'ready') { clearTimeout(timer); view.failed = false; settle(piece.value as T) }
      else if (status === 'failed') { view.failed = true; view.stale = isChunkLoadError(lastError); void noteChunkFailure() }
    },
  })
  return {
    view,
    loader(): Promise<T> { if (piece.state.status === 'idle') { arm(); void piece.load() } return done },
    retry(): void { view.failed = false; arm(); void piece.load() },
  }
}

const box = 'padding:16px;text-align:center'

/** Same as defineAsyncComponent(), with the loading line, the retries and the failure message described above. */
export const lazyComponent = <T extends Component>(load: AsyncComponentLoader<T>): T => make(load, false)
/** For a small inline piece (chip, banner, button): nothing is shown while it loads or if it fails, but it still retries. */
export const lazyQuiet = <T extends Component>(load: AsyncComponentLoader<T>): T => make(load, true)

function make<T extends Component>(load: AsyncComponentLoader<T>, quiet: boolean): T {
  const { view, loader, retry } = createLazyScreen<T>(load as () => Promise<T>)
  return defineAsyncComponent({
    loader: loader as AsyncComponentLoader<T>,
    suspensible: false, // inside a Suspense a failure would hang its fallback; this screen speaks for itself
    delay: LAZY_SHOW_AFTER_MS,
    ...(quiet ? {} : { loadingComponent: () => view.failed
      ? h('div', { role: 'alert', style: box }, [
        h('p', LAZY_FAILED_TEXT),
        h('button', { type: 'button', class: 'ui-button is-primary', onClick: retry }, 'Try again'),
        view.stale ? h('button', { type: 'button', class: 'ui-button', onClick: () => location.reload() }, 'Reload page') : null,
      ])
      : h('p', { role: 'status', style: box }, LAZY_LOADING_TEXT) }),
  })
}
