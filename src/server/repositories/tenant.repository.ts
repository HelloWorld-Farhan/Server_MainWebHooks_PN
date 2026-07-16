import type {
  CallVolumeRange,
  MemberStatus,
  PrimaryUseCase,
  UserRole,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

import { BaseRepository } from "@/server/repositories/base.repository";
import { generateUniqueContractId } from "@/server/lib/contract-id";

export class TenantRepository extends BaseRepository {
  findCompanyByClerkOrgId(clerkOrganizationId: string) {
    return this.prisma.company.findFirst({
      where: { clerkOrganizationId },
    });
  }

  findCompanyById(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
    });
  }

  findCompanyByContractId(contractId: string) {
    return this.prisma.company.findFirst({
      where: { contractId },
    });
  }

  findCompanyByOwnerUserId(ownerUserId: string) {
    return this.prisma.company.findFirst({
      where: { ownerUserId },
    });
  }

  findUserByClerkId(clerkUserId: string) {
    return this.prisma.user.findUnique({
      where: { clerkUserId },
    });
  }

  findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }

  findMembership(companyId: string, userId: string) {
    return this.prisma.companyMember.findUnique({
      where: {
        companyId_userId: { companyId, userId },
      },
      include: {
        customRole: true,
        user: true,
        company: true,
        branchAccess: true,
      },
    });
  }

  upsertUser(data: {
    clerkUserId: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    imageUrl?: string | null;
    phone?: string | null;
  }) {
    return this.prisma.user.upsert({
      where: { clerkUserId: data.clerkUserId },
      create: {
        clerkUserId: data.clerkUserId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        imageUrl: data.imageUrl,
        phone: data.phone,
      },
      update: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        imageUrl: data.imageUrl,
        phone: data.phone,
      },
    });
  }

  async upsertCompany(data: {
    clerkOrganizationId: string;
    name: string;
    slug: string;
    primaryUseCase?: PrimaryUseCase | null;
    callVolume?: CallVolumeRange | null;
  }) {
    const updateData = {
      name: data.name,
      ...(data.primaryUseCase !== undefined
        ? { primaryUseCase: data.primaryUseCase }
        : {}),
      ...(data.callVolume !== undefined ? { callVolume: data.callVolume } : {}),
    };

    const existing = await this.findCompanyByClerkOrgId(data.clerkOrganizationId);
    if (existing) {
      return this.prisma.company.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    const contractId = await generateUniqueContractId(this.prisma);
    try {
      return await this.prisma.company.create({
        data: {
          clerkOrganizationId: data.clerkOrganizationId,
          name: data.name,
          slug: data.slug,
          contractId,
          ownerUserId: null,
          primaryUseCase: data.primaryUseCase ?? undefined,
          callVolume: data.callVolume ?? undefined,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await this.findCompanyByClerkOrgId(data.clerkOrganizationId);
        if (raced) {
          return this.prisma.company.update({
            where: { id: raced.id },
            data: updateData,
          });
        }
      }
      throw error;
    }
  }

  upsertMembership(data: {
    companyId: string;
    userId: string;
    role: UserRole;
    status?: MemberStatus;
  }) {
    return this.prisma.companyMember.upsert({
      where: {
        companyId_userId: {
          companyId: data.companyId,
          userId: data.userId,
        },
      },
      create: {
        companyId: data.companyId,
        userId: data.userId,
        role: data.role,
        status: data.status ?? "ACTIVE",
        joinedAt: new Date(),
      },
      update: {
        role: data.role,
        status: data.status ?? "ACTIVE",
      },
    });
  }

  findUsersByIds(companyId: string, ids: string[]) {
    return this.prisma.user.findMany({
      where: {
        id: { in: ids },
        memberships: { some: { companyId, status: "ACTIVE" } },
      },
    });
  }

  findCompanyContact(companyId: string) {
    return this.prisma.companyContact.findUnique({
      where: { companyId },
    });
  }

  upsertCompanyContact(
    companyId: string,
    data: { name: string; email: string; phone?: string; title?: string },
  ) {
    return this.prisma.companyContact.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }
}
