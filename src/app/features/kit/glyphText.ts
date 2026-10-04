// Splits a text into plain runs and emoji that have a glyph. Pure, so it is tested without a browser.

/** One emoji (with its skin tone, variation selector and ZWJ tail), or a flag: the same pattern as src/ui/icon-map.ts. */
const EMOJI = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)/gu

export type GlyphPart = { text: string; emoji?: undefined } | { emoji: string; text?: undefined }

/** `drawable(emoji)` says whether the icon set has a glyph for it; one that has none stays text. */
export function glyphParts(text: string | null | undefined, drawable: (emoji: string) => boolean): GlyphPart[] {
  const source = String(text ?? '')
  const parts: GlyphPart[] = []
  let text_ = ''
  let last = 0
  for (const match of source.matchAll(EMOJI)) {
    if (!drawable(match[0])) continue
    text_ += source.slice(last, match.index)
    if (text_) parts.push({ text: text_ })
    text_ = ''
    parts.push({ emoji: match[0] })
    last = match.index + match[0].length
  }
  text_ += source.slice(last)
  if (text_) parts.push({ text: text_ })
  return parts
}
