/**
 * Try each OBD service number against VoiceNSMS and print full responses.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildObdProviderOutboundPayload } from "@/server/telephony/dto/outbound-request.dto";
import { getObdConfig } from "@/server/telephony/obd-config";
import { extractProviderCallId } from "@/server/telephony/dto/outbound-response.dto";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.production"), override: true });

const TEST_PHONE = "+918810214283";
const SERVICE_NUMBERS = ["7971502709", "7971501524", "7971502635"];

async function main() {
  const cfg = getObdConfig();
  const base = buildObdProviderOutboundPayload(
    {
      callid: `diag-${Date.now()}`,
      phone: TEST_PHONE,
      correlationId: `diag-${Date.now()}`,
    },
    cfg,
  );

  console.log("OBD base URL:", cfg.baseUrl);
  console.log("sendNow:", cfg.sendNow);
  console.log("ivrTemplateId:", cfg.ivrTemplateId);
  console.log("webhookUrl (env):", cfg.webhookUrl);
  console.log("");

  for (const serviceno of SERVICE_NUMBERS) {
    const payload = { ...base, serviceno };
    const res = await fetch(cfg.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const campaignId = extractProviderCallId(body);
    console.log(`--- serviceno ${serviceno} ---`);
    console.log("HTTP:", res.status);
    console.log("Body:", JSON.stringify(body));
    console.log("campaignId:", campaignId ?? "(none)");
    console.log("");
  }

  if (cfg.webhookUrl) {
    const withWebhook = {
      ...base,
      msisdnlist: [
        { ...base.msisdnlist[0]!, webhookurl: cfg.webhookUrl },
      ],
    };
    const res = await fetch(cfg.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withWebhook),
    });
    const body = await res.json();
    console.log("--- with webhookurl in msisdnlist ---");
    console.log("HTTP:", res.status);
    console.log("Body:", JSON.stringify(body));
    console.log("campaignId:", extractProviderCallId(body) ?? "(none)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
