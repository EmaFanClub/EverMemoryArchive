export type SseHandler<T> = (event: T) => void;

export interface SseSubscription {
  close: () => void;
}

export function subscribeSse<T>(
  url: string,
  handler: SseHandler<T>,
  options: {
    onDisconnect?: () => void;
  } = {},
): SseSubscription {
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;
  let source: EventSource | null = null;

  const connect = () => {
    if (closed) {
      return;
    }

    source = new EventSource(url);
    source.onmessage = (event) => {
      try {
        handler(JSON.parse(event.data) as T);
      } catch {
        // Ignore malformed events from dev tooling or intermediaries.
      }
    };
    source.addEventListener("actor.created", source.onmessage);
    source.addEventListener("actor.updated", source.onmessage);
    source.addEventListener("actor.deleted", source.onmessage);
    source.addEventListener("actor.runtime.changed", source.onmessage);
    source.addEventListener("actor.latest_preview", source.onmessage);
    source.addEventListener("actor.unread.changed", source.onmessage);
    source.addEventListener("conversation.message.created", source.onmessage);
    source.addEventListener("conversation.typing.changed", source.onmessage);
    source.addEventListener("channel.qq.connection.changed", source.onmessage);
    source.onopen = () => {
      retryDelay = 1000;
    };
    source.onerror = () => {
      options.onDisconnect?.();
      source?.close();
      if (closed) {
        return;
      }
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    };
  };

  connect();

  return {
    close() {
      closed = true;
      source?.close();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    },
  };
}
