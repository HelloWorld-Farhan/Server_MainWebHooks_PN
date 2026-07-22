import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppConfigModule } from "./config/config.module";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { PrismaModule } from "./database/prisma/prisma.module";
import { ApiModule } from "./modules/api/api.module";
import { CampaignExecutionModule } from "./server/campaign-execution/campaign-execution.module";
import { ChannelsModule } from "./server/channels/channels.module";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ApiModule,
    ChannelsModule,
    CampaignExecutionModule,
  ],
  controllers: [AppController],
  providers: [LoggingInterceptor],
})
export class AppModule {}
