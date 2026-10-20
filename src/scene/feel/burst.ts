/**
 * OWNER: scenes
 * The confetti of a big moment: pieces flung out from a point by CSS only (.life-burst in src/ui/shell.css), removed when the last
 * piece has faded. The piece count comes from the tier. (A 3D burst can replace this later; nothing depends on it.)
 */

const COLOURS = ['#f2b01e', '#2fa866', '#2a5bd7', '#e2572b', '#7a3fb0', '#ffffff']

/** `pieces` of confetti into `parent` (the page body by default); `at` is a viewport point in px, else under the top bar. Nothing under reduced motion. */
export function confetti(parent: Element | null | undefined, pieces: number, at?: { x: number; y: number }): void {
  const doc = globalThis.document
  if (!doc?.createElement || !parent || pieces <= 0 || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  doc.querySelector('.life-burst')?.remove()
  const box = doc.createElement('div')
  box.className = 'life-burst'; box.setAttribute('aria-hidden', 'true')
  if (at) { box.style.left = `${Math.round(at.x)}px`; box.style.top = `${Math.round(at.y)}px` }
  for (let i = 0; i < pieces; i += 1) {
    const piece = doc.createElement('i'), angle = (i / pieces) * Math.PI * 2, far = 70 + ((i * 37) % 60)
    piece.style.setProperty('--c', COLOURS[i % COLOURS.length]!)
    piece.style.setProperty('--x', `${Math.round(Math.cos(angle) * far)}px`)
    piece.style.setProperty('--y', `${Math.round(Math.sin(angle) * far * 0.7 + 50)}px`)
    piece.style.setProperty('--r', `${(i % 2 ? 1 : -1) * (120 + i * 9)}deg`)
    piece.style.animationDelay = `${(i % 5) * 18}ms`
    box.append(piece)
  }
  box.lastChild!.addEventListener('animationend', () => box.remove(), { once: true })
  parent.append(box)
}
