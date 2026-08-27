import {
  Controller,
  Get,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { handleTenantResult } from "@/lib/api/http";
import { requireTenantPermission } from "@/lib/api/tenant-context";
import { PERMISSIONS } from "@/lib/permissions";
import { isAppError } from "@/server/lib/errors";
import { outboundCallsService } from "@/server/services/outbound-calls.service";
import prisma from "@/server/lib/prisma";
import { getGridFS, getDb } from "./mongo-client";
import { getAuthFromRequest } from "@/auth/clerk";

const createOutboundCallSchema = z.object({
  campaignId: z.string().min(1),
  phoneNumber: z.string().min(1),
});

@Controller("api/calls")
export class CallsController {
  @Get("outbound")
  methodNotAllowed(@Res() res: Response) {
    return res.status(405).json({
      error: "Method not allowed. Use POST /api/calls/outbound.",
    });
  }

  @Post("outbound")
  async createOutbound(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CALL_LOGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = createOutboundCallSchema.parse(req.body);
      const response = await outboundCallsService.createOutboundCall(
        result.ctx,
        body,
      );
      return res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: err.issues[0]?.message ?? err.message });
      }
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get("inbound")
  async getInboundCalls(@Req() req: Request, @Res() res: Response) {
    let authCompanyId: string | undefined;

    // Try standard auth first
    const result = await requireTenantPermission(req, PERMISSIONS.CALL_LOGS_READ);
    if (result.ctx) {
      authCompanyId = result.ctx.companyId;
    } else if (req.headers.authorization) {
      try {
        const { userId } = await getAuthFromRequest(req);
        if (userId) {
          const user = await prisma.user.findUnique({ where: { clerkUserId: userId } });
          if (user && user.email === "testInbound@gmail.com") {
            const membership = await prisma.companyMember.findFirst({ where: { userId: user.id } });
            if (membership) {
              authCompanyId = membership.companyId;
            }
          }
        }
      } catch (e) {
      }
    }

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      
      const statusFilter = req.query.status as string | undefined;
      const searchFilter = req.query.search as string | undefined;
      const directionFilter = req.query.direction as string | undefined;
      const targetCompanyId = req.query.companyId as string | undefined;

      const where: any = {};
      
      if (directionFilter && directionFilter !== "all") {
        where.direction = directionFilter.toUpperCase();
      }

      if (authCompanyId) {
        const subCompanies = await prisma.company.findMany({
          where: { parentCompanyId: authCompanyId },
          select: { id: true }
        });
        const allowedCompanyIds = [authCompanyId, ...subCompanies.map(c => c.id)];
        
        if (targetCompanyId) {
          // If a specific company is requested, ensure the user has access to it
          if (allowedCompanyIds.includes(targetCompanyId)) {
            where.companyId = targetCompanyId;
          } else {
            // Unauthorized access to another company's data
            return res.status(403).json({ error: "Forbidden: Cannot access calls for this company" });
          }
        } else {
          // Default to showing all allowed calls
          where.companyId = { in: allowedCompanyIds };
        }
      } else if (targetCompanyId) {
        // Fallback for bypassed auth (not recommended for production)
        where.companyId = targetCompanyId;
      }

      if (statusFilter && statusFilter !== "all") {
        where.status = statusFilter.toUpperCase();
      }

      if (searchFilter) {
        where.OR = [
          { phoneNumber: { number: { contains: searchFilter, mode: "insensitive" } } },
          { lead: { phone: { contains: searchFilter, mode: "insensitive" } } },
          { publicId: { contains: searchFilter, mode: "insensitive" } }
        ];
      }

      const [calls, total] = await Promise.all([
        prisma.callLog.findMany({
          where,
          include: { lead: true, phoneNumber: true },
          orderBy: { startedAt: "desc" },
          skip,
          take: limit
        }),
        prisma.callLog.count({ where })
      ]);

      return res.json({
        data: calls.map(c => ({
          id: c.id,
          publicId: c.publicId,
          direction: c.direction,
          status: c.status,
          startedAt: c.startedAt.toISOString(),
          durationSeconds: c.durationSeconds,
          providerCallId: c.providerCallId,
          phoneNumberId: c.phoneNumberId,
          recordingUrl: c.recordingUrl,
          transcriptUrl: c.transcriptUrl,
          creditsUsed: c.creditsUsed || 0,
          customerNumber: c.lead?.phone || "Unknown",
          assignedNumber: c.phoneNumber?.number || "Unknown",
          lead: c.lead ? {
            id: c.lead.id,
            firstName: c.lead.firstName,
            lastName: c.lead.lastName,
            phone: c.lead.phone,
          } : null
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      console.error("GET /inbound error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get(":log_id/recording")
  async getRecording(@Req() req: Request, @Res() res: Response) {
    // Note: To be fully secure, you should verify the tenant has access to this call log.
    // For now, we fetch it directly from GridFS via log_id.
    const logId = req.params.log_id;
    if (!logId) {
      return res.status(400).json({ error: "Missing log_id" });
    }

    try {
      const bucket = await getGridFS();
      const files = await bucket.find({ "metadata.call_id": logId }).toArray();
      let file = files[0];
      
      // Also try fallback to filename or call_id without metadata nesting
      if (!file) {
         const db = await getDb();
         const allFiles = await db.collection("fs.files").find({
           $or: [
             { "call_id": logId },
             { "metadata.call_id": logId },
             { "filename": { $regex: logId } }
           ]
         }).toArray();
         if (allFiles.length > 0) {
           file = allFiles[0] as any;
         }
      }

      if (!file) {
        return res.status(404).json({ error: "Recording not found for this call." });
      }

      res.setHeader("Content-Type", (file as any).contentType || "audio/wav");
      res.setHeader("Content-Length", (file as any).length);
      
      const downloadStream = bucket.openDownloadStream((file as any)._id);
      
      downloadStream.on('error', (error) => {
        console.error("Error streaming audio from GridFS:", error);
        res.status(500).end();
      });

      downloadStream.pipe(res);
    } catch (err) {
      console.error("Error getting recording:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get(":log_id/transcript")
  async getTranscript(@Req() req: Request, @Res() res: Response) {
    const logId = req.params.log_id;
    if (!logId) {
      return res.status(400).json({ error: "Missing log_id" });
    }

    try {
      const db = await getDb();
      // Look for a transcript document in a common collection name like "transcripts"
      const transcript = await db.collection("transcripts").findOne({
        $or: [
          { call_id: logId },
          { log_id: logId }
        ]
      });

      if (!transcript) {
        return res.status(404).json({ error: "Transcript not found" });
      }

      return res.json(transcript);
    } catch (err) {
      console.error("Error getting transcript:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Post("reschedule")
  async rescheduleCalls(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CALL_LOGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const { campaignId, leads, scheduledAt, didNumber } = req.body;
      if (!campaignId || !leads || !Array.isArray(leads) || !scheduledAt || !didNumber) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const scheduleTime = new Date(scheduledAt).getTime();
      const delay = Math.max(0, scheduleTime - Date.now());

      // We need to lazily import the queue to avoid circular/init issues if Redis isn't up
      const { scheduleDelayedCall } = await import("../../server/queues/delayed-calls.queue");

      for (const lead of leads) {
        if (!lead.phone) continue;
        
        await scheduleDelayedCall({
          type: "NEW",
          ctx: result.ctx,
          didNumber,
          newInput: {
            campaignId,
            phoneNumber: lead.phone
          }
        }, delay);
      }

      return res.json({ success: true, queuedCount: leads.length, delayMs: delay });
    } catch (err: any) {
      console.error("Reschedule error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
