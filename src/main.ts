import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as express from "express";
import type { Server } from "http";
import { AppModule } from "./app.module";
import { getClerkAuthorizedParties } from "./auth/clerk-config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { PrismaExceptionFilter } from "./common/filters/prisma-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";

import "./server/queues/delayed-calls.worker";
import "./server/queues/campaign-execution.worker";
import "./server/cron/reactivation.cron";
import { runReactivationExtraction } from "./server/cron/reactivation.cron";
import { redisConnection } from "./server/queues/redis.client";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(
    "/api/webhooks/clerk",
    express.raw({ type: "application/json" }),
  );
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (
        err instanceof SyntaxError &&
        "status" in err &&
        (err as { status?: number }).status === 400
      ) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
      next(err);
    },
  );

  app.enableCors({
    origin: getClerkAuthorizedParties(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Order matters: Nest stops at the first filter whose @Catch() type matches,
  // so the specific filters must run before the catch-all fallback.
  app.useGlobalFilters(
    new HttpExceptionFilter(),
    new PrismaExceptionFilter(),
    new AllExceptionsFilter(),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("PropNex Main API")
    .setDescription("Tenant dashboard GraphQL + REST APIs")
    .setVersion("1.0")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT ?? 3004;
  await app.listen(port, "0.0.0.0");

  // Bound how long a request can hang (e.g. a stuck downstream call) so it
  // fails with a proper 5xx the client can retry against, instead of hanging.
  const httpServer = app.getHttpServer() as Server;
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 31_000;
}

bootstrap();

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP RECOVERY GUARD
// If the server was down at 11:50 PM IST and missed the nightly extraction,
// run it immediately on next startup so all 3 waves get scheduled correctly.
// A Redis flag prevents double-running if the server is restarted multiple times.
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await new Promise((r) => setTimeout(r, 5000)); // wait 5s for Redis to connect

    const now = new Date();
    // Determine IST date string for today
    const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const yyyy = istDate.getUTCFullYear();
    const mm   = String(istDate.getUTCMonth() + 1).padStart(2, "0");
    const dd   = String(istDate.getUTCDate()).padStart(2, "0");
    const todayKey = `${yyyy}-${mm}-${dd}`;

    // IST hour right now
    const istHour = istDate.getUTCHours();
    // The extraction should have happened at 23:50 IST last night.
    // If it's currently between 00:00 and 23:49 IST and no Redis flag exists → we missed it.
    const alreadyRan = redisConnection
      ? await redisConnection.get(`reactivation-extracted:${todayKey}`)
      : null;

    if (!alreadyRan) {
      // Only recover if at least one wave is still in the future (before 8 PM IST)
      if (istHour < 20) {
        console.log(
          `[Reactivation Recovery] No extraction found for ${todayKey}. ` +
          `Running now at IST hour=${istHour} so upcoming waves get scheduled correctly.`
        );
        await runReactivationExtraction(now);
      } else {
        console.log(
          `[Reactivation Recovery] Missed extraction for ${todayKey} but all waves have passed (IST ${istHour}:xx). Skipping.`
        );
      }
    } else {
      console.log(`[Reactivation Recovery] Extraction already ran for ${todayKey}. No recovery needed.`);
    }
  } catch (err) {
    console.error("[Reactivation Recovery] Startup check failed:", err);
  }
})();
