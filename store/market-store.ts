import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { normalizePrice, normalizeSize } from "@/lib/number";
import type {
  BookDeltaMessage,
  ConnectionState,
  GapState,
  MarketId,
  MarketSnapshot,
  MessageRates,
  PriceLevel,
  TradeRecord
} from "@/lib/types";

// ---------------------------------------------------------------------
// 这个文件是“行情内存模型”：
// - websocket-provider 负责收消息与节流
// - market-store 负责把消息落地成可渲染结构
// - 对外暴露最小状态写入接口（读取 hooks 已拆分到 lib/hooks.ts）
// ---------------------------------------------------------------------

const DEFAULT_MARKET: MarketId = "BTC-PERP";
const MAX_RECENT_TRADES = 120;
const MAX_BOOK_LEVELS_PER_SIDE = 500;

// 每个动画帧内聚合的增量数据：
// WebSocket 高频消息先写入 frame，再批量提交到 store。
export interface BufferedFrame {
  deltas: BookDeltaMessage[];
  trades: TradeRecord[];
  lastSeq: number;
}

interface MarketStoreState {
  marketId: MarketId;
  // book 用 Map 存储（price -> size），增量更新/删除更高效。
  bids: Map<number, number>;
  asks: Map<number, number>;
  // 最近成交按“新到旧”排列（index 0 永远最新）。
  trades: TradeRecord[];
  lastSeq: number;
  // version 是“重算开关”：
  // Map 是可变结构，引用不一定变化，所以需要显式版本号驱动 selector 重算。
  bookVersion: number;
  tradeVersion: number;
  connectionState: ConnectionState;
  reconnectAttempt: number;
  lastPongAt: number | null;
  gap: GapState | null;
  rates: MessageRates;
  error: string | null;
  resetMarket: (marketId: MarketId) => void;
  hydrateSnapshot: (snapshot: MarketSnapshot) => void;
  applyFrame: (frame: BufferedFrame) => void;
  setConnectionState: (
    connectionState: ConnectionState,
    reconnectAttempt?: number,
    error?: string | null
  ) => void;
  setMessageRates: (rates: MessageRates) => void;
  markGap: (gap: GapState) => void;
  clearGap: () => void;
  markPong: (ts: number) => void;
}

// 将快照数组转为 Map：
// key=price, value=size，后续增量更新 O(1)。
function buildSideMap(levels: PriceLevel[]): Map<number, number> {
  const next = new Map<number, number>();

  for (const level of levels) {
    const price = normalizePrice(level.price);
    const size = normalizeSize(level.size);

    if (size > 0) {
      next.set(price, size);
    }
  }

  return next;
}

// 应用增量档位：
// size=0 代表删除该价格档；否则写入/覆盖该档。
function applyLevels(side: Map<number, number>, levels: PriceLevel[]): boolean {
  let changed = false;

  for (const level of levels) {
    const price = normalizePrice(level.price);
    const size = normalizeSize(level.size);

    if (size === 0) {
      changed = side.delete(price) || changed;
      continue;
    }

    if (side.get(price) !== size) {
      side.set(price, size);
      changed = true;
    }
  }

  return changed;
}

// 防御性裁剪：限制单侧档位数量，避免滚动高度和内存无限增长。
function trimBookSide(side: Map<number, number>, bookSide: "bids" | "asks"): boolean {
  if (side.size <= MAX_BOOK_LEVELS_PER_SIDE) {
    return false;
  }

  const sortedPrices = Array.from(side.keys()).sort((left, right) =>
    bookSide === "bids" ? right - left : left - right
  );
  let changed = false;

  for (const price of sortedPrices.slice(MAX_BOOK_LEVELS_PER_SIDE)) {
    changed = side.delete(price) || changed;
  }

  return changed;
}

// 交易去重后前插，始终保留最近 MAX_RECENT_TRADES 条。
function mergeTrades(current: TradeRecord[], incoming: TradeRecord[]): TradeRecord[] {
  if (incoming.length === 0) {
    return current;
  }

  // 以 tradeId 去重，防止网络抖动导致重复推送。
  const seen = new Set(current.map((trade) => trade.tradeId));
  const fresh = incoming.filter((trade) => !seen.has(trade.tradeId));

  if (fresh.length === 0) {
    return current;
  }

  return [...fresh.reverse(), ...current].slice(0, MAX_RECENT_TRADES);
}

// Zustand 全局行情仓库：
// - book 用 Map 存，更新高效
// - version 字段驱动 selector 精准重算，减少无意义渲染
export const useMarketStore = create<MarketStoreState>()(
  subscribeWithSelector((set) => ({
    marketId: DEFAULT_MARKET,
    bids: new Map<number, number>(),
    asks: new Map<number, number>(),
    trades: [],
    lastSeq: 0,
    bookVersion: 0,
    tradeVersion: 0,
    connectionState: "idle",
    reconnectAttempt: 0,
    lastPongAt: null,
    gap: null,
    rates: {
      bookPerSecond: 0,
      tradePerSecond: 0
    },
    error: null,
    resetMarket: (marketId) =>
      // 切市场时重置运行态，避免旧市场数据残留到新市场。
      set((state) => ({
        marketId,
        bids: new Map<number, number>(),
        asks: new Map<number, number>(),
        trades: [],
        lastSeq: 0,
        bookVersion: state.bookVersion + 1,
        tradeVersion: state.tradeVersion + 1,
        connectionState: "idle",
        reconnectAttempt: 0,
        lastPongAt: null,
        gap: null,
        rates: {
          bookPerSecond: 0,
          tradePerSecond: 0
        },
        error: null
      })),
    hydrateSnapshot: (snapshot) =>
      // snapshot 是“强一致基线”：直接覆盖 book/trades/seq。
      set((state) => {
        const nextBids = buildSideMap(snapshot.bids);
        const nextAsks = buildSideMap(snapshot.asks);
        trimBookSide(nextBids, "bids");
        trimBookSide(nextAsks, "asks");

        return {
          marketId: snapshot.marketId,
          bids: nextBids,
          asks: nextAsks,
          trades: snapshot.trades.slice(0, MAX_RECENT_TRADES),
          lastSeq: snapshot.seq ?? 0,
          bookVersion: state.bookVersion + 1,
          tradeVersion: state.tradeVersion + 1,
          gap: null,
          error: null
        };
      }),
    applyFrame: (frame) =>
      set((state) => {
        // 一次处理一个动画帧批次，减少 store 更新频率。
        let bookChanged = false;

        for (const delta of frame.deltas) {
          bookChanged = applyLevels(state.bids, delta.bids) || bookChanged;
          bookChanged = applyLevels(state.asks, delta.asks) || bookChanged;
        }
        bookChanged = trimBookSide(state.bids, "bids") || bookChanged;
        bookChanged = trimBookSide(state.asks, "asks") || bookChanged;

        const nextTrades = mergeTrades(state.trades, frame.trades);
        const tradeChanged = nextTrades !== state.trades;

        return {
          // frame.lastSeq 来自 provider 的连续 seq 校验通过结果。
          lastSeq: frame.lastSeq,
          bookVersion: bookChanged ? state.bookVersion + 1 : state.bookVersion,
          trades: nextTrades,
          tradeVersion: tradeChanged ? state.tradeVersion + 1 : state.tradeVersion,
          gap: null,
          error: null
        };
      }),
    setConnectionState: (connectionState, reconnectAttempt = 0, error = null) =>
      set((state) => {
        // 无变化直接返回旧 state，避免无意义订阅通知。
        if (
          state.connectionState === connectionState &&
          state.reconnectAttempt === reconnectAttempt &&
          state.error === error
        ) {
          return state;
        }

        return {
          connectionState,
          reconnectAttempt,
          error
        };
      }),
    setMessageRates: (rates) =>
      set((state) => {
        if (
          state.rates.bookPerSecond === rates.bookPerSecond &&
          state.rates.tradePerSecond === rates.tradePerSecond
        ) {
          return state;
        }

        return {
          rates
        };
      }),
    markGap: (gap) =>
      set((state) => {
        // gap 期间强制切到 gap-detected，并暴露错误信息给 UI。
        if (
          state.connectionState === "gap-detected" &&
          state.error === "Sequence gap detected" &&
          state.gap?.expectedSeq === gap.expectedSeq &&
          state.gap?.receivedSeq === gap.receivedSeq
        ) {
          return state;
        }

        return {
          gap,
          connectionState: "gap-detected",
          error: "Sequence gap detected"
        };
      }),
    clearGap: () =>
      set((state) => {
        if (state.gap === null && state.error === null) {
          return state;
        }

        return {
          gap: null,
          error: null
        };
      }),
    markPong: (ts) =>
      set((state) => {
        if (state.lastPongAt === ts) {
          return state;
        }

        return {
          lastPongAt: ts
        };
      })
  }))
);
