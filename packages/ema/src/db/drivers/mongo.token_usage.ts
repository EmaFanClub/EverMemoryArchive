import type {
  ActorTokenUsageSummary,
  SummarizeActorTokenUsageRequest,
  TokenUsageDailySummary,
  TokenUsageDB,
  TokenUsageRecordEntity,
  TokenUsageSourceSummary,
} from "../base";
import type { Mongo } from "../mongo";
import {
  addTokenUsageTotals,
  createEmptyTokenUsageTotals,
  TokenUsageSources,
} from "../../token_usage/base";
import { formatTimestamp } from "../../shared/utils";
import { getNextId, omitMongoId } from "../mongo/utils";

export class MongoTokenUsageDB implements TokenUsageDB {
  private readonly mongo: Mongo;
  private readonly $cn = "token_usage_records";
  collections: string[] = [this.$cn];

  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  async createTokenUsageRecord(
    entity: TokenUsageRecordEntity,
  ): Promise<number> {
    const db = this.mongo.getDb();
    const collection = db.collection<TokenUsageRecordEntity>(this.$cn);
    const id = entity.id ?? (await getNextId(this.mongo, this.$cn));
    await collection.insertOne({
      ...entity,
      id,
      createdAt: entity.createdAt ?? Date.now(),
    });
    return id;
  }

  async summarizeActorTokenUsage(
    req: SummarizeActorTokenUsageRequest,
  ): Promise<ActorTokenUsageSummary> {
    if (typeof req.actorId !== "number") {
      throw new Error("actorId must be a number");
    }
    const db = this.mongo.getDb();
    const collection = db.collection<TokenUsageRecordEntity>(this.$cn);
    const filter: any = { actorId: req.actorId };
    if (req.from !== undefined || req.to !== undefined) {
      filter.createdAt = {};
      if (req.from !== undefined) {
        filter.createdAt.$gte = req.from;
      }
      if (req.to !== undefined) {
        filter.createdAt.$lte = req.to;
      }
    }
    const records = (await collection.find(filter).toArray()).map(omitMongoId);
    return summarizeRecords(records);
  }

  async deleteTokenUsageRecordsByActorId(actorId: number): Promise<number> {
    if (typeof actorId !== "number") {
      throw new Error("actorId must be a number");
    }
    const db = this.mongo.getDb();
    const collection = db.collection<TokenUsageRecordEntity>(this.$cn);
    const result = await collection.deleteMany({ actorId });
    return result.deletedCount;
  }

  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<TokenUsageRecordEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ actorId: 1, createdAt: -1 });
    await collection.createIndex({ actorId: 1, source: 1, createdAt: -1 });
  }
}

function summarizeRecords(
  records: TokenUsageRecordEntity[],
): ActorTokenUsageSummary {
  const total = createEmptyTokenUsageTotals();
  const sourceMap = new Map<string, TokenUsageSourceSummary>();
  const dayMap = new Map<string, TokenUsageDailySummary>();

  for (const record of records) {
    addTokenUsageTotals(total, record);

    const sourceBucket =
      sourceMap.get(record.source) ??
      ({
        source: record.source,
        ...createEmptyTokenUsageTotals(),
      } satisfies TokenUsageSourceSummary);
    addTokenUsageTotals(sourceBucket, record);
    sourceMap.set(record.source, sourceBucket);

    const date = formatTimestamp("YYYY-MM-DD", record.createdAt);
    const dayBucket =
      dayMap.get(date) ??
      ({
        date,
        ...createEmptyTokenUsageTotals(),
      } satisfies TokenUsageDailySummary);
    addTokenUsageTotals(dayBucket, record);
    dayMap.set(date, dayBucket);
  }

  const sourceOrder = new Map(
    TokenUsageSources.map((source, index) => [source, index]),
  );
  return {
    total,
    bySource: Array.from(sourceMap.values()).sort(
      (a, b) =>
        (sourceOrder.get(a.source) ?? Number.MAX_SAFE_INTEGER) -
        (sourceOrder.get(b.source) ?? Number.MAX_SAFE_INTEGER),
    ),
    byDay: Array.from(dayMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
  };
}
