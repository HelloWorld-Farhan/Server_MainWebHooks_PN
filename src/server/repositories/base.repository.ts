import type { PrismaClient } from "@prisma/client";

export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaClient) {}

  protected scope(companyId: string) {
    return { companyId };
  }
}
