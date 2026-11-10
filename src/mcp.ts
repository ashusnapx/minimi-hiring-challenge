import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { localDay, longDate } from './dates';
import { recall, renderMemory } from './memory';
import type { Store } from './store';

const readOnly = { readOnlyHint: true, openWorldHint: false };

/**
 * minimi's memory as an MCP server: plug it into Claude, ChatGPT, Cursor or any MCP client, so they never need briefing either.
 * Read-only and stateless (a fresh server per request). Host is checked, so a web page can't reach it via DNS rebinding.
 */
export async function handleMcp(store: Store, req: Request, tz: string, port: number): Promise<Response> {
  const server = new McpServer({ name: 'minimi-memory', version: '1.0.0' });
  const today = () => localDay(new Date(), tz);
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  server.registerTool('recall_memory', {
    description:
      "Search the user's past chats with minimi by date phrase or topic, e.g. \"what did I ask on 3 November\" or \"last Tuesday Postgres\". " +
      'Returns dated questions and answers, the facts stated then with sources, what minimi knows about the user, and their open loops.',
    inputSchema: { query: z.string().describe('Date phrase and/or topic') },
    annotations: readOnly,
  }, async ({ query }) => text(renderMemory(recall(store, query, today()), tz)));

  server.registerTool('open_loops', {
    description: "The user's open loops (decisions or follow-ups they still owe, with due dates) and recently closed ones with the decision taken.",
    annotations: readOnly,
  }, async () => text(loopsText(store)));

  server.registerTool('about_user', {
    description: 'Durable facts the user told minimi about themselves (team, stack, location, preferences). Use them instead of asking again.',
    annotations: readOnly,
  }, async () => text(store.data.profile.map((f) => `- ${f.key}: ${f.value} (since ${f.day})`).join('\n') || 'Nothing known about the user yet.'));

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`],
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

function loopsText(store: Store): string {
  const open = store.openLoops().map((l) => `- #${l.id} ${l.title} (opened ${longDate(l.openedDay)}${l.dueDay ? `, due ${longDate(l.dueDay)}` : ''})`);
  const closed = store.data.loops.filter((l) => l.status === 'closed').slice(-10)
    .map((l) => `- #${l.id} ${l.title}: ${l.decision} (closed ${longDate(l.closedDay!)})`);
  return [`Open (${open.length}):`, ...open, '', 'Recently closed:', ...(closed.length ? closed : ['- none'])].join('\n');
}
