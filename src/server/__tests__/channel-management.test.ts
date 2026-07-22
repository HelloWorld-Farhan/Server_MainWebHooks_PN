process.env.CHANNEL_COOLDOWN_MS = "100";
process.env.CHANNEL_QUEUE_POLL_MS = "50";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { generateCampaignPublicId } from "@/server/lib/public-id";
import prisma from "@/server/lib/prisma";
import { channelService } from "@/server/channels/channel.service";
import { ChannelQueueWorker } from "@/server/channels/channel-queue.worker";
import { ChannelReconciliationService } from "@/server/channels/channel-reconciliation.service";
import { OutboundCallsService } from "@/server/services/outbound-calls.service";
import { callService } from "@/server/services/call.service";
import { obdOutboundService } from "@/server/telephony/outbound.service";
import { ObdWebhookService } from "@/server/telephony/webhook.service";
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
    permissions: [PERMISSIONS.CALL_LOGS_READ, PERMISSIONS.CALL_LOGS_WRITE],
    campaignAccess: { type: "ALL", campaignIds: [] },
    loaders: {} as TenantContext["loaders"],
  };
}

describe("Channel management", () => {
  let companyId: string;
  let userId: string;
  let ctx: TenantContext;
  let campaignPublicId: string;
  let companyCli: string;
  let worker: ChannelQueueWorker;
  let originalDispatch: typeof obdOutboundService.dispatch;

  before(async () => {
    channelService.resetInMemoryForTests();
    originalDispatch = obdOutboundService.dispatch.bind(obdOutboundService);
    obdOutboundService.dispatch = async (input) => {
      await prisma.callLog.updateMany({
        where: { id: input.callLogId, companyId: input.companyId },
        data: {
          status: "QUEUED_AT_PROVIDER",
          provider: "obd",
          providerCallId: `mock-${input.callLogId}`,
          correlationId: "mock-correlation-id",
        },
      });
      return {
        status: "QUEUED_AT_PROVIDER",
        providerCallId: `mock-${input.callLogId}`,
        correlationId: "mock-correlation-id",
      };
    };

    const suffix = Math.random().toString(36).slice(2, 8);
    companyCli = randomCli();
    const user = await prisma.user.create({
      data: {
        clerkUserId: `user_channel_${suffix}`,
        email: `channel-${suffix}@test.com`,
        firstName: "Channel",
        lastName: "Tester",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: `Channel Test Co ${suffix}`,
        slug: `channel-test-co-${suffix}`,
        contractId: `CH${suffix.toUpperCase()}`.slice(0, 10),
        cli: companyCli,
        companyCode: randomCompanyCode(),
        ownerUserId: user.clerkUserId,
        setupConfig: {
          create: {
            totalChannels: 2,
          },
        },
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
    await prisma.campaign.create({
      data: {
        companyId,
        resourceKey: campaignResourceKey,
        name: "Channel Campaign",
      },
    });
    campaignPublicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey,
    });

    ctx = createMockCtx(companyId, userId);
    await channelService.initializeCompany(companyId, 2, 0);
    worker = new ChannelQueueWorker();
  });

  after(async () => {
    worker.onModuleDestroy();
    obdOutboundService.dispatch = originalDispatch;
    channelService.resetInMemoryForTests();
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  function createOutboundService() {
    return new OutboundCallsService({
      requestDispatch: (input) => callService.requestDispatch(input),
    });
  }

  async function resetCompanyChannelState(allocated = 2) {
    channelService.resetInMemoryForTests();
    await prisma.callLog.deleteMany({ where: { companyId } });
    await channelService.initializeCompany(companyId, allocated, 0);
  }

  async function createCall(phone: string) {
    return createOutboundService().createOutboundCall(ctx, {
      campaignId: campaignPublicId,
      phoneNumber: phone,
    });
  }

  it("reserves channels for immediate dispatch up to capacity", async () => {
    await resetCompanyChannelState(2);

    const first = await createCall(`+9188${Math.random().toString().slice(2, 10)}`);
    const second = await createCall(`+9187${Math.random().toString().slice(2, 10)}`);

    assert.equal(first.status, "QUEUED_AT_PROVIDER");
    assert.equal(second.status, "QUEUED_AT_PROVIDER");

    const metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.active, 2);
    assert.equal(metrics.queueLength, 0);
  });

  it("queues calls when channels are full", async () => {
    await resetCompanyChannelState(2);

    await createCall(`+9186${Math.random().toString().slice(2, 10)}`);
    await createCall(`+9185${Math.random().toString().slice(2, 10)}`);
    const third = await createCall(`+9184${Math.random().toString().slice(2, 10)}`);

    assert.equal(third.status, "QUEUED");

    const callLog = await prisma.callLog.findFirst({
      where: { companyId, publicId: third.callLogId },
    });
    assert.equal(callLog?.status, "QUEUED");

    const metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.active, 2);
    assert.equal(metrics.queueLength, 1);
  });

  it("does not create duplicate queue entries", async () => {
    await resetCompanyChannelState(2);

    await channelService.enqueue(companyId, "duplicate-call-id");
    const second = await channelService.enqueue(companyId, "duplicate-call-id");

    assert.equal(second, -1);
    const metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.queueLength, 1);
  });

  it("releases channels after cooldown and dispatches queued calls FIFO", async () => {
    await resetCompanyChannelState(1);

    const first = await createCall(`+9183${Math.random().toString().slice(2, 10)}`);
    const second = await createCall(`+9182${Math.random().toString().slice(2, 10)}`);
    assert.equal(second.status, "QUEUED");

    const firstLog = await prisma.callLog.findFirst({
      where: { companyId, publicId: first.callLogId },
    });
    assert.ok(firstLog);

    await callService.handleProviderWebhook({
      companyId,
      callLogId: firstLog.id,
      currentStatus: "QUEUED_AT_PROVIDER",
      providerStatus: "COMPLETED",
      providerWebhook: { status: "COMPLETED" },
    });

    let metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.active, 1);
    assert.equal(metrics.cooldownCount, 1);

    await new Promise((resolve) => setTimeout(resolve, 200));
    await worker.tick();

    metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.cooldownCount, 0);

    const secondLog = await prisma.callLog.findFirst({
      where: { companyId, publicId: second.callLogId },
    });
    assert.equal(secondLog?.status, "QUEUED_AT_PROVIDER");
  });

  it("rebuilds redis state from database on reconciliation", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const reconcileCompany = await prisma.company.create({
      data: {
        name: `Reconcile Co ${suffix}`,
        slug: `reconcile-co-${suffix}`,
        contractId: `RC${suffix.toUpperCase()}`.slice(0, 10),
        cli: randomCli(),
        companyCode: randomCompanyCode(),
        ownerUserId: `owner_${suffix}`,
        setupConfig: {
          create: {
            totalChannels: 2,
          },
        },
      },
    });

    const queuedLog = await prisma.callLog.create({
      data: {
        callLogId: "CL88888888",
        publicId: `v1.${reconcileCompany.cli}.CP000088.CL88888888`,
        companyId: reconcileCompany.id,
        direction: "OUTBOUND",
        status: "QUEUED",
        startedAt: new Date(),
      },
    });

    await prisma.callLog.create({
      data: {
        callLogId: "CL88888887",
        publicId: `v1.${reconcileCompany.cli}.CP000088.CL88888887`,
        companyId: reconcileCompany.id,
        direction: "OUTBOUND",
        status: "QUEUED_AT_PROVIDER",
        startedAt: new Date(),
      },
    });

    const reconciliation = new ChannelReconciliationService();
    await reconciliation.reconcileAll();

    const metrics = await channelService.getMetrics(reconcileCompany.id);
    assert.equal(metrics.allocated, 2);
    assert.equal(metrics.active, 1);
    assert.equal(metrics.queueLength, 1);

    await prisma.company.delete({ where: { id: reconcileCompany.id } });
    await prisma.callLog.deleteMany({ where: { id: queuedLog.id } });
  });

  it("ignores duplicate webhook events without double cooldown", async () => {
    await resetCompanyChannelState(1);

    const phone = `+9181${Math.random().toString().slice(2, 10)}`;
    const created = await createCall(phone);
    const callLog = await prisma.callLog.findFirst({
      where: { companyId, publicId: created.callLogId },
      include: { phoneNumber: true },
    });
    assert.ok(callLog?.phoneNumber);

    const webhookService = new ObdWebhookService();
    const payload = {
      callid: created.callLogId,
      phone: callLog.phoneNumber.number,
      status: "COMPLETED",
      event_id: `evt-dup-${Math.random().toString(36).slice(2, 8)}`,
      correlation_id: callLog.correlationId ?? "corr-dup",
    };

    const first = await webhookService.processWebhook(payload);
    const second = await webhookService.processWebhook(payload);

    assert.equal(first.duplicate, undefined);
    assert.equal(second.duplicate, true);

    const metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.cooldownCount, 1);
  });

  it("handles concurrent reservations without over-allocating channels", async () => {
    await resetCompanyChannelState(3);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => channelService.tryReserve(companyId)),
    );

    const reserved = results.filter(Boolean).length;
    assert.equal(reserved, 3);

    const metrics = await channelService.getMetrics(companyId);
    assert.equal(metrics.active, 3);
    assert.equal(metrics.available, 0);
  });
});
