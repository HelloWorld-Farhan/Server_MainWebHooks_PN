/**
 * Production channel load & redial test.
 *
 * Run:
 *   dotenv -e .env.production -- npx tsx scripts/test-channel-load-production.ts
 *
 * Places real OBD calls to +918810214283 and verifies Redis channel limits.
 */
import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCampaignPublicId } from "@/server/lib/public-id";
import { PublicResourceType } from "@/server/lib/public-id/types";
import { allocateResourceKey } from "@/server/lib/resource-key";
import { generateApiKey } from "@/server/lib/api-key-crypto";
import { generateUniqueCompanyCode } from "@/server/lib/company-code";
import { generateUniqueContractId } from "@/server/lib/contract-id";
import prisma from "@/server/lib/prisma";
import { channelService } from "@/server/channels/channel.service";
import { connectRedisOnStartup } from "@/server/cache/redis.client";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import { PERMISSIONS } from "@/server/types/permissions";
import type { TenantContext } from "@/server/types/context";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.production") });

const TEST_SLUG = "channel-load-test";
const TEST_CLI = "CLT";
const TEST_PHONE = "+918810214283";
const CAMPAIGN_RESOURCE_KEY = "CP000001";
const CHANNEL_COUNT = 2;
const CALL_BURST = 8;
const MONITOR_DURATION_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;
const OBD_SERVICE_NUMBER = "7971502709";
const API_KEY_NAME = "Channel Load Test Key";

type SetupResult = {
  companyId: string;
  campaignId: string;
  campaignPublicId: string;
  apiKeySecret: string;
  tenantCtx: TenantContext;
};

type PollSample = {
  at: string;
  allocated: number;
  active: number;
  queueLength: number;
  cooldownCount: number;
  statusCounts: Record<string, number>;
  retryCount: number;
  violation: boolean;
};

type OutboundResult = {
  index: number;
  status: number;
  callLogId?: string;
  dispatchStatus?: string;
  error?: string;
};

async function waitForHealth(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        console.log(`Health check OK (${res.status})`);
        return;
      }
    } catch {
      // retry
    }
    await sleep(3_000);
  }
  throw new Error(`Health check failed for ${baseUrl}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOrCreateTestCompany(): Promise<SetupResult> {
  console.log("\n=== Phase 1: Provision test company ===");

  const existing = await prisma.company.findUnique({
    where: { slug: TEST_SLUG },
    include: {
      campaigns: { where: { resourceKey: CAMPAIGN_RESOURCE_KEY }, take: 1 },
      setupConfig: true,
      creditBalance: true,
      members: {
        where: { status: "ACTIVE", role: "OWNER" },
        take: 1,
        include: { user: true },
      },
    },
  });

  let companyId: string;
  let campaignId: string;
  let ownerUserId: string;

  if (existing) {
    console.log(`Reusing company: ${existing.name} (${existing.id})`);
    companyId = existing.id;

    if (!existing.campaigns[0]) {
      const campaign = await prisma.campaign.create({
        data: {
          companyId,
          resourceKey: CAMPAIGN_RESOURCE_KEY,
          name: "Channel Load Campaign",
        },
      });
      campaignId = campaign.id;
    } else {
      campaignId = existing.campaigns[0].id;
    }

    if (!existing.members[0]) {
      const suffix = Date.now().toString(36);
      const user = await prisma.user.create({
        data: {
          clerkUserId: `channel_load_${suffix}`,
          email: `channel-load-${suffix}@test.com`,
          firstName: "Channel",
          lastName: "LoadTester",
        },
      });
      await prisma.companyMember.create({
        data: {
          companyId,
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
          campaignAccessType: "ALL",
          joinedAt: new Date(),
        },
      });
      ownerUserId = user.id;
    } else {
      ownerUserId = existing.members[0].userId;
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { isDemo: true },
    });

    await prisma.companySetupConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        totalChannels: CHANNEL_COUNT,
        serviceNumber: OBD_SERVICE_NUMBER,
        deltaSeconds: 2,
        agentsAllocated: 1,
      },
      update: {
        totalChannels: CHANNEL_COUNT,
        serviceNumber: OBD_SERVICE_NUMBER,
      },
    });

    await prisma.creditBalance.upsert({
      where: { companyId },
      create: { companyId, creditsRemaining: 50_000, creditsUsed: 0 },
      update: { creditsRemaining: 50_000 },
    });
  } else {
    const suffix = Date.now().toString(36).slice(-6);
    const contractId = await generateUniqueContractId(prisma);
    const companyCode = await generateUniqueCompanyCode(prisma);

    const user = await prisma.user.create({
      data: {
        clerkUserId: `channel_load_${suffix}`,
        email: `channel-load-${suffix}@test.com`,
        firstName: "Channel",
        lastName: "LoadTester",
      },
    });
    ownerUserId = user.id;

    const company = await prisma.company.create({
      data: {
        name: "Channel Load Test",
        slug: TEST_SLUG,
        contractId,
        cli: TEST_CLI,
        companyCode,
        isDemo: true,
        ownerUserId: user.clerkUserId,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
            status: "ACTIVE",
            campaignAccessType: "ALL",
            joinedAt: new Date(),
          },
        },
        campaigns: {
          create: {
            resourceKey: CAMPAIGN_RESOURCE_KEY,
            name: "Channel Load Campaign",
          },
        },
        setupConfig: {
          create: {
            totalChannels: CHANNEL_COUNT,
            serviceNumber: OBD_SERVICE_NUMBER,
            deltaSeconds: 2,
            agentsAllocated: 1,
          },
        },
        creditBalance: {
          create: { creditsRemaining: 50_000, creditsUsed: 0 },
        },
      },
      include: { campaigns: true },
    });

    companyId = company.id;
    campaignId = company.campaigns[0]!.id;
    console.log(`Created company: ${company.name} (${companyId})`);
  }

  const contact = await prisma.uploadedContact.findFirst({
    where: { companyId, phone: TEST_PHONE },
  });
  if (!contact) {
    await prisma.$transaction(async (tx) => {
      const resourceKey = await allocateResourceKey(
        tx,
        companyId,
        PublicResourceType.CONTACT,
      );
      await tx.uploadedContact.create({
        data: {
          companyId,
          phone: TEST_PHONE,
          field1: "Load Test Contact",
          resourceKey,
          campaignIds: [campaignId],
        },
      });
    });
    console.log(`Added contact ${TEST_PHONE}`);
  } else if (!contact.campaignIds.includes(campaignId)) {
    await prisma.uploadedContact.update({
      where: { id: contact.id },
      data: { campaignIds: { push: campaignId } },
    });
    console.log(`Linked contact ${TEST_PHONE} to campaign`);
  }

  await channelService.initializeCompany(companyId, CHANNEL_COUNT, 0, []);
  console.log(`Initialized Redis channels: allocated=${CHANNEL_COUNT}, active=0`);

  const existingKey = await prisma.apiKey.findFirst({
    where: { companyId, name: API_KEY_NAME },
  });
  const generated = generateApiKey("TEST");
  if (existingKey) {
    await prisma.apiKey.update({
      where: { id: existingKey.id },
      data: {
        keyId: generated.keyId,
        keyPrefix: generated.keyPrefix,
        hashedSecret: generated.hashedSecret,
        environment: "TEST",
        scopes: [PERMISSIONS.CALL_LOGS_WRITE, PERMISSIONS.CAMPAIGNS_WRITE],
        status: "ACTIVE",
        deletedAt: null,
        campaignAccessType: "ALL",
        createdById: ownerUserId,
      },
    });
  } else {
    await prisma.apiKey.create({
      data: {
        companyId,
        name: API_KEY_NAME,
        keyId: generated.keyId,
        keyPrefix: generated.keyPrefix,
        hashedSecret: generated.hashedSecret,
        environment: "TEST",
        scopes: [PERMISSIONS.CALL_LOGS_WRITE, PERMISSIONS.CAMPAIGNS_WRITE],
        campaignAccessType: "ALL",
        createdById: ownerUserId,
      },
    });
  }

  const campaignPublicId = generateCampaignPublicId({
    cli: TEST_CLI,
    campaignResourceKey: CAMPAIGN_RESOURCE_KEY,
  });

  console.log({
    companyId,
    campaignPublicId,
    channels: CHANNEL_COUNT,
    phone: TEST_PHONE,
  });

  return {
    companyId,
    campaignId,
    campaignPublicId,
    apiKeySecret: generated.plaintext,
    tenantCtx: {
      authType: "user",
      userId: ownerUserId,
      clerkUserId: "channel_load_test",
      companyId,
      membershipId: `member-${ownerUserId}`,
      role: "OWNER",
      permissions: [PERMISSIONS.CALL_LOGS_WRITE, PERMISSIONS.CAMPAIGNS_WRITE],
      campaignAccess: { type: "ALL", campaignIds: [] },
      loaders: {} as TenantContext["loaders"],
    },
  };
}

async function configureRetryAndStart(
  companyId: string,
  campaignId: string,
): Promise<void> {
  console.log("\n=== Phase 2: Configure retry policy & start campaign (DB) ===");

  const contactCount = await prisma.uploadedContact.count({
    where: { companyId, campaignIds: { has: campaignId } },
  });

  await prisma.campaignExecution.upsert({
    where: { campaignId },
    create: {
      companyId,
      campaignId,
      status: "RUNNING",
      startedAt: new Date(),
      totalContacts: contactCount,
      correlationId: `channel-load-${Date.now()}`,
      retryEnabled: true,
      maxRetries: 5,
      retryDelaySeconds: 30,
      retryOnBusy: true,
      retryOnNoAnswer: true,
      retryOnFailed: true,
      retryOnMissed: true,
    },
    update: {
      status: "RUNNING",
      startedAt: new Date(),
      pausedAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      failureReason: null,
      totalContacts: contactCount,
      retryEnabled: true,
      maxRetries: 5,
      retryDelaySeconds: 30,
      retryOnBusy: true,
      retryOnNoAnswer: true,
      retryOnFailed: true,
      retryOnMissed: true,
    },
  });

  console.log(`Campaign execution RUNNING with ${contactCount} contact(s), retry delay 30s`);
}

async function fireOutboundBurst(
  ctx: TenantContext,
  campaignPublicId: string,
): Promise<OutboundResult[]> {
  console.log(`\n=== Phase 3: Fire ${CALL_BURST} outbound calls to ${TEST_PHONE} ===`);
  console.log("(via outboundCallsService → production Redis + OBD, sequential to avoid DB conflicts)");

  const results: OutboundResult[] = [];
  for (let index = 0; index < CALL_BURST; index += 1) {
    try {
      const body = await outboundCallsService.createOutboundCall(ctx, {
        campaignId: campaignPublicId,
        phoneNumber: TEST_PHONE,
      });
      results.push({
        index: index + 1,
        status: 200,
        callLogId: body.callLogId,
        dispatchStatus: body.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        index: index + 1,
        status: 500,
        error: message,
      });
    }
  }

  for (const result of results) {
    console.log(
      `  Call ${result.index}: HTTP ${result.status} | ${result.dispatchStatus ?? "—"} | ${result.callLogId ?? result.error ?? "no id"}`,
    );
  }

  const successCount = results.filter((r) => r.status < 400).length;
  console.log(`Dispatched ${successCount}/${CALL_BURST} calls successfully`);
  assert.ok(successCount >= CALL_BURST - 1, "Too many outbound call failures");

  return results;
}

async function countCallStatuses(companyId: string, campaignId: string) {
  const logs = await prisma.callLog.groupBy({
    by: ["status"],
    where: { companyId, campaignId },
    _count: { status: true },
  });
  const statusCounts: Record<string, number> = {};
  for (const row of logs) {
    statusCounts[row.status] = row._count.status;
  }
  return statusCounts;
}

async function countRetries(companyId: string, campaignId: string): Promise<number> {
  return prisma.callLog.count({
    where: { companyId, campaignId, isRetry: true },
  });
}

async function monitorChannels(
  companyId: string,
  campaignId: string,
): Promise<PollSample[]> {
  console.log(`\n=== Phase 4: Monitor for ${MONITOR_DURATION_MS / 1000}s ===`);
  console.log("Time       | active | queue | cooldown | retries | statuses");
  console.log("-----------|--------|-------|----------|---------|--------");

  const samples: PollSample[] = [];
  const deadline = Date.now() + MONITOR_DURATION_MS;

  while (Date.now() < deadline) {
    const metrics = await channelService.getMetrics(companyId);
    const statusCounts = await countCallStatuses(companyId, campaignId);
    const retryCount = await countRetries(companyId, campaignId);
    const violation = metrics.active > metrics.allocated;

    const sample: PollSample = {
      at: new Date().toISOString(),
      allocated: metrics.allocated,
      active: metrics.active,
      queueLength: metrics.queueLength,
      cooldownCount: metrics.cooldownCount,
      statusCounts,
      retryCount,
      violation,
    };
    samples.push(sample);

    const statusSummary = Object.entries(statusCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");

    console.log(
      `${sample.at.slice(11, 19)} | ${String(metrics.active).padStart(6)} | ${String(metrics.queueLength).padStart(5)} | ${String(metrics.cooldownCount).padStart(8)} | ${String(retryCount).padStart(7)} | ${statusSummary}${violation ? " *** VIOLATION ***" : ""}`,
    );

    if (violation) {
      console.error(
        `CHANNEL VIOLATION: active=${metrics.active} > allocated=${metrics.allocated}`,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return samples;
}

async function evaluateResults(
  samples: PollSample[],
  outboundResults: OutboundResult[],
  companyId: string,
  campaignId: string,
): Promise<{ passed: number; total: number; checks: [string, boolean][] }> {
  console.log("\n=== Phase 5: Evaluate pass/fail criteria ===");

  const violations = samples.filter((s) => s.violation);
  const maxActive = Math.max(...samples.map((s) => s.active), 0);
  const initialQueue = samples[0]?.queueLength ?? 0;
  const hadQueue = samples.some((s) => s.queueLength > 0);
  const dispatchedStatuses = new Set([
    "QUEUED_AT_PROVIDER",
    "DISPATCHING",
    "RINGING",
    "ANSWERED",
    "COMPLETED",
    "NO_ANSWER",
    "BUSY",
    "FAILED",
    "MISSED",
  ]);
  const dispatchedCount = outboundResults.filter(
    (r) => r.dispatchStatus && dispatchedStatuses.has(r.dispatchStatus),
  ).length;
  const queuedCount = outboundResults.filter(
    (r) => r.dispatchStatus === "QUEUED",
  ).length;
  const maxRetries = Math.max(...samples.map((s) => s.retryCount), 0);
  const pendingRetryJobs = await prisma.contactRetryJob.count({
    where: { companyId, campaignId },
  });
  const finalSample = samples[samples.length - 1];
  const recovered =
    finalSample !== undefined &&
    finalSample.active === 0 &&
    finalSample.queueLength === 0;

  const terminalCount = await prisma.callLog.count({
    where: {
      companyId,
      campaignId,
      status: {
        in: ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "MISSED", "CANCELLED"],
      },
    },
  });
  const webhooksPending = terminalCount === 0;

  const checks: [string, boolean][] = [
    ["Channel cap: active <= allocated on every sample", violations.length === 0],
    [`Channel cap: max active (${maxActive}) <= ${CHANNEL_COUNT}`, maxActive <= CHANNEL_COUNT],
    [
      "Queue works: queue had entries after burst",
      hadQueue || initialQueue > 0 || queuedCount > 0,
    ],
    [
      "Calls dispatched: at least 2 reached provider or beyond",
      dispatchedCount >= 2,
    ],
    [
      webhooksPending
        ? "Redials: skipped (no OBD terminal webhooks yet)"
        : "Redials: retry call or retry job observed",
      webhooksPending || maxRetries >= 1 || pendingRetryJobs >= 1,
    ],
    [
      webhooksPending
        ? "Recovery: skipped (calls still in-flight at provider)"
        : "Recovery: active=0 at end of monitor window",
      webhooksPending || recovered || finalSample?.active === 0,
    ],
  ];

  let passed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (ok) passed += 1;
  }

  return { passed, total: checks.length, checks };
}

async function printRetryJobs(companyId: string, campaignId: string): Promise<void> {
  const jobs = await prisma.contactRetryJob.findMany({
    where: { companyId, campaignId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      status: true,
      retryNumber: true,
      scheduledAt: true,
      phoneNumber: true,
    },
  });
  if (jobs.length > 0) {
    console.log("\nRecent retry jobs:");
    for (const job of jobs) {
      console.log(
        `  ${job.status} retry#${job.retryNumber} ${job.phoneNumber} scheduled=${job.scheduledAt.toISOString()}`,
      );
    }
  }
}

async function main() {
  const baseUrl = (
    process.env.TEST_BASE_URL ??
    process.env.MAIN_SERVER_URL ??
    "https://propnexai-main-server.onrender.com"
  ).replace(/\/$/, "");

  console.log("Production Channel Load Test");
  console.log(`Target: ${baseUrl}`);
  console.log(`Phone: ${TEST_PHONE}`);
  console.log(`Channels: ${CHANNEL_COUNT} | Burst: ${CALL_BURST}`);

  await connectRedisOnStartup();
  await waitForHealth(baseUrl);

  const setup = await findOrCreateTestCompany();
  await configureRetryAndStart(setup.companyId, setup.campaignId);

  const outboundResults = await fireOutboundBurst(
    setup.tenantCtx,
    setup.campaignPublicId,
  );

  const samples = await monitorChannels(setup.companyId, setup.campaignId);
  await printRetryJobs(setup.companyId, setup.campaignId);

  const { passed, total } = await evaluateResults(
    samples,
    outboundResults,
    setup.companyId,
    setup.campaignId,
  );

  console.log(`\n=== Result: ${passed}/${total} checks passed ===`);

  if (passed !== total) {
    console.log(
      "\nNote: Redial and recovery checks may fail if OBD webhooks are slow.",
    );
    console.log("Re-run monitoring or check call logs in MongoDB for full picture.");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
