import { SupportRequestReason } from "@prisma/client";
import type { Request } from "express";
import { z } from "zod";

import { clerkClient, getAuthFromRequest } from "@/auth/clerk";
import {
  CONTACT_PLAN_OPTIONS,
  CONTACT_REASON_OPTIONS,
  getContactPlanLabel,
} from "@/lib/contact-form-data";
import prisma from "@/server/lib/prisma";
import { SupportRequestRepository } from "@/server/repositories/support-request.repository";
import { TenantRepository } from "@/server/repositories/tenant.repository";
import { resolveAuthenticatedTenant } from "@/server/services/company-resolution.service";

const reasonValues = CONTACT_REASON_OPTIONS.map((option) => option.value);
const planIds = CONTACT_PLAN_OPTIONS.map((option) => option.id);

const contactRequestSchema = z.object({
  name: z.string().trim().min(1, "Full name is required.").max(200),
  email: z.string().trim().email("A valid email address is required.").max(320),
  reason: z.enum(reasonValues as [SupportRequestReason, ...SupportRequestReason[]]),
  planId: z.enum(planIds as [string, ...string[]]),
  message: z.string().trim().min(1, "Message is required.").max(5000),
});

export type SubmitContactRequestResult =
  | { success: true; requestId: string }
  | { success: false; error: string };

export async function submitContactRequest(
  req: Request,
): Promise<SubmitContactRequestResult> {
  const parsed = contactRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid form data.",
    };
  }

  const data = parsed.data;
  const repo = new SupportRequestRepository(prisma);
  const tenantRepo = new TenantRepository(prisma);

  let userId: string | null = null;
  let companyId: string | null = null;
  let clerkUserId: string | null = null;
  let email = data.email;

  try {
    const { userId: authUserId, orgId } = await getAuthFromRequest(req);
    if (authUserId) {
      clerkUserId = authUserId;
      const dbUser = await tenantRepo.findUserByClerkId(authUserId);
      if (dbUser) {
        userId = dbUser.id;
        email = dbUser.email;
      } else {
        const clerkUser = await clerkClient.users.getUser(authUserId);
        const primaryEmail =
          clerkUser.emailAddresses.find(
            (entry) => entry.id === clerkUser.primaryEmailAddressId,
          )?.emailAddress ??
          clerkUser.emailAddresses[0]?.emailAddress ??
          data.email;
        email = primaryEmail;
      }

      try {
        const tenant = await resolveAuthenticatedTenant(authUserId, orgId);
        if (tenant) {
          companyId = tenant.company.id;
          if (!userId) {
            userId = tenant.user.id;
            email = tenant.user.email;
          }
        }
      } catch {
        // Signed-in user without company context is allowed for public contact.
      }
    }

    const request = await repo.create({
      name: data.name,
      email,
      reason: data.reason,
      planId: data.planId,
      planName: getContactPlanLabel(data.planId),
      message: data.message,
      userId,
      companyId,
      clerkUserId,
    });

    return { success: true, requestId: request.id };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to submit your request right now.";
    console.error("submitContactRequest failed:", error);
    return { success: false, error: message };
  }
}
