import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import { generateCampaignPublicId } from "@/server/lib/public-id";
import prisma from "@/server/lib/prisma";
import { ValidationError } from "@/server/lib/errors";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { OutboundCallsService } from "@/server/services/outbound-calls.service";
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

describe("OutboundCallsService", () => {
  let companyId: string;
  let userId: string;
  let ctx: TenantContext;
  let campaignId: string;
  let campaignPublicId: string;
  let secondCampaignId: string;
  let secondCampaignPublicId: string;
  const testPhone = "+919876543210";

  let companyCli: string;
  let companyCode: string;
  let outboundCallsService: OutboundCallsService;

  before(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    companyCli = randomCli();
    companyCode = randomCompanyCode();
    const user = await prisma.user.create({
      data: {
        clerkUserId: `user_outbound_${suffix}`,
        email: `outbound-${suffix}@test.com`,
        firstName: "Outbound",
        lastName: "Tester",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: `Outbound Test Co ${suffix}`,
        slug: `outbound-test-co-${suffix}`,
        contractId: `OB${suffix.toUpperCase()}`.slice(0, 10),
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
        name: "Primary Campaign",
      },
    });
    campaignId = campaign.id;
    campaignPublicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey,
    });

    const secondCampaignResourceKey = randomCampaignResourceKey();
    const secondCampaign = await prisma.campaign.create({
      data: {
        companyId,
        resourceKey: secondCampaignResourceKey,
        name: "Secondary Campaign",
      },
    });
    secondCampaignId = secondCampaign.id;
    secondCampaignPublicId = generateCampaignPublicId({
      cli: companyCli,
      campaignResourceKey: secondCampaignResourceKey,
    });

    ctx = createMockCtx(companyId, userId);
    outboundCallsService = new OutboundCallsService({
      requestDispatch: async (input) => {
        await prisma.callLog.updateMany({
          where: { id: input.callLogId, companyId: input.companyId },
          data: {
            status: "QUEUED_AT_PROVIDER",
            provider: "obd",
            providerCallId: "mock-provider-req-1",
            correlationId: "mock-correlation-id",
          },
        });
        return {
          status: "QUEUED_AT_PROVIDER",
        };
      },
    });
  });

  after(async () => {
    if (companyId) {
      await prisma.company.delete({ where: { id: companyId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("creates phone number and queued-at-provider call log with campaign-scoped public IDs", async () => {
    const phoneSuffix = Math.random().toString().slice(2, 10);
    const phone = `+9198${phoneSuffix.slice(0, 8)}`;

    const result = await outboundCallsService.createOutboundCall(ctx, {
      campaignId: campaignPublicId,
      phoneNumber: phone,
    });

    assert.equal(result.status, "QUEUED_AT_PROVIDER");
    assert.match(result.callLogId, /^v1\..+\.CL\d{8}$/);
    assert.match(result.phoneNumberId, /^v1\..+\.PH\d{6}$/);

    const callLog = await prisma.callLog.findFirst({
      where: { companyId, publicId: result.callLogId },
    });
    assert.ok(callLog);
    assert.equal(callLog?.status, "QUEUED_AT_PROVIDER");
    assert.equal(callLog?.provider, "obd");
    assert.equal(callLog?.providerCallId, "mock-provider-req-1");
    assert.equal(callLog?.direction, "OUTBOUND");

    const phoneNumber = await prisma.phoneNumber.findFirst({
      where: { companyId, publicId: result.phoneNumberId },
    });
    assert.ok(phoneNumber);
    assert.equal(phoneNumber?.campaignId, campaignId);
    assert.equal(phoneNumber?.number, phone);
  });

  it("reuses the same phone number for repeated calls in one campaign", async () => {
    const phoneSuffix = Math.random().toString().slice(2, 10);
    const phone = `+9197${phoneSuffix.slice(0, 8)}`;

    const first = await outboundCallsService.createOutboundCall(ctx, {
      campaignId: campaignPublicId,
      phoneNumber: phone,
    });
    const second = await outboundCallsService.createOutboundCall(ctx, {
      campaignId: campaignPublicId,
      phoneNumber: phone,
    });

    assert.equal(first.phoneNumberId, second.phoneNumberId);
    assert.notEqual(first.callLogId, second.callLogId);

    const phoneCount = await prisma.phoneNumber.count({
      where: { companyId, campaignId, number: phone },
    });
    assert.equal(phoneCount, 1);

    const callLogCount = await prisma.callLog.count({
      where: {
        companyId,
        campaignId,
        phoneNumber: {
          publicId: first.phoneNumberId,
        },
      },
    });
    assert.equal(callLogCount, 2);
  });

  it("creates separate phone numbers for the same number in different campaigns", async () => {
    const phoneSuffix = Math.random().toString().slice(2, 10);
    const phone = `+9196${phoneSuffix.slice(0, 8)}`;

    const first = await outboundCallsService.createOutboundCall(ctx, {
      campaignId: campaignPublicId,
      phoneNumber: phone,
    });
    const second = await outboundCallsService.createOutboundCall(ctx, {
      campaignId: secondCampaignPublicId,
      phoneNumber: phone,
    });

    assert.notEqual(first.phoneNumberId, second.phoneNumberId);
  });

  it("rejects invalid phone numbers", async () => {
    await assert.rejects(
      () =>
        outboundCallsService.createOutboundCall(ctx, {
          campaignId: campaignPublicId,
          phoneNumber: "9876543210",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, /E\.164/i);
        return true;
      },
    );
  });

  it("rejects missing campaign", async () => {
    await assert.rejects(
      () =>
        outboundCallsService.createOutboundCall(ctx, {
          campaignId: `v1.${companyCli}.CP999999`,
          phoneNumber: testPhone,
        }),
      (error: unknown) => {
        assert.ok(
          error instanceof ValidationError || error instanceof Error,
        );
        return true;
      },
    );
  });

  it("invokes OBD dispatch after persistence", async () => {
    const phoneSuffix = Math.random().toString().slice(2, 10);
    const phone = `+9191${phoneSuffix.slice(0, 8)}`;

    let dispatchCalled = false;
    const service = new OutboundCallsService({
      requestDispatch: async (input) => {
        dispatchCalled = true;
        assert.match(input.callLogPublicId, /^v1\..+\.CL\d{8}$/);
        assert.equal(input.phone, phone);
        return {
          status: "QUEUED_AT_PROVIDER",
        };
      },
    });

    await service.createOutboundCall(ctx, {
      campaignId: campaignPublicId,
      phoneNumber: phone,
    });

    assert.equal(dispatchCalled, true);
  });

  it("rolls back when call log creation fails", async () => {
    const phoneSuffix = Math.random().toString().slice(2, 10);
    const phone = `+9195${phoneSuffix.slice(0, 8)}`;

    const originalCreate = CallLogsRepository.prototype.createOutboundPending;

    mock.method(
      CallLogsRepository.prototype,
      "createOutboundPending",
      async () => {
        throw new Error("Simulated call log creation failure");
      },
    );

    await assert.rejects(
      () =>
        outboundCallsService.createOutboundCall(ctx, {
          campaignId: campaignPublicId,
          phoneNumber: phone,
        }),
      /Simulated call log creation failure/,
    );

    const phoneCount = await prisma.phoneNumber.count({
      where: { companyId, campaignId, number: phone },
    });
    const callLogCount = await prisma.callLog.count({
      where: {
        companyId,
        campaignId,
        phoneNumber: { number: phone },
      },
    });

    assert.equal(phoneCount, 0);
    assert.equal(callLogCount, 0);

    CallLogsRepository.prototype.createOutboundPending = originalCreate;
    mock.restoreAll();
  });
});
