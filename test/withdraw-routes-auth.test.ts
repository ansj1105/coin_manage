import { describe, expect, it, vi } from 'vitest';
import {
  createRequireWithdrawApiKey,
  readWithdrawActorId,
  readWithdrawAdminActorId
} from '../src/interfaces/http/middleware/withdraw-auth.js';

const buildReq = (headers: Record<string, string> = {}) =>
  ({
    header: (name: string) => headers[name.toLowerCase()]
  }) as any;

describe('withdraw route auth', () => {
  it('blocks request creation without request api key', () => {
    const middleware = createRequireWithdrawApiKey(
      'request-secret',
      'WITHDRAW_REQUEST_UNAUTHORIZED',
      'withdraw request api key is required'
    );
    const next = vi.fn();

    middleware(buildReq(), {} as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      code: 'WITHDRAW_REQUEST_UNAUTHORIZED'
    });
  });

  it('accepts admin requests when the api key matches', () => {
    const middleware = createRequireWithdrawApiKey(
      'admin-secret',
      'WITHDRAW_ADMIN_UNAUTHORIZED',
      'withdraw admin api key is required'
    );
    const next = vi.fn();

    middleware(buildReq({ 'x-admin-api-key': 'admin-secret' }), {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('prefers authenticated admin id headers for approval actors', () => {
    const req = buildReq({ 'x-admin-id': 'ops-admin-1', 'x-actor-id': 'ignored-actor' });

    expect(readWithdrawAdminActorId(req)).toBe('ops-admin-1');
  });

  it('reads generic actor headers for external auth actors', () => {
    const req = buildReq({ 'x-actor-id': 'ops-bot-1' });

    expect(readWithdrawActorId(req)).toBe('ops-bot-1');
  });
});
