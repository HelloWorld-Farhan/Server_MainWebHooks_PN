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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(
    "/api/webhooks/clerk",
    express.raw({ type: "application/json" }),
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
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
