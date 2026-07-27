/**
 * Removes all tenant/user data from MongoDB.
 * Preserves the global AgentLibraryEntry catalog (agent library).
 *
 * Deletes child collections explicitly (avoids Prisma Mongo cascade/unique issues),
 * then companies and users.
 *
 * Usage:
 *   npx dotenv -e .env -- node scripts/clean-user-data.mjs
 *   npx dotenv -e .env.production -- node scripts/clean-user-data.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** @type {Array<[string, () => Promise<{ count: number }>]>} */
const DELETE_STEPS = [
  ["MemberCampaignAccess", () => prisma.memberCampaignAccess.deleteMany()],
  ["ApiKeyCampaignAccess", () => prisma.apiKeyCampaignAccess.deleteMany()],
  ["CallLogProviderEvent", () => prisma.callLogProviderEvent.deleteMany()],
  ["CallTranscript", () => prisma.callTranscript.deleteMany()],
  ["CallInternalNote", () => prisma.callInternalNote.deleteMany()],
  ["CallAnalysis", () => prisma.callAnalysis.deleteMany()],
  ["CallEvent", () => prisma.callEvent.deleteMany()],
  ["DialerIntegrationLog", () => prisma.dialerIntegrationLog.deleteMany()],
  ["DialerCall", () => prisma.dialerCall.deleteMany()],
  ["ContactRetryJob", () => prisma.contactRetryJob.deleteMany()],
  [
    "CallLog.parentCallLogId clear",
    async () => {
      const result = await prisma.callLog.updateMany({
        where: { parentCallLogId: { not: null } },
        data: { parentCallLogId: null },
      });
      return { count: result.count };
    },
  ],
  ["CallLog", () => prisma.callLog.deleteMany()],
  ["LeadAssignment", () => prisma.leadAssignment.deleteMany()],
  ["LeadNote", () => prisma.leadNote.deleteMany()],
  ["LeadActivity", () => prisma.leadActivity.deleteMany()],
  ["Lead", () => prisma.lead.deleteMany()],
  ["LeadSource", () => prisma.leadSource.deleteMany()],
  ["LeadPipelineStage", () => prisma.leadPipelineStage.deleteMany()],
  ["AgentToolAssignment", () => prisma.agentToolAssignment.deleteMany()],
  ["AgentPromptTemplate", () => prisma.agentPromptTemplate.deleteMany()],
  ["AgentCommunicationChannel", () => prisma.agentCommunicationChannel.deleteMany()],
  ["KnowledgeSource", () => prisma.knowledgeSource.deleteMany()],
  ["PhoneNumber", () => prisma.phoneNumber.deleteMany()],
  ["UploadedContact", () => prisma.uploadedContact.deleteMany()],
  ["OutboundCampaign", () => prisma.outboundCampaign.deleteMany()],
  ["SchedulerEvent", () => prisma.schedulerEvent.deleteMany()],
  ["IntegrationSyncLog", () => prisma.integrationSyncLog.deleteMany()],
  ["Integration", () => prisma.integration.deleteMany()],
  ["WebhookEndpoint", () => prisma.webhookEndpoint.deleteMany()],
  ["AuditLog", () => prisma.auditLog.deleteMany()],
  ["Notification", () => prisma.notification.deleteMany()],
  ["CsvImportBatch", () => prisma.csvImportBatch.deleteMany()],
  ["ApiKey", () => prisma.apiKey.deleteMany()],
  ["CreditUsage", () => prisma.creditUsage.deleteMany()],
  ["CreditBalance", () => prisma.creditBalance.deleteMany()],
  ["BillingInvoice", () => prisma.billingInvoice.deleteMany()],
  ["BillingSubscription", () => prisma.billingSubscription.deleteMany()],
  ["BillingQuote", () => prisma.billingQuote.deleteMany()],
  ["CampaignDocument", () => prisma.campaignDocument.deleteMany()],
  ["CampaignActivity", () => prisma.campaignActivity.deleteMany()],
  ["CampaignInvitation", () => prisma.campaignInvitation.deleteMany()],
  ["CampaignExecution", () => prisma.campaignExecution.deleteMany()],
  ["Channel", () => prisma.channel.deleteMany()],
  ["CompanyChannel", () => prisma.companyChannel.deleteMany()],
  ["AiAgent", () => prisma.aiAgent.deleteMany()],
  ["Campaign", () => prisma.campaign.deleteMany()],
  ["Invitation", () => prisma.invitation.deleteMany()],
  ["CompanyMember", () => prisma.companyMember.deleteMany()],
  ["Role", () => prisma.role.deleteMany()],
  ["CompanyContact", () => prisma.companyContact.deleteMany()],
  ["CompanySetupConfig", () => prisma.companySetupConfig.deleteMany()],
  ["CompanyBillingRates", () => prisma.companyBillingRates.deleteMany()],
  ["CompanyResourceSequence", () => prisma.companyResourceSequence.deleteMany()],
  ["SystemEvent", () => prisma.systemEvent.deleteMany()],
  ["SupportRequest", () => prisma.supportRequest.deleteMany()],
  ["AnalyticsSnapshot", () => prisma.analyticsSnapshot.deleteMany()],
  ["Company", () => prisma.company.deleteMany()],
  ["User", () => prisma.user.deleteMany()],
];

async function countSnapshot(label) {
  const [users, companies, aiAgents, libraryEntries] = await Promise.all([
    prisma.user.count(),
    prisma.company.count(),
    prisma.aiAgent.count(),
    prisma.agentLibraryEntry.count(),
  ]);

  console.log(`\n=== ${label} ===`);
  console.log(`User: ${users}`);
  console.log(`Company: ${companies}`);
  console.log(`AiAgent (deployed): ${aiAgents}`);
  console.log(`AgentLibraryEntry (preserved): ${libraryEntries}`);
}

async function main() {
  await countSnapshot("Before cleanup");

  console.log("\n=== Deleted ===");
  for (const [label, run] of DELETE_STEPS) {
    const result = await run();
    if (result.count > 0) {
      console.log(`${label}: ${result.count}`);
    }
  }

  await countSnapshot("After cleanup");
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
