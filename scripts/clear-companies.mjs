/**
 * Removes all companies and tenant-scoped data from MongoDB.
 * Preserves users and the global AgentLibraryEntry catalog.
 *
 * Usage: npx dotenv -e .env.production -- node scripts/clear-companies.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function countSnapshot(label) {
  const [companies, users, aiAgents, libraryEntries] = await Promise.all([
    prisma.company.count(),
    prisma.user.count(),
    prisma.aiAgent.count(),
    prisma.agentLibraryEntry.count(),
  ]);

  console.log(`\n=== ${label} ===`);
  console.log(`Companies: ${companies}`);
  console.log(`Users: ${users}`);
  console.log(`AiAgents: ${aiAgents}`);
  console.log(`AgentLibraryEntry (preserved): ${libraryEntries}`);
}

async function main() {
  await countSnapshot("Before cleanup");

  const contactRetryJobs = await prisma.contactRetryJob.deleteMany();
  const retryCallLogs = await prisma.callLog.deleteMany({ where: { isRetry: true } });
  const callLogs = await prisma.callLog.deleteMany();
  const billingInvoices = await prisma.billingInvoice.deleteMany();
  const billingSubscriptions = await prisma.billingSubscription.deleteMany();
  const creditUsages = await prisma.creditUsage.deleteMany();
  const creditBalances = await prisma.creditBalance.deleteMany();
  const supportRequests = await prisma.supportRequest.deleteMany();
  const companies = await prisma.company.deleteMany();

  console.log("\n=== Deleted ===");
  console.log(`ContactRetryJob: ${contactRetryJobs.count}`);
  console.log(`CallLog (retries): ${retryCallLogs.count}`);
  console.log(`CallLog: ${callLogs.count}`);
  console.log(`BillingInvoice: ${billingInvoices.count}`);
  console.log(`BillingSubscription: ${billingSubscriptions.count}`);
  console.log(`CreditUsage: ${creditUsages.count}`);
  console.log(`CreditBalance: ${creditBalances.count}`);
  console.log(`SupportRequest: ${supportRequests.count}`);
  console.log(`Company: ${companies.count}`);

  await countSnapshot("After cleanup");
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
