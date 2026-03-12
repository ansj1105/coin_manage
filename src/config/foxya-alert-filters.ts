const normalize = (value: string) => value.trim().toUpperCase();

const internalTransferExcludedTypes = ['REFERRAL_REWARD'];

const internalTransferExcludedTypeSet = new Set(internalTransferExcludedTypes.map(normalize));

export const shouldExcludeFoxyaInternalTransferAlert = (input: {
  transferType?: string | null;
  transactionType?: string | null;
}) => {
  const candidates = [input.transferType, input.transactionType]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalize);

  return candidates.some((value) => internalTransferExcludedTypeSet.has(value));
};

export const foxyaAlertFilters = {
  internalTransferExcludedTypes: [...internalTransferExcludedTypeSet]
};
