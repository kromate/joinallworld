// The one way the game says "this person is a game character, not a real player". Every surface that shows a person
// (the People panel, the person card, Contacts, Family, venue chat, the name tags in the 3D scenes) takes its word and
// its spoken form from here, so the mark reads the same everywhere. Real players carry no mark: its absence means a
// real person. Pure (no Vue, no DOM at import), so the scene hosts and node --test reach it.

/** The word on the badge. It is what the game already used beside an NPC's role ("Neighbour · NPC"). */
export const NPC_WORD = 'NPC'
/** What the word means, for a title (a hover) and for a screen reader. */
export const NPC_MEANING = 'a game character, not a real player'
/** The spoken form of the badge. */
export const NPC_SPEECH = `${NPC_WORD}, ${NPC_MEANING}`
/** A control's accessible name for an NPC: "Tunde, NPC, a game character, not a real player". */
export const npcAria = (name: string): string => `${name}, ${NPC_SPEECH}`
/** A tooltip for an NPC's tag: "Tunde · NPC". */
export const npcTitle = (name: string): string => `${name} · ${NPC_WORD}`

/** The CSS class of the word inside a scene tag (the 3D scenes draw tags as DOM nodes, not Vue components). */
export const NPC_WORD_CLASS = 'npc-word'
/** Add the badge word to a scene tag node (textContent only). Hidden from a screen reader: the node's aria-label already says it all. */
/** The little of a DOM element this needs (src/game is typed without the DOM library). */
interface TagWord { className: string; textContent: string | null; setAttribute(name: string, value: string): void }
interface TagNode { appendChild(child: never): unknown; classList: { add(name: string): void } }
export function addNpcWord(doc: { createElement(tag: 'span'): TagWord }, node: TagNode): void {
  const word = doc.createElement('span')
  word.className = NPC_WORD_CLASS
  word.setAttribute('aria-hidden', 'true')
  word.textContent = NPC_WORD
  node.classList.add('has-npc-word')
  node.appendChild(word as never)
}
