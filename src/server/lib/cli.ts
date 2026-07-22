import type { PrismaClient } from "@prisma/client";

const CLI_PATTERN = /^[A-Z]{2,5}$/;

export function normalizeCli(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  return CLI_PATTERN.test(normalized) ? normalized : null;
}

export function deriveCliFromSlug(slug: string): string {
  const letters = slug.replace(/[^a-zA-Z]/g, "").toUpperCase();
  if (letters.length >= 3) {
    return letters.slice(0, 3);
  }
  return letters.padEnd(3, "X").slice(0, 3);
}

export async function generateUniqueCliFromSlug(
  prisma: PrismaClient,
  slug: string,
): Promise<string> {
  const base = deriveCliFromSlug(slug);

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate =
      attempt === 0
        ? base
        : `${base.slice(0, 2)}${String.fromCharCode(65 + (attempt % 26))}`.slice(
            0,
            3,
          );

    const existing = await prisma.company.findFirst({
      where: { cli: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new Error(`Failed to generate unique CLI for slug: ${slug}`);
}
