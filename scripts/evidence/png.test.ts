import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, type Image } from './png.ts';

/** A picture with a different value in every pixel and channel, so a wrong filter shows up. */
function pattern(width: number, height: number): Image {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    data[at] = (x * 37 + y * 11) & 255; data[at + 1] = (x * x + y * 5) & 255; data[at + 2] = (x * 3 ^ y * 7) & 255; data[at + 3] = 255 - ((x + y) & 63);
  }
  return { width, height, data };
}

test('a generated picture comes back exactly through every row filter', () => {
  const image = pattern(23, 17);
  for (const filter of [0, 1, 2, 3, 4]) {
    const back = decodePng(encodePng(image, filter));
    assert.equal(back.width, 23, `filter ${filter}`);
    assert.equal(back.height, 17, `filter ${filter}`);
    assert.deepEqual(Array.from(back.data), Array.from(image.data), `filter ${filter}`);
  }
});

/** Build a PNG by hand for a colour type the writer does not make. */
function handmade(colour: number, rows: number[][], width: number, extra: Buffer[] = []): Buffer {
  const crc = (buffer: Buffer): number => { let c = 0xffffffff; for (const byte of buffer) { c ^= byte; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (kind: string, body: Buffer): Buffer => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1'); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0); return Buffer.concat([head, body, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(rows.length, 4); header[8] = 8; header[9] = colour;
  const raw = Buffer.concat(rows.map((row) => Buffer.from([0, ...row])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), ...extra.map((body, i) => chunk(i === 0 ? 'PLTE' : 'tRNS', body)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('RGB, grey and palette pictures are read as RGBA', () => {
  const rgb = decodePng(handmade(2, [[10, 20, 30, 40, 50, 60]], 2));
  assert.deepEqual(Array.from(rgb.data), [10, 20, 30, 255, 40, 50, 60, 255]);
  const grey = decodePng(handmade(0, [[7, 9]], 2));
  assert.deepEqual(Array.from(grey.data), [7, 7, 7, 255, 9, 9, 9, 255]);
  const indexed = decodePng(handmade(3, [[1, 0]], 2, [Buffer.from([255, 0, 0, 0, 255, 0]), Buffer.from([128, 255])]));
  assert.deepEqual(Array.from(indexed.data), [0, 255, 0, 255, 255, 0, 0, 128]);
});

test('what is not a readable PNG is refused with a reason', () => {
  assert.throws(() => decodePng(Buffer.from('hello world, not a picture')), /Not a PNG/);
  const interlaced = Buffer.from(encodePng(pattern(2, 2)));
  interlaced[16 + 12] = 1; // the interlace byte of the header (8 signature + 8 chunk head + 12)
  assert.throws(() => decodePng(interlaced), /Interlaced/);
});
