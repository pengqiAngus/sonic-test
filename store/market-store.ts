import { useMemo } from "react";

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

const DEFAULT_MARKET: MarketId = "BTC-PERP";
const MAX_RECENT_TRADES = 120;

export interface BufferedFrame {
  deltas: BookDeltaMessage[];
  trades: TradeRecord[];
  lastSeq: number;
}

interface MarketStoreState {
  marketId: MarketId;
  bids: Map<number, number>;
  asks: Map<number, number>;
  trades: TradeRecord[];
  lastSeq: number;
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

function mergeTrades(current: TradeRecord[], incoming: TradeRecord[]): TradeRecord[] {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((trade) => trade.tradeId));
  const fresh = incoming.filter((trade) => !seen.has(trade.tradeId));

  if (fresh.length === 0) {
    return current;
  }

  return [...fresh.reverse(), ...current].slice(0, MAX_RECENT_TRADES);
}

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
      set((state) => ({
        marketId: snapshot.marketId,
        bids: buildSideMap(snapshot.bids),
        asks: buildSideMap(snapshot.asks),
        trades: snapshot.trades.slice(0, MAX_RECENT_TRADES),
        lastSeq: snapshot.seq,
        bookVersion: state.bookVersion + 1,
        tradeVersion: state.tradeVersion + 1,
        gap: null,
        error: null
      })),
    applyFrame: (frame) =>
      set((state) => {
        let bookChanged = false;

        for (const delta of frame.deltas) {
          bookChanged = applyLevels(state.bids, delta.bids) || bookChanged;
          bookChanged = applyLevels(state.asks, delta.asks) || bookChanged;
        }

        const nextTrades = mergeTrades(state.trades, frame.trades);
        const tradeChanged = nextTrades !== state.trades;

        return {
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

export function useTopLevels(side: "bids" | "asks", limit = 12): Array<{
  price: number;
  size: number;
  total: number;
}> {
  const levels = useBookLevels(side);

  return useMemo(() => levels.slice(0, limit), [levels, limit]);
}

export function useBookLevels(side: "bids" | "asks"): Array<{
  price: number;
  size: number;
  total: number;
}> {
  const bookVersion = useMarketStore((state) => state.bookVersion);
  const source = useMarketStore((state) => (side === "bids" ? state.bids : state.asks));

  return useMemo(() => {
    void bookVersion;

    const sorted = Array.from(source.entries(), ([price, size]) => ({ price, size })).sort(
      (left, right) => (side === "bids" ? right.price - left.price : left.price - right.price)
    );

    let runningTotal = 0;

    return sorted.map((level) => {
      runningTotal += level.size;

      return {
        ...level,
        total: runningTotal
      };
    });
  }, [bookVersion, side, source]);
}

export function useRecentTrades(limit = 24): TradeRecord[] {
  const tradeVersion = useMarketStore((state) => state.tradeVersion);
  const trades = useMarketStore((state) => state.trades);

  return useMemo(() => {
    void tradeVersion;
    return trades.slice(0, limit);
  }, [limit, tradeVersion, trades]);
}

export function useMidPrice(): number | null {
  const bookVersion = useMarketStore((state) => state.bookVersion);
  const bids = useMarketStore((state) => state.bids);
  const asks = useMarketStore((state) => state.asks);

  return useMemo(() => {
    void bookVersion;

    const bestBid = Math.max(...bids.keys());
    const bestAsk = Math.min(...asks.keys());

    if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) {
      return null;
    }

    return (bestBid + bestAsk) / 2;
  }, [asks, bids, bookVersion]);
}
