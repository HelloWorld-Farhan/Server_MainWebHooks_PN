import prisma from "@/server/lib/prisma";
import {
  decodeLegacyPublicId,
  decodePublicId,
  generateCampaignPublicId,
  generateLegacyPublicId,
  generatePublicId,
  isLegacyObjectId,
  looksLikePublicId,
  normalizeCallLogEntityId,
  parseCampaignPublicId,
  parseLegacyPublicId,
  parsePublicId,
  resourceKeyMatchesType,
} from "@/server/lib/public-id";
import {
  CAMPAIGN_SCOPED_RESOURCE_TYPES,
  type CompanyPublicIdentity,
  PublicResourceType,
} from "@/server/lib/public-id/types";
import { NotFoundError, ValidationError } from "@/server/lib/errors";

type LegacyResourceModel = {
  findByKey: (
    companyId: string,
    resourceKey: string,
  ) => Promise<{ id: string } | null>;
  findKeyById: (
    companyId: string,
    id: string,
  ) => Promise<{ resourceKey: string } | null>;
};

type CampaignScopedEntityRow = {
  entityId: string;
  publicId: string | null;
  campaignId: string | null;
  campaign: { resourceKey: string } | null;
};

type CampaignScopedResourceModel = {
  findByPublicId: (
    companyId: string,
    publicId: string,
  ) => Promise<{ id: string } | null>;
  findByCampaignAndEntity: (
    companyId: string,
    campaignResourceKey: string,
    entityId: string,
  ) => Promise<{ id: string } | null>;
  findEntityById: (
    companyId: string,
    id: string,
  ) => Promise<CampaignScopedEntityRow | null>;
};

function normalizeEntityIdForLookup(
  entityId: string,
  resourceType: PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER,
): string {
  if (resourceType === PublicResourceType.CALL_LOG) {
    return normalizeCallLogEntityId(entityId);
  }
  return entityId;
}

const LEGACY_RESOURCE_MODEL: Record<
  Exclude<
    PublicResourceType,
    PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER
  >,
  LegacyResourceModel
> = {
  [PublicResourceType.AGENT]: {
    findByKey: (companyId, resourceKey) =>
      prisma.aiAgent.findFirst({
        where: { companyId, resourceKey },
        select: { id: true },
      }),
    findKeyById: (companyId, id) =>
      prisma.aiAgent.findFirst({
        where: { companyId, id },
        select: { resourceKey: true },
      }),
  },
  [PublicResourceType.CONTACT]: {
    findByKey: (companyId, resourceKey) =>
      prisma.uploadedContact.findFirst({
        where: { companyId, resourceKey },
        select: { id: true },
      }),
    findKeyById: (companyId, id) =>
      prisma.uploadedContact.findFirst({
        where: { companyId, id },
        select: { resourceKey: true },
      }),
  },
  [PublicResourceType.CAMPAIGN]: {
    findByKey: (companyId, resourceKey) =>
      prisma.campaign.findFirst({
        where: { companyId, resourceKey },
        select: { id: true },
      }),
    findKeyById: (companyId, id) =>
      prisma.campaign.findFirst({
        where: { companyId, id },
        select: { resourceKey: true },
      }),
  },
};

const CAMPAIGN_SCOPED_RESOURCE_MODEL: Record<
  PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER,
  CampaignScopedResourceModel
> = {
  [PublicResourceType.CALL_LOG]: {
    findByPublicId: (companyId, publicId) =>
      prisma.callLog.findFirst({
        where: { companyId, publicId },
        select: { id: true },
      }),
    findByCampaignAndEntity: (companyId, campaignResourceKey, entityId) =>
      prisma.callLog.findFirst({
        where: {
          companyId,
          callLogId: normalizeCallLogEntityId(entityId),
          campaign: { resourceKey: campaignResourceKey },
        },
        select: { id: true },
      }),
    findEntityById: (companyId, id) =>
      prisma.callLog.findFirst({
        where: { companyId, id },
        select: {
          callLogId: true,
          publicId: true,
          campaignId: true,
          campaign: { select: { resourceKey: true } },
        },
      }).then((row) =>
        row
          ? {
              entityId: row.callLogId,
              publicId: row.publicId,
              campaignId: row.campaignId,
              campaign: row.campaign,
            }
          : null,
      ),
  },
  [PublicResourceType.PHONE_NUMBER]: {
    findByPublicId: (companyId, publicId) =>
      prisma.phoneNumber.findFirst({
        where: { companyId, publicId },
        select: { id: true },
      }),
    findByCampaignAndEntity: (companyId, campaignResourceKey, entityId) =>
      prisma.phoneNumber.findFirst({
        where: {
          companyId,
          phoneNumberId: entityId,
          OR: [
            {
              campaign: { resourceKey: campaignResourceKey },
            },
            {
              inboundAgent: {
                campaign: { resourceKey: campaignResourceKey },
              },
            },
            {
              outboundAgent: {
                campaign: { resourceKey: campaignResourceKey },
              },
            },
          ],
        },
        select: { id: true },
      }),
    findEntityById: (companyId, id) =>
      prisma.phoneNumber
        .findFirst({
          where: { companyId, id },
          select: {
            phoneNumberId: true,
            publicId: true,
            campaignId: true,
            campaign: { select: { resourceKey: true } },
            inboundAgent: {
              select: {
                campaignId: true,
                campaign: { select: { resourceKey: true } },
              },
            },
            outboundAgent: {
              select: {
                campaignId: true,
                campaign: { select: { resourceKey: true } },
              },
            },
          },
        })
        .then((row) => {
          if (!row) return null;
          const campaign =
            row.campaign ??
            row.inboundAgent?.campaign ??
            row.outboundAgent?.campaign ??
            null;
          const campaignId =
            row.campaignId ??
            row.inboundAgent?.campaignId ??
            row.outboundAgent?.campaignId ??
            null;
          return {
            entityId: row.phoneNumberId,
            publicId: row.publicId,
            campaignId,
            campaign,
          };
        }),
  },
};

const companyIdentityCache = new Map<string, CompanyPublicIdentity>();

export class PublicIdResolverService {
  clearCompanyIdentityCache(companyId?: string) {
    if (companyId) {
      companyIdentityCache.delete(companyId);
      return;
    }
    companyIdentityCache.clear();
  }

  async getCompanyPublicIdentity(
    companyId: string,
  ): Promise<CompanyPublicIdentity> {
    const cached = companyIdentityCache.get(companyId);
    if (cached) {
      return cached;
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { cli: true, companyCode: true },
    });

    if (!company?.cli || !company.companyCode) {
      throw new ValidationError("Company public identity is not configured");
    }

    const identity = {
      cli: company.cli,
      companyCode: company.companyCode,
    };
    companyIdentityCache.set(companyId, identity);
    return identity;
  }

  async getCampaignResourceKey(
    companyId: string,
    campaignInternalId: string,
  ): Promise<string> {
    const campaign = await prisma.campaign.findFirst({
      where: { companyId, id: campaignInternalId },
      select: { resourceKey: true },
    });
    if (!campaign?.resourceKey) {
      throw new NotFoundError("Campaign not found");
    }
    return campaign.resourceKey;
  }

  toCampaignPublicId(
    identity: CompanyPublicIdentity,
    campaignResourceKey: string,
  ): string {
    return generateCampaignPublicId({
      cli: identity.cli,
      campaignResourceKey,
    });
  }

  toLegacyPublicId(
    identity: CompanyPublicIdentity,
    resourceKey: string,
  ): string {
    return generateLegacyPublicId({
      cli: identity.cli,
      companyCode: identity.companyCode,
      resourceKey,
    });
  }

  toPublicId(
    identity: CompanyPublicIdentity,
    campaignId: string,
    entityId: string,
  ): string {
    return generatePublicId({
      cli: identity.cli,
      campaignId,
      entityId,
    });
  }

  async mapCampaignEntityToPublicId(
    companyId: string,
    campaignInternalId: string | null | undefined,
    entityId: string,
    identity?: CompanyPublicIdentity,
  ): Promise<string> {
    if (!campaignInternalId) {
      throw new ValidationError("Campaign is required for public ID");
    }

    const resolvedIdentity =
      identity ?? (await this.getCompanyPublicIdentity(companyId));
    const campaignResourceKey = await this.getCampaignResourceKey(
      companyId,
      campaignInternalId,
    );
    return this.toPublicId(resolvedIdentity, campaignResourceKey, entityId);
  }

  async mapResourceKeyToLegacyPublicId(
    companyId: string,
    resourceKey: string,
    identity?: CompanyPublicIdentity,
  ): Promise<string> {
    const resolvedIdentity =
      identity ?? (await this.getCompanyPublicIdentity(companyId));
    return this.toLegacyPublicId(resolvedIdentity, resourceKey);
  }

  async mapInternalIdToPublicId(
    companyId: string,
    internalId: string | null | undefined,
    resourceType: PublicResourceType,
    identity?: CompanyPublicIdentity,
  ): Promise<string | null> {
    if (!internalId) {
      return null;
    }

    if (CAMPAIGN_SCOPED_RESOURCE_TYPES.has(resourceType)) {
      return this.mapInternalIdToCampaignScopedPublicId(
        companyId,
        internalId,
        undefined,
        resourceType as
          | PublicResourceType.CALL_LOG
          | PublicResourceType.PHONE_NUMBER,
        identity,
      );
    }

    const row = await LEGACY_RESOURCE_MODEL[resourceType].findKeyById(
      companyId,
      internalId,
    );
    if (!row?.resourceKey) {
      throw new NotFoundError("Resource not found");
    }

    if (resourceType === PublicResourceType.CAMPAIGN) {
      const resolvedIdentity =
        identity ?? (await this.getCompanyPublicIdentity(companyId));
      return this.toCampaignPublicId(resolvedIdentity, row.resourceKey);
    }

    return this.mapResourceKeyToLegacyPublicId(
      companyId,
      row.resourceKey,
      identity,
    );
  }

  async mapInternalIdToCampaignScopedPublicId(
    companyId: string,
    internalId: string | null | undefined,
    campaignInternalId: string | null | undefined,
    resourceType: PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER,
    identity?: CompanyPublicIdentity,
  ): Promise<string | null> {
    if (!internalId) {
      return null;
    }

    const row = await CAMPAIGN_SCOPED_RESOURCE_MODEL[
      resourceType
    ].findEntityById(companyId, internalId);
    if (!row?.entityId) {
      throw new NotFoundError("Resource not found");
    }

    if (row.publicId) {
      return row.publicId;
    }

    const resolvedIdentity =
      identity ?? (await this.getCompanyPublicIdentity(companyId));

    if (campaignInternalId) {
      const campaignResourceKey = await this.getCampaignResourceKey(
        companyId,
        campaignInternalId,
      );
      return this.toPublicId(
        resolvedIdentity,
        campaignResourceKey,
        row.entityId,
      );
    }

    if (!row.campaignId || !row.campaign?.resourceKey) {
      throw new ValidationError(
        "Campaign context is required for campaign-scoped public ID",
      );
    }

    return this.toPublicId(
      resolvedIdentity,
      row.campaign.resourceKey,
      row.entityId,
    );
  }

  async mapInternalIdsToPublicIds(
    companyId: string,
    internalIds: string[],
    resourceType: PublicResourceType,
    identity?: CompanyPublicIdentity,
  ): Promise<string[]> {
    if (internalIds.length === 0) {
      return [];
    }

    const resolvedIdentity =
      identity ?? (await this.getCompanyPublicIdentity(companyId));

    const keys = await Promise.all(
      internalIds.map((id) =>
        this.mapInternalIdToPublicId(
          companyId,
          id,
          resourceType,
          resolvedIdentity,
        ),
      ),
    );

    return keys.filter((id): id is string => id !== null);
  }

  async resolveToInternalId(
    companyId: string,
    input: string,
    resourceType: PublicResourceType,
  ): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new ValidationError("ID is required");
    }

    if (CAMPAIGN_SCOPED_RESOURCE_TYPES.has(resourceType)) {
      return this.resolveCampaignScopedToInternalId(
        companyId,
        trimmed,
        resourceType as
          | PublicResourceType.CALL_LOG
          | PublicResourceType.PHONE_NUMBER,
      );
    }

    return this.resolveLegacyToInternalId(
      companyId,
      trimmed,
      resourceType as Exclude<
        PublicResourceType,
        PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER
      >,
    );
  }

  private async resolveCampaignScopedToInternalId(
    companyId: string,
    input: string,
    resourceType: PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER,
  ): Promise<string> {
    const model = CAMPAIGN_SCOPED_RESOURCE_MODEL[resourceType];

    if (looksLikePublicId(input)) {
      const campaignParsed = parsePublicId(input);
      if (campaignParsed) {
        if (!resourceKeyMatchesType(campaignParsed.entityId, resourceType)) {
          throw new ValidationError(
            "Public ID does not match expected resource type",
          );
        }

        const identity = await this.getCompanyPublicIdentity(companyId);
        if (campaignParsed.cli !== identity.cli) {
          throw new NotFoundError("Resource not found");
        }

        const byPublicId = await model.findByPublicId(companyId, input);
        if (byPublicId) {
          return byPublicId.id;
        }

        const entityId = normalizeEntityIdForLookup(
          campaignParsed.entityId,
          resourceType,
        );
        const row = await model.findByCampaignAndEntity(
          companyId,
          campaignParsed.campaignId,
          entityId,
        );
        if (!row) {
          throw new NotFoundError("Resource not found");
        }
        return row.id;
      }

      const legacyParsed = parseLegacyPublicId(input);
      if (legacyParsed) {
        if (!resourceKeyMatchesType(legacyParsed.resourceKey, resourceType)) {
          throw new ValidationError(
            "Public ID does not match expected resource type",
          );
        }

        console.warn(
          "[public-id:deprecated] Legacy company-scoped entity public ID format used; migrate to v1.<CLI>.<CP######>.<ENTITY>",
          { input, resourceType },
        );

        const identity = await this.getCompanyPublicIdentity(companyId);
        if (
          legacyParsed.cli !== identity.cli ||
          legacyParsed.companyCode !== identity.companyCode
        ) {
          throw new NotFoundError("Resource not found");
        }

        const entityId = normalizeEntityIdForLookup(
          legacyParsed.resourceKey,
          resourceType,
        );
        const row = await this.findLegacyCompanyScopedEntity(
          companyId,
          entityId,
          resourceType,
        );
        if (!row) {
          throw new NotFoundError("Resource not found");
        }
        return row.id;
      }
    }

    if (isLegacyObjectId(input)) {
      const row = await model.findEntityById(companyId, input);
      if (!row) {
        throw new NotFoundError("Resource not found");
      }
      return input;
    }

    throw new ValidationError("Invalid public ID format");
  }

  private async findLegacyCompanyScopedEntity(
    companyId: string,
    entityId: string,
    resourceType: PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER,
  ): Promise<{ id: string } | null> {
    if (resourceType === PublicResourceType.CALL_LOG) {
      return prisma.callLog.findFirst({
        where: { companyId, callLogId: entityId },
        select: { id: true },
      });
    }

    return prisma.phoneNumber.findFirst({
      where: { companyId, phoneNumberId: entityId },
      select: { id: true },
    });
  }

  private async resolveLegacyToInternalId(
    companyId: string,
    input: string,
    resourceType: Exclude<
      PublicResourceType,
      PublicResourceType.CALL_LOG | PublicResourceType.PHONE_NUMBER
    >,
  ): Promise<string> {
    if (looksLikePublicId(input)) {
      if (resourceType === PublicResourceType.CAMPAIGN) {
        return this.resolveCampaignPublicIdToInternalId(companyId, input);
      }

      const parsed = decodeLegacyPublicId(input);
      if (!resourceKeyMatchesType(parsed.resourceKey, resourceType)) {
        throw new ValidationError(
          "Public ID does not match expected resource type",
        );
      }

      const identity = await this.getCompanyPublicIdentity(companyId);
      if (
        parsed.cli !== identity.cli ||
        parsed.companyCode !== identity.companyCode
      ) {
        throw new NotFoundError("Resource not found");
      }

      const row = await LEGACY_RESOURCE_MODEL[resourceType].findByKey(
        companyId,
        parsed.resourceKey,
      );
      if (!row) {
        throw new NotFoundError("Resource not found");
      }
      return row.id;
    }

    if (isLegacyObjectId(input)) {
      const row = await LEGACY_RESOURCE_MODEL[resourceType].findKeyById(
        companyId,
        input,
      );
      if (!row) {
        throw new NotFoundError("Resource not found");
      }
      return input;
    }

    throw new ValidationError("Invalid public ID format");
  }

  private async resolveCampaignPublicIdToInternalId(
    companyId: string,
    input: string,
  ): Promise<string> {
    const campaignParsed = parseCampaignPublicId(input);
    if (campaignParsed) {
      const identity = await this.getCompanyPublicIdentity(companyId);
      if (campaignParsed.cli !== identity.cli) {
        throw new NotFoundError("Resource not found");
      }

      const row = await LEGACY_RESOURCE_MODEL[PublicResourceType.CAMPAIGN].findByKey(
        companyId,
        campaignParsed.campaignResourceKey,
      );
      if (!row) {
        throw new NotFoundError("Resource not found");
      }
      return row.id;
    }

    const legacyParsed = parseLegacyPublicId(input);
    if (
      legacyParsed &&
      resourceKeyMatchesType(legacyParsed.resourceKey, PublicResourceType.CAMPAIGN)
    ) {
      console.warn(
        "[public-id:deprecated] Legacy campaign public ID format used; migrate to v1.<CLI>.<CP######>",
        { input },
      );

      const identity = await this.getCompanyPublicIdentity(companyId);
      if (
        legacyParsed.cli !== identity.cli ||
        legacyParsed.companyCode !== identity.companyCode
      ) {
        throw new NotFoundError("Resource not found");
      }

      const row = await LEGACY_RESOURCE_MODEL[PublicResourceType.CAMPAIGN].findByKey(
        companyId,
        legacyParsed.resourceKey,
      );
      if (!row) {
        throw new NotFoundError("Resource not found");
      }
      return row.id;
    }

    throw new ValidationError("Invalid public ID format");
  }

  tryParsePublicId(input: string) {
    return (
      parsePublicId(input) ??
      parseCampaignPublicId(input) ??
      parseLegacyPublicId(input)
    );
  }
}

export const publicIdResolver = new PublicIdResolverService();
