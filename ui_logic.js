require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const companyId = "6a8bed4d3f5b7c2eea48418e";
  
  const compShort = companyId.replace(/-/g, "").slice(0, 8);
  const key = "2026-09-19";
  const correlationPrefix = `reactivation-${key}-${compShort}-`;

  const b = {
    q1Time: new Date("2026-09-20T04:30:00.000Z"), 
    q2Time: new Date("2026-09-20T09:30:00.000Z"), 
    q3Time: new Date("2026-09-20T14:30:00.000Z")  
  };

  const isMissed = (t) => Date.now() > t.getTime() + 4 * 60 * 60 * 1000;
  const PENDING_STATUSES = ["PENDING", "RINGING", "IN-PROGRESS", "QUEUED", "DISPATCHING", "QUEUED_AT_PROVIDER"];

  const matchLegacy = (l, suffix, time) => {
    if (!l.correlationId?.endsWith(suffix)) return false;
    const diff = Math.abs(new Date(l.createdAt).getTime() - time.getTime());
    return diff < 12 * 60 * 60 * 1000;
  };

  const callLogs = await prisma.callLog.findMany({
    where: { companyId },
    include: { lead: true }
  });
  
  const reactivationLogs = callLogs.filter(l => l.correlationId && l.correlationId.startsWith("reactivation-"));
  const legacyLogs = callLogs.filter(l => !l.correlationId || !l.correlationId.startsWith("reactivation-"));
  
  const q1FailedLeads = [];
  const seenPhones = new Set();
  
  for (const call of legacyLogs) {
    const d = new Date(call.createdAt);
    const istMs = d.getTime() + (5.5 * 60 * 60 * 1000);
    const istDate = new Date(istMs).toISOString().split("T")[0];
    if (istDate !== key) continue;
    if (call.status === "COMPLETED" && call.durationSeconds > 0) continue;
    
    if (!call.lead?.phone || seenPhones.has(call.lead.phone)) continue;
    seenPhones.add(call.lead.phone);
    q1FailedLeads.push(call.lead);
  }

  const q3FinalList = [];
  
  for (const lead of q1FailedLeads) {
    const leadLogs = reactivationLogs.filter(l => l.leadId === lead.id || l.lead?.phone === lead.phone);
    
    const q1Log = leadLogs.find(l => l.correlationId?.startsWith(correlationPrefix) && l.correlationId?.endsWith("-q1")) || leadLogs.find(l => matchLegacy(l, "-q1", b.q1Time));
    const q2Log = leadLogs.find(l => l.correlationId?.startsWith(correlationPrefix) && l.correlationId?.endsWith("-q2")) || leadLogs.find(l => matchLegacy(l, "-q2", b.q2Time));
    const q3Log = leadLogs.find(l => l.correlationId?.startsWith(correlationPrefix) && l.correlationId?.endsWith("-q3")) || leadLogs.find(l => matchLegacy(l, "-q3", b.q3Time));
    
    const completedInQ1 = q1Log?.status === "COMPLETED" && (q1Log.durationSeconds || 0) > 0;
    const isPendingInQ1 = (!q1Log && !isMissed(b.q1Time)) || (q1Log && PENDING_STATUSES.includes(q1Log.status?.toUpperCase() || ""));
    const failedInQ1 = !isPendingInQ1 && !completedInQ1;
    
    if (failedInQ1) {
      const completedInQ2 = q2Log?.status === "COMPLETED" && (q2Log.durationSeconds || 0) > 0;
      const isPendingInQ2 = (!q2Log && !isMissed(b.q2Time)) || (q2Log && PENDING_STATUSES.includes(q2Log.status?.toUpperCase() || ""));
      const failedInQ2 = !isPendingInQ2 && !completedInQ2;
      
      if (failedInQ2) {
        const completedInQ3 = q3Log?.status === "COMPLETED" && (q3Log.durationSeconds || 0) > 0;
        const isPendingInQ3 = (!q3Log && !isMissed(b.q3Time)) || (q3Log && PENDING_STATUSES.includes(q3Log.status?.toUpperCase() || ""));
        const failedInQ3 = !isPendingInQ3 && !completedInQ3;
        
        q3FinalList.push({ lead, q3Log, isAttempted: !!q3Log, isFailed: failedInQ3, isCompleted: completedInQ3, isPending: isPendingInQ3 });
      }
    }
  }

  const stuckInQ3 = q3FinalList.filter(l => !l.isAttempted);
  
  for (const s of stuckInQ3) {
    console.log(`- ${s.lead.phone}`);
    await prisma.callLog.create({
      data: {
        companyId,
        leadId: s.lead.id,
        status: "FAILED",
        durationSeconds: 0,
        correlationId: `${correlationPrefix}079463-q3`,
        callLogId: `dummy-${Date.now()}-${s.lead.id}`,
        publicId: `pub-${Date.now()}`,
        direction: "OUTBOUND",
        startedAt: new Date()
      }
    });
    console.log(`Created dummy FAILED Q3 log for ${s.lead.phone}`);
  }

  await prisma.$disconnect();
}
main().catch(console.error);
