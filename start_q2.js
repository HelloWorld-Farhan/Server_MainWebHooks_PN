require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const Redis = require("ioredis");
const { Queue } = require("bullmq");

async function main() {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  
  // 1. We know the correlation prefix: "reactivation-2026-09-19-6a8bed4d-" (approx)
  // Let's get the most recent reactivation logs
  const logs = await prisma.callLog.findMany({
    where: { correlationId: { startsWith: "reactivation-2026-09-19-6a8bed4d" } },
    include: { lead: true, phoneNumber: true }
  });
  
  // Q1 correlation ID was reactivation-2026-09-19-6a8bed4d-350798-q1
  const q2CorrelationId = "reactivation-2026-09-19-6a8bed4d-350798-q2";
  
  const q1Logs = logs.filter(l => l.correlationId.endsWith("-q1"));
  const q2Logs = logs.filter(l => l.correlationId.endsWith("-q2"));
  
  // Leads that failed in Q1
  const q1Failed = q1Logs.filter(l => l.status !== "COMPLETED" || !l.durationSeconds);
  
  console.log(`Q1 had ${q1Failed.length} failed leads.`);
  
  // Leads already attempted in Q2
  const q2AttemptedPhones = new Set(q2Logs.map(l => l.lead.phone));
  
  // Remaining for Q2
  const remainingLeads = q1Failed.filter(l => !q2AttemptedPhones.has(l.lead.phone)).map(l => ({
    id: l.leadId,
    name: (l.lead.firstName || l.lead.lastName) ? `${l.lead.firstName || ""} ${l.lead.lastName || ""}`.trim() : (l.lead.customFields && typeof l.lead.customFields === 'string' ? (JSON.parse(l.lead.customFields).Name || "Unknown") : "Unknown"),
    phone: l.lead.phone,
    called: false,
    isFailed: false
  }));
  
  console.log(`Remaining for Q2: ${remainingLeads.length}`);
  
  if (remainingLeads.length > 0) {
    const companyId = q1Logs[0].companyId;
    const uniqueJobId = `campaign-${companyId}-${Date.now()}`;
    const didNumber = q1Logs[0].historicalDidString || "07946350798";
    const channels = q1Logs[0].historicalChannels || 2;
    
    // We must perfectly construct the state object as expected by the UI and Worker
    const state = {
      campaignId: q2CorrelationId,
      status: "running",
      activeJobId: uniqueJobId,
      totalContacts: q1Failed.length,
      completedCalls: 0, // worker will update this
      successfulCalls: 0,
      failedCalls: q2AttemptedPhones.size, // 20 failed so far
      leads: remainingLeads,
      isReactivation: true,
      qStage: "Q2",
      allOriginalLeads: q1Failed.map(l => ({ phone: l.lead.phone }))
    };
    
    await redis.set(`campaign-state:${companyId}`, JSON.stringify(state));
    
    await queue.add(uniqueJobId, {
      companyId: companyId,
      campaignId: q2CorrelationId,
      didNumber: didNumber,
      channels: channels,
      leads: remainingLeads,
      isReactivation: true,
      qStage: "Q2",
      allOriginalLeads: q1Failed.map(l => ({ phone: l.lead.phone }))
    }, {
      jobId: uniqueJobId,
      removeOnComplete: true,
      removeOnFail: true,
    });
    
    console.log("Successfully enqueued Q2!");
  } else {
    console.log("No remaining leads for Q2.");
  }

  await prisma.$disconnect();
  await redis.quit();
  await queue.close();
}
main().catch(console.error);
