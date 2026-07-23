import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { generateApiKey } from "../src/server/lib/api-key-crypto.ts";
import { generateCampaignPublicId } from "../src/server/lib/public-id/index.ts";
import { PERMISSIONS } from "../src/server/types/permissions.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const COMPANY_ID = "6a61c642d2203642e875ec2a";
const MAIN_SERVER_URL = "https://propnexai-main-server.onrender.com";
const CAMPAIGN_RESOURCE_KEY = "CP000001";
const PHONE = "+918810214283";

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findUnique({
    where: { id: COMPANY_ID },
    include: {
      members: {
        where: { status: "ACTIVE", role: "OWNER" },
        take: 1,
      },
    },
  });
  if (!company?.cli) throw new Error("Company not found");

  const ownerUserId = company.members[0]?.userId;
  if (!ownerUserId) throw new Error("No owner member");

  const generated = generateApiKey("TEST");
  const apiKeyName = "Nirupam Provision Key";

  const existingKey = await prisma.apiKey.findFirst({
    where: { companyId: COMPANY_ID, name: apiKeyName },
  });

  if (existingKey) {
    await prisma.apiKey.update({
      where: { id: existingKey.id },
      data: {
        keyId: generated.keyId,
        keyPrefix: generated.keyPrefix,
        hashedSecret: generated.hashedSecret,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
  } else {
    await prisma.apiKey.create({
      data: {
        companyId: COMPANY_ID,
        name: apiKeyName,
        keyId: generated.keyId,
        keyPrefix: generated.keyPrefix,
        hashedSecret: generated.hashedSecret,
        environment: "TEST",
        scopes: [
          PERMISSIONS.CALL_LOGS_WRITE,
          PERMISSIONS.CAMPAIGNS_WRITE,
          PERMISSIONS.CAMPAIGNS_READ,
        ],
        campaignAccessType: "ALL",
        createdById: ownerUserId,
      },
    });
  }

  const campaignPublicId = generateCampaignPublicId({
    cli: company.cli,
    campaignResourceKey: CAMPAIGN_RESOURCE_KEY,
  });

  console.log("Campaign:", campaignPublicId);
  console.log("API key:", generated.plaintext);

  const execRes = await fetch(
    `${MAIN_SERVER_URL}/api/campaigns/${encodeURIComponent(campaignPublicId)}/execution/start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${generated.plaintext}`,
      },
      body: JSON.stringify({}),
    },
  );
  console.log("\nExecution start:", execRes.status, await execRes.text());

  const callRes = await fetch(`${MAIN_SERVER_URL}/api/calls/outbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${generated.plaintext}`,
    },
    body: JSON.stringify({
      campaignId: campaignPublicId,
      phoneNumber: PHONE,
    }),
  });
  console.log("\nOutbound call:", callRes.status, await callRes.text());
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
