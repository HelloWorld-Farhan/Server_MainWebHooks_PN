const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { startCampaignJob } = require("./dist/server/queues/campaign-execution.queue");

async function run() {
  console.log("Mocking cron execution...");
  const now = new Date();
  
  // Inject some fake failed calls if needed, but let's just run the extraction
  const failedCalls = await prisma.callLog.findMany({
    where: {
      direction: "OUTBOUND",
      OR: [
        { status: { in: ["FAILED", "MISSED", "BUSY", "NO-ANSWER", "CANCELLED"] } },
        { durationSeconds: 0 },
      ],
      leadId: { not: null },
      companyId: { not: null },
    },
    include: {
      lead: true,
      phoneNumber: true,
    },
    take: 10
  });
  
  console.log(`Found ${failedCalls.length} failed calls to reactivate.`);
  
  const buckets = {};
  for (const call of failedCalls) {
    if (!call.lead) continue;
    const key = `${call.companyId}-${call.phoneNumber?.number || "default"}`;
    if (!buckets[key]) {
      buckets[key] = {
        companyId: call.companyId,
        didNumber: call.phoneNumber?.number || "",
        leads: [],
      };
    }
    if (!buckets[key].leads.find(l => l.id === call.leadId)) {
       buckets[key].leads.push({
         ...call.lead,
         id: call.leadId,
         phone: call.lead.phone,
       });
    }
  }

  for (const key of Object.keys(buckets)) {
    const bucket = buckets[key];
    if (bucket.leads.length === 0) continue;
    console.log(`[TEST] Would schedule 3 waves for Company ${bucket.companyId} with ${bucket.leads.length} leads.`);
  }
}

run().catch(console.error).finally(() => process.exit(0));
