import { describe, expect, test } from "vitest";

import { EmaBus } from "../bus";

describe("EmaBus", () => {
  test("publishes events to all subscribers", () => {
    const bus = new EmaBus();
    const received: string[] = [];

    const unsubscribe = bus.subscribe((event) => {
      received.push(event.type);
    });

    bus.publish(
      bus.createEvent({
        type: "actor.created",
        actorId: 1,
        data: { actorId: 1 },
      }),
    );
    unsubscribe();
    bus.publish(
      bus.createEvent({
        type: "actor.updated",
        actorId: 1,
        data: { actorId: 1 },
      }),
    );

    expect(received).toEqual(["actor.created"]);
  });

  test("supports topic and predicate filters", () => {
    const bus = new EmaBus();
    const topicEvents: string[] = [];
    const actorEvents: string[] = [];

    bus.subscribe("actor.updated", (event) => {
      topicEvents.push(event.type);
    });
    bus.subscribe(
      (event) => event.actorId === 2,
      (event) => {
        actorEvents.push(event.type);
      },
    );

    bus.publish(
      bus.createEvent({
        type: "actor.created",
        actorId: 1,
        data: {},
      }),
    );
    bus.publish(
      bus.createEvent({
        type: "actor.updated",
        actorId: 2,
        data: {},
      }),
    );

    expect(topicEvents).toEqual(["actor.updated"]);
    expect(actorEvents).toEqual(["actor.updated"]);
  });
});
