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

    const existingLinked = await tenantRepo.findCompanyByOwnerUserId(clerkUserId);
    if (existingLinked) {
      throw new ConflictError("You have already linked a Contract ID");
    }

    const company = await prisma.company.findFirst({
      where: { contractId },
      include: { contact: true },
    });
    if (!company) {
      // #region agent log
      fetch('http://127.0.0.1:7337/ingest/56a44334-4141-484c-bb9b-95d1a3690082',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ead72'},body:JSON.stringify({sessionId:'1ead72',location:'contract.service.ts:linkContractId',message:'contract id not in database',data:{contractId},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      throw new ContractNotFoundError();
    }

    const isDemo = company.isDemo;

    if (!isDemo && company.ownerUserId != null) {
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

    const result = await prisma.$transaction(async (tx) => {
      const freshCompany = await tx.company.findUnique({
        where: { id: company.id },
      });

      if (!freshCompany) {
        throw new ContractNotFoundError();
      }

      if (!isDemo && freshCompany.ownerUserId != null) {
        throw new ConflictError("This Contract ID has already been linked");
      }

      if (!isDemo) {
        const userAlreadyLinked = await tx.company.findFirst({
          where: { ownerUserId: clerkUserId },
        });
        if (userAlreadyLinked) {
          throw new ConflictError("You have already linked a Contract ID");
        }
      }

      if (!isDemo && !freshCompany.clerkOrganizationId) {
        await tx.company.update({
          where: { id: company.id },
          data: { clerkOrganizationId },
        });
      }

      await tx.companyMember.upsert({
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
        const claimResult = await tx.company.updateMany({
          where: {
            id: company.id,
            OR: [{ ownerUserId: null }, { ownerUserId: { isSet: false } }],
          },
          data: {
            ownerUserId: clerkUserId,
            claimedAt,
          },
        });

        if (claimResult.count === 0) {
          throw new ConflictError("This Contract ID has already been linked");
        }
      }

      if (!isDemo) {
        await tx.companyContact.upsert({
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

      return {
        contractId: freshCompany.contractId,
        claimedAt: claimedAt.toISOString(),
        companyId: company.id,
      };
    });

    await ensureCreditBalance(result.companyId);
    await cacheService.invalidateSettingsPages(result.companyId);

    if (!isDemo && clerkOrganizationId.startsWith("org_")) {
      await ensureClerkOrganizationMember({
        organizationId: clerkOrganizationId,
        userId: clerkUserId,
        propnexRole: "OWNER",
      });
    }

    return {
      linked: true as const,
      contractId: result.contractId,
      claimedAt: result.claimedAt,
    };
  }
}

export const contractService = new ContractService();
