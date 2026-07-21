import { clerkClient } from "@/auth/clerk";

import { getInviteAcceptRedirectUrl } from "@/lib/app-url";
import {
  isClerkNotFound,
  isClerkOrganizationsDisabled,
} from "@/server/lib/clerk-errors";
import { ensureRealClerkOrganizationId } from "@/server/lib/clerk-org";
import { ValidationError } from "@/server/lib/errors";
import {
  mapUserRoleToClerkInviteRole,
} from "@/server/lib/clerk-sync";
import { clerkMembershipService } from "@/server/services/clerk-membership.service";

type CompanyOrgFields = {
  id: string;
  name: string;
  clerkOrganizationId: string | null;
  ownerUserId: string | null;
};

type ClerkApiErrorShape = {
  errors?: { code?: string; message?: string; longMessage?: string }[];
  status?: number;
  message?: string;
};

export type ClerkInviteMetadata = {
  propnexRole: string;
  campaignAccessType: string;
  campaignIds: string[];
  jobTitle: string | null;
  inviteName?: string;
};

export async function getActiveClerkOrganizationId(
  company: CompanyOrgFields,
  options?: { createdByClerkUserId?: string },
): Promise<string> {
  return ensureRealClerkOrganizationId(company, options);
}

function clerkErrorText(error: unknown): {
  codes: string[];
  messages: string[];
  status?: number;
} {
  const err = error as ClerkApiErrorShape;
  return {
    codes: err.errors?.map((e) => e.code ?? "") ?? [],
    messages: err.errors?.map((e) => e.message ?? e.longMessage ?? "") ?? [],
    status: err.status,
  };
}

export function mapClerkInviteError(error: unknown): string {
  const { codes, messages, status } = clerkErrorText(error);

  if (isClerkOrganizationsDisabled(error)) {
    return "Employee invitations require Clerk Organizations. Enable Organizations in your Clerk Dashboard, then try again.";
  }

  if (
    codes.some((c) =>
      /already.*member|duplicate.*membership|membership_exists/i.test(c),
    ) ||
    messages.some((m) => /already.*member/i.test(m))
  ) {
    return "This email is already a member of the organization";
  }

  if (
    codes.some((c) =>
      /already.*invit|duplicate.*invit|invitation_exists|pending_invitation/i.test(
        c,
      ),
    ) ||
    messages.some((m) => /already.*invit|pending invitation/i.test(m))
  ) {
    return "This email already has a pending invitation";
  }

  if (
    codes.some((c) =>
      /form_identifier|invalid.*email|email_address/i.test(c),
    ) ||
    messages.some((m) => /valid email/i.test(m))
  ) {
    return "Enter a valid email address";
  }

  if (
    status === 404 ||
    messages.some((m) => /not found/i.test(m)) ||
    codes.some((c) => /not_found/i.test(c))
  ) {
    if (messages.some((m) => /role/i.test(m)) || codes.some((c) => /role/i.test(c))) {
      return "The organization role is not configured in Clerk. The invite used a default role; try again or contact support.";
    }
    if (
      messages.some((m) => /user|inviter|member/i.test(m)) ||
      codes.some((c) => /user|inviter|member/i.test(c))
    ) {
      return "Your account is not linked to the company organization in Clerk. Try signing out and back in.";
    }
    return "The company organization could not be found in Clerk. Please try again.";
  }

  const firstMessage = messages.find(Boolean);
  if (firstMessage) return firstMessage;

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to send invitation. Please try again.";
}

async function isClerkOrganizationMember(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  return clerkMembershipService.isOrganizationMember(organizationId, userId);
}

export async function ensureClerkOrganizationMember(params: {
  organizationId: string;
  userId: string;
  propnexRole: string;
}): Promise<void> {
  if (!params.userId.startsWith("user_")) return;

  const isMember = await isClerkOrganizationMember(
    params.organizationId,
    params.userId,
  );
  if (isMember) return;

  const client = clerkClient;
  try {
    await client.organizations.createOrganizationMembership({
      organizationId: params.organizationId,
      userId: params.userId,
      role: mapUserRoleToClerkInviteRole(params.propnexRole),
    });
  } catch (error) {
    const { messages } = clerkErrorText(error);
    if (messages.some((m) => /already.*member/i.test(m))) return;
    throw error;
  }
}

async function createOrganizationInvitationAttempt(params: {
  organizationId: string;
  email: string;
  role: string;
  metadata: ClerkInviteMetadata;
  inviterUserId?: string;
  expiresInDays?: number;
  redirectUrl?: string;
}) {
  const client = clerkClient;
  return client.organizations.createOrganizationInvitation({
    organizationId: params.organizationId,
    emailAddress: params.email,
    role: mapUserRoleToClerkInviteRole(params.role),
    expiresInDays: params.expiresInDays ?? 7,
    inviterUserId: params.inviterUserId,
    redirectUrl: params.redirectUrl ?? getInviteAcceptRedirectUrl(),
    publicMetadata: params.metadata,
  });
}

export async function sendClerkOrganizationInvitation(params: {
  organizationId: string;
  email: string;
  role: string;
  metadata: ClerkInviteMetadata;
  inviterUserId?: string;
  expiresInDays?: number;
  /** Override the post-acceptance redirect URL embedded in the Clerk email. */
  redirectUrl?: string;
}): Promise<{ invitationId: string; expiresAt: Date }> {
  if (params.inviterUserId) {
    await ensureClerkOrganizationMember({
      organizationId: params.organizationId,
      userId: params.inviterUserId,
      propnexRole: params.role,
    });
  }

  try {
    const invitation = await createOrganizationInvitationAttempt(params);
    return {
      invitationId: invitation.id,
      expiresAt: new Date(invitation.expiresAt),
    };
  } catch (error) {
    const { messages, status } = clerkErrorText(error);
    const isNotFound =
      status === 404 || messages.some((m) => /not found/i.test(m));

    if (isNotFound && params.inviterUserId) {
      try {
        const invitation = await createOrganizationInvitationAttempt({
          ...params,
          inviterUserId: undefined,
        });
        return {
          invitationId: invitation.id,
          expiresAt: new Date(invitation.expiresAt),
        };
      } catch (retryError) {
        throw new ValidationError(mapClerkInviteError(retryError));
      }
    }

    throw new ValidationError(mapClerkInviteError(error));
  }
}

export async function revokeClerkOrganizationInvitation(params: {
  organizationId: string;
  invitationId: string;
  requestingUserId?: string;
}): Promise<void> {
  const client = clerkClient;

  try {
    await client.organizations.revokeOrganizationInvitation({
      organizationId: params.organizationId,
      invitationId: params.invitationId,
      requestingUserId: params.requestingUserId,
    });
  } catch {
    // Best-effort revoke; DB state is source of truth for cancelled invites
  }
}

async function findClerkUserIdByEmail(email: string): Promise<string | null> {
  try {
    const client = clerkClient;
    const users = await client.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    return users.data[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function revokeAllClerkPendingInvitationsForEmail(params: {
  organizationId: string;
  email: string;
  requestingUserId?: string;
}): Promise<void> {
  if (!params.organizationId.startsWith("org_")) return;

  const client = clerkClient;

  try {
    const list = await client.organizations.getOrganizationInvitationList({
      organizationId: params.organizationId,
      status: ["pending"],
      limit: 100,
    });

    const matches = list.data.filter(
      (inv) => inv.emailAddress.toLowerCase() === params.email.toLowerCase(),
    );

    for (const invitation of matches) {
      await revokeClerkOrganizationInvitation({
        organizationId: params.organizationId,
        invitationId: invitation.id,
        requestingUserId: params.requestingUserId,
      });
    }
  } catch {
    // Best-effort revoke
  }
}

export async function removeClerkOrganizationMember(params: {
  organizationId: string;
  email: string;
  clerkUserId?: string | null;
}): Promise<void> {
  if (!params.organizationId.startsWith("org_")) return;

  const client = clerkClient;
  const userIds = new Set<string>();

  if (params.clerkUserId?.startsWith("user_")) {
    userIds.add(params.clerkUserId);
  }

  const resolvedByEmail = await findClerkUserIdByEmail(params.email);
  if (resolvedByEmail) {
    userIds.add(resolvedByEmail);
  }

  try {
    const memberships = await clerkMembershipService.getOrgMemberships(
      params.organizationId,
    );

    for (const membership of memberships.data) {
      const memberEmail = membership.publicUserData?.identifier;
      if (
        memberEmail?.toLowerCase() === params.email.toLowerCase() &&
        membership.publicUserData?.userId
      ) {
        userIds.add(membership.publicUserData.userId);
      }
    }
  } catch (error) {
    if (!isClerkNotFound(error)) {
      // Best-effort membership lookup
    }
  }

  for (const userId of userIds) {
    try {
      await client.organizations.deleteOrganizationMembership({
        organizationId: params.organizationId,
        userId,
      });
    } catch {
      // Best-effort removal
    }
  }
}

/** Revokes pending invites and removes org membership so the email can be invited again. */
export async function removeClerkOrganizationAccess(params: {
  organizationId: string;
  email: string;
  clerkUserId?: string | null;
  requestingUserId?: string;
}): Promise<void> {
  await revokeAllClerkPendingInvitationsForEmail({
    organizationId: params.organizationId,
    email: params.email,
    requestingUserId: params.requestingUserId,
  });

  await removeClerkOrganizationMember({
    organizationId: params.organizationId,
    email: params.email,
    clerkUserId: params.clerkUserId,
  });
}

export async function findClerkPendingInvitationId(params: {
  organizationId: string;
  email: string;
}): Promise<string | null> {
  const client = clerkClient;

  try {
    const list = await client.organizations.getOrganizationInvitationList({
      organizationId: params.organizationId,
      status: ["pending"],
      limit: 100,
    });

    const match = list.data.find(
      (inv) => inv.emailAddress.toLowerCase() === params.email.toLowerCase(),
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

export const clerkOrgLib = {
  getActiveClerkOrganizationId,
  sendClerkOrganizationInvitation,
  revokeClerkOrganizationInvitation,
  removeClerkOrganizationAccess,
};
