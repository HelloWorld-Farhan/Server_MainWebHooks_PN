import { PublicResourceType } from "./types";

const RESOURCE_PREFIX: Record<
  Exclude<PublicResourceType, PublicResourceType.CALL_LOG>,
  string
> = {
  [PublicResourceType.PHONE_NUMBER]: "PH",
  [PublicResourceType.AGENT]: "AG",
  [PublicResourceType.CONTACT]: "CT",
  [PublicResourceType.CAMPAIGN]: "CP",
};

const PREFIX_TO_RESOURCE_TYPE: Record<string, PublicResourceType> = {
  PH: PublicResourceType.PHONE_NUMBER,
  AG: PublicResourceType.AGENT,
  CT: PublicResourceType.CONTACT,
  CP: PublicResourceType.CAMPAIGN,
};

export function formatResourceKey(
  resourceType: PublicResourceType,
  sequence: number,
): string {
  if (sequence < 1) {
    throw new Error("Resource sequence must be >= 1");
  }

  if (resourceType === PublicResourceType.CALL_LOG) {
    return `CL${String(sequence).padStart(8, "0")}`;
  }

  const prefix = RESOURCE_PREFIX[resourceType];
  return `${prefix}${String(sequence).padStart(6, "0")}`;
}

export function normalizeCallLogEntityId(entityId: string): string {
  const trimmed = entityId.trim();
  if (/^CL\d{8}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{8}$/.test(trimmed)) {
    return `CL${trimmed}`;
  }
  return trimmed;
}

export function inferResourceTypeFromKey(
  resourceKey: string,
): PublicResourceType | null {
  if (/^CL\d{8}$/.test(resourceKey) || /^\d{8}$/.test(resourceKey)) {
    return PublicResourceType.CALL_LOG;
  }

  const prefix = resourceKey.slice(0, 2);
  return PREFIX_TO_RESOURCE_TYPE[prefix] ?? null;
}

export function resourceKeyMatchesType(
  resourceKey: string,
  resourceType: PublicResourceType,
): boolean {
  return inferResourceTypeFromKey(resourceKey) === resourceType;
}
