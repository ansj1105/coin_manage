import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError, isDomainError } from '../core/domain-error.js';
import { zodToDomainError } from '../core/validation.js';

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'route not found'
    }
  });
};

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  let targetError: DomainError;

  if (error instanceof ZodError) {
    targetError = zodToDomainError(error);
  } else if (isDomainError(error)) {
    targetError = error;
  } else {
    targetError = new DomainError(500, 'INTERNAL_ERROR', 'internal server error');
  }

  res.status(targetError.statusCode).json({
    error: {
      code: targetError.code,
      message: targetError.message,
      details: targetError.details
    }
  });
};
