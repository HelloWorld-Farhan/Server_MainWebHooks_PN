import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { handleTenantResult } from "@/lib/api/http";
import { requireTenantPermission } from "@/lib/api/tenant-context";
import { PERMISSIONS } from "@/lib/permissions";
import { isAppError } from "@/server/lib/errors";
import { campaignExecutionService } from "@/server/campaign-execution/campaign-execution.service";

const scheduleSchema = z.object({
  scheduledAt: z.string().min(1),
});

const startSchema = z.object({
  scheduledAt: z.string().optional(),
});

const retryPolicySchema = z.object({
  retryEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).optional(),
  retryDelaySeconds: z.number().int().min(0).optional(),
  retryOnBusy: z.boolean().optional(),
  retryOnNoAnswer: z.boolean().optional(),
  retryOnFailed: z.boolean().optional(),
  retryOnCancelled: z.boolean().optional(),
  retryOnVoicemail: z.boolean().optional(),
  retryOnMissed: z.boolean().optional(),
});

@Controller("api/campaigns/:campaignId/execution")
export class CampaignExecutionController {
  @Post("start")
  async start(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = startSchema.parse(req.body ?? {});
      const response = await campaignExecutionService.start(
        result.ctx,
        campaignId,
        body.scheduledAt,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Post("schedule")
  async schedule(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = scheduleSchema.parse(req.body);
      const response = await campaignExecutionService.schedule(
        result.ctx,
        campaignId,
        body.scheduledAt,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Post("pause")
  async pause(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.pause(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Post("resume")
  async resume(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.resume(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Post("retry")
  async retry(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.retry(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Post("reset")
  async reset(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.reset(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Post("cancel")
  async cancel(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.cancel(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("status")
  async status(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getStatus(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("statistics")
  async statistics(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getStatistics(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("progress")
  async progress(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getProgress(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("retry-policy")
  async retryPolicy(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getRetryPolicy(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Put("retry-policy")
  async updateRetryPolicy(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = retryPolicySchema.parse(req.body ?? {});
      const response = await campaignExecutionService.updateRetryPolicy(
        result.ctx,
        campaignId,
        body,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("retry-history")
  async retryHistory(
    @Param("campaignId") campaignId: string,
    @Query("phoneNumber") phoneNumber: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getRetryHistory(
        result.ctx,
        campaignId,
        phoneNumber,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("pending-retries")
  async pendingRetries(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getPendingRetries(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("retry-statistics")
  async retryStatistics(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getRetryStatistics(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  @Get("retry-summary")
  async retrySummary(
    @Param("campaignId") campaignId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CAMPAIGNS_READ,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const response = await campaignExecutionService.getRetrySummary(
        result.ctx,
        campaignId,
      );
      return res.json(response);
    } catch (err) {
      return this.handleError(res, err);
    }
  }

  private handleError(res: Response, err: unknown) {
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
