import type { IntegrationType } from "@prisma/client";

import type { Prisma } from "@prisma/client";

import { INTEGRATION_DEFINITIONS } from "@/lib/integrations/registry";
import {
  isGoogleIntegration,
} from "@/lib/integrations/google/constants";
import {
  appendSheetRow,
  createSpreadsheet,
  deleteSpreadsheet,
  listSpreadsheets,
  listWorksheets,
  mapDataToRow,
  mapDialerCallToRow,
  mapLeadToRow,
  readSheetRange,
  rowToRecord,
  updateSheetRange,
} from "@/lib/integrations/google/sheets-service";
import {
  clearGoogleTokens,
  getGoogleTokens,
} from "@/lib/integrations/google/token-store";
import { revokeGoogleToken } from "@/lib/integrations/google/oauth";
import {
  isGoogleIntegrationAuthorized,
  markGoogleIntegrationsConnected,
  reconcileGoogleIntegrationStatus,
} from "@/lib/integrations/google/auth-status";
import {
  DEFAULT_CALENDAR_CONFIG,
  DEFAULT_SHEETS_CONFIG,
  type ColumnMapping,
  type GoogleCalendarConfig,
  type GoogleSheetsConfig,
  type IntegrationId,
  type SheetRow,
  type SyncHistoryEntry,
  type WorkspaceIntegration,
} from "@/lib/integrations/types";
import type { AgentToolAssignment, AgentToolId } from "@/lib/tools/types";
import {
  DEFAULT_BILLING_CONFIG,
  DEFAULT_CALENDAR_TOOL_CONFIG,
  DEFAULT_FAQ_CONFIG,
  DEFAULT_SHEETS_TOOL_CONFIG,
} from "@/lib/tools/types";
import prisma from "@/server/lib/prisma";
import { integrationsManagementService } from "@/server/services/integrations-management.service";
import type { TenantContext } from "@/server/types/context";

const TYPE_MAP: Record<IntegrationId, IntegrationType> = {
  "google-sheets": "GOOGLE_SHEETS",
  "google-calendar": "GOOGLE_CALENDAR",
  hubspot: "HUBSPOT",
  salesforce: "SALESFORCE",
  email: "EMAIL",
  whatsapp: "WHATSAPP",
};

const ID_MAP: Partial<Record<IntegrationType, IntegrationId>> = Object.fromEntries(
  Object.entries(TYPE_MAP).map(([k, v]) => [v, k as IntegrationId]),
);

type IntegrationConfig = {
  sheetsConfig?: GoogleSheetsConfig;
  calendarConfig?: GoogleCalendarConfig;
  spreadsheets?: { id: string; name: string; modifiedAt: string }[];
  worksheets?: Record<string, { id: string; name: string; rowCount: number }[]>;
  sheetRows?: SheetRow[];
  syncHistory?: SyncHistoryEntry[];
  calendarEvents?: Record<string, unknown>[];
};

function statusFromDb(status: string): WorkspaceIntegration["status"] {
  switch (status) {
    case "CONNECTED":
      return "connected";
    case "SYNCING":
      return "syncing";
    case "ERROR":
      return "error";
    default:
      return "not_connected";
  }
}

function parseConfig(raw: unknown): IntegrationConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as IntegrationConfig;
}

async function getOrCreateIntegration(companyId: string, id: IntegrationId) {
  const type = TYPE_MAP[id];
  return prisma.integration.upsert({
    where: { companyId_type: { companyId, type } },
    create: { company: { connect: { id: companyId } }, type, config: {} },
    update: {},
  });
}

function toWorkspaceIntegration(
  id: IntegrationId,
  row: { status: string; connectedAccount: string | null; lastSyncAt: Date | null; errorMessage: string | null; config: unknown },
): WorkspaceIntegration {
  const def = INTEGRATION_DEFINITIONS.find((d) => d.id === id);
  const config = parseConfig(row.config);
  const base: WorkspaceIntegration = {
    id,
    name: def?.name ?? id,
    status: statusFromDb(row.status),
    connectedAccount: row.connectedAccount,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
  };
  if (id === "google-sheets") {
    return { ...base, sheetsConfig: config.sheetsConfig ?? { ...DEFAULT_SHEETS_CONFIG } };
  }
  if (id === "google-calendar") {
    return { ...base, calendarConfig: config.calendarConfig ?? { ...DEFAULT_CALENDAR_CONFIG } };
  }
  return base;
}

export async function listIntegrations(ctx: TenantContext): Promise<WorkspaceIntegration[]> {
  await reconcileGoogleIntegrationStatus(ctx);

  const rows = await integrationsManagementService.list(ctx);
  const byType = new Map(rows.map((r) => [r.type, r]));
  const googleAuthorized = await isGoogleIntegrationAuthorized(ctx);

  return INTEGRATION_DEFINITIONS.filter((d) => d.available).map((def) => {
    const row = byType.get(TYPE_MAP[def.id]);
    if (!row) {
      return toWorkspaceIntegration(def.id, {
        status: "NOT_CONNECTED",
        connectedAccount: null,
        lastSyncAt: null,
        errorMessage: null,
        config: {},
      });
    }

    let status =
      row.status === "connected"
        ? "CONNECTED"
        : row.status === "syncing"
          ? "SYNCING"
          : row.status === "error"
            ? "ERROR"
            : "NOT_CONNECTED";

    if (isGoogleIntegration(def.id) && !googleAuthorized) {
      status = "NOT_CONNECTED";
    }

    return toWorkspaceIntegration(def.id, {
      status,
      connectedAccount: googleAuthorized || !isGoogleIntegration(def.id)
        ? row.connectedAccount
        : null,
      lastSyncAt: googleAuthorized || !isGoogleIntegration(def.id)
        ? row.lastSyncAt
          ? new Date(row.lastSyncAt)
          : null
        : null,
      errorMessage: row.errorMessage,
      config: row.config,
    });
  });
}

export async function getIntegrationById(
  ctx: TenantContext,
  id: IntegrationId,
): Promise<WorkspaceIntegration | null> {
  const all = await listIntegrations(ctx);
  return all.find((i) => i.id === id) ?? null;
}

export async function connectIntegrationDb(
  ctx: TenantContext,
  id: IntegrationId,
  account?: string,
) {
  if (isGoogleIntegration(id)) {
    await markGoogleIntegrationsConnected(ctx, account ?? null, "oauth");
    return getIntegrationById(ctx, id);
  }

  await integrationsManagementService.connect(ctx, id, account);
  return getIntegrationById(ctx, id);
}

export async function disconnectIntegrationDb(
  ctx: TenantContext,
  id: IntegrationId,
) {
  if (isGoogleIntegration(id)) {
    const tokens = await getGoogleTokens(ctx);
    if (tokens?.refreshToken) {
      await revokeGoogleToken(tokens.refreshToken);
    }
    await clearGoogleTokens(ctx);
    await reconcileGoogleIntegrationStatus(ctx);
    return getIntegrationById(ctx, id);
  }

  await integrationsManagementService.disconnect(ctx, id);
  return getIntegrationById(ctx, id);
}

async function mergeConfig(
  ctx: TenantContext,
  id: IntegrationId,
  patch: IntegrationConfig,
) {
  const row = await getOrCreateIntegration(ctx.companyId, id);
  const current = parseConfig(row.config);
  const next = { ...current, ...patch };
  await prisma.integration.update({
    where: { id: row.id },
    data: { config: next as Prisma.InputJsonValue },
  });
  return next;
}

export async function updateSheetsConfigDb(
  ctx: TenantContext,
  sheetsConfig: GoogleSheetsConfig,
) {
  await mergeConfig(ctx, "google-sheets", { sheetsConfig });
  return getIntegrationById(ctx, "google-sheets");
}

export async function updateCalendarConfigDb(
  ctx: TenantContext,
  calendarConfig: GoogleCalendarConfig,
) {
  await mergeConfig(ctx, "google-calendar", { calendarConfig });
  return getIntegrationById(ctx, "google-calendar");
}

export async function getSpreadsheetsDb(ctx: TenantContext) {
  try {
    const remote = await listSpreadsheets(ctx);
    if (remote.length > 0) {
      await mergeConfig(ctx, "google-sheets", { spreadsheets: remote });
      return remote;
    }
  } catch {
    /* fall back to cache when not connected */
  }
  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  return parseConfig(row.config).spreadsheets ?? [];
}

export async function createSpreadsheetDb(
  ctx: TenantContext,
  name: string,
  columns: ColumnMapping[] = [],
) {
  const sheet = await createSpreadsheet(ctx, name, columns);
  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  const config = parseConfig(row.config);
  const spreadsheets = [sheet, ...(config.spreadsheets ?? [])];
  const worksheets = {
    ...(config.worksheets ?? {}),
    [sheet.id]: [{ id: "0", name: "Sheet1", rowCount: 1 }],
  };

  const columnMappings =
    columns.length > 0
      ? columns.map((col, index) => ({
          ...col,
          spreadsheetColumn: `Column ${String.fromCharCode(65 + index)}`,
        }))
      : (config.sheetsConfig?.columnMappings ?? []);

  const sheetsConfig: GoogleSheetsConfig = {
    ...(config.sheetsConfig ?? DEFAULT_SHEETS_CONFIG),
    spreadsheetId: sheet.id,
    spreadsheetName: sheet.name,
    worksheetId: "0",
    worksheetName: "Sheet1",
    columnMappings,
  };

  await mergeConfig(ctx, "google-sheets", {
    spreadsheets,
    worksheets,
    sheetsConfig,
  });
  return sheet;
}

export async function deleteSpreadsheetDb(
  ctx: TenantContext,
  spreadsheetId: string,
) {
  try {
    await deleteSpreadsheet(ctx, spreadsheetId);
  } catch {
    /* still remove from local cache if file is already gone */
  }

  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  const config = parseConfig(row.config);
  const spreadsheets = (config.spreadsheets ?? []).filter(
    (sheet) => sheet.id !== spreadsheetId,
  );
  const worksheets = { ...(config.worksheets ?? {}) };
  delete worksheets[spreadsheetId];

  const sheetsConfig = { ...(config.sheetsConfig ?? DEFAULT_SHEETS_CONFIG) };
  if (sheetsConfig.spreadsheetId === spreadsheetId) {
    sheetsConfig.spreadsheetId = null;
    sheetsConfig.spreadsheetName = null;
    sheetsConfig.worksheetId = null;
    sheetsConfig.worksheetName = null;
    sheetsConfig.columnMappings = [];
  }

  await mergeConfig(ctx, "google-sheets", {
    spreadsheets,
    worksheets,
    sheetsConfig,
  });

  return getIntegrationById(ctx, "google-sheets");
}

export async function getWorksheetsDb(ctx: TenantContext, spreadsheetId: string) {
  try {
    const remote = await listWorksheets(ctx, spreadsheetId);
    if (remote.length > 0) {
      const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
      const config = parseConfig(row.config);
      await mergeConfig(ctx, "google-sheets", {
        worksheets: {
          ...(config.worksheets ?? {}),
          [spreadsheetId]: remote,
        },
      });
      return remote;
    }
  } catch {
    /* fall back to cache */
  }
  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  return parseConfig(row.config).worksheets?.[spreadsheetId] ?? [];
}

export async function getSyncHistoryDb(ctx: TenantContext): Promise<SyncHistoryEntry[]> {
  const row = await prisma.integration.findFirst({
    where: { companyId: ctx.companyId, type: "GOOGLE_SHEETS" },
  });
  if (!row) return [];
  const logs = await prisma.integrationSyncLog.findMany({
    where: { integrationId: row.id },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  return logs.map((log) => ({
    id: log.id,
    startedAt: log.startedAt.toISOString(),
    completedAt: log.completedAt?.toISOString() ?? log.startedAt.toISOString(),
    result: log.result === "SUCCESS" ? "success" : log.result === "PARTIAL" ? "partial" : "error",
    rowsSynced: log.rowsSynced,
    message: log.message ?? "",
  }));
}

export async function triggerSheetsSyncDb(ctx: TenantContext) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  await prisma.integration.update({
    where: { id: row.id },
    data: { status: "SYNCING" },
  });
  return getIntegrationById(ctx, "google-sheets");
}

export async function completeSheetsSyncDb(
  ctx: TenantContext,
  message: string,
  rowsSynced: number,
  result: "success" | "partial" | "error" = "success",
) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  await prisma.integrationSyncLog.create({
    data: {
      integration: { connect: { id: row.id } },
      result:
        result === "success"
          ? "SUCCESS"
          : result === "partial"
            ? "PARTIAL"
            : "ERROR",
      rowsSynced,
      message,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  await prisma.integration.update({
    where: { id: row.id },
    data: {
      status: result === "error" ? "ERROR" : "CONNECTED",
      lastSyncAt: new Date(),
      errorMessage: result === "error" ? message : null,
    },
  });
  return getIntegrationById(ctx, "google-sheets");
}

export async function getCalendarsDb(ctx: TenantContext) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-calendar");
  const config = parseConfig(row.config);
  return (config as { calendars?: unknown[] }).calendars ?? [];
}

export async function getCalendarConfigDb(ctx: TenantContext) {
  const integration = await getIntegrationById(ctx, "google-calendar");
  return integration?.calendarConfig ?? { ...DEFAULT_CALENDAR_CONFIG };
}

export async function getSheetRowsDb(ctx: TenantContext): Promise<SheetRow[]> {
  const row = await getOrCreateIntegration(ctx.companyId, "google-sheets");
  return parseConfig(row.config).sheetRows ?? [];
}

export async function syncSheetsDataDb(ctx: TenantContext): Promise<number> {
  const integration = await getIntegrationById(ctx, "google-sheets");
  const config = integration?.sheetsConfig;
  if (!config?.spreadsheetId || !config.worksheetName) {
    throw new Error("Spreadsheet and worksheet must be configured before sync");
  }
  if (config.columnMappings.length === 0) {
    throw new Error("Column mappings must be configured before sync");
  }

  const leads = await prisma.lead.findMany({
    where: { companyId: ctx.companyId },
    include: {
      stage: true,
      notes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  let rowsSynced = 0;
  for (const lead of leads) {
    const values = mapLeadToRow(lead, config.columnMappings);
    await appendSheetRow(
      ctx,
      config.spreadsheetId,
      config.worksheetName,
      values,
    );
    rowsSynced += 1;
  }

  return rowsSynced;
}

export type DialerSheetsSyncResult =
  | { skipped: true; reason: string }
  | { success: true; spreadsheetId: string; rowsAppended: number };

export async function syncDialerCallToSheetDb(
  ctx: TenantContext,
  callId: string,
): Promise<DialerSheetsSyncResult> {
  const integrationRow = await prisma.integration.findFirst({
    where: {
      companyId: ctx.companyId,
      type: "GOOGLE_SHEETS",
      status: "CONNECTED",
    },
  });

  if (!integrationRow) {
    return { skipped: true, reason: "Google Sheets integration is not connected" };
  }

  const config = parseConfig(integrationRow.config);
  const sheetsConfig = config.sheetsConfig;

  if (!sheetsConfig?.spreadsheetId || !sheetsConfig.worksheetName) {
    return {
      skipped: true,
      reason: "Spreadsheet and worksheet are not configured",
    };
  }

  if (sheetsConfig.columnMappings.length === 0) {
    return { skipped: true, reason: "Column mappings are not configured" };
  }

  const dialerCall = await prisma.dialerCall.findFirst({
    where: { id: callId, companyId: ctx.companyId },
    include: {
      lead: {
        include: {
          stage: true,
          notes: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      analysis: true,
    },
  });

  if (!dialerCall) {
    throw new Error(`Dialer call not found: ${callId}`);
  }

  const values = mapDialerCallToRow(
    dialerCall,
    dialerCall.lead,
    dialerCall.analysis,
    sheetsConfig.columnMappings,
  );

  await appendSheetRow(
    ctx,
    sheetsConfig.spreadsheetId,
    sheetsConfig.worksheetName,
    values,
  );

  await prisma.integrationSyncLog.create({
    data: {
      integration: { connect: { id: integrationRow.id } },
      result: "SUCCESS",
      rowsSynced: 1,
      message: `Post-call sync for dialer call ${callId}`,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  await prisma.integration.update({
    where: { id: integrationRow.id },
    data: { lastSyncAt: new Date(), errorMessage: null },
  });

  return {
    success: true,
    spreadsheetId: sheetsConfig.spreadsheetId,
    rowsAppended: 1,
  };
}

export async function readSheetRowDb(ctx: TenantContext, rowIndex: number) {
  const integration = await getIntegrationById(ctx, "google-sheets");
  const config = integration?.sheetsConfig;
  if (!config?.spreadsheetId || !config.worksheetName) {
    return null;
  }
  if (config.columnMappings.length === 0) {
    return null;
  }

  const rowNumber = rowIndex + 2;
  const endCol = String.fromCharCode(
    64 + Math.max(config.columnMappings.length, 1),
  );
  const range = `${config.worksheetName}!A${rowNumber}:${endCol}${rowNumber}`;
  const rows = await readSheetRange(ctx, config.spreadsheetId, range);
  if (!rows[0]) return null;
  return rowToRecord(rows[0], config.columnMappings);
}

export async function writeSheetRowDb(
  ctx: TenantContext,
  rowIndex: number,
  data: SheetRow,
) {
  const integration = await getIntegrationById(ctx, "google-sheets");
  const config = integration?.sheetsConfig;
  if (!config?.spreadsheetId || !config.worksheetName) {
    throw new Error("Spreadsheet not configured");
  }
  if (config.columnMappings.length === 0) {
    throw new Error("Column mappings not configured");
  }

  const values = mapDataToRow(data, config.columnMappings);
  const rowNumber = rowIndex + 2;
  const endCol = String.fromCharCode(
    64 + Math.max(config.columnMappings.length, 1),
  );
  const range = `${config.worksheetName}!A${rowNumber}:${endCol}${rowNumber}`;

  await updateSheetRange(ctx, config.spreadsheetId, range, [values]);
  return data;
}

export async function appendSheetRowDb(
  ctx: TenantContext,
  data: SheetRow,
) {
  const integration = await getIntegrationById(ctx, "google-sheets");
  const config = integration?.sheetsConfig;
  if (!config?.spreadsheetId || !config.worksheetName) {
    throw new Error("Spreadsheet not configured");
  }
  if (config.columnMappings.length === 0) {
    throw new Error("Column mappings not configured");
  }

  const values = mapDataToRow(data, config.columnMappings);
  await appendSheetRow(
    ctx,
    config.spreadsheetId,
    config.worksheetName,
    values,
  );
  return data;
}

const TOOL_DEFAULTS: Record<AgentToolId, AgentToolAssignment> = {
  faq: {
    toolId: "faq",
    enabled: false,
    status: "disabled",
    health: "healthy",
    config: DEFAULT_FAQ_CONFIG,
    usage: { totalExecutions: 0, successRate: 1, lastUsedAt: null, errorCount: 0 },
  },
  billing: {
    toolId: "billing",
    enabled: false,
    status: "disabled",
    health: "healthy",
    config: DEFAULT_BILLING_CONFIG,
    usage: { totalExecutions: 0, successRate: 1, lastUsedAt: null, errorCount: 0 },
  },
  "google-calendar": {
    toolId: "google-calendar",
    enabled: false,
    status: "disabled",
    health: "healthy",
    config: DEFAULT_CALENDAR_TOOL_CONFIG,
    usage: { totalExecutions: 0, successRate: 1, lastUsedAt: null, errorCount: 0 },
  },
  "google-sheets": {
    toolId: "google-sheets",
    enabled: false,
    status: "disabled",
    health: "healthy",
    config: DEFAULT_SHEETS_TOOL_CONFIG,
    usage: { totalExecutions: 0, successRate: 1, lastUsedAt: null, errorCount: 0 },
  },
};

export async function getCalendarEventsDb(ctx: TenantContext) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-calendar");
  return (parseConfig(row.config).calendarEvents ?? []) as {
    id: string;
    title: string;
    start: string;
    end: string;
    attendeeEmail?: string;
  }[];
}

export async function addCalendarEventDb(
  ctx: TenantContext,
  event: Omit<{ id: string; title: string; start: string; end: string; attendeeEmail?: string }, "id">,
) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-calendar");
  const config = parseConfig(row.config);
  const created = { ...event, id: `evt-${Date.now()}` };
  const calendarEvents = [...(config.calendarEvents ?? []), created];
  await mergeConfig(ctx, "google-calendar", { calendarEvents });
  return created;
}

export async function updateCalendarEventDb(
  ctx: TenantContext,
  eventId: string,
  update: Partial<{ title: string; start: string; end: string; attendeeEmail?: string }>,
) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-calendar");
  const config = parseConfig(row.config);
  const events = [...(config.calendarEvents ?? [])] as {
    id: string;
    title: string;
    start: string;
    end: string;
    attendeeEmail?: string;
  }[];
  const index = events.findIndex((e) => e.id === eventId);
  if (index === -1) return null;
  events[index] = { ...events[index], ...update };
  await mergeConfig(ctx, "google-calendar", { calendarEvents: events });
  return events[index];
}

export async function deleteCalendarEventDb(ctx: TenantContext, eventId: string) {
  const row = await getOrCreateIntegration(ctx.companyId, "google-calendar");
  const config = parseConfig(row.config);
  const events = ((config.calendarEvents ?? []) as { id: string }[]).filter(
    (e) => e.id !== eventId,
  );
  if (events.length === (config.calendarEvents ?? []).length) return false;
  await mergeConfig(ctx, "google-calendar", { calendarEvents: events });
  return true;
}

export async function getAgentToolsDb(ctx: TenantContext, agentId: string) {
  const rows = await integrationsManagementService.getAgentTools(ctx, agentId);
  const byId = new Map(rows.map((r) => [r.toolId, r]));
  return (Object.keys(TOOL_DEFAULTS) as AgentToolId[]).map((toolId) => {
    const row = byId.get(toolId);
    const defaults = TOOL_DEFAULTS[toolId];
    if (!row) return defaults;
    return {
      ...defaults,
      enabled: row.enabled,
      status: row.enabled ? "enabled" : "disabled",
      config: row.config as AgentToolAssignment["config"],
      usage: row.usage as AgentToolAssignment["usage"],
    } satisfies AgentToolAssignment;
  });
}

export async function updateAgentToolDb(
  ctx: TenantContext,
  agentId: string,
  toolId: AgentToolId,
  patch: Partial<AgentToolAssignment>,
) {
  const updated = await integrationsManagementService.updateAgentTool(ctx, agentId, toolId, {
    enabled: patch.enabled,
    config: patch.config as Record<string, unknown>,
  });
  const defaults = TOOL_DEFAULTS[toolId];
  return {
    ...defaults,
    enabled: updated.enabled,
    status: updated.enabled ? "enabled" : "disabled",
    config: updated.config as AgentToolAssignment["config"],
    usage: updated.usage as AgentToolAssignment["usage"],
    health: patch.health ?? defaults.health,
  } satisfies AgentToolAssignment;
}
