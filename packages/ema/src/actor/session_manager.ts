import type { ActorInput } from "./base";
import { SessionQueue, type SessionQueueOptions } from "./session_queue";

export class SessionManager {
  private readonly queues = new Map<number, SessionQueue<ActorInput>>();

  constructor(
    private readonly onQueueUnlocked: (conversationId: number) => void,
    private readonly queueOptions: SessionQueueOptions = {},
  ) {}

  enqueue(conversationId: number, input: ActorInput): void {
    const queue = this.getOrCreateQueue(conversationId);
    queue.push(input);
  }

  tryPop(conversationId: number, now: number = Date.now()): ActorInput | null {
    return this.queues.get(conversationId)?.tryPop(now) ?? null;
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

  private getOrCreateQueue(conversationId: number): SessionQueue<ActorInput> {
    let queue = this.queues.get(conversationId);
    if (!queue) {
      const queue = new SessionQueue<ActorInput>(this.queueOptions);
      queue.onUnlocked(() => {
        this.onQueueUnlocked(conversationId);
      });
      this.queues.set(conversationId, queue);
      return queue;
    }
    return queue;
  }
}
