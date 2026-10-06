// THE ADDRESS BAR, without a window: while a view an address named is open the address stays (so it can be copied and shared);
// when the player leaves it the address goes back to `/`, with no reload (History API).
//
//   A view the player opened from inside the game PUSHES an entry, so Back closes it instead of leaving the site.
//   A view the page was loaded on (or Back/Forward arrived at) REPLACES the entry; leaving it replaces the address with `/`.
//
// `Address` is the window's location and history, so a test can drive it with a fake.
export interface Address {
  path(): string
  search(): string
  hash(): string
  /** The current entry is one this module pushed (its state says so). */
  pushed(): boolean
  push(path: string): void
  replace(url: string, state: 'shown' | null): void
  back(): void
}

export function browserAddress(): Address {
  const where = (): Location => globalThis.location
  return {
    path: () => where().pathname,
    search: () => where().search,
    hash: () => where().hash,
    pushed: () => (globalThis.history?.state as { aw?: unknown } | null)?.aw === 'pushed',
    push: (path) => { globalThis.history.pushState({ aw: 'pushed' }, '', path) },
    replace: (url, state) => { globalThis.history.replaceState(state ? { aw: state } : null, '', url) },
    back: () => { globalThis.history.back() },
  }
}

interface View { path: string; open(): boolean; pushed: boolean; seen: boolean }

export interface Views {
  /** Show `path` (push or replace the entry) and hold it as the open view; `open` says whether the view is still open. */
  hold(path: string, open: () => boolean, how: 'push' | 'replace'): void
  /** Show a path without holding a view (the address of a landing). */
  show(path: string, how: 'push' | 'replace'): boolean
  /** The held view's open state changed: leaving it (it was open, now it is not) puts the address back to `/`. */
  watch(open: boolean | null): void
  /** The view is over: the address goes back to `/`. */
  leave(): void
  /** Take the held view away without touching the address (Back or Forward already moved it). Returns whether there was one. */
  drop(): boolean
  held(): string | null
  /** Whether the held view is open now (null when there is none): what a watcher reads. */
  probe(): boolean | null
}

/** `later` runs a function after a delay (a view that never opened does not keep its address). */
export function createViews(address: Address, later: (run: () => void, ms: number) => unknown = (run, ms) => globalThis.setTimeout(run, ms)): Views {
  let view: View | null = null
  const tidy = (): void => { try { address.replace('/', null) } catch { /* the address stays */ } }

  function show(path: string, how: 'push' | 'replace'): boolean {
    try {
      if (address.path() === path) return address.pushed()
      if (how === 'push') address.push(path)
      else address.replace(`${path}${address.search()}${address.hash()}`, 'shown')
      return how === 'push'
    } catch { return false /* the address stays as it was */ }
  }
  function leave(): void {
    const gone = view
    view = null
    if (!gone || address.path() !== gone.path) return
    try { if (gone.pushed && address.pushed()) address.back(); else tidy() } catch { /* the address stays */ }
  }
  return {
    show,
    leave,
    hold(path, open, how) {
      const next: View = { path, open, pushed: show(path, how), seen: false }
      view = next
      later(() => { if (view === next && !next.seen && !open()) leave() }, 3000)
    },
    watch(open) {
      if (!view || open === null) return
      if (open) view.seen = true
      else if (view.seen) leave()
    },
    drop() { const had = view !== null; view = null; return had },
    held: () => view?.path ?? null,
    probe: () => (view ? view.open() : null),
  }
}
