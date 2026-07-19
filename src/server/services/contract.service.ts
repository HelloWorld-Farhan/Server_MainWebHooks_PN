import { clerkClient } from "@/auth/clerk";

import { ensureClerkOrganizationMember } from "@/lib/clerk/organization";
import { cacheService } from "@/server/cache/cache.service";
import { isClerkOrganizationsDisabled } from "@/server/lib/clerk-errors";
import { localClerkOrganizationId } from "@/server/lib/clerk-sync";
import { normalizeContractId } from "@/server/lib/contract-id";
import {
  AppError,
  ConflictError,
  ContractNotFoundError,
} from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import { TenantRepository } from "@/server/repositories/tenant.repository";

const tenantRepo = new TenantRepository(prisma);

type ClerkUserSnapshot = {
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
  emailAddresses: { id: string; emailAddress: string }[];
  primaryEmailAddressId: string | null;
  phoneNumbers: { phoneNumber: string }[];
};

function getPrimaryEmail(clerkUser: ClerkUserSnapshot): string | null {
  return (
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? null
  );
}

async function ensureCreditBalance(companyId: string) {
  await prisma.creditBalance.upsert({
    where: { companyId },
    create: {
      companyId,
      creditsRemaining: 0,
      creditsUsed: 0,
    },
    update: {},
  });
}

async function resolveClerkOrganizationId(
  clerkUserId: string,
  companyName: string,
  existingOrgId: string | null,
): Promise<string> {
  if (existingOrgId) {
    return existingOrgId;
  }

  const client = clerkClient;
  try {
    const org = await client.organizations.createOrganization({
      name: companyName,
      createdBy: clerkUserId,
    });
    return org.id;
  } catch (error) {
    if (isClerkOrganizationsDisabled(error)) {
      return localClerkOrganizationId(clerkUserId);
    }
    throw error;
  }
}

export class ContractService {
  async getContractLinkStatus(clerkUserId: string) {
    const ownedCompany = await tenantRepo.findCompanyByOwnerUserId(clerkUserId);
    if (ownedCompany) {
      return {
        linked: true as const,
        contractId: ownedCompany.contractId,
        claimedAt: ownedCompany.claimedAt?.toISOString() ?? null,
      };
    }

    const dbUser = await tenantRepo.findUserByClerkId(clerkUserId);
    if (dbUser) {
      const activeMembership = await prisma.companyMember.findFirst({
        where: { userId: dbUser.id, status: "ACTIVE" },
        include: { company: true },
        orderBy: { joinedAt: "desc" },
      });
      if (activeMembership) {
        return {
          linked: true as const,
          contractId: activeMembership.company.contractId,
          claimedAt: activeMembership.company.claimedAt?.toISOString() ?? null,
        };
      }

      const invitedMembership = await prisma.companyMember.findFirst({
        where: { userId: dbUser.id, status: "INVITED" },
        include: { company: true },
        orderBy: { invitedAt: "desc" },
      });
      if (invitedMembership) {
        return {
          linked: true as const,
          contractId: invitedMembership.company.contractId,
          claimedAt: invitedMembership.company.claimedAt?.toISOString() ?? null,
        };
      }
    }

    return { linked: false as const };
  }

  async linkContractId(clerkUserId: string, rawContractId: string) {
    const contractId = normalizeContractId(rawContractId);
    if (!contractId) {
      throw new AppError("Invalid Contract ID format", "INVALID_FORMAT", 400);
    }

    const existingUser = await tenantRepo.findUserByClerkId(clerkUserId);
    if (existingUser) {
      const activeMembership = await prisma.companyMember.findFirst({
        where: { userId: existingUser.id, status: "ACTIVE" },
      });
      if (activeMembership) {
        throw new ConflictError("You have already linked a Contract ID");
      }
    }

    // Block only if the user already owns a *different* contract. Re-linking the
    // same contract is allowed so a previously-interrupted link can be resumed.
    const existingLinked = await tenantRepo.findCompanyByOwnerUserId(clerkUserId);
    if (existingLinked && existingLinked.contractId !== contractId) {
      throw new ConflictError("You have already linked a Contract ID");
    }

    const company = await prisma.company.findFirst({
      where: { contractId },
      include: { contact: true },
    });
    if (!company) {
      throw new ContractNotFoundError();
    }

    const isDemo = company.isDemo;

    // A non-demo contract already claimed by someone else cannot be linked.
    if (
      !isDemo &&
      company.ownerUserId != null &&
      company.ownerUserId !== clerkUserId
    ) {
      throw new ConflictError("This Contract ID has already been linked");
    }

    const client = clerkClient;
    const clerkUser = await client.users.getUser(clerkUserId);
    const primaryEmail = getPrimaryEmail(clerkUser);
    if (!primaryEmail) {
      throw new AppError("User email is required", "INVALID_USER", 400);
    }

    const ownerDisplayName = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const clerkOrganizationId = isDemo
      ? (company.clerkOrganizationId ?? localClerkOrganizationId(clerkUserId))
      : await resolveClerkOrganizationId(
          clerkUserId,
          company.name,
          company.clerkOrganizationId,
        );

    const dbUser = await tenantRepo.upsertUser({
      clerkUserId,
      email: primaryEmail,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
      phone: clerkUser.phoneNumbers[0]?.phoneNumber,
    });

    const claimedAt = new Date();

    // Sequential idempotent writes (no interactive transaction). MongoDB
    // interactive transactions add constraints that can silently roll the
    // whole link back; instead we claim the company first via a compare-and-set
    // so ownership is established before the membership is created, then run
    // idempotent upserts that are safe to retry.
    if (!isDemo) {
      const claimData: {
        ownerUserId: string;
        claimedAt: Date;
        clerkOrganizationId?: string;
      } = { ownerUserId: clerkUserId, claimedAt };
      if (!company.clerkOrganizationId) {
        claimData.clerkOrganizationId = clerkOrganizationId;
      }

      const claimResult = await prisma.company.updateMany({
        where: {
          id: company.id,
          OR: [{ ownerUserId: null }, { ownerUserId: { isSet: false } }],
        },
        data: claimData,
      });

      // count === 0 means the compare-and-set did not apply. That is fine only
      // when this same user already owns the company (resuming a prior attempt);
      // any other owner is a genuine conflict.
      if (claimResult.count === 0) {
        const current = await prisma.company.findUnique({
          where: { id: company.id },
        });
        if (!current || current.ownerUserId !== clerkUserId) {
          throw new ConflictError("This Contract ID has already been linked");
        }
      }
    }

    await prisma.companyMember.upsert({
      where: {
        companyId_userId: {
          companyId: company.id,
          userId: dbUser.id,
        },
      },
      create: {
        companyId: company.id,
        userId: dbUser.id,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: claimedAt,
      },
      update: {
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    if (!isDemo) {
      await prisma.companyContact.upsert({
        where: { companyId: company.id },
        create: {
          companyId: company.id,
          name: ownerDisplayName || primaryEmail.split("@")[0] || "Owner",
          email: primaryEmail.toLowerCase(),
          phone: clerkUser.phoneNumbers[0]?.phoneNumber ?? null,
        },
        update: {
          name: ownerDisplayName || undefined,
          email: primaryEmail.toLowerCase(),
          phone: clerkUser.phoneNumbers[0]?.phoneNumber ?? undefined,
        },
      });
    }

    await ensureCreditBalance(company.id);
    await cacheService.invalidateSettingsPages(company.id);

    if (!isDemo && clerkOrganizationId.startsWith("org_")) {
      await ensureClerkOrganizationMember({
        organizationId: clerkOrganizationId,
        userId: clerkUserId,
        propnexRole: "OWNER",
      });
    }

    const linkedCompany = await prisma.company.findUnique({
      where: { id: company.id },
    });

    return {
      linked: true as const,
      contractId: linkedCompany?.contractId ?? company.contractId,
      claimedAt: (linkedCompany?.claimedAt ?? claimedAt).toISOString(),
    };
  }
}

export const contractService = new ContractService();
