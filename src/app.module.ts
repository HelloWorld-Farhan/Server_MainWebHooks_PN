import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppConfigModule } from "./config/config.module";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { PrismaModule } from "./database/prisma/prisma.module";
import { ApiModule } from "./modules/api/api.module";

@Module({
  imports: [AppConfigModule, PrismaModule, ApiModule],
  controllers: [AppController],
  providers: [LoggingInterceptor],
})
export class AppModule {}
