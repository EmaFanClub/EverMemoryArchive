import type { ActorInput } from "./base";
import {
  SessionQueue,
  type SessionQueueEvent,
  type SessionQueueOptions,
} from "./session_queue";

export type SessionManagerQueueEvent = SessionQueueEvent;
export type SessionActivityState = "inactive" | "active";

export class SessionManager {
  private readonly queues = new Map<number, SessionQueue<ActorInput>>();
  private readonly activityStates = new Map<number, SessionActivityState>();

  constructor(
    private readonly onQueueUnlocked: (conversationId: number) => void,
    private readonly queueOptions: SessionQueueOptions = {},
    private readonly onQueueEvent: (
      conversationId: number,
      event: SessionQueueEvent,
    ) => void = () => {},
  ) {}

  enqueue(conversationId: number, input: ActorInput): void {
    const queue = this.getOrCreateQueue(conversationId);
    queue.push(input);
  }

  getActivityState(conversationId: number): SessionActivityState {
    return this.activityStates.get(conversationId) ?? "inactive";
  }

  activateConversation(conversationId: number): void {
    this.activityStates.set(conversationId, "active");
  }

  deactivateConversation(conversationId: number): void {
    this.activityStates.set(conversationId, "inactive");
  }

  listActiveConversationIds(): number[] {
    return Array.from(this.activityStates.entries())
      .filter(([, state]) => state === "active")
      .map(([conversationId]) => conversationId);
  }

  tryPop(conversationId: number, now: number = Date.now()): ActorInput | null {
    return this.queues.get(conversationId)?.tryPop(now) ?? null;
  }

  listQueuedInputs(conversationId: number): ActorInput[] {
    return this.queues.get(conversationId)?.snapshot() ?? [];
  }

  drainConversationQueue(conversationId: number): ActorInput[] {
    const queue = this.queues.get(conversationId);
    if (!queue) {
      return [];
    }
    const inputs = queue.drain();
    this.queues.delete(conversationId);
    return inputs;
  }

  pickNextConversationId(now: number = Date.now()): number | null {
    let selectedConversationId: number | null = null;
    let selectedPriority = 0;
    for (const [conversationId, queue] of this.queues) {
      const priority = queue.priority(now);
      if (priority > selectedPriority) {
        selectedConversationId = conversationId;
        selectedPriority = priority;
      }
    }
    return selectedConversationId;
  }

  dropConversation(conversationId: number): number {
    const queue = this.queues.get(conversationId);
    if (!queue) {
      return 0;
    }
    const dropped = queue.dispose();
    this.queues.delete(conversationId);
    this.activityStates.delete(conversationId);
    return dropped;
  }

  clear(): void {
    for (const queue of this.queues.values()) {
      queue.dispose();
    }
    this.queues.clear();
    this.activityStates.clear();
  }

  private getOrCreateQueue(conversationId: number): SessionQueue<ActorInput> {
    let queue = this.queues.get(conversationId);
    if (!queue) {
      const queue = new SessionQueue<ActorInput>(this.queueOptions);
      queue.onEvent((event) => {
        this.onQueueEvent(conversationId, event);
      });
      queue.onUnlocked(() => {
        this.onQueueUnlocked(conversationId);
      });
      this.queues.set(conversationId, queue);
      return queue;
    }
    return queue;
  }
}
