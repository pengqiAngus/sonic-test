import BigNumber from "bignumber.js";

const PRICE_DECIMALS = 8;
const SIZE_DECIMALS = 8;

// 统一价格精度，避免浮点误差在不同模块重复出现。
export function normalizePrice(value: number): number {
  return new BigNumber(value).decimalPlaces(PRICE_DECIMALS).toNumber();
}

// 统一数量精度，与 price 同步走 BigNumber 归一化。
export function normalizeSize(value: number): number {
  return new BigNumber(value).decimalPlaces(SIZE_DECIMALS).toNumber();
}
