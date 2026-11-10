import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store';
import { recall, renderMemory } from '../src/memory';

const TODAY = '2026-11-11';

function seeded() {
  const s = new Store(null);
  const turn = (day: string, title: string, q: string, a: string) => {
    const c = s.addConversation(title, `${day}T09:00:00Z`, day);
    s.addMessage({ conversationId: c.id, role: 'user', content: q, at: `${day}T09:00:00Z`, day });
    const ans = s.addMessage({ conversationId: c.id, role: 'assistant', content: a, at: `${day}T09:00:05Z`, day });
    return ans;
  };
  const pg = turn('2026-11-03', 'Postgres hosting', 'What is the cheapest managed Postgres hosting?', 'Neon Launch is $19/mo [1].');
  s.addClaims([{ messageId: pg.id, subject: 'Neon', attribute: 'Launch plan price', value: '$19/month', day: '2026-11-03' }]);
  turn('2026-11-09', 'CRM shortlist', 'Shortlist 5 CRM tools for a 20-person sales team', 'HubSpot, Pipedrive, Salesforce, Zoho, Close.');
  return s;
}

test('ambiguous "last Tuesday" picks the day that has a conversation', () => {
  const r = recall(seeded(), 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?', TODAY);
  assert.deepEqual(r.dates[0].chosen, [{ from: '2026-11-03', to: '2026-11-03' }]);
  assert.equal(r.turns[0].conversation.title, 'Postgres hosting');
  assert.equal(r.turns[0].claims[0].value, '$19/month');
  assert.match(renderMemory(r, 'UTC'), /the only option with a conversation/);
});

test('a date with no conversation is reported as no record', () => {
  const r = recall(seeded(), 'What did I ask you on 1 October?', TODAY);
  assert.equal(r.turns.length, 0);
  assert.match(renderMemory(r, 'UTC'), /NO record/);
});

test('topic match finds the CRM shortlist without a usable date', () => {
  const r = recall(seeded(), 'Has any of the CRM tools we shortlisted changed pricing since?', TODAY);
  assert.equal(r.turns[0].conversation.title, 'CRM shortlist');
});

test('a fresh question with no past cue pulls no old turns', () => {
  const r = recall(seeded(), 'What is the latest Node.js LTS version?', TODAY);
  assert.equal(r.turns.length, 0);
});

test('empty memory says so', () => {
  assert.match(renderMemory(recall(new Store(null), 'What did I ask you on 3 November?', TODAY), 'UTC'), /No earlier conversations/);
});
