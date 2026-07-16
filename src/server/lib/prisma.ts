import { PrismaClient } from "@prisma/client";

import { getDatabaseUrl } from "@/server/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(getDatabaseUrl()
      ? {
          datasources: {
            db: {
              url: getDatabaseUrl(),
            },
          },
        }
      : {}),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
