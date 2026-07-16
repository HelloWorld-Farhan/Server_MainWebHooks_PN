import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { billingSummary } from "@/lib/billing-data";
import { requireAgentsWrite } from "@/lib/integrations/api-guard";
import {
  appendSheetRowDb,
  readSheetRowDb,
  writeSheetRowDb,
  addCalendarEventDb,
  deleteCalendarEventDb,
  getCalendarEventsDb,
  updateCalendarEventDb,
  getCalendarConfigDb,
} from "@/lib/integrations/db-state";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";

import { delay, requireAuth } from "@/lib/api/auth";
import { handleTenantResult } from "@/lib/api/http";
import { requireTenantContext } from "@/lib/api/tenant-context";
import {
  parseContactPhoneUpload,
  SERVER_PARSE_EXTENSIONS,
} from "@/lib/contact-phone-file-parser";
import { DEFAULT_CONTACT_PHONE_COUNTRY } from "@/lib/country-dial-codes";
import { getContactPhoneUploadExtension } from "@/lib/contact-phone-import";
import { getAgentToolsDb, updateAgentToolDb } from "@/lib/integrations/db-state";
import type { AgentToolAssignment, AgentToolId } from "@/lib/tools/types";
import type { SheetRow } from "@/lib/integrations/types";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SERVER_EXTENSION_SET = new Set<string>(SERVER_PARSE_EXTENSIONS);

@Controller("api/agents")
export class AgentsController {
  @Get(":agentId/tools")
  async listTools(
    @Req() req: Request,
    @Res() res: Response,
    @Param("agentId") agentId: string,
  ) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const tools = await getAgentToolsDb(result.ctx, agentId);
    return res.json({ tools });
  }

  @Put(":agentId/tools/:toolId")
  async updateTool(
    @Req() req: Request,
    @Res() res: Response,
    @Param("agentId") agentId: string,
    @Param("toolId") toolId: string,
  ) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as Partial<AgentToolAssignment>;
    const tool = await updateAgentToolDb(
      result.ctx,
      agentId,
      toolId as AgentToolId,
      body,
    );
    return res.json({ tool });
  }

  @Post(":agentId/tools/:toolId")
  async healthCheck(
    @Req() req: Request,
    @Res() res: Response,
    @Param("agentId") agentId: string,
    @Param("toolId") toolId: string,
  ) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    await delay(800);

    const tool = await updateAgentToolDb(
      result.ctx,
      agentId,
      toolId as AgentToolId,
      {
        health: "healthy",
        usage: {
          totalExecutions: 1,
          successRate: 1,
          lastUsedAt: new Date().toISOString(),
          errorCount: 0,
        },
      },
    );

    return res.json({ tool, testResult: "passed" });
  }
}

@Controller("api/contact-phones")
export class ContactPhonesController {
  @Post("parse-upload")
  @UseInterceptors(FileInterceptor("file"))
  async parseUpload(
    @Req() req: Request,
    @Res() res: Response,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const result = await requireAgentsWrite(req);
    if (!handleTenantResult(res, result)) return;

    if (!file) {
      return res.status(400).json({ error: "A file is required." });
    }

    const extension = getContactPhoneUploadExtension(file.originalname);
    if (!extension || !SERVER_EXTENSION_SET.has(extension)) {
      return res.status(400).json({
        error:
          "Unsupported file type. Upload Excel (.xlsx/.xls), PDF, or Word (.docx).",
      });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: "File exceeds the 50 MB limit." });
    }

    const defaultCountryRaw = req.body?.defaultCountry;
    const defaultCountry =
      typeof defaultCountryRaw === "string" && defaultCountryRaw.trim()
        ? defaultCountryRaw.trim()
        : DEFAULT_CONTACT_PHONE_COUNTRY;

    try {
      const parseResult = await parseContactPhoneUpload(
        file.buffer,
        file.originalname,
        { defaultCountry },
      );

      if (parseResult.contacts.length === 0) {
        return res.status(400).json({
          error:
            parseResult.invalid > 0
              ? "No valid phone numbers found. Use country (ISO code) and a 10-digit phone column, or a supported default country for unstructured files."
              : "No phone numbers found in the uploaded file.",
        });
      }

      return res.json(parseResult);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to parse the uploaded file.";
      return res.status(400).json({ error: message });
    }
  }
}

@Controller("api/tools")
export class ToolsController {
  @Post("billing/lookup")
  async billingLookup(@Req() req: Request, @Res() res: Response) {
    const authResult = await requireAuth(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json(authResult.error.body);
    }

    const body = req.body as {
      permissions?: {
        creditAccess?: boolean;
        planAccess?: boolean;
        invoiceAccess?: boolean;
      };
    };
    const permissions = body.permissions ?? {
      creditAccess: true,
      planAccess: true,
      invoiceAccess: true,
    };

    const result: Record<string, unknown> = {};

    if (permissions.creditAccess) {
      result.credits = {
        remaining: billingSummary.remainingCredits,
        total: billingSummary.totalCredits,
        used: billingSummary.usedCredits,
      };
    }
    if (permissions.planAccess) {
      result.plan = {
        name: billingSummary.activePlan,
        resetDate: billingSummary.resetDate,
      };
    }
    if (permissions.invoiceAccess) {
      result.invoice = {
        nextAmount: billingSummary.nextInvoiceAmount,
        dueDate: billingSummary.nextInvoiceDue,
        status: "paid",
      };
    }

    return res.json(result);
  }

  @Post("faq/search")
  async faqSearch(@Req() req: Request, @Res() res: Response) {
    const authResult = await requireAuth(req);
    if (authResult.error) {
      return res.status(authResult.error.status).json(authResult.error.body);
    }

    const FAQ_ANSWERS: Record<string, string> = {
      pricing:
        "PropNex AI offers flexible plans starting from pay-as-you-go credits. Enterprise plans include custom integrations and dedicated support.",
      company:
        "PropNex AI is a voice AI platform for real estate and sales teams, enabling automated phone conversations with AI agents.",
      product:
        "Our platform includes inbound/outbound AI agents, call analytics, lead qualification, and integrations with CRM and calendar tools.",
      default:
        "I found some relevant information in our knowledge base. Would you like me to elaborate on a specific topic?",
    };

    const body = req.body as { query?: string; agentId?: string };
    const query = (body.query ?? "").toLowerCase();

    let answer = FAQ_ANSWERS.default;
    let confidence = 0.65;

    if (query.includes("price") || query.includes("cost") || query.includes("plan")) {
      answer = FAQ_ANSWERS.pricing;
      confidence = 0.92;
    } else if (
      query.includes("company") ||
      query.includes("about") ||
      query.includes("propnex")
    ) {
      answer = FAQ_ANSWERS.company;
      confidence = 0.88;
    } else if (query.includes("product") || query.includes("feature")) {
      answer = FAQ_ANSWERS.product;
      confidence = 0.85;
    }

    return res.json({ answer, confidence, sources: ["Product FAQ"] });
  }

  @Post("google-sheets/execute")
  async googleSheetsExecute(@Req() req: Request, @Res() res: Response) {
    const result = await requireAgentsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as {
      action: "read" | "write" | "append" | "update";
      rowIndex?: number;
      data?: SheetRow;
    };

    try {
      if (body.action === "read") {
        if (body.rowIndex === undefined) {
          return res.status(400).json({ error: "rowIndex required" });
        }
        const row = await readSheetRowDb(result.ctx, body.rowIndex);
        return res.json({ row });
      }

      if (body.action === "append" && body.data) {
        const row = await appendSheetRowDb(result.ctx, body.data);
        return res.json({ row });
      }

      if (
        (body.action === "write" || body.action === "update") &&
        body.data &&
        body.rowIndex !== undefined
      ) {
        const row = await writeSheetRowDb(
          result.ctx,
          body.rowIndex,
          body.data,
        );
        return res.json({ row });
      }

      return res.status(400).json({ error: "Invalid action" });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : "Execute failed",
      });
    }
  }

  @Post("google-calendar/events")
  async googleCalendarEvents(@Req() req: Request, @Res() res: Response) {
    const result = await requireAgentsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const body = req.body as {
      action: "create" | "reschedule" | "cancel" | "list";
      eventId?: string;
      title?: string;
      start?: string;
      end?: string;
      attendeeEmail?: string;
    };

    switch (body.action) {
      case "list":
        return res.json({ events: await getCalendarEventsDb(result.ctx) });
      case "create": {
        const event = await addCalendarEventDb(result.ctx, {
          title: body.title ?? "Appointment",
          start: body.start ?? new Date().toISOString(),
          end:
            body.end ??
            new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          attendeeEmail: body.attendeeEmail,
        });
        return res.json({ event });
      }
      case "reschedule": {
        if (!body.eventId) {
          return res.status(400).json({ error: "eventId required" });
        }
        const event = await updateCalendarEventDb(result.ctx, body.eventId, {
          start: body.start,
          end: body.end,
        });
        if (!event) {
          return res.status(404).json({ error: "Event not found" });
        }
        return res.json({ event });
      }
      case "cancel": {
        if (!body.eventId) {
          return res.status(400).json({ error: "eventId required" });
        }
        const deleted = await deleteCalendarEventDb(result.ctx, body.eventId);
        if (!deleted) {
          return res.status(404).json({ error: "Event not found" });
        }
        return res.json({ success: true });
      }
      default:
        return res.status(400).json({ error: "Invalid action" });
    }
  }

  @Post("google-calendar/availability")
  async googleCalendarAvailability(@Req() req: Request, @Res() res: Response) {
    const result = await requireAgentsWrite(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    const config = await getCalendarConfigDb(result.ctx);
    return res.json({
      available: true,
      timezone: config.timezone,
      workingHours: config.workingHours,
      meetingDurationMinutes: config.meetingDurationMinutes,
      bufferMinutes: config.bufferMinutes,
    });
  }
}
