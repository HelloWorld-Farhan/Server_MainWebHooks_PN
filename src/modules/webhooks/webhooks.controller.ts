import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Webhook } from "svix";

import { cacheService } from "@/server/cache/cache.service";
import { gqlDebug, gqlLogError } from "@/server/graphql/debug";
import { isClerkWebhooksEnabled } from "@/server/lib/clerk-config";
import prisma from "@/server/lib/prisma";
import { logResolutionEvent } from "@/server/lib/resolution-metrics";
import { handleClerkWebhookEvent } from "@/server/services/clerk-provision.service";

@Controller("api/webhooks/clerk")
export class WebhooksController {
  @Post()
  async handleClerkWebhook(@Req() req: Request, @Res() res: Response) {
    if (!isClerkWebhooksEnabled()) {
      return res.json({
        received: true,
        skipped: true,
        reason: "Clerk webhooks disabled; use direct API provisioning in dev",
      });
    }

    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({
        error:
          "CLERK_WEBHOOKS_ENABLED is true but CLERK_WEBHOOK_SECRET is missing",
      });
    }

    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
    const svixSignature = req.headers["svix-signature"] as string | undefined;

    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ error: "Missing svix headers" });
    }

    const payload = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});
    const wh = new Webhook(webhookSecret);

    let event: { type: string; data: Record<string, unknown> };
    try {
      event = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as { type: string; data: Record<string, unknown> };
    } catch {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const start = performance.now();

    try {
      await handleClerkWebhookEvent(event.type, event.data);
    } catch (error) {
      gqlLogError("clerk:webhook:handler-failed", error, { type: event.type });
      return res.status(500).json({ error: "Webhook handler failed" });
    }

    const durationMs = Math.round(performance.now() - start);

    if (
      event.type === "organizationMembership.created" ||
      event.type === "organizationMembership.updated" ||
      event.type === "organizationMembership.deleted"
    ) {
      const clerkUserId = event.data.public_user_data
        ? (event.data.public_user_data as { user_id: string }).user_id
        : (event.data.user_id as string);
      const orgId = event.data.organization_id as string | undefined;

      if (clerkUserId) {
        await cacheService.invalidateClerkMembershipCaches(clerkUserId, orgId);

        const user = await prisma.user.findUnique({
          where: { clerkUserId },
        });
        if (user) {
          await cacheService.invalidateUserPermissions(user.id);
        }
      }

      logResolutionEvent("clerk:webhook:membership", {
        type: event.type,
        clerkUserId,
        orgId,
        durationMs,
      });
    } else {
      gqlDebug("clerk:webhook:processed", { type: event.type, durationMs });
    }

    return res.json({ received: true });
  }
}
