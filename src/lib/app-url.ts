/** Absolute app origin, e.g. http://localhost:3000 */
export function getAppOrigin(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return base.replace(/\/$/, "");
}

/** Post-invite redirect target — sends users to the app dashboard after accepting. */
export function getInviteAcceptRedirectUrl(): string {
  return `${getAppOrigin()}/dashboard`;
}

/**
 * Branch invitation redirect target.
 * Points the Clerk email link directly at the custom acceptance page so
 * the acceptInvitation server action runs and BranchInvitation.status is
 * updated to ACCEPTED. Without this, Clerk would redirect to /dashboard and
 * the acceptance page — and its DB transaction — would never be reached.
 */
export function getBranchInviteRedirectUrl(token: string): string {
  return `${getAppOrigin()}/invitations/branch/${token}`;
}
