import cron from "node-cron";
import prisma from "@/server/lib/prisma";
import { startCampaignJob } from "@/server/queues/campaign-execution.queue";

// Run every night at 11:59 PM IST
cron.schedule(
  "59 23 * * *",
  async () => {
    console.log("[Reactivation Engine] Starting daily extraction of failed calls...");
    try {
      // Fetch calls from the last 24 hours
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
        include: {
          lead: true,
          phoneNumber: true,
        },
      });

      console.log(`[Reactivation Engine] Found ${failedCalls.length} failed calls today.`);

      // Group by companyId and didNumber
      const buckets: Record<string, { companyId: string, didNumber: string, leads: any[] }> = {};

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
        
        // Prevent duplicate leads in the same bucket
        if (!buckets[key].leads.find(l => l.id === call.leadId)) {
           buckets[key].leads.push({
             ...call.lead,
             id: call.leadId,
             phone: call.lead.phone,
           });
        }
      }

      // 11:59 PM to 10:00 AM = 10 hours 1 minute = 36,060,000 ms
      // 11:59 PM to 2:00 PM = 14 hours 1 minute = 50,460,000 ms
      // 11:59 PM to 8:00 PM = 20 hours 1 minute = 72,060,000 ms
      const q1Delay = 10 * 60 * 60 * 1000 + 1 * 60 * 1000;
      const q2Delay = 14 * 60 * 60 * 1000 + 1 * 60 * 1000;
      const q3Delay = 20 * 60 * 60 * 1000 + 1 * 60 * 1000;

      for (const key of Object.keys(buckets)) {
        const bucket = buckets[key];
        if (bucket.leads.length === 0) continue;

        if (!bucket.didNumber) {
           // Find a fallback DID for this company
           const fallbackDid = await prisma.phoneNumber.findFirst({
             where: { companyId: bucket.companyId, outboundAgentId: { not: null } }
           });
           if (fallbackDid) bucket.didNumber = fallbackDid.number;
           else continue; // Cannot reactivate without a DID
        }

        const dateStr = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' });
        const uploadedFileName = `${dateStr} Failed Leads`;

        console.log(`[Reactivation Engine] Scheduling 3 Waves for Company ${bucket.companyId} DID ${bucket.didNumber} - ${bucket.leads.length} leads`);

        await startCampaignJob({
          companyId: bucket.companyId,
          campaignId: `reactivation-${Date.now()}-q1`,
          didNumber: bucket.didNumber,
          leads: bucket.leads,
          channels: 1, // Safe concurrency for background tasks
          isReactivation: true,
          qStage: "Q1",
          uploadedFileName,
          scheduledAt: new Date(now.getTime() + q1Delay).toISOString(),
        }, q1Delay);

        await startCampaignJob({
          companyId: bucket.companyId,
          campaignId: `reactivation-${Date.now()}-q2`,
          didNumber: bucket.didNumber,
          leads: bucket.leads,
          channels: 1,
          isReactivation: true,
          qStage: "Q2",
          uploadedFileName,
          scheduledAt: new Date(now.getTime() + q2Delay).toISOString(),
        }, q2Delay);

        await startCampaignJob({
          companyId: bucket.companyId,
          campaignId: `reactivation-${Date.now()}-q3`,
          didNumber: bucket.didNumber,
          leads: bucket.leads,
          channels: 1,
          isReactivation: true,
          qStage: "Q3",
          uploadedFileName,
          scheduledAt: new Date(now.getTime() + q3Delay).toISOString(),
        }, q3Delay);
      }

    } catch (err) {
      console.error("[Reactivation Engine] Daily Extraction Error:", err);
    }
  },
  {
    timezone: "Asia/Kolkata",
  }
);
