import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { channelService } from "@/server/channels/channel.service";
import { getChannelMetricsSnapshot } from "@/server/channels/channel-metrics";

const API_KEY_HEADER = "x-agent-server-key";

function validateInternalRequest(req: Request): { error?: { status: number; body: { error: string } } } {
  const expectedKey = process.env.AGENT_SERVER_API_KEY;
  if (!expectedKey) {
    return {
      error: {
        status: 503,
        body: { error: "Internal API key is not configured" },
      },
    };
  }

  const providedKey = req.headers[API_KEY_HEADER] as string | undefined;
  if (!providedKey || providedKey !== expectedKey) {
    return { error: { status: 401, body: { error: "Unauthorized" } } };
  }

  return {};
}

@Controller("api/internal/channels")
export class ChannelsInternalController {
  @Get("metrics")
  async metrics(@Req() req: Request, @Res() res: Response) {
    const auth = validateInternalRequest(req);
    if (auth.error) {
      return res.status(auth.error.status).json(auth.error.body);
    }

    return res.json(getChannelMetricsSnapshot());
  }

  @Get(":companyId/status")
  async companyStatus(
    @Req() req: Request,
    @Param("companyId") companyId: string,
    @Res() res: Response,
  ) {
    const auth = validateInternalRequest(req);
    if (auth.error) {
      return res.status(auth.error.status).json(auth.error.body);
    }

    const trimmedCompanyId = companyId?.trim();
    if (!trimmedCompanyId) {
      return res.status(400).json({ error: "companyId is required" });
    }

    const status = await channelService.getMetrics(trimmedCompanyId);
    return res.json(status);
  }
}
