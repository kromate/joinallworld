/** Is this timed action taking the player out of the current venue? */
export const isTrip = (active: { kind: string } | null | undefined): boolean => active?.kind === 'travel' || active?.kind === 'commute' || active?.kind === 'homeward'
