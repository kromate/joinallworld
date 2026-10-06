// What the page starts only for some visits, behind one import so the first download carries one call for them instead of one each:
// `?diagnostics` (the scene's frame counter, ./diagnostics.ts) and a short address (/games, /abuja, …: ./features/paths/arrive.ts, the
// landing starts it for an address kept earlier in this tab).
export function startExtras(diagnostics: boolean): void {
  if (diagnostics) void import('./diagnostics.ts').then(({ showDiagnostics }) => { showDiagnostics() })
  if (location.pathname !== '/') void import('./features/paths/arrive.ts').then(({ startPaths }) => { startPaths() })
}
