import { clerkClient } from "@/auth/clerk";
import prisma from "@/server/lib/prisma";

export type CampaignInvitationErrorCode =
  | "not_found"
  | "accepted"
  | "cancelled"
  | "expired"
  | "not_pending";

export type CampaignInvitationView = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  campaign: { id: string; name: string };
  company: { id: string; name: string; clerkOrganizationId: string | null };
};

export type GetCampaignInvitationResult =
  | { valid: true; invitation: CampaignInvitationView }
  | {
      valid: false;
      error: CampaignInvitationErrorCode;
      message: string;
      expiresAt?: string;
    };

export async function getCampaignInvitationByToken(
  token: string,
): Promise<GetCampaignInvitationResult> {
  const invitation = await prisma.campaignInvitation.findUnique({
    where: { token },
    include: {
      campaign: true,
      company: true,
    },
  });

  if (!invitation) {
    return {
      valid: false,
      error: "not_found",
      message:
        "This invitation token is invalid, has been cancelled, or does not exist.",
    };
  }

  const now = new Date();
  const isExpired = invitation.expiresAt <= now;

  if (invitation.status === "ACCEPTED") {
    return {
      valid: false,
      error: "accepted",
      message:
        "This invitation has already been accepted and cannot be reused.",
    };
  }

  if (invitation.status === "CANCELLED") {
    return {
      valid: false,
      error: "cancelled",
      message: "This invitation has been cancelled by the administrator.",
    };
  }

  if (isExpired) {
    return {
      valid: false,
      error: "expired",
      message: `This invitation expired on ${invitation.expiresAt.toLocaleDateString()}. Please contact your administrator to generate a new invitation.`,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  if (invitation.status !== "PENDING") {
    return {
      valid: false,
      error: "not_pending",
      message:
        "This invitation token is invalid, has been cancelled, or does not exist.",
    };
  }

  return {
    valid: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      campaign: {
        id: invitation.campaign.id,
        name: invitation.campaign.name,
      },
      company: {
        id: invitation.company.id,
        name: invitation.company.name,
        clerkOrganizationId: invitation.company.clerkOrganizationId,
      },
    },
  };
}

export type AcceptCampaignInvitationResult =
  | { success: true }
  | { success: false; error: string; statusCode: number };

export async function acceptCampaignInvitation(
  token: string,
  clerkUserId: string,
): Promise<AcceptCampaignInvitationResult> {
  const invitation = await prisma.campaignInvitation.findUnique({
    where: { token },
    include: {
      campaign: true,
      company: true,
    },
  });

  if (!invitation || invitation.status !== "PENDING") {
    return {
      success: false,
      error: "Invitation is no longer pending",
      statusCode: 400,
    };
  }

  if (invitation.expiresAt <= new Date()) {
    return {
      success: false,
      error: "Invitation has expired",
      statusCode: 400,
    };
  }

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const activeEmail =
    clerkUser.emailAddresses.find(
      (entry) => entry.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

  if (!activeEmail) {
    return {
      success: false,
      error: "Email not found",
      statusCode: 400,
    };
  }

  if (activeEmail.toLowerCase() !== invitation.email.toLowerCase()) {
    return {
      success: false,
      error: "Mismatched email",
      statusCode: 403,
    };
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.campaignInvitation.findUnique({
      where: { id: invitation.id },
    });
    if (!current || current.status !== "PENDING") {
      throw new Error("Invitation is no longer pending");
    }

    await tx.campaignInvitation.update({
      where: { id: invitation.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
      },
    });

    let dbUser = await tx.user.findFirst({
      where: { email: { equals: activeEmail, mode: "insensitive" } },
    });

    if (dbUser) {
      if (dbUser.clerkUserId !== clerkUserId) {
        dbUser = await tx.user.update({
          where: { id: dbUser.id },
          data: { clerkUserId, status: "ACTIVE" },
        });
      }
    } else {
      dbUser = await tx.user.create({
        data: {
          clerkUserId,
          email: activeEmail,
          firstName: clerkUser.firstName,
          lastName: clerkUser.lastName,
          imageUrl: clerkUser.imageUrl,
          status: "ACTIVE",
        },
      });
    }

    const member = await tx.companyMember.upsert({
      where: {
        companyId_userId: {
          companyId: invitation.companyId,
          userId: dbUser.id,
        },
      },
      create: {
        companyId: invitation.companyId,
        userId: dbUser.id,
        role: "ADMIN",
        campaignAccessType: "SELECTED",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
      update: {
        role: "ADMIN",
        campaignAccessType: "SELECTED",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });

    await tx.memberCampaignAccess.upsert({
      where: {
        memberId_campaignId: {
          memberId: member.id,
          campaignId: invitation.campaignId,
        },
      },
      create: {
        memberId: member.id,
        campaignId: invitation.campaignId,
      },
      update: {},
    });
  });

  if (
    invitation.company.clerkOrganizationId &&
    !invitation.company.clerkOrganizationId.startsWith("local:")
  ) {
    try {
      await clerkClient.organizations.createOrganizationMembership({
        organizationId: invitation.company.clerkOrganizationId,
        userId: clerkUserId,
        role: "org:admin",
      });
    } catch (err) {
      console.error("[Clerk Org Invite Error]", err);
    }
  }

  return { success: true };
}
