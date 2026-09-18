const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const companyId = '0b1b118b-6dd7-4e36-afcc-47e03408a2fc'; // Need to find a valid companyId, I can just query the first company

  const company = await prisma.company.findFirst();
  if (!company) return;

  const failedCalls = await prisma.callLog.findMany({
    where: {
      companyId: company.id,
      direction: "OUTBOUND",
      OR: [
        { status: { in: ["FAILED", "MISSED", "BUSY", "NO_ANSWER", "CANCELLED"] } },
        { durationSeconds: 0 },
      ]
    },
    include: { lead: true, phoneNumber: true },
    orderBy: { startedAt: "asc" }
  });

  const reactivationLogs = await prisma.callLog.findMany({
    where: {
      companyId: company.id,
      direction: "OUTBOUND",
      correlationId: { startsWith: "reactivation-" }
    },
    select: { leadId: true, status: true, correlationId: true, durationSeconds: true, startedAt: true }
  });

  const buckets = {};
  let currentKey = "";
  const seenPhones = new Set();

  for (const call of failedCalls) {
    const d = call.startedAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    
    if (key !== currentKey) {
      currentKey = key;
      seenPhones.clear();
    }

    let fallbackCustomerNumber = "";
    if (call.providerWebhook && typeof call.providerWebhook === 'object') {
       const wh = call.providerWebhook;
       fallbackCustomerNumber = wh.DestinationNumber || wh.to_number || "";
    }
    const leadPhone = call.lead?.phone || fallbackCustomerNumber;
    if (!leadPhone) continue;
    
    if (seenPhones.has(leadPhone)) continue;
    seenPhones.add(leadPhone);
    
    if (!buckets[key]) {
      const nextDay = new Date(d);
      nextDay.setDate(nextDay.getDate() + 1);
      const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(d);
      
      const yyyy = nextDay.getFullYear();
      const mm = String(nextDay.getMonth() + 1).padStart(2, "0");
      const dd = String(nextDay.getDate()).padStart(2, "0");
      const nextDayStr = `${yyyy}-${mm}-${dd}`;

      const q1Time = new Date(`${nextDayStr}T10:00:00+05:30`);
      const q2Time = new Date(`${nextDayStr}T15:00:00+05:30`);
      const q3Time = new Date(`${nextDayStr}T20:00:00+05:30`);

      buckets[key] = {
        id: key,
        q1Time, q2Time, q3Time,
        q1: { status: "Pending", failedLeads: [] },
        q2: { status: "Pending", failedLeads: [] },
        q3: { status: "Pending", failedLeads: [] },
      };
    }
    
    const leadId = call.leadId || `manual-${leadPhone}`;
    if (!buckets[key].q1.failedLeads.find((l) => l.phone === leadPhone)) {
      buckets[key].q1.failedLeads.push({ id: leadId, phone: leadPhone });
    }
  }

  const matchLegacy = (log, suffix, expectedTime) => {
    if (!log.correlationId?.endsWith(suffix)) return false;
    if (log.correlationId?.match(/reactivation-\d{4}-\d{2}-\d{2}-/)) return false;
    const logDate = new Date(log.startedAt).toISOString().split('T')[0];
    const expectedDate = expectedTime.toISOString().split('T')[0];
    return logDate === expectedDate;
  };

  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    const compShort = company.id.replace(/-/g, "").slice(0, 8);
    const didDigits = "123456"; // stub
    const q1CorrelationId = `reactivation-${key}-${compShort}-${didDigits}-q1`;

    const hasQ1Logs = reactivationLogs.some(l => 
      l.correlationId === q1CorrelationId || 
      (b.q1.failedLeads.some((fl) => fl.id === l.leadId) && matchLegacy(l, "-q1", b.q1Time))
    );

    b.q1.status = hasQ1Logs ? "Completed" : "Pending";
  }

  console.log(Object.keys(buckets).map(k => ({ date: k, q1Status: buckets[k].q1.status })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
