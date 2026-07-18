import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { getAuthFromRequest } from "@/auth/clerk";
import { handleTenantResult, sendAppErrorResponse } from "@/lib/api/http";
import {
  requireTenantContext,
  requireTenantPermission,
} from "@/lib/api/tenant-context";
import { PERMISSIONS } from "@/lib/permissions";
import { submitContactRequest } from "@/modules/contact-requests/contact-request.handler";
import { isAppError } from "@/server/lib/errors";
import prisma from "@/server/lib/prisma";
import { TenantRepository } from "@/server/repositories/tenant.repository";
import { reconcileInviteMembershipOnLogin } from "@/server/services/clerk-provision.service";
import { companyService } from "@/server/services/company.service";
import { contractService } from "@/server/services/contract.service";

const tenantRepo = new TenantRepository(prisma);

const contactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  title: z.string().optional(),
});

const linkSchema = z.object({
  contractId: z.string().min(1, "Contract ID is required"),
});

@Controller("api/company")
export class CompanyController {
  @Get("contact")
  async getContact(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantContext(req);
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const contact = await companyService.getContact(result.ctx);
      return res.json({ contact });
    } catch (err) {
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Put("contact")
  async putContact(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.SETTINGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = contactSchema.parse(req.body);
      const contact = await companyService.upsertContact(result.ctx, {
        name: body.name.trim(),
        email: body.email.trim(),
        phone: body.phone?.trim() || undefined,
        title: body.title?.trim() || undefined,
      });
      return res.json({ contact });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: err.issues[0]?.message ?? err.message });
      }
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get("contract")
  async getContract(@Req() req: Request, @Res() res: Response) {
    const { userId, orgId } = await getAuthFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const dbUser = await tenantRepo.findUserByClerkId(userId);
      if (dbUser) {
        const invitedMembership = await prisma.companyMember.findFirst({
          where: { userId: dbUser.id, status: "INVITED" },
        });
        const pendingBranchInvite = await prisma.branchInvitation.findFirst({
          where: {
            email: { equals: dbUser.email, mode: "insensitive" },
            status: "PENDING",
          },
        });
        if (invitedMembership || pendingBranchInvite) {
          await reconcileInviteMembershipOnLogin(userId, orgId);
        }
      }

      const status = await contractService.getContractLinkStatus(userId);
      return res.json(status);
    } catch (err) {
      if (isAppError(err)) {
        return sendAppErrorResponse(res, err);
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Post("contract/link")
  async linkContract(@Req() req: Request, @Res() res: Response) {
    const { userId } = await getAuthFromRequest(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const body = linkSchema.parse(req.body);
      const result = await contractService.linkContractId(
        userId,
        body.contractId,
      );
      return res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: err.issues[0]?.message ?? err.message });
      }
      if (isAppError(err)) {
        // #region agent log
        fetch('http://127.0.0.1:7337/ingest/56a44334-4141-484c-bb9b-95d1a3690082',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ead72'},body:JSON.stringify({sessionId:'1ead72',location:'company.controller.ts:linkContract',message:'contract link app error',data:{code:err.code,statusCode:err.statusCode},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        return sendAppErrorResponse(res, err);
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}

@Controller("api/contact-requests")
export class ContactRequestsController {
  @Post()
  async submit(@Req() req: Request, @Res() res: Response) {
    const result = await submitContactRequest(req);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  }
}
