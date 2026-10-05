// What the landing screen says, and how long it waits, when the server could not let a new player in: every place taken,
// or too many new players from one network address. Apart from quickStartModel.ts on purpose: the page's state reads these
// when Play is refused, and must not bring the character presets and the look rules into the first download with them.
/**
 * EVERY PLACE IS TAKEN (the server answered Play with 503 device_capacity). The screen says so, keeps the name and the
 * character, and sends the start again by itself: after about 10, 20, 40 seconds, then every minute — each wait spread
 * a little, so a crowd that was turned away together does not come back together.
 */
export const worldFullWait = (tries: number, random: () => number = Math.random): number => Math.round(Math.min(60, 10 * 2 ** Math.max(0, Math.min(tries, 6))) * (0.8 + 0.4 * random()))
export const worldFullText = (seconds: number): string => `The world is full right now: every place is taken. Nothing is lost — your name and character are kept on this device. Trying again in about ${seconds} seconds; tap Play now to try at once.`
/**
 * TOO MANY NEW PLAYERS FROM ONE NETWORK ADDRESS in the last hour (the server answered Play with 429 and how long to wait).
 * That address may be a whole campus or a mobile network, so the visitor is told plainly that it is not about them, how
 * long to wait, and that nothing is lost. The start is sent again by itself when the wait is over.
 */
export const networkLimitWait = (retryAfter: number | null | undefined): number => Math.min(3600, Math.max(30, Math.ceil(retryAfter ?? 300)))
export function networkLimitText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  return `Too many new players have started from your network in the last hour — a shared Wi-Fi or mobile network counts as one. Nothing is lost: your name and character are kept on this device. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}; we will also try for you then. Mobile data or another network works straight away.`
}
