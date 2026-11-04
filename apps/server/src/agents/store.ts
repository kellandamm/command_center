import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

export type AgentAdapterId = "openai-compatible";

export interface AgentConnection {
  id: string;
  name: string;
  adapter: AgentAdapterId;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentConversation {
  id: string;
  agentId: string;
  userId: string;
  title: string;
  messages: AgentChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface AgentHubData {
  agents: AgentConnection[];
  conversations: AgentConversation[];
}

const MAX_AGENTS = 50;
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 100;
const MAX_MESSAGE_LENGTH = 16_000;
const CONTEXT_MESSAGES = 40;
const EMPTY: AgentHubData = { agents: [], conversations: [] };

export class AgentHubStore {
  private data: AgentHubData = structuredClone(EMPTY);
  private writeQueue: Promise<void> = Promise.resolve();
  private conversationQueues = new Map<string, Promise<void>>();

  private constructor(private path: string) {}

  static async open(dataDir: string): Promise<AgentHubStore> {
    const store = new AgentHubStore(join(dataDir, "agent-hub.json"));
    const saved = await readJson<Partial<AgentHubData>>(store.path);
    if (saved) {
      if (!Array.isArray(saved.agents) || !Array.isArray(saved.conversations)) {
        throw new Error("Agent hub data is invalid.");
      }
      store.data = { agents: saved.agents, conversations: saved.conversations };
    }
    return store;
  }

  listAgents(): AgentConnection[] {
    return structuredClone(this.data.agents).sort((a, b) => a.name.localeCompare(b.name));
  }

  getAgent(id: string): AgentConnection | undefined {
    const agent = this.data.agents.find((row) => row.id === id);
    return agent ? structuredClone(agent) : undefined;
  }

  async addAgent(input: Omit<AgentConnection, "id" | "createdAt" | "updatedAt">): Promise<AgentConnection> {
    if (this.data.agents.length >= MAX_AGENTS) throw new Error(`At most ${MAX_AGENTS} agents can be connected.`);
    const now = new Date().toISOString();
    const agent: AgentConnection = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    await this.mutate((data) => data.agents.push(agent));
    return structuredClone(agent);
  }

  async updateAgent(
    id: string,
    patch: Partial<Pick<AgentConnection, "name" | "baseUrl" | "model" | "systemPrompt">>,
  ): Promise<AgentConnection | undefined> {
    let updated: AgentConnection | undefined;
    await this.mutate((data) => {
      const current = data.agents.find((row) => row.id === id);
      if (!current) return;
      Object.assign(current, patch, { updatedAt: new Date().toISOString() });
      updated = structuredClone(current);
    });
    return updated;
  }

  async removeAgent(id: string): Promise<boolean> {
    let removed = false;
    await this.mutate((data) => {
      const before = data.agents.length;
      data.agents = data.agents.filter((row) => row.id !== id);
      removed = data.agents.length !== before;
      if (removed) data.conversations = data.conversations.filter((row) => row.agentId !== id);
    });
    return removed;
  }

  listConversations(agentId: string, userId: string): Array<Omit<AgentConversation, "messages"> & { messageCount: number }> {
    return this.data.conversations
      .filter((row) => row.agentId === agentId && row.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ messages, ...row }) => ({ ...structuredClone(row), messageCount: messages.length }));
  }

  getConversation(agentId: string, id: string, userId: string): AgentConversation | undefined {
    const conversation = this.data.conversations.find(
      (row) => row.agentId === agentId && row.id === id && row.userId === userId,
    );
    return conversation ? structuredClone(conversation) : undefined;
  }

  async createConversation(agentId: string, userId: string, title?: string): Promise<AgentConversation> {
    if (!this.data.agents.some((row) => row.id === agentId)) throw new Error("Agent not found.");
    const conversation: AgentConversation = {
      id: randomUUID(),
      agentId,
      userId,
      title: title?.trim().slice(0, 120) || "New chat",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.mutate((data) => {
      data.conversations.unshift(conversation);
      data.conversations = data.conversations.slice(0, MAX_CONVERSATIONS);
    });
    return structuredClone(conversation);
  }

  async sendMessage(
    agentId: string,
    conversationId: string,
    userId: string,
    content: string,
    complete: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<string>,
  ): Promise<AgentConversation> {
    const cleanContent = content.trim();
    if (!cleanContent) throw new Error("Message is required.");
    if (cleanContent.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);

    return this.withConversationLock(conversationId, async () => {
      const agent = this.getAgent(agentId);
      if (!agent) throw new Error("Agent not found.");
      const current = this.getConversation(agentId, conversationId, userId);
      if (!current) throw new Error("Conversation not found.");
      if (current.messages.length + 2 > MAX_MESSAGES_PER_CONVERSATION) {
        throw new Error("This conversation reached its message limit. Start a new chat to continue.");
      }
      const history = current.messages.slice(-CONTEXT_MESSAGES).map(({ role, content: text }) => ({ role, content: text }));
      const reply = (await complete([
        ...(agent.systemPrompt ? [{ role: "system" as const, content: agent.systemPrompt }] : []),
        ...history,
        { role: "user", content: cleanContent },
      ])).trim();
      if (!reply) throw new Error("Agent returned an empty reply.");

      const timestamp = new Date().toISOString();
      const userMessage: AgentChatMessage = { role: "user", content: cleanContent, createdAt: timestamp };
      const assistantMessage: AgentChatMessage = { role: "assistant", content: reply.slice(0, MAX_MESSAGE_LENGTH), createdAt: timestamp };
      let updated: AgentConversation | undefined;
      await this.mutate((data) => {
        const row = data.conversations.find(
          (item) => item.agentId === agentId && item.id === conversationId && item.userId === userId,
        );
        if (!row) throw new Error("Conversation not found.");
        if (row.messages.length === 0 && row.title === "New chat") {
          row.title = cleanContent.split(/\r?\n/, 1)[0]!.slice(0, 120) || "New chat";
        }
        row.messages.push(userMessage, assistantMessage);
        row.updatedAt = timestamp;
        updated = structuredClone(row);
      });
      if (!updated) throw new Error("Conversation update failed.");
      return updated;
    });
  }

  private async withConversationLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.conversationQueues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.conversationQueues.set(id, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.conversationQueues.get(id) === queued) this.conversationQueues.delete(id);
    }
  }

  private async mutate(change: (data: AgentHubData) => void): Promise<void> {
    const run = this.writeQueue.then(async () => {
      const next = structuredClone(this.data);
      change(next);
      await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
      this.data = next;
    });
    this.writeQueue = run.then(() => {}, () => {});
    await run;
  }
}
