import {
  formatResourceKey,
  inferResourceTypeFromKey,
  normalizeCallLogEntityId,
  resourceKeyMatchesType,
} from "./formatters";
import {
  decodeLegacyPublicId,
  generateLegacyPublicId,
  parseLegacyPublicId,
  validateLegacyPublicId,
} from "./legacy";
import {
  PUBLIC_ID_VERSION,
  CAMPAIGN_SCOPED_RESOURCE_TYPES,
  type CompanyPublicIdentity,
  type GenerateCampaignPublicIdInput,
  type GenerateLegacyPublicIdInput,
  type GeneratePublicIdInput,
  type ParsedCampaignPublicIdV1,
  type ParsedLegacyPublicIdV1,
  type ParsedPublicIdV1,
  type PublicIdVersion,
  PublicResourceType,
} from "./types";

export {
  PUBLIC_ID_VERSION,
  PublicResourceType,
  CAMPAIGN_SCOPED_RESOURCE_TYPES,
  type CompanyPublicIdentity,
  type GenerateCampaignPublicIdInput,
  type GenerateLegacyPublicIdInput,
  type GeneratePublicIdInput,
  type ParsedCampaignPublicIdV1,
  type ParsedLegacyPublicIdV1,
  type ParsedPublicIdV1,
  type PublicIdVersion,
};
export {
  formatResourceKey,
  inferResourceTypeFromKey,
  normalizeCallLogEntityId,
  resourceKeyMatchesType,
};
export {
  decodeLegacyPublicId,
  generateLegacyPublicId,
  parseLegacyPublicId,
  validateLegacyPublicId,
};

export class UnsupportedPublicIdVersionError extends Error {
  constructor(version: string) {
    super(`Unsupported public ID version: ${version}`);
    this.name = "UnsupportedPublicIdVersionError";
  }
}

const V1_CAMPAIGN_PUBLIC_ID_PATTERN = /^v1\.([A-Z]{2,5})\.(CP\d{6})$/;
const V1_CAMPAIGN_SCOPED_PUBLIC_ID_PATTERN =
  /^v1\.([A-Z]{2,5})\.(CP\d{6})\.(.+)$/;

export function generateCampaignPublicId(
  input: GenerateCampaignPublicIdInput,
): string {
  const { cli, campaignResourceKey } = input;
  return `${PUBLIC_ID_VERSION}.${cli}.${campaignResourceKey}`;
}

export function parseCampaignPublicId(
  input: string,
): ParsedCampaignPublicIdV1 | null {
  const trimmed = input.trim();
  const match = trimmed.match(V1_CAMPAIGN_PUBLIC_ID_PATTERN);
  if (!match) {
    return null;
  }

  return {
    version: PUBLIC_ID_VERSION,
    cli: match[1],
    campaignResourceKey: match[2],
  };
}

export function validateCampaignPublicId(input: string): boolean {
  if (getVersion(input) === "v2") {
    return false;
  }
  return parseCampaignPublicId(input) !== null;
}

export function decodeCampaignPublicId(
  input: string,
): ParsedCampaignPublicIdV1 {
  const version = getVersion(input);
  if (version === "v2") {
    throw new UnsupportedPublicIdVersionError("v2");
  }

  const parsed = parseCampaignPublicId(input);
  if (!parsed) {
    throw new Error("Invalid campaign public ID format");
  }

  return parsed;
}

export function generatePublicId(input: GeneratePublicIdInput): string {
  const { cli, campaignId, entityId } = input;
  return `${PUBLIC_ID_VERSION}.${cli}.${campaignId}.${entityId}`;
}

export function parsePublicId(input: string): ParsedPublicIdV1 | null {
  const trimmed = input.trim();
  const match = trimmed.match(V1_CAMPAIGN_SCOPED_PUBLIC_ID_PATTERN);
  if (!match) {
    return null;
  }

  return {
    version: PUBLIC_ID_VERSION,
    cli: match[1],
    campaignId: match[2],
    entityId: match[3],
  };
}

export function getVersion(input: string): PublicIdVersion | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("v1.")) {
    return PUBLIC_ID_VERSION;
  }
  if (trimmed.startsWith("v2.")) {
    return "v2";
  }
  return null;
}

export function validatePublicId(
  input: string,
  expectedResourceType?: PublicResourceType,
): boolean {
  const version = getVersion(input);
  if (version === "v2") {
    return false;
  }

  const parsed = parsePublicId(input);
  if (!parsed) {
    return false;
  }

  if (!expectedResourceType) {
    return true;
  }

  return resourceKeyMatchesType(parsed.entityId, expectedResourceType);
}

export function decodePublicId(input: string): ParsedPublicIdV1 {
  const version = getVersion(input);
  if (version === "v2") {
    throw new UnsupportedPublicIdVersionError("v2");
  }

  const parsed = parsePublicId(input);
  if (!parsed) {
    throw new Error("Invalid public ID format");
  }

  return parsed;
}

const LEGACY_OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export function isLegacyObjectId(input: string): boolean {
  return LEGACY_OBJECT_ID_PATTERN.test(input.trim());
}

export function looksLikePublicId(input: string): boolean {
  return getVersion(input) !== null;
}
