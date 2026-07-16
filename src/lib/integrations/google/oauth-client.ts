import { google } from "googleapis";

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    process.env.GOOGLE_REDIRECT_URI ??
    "http://localhost:3000/api/integrations/google/oauth/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
