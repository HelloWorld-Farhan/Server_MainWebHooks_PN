/**
 * One-time NIR company channel state reset (DB + Redis).
 *
 * Usage:
 *   npx tsx scripts/reset-nir-channel-state.mjs
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.production"), override: true });

const COMPANY_ID = "6a61c642d2203642e875ec2a";
const FORCE_FAIL_PUBLIC_IDS = [
  "v1.NIR.CP000001.CL00000067",
  "v1.NIR.CP000001.CL00000001",
];

const STALE_DISPATCHING_MS = 2 * 60 * 1000;
const STALE_QUEUED_AT_PROVIDER_MS = 2 * 60 * 1000;

const ACTIVE_STATUSES = [
  "DISPATCHING",
  "QUEUED_AT_PROVIDER",
  "RINGING",
  "ANSWERED",
];

const prisma = new PrismaClient();

function channelKeys(companyId) {
  return {
    channels: `company:${companyId}:channels`,
    queue: `company:${companyId}:queue`,
    queueDedup: `company:${companyId}:queue:dedup`,
    cooldown: `company:${companyId}:cooldown`,
  };
}

async function readRedisMetrics(redis, companyId) {
  const keys = channelKeys(companyId);
  const [hash, queueLength, cooldownCount] = await Promise.all([
    redis.hgetall(keys.channels),
    redis.llen(keys.queue),
    redis.zcard(keys.cooldown),
  ]);
  return {
    allocated: Number(hash.allocated ?? 0),
    active: Number(hash.active ?? 0),
    queueLength,
    cooldownCount,
  };
}

async function main() {
  const company = await prisma.company.findUnique({
    where: { id: COMPANY_ID },
    select: {
      id: true,
      name: true,
      setupConfig: { select: { totalChannels: true, serviceNumber: true } },
    },
  });
  if (!company) {
    throw new Error(`Company not found: ${COMPANY_ID}`);
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
    lazyConnect: true,
  });
  await redis.connect();

  const beforeDb = {
    active: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: { in: ACTIVE_STATUSES } },
    }),
    queued: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: "QUEUED" },
    }),
    dispatching: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: "DISPATCHING" },
    }),
    queuedAtProvider: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: "QUEUED_AT_PROVIDER" },
    }),
  };
  const beforeRedis = await readRedisMetrics(redis, COMPANY_ID);

  console.log("BEFORE", JSON.stringify({ company, beforeDb, beforeRedis }, null, 2));

  const now = Date.now();
  const staleDispatchingBefore = new Date(now - STALE_DISPATCHING_MS);
  const staleQueuedAtProviderBefore = new Date(
    now - STALE_QUEUED_AT_PROVIDER_MS,
  );

  const forced = await prisma.callLog.updateMany({
    where: {
      companyId: COMPANY_ID,
      publicId: { in: FORCE_FAIL_PUBLIC_IDS },
      status: { in: ["DISPATCHING", "QUEUED_AT_PROVIDER"] },
    },
    data: {
      status: "FAILED",
      providerCompletedAt: new Date(),
      disconnectReason: "NIR channel reset (force-fail stuck call)",
    },
  });

  const staleDispatching = await prisma.callLog.updateMany({
    where: {
      companyId: COMPANY_ID,
      status: "DISPATCHING",
      OR: [
        { providerRequestedAt: { lt: staleDispatchingBefore } },
        {
          providerRequestedAt: null,
          updatedAt: { lt: staleDispatchingBefore },
        },
      ],
    },
    data: {
      status: "FAILED",
      providerCompletedAt: new Date(),
      disconnectReason: "Stale DISPATCHING cleanup",
    },
  });

  const staleQueuedRows = await prisma.callLog.findMany({
    where: {
      companyId: COMPANY_ID,
      status: "QUEUED_AT_PROVIDER",
      startedAt: { lt: staleQueuedAtProviderBefore },
    },
    select: { id: true, endedAt: true },
  });
  const staleQueuedIds = staleQueuedRows
    .filter((row) => row.endedAt == null)
    .map((row) => row.id);
  const staleQueuedAtProvider =
    staleQueuedIds.length === 0
      ? { count: 0 }
      : await prisma.callLog.updateMany({
          where: {
            companyId: COMPANY_ID,
            id: { in: staleQueuedIds },
            status: "QUEUED_AT_PROVIDER",
          },
          data: {
            status: "FAILED",
            providerCompletedAt: new Date(),
            disconnectReason:
              "Stale QUEUED_AT_PROVIDER cleanup (no webhook)",
          },
        });

  const allocated = company.setupConfig?.totalChannels ?? 0;
  const queuedIds = (
    await prisma.callLog.findMany({
      where: { companyId: COMPANY_ID, status: "QUEUED" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
  ).map((row) => row.id);

  const keys = channelKeys(COMPANY_ID);
  const pipeline = redis.pipeline();
  pipeline.del(keys.queue, keys.queueDedup, keys.cooldown);
  pipeline.hset(keys.channels, {
    allocated: String(allocated),
    active: "0",
  });
  for (const callLogId of queuedIds) {
    pipeline.sadd(keys.queueDedup, callLogId);
    pipeline.rpush(keys.queue, callLogId);
  }
  await pipeline.exec();

  const afterDb = {
    active: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: { in: ACTIVE_STATUSES } },
    }),
    queued: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: "QUEUED" },
    }),
    dispatching: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: "DISPATCHING" },
    }),
    queuedAtProvider: await prisma.callLog.count({
      where: { companyId: COMPANY_ID, status: "QUEUED_AT_PROVIDER" },
    }),
  };
  const afterRedis = await readRedisMetrics(redis, COMPANY_ID);

  console.log(
    "AFTER",
    JSON.stringify(
      {
        cleanup: {
          forcedFail: forced.count,
          staleDispatching: staleDispatching.count,
          staleQueuedAtProvider: staleQueuedAtProvider.count,
        },
        afterDb,
        afterRedis,
      },
      null,
      2,
    ),
  );

  redis.disconnect();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
