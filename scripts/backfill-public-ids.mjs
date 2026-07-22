import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

function normalizeCallLogEntityId(value) {
  const trimmed = String(value).trim();
  if (/^CL\d{8}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{8}$/.test(trimmed)) {
    return `CL${trimmed}`;
  }
  return trimmed;
}

function buildPublicId(cli, campaignResourceKey, entityId) {
  return `v1.${cli}.${campaignResourceKey}.${entityId}`;
}

async function getCompanyCli(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { cli: true },
  });
  return company?.cli ?? null;
}

async function getCampaignResourceKey(campaignId) {
  if (!campaignId) return null;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { resourceKey: true },
  });
  return campaign?.resourceKey ?? null;
}

async function inferCallLogCampaignId(callLog) {
  if (callLog.campaignId) {
    return callLog.campaignId;
  }

  if (callLog.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: callLog.leadId },
      select: { campaignId: true },
    });
    if (lead?.campaignId) {
      return lead.campaignId;
    }
  }

  if (callLog.aiAgentId) {
    const agent = await prisma.aiAgent.findUnique({
      where: { id: callLog.aiAgentId },
      select: { campaignId: true },
    });
    if (agent?.campaignId) {
      return agent.campaignId;
    }
  }

  return null;
}

async function inferPhoneNumberCampaignId(phoneNumber) {
  const agentIds = [phoneNumber.inboundAgentId, phoneNumber.outboundAgentId].filter(
    Boolean,
  );
  if (agentIds.length === 0) {
    return null;
  }

  const agents = await prisma.aiAgent.findMany({
    where: { id: { in: agentIds } },
    select: { campaignId: true },
  });

  return agents.find((agent) => agent.campaignId)?.campaignId ?? null;
}

async function backfillCallLogs() {
  const callLogs = await prisma.$runCommandRaw({
    find: "CallLog",
    filter: {},
  });

  const docs = callLogs?.cursor?.firstBatch ?? [];
  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const companyId = doc.companyId?.$oid ?? doc.companyId;
    const id = doc._id?.$oid ?? doc._id;
    const legacyKey = doc.resourceKey ?? doc.callLogId;
    if (!legacyKey) {
      skipped += 1;
      continue;
    }

    const callLogId = normalizeCallLogEntityId(legacyKey);
    const cli = await getCompanyCli(companyId);
    if (!cli) {
      console.warn(`Skipping call log ${id}: missing company CLI`);
      skipped += 1;
      continue;
    }

    const campaignInternalId = await inferCallLogCampaignId({
      campaignId: doc.campaignId?.$oid ?? doc.campaignId ?? null,
      leadId: doc.leadId?.$oid ?? doc.leadId ?? null,
      aiAgentId: doc.aiAgentId?.$oid ?? doc.aiAgentId ?? null,
    });

    if (!campaignInternalId) {
      console.warn(`Skipping call log ${id}: no campaign context`);
      skipped += 1;
      continue;
    }

    const campaignResourceKey = await getCampaignResourceKey(campaignInternalId);
    if (!campaignResourceKey) {
      skipped += 1;
      continue;
    }

    const publicId = buildPublicId(cli, campaignResourceKey, callLogId);

    await prisma.$runCommandRaw({
      update: "CallLog",
      updates: [
        {
          q: { _id: { $oid: id } },
          u: {
            $set: {
              callLogId,
              publicId,
              campaignId: { $oid: campaignInternalId },
            },
            $unset: { resourceKey: "" },
          },
        },
      ],
    });
    updated += 1;
  }

  console.log(`Call logs: updated=${updated}, skipped=${skipped}`);
}

async function backfillPhoneNumbers() {
  const phoneNumbers = await prisma.$runCommandRaw({
    find: "PhoneNumber",
    filter: {},
  });

  const docs = phoneNumbers?.cursor?.firstBatch ?? [];
  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const companyId = doc.companyId?.$oid ?? doc.companyId;
    const id = doc._id?.$oid ?? doc._id;
    const phoneNumberId = doc.phoneNumberId ?? doc.resourceKey;
    if (!phoneNumberId) {
      skipped += 1;
      continue;
    }

    const cli = await getCompanyCli(companyId);
    if (!cli) {
      skipped += 1;
      continue;
    }

    const campaignInternalId = await inferPhoneNumberCampaignId({
      inboundAgentId: doc.inboundAgentId?.$oid ?? doc.inboundAgentId ?? null,
      outboundAgentId: doc.outboundAgentId?.$oid ?? doc.outboundAgentId ?? null,
    });

    if (!campaignInternalId) {
      console.warn(`Skipping phone number ${id}: no campaign context`);
      skipped += 1;
      continue;
    }

    const campaignResourceKey = await getCampaignResourceKey(campaignInternalId);
    if (!campaignResourceKey) {
      skipped += 1;
      continue;
    }

    const publicId = buildPublicId(cli, campaignResourceKey, phoneNumberId);

    await prisma.$runCommandRaw({
      update: "PhoneNumber",
      updates: [
        {
          q: { _id: { $oid: id } },
          u: {
            $set: {
              phoneNumberId,
              publicId,
            },
            $unset: { resourceKey: "" },
          },
        },
      ],
    });
    updated += 1;
  }

  console.log(`Phone numbers: updated=${updated}, skipped=${skipped}`);
}

async function main() {
  console.log("Starting public ID backfill...");
  await backfillCallLogs();
  await backfillPhoneNumbers();
  console.log("Backfill complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
