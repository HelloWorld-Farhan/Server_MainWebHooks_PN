import { publicIdResolver } from "@/server/services/public-id-resolver.service";
import type { TenantContext } from "@/server/types/context";
import type { CompanyPublicIdentity } from "@/server/lib/public-id/types";
import { PublicResourceType } from "@/server/lib/public-id/types";

export async function getIdentityFromContext(
  ctx: TenantContext,
): Promise<CompanyPublicIdentity> {
  if (ctx.companyPublicIdentity) {
    return ctx.companyPublicIdentity;
  }
  return publicIdResolver.getCompanyPublicIdentity(ctx.companyId);
}

export async function resolveResourceId(
  ctx: TenantContext,
  input: string,
  resourceType: PublicResourceType,
): Promise<string> {
  return publicIdResolver.resolveToInternalId(
    ctx.companyId,
    input,
    resourceType,
  );
}

/**
 * Legacy company-scoped public ID for agents and contacts only.
 * Format: v1.{cli}.{companyCode}.{resourceKey}
 */
export async function toPublicResourceId(
  ctx: TenantContext,
  resourceKey: string,
  identity?: CompanyPublicIdentity,
): Promise<string> {
  const resolvedIdentity = identity ?? (await getIdentityFromContext(ctx));
  return publicIdResolver.toLegacyPublicId(resolvedIdentity, resourceKey);
}

/** Campaign reference public ID: v1.{cli}.{campaignResourceKey} */
export async function toCampaignPublicId(
  ctx: TenantContext,
  campaignResourceKey: string,
  identity?: CompanyPublicIdentity,
): Promise<string> {
  const resolvedIdentity = identity ?? (await getIdentityFromContext(ctx));
  return publicIdResolver.toCampaignPublicId(
    resolvedIdentity,
    campaignResourceKey,
  );
}

export async function toCampaignScopedPublicId(
  ctx: TenantContext,
  campaignInternalId: string | null | undefined,
  entityId: string,
  identity?: CompanyPublicIdentity,
): Promise<string> {
  return publicIdResolver.mapCampaignEntityToPublicId(
    ctx.companyId,
    campaignInternalId,
    entityId,
    identity,
  );
}

export async function mapFkToPublicId(
  ctx: TenantContext,
  internalId: string | null | undefined,
  resourceType: PublicResourceType,
  identity?: CompanyPublicIdentity,
): Promise<string | null> {
  return publicIdResolver.mapInternalIdToPublicId(
    ctx.companyId,
    internalId,
    resourceType,
    identity,
  );
}

export async function mapCampaignScopedFkToPublicId(
  ctx: TenantContext,
  internalId: string | null | undefined,
  campaignInternalId: string | null | undefined,
  resourceType: PublicResourceType,
  identity?: CompanyPublicIdentity,
): Promise<string | null> {
  return publicIdResolver.mapInternalIdToCampaignScopedPublicId(
    ctx.companyId,
    internalId,
    campaignInternalId,
    resourceType as
      | PublicResourceType.CALL_LOG
      | PublicResourceType.PHONE_NUMBER,
    identity,
  );
}

export async function mapFkListToPublicIds(
  ctx: TenantContext,
  internalIds: string[],
  resourceType: PublicResourceType,
  identity?: CompanyPublicIdentity,
): Promise<string[]> {
  return publicIdResolver.mapInternalIdsToPublicIds(
    ctx.companyId,
    internalIds,
    resourceType,
    identity,
  );
}
