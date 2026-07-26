import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractProviderErrorMessage } from "@/server/telephony/dto/outbound-response.dto";

describe("outbound-response.dto", () => {
  it("treats VoiceNSMS accepted responses without a campaign ID as success", () => {
    const body = { value: "accepted", status: "success" };
    assert.equal(extractProviderErrorMessage(body), null);
  });

  it("does not flag successful responses that include a campaign ID", () => {
    const body = { campaignid: "12345", status: "success" };
    assert.equal(extractProviderErrorMessage(body), null);
  });

  it("flags explicit provider error values", () => {
    const body = { value: "invalid number", status: "success" };
    assert.match(
      extractProviderErrorMessage(body) ?? "",
      /invalid number/i,
    );
  });
});
