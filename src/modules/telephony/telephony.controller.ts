import {
  Body,
  Controller,
  Get,
  Post,
  Put,
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
import { telephonyService } from "@/server/services/telephony.service";

const providerEnum = z.enum(["twilio", "exotel", "propnex"]);

const providerConfigsSchema = z.object({
  twilio: z
    .object({
      accountSid: z.string(),
      authToken: z.string(),
      defaultPhoneNumber: z.string(),
    })
    .optional(),
  exotel: z
    .object({
      apiKey: z.string(),
      apiSecret: z.string(),
      exophoneNumber: z.string(),
    })
    .optional(),
  propnex: z
    .object({
      region: z.string(),
      environment: z.enum(["production", "sandbox"]),
    })
    .optional(),
});

const saveConfigSchema = z.object({
  activeProvider: providerEnum,
  providerConfigs: providerConfigsSchema,
  channelSettings: z
    .object({
      maxConcurrentCalls: z.number().int().positive(),
      callQueueLimit: z.number().int().nonnegative(),
      overflowHandling: z.enum(["queue", "reject", "forward"]),
    })
    .optional(),
  totalChannels: z.number().int().nonnegative().optional(),
  pulseTimeSeconds: z.number().int().positive().optional(),
  deltaSeconds: z.number().int().positive().optional(),
  channels: z
    .array(
      z.object({
        channelIndex: z.number().int().nonnegative(),
        label: z.string().optional(),
        phoneNumberId: z.string().optional(),
      }),
    )
    .optional(),
});

const testConnectionSchema = z.object({
  provider: providerEnum,
  providerConfigs: providerConfigsSchema,
});

const testCallSchema = z.object({
  phoneNumber: z.string().min(1),
  provider: providerEnum.optional(),
});

@Controller("api/telephony")
export class TelephonyController {
  @Get("config")
  async getConfig(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const config = await telephonyService.getConfig(result.ctx);
      return res.json({ config });
    } catch (err) {
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Put("config")
  async saveConfig(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.SETTINGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = saveConfigSchema.parse(req.body);
      const config = await telephonyService.saveConfig(result.ctx, {
        activeProvider: body.activeProvider,
        providerConfigs: {
          twilio: body.providerConfigs.twilio ?? {
            accountSid: "",
            authToken: "",
            defaultPhoneNumber: "",
          },
          exotel: body.providerConfigs.exotel ?? {
            apiKey: "",
            apiSecret: "",
            exophoneNumber: "",
          },
          propnex: body.providerConfigs.propnex ?? {
            region: "us-east-1",
            environment: "production",
          },
        },
        channelSettings: body.channelSettings,
        totalChannels: body.totalChannels,
        pulseTimeSeconds: body.pulseTimeSeconds,
        deltaSeconds: body.deltaSeconds,
        channels: body.channels,
      });
      return res.json({ config });
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

  @Post("test-connection")
  async testConnection(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.SETTINGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = testConnectionSchema.parse(req.body);
      const testResult = await telephonyService.testConnection(result.ctx, {
        provider: body.provider,
        providerConfigs: {
          twilio: body.providerConfigs.twilio ?? {
            accountSid: "",
            authToken: "",
            defaultPhoneNumber: "",
          },
          exotel: body.providerConfigs.exotel ?? {
            apiKey: "",
            apiSecret: "",
            exophoneNumber: "",
          },
          propnex: body.providerConfigs.propnex ?? {
            region: "us-east-1",
            environment: "production",
          },
        },
      });
      return res.json(testResult);
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

  @Post("test-call")
  async testCall(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.SETTINGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = testCallSchema.parse(req.body);
      const testResult = await telephonyService.testCall(result.ctx, body);
      return res.json(testResult);
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
}
