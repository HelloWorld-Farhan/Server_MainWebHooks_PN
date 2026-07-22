const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function normalizeE164Phone(raw: string): string | null {
  const trimmed = raw.trim();
  return E164_REGEX.test(trimmed) ? trimmed : null;
}

export function isValidE164Phone(value: string): boolean {
  return normalizeE164Phone(value) !== null;
}
