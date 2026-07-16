import type { PrismaClient } from "@prisma/client";
import randomstring from "randomstring";

const CONTRACT_ID_PATTERN = /^[A-Z0-9]{10}$/;

export function generateContractId(): string {
  return randomstring.generate({
    length: 10,
    charset: "alphanumeric",
    capitalization: "uppercase",
  });
}

export function normalizeContractId(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  return CONTRACT_ID_PATTERN.test(normalized) ? normalized : null;
}

export async function generateUniqueContractId(
  prisma: PrismaClient,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const contractId = generateContractId();
    const existing = await prisma.company.findFirst({
      where: { contractId },
      select: { id: true },
    });
    if (!existing) {
      return contractId;
    }
  }
  throw new Error("Failed to generate unique contract ID after 20 attempts");
}
