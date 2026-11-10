import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store';
import { recall, renderMemory } from '../src/memory';

function withLoop() {
  const s = new Store(null);
  const c = s.addConversation('CRM', '2026-11-09T09:00:00Z', '2026-11-09');
  const q = s.addMessage({ conversationId: c.id, role: 'user', content: 'I have to pick a CRM by Friday', at: '2026-11-09T09:00:00Z', day: '2026-11-09' });
  const loop = s.openLoop({ title: 'Pick a CRM from the shortlist', openedDay: '2026-11-09', dueDay: '2026-11-13', messageId: q.id });
  s.setProfile('team_size', '20-person sales team', '2026-11-09');
  return { s, loop };
}

test('pings fire only once a loop is due', () => {
  const { s } = withLoop();
  assert.equal(s.dueLoops('2026-11-12').length, 0);
  assert.equal(s.dueLoops('2026-11-13').length, 1);
  assert.equal(s.dueLoops('2026-11-20').length, 1); // overdue keeps pinging until closed
});

test('closing a loop traces the decision and stops pings', () => {
  const { s, loop } = withLoop();
  const closed = s.closeLoop(loop.id, 'Went with HubSpot', '2026-11-12');
  assert.equal(closed?.decision, 'Went with HubSpot');
  assert.equal(s.dueLoops('2026-11-13').length, 0);
  assert.equal(s.closeLoop(loop.id, 'again', '2026-11-13'), undefined); // already closed
});

test('memory block carries profile and open loops, flagged when due', () => {
  const { s } = withLoop();
  const block = renderMemory(recall(s, "What's on my plate?", '2026-11-13'), 'UTC');
  assert.match(block, /team_size: 20-person sales team/);
  assert.match(block, /Pick a CRM from the shortlist.*DUE TODAY/);
});

test('profile facts upsert by key and can be forgotten', () => {
  const { s } = withLoop();
  s.setProfile('team_size', '25-person sales team', '2026-11-20');
  assert.deepEqual(s.data.profile.map((f) => f.value), ['25-person sales team']);
  assert.equal(s.forgetProfile('team_size'), true);
  assert.equal(s.data.profile.length, 0);
});
