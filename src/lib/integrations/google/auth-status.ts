import type { IntegrationType, Prisma } from "@prisma/client";

import {
  getClerkGoogleAccessToken,
  hasRequiredGoogleScopes,
} from "@/lib/integrations/google/clerk-auth";
import { getGoogleTokens, hasGoogleTokens } from "@/lib/integrations/google/token-store";
import prisma from "@/server/lib/prisma";
import type { TenantContext } from "@/server/types/context";

type IntegrationConfig = {
  googleTokens?: string;
  connectedByClerkUserId?: string;
  googleAuthSource?: "clerk" | "oauth";
  [key: string]: unknown;
};

const GOOGLE_TYPES: IntegrationType[] = ["GOOGLE_SHEETS", "GOOGLE_CALENDAR"];

function parseConfig(raw: unknown): IntegrationConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as IntegrationConfig;
}

async function getGoogleIntegrationRow(companyId: string) {
  return prisma.integration.findFirst({
    where: { companyId, type: "GOOGLE_SHEETS" },
  });
}

export async function resolveGoogleClerkUserId(
  ctx: TenantContext,
): Promise<string | null> {
  const row = await getGoogleIntegrationRow(ctx.companyId);
  const config = parseConfig(row?.config);
  return config.connectedByClerkUserId ?? ctx.clerkUserId ?? null;
}

export async function isGoogleIntegrationAuthorized(
  ctx: TenantContext,
): Promise<boolean> {
  const row = await getGoogleIntegrationRow(ctx.companyId);
  if (!row || row.status !== "CONNECTED") {
    return false;
  }

  if (await hasGoogleTokens(ctx)) {
    return true;
  }

  const clerkUserId = await resolveGoogleClerkUserId(ctx);
  if (!clerkUserId) return false;

  const clerkToken = await getClerkGoogleAccessToken(clerkUserId);
  if (!clerkToken) return false;

  return hasRequiredGoogleScopes(clerkToken.scopes);
}

export async function reconcileGoogleIntegrationStatus(
  ctx: TenantContext,
): Promise<void> {
  const authorized = await isGoogleIntegrationAuthorized(ctx);

  for (const type of GOOGLE_TYPES) {
    const row = await prisma.integration.findFirst({
      where: { companyId: ctx.companyId, type },
    });
    if (!row) continue;

    if (authorized) return;

    if (row.status !== "NOT_CONNECTED") {
      const config = parseConfig(row.config);
      await prisma.integration.update({
        where: { id: row.id },
        data: {
          status: "NOT_CONNECTED",
          connectedAccount: null,
          lastSyncAt: null,
          errorMessage: null,
          config: {
            ...config,
            googleAuthSource: undefined,
            connectedByClerkUserId: undefined,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

export async function markGoogleIntegrationsConnected(
  ctx: TenantContext,
  account: string | null,
  authSource: "clerk" | "oauth",
): Promise<void> {
  for (const type of GOOGLE_TYPES) {
    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId: ctx.companyId, type } },
      create: {
        company: { connect: { id: ctx.companyId } },
        type,
        status: "CONNECTED",
        connectedAccount: account,
        lastSyncAt: new Date(),
        config: {
          googleAuthSource: authSource,
          connectedByClerkUserId: ctx.clerkUserId,
        } as Prisma.InputJsonValue,
      },
      update: {},
    });

    const config = parseConfig(row.config);
    await prisma.integration.update({
      where: { id: row.id },
      data: {
        status: "CONNECTED",
        connectedAccount: account,
        lastSyncAt: new Date(),
        errorMessage: null,
        config: {
          ...config,
          googleAuthSource: authSource,
          connectedByClerkUserId: ctx.clerkUserId,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
