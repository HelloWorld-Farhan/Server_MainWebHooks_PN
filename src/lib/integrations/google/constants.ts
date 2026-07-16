import type { IntegrationId } from "@/lib/integrations/types";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar",
];

export const GOOGLE_INTEGRATION_IDS = new Set<IntegrationId>([
  "google-sheets",
  "google-calendar",
]);

export function isGoogleIntegration(id: IntegrationId): boolean {
  return GOOGLE_INTEGRATION_IDS.has(id);
}

export function spreadsheetWebViewLink(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

export function columnIndexToLetter(index: number): string {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export function columnLetterToPreset(letter: string): string {
  return `Column ${letter}`;
}
