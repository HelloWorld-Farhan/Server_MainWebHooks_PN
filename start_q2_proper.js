require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const Redis = require("ioredis");
const { Queue } = require("bullmq");

async function main() {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("No REDIS_URL found");
  const redis = new Redis(redisUrl);
  const queue = new Queue("campaign-execution-queue", { connection: redis });
  
  const companyId = "6a8bed4d3f5b7c2eea48418e"; 
  const key = "2026-09-19";
  
  const callLogs = await prisma.callLog.findMany({
    where: {
      companyId,
      status: { not: "COMPLETED" },
    },
    include: { lead: true, phoneNumber: true }
  });
  
  const reactivationLogs = await prisma.callLog.findMany({
    where: { companyId, correlationId: { startsWith: "reactivation-" } },
    include: { lead: true, phoneNumber: true }
  });

  const q1FailedLeads = [];
  const seenPhones = new Set();
  
  for (const call of callLogs) {
    if (call.correlationId && call.correlationId.startsWith("reactivation-")) continue;
    
    const d = new Date(call.createdAt);
    // Convert to IST offset
    const istMs = d.getTime() + (5.5 * 60 * 60 * 1000);
    const istDate = new Date(istMs).toISOString().split("T")[0];
    
    if (istDate !== key) continue;
    
    const leadPhone = call.lead?.phone;
    if (!leadPhone) continue;
    
    if (seenPhones.has(leadPhone)) continue;
    seenPhones.add(leadPhone);
    
    const leadName = call.lead?.firstName ? `${call.lead.firstName} ${call.lead.lastName || ""}` : "Unknown";
    
    q1FailedLeads.push({
      id: call.leadId,
      name: leadName.trim(),
      phone: leadPhone,
    });
  }
  
  console.log(`Found ${q1FailedLeads.length} original failed leads for ${key}`);
  
  const compShort = companyId.replace(/-/g, "").slice(0, 8);
  const correlationPrefix = `reactivation-${key}-${compShort}-`;
  
  const q2FinalList = [];
  
  for (const lead of q1FailedLeads) {
    const leadLogs = reactivationLogs.filter(l => l.leadId === lead.id || l.lead?.phone === lead.phone);
    
    const q1Log = leadLogs.find(l => l.correlationId?.endsWith("-q1"));
    const q2Log = leadLogs.find(l => l.correlationId?.endsWith("-q2"));
    
    const completedInQ1 = q1Log?.status === "COMPLETED" && q1Log.durationSeconds > 0;
    const isPendingInQ1 = q1Log && ["PENDING", "RINGING"].includes(q1Log.status);
    const failedInQ1 = !isPendingInQ1 && !completedInQ1;
    
    if (failedInQ1) {
      const isAttempted = !!q2Log;
      if (!isAttempted) {
        q2FinalList.push({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          called: false,
          isFailed: false
        });
      }
    }
  }
  
  console.log(`Remaining leads to call in Q2: ${q2FinalList.length}`);
  
  if (q2FinalList.length > 0) {
    const q2CorrelationId = `${correlationPrefix}079463-q2`; 
    const uniqueJobId = `campaign-${companyId}-${Date.now()}`;
    
    const state = {
      campaignId: q2CorrelationId,
      status: "running",
      activeJobId: uniqueJobId,
      totalContacts: q1FailedLeads.length, 
      completedCalls: 0, 
      successfulCalls: 0,
      failedCalls: q1FailedLeads.length - q2FinalList.length,
      leads: q2FinalList,
      isReactivation: true,
      qStage: "Q2",
      allOriginalLeads: q1FailedLeads.map(l => ({ phone: l.phone }))
    };
    
    await redis.set(`campaign-state:${companyId}`, JSON.stringify(state));
    
    await queue.add(uniqueJobId, {
      companyId: companyId,
      campaignId: q2CorrelationId,
      didNumber: "07946350798",
      channels: 2,
      leads: q2FinalList,
      isReactivation: true,
      qStage: "Q2",
      allOriginalLeads: q1FailedLeads.map(l => ({ phone: l.phone }))
    }, {
      jobId: uniqueJobId,
      removeOnComplete: true,
      removeOnFail: true,
    });
    console.log("Q2 Successfully restarted!");
  }

  await prisma.$disconnect();
  await redis.quit();
  await queue.close();
}
main().catch(console.error);
