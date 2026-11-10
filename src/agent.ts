import Anthropic from '@anthropic-ai/sdk';
import { parseSearchInput, webSearch, webSearchTool } from './search';
import type { Source } from './store';

type Beta = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'sources'; sources: Source[] };

export const MODEL = process.env.MINIMI_MODEL || 'claude-sonnet-5-5';
const MAX_ROUNDS = 5;

let client: Anthropic | undefined;
export const anthropic = () => (client ??= new Anthropic());

/**
 * The agent loop: stream a reply; if the model asks for searches, run them all in parallel,
 * hand back numbered results, repeat. The last round forbids tool calls so it always answers.
 */
export async function runAgent(opts: {
  system: string;
  messages: Beta[];
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; sources: Source[]; searches: number }> {
  const { system, emit, signal } = opts;
  const messages = [...opts.messages];
  const sources: Source[] = [];
  let text = '';
  let searches = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    const stream = anthropic().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system,
        messages,
        tools: [webSearchTool], // never change tools mid-turn: kept identical so earlier thinking blocks stay valid
        tool_choice: { type: last ? 'none' : 'auto' },
        output_config: { effort: 'low' }, // chat + search: low effort is the fastest setting that holds quality
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // if a request is declined, the API retries it on a suitable model in the same call
      },
      { signal },
    );
    let started = false;
    stream.on('text', (delta) => {
      if (!started && text) {
        text += '\n\n'; // keep text from separate rounds in separate paragraphs
        emit({ type: 'text', text: '\n\n' });
      }
      started = true;
      text += delta;
      emit({ type: 'text', text: delta });
    });

    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content }); // full content, thinking blocks included

    if (msg.stop_reason === 'refusal') {
      const note = "I can't help with that request.";
      emit({ type: 'text', text: note });
      return { text: text + note, sources, searches };
    }
    const uses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !uses.length) break;

    const results = await Promise.all(
      uses.map(async (use): Promise<ToolResult> => {
        const input = parseSearchInput(use.input);
        if (!input) return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Invalid input: `query` (string) is required.' };
        searches++;
        emit({ type: 'status', text: `Searching: ${input.query}${input.published_after ? ` (since ${input.published_after})` : ''}` });
        try {
          const hits = await webSearch(input, signal);
          // Numbers are global across the turn so [n] in the answer maps to exactly one source.
          const numbered = hits.map((h) => {
            const s: Source = { n: sources.length + 1, title: h.title, url: h.url, published: h.published };
            sources.push(s);
            return { ...s, text: h.text };
          });
          emit({ type: 'sources', sources: numbered.map(({ text: _, ...s }) => s) });
          const body = numbered.map((h) => `[${h.n}] ${h.title}\n${h.url}${h.published ? ` (published ${h.published})` : ''}\n${h.text}`).join('\n\n');
          return { type: 'tool_result', tool_use_id: use.id, content: body || 'No results.' };
        } catch (e) {
          if (signal?.aborted) throw e;
          return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Search failed: ${(e as Error).message}` };
        }
      }),
    );
    messages.push({ role: 'user', content: results }); // all results in one message keeps parallel calls coming
  }

  return { text, sources, searches };
}
