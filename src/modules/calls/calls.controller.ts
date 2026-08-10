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
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CALL_LOGS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      
      const statusFilter = req.query.status as string | undefined;
      const searchFilter = req.query.search as string | undefined;

      const where: any = {
        companyId: result.ctx.companyId,
        direction: "INBOUND",
      };

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
}
