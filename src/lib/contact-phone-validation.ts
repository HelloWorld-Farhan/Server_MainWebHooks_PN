import { splitStoredContactPhone } from "@/lib/country-dial-codes";

const CONTACT_PHONE_REGEX = /^\d{10}$/;

export function normalizeContactPhone(raw: string): string | null {
  const digits = raw.trim().replace(/\D/g, "");
  return CONTACT_PHONE_REGEX.test(digits) ? digits : null;
}

export function isValidContactPhone(value: string): boolean {
  return normalizeContactPhone(value) !== null;
}

export function normalizeStoredContactPhone(raw: string): string | null {
  const digits = raw.trim().replace(/\D/g, "");
  if (!digits) return null;

  const split = splitStoredContactPhone(digits);
  if (!split) return null;

  return digits;
}

export function isValidStoredContactPhone(value: string): boolean {
  return normalizeStoredContactPhone(value) !== null;
}
