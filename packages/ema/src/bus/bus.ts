import { EventEmitter } from "node:events";

import type { EmaEvent, EmaEventFilter, EmaEventHandler } from "./types";

export class EmaBus {
  private readonly emitter = new EventEmitter();

  publish(event: EmaEvent): void {
    this.emitter.emit("event", event);
  }

  createEvent<T extends EmaEvent["type"], D>(
    input: Omit<EmaEvent<T, D>, "ts"> & { ts?: number },
  ): EmaEvent<T, D> {
    return {
      ...input,
      ts: input.ts ?? Date.now(),
    };
  }

  subscribe(handler: EmaEventHandler): () => void;
  subscribe(filter: EmaEventFilter, handler: EmaEventHandler): () => void;
  subscribe(
    filterOrHandler: EmaEventFilter | EmaEventHandler,
    maybeHandler?: EmaEventHandler,
  ): () => void {
    const filter =
      typeof maybeHandler === "function" ? filterOrHandler : undefined;
    const handler =
      typeof maybeHandler === "function"
        ? maybeHandler
        : (filterOrHandler as EmaEventHandler);

    const wrapped = (event: EmaEvent) => {
      if (!matchesFilter(event, filter as EmaEventFilter | undefined)) {
        return;
      }
      handler(event);
    };

    this.emitter.on("event", wrapped);
    return () => {
      this.emitter.off("event", wrapped);
    };
  }
}

function matchesFilter(
  event: EmaEvent,
  filter: EmaEventFilter | undefined,
): boolean {
  if (!filter) {
    return true;
  }
  if (typeof filter === "function") {
    return filter(event);
  }
  if (Array.isArray(filter)) {
    return filter.includes(event.type);
  }
  return event.type === filter;
}
