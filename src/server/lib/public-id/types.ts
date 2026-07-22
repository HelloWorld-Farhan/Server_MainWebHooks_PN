export const PUBLIC_ID_VERSION = "v1" as const;

export type PublicIdVersion = typeof PUBLIC_ID_VERSION | "v2";

export enum PublicResourceType {
  CALL_LOG = "CALL_LOG",
  PHONE_NUMBER = "PHONE_NUMBER",
  AGENT = "AGENT",
  CONTACT = "CONTACT",
  CAMPAIGN = "CAMPAIGN",
}

/** Campaign reference public ID: v1.{cli}.{campaignResourceKey} */
export type ParsedCampaignPublicIdV1 = {
  version: typeof PUBLIC_ID_VERSION;
  cli: string;
  campaignResourceKey: string;
};

/** Campaign-scoped entity public ID: v1.{cli}.{campaignId}.{entityId} */
export type ParsedPublicIdV1 = {
  version: typeof PUBLIC_ID_VERSION;
  cli: string;
  campaignId: string;
  entityId: string;
};

/** Legacy company-scoped public ID: v1.{cli}.{companyCode}.{resourceKey} */
export type ParsedLegacyPublicIdV1 = {
  version: typeof PUBLIC_ID_VERSION;
  cli: string;
  companyCode: string;
  resourceKey: string;
};

export type CompanyPublicIdentity = {
  cli: string;
  companyCode: string;
};

export type GenerateCampaignPublicIdInput = {
  cli: string;
  campaignResourceKey: string;
};

export type GeneratePublicIdInput = {
  cli: string;
  campaignId: string;
  entityId: string;
};

export type GenerateLegacyPublicIdInput = CompanyPublicIdentity & {
  resourceKey: string;
};

export const CAMPAIGN_SCOPED_RESOURCE_TYPES = new Set<PublicResourceType>([
  PublicResourceType.CALL_LOG,
  PublicResourceType.PHONE_NUMBER,
]);
