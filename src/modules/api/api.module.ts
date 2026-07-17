import { Module } from "@nestjs/common";

import {
  AgentsController,
  ContactPhonesController,
  ToolsController,
} from "./api.controllers";
import { CompanyController, ContactRequestsController } from "../company/company.controller";
import { BillingController } from "../billing/billing.controller";
import { GraphQLModule } from "../graphql/graphql.module";
import { IntegrationsController } from "../integrations/integrations.controller";
import { InternalController } from "../internal/internal.controller";
import { PageCacheController } from "../page-cache/page-cache.controller";
import { InvitationsController } from "../invitations/invitations.controller";
import { TelephonyController } from "../telephony/telephony.controller";
import { WebhooksController } from "../webhooks/webhooks.controller";

@Module({
  imports: [GraphQLModule],
  controllers: [
    CompanyController,
    ContactRequestsController,
    BillingController,
    TelephonyController,
    WebhooksController,
    InternalController,
    IntegrationsController,
    InvitationsController,
    AgentsController,
    ToolsController,
    ContactPhonesController,
    PageCacheController,
  ],
})
export class ApiModule {}
