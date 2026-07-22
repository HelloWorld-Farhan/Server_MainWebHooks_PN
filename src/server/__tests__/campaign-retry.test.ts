import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { campaignExecutionLockService } from "@/server/campaign-execution/campaign-execution-lock.service";
import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";
import { campaignRunnerService } from "@/server/campaign-execution/campaign-runner.service";
import { contactCompletionService } from "@/server/campaign-execution/retry/contact-completion.service";
import { retrySchedulerService } from "@/server/campaign-execution/retry/retry-scheduler.service";
import { retryWorkerService } from "@/server/campaign-execution/retry/retry-worker.service";
import { generateCampaignPublicId } from "@/server/lib/public-id";
import { resolveResourceId } from "@/server/lib/public-id/mapper";
import { PublicResourceType } from "@/server/lib/public-id/types";
import prisma from "@/server/lib/prisma";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";

process.env.DEFAULT_RETRY_DELAY_SECONDS = "0";
process.env.RETRY_WORKER_INTERVAL_MS = "50";

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

async function createOutboundCallLog(input: {
  companyId: string;
  campaignId: string;
  campaignResourceKey: string;
  companyCli: string;
  phone: string;
  status: "BUSY" | "NO_ANSWER" | "FAILED" | "COMPLETED" | "ANSWERED";
  retryNumber?: number;
  parentCallLogId?: string;
  isRetry?: boolean;
}) {
  const callLogsRepo = new CallLogsRepository(prisma);
  let phoneNumber = await prisma.phoneNumber.findFirst({
    where: {
      companyId: input.companyId,
      campaignId: input.campaignId,
      number: input.phone,
    },
  });
  if (!phoneNumber) {
    phoneNumber = await prisma.phoneNumber.create({
      data: {
        companyId: input.companyId,
        campaignId: input.campaignId,
        number: input.phone,
        phoneNumberId: `PH${Date.now()}`,
        publicId: `v1.${input.companyCli}.${input.campaignResourceKey}.PH${Date.now()}`,
        provider: "PROPNEX",
      },
    });
  }

  return prisma.$transaction(async (tx) =>
    callLogsRepo.createOutboundPending(tx, {
      companyId: input.companyId,
      campaignId: input.campaignId,
      phoneNumberId: phoneNumber!.id,
      campaignResourceKey: input.campaignResourceKey,
      companyCli: input.companyCli,
      retryNumber: input.retryNumber,
      parentCallLogId: input.parentCallLogId,
      isRetry: input.isRetry,
      retryReason: input.isRetry ? input.status : undefined,
    }).then(async (callLog) => {
      await tx.callLog.update({
        where: { id: callLog.id },
        data: { status: input.status },
      });
      return { ...callLog, status: input.status };
    }),
  );
}

describe("Campaign retry engine", () => {
  let companyId: string;
  let userId: string;
  let ctx: TenantContext;
  let campaignId: string;
  let campaignPublicId: string;
  let campaignResourceKey: string;
  let companyCli: string;
  let companyCode: string;
  const phone = "+919876543210";
  let retryCallsCreated = 0;

  before(async () => {
    campaignExecutionLockService.resetInMemoryForTests();
    campaignRunnerService.resetActiveForTests();

    const suffix = Math.random().toString(36).slice(2, 8);
    companyCli = randomCli();
    companyCode = randomCompanyCode();

    const user = await prisma.user.create({
      data: {
        clerkUserId: `user_retry_${suffix}`,
        email: `retry-${suffix}@test.com`,
        firstName: "Retry",
        lastName: "Test",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: `Retry Co ${suffix}`,
        slug: `retry-co-${suffix}`,
        contractId: `RT${suffix.toUpperCase()}`.slice(0, 10),
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

    campaignResourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey: campaignResourceKey,
        name: "Retry Campaign",
      },
    });
    campaignId = campaign.id;
    campaignPublicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey,
    });

    ctx = createMockCtx(companyId, userId);

    await prisma.uploadedContact.create({
      data: {
        companyId,
        phone,
        resourceKey: `CT${suffix}`,
        campaignIds: [campaignId],
      },
    });

    mock.method(
      outboundCallsService,
      "createRetryOutboundCall",
      async (callCtx, input) => {
        retryCallsCreated += 1;
        const internalCampaignId = await resolveResourceId(
          callCtx,
          input.campaignId,
          PublicResourceType.CAMPAIGN,
        );
        const campaignRow = await prisma.campaign.findFirst({
          where: { id: internalCampaignId },
          select: { resourceKey: true },
        });
        const callLog = await createOutboundCallLog({
          companyId,
          campaignId: internalCampaignId,
          campaignResourceKey: campaignRow!.resourceKey,
          companyCli,
          phone: input.phoneNumber,
          status: "QUEUED" as "BUSY",
          isRetry: true,
          retryNumber: input.retryNumber,
          parentCallLogId: input.parentCallLogId,
        });
        return {
          callLogId: callLog.publicId,
          phoneNumberId: "PN-retry",
          status: "QUEUED" as const,
        };
      },
    );
  });

  after(async () => {
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

  async function startCampaignWithPolicy(overrides?: {
    retryEnabled?: boolean;
    maxRetries?: number;
    retryDelaySeconds?: number;
  }) {
    await campaignExecutionService.start(ctx, campaignPublicId);
    if (overrides) {
      await campaignExecutionService.updateRetryPolicy(ctx, campaignPublicId, overrides);
    }
  }

  async function scheduleRetryFromStatus(
    status: "BUSY" | "NO_ANSWER" | "FAILED",
    callLogId: string,
    targetCampaignId = campaignId,
  ) {
    await retrySchedulerService.handleTerminalCall({
      companyId,
      callLogId,
      campaignId: targetCampaignId,
      mappedStatus: status,
      correlationId: "corr-test",
    });
  }

  it("schedules BUSY retry", async () => {
    retryCallsCreated = 0;
    await startCampaignWithPolicy();

    const callLog = await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone,
      status: "BUSY",
    });

    await scheduleRetryFromStatus("BUSY", callLog.id);

    const job = await prisma.contactRetryJob.findUnique({
      where: { parentCallLogId: callLog.id },
    });
    assert.ok(job);
    assert.equal(job.retryReason, "BUSY");
    assert.equal(job.retryNumber, 1);
  });

  it("schedules NO_ANSWER retry", async () => {
    const callLog = await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111101",
      status: "NO_ANSWER",
    });

    await retrySchedulerService.handleTerminalCall({
      companyId,
      callLogId: callLog.id,
      campaignId,
      phone: "+919111111101",
      mappedStatus: "NO_ANSWER",
    });

    const job = await prisma.contactRetryJob.findFirst({
      where: { parentCallLogId: callLog.id },
    });
    assert.ok(job);
    assert.equal(job.retryReason, "NO_ANSWER");
  });

  it("schedules FAILED retry", async () => {
    const callLog = await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111102",
      status: "FAILED",
    });

    await scheduleRetryFromStatus("FAILED", callLog.id);

    const job = await prisma.contactRetryJob.findFirst({
      where: { parentCallLogId: callLog.id },
    });
    assert.ok(job);
    assert.equal(job.retryReason, "FAILED");
  });

  it("does not schedule retry when disabled", async () => {
    const callLog = await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111103",
      status: "BUSY",
    });

    await campaignExecutionService.updateRetryPolicy(ctx, campaignPublicId, {
      retryEnabled: false,
    });

    await scheduleRetryFromStatus("BUSY", callLog.id);

    const job = await prisma.contactRetryJob.findFirst({
      where: { parentCallLogId: callLog.id },
    });
    assert.equal(job, null);
  });

  it("does not schedule retry when limit reached", async () => {
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: { companyId, resourceKey, name: `Limit ${suffix}` },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    const limitPhone = "+919111111104";

    await campaignExecutionService.start(ctx, publicId);
    await campaignExecutionService.updateRetryPolicy(ctx, publicId, {
      retryEnabled: true,
      maxRetries: 1,
    });

    const parent = await createOutboundCallLog({
      companyId,
      campaignId: campaign.id,
      campaignResourceKey: resourceKey,
      companyCli,
      phone: limitPhone,
      status: "BUSY",
    });

    await createOutboundCallLog({
      companyId,
      campaignId: campaign.id,
      campaignResourceKey: resourceKey,
      companyCli,
      phone: limitPhone,
      status: "BUSY",
      isRetry: true,
      retryNumber: 1,
      parentCallLogId: parent.id,
    });

    const latest = await createOutboundCallLog({
      companyId,
      campaignId: campaign.id,
      campaignResourceKey: resourceKey,
      companyCli,
      phone: limitPhone,
      status: "BUSY",
      isRetry: true,
      retryNumber: 1,
      parentCallLogId: parent.id,
    });

    await retrySchedulerService.handleTerminalCall({
      companyId,
      callLogId: latest.id,
      campaignId: campaign.id,
      phone: limitPhone,
      mappedStatus: "BUSY",
    });

    const jobs = await prisma.contactRetryJob.count({
      where: { phoneNumber: limitPhone, status: "PENDING" },
    });
    assert.equal(jobs, 0);
  });

  it("prevents duplicate retry for same failed attempt", async () => {
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: { companyId, resourceKey, name: `Dup ${suffix}` },
    });
    const dupPhone = "+919111111105";

    await campaignExecutionService.start(
      ctx,
      generateCampaignPublicId({ cli: companyCli, campaignResourceKey: resourceKey }),
    );

    const callLog = await createOutboundCallLog({
      companyId,
      campaignId: campaign.id,
      campaignResourceKey: resourceKey,
      companyCli,
      phone: dupPhone,
      status: "BUSY",
    });

    await scheduleRetryFromStatus("BUSY", callLog.id, campaign.id);
    await scheduleRetryFromStatus("BUSY", callLog.id, campaign.id);

    const jobs = await prisma.contactRetryJob.count({
      where: { parentCallLogId: callLog.id },
    });
    assert.equal(jobs, 1);
  });

  it("executes retry worker and creates new call log", async () => {
    retryCallsCreated = 0;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: { companyId, resourceKey, name: `Worker ${suffix}` },
    });
    const workerPhone = "+919111111106";

    await campaignExecutionService.start(
      ctx,
      generateCampaignPublicId({ cli: companyCli, campaignResourceKey: resourceKey }),
    );

    const callLog = await createOutboundCallLog({
      companyId,
      campaignId: campaign.id,
      campaignResourceKey: resourceKey,
      companyCli,
      phone: workerPhone,
      status: "BUSY",
    });

    await prisma.contactRetryJob.create({
      data: {
        companyId,
        campaignId: campaign.id,
        parentCallLogId: callLog.id,
        phoneNumber: workerPhone,
        retryNumber: 1,
        retryReason: "BUSY",
        scheduledAt: new Date(Date.now() - 1000),
        status: "PENDING",
      },
    });

    await prisma.campaignExecution.updateMany({
      where: { campaignId: campaign.id },
      data: { pendingRetries: 1, totalRetries: 1 },
    });

    await retryWorkerService.processDueRetries();

    const job = await prisma.contactRetryJob.findUnique({
      where: { parentCallLogId: callLog.id },
    });
    assert.equal(job?.status, "COMPLETED");
    assert.equal(retryCallsCreated, 1);
  });

  it("respects retry scheduling delay", async () => {
    const callLog = await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111107",
      status: "BUSY",
    });

    await prisma.contactRetryJob.create({
      data: {
        companyId,
        campaignId,
        parentCallLogId: callLog.id,
        phoneNumber: "+919111111107",
        retryNumber: 1,
        retryReason: "BUSY",
        scheduledAt: new Date(Date.now() + 60_000),
        status: "PENDING",
      },
    });

    await retryWorkerService.processDueRetries();

    const job = await prisma.contactRetryJob.findUnique({
      where: { parentCallLogId: callLog.id },
    });
    assert.equal(job?.status, "PENDING");
  });

  it("exposes retry history via API", async () => {
    const callLog = await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111108",
      status: "BUSY",
    });

    await prisma.contactRetryJob.create({
      data: {
        companyId,
        campaignId,
        parentCallLogId: callLog.id,
        phoneNumber: "+919111111108",
        retryNumber: 1,
        retryReason: "BUSY",
        scheduledAt: new Date(),
        status: "PENDING",
      },
    });

    const history = await campaignExecutionService.getRetryHistory(
      ctx,
      campaignPublicId,
      "+919111111108",
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].retryNumber, 1);
    assert.equal(history[0].reason, "BUSY");
  });

  it("updates retry statistics", async () => {
    await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111109",
      status: "COMPLETED",
      isRetry: false,
    });

    await createOutboundCallLog({
      companyId,
      campaignId,
      campaignResourceKey,
      companyCli,
      phone: "+919111111110",
      status: "COMPLETED",
      isRetry: true,
      retryNumber: 1,
    });

    const stats = await campaignExecutionService.getRetryStatistics(
      ctx,
      campaignPublicId,
    );
    assert.ok(stats.initialCalls >= 1);
    assert.ok(stats.retryCalls >= 1);
  });

  it("completes campaign only after retries are exhausted", async () => {
    retryCallsCreated = 0;
    const suffix = Date.now();
    const resourceKey = randomCampaignResourceKey();
    const campaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey,
        name: `Completion ${suffix}`,
      },
    });
    const publicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: resourceKey,
    });
    const completionPhone = "+919111111199";
    await prisma.uploadedContact.create({
      data: {
        companyId,
        phone: completionPhone,
        resourceKey: `CT${suffix}`,
        campaignIds: [campaign.id],
      },
    });

    await campaignExecutionService.start(ctx, publicId);
    await campaignExecutionService.updateRetryPolicy(ctx, publicId, {
      retryEnabled: false,
    });

    await prisma.campaignExecution.updateMany({
      where: { campaignId: campaign.id },
      data: { processedCount: 1, totalContacts: 1 },
    });

    const callLog = await createOutboundCallLog({
      companyId,
      campaignId: campaign.id,
      campaignResourceKey: resourceKey,
      companyCli,
      phone: completionPhone,
      status: "BUSY",
    });

    await retrySchedulerService.handleTerminalCall({
      companyId,
      callLogId: callLog.id,
      campaignId: campaign.id,
      phone: completionPhone,
      mappedStatus: "BUSY",
    });

    await contactCompletionService.checkCampaignCompletion(companyId, campaign.id);

    const status = await campaignExecutionService.getStatus(ctx, publicId);
    assert.equal(status.status, "COMPLETED");
  });
});
