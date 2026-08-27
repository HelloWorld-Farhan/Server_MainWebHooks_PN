import { Controller, Post, Get, Body, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { requireTenantPermission } from "@/lib/api/tenant-context";
import { handleTenantResult } from "@/lib/api/http";
import { PERMISSIONS } from "@/lib/permissions";
import { startCampaignJob, getCampaignState } from "@/server/queues/campaign-execution.queue";

@Controller("api/campaign-execution")
export class OutboundCampaignExecutionController {
  
  @Post("start")
  async startCampaign(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(req, PERMISSIONS.CALL_LOGS_WRITE);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const { campaignId, didNumber, leads, channels } = req.body;
      
      if (!didNumber || !leads || leads.length === 0) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      await startCampaignJob({
        companyId: result.ctx.companyId,
        campaignId: campaignId || "manual",
        didNumber,
        leads,
        channels: channels || 2
      });

      return res.json({ success: true, message: "Campaign queued successfully" });
    } catch (e: any) {
      console.error("Failed to start campaign", e);
      return res.status(500).json({ error: e.message });
    }
  }

  @Get("status")
  async getStatus(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(req, PERMISSIONS.CALL_LOGS_READ);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const state = await getCampaignState(result.ctx.companyId);
      return res.json({ success: true, data: state });
    } catch (e: any) {
      console.error("Failed to fetch campaign state", e);
      return res.status(500).json({ error: e.message });
    }
  }
}
