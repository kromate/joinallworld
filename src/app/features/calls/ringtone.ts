// A soft ring for an incoming call. It plays only if the player has already used the page (the browser
// refuses sound before that, and a surprise sound on a page nobody has touched would be rude): otherwise
// the banner is the only signal. It stops the moment the call is answered, declined, missed or cancelled.
let context: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | null = null

function beep(audio: AudioContext): void {
  const oscillator = audio.createOscillator(), gain = audio.createGain()
  oscillator.type = 'sine'; oscillator.frequency.value = 440
  gain.gain.setValueAtTime(0.0001, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.06, audio.currentTime + 0.05)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5)
  oscillator.connect(gain); gain.connect(audio.destination)
  oscillator.start(); oscillator.stop(audio.currentTime + 0.55)
}
export const canRing = (): boolean => typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true && typeof AudioContext !== 'undefined'

export function startRinging(): void {
  if (timer !== null || !canRing()) return
  try {
    context ??= new AudioContext()
    const audio = context
    void audio.resume().then(() => { if (timer !== null) beep(audio) }).catch(() => {})
    timer = setInterval(() => { if (audio.state === 'running') beep(audio) }, 2000)
  } catch { /* visual only */ }
}
export function stopRinging(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
  const audio = context
  context = null
  void audio?.close().catch(() => {})
}
