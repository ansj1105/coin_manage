const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const isValidTronAddress = (value: string): boolean => TRON_ADDRESS_PATTERN.test(value);

export const tronAddressPattern = TRON_ADDRESS_PATTERN;
