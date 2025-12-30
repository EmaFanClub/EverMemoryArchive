import { EventEmitter } from "node:events";

/**
 * You can use {@link ActorClient} APIs to communicate with the actor.
 * The actors are the core components of the system. They are responsible for taking user inputs and generating outputs.
 * Each actor holds resources, such as LLM memory, tools, database storage, etc.
 */
export interface ActorClient {
  /**
   * The event source of the actor client.
   */
  events: EventEmitter<ActorClientEventMap> & ActorEventSource;

  /**
   * Adds a batch of {@link ActorInput} to the actor's input queue.
   * @param inputs - The batch of inputs to add to the actor's input queue.
   * @returns Promise resolving when the batch of inputs is added to the input queue.
   */
  addInputs(inputs: ActorInput[]): Promise<void>;
}

/**
 * The event map for the actor client.
 */
export interface ActorClientEventMap {
  /**
   * Emitted when the actor has processed the input and generated the output.
   */
  output: ActorMessageEvent[];
}

/**
 * The input to the actor, including text, image, audio, video, etc.
 */
export type ActorInput = ActorTextInput;

/**
 * The text input to the actor.
 */
export interface ActorTextInput {
  /**
   * The kind of the input.
   */
  kind: "text";
  /**
   * The content of the input.
   */
  content: string;
}

/**
 * A event from the actor.
 */
export type ActorEvent = ActorMessageEvent;

/**
 * A message from the actor.
 */
export interface ActorMessageEvent {
  /**
   * The kind of the event.
   */
  kind: "message";
  /**
   * The content of the message.
   */
  content: string;
}

/** Following are extended friendly typings.  */

/**
 * The event source for the actor client.
 */
interface ActorEventSource extends EventEmitter<ActorClientEventMap> {
  /**
   * Subscribes to the actor's output ({@link ActorEvent}).
   * @param event - The event to subscribe to.
   * @param callback - The callback to call when the event is emitted.
   * @returns The actor client.
   */
  on(event: "output", callback: (event: ActorMessageEvent) => void): this;
  /**
   * Unsubscribes from the actor's output ({@link ActorEvent}).
   * @param event - The event to unsubscribe from.
   * @param callback - The callback to unsubscribe from.
   * @returns The actor client.
   */
  off(event: "output", callback: (event: ActorMessageEvent) => void): this;
  /**
   * Subscribes to the actor's output ({@link ActorEvent}) once.
   * @param event - The event to subscribe to.
   * @param callback - The callback to call when the event is emitted.
   * @returns The actor client.
   */
  once(event: "output", callback: (event: ActorMessageEvent) => void): this;
  /**
   * Emits events from the actor.
   * @param events - The events to emit.
   * @returns True if the event was emitted, false otherwise.
   */
  emit(event: "output", ...data: ActorMessageEvent[]): boolean;
}
