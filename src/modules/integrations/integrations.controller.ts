import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { handleTenantResult } from "@/lib/api/http";
import {
  requireIntegrationsRead,
  requireIntegrationsWrite,
} from "@/lib/integrations/api-guard";
import { markGoogleIntegrationsConnected } from "@/lib/integrations/google/auth-status";
import {
  getClerkGoogleAccessToken,
  getClerkGoogleEmail,
  hasRequiredGoogleScopes,
  userHasGoogleAccount,
} from "@/lib/integrations/google/clerk-auth";
import { isGoogleIntegration } from "@/lib/integrations/google/constants";
import { GoogleSheetsScopeError } from "@/lib/integrations/google/client";
import {
  exchangeGoogleAuthCode,
  buildGoogleAuthUrl,
  parseGoogleOAuthState,
} from "@/lib/integrations/google/oauth";
import { getSheetHeaders } from "@/lib/integrations/google/sheets-service";
import { saveGoogleTokens } from "@/lib/integrations/google/token-store";
import {
  completeSheetsSyncDb,
  connectIntegrationDb,
  createSpreadsheetDb,
  deleteSpreadsheetDb,
  disconnectIntegrationDb,
  getCalendarsDb,
  getIntegrationById,
  getSpreadsheetsDb,
  getSyncHistoryDb,
  getWorksheetsDb,
  listIntegrations,
  syncSheetsDataDb,
  triggerSheetsSyncDb,
  updateCalendarConfigDb,
  updateSheetsConfigDb,
} from "@/lib/integrations/db-state";
import type {
  ColumnMapping,
  GoogleCalendarConfig,
  GoogleSheetsConfig,
  IntegrationId,
} from "@/lib/integrations/types";
import { DEFAULT_WORKING_HOURS } from "@/lib/integrations/types";
import { resolveTenantContext, requireTenantContext } from "@/lib/api/tenant-context";
import type { TenantContext } from "@/server/types/context";

function oauthRedirectResponse(
  ctx: TenantContext,
  integrationId: IntegrationId,
  res: Response,
) {
  const oauthUrl = buildGoogleAuthUrl(ctx.companyId, integrationId);
  return res.json({ oauthUrl, requiresOAuth: true });
}

@Controller("api/integrations")
export class IntegrationsController {
  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const integrations = await listIntegrations(result.ctx);
    return res.json({ integrations });
  }

  @Get("google/oauth/start")
  async oauthStart(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsRead(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const integrationId = req.query.integrationId as IntegrationId | undefined;

    if (!integrationId || !isGoogleIntegration(integrationId)) {
      return res.status(400).json({
        error: "integrationId must be google-sheets or google-calendar",
      });
    }

    try {
      const url = buildGoogleAuthUrl(result.ctx.companyId, integrationId);
      return res.redirect(url);
    } catch (e) {
      return res.status(500).json({
        error:
          e instanceof Error ? e.message : "Failed to start Google OAuth",
      });
    }
  }

  @Get("google/oauth/callback")
  async oauthCallback(@Req() req: Request, @Res() res: Response) {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const oauthError = req.query.error as string | undefined;

    const websiteUrl =
      process.env.MAIN_WEBSITE_URL ?? "http://localhost:3000";
    const settingsUrl = new URL("/settings", websiteUrl);
    settingsUrl.searchParams.set("tab", "integrations");

    if (oauthError) {
      settingsUrl.searchParams.set("oauth_error", oauthError);
      return res.redirect(settingsUrl.toString());
    }

    if (!code || !state) {
      settingsUrl.searchParams.set("oauth_error", "missing_code");
      return res.redirect(settingsUrl.toString());
    }

    try {
      const parsed = parseGoogleOAuthState(state);
      const ctx = await resolveTenantContext(req);

      if (!ctx || ctx.companyId !== parsed.companyId) {
        settingsUrl.searchParams.set("oauth_error", "unauthorized");
        return res.redirect(settingsUrl.toString());
      }

      const tokens = await exchangeGoogleAuthCode(code);
      await saveGoogleTokens(ctx, tokens);
      await connectIntegrationDb(
        ctx,
        parsed.integrationId,
        tokens.email ?? undefined,
      );

      const otherId =
        parsed.integrationId === "google-sheets"
          ? "google-calendar"
          : "google-sheets";
      await connectIntegrationDb(ctx, otherId, tokens.email ?? undefined);

      settingsUrl.searchParams.set("oauth_success", parsed.integrationId);
      return res.redirect(settingsUrl.toString());
    } catch (e) {
      settingsUrl.searchParams.set(
        "oauth_error",
        e instanceof Error ? e.message : "oauth_failed",
      );
      return res.redirect(settingsUrl.toString());
    }
  }

  @Post("google/connect")
  async googleConnect(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as { integrationId?: IntegrationId };
    const integrationId = body.integrationId;

    if (!integrationId || !isGoogleIntegration(integrationId)) {
      return res.status(400).json({
        error: "integrationId must be google-sheets or google-calendar",
      });
    }

    const clerkUserId = result.ctx.clerkUserId;

    if (clerkUserId) {
      const hasGoogle = await userHasGoogleAccount(clerkUserId);
      const clerkToken = hasGoogle
        ? await getClerkGoogleAccessToken(clerkUserId)
        : null;

      if (clerkToken && hasRequiredGoogleScopes(clerkToken.scopes)) {
        const email = await getClerkGoogleEmail(clerkUserId);
        await markGoogleIntegrationsConnected(result.ctx, email, "clerk");
        const integration = await getIntegrationById(result.ctx, integrationId);

        if (!integration) {
          return res.status(404).json({ error: "Integration not found" });
        }

        return res.json({ integration, authSource: "clerk" });
      }
    }

    try {
      return oauthRedirectResponse(result.ctx, integrationId, res);
    } catch (e) {
      return res.status(500).json({
        error:
          e instanceof Error
            ? e.message
            : "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      });
    }
  }

  @Put("google/sheets/config")
  async sheetsConfig(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as Partial<GoogleSheetsConfig>;
    const integration = await updateSheetsConfigDb(result.ctx, {
      spreadsheetId: body.spreadsheetId ?? null,
      spreadsheetName: body.spreadsheetName ?? null,
      worksheetId: body.worksheetId ?? null,
      worksheetName: body.worksheetName ?? null,
      columnMappings: body.columnMappings ?? [],
      autoSync: body.autoSync ?? false,
      lastSyncResult: body.lastSyncResult ?? null,
      lastSyncMessage: body.lastSyncMessage ?? null,
    });

    if (!integration) {
      return res.status(404).json({ error: "Integration not found" });
    }

    return res.json({ integration });
  }

  @Get("google/sheets/spreadsheets")
  async listSpreadsheets(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsRead(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const spreadsheets = await getSpreadsheetsDb(result.ctx);
      return res.json({ spreadsheets });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : "Failed to list spreadsheets",
      });
    }
  }

  @Post("google/sheets/spreadsheets")
  async createSpreadsheet(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as { name?: string; columns?: ColumnMapping[] };
    const name =
      body.name?.trim() ||
      `PropNex Sheet ${new Date().toLocaleDateString()}`;

    try {
      const spreadsheet = await createSpreadsheetDb(
        result.ctx,
        name,
        body.columns ?? [],
      );
      return res.json({ spreadsheet });
    } catch (e) {
      const status = e instanceof GoogleSheetsScopeError ? 400 : 500;
      return res.status(status).json({
        error:
          e instanceof Error ? e.message : "Failed to create spreadsheet",
      });
    }
  }

  @Post("google/sheets/spreadsheets/create")
  async createSpreadsheetAlias(@Req() req: Request, @Res() res: Response) {
    return this.createSpreadsheet(req, res);
  }

  @Delete("google/sheets/spreadsheets")
  async deleteSpreadsheet(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const spreadsheetId = req.query.spreadsheetId as string | undefined;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId required" });
    }

    try {
      const integration = await deleteSpreadsheetDb(result.ctx, spreadsheetId);
      const spreadsheets = await getSpreadsheetsDb(result.ctx);
      return res.json({ integration, spreadsheets });
    } catch (e) {
      return res.status(500).json({
        error:
          e instanceof Error ? e.message : "Failed to delete spreadsheet",
      });
    }
  }

  @Get("google/sheets/worksheets")
  async worksheets(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsRead(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const spreadsheetId = req.query.spreadsheetId as string | undefined;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId required" });
    }

    const worksheets = await getWorksheetsDb(result.ctx, spreadsheetId);
    return res.json({ worksheets });
  }

  @Get("google/sheets/headers")
  async headers(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsRead(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const spreadsheetId = req.query.spreadsheetId as string | undefined;
    const worksheetName = (req.query.worksheetName as string) ?? "Sheet1";

    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId required" });
    }

    try {
      const headers = await getSheetHeaders(
        result.ctx,
        spreadsheetId,
        worksheetName,
      );
      return res.json({ headers });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : "Failed to fetch headers",
      });
    }
  }

  @Post("google/sheets/sync")
  async sheetsSync(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      await triggerSheetsSyncDb(result.ctx);
      const rowsSynced = await syncSheetsDataDb(result.ctx);
      const integration = await completeSheetsSyncDb(
        result.ctx,
        `Synced ${rowsSynced} row(s) successfully`,
        rowsSynced,
      );
      return res.json({ integration });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      const integration = await completeSheetsSyncDb(
        result.ctx,
        message,
        0,
        "error",
      );
      return res.status(500).json({ error: message, integration });
    }
  }

  @Get("google/sheets/sync-history")
  async syncHistory(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsRead(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const history = await getSyncHistoryDb(result.ctx);
    return res.json({ history });
  }

  @Put("google/calendar/config")
  async calendarConfig(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as Partial<GoogleCalendarConfig>;
    const integration = await updateCalendarConfigDb(result.ctx, {
      calendarId: body.calendarId ?? null,
      calendarName: body.calendarName ?? null,
      timezone: body.timezone ?? "Asia/Kolkata",
      workingHours: body.workingHours ?? DEFAULT_WORKING_HOURS,
      meetingDurationMinutes: body.meetingDurationMinutes ?? 30,
      bufferMinutes: body.bufferMinutes ?? 15,
    });

    if (!integration) {
      return res.status(404).json({ error: "Integration not found" });
    }

    return res.json({ integration });
  }

  @Get("google/calendar/calendars")
  async calendars(@Req() req: Request, @Res() res: Response) {
    const result = await requireIntegrationsRead(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const calendars = await getCalendarsDb(result.ctx);
    return res.json({ calendars });
  }

  @Get(":id")
  async getById(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const integration = await getIntegrationById(
      result.ctx,
      id as IntegrationId,
    );
    if (!integration) {
      return res.status(404).json({ error: "Integration not found" });
    }

    return res.json({ integration });
  }

  @Post(":id/connect")
  async connect(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    if (isGoogleIntegration(id as IntegrationId)) {
      return res.status(400).json({
        error: "Use Google OAuth to connect this integration",
      });
    }

    const integration = await connectIntegrationDb(
      result.ctx,
      id as IntegrationId,
    );
    if (!integration) {
      return res.status(404).json({ error: "Integration not found" });
    }

    return res.json({ integration });
  }

  @Post(":id/disconnect")
  async disconnect(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const result = await requireIntegrationsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const integration = await disconnectIntegrationDb(
      result.ctx,
      id as IntegrationId,
    );
    if (!integration) {
      return res.status(404).json({ error: "Integration not found" });
    }

    return res.json({ integration });
  }
}
