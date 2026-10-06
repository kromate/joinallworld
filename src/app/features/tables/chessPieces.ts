// The chess pieces, drawn here as small static SVG markup (viewBox 0 0 100 100). Each piece is a
// silhouette plus a few detail lines; the colours are set per side. The strings are fixed text in
// this file, never built from anything a player types, so they are safe to put in a v-html.
export type PieceKind = 'P' | 'R' | 'N' | 'B' | 'Q' | 'K'
export type PieceSide = 'w' | 'b'

interface PieceArt {
  /** The filled silhouette (path data), drawn with the side's fill and outline. */
  body: string[]
  /** Round parts (cx, cy, r) that belong to the silhouette. */
  dots: [number, number, number][]
  /** Detail strokes (path data) drawn on top in the side's detail colour. */
  lines: string[]
}

const ART: Record<PieceKind, PieceArt> = {
  P: {
    body: ['M36 80 C36 63 44 57 46 47 L54 47 C56 57 64 63 64 80 Z', 'M28 80 H72 V87 Q72 90 69 90 H31 Q28 90 28 87 Z'],
    dots: [[50, 31, 12]],
    lines: ['M38 71 H62'],
  },
  R: {
    body: ['M30 80 H70 V74 H66 L64 46 H70 V26 H61 V34 H55 V26 H45 V34 H39 V26 H30 V46 H36 L34 74 H30 Z', 'M26 80 H74 V87 Q74 90 71 90 H29 Q26 90 26 87 Z'],
    dots: [],
    lines: ['M36 46 H64', 'M35 66 H65'],
  },
  N: {
    body: [
      'M30 80 C30 66 34 62 40 54 C44 49 34 52 30 56 C24 60 21 56 22 52 C24 44 34 34 44 28 L46 18 L53 25 L58 17 L60 27 C74 36 76 54 72 80 Z',
      'M26 80 H76 V87 Q76 90 73 90 H29 Q26 90 26 87 Z',
    ],
    dots: [],
    lines: ['M60 32 C67 44 67 58 64 72', 'M27 55 L33 54'],
  },
  B: {
    body: [
      'M38 80 C36 70 38 62 43 56 C34 50 34 38 44 30 C47 27 49 25 50 22 C51 25 53 27 56 30 C66 38 66 50 57 56 C62 62 64 70 62 80 Z',
      'M28 80 H72 V87 Q72 90 69 90 H31 Q28 90 28 87 Z',
    ],
    dots: [[50, 16, 6]],
    lines: ['M43 38 L56 50', 'M40 72 H60'],
  },
  Q: {
    body: [
      'M31 78 L22 38 L34 56 L36 28 L43 54 L50 24 L57 54 L64 28 L66 56 L78 38 L69 78 Z',
      'M26 78 H74 V87 Q74 90 71 90 H29 Q26 90 26 87 Z',
    ],
    dots: [[22, 34, 5], [36, 24, 5], [50, 20, 5], [64, 24, 5], [78, 34, 5]],
    lines: ['M33 68 H67'],
  },
  K: {
    body: [
      'M47 6 H53 V12 H59 V18 H53 V28 H47 V18 H41 V12 H47 Z',
      'M31 80 C28 66 26 46 38 38 C42 35 44 33 44 28 H56 C56 33 58 35 62 38 C74 46 72 66 69 80 Z',
      'M26 80 H74 V87 Q74 90 71 90 H29 Q26 90 26 87 Z',
    ],
    dots: [],
    lines: ['M34 68 H66', 'M40 46 C46 50 54 50 60 46'],
  },
}

const LOOK: Record<PieceSide, { fill: string; stroke: string; detail: string }> = {
  w: { fill: '#fbf1d6', stroke: '#2d2a26', detail: '#2d2a26' },
  b: { fill: '#2c2b31', stroke: '#14131a', detail: '#e4dfd0' },
}

const build = (kind: PieceKind, side: PieceSide): string => {
  const art = ART[kind], look = LOOK[side]
  const shapes = [
    ...art.body.map((d) => `<path d="${d}"/>`),
    ...art.dots.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`),
  ].join('')
  const lines = art.lines.map((d) => `<path d="${d}"/>`).join('')
  return `<svg viewBox="0 0 100 100" focusable="false" aria-hidden="true"><g fill="${look.fill}" stroke="${look.stroke}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">${shapes}</g><g fill="none" stroke="${look.detail}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".85">${lines}</g></svg>`
}

const KINDS: readonly PieceKind[] = ['P', 'R', 'N', 'B', 'Q', 'K']
/** The markup of every piece by its code ('wP', 'bK' …). */
export const PIECE_SVG: Readonly<Record<string, string>> = Object.fromEntries(
  (['w', 'b'] as const).flatMap((side) => KINDS.map((kind) => [`${side}${kind}`, build(kind, side)] as const)),
)

/** The markup for a piece code, or an empty string for anything else. */
export const pieceSvg = (code: string | null): string => (code ? PIECE_SVG[code] ?? '' : '')
