import { cacheService } from "@/server/cache/cache.service";
import { ForbiddenError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import { TenantRepository } from "@/server/repositories/tenant.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";

export class CompanyService {
  private readonly repo = new TenantRepository(prisma);

  async getContact(ctx: TenantContext) {
    const contact = await this.repo.findCompanyContact(ctx.companyId);
    if (!contact) return null;

    return {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
    };
  }

  async upsertContact(
    ctx: TenantContext,
    data: { name: string; email: string; phone?: string; title?: string },
  ) {
    tenantService.requirePermission(ctx, PERMISSIONS.SETTINGS_WRITE);

    const company = await prisma.company.findUnique({
      where: { id: ctx.companyId },
      include: { contact: true },
    });

    if (company?.ownerUserId && company.contact?.email) {
      const existingEmail = company.contact.email.trim().toLowerCase();
      const submittedEmail = data.email.trim().toLowerCase();
      if (submittedEmail !== existingEmail) {
        throw new ForbiddenError(
          "Owner email cannot be changed after linking the Contract ID.",
        );
      }
      data = { ...data, email: company.contact.email };
    }

    const contact = await this.repo.upsertCompanyContact(ctx.companyId, data);
    await cacheService.invalidateSettingsPages(ctx.companyId);

    return {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
    };
  }
}

export const companyService = new CompanyService();
