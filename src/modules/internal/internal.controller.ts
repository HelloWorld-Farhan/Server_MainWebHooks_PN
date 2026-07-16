import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { validateAgentServerRequest } from "@/lib/api/agent-server-auth";
import { createServiceTenantContext } from "@/lib/api/service-tenant-context";
import { syncDialerCallToSheetDb } from "@/lib/integrations/db-state";

@Controller("api/internal/dialer")
export class InternalController {
  @Post("sheets-sync")
  async sheetsSync(
    @Req() req: Request,
    @Body() body: { callId?: string },
    @Res() res: Response,
  ) {
    const { companyId, error } = validateAgentServerRequest(req);
    if (error) {
      return res.status(error.status).json(error.body);
    }

    const callId = body.callId?.trim();
    if (!callId) {
      return res.status(400).json({ error: "callId is required" });
    }

    try {
      const ctx = createServiceTenantContext(companyId);
      const result = await syncDialerCallToSheetDb(ctx, callId);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : "Sheets sync failed",
      });
    }
  }
}
