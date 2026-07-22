import type { PrismaClient } from "@prisma/client";
import randomstring from "randomstring";

const COMPANY_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function generateCompanyCode(): string {
  return randomstring.generate({
    length: 6,
    charset: "alphanumeric",
    capitalization: "uppercase",
  });
}

export function normalizeCompanyCode(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  return COMPANY_CODE_PATTERN.test(normalized) ? normalized : null;
}

export async function generateUniqueCompanyCode(
  prisma: PrismaClient,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const companyCode = generateCompanyCode();
    const existing = await prisma.company.findFirst({
      where: { companyCode },
      select: { id: true },
    });
    if (!existing) {
      return companyCode;
    }
  }
  throw new Error("Failed to generate unique company code after 20 attempts");
}
