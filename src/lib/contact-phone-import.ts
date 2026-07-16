import {
  buildStoredContactPhone,
  DEFAULT_CONTACT_PHONE_COUNTRY,
  splitStoredContactPhone,
} from "@/lib/country-dial-codes";
import { guessColumnMapping, parseCsv } from "@/lib/csv-import";

export type ParsedContactRecord = {
  phone: string;
  name: string | null;
  email: string | null;
  address: string | null;
  branchNames: string[];
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

function getBranchNames(row: string[], index: number): string[] {
  if (index === -1) return [];
  const raw = row[index] ?? "";
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
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
  const nameIndex =
    mapping.contactName !== null ? headers.indexOf(mapping.contactName) : -1;
  const emailIndex = findColumnIndex(headers, "email", "mail");
  const addressIndex = findColumnIndex(
    headers,
    "address",
    "location",
    "addr",
    "street",
  );
  const branchesIndex = findColumnIndex(headers, "branch", "branches");

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

    const stored = buildStoredContactPhone(countryRaw, rawPhone);
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
      name: getRowValue(row, nameIndex),
      email: getRowValue(row, emailIndex),
      address: getRowValue(row, addressIndex),
      branchNames: getBranchNames(row, branchesIndex),
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

export const CONTACT_PHONES_SAMPLE_CONTENT = `country,phone,name,email,address,branches
IN,9876543210,John Doe,john.doe@example.com,"123 Main St, Mumbai","Downtown Branch"
IN,9123456789,Jane Smith,jane.smith@example.com,"45 Park Ave, Delhi","Downtown Branch,North Branch"
US,5551234567,Alex Rivera,alex.rivera@example.com,"10 Oak Lane, Austin",
GB,7911123456,Maria Chen,maria.chen@example.com,"22 Baker Street, London","North Branch"
AU,4123456789,Sam Wilson,sam.wilson@example.com,"8 Harbour Rd, Sydney",
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
  const lines = ["country,phone"];

  for (const contact of contacts) {
    const split = splitStoredContactPhone(contact.phone);
    if (split) {
      lines.push(`${split.country},${split.local}`);
    } else {
      lines.push(`,${contact.phone}`);
    }
  }

  return lines.join("\n");
}
