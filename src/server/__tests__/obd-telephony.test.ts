import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { generatePublicId } from "@/server/lib/public-id";
import prisma from "@/server/lib/prisma";
import { CallLogsRepository } from "@/server/repositories/call-logs.repository";
import { PhoneNumbersRepository } from "@/server/repositories/phone-numbers.repository";
import { ObdOutboundService } from "@/server/telephony/outbound.service";
import { ObdProviderClient } from "@/server/telephony/provider-client";
import { mapProviderStatusToCallStatus } from "@/server/telephony/status-mapper";
import { channelService } from "@/server/channels/channel.service";
import { ObdWebhookService } from "@/server/telephony/webhook.service";
import {
  DEFAULT_OBD_SERVICE_NUMBERS,
  getDefaultObdServiceNo,
  getObdConfig,
  getObdServiceNumbers,
} from "@/server/telephony/obd-config";

const OBD_TEST_CONFIG = {
  baseUrl:
    "https://obd.test.example/obd/OBDAPI/webresources/CreateOBDCampaignPost",
  apiKey: "test-obd-api-key",
  webhookUrl: "https://main.test.example/api/webhooks/obd",
  timeoutMs: 5_000,
  maxRetries: 1,
  webhookSecret: null,
  serviceNo: "7912345678",
  voiceFile: "welcome.mp3",
  ivrTemplateId: "179",
  retryAttempts: "0",
  retryDuration: "15",
  sourceType: "1",
  campaignType: "4",
  fileType: "2",
  sendNow: "1",
};

const CORRELATION_ID = "00000000-0000-4000-8000-000000000001";

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

describe("OBD telephony", () => {
  describe("obd-config", () => {
    it("returns default service numbers and default service number", () => {
      assert.deepEqual(getObdServiceNumbers(), [...DEFAULT_OBD_SERVICE_NUMBERS]);
      assert.equal(getDefaultObdServiceNo(), DEFAULT_OBD_SERVICE_NUMBERS[0]);
      assert.equal(getObdConfig().serviceNo, DEFAULT_OBD_SERVICE_NUMBERS[0]);
    });
  });

  describe("status-mapper", () => {
    it("maps provider statuses to internal CallStatus values", () => {
      assert.equal(mapProviderStatusToCallStatus("SUCCESS"), "COMPLETED");
      assert.equal(mapProviderStatusToCallStatus("ANSWERED"), "ANSWERED");
      assert.equal(mapProviderStatusToCallStatus("RINGING"), "RINGING");
      assert.equal(mapProviderStatusToCallStatus("QUEUED"), "QUEUED_AT_PROVIDER");
      assert.equal(mapProviderStatusToCallStatus("BUSY"), "BUSY");
      assert.equal(mapProviderStatusToCallStatus("NO_ANSWER"), "NO_ANSWER");
      assert.equal(mapProviderStatusToCallStatus("CANCELLED"), "CANCELLED");
      assert.equal(mapProviderStatusToCallStatus("FAILED"), "FAILED");
      assert.equal(mapProviderStatusToCallStatus("UNKNOWN_STATUS"), "FAILED");
    });
  });

  describe("ObdProviderClient", () => {
    it("sends VoiceNSMS CreateOBDCampaignPost payload on success", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const client = new ObdProviderClient({
        config: OBD_TEST_CONFIG,
        fetchFn: async (url, init) => {
          calls.push({ url: String(url), init });
          return new Response(
            JSON.stringify({ campaignid: "provider-req-123", status: "success" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const callid = "v1.PNX.CP000001.CL00000001";
      const result = await client.sendOutboundCall({
        callid,
        phone: "+919876543210",
        correlationId: CORRELATION_ID,
        webhookUrl: OBD_TEST_CONFIG.webhookUrl ?? undefined,
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.providerCallId, "provider-req-123");
      assert.equal(
        calls[0]?.url,
        OBD_TEST_CONFIG.baseUrl,
      );
      const body = JSON.parse(String(calls[0]?.init?.body)) as {
        sourcetype: string;
        sendnow: string;
        ukey: string;
        serviceno: string;
        ivrtemplateid: string;
        msisdnlist: Array<{
          phoneno: string;
          callid: string;
          user_name: string;
          "Recording URL": string;
          Summary: string;
          " Transcripts": string;
          webhookurl?: string;
        }>;
      };
      assert.equal(body.sourcetype, "1");
      assert.equal(body.sendnow, "1");
      assert.equal(body.ukey, OBD_TEST_CONFIG.apiKey);
      assert.equal(body.serviceno, OBD_TEST_CONFIG.serviceNo);
      assert.equal(body.ivrtemplateid, OBD_TEST_CONFIG.ivrTemplateId);
      assert.equal(body.msisdnlist[0]?.phoneno, "9876543210");
      assert.equal(body.msisdnlist[0]?.callid, callid);
      assert.equal(body.msisdnlist[0]?.user_name, "Nil");
      assert.equal(body.msisdnlist[0]?.["Recording URL"], "Nil");
      assert.equal(body.msisdnlist[0]?.Summary, "Nil");
      assert.equal(body.msisdnlist[0]?.[" Transcripts"], "Nil");
      assert.equal(body.msisdnlist[0]?.webhookurl, OBD_TEST_CONFIG.webhookUrl);
      assert.equal("webhookurl" in body, false);
      assert.equal("schddate" in body, false);
      assert.equal("voice_file" in (body.msisdnlist[0] ?? {}), false);
      assert.equal("param1" in (body.msisdnlist[0] ?? {}), false);
    });

    it("maps uploaded contact fields into VoiceNSMS msisdnlist", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const client = new ObdProviderClient({
        config: OBD_TEST_CONFIG,
        fetchFn: async (url, init) => {
          calls.push({ url: String(url), init });
          return new Response(
            JSON.stringify({ campaignid: "provider-req-456", status: "success" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const callid = "v1.PNX.CP000001.CL00000002";
      const result = await client.sendOutboundCall({
        callid,
        phone: "+918810214283",
        correlationId: CORRELATION_ID,
        contactFields: {
          userName: "XYZ",
          recordingUrl: "https://example.com/recording.mp3",
          summary: "ABCD",
          transcripts: "XXXX",
        },
      });

      assert.equal(result.ok, true);
      const body = JSON.parse(String(calls[0]?.init?.body)) as {
        msisdnlist: Array<{
          phoneno: string;
          callid: string;
          user_name: string;
          "Recording URL": string;
          Summary: string;
          " Transcripts": string;
        }>;
      };
      assert.equal(body.msisdnlist[0]?.phoneno, "8810214283");
      assert.equal(body.msisdnlist[0]?.callid, callid);
      assert.equal(body.msisdnlist[0]?.user_name, "XYZ");
      assert.equal(
        body.msisdnlist[0]?.["Recording URL"],
        "https://example.com/recording.mp3",
      );
      assert.equal(body.msisdnlist[0]?.Summary, "ABCD");
      assert.equal(body.msisdnlist[0]?.[" Transcripts"], "XXXX");
    });

    it("does not retry auth failures", async () => {
      let attempts = 0;
      const client = new ObdProviderClient({
        config: { ...OBD_TEST_CONFIG, maxRetries: 2 },
        fetchFn: async () => {
          attempts += 1;
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
          });
        },
      });

      const result = await client.sendOutboundCall({
        callid: "v1.PNX.CP000001.CL00000002",
        phone: "+919876543211",
        correlationId: CORRELATION_ID,
      });

      assert.equal(result.ok, false);
      assert.equal(attempts, 1);
    });

    it("retries retryable 503 responses", async () => {
      let attempts = 0;
      const client = new ObdProviderClient({
        config: { ...OBD_TEST_CONFIG, maxRetries: 1 },
        fetchFn: async () => {
          attempts += 1;
          if (attempts === 1) {
            return new Response(null, { status: 503 });
          }
          return new Response(JSON.stringify({ request_id: "after-retry" }), {
            status: 200,
          });
        },
      });

      const result = await client.sendOutboundCall({
        callid: "v1.PNX.CP000001.CL00000003",
        phone: "+919876543212",
        correlationId: CORRELATION_ID,
      });

      assert.equal(result.ok, true);
      assert.equal(attempts, 2);
    });

    it("retries network failures up to maxRetries", async () => {
      let attempts = 0;
      const client = new ObdProviderClient({
        config: { ...OBD_TEST_CONFIG, maxRetries: 2 },
        fetchFn: async () => {
          attempts += 1;
          throw new TypeError("fetch failed");
        },
      });

      const result = await client.sendOutboundCall({
        callid: "v1.PNX.CP000001.CL00000004",
        phone: "+919876543213",
        correlationId: CORRELATION_ID,
      });

      assert.equal(result.ok, false);
      assert.equal(attempts, 3);
    });

    it("accepts VoiceNSMS success without a campaign ID (warning only)", async () => {
      const client = new ObdProviderClient({
        config: OBD_TEST_CONFIG,
        fetchFn: async () =>
          new Response(
            JSON.stringify({ value: "accepted", status: "success" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      });

      const result = await client.sendOutboundCall({
        callid: "v1.PNX.CP000001.CL00000006",
        phone: "+919876543215",
        correlationId: CORRELATION_ID,
      });

      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.providerCallId, null);
      assert.match(result.warning ?? "", /returned no campaign ID/i);
    });

    it("handles provider timeouts", async () => {
      const client = new ObdProviderClient({
        config: { ...OBD_TEST_CONFIG, timeoutMs: 10, maxRetries: 0 },
        fetchFn: async (_url, init): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      });

      const result = await client.sendOutboundCall({
        callid: "v1.PNX.CP000001.CL00000005",
        phone: "+919876543214",
        correlationId: CORRELATION_ID,
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        return;
      }
      assert.equal(result.error.isTimeout, true);
    });
  });

  describe("outbound + webhook integration", () => {
    let companyId: string;
    let campaignId: string;
    let companyCli: string;
    let campaignResourceKey: string;
    let callLogPublicId: string;
    let phoneNumber: string;
    const webhookService = new ObdWebhookService();

    before(async () => {
      process.env.OBD_API_KEY = OBD_TEST_CONFIG.apiKey;
      process.env.OBD_BASE_URL = OBD_TEST_CONFIG.baseUrl;
      process.env.OBD_VOICE_FILE = OBD_TEST_CONFIG.voiceFile;

      const suffix = Math.random().toString(36).slice(2, 8);
      companyCli = randomCli();
      campaignResourceKey = `CP${String(Math.floor(Math.random() * 999999) + 1).padStart(6, "0")}`;
      phoneNumber = `+9198${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`;

      const user = await prisma.user.create({
        data: {
          clerkUserId: `user_obd_${suffix}`,
          email: `obd-${suffix}@test.com`,
          firstName: "OBD",
          lastName: "Tester",
        },
      });

      const company = await prisma.company.create({
        data: {
          name: `OBD Test Co ${suffix}`,
          slug: `obd-test-co-${suffix}`,
          contractId: `OD${suffix.toUpperCase()}`.slice(0, 10),
          cli: companyCli,
          companyCode: randomCompanyCode(),
          ownerUserId: user.clerkUserId,
        },
      });
      companyId = company.id;

      const campaign = await prisma.campaign.create({
        data: {
          companyId,
          resourceKey: campaignResourceKey,
          name: "OBD Campaign",
        },
      });
      campaignId = campaign.id;

      const phoneNumbersRepo = new PhoneNumbersRepository(prisma);
      const callLogsRepo = new CallLogsRepository(prisma);

      const { phoneNumber: phoneRecord, callLog } = await prisma.$transaction(
        async (tx) => {
          const phone = await phoneNumbersRepo.createForCampaign(
            tx,
            companyId,
            campaignId,
            phoneNumber,
            campaignResourceKey,
            companyCli,
          );
          const log = await callLogsRepo.createOutboundPending(tx, {
            companyId,
            campaignId,
            phoneNumberId: phone.id,
            campaignResourceKey,
            companyCli,
          });
          return { phoneNumber: phone, callLog: log };
        },
      );

      callLogPublicId = callLog.publicId;
      assert.equal(phoneRecord.number, phoneNumber);
    });

    after(async () => {
      if (companyId) {
        await prisma.company.delete({ where: { id: companyId } });
      }
    });

    it("transitions PENDING to QUEUED_AT_PROVIDER with provider timestamps", async () => {
      const callLog = await prisma.callLog.findFirst({
        where: { companyId, publicId: callLogPublicId },
      });
      assert.ok(callLog);

      const outboundService = new ObdOutboundService(
        new ObdProviderClient({
          config: OBD_TEST_CONFIG,
          fetchFn: async () =>
            new Response(JSON.stringify({ request_id: "req-queued-1" }), {
              status: 200,
            }),
        }),
      );

      const result = await outboundService.dispatch({
        companyId,
        callLogId: callLog.id,
        callLogPublicId,
        phone: phoneNumber,
      });

      assert.equal(result.status, "QUEUED_AT_PROVIDER");
      assert.ok(result.correlationId);

      const updated = await prisma.callLog.findFirst({
        where: { publicId: callLogPublicId },
      });
      assert.equal(updated?.status, "QUEUED_AT_PROVIDER");
      assert.equal(updated?.provider, "obd");
      assert.ok(updated?.providerRequestedAt);
      assert.ok(updated?.providerAcceptedAt);
      assert.ok(updated?.correlationId);
      assert.ok(Array.isArray(updated?.providerRequest));
      assert.ok(Array.isArray(updated?.providerResponse));
    });

    it("updates call log to FAILED when provider dispatch fails", async () => {
      const suffix = Math.random().toString(36).slice(2, 8);
      const failedPhone = `+9177${suffix.slice(0, 8)}`;
      const callLogsRepo = new CallLogsRepository(prisma);
      const phoneNumbersRepo = new PhoneNumbersRepository(prisma);

      const failedLog = await prisma.$transaction(async (tx) => {
        const phone = await phoneNumbersRepo.createForCampaign(
          tx,
          companyId,
          campaignId,
          failedPhone,
          campaignResourceKey,
          companyCli,
        );
        return callLogsRepo.createOutboundPending(tx, {
          companyId,
          campaignId,
          phoneNumberId: phone.id,
          campaignResourceKey,
          companyCli,
        });
      });

      const outboundService = new ObdOutboundService(
        new ObdProviderClient({
          config: OBD_TEST_CONFIG,
          fetchFn: async () =>
            new Response(JSON.stringify({ error: "bad request" }), {
              status: 400,
            }),
        }),
      );

      const result = await outboundService.dispatch({
        companyId,
        callLogId: failedLog.id,
        callLogPublicId: failedLog.publicId,
        phone: failedPhone,
      });

      assert.equal(result.status, "FAILED");
      const updated = await prisma.callLog.findFirst({
        where: { id: failedLog.id },
      });
      assert.equal(updated?.status, "FAILED");
      assert.ok(updated?.providerCompletedAt);
      assert.ok(Array.isArray(updated?.providerResponse));
    });

    it("processes webhook success and updates existing call log", async () => {
      webhookService.assertAuthorized(OBD_TEST_CONFIG.apiKey);
      channelService.resetInMemoryForTests();

      await prisma.callLog.updateMany({
        where: { publicId: callLogPublicId },
        data: { status: "QUEUED_AT_PROVIDER", durationSeconds: 0 },
      });

      const result = await webhookService.processWebhook({
        callid: callLogPublicId,
        phone: phoneNumber,
        status: "SUCCESS",
        duration: 42,
        event_id: `evt-success-${Math.random().toString(36).slice(2, 8)}`,
        ended_at: "2026-07-22T10:00:00.000Z",
      });

      assert.equal(result.received, true);
      assert.equal(result.duplicate, undefined);

      const updated = await prisma.callLog.findFirst({
        where: { publicId: callLogPublicId },
      });
      assert.equal(updated?.status, "COMPLETED");
      assert.equal(updated?.providerStatus, "SUCCESS");
      assert.equal(updated?.durationSeconds, 42);
      assert.ok(updated?.providerCompletedAt);
      assert.ok(updated?.providerWebhook);
    });

    it("ignores duplicate webhook deliveries", async () => {
      const eventId = `evt-dup-${Math.random().toString(36).slice(2, 8)}`;

      const first = await webhookService.processWebhook({
        callid: callLogPublicId,
        phone: phoneNumber,
        status: "RINGING",
        duration: 99,
        event_id: eventId,
      });
      assert.equal(first.duplicate, undefined);

      const duplicate = await webhookService.processWebhook({
        callid: callLogPublicId,
        phone: phoneNumber,
        status: "RINGING",
        duration: 99,
        event_id: eventId,
      });

      assert.equal(duplicate.duplicate, true);

      const updated = await prisma.callLog.findFirst({
        where: { publicId: callLogPublicId },
      });
      assert.equal(updated?.durationSeconds, 42);
    });

    it("appends webhook audit without regressing completed status", async () => {
      const result = await webhookService.processWebhook({
        callid: callLogPublicId,
        phone: phoneNumber,
        status: "RINGING",
        duration: 10,
        event_id: "evt-late-ringing",
      });

      assert.equal(result.received, true);
      const updated = await prisma.callLog.findFirst({
        where: { publicId: callLogPublicId },
      });
      assert.equal(updated?.status, "COMPLETED");
      const webhookEntries = updated?.providerWebhook as unknown[];
      assert.ok(webhookEntries.length >= 2);
    });

    it("rejects company mismatch via validation chain", async () => {
      const callLog = await prisma.callLog.findFirst({
        where: { publicId: callLogPublicId },
        select: {
          id: true,
          companyId: true,
          campaignId: true,
          publicId: true,
          status: true,
          correlationId: true,
          phoneNumber: {
            select: {
              id: true,
              number: true,
              campaignId: true,
              companyId: true,
            },
          },
          campaign: {
            select: { id: true, resourceKey: true, companyId: true },
          },
          company: { select: { id: true, cli: true } },
        },
      });
      assert.ok(callLog?.company && callLog.phoneNumber && callLog.campaign);

      const { validateWebhookCallLogChain } = await import(
        "@/server/telephony/webhook-validation"
      );

      assert.throws(
        () =>
          validateWebhookCallLogChain(
            {
              callid: callLogPublicId.replace(companyCli, "ZZZ"),
              phone: phoneNumber,
              status: "SUCCESS",
            },
            {
              ...callLog,
              company: callLog.company!,
              phoneNumber: callLog.phoneNumber!,
              campaign: callLog.campaign!,
            },
          ),
        /company does not match/i,
      );
    });

    it("rejects campaign mismatch via validation chain", async () => {
      const callLog = await prisma.callLog.findFirst({
        where: { publicId: callLogPublicId },
        select: {
          id: true,
          companyId: true,
          campaignId: true,
          publicId: true,
          status: true,
          correlationId: true,
          phoneNumber: {
            select: {
              id: true,
              number: true,
              campaignId: true,
              companyId: true,
            },
          },
          campaign: {
            select: { id: true, resourceKey: true, companyId: true },
          },
          company: { select: { id: true, cli: true } },
        },
      });
      assert.ok(callLog?.company && callLog.phoneNumber && callLog.campaign);

      const { validateWebhookCallLogChain } = await import(
        "@/server/telephony/webhook-validation"
      );

      assert.throws(
        () =>
          validateWebhookCallLogChain(
            {
              callid: callLogPublicId.replace(campaignResourceKey, "CP999999"),
              phone: phoneNumber,
              status: "SUCCESS",
            },
            {
              ...callLog,
              company: callLog.company!,
              phoneNumber: callLog.phoneNumber!,
              campaign: callLog.campaign!,
            },
          ),
        /campaign does not match/i,
      );
    });

    it("rejects phone mismatch", async () => {
      await assert.rejects(
        () =>
          webhookService.processWebhook({
            callid: callLogPublicId,
            phone: "+919999999999",
            status: "SUCCESS",
          }),
        /phone number does not match/i,
      );
    });

    it("rejects invalid public ID format", async () => {
      await assert.rejects(
        () =>
          webhookService.processWebhook({
            callid: "not-a-public-id",
            phone: phoneNumber,
            status: "SUCCESS",
          }),
        /Invalid callid public ID format/,
      );
    });

    it("rejects unknown callid without creating a call log", async () => {
      const unknownCallId = generatePublicId({
        cli: companyCli,
        campaignId: campaignResourceKey,
        entityId: "CL99999999",
      });

      const beforeCount = await prisma.callLog.count({ where: { companyId } });

      await assert.rejects(
        () =>
          webhookService.processWebhook({
            callid: unknownCallId,
            phone: phoneNumber,
            status: "SUCCESS",
          }),
        /Call log not found/,
      );

      const afterCount = await prisma.callLog.count({ where: { companyId } });
      assert.equal(afterCount, beforeCount);
    });

    it("rejects webhook when API key is invalid", () => {
      assert.throws(
        () => webhookService.assertAuthorized("wrong-key"),
        /Invalid OBD webhook API key/,
      );
    });
  });
});
