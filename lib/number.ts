import BigNumber from "bignumber.js";

const PRICE_DECIMALS = 8;
const SIZE_DECIMALS = 8;

export function normalizePrice(value: number): number {
  return new BigNumber(value).decimalPlaces(PRICE_DECIMALS).toNumber();
}

export function normalizeSize(value: number): number {
  return new BigNumber(value).decimalPlaces(SIZE_DECIMALS).toNumber();
}
