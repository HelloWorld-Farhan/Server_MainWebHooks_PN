import { Body, Controller, Get, Post, Req, Res, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { requireTenantContext } from "@/lib/api/tenant-context";
import { handleTenantResult, sendAppErrorResponse } from "@/lib/api/http";
import prisma from "@/server/lib/prisma";
import { isAppError } from "@/server/lib/errors";
import { generateContractId } from "@/server/lib/contract-id";
import { notificationService } from "@/server/services/notification.service";

const createSubCompanySchema = z.object({
  companyName: z.string().min(1, "Company Name is required"),
  companyEmail: z.string().optional().or(z.literal("")),
  allocatedCredits: z.number().min(0, "Allocated credits cannot be negative"),
});

@Controller("api/sub-companies")
export class SubCompaniesController {
  private readonly logger = new Logger(SubCompaniesController.name);

  @Get()
  async getSubCompanies(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ error: "Invalid token" });
      const payloadStr = Buffer.from(payloadBase64, "base64").toString("utf-8");
      const payload = JSON.parse(payloadStr);
      const email = payload.email || payload.sub; 

      const dbUser = await prisma.user.findFirst({
        where: { email },
        include: { memberships: { where: { status: "ACTIVE" } } }
      });

      const parentCompanyId = dbUser?.memberships[0]?.companyId;
      if (!parentCompanyId) return res.status(403).json({ error: "Tenant not found" });

      const subCompanies = await prisma.company.findMany({
        where: { parentCompanyId } as any,
        orderBy: { createdAt: "desc" },
        include: {
          creditBalance: true,
          phoneNumbers: true,
          callLogs: {
            where: { direction: "INBOUND" },
          },
          _count: {
            select: { callLogs: true }
          }
        }
      });

      // Format them to match what the frontend expects
      const formatted = subCompanies.map((c: any) => {
        const allNumbers = (c.phoneNumbers || []).map((p: any) => ({
          number: p.number,
          direction: p.direction || "GENERAL",
          channels: p.channels,
          agentUrl: p.agentUrl
        }));
        return {
          _id: c.id,
          companyName: c.name,
          companyEmail: "", 
          contactPhone: allNumbers[0]?.number || "",     // first number (backward compat)
          assignedNumbers: allNumbers,            // ALL numbers
          status: c.status.toLowerCase(),
          createdAt: c.createdAt.toISOString(),
          creditsUsed: c.creditBalance?.creditsUsed || 0,
          creditsRemaining: c.creditBalance?.creditsRemaining || 0,
          inboundCalls: c.callLogs?.length || 0,
          outboundCalls: (c._count?.callLogs || 0) - (c.callLogs?.length || 0)
        };
      });

      return res.json(formatted);
    } catch (err) {
      if (isAppError(err)) {
        return sendAppErrorResponse(res, err);
      }
      this.logger.error(`GET /api/sub-companies failed: ${err}`);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Post()
  async createSubCompany(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ error: "Invalid token" });
      const payloadStr = Buffer.from(payloadBase64, "base64").toString("utf-8");
      const payload = JSON.parse(payloadStr);
      const email = payload.email || payload.sub; 

      const dbUser = await prisma.user.findFirst({
        where: { email },
        include: { memberships: { where: { status: "ACTIVE" } } }
      });

      const parentCompanyId = dbUser?.memberships[0]?.companyId;
      if (!parentCompanyId) return res.status(403).json({ error: "Tenant not found" });

      const body = createSubCompanySchema.parse(req.body);
      const contractId = generateContractId();

      // Start a transaction to deduct credits and create the sub-company
      const result = await prisma.$transaction(async (tx) => {
        const parentCredit = await tx.creditBalance.findUnique({
          where: { companyId: parentCompanyId }
        });

        if (!parentCredit) {
          throw new Error("Parent company credit balance not found");
        }

        if (parentCredit.creditsRemaining < body.allocatedCredits) {
          throw new Error("Insufficient credits in main company");
        }

        // Deduct credits from parent
        await tx.creditBalance.update({
          where: { id: parentCredit.id },
          data: {
            creditsRemaining: { decrement: body.allocatedCredits }
          }
        });

        // Create the child company
        const newCompany = await tx.company.create({
          data: {
            name: body.companyName,
            slug: `sub-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            contractId,
            cli: `SUB${Math.floor(Math.random() * 10000)}`,
            companyCode: `CODE${Math.floor(Math.random() * 10000)}`,
            tenantType: "CHILD",
            parentCompanyId,
            status: "PENDING", // PENDING so Admin can verify and allocate number
          } as any,
        });

        // Create credit balance for child company
        await tx.creditBalance.create({
          data: {
            companyId: newCompany.id,
            creditsRemaining: body.allocatedCredits,
            creditsUsed: 0,
          } as any
        });

        const parentCompany = await tx.company.findUnique({
          where: { id: parentCompanyId },
          select: { name: true }
        });

        return { newCompany, parentCompanyName: parentCompany?.name || "Main Company" };
      });

      // Fire and forget notification
      notificationService.sendSubCompanyCreatedEmail({
        companyName: result.newCompany.name,
        parentCompanyName: result.parentCompanyName,
        allocatedCredits: body.allocatedCredits,
        email: body.companyEmail || "",
      }).catch(console.error);

      return res.json({
        _id: result.newCompany.id,
        companyName: result.newCompany.name,
        companyEmail: body.companyEmail || "",
        status: result.newCompany.status.toLowerCase(),
        createdAt: result.newCompany.createdAt.toISOString(),
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues[0]?.message ?? err.message });
      }
      if (isAppError(err)) {
        return sendAppErrorResponse(res, err);
      }
      this.logger.error(`POST /api/sub-companies failed:`, err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  @Post(":id/transfer-credits")
  async transferCredits(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ error: "Invalid token" });
      const payloadStr = Buffer.from(payloadBase64, "base64").toString("utf-8");
      const payload = JSON.parse(payloadStr);
      const email = payload.email || payload.sub; 

      const dbUser = await prisma.user.findFirst({
        where: { email },
        include: { memberships: { where: { status: "ACTIVE" } } }
      });

      const parentCompanyId = dbUser?.memberships[0]?.companyId;
      if (!parentCompanyId) return res.status(403).json({ error: "Tenant not found" });

      const childCompanyId = req.params.id as string;
      if (!childCompanyId) return res.status(400).json({ error: "Child company ID is required" });

      // Ensure child belongs to parent
      const childCompany = await prisma.company.findFirst({
        where: { id: childCompanyId, parentCompanyId }
      });

      if (!childCompany) {
        return res.status(404).json({ error: "Child company not found or does not belong to you" });
      }

      const bodySchema = z.object({
        amount: z.number().int().positive("Transfer amount must be positive"),
        action: z.enum(["ADD", "REDUCE"]).default("ADD"),
      });

      const { amount, action } = bodySchema.parse(req.body);

      // Perform transfer
      const result = await prisma.$transaction(async (tx) => {
        const parentCredit = await tx.creditBalance.findUnique({
          where: { companyId: parentCompanyId }
        });

        const childCreditCheck = await tx.creditBalance.findUnique({
          where: { companyId: childCompanyId }
        });

        if (action === "ADD") {
          if (!parentCredit || parentCredit.creditsRemaining < amount) {
            throw new Error("Insufficient credits in main company");
          }

          // Deduct from parent
          const updatedParent = await tx.creditBalance.update({
            where: { id: parentCredit.id },
            data: { creditsRemaining: { decrement: amount } }
          });

          // Add to child
          const childCredit = await tx.creditBalance.upsert({
            where: { companyId: childCompanyId },
            create: {
              companyId: childCompanyId,
              creditsRemaining: amount,
              creditsUsed: 0
            } as any,
            update: {
              creditsRemaining: { increment: amount }
            }
          });

          // Zero-credit warning check for parent
          if (parentCredit.creditsRemaining > 0 && updatedParent.creditsRemaining <= 0) {
            process.nextTick(async () => {
              try {
                const fullCompany = await prisma.company.findUnique({
                  where: { id: parentCompanyId },
                  include: { members: { where: { role: "OWNER", status: "ACTIVE" }, include: { user: true } } },
                });
                const user = fullCompany?.members?.[0]?.user;
                if (user && user.email) {
                  await notificationService.sendCreditZeroWarningEmail({
                    email: user.email,
                    name: user.firstName ? `${user.firstName} ${user.lastName}`.trim() : user.email.split("@")[0],
                  });
                }
              } catch (e) { console.error("Failed to process parent zero warning:", e); }
            });
          }

          return childCredit;
        } else {
          // REDUCE logic
          if (!childCreditCheck || childCreditCheck.creditsRemaining < amount) {
            throw new Error("Insufficient credits in sub-company to withdraw");
          }

          // Deduct from child
          const childCredit = await tx.creditBalance.update({
            where: { companyId: childCompanyId },
            data: { creditsRemaining: { decrement: amount } }
          });

          // Add back to parent
          if (parentCredit) {
            await tx.creditBalance.update({
              where: { id: parentCredit.id },
              data: { creditsRemaining: { increment: amount } }
            });
          }

          // Zero-credit warning check for child
          if (childCreditCheck.creditsRemaining > 0 && childCredit.creditsRemaining <= 0) {
            process.nextTick(async () => {
              try {
                const fullCompany = await prisma.company.findUnique({
                  where: { id: childCompanyId },
                  include: { members: { where: { role: "OWNER", status: "ACTIVE" }, include: { user: true } } },
                });
                const user = fullCompany?.members?.[0]?.user;
                if (user && user.email) {
                  await notificationService.sendSubCompanyCreditZeroWarningEmail({
                    email: user.email,
                    companyName: fullCompany.name,
                  });
                }
              } catch (e) { console.error("Failed to process child zero warning:", e); }
            });
          }

          return childCredit;
        }
      });

      return res.json({ success: true, newBalance: result.creditsRemaining });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues[0]?.message ?? err.message });
      }
      this.logger.error(`POST /api/sub-companies/:id/transfer-credits failed:`, err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }
}
