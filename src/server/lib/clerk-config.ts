/**
 * Clerk webhooks are optional. Local dev uses direct API provisioning during
 * contract linking and tenant sync instead of webhook sync.
 */
export function isClerkWebhooksEnabled(): boolean {
  return process.env.CLERK_WEBHOOKS_ENABLED === "true";
}
