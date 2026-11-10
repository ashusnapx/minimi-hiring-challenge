import { writeFileSync } from 'node:fs';
import { anthropic } from '../src/agent';
import { chatTurn } from '../src/chat';
import { Store } from '../src/store';
import { cases, type Case } from './cases';

try {
  process.loadEnvFile();
} catch {
  // .env optional
}

const JUDGE = process.env.MINIMI_JUDGE_MODEL || 'claude-sonnet-5-5';
const TZ = 'UTC';
const only = process.argv[2]; // npm run eval -- "small talk"

type Result = { name: string; pass: boolean; reason: string; searchOk: boolean; searches: number; firstTokenMs: number | null; ms: number; answer: string };

async function runCase(c: Case): Promise<Result> {
  const store = new Store(null); // every case starts with a clean memory
  for (const s of c.setup ?? []) {
    const r = await chatTurn(store, { message: s.message, tz: TZ, now: new Date(), today: s.day }, () => {});
    await r.remembered; // facts, profile and loops must exist before the follow-up, as they would a week later
  }
  let done = { ms: 0, firstTokenMs: null as number | null, searches: 0 };
  const r = await chatTurn(store, { message: c.message, tz: TZ, now: new Date(), today: c.day }, (e) => {
    if (e.type === 'done') done = e;
  });
  const history = (c.setup ?? []).map((s) => `On ${s.day} the user asked: ${s.message}`).join('\n') || 'No earlier conversations.';
  const verdict = await judge(c, history, r.answer.content);
  const searchOk = c.expectSearch === undefined || c.expectSearch === done.searches > 0;
  return { name: c.name, ...verdict, pass: verdict.pass && searchOk, searchOk, ...done, answer: r.answer.content };
}

async function judge(c: Case, history: string, answer: string): Promise<{ pass: boolean; reason: string }> {
  const res = await anthropic().messages.create({
    model: JUDGE,
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: { type: 'object', additionalProperties: false, required: ['pass', 'reason'], properties: { pass: { type: 'boolean' }, reason: { type: 'string' } } },
      },
    },
    messages: [{
      role: 'user',
      content: `Grade a chat assistant's reply against a rubric. Today is ${c.day}. Pass only if every point of the rubric is met. Reason: one sentence.

<history>${history}</history>
<user_message>${c.message}</user_message>
<reply>${answer}</reply>
<rubric>${c.rubric}</rubric>`,
    }],
  });
  const text = res.content.find((b) => b.type === 'text');
  return JSON.parse(text && text.type === 'text' ? text.text : '{"pass":false,"reason":"no verdict"}');
}

const s = (ms: number | null) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`);
const selected = cases.filter((c) => !only || c.name.includes(only));
console.log(`Running ${selected.length} cases in parallel…`);
const results = await Promise.all(
  selected.map((c) =>
    runCase(c).catch((e): Result => ({ name: c.name, pass: false, reason: `crashed: ${(e as Error).message}`, searchOk: false, searches: 0, firstTokenMs: null, ms: 0, answer: '' })),
  ),
);

const rows = results.map((r) => `| ${r.pass ? '✅' : '❌'} | ${r.name} | ${r.searches}${r.searchOk ? '' : ' ⚠'} | ${s(r.firstTokenMs)} | ${s(r.ms)} | ${r.reason.replace(/\|/g, '/')} |`);
const passed = results.filter((r) => r.pass).length;
const report = [
  `# Eval results (${new Date().toISOString().slice(0, 10)})`,
  '',
  `**${passed}/${results.length} passed** · judge: ${JUDGE} · simulated today: Wed 11 Nov 2026`,
  '',
  '| | case | searches | first words | total | judge |',
  '|---|---|---|---|---|---|',
  ...rows,
  '',
  ...results.flatMap((r) => [`<details><summary>${r.name}</summary>`, '', r.answer, '', '</details>', '']),
].join('\n');
writeFileSync('eval/results.md', report);
console.log(rows.join('\n'));
console.log(`\n${passed}/${results.length} passed → eval/results.md`);
