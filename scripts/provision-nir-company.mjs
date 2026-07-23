/**
 * Provision Nirupam Testing Company for outbound calling.
 * Usage: npx tsx scripts/provision-nir-company.mjs
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { generateApiKey } from "../src/server/lib/api-key-crypto.ts";
import { generateCampaignPublicId } from "../src/server/lib/public-id/index.ts";
import { allocateResourceKey } from "../src/server/lib/resource-key.ts";
import { PublicResourceType } from "../src/server/lib/public-id/types.ts";
import { channelService } from "../src/server/channels/channel.service.ts";
import { connectRedisOnStartup } from "../src/server/cache/redis.client.ts";
import { PERMISSIONS } from "../src/server/types/permissions.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const COMPANY_CODE = "BB61K7";
const CONTRACT_ID = "99VFA3X2WR";
const SERVICE_NUMBER = "7971501524";
const CHANNEL_COUNT = 1;
const CREDITS = 10_000;

/** Mobile numbers to dial (E.164). */
const CONTACT_PHONES = [
  { phone: "+918810214283", name: "Test Contact 1" },
];

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst({
    where: { OR: [{ companyCode: COMPANY_CODE }, { contractId: CONTRACT_ID }] },
    include: {
      members: {
        where: { status: "ACTIVE", role: "OWNER" },
        take: 1,
        include: { user: true },
      },
      campaigns: { take: 1, orderBy: { createdAt: "asc" } },
      setupConfig: true,
      creditBalance: true,
    },
  });

  if (!company) {
    throw new Error(`Company not found (${COMPANY_CODE})`);
  }

  console.log(`Provisioning company: ${company.name} (${company.id})`);

  const ownerMember = company.members[0];
  if (!ownerMember) {
    throw new Error("No owner member found — company must be claimed first");
  }

  await prisma.companySetupConfig.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      totalChannels: CHANNEL_COUNT,
      serviceNumber: SERVICE_NUMBER,
      pulseTimeSeconds: 60,
      deltaSeconds: 2,
      agentsAllocated: 1,
    },
    update: {
      totalChannels: CHANNEL_COUNT,
      serviceNumber: SERVICE_NUMBER,
      pulseTimeSeconds: 60,
      deltaSeconds: 2,
      agentsAllocated: 1,
    },
  });
  console.log(`Setup: ${CHANNEL_COUNT} channel(s), service ${SERVICE_NUMBER}`);

  await prisma.companyBillingRates.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      costPerChannel: 650,
      costPerCredit: 0.31,
      pulseTimeSeconds: 60,
      setupOneTimeCost: 0,
      currency: "INR",
    },
    update: {
      costPerCredit: 0.31,
      pulseTimeSeconds: 60,
    },
  });

  await prisma.creditBalance.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      creditsRemaining: CREDITS,
      creditsUsed: 0,
    },
    update: { creditsRemaining: CREDITS },
  });
  console.log(`Credits: ${CREDITS}`);

  let campaign = company.campaigns[0];
  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        companyId: company.id,
        resourceKey: "CP000001",
        name: "Nirupam Outbound Campaign",
        status: "ACTIVE",
        aiEnabled: true,
      },
    });
    console.log(`Created campaign: ${campaign.name}`);
  } else {
    campaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "ACTIVE", aiEnabled: true },
    });
    console.log(`Using existing campaign: ${campaign.name}`);
  }

  const campaignPublicId = generateCampaignPublicId({
    cli: company.cli,
    campaignResourceKey: campaign.resourceKey,
  });
  console.log(`Campaign public ID: ${campaignPublicId}`);

  const stage = await prisma.leadPipelineStage.upsert({
    where: {
      companyId_slug: { companyId: company.id, slug: "new" },
    },
    update: {},
    create: {
      companyId: company.id,
      name: "New",
      slug: "new",
      order: 1,
      isDefault: true,
    },
  });

  let agent = await prisma.aiAgent.findFirst({
    where: { companyId: company.id, status: "ACTIVE", type: "OUTBOUND" },
  });
  if (!agent) {
    agent = await prisma.$transaction(async (tx) => {
      const resourceKey = await allocateResourceKey(
        tx,
        company.id,
        PublicResourceType.AGENT,
      );
      return tx.aiAgent.create({
        data: {
          companyId: company.id,
          campaignId: campaign.id,
          resourceKey,
          name: "Nirupam Outbound Agent",
          type: "OUTBOUND",
          status: "ACTIVE",
          enabled: true,
          firstMessage: "Hello, this is a call from Propnex.",
          systemPrompt:
            "You are a helpful outbound sales assistant for Nirupam Testing Company.",
        },
      });
    });
    console.log(`Created AI agent: ${agent.name}`);
  }

  const channelNumber = `+91${SERVICE_NUMBER}`;
  let dialerChannel = await prisma.channel.findFirst({
    where: { companyId: company.id, number: channelNumber },
  });
  if (!dialerChannel) {
    dialerChannel = await prisma.channel.create({
      data: {
        companyId: company.id,
        number: channelNumber,
        status: "AVAILABLE",
        aiAgentId: agent.id,
      },
    });
    console.log(`Created dialer channel: ${channelNumber}`);
  } else {
    dialerChannel = await prisma.channel.update({
      where: { id: dialerChannel.id },
      data: { status: "AVAILABLE", aiAgentId: agent.id },
    });
  }

  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const existing = await prisma.companyChannel.findFirst({
      where: { companyId: company.id, channelIndex: i + 1 },
    });
    if (!existing) {
      await prisma.companyChannel.create({
        data: {
          companyId: company.id,
          channelIndex: i + 1,
          label: `Channel ${i + 1}`,
        },
      });
    }
  }

  for (const contact of CONTACT_PHONES) {
    const existingContact = await prisma.uploadedContact.findFirst({
      where: { companyId: company.id, phone: contact.phone },
    });

    if (!existingContact) {
      await prisma.$transaction(async (tx) => {
        const resourceKey = await allocateResourceKey(
          tx,
          company.id,
          PublicResourceType.CONTACT,
        );
        await tx.uploadedContact.create({
          data: {
            companyId: company.id,
            phone: contact.phone,
            name: contact.name,
            resourceKey,
            campaignIds: [campaign.id],
          },
        });
      });
      console.log(`Added uploaded contact: ${contact.phone}`);
    } else if (!existingContact.campaignIds.includes(campaign.id)) {
      await prisma.uploadedContact.update({
        where: { id: existingContact.id },
        data: { campaignIds: { push: campaign.id } },
      });
      console.log(`Linked contact ${contact.phone} to campaign`);
    }

    const existingLead = await prisma.lead.findFirst({
      where: { companyId: company.id, phone: contact.phone },
    });
    if (!existingLead) {
      await prisma.lead.create({
        data: {
          companyId: company.id,
          campaignId: campaign.id,
          stageId: stage.id,
          phone: contact.phone,
          firstName: contact.name,
          queueStatus: "PENDING",
          assignedAiAgentId: agent.id,
        },
      });
      console.log(`Added lead: ${contact.phone}`);
    } else {
      await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          queueStatus: "PENDING",
          channelId: null,
          lockedAt: null,
          campaignId: campaign.id,
          assignedAiAgentId: agent.id,
        },
      });
      console.log(`Reset lead queue: ${contact.phone}`);
    }
  }

  const apiKeyName = "Nirupam Provision Key";
  const generated = generateApiKey("TEST");
  const existingKey = await prisma.apiKey.findFirst({
    where: { companyId: company.id, name: apiKeyName },
  });

  let apiKeyPlaintext;
  if (existingKey) {
    await prisma.apiKey.update({
      where: { id: existingKey.id },
      data: {
        keyId: generated.keyId,
        keyPrefix: generated.keyPrefix,
        hashedSecret: generated.hashedSecret,
        environment: "TEST",
        scopes: [
          PERMISSIONS.CALL_LOGS_WRITE,
          PERMISSIONS.CAMPAIGNS_WRITE,
          PERMISSIONS.CAMPAIGNS_READ,
        ],
        status: "ACTIVE",
        deletedAt: null,
        campaignAccessType: "ALL",
        createdById: ownerMember.userId,
      },
    });
    apiKeyPlaintext = generated.plaintext;
    console.log("Rotated API key");
  } else {
    await prisma.apiKey.create({
      data: {
        companyId: company.id,
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
        createdById: ownerMember.userId,
      },
    });
    apiKeyPlaintext = generated.plaintext;
    console.log("Created API key");
  }

  await connectRedisOnStartup();
  await channelService.initializeCompany(company.id, CHANNEL_COUNT, 0, []);
  console.log("Initialized Redis channel pool");

  const mainServerUrl =
    process.env.MAIN_SERVER_URL?.trim() || "http://localhost:3004";

  console.log("\n--- Starting campaign execution ---");
  const execRes = await fetch(
    `${mainServerUrl}/api/campaigns/${encodeURIComponent(campaignPublicId)}/execution/start`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyPlaintext}`,
      },
      body: JSON.stringify({}),
    },
  );
  const execBody = await execRes.json().catch(() => ({}));
  console.log(`Execution start: ${execRes.status}`, JSON.stringify(execBody, null, 2));

  console.log("\n--- Placing test outbound call ---");
  for (const contact of CONTACT_PHONES) {
    const callRes = await fetch(`${mainServerUrl}/api/calls/outbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyPlaintext}`,
      },
      body: JSON.stringify({
        campaignId: campaignPublicId,
        phoneNumber: contact.phone,
      }),
    });
    const callBody = await callRes.json().catch(() => ({}));
    console.log(`Outbound ${contact.phone}: ${callRes.status}`, JSON.stringify(callBody, null, 2));
  }

  console.log("\n=== Provision complete ===");
  console.log(`Company ID:     ${company.id}`);
  console.log(`Campaign ID:    ${campaignPublicId}`);
  console.log(`Service number: ${SERVICE_NUMBER}`);
  console.log(`API key:        ${apiKeyPlaintext}`);
  console.log(`Contacts:       ${CONTACT_PHONES.map((c) => c.phone).join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
