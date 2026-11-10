import { anthropic } from './agent';
import { longDate } from './dates';
import type { Message, Store } from './store';

const EXTRACT_MODEL = process.env.MINIMI_EXTRACT_MODEL || 'claude-haiku-5-5';

const str = { type: 'string' } as const;
const list = (properties: Record<string, object>) => ({
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
});
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims', 'profile', 'loops_opened', 'loops_closed'],
  properties: {
    claims: list({ subject: str, attribute: str, value: str, source: { type: 'integer' } }),
    profile: list({ key: str, value: str }),
    loops_opened: list({ title: str, due: str }),
    loops_closed: list({ id: { type: 'integer' }, decision: str }),
  },
};
type Extracted = {
  claims: { subject: string; attribute: string; value: string; source: number }[];
  profile: { key: string; value: string }[];
  loops_opened: { title: string; due: string }[];
  loops_closed: { id: number; decision: string }[];
};

/**
 * After each reply, one cheap structured call decides what is worth remembering from the turn:
 * - claims: checkable facts the answer stated (feeds "has it changed since?")
 * - profile: durable facts the user stated about themselves (so they never brief the agent twice)
 * - open loops: decisions or follow-ups the user still owes, and which earlier loops this turn closed
 * Runs off the critical path, so it never slows an answer.
 */
export async function remember(store: Store, question: Message, answer: Message): Promise<void> {
  const today = answer.day;
  const sources = answer.sources ?? [];
  const open = store.openLoops();
  const res = await anthropic().messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: `Today is ${longDate(today)} (${today}). Read one chat turn and decide what a personal assistant should remember.

claims: facts in the ANSWER that can change over time and carry a [n] citation (prices, plan limits, versions, release dates, availability). Values copied exactly. source = the n. At most 25. Empty if none.
profile: durable facts the USER stated about themselves, their team, company, stack, budget, location or preferences. snake_case key, short value. Nothing transient. Empty if none.
loops_opened: things the USER still has to decide, do or re-check later (e.g. "Pick a CRM from the shortlist", "Re-check Postgres pricing after Black Friday"). Imperative title, at most 8 words. due = YYYY-MM-DD if the user gave any timing (resolve it from today), else "". Skip anything already in the open loops below.
loops_closed: open loops below that this turn resolves (a decision was made, or the check was done and answered). decision = the outcome in a few words.

<open_loops>
${open.map((l) => `#${l.id} ${l.title}${l.dueDay ? ` (due ${l.dueDay})` : ''}`).join('\n') || 'none'}
</open_loops>
<user>${question.content}</user>
<answer>${answer.content}</answer>`,
    }],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return;
  const x = JSON.parse(block.text) as Extracted;

  if (sources.length) {
    store.addClaims(x.claims.slice(0, 25).map((c) => ({
      messageId: answer.id, subject: c.subject, attribute: c.attribute, value: c.value,
      sourceUrl: sources.find((s) => s.n === c.source)?.url, day: today,
    })));
  }
  for (const p of x.profile.slice(0, 10)) if (p.key && p.value) store.setProfile(p.key.slice(0, 60), p.value.slice(0, 200), today);
  for (const l of x.loops_closed) store.closeLoop(l.id, l.decision.slice(0, 200), today);
  for (const l of x.loops_opened.slice(0, 5)) {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(l.due) && l.due >= today ? l.due : undefined;
    if (l.title) store.openLoop({ title: l.title.slice(0, 120), openedDay: today, dueDay: due, messageId: question.id });
  }
}
