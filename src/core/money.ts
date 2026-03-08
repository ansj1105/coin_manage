import { DomainError } from './domain-error.js';

export const KORI_DECIMALS = 6;
const KORI_SCALE = 1_000_000n;

export const parseKoriAmount = (amount: number): bigint => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'amount must be a positive number');
  }

  const scaled = amount * Number(KORI_SCALE);
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 0.000001) {
    throw new DomainError(400, 'VALIDATION_ERROR', 'amount supports up to 6 decimals');
  }

  return BigInt(rounded);
};

export const formatKoriAmount = (units: bigint): string => {
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const intPart = abs / KORI_SCALE;
  const fracPart = (abs % KORI_SCALE).toString().padStart(KORI_DECIMALS, '0');
  return `${sign}${intPart.toString()}.${fracPart}`;
};

export const parseStoredKoriAmount = (amount: string | number): bigint => {
  const normalized = String(amount).trim();
  if (!/^-?\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new DomainError(500, 'STATE_CORRUPTED', `invalid stored KORI amount: ${normalized}`);
  }

  const sign = normalized.startsWith('-') ? -1n : 1n;
  const unsigned = normalized.replace(/^-/, '');
  const [intPart, fracPart = ''] = unsigned.split('.');
  const units = BigInt(intPart) * KORI_SCALE + BigInt(fracPart.padEnd(KORI_DECIMALS, '0'));
  return units * sign;
};

export const sumBigInt = (values: bigint[]): bigint => values.reduce((acc, value) => acc + value, 0n);
