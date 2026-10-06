// askCompanion(context, message): the one seam between the chat and whatever answers it.
//   - the deterministic brain (answers.ts) is the default, needs no network, cannot invent anything, and is the source of ACTIONS;
//   - a hosted language model (POST /api/companion/ask, off unless the server has it switched on) is asked only for free-text messages the
//     local matcher is not sure about, or that are conversational. Its reply carries text and suggested ids; every id is checked again here
//     (suggest.ts) and turned into the same buttons the local brain uses. When it is off, slow or refuses, the local answer is used.
import { answerFor } from './answers.ts'
import type { IntentId } from './intents.ts'
import { suggestToAction } from './suggest.ts'
import type { AskInput, AskResult, CompanionAction, CompanionReply } from './types.ts'

export type Via = 'local' | 'primary' | 'fallback'
export interface Answer extends CompanionReply { via: Via; intent: IntentId }
export interface Hosted { text: string | null; suggest: string[]; via: string; topic?: string }
/** Calls the server route; resolves null when the feature is off or it fails. */
export type HostedAsk = (message: string, history: { role: 'user' | 'assistant'; text: string }[]) => Promise<Hosted | null>

/** The seam a plugged-in provider fulfils. */
export interface CompanionProvider { ask(input: AskInput): Promise<AskResult | null> }
export const localProvider: CompanionProvider = {
  async ask({ context, message, memory }) {
    const reply = answerFor(message, context, memory)
    return { text: reply.text, actions: reply.actions, topic: reply.topic, ...(reply.mood ? { mood: reply.mood } : {}) }
  },
}

/** Which questions are worth the model: ones the local matcher could not place, and ones that are conversational. */
export const wantsModel = (intent: IntentId, confident: boolean): boolean => intent === 'unknown' || intent === 'encourage' || !confident && intent !== 'greet' && intent !== 'thanks' && intent !== 'bye' && intent !== 'safety'

export async function askCompanion(input: AskInput, hosted: HostedAsk | null, history: { role: 'user' | 'assistant'; text: string }[] = []): Promise<Answer> {
  const local = answerFor(input.message, input.context, input.memory)
  const base: Answer = { ...local, via: 'local' }
  if (!hosted || !wantsModel(local.intent, local.confident) || local.intent === 'safety') return base
  try {
    const answer = await hosted(input.message, history)
    if (!answer || !answer.text || (answer.via !== 'primary' && answer.via !== 'fallback')) return base
    const suggested = answer.suggest.map((id) => suggestToAction(id, input.context)).filter((action): action is CompanionAction => action !== null)
    // A model that has nothing to suggest on a question the brain could not place keeps the brain's honest exits (topics, ask a person, report).
    const actions = suggested.length ? suggested : local.intent === 'unknown' ? local.actions : []
    return { topic: answer.topic ?? 'ai', text: answer.text, actions, via: answer.via, intent: local.intent, ...(local.mood ? { mood: local.mood } : {}) }
  } catch { return base }
}
