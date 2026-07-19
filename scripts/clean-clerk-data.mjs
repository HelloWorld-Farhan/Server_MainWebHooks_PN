/**
 * Removes all Clerk users and organizations.
 *
 * Usage:
 *   npx dotenv -e .env -- node scripts/clean-clerk-data.mjs --dry-run
 *   npx dotenv -e .env -- node scripts/clean-clerk-data.mjs --confirm
 */
import { createClerkClient } from "@clerk/backend";

const secretKey = process.env.CLERK_SECRET_KEY;
const publishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!secretKey) {
  console.error("FAIL: CLERK_SECRET_KEY not set");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm");

if (!dryRun && !confirm) {
  console.error("Pass --dry-run to preview or --confirm to delete.");
  process.exit(1);
}

const clerk = createClerkClient({
  secretKey,
  publishableKey,
});
const PAGE_SIZE = 100;
const DELAY_MS = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOrganizationsDisabled(error) {
  return (
    error?.errors?.some(
      (e) => e.code === "organization_not_enabled_in_instance",
    ) ?? false
  );
}

async function countAll(fetchPage) {
  let total = 0;
  let offset = 0;

  while (true) {
    const page = await fetchPage({ limit: PAGE_SIZE, offset });
    total += page.data.length;
    if (page.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return total;
}

async function deleteAll(label, fetchPage, deleteOne) {
  let deleted = 0;
  let offset = 0;

  while (true) {
    const page = await fetchPage({ limit: PAGE_SIZE, offset });
    if (page.data.length === 0) break;

    for (const item of page.data) {
      if (dryRun) {
        console.log(`[dry-run] would delete ${label}: ${item.id}`);
      } else {
        await deleteOne(item.id);
        console.log(`Deleted ${label}: ${item.id}`);
        await sleep(DELAY_MS);
      }
      deleted += 1;
    }

    if (page.data.length < PAGE_SIZE) break;
    if (!dryRun) offset = 0;
    else offset += PAGE_SIZE;
  }

  return deleted;
}

async function main() {
  console.log(`=== Clerk cleanup (${dryRun ? "dry-run" : "confirm"}) ===`);

  let orgCount = 0;
  let organizationsEnabled = true;

  try {
    orgCount = await countAll((params) =>
      clerk.organizations.getOrganizationList(params),
    );
  } catch (error) {
    if (isOrganizationsDisabled(error)) {
      organizationsEnabled = false;
      console.log("Organizations: disabled in this Clerk instance (skipping)");
    } else {
      throw error;
    }
  }

  const userCount = await countAll((params) => clerk.users.getUserList(params));

  if (organizationsEnabled) {
    console.log(`Organizations: ${orgCount}`);
  }
  console.log(`Users: ${userCount}`);

  if (dryRun) {
    console.log("\nDry-run only — no records deleted.");
    return;
  }

  let deletedOrgs = 0;
  if (organizationsEnabled) {
    deletedOrgs = await deleteAll(
      "organization",
      (params) => clerk.organizations.getOrganizationList(params),
      (id) => clerk.organizations.deleteOrganization(id),
    );
  }

  const deletedUsers = await deleteAll(
    "user",
    (params) => clerk.users.getUserList(params),
    (id) => clerk.users.deleteUser(id),
  );

  console.log("\n=== Deleted ===");
  if (organizationsEnabled) {
    console.log(`Organizations: ${deletedOrgs}`);
  }
  console.log(`Users: ${deletedUsers}`);

  let remainingOrgs = 0;
  if (organizationsEnabled) {
    remainingOrgs = await countAll((params) =>
      clerk.organizations.getOrganizationList(params),
    );
  }
  const remainingUsers = await countAll((params) =>
    clerk.users.getUserList(params),
  );

  console.log("\n=== Remaining ===");
  if (organizationsEnabled) {
    console.log(`Organizations: ${remainingOrgs}`);
  }
  console.log(`Users: ${remainingUsers}`);
}

main().catch((error) => {
  console.error("Clerk cleanup failed:", error);
  process.exit(1);
});
