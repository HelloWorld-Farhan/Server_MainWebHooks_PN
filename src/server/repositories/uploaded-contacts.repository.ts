import { BaseRepository } from "@/server/repositories/base.repository";

export type UploadedContactCreateInput = {
  phone: string;
  name?: string | null;
  email?: string | null;
  address?: string | null;
  branchIds?: string[];
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
    return this.prisma.uploadedContact.create({
      data: {
        phone: contact.phone,
        name: contact.name ?? null,
        email: contact.email ?? null,
        address: contact.address ?? null,
        branchIds: contact.branchIds ?? [],
        company: { connect: { id: companyId } },
      },
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
      await this.prisma.uploadedContact.createMany({
        data: toCreate.map((contact) => ({
          companyId,
          phone: contact.phone,
          name: contact.name ?? null,
          email: contact.email ?? null,
          address: contact.address ?? null,
          branchIds: contact.branchIds ?? [],
        })),
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
