import {
  allocateResourceKey,
  allocateResourceKeys,
} from "@/server/lib/resource-key";
import { PublicResourceType } from "@/server/lib/public-id/types";
import { BaseRepository } from "@/server/repositories/base.repository";

export type UploadedContactCreateInput = {
  phone: string;
  field1?: string | null;
  field2?: string | null;
  field3?: string | null;
  campaignIds?: string[];
};

type ExistingUploadedContact = {
  id: string;
  phone: string;
  field1: string | null;
  field2: string | null;
  field3: string | null;
  campaignIds: string[];
};

function mergeIncomingContact(
  existing: ExistingUploadedContact,
  incoming: UploadedContactCreateInput,
): {
  field1: string | null;
  field2: string | null;
  field3: string | null;
  campaignIds: string[];
} | null {
  const campaignIds = [
    ...new Set([...existing.campaignIds, ...(incoming.campaignIds ?? [])]),
  ];
  const field1 = incoming.field1?.trim()
    ? incoming.field1.trim()
    : existing.field1;
  const field2 = incoming.field2?.trim()
    ? incoming.field2.trim()
    : existing.field2;
  const field3 = incoming.field3?.trim()
    ? incoming.field3.trim()
    : existing.field3;

  const changed =
    campaignIds.length !== existing.campaignIds.length ||
    field1 !== existing.field1 ||
    field2 !== existing.field2 ||
    field3 !== existing.field3;

  if (!changed) {
    return null;
  }

  return { field1, field2, field3, campaignIds };
}

export class UploadedContactsRepository extends BaseRepository {
  findMany(companyId: string) {
    return this.prisma.uploadedContact.findMany({
      where: this.scope(companyId),
      orderBy: { createdAt: "desc" },
    });
  }

  findById(companyId: string, id: string) {
    return this.prisma.uploadedContact.findFirst({
      where: { id, companyId },
    });
  }

  findByPhones(companyId: string, phones: string[]) {
    if (phones.length === 0) {
      return Promise.resolve([] as ExistingUploadedContact[]);
    }
    return this.prisma.uploadedContact.findMany({
      where: { companyId, phone: { in: phones } },
      select: {
        id: true,
        phone: true,
        field1: true,
        field2: true,
        field3: true,
        campaignIds: true,
      },
    });
  }

  create(companyId: string, contact: UploadedContactCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const resourceKey = await allocateResourceKey(
        tx,
        companyId,
        PublicResourceType.CONTACT,
      );

      return tx.uploadedContact.create({
        data: {
          phone: contact.phone,
          field1: contact.field1 ?? null,
          field2: contact.field2 ?? null,
          field3: contact.field3 ?? null,
          campaignIds: contact.campaignIds ?? [],
          resourceKey,
          company: { connect: { id: companyId } },
        },
      });
    });
  }

  async createMany(
    companyId: string,
    contacts: UploadedContactCreateInput[],
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const seen = new Set<string>();
    const uniqueContacts: UploadedContactCreateInput[] = [];

    for (const contact of contacts) {
      if (seen.has(contact.phone)) {
        continue;
      }
      seen.add(contact.phone);
      uniqueContacts.push(contact);
    }

    if (uniqueContacts.length === 0) {
      return { created: 0, updated: 0, skipped: 0 };
    }

    const existingRows = await this.findByPhones(
      companyId,
      uniqueContacts.map((contact) => contact.phone),
    );
    const existingByPhone = new Map<string, ExistingUploadedContact>(
      existingRows.map((row) => [row.phone, row]),
    );

    const toCreate: UploadedContactCreateInput[] = [];
    const toUpdate: Array<{
      id: string;
      field1: string | null;
      field2: string | null;
      field3: string | null;
      campaignIds: string[];
    }> = [];
    let skipped = 0;

    for (const contact of uniqueContacts) {
      const existing = existingByPhone.get(contact.phone);
      if (!existing) {
        toCreate.push(contact);
        continue;
      }

      const merged = mergeIncomingContact(existing, contact);
      if (!merged) {
        skipped++;
        continue;
      }

      toUpdate.push({
        id: existing.id,
        ...merged,
      });
    }

    if (toCreate.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        const resourceKeys = await allocateResourceKeys(
          tx,
          companyId,
          PublicResourceType.CONTACT,
          toCreate.length,
        );

        await tx.uploadedContact.createMany({
          data: toCreate.map((contact, index) => ({
            companyId,
            phone: contact.phone,
            field1: contact.field1 ?? null,
            field2: contact.field2 ?? null,
            field3: contact.field3 ?? null,
            campaignIds: contact.campaignIds ?? [],
            resourceKey: resourceKeys[index]!,
          })),
        });
      });
    }

    for (const update of toUpdate) {
      await this.prisma.uploadedContact.update({
        where: { id: update.id },
        data: {
          field1: update.field1,
          field2: update.field2,
          field3: update.field3,
          campaignIds: update.campaignIds,
        },
      });
    }

    return {
      created: toCreate.length,
      updated: toUpdate.length,
      skipped,
    };
  }

  async delete(companyId: string, id: string): Promise<boolean> {
    const existing = await this.findById(companyId, id);
    if (!existing) {
      return false;
    }
    await this.prisma.uploadedContact.delete({ where: { id } });
    return true;
  }

  async bulkDelete(companyId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.prisma.uploadedContact.deleteMany({
      where: { companyId, id: { in: ids } },
    });
    return result.count;
  }
}
