import { Module } from '@nestjs/common';

import {
  AgentsController,
  ContactPhonesController,
  ToolsController,
} from './api.controllers';
import { BillingController } from '../billing/billing.controller';
import { CallsController } from '../calls/calls.controller';
import { OutboundCampaignExecutionController } from '../calls/campaign-execution.controller';
import { CampaignExecutionController } from '../campaigns/campaign-execution.controller';
import {
  CompanyController,
  ContactRequestsController,
} from '../company/company.controller';
import { SubCompaniesController } from '../company/sub-company.controller';
import { GraphQLModule } from '../graphql/graphql.module';
import { IntegrationsController } from '../integrations/integrations.controller';
import { ChannelsInternalController } from '../internal/channels-internal.controller';
import { InternalController } from '../internal/internal.controller';
import { InvitationsController } from '../invitations/invitations.controller';
import { ObdController } from '../obd/obd.controller';
// removed
import { PageCacheController } from '../page-cache/page-cache.controller';
import { TelephonyController } from '../telephony/telephony.controller';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { InboundWebhooksController } from '../webhooks/inbound-webhooks.controller';
import { UsersController } from '../users/users.controller';

@Module({
  imports: [GraphQLModule],
  controllers: [
    CompanyController,
    SubCompaniesController,
    ContactRequestsController,
    BillingController,
    TelephonyController,
    ObdController,
    WebhooksController,
    InboundWebhooksController,
    UsersController,
    InternalController,
    ChannelsInternalController,
    IntegrationsController,
    InvitationsController,
    AgentsController,
    ToolsController,
    ContactPhonesController,
    PageCacheController,
    CallsController,
    OutboundCampaignExecutionController,
    CampaignExecutionController,
  ],
})
export class ApiModule {}
