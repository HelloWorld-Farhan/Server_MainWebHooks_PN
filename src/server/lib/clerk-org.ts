import { clerkClient } from "@/auth/clerk";

import {
  isClerkNotFound,
  isClerkOrganizationsDisabled,
} from "@/server/lib/clerk-errors";
import { ValidationError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";

type CompanyOrgFields = {
  id: string;
  name: string;
  clerkOrganizationId: string | null;
  ownerUserId: string | null;
};

type EnsureOrgOptions = {
  /** Clerk user id to use when creating an org (e.g. current inviter). */
  createdByClerkUserId?: string;
};

async function clerkOrganizationExists(organizationId: string): Promise<boolean> {
  const client = clerkClient;
  try {
    await client.organizations.getOrganization({ organizationId });
    return true;
  } catch (error) {
    if (isClerkNotFound(error)) return false;
    throw error;
  }
}

async function resolveCreatedByClerkUserId(
  company: CompanyOrgFields,
  options?: EnsureOrgOptions,
): Promise<string> {
  if (company.ownerUserId?.startsWith("user_")) {
    return company.ownerUserId;
  }

  if (options?.createdByClerkUserId?.startsWith("user_")) {
    return options.createdByClerkUserId;
  }

  const ownerMember = await prisma.companyMember.findFirst({
    where: {
      companyId: company.id,
      role: "OWNER",
      status: "ACTIVE",
    },
    include: { user: true },
  });

  const ownerClerkUserId = ownerMember?.user.clerkUserId;
  if (ownerClerkUserId?.startsWith("user_")) {
    return ownerClerkUserId;
  }

  throw new ValidationError(
    "Organization invitations require a company owner with a linked Clerk account",
  );
}

async function createClerkOrganizationForCompany(
  company: CompanyOrgFields,
  createdByClerkUserId: string,
): Promise<string> {
  const client = clerkClient;

  try {
    const org = await client.organizations.createOrganization({
      name: company.name,
      createdBy: createdByClerkUserId,
    });

    await prisma.company.update({
      where: { id: company.id },
      data: { clerkOrganizationId: org.id },
    });

    return org.id;
  } catch (error) {
    if (isClerkOrganizationsDisabled(error)) {
      throw new ValidationError(
        "Employee invitations require Clerk Organizations. Enable Organizations in your Clerk Dashboard (dashboard.clerk.com), then try sending the invite again.",
      );
    }
    throw error;
  }
}

/**
 * Returns a real Clerk org id (`org_…`). Verifies stored ids against Clerk,
 * recreates the org when missing/stale, and upgrades legacy `local:` ids when
 * Clerk Organizations is enabled.
 */
export async function ensureRealClerkOrganizationId(
  company: CompanyOrgFields,
  options?: EnsureOrgOptions,
): Promise<string> {
  const storedOrgId = company.clerkOrganizationId;

  if (storedOrgId?.startsWith("org_")) {
    const exists = await clerkOrganizationExists(storedOrgId);
    if (exists) return storedOrgId;
  }

  const createdByClerkUserId = await resolveCreatedByClerkUserId(
    company,
    options,
  );

  return createClerkOrganizationForCompany(company, createdByClerkUserId);
}
