/**
 * Manual end-to-end test for Phase 3 outbound call persistence.
 * Run: npx tsx scripts/test-outbound-call-flow.ts
 * Optional: AUTH_BEARER=<api-key> TEST_BASE_URL=http://localhost:3004 for REST test
 */
import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCampaignPublicId } from "@/server/lib/public-id";
import prisma from "@/server/lib/prisma";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const VALID_CLI = /^[A-Z]{2,5}$/;
const CAMPAIGN_PUBLIC_ID_PATTERN = /^v1\.[A-Z]{2,5}\.CP\d{6}$/;
const ENTITY_PUBLIC_ID_PATTERN = /^v1\.[A-Z]{2,5}\.CP\d{6}\.(CL|PH)\d+$/;

async function findOrCreateTestTenant() {
  const candidates = await prisma.company.findMany({
    where: { cli: { not: "" } },
    take: 20,
    select: {
      id: true,
      cli: true,
      companyCode: true,
      name: true,
      campaigns: {
        take: 1,
        select: { id: true, resourceKey: true, name: true },
      },
      members: {
        where: { status: "ACTIVE" },
        take: 1,
        select: { id: true, userId: true, role: true },
      },
    },
  });

  const existing = candidates.find(
    (row) =>
      VALID_CLI.test(row.cli) &&
      row.campaigns[0] &&
      row.members[0],
  );

  if (existing) {
    return {
      company: existing,
      campaign: existing.campaigns[0]!,
      member: existing.members[0]!,
      created: false as const,
      userId: null as string | null,
    };
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  const cli = Array.from({ length: 3 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join("");
  const companyCode = Array.from({ length: 6 }, () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return chars[Math.floor(Math.random() * chars.length)];
  }).join("");

  const user = await prisma.user.create({
    data: {
      clerkUserId: `manual_flow_${suffix}`,
      email: `manual-flow-${suffix}@test.com`,
      firstName: "Manual",
      lastName: "Tester",
    },
  });

  const company = await prisma.company.create({
    data: {
      name: `Manual Flow Test ${suffix}`,
      slug: `manual-flow-${suffix}`,
      contractId: `MF${suffix.toUpperCase()}`.slice(0, 10),
      cli,
      companyCode,
      ownerUserId: user.clerkUserId,
      members: {
        create: {
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
          campaignAccessType: "ALL",
          joinedAt: new Date(),
        },
      },
      campaigns: {
        create: {
          resourceKey: `CP${String(Math.floor(Math.random() * 999999) + 1).padStart(6, "0")}`,
          name: "Manual Test Campaign",
        },
      },
    },
    include: {
      campaigns: { take: 1 },
      members: { where: { userId: user.id }, take: 1 },
    },
  });

  return {
    company,
    campaign: company.campaigns[0]!,
    member: company.members[0]!,
    created: true as const,
    userId: user.id,
  };
}

async function verifyDatabase(
  companyId: string,
  campaignId: string,
  phone: string,
  campaignPublicId: string,
  first: Awaited<ReturnType<typeof outboundCallsService.createOutboundCall>>,
  second: Awaited<ReturnType<typeof outboundCallsService.createOutboundCall>>,
) {
  console.log("\n--- Step 3: Verify MongoDB records ---");

  const phoneRecords = await prisma.phoneNumber.findMany({
    where: { companyId, campaignId, number: phone },
    select: {
      publicId: true,
      phoneNumberId: true,
      number: true,
      provider: true,
      campaignId: true,
    },
  });

  const callLogs = await prisma.callLog.findMany({
    where: {
      companyId,
      campaignId,
      publicId: { in: [first.callLogId, second.callLogId] },
    },
    select: {
      publicId: true,
      callLogId: true,
      status: true,
      direction: true,
      phoneNumberId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("PhoneNumber records:", JSON.stringify(phoneRecords, null, 2));
  console.log("CallLog records:", JSON.stringify(callLogs, null, 2));

  const checks: [string, boolean][] = [
    ["campaign public ID format", CAMPAIGN_PUBLIC_ID_PATTERN.test(campaignPublicId)],
    ["call log public ID format", ENTITY_PUBLIC_ID_PATTERN.test(first.callLogId)],
    ["phone number public ID format", ENTITY_PUBLIC_ID_PATTERN.test(first.phoneNumberId)],
    ["first.status is PENDING", first.status === "PENDING"],
    ["second.status is PENDING", second.status === "PENDING"],
    ["phone reused", first.phoneNumberId === second.phoneNumberId],
    ["distinct call logs", first.callLogId !== second.callLogId],
    ["single phone record", phoneRecords.length === 1],
    ["two call log records", callLogs.length === 2],
    ["call logs OUTBOUND", callLogs.every((c) => c.direction === "OUTBOUND")],
    ["call logs PENDING", callLogs.every((c) => c.status === "PENDING")],
    [
      "public IDs stored",
      phoneRecords[0]?.publicId === first.phoneNumberId &&
        callLogs.every((c) => c.publicId.startsWith("v1.")),
    ],
  ];

  console.log("\n--- Assertions ---");
  let passed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (ok) passed += 1;
  }

  return { passed, total: checks.length };
}

async function runRestFlow(baseUrl: string, campaignPublicId: string, phone: string) {
  console.log(`\n--- Step 4: REST API POST ${baseUrl}/api/calls/outbound ---`);

  const token = process.env.AUTH_BEARER;
  if (!token) {
    console.log("(Skipped — set AUTH_BEARER to an API key to test REST.)");
    return { skipped: true };
  }

  const res = await fetch(`${baseUrl}/api/calls/outbound`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      campaignId: campaignPublicId,
      phoneNumber: phone,
    }),
  });

  const body = await res.json();
  console.log("Status:", res.status);
  console.log("Body:", JSON.stringify(body, null, 2));
  return { skipped: false, status: res.status, body };
}

async function main() {
  await prisma.company.deleteMany({
    where: { slug: { startsWith: "manual-flow-" } },
  });

  const setup = await findOrCreateTestTenant();
  const { company, campaign, member } = setup;
  const campaignPublicId = generateCampaignPublicId({
    cli: company.cli,
    campaignResourceKey: campaign.resourceKey,
  });

  assert.match(campaignPublicId, CAMPAIGN_PUBLIC_ID_PATTERN);

  const phone = `+9199${Date.now().toString().slice(-8)}`;

  console.log("Tenant:", {
    companyId: company.id,
    companyName: company.name,
    cli: company.cli,
    campaignId: campaign.id,
    campaignPublicId,
    campaignName: campaign.name,
    phone,
    tenantCreated: setup.created,
  });

  const ctx: TenantContext = {
    authType: "user",
    userId: member.userId,
    clerkUserId: "manual_test",
    companyId: company.id,
    membershipId: member.id,
    role: member.role,
    permissions: [PERMISSIONS.CALL_LOGS_READ, PERMISSIONS.CALL_LOGS_WRITE],
    campaignAccess: { type: "ALL", campaignIds: [] },
    loaders: {} as TenantContext["loaders"],
  };

  console.log("\n--- Step 1: Create first outbound call ---");
  const first = await outboundCallsService.createOutboundCall(ctx, {
    campaignId: campaignPublicId,
    phoneNumber: phone,
  });
  console.log("Response:", JSON.stringify(first, null, 2));

  console.log("\n--- Step 2: Create second outbound call (same number) ---");
  const second = await outboundCallsService.createOutboundCall(ctx, {
    campaignId: campaignPublicId,
    phoneNumber: phone,
  });
  console.log("Response:", JSON.stringify(second, null, 2));

  const { passed, total } = await verifyDatabase(
    company.id,
    campaign.id,
    phone,
    campaignPublicId,
    first,
    second,
  );

  const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3004";
  await runRestFlow(
    baseUrl,
    campaignPublicId,
    `+9198${Date.now().toString().slice(-8)}`,
  );

  console.log(`\n=== Result: ${passed}/${total} checks passed ===`);

  if (setup.created && setup.userId) {
    console.log("\nCleaning up temporary test tenant...");
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.user.delete({ where: { id: setup.userId } });
  }

  if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
