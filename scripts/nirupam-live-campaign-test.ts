/**
 * Nirupam Testing Company — live OBD campaign smoke test.
 *
 * Run:
 *   dotenv -e .env.production -- npx tsx scripts/nirupam-live-campaign-test.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";
import { campaignRunnerService } from "@/server/campaign-execution/campaign-runner.service";
import { connectRedisOnStartup } from "@/server/cache/redis.client";
import { toCampaignPublicId } from "@/server/lib/public-id/mapper";
import prisma from "@/server/lib/prisma";
import { channelService } from "@/server/channels/channel.service";
import { campaignsService } from "@/server/services/campaigns.service";
import { uploadedContactsService } from "@/server/services/uploaded-contacts.service";
import { PERMISSIONS } from "@/server/types/permissions";
import type { TenantContext } from "@/server/types/context";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.production") });

const COMPANY_SLUG = "nirupam-testing-company-qxrpp6";
const TEST_PHONE = "+918810214283";
const POLL_INTERVAL_MS = 2_000;
const POLL_DURATION_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function buildTenantContext(
  companyId: string,
  userId: string,
  clerkUserId: string,
  membershipId: string,
): TenantContext {
  return {
    authType: "user",
    userId,
    clerkUserId,
    companyId,
    membershipId,
    role: "OWNER",
    permissions: [
      PERMISSIONS.CAMPAIGNS_READ,
      PERMISSIONS.CAMPAIGNS_WRITE,
      PERMISSIONS.LEADS_READ,
      PERMISSIONS.LEADS_WRITE,
      PERMISSIONS.CALL_LOGS_WRITE,
    ],
    campaignAccess: { type: "ALL", campaignIds: [] },
    loaders: {} as TenantContext["loaders"],
  };
}

async function resolveNirupamContext(): Promise<TenantContext> {
  const company = await prisma.company.findUnique({
    where: { slug: COMPANY_SLUG },
    include: {
      setupConfig: true,
      members: {
        where: { status: "ACTIVE", role: "OWNER" },
        take: 1,
        include: { user: true },
      },
    },
  });

  if (!company) {
    throw new Error(`Company not found for slug: ${COMPANY_SLUG}`);
  }

  const owner = company.members[0];
  if (!owner) {
    throw new Error("No active OWNER member found for Nirupam Testing Company");
  }

  const ctx = buildTenantContext(
    company.id,
    owner.userId,
    owner.user.clerkUserId,
    owner.id,
  );

  if (company.setupConfig) {
    await channelService.initializeCompany(
      company.id,
      company.setupConfig.totalChannels,
      0,
      [],
    );
    console.log(
      `Initialized Redis channels: allocated=${company.setupConfig.totalChannels}, serviceNumber=${company.setupConfig.serviceNumber}`,
    );
  }

  console.log({
    companyId: company.id,
    companyName: company.name,
    cli: company.cli,
    ownerEmail: owner.user.email,
  });

  return ctx;
}

async function printCallLogDiagnostics(
  companyId: string,
  campaignId: string,
): Promise<void> {
  const logs = await prisma.callLog.findMany({
    where: { companyId, campaignId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      publicId: true,
      status: true,
      disconnectReason: true,
      providerRequestedAt: true,
      providerAcceptedAt: true,
      providerCompletedAt: true,
      providerRequest: true,
      providerResponse: true,
      createdAt: true,
    },
  });

  if (logs.length === 0) {
    console.log("\nNo call logs yet for this campaign.");
    return;
  }

  console.log("\n=== Recent call logs ===");
  for (const log of logs) {
    console.log(JSON.stringify(log, null, 2));
  }
}

async function main() {
  const campaignName = `Live Test ${new Date().toISOString().slice(0, 10)}`;

  console.log("Nirupam Live Campaign Test");
  console.log(`Phone: ${TEST_PHONE}`);
  console.log(`Campaign name: ${campaignName}`);

  await connectRedisOnStartup();
  const ctx = await resolveNirupamContext();

  console.log("\n=== Step 1: Create campaign ===");
  const created = await campaignsService.create(ctx, {
    name: campaignName,
    status: "ACTIVE",
    aiEnabled: false,
  });
  const campaignInternalId = created.id;

  const campaignRow = await prisma.campaign.findFirst({
    where: { id: campaignInternalId, companyId: ctx.companyId },
    select: { id: true, resourceKey: true, name: true },
  });
  if (!campaignRow) {
    throw new Error("Created campaign not found");
  }

  const campaignPublicId = await toCampaignPublicId(
    ctx,
    campaignRow.resourceKey,
  );
  console.log({
    campaignInternalId,
    campaignPublicId,
    resourceKey: campaignRow.resourceKey,
    name: campaignRow.name,
  });

  console.log("\n=== Step 2: Import contact ===");
  const importResult = await uploadedContactsService.importContacts(ctx, [
    {
      phone: TEST_PHONE,
      field1: "Nirupam Live Test",
      campaignIds: [campaignInternalId],
    },
  ]);
  console.log(importResult);

  const contactCount = await prisma.uploadedContact.count({
    where: {
      companyId: ctx.companyId,
      campaignIds: { has: campaignInternalId },
    },
  });
  console.log(`Contacts linked to campaign: ${contactCount}`);
  if (contactCount === 0) {
    throw new Error("No contacts linked to the new campaign");
  }

  console.log("\n=== Step 3: Start campaign execution ===");
  const execution = await campaignExecutionService.start(ctx, campaignPublicId);
  console.log({
    status: execution.status,
    totalContacts: execution.totalContacts,
    correlationId: execution.correlationId,
    startedAt: execution.startedAt,
  });

  console.log(
    `\n=== Step 4: Poll runner for ${POLL_DURATION_MS / 1000}s ===`,
  );
  const deadline = Date.now() + POLL_DURATION_MS;
  let lastProcessed = 0;

  while (Date.now() < deadline) {
    const processed = await campaignRunnerService.processRunnableCampaigns();
    if (processed > 0) {
      lastProcessed = processed;
      console.log(`Runner processed ${processed} campaign(s)`);
    }

    const latestLog = await prisma.callLog.findFirst({
      where: { companyId: ctx.companyId, campaignId: campaignInternalId },
      orderBy: { createdAt: "desc" },
      select: { status: true, publicId: true },
    });

    if (latestLog) {
      console.log(
        `Latest call log: ${latestLog.publicId} status=${latestLog.status}`,
      );
      if (
        latestLog.status !== "QUEUED" &&
        latestLog.status !== "DISPATCHING"
      ) {
        break;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (lastProcessed === 0) {
    console.log(
      "Runner did not process campaigns locally — production worker may pick this up.",
    );
  }

  const finalExecution = await prisma.campaignExecution.findUnique({
    where: { campaignId: campaignInternalId },
    select: {
      status: true,
      processedCount: true,
      totalContacts: true,
      statsFailed: true,
      statsCompleted: true,
      statsDialing: true,
      failureReason: true,
    },
  });

  console.log("\n=== Campaign execution status ===");
  console.log(finalExecution);

  await printCallLogDiagnostics(ctx.companyId, campaignInternalId);

  console.log("\n=== Done ===");
  console.log(
    "Check phone 8810214283 for an incoming call and report whether it rang.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
