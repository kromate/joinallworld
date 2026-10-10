/** TEST SUPPORT for showcase shops, shared by the Node and Worker tests: a hand-built JPEG of a given size and a valid shop body. Nothing in the running game imports this file. */

/** A still 8 x 8 JPEG of about `size` bytes that the server's picture parser accepts; with `exif` it carries an EXIF segment the server must drop. */
export function jpeg(size: number, { exif = false }: { exif?: boolean } = {}): Uint8Array {
  const parts: number[][] = [
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00],
    ...(exif ? [[0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53, 0x21, 0x21, 0x21, 0x21, 0x21]] : []),
    [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00],
    [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00],
    new Array<number>(Math.max(1, size)).fill(0x01),
    [0xff, 0xd9],
  ];
  return Uint8Array.from(parts.flat());
}
export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const WEEK = [{ open: '09:00', close: '18:00' }, { open: '09:00', close: '18:00' }, { open: '09:00', close: '18:00' }, { open: '09:00', close: '18:00' }, { open: '09:00', close: '18:00' }, { open: '10:00', close: '14:00' }, null];
/** A valid shop body for the Lagos market; `over` replaces fields. */
export const shopBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  city: 'lagos', venue: 'market', name: 'Ada Braids', category: 'salon', template: 'classic', colours: ['#aa3300', '#ffeecc'], sign: 'Braids by Ada', logo: 'scissors',
  about: 'Neat braids and natural hair care since 2019. Come to the market and ask for stall Ada.',
  services: [{ label: 'Knotless braids', priceNaira: 25000, note: 'About four hours' }, { label: 'Wash and set', priceNaira: 6000, note: '' }], hours: WEEK,
  chat: { url: 'https://wa.me/2348012345678' }, pay: { url: 'https://paystack.com/pay/adabraids' }, ...over,
});
