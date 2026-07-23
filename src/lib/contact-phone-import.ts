import {
  buildStoredContactPhone,
  DEFAULT_CONTACT_PHONE_COUNTRY,
  splitStoredContactPhone,
} from "@/lib/country-dial-codes";
import { normalizeStoredContactPhone } from "@/lib/contact-phone-validation";
import { guessColumnMapping, parseCsv } from "@/lib/csv-import";

export type ParsedContactRecord = {
  phone: string;
  field1: string | null;
  field2: string | null;
  field3: string | null;
  campaignNames: string[];
};

export type ParsedPhoneImport = {
  contacts: ParsedContactRecord[];
  invalid: number;
};

export type ParsePhonesOptions = {
  defaultCountry?: string;
};

export const CONTACT_PHONE_UPLOAD_EXTENSIONS = [
  ".csv",
  ".xlsx",
  ".xls",
  ".pdf",
  ".docx",
] as const;

export function getContactPhoneUploadExtension(
  filename: string,
): string | null {
  const lower = filename.toLowerCase();
  return (
    CONTACT_PHONE_UPLOAD_EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? null
  );
}

export function isSupportedContactPhoneUpload(filename: string): boolean {
  return getContactPhoneUploadExtension(filename) !== null;
}

function findColumnIndex(headers: string[], ...candidates: string[]): number {
  const normalized = headers.map((header) =>
    header.toLowerCase().replace(/[\s_-]+/g, ""),
  );

  for (let index = 0; index < normalized.length; index++) {
    if (candidates.some((candidate) => normalized[index].includes(candidate))) {
      return index;
    }
  }

  return -1;
}

function getRowValue(row: string[], index: number): string | null {
  if (index === -1) return null;
  const value = (row[index] ?? "").trim();
  return value.length > 0 ? value : null;
}

function getCampaignNames(row: string[], index: number): string[] {
  if (index === -1) return [];
  const raw = row[index] ?? "";
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function normalizePhoneValue(rawPhone: string, countryRaw: string): string | null {
  const stored = buildStoredContactPhone(countryRaw, rawPhone);
  if (stored) return stored;

  const digits = rawPhone.trim().replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length > 10) {
    const fromLocal = buildStoredContactPhone(countryRaw, digits.slice(-10));
    if (fromLocal) return fromLocal;
  }

  return normalizeStoredContactPhone(digits);
}

export function parsePhonesFromStructuredRows(
  headers: string[],
  rows: string[][],
  options: ParsePhonesOptions = {},
): ParsedPhoneImport {
  if (headers.length === 0 || rows.length === 0) {
    return { contacts: [], invalid: 0 };
  }

  const mapping = guessColumnMapping(headers);
  const phoneColumn = mapping.phoneNumber;
  const countryColumn = mapping.country;
  const defaultCountry = options.defaultCountry ?? DEFAULT_CONTACT_PHONE_COUNTRY;

  if (!phoneColumn) {
    return { contacts: [], invalid: rows.length };
  }

  const phoneIndex = headers.indexOf(phoneColumn);
  if (phoneIndex === -1) {
    return { contacts: [], invalid: rows.length };
  }

  const countryIndex =
    countryColumn !== null ? headers.indexOf(countryColumn) : -1;
  const hasCountryColumn = countryIndex !== -1;
  const field1Index = findColumnIndex(
    headers,
    "username",
    "contactname",
    "fullname",
    "name",
  );
  const field2Index = findColumnIndex(headers, "recordingurl", "recording");
  const field3Index = findColumnIndex(headers, "transcript", "transcripts");
  const campaignsIndex = findColumnIndex(headers, "campaign", "campaigns");

  const seen = new Set<string>();
  const contacts: ParsedContactRecord[] = [];
  let invalid = 0;

  for (const row of rows) {
    const rawPhone = (row[phoneIndex] ?? "").trim();
    if (!rawPhone) {
      invalid++;
      continue;
    }

    const countryRaw = hasCountryColumn
      ? (row[countryIndex] ?? "").trim()
      : defaultCountry;

    if (!countryRaw) {
      invalid++;
      continue;
    }

    const stored = normalizePhoneValue(rawPhone, countryRaw);
    if (!stored) {
      invalid++;
      continue;
    }

    if (seen.has(stored)) {
      continue;
    }
    seen.add(stored);
    contacts.push({
      phone: stored,
      field1: getRowValue(row, field1Index),
      field2: getRowValue(row, field2Index),
      field3: getRowValue(row, field3Index),
      campaignNames: getCampaignNames(row, campaignsIndex),
    });
  }

  return { contacts, invalid };
}

export function parsePhonesFromCsv(
  text: string,
  options: ParsePhonesOptions = {},
): ParsedPhoneImport {
  const parsed = parseCsv(text);
  return parsePhonesFromStructuredRows(parsed.headers, parsed.rows, options);
}

export async function parsePhonesFromUploadFile(
  file: File,
  options: ParsePhonesOptions = {},
): Promise<ParsedPhoneImport> {
  const extension = getContactPhoneUploadExtension(file.name);
  if (!extension) {
    throw new Error(
      "Unsupported file type. Upload CSV, Excel (.xlsx/.xls), PDF, or Word (.docx).",
    );
  }

  if (extension === ".csv") {
    const text = await file.text();
    return parsePhonesFromCsv(text, options);
  }

  const formData = new FormData();
  formData.append("file", file);
  if (options.defaultCountry) {
    formData.append("defaultCountry", options.defaultCountry);
  }

  const response = await fetch("/api/contact-phones/parse-upload", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json()) as {
    contacts?: ParsedContactRecord[];
    invalid?: number;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to parse the uploaded file.");
  }

  return {
    contacts: payload.contacts ?? [],
    invalid: payload.invalid ?? 0,
  };
}

export const CONTACT_PHONES_SAMPLE_FILENAME = "propnex-phone-contacts-sample.csv";

export const CONTACT_PHONES_SAMPLE_CONTENT = `MSISDN,user_name,Recording URL,Transcripts
9876543210,John Doe,https://example.com/recording/1,"Hello, this is a sample transcript."
9123456789,Jane Smith,https://example.com/recording/2,"Another sample transcript."
5551234567,Alex Rivera,,
7911123456,Maria Chen,https://example.com/recording/3,"London contact transcript."
`;

export function downloadContactPhonesSampleCsv(): void {
  const blob = new Blob([CONTACT_PHONES_SAMPLE_CONTENT], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = CONTACT_PHONES_SAMPLE_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

export function contactsToCsv(
  contacts: { phone: string }[],
): string {
  const lines = ["MSISDN"];

  for (const contact of contacts) {
    const split = splitStoredContactPhone(contact.phone);
    if (split) {
      lines.push(`${split.local}`);
    } else {
      lines.push(contact.phone);
    }
  }

  return lines.join("\n");
}
