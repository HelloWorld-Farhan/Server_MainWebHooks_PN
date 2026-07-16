import type {
  ColumnMapping,
  SpreadsheetOption,
  WorksheetOption,
} from "@/lib/integrations/types";
import {
  columnIndexToLetter,
  columnLetterToPreset,
  spreadsheetWebViewLink,
} from "@/lib/integrations/google/constants";
import {
  ensureGoogleSheetsAuthorized,
  getDriveClient,
  getSheetsClient,
} from "@/lib/integrations/google/client";
import type { TenantContext } from "@/server/types/context";

function buildColumnMappings(columns: ColumnMapping[]): ColumnMapping[] {
  return columns.map((col, index) => {
    const letter = columnIndexToLetter(index);
    return {
      ...col,
      spreadsheetColumn: columnLetterToPreset(letter),
    };
  });
}

function headerRange(columnCount: number, worksheetName = "Sheet1"): string {
  const end = columnIndexToLetter(columnCount - 1);
  return `${worksheetName}!A1:${end}1`;
}

export async function listSpreadsheets(
  ctx: TenantContext,
): Promise<SpreadsheetOption[]> {
  const drive = await getDriveClient(ctx);
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
  });

  return (response.data.files ?? []).map((file) => ({
    id: file.id!,
    name: file.name ?? "Untitled",
    modifiedAt: file.modifiedTime ?? new Date().toISOString(),
    webViewLink: file.webViewLink ?? spreadsheetWebViewLink(file.id!),
  }));
}

export async function deleteSpreadsheet(
  ctx: TenantContext,
  spreadsheetId: string,
): Promise<void> {
  const drive = await getDriveClient(ctx);
  await drive.files.delete({ fileId: spreadsheetId });
}

function formatGoogleApiError(error: unknown, context: string): Error {
  const message =
    error instanceof Error ? error.message : "Unknown Google API error";
  return new Error(`Google Sheets API: ${context}: ${message}`);
}

export async function createSpreadsheet(
  ctx: TenantContext,
  name: string,
  columns: ColumnMapping[] = [],
): Promise<SpreadsheetOption> {
  await ensureGoogleSheetsAuthorized(ctx);

  const sheets = await getSheetsClient(ctx);
  const mappings = buildColumnMappings(columns);

  let response;
  try {
    response = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: name },
        sheets: [{ properties: { title: "Sheet1" } }],
      },
    });
  } catch (error) {
    throw formatGoogleApiError(error, "failed creating spreadsheet");
  }

  const spreadsheetId = response.data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Google Sheets API: failed creating spreadsheet: no id returned");
  }

  if (mappings.length > 0) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: headerRange(mappings.length),
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [mappings.map((col) => col.label)],
        },
      });
    } catch (error) {
      throw formatGoogleApiError(error, "failed writing headers");
    }
  }

  return {
    id: spreadsheetId,
    name: response.data.properties?.title ?? name,
    modifiedAt: new Date().toISOString(),
    webViewLink: spreadsheetWebViewLink(spreadsheetId),
  };
}

export async function listWorksheets(
  ctx: TenantContext,
  spreadsheetId: string,
): Promise<WorksheetOption[]> {
  const sheets = await getSheetsClient(ctx);
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "sheets(properties(sheetId,title),properties(gridProperties(rowCount)))",
  });

  return (response.data.sheets ?? []).map((sheet) => ({
    id: String(sheet.properties?.sheetId ?? ""),
    name: sheet.properties?.title ?? "Sheet",
    rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
  }));
}

export async function getSheetHeaders(
  ctx: TenantContext,
  spreadsheetId: string,
  worksheetName: string,
): Promise<string[]> {
  const sheets = await getSheetsClient(ctx);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${worksheetName}!1:1`,
  });
  const row = response.data.values?.[0] ?? [];
  return row.map((cell) => String(cell));
}

export async function appendSheetRow(
  ctx: TenantContext,
  spreadsheetId: string,
  worksheetName: string,
  values: string[],
): Promise<void> {
  const sheets = await getSheetsClient(ctx);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${worksheetName}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
}

export async function updateSheetRange(
  ctx: TenantContext,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<void> {
  const sheets = await getSheetsClient(ctx);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

export async function readSheetRange(
  ctx: TenantContext,
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const sheets = await getSheetsClient(ctx);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return (response.data.values ?? []).map((row) =>
    row.map((cell) => String(cell)),
  );
}

export function mapLeadToRow(
  lead: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    score: number;
    temperature: string | null;
    nextFollowUpAt: Date | null;
    stage?: { name: string } | null;
    notes?: { content: string }[];
  },
  mappings: ColumnMapping[],
): string[] {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const fieldValues: Record<string, string> = {
    customerName: fullName,
    phoneNumber: lead.phone ?? "",
    budget: "",
    leadStatus: lead.stage?.name ?? "",
    followUpDate: lead.nextFollowUpAt?.toISOString().slice(0, 10) ?? "",
    notes: lead.notes?.[0]?.content ?? "",
    callOutcome: "",
    aiSummary: "",
    leadScore: String(lead.score),
    temperature: lead.temperature ?? "",
  };

  return mappings.map((mapping) => fieldValues[mapping.propnexField] ?? "");
}

export function mapDialerCallToRow(
  dialerCall: {
    callStatus: string;
    summary: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
  },
  lead: {
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    score: number;
    temperature: string | null;
    nextFollowUpAt: Date | null;
    stage?: { name: string } | null;
    notes?: { content: string }[];
  },
  analysis: {
    intent: string | null;
  } | null,
  mappings: ColumnMapping[],
): string[] {
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const customerName =
    dialerCall.customerName?.trim() || leadName || "";
  const phoneNumber = dialerCall.customerPhone ?? lead.phone ?? "";
  const summary = dialerCall.summary?.trim() ?? "";
  const leadNote = lead.notes?.[0]?.content ?? "";
  const intent = analysis?.intent ?? "unknown";
  const callOutcome = `${dialerCall.callStatus} — ${intent}`;

  const fieldValues: Record<string, string> = {
    customerName,
    phoneNumber,
    budget: "",
    leadStatus: lead.stage?.name ?? "",
    followUpDate: lead.nextFollowUpAt?.toISOString().slice(0, 10) ?? "",
    notes: leadNote || summary,
    callOutcome,
    aiSummary: summary,
    leadScore: String(lead.score),
    temperature: lead.temperature ?? "",
  };

  return mappings.map((mapping) => fieldValues[mapping.propnexField] ?? "");
}

export function mapDataToRow(
  data: Record<string, string>,
  mappings: ColumnMapping[],
): string[] {
  return mappings.map((mapping) => data[mapping.propnexField] ?? "");
}

export function rowToRecord(
  row: string[],
  mappings: ColumnMapping[],
): Record<string, string> {
  const record: Record<string, string> = {};
  mappings.forEach((mapping, index) => {
    record[mapping.propnexField] = row[index] ?? "";
  });
  return record;
}
