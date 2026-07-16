export type IntegrationId =
  | "google-sheets"
  | "google-calendar"
  | "hubspot"
  | "salesforce"
  | "email"
  | "whatsapp";

export type IntegrationStatus =
  | "connected"
  | "not_connected"
  | "syncing"
  | "error";

export type PropNexFieldId =
  | "customerName"
  | "phoneNumber"
  | "budget"
  | "leadStatus"
  | "followUpDate"
  | "notes"
  | "callOutcome"
  | "aiSummary"
  | "leadScore"
  | "temperature"
  | string;

export type ColumnMapping = {
  propnexField: PropNexFieldId;
  spreadsheetColumn: string;
  label: string;
};

export type SyncResult = "success" | "partial" | "error";

export type SyncHistoryEntry = {
  id: string;
  startedAt: string;
  completedAt: string;
  result: SyncResult;
  rowsSynced: number;
  message: string;
};

export type GoogleSheetsConfig = {
  spreadsheetId: string | null;
  spreadsheetName: string | null;
  worksheetId: string | null;
  worksheetName: string | null;
  columnMappings: ColumnMapping[];
  autoSync: boolean;
  lastSyncResult: SyncResult | null;
  lastSyncMessage: string | null;
};

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type WorkingHoursDay = {
  enabled: boolean;
  start: string;
  end: string;
};

export type WorkingHours = Record<DayOfWeek, WorkingHoursDay>;

export type GoogleCalendarConfig = {
  calendarId: string | null;
  calendarName: string | null;
  timezone: string;
  workingHours: WorkingHours;
  meetingDurationMinutes: number;
  bufferMinutes: number;
};

export type WorkspaceIntegration = {
  id: IntegrationId;
  name: string;
  status: IntegrationStatus;
  connectedAccount: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
  sheetsConfig?: GoogleSheetsConfig;
  calendarConfig?: GoogleCalendarConfig;
};

export type SpreadsheetOption = {
  id: string;
  name: string;
  modifiedAt: string;
  webViewLink?: string;
};

export type WorksheetOption = {
  id: string;
  name: string;
  rowCount: number;
};

export type CalendarOption = {
  id: string;
  name: string;
  primary: boolean;
  timezone: string;
};

export const PROPNEX_FIELD_PRESETS: {
  id: PropNexFieldId;
  label: string;
}[] = [
  { id: "customerName", label: "Customer Name" },
  { id: "phoneNumber", label: "Phone Number" },
  { id: "budget", label: "Budget" },
  { id: "leadStatus", label: "Lead Status" },
  { id: "followUpDate", label: "Follow-Up Date" },
  { id: "notes", label: "Notes" },
  { id: "callOutcome", label: "Call Outcome" },
  { id: "aiSummary", label: "AI Summary" },
  { id: "leadScore", label: "Lead Score" },
  { id: "temperature", label: "Hot/Warm/Cold" },
];

export const SHEET_COLUMN_PRESETS = [
  "Column A",
  "Column B",
  "Column C",
  "Column D",
  "Column E",
  "Column F",
  "Column G",
  "Column H",
];

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  monday: { enabled: true, start: "09:00", end: "17:00" },
  tuesday: { enabled: true, start: "09:00", end: "17:00" },
  wednesday: { enabled: true, start: "09:00", end: "17:00" },
  thursday: { enabled: true, start: "09:00", end: "17:00" },
  friday: { enabled: true, start: "09:00", end: "17:00" },
  saturday: { enabled: false, start: "09:00", end: "17:00" },
  sunday: { enabled: false, start: "09:00", end: "17:00" },
};

export const DEFAULT_SHEETS_CONFIG: GoogleSheetsConfig = {
  spreadsheetId: null,
  spreadsheetName: null,
  worksheetId: null,
  worksheetName: null,
  columnMappings: [],
  autoSync: false,
  lastSyncResult: null,
  lastSyncMessage: null,
};

export const DEFAULT_CALENDAR_CONFIG: GoogleCalendarConfig = {
  calendarId: null,
  calendarName: null,
  timezone: "Asia/Kolkata",
  workingHours: DEFAULT_WORKING_HOURS,
  meetingDurationMinutes: 30,
  bufferMinutes: 15,
};

export type SheetRow = Record<string, string>;
