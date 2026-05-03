import { GlobalConfig } from "../config";
import type { Server } from "../server";
import type { SetupCommitInput, SetupStatus } from "./types";

const DEFAULT_WEB_USER_ID = 1;

export class SetupController {
  constructor(private readonly server: Server) {}

  async getStatus(): Promise<SetupStatus> {
    const [owner, globalConfig] = await Promise.all([
      this.server.dbService.getDefaultUser(),
      this.server.dbService.globalConfigDB.getGlobalConfig(),
    ]);
    return {
      complete: Boolean(owner && globalConfig),
      owner,
      hasGlobalConfig: Boolean(globalConfig),
    };
  }

  async commit(input: SetupCommitInput): Promise<SetupStatus> {
    const now = Date.now();
    const ownerId = input.owner.id ?? DEFAULT_WEB_USER_ID;
    await this.server.dbService.globalConfigDB.upsertGlobalConfig({
      ...input.globalConfig,
      id: "global",
      version: 1,
      createdAt: input.globalConfig.createdAt ?? now,
      updatedAt: now,
    });
    await this.server.dbService.userDB.upsertUser({
      id: ownerId,
      name: input.owner.name.trim(),
      description: input.owner.description ?? "",
      avatar: input.owner.avatar ?? "",
      updatedAt: now,
    });
    await this.server.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding(
      {
        userId: ownerId,
        channel: "web",
        uid: String(ownerId),
        updatedAt: now,
      },
    );
    for (const binding of input.identityBindings ?? []) {
      const channel = binding.channel.trim();
      const uid = binding.uid.trim();
      if (!channel || !uid || channel === "web") {
        continue;
      }
      await this.server.dbService.externalIdentityBindingDB.upsertExternalIdentityBinding(
        {
          userId: ownerId,
          channel,
          uid,
          updatedAt: now,
        },
      );
    }
    const loaded = await this.server.reloadGlobalConfig();
    if (!loaded || !GlobalConfig.hasRuntimeConfig) {
      throw new Error("Global config was not available after setup commit.");
    }
    await this.server.start();
    return await this.getStatus();
  }
}
