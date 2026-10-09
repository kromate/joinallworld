import type { PlayerRef } from '../../../types/protocol.ts'
import type { Conversation, Message, MessagePinsChangedFrame } from '../../../types/social.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const playerRef = (value: unknown): value is PlayerRef => record(value) && typeof value.id === 'string' && typeof value.name === 'string' && (value.founder === undefined || value.founder === true)
const optionalTrue = (value: unknown): boolean => value === undefined || value === true
const allowed = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value)

function messageFrame(value: unknown): value is Message {
  if (!record(value) || !Number.isSafeInteger(value.seq) || typeof value.id !== 'string' || typeof value.conv !== 'string' ||
    !(value.from === null || playerRef(value.from)) || typeof value.body !== 'string' || typeof value.at !== 'number' ||
    !optionalTrue(value.sys) || !optionalTrue(value.auto) || !optionalTrue(value.deleted) || !optionalTrue(value.forwarded) ||
    value.clientId !== undefined && typeof value.clientId !== 'string' || value.version !== undefined && !Number.isSafeInteger(value.version) ||
    value.editedAt !== undefined && typeof value.editedAt !== 'number') return false
  if (value.mentions !== undefined && (!Array.isArray(value.mentions) || value.mentions.length > 32 || value.mentions.some((mention) => !record(mention) || typeof mention.id !== 'string' || !Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end)))) return false
  if (value.replyTo !== undefined && (!record(value.replyTo) || !Number.isSafeInteger(value.replyTo.seq) || !(value.replyTo.from === null || playerRef(value.replyTo.from)) || typeof value.replyTo.text !== 'string')) return false
  if (value.gift !== undefined && (!record(value.gift) || typeof value.gift.amount !== 'number' || value.gift.repaid !== undefined && typeof value.gift.repaid !== 'number')) return false
  if (value.reactions !== undefined && (!Array.isArray(value.reactions) || value.reactions.length > 32 || value.reactions.some((reaction) => !record(reaction) || typeof reaction.emoji !== 'string' || !Number.isSafeInteger(reaction.count) || !optionalTrue(reaction.mine)))) return false
  if (value.image !== undefined && (!record(value.image) || typeof value.image.id !== 'string' || !Number.isSafeInteger(value.image.width) || !Number.isSafeInteger(value.image.height) || value.image.state !== undefined && !allowed(value.image.state, ['expired', 'hidden', 'reported', 'off']) || !optionalTrue(value.image.blur))) return false
  if (value.voice !== undefined && (!record(value.voice) || typeof value.voice.id !== 'string' || !Number.isSafeInteger(value.voice.durationMs) || value.voice.state !== undefined && !allowed(value.voice.state, ['expired', 'hidden', 'reported', 'off']))) return false
  return true
}

function conversationFrame(value: unknown): value is Conversation {
  if (!record(value) || typeof value.id !== 'string' || !allowed(value.kind, ['dm', 'group', 'house']) || typeof value.name !== 'string' ||
    !Array.isArray(value.members) || value.members.length > 64 || value.members.some((member) => !playerRef(member)) ||
    !(value.owner === null || typeof value.owner === 'string') || !(value.with === null || typeof value.with === 'string') || !Number.isSafeInteger(value.unread) ||
    !optionalTrue(value.muted) || !optionalTrue(value.pinned) || value.mentions !== undefined && !Number.isSafeInteger(value.mentions)) return false
  const last = value.last
  return last === null || record(last) && Number.isSafeInteger(last.seq) && (last.from === null || playerRef(last.from)) && typeof last.body === 'string' && typeof last.at === 'number'
}

export function isMessagePinsFrame(frame: unknown): frame is MessagePinsChangedFrame {
  if (!record(frame) || frame.type !== 'message-pins') return false
  const conversation = frame.conv, view = frame.pins
  if (!conversationFrame(conversation) || !record(view)) return false
  return typeof view.scope === 'string' && view.scope.length > 0 && view.scope.length <= 80 && Number.isSafeInteger(view.revision) && Number(view.revision) >= 0 &&
    typeof view.canManage === 'boolean' && Array.isArray(view.items) && view.items.length <= 3 &&
    view.items.every((entry: unknown) => record(entry) && messageFrame(entry.message) && entry.message.conv === conversation.id)
}
