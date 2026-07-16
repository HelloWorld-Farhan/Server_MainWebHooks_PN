import path from "node:path";
import { pathToFileURL } from "node:url";

import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

import {
  buildStoredContactPhone,
  DEFAULT_CONTACT_PHONE_COUNTRY,
} from "@/lib/country-dial-codes";
import { normalizeContactPhone } from "@/lib/contact-phone-validation";
import { guessColumnMapping } from "@/lib/csv-import";
import {
  parsePhonesFromStructuredRows,
  type ParsedContactRecord,
  type ParsedPhoneImport,
  type ParsePhonesOptions,
} from "@/lib/contact-phone-import";

export const SERVER_PARSE_EXTENSIONS = [
  ".xlsx",
  ".xls",
  ".pdf",
  ".docx",
] as const;

const TEN_DIGIT_PHONE_REGEX = /\b\d{10}\b/g;

let pdfWorkerConfigured = false;

function ensurePdfWorkerConfigured(): void {
  if (pdfWorkerConfigured) return;

  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  PDFParse.setWorker(pathToFileURL(workerPath).href);
  pdfWorkerConfigured = true;
}

export function normalizePhoneCandidate(
  raw: string,
  defaultCountry = DEFAULT_CONTACT_PHONE_COUNTRY,
): string | null {
  const local = normalizeContactPhone(raw);
  if (!local) return null;
  return buildStoredContactPhone(defaultCountry, local);
}

export function parsePhonesFromText(
  text: string,
  defaultCountry = DEFAULT_CONTACT_PHONE_COUNTRY,
): ParsedPhoneImport {
  const seen = new Set<string>();
  const contacts: ParsedContactRecord[] = [];
  let invalid = 0;

  const matches = text.match(TEN_DIGIT_PHONE_REGEX) ?? [];
  for (const match of matches) {
    const normalized = normalizePhoneCandidate(match, defaultCountry);
    if (!normalized) {
      invalid++;
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    contacts.push({
      phone: normalized,
      name: null,
      email: null,
      address: null,
      branchNames: [],
    });
  }

  return { contacts, invalid };
}

export function parsePhonesFromExcel(
  buffer: Buffer,
  options: ParsePhonesOptions = {},
): ParsedPhoneImport {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { contacts: [], invalid: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as string[][];

  if (rows.length === 0) {
    return { contacts: [], invalid: 0 };
  }

  const headers = rows[0].map((cell) => String(cell ?? "").trim());
  const dataRows = rows
    .slice(1)
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  return parsePhonesFromStructuredRows(headers, dataRows, options);
}

export async function parsePhonesFromPdf(
  buffer: Buffer,
  defaultCountry = DEFAULT_CONTACT_PHONE_COUNTRY,
): Promise<ParsedPhoneImport> {
  ensurePdfWorkerConfigured();

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return parsePhonesFromText(result.text, defaultCountry);
  } finally {
    await parser.destroy();
  }
}

export async function parsePhonesFromDocx(
  buffer: Buffer,
  defaultCountry = DEFAULT_CONTACT_PHONE_COUNTRY,
): Promise<ParsedPhoneImport> {
  const result = await mammoth.extractRawText({ buffer });
  return parsePhonesFromText(result.value, defaultCountry);
}

function getExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex === -1 ? "" : lower.slice(dotIndex);
}

export async function parseContactPhoneUpload(
  buffer: Buffer,
  filename: string,
  options: ParsePhonesOptions = {},
): Promise<ParsedPhoneImport> {
  const extension = getExtension(filename);
  const defaultCountry = options.defaultCountry ?? DEFAULT_CONTACT_PHONE_COUNTRY;

  if (extension === ".doc") {
    throw new Error(
      "Legacy .doc files are not supported. Save as .docx or export to CSV/Excel.",
    );
  }

  switch (extension) {
    case ".xlsx":
    case ".xls":
      return parsePhonesFromExcel(buffer, options);
    case ".pdf":
      return parsePhonesFromPdf(buffer, defaultCountry);
    case ".docx":
      return parsePhonesFromDocx(buffer, defaultCountry);
    default:
      throw new Error(
        "Unsupported file type. Upload Excel (.xlsx/.xls), PDF, or Word (.docx).",
      );
  }
}

export function hasPhoneColumn(headers: string[]): boolean {
  return guessColumnMapping(headers).phoneNumber !== null;
}
