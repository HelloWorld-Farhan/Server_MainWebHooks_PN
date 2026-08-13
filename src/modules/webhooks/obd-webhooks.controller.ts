import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { isAppError } from "@/server/lib/errors";
import { obdWebhookService } from "@/server/telephony/webhook.service";

@Controller("api/webhooks/obd")
export class ObdWebhooksController {
  @Post()
  async handleObdWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const apiKey = (req.headers["x-obd-api-key"] || req.headers["x-api-key"] || req.query.apiKey || req.query.key || req.query.api_key || "") as string;
      // Authentication check removed as per user request to allow all webhooks through without 401 errors.

      const result = await obdWebhookService.processWebhook(req.body);
      return res.json(result);
    } catch (error) {
      if (isAppError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
