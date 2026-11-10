import type Anthropic from '@anthropic-ai/sdk';

export type SearchInput = { query: string; published_after?: string; domains?: string[]; fresh?: boolean };
export type Hit = { title: string; url: string; published?: string; text: string };

/** The agent's one tool. Description and params are written to steer *how* it searches, not just *that* it does. */
export const webSearchTool: Anthropic.Beta.Messages.BetaTool = {
  name: 'web_search',
  description:
    'Search the live web. Returns numbered results with title, URL, publish date and the most relevant excerpts. ' +
    'Call it several times in the same turn (in parallel) for different entities or angles. ' +
    'Prefer official sources: name the vendor domain in `domains` for pricing or changelog pages.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A specific search query, e.g. "Neon Postgres pricing plans".' },
      published_after: {
        type: 'string',
        description: 'YYYY-MM-DD. Only pages published on or after this day: use for news, launches and changelogs since a date. Not for pricing pages (they rarely carry a publish date).',
      },
      domains: { type: 'array', items: { type: 'string' }, description: 'Only search these domains, e.g. ["neon.com"].' },
      fresh: { type: 'boolean', description: 'Read the live page instead of a cached copy. Slower; use when current values matter (pricing, plans, limits).' },
    },
    required: ['query'],
  },
};

/** Model output is untrusted: validate the shape before spending an API call on it. */
export function parseSearchInput(raw: unknown): SearchInput | null {
  const i = raw as Record<string, unknown>;
  if (!i || typeof i.query !== 'string' || !i.query.trim()) return null;
  const out: SearchInput = { query: i.query.trim().slice(0, 400) };
  if (typeof i.published_after === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.published_after)) out.published_after = i.published_after;
  if (Array.isArray(i.domains)) out.domains = i.domains.filter((d): d is string => typeof d === 'string' && d.length > 0).slice(0, 10);
  if (i.fresh === true) out.fresh = true;
  return out;
}

export async function webSearch(input: SearchInput, signal?: AbortSignal): Promise<Hit[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error('EXA_API_KEY is not set');
  const body = {
    query: input.query,
    type: 'auto',
    numResults: 6,
    ...(input.published_after && { startPublishedDate: `${input.published_after}T00:00:00.000Z` }),
    ...(input.domains?.length && { includeDomains: input.domains }),
    // Highlights = the query-relevant passages only: fewer tokens for the model to read, so a faster answer.
    contents: { highlights: { maxCharacters: 1500 }, ...(input.fresh && { maxAgeHours: 0 }) },
  };
  const timeout = AbortSignal.timeout(input.fresh ? 25_000 : 12_000);
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { results?: { title?: string; url: string; publishedDate?: string; highlights?: string[]; text?: string }[] };
  return (json.results ?? []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    published: r.publishedDate?.slice(0, 10),
    text: (r.highlights?.join(' … ') || r.text || '').slice(0, 2000),
  }));
}
