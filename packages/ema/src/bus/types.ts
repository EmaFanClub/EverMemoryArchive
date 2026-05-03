export type EmaEventTopic =
  | "actor.created"
  | "actor.updated"
  | "actor.deleted"
  | "actor.runtime.changed"
  | "actor.latest_preview"
  | "channel.qq.connection.changed";

export interface EmaEvent<
  T extends EmaEventTopic = EmaEventTopic,
  D = unknown,
> {
  type: T;
  ts: number;
  actorId?: number;
  data: D;
}

export type EmaEventHandler = (event: EmaEvent) => void;

export type EmaEventFilter =
  | EmaEventTopic
  | EmaEventTopic[]
  | ((event: EmaEvent) => boolean);
