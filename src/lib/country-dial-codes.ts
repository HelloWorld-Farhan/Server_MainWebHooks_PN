import { normalizeContactPhone } from "@/lib/contact-phone-validation";

export type ContactPhoneCountry = {
  code: string;
  label: string;
  dialCode: string;
};

export const CONTACT_PHONE_COUNTRIES: ContactPhoneCountry[] = [
  { code: "IN", label: "India", dialCode: "91" },
  { code: "US", label: "United States", dialCode: "1" },
  { code: "GB", label: "United Kingdom", dialCode: "44" },
  { code: "AU", label: "Australia", dialCode: "61" },
];

const DIAL_CODE_BY_ISO = new Map(
  CONTACT_PHONE_COUNTRIES.map((c) => [c.code.toUpperCase(), c.dialCode]),
);

const ISO_BY_DIAL_CODE = new Map(
  CONTACT_PHONE_COUNTRIES.map((c) => [c.dialCode, c.code]),
);

const DIAL_CODES_LONGEST_FIRST = [...CONTACT_PHONE_COUNTRIES]
  .map((c) => c.dialCode)
  .sort((a, b) => b.length - a.length);

export const DEFAULT_CONTACT_PHONE_COUNTRY = "IN";

export function resolveDialCode(iso2: string): string | null {
  return DIAL_CODE_BY_ISO.get(iso2.trim().toUpperCase()) ?? null;
}

export function buildStoredContactPhone(
  iso2: string,
  localRaw: string,
): string | null {
  const dialCode = resolveDialCode(iso2);
  if (!dialCode) return null;

  const local = normalizeContactPhone(localRaw);
  if (!local) return null;

  return `${dialCode}${local}`;
}

export function splitStoredContactPhone(
  stored: string,
): { country: string; local: string } | null {
  const digits = stored.replace(/\D/g, "");
  if (!digits) return null;

  for (const dialCode of DIAL_CODES_LONGEST_FIRST) {
    if (!digits.startsWith(dialCode)) continue;

    const local = digits.slice(dialCode.length);
    const iso = ISO_BY_DIAL_CODE.get(dialCode);
    if (!iso || local.length !== 10) continue;

    return { country: iso, local };
  }

  if (digits.length === 10) {
    return { country: "", local: digits };
  }

  return null;
}
