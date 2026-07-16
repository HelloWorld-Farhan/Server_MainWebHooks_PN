import {
  CallVolumeRange,
  PrimaryUseCase,
} from "@prisma/client";

export { CallVolumeRange, PrimaryUseCase };

const PRIMARY_USE_CASE_VALUES = new Set<string>(Object.values(PrimaryUseCase));

const CALL_VOLUME_RANGE_VALUES = new Set<string>(Object.values(CallVolumeRange));

/** Legacy Clerk metadata values from before Prisma enum alignment. */
const LEGACY_PRIMARY_USE_CASE: Record<string, PrimaryUseCase> = {
  lead_qualification: PrimaryUseCase.LEAD_QUALIFICATION,
  customer_support: PrimaryUseCase.CUSTOMER_SUPPORT,
  appointment_booking: PrimaryUseCase.APPOINTMENT_BOOKING,
};

/** Legacy Clerk metadata values from before Prisma enum alignment. */
const LEGACY_CALL_VOLUME_RANGE: Record<string, CallVolumeRange> = {
  "1-100": CallVolumeRange.RANGE_1_100,
  "100-500": CallVolumeRange.RANGE_100_500,
  "500-1000": CallVolumeRange.RANGE_500_1000,
  "1000+": CallVolumeRange.RANGE_1000_PLUS,
};

export type UserOnboardingMetadata = {
  onboardingComplete?: boolean;
  companyName?: string;
  primaryUseCase?: PrimaryUseCase;
  callVolume?: CallVolumeRange;
  phone?: string;
};

export function isPrimaryUseCase(value: unknown): value is PrimaryUseCase {
  return typeof value === "string" && PRIMARY_USE_CASE_VALUES.has(value);
}

export function isCallVolumeRange(value: unknown): value is CallVolumeRange {
  return typeof value === "string" && CALL_VOLUME_RANGE_VALUES.has(value);
}

export function parsePrimaryUseCase(
  value: unknown,
): PrimaryUseCase | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (isPrimaryUseCase(value)) {
    return value;
  }
  return LEGACY_PRIMARY_USE_CASE[value];
}

export function parseCallVolumeRange(
  value: unknown,
): CallVolumeRange | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (isCallVolumeRange(value)) {
    return value;
  }
  return LEGACY_CALL_VOLUME_RANGE[value];
}

export function getUserMetadata(
  unsafeMetadata: Record<string, unknown> | undefined,
): UserOnboardingMetadata {
  if (!unsafeMetadata) {
    return {};
  }

  return {
    onboardingComplete: Boolean(unsafeMetadata.onboardingComplete),
    companyName:
      typeof unsafeMetadata.companyName === "string"
        ? unsafeMetadata.companyName
        : undefined,
    primaryUseCase: parsePrimaryUseCase(unsafeMetadata.primaryUseCase),
    callVolume: parseCallVolumeRange(unsafeMetadata.callVolume),
    phone:
      typeof unsafeMetadata.phone === "string" ? unsafeMetadata.phone : undefined,
  };
}

export function formatPrimaryUseCase(useCase?: PrimaryUseCase): string {
  switch (useCase) {
    case PrimaryUseCase.LEAD_QUALIFICATION:
      return "Lead Qualification";
    case PrimaryUseCase.CUSTOMER_SUPPORT:
      return "Customer Support";
    case PrimaryUseCase.APPOINTMENT_BOOKING:
      return "Appointment Booking";
    default:
      return "";
  }
}

export function formatCallVolumeRange(volume?: CallVolumeRange): string {
  switch (volume) {
    case CallVolumeRange.RANGE_1_100:
      return "1–100";
    case CallVolumeRange.RANGE_100_500:
      return "100–500";
    case CallVolumeRange.RANGE_500_1000:
      return "500–1000";
    case CallVolumeRange.RANGE_1000_PLUS:
      return "1000+";
    default:
      return "";
  }
}
