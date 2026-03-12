import { describe, expect, it } from 'vitest';
import { foxyaAlertFilters, shouldExcludeFoxyaInternalTransferAlert } from '../src/config/foxya-alert-filters.js';

describe('foxya alert filters', () => {
  it('excludes referral reward internal transfers', () => {
    expect(
      shouldExcludeFoxyaInternalTransferAlert({
        transferType: 'REFERRAL_REWARD',
        transactionType: 'REFERRAL_REWARD'
      })
    ).toBe(true);
  });

  it('keeps non-excluded internal transfers', () => {
    expect(
      shouldExcludeFoxyaInternalTransferAlert({
        transferType: 'USER_TRANSFER',
        transactionType: 'USER_TRANSFER'
      })
    ).toBe(false);
  });

  it('exposes excluded types for shared maintenance', () => {
    expect(foxyaAlertFilters.internalTransferExcludedTypes).toContain('REFERRAL_REWARD');
  });
});
