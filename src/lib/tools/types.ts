import type { IntegrationId } from "@/lib/integrations/types";

export type AgentToolId =
  | "faq"
  | "billing"
  | "google-calendar"
  | "google-sheets";

export type ToolStatus = "enabled" | "disabled";

export type ToolHealth = "healthy" | "degraded" | "down" | "unavailable";

export type ToolUsageMetrics = {
  totalExecutions: number;
  successRate: number;
  lastUsedAt: string | null;
  errorCount: number;
};

export type FaqToolConfig = {
  knowledgeSourceIds: string[];
  confidenceThreshold: number;
  fallbackResponse: string;
};

export type BillingToolPermissions = {
  creditAccess: boolean;
  planAccess: boolean;
  invoiceAccess: boolean;
};

export type BillingToolConfig = {
  permissions: BillingToolPermissions;
};

export type GoogleCalendarToolPermissions = {
  checkAvailability: boolean;
  createEvents: boolean;
  rescheduleEvents: boolean;
  cancelEvents: boolean;
};

export type GoogleCalendarToolConfig = {
  permissions: GoogleCalendarToolPermissions;
};

export type GoogleSheetsToolPermissions = {
  readRecords: boolean;
  createRecords: boolean;
  updateRecords: boolean;
  saveCallOutcomes: boolean;
  saveNotes: boolean;
  saveLeadScores: boolean;
};

export type GoogleSheetsToolConfig = {
  permissions: GoogleSheetsToolPermissions;
};

export type ToolConfig =
  | FaqToolConfig
  | BillingToolConfig
  | GoogleCalendarToolConfig
  | GoogleSheetsToolConfig;

export type AgentToolAssignment = {
  toolId: AgentToolId;
  enabled: boolean;
  status: ToolStatus;
  health: ToolHealth;
  config: ToolConfig;
  usage: ToolUsageMetrics;
  blockedReason?: string;
};

export type AgentToolsState = {
  agentId: string;
  tools: AgentToolAssignment[];
};

export const DEFAULT_FAQ_CONFIG: FaqToolConfig = {
  knowledgeSourceIds: [],
  confidenceThreshold: 0.7,
  fallbackResponse:
    "I don't have that information right now. Let me connect you with a team member who can help.",
};

export const DEFAULT_BILLING_CONFIG: BillingToolConfig = {
  permissions: {
    creditAccess: true,
    planAccess: true,
    invoiceAccess: false,
  },
};

export const DEFAULT_CALENDAR_TOOL_CONFIG: GoogleCalendarToolConfig = {
  permissions: {
    checkAvailability: true,
    createEvents: true,
    rescheduleEvents: true,
    cancelEvents: false,
  },
};

export const DEFAULT_SHEETS_TOOL_CONFIG: GoogleSheetsToolConfig = {
  permissions: {
    readRecords: true,
    createRecords: true,
    updateRecords: true,
    saveCallOutcomes: true,
    saveNotes: true,
    saveLeadScores: true,
  },
};

export type ToolDefinition = {
  id: AgentToolId;
  name: string;
  description: string;
  requiredIntegrationId?: IntegrationId;
};
