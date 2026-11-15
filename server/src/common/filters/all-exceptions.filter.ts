import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isPgError } from '../utils/db-errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Something went wrong';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const payload = body as { message?: string | string[]; error?: string; code?: string };
        message = payload.message ?? exception.message;
        code = payload.code ?? (payload.error ?? 'REQUEST_FAILED').toUpperCase().replace(/\s+/g, '_');
      }
    } else if (isPgError(exception)) {
      if (exception.code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'This record already exists';
        code = 'CONFLICT';
      } else if (exception.code === '23503') {
        status = HttpStatus.BAD_REQUEST;
        message = 'This record is still referenced by other data';
        code = 'FOREIGN_KEY_VIOLATION';
      } else if (exception.code === '23502') {
        status = HttpStatus.BAD_REQUEST;
        message = 'A required value is missing';
        code = 'NOT_NULL_VIOLATION';
      } else {
        code = `DATABASE_${exception.code}`;
      }
    } else if (
      exception instanceof Error &&
      (exception.name === 'MulterError' || exception.message.includes('File too large'))
    ) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'The uploaded file is too large';
      code = 'FILE_TOO_LARGE';
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      if (process.env.NODE_ENV === 'production') {
        message = 'Something went wrong on our side';
      }
    } else if (status !== HttpStatus.UNAUTHORIZED) {
      this.logger.warn(`${request.method} ${request.originalUrl} → ${status}: ${String(message)}`);
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
