export type CsvFieldKey = "contactName" | "phoneNumber" | "agentId" | "country";

export type ColumnMapping = Record<CsvFieldKey, string | null>;

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

export type PreviewRow = {
  index: number;
  cells: Record<string, string>;
  phoneInvalid: boolean;
};

export const CSV_FIELD_LABELS: Record<CsvFieldKey, string> = {
  contactName: "Contact Name",
  phoneNumber: "Phone Number",
  agentId: "Agent ID (Optional)",
  country: "Country",
};

export const SAMPLE_CSV_FILENAME = "propnex-contacts-sample.csv";

export const SAMPLE_CSV_CONTENT = `full_name,phone_e164,email,agent_id
John Smith,+15550123456,john.smith@example.com,
Jane Doe,+15550987654,jane.doe@example.com,agent-001
K-2SO,999-999-invalid,invalid@example.com,
Alex Rivera,+447911123456,alex.rivera@example.com,agent-002
Maria Chen,+61412345678,maria.chen@example.com,
Sam Wilson,+15551234567,sam.wilson@example.com,agent-001
`;

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(stripQuotes(current.trim()));
        current = "";
      } else {
        current += char;
      }
    }

    result.push(stripQuotes(current.trim()));
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);

  return { headers, rows };
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value;
}

export function isValidE164Phone(value: string): boolean {
  return E164_REGEX.test(value.trim());
}

export function guessColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((header) => ({
    original: header,
    key: header.toLowerCase().replace(/[\s_-]+/g, ""),
  }));

  const findHeader = (...candidates: string[]) => {
    const match = normalized.find((header) =>
      candidates.some((candidate) => header.key.includes(candidate)),
    );
    return match?.original ?? null;
  };

  return {
    contactName: findHeader("fullname", "contactname", "name"),
    phoneNumber: findHeader("phonee164", "phone", "mobile", "tel"),
    agentId: findHeader("agentid", "agent"),
    country: findHeader("country", "countrycode", "iso"),
  };
}

export function buildPreviewRows(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  limit = 10,
): PreviewRow[] {
  const { headers, rows } = parsed;

  return rows.slice(0, limit).map((row, rowIndex) => {
    const cells: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      cells[header] = row[columnIndex] ?? "";
    });

    const phoneColumn = mapping.phoneNumber;
    const phoneValue = phoneColumn ? cells[phoneColumn] ?? "" : "";

    return {
      index: rowIndex + 1,
      cells,
      phoneInvalid: phoneValue.length > 0 && !isValidE164Phone(phoneValue),
    };
  });
}

export function countValidRecords(parsed: ParsedCsv, mapping: ColumnMapping): number {
  if (!mapping.phoneNumber) {
    return parsed.rows.length;
  }

  return parsed.rows.filter((row) => {
    const phoneIndex = parsed.headers.indexOf(mapping.phoneNumber!);
    if (phoneIndex === -1) {
      return false;
    }
    const phone = row[phoneIndex] ?? "";
    return phone.length > 0 && isValidE164Phone(phone);
  }).length;
}

export function downloadSampleCsv(): void {
  const blob = new Blob([SAMPLE_CSV_CONTENT], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = SAMPLE_CSV_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

export type LeadCategory = "hot" | "warm" | "cold";

export type CategorizedLeadImport = {
  hot: number;
  warm: number;
  cold: number;
  total: number;
  invalid: number;
  created?: number;
  updated?: number;
};

export type LeadImportRow = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string;
  temperature: LeadCategory;
};

function splitContactName(fullName: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: null, lastName: null };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function getCellValue(
  row: string[],
  headers: string[],
  column: string | null,
): string {
  if (!column) return "";
  const index = headers.indexOf(column);
  return index === -1 ? "" : (row[index] ?? "").trim();
}

function scoreLeadRow(
  row: string[],
  headers: string[],
  mapping: ColumnMapping,
): LeadCategory | null {
  const phone = getCellValue(row, headers, mapping.phoneNumber);
  if (!phone || !isValidE164Phone(phone)) {
    return null;
  }

  const name = getCellValue(row, headers, mapping.contactName);
  const agentId = getCellValue(row, headers, mapping.agentId);
  const emailHeader = headers.find((h) => h.toLowerCase().includes("email"));
  const email = emailHeader ? getCellValue(row, headers, emailHeader) : "";

  if (agentId) {
    return "hot";
  }
  if (name && email.includes("@")) {
    return "warm";
  }
  return "cold";
}

export function categorizeLeads(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
): CategorizedLeadImport {
  const result: CategorizedLeadImport = {
    hot: 0,
    warm: 0,
    cold: 0,
    total: 0,
    invalid: 0,
  };

  for (const row of parsed.rows) {
    const category = scoreLeadRow(row, parsed.headers, mapping);
    if (!category) {
      result.invalid++;
      continue;
    }
    result[category]++;
    result.total++;
  }

  return result;
}

export function buildLeadImportRows(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
): LeadImportRow[] {
  const rows: LeadImportRow[] = [];

  for (const row of parsed.rows) {
    const category = scoreLeadRow(row, parsed.headers, mapping);
    if (!category) continue;

    const phone = getCellValue(row, parsed.headers, mapping.phoneNumber);
    const contactName = getCellValue(row, parsed.headers, mapping.contactName);
    const emailHeader = parsed.headers.find((header) =>
      header.toLowerCase().includes("email"),
    );
    const email = emailHeader
      ? getCellValue(row, parsed.headers, emailHeader)
      : "";
    const { firstName, lastName } = splitContactName(contactName);

    rows.push({
      firstName,
      lastName,
      email: email || null,
      phone,
      temperature: category,
    });
  }

  return rows;
}

export function autoProcessCsv(text: string): {
  parsed: ParsedCsv;
  mapping: ColumnMapping;
  categories: CategorizedLeadImport;
  rows: LeadImportRow[];
} {
  const parsed = parseCsv(text);
  const mapping = guessColumnMapping(parsed.headers);
  const categories = categorizeLeads(parsed, mapping);
  const rows = buildLeadImportRows(parsed, mapping);
  return { parsed, mapping, categories, rows };
}
