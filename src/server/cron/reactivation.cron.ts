import cron from "node-cron";
import prisma from "@/server/lib/prisma";
import { startCampaignJob } from "@/server/queues/campaign-execution.queue";
import { buildReactivationCorrelationId } from "@/server/queues/campaign-execution.queue";


// Run every night at 11:59 PM IST — schedules Wave 1 only.
// Wave 2 and Wave 3 are auto-chained in campaign-runner.service.ts after each wave completes.
cron.schedule(
  "59 23 * * *",
  async () => {
    console.log("[Reactivation Engine] Starting daily extraction of failed calls...");
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Stable date key for today's bucket (the day being reactivated)
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const failedCalls = await prisma.callLog.findMany({
        where: {
          direction: "OUTBOUND",
          startedAt: { gte: yesterday, lte: now },
          OR: [
            { status: { in: ["FAILED", "MISSED", "BUSY", "NO_ANSWER", "CANCELLED"] } },
            { durationSeconds: 0 },
          ],
          leadId: { not: null },
          companyId: { not: null },
          campaignId: null,
          correlationId: null,
        },
        include: { lead: true, phoneNumber: true },
      });

      console.log(`[Reactivation Engine] Found ${failedCalls.length} failed calls today.`);

      // Group by companyId + didNumber
      const buckets: Record<string, { companyId: string; didNumber: string; leads: any[] }> = {};

      for (const call of failedCalls) {
        if (!call.lead) continue;
        const key = `${call.companyId}-${call.phoneNumber?.number || "default"}`;
        if (!buckets[key]) {
          buckets[key] = {
            companyId: call.companyId!,
            didNumber: call.phoneNumber?.number || "",
            leads: [],
          };
        }
        if (!buckets[key].leads.find((l) => l.id === call.leadId)) {
          buckets[key].leads.push({ ...call.lead, id: call.leadId, phone: call.lead.phone });
        }
      }

      // Calculate delays from 11:59 PM IST
      const q1Delay = 10 * 60 * 60 * 1000 + 1 * 60 * 1000; // 10 AM
      const q2Delay = 15 * 60 * 60 * 1000 + 1 * 60 * 1000; // 3 PM
      const q3Delay = 20 * 60 * 60 * 1000 + 1 * 60 * 1000; // 8 PM

      for (const key of Object.keys(buckets)) {
        const bucket = buckets[key];
        if (bucket.leads.length === 0) continue;

        if (!bucket.didNumber) {
          const fallbackDid = await prisma.phoneNumber.findFirst({
            where: { companyId: bucket.companyId, outboundAgentId: { not: null } },
          });
          if (fallbackDid) bucket.didNumber = fallbackDid.number;
          else continue;
        }

        const dateLabel = now.toLocaleDateString("en-US", {
          timeZone: "Asia/Kolkata",
          month: "short",
          day: "numeric",
        });
        const uploadedFileName = `${dateLabel} Failed Leads`;
        
        const stages = [
          { stage: "q1", label: "Q1", delay: q1Delay },
          { stage: "q2", label: "Q2", delay: q2Delay },
          { stage: "q3", label: "Q3", delay: q3Delay },
        ] as const;

        for (const { stage, label, delay } of stages) {
          const correlationId = buildReactivationCorrelationId(dateStr, bucket.companyId, bucket.didNumber, stage as any);

          console.log(
            `[Reactivation Engine] Scheduling ${label} — Company: ${bucket.companyId}, DID: ${bucket.didNumber}, ` +
            `Base Leads: ${bucket.leads.length}, correlationId: ${correlationId}`
          );

          await startCampaignJob(
            {
              companyId: bucket.companyId,
              campaignId: correlationId,
              didNumber: bucket.didNumber,
              leads: bucket.leads, // Q2 and Q3 will dynamically filter these at execution time
              channels: 1,
              isReactivation: true,
              qStage: label as "Q1" | "Q2" | "Q3",
              uploadedFileName,
              scheduledAt: new Date(now.getTime() + delay).toISOString(),
              reactivationDateKey: dateStr,
              allOriginalLeads: bucket.leads,
            },
            delay
          );
        }
      }
    } catch (err) {
      console.error("[Reactivation Engine] Daily Extraction Error:", err);
    }
  },
  { timezone: "Asia/Kolkata" }
);

