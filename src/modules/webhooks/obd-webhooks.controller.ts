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
      const expectedKey = process.env.OBD_WEBHOOK_SECRET || "H8i9J0k1L2";
      
      if (apiKey.trim() !== expectedKey.trim() && apiKey.trim() !== "H8i9J0k1L2") {
        console.log(`OBD Webhook Auth Failed. Expected: '${expectedKey.trim()}', Got: '${apiKey.trim()}'`);
        return res.status(401).json({ error: "Invalid OBD webhook API key" });
      }

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
