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
  createEmptyTokenUsageTotals,
  TokenUsageSources,
  type TokenUsageTotals,
} from "../../token_usage/base";
import { getNextId } from "../mongo/utils";

type TokenUsageAggregationResult = {
  total: TokenUsageTotals[];
  bySource: TokenUsageSourceSummary[];
  byDay: TokenUsageDailySummary[];
};

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
    const filter: Record<string, unknown> = { actorId: req.actorId };
    if (req.from !== undefined || req.to !== undefined) {
      const createdAtFilter: Record<string, number> = {};
      if (req.from !== undefined) {
        createdAtFilter.$gte = req.from;
      }
      if (req.to !== undefined) {
        createdAtFilter.$lte = req.to;
      }
      filter.createdAt = createdAtFilter;
    }
    const [summary] = await collection
      .aggregate<TokenUsageAggregationResult>([
        { $match: filter },
        {
          $facet: {
            total: [
              { $group: buildTokenUsageGroupStage(null) },
              { $project: { _id: 0 } },
            ],
            bySource: [
              { $group: buildTokenUsageGroupStage("$source") },
              {
                $project: {
                  _id: 0,
                  source: "$_id",
                  cacheReadTokens: 1,
                  cacheWriteTokens: 1,
                  outputTokens: 1,
                  totalTokens: 1,
                },
              },
            ],
            byDay: [
              {
                $group: buildTokenUsageGroupStage({
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: { $toDate: "$createdAt" },
                    timezone: getLocalTimezone(),
                  },
                }),
              },
              {
                $project: {
                  _id: 0,
                  date: "$_id",
                  cacheReadTokens: 1,
                  cacheWriteTokens: 1,
                  outputTokens: 1,
                  totalTokens: 1,
                },
              },
              { $sort: { date: 1 } },
            ],
          },
        },
      ])
      .toArray();
    return normalizeAggregationResult(summary);
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

function normalizeAggregationResult(
  summary: TokenUsageAggregationResult | undefined,
): ActorTokenUsageSummary {
  const sourceOrder = new Map(
    TokenUsageSources.map((source, index) => [source, index]),
  );
  return {
    total: summary?.total[0] ?? createEmptyTokenUsageTotals(),
    bySource: [...(summary?.bySource ?? [])].sort(
      (a, b) =>
        (sourceOrder.get(a.source) ?? Number.MAX_SAFE_INTEGER) -
        (sourceOrder.get(b.source) ?? Number.MAX_SAFE_INTEGER),
    ),
    byDay: summary?.byDay ?? [],
  };
}

function buildTokenUsageGroupStage(id: unknown) {
  return {
    _id: id,
    cacheReadTokens: { $sum: "$cacheReadTokens" },
    cacheWriteTokens: { $sum: "$cacheWriteTokens" },
    outputTokens: { $sum: "$outputTokens" },
    totalTokens: { $sum: "$totalTokens" },
  };
}

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
