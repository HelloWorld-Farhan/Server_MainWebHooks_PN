import { resourceKeyMatchesType } from "./formatters";
import {
  PUBLIC_ID_VERSION,
  type GenerateLegacyPublicIdInput,
  type ParsedLegacyPublicIdV1,
  type PublicResourceType,
} from "./types";

const LEGACY_V1_PUBLIC_ID_PATTERN =
  /^v1\.([A-Z]{2,5})\.([A-Z0-9]{6})\.(.+)$/;

/** Campaign IDs use a CP prefix; company codes do not. */
const CAMPAIGN_ID_SEGMENT_PATTERN = /^CP\d{6}$/;

export function generateLegacyPublicId(
  input: GenerateLegacyPublicIdInput,
): string {
  const { cli, companyCode, resourceKey } = input;
  return `${PUBLIC_ID_VERSION}.${cli}.${companyCode}.${resourceKey}`;
}

export function parseLegacyPublicId(
  input: string,
): ParsedLegacyPublicIdV1 | null {
  const trimmed = input.trim();
  const match = trimmed.match(LEGACY_V1_PUBLIC_ID_PATTERN);
  if (!match) {
    return null;
  }

  if (CAMPAIGN_ID_SEGMENT_PATTERN.test(match[2])) {
    return null;
  }

  return {
    version: PUBLIC_ID_VERSION,
    cli: match[1],
    companyCode: match[2],
    resourceKey: match[3],
  };
}

export function validateLegacyPublicId(
  input: string,
  expectedResourceType?: PublicResourceType,
): boolean {
  const parsed = parseLegacyPublicId(input);
  if (!parsed) {
    return false;
  }

  if (!expectedResourceType) {
    return true;
  }

  return resourceKeyMatchesType(parsed.resourceKey, expectedResourceType);
}

export function decodeLegacyPublicId(input: string): ParsedLegacyPublicIdV1 {
  const parsed = parseLegacyPublicId(input);
  if (!parsed) {
    throw new Error("Invalid legacy public ID format");
  }

  return parsed;
}
