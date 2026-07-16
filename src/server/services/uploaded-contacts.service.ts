import { AppError, NotFoundError } from "@/server/lib/errors";
import { cacheService } from "@/server/cache/cache.service";
import prisma from "@/server/lib/prisma";
import { BranchesRepository } from "@/server/repositories/branches.repository";
import {
  UploadedContactsRepository,
  type UploadedContactCreateInput,
} from "@/server/repositories/uploaded-contacts.repository";
import type { TenantContext } from "@/server/types/context";
import { PERMISSIONS } from "@/server/types/permissions";
import { tenantService } from "@/server/services/tenant.service";
import { normalizeStoredContactPhone } from "@/lib/contact-phone-validation";
const MAX_IMPORT_ROWS = 5000;

function mapUploadedContact(row: {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  address: string | null;
  branchIds: string[];
  createdAt: Date;
}) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    email: row.email,
    address: row.address,
    branchIds: row.branchIds,
    createdAt: row.createdAt.toISOString(),
  };
}

type ImportedContactRow = UploadedContactCreateInput & {
  branchNames?: string[];
};

function normalizeImportedContact(
  contact: ImportedContactRow,
): (UploadedContactCreateInput & { branchNames: string[] }) | null {
  const normalized = normalizeStoredContactPhone(contact.phone);
  if (!normalized) {
    return null;
  }

  return {
    phone: normalized,
    name: contact.name?.trim() || null,
    email: contact.email?.trim() || null,
    address: contact.address?.trim() || null,
    branchNames: (contact.branchNames ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  };
}

export class UploadedContactsService {
  private readonly repo = new UploadedContactsRepository(prisma);
  private readonly branchesRepo = new BranchesRepository(prisma);

  async list(ctx: TenantContext) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_READ);
    const rows = await this.repo.findMany(ctx.companyId);
    return rows.map(mapUploadedContact);
  }

  async create(ctx: TenantContext, phone: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_WRITE);

    const normalized = normalizeStoredContactPhone(phone);
    if (!normalized) {
      throw new AppError(
        "Phone number must be a valid 10-digit local number with a supported country code.",
        "INVALID_PHONE",
      );
    }

    const existing = await this.repo.findByPhones(ctx.companyId, [normalized]);
    if (existing.length > 0) {
      throw new AppError("This phone number already exists.", "DUPLICATE_PHONE");
    }

    const row = await this.repo.create(ctx.companyId, { phone: normalized });
    await cacheService.invalidateUploadedContactPages(ctx.companyId);
    return mapUploadedContact(row);
  }

  async importContacts(ctx: TenantContext, contacts: ImportedContactRow[]) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_WRITE);

    const normalizedRows: Array<
      UploadedContactCreateInput & { branchNames: string[] }
    > = [];
    let invalid = 0;
    const seen = new Set<string>();

    for (const raw of contacts.slice(0, MAX_IMPORT_ROWS)) {
      const normalized = normalizeImportedContact(raw);
      if (!normalized) {
        invalid++;
        continue;
      }
      if (seen.has(normalized.phone)) {
        continue;
      }
      seen.add(normalized.phone);
      normalizedRows.push(normalized);
    }

    const branches = await this.branchesRepo.findAllNames(ctx.companyId);
    const branchByName = new Map(
      branches.map((branch) => [branch.name.trim().toLowerCase(), branch.id]),
    );
    const unmatchedBranches = new Set<string>();

    const validContacts: UploadedContactCreateInput[] = normalizedRows.map(
      (row) => {
        const branchIds: string[] = [];
        for (const name of row.branchNames) {
          const branchId = branchByName.get(name.toLowerCase());
          if (branchId) {
            branchIds.push(branchId);
          } else {
            unmatchedBranches.add(name);
          }
        }
        return {
          phone: row.phone,
          name: row.name,
          email: row.email,
          address: row.address,
          branchIds: [...new Set(branchIds)],
        };
      },
    );

    const { created, skipped } = await this.repo.createMany(
      ctx.companyId,
      validContacts,
    );

    if (created > 0) {
      await cacheService.invalidateUploadedContactPages(ctx.companyId);
    }

    return {
      created,
      skipped,
      invalid,
      unmatchedBranches: [...unmatchedBranches],
    };
  }

  async delete(ctx: TenantContext, id: string) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_WRITE);

    const deleted = await this.repo.delete(ctx.companyId, id);
    if (!deleted) {
      throw new NotFoundError("Contact not found");
    }

    await cacheService.invalidateUploadedContactPages(ctx.companyId);
    return true;
  }

  async bulkDelete(ctx: TenantContext, ids: string[]) {
    tenantService.requirePermission(ctx, PERMISSIONS.LEADS_WRITE);

    const count = await this.repo.bulkDelete(ctx.companyId, ids);
    if (count > 0) {
      await cacheService.invalidateUploadedContactPages(ctx.companyId);
    }
    return count;
  }
}

export const uploadedContactsService = new UploadedContactsService();
