import prisma from "@/server/lib/prisma";
import { startCampaignJob } from "@/server/queues/campaign-execution.queue";

/**
 * Build a stable, date-based correlationId so the dashboard can always
 * reconstruct it from the bucket's date key.
 *
 *  Format: reactivation-{YYYY-MM-DD}-{companyId[0..7]}-{didLast6}-q1|q2|q3
 *
 * This must be used EVERYWHERE (cron + dashboard + runner) so they always agree.
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

// Parses the date, didLast6 and stage from a reactivation correlationId.
// Format: reactivation-{YYYY-MM-DD}-{compShort}-{didLast6}-{q1|q2|q3}
const REACTIVATION_RE =
  /^reactivation-(\d{4}-\d{2}-\d{2})-[a-f0-9]+-(\d{1,6})-(q[123])$/;

/**
 * Called by the campaign-runner after a reactivation wave completes.
 * Reads the current wave's call logs, filters to ONLY failed leads,
 * and schedules the next wave (Q1→Q2 or Q2→Q3).
 */
export async function chainNextReactivationWave(
  companyId: string,
  correlationId: string,
  allOriginalLeads: any[],
  uploadedFileName: string
): Promise<void> {
  const match = correlationId.match(REACTIVATION_RE);
  if (!match) return; // Not a reactivation campaign

  const [, dateStr, didLast6, stage] = match;
  if (stage === "q3") return; // No wave after Q3

  const nextStageLabel = stage === "q1" ? "Q2" : "Q3";
  const nextStage = nextStageLabel.toLowerCase() as "q2" | "q3";

  // Look up the full DID number for this company that ends with didLast6
  const phoneNumbers = await prisma.phoneNumber.findMany({
    where: { companyId },
    select: { number: true },
  });
  const didNumber =
    phoneNumbers.find((p) => p.number.replace(/\D/g, "").endsWith(didLast6))
      ?.number || didLast6;

  // Fetch this wave's call logs to find which leads succeeded
  const waveLogs = await prisma.callLog.findMany({
    where: { companyId, correlationId },
    select: { leadId: true, status: true, durationSeconds: true },
  });

  const succeededLeadIds = new Set(
    waveLogs
      .filter((l) => l.status === "COMPLETED" && (l.durationSeconds || 0) > 0)
      .map((l) => l.leadId)
      .filter(Boolean)
  );

  // Next wave only gets leads that did NOT succeed in this wave
  const failedLeads = allOriginalLeads.filter((lead) => {
    const id = lead.id || lead.leadId;
    return !succeededLeadIds.has(id);
  });

  if (failedLeads.length === 0) {
    console.log(
      `[Reactivation] ${nextStageLabel} for ${companyId}: all leads succeeded — skipping.`
    );
    return;
  }

  const nextCorrelationId = buildReactivationCorrelationId(
    dateStr,
    companyId,
    didNumber,
    nextStage
  );

  // Calculate correct delay for Q2 (3 PM) or Q3 (8 PM) IST
  // dateStr is the date the calls failed. Reactivation is the NEXT day.
  const [yyyy, mm, dd] = dateStr.split('-');
  const failureDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00+05:30`);
  const reactivationDate = new Date(failureDate.getTime() + 24 * 60 * 60 * 1000);
  const reactYear = reactivationDate.getFullYear();
  const reactMonth = String(reactivationDate.getMonth() + 1).padStart(2, "0");
  const reactDay = String(reactivationDate.getDate()).padStart(2, "0");
  
  const targetTimeStr = nextStageLabel === "Q2" ? "15:00:00" : "20:00:00";
  const targetDateStr = `${reactYear}-${reactMonth}-${reactDay}T${targetTimeStr}+05:30`;
  const targetDate = new Date(targetDateStr);
  
  const nowMs = Date.now();
  const delayMs = Math.max(0, targetDate.getTime() - nowMs);

  console.log(
    `[Reactivation] Auto-chaining ${nextStageLabel} for ${companyId} — ${failedLeads.length} failed leads -> correlationId: ${nextCorrelationId}`
  );
  console.log(`[Reactivation] Scheduling at ${targetDate.toISOString()} (Delay: ${Math.round(delayMs / 60000)} mins)`);

  await startCampaignJob(
    {
      companyId,
      campaignId: nextCorrelationId,
      didNumber,
      leads: failedLeads,
      channels: 1,
      isReactivation: true,
      qStage: nextStageLabel as "Q2" | "Q3",
      uploadedFileName,
      scheduledAt: targetDate.toISOString(),
      reactivationDateKey: dateStr,
      allOriginalLeads,
    },
    delayMs
  );
}
