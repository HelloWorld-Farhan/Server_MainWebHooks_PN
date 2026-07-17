import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { handleTenantResult } from "@/lib/api/http";
import {
  requireTenantContext,
  requireTenantPermission,
} from "@/lib/api/tenant-context";
import { PERMISSIONS } from "@/lib/permissions";
import { isAppError } from "@/server/lib/errors";
import { billingService } from "@/server/services/billing.service";

const createQuoteSchema = z.object({
  channelQty: z.number().int().nonnegative(),
  virtualNumberQty: z.number().int().nonnegative(),
  expectedMonthlyCalls: z.number().int().nonnegative(),
});

@Controller("api/billing")
export class BillingController {
  @Get("rates")
  async getRates(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const rates = await billingService.getRates(result.ctx);
      return res.json({ rates });
    } catch (err) {
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get("quotes")
  async listQuotes(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const quotes = await billingService.listQuotes(result.ctx);
      return res.json({ quotes });
    } catch (err) {
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Post("quotes")
  async createQuote(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.BILLING_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = createQuoteSchema.parse(req.body);
      const quote = await billingService.createQuote(result.ctx, body);
      return res.status(201).json({ quote });
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

  @Post("quotes/:id/purchase")
  async purchaseQuote(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.BILLING_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const purchase = await billingService.purchaseQuote(result.ctx, id);
      return res.json(purchase);
    } catch (err) {
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
