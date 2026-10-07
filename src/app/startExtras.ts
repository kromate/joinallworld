// What the page starts only for some visits, behind one import so the first download carries one call for them instead of one each:
// `?diagnostics` (the scene's frame counter, ./diagnostics.ts) and a short address (/games, /abuja, …: ./features/paths/arrive.ts, the
// landing starts it for an address kept earlier in this tab) and `?models=moments` (./moments.ts, the venue card's local moment lines).
export function startExtras(diagnostics: boolean): void {
  if (diagnostics) void import('./diagnostics.ts').then(({ showDiagnostics }) => { showDiagnostics() })
  if (new URLSearchParams(location.search).has('models')) void import('../models/integration/flags.ts').then(({ modelFlags }) => { if (modelFlags().moments) void import('./moments.ts').then(({ startMoments }) => { startMoments() }) })
  if (location.pathname !== '/') void import('./features/paths/arrive.ts').then(({ startPaths }) => { startPaths() })
}
