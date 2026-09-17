import cron from "node-cron";
import prisma from "@/server/lib/prisma";
import { startCampaignJob } from "@/server/queues/campaign-execution.queue";

/**
 * Build a stable, date-based correlationId so the dashboard can always
 * reconstruct it from the bucket's date key.
 *
 *  Format: reactivation-{YYYY-MM-DD}-{companyId[0..7]}-{didLast6}-q1|q2|q3
 *
 * This must be used EVERYWHERE (cron + dashboard query) so they always agree.
 */
export function buildReactivationCorrelationId(
  dateStr: string,   // "2026-09-17"
  companyId: string,
  didNumber: string,
  stage: "q1" | "q2" | "q3"
): string {
  const compShort = companyId.replace(/-/g, "").slice(0, 8);
  const didDigits = didNumber.replace(/\D/g, "").slice(-6);
  return `reactivation-${dateStr}-${compShort}-${didDigits}-${stage}`;
}

/**
 * Called by the queue worker after Wave 1 completes.
 * Fetches ONLY leads that failed in Wave 1 and schedules Wave 2.
 */
export async function scheduleReactivationWave2(
  companyId: string,
  didNumber: string,
  dateStr: string,
  uploadedFileName: string,
  allLeads: any[]
): Promise<void> {
  try {
    const q1CorrelationId = buildReactivationCorrelationId(dateStr, companyId, didNumber, "q1");

    const q1Logs = await prisma.callLog.findMany({
      where: { companyId, correlationId: q1CorrelationId },
      select: { leadId: true, status: true, durationSeconds: true },
    });

    const succeededLeadIds = new Set(
      q1Logs
        .filter(l => l.status === "COMPLETED" && (l.durationSeconds || 0) > 0)
        .map(l => l.leadId)
        .filter(Boolean)
    );

    const failedLeads = allLeads.filter(lead => {
      const id = lead.id || lead.leadId;
      return !succeededLeadIds.has(id);
    });

    if (failedLeads.length === 0) {
      console.log(`[Reactivation] Wave 2 for ${companyId}: all leads succeeded in Wave 1 — skipping.`);
      return;
    }

    const q2CorrelationId = buildReactivationCorrelationId(dateStr, companyId, didNumber, "q2");
    console.log(`[Reactivation] Scheduling Wave 2 for ${companyId} with ${failedLeads.length} failed leads`);

    await startCampaignJob(
      {
        companyId,
        campaignId: q2CorrelationId,
        didNumber,
        leads: failedLeads,
        channels: 1,
        isReactivation: true,
        qStage: "Q2",
        uploadedFileName,
        scheduledAt: new Date().toISOString(),
        reactivationDateKey: dateStr,
        allOriginalLeads: allLeads,
      },
      0 // Fire immediately after Wave 1 finishes
    );
  } catch (err) {
    console.error("[Reactivation] Error scheduling Wave 2:", err);
  }
}

/**
 * Called by the queue worker after Wave 2 completes.
 * Fetches ONLY leads that failed in Wave 2 and schedules Wave 3.
 */
export async function scheduleReactivationWave3(
  companyId: string,
  didNumber: string,
  dateStr: string,
  uploadedFileName: string,
  allLeads: any[]
): Promise<void> {
  try {
    const q2CorrelationId = buildReactivationCorrelationId(dateStr, companyId, didNumber, "q2");

    const q2Logs = await prisma.callLog.findMany({
      where: { companyId, correlationId: q2CorrelationId },
      select: { leadId: true, status: true, durationSeconds: true },
    });

    const succeededLeadIds = new Set(
      q2Logs
        .filter(l => l.status === "COMPLETED" && (l.durationSeconds || 0) > 0)
        .map(l => l.leadId)
        .filter(Boolean)
    );

    const failedLeads = allLeads.filter(lead => {
      const id = lead.id || lead.leadId;
      return !succeededLeadIds.has(id);
    });

    if (failedLeads.length === 0) {
      console.log(`[Reactivation] Wave 3 for ${companyId}: all leads succeeded in Wave 2 — skipping.`);
      return;
    }

    const q3CorrelationId = buildReactivationCorrelationId(dateStr, companyId, didNumber, "q3");
    console.log(`[Reactivation] Scheduling Wave 3 for ${companyId} with ${failedLeads.length} failed leads`);

    await startCampaignJob(
      {
        companyId,
        campaignId: q3CorrelationId,
        didNumber,
        leads: failedLeads,
        channels: 1,
        isReactivation: true,
        qStage: "Q3",
        uploadedFileName,
        scheduledAt: new Date().toISOString(),
        reactivationDateKey: dateStr,
        allOriginalLeads: allLeads,
      },
      0
    );
  } catch (err) {
    console.error("[Reactivation] Error scheduling Wave 3:", err);
  }
}

// Run every night at 11:59 PM IST — schedules Wave 1 only.
// Wave 2 and Wave 3 chain automatically from the queue worker on completion.
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

