import cron from "node-cron";
import prisma from "@/server/lib/prisma";
import { startCampaignJob, buildReactivationCorrelationId } from "@/server/queues/campaign-execution.queue";
import { redisConnection } from "@/server/queues/redis.client";

// ─────────────────────────────────────────────────────────────────────────────
// Shared extraction function — called both by the nightly cron AND by the
// startup recovery guard so the server never misses a nightly run.
// ─────────────────────────────────────────────────────────────────────────────
export async function runReactivationExtraction(now: Date): Promise<void> {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Stable date key for today's bucket (the day being reactivated)
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  console.log(`[Reactivation Engine] Running extraction for dateKey=${dateStr}`);

  const failedCalls = await prisma.callLog.findMany({
    where: {
      direction: "OUTBOUND",
      startedAt: { gte: yesterday, lte: now },
      OR: [
        { status: { in: ["FAILED", "MISSED", "BUSY", "NO_ANSWER", "CANCELLED"] } },
        { durationSeconds: 0 },
      ],
      leadId:    { not: null },
      companyId: { not: null },
      NOT: {
        correlationId: { startsWith: "reactivation-" }
      }
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
      const originalCallType =
        call.campaignId || (call.correlationId && call.correlationId.startsWith("camp-"))
          ? "Campaign"
          : call.leadId && !call.campaignId && !call.correlationId
          ? "Lead"
          : "Internal";
      buckets[key].leads.push({
        ...call.lead,
        id: call.leadId,
        phone: call.lead.phone,
        originalCallType,
      });
    }
  }

  // Calculate delays from NOW → target wave times (IST).
  // If we're running at startup recovery (e.g. 00:30), the delays will be:
  //   Q1 at 10 AM → ~9.5h
  //   Q2 at 3 PM  → ~14.5h
  //   Q3 at 8 PM  → ~19.5h
  // This is correct regardless of when extraction runs.
  function msUntilISTHour(targetHour: number): number {
    const target = new Date(now);
    // Convert now to IST offset (UTC+5:30) to find the correct calendar day
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffsetMs);
    const istToday = new Date(Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      targetHour - 5,   // subtract IST offset hours
      30 * (targetHour >= 5 ? -1 : 1), // subtract 30 min (IST = UTC+5:30)
      0,
      0
    ));
    // Simpler and reliable: just hard-code UTC equivalents
    // 10 AM IST = 04:30 UTC, 3 PM IST = 09:30 UTC, 8 PM IST = 14:30 UTC
    const utcHours: Record<number, [number, number]> = {
      10: [4, 30],
      15: [9, 30],
      20: [14, 30],
    };
    const [h, m] = utcHours[targetHour] ?? [targetHour - 5, 30];
    const fireDate = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      h, m, 0, 0
    ));
    // If already past this time today, push to tomorrow
    if (fireDate.getTime() <= now.getTime()) {
      fireDate.setUTCDate(fireDate.getUTCDate() + 1);
    }
    return fireDate.getTime() - now.getTime();
  }

  const q1Delay = msUntilISTHour(10); // 10:00 AM IST
  const q2Delay = msUntilISTHour(15); // 3:00 PM IST
  const q3Delay = msUntilISTHour(20); // 8:00 PM IST

  const dateLabel = now.toLocaleDateString("en-US", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
  });

  for (const key of Object.keys(buckets)) {
    const bucket = buckets[key];
    if (bucket.leads.length === 0) continue;

    if (!bucket.didNumber) {
      const fallbackDid = await prisma.phoneNumber.findFirst({
        where: {
          companyId: bucket.companyId,
          direction: { in: ["OUTBOUND", "BOTH"] },
          status: "ACTIVE",
        },
      });
      if (fallbackDid) bucket.didNumber = fallbackDid.number;
      else {
        console.warn(`[Reactivation Engine] No active outbound DID for company ${bucket.companyId} — skipping.`);
        continue;
      }
    }

    const uploadedFileName = `${dateLabel} Failed Leads`;

    const stages = [
      { stage: "q1", label: "Q1", delay: q1Delay },
      { stage: "q2", label: "Q2", delay: q2Delay },
      { stage: "q3", label: "Q3", delay: q3Delay },
    ] as const;

    for (const { stage, label, delay } of stages) {
      const correlationId = buildReactivationCorrelationId(
        dateStr,
        bucket.companyId,
        bucket.didNumber,
        stage as any
      );

      console.log(
        `[Reactivation Engine] Scheduling ${label} — Company: ${bucket.companyId}, DID: ${bucket.didNumber}, ` +
        `Leads: ${bucket.leads.length}, delay: ${Math.round(delay / 60000)}min, correlationId: ${correlationId}`
      );

      await startCampaignJob(
        {
          companyId:          bucket.companyId,
          campaignId:         correlationId,
          didNumber:          bucket.didNumber,
          leads:              bucket.leads,
          channels:           1,
          isReactivation:     true,
          qStage:             label as "Q1" | "Q2" | "Q3",
          uploadedFileName,
          scheduledAt:        new Date(now.getTime() + delay).toISOString(),
          reactivationDateKey: dateStr,
          allOriginalLeads:   bucket.leads,
        },
        delay
      );
    }
  }

  // Mark this date as extracted in Redis so recovery doesn't double-run
  if (redisConnection) {
    await redisConnection.set(
      `reactivation-extracted:${dateStr}`,
      "1",
      "EX",
      48 * 60 * 60 // expire after 48h
    );
  }

  console.log(`[Reactivation Engine] Extraction complete for ${dateStr}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nightly cron — runs at 11:50 PM IST every day
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule(
  "50 23 * * *",
  async () => {
    console.log("[Reactivation Engine] Nightly cron triggered.");
    try {
      await runReactivationExtraction(new Date());
    } catch (err) {
      console.error("[Reactivation Engine] Daily Extraction Error:", err);
    }
  },
  { timezone: "Asia/Kolkata" }
);
