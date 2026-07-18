import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";

import {
  isMissingApiRouteMessage,
} from "@/lib/api/http";

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : (exceptionResponse as { message?: string | string[] }).message;

    const normalizedMessage = Array.isArray(message) ? message[0] : message;
    const isMissingRoute =
      status === 404 && isMissingApiRouteMessage(normalizedMessage);

    this.logger.warn(
      `${request.method} ${request.url} → ${status}: ${JSON.stringify(message)}`,
    );

    if (isMissingRoute) {
      // #region agent log
      fetch('http://127.0.0.1:7337/ingest/56a44334-4141-484c-bb9b-95d1a3690082',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ead72'},body:JSON.stringify({sessionId:'1ead72',location:'http-exception.filter.ts:catch',message:'api route missing',data:{method:request.method,url:request.url,status},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }

    response.status(status).json({
      statusCode: status,
      error: isMissingRoute
        ? "API route not found"
        : (normalizedMessage ?? "Not found"),
      code: isMissingRoute ? "ROUTE_NOT_FOUND" : "NOT_FOUND",
    });
  }
}
