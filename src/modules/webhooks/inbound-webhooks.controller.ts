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
        console.warn(`[Inbound Webhook] Unauthorized request. Provided Key: ${apiKey}`);
        return res.status(401).json({ error: "Invalid OBD webhook API key" });
      }
      
      console.log(`[Inbound Webhook] Received payload:`, JSON.stringify(body));
      console.log(`[Inbound Webhook] Key fields - agentNumber(callid/calledno): ${body.callid || body.calledno}, callerNo(phone): ${body.phone || body.callingNo}, status: ${body.status}`);
      
      // Parse payload based on common VoiceNSMS/OBD field names or VoiceLink's nested 'call' object
      const callObj = body.call || {};
      
      const callingNo = body.phone || body["Calling No"] || body.callingNo || body.calling_no || body.caller_id || callObj.from || "Unknown";
      const callDurationRaw = body.duration ?? body["Call Duration"] ?? body.callDuration ?? body.call_duration ?? callObj.durationSec;
      const statusRaw = body.status ?? body["Status"] ?? callObj.status;
      const logId = body.log_id || body.logId || body["Log ID"] || body.callid || body.calledno || callObj.id || `webhook-${Date.now()}`;
      const recordingUrl = body.recording_url || body.recordingUrl || body.recording || callObj.recordingUrl || null;
      const transcriptUrl = body.transcript_url || body.transcriptUrl || body.transcript || null;
      const agentNumber = body.callid || body.calledno || callObj.to || "Unknown";

      // Generate all possible number variants for robust DB lookup
      const getNumberVariants = (num: string): string[] => {
        if (!num || num === "Unknown") return [num];
        const digits = num.replace(/\D/g, "");
        const variants = new Set<string>([num, digits]);
        
        // Handle double zero country code format: 0091XXXXXXXXXX
        if (digits.startsWith("00")) {
          const stripped = digits.substring(2);
          variants.add(stripped);
          variants.add("+" + stripped);
          if (stripped.startsWith("91")) {
            const national = stripped.substring(2);
            variants.add(national);
            variants.add("0" + national);
          }
        } else if (digits.startsWith("0")) {
          // e.g. 07969007102 -> 7969007102
          const stripped = digits.substring(1);
          variants.add(stripped);
          variants.add("+" + stripped);
        }

        // Handle Indian local format: 0XXXXXXXXXX (10 digits with leading 0)
        if (digits.startsWith("0") && digits.length === 11) {
          // e.g. 07969007102 -> 7969007102 -> 917969007102 -> +917969007102
          const without0 = digits.substring(1); // 7969007102
          variants.add(without0);
          variants.add("91" + without0);         // 917969007102
          variants.add("+91" + without0);        // +917969007102
          variants.add("9191" + without0);       // rare double-prefix
        }

        // Handle 10-digit Indian mobile: 9XXXXXXXXX
        if (!digits.startsWith("91") && digits.length === 10) {
          variants.add("91" + digits);
          variants.add("+91" + digits);
          variants.add("0" + digits);
        }

        // Strip leading 91 (India country code) variants
        if (digits.startsWith("9191") && digits.length >= 14) {
          // e.g. 91919429390110 -> 919429390110 -> +919429390110
          const stripped = digits.substring(2);
          variants.add(stripped);
          variants.add("+" + stripped);
        }
        if (digits.startsWith("91") && digits.length >= 12) {
          // e.g. 91917969126581 -> +91917969126581, or 917969126581 -> +917969126581
          variants.add("+" + digits);
          // Also try stripping one 91 prefix
          const stripped = digits.substring(2);
          if (stripped.length >= 10) {
            variants.add(stripped);
            variants.add("0" + stripped); // Add the 0 prefix variant for Indian numbers
            variants.add("+" + stripped);
            variants.add("91" + stripped);
            variants.add("+91" + stripped);
          }
        }
        // Also add without + prefix version
        variants.forEach(v => { if (v.startsWith("+")) variants.add(v.substring(1)); });
        
        return Array.from(variants);
      };

      const agentVariants = getNumberVariants(agentNumber);
      const callingVariants = getNumberVariants(callingNo);
      // Use the most normalized form as canonical
      const normalizedCallingNo = callingVariants.find(v => v.startsWith("+")) || callingVariants[0];
      const normalizedAgentNumber = agentVariants.find(v => v.startsWith("+")) || agentVariants[0];

      // Map agent number to companies
      let companies: any[] = [];
      let resolvedPhoneNumber: any = null;
      
      // Look up by custom_parameters first (if provided by outbound add_lead)
      const customParamsStr = body.custom_parameters || callObj.customParameters || callObj.custom_parameters;
      let customParams: any = {};
      try {
        if (typeof customParamsStr === 'string') customParams = JSON.parse(customParamsStr);
        else if (typeof customParamsStr === 'object') customParams = customParamsStr;
      } catch(e) {}
      
      let direction = "INBOUND";
      const payloadCompanyId = customParams?.companyId || customParams?.company_id;
      if (payloadCompanyId) {
        const exactCompany = await prisma.company.findUnique({ where: { id: payloadCompanyId } });
        if (exactCompany) {
          companies = [exactCompany];
          direction = customParams.callType === "outbound" || callObj.direction === "outbound" ? "OUTBOUND" : "INBOUND";
        }
      }

      // If we didn't explicitly detect outbound from the payload flags, check if there's a PENDING outbound call
      if (direction === "INBOUND") {
        const allVariants = [...agentVariants, ...callingVariants];
        const pendingOutbound = await prisma.callLog.findFirst({
          where: {
            direction: "OUTBOUND",
            status: "PENDING",
            lead: { phone: { in: allVariants } },
            ...(companies.length > 0 ? { companyId: { in: companies.map(c => c.id) } } : {})
          },
          orderBy: { startedAt: 'desc' },
          include: { company: true }
        });
        
        if (pendingOutbound && pendingOutbound.company) {
          direction = "OUTBOUND";
          if (companies.length === 0) {
            companies = [pendingOutbound.company];
          }
        }
      }

      // If STILL no company found (not an outbound pending call), look up by agent number (INBOUND) and calling number (OUTBOUND) in PhoneNumber table
      let phoneNumbers: any[] = [];
      if (companies.length === 0) {
        phoneNumbers = await prisma.phoneNumber.findMany({
          where: { 
            OR: agentVariants.map(v => ({ number: { contains: v } })),
            status: "ACTIVE",
            direction: { not: "OUTBOUND" }
          }
        });
        
        // If agentNumber didn't match a DID, try callingNo (Outbound calls have DID in the from/callingNo field)
        if (phoneNumbers.length === 0) {
          phoneNumbers = await prisma.phoneNumber.findMany({
            where: { 
              OR: callingVariants.map(v => ({ number: { contains: v } })),
              status: "ACTIVE"
            }
          });
          if (phoneNumbers.length > 0) {
            direction = "OUTBOUND";
          }
        }
        
        if (phoneNumbers.length > 0) {
          resolvedPhoneNumber = phoneNumbers[0];
          const companyIds = Array.from(new Set(phoneNumbers.map((p: any) => p.companyId).filter(Boolean)));
          if (companyIds.length > 0) {
            companies = await prisma.company.findMany({ where: { id: { in: companyIds as string[] } } });
          }
        }
      }

      if (companies.length === 0) {
        console.warn(`Webhook rejected: No matching company found for inbound call to ${agentNumber} from ${callingNo}`);
        return res.status(404).json({ error: "No company found for this number" });
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


      // Map status from VoiceLink/provider to our DB enum
      let status = "COMPLETED";
      if (statusRaw !== undefined) {
        const normalizedStatus = statusRaw.toString().toUpperCase();
        if (normalizedStatus.includes("RING") || normalizedStatus.includes("INITIAT") || normalizedStatus.includes("QUEUE") || normalizedStatus.includes("DISPATCH")) {
          status = "RINGING";
        } else if (normalizedStatus.includes("ANSWER") || normalizedStatus.includes("CONNECT") || normalizedStatus.includes("ACTIVE") || normalizedStatus.includes("IN_PROGRESS")) {
          status = "ANSWERED";
        } else if (normalizedStatus.includes("FAIL") || normalizedStatus.includes("ERROR") || normalizedStatus.includes("REJECT") || normalizedStatus.includes("CANCEL")) {
          status = "FAILED";
        } else if (normalizedStatus.includes("BUSY") || normalizedStatus.includes("NO ANSWER") || normalizedStatus.includes("NO_ANSWER") || normalizedStatus.includes("MISSED") || normalizedStatus.includes("VOICEMAIL")) {
          status = "MISSED";
        }
        // else keep COMPLETED for COMPLETED/ENDED/HANGUP
      }

      const isCallLive = status === "RINGING" || status === "ANSWERED";

      // If a call is finished but has 0 duration, it should be marked as FAILED or MISSED
      if (!isCallLive && durationSeconds === 0) {
        status = "FAILED";
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

        const customerNumber = direction === "OUTBOUND" ? normalizedAgentNumber : normalizedCallingNo;

        // Find or create lead
        let lead = await prisma.lead.findFirst({
          where: { companyId: company.id, phone: customerNumber }
        });
        if (!lead) {
          lead = await prisma.lead.create({
            data: {
              companyId: company.id,
              phone: customerNumber,
              firstName: direction === "OUTBOUND" ? "Outbound" : "Incoming",
              lastName: direction === "OUTBOUND" ? "Contact" : "Caller",
              stageId: stage.id
            }
          });
        }

        let existingCall = await prisma.callLog.findFirst({
          where: {
            companyId: company.id,
            OR: [
              { callLogId: logId },
              { providerCallId: logId }
            ]
          }
        });
        
        let callLogIdToUse = logId;
        if (existingCall) {
          callLogIdToUse = existingCall.callLogId;
        } else if (direction === "OUTBOUND") {
          // Strategy 1: Direct match via pendingCallId embedded in customParameters (fastest & race-condition-free)
          // NOTE: Do NOT filter by status=PENDING here — VoiceLink sometimes delivers call.completed BEFORE
          // call.ringing (out of order), meaning the record may already be FAILED by the time ringing arrives.
          const pendingCallIdFromParams = customParams?.pendingCallId;
          if (pendingCallIdFromParams) {
            const byId = await prisma.callLog.findFirst({
              where: {
                companyId: company.id,
                callLogId: pendingCallIdFromParams,
                direction: "OUTBOUND"
                // No status filter — allow matching even if already FAILED (out-of-order webhooks)
              }
            });
            if (byId) {
              existingCall = byId;
              callLogIdToUse = byId.callLogId;
            }
          }
          
          // Strategy 2: Fallback to phone variant matching (also without status filter for same reason)
          if (!existingCall) {
            const allVariants = [...agentVariants, ...callingVariants];
            const pendingCall = await prisma.callLog.findFirst({
              where: {
                companyId: company.id,
                lead: { phone: { in: allVariants } },
                direction: "OUTBOUND",
                status: { in: ["PENDING", "RINGING", "ANSWERED"] }
              },
              orderBy: { startedAt: 'desc' }
            });
            
            if (pendingCall) {
              existingCall = pendingCall;
              callLogIdToUse = pendingCall.callLogId;
            }
          }
        }

        
        const alreadyCharged = existingCall?.creditsUsed ? existingCall.creditsUsed > 0 : false;
        
        let localCreditsToDeduct = creditsToDeduct;
        // Never charge for live calls, and don't double-charge completed calls
        if (alreadyCharged || isCallLive) {
          localCreditsToDeduct = 0;
        }

        const updateData: any = {};
        if (statusRaw !== undefined) updateData.status = status;
        
        if (existingCall && existingCall.status === "PENDING" && isCallLive) {
          updateData.startedAt = new Date();
        }
        // Only update duration/recording on non-live events so we don't overwrite with 0
        if (!isCallLive) {
          if (callDurationRaw !== undefined) updateData.durationSeconds = durationSeconds;
          updateData.recordingUrl = finalRecordingUrl;
          updateData.transcriptUrl = finalTranscriptUrl;
        }
        // Only set creditsUsed if we are deducting now, or keep the existing one
        if (!alreadyCharged && !isCallLive) {
          updateData.creditsUsed = localCreditsToDeduct;
        }
        if (resolvedPhoneNumber?.id) {
          updateData.phoneNumberId = resolvedPhoneNumber.id;
        }
        // Always keep a record of the latest webhook payload
        updateData.providerWebhook = body;
        
        // Link the provider's call ID if we adopted a pending call
        if (logId) {
          updateData.providerCallId = logId;
        }

        const callLog = await prisma.callLog.upsert({
          where: {
            companyId_callLogId: {
              companyId: company.id,
              callLogId: callLogIdToUse
            }
          },
          update: updateData,
          create: {
            companyId: company.id,
            callLogId: logId, // If creating new, use Voicelink's ID
            publicId: publicId,
            direction: direction as any,
            status: status as any,
            startedAt: new Date(),
            durationSeconds: isCallLive ? 0 : durationSeconds,
            recordingUrl: isCallLive ? null : finalRecordingUrl,
            transcriptUrl: isCallLive ? null : finalTranscriptUrl,
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
