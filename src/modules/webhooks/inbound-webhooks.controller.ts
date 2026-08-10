import { Controller, Post, Req, Res, Query } from "@nestjs/common";
import type { Request, Response } from "express";
import prisma from "@/server/lib/prisma";
import { generatePublicId } from "@/server/lib/public-id";

@Controller("api/webhooks/inbound")
export class InboundWebhooksController {
  @Post()
  async handleInboundWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const apiKey = req.headers["x-obd-api-key"] || req.headers["x-api-key"];
      const expectedKey = process.env.INBOUND_WEBHOOK_SECRET || process.env.OBD_WEBHOOK_SECRET;
      
      if (!expectedKey || apiKey !== expectedKey) {
        return res.status(401).json({ error: "Invalid OBD webhook API key" });
      }

      const body = req.body || {};
      
      // Parse payload based on common VoiceNSMS/OBD field names or the provided screenshot headers
      const callingNo = body.phone || body["Calling No"] || body.callingNo || body.calling_no || body.caller_id || "Unknown";
      const callDurationRaw = body.duration || body["Call Duration"] || body.callDuration || body.call_duration || 0;
      const statusRaw = body.status || body["Status"] || "COMPLETED";
      const logId = body.log_id || body.logId || body["Log ID"] || body.callid || body.calledno || `webhook-${Date.now()}`;
      const recordingUrl = body.recording_url || body.recordingUrl || body.recording || null;
      const transcriptUrl = body.transcript_url || body.transcriptUrl || body.transcript || null;

      const company = await prisma.company.findFirst();
      if (!company) {
        return res.status(404).json({ error: "No company found" });
      }

      let durationSeconds = 0;
      if (typeof callDurationRaw === "number") {
        durationSeconds = callDurationRaw;
      } else if (typeof callDurationRaw === "string") {
        durationSeconds = parseInt(callDurationRaw, 10);
        if (isNaN(durationSeconds)) durationSeconds = 0;
      }

      // Map status
      const normalizedStatus = statusRaw.toString().toUpperCase();
      let status = "COMPLETED";
      if (normalizedStatus.includes("FAIL") || normalizedStatus.includes("ERROR") || normalizedStatus.includes("REJECT")) {
        status = "FAILED";
      } else if (normalizedStatus.includes("BUSY") || normalizedStatus.includes("NO ANSWER") || normalizedStatus.includes("NO_ANSWER") || normalizedStatus.includes("MISSED")) {
        status = "MISSED";
      }

      const publicId = `INB-${logId.toString().substring(0, 10)}`;

      // Find or create stage
      let stage = await prisma.leadPipelineStage.findFirst({
        where: { companyId: company.id, slug: "new" }
      });
      if (!stage) {
        stage = await prisma.leadPipelineStage.create({
          data: { companyId: company.id, name: "New", slug: "new", order: 1 }
        });
      }

      // Find or create lead
      let lead = await prisma.lead.findFirst({
        where: { companyId: company.id, phone: callingNo }
      });
      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            companyId: company.id,
            phone: callingNo,
            firstName: "Incoming",
            lastName: "Caller",
            stageId: stage.id
          }
        });
      }

      const callLog = await prisma.callLog.upsert({
        where: {
          companyId_callLogId: {
            companyId: company.id,
            callLogId: logId
          }
        },
        update: {
          status: status as any,
          durationSeconds,
          recordingUrl: recordingUrl,
          transcriptUrl: transcriptUrl,
          providerWebhook: body
        },
        create: {
          companyId: company.id,
          callLogId: logId,
          publicId: publicId,
          direction: "INBOUND",
          status: status as any,
          startedAt: new Date(),
          durationSeconds,
          recordingUrl: recordingUrl,
          transcriptUrl: transcriptUrl,
          provider: "webhook",
          providerCallId: logId,
          providerWebhook: body,
          leadId: lead.id
        }
      });

      return res.status(200).json({ success: true, callLogId: callLog.id });
    } catch (error) {
      console.error("Inbound webhook error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
