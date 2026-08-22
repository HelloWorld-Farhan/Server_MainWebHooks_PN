import { Body, Controller, Get, Post, Req, Res, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import prisma from "@/server/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "default-secret-key";
const JWT_EXPIRES_IN = "1d";

@Controller("api/users")
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  // â”€â”€â”€ AUTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Post("signup")
  async signup(@Req() req: Request, @Res() res: Response) {
    try {
      const { firstName, lastName, email, phone, password, confirmPassword } = req.body as {
        firstName: string;
        lastName: string;
        email: string;
        phone?: string;
        password: string;
        confirmPassword: string;
      };

      if (!firstName?.trim() || !lastName?.trim()) {
        return res.status(400).json({ message: "First and last name are required" });
      }
      if (!email?.trim()) {
        return res.status(400).json({ message: "Email is required" });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Check duplicate
      const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existing) {
        return res.status(409).json({ message: "Email already registered" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const clerkUserId = `local_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const newUser = await prisma.user.create({
        data: {
          email: normalizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone || null,
          passwordHash,
          clerkUserId,
          status: "ACTIVE",
        } as any,
      });

      // Create PendingApproval so admin panel gets notified
      try {
        await prisma.pendingApproval.create({
          data: { email: normalizedEmail },
        });
      } catch (e) {
        this.logger.warn(`PendingApproval creation failed for ${normalizedEmail}: ${e}`);
      }

      // Fire Google Apps Script registration webhook (fire-and-forget)
      const webhookUrl = "https://script.google.com/macros/s/AKfycbz2zj_l7vcmiPZKuYqEVdso0apyW3aDJZZWTVTJ1jRrQr8PLGZIH_TzRpTLFskphIwgDQ/exec";
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "new_registration",
          name: `${newUser.firstName} ${newUser.lastName}`.trim(),
          email: newUser.email,
        }),
      }).catch((err) => this.logger.error(`Registration webhook failed: ${err}`));

      const accessToken = jwt.sign(
        { sub: newUser.id, email: newUser.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN },
      );

      return res.status(201).json({
        accessToken,
        access_token: accessToken,
        user: {
          id: newUser.id,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          email: newUser.email,
          phone: newUser.phone,
          companyId: null,
          contractId: null,
        },
      });
    } catch (err: any) {
      this.logger.error(`POST /api/users/signup failed: ${err}`);
      return res.status(500).json({ message: err.message || "Internal server error" });
    }
  }

  @Post("signin")
  async signin(@Req() req: Request, @Res() res: Response) {
    try {
      const { email, password } = req.body as { email: string; password: string };

      if (!email?.trim() || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const passwordHash = (user as any).passwordHash;
      if (!passwordHash) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(password, passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Fetch company membership
      const membership = await prisma.companyMember.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        include: { company: true },
      });
      const companyId = membership?.companyId || null;
      const contractId = membership?.company?.contractId || null;

      const accessToken = jwt.sign(
        { sub: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN },
      );

      return res.json({
        accessToken,
        access_token: accessToken,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          companyId,
          contractId,
          approvalStatus: companyId ? "APPROVED" : "PENDING",
        },
      });
    } catch (err: any) {
      this.logger.error(`POST /api/users/signin failed: ${err}`);
      return res.status(500).json({ message: err.message || "Internal server error" });
    }
  }

  // â”€â”€â”€ PROFILE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Get("me")
  async getMe(@Req() req: Request, @Res() res: Response) {
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
      
      // Attempt to get email or userId from the JWT payload
      const email = payload.email || payload.sub; 
      if (!email) {
        return res.status(401).json({ error: "No email found in token payload" });
      }

      // Find user in our main database by email
      const dbUser = await prisma.user.findFirst({
        where: { email },
        include: {
          memberships: {
            include: { company: true },
            where: { status: "ACTIVE" }
          }
        }
      });

      if (!dbUser) {
        return res.status(404).json({ error: "User not found in main DB" });
      }

      const activeMembership = dbUser.memberships[0];
      const companyId = activeMembership?.companyId || null;
      let company = activeMembership?.company || null;
      
      // Auto-unblock logic
      if (company && company.status === "SUSPENDED" && (company as any).blockedUntil) {
        const blockedUntilDate = new Date((company as any).blockedUntil);
        if (blockedUntilDate <= new Date()) {
          // Time has passed, unblock the company
          company = await prisma.company.update({
            where: { id: company.id },
            data: { status: "ACTIVE", blockedUntil: null }
          });
        }
      }

      const contractId = company?.contractId || null;
      
      let assignedNumber = "Not Assigned";
      let creditBalance: any = null;

      if (companyId) {
          const [companyPhones, balance] = await Promise.all([
            prisma.phoneNumber.findMany({
              where: {
                OR: [
                  { companyId: companyId },
                  { assignedParentTenantId: companyId }
                ],
              }
            }),
            prisma.company.findUnique({
              where: { id: companyId },
              select: { creditBalance: true }
            })
          ]);
  
          if (companyPhones && companyPhones.length > 0) {
            assignedNumber = companyPhones
              .map((p: any) => p.number || p.phoneNumberId)
              .filter(Boolean)
              .join(", ");
          }
        if (balance) {
          creditBalance = balance;
          
          // If this is a parent company, we DO NOT aggregate the creditsRemaining from its sub-companies
          // The parent dashboard should only show the unallocated parent credits.
          // The parent's creditsUsed already tracks total usage.
        }
      }

      let userStatus = dbUser.status;
      if (company && company.status === "SUSPENDED") {
        userStatus = "SUSPENDED";
      }

      return res.json({
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          phone: dbUser.phone || "Not set",
          companyId,
          contractId,
          assignedNumber,
          creditBalance,
          role: activeMembership?.role || "AGENT",
          status: userStatus,
          blockedUntil: company ? (company as any).blockedUntil : null,
          approvalStatus: companyId ? "APPROVED" : "PENDING"
        }
      });
    } catch (error) {
      console.error("GET /api/users/me error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get("dashboard-stats")
  async getDashboardStats(@Req() req: Request, @Res() res: Response) {
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
      
      const targetCompanyId = req.query.companyId as string | undefined;
      const companyId = targetCompanyId || dbUser?.memberships[0]?.companyId;
      if (!companyId) {
        return res.json({
          inboundCalls: 0,
          outboundCalls: 0,
          activeAgents: 0,
          creditsUsed: 0,
          inboundTrend: 0,
          outboundTrend: 0,
          agentsTrend: 0,
          creditsTrend: 0
        });
      }

      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (!company) {
        return res.json({
          inboundCalls: 0,
          outboundCalls: 0,
          activeAgents: 0,
          creditsUsed: 0,
          inboundTrend: 0,
          outboundTrend: 0,
          agentsTrend: 0,
          creditsTrend: 0
        });
      }

      let companyIdsToQuery = [company.id];
      if (!targetCompanyId) {
         const subCompanies = await prisma.company.findMany({
           where: { parentCompanyId: company.id },
           select: { id: true }
         });
         companyIdsToQuery = [company.id, ...subCompanies.map((c: any) => c.id)];
      }

      const now = new Date();
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      const [
        inboundCalls,
        outboundCalls,
        activeAgents,
        creditBalances,
        pastInboundCalls,
        pastOutboundCalls
      ] = await Promise.all([
        prisma.callLog.count({
          where: { companyId: { in: companyIdsToQuery }, direction: "INBOUND", startedAt: { gte: startOfThisMonth } }
        }),
        prisma.callLog.count({
          where: { companyId: { in: companyIdsToQuery }, direction: "OUTBOUND", startedAt: { gte: startOfThisMonth } }
        }),
        prisma.aiAgent.count({
          where: { companyId: { in: companyIdsToQuery }, status: "ACTIVE" }
        }),
        prisma.creditBalance.findMany({
          where: { companyId: { in: companyIdsToQuery } }
        }),
        prisma.callLog.count({
          where: { companyId: { in: companyIdsToQuery }, direction: "INBOUND", startedAt: { gte: startOfLastMonth, lte: endOfLastMonth } }
        }),
        prisma.callLog.count({
          where: { companyId: { in: companyIdsToQuery }, direction: "OUTBOUND", startedAt: { gte: startOfLastMonth, lte: endOfLastMonth } }
        })
      ]);

      const totalCreditsUsed = creditBalances.reduce((sum: number, cb: any) => sum + (cb.creditsUsed || 0), 0);
      
      const calcTrend = (current: number, past: number) => {
        if (past === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - past) / past) * 100);
      };

      return res.json({
        inboundCalls,
        outboundCalls,
        activeAgents,
        creditsUsed: totalCreditsUsed > 0 ? totalCreditsUsed : 0,
        inboundTrend: calcTrend(inboundCalls, pastInboundCalls),
        outboundTrend: calcTrend(outboundCalls, pastOutboundCalls),
        agentsTrend: 0,
        creditsTrend: 0 // Credit trend is hard to calculate without historical snapshots of creditBalance, so we leave it at 0
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get("recent-activity")
  async getRecentActivity(@Req() req: Request, @Res() res: Response) {
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
      
      const companyId = dbUser?.memberships[0]?.companyId;
      if (!companyId) return res.json([]);

      const subCompanies = await prisma.company.findMany({
        where: { parentCompanyId: companyId },
        select: { id: true }
      });
      const companyIdsToQuery = [companyId, ...subCompanies.map(c => c.id)];

      // Fetch latest 5 calls across parent and subcompanies
      const recentCalls = await prisma.callLog.findMany({
        where: { companyId: { in: companyIdsToQuery } },
        orderBy: { createdAt: "desc" },
        take: 5
      });

      const timeAgo = (date: Date) => {
        const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + "y ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + "mo ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + "d ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + "h ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + "m ago";
        return Math.floor(seconds) + "s ago";
      };

      const activities = recentCalls.map(call => {
        const isCompleted = call.status === "COMPLETED" || call.status?.toString().toLowerCase() === "completed";
        const statusText = isCompleted ? "Completed" : "Missed";
        const webhook = call.providerWebhook as any;
        const phone = webhook?.phone || webhook?.message?.call?.customer?.number || webhook?.message?.call?.phoneNumber || "Unknown";
        return {
          id: call.id,
          type: call.direction === "INBOUND" ? "inbound" : "outbound",
          title: call.direction === "INBOUND" ? "Inbound Call" : "Outbound Call",
          description: `${statusText} call from ${phone} (${call.durationSeconds || 0}s)`,
          timestamp: timeAgo(new Date(call.createdAt))
        };
      });

      return res.json(activities);
    } catch (error) {
      console.error("GET /api/users/recent-activity error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  @Get("calls/inbound")
  async getInboundCalls(@Req() req: Request, @Res() res: Response) {
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
      
      const authCompanyId = dbUser?.memberships[0]?.companyId;
      if (!authCompanyId) {
        return res.status(403).json({ error: "No active company found for user" });
      }

      const targetCompanyId = req.query.companyId as string | undefined;
      let companyIdsToQuery = [authCompanyId];

      if (targetCompanyId) {
        const subCompanies = await prisma.company.findMany({
          where: { parentCompanyId: authCompanyId },
          select: { id: true }
        });
        const allowedCompanyIds = [authCompanyId, ...subCompanies.map(c => c.id)];
        
        if (allowedCompanyIds.includes(targetCompanyId)) {
          // If the target is the auth company itself, aggregate it with its sub-companies
          if (targetCompanyId === authCompanyId) {
            companyIdsToQuery = allowedCompanyIds;
          } else {
            companyIdsToQuery = [targetCompanyId];
          }
        } else {
          return res.status(403).json({ error: "Forbidden: Cannot access calls for this company" });
        }
      } else {
        const subCompanies = await prisma.company.findMany({
          where: { parentCompanyId: authCompanyId },
          select: { id: true }
        });
        companyIdsToQuery = [authCompanyId, ...subCompanies.map(c => c.id)];
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      let direction = (req.query.direction as string)?.toUpperCase();
      if (direction !== "INBOUND" && direction !== "OUTBOUND") {
        direction = "INBOUND";
      }

      const [total, data] = await Promise.all([
        prisma.callLog.count({
          where: { companyId: { in: companyIdsToQuery }, direction: direction as any }
        }),
        prisma.callLog.findMany({
          where: { companyId: { in: companyIdsToQuery }, direction: direction as any },
          orderBy: { startedAt: "desc" },
          skip,
          take: limit,
        })
      ]);

      return res.json({
        data,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error: any) {
      console.error("GET /api/users/calls/inbound error:", error);
      return res.status(500).json({ error: error.message || "Internal server error" });
    }
  }

  @Post("request-topup")
  async requestTopup(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ message: "Invalid token" });
      const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
      const email = payload.email || payload.sub;

      const { amount } = req.body as { amount: number };
      if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: "Please enter a valid credit amount." });
      }

      // Resolve user
      const user = await prisma.user.findFirst({ where: { email } });
      if (!user) return res.status(404).json({ message: "User not found" });

      // Resolve company via membership
      const membership = await prisma.companyMember.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        include: { company: true },
      });
      if (!membership?.company) {
        return res.status(400).json({ message: "No active company found for your account. Please contact support." });
      }
      const company = membership.company;

      // Check credit balance limit (max 10,000)
      const creditBalance = await prisma.creditBalance.findUnique({ where: { companyId: company.id } });
      const currentBalance = creditBalance?.creditsRemaining ?? 0;
      if (currentBalance + amount > 10000) {
        return res.status(400).json({
          message: `Cannot exceed 10,000 maximum limit. You can request up to ${10000 - currentBalance} more credits.`,
        });
      }

      // Block if a pending credit request already exists for this company
      const existingRequest = await prisma.supportRequest.findFirst({
        where: { companyId: company.id, reason: "BILLING_CREDITS", status: "NEW" },
      });
      if (existingRequest) {
        return res.status(409).json({ error: "already_pending", message: "You already have a pending credit request. Please wait for the admin to process it before submitting a new one." });
      }

      // Save SupportRequest so admin can see it
      try {
        await prisma.supportRequest.create({
          data: {
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown User",
            email: user.email,
            reason: "BILLING_CREDITS",
            message: `Credit top-up request: ${amount} credits`,
            status: "NEW",
            userId: user.id,
            companyId: company.id,
          },
        });
      } catch (e) {
        this.logger.warn(`SupportRequest creation failed: ${e}`);
      }

      // Fire Google Apps Script webhook (fire-and-forget)
      const webhookUrl = process.env.GOOGLE_SCRIPT_WEBHOOK_URL ||
        "https://script.google.com/macros/s/AKfycbz2zj_l7vcmiPZKuYqEVdso0apyW3aDJZZWTVTJ1jRrQr8PLGZIH_TzRpTLFskphIwgDQ/exec";
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "credit_request",
          amount,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
          email: user.email,
          companyId: company.id,
          companyName: company.name,
        }),
      }).catch((err) => this.logger.error(`Credit request webhook failed: ${err}`));

      return res.json({ success: true, requestedAmount: amount });
    } catch (err: any) {
      this.logger.error(`POST /api/users/request-topup failed: ${err}`);
      return res.status(500).json({ message: err.message || "Internal server error" });
    }
  }

  @Get("billing-history")
  async getBillingHistory(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ error: "Invalid token" });
      const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
      const email = payload.email || payload.sub;

      const user = await prisma.user.findFirst({
        where: { email },
        include: { memberships: { where: { status: "ACTIVE" } } },
      });
      const companyId = user?.memberships[0]?.companyId;
      if (!companyId) return res.json([]);

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const usageRecords = await prisma.creditUsage.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });

      const history = usageRecords.map((r) => ({
        id: r.id,
        date: r.createdAt,
        description: r.description || r.reason,
        type: r.amount > 0 ? "credit" : "debit",
        credits: Math.abs(r.amount),
        amount: null,
        status: "COMPLETED",
        reason: r.reason,
      }));

      return res.json(history);
    } catch (err: any) {
      this.logger.error(`GET /api/users/billing-history failed: ${err}`);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  /** Check if the calling user's company has a pending credit top-up request */
  @Get("pending-topup")
  async getPendingTopup(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ error: "Invalid token" });
      const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
      const email = payload.email || payload.sub;

      const user = await prisma.user.findFirst({
        where: { email },
        include: { memberships: { where: { status: "ACTIVE" } } },
      });
      const companyId = user?.memberships[0]?.companyId;
      if (!companyId) return res.json({ hasPending: false });

      const existing = await prisma.supportRequest.findFirst({
        where: { companyId, reason: "BILLING_CREDITS", status: "NEW" },
      });

      return res.json({ hasPending: !!existing });
    } catch (err: any) {
      this.logger.error(`GET /api/users/pending-topup failed: ${err}`);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }

  /** Send a waiting-room approval reminder to admin (24h dedup — upserts existing notification) */
  @Post("remind-admin")
  async remindAdmin(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return res.status(401).json({ message: "Invalid token" });
      const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
      const email = payload.email || payload.sub;

      const user = await prisma.user.findFirst({ where: { email } });
      if (!user) return res.status(404).json({ message: "User not found" });

      // 24h cooldown via SupportRequest sentinel row (no schema change needed)
      const existing = await prisma.supportRequest.findFirst({
        where: { email: user.email, reason: "OTHER", message: "Approval Reminder" },
      });

      if (existing) {
        const hoursSince = (Date.now() - existing.updatedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          return res.status(429).json({ error: "24h_lock", message: "You can only send a reminder once every 24 hours." });
        }
        await prisma.supportRequest.update({
          where: { id: existing.id },
          data: { updatedAt: new Date() },
        });
      } else {
        const userName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown User";
        await prisma.supportRequest.create({
          data: {
            name: userName,
            email: user.email,
            reason: "OTHER",
            message: "Approval Reminder",
            status: "RESOLVED",
            userId: user.id,
          },
        });
      }

      // Fire webhook email to admin (only send email — no new notification created in admin DB)
      const webhookUrl = process.env.GOOGLE_SCRIPT_WEBHOOK_URL ||
        "https://script.google.com/macros/s/AKfycbz2zj_l7vcmiPZKuYqEVdso0apyW3aDJZZWTVTJ1jRrQr8PLGZIH_TzRpTLFskphIwgDQ/exec";
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "reminder_approval",
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown User",
          email: user.email,
        }),
      }).catch((err) => this.logger.error(`Reminder webhook failed: ${err}`));

      return res.json({ success: true });
    } catch (err: any) {
      this.logger.error(`POST /api/users/remind-admin failed: ${err}`);
      return res.status(500).json({ message: err.message || "Internal server error" });
    }
  }
}
