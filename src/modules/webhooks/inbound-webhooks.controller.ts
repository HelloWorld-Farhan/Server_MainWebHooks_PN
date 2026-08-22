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

      const normalizeNumber = (num: string) => {
        if (!num || num === "Unknown") return num;
        let cleaned = num.replace(/\D/g, "");
        if (cleaned.startsWith("9191") && cleaned.length >= 12) {
          cleaned = cleaned.substring(2);
        }
        if (cleaned.startsWith("91") && cleaned.length >= 12) {
          return "+" + cleaned;
        }
        return num;
      };

      const normalizedAgentNumber = normalizeNumber(agentNumber);
      const normalizedCallingNo = normalizeNumber(callingNo);

      // Map agent number to companies
      let companies: any[] = [];
      let resolvedPhoneNumber: any = null;
      
      // Look up by agent number in PhoneNumber table
      const phoneNumbers = await prisma.phoneNumber.findMany({
        where: { 
          OR: [
            { number: { contains: agentNumber } },
            { number: { contains: normalizedAgentNumber } }
          ],
          status: "ACTIVE"
        }
      });
      
      if (phoneNumbers.length > 0) {
        resolvedPhoneNumber = phoneNumbers[0];
        const companyIds = Array.from(new Set(phoneNumbers.map(p => p.companyId).filter(Boolean)));
        if (companyIds.length > 0) {
          companies = await prisma.company.findMany({ where: { id: { in: companyIds as string[] } } });
        }

        // If any found company is a sub-company (has parentCompanyId),
        // also include the parent company so both get an inbound call log.
        const parentIds = companies
          .filter((c: any) => c.parentCompanyId)
          .map((c: any) => c.parentCompanyId as string);

        if (parentIds.length > 0) {
          const parentCompanies = await prisma.company.findMany({
            where: { id: { in: parentIds } }
          });
          for (const parent of parentCompanies) {
            if (!companies.find((c: any) => c.id === parent.id)) {
              companies.push(parent);
            }
          }
        }
      }
      
      if (companies.length === 0) {
        // Fallback to first company if not found
        const firstCompany = await prisma.company.findFirst();
        if (firstCompany) companies = [firstCompany];
      }
      if (companies.length === 0) {
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

      let primaryCallLogId: string | undefined;

      // Process for ALL companies that have this number assigned
      for (const company of companies) {
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
          where: { companyId: company.id, phone: normalizedCallingNo }
        });
        if (!lead) {
          lead = await prisma.lead.create({
            data: {
              companyId: company.id,
              phone: normalizedCallingNo,
              firstName: "Incoming",
              lastName: "Caller",
              stageId: stage.id
            }
          });
        }

        const existingCall = await prisma.callLog.findUnique({
          where: {
            companyId_callLogId: { companyId: company.id, callLogId: logId }
          }
        });
        
        const alreadyCharged = existingCall?.creditsUsed ? existingCall.creditsUsed > 0 : false;
        
        let localCreditsToDeduct = creditsToDeduct;
        // If already charged, do not deduct again
        if (alreadyCharged) {
          localCreditsToDeduct = 0;
        }

        const updateData: any = {};
        if (statusRaw !== undefined) updateData.status = status;
        if (callDurationRaw !== undefined) updateData.durationSeconds = durationSeconds;
        updateData.recordingUrl = finalRecordingUrl;
        updateData.transcriptUrl = finalTranscriptUrl;
        // Only set creditsUsed if we are deducting now, or keep the existing one
        if (!alreadyCharged) {
          updateData.creditsUsed = localCreditsToDeduct;
        }
        if (resolvedPhoneNumber?.id) {
          updateData.phoneNumberId = resolvedPhoneNumber.id;
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
            creditsUsed: localCreditsToDeduct,
            provider: "webhook",
            providerCallId: logId,
            providerWebhook: body,
            leadId: lead.id,
            ...(resolvedPhoneNumber?.id ? { phoneNumberId: resolvedPhoneNumber.id } : {})
          }
        });

        if (!primaryCallLogId) {
          primaryCallLogId = callLog.id;
        }

        // Deduct credits for COMPLETED calls
        if (localCreditsToDeduct > 0) {
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
                creditsRemaining: { decrement: localCreditsToDeduct },
                creditsUsed: { increment: localCreditsToDeduct }
              }
            }),
            prisma.creditUsage.create({
              data: {
                companyId: company.id,
                amount: localCreditsToDeduct,
                reason: "CALL",
                callLogId: callLog.id,
                description: `Inbound call duration: ${durationSeconds}s`
              }
            })
          ];

          await prisma.$transaction(txOps);
          
          try {
            await cacheService.invalidateCompanyCredits(company.id);
            await cacheService.invalidateBillingPages(company.id);
          } catch (cacheErr) {
            console.error("Cache invalidation error:", cacheErr);
          }
        }
      }

      return res.status(200).json({ success: true, callLogId: primaryCallLogId });
    } catch (error) {
      console.error("Inbound webhook error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
