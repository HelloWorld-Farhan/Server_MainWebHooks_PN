import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ObdProviderClient } from "@/server/telephony/provider-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.production") });

async function main() {
  const correlationId = `obd-integration-test-${Date.now()}`;
  const client = new ObdProviderClient();
  const result = await client.sendOutboundCall({
    callid: "v1.NIR.CP000001.CL99999999",
    phone: "+918810214283",
    correlationId,
  });

  console.log("\nRESULT:", JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
