import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentEvents, type AgentEventContent } from "./agent";
import { ToolResult } from "./tools/base";
import { Config } from "./config";
import type {
  ActorDB,
  ActorEntity,
  LongTermMemoryDB,
  LongTermMemoryEntity,
  LongTermMemorySearcher,
  ListLongTermMemoriesRequest,
  SearchLongTermMemoriesRequest,
  ShortTermMemoryDB,
  ShortTermMemoryEntity,
  ListShortTermMemoriesRequest,
} from "./db";
import { ActorWorker, isAgentEvent } from "./actor";

// Minimal in-memory implementations to satisfy ActorWorker dependencies.
class InMemoryActorDB implements ActorDB {
  private store = new Map<number, ActorEntity>();

  async listActors(): Promise<ActorEntity[]> {
    return Array.from(this.store.values());
  }

  async getActor(id: number): Promise<ActorEntity | null> {
    return this.store.get(id) ?? null;
  }

  async upsertActor(entity: ActorEntity): Promise<number> {
    const id = entity.id ?? 1;
    this.store.set(id, { ...entity, id });
    return id;
  }

  async deleteActor(id: number): Promise<boolean> {
    return this.store.delete(id);
  }
}

class InMemoryShortTermMemoryDB implements ShortTermMemoryDB {
  private store: ShortTermMemoryEntity[] = [];

  async listShortTermMemories(
    _req?: ListShortTermMemoriesRequest,
  ): Promise<ShortTermMemoryEntity[]> {
    return [...this.store];
  }

  async appendShortTermMemory(entity: ShortTermMemoryEntity): Promise<number> {
    this.store.push(entity);
    return this.store.length;
  }

  async deleteShortTermMemory(_id: number): Promise<boolean> {
    return true;
  }
}

class InMemoryLongTermMemoryDB implements LongTermMemoryDB {
  private store: LongTermMemoryEntity[] = [];

  async listLongTermMemories(
    _req?: ListLongTermMemoriesRequest,
  ): Promise<LongTermMemoryEntity[]> {
    return [...this.store];
  }

  async appendLongTermMemory(entity: LongTermMemoryEntity): Promise<number> {
    this.store.push(entity);
    return this.store.length;
  }

  async deleteLongTermMemory(_id: number): Promise<boolean> {
    return true;
  }
}

class NoopLongTermMemorySearcher implements LongTermMemorySearcher {
  async searchLongTermMemories(
    _req: SearchLongTermMemoriesRequest,
  ): Promise<(LongTermMemoryEntity & { createdAt: number })[]> {
    return [];
  }
}

async function main(): Promise<void> {
  const actorId = 1;
  const actor = new ActorWorker(
    Config.load(),
    actorId,
    new InMemoryActorDB(),
    new InMemoryShortTermMemoryDB(),
    new InMemoryLongTermMemoryDB(),
    new NoopLongTermMemorySearcher(),
  );

  actor.subscribe((response) => {
    const last = response.events.at(-1);
    if (isAgentEvent(last, AgentEvents.emaReplyReceived)) {
      const reply = last.content.reply;
      console.log(`[${reply.expression}][${reply.action}](${reply.think})`);
      console.log(`EMA > ${reply.response}`);
    }
  });

  const rl = readline.createInterface({ input, output });
  rl.on("SIGINT", () => {
    rl.close();
    process.exit(0);
  });

  for (;;) {
    const userInput = (await rl.question("\nYOU > ")).trim();
    if (!userInput) {
      continue;
    }
    if (userInput === "/exit" || userInput === "/quit") {
      break;
    }
    await actor.work([{ kind: "text", content: userInput }]);
  }

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error in run_actor:", err);
  process.exit(1);
});
