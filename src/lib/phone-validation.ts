import { normalizeStoredContactPhone } from "@/lib/contact-phone-validation";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function normalizeE164Phone(raw: string): string | null {
  const trimmed = raw.trim();
  return E164_REGEX.test(trimmed) ? trimmed : null;
}

/** Accept E.164 or stored uploaded-contact digits (e.g. 919899077142). */
export function normalizeOutboundPhone(raw: string): string | null {
  const e164 = normalizeE164Phone(raw);
  if (e164) {
    return e164;
  }

  const stored = normalizeStoredContactPhone(raw);
  if (stored) {
    return `+${stored}`;
  }

  return null;
}

export function isValidE164Phone(value: string): boolean {
  return normalizeE164Phone(value) !== null;
}
