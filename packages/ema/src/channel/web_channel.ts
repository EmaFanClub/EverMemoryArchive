import type { ActorChatResponse } from "../actor";
import type { Channel } from "./base";

type ResponseListener = (response: ActorChatResponse) => void;

export class WebChannel implements Channel {
  readonly name = "web";

  private readonly listeners = new Map<string, Set<ResponseListener>>();

  subscribe(conversationId: number, listener: ResponseListener): () => void {
    const key = String(conversationId);
    let group = this.listeners.get(key);
    if (!group) {
      group = new Set();
      this.listeners.set(key, group);
    }
    group.add(listener);
    return () => {
      const current = this.listeners.get(key);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  async send(response: ActorChatResponse): Promise<void> {
    const key = String(response.conversationId);
    const group = this.listeners.get(key);
    if (!group || group.size === 0) {
      return;
    }
    for (const listener of group) {
      listener(response);
    }
  }
}
