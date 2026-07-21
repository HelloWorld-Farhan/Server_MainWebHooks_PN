import { Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { getAuthFromRequest } from "@/auth/clerk";
import {
  acceptCampaignInvitation,
  getCampaignInvitationByToken,
} from "@/modules/invitations/campaign-invitation.service";

@Controller("api/invitations/campaign")
export class InvitationsController {
  @Get(":token")
  async getInvitation(
    @Param("token") token: string,
    @Res() res: Response,
  ) {
    const result = await getCampaignInvitationByToken(token);
    return res.json(result);
  }

  @Post(":token/accept")
  async acceptInvitation(
    @Param("token") token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { userId } = await getAuthFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await acceptCampaignInvitation(token, userId);
    if (!result.success) {
      return res.status(result.statusCode).json({ error: result.error });
    }

    return res.json({ success: true });
  }
}
