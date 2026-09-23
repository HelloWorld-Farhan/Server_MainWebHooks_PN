require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const companyId = "6a8bed4d3f5b7c2eea48418e"; 
  const key = "2026-09-19";
  
  const callLogs = await prisma.callLog.findMany({
    where: { companyId, status: { not: "COMPLETED" } },
    include: { lead: true }
  });
  
  const reactivationLogs = await prisma.callLog.findMany({
    where: { companyId, correlationId: { startsWith: "reactivation-" } },
    include: { lead: true }
  });

  const q1FailedLeads = [];
  const seenPhones = new Set();
  
  for (const call of callLogs) {
    if (call.correlationId && call.correlationId.startsWith("reactivation-")) continue;
    const d = new Date(call.createdAt);
    const istMs = d.getTime() + (5.5 * 60 * 60 * 1000);
    const istDate = new Date(istMs).toISOString().split("T")[0];
    if (istDate !== key) continue;
    
    const leadPhone = call.lead?.phone;
    if (!leadPhone || seenPhones.has(leadPhone)) continue;
    seenPhones.add(leadPhone);
    
    q1FailedLeads.push(call.lead);
  }
  
  console.log(`Initial Q1 failed leads: ${q1FailedLeads.length}`);
  
  const q2FinalList = [];
  const q3FinalList = [];
  
  for (const lead of q1FailedLeads) {
    const leadLogs = reactivationLogs.filter(l => l.leadId === lead.id || l.lead?.phone === lead.phone);
    const q1Log = leadLogs.find(l => l.correlationId?.endsWith("-q1"));
    const q2Log = leadLogs.find(l => l.correlationId?.endsWith("-q2"));
    const q3Log = leadLogs.find(l => l.correlationId?.endsWith("-q3"));
    
    const completedInQ1 = q1Log?.status === "COMPLETED" && q1Log.durationSeconds > 0;
    const isPendingInQ1 = q1Log && ["PENDING", "RINGING"].includes(q1Log.status);
    const failedInQ1 = !isPendingInQ1 && !completedInQ1;
    
    if (failedInQ1) {
      q2FinalList.push(lead);
      const completedInQ2 = q2Log?.status === "COMPLETED" && q2Log.durationSeconds > 0;
      const isPendingInQ2 = q2Log && ["PENDING", "RINGING"].includes(q2Log.status);
      const failedInQ2 = !isPendingInQ2 && !completedInQ2;
      
      if (failedInQ2) {
        q3FinalList.push({ lead, q3Log });
      }
    }
  }
  
  console.log(`Leads that failed Q2 (so they belong in Q3): ${q3FinalList.length}`);
  
  const stuckInQ3 = q3FinalList.filter(l => !l.q3Log);
  console.log(`Leads stuck in Q3 (no q3Log): ${stuckInQ3.length}`);
  
  for (const s of stuckInQ3) {
    console.log(`Stuck: ${s.lead.phone}`);
    
    // Create a fake FAILED log for them in Q3 so they complete
    const compShort = companyId.replace(/-/g, "").slice(0, 8);
    const correlationPrefix = `reactivation-${key}-${compShort}-`;
    
    await prisma.callLog.create({
      data: {
        companyId,
        leadId: s.lead.id,
        status: "FAILED",
        durationSeconds: 0,
        correlationId: `${correlationPrefix}079463-q3`
      }
    });
    console.log(`Created dummy FAILED Q3 log for ${s.lead.phone}`);
  }
  
  await prisma.$disconnect();
}
main().catch(console.error);
