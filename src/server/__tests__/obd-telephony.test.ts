import {
  buildObdProviderOutboundPayload,
  toVoiceNsmsMsisdn,
  type ObdOutboundCallInput,
} from "../telephony/dto/outbound-request.dto";

describe("OBD Telephony Payload Builder", () => {
  describe("toVoiceNsmsMsisdn", () => {
    it("strips +91 prefix", () => {
      expect(toVoiceNsmsMsisdn("+918891189392")).toBe("8891189392");
    });
    it("strips non-digits", () => {
      expect(toVoiceNsmsMsisdn("(889) 118-9392")).toBe("8891189392");
    });
    it("keeps 10 digits as is", () => {
      expect(toVoiceNsmsMsisdn("8891189392")).toBe("8891189392");
    });
  });

  describe("buildObdProviderOutboundPayload", () => {
    it("builds the correct Bonvoice payload", () => {
      const input: ObdOutboundCallInput = {
        callid: "test-call-id-123",
        phone: "+918891189392",
        correlationId: "corr-123",
      };
      
      const config = {
        serviceNo: "7946350797",
        voicebotUrl: "wss://agent.example.com",
      };

      const payload = buildObdProviderOutboundPayload(input, config);
      
      expect(payload).toEqual({
        autocallType: "5",
        destination: "8891189392",
        legACallerID: "7946350797",
        eventID: "test-call-id-123",
        voicebotProvider: "BONVOICE",
        voicebotURL: "wss://agent.example.com",
      });
    });

    it("handles missing voicebotUrl", () => {
      const input: ObdOutboundCallInput = {
        callid: "test-call-id-123",
        phone: "8891189392",
        correlationId: "corr-123",
      };
      
      const config = {
        serviceNo: "7946350797",
        voicebotUrl: null,
      };

      const payload = buildObdProviderOutboundPayload(input, config as any);
      
      expect(payload.voicebotURL).toBe("");
    });
  });
});
