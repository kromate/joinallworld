import { createNoticeMarks } from './messagesModel.ts'

function deviceStorage(): Storage | null { try { return globalThis.localStorage ?? null } catch { return null } }
export const noticeMarks = createNoticeMarks(deviceStorage())
