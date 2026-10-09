import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'
import type { Landing, LandingDeps, LandingRefs, ShownBanner } from './landingStore.ts'
import type { LandingState } from '../growth/growthTypes.ts'

export interface LandingLoaderDeps extends LandingDeps {
  /** The identity and city the deferred continuation belongs to. */
  identity(): string | null
  /** Called for a failed feature import; pending link state remains untouched for retry. */
  importFailed(error: unknown): void
  /** Production supplies a dynamic import; tests can hold or reject it deterministically. */
  load(): Promise<{ createLanding(deps: LandingDeps, refs?: LandingRefs): Landing }>
}

/**
 * Stable shell-facing refs with a conditional feature boundary. Merely entering the connected
 * game does not fetch the link landing code. A link or an owed quick-start welcome loads it on
 * demand, and the imported store receives these same refs rather than replacing shell bindings.
 */
export interface LandingLoader {
  banner: ShallowRef<ShownBanner | null>
  landed: ShallowRef<LandingState | null>
  land(): Promise<void>
  knock(): void
  dismiss(): void
  owe(): void
  /** Invalidates work started before a synchronous identity or city transition. */
  invalidate(): void
  captureScope(): LandingScope
  isScopeCurrent(scope: LandingScope): boolean
}

export interface LandingScope { identity: string | null; city: string; generation: number }

export function createLandingLoader(deps: LandingLoaderDeps): LandingLoader {
  const banner = shallowRef<ShownBanner | null>(null)
  const landed = shallowRef<LandingState | null>(null)
  const refs: LandingRefs = { banner, landed }
  let implementation: Landing | null = null
  let loading: Promise<Landing | null> | null = null
  let owedWelcome = false
  let owedIdentity: string | null = null
  let generation = 0

  const hasOwedFor = (identity: string | null): boolean => owedWelcome && owedIdentity === identity
  const hasPendingWork = (): boolean => Boolean(deps.joinTarget() || deps.pendingRef() || deps.pendingTable() || deps.pendingGo() || hasOwedFor(deps.identity()))

  async function load(): Promise<Landing | null> {
    if (implementation) return implementation
    if (loading) return loading
    loading = deps.load().then(({ createLanding }) => {
      const created = createLanding(deps, refs)
      if (hasOwedFor(deps.identity())) created.owe()
      implementation = created
      return created
    }).catch((error: unknown) => {
      try { deps.importFailed(error) } catch { /* Failure reporting must not consume or replace the pending link. */ }
      return null
    }).finally(() => { loading = null })
    return loading
  }

  function captureScope(): LandingScope { return { identity: deps.identity(), city: deps.cityId(), generation } }

  function isScopeCurrent(scope: LandingScope): boolean {
    return scope.identity !== null && scope.identity === deps.identity() && scope.city === deps.cityId() && scope.generation === generation
  }

  async function land(): Promise<void> {
    if (!deps.online() || !hasPendingWork()) return
    const scope = captureScope()
    if (!scope.identity) return
    const target = await load()
    if (!target) return
    // Dynamic imports can finish after sign-out, character switch, travel, or a reconnect. Do not
    // let the old continuation clean the URL, consume a token, make a request, or open a panel.
    if (!deps.online() || !isScopeCurrent(scope) || !hasPendingWork()) return
    target.owe(hasOwedFor(scope.identity))
    await target.land(() => deps.online() && isScopeCurrent(scope))
    if (isScopeCurrent(scope) && owedIdentity === scope.identity) owedWelcome = target.hasOwedWelcome()
  }

  function owe(): void {
    owedWelcome = true
    owedIdentity = deps.identity()
    implementation?.owe()
    // Unlike a warm-up this is an explicit quick-start outcome. Load the feature now so the
    // existing immediately-following land() call can keep its original ordering; never land here.
    if (!implementation) void load()
  }

  function invalidate(): void {
    generation++
    implementation?.dismiss()
    landed.value = null
  }

  return {
    banner,
    landed,
    land,
    owe,
    invalidate,
    captureScope,
    isScopeCurrent,
    knock: () => implementation?.knock(),
    dismiss: () => implementation?.dismiss(),
  }
}
