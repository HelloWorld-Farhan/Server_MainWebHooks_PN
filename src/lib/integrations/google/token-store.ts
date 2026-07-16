import type { IntegrationType, Prisma } from "@prisma/client";

import { decryptJson, encryptJson } from "@/lib/integrations/google/crypto";
import prisma from "@/server/lib/prisma";
import type { TenantContext } from "@/server/types/context";

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  scope: string;
  tokenType: string;
  email: string | null;
};

type IntegrationConfig = {
  googleTokens?: string;
  [key: string]: unknown;
};

const TOKEN_HOLDER_TYPES: IntegrationType[] = [
  "GOOGLE_SHEETS",
  "GOOGLE_CALENDAR",
];

function parseConfig(raw: unknown): IntegrationConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as IntegrationConfig;
}

async function findTokenHolder(companyId: string) {
  for (const type of TOKEN_HOLDER_TYPES) {
    const row = await prisma.integration.findFirst({
      where: { companyId, type },
    });
    const config = parseConfig(row?.config);
    if (row && config.googleTokens) {
      return row;
    }
  }
  return prisma.integration.findFirst({
    where: { companyId, type: "GOOGLE_SHEETS" },
  });
}

export async function getGoogleTokens(
  ctx: TenantContext,
): Promise<GoogleTokenSet | null> {
  const row = await findTokenHolder(ctx.companyId);
  if (!row) return null;
  const config = parseConfig(row.config);
  if (!config.googleTokens) return null;
  try {
    return decryptJson<GoogleTokenSet>(config.googleTokens);
  } catch {
    return null;
  }
}

export async function saveGoogleTokens(
  ctx: TenantContext,
  tokens: GoogleTokenSet,
): Promise<void> {
  const encrypted = encryptJson(tokens);
  for (const type of TOKEN_HOLDER_TYPES) {
    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId: ctx.companyId, type } },
      create: {
        company: { connect: { id: ctx.companyId } },
        type,
        config: { googleTokens: encrypted } as Prisma.InputJsonValue,
      },
      update: {},
    });
    const current = parseConfig(row.config);
    await prisma.integration.update({
      where: { id: row.id },
      data: {
        config: {
          ...current,
          googleTokens: encrypted,
        } as Prisma.InputJsonValue,
      },
    });
  }
}

export async function clearGoogleTokens(ctx: TenantContext): Promise<void> {
  for (const type of TOKEN_HOLDER_TYPES) {
    const row = await prisma.integration.findFirst({
      where: { companyId: ctx.companyId, type },
    });
    if (!row) continue;
    const current = parseConfig(row.config);
    const {
      googleTokens: _removed,
      connectedByClerkUserId: _clerk,
      googleAuthSource: _source,
      ...rest
    } = current;
    await prisma.integration.update({
      where: { id: row.id },
      data: {
        config: rest as Prisma.InputJsonValue,
        status: "NOT_CONNECTED",
        connectedAccount: null,
        errorMessage: null,
      },
    });
  }
}

export async function hasGoogleTokens(ctx: TenantContext): Promise<boolean> {
  const tokens = await getGoogleTokens(ctx);
  return tokens !== null && Boolean(tokens.refreshToken || tokens.accessToken);
}
