const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting DB wipe...');
  
  // 1. Detach PhoneNumbers and CallLogs to be 100% safe
  console.log('Detaching PhoneNumbers and CallLogs from Companies...');
  const phones = await prisma.phoneNumber.findMany();
  for (const phone of phones) {
    await prisma.phoneNumber.update({
      where: { id: phone.id },
      data: { 
        companyId: null, 
        campaignId: null, 
        assignedParentTenantId: null, 
        phoneNumberId: phone.id,
        number: phone.number + '-' + phone.id,
        publicId: phone.publicId + '-' + phone.id
      }
    });
  }
  
  await prisma.callLog.updateMany({
    data: { companyId: null, leadId: null, assignedUserId: null, campaignId: null, aiAgentId: null }
  });
  
  await prisma.company.updateMany({
    data: { parentCompanyId: null }
  });
  
  // 2. Wipe everything else that is user/company related
  console.log('Wiping user and company data...');
  
  // Delete in order of dependencies (child to parent)
  const tablesToWipe = [
    'companyMember',
    'memberCampaignAccess',
    'invitation',
    'pendingApproval',
    'lead',
    'uploadedContact',
    'leadAssignment',
    'leadActivity',
    'leadNote',
    'leadPipelineStage',
    'leadSource',
    'billingQuote',
    'agentLibraryEntry',
    'aiAgent',
    'agentCommunicationChannel',
    'agentPromptTemplate',
    'agentToolAssignment',
    'knowledgeSource',
    'analyticsSnapshot',
    'outboundCampaign',
    'schedulerEvent',
    'integrationSyncLog',
    'integration',
    'webhookEndpoint',
    'auditLog',
    'notification',
    'csvImportBatch',
    'apiKeyCampaignAccess',
    'apiKey',
    'creditBalance',
    'creditUsage',
    'billingSubscription',
    'billingInvoice',
    'systemEvent',
    'companyContact',
    'companySetupConfig',
    'companyChannel',
    'companyBillingRates',
    'supportRequest',
    'channel',
    'dialerCall',
    'dialerIntegrationLog',
    'contactRetryJob',
    'campaignDocument',
    'campaignActivity',
    'campaignInvitation',
    'campaignExecution',
    'campaign',
    'role',
    'companyResourceSequence',
    'user',
    'company'
  ];

  for (const table of tablesToWipe) {
    try {
      console.log(`Wiping ${table}...`);
      await prisma[table].deleteMany({});
    } catch (e) {
      console.log(`Could not wipe ${table}: ${e.message}`);
    }
  }

  console.log('DB wipe complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
