import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canTransitionCallStatus,
  isProviderCompletedStatus,
  isTerminalCallStatus,
} from "@/server/telephony/call-status-lifecycle";
import {
  isRetryableHttpStatus,
  isRetryableProviderError,
} from "@/server/telephony/retry-policy";
import { validateWebhookCallLogChain } from "@/server/telephony/webhook-validation";

describe("telephony utilities", () => {
  describe("retry-policy", () => {
    it("retries transient HTTP statuses", () => {
      for (const status of [408, 429, 500, 502, 503, 504]) {
        assert.equal(isRetryableHttpStatus(status), true);
      }
    });

    it("does not retry client errors", () => {
      for (const status of [400, 401, 403, 404, 422]) {
        assert.equal(isRetryableHttpStatus(status), false);
      }
    });

    it("retries network and timeout errors", () => {
      assert.equal(
        isRetryableProviderError({ message: "timeout", isTimeout: true }),
        true,
      );
      assert.equal(
        isRetryableProviderError({ message: "network", isNetworkError: true }),
        true,
      );
      assert.equal(
        isRetryableProviderError({ message: "bad request", httpStatus: 400 }),
        false,
      );
    });
  });

  describe("call-status-lifecycle", () => {
    it("identifies terminal statuses", () => {
      assert.equal(isTerminalCallStatus("COMPLETED"), true);
      assert.equal(isTerminalCallStatus("PENDING"), false);
      assert.equal(isTerminalCallStatus("DISPATCHING"), false);
    });

    it("allows forward transitions and blocks terminal regression", () => {
      assert.equal(
        canTransitionCallStatus("PENDING", "QUEUED"),
        true,
      );
      assert.equal(
        canTransitionCallStatus("PENDING", "DISPATCHING"),
        true,
      );
      assert.equal(
        canTransitionCallStatus("QUEUED_AT_PROVIDER", "RINGING"),
        true,
      );
      assert.equal(canTransitionCallStatus("COMPLETED", "RINGING"), false);
    });

    it("identifies provider-completed statuses", () => {
      assert.equal(isProviderCompletedStatus("COMPLETED"), true);
      assert.equal(isProviderCompletedStatus("BUSY"), true);
      assert.equal(isProviderCompletedStatus("RINGING"), false);
    });
  });

  describe("webhook-validation", () => {
    const baseCallLog = {
      id: "log-1",
      companyId: "company-1",
      campaignId: "campaign-1",
      publicId: "v1.PNX.CP000001.CL00000001",
      status: "QUEUED_AT_PROVIDER" as const,
      correlationId: "corr-1",
      phoneNumber: {
        id: "phone-1",
        number: "+919876543210",
        campaignId: "campaign-1",
        companyId: "company-1",
      },
      campaign: {
        id: "campaign-1",
        resourceKey: "CP000001",
        companyId: "company-1",
      },
      company: {
        id: "company-1",
        cli: "PNX",
      },
    };

    it("accepts a valid call chain", () => {
      assert.doesNotThrow(() =>
        validateWebhookCallLogChain(
          {
            callid: "v1.PNX.CP000001.CL00000001",
            phone: "+919876543210",
            status: "RINGING",
          },
          baseCallLog,
        ),
      );
    });

    it("rejects company CLI mismatch", () => {
      assert.throws(
        () =>
          validateWebhookCallLogChain(
            {
              callid: "v1.AAA.CP000001.CL00000001",
              phone: "+919876543210",
              status: "RINGING",
            },
            baseCallLog,
          ),
        /company does not match/i,
      );
    });

    it("rejects campaign mismatch", () => {
      assert.throws(
        () =>
          validateWebhookCallLogChain(
            {
              callid: "v1.PNX.CP000002.CL00000001",
              phone: "+919876543210",
              status: "RINGING",
            },
            baseCallLog,
          ),
        /campaign does not match/i,
      );
    });
  });
});
