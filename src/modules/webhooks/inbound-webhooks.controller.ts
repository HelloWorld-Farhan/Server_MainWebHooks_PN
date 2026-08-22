import { Controller, Post, Req, Res, Query } from "@nestjs/common";
import type { Request, Response } from "express";
import prisma from "@/server/lib/prisma";
import { cacheService } from "@/server/cache/cache.service";


@Controller("api/webhooks/inbound")
export class InboundWebhooksController {
  @Post()
  async handleInboundWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const body = req.body || {};
      const query = req.query || {};
      
      const apiKey = 
        req.headers["x-obd-api-key"] || 
        req.headers["x-api-key"] || 
        body["x-obd-api-key"] || 
        body["x-api-key"] ||
        query["x-obd-api-key"] ||
        query["x-api-key"];
        
      const expectedKey = process.env.INBOUND_WEBHOOK_SECRET || process.env.OBD_WEBHOOK_SECRET;
      
      if (!expectedKey || apiKey !== expectedKey) {
        return res.status(401).json({ error: "Invalid OBD webhook API key" });
      }
      
      // Parse payload based on common VoiceNSMS/OBD field names or the provided screenshot headers
      const callingNo = body.phone || body["Calling No"] || body.callingNo || body.calling_no || body.caller_id || "Unknown";
      const callDurationRaw = body.duration ?? body["Call Duration"] ?? body.callDuration ?? body.call_duration;
      const statusRaw = body.status ?? body["Status"];
      const logId = body.log_id || body.logId || body["Log ID"] || body.callid || body.calledno || `webhook-${Date.now()}`;
      const recordingUrl = body.recording_url || body.recordingUrl || body.recording || null;
      const transcriptUrl = body.transcript_url || body.transcriptUrl || body.transcript || null;
      const agentNumber = body.callid || body.calledno || "Unknown";

      let normalizedAgentNumber = agentNumber.replace(/\D/g, "");
      if (normalizedAgentNumber.startsWith("9191") && normalizedAgentNumber.length > 12) {
        normalizedAgentNumber = normalizedAgentNumber.substring(2);
      }

      // Map agent number to company
      let company: any = null;
      
      // Look up by agent number in PhoneNumber table
      const phoneNumber = await prisma.phoneNumber.findFirst({
        where: { 
          OR: [
            { number: { contains: agentNumber } },
            { number: { contains: normalizedAgentNumber } }
          ]
        },
        orderBy: { createdAt: 'desc' }
      });
      
      if (phoneNumber && phoneNumber.companyId) {
        company = await prisma.company.findUnique({ where: { id: phoneNumber.companyId } });
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
      
      let creditsToDeduct = 0;
      if (status === "COMPLETED" && durationSeconds > 0) {
        const minutes = Math.floor(durationSeconds / 60);
        const remainder = durationSeconds % 60;
        
        creditsToDeduct = minutes * 3.5;
        if (remainder > 0 && remainder <= 30) {
          creditsToDeduct += 1.75;
        } else if (remainder > 30) {
          creditsToDeduct += 3.5;
        }
      }

      const existingCall = await prisma.callLog.findUnique({
        where: {
          companyId_callLogId: { companyId: company.id, callLogId: logId }
        }
      });
      
      const alreadyCharged = existingCall?.creditsUsed ? existingCall.creditsUsed > 0 : false;
      
      // If already charged, do not deduct again
      if (alreadyCharged) {
        creditsToDeduct = 0;
      }

      const updateData: any = {};
      if (statusRaw !== undefined) updateData.status = status;
      if (callDurationRaw !== undefined) updateData.durationSeconds = durationSeconds;
      updateData.recordingUrl = finalRecordingUrl;
      updateData.transcriptUrl = finalTranscriptUrl;
      // Only set creditsUsed if we are deducting now, or keep the existing one
      if (!alreadyCharged) {
        updateData.creditsUsed = creditsToDeduct;
      }
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
          creditsUsed: creditsToDeduct,
          provider: "webhook",
          providerCallId: logId,
          providerWebhook: body,
          leadId: lead.id
        }
      });

      // Deduct credits for COMPLETED calls
      if (creditsToDeduct > 0) {
        
        let balance = await prisma.creditBalance.findFirst({
          where: { companyId: company.id }
        });

        if (!balance) {
          balance = await prisma.creditBalance.create({
            data: {
              companyId: company.id,
              creditsRemaining: 0,
              creditsUsed: 0
            }
          });
        }
        
        const txOps = [
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
        ];

        // We DO NOT deduct from the parent company's creditsRemaining because the credits 
        // were already deducted from the parent when they were allocated to the sub-company.
        // Double-deducting here causes incorrect balances.

        await prisma.$transaction(txOps);
        
        try {
          await cacheService.invalidateCompanyCredits(company.id);
          await cacheService.invalidateBillingPages(company.id);
        } catch (cacheErr) {
          console.error("Cache invalidation error:", cacheErr);
        }
      }

      return res.status(200).json({ success: true, callLogId: callLog.id });
    } catch (error) {
      console.error("Inbound webhook error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
