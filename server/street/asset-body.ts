export async function streetAssetText(response: Response, limit: number): Promise<string | null> {
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return null
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break
      length += next.value.byteLength
      if (length > limit) throw Error('Street asset exceeds its byte limit')
      chunks.push(next.value)
    }
  } catch (error) { await reader.cancel(); throw error }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
