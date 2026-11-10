import { runAgent, type AgentEvent } from './agent';
import { extractClaims } from './claims';
import { localDay } from './dates';
import { recall, renderMemory } from './memory';
import { systemPrompt } from './prompt';
import type { Store } from './store';

export type ChatEvent =
  | AgentEvent
  | { type: 'meta'; conversationId: string; today: string; recalled: { day: string; title: string; question: string }[]; notes: string[] }
  | { type: 'done'; ms: number; firstTokenMs: number | null; searches: number };

export type ChatInput = { message: string; conversationId?: string; tz: string; now: Date; today?: string };

const HISTORY_TURNS = 20;

/**
 * One chat turn, independent of HTTP: the server streams these events as SSE, the eval reads them directly.
 * recall (code) → prompt → agent loop (model + search) → save → extract facts in the background.
 */
export async function chatTurn(store: Store, input: ChatInput, emit: (e: ChatEvent) => void, signal?: AbortSignal) {
  const t0 = Date.now();
  let firstTokenMs: number | null = null;
  const { message, tz, now } = input;
  const today = input.today ?? localDay(now, tz); // `today` override = the time-travel clock
  const at = now.toISOString();

  const conv = (input.conversationId && store.conversation(input.conversationId)) || store.addConversation(title(message), at, today);
  const history = store.messages(conv.id).slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));
  while (history[0]?.role === 'assistant') history.shift(); // must open with a user turn

  const mem = recall(store, message, today, conv.id);
  emit({
    type: 'meta',
    conversationId: conv.id,
    today,
    recalled: mem.turns.map((t) => ({ day: t.question.day, title: t.conversation.title, question: t.question.content })),
    notes: mem.dates.filter((d) => !d.chosen.length).map((d) => `No conversation on record for "${d.phrase}"`),
  });

  store.addMessage({ conversationId: conv.id, role: 'user', content: message, at, day: today });
  const result = await runAgent({
    system: systemPrompt(today, tz, renderMemory(mem, tz)),
    messages: [...history, { role: 'user', content: message }],
    emit: (e) => {
      if (e.type === 'text' && firstTokenMs === null) firstTokenMs = Date.now() - t0;
      emit(e);
    },
    signal,
  });

  const cited = result.sources.filter((s) => result.text.includes(`[${s.n}]`));
  const answer = store.addMessage({ conversationId: conv.id, role: 'assistant', content: result.text, sources: cited, at: new Date().toISOString(), day: today });
  emit({ type: 'done', ms: Date.now() - t0, firstTokenMs, searches: result.searches });

  // After the reply: record what was claimed, so a later "has this changed?" has something to compare against.
  const claims = extractClaims(answer)
    .then((c) => store.addClaims(c))
    .catch((e) => console.warn(`[claims] skipped for message ${answer.id}: ${(e as Error).message}`));
  return { conversationId: conv.id, answer, claims };
}

function title(message: string) {
  const t = message.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

