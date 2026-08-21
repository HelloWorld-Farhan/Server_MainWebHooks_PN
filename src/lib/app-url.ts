/** Absolute app origin, e.g. http://200.234.34.240:3000 */
export function getAppOrigin(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://200.234.34.240:3000";
  return base.replace(/\/$/, "");
}

/** Post-invite redirect target — sends users to the app dashboard after accepting. */
export function getInviteAcceptRedirectUrl(): string {
  return `${getAppOrigin()}/dashboard`;
}

/**
 * Campaign invitation redirect target.
 * Points the Clerk email link directly at the custom acceptance page so
 * the acceptInvitation server action runs and CampaignInvitation.status is
 * updated to ACCEPTED. Without this, Clerk would redirect to /dashboard and
 * the acceptance page — and its DB transaction — would never be reached.
 */
export function getCampaignInviteRedirectUrl(token: string): string {
  return `${getAppOrigin()}/invitations/campaign/${token}`;
}
