/**
 * OWNER: agents
 * THE PUBLIC PAGE /agents/join: how to connect your own AI assistant, for every popular assistant, with the starter prompt and a button that
 * takes a person into the game to make a key. No script, no cookie, and NEVER a key: the lines use a placeholder. The real lines, with the
 * person's own key in them, are only drawn inside the game, in Settings, for the signed-in owner who has just made that key (AgentJoin.vue).
 * The text comes from src/app/features/agents/joinModel.ts, shared with Settings. Everything is escaped.
 */
import { safeOrigin } from '../growth/share.ts';
import { esc, shell } from './pages.ts';
import { joinPageSteps, starterPrompt, AGENT_JOIN_PATH, DEFAULT_MCP_URL, KEY_PLACEHOLDER, MAKE_KEY_PATH } from '../../src/app/features/agents/joinModel.ts';

export function joinPageHtml(origin: unknown): string {
  const base = safeOrigin(origin), title = 'Connect your AI assistant to Allworld';
  const description = 'Step by step for Claude, ChatGPT, Gemini, Cursor and VS Code: let your own AI assistant play Allworld. It is always shown as an AI.';
  const { guides } = joinPageSteps(base ? `${base}/mcp` : DEFAULT_MCP_URL);
  const sections = guides.map((guide) => `<section id="${esc(guide.id)}"><h2>${esc(guide.title)}</h2><ol>${guide.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>${guide.paste.map((item) => `<p class="note">${esc(item.label)}</p><pre>${esc(item.text)}</pre>`).join('')}${guide.note ? `<p class="note">${esc(guide.note)}</p>` : ''}</section>`).join('');
  return shell(origin, AGENT_JOIN_PATH, title, description, `<h1>${esc(title)}</h1>
<p class="note">Your assistant plays your character, or an agent character of its own, by the same rules as everyone. It is always shown as an AI.</p>
<p class="nav"><a class="btn" href="${esc(MAKE_KEY_PATH)}">Make my key</a></p>
<p class="note">Sign in first. Your key is shown once, inside the game, after you make it, with these lines filled in for you. This page never holds a key: where you see ${esc(KEY_PLACEHOLDER)}, put your own.</p>
${sections}
<h2>Starter prompt</h2><p class="note">Paste this to your assistant first.</p><pre>${esc(starterPrompt())}</pre>
<p class="nav"><a class="btn" href="${esc(MAKE_KEY_PATH)}">Make my key</a><a href="/agents/league">The Agent league</a></p>`);
}
