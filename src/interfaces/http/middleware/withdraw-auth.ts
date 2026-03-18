import type { NextFunction, Request, Response } from 'express';
import { DomainError } from '../../../core/domain-error.js';

const readApiKey = (req: Request) => {
  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return req.header('x-admin-api-key') ?? req.header('x-internal-api-key') ?? req.header('x-api-key') ?? undefined;
};

export const createRequireWithdrawApiKey =
  (expectedApiKey?: string, code = 'UNAUTHORIZED', message = 'withdraw api key is required') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!expectedApiKey) {
      next();
      return;
    }

    if (readApiKey(req) !== expectedApiKey) {
      next(new DomainError(401, code, message));
      return;
    }

    next();
  };

const readHeaderValue = (req: Request, headerNames: string[]) => {
  for (const headerName of headerNames) {
    const value = req.header(headerName);
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

export const readWithdrawAdminActorId = (req: Request) => readHeaderValue(req, ['x-admin-id', 'x-actor-id', 'x-user-id']);

export const readWithdrawActorId = (req: Request) => readHeaderValue(req, ['x-actor-id', 'x-admin-id', 'x-user-id']);
