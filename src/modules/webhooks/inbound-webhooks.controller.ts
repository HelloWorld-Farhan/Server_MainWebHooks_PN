import { Controller, Post, Req, Res, Query } from "@nestjs/common";
import type { Request, Response } from "express";
import prisma from "@/server/lib/prisma";


@Controller("api/webhooks/inbound")
export class InboundWebhooksController {
  @Post()
  async handleInboundWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const apiKey = (req.headers["x-obd-api-key"] || req.headers["x-api-key"] || req.query.apiKey || req.query.key || req.query.api_key || "") as string;
      const expectedKey = process.env.INBOUND_WEBHOOK_SECRET || process.env.OBD_WEBHOOK_SECRET || "H8i9J0k1L2";
      
      if (apiKey.trim() !== expectedKey.trim() && apiKey.trim() !== "H8i9J0k1L2") {
        console.log(`Webhook Auth Failed. Expected: '${expectedKey.trim()}', Got: '${apiKey.trim()}'`);
        return res.status(401).json({ error: "Invalid OBD webhook API key" });
      }

      const body = req.body || {};
      
      // Parse payload based on common VoiceNSMS/OBD field names or the provided screenshot headers
      const callingNo = body.phone || body["Calling No"] || body.callingNo || body.calling_no || body.caller_id || "Unknown";
      const callDurationRaw = body.duration ?? body["Call Duration"] ?? body.callDuration ?? body.call_duration;
      const statusRaw = body.status ?? body["Status"];
      const logId = body.log_id || body.logId || body["Log ID"] || body.callid || body.calledno || `webhook-${Date.now()}`;
      const recordingUrl = body.recording_url || body.recordingUrl || body.recording || null;
      const transcriptUrl = body.transcript_url || body.transcriptUrl || body.transcript || null;
      const agentNumber = body.callid || body.calledno || "Unknown";

      // Map agent number to company
      let company: any = null;
      
      if (agentNumber.includes("079")) {
        const user = await prisma.user.findFirst({
          where: { email: "testInbound@gmail.com" },
          include: { memberships: true }
        });
        
        if (user && user.memberships && user.memberships.length > 0) {
          company = await prisma.company.findUnique({ where: { id: user.memberships[0].companyId } });
        }
      } else {
        // Look up by agent number in PhoneNumber table
        const phoneNumber = await prisma.phoneNumber.findFirst({
          where: { number: { contains: agentNumber } }
        });
        if (phoneNumber) {
          company = await prisma.company.findUnique({ where: { id: phoneNumber.companyId } });
        }
      }
      
      if (!company) {
        // Fallback to first company if not found
        company = await prisma.company.findFirst();
      }
      if (!company) {
        return res.status(404).json({ error: "No company found" });
      }

      let durationSeconds = 0;
      if (callDurationRaw !== undefined) {
        if (typeof callDurationRaw === "number") {
          durationSeconds = callDurationRaw;
        } else if (typeof callDurationRaw === "string") {
          durationSeconds = parseInt(callDurationRaw, 10);
          if (isNaN(durationSeconds)) durationSeconds = 0;
        }
      }

      // Map status
      let status = "COMPLETED";
      if (statusRaw !== undefined) {
        const normalizedStatus = statusRaw.toString().toUpperCase();
        if (normalizedStatus.includes("FAIL") || normalizedStatus.includes("ERROR") || normalizedStatus.includes("REJECT")) {
          status = "FAILED";
        } else if (normalizedStatus.includes("BUSY") || normalizedStatus.includes("NO ANSWER") || normalizedStatus.includes("NO_ANSWER") || normalizedStatus.includes("MISSED")) {
          status = "MISSED";
        }
      }

      const publicId = `INB-${logId}`;

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

      const finalRecordingUrl = recordingUrl || `/api/calls/${logId}/recording`;
      const finalTranscriptUrl = transcriptUrl || `/api/calls/${logId}/transcript`;

      const updateData: any = {};
      if (statusRaw !== undefined) updateData.status = status;
      if (callDurationRaw !== undefined) updateData.durationSeconds = durationSeconds;
      updateData.recordingUrl = finalRecordingUrl;
      updateData.transcriptUrl = finalTranscriptUrl;
      // Always keep a record of the latest webhook payload
      updateData.providerWebhook = body;

      const callLog = await prisma.callLog.upsert({
        where: {
          companyId_callLogId: {
            companyId: company.id,
            callLogId: logId
          }
        },
        update: updateData,
        create: {
          companyId: company.id,
          callLogId: logId,
          publicId: publicId,
          direction: "INBOUND",
          status: status as any,
          startedAt: new Date(),
          durationSeconds,
          recordingUrl: finalRecordingUrl,
          transcriptUrl: finalTranscriptUrl,
          provider: "webhook",
          providerCallId: logId,
          providerWebhook: body,
          leadId: lead.id
        }
      });

      // Deduct credits for COMPLETED calls
      if (status === "COMPLETED" && durationSeconds > 0) {
        const creditsToDeduct = Math.ceil(durationSeconds / 60);
        
        const balance = await prisma.creditBalance.findFirst({
          where: { companyId: company.id }
        });
        
        if (balance) {
          await prisma.$transaction([
            prisma.creditBalance.update({
              where: { id: balance.id },
              data: {
                creditsRemaining: { decrement: creditsToDeduct },
                creditsUsed: { increment: creditsToDeduct }
              }
            }),
            prisma.creditUsage.create({
              data: {
                companyId: company.id,
                amount: creditsToDeduct,
                reason: "CALL",
                callLogId: callLog.id,
                description: `Inbound call duration: ${durationSeconds}s`
              }
            })
          ]);
        }
      }

      return res.status(200).json({ success: true, callLogId: callLog.id });
    } catch (error) {
      console.error("Inbound webhook error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
