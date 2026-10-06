// A stand-in for the language-model gateway, for tests of the hosted companion: a local HTTP server that records every request
// it receives and answers as the test says. Tests use ports 4143-4145 only. Nothing outside this machine is ever called.
import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface Seen { method: string; path: string; headers: Record<string, string | string[] | undefined>; raw: string; body: Record<string, unknown> }
export interface Plan {
  status?: number
  /** Wait this long before answering. */
  delayMs?: number
  /** The model's reply text (put inside the usual chat answer). */
  reply?: string
  /** Send exactly this as the body instead. */
  raw?: string
  usage?: { prompt_tokens: number; completion_tokens: number } | null
}
export type Planner = (seen: Seen, index: number) => Plan;
export const GOOD = JSON.stringify({ text: 'Hello! Try Jobs to find work.', suggest: ['open-jobs'] });

export async function fakeGateway(port: number, plan: Planner = () => ({})) {
  const seen: Seen[] = [];
  const state = { plan };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* kept as {} */ }
      const entry: Seen = { method: request.method ?? '', path: request.url ?? '', headers: request.headers, raw, body };
      seen.push(entry);
      const chosen = state.plan(entry, seen.length - 1);
      const send = (): void => {
        response.writeHead(chosen.status ?? 200, { 'Content-Type': 'application/json' });
        response.end(chosen.raw ?? ((chosen.status ?? 200) >= 400 ? JSON.stringify({ error: { message: 'no' } }) : JSON.stringify({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: chosen.reply ?? GOOD } }], ...(chosen.usage === null ? {} : { usage: chosen.usage ?? { prompt_tokens: 700, completion_tokens: 40 } }) })));
      };
      if (chosen.delayMs) setTimeout(send, chosen.delayMs); else send();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  return {
    seen, port, base: `http://127.0.0.1:${port}`,
    plan(next: Planner): void { state.plan = next; },
    reset(): void { seen.length = 0; },
    async stop(): Promise<void> { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
/** A fetch that sends what is meant for the gateway's https address to the local fake instead. */
export const redirectTo = (base: string) => (url: string, init?: RequestInit): Promise<Response> => fetch(url.replace('https://ai-gateway.vercel.sh', base), init);
