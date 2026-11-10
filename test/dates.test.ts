import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, resolveDates } from '../src/dates';

const TODAY = '2026-11-11'; // a Wednesday
const days = (text: string) => resolveDates(text, TODAY).map((r) => r.candidates.map((c) => (c.from === c.to ? c.from : `${c.from}..${c.to}`)));

test('"last Tuesday" on a Wednesday is ambiguous: yesterday or the week before', () => {
  assert.deepEqual(days('Last Tuesday I asked you about Postgres hosting'), [['2026-11-10', '2026-11-03']]);
});

test('a bare weekday is the most recent one', () => {
  assert.deepEqual(days('On Monday we shortlisted 5 CRM tools'), [['2026-11-09']]);
  assert.deepEqual(days('what did we say on Wednesday'), [['2026-11-04']]); // today is Wednesday: means last week's
});

test('explicit dates resolve to the past', () => {
  assert.deepEqual(days('What did I ask you on 3 November?'), [['2026-11-03']]);
  assert.deepEqual(days('what did I ask on December 3'), [['2025-12-03']]);
  assert.deepEqual(days('what did I ask yesterday'), [['2026-11-10']]);
});

test('weeks and months become ranges', () => {
  assert.deepEqual(days('what did we discuss last week'), [['2026-11-02..2026-11-08']]);
  assert.deepEqual(days('anything this week?'), [['2026-11-09..2026-11-11']]);
  assert.deepEqual(days('what did I ask last month'), [['2026-10-01..2026-10-31']]);
});

test('messages without dates find nothing', () => {
  assert.deepEqual(days('Shortlist 5 CRM tools for a 20-person sales team'), []);
});

test('localDay respects the user timezone', () => {
  const at = new Date('2026-11-10T20:00:00Z');
  assert.equal(localDay(at, 'Asia/Kolkata'), '2026-11-11');
  assert.equal(localDay(at, 'America/New_York'), '2026-11-10');
});
