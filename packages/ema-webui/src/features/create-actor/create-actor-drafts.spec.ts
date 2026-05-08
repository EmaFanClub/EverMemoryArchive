import { describe, expect, test } from "vitest";

import {
  createInitialCreateActorDrafts,
  patchCreateActorDraft,
} from "./create-actor-drafts";

describe("create actor drafts", () => {
  test("creates independent drafts for each source", () => {
    const drafts = createInitialCreateActorDrafts();

    expect(drafts.blank).not.toBe(drafts.history);
    expect(drafts.blank.mbtiAxes).not.toBe(drafts.history.mbtiAxes);
    expect(drafts.blank.selectedTraits).not.toBe(drafts.history.selectedTraits);
  });

  test("updates only the selected source draft", () => {
    const drafts = createInitialCreateActorDrafts();

    const updated = patchCreateActorDraft(drafts, "history", {
      actorName: "亚托莉",
      roleBook: "history role book",
    });

    expect(updated.history.actorName).toBe("亚托莉");
    expect(updated.history.roleBook).toBe("history role book");
    expect(updated.blank.actorName).toBe("");
    expect(updated.blank.roleBook).toBe("");
    expect(updated.blank).toBe(drafts.blank);
  });

  test("keeps repeated source edits isolated", () => {
    const drafts = createInitialCreateActorDrafts();

    const withHistory = patchCreateActorDraft(drafts, "history", (draft) => ({
      selectedTraits: [...draft.selectedTraits, "quiet"],
    }));
    const withBlank = patchCreateActorDraft(withHistory, "blank", {
      actorName: "空白角色",
    });

    expect(withBlank.history.selectedTraits).toEqual(["quiet"]);
    expect(withBlank.history.actorName).toBe("");
    expect(withBlank.blank.actorName).toBe("空白角色");
    expect(withBlank.blank.selectedTraits).toEqual([]);
  });
});
