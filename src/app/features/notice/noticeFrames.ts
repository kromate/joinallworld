// Hands a notice or an announcement frame to its store. Fetched with the first of either, so the first download holds only NoticeHost.vue.
export async function receive(frame: { type: string }): Promise<void> {
  if (frame.type === 'announce') (await import('../announce/announceStore.ts')).receive(frame)
  else (await import('./noticeStore.ts')).receiveNotice(frame)
}
