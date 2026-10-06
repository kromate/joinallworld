// Getting a picture ready to send: pure rules (which files are taken, how big, how hard to compress) and the browser steps that
// decode it and draw it again on a canvas, which is what removes every piece of metadata (camera, time, GPS) before anything leaves
// the device. The server checks the bytes again and writes them out without metadata (server/social/images.ts).
export const PICTURE = Object.freeze({ side: 1280, target: 180000, cap: 250000, qualities: [0.82, 0.7, 0.58, 0.46, 0.36] as readonly number[], sides: [1280, 1024, 800, 640] as readonly number[] })

/** Why this file cannot be sent, or null. Only still photos: animated, vector and unknown types are refused. */
export function refusalFor(type: string): string | null {
  if (type === 'image/gif') return 'Animated pictures cannot be sent. Choose a photo.'
  if (type === 'image/svg+xml' || type.startsWith('video/')) return 'Only photos can be sent.'
  if (type && !type.startsWith('image/')) return 'Only photos can be sent.'
  return null
}
/** The size to draw a picture at: the long edge no more than `max`, the shape kept, never made larger. */
export function fitWithin(width: number, height: number, max: number = PICTURE.side): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
/** The sentence when no setting makes it small enough. */
export const TOO_BIG = 'That picture is too big to send even after shrinking it. Try another one.'
export interface Ready { blob: Blob; type: 'image/webp' | 'image/jpeg'; width: number; height: number; url: string }

/** Decode, shrink and re-encode. WebP where the browser can make it, JPEG otherwise; aims at PICTURE.target and refuses above PICTURE.cap. */
export async function preparePicture(file: File): Promise<{ ok: true; ready: Ready } | { ok: false; reason: string }> {
  const refused = refusalFor(file.type)
  if (refused) return { ok: false, reason: refused }
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { return { ok: false, reason: 'That file could not be read as a photo. Try another one.' } }
  try {
    for (const side of PICTURE.sides) {
      const size = fitWithin(bitmap.width, bitmap.height, side)
      const canvas = document.createElement('canvas')
      canvas.width = size.width; canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) return { ok: false, reason: 'This browser cannot prepare pictures.' }
      context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height) // a transparent photo is flattened: no hidden pixels
      context.drawImage(bitmap, 0, 0, size.width, size.height)
      for (const quality of PICTURE.qualities) {
        const asked: 'image/webp' | 'image/jpeg' = 'image/webp'
        let blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, asked, quality))
        // A browser that cannot make WebP answers with PNG: JPEG is used instead.
        if (!blob || blob.type !== asked) blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality))
        if (!blob) continue
        if (blob.size <= PICTURE.target || (quality === PICTURE.qualities.at(-1) && blob.size <= PICTURE.cap)) {
          return { ok: true, ready: { blob, type: blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg', width: size.width, height: size.height, url: URL.createObjectURL(blob) } }
        }
      }
    }
    return { ok: false, reason: TOO_BIG }
  } finally { bitmap.close() }
}
/** Standard base64 of a blob's bytes, in pieces (a large string is never built from one apply()). */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
/** What the upload sends: the picture and its caption, with the conversation or player it is for. */
export interface Upload { target: { to: string } | { conv: string }; clientId: string; ready: Ready; caption: string; replyTo?: number }
export async function uploadBody(upload: Upload): Promise<string> {
  return JSON.stringify({ ...upload.target, clientId: upload.clientId, type: upload.ready.type, data: await toBase64(upload.ready.blob), ...(upload.caption ? { body: upload.caption } : {}), ...(upload.replyTo ? { replyTo: upload.replyTo } : {}) })
}
/** The address a picture is shown from. Same origin, so the session cookie goes with it. */
export const pictureUrl = (id: string): string => `/api/social/images/${encodeURIComponent(id)}`
