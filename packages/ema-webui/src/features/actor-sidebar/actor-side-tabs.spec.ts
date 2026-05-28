import { describe, expect, test } from "vitest";

import {
  deleteActorSideTab,
  readActorSideTabs,
  resolveActorSideTab,
  updateActorSideTab,
  writeActorSideTabs,
} from "./actor-side-tabs";

describe("actor side tab persistence helpers", () => {
  test("resolves each actor tab independently with schedule as the fallback", () => {
    expect(resolveActorSideTab({ "1": "stats", "2": "settings" }, "1")).toBe(
      "stats",
    );
    expect(resolveActorSideTab({ "1": "stats", "2": "settings" }, "2")).toBe(
      "settings",
    );
    expect(resolveActorSideTab({ "1": "stats" }, "3")).toBe("schedule");
  });

  test("updates and deletes a single actor without changing other actor tabs", () => {
    const updated = updateActorSideTab({ "1": "schedule" }, "2", "stats");
    expect(updated).toEqual({ "1": "schedule", "2": "stats" });

    expect(deleteActorSideTab(updated, "1")).toEqual({ "2": "stats" });
  });

  test("ignores invalid stored tab ids", () => {
    const storage = createMemoryStorage({
      "actor-tabs": JSON.stringify({
        "1": "stats",
        "2": "bad",
        "3": 1,
      }),
    });

    expect(readActorSideTabs(storage, "actor-tabs")).toEqual({ "1": "stats" });
  });

  test("writes tab state as JSON", () => {
    const storage = createMemoryStorage();

    writeActorSideTabs(storage, "actor-tabs", { "1": "stats" });

    expect(storage.getItem("actor-tabs")).toBe('{"1":"stats"}');
  });
});

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
