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
const MAX_RECENT_TRADES = 1000;
const MAX_BOOK_LEVELS_PER_SIDE = 1000;

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

// Convert snapshot arrays to Maps:
// key=price, value=size; enables O(1) incremental updates later.
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

// Apply incremental levels:
// size=0 means delete this price level; otherwise set/overwrite it.
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

// Defensive trimming: limit levels per side to cap scroll height and memory growth.
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

// Deduplicate trades then prepend; always keep only MAX_RECENT_TRADES latest items.
function mergeTrades(current: TradeRecord[], incoming: TradeRecord[]): TradeRecord[] {
  if (incoming.length === 0) {
    return current;
  }

  // Deduplicate by tradeId to avoid duplicates from network jitter.
  const seen = new Set(current.map((trade) => trade.tradeId));
  const fresh = incoming.filter((trade) => !seen.has(trade.tradeId));

  if (fresh.length === 0) {
    return current;
  }

  return [...fresh.reverse(), ...current].slice(0, MAX_RECENT_TRADES);
}

// Global market store with Zustand:
// - book uses Map for efficient writes
// - version fields drive precise selector recomputation to reduce unnecessary renders
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
      // Reset runtime state on market switch to avoid stale data carry-over.
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
      // Snapshot is the strong-consistency baseline: overwrite book/trades/seq directly.
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
        // Process one animation-frame batch at a time to reduce store update frequency.
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
          // frame.lastSeq is produced after provider-side sequential seq validation.
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
        // Return previous state when unchanged to avoid unnecessary subscription notifications.
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
        // Force gap-detected during gap period and expose error state to UI.
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
