# DESIGN

## The bet

Every example in the brief is about **time**, not search: *"What did I ask you on 3 November? Is it still correct?"*, *"Last Tuesday… has pricing changed since?"*, *"On Monday we shortlisted…"*. A search-only agent fails all three: it has no memory across chats, does date maths in its head, and has no record of what it actually said. So minimi treats **dated memory as the core** and web search as the one tool.

## How it works

1. **Dates, in code** (`dates.ts`). `chrono-node` turns phrases into day ranges in the user's timezone. Ambiguity is kept, not guessed: on Wed 11 Nov, "last Tuesday" yields *both* 10 Nov and 3 Nov.
2. **Recall, in code** (`memory.ts`). Past questions are matched by day window, plus IDF-weighted topic overlap when the message points backwards ("asked", "since", "still"…). If exactly one candidate day has a conversation, that's the one. The result is rendered as a `<memory>` block that also states **absences** ("NO record for 3 Nov: never guess"), because a model left to fill a gap will fill it.
3. **One agent loop** (`agent.ts`). Claude Sonnet 5.5 at `effort: low` streams the answer and may call `web_search` several times in parallel per round (≤5 rounds, last round tool-free). Results are numbered globally so `[n]` in the answer maps to exactly one source.
4. **Search built for "since"** (`search.ts`, Exa). `published_after` finds launches and changelogs after a date; `fresh: true` reads the live pricing page instead of a cached copy; `domains` pins official sources. Only query-relevant highlights come back, so the model reads less and answers sooner.
5. **A claims ledger, after the reply** (`claims.ts`). Haiku 5.5 extracts checkable facts `{subject, attribute, value, source, day}` with structured output. Next week's "has it changed?" compares against *what was said*, not a vague summary.
6. **Transport-free core** (`chat.ts`). One function runs a turn and emits events; the server streams them as SSE, the eval calls it directly. The UI shows what the agent did: memory chips, search chips, cited sources with dates, time to first words.

## Why this shape

- **Fast**: nothing before the first token calls a model. Recall is microseconds; extraction runs after the reply.
- **Right**: date maths and memory lookup are deterministic and unit-tested; the model only does judgment and writing.
- **Honest**: absences are stated in the prompt; every searched fact cites a dated source.
- **Testable by a reviewer**: a *time-travel clock* in the UI stores messages on any chosen day, so "ask today, come back next week" takes 30 seconds, not a week.

## Considered and rejected

| Option | Why not |
|---|---|
| Memory as a second tool (`recall()`) | Extra model round-trip; the model does date maths; bends the one-tool brief |
| Whole history in every prompt | Cost and latency grow forever; nothing structured to diff against |
| Vector DB / embeddings | Overkill for one user; dates + keywords cover the dataset's references |
| Claude's built-in web search | Black box: no date filter, no live-page control, sources not ours to log |
| LangChain / Vercel AI SDK | Hide the loop that reviewers want to read |
| Planner + executor agents | Slower, more failure modes, no quality gain for chat |
| SQLite (`better-sqlite3`) | v13 needs Node 22 + native build; a JSON store can't break `npm install` |
| Higher effort / more thinking | Slower; `low` is Anthropic's recommended chat+search setting, and the eval checks it holds |

## Evidence

- `npm test`: 11 unit tests over dates and recall (the parts most likely to fail quietly). No keys needed.
- `npm run eval`: 7 dataset-style scenarios. Setup turns run on simulated past days, so memory is real agent output; a Claude judge grades each reply against a rubric; latency and search counts are reported.

## With another week

- **Watch list**: re-check ledger claims on a schedule and tell the user when a price moves.
- **Paraphrase recall**: embeddings for "that database thing" when keywords miss.
- **Clarify ambiguity in the UI**: one-tap "Tue 10 or Tue 3?" when both days have chats.
- **Speed**: prompt-cache the stable system prefix, cache search results per query, measure p50/p90 first-token time.
- **Multi-user**: auth + SQLite/Postgres with FTS behind the same `Store` interface.
- **Bigger eval**: grow cases from real transcripts and run them in CI.
