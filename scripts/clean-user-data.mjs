/**
 * Removes all tenant/user data from MongoDB.
 * Preserves the global AgentLibraryEntry catalog (agent library).
 *
 * Usage: npx dotenv -e .env -- node scripts/clean-user-data.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function countSnapshot(label) {
  const [
    users,
    companies,
    aiAgents,
    libraryEntries,
    supportRequests,
    billingSubs,
    billingInvoices,
    creditBalances,
    creditUsages,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.company.count(),
    prisma.aiAgent.count(),
    prisma.agentLibraryEntry.count(),
    prisma.supportRequest.count(),
    prisma.billingSubscription.count(),
    prisma.billingInvoice.count(),
    prisma.creditBalance.count(),
    prisma.creditUsage.count(),
  ]);

  console.log(`\n=== ${label} ===`);
  console.log(`User: ${users}`);
  console.log(`Company: ${companies}`);
  console.log(`AiAgent (deployed): ${aiAgents}`);
  console.log(`AgentLibraryEntry (preserved): ${libraryEntries}`);
  console.log(`SupportRequest: ${supportRequests}`);
  console.log(`BillingSubscription: ${billingSubs}`);
  console.log(`BillingInvoice: ${billingInvoices}`);
  console.log(`CreditBalance: ${creditBalances}`);
  console.log(`CreditUsage: ${creditUsages}`);
}

async function main() {
  await countSnapshot("Before cleanup");

  const billingInvoices = await prisma.billingInvoice.deleteMany();
  const billingSubscriptions = await prisma.billingSubscription.deleteMany();
  const creditUsages = await prisma.creditUsage.deleteMany();
  const creditBalances = await prisma.creditBalance.deleteMany();
  const supportRequests = await prisma.supportRequest.deleteMany();

  // Tenant data cascades from Company (leads, calls, deployed agents, integrations, etc.).
  const companies = await prisma.company.deleteMany();
  const users = await prisma.user.deleteMany();

  console.log("\n=== Deleted ===");
  console.log(`BillingInvoice: ${billingInvoices.count}`);
  console.log(`BillingSubscription: ${billingSubscriptions.count}`);
  console.log(`CreditUsage: ${creditUsages.count}`);
  console.log(`CreditBalance: ${creditBalances.count}`);
  console.log(`SupportRequest: ${supportRequests.count}`);
  console.log(`Company: ${companies.count}`);
  console.log(`User: ${users.count}`);

  const libraryEntries = await prisma.agentLibraryEntry.count();
  console.log(`\nAgentLibraryEntry preserved: ${libraryEntries}`);

  await countSnapshot("After cleanup");
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
