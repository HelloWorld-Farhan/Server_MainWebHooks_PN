/**
 * One-time migration: map legacy QUEUED call logs to QUEUED_AT_PROVIDER.
 *
 * Run with:
 *   npx tsx -r tsconfig-paths/register scripts/migrate-queued-call-status.ts
 */
import prisma from "@/server/lib/prisma";

async function main() {
  const result = await prisma.callLog.updateMany({
    where: { status: "QUEUED" as never },
    data: { status: "QUEUED_AT_PROVIDER" },
  });

  console.info(
    `Migrated ${result.count} call log(s) from QUEUED to QUEUED_AT_PROVIDER`,
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
