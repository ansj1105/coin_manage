import { ZodError } from 'zod';
import { DomainError } from './domain-error.js';

export const zodToDomainError = (error: ZodError): DomainError => {
  return new DomainError(400, 'VALIDATION_ERROR', 'invalid request payload', error.flatten());
};

export const requireIdempotencyKey = (value: string | undefined): string => {
  if (!value || !value.trim()) {
    throw new DomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  }
  return value.trim();
};
