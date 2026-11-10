import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Source = { n: number; title: string; url: string; published?: string };
export type Conversation = { id: string; title: string; day: string; at: string };
/** `at` is the real instant; `day` is the user's local calendar day (or the simulated one). */
export type Message = {
  id: number; conversationId: string; role: 'user' | 'assistant'; content: string;
  sources?: Source[]; at: string; day: string;
};
/** One checkable fact the agent stated, kept so a later turn can compare then vs now. */
export type Claim = { messageId: number; subject: string; attribute: string; value: string; sourceUrl?: string; day: string };

type Data = { conversations: Conversation[]; messages: Message[]; claims: Claim[] };

// shortcut: the whole store lives in memory and is rewritten atomically on each change.
// Fine for one user (~10k turns, no native deps so `npm install` never breaks); move to SQLite + FTS5 for multi-user.
export class Store {
  data: Data = { conversations: [], messages: [], claims: [] };

  /** `file: null` keeps everything in memory (tests, evals). */
  constructor(private file: string | null) {
    if (!file) return;
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      // Never start empty over an unreadable file: that would wipe the user's memory on the next save.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read memory file ${file}: ${(e as Error).message}`);
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
    renameSync(`${this.file}.tmp`, this.file);
  }

  addConversation(title: string, at: string, day: string): Conversation {
    const c = { id: randomUUID(), title, at, day };
    this.data.conversations.push(c);
    this.save();
    return c;
  }

  conversation(id: string) {
    return this.data.conversations.find((c) => c.id === id);
  }

  /** Newest first. */
  conversations() {
    return [...this.data.conversations].sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at));
  }

  messages(conversationId: string) {
    return this.data.messages.filter((m) => m.conversationId === conversationId);
  }

  addMessage(m: Omit<Message, 'id'>): Message {
    const msg = { id: (this.data.messages.at(-1)?.id ?? 0) + 1, ...m };
    this.data.messages.push(msg);
    this.save();
    return msg;
  }

  /** The assistant reply that followed a user message in the same conversation. */
  answerTo(q: Message) {
    return this.data.messages.find((m) => m.conversationId === q.conversationId && m.id > q.id && m.role === 'assistant');
  }

  addClaims(claims: Claim[]) {
    if (!claims.length) return;
    this.data.claims.push(...claims);
    this.save();
  }

  claimsFor(messageId: number) {
    return this.data.claims.filter((c) => c.messageId === messageId);
  }
}
