import cron from "node-cron";
import prisma from "@/server/lib/prisma";
import { startCampaignJob } from "@/server/queues/campaign-execution.queue";
import { buildReactivationCorrelationId } from "@/server/cron/reactivation-wave-chainer";


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

      // Wave 1 fires at 10 AM IST next morning
      // 11:59 PM → 10:00 AM = 10h 1m = 36,060,000 ms
      const q1Delay = 10 * 60 * 60 * 1000 + 1 * 60 * 1000;

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
        const q1CorrelationId = buildReactivationCorrelationId(dateStr, bucket.companyId, bucket.didNumber, "q1");

        console.log(
          `[Reactivation Engine] Scheduling Wave 1 — Company: ${bucket.companyId}, DID: ${bucket.didNumber}, ` +
          `Leads: ${bucket.leads.length}, correlationId: ${q1CorrelationId}`
        );

        // Only schedule Wave 1. Wave 2 & 3 are auto-chained after completion.
        await startCampaignJob(
          {
            companyId: bucket.companyId,
            campaignId: q1CorrelationId,
            didNumber: bucket.didNumber,
            leads: bucket.leads,
            channels: 1,
            isReactivation: true,
            qStage: "Q1",
            uploadedFileName,
            scheduledAt: new Date(now.getTime() + q1Delay).toISOString(),
            reactivationDateKey: dateStr,
            allOriginalLeads: bucket.leads,
          },
          q1Delay
        );
      }
    } catch (err) {
      console.error("[Reactivation Engine] Daily Extraction Error:", err);
    }
  },
  { timezone: "Asia/Kolkata" }
);

