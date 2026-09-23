require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { Queue } = require("bullmq");
const Redis = require("ioredis");

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL);
const queue = new Queue("campaign-execution-queue", { connection: redis });

async function run() {
  const companyId = "6a8bed4d3f5b7c2eea48418e";
  const dateKey = "2026-09-20";
  const didNumber = "07946350798";
  
  const jobs = await queue.getDelayed();
  const q2Job = jobs.find(j => j.data.qStage === 'Q2' && j.data.companyId === companyId);
  if (!q2Job) throw new Error("Q2 job not found!");
  
  const leads = q2Job.data.allOriginalLeads || q2Job.data.leads;
  
  const correlationId = `reactivation-${dateKey}-6a8bed4d-350798-q3`;
  const uniqueJobId = `campaign-${companyId}-Q3-${Date.now()}`;
  
  const initialState = {
    campaignId: correlationId,
    status: "scheduled",
    activeJobId: uniqueJobId,
    totalContacts: leads.length,
    completedCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    leads: leads,
    isReactivation: true,
    qStage: "Q3",
    uploadedFileName: "20 Sep Failed Leads",
    reactivationDateKey: dateKey,
    allOriginalLeads: leads
  };
  
  await redis.set(`campaign-state:${companyId}`, JSON.stringify(initialState));

  const targetHour = 20; // 8 PM IST
  const now = new Date();
  const fireDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), targetHour - 5, 30, 0, 0));
  if (fireDate.getTime() <= now.getTime()) {
    fireDate.setUTCDate(fireDate.getUTCDate() + 1);
  }
  
  const delayMs = fireDate.getTime() - now.getTime();
  
  await queue.add(uniqueJobId, {
    companyId,
    campaignId: correlationId,
    didNumber,
    leads,
    channels: 2,
    isReactivation: true,
    qStage: "Q3",
    uploadedFileName: "20 Sep Failed Leads",
    scheduledAt: fireDate.toISOString(),
    reactivationDateKey: dateKey,
    allOriginalLeads: leads
  }, {
    jobId: uniqueJobId,
    delay: delayMs,
    removeOnComplete: true,
    removeOnFail: true,
  });

  console.log(`Q3 Job added with a delay of ${Math.round(delayMs / 1000 / 60)} minutes.`);
  process.exit(0);
}

run();
