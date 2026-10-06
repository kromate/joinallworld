// How a wait and a closed door are worded wherever the odd job, the bench, the tap and the help card are offered: the card, the goal line, the
// wallet and the activity cards of the place itself all say "Again in 3 h 45 min" in the same words. Small and free of the rules engine.

/** A wait in words a person says: "under a minute", "12 min", "3 h 45 min" (rounded up to the minute). */
export function humanWait(seconds: number): string {
  if (!(seconds >= 60)) return 'under a minute'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

const clock = (hours: string | undefined, minutes: string | undefined, seconds?: string): number => Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)

/** The short line under a row that cannot be done now: "Closed · opens in 2 h 3 min", else the game's own sentence (a wait already comes as "Again in 3 h 45 min."). */
export function shortReason(reason: string): string {
  const opens = /Opens in (?:(\d+)h )?(?:(\d+)m)?/.exec(reason)
  if (opens && /closed/i.test(reason)) return `Closed · opens in ${humanWait(clock(opens[1], opens[2]))}`
  return reason
}
