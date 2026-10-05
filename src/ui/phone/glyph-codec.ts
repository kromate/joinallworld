/** Repeated SVG fragments in the JSON catalogue; byte codes 128 onward are reserved for these. */
export const GLYPH_TOKENS: readonly string[] = [
  "fill=\\\"currentColor\\\" fill-opacity=\\\".3\\\"",
  "fill=\\\"currentColor\\\" stroke=\\\"none\\\"",
  "stroke-width=\\\"2.7\\\"",
  "<path d=\\\"",
  "<circle cx=\\\"",
  "<rect x=\\\"",
  "\\\" cy=\\\"",
  "\\\" r=\\\"",
  "\\\" y=\\\"",
  "\\\" width=\\\"",
  "\\\" height=\\\"",
  "\\\" rx=\\\"",
  "/>",
  " 0 0 1 ",
  " 0 0 0 ",
  "M12 "
];

/** Decode the generated, fixed 12-bit LZW text. Each call has its own bounded dictionary. */
export function unpackGlyphText(data: string, count: number): string {
  if (!Number.isInteger(count) || count < 0) throw new Error('Invalid glyph code count');
  if (!count) return '';
  const bytes = atob(data), words = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
  let offset = 0, bits = 0, buffer = 0;
  const read = (): number => {
    while (bits < 12) {
      if (offset >= bytes.length) throw new Error('Truncated glyph data');
      buffer = (buffer << 8) | bytes.charCodeAt(offset++);
      bits += 8;
    }
    bits -= 12;
    return (buffer >> bits) & 4095;
  };
  const first = words[read()];
  if (first === undefined) throw new Error('Invalid first glyph code');
  let previous: string = first, text = first;
  for (let i = 1; i < count; i++) {
    const code = read(), word: string | undefined = words[code] ?? (code === words.length ? previous + previous.charAt(0) : undefined);
    if (word === undefined) throw new Error('Invalid glyph dictionary code');
    text += word;
    if (words.length < 4096) words.push(previous + word.charAt(0));
    previous = word;
  }
  return text.replace(/[\x80-\xff]/g, char => {
    const token = GLYPH_TOKENS[char.charCodeAt(0) - 128];
    if (token === undefined) throw new Error('Invalid glyph fragment');
    return token;
  });
}
