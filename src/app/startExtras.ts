// What the page starts only for some visits, or only once the game is up, behind one import so the first download carries one call for them
// instead of one each. `startExtras`: `?diagnostics` (the scene's frame counter, ./diagnostics.ts) and a short address (/games, /abuja, …:
// ./features/paths/arrive.ts; the landing starts it for an address kept earlier in this tab). `startAfterReady`: for every player, once the
// scene is shown, the venue card's local moment lines (./moments.ts) and the kit of work dilemmas and place actions (src/game/dilemma-pack.ts,
// a chunk of its own: the page lists place actions once it is in).
// The regulars talking to each other (./chatter/start.ts, REALISM R12) start here too, in a chunk of their own.
export function startExtras(diagnostics: boolean): void {
  if (diagnostics) void import('./diagnostics.ts').then(({ showDiagnostics }) => { showDiagnostics() })
  if (location.pathname !== '/') void import('./features/paths/arrive.ts').then(({ startPaths }) => { startPaths() })
}

export function startAfterReady(): void {
  void import('./moments.ts').then(({ startMoments }) => { startMoments() }, () => undefined)
  void import('../game/dilemma-pack.ts').catch(() => undefined)
  void import('./chatter/start.ts').then(({ startChatter }) => { startChatter() }, () => undefined)
}
