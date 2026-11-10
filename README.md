<p align="center"><img src="docs/hero.svg" alt="minimi: remembers what it told you, checks if it's still true" width="100%"></p>

<p align="center"><b>Ask today. Come back next week. Ask “has anything changed?”</b><br>A chat agent with web search and a dated memory of every conversation.</p>

---

## ⚡ Run it

- `cp .env.example .env` and add two keys
  - `ANTHROPIC_API_KEY`: answers and fact extraction
  - `EXA_API_KEY`: the `web_search` tool
- `npm install && npm run dev` then open **http://localhost:3000**
- Try memory without waiting a week
  - Set **Time travel** (sidebar) to 3 Nov, ask about Postgres hosting
  - Clear it, ask *“What did I ask you on 3 November? Still correct?”*

## 🎯 The insight

- Every example in the brief is about **time**, not search
  - *“What did I ask you on 3 November?”* needs memory across chats, with dates
  - *“Last Tuesday…”* needs date maths that's right: 10 Nov or 3 Nov?
  - *“Changed since?”* needs what was **said** then, to compare with now
- So memory is the core, and search is the tool

## 🧭 How one message flows

<img src="docs/flow.svg" alt="Request flow" width="100%">

- **Before the first word**: code only, 0 model calls
  - dates resolved by `chrono-node` in your timezone
  - memory recalled by day + topic, injected as `<memory>`
- **One agent loop**: Sonnet 5.5, low effort, parallel `web_search`
- **After the reply**: Haiku 5.5 files facts into a claims ledger

## 📅 “Last Tuesday” is ambiguous, so it's kept ambiguous

<img src="docs/dates.svg" alt="Resolving last Tuesday" width="100%">

- Both readings kept, memory picks the day that has a chat
- Model is told which day it assumed, and says so
- No chat on that day: the prompt says **NO record**, so it never invents one

## 🔁 Then vs now

<img src="docs/ledger.svg" alt="Claims ledger diff" width="100%">

- Each answer stores `{subject, attribute, value, source, day}`
- “Changed since?” = old facts + `published_after` + live pricing pages
- Verdict per item: same / changed / couldn't verify

## ✅ Built to be trusted

- Every searched fact cites `[n]`, shown as a source card with its date
- UI shows the agent's steps: memory chips, search chips, time to first words
- Search failures go back to the model; refusals fall back server-side
- Memory file is written atomically and never overwritten if unreadable

## 🧪 Proof

- `npm test`: 11 unit tests, dates + recall, no keys needed
- `npm run eval`: 7 dataset-style scenarios, Claude-judged, with latency
  - setup turns run on simulated past days, so memory is real agent output
  - results in [`eval/results.md`](eval/results.md)

## 🗂 Code map

- [`src/chat.ts`](src/chat.ts): one turn, no HTTP inside
- [`src/dates.ts`](src/dates.ts): date phrases to day ranges
- [`src/memory.ts`](src/memory.ts): recall + `<memory>` block
- [`src/agent.ts`](src/agent.ts): streaming tool loop
- [`src/search.ts`](src/search.ts): Exa-backed `web_search`
- [`src/claims.ts`](src/claims.ts): facts ledger extraction
- [`src/store.ts`](src/store.ts): JSON store, atomic writes
- [`src/server.ts`](src/server.ts) + [`public/index.html`](public/index.html): Hono, SSE, UI

## 📄 Design

- Decisions, trade-offs, rejected options, next week: [**DESIGN.md**](DESIGN.md)
