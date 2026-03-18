import BigNumber from "bignumber.js";

const PRICE_DECIMALS = 8;
const SIZE_DECIMALS = 8;

// Normalize price precision to avoid repeated floating-point drift across modules.
export function normalizePrice(value: number): number {
  return new BigNumber(value).decimalPlaces(PRICE_DECIMALS).toNumber();
}

// Normalize size precision with BigNumber, same strategy as price.
export function normalizeSize(value: number): number {
  return new BigNumber(value).decimalPlaces(SIZE_DECIMALS).toNumber();
}
