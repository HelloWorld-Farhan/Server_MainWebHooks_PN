import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";

import { contactCompletionService } from "@/server/campaign-execution/retry/contact-completion.service";
import { campaignExecutionConfig } from "@/server/campaign-execution/campaign-execution.config";
import { campaignExecutionLockService } from "@/server/campaign-execution/campaign-execution-lock.service";
import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";
import { campaignProgressService } from "@/server/campaign-execution/campaign-progress.service";
import { campaignRunnerService } from "@/server/campaign-execution/campaign-runner.service";
import { campaignSchedulerService } from "@/server/campaign-execution/campaign-scheduler.service";
import { isRedisAvailable, redis } from "@/server/cache/redis.client";
import { generateCampaignPublicId } from "@/server/lib/public-id";
import { resolveResourceId } from "@/server/lib/public-id/mapper";
import { PublicResourceType } from "@/server/lib/public-id/types";
import prisma from "@/server/lib/prisma";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";

function randomCli() {
  return Array.from({ length: 3 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join("");
}

function randomCompanyCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function randomCampaignResourceKey() {
  return `CP${String(Math.floor(Math.random() * 999999) + 1).padStart(6, "0")}`;
}

function createMockCtx(companyId: string, userId: string): TenantContext {
  return {
    authType: "user",
    userId,
    clerkUserId: `user_${Math.random().toString(36).slice(2, 8)}`,
    companyId,
    membershipId: `member-${userId}`,
    role: "OWNER",
    permissions: [
      PERMISSIONS.CAMPAIGNS_READ,
      PERMISSIONS.CAMPAIGNS_WRITE,
      PERMISSIONS.CALL_LOGS_WRITE,
    ],
    campaignAccess: { type: "ALL", campaignIds: [] },
    loaders: {} as TenantContext["loaders"],
  };
}

async function seedContacts(
  companyId: string,
  campaignId: string,
  phones: string[],
) {
  for (const phone of phones) {
    const resourceKey = `CT${String(Math.floor(Math.random() * 999999) + 1).padStart(6, "0")}`;
    await prisma.uploadedContact.create({
      data: {
        companyId,
        phone,
        resourceKey,
        campaignIds: [campaignId],
      },
    });
  }
}

describe("Campaign execution engine", () => {
  let companyId: string;
  let userId: string;
  let ctx: TenantContext;
  let campaignId: string;
  let campaignPublicId: string;
  let companyCli: string;
  let companyCode: string;
  let originalBatchSize: number;
  let outboundCallsCreated = 0;

  async function runUntilOutboundCount(target: number, maxTicks = 10) {
    for (let tick = 0; tick < maxTicks && outboundCallsCreated < target; tick += 1) {
      await campaignRunnerService.processRunnableCampaigns();
    }
  }

  before(async () => {
    originalBatchSize = campaignExecutionConfig.batchSize;
    campaignExecutionConfig.maxConcurrentCampaigns = 20;
    campaignExecutionLockService.resetInMemoryForTests();
    campaignRunnerService.resetActiveForTests();
    campaignProgressService.resetSnapshotsForTests();

    await prisma.campaignExecution.updateMany({
      where: { status: { in: ["RUNNING", "PAUSED", "SCHEDULED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        workerId: null,
        lockExpiresAt: null,
      },
    });

    if (isRedisAvailable() && redis) {
      const lockKeys = await redis.keys("campaign:runner-lock:*");
      if (lockKeys.length > 0) {
        await redis.del(...lockKeys);
      }
    }

    const suffix = Math.random().toString(36).slice(2, 8);
    companyCli = randomCli();
    companyCode = randomCompanyCode();

    const user = await prisma.user.create({
      data: {
        clerkUserId: `user_campaign_exec_${suffix}`,
        email: `campaign-exec-${suffix}@test.com`,
        firstName: "Campaign",
        lastName: "Exec",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: `Campaign Exec Co ${suffix}`,
        slug: `campaign-exec-co-${suffix}`,
        contractId: `CE${suffix.toUpperCase()}`.slice(0, 10),
        cli: companyCli,
        companyCode,
        ownerUserId: user.clerkUserId,
      },
    });
    companyId = company.id;

    await prisma.companyMember.create({
      data: {
        companyId,
        userId,
        role: "OWNER",
        status: "ACTIVE",
        campaignAccessType: "ALL",
        joinedAt: new Date(),
      },
    });

    const campaignResourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey: campaignResourceKey,
        name: "Execution Campaign",
      },
    });
    campaignId = campaign.id;
    campaignPublicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey,
    });

    ctx = createMockCtx(companyId, userId);

    mock.method(outboundCallsService, "createOutboundCall", async (callCtx, input) => {
      outboundCallsCreated += 1;
      const phone = input.phoneNumber;
      const uniqueSuffix = `${Date.now()}${outboundCallsCreated}`;
      const internalCampaignId = await resolveResourceId(
        callCtx,
        input.campaignId,
        PublicResourceType.CAMPAIGN,
      );
      const campaignRow = await prisma.campaign.findFirst({
        where: { id: internalCampaignId },
        select: { resourceKey: true },
      });
      const campaignResourceKey = campaignRow!.resourceKey;

      let phoneNumber = await prisma.phoneNumber.findFirst({
        where: { companyId, campaignId: internalCampaignId, number: phone },
      });
      if (!phoneNumber) {
        phoneNumber = await prisma.phoneNumber.create({
          data: {
            companyId,
            campaignId: internalCampaignId,
            number: phone,
            phoneNumberId: `PH${uniqueSuffix}`,
            publicId: `v1.${companyCli}.${campaignResourceKey}.PH${uniqueSuffix}`,
            provider: "PROPNEX",
          },
        });
      }
      const callLogId = `CL${uniqueSuffix}`;
      await prisma.callLog.create({
        data: {
          companyId,
          campaignId: internalCampaignId,
          phoneNumberId: phoneNumber.id,
          callLogId,
          publicId: `v1.${companyCli}.${campaignResourceKey}.${callLogId}`,
          direction: "OUTBOUND",
          status: "COMPLETED",
          startedAt: new Date(),
        },
      });
      return {
        callLogId,
        phoneNumberId: phoneNumber.publicId,
        status: "QUEUED" as const,
      };
    });
  });

  after(async () => {
    campaignExecutionConfig.batchSize = originalBatchSize;
    mock.restoreAll();

    if (companyId) {
      await prisma.contactRetryJob.deleteMany({ where: { companyId } });
      await prisma.callLog.deleteMany({
        where: { companyId, isRetry: true },
      });
      await prisma.callLog.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  afterEach(async () => {
    await prisma.campaignExecution.updateMany({
      where: {
        companyId,
        status: { in: ["RUNNING", "PAUSED", "SCHEDULED"] },
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        workerId: null,
        lockExpiresAt: null,
      },
    });
    campaignRunnerService.resetActiveForTests();
    campaignExecutionLockService.resetInMemoryForTests();
  });

  it("starts immediately and processes contacts in batches", async () => {
    outboundCallsCreated = 0;
    campaignExecutionConfig.batchSize = 2;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Batch ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    await seedContacts(companyId, campaign.id, [
      "+911111111101",
      "+911111111102",
      "+911111111103",
    ]);

    const started = await campaignExecutionService.start(ctx, publicId);
    assert.equal(started.status, "RUNNING");
    assert.equal(started.totalContacts, 3);

    await runUntilOutboundCount(3);
    assert.equal(outboundCallsCreated, 3, `expected 3 outbound calls, got ${outboundCallsCreated}`);

    await contactCompletionService.checkCampaignCompletion(companyId, campaign.id);

    const completed = await campaignExecutionService.getStatus(ctx, publicId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.processedCount, 3);
  });

  it("schedules and promotes due campaigns via scheduler", async () => {
    outboundCallsCreated = 0;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Scheduled ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    await seedContacts(companyId, campaign.id, ["+922222222201"]);

    const scheduledAt = new Date(Date.now() - 60_000).toISOString();
    const scheduled = await campaignExecutionService.schedule(
      ctx,
      publicId,
      scheduledAt,
    );
    assert.equal(scheduled.status, "SCHEDULED");

    const startedCount = await campaignSchedulerService.processDueScheduled();
    assert.equal(startedCount, 1);

    const status = await campaignExecutionService.getStatus(ctx, publicId);
    assert.equal(status.status, "RUNNING");
  });

  it("pauses and resumes without duplicate calls", async () => {
    outboundCallsCreated = 0;
    campaignExecutionConfig.batchSize = 1;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Pause Resume ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    await seedContacts(companyId, campaign.id, [
      "+933333333301",
      "+933333333302",
    ]);

    await campaignExecutionService.start(ctx, publicId);
    await prisma.campaignExecution.updateMany({
      where: { companyId, campaignId: campaign.id },
      data: { retryEnabled: false },
    });
    await runUntilOutboundCount(1);
    assert.equal(outboundCallsCreated, 1);

    await campaignExecutionService.pause(ctx, publicId);
    await campaignRunnerService.processRunnableCampaigns();
    assert.equal(outboundCallsCreated, 1);

    await campaignExecutionService.resume(ctx, publicId);
    await runUntilOutboundCount(2);
    assert.equal(outboundCallsCreated, 2);
  });

  it("cancels queued call logs", async () => {
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Cancel ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });

    await prisma.callLog.create({
      data: {
        companyId,
        campaignId: campaign.id,
        callLogId: `CL${suffix}`,
        publicId: `v1.${companyCli}.${resourceKey}.CL${suffix}`,
        direction: "OUTBOUND",
        status: "QUEUED",
        startedAt: new Date(),
      },
    });

    await campaignExecutionService.start(ctx, publicId);
    await campaignExecutionService.cancel(ctx, publicId);

    const cancelled = await prisma.callLog.findMany({
      where: { companyId, campaignId: campaign.id, status: "CANCELLED" },
    });
    assert.equal(cancelled.length, 1);
  });

  it("prevents duplicate worker locks", async () => {
    const lockCampaignId = `lock-${Date.now()}`;
    const workerA = "worker-a";
    const workerB = "worker-b";

    const first = await campaignExecutionLockService.acquire(
      lockCampaignId,
      workerA,
    );
    const second = await campaignExecutionLockService.acquire(
      lockCampaignId,
      workerB,
    );

    assert.equal(first, true);
    assert.equal(second, false);

    await campaignExecutionLockService.release(lockCampaignId, workerA);
    const third = await campaignExecutionLockService.acquire(
      lockCampaignId,
      workerB,
    );
    assert.equal(third, true);
    await campaignExecutionLockService.release(lockCampaignId, workerB);
  });

  it("updates progress and statistics", async () => {
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Stats ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });

    await prisma.callLog.createMany({
      data: [
        {
          companyId,
          campaignId: campaign.id,
          callLogId: `CL${suffix}1`,
          publicId: `v1.${companyCli}.${resourceKey}.CL${suffix}1`,
          direction: "OUTBOUND",
          status: "QUEUED",
          startedAt: new Date(),
        },
        {
          companyId,
          campaignId: campaign.id,
          callLogId: `CL${suffix}2`,
          publicId: `v1.${companyCli}.${resourceKey}.CL${suffix}2`,
          direction: "OUTBOUND",
          status: "COMPLETED",
          startedAt: new Date(),
        },
      ],
    });

    await campaignExecutionService.start(ctx, publicId);
    await campaignProgressService.updateExecution(companyId, campaign.id);

    const stats = await campaignExecutionService.getStatistics(ctx, publicId);
    assert.equal(stats.queued, 1);
    assert.equal(stats.completed, 1);

    const progress = await campaignExecutionService.getProgress(ctx, publicId);
    assert.ok(progress.percentComplete >= 0);
  });

  it("resumes after lock expiry on stale running execution", async () => {
    outboundCallsCreated = 0;
    campaignExecutionConfig.batchSize = 10;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Recovery ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    await seedContacts(companyId, campaign.id, ["+944444444401"]);

    await campaignExecutionService.start(ctx, publicId);
    await prisma.campaignExecution.updateMany({
      where: { campaignId: campaign.id },
      data: {
        lockExpiresAt: new Date(Date.now() - 60_000),
        lastProcessedContactId: null,
        processedCount: 0,
      },
    });

    await campaignSchedulerService.recoverOnStartup();
    await runUntilOutboundCount(1);
    assert.equal(outboundCallsCreated, 1);
  });

  it("retries a failed campaign and resumes calling", async () => {
    outboundCallsCreated = 0;
    campaignExecutionConfig.batchSize = 10;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Retry ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    await seedContacts(companyId, campaign.id, ["+955555555501"]);

    await campaignExecutionService.start(ctx, publicId);
    await campaignExecutionService.markFailed(
      companyId,
      campaign.id,
      "Simulated runner failure",
    );

    const failed = await campaignExecutionService.getStatus(ctx, publicId);
    assert.equal(failed.status, "FAILED");

    const retried = await campaignExecutionService.retry(ctx, publicId);
    assert.equal(retried.status, "RUNNING");
    assert.equal(retried.failureReason, null);

    await runUntilOutboundCount(1);
    assert.equal(outboundCallsCreated, 1);
  });
});
