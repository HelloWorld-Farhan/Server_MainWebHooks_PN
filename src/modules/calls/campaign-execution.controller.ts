import { Controller, Post, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import prisma from "@/server/lib/prisma";
import { startCampaignJob, getCampaignState, clearCampaignState } from "@/server/queues/campaign-execution.queue";

const JWT_SECRET = process.env.JWT_SECRET || "propnex_secret_jwt_key_2026_key";

async function getCompanyIdFromToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  
  const token = authHeader.split(" ")[1];
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub || decoded.id;
    
    if (!userId) return null;
    
    const member = await prisma.companyMember.findFirst({
      where: { userId, status: "ACTIVE" }
    });
    
    return member?.companyId || null;
  } catch (err) {
    return null;
  }
}

@Controller("api/campaign-execution")
export class OutboundCampaignExecutionController {
  
  @Post("start")
  async startCampaign(@Req() req: Request, @Res() res: Response) {
    const tokenCompanyId = await getCompanyIdFromToken(req);
    if (!tokenCompanyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { campaignId, didNumber, leads, channels, companyId: requestedCompanyId } = req.body;
      
      let finalCompanyId = tokenCompanyId;
      if (requestedCompanyId && requestedCompanyId !== tokenCompanyId) {
        // Verify user has access to this sub-company
        const subCompany = await prisma.company.findFirst({
          where: { id: requestedCompanyId, parentCompanyId: tokenCompanyId }
        });
        if (!subCompany) {
          return res.status(403).json({ error: "Forbidden: Not a valid sub-company" });
        }
        finalCompanyId = requestedCompanyId;
      }
      
      if (!didNumber || !leads || leads.length === 0) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      await startCampaignJob({
        companyId: finalCompanyId,
        campaignId: campaignId || "manual",
        didNumber,
        leads,
        channels: channels || 2
      });

      return res.json({ success: true, message: "Campaign queued successfully" });
    } catch (e: any) {
      console.error("Failed to start campaign", e);
      return res.status(500).json({ error: e.message });
    }
  }

  @Get("status")
  async getStatus(@Req() req: Request, @Res() res: Response) {
    const tokenCompanyId = await getCompanyIdFromToken(req);
    if (!tokenCompanyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const requestedCompanyId = req.query.companyId as string | undefined;
      let finalCompanyId = tokenCompanyId;
      if (requestedCompanyId && requestedCompanyId !== tokenCompanyId) {
        const subCompany = await prisma.company.findFirst({
          where: { id: requestedCompanyId, parentCompanyId: tokenCompanyId }
        });
        if (!subCompany) {
          return res.status(403).json({ error: "Forbidden: Not a valid sub-company" });
        }
        finalCompanyId = requestedCompanyId;
      }

      const state = await getCampaignState(finalCompanyId);
      return res.json({ success: true, data: state });
    } catch (e: any) {
      console.error("Failed to fetch campaign state", e);
      return res.status(500).json({ error: e.message });
    }
  }

  @Post("clear")
  async clearCampaign(@Req() req: Request, @Res() res: Response) {
    const tokenCompanyId = await getCompanyIdFromToken(req);
    if (!tokenCompanyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const requestedCompanyId = req.body?.companyId;
      let finalCompanyId = tokenCompanyId;
      if (requestedCompanyId && requestedCompanyId !== tokenCompanyId) {
        const subCompany = await prisma.company.findFirst({
          where: { id: requestedCompanyId, parentCompanyId: tokenCompanyId }
        });
        if (!subCompany) {
          return res.status(403).json({ error: "Forbidden: Not a valid sub-company" });
        }
        finalCompanyId = requestedCompanyId;
      }

      await clearCampaignState(finalCompanyId);
      return res.json({ success: true, message: "Campaign state cleared" });
    } catch (e: any) {
      console.error("Failed to clear campaign state", e);
      return res.status(500).json({ error: e.message });
    }
  }
}
