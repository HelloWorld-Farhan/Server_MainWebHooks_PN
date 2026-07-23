import { allocateResourceKey } from "@/server/lib/resource-key";
import { PublicResourceType } from "@/server/lib/public-id/types";
import { BaseRepository } from "@/server/repositories/base.repository";

export type UploadedContactCreateInput = {
  phone: string;
  field1?: string | null;
  field2?: string | null;
  field3?: string | null;
  campaignIds?: string[];
};

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
      return Promise.resolve([]);
    }
    return this.prisma.uploadedContact.findMany({
      where: { companyId, phone: { in: phones } },
      select: { phone: true },
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
  ): Promise<{ created: number; skipped: number }> {
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
      return { created: 0, skipped: 0 };
    }

    const existing = await this.findByPhones(
      companyId,
      uniqueContacts.map((contact) => contact.phone),
    );
    const existingSet = new Set(existing.map((row) => row.phone));
    const toCreate = uniqueContacts.filter(
      (contact) => !existingSet.has(contact.phone),
    );
    const skipped = uniqueContacts.length - toCreate.length;

    if (toCreate.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const contact of toCreate) {
          const resourceKey = await allocateResourceKey(
            tx,
            companyId,
            PublicResourceType.CONTACT,
          );
          await tx.uploadedContact.create({
            data: {
              companyId,
              phone: contact.phone,
              field1: contact.field1 ?? null,
              field2: contact.field2 ?? null,
              field3: contact.field3 ?? null,
              campaignIds: contact.campaignIds ?? [],
              resourceKey,
            },
          });
        }
      });
    }

    return { created: toCreate.length, skipped };
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
