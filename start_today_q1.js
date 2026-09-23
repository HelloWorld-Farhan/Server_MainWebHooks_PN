require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

async function main() {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  
  const companyId = "6a8bed4d3f5b7c2eea48418e";
  const compShort = companyId.replace(/-/g, "").slice(0, 8);
  const dateKey = "2026-09-20";
  const didNumber = "07946350798";
  const didDigits = didNumber.replace(/\D/g, "").slice(-6);

  const correlationId = `reactivation-${dateKey}-${compShort}-${didDigits}-q1`;

  // find the 1 failed lead
  const failedCalls = await prisma.callLog.findMany({
    where: { 
      companyId,
      startedAt: { 
        gte: new Date("2026-09-19T18:20:00Z"), 
        lte: new Date("2026-09-20T18:20:00Z") 
      },
      OR: [ { correlationId: { isSet: false } }, { correlationId: null }, { correlationId: { not: { startsWith: 'reactivation-' } } } ],
      status: "FAILED"
    },
    include: { lead: true }
  });

  const uniqueLeads = Array.from(new Map(failedCalls.map(c => [c.leadId, c.lead])).values());
  
  if (uniqueLeads.length === 0) {
    console.log("No leads found!");
    process.exit(1);
  }

  console.log(`Found ${uniqueLeads.length} leads. Initiating Q1 immediately.`);

  const uniqueJobId = `campaign-${companyId}-${Date.now()}`;
  
  const initialState = {
    campaignId: correlationId,
    status: "running",
    activeJobId: uniqueJobId,
    totalContacts: uniqueLeads.length,
    completedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    leads: uniqueLeads.map(l => ({ ...l, phone: l.phone, originalCallType: "Lead" })),
    isReactivation: true,
    qStage: "Q1",
    uploadedFileName: "20 Sept Failed Leads",
    reactivationDateKey: dateKey,
    allOriginalLeads: uniqueLeads.map(l => ({ ...l, phone: l.phone, originalCallType: "Lead" }))
  };
  await redis.set(`campaign-state:${companyId}`, JSON.stringify(initialState));

  await queue.add(uniqueJobId, {
    companyId,
    campaignId: correlationId,
    didNumber,
    leads: uniqueLeads.map(l => ({ ...l, phone: l.phone, originalCallType: "Lead" })),
    channels: 2,
    isReactivation: true,
    qStage: "Q1",
    uploadedFileName: "20 Sept Failed Leads",
    scheduledAt: new Date().toISOString(),
    reactivationDateKey: dateKey,
    allOriginalLeads: uniqueLeads.map(l => ({ ...l, phone: l.phone, originalCallType: "Lead" }))
  }, {
    jobId: uniqueJobId,
    removeOnComplete: true,
    removeOnFail: true,
  });

  console.log("Q1 Job successfully added to queue! It should start making calls immediately.");

  await prisma.$disconnect();
  await redis.quit();
}

main().catch(console.error);
