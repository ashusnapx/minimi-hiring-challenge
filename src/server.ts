import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { chatTurn, type ChatEvent } from './chat';
import { isValidTz, localDay } from './dates';
import { handleMcp } from './mcp';
import { Store } from './store';

try {
  process.loadEnvFile();
} catch {
  // .env is optional: real environment variables work too
}
const missing = ['ANTHROPIC_API_KEY', 'EXA_API_KEY'].filter((k) => !process.env[k]);
const store = new Store(process.env.MINIMI_DATA || 'data/memory.json');
const port = Number(process.env.PORT) || 3000;
const serverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : localDay(new Date(), serverTz));
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: !missing.length, missing }));
app.get('/api/conversations', (c) => c.json(store.conversations()));
app.get('/api/conversations/:id', (c) => c.json(store.messages(c.req.param('id'))));

// Open loops inbox, pings, and "own your memory" (see and forget what minimi knows about you).
app.get('/api/loops', (c) => c.json([...store.data.loops].reverse()));
app.post('/api/loops/:id/close', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = typeof b.decision === 'string' && b.decision.trim() ? b.decision.trim().slice(0, 200) : 'Marked done';
  const loop = store.closeLoop(Number(c.req.param('id')), decision, day(b.asOf));
  return loop ? c.json(loop) : c.json({ error: 'no open loop with that id' }, 404);
});
app.get('/api/pings', (c) => c.json(store.dueLoops(day(c.req.query('today')))));
app.get('/api/profile', (c) => c.json(store.data.profile));
app.delete('/api/profile/:key', (c) => c.json({ forgotten: store.forgetProfile(c.req.param('key')) }));

// Memory MCP: plug minimi's memory into any MCP client.
app.all('/mcp', (c) => handleMcp(store, c.req.raw, serverTz, port));

app.post('/api/chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 8000) return c.json({ error: 'message must be 1-8000 characters' }, 400);
  if (missing.length) return c.json({ error: `Missing ${missing.join(', ')}: copy .env.example to .env and fill it in.` }, 503);

  const tz = isValidTz(body?.tz) ? body.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Time-travel clock: lets a reviewer chat "on" one day and come back "a week later" to test memory.
  const today = typeof body?.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : undefined;
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;

  return streamSSE(c, async (s) => {
    const send = (e: ChatEvent | { type: 'error'; message: string }) => {
      s.writeSSE({ event: e.type, data: JSON.stringify(e) }).catch(() => {}); // client may have left
    };
    try {
      await chatTurn(store, { message, conversationId, tz, now: new Date(), today }, send, c.req.raw.signal);
    } catch (e) {
      if (c.req.raw.signal.aborted) return;
      console.error('[chat]', e);
      send({ type: 'error', message: friendly(e) });
    }
  });
});

app.use('/*', serveStatic({ root: './public' }));

function friendly(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the model API. Try again in a few seconds.';
  if (e instanceof Anthropic.InternalServerError) return 'The model API is overloaded right now. Try again in a moment.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the model API. Check your connection.';
  return `Something went wrong: ${(e as Error).message}`;
}

// Localhost only by default: the memory is personal.
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '127.0.0.1' }, () => {
  console.log(`minimi → http://localhost:${port}   ·   memory MCP → http://localhost:${port}/mcp`);
  if (missing.length) console.warn(`⚠ Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
});
