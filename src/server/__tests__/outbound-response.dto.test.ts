import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractProviderErrorMessage,
  extractProviderResponseWarning,
} from "@/server/telephony/dto/outbound-response.dto";

describe("outbound-response.dto", () => {
  it("flags accepted VoiceNSMS responses without a campaign ID", () => {
    const body = { value: "accepted", status: "success" };
    assert.match(
      extractProviderResponseWarning(body) ?? "",
      /returned no campaign ID/i,
    );
    assert.match(
      extractProviderErrorMessage(body) ?? "",
      /returned no campaign ID/i,
    );
  });

  it("does not flag successful responses that include a campaign ID", () => {
    const body = { campaignid: "12345", status: "success" };
    assert.equal(extractProviderResponseWarning(body), null);
    assert.equal(extractProviderErrorMessage(body), null);
  });
});
