#!/usr/bin/env node
/**
 * MongoDB migration via Prisma: Branch → Campaign rename.
 * Run from propnex-main-server:
 *   node scripts/migrate-branch-to-campaign-mongo.mjs [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");
const prisma = new PrismaClient();

const COLLECTION_RENAMES = [
  ["Campaign", "OutboundCampaign"],
  ["Branch", "Campaign"],
  ["BranchDocument", "CampaignDocument"],
  ["BranchActivity", "CampaignActivity"],
  ["BranchInvitation", "CampaignInvitation"],
  ["MemberBranchAccess", "MemberCampaignAccess"],
  ["ApiKeyBranchAccess", "ApiKeyCampaignAccess"],
];

const FIELD_RENAMES = [
  { collection: "CompanyMember", from: "branchAccessType", to: "campaignAccessType" },
  { collection: "Invitation", from: "branchAccessType", to: "campaignAccessType" },
  { collection: "Invitation", from: "branchIds", to: "campaignIds" },
  { collection: "Lead", from: "branchId", to: "campaignId" },
  { collection: "CallLog", from: "branchId", to: "campaignId" },
  { collection: "AiAgent", from: "branchId", to: "campaignId" },
  { collection: "UploadedContact", from: "branchIds", to: "campaignIds" },
  { collection: "ApiKey", from: "branchAccessType", to: "campaignAccessType" },
  { collection: "MemberCampaignAccess", from: "branchId", to: "campaignId" },
  { collection: "ApiKeyCampaignAccess", from: "branchId", to: "campaignId" },
  { collection: "CampaignDocument", from: "branchId", to: "campaignId" },
  { collection: "CampaignActivity", from: "branchId", to: "campaignId" },
  { collection: "CampaignInvitation", from: "branchId", to: "campaignId" },
];

async function listCollections() {
  const result = await prisma.$runCommandRaw({ listCollections: 1 });
  const cursor = result.cursor;
  const firstBatch = cursor?.firstBatch ?? [];
  return new Set(firstBatch.map((c) => c.name));
}

async function renameCollection(existing, from, to) {
  if (!existing.has(from)) {
    console.log(`  skip collection rename (not found): ${from}`);
    return existing;
  }
  if (existing.has(to)) {
    console.log(`  skip collection rename (target exists): ${from} → ${to}`);
    return existing;
  }
  console.log(`  rename collection: ${from} → ${to}`);
  if (!DRY_RUN) {
    // Atlas requires admin for renameCollection — use copy + drop instead.
    await prisma.$runCommandRaw({
      aggregate: from,
      pipeline: [{ $match: {} }, { $out: to }],
      cursor: {},
    });
    await prisma.$runCommandRaw({ drop: from });
    existing.delete(from);
    existing.add(to);
  }
  return existing;
}

async function renameField(collection, from, to, existing) {
  if (!existing.has(collection)) {
    console.log(`  skip field rename (collection not found): ${collection}.${from}`);
    return;
  }

  const countResult = await prisma.$runCommandRaw({
    count: collection,
    query: { [from]: { $exists: true } },
  });
  const count = Number(countResult.n ?? 0);
  if (count === 0) {
    console.log(`  skip field rename (no docs): ${collection}.${from}`);
    return;
  }

  console.log(`  rename field: ${collection}.${from} → ${to} (${count} docs)`);
  if (!DRY_RUN) {
    await prisma.$runCommandRaw({
      update: collection,
      updates: [
        {
          q: { [from]: { $exists: true } },
          u: { $rename: { [from]: to } },
          multi: true,
        },
      ],
    });
  }
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN\n" : "Running MongoDB migration...\n");

  let collections = await listCollections();

  console.log("1. Renaming collections...");
  for (const [from, to] of COLLECTION_RENAMES) {
    collections = await renameCollection(collections, from, to);
  }

  if (!DRY_RUN) {
    collections = await listCollections();
  }

  console.log("\n2. Renaming fields...");
  for (const spec of FIELD_RENAMES) {
    await renameField(spec.collection, spec.from, spec.to, collections);
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
