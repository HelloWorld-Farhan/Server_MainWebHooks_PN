import { getDatabaseUrl } from "./database-url";

export default () => ({
  port: parseInt(process.env.PORT ?? "3004", 10),
  databaseUrl: getDatabaseUrl(),
  mainWebsiteUrl: process.env.MAIN_WEBSITE_URL ?? "http://localhost:3000",
  mainServerUrl: process.env.MAIN_SERVER_URL ?? "http://localhost:3004",
  agentServerApiKey: process.env.AGENT_SERVER_API_KEY,
  apiKeyPepper: process.env.API_KEY_PEPPER,
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  clerkWebhookSecret: process.env.CLERK_WEBHOOK_SECRET,
  clerkWebhooksEnabled: process.env.CLERK_WEBHOOKS_ENABLED === "true",
});
