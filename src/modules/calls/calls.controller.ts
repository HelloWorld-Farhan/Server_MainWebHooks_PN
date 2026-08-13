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
    let companyId: string | null = null;
    let userEmail = "";

    // Primary auth: full tenant permission check
    const result = await requireTenantPermission(req, PERMISSIONS.CALL_LOGS_READ);
    if (result.ctx) {
      companyId = result.ctx.companyId;
      if (result.ctx.userId) {
        const user = await prisma.user.findFirst({ where: { clerkUserId: result.ctx.userId } });
        if (user) userEmail = user.email;
      }
    } else {
      // Fallback: verify JWT directly and use X-Company-Id header
      // This supports propnex-server users who sign in via the legacy auth system
      try {
        const jwt = await import("jsonwebtoken");
        const authHeader = req.headers.authorization || "";
        const companyHeader = (req.headers["x-company-id"] as string) || (req.query.companyId as string) || "";
        const emailHeader = (req.headers["x-user-email"] as string) || "";

        if (authHeader.startsWith("Bearer ") && companyHeader) {
          const token = authHeader.split(" ")[1];
          const payload = jwt.verify(token, process.env.JWT_SECRET || "default-secret-key") as any;
          if (payload && (payload.sub || payload.email)) {
            companyId = companyHeader;
            userEmail = emailHeader || payload.email || "";
            console.log(`[CallsController] Fallback auth successful for email=${userEmail} companyId=${companyId}`);
          }
        }
      } catch (e) {
        console.log("[CallsController] Fallback auth failed:", e);
      }
    }

    if (!companyId) {
      console.log("[CallsController] requireTenantPermission failed:", JSON.stringify(result.error));
      if (result.error) {
        return res.status(result.error.status).json(result.error.body);
      }
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      
      const statusFilter = req.query.status as string | undefined;
      const searchFilter = req.query.search as string | undefined;

      const where: any = {
        companyId: companyId,
        direction: "INBOUND",
        AND: []
      };

      if (statusFilter && statusFilter !== "all") {
        where.status = statusFilter.toUpperCase();
      }

      if (searchFilter) {
        where.AND.push({
          OR: [
            { phoneNumber: { number: { contains: searchFilter, mode: "insensitive" } } },
            { lead: { phone: { contains: searchFilter, mode: "insensitive" } } },
            { publicId: { contains: searchFilter, mode: "insensitive" } }
          ]
        });
      }

      // Restrict 079 calls to testInbound@gmail.com
      if (userEmail !== "testInbound@gmail.com") {
        where.AND.push({
          OR: [
            { phoneNumberId: null },
            { phoneNumber: { number: { not: { startsWith: "079" } } } }
          ]
        });
      }

      if (where.AND.length === 0) {
        delete where.AND;
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
          creditsUsed: Math.ceil((c.durationSeconds || 0) / 60),
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
}
