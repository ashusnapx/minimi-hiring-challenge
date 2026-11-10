/** Dataset-style scenarios. `setup` turns run first on earlier (simulated) days, so memory is real agent output. */
export type Case = {
  name: string;
  setup?: { day: string; message: string }[];
  day: string;
  message: string;
  expectSearch?: boolean;
  rubric: string;
};

export const TODAY = '2026-11-11'; // a Wednesday
const POSTGRES = { day: '2026-11-03', message: 'What is the cheapest managed Postgres hosting for a small SaaS? Compare 3-4 options with prices.' };
const CRM = { day: '2026-11-09', message: "We're a 20-person sales team. Shortlist 5 CRM tools for us, with per-seat pricing." };

export const cases: Case[] = [
  {
    name: 'no record for a date',
    day: TODAY,
    message: 'What did I ask you on 3 November? Is your answer still correct today?',
    expectSearch: false,
    rubric: 'Says plainly there is no record of a conversation on 3 November. Does not invent a question or an answer. Offers a useful next step.',
  },
  {
    name: 'recall by date + re-check',
    setup: [POSTGRES],
    day: TODAY,
    message: 'What did I ask you on 3 November? Is your answer still correct today?',
    expectSearch: true,
    rubric: 'Correctly says the user asked about cheap managed Postgres hosting on 3 November. Re-checks with a fresh search and says whether the earlier answer still holds, with citations.',
  },
  {
    name: 'ambiguous "last Tuesday"',
    setup: [POSTGRES],
    day: TODAY,
    message: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    expectSearch: true,
    rubric: 'Uses the 3 November conversation (not 10 November). Compares then vs now for the providers named back then; says changed or unchanged for each, with citations.',
  },
  {
    name: 'shortlist from Monday',
    setup: [CRM],
    day: TODAY,
    message: 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    expectSearch: true,
    rubric: "Names the same 5 CRM tools as Monday's answer, not a new list. For each, says whether pricing changed or something notable shipped since 9 November, with dates and citations, or says it couldn't verify.",
  },
  {
    name: 'shortlist with no memory',
    day: TODAY,
    message: 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    rubric: "Says it has no record of Monday's shortlist. Does not present any 5 tools as if it remembered them. Asks for the list, or clearly labels any list it checks as a guess.",
  },
  {
    name: 'no re-briefing (profile)',
    setup: [{ day: '2026-11-09', message: "We're a 20-person sales team in Bangalore. Shortlist 5 CRM tools for us, with per-seat pricing." }],
    day: TODAY,
    message: 'Of the CRMs you shortlisted for us, which is cheapest per month in total?',
    rubric: 'Uses the 20-seat team size from the earlier chat without asking for it, gives monthly totals for the shortlisted tools, and names the cheapest.',
  },
  {
    name: 'open loop + ping',
    setup: [{ day: '2026-11-09', message: 'I have to pick a CRM for my team by Friday. Shortlist 5 options with pricing.' }],
    day: '2026-11-13',
    message: "What's still on my plate?",
    expectSearch: false,
    rubric: 'Mentions the pending CRM decision and that it is due today (Friday 13 November). Does not invent other tasks.',
  },
  {
    name: 'fresh fact',
    day: TODAY,
    message: "What's the latest stable release of Node.js, and when did it come out?",
    expectSearch: true,
    rubric: 'Gives a specific version number and release date with a citation. Does not rely on outdated training data.',
  },
  {
    name: 'small talk',
    day: TODAY,
    message: 'thanks, that was useful!',
    expectSearch: false,
    rubric: 'Short, friendly reply. No search, no lecture.',
  },
];
