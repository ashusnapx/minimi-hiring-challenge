import { anthropic } from './agent';
import type { Claim, Message } from './store';

const EXTRACT_MODEL = process.env.MINIMI_EXTRACT_MODEL || 'claude-haiku-5-5';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'attribute', 'value', 'source'],
        properties: {
          subject: { type: 'string', description: 'Product, company or thing, e.g. "Neon"' },
          attribute: { type: 'string', description: 'What about it, e.g. "Launch plan price"' },
          value: { type: 'string', description: 'The stated value, e.g. "$19/month"' },
          source: { type: 'integer', description: 'The [n] citation number, 0 if none' },
        },
      },
    },
  },
};

/**
 * Pulls the checkable, time-sensitive facts out of an answer (prices, plans, versions, dates, launches).
 * Runs after the reply has streamed, so it never slows the user down. Feeds "has it changed since?" later.
 */
export async function extractClaims(answer: Message): Promise<Claim[]> {
  const sources = answer.sources ?? [];
  if (!sources.length) return []; // only facts grounded in search are worth re-checking later
  const res = await anthropic().messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [
      {
        role: 'user',
        content:
          'List the facts in this answer that could change over time and are worth re-checking later: prices, plan limits, versions, ' +
          'release or launch dates, availability, rankings. One fact per item, values copied exactly. Skip opinions and advice. ' +
          `At most 25 items.\n\n<answer>\n${answer.content}\n</answer>`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return [];
  const parsed = JSON.parse(block.text) as { claims: { subject: string; attribute: string; value: string; source: number }[] };
  return parsed.claims.slice(0, 25).map((c) => ({
    messageId: answer.id,
    subject: c.subject,
    attribute: c.attribute,
    value: c.value,
    sourceUrl: sources.find((s) => s.n === c.source)?.url,
    day: answer.day,
  }));
}
