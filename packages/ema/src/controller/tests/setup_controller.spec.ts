import { afterEach, describe, expect, test, vi } from "vitest";

import { GlobalConfig } from "../../config";
import { createTestGlobalConfigRecord } from "../../config/tests/helpers";
import { SetupController } from "../setup_controller";

describe("SetupController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("commits owner identity bindings", async () => {
    const globalConfig = createTestGlobalConfigRecord();
    const owner = {
      id: 1,
      name: "Disviel",
      description: "",
      avatar: "",
    };
    const server = {
      dbService: {
        globalConfigDB: {
          upsertGlobalConfig: vi.fn(async () => {}),
          getGlobalConfig: vi.fn(async () => globalConfig),
        },
        userDB: {
          upsertUser: vi.fn(async () => {}),
        },
        externalIdentityBindingDB: {
          upsertExternalIdentityBinding: vi.fn(async () => 1),
        },
        getDefaultUser: vi.fn(async () => owner),
      },
      reloadGlobalConfig: vi.fn(async () => true),
      start: vi.fn(async () => {}),
    };
    vi.spyOn(GlobalConfig, "hasRuntimeConfig", "get").mockReturnValue(true);

    await new SetupController(server as never).commit({
      owner: { name: "Disviel" },
      globalConfig,
      identityBindings: [{ channel: "qq", uid: "12345" }],
    });

    expect(
      server.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 1,
        channel: "web",
        uid: "1",
      }),
    );
    expect(
      server.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 1,
        channel: "qq",
        uid: "12345",
      }),
    );
  });
});
