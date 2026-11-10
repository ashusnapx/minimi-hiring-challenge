import { localTime, longDate, resolveDates, type DayRange } from './dates';
import type { Claim, Conversation, Message, Store } from './store';

export type Turn = { conversation: Conversation; question: Message; answer?: Message; claims: Claim[] };
export type DateFinding = { phrase: string; options: { range: DayRange; questions: number }[]; chosen: DayRange[] };
export type Recall = { dates: DateFinding[]; turns: Turn[]; recent: Conversation[]; firstDay?: string };

// Words that signal the user is pointing at an earlier conversation.
const PAST_CUE =
  /\b(asked|told|said|earlier|before|previous(ly)?|last time|remember|recall|since|still|again|we (discussed|talked|shortlisted|compared|picked|chose|looked|decided)|you (said|told|recommended|suggested|mentioned|answered))\b/i;
const STOP = new Set(
  `the and but then than that this those these what which who whom when where why how are was were been being does did have has had
  you your yours our ours their they them she him her its not any some all can could would should will just also there here about from with into over after before since
  ask asked tell told said say says changed change changes still today yesterday ago week weeks month months year
  monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december
  answer answered question correct right true valid accurate anything something thing things please thanks thank`.split(/\s+/),
);

/** Lowercased content words with a crude plural strip ("tools" ~ "tool"). */
function terms(s: string): Set<string> {
  const words = s.toLowerCase().match(/[a-z0-9][a-z0-9+#]*/g) ?? [];
  return new Set(words.filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)));
}

/**
 * Finds what the user is referring to in past conversations. Plain code, no model call:
 * runs in microseconds, so memory adds nothing to time-to-first-token.
 */
export function recall(store: Store, text: string, today: string, currentId?: string): Recall {
  const past = store.data.messages.filter((m) => m.role === 'user' && m.conversationId !== currentId);
  const within = (m: Message, r: DayRange) => m.day >= r.from && m.day <= r.to;

  const dates: DateFinding[] = resolveDates(text, today).map((ref) => {
    const options = ref.candidates.map((range) => ({ range, questions: past.filter((m) => within(m, range)).length }));
    const withTurns = options.filter((o) => o.questions > 0);
    return { phrase: ref.phrase, options, chosen: withTurns.map((o) => o.range) };
  });

  // Topic relevance: rare shared words count more (IDF-weighted overlap).
  const q = terms(text);
  const docs = past.map((m) => ({ m, t: terms(`${m.content} ${store.answerTo(m)?.content.slice(0, 3000) ?? ''}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.t) if (q.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const score = new Map(docs.map((d) => [d.m.id, [...q].reduce((s, w) => s + (d.t.has(w) ? Math.log(1 + docs.length / df.get(w)!) : 0), 0)]));
  const byScore = (a: Message, b: Message) => score.get(b.id)! - score.get(a.id)!;

  const dated = past.filter((m) => dates.some((d) => d.chosen.some((r) => within(m, r)))).sort(byScore).slice(0, 6);
  const topical = dates.length || PAST_CUE.test(text) ? past.filter((m) => score.get(m.id)! > 0).sort(byScore).slice(0, 3) : [];

  const picked = [...new Map([...dated, ...topical].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id);
  const turns = picked.map((question) => {
    const answer = store.answerTo(question);
    return { conversation: store.conversation(question.conversationId)!, question, answer, claims: answer ? store.claimsFor(answer.id) : [] };
  });

  const firstDay = store.data.messages.filter((m) => m.conversationId !== currentId).map((m) => m.day).sort()[0];
  return { dates, turns, recent: store.conversations().filter((c) => c.id !== currentId).slice(0, 8), firstDay };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …[truncated]` : s);
const span = (r: DayRange) => (r.from === r.to ? longDate(r.from) : `${longDate(r.from)} to ${longDate(r.to)}`);

/** The <memory> block for the system prompt. States absences explicitly so the model cannot fill gaps. */
export function renderMemory(r: Recall, tz: string): string {
  const out = ['<memory>'];
  out.push(r.firstDay ? `Stored conversations go back to ${longDate(r.firstDay)}. Nothing earlier exists.` : 'No earlier conversations are stored: this is the first one.');

  for (const d of r.dates) {
    const opts = d.options.map((o) => `${span(o.range)} (${o.questions ? `${o.questions} question(s) on record` : 'no conversations on record'})`);
    let line = `Date "${d.phrase}" = ${opts.join(' OR ')}.`;
    if (!d.chosen.length) line += ' There is NO record for this: say so plainly, never guess what was asked.';
    else if (d.options.length > 1 && d.chosen.length === 1) line += ` Use ${span(d.chosen[0])}, the only option with a conversation, and say you assumed it.`;
    else if (d.chosen.length > 1) line += ' More than one option has conversations: pick by topic, or ask which one.';
    out.push(line);
  }

  for (const t of r.turns) {
    out.push('', `## ${longDate(t.question.day)}, ${localTime(t.question.at, tz)} · conversation "${t.conversation.title}"`);
    out.push(`User asked: ${t.question.content}`);
    if (t.answer) out.push(`You answered: ${clip(t.answer.content, 2000)}`);
    if (t.claims.length) {
      out.push(`Facts you stated then (as of ${longDate(t.question.day)}):`);
      for (const c of t.claims) out.push(`- ${c.subject} · ${c.attribute}: ${c.value}${c.sourceUrl ? ` (${c.sourceUrl})` : ''}`);
    }
  }

  if (r.recent.length) out.push('', `Recent conversations: ${r.recent.map((c) => `${c.day} "${c.title}"`).join('; ')}`);
  out.push('</memory>');
  return out.join('\n');
}
