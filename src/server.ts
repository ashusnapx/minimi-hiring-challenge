import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { chatTurn, type ChatEvent } from './chat';
import { isValidTz } from './dates';
import { Store } from './store';

try {
  process.loadEnvFile();
} catch {
  // .env is optional: real environment variables work too
}
const missing = ['ANTHROPIC_API_KEY', 'EXA_API_KEY'].filter((k) => !process.env[k]);
const store = new Store(process.env.MINIMI_DATA || 'data/memory.json');
const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: !missing.length, missing }));
app.get('/api/conversations', (c) => c.json(store.conversations()));
app.get('/api/conversations/:id', (c) => c.json(store.messages(c.req.param('id'))));

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

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, () => {
  console.log(`minimi → http://localhost:${port}`);
  if (missing.length) console.warn(`⚠ Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
});
