import { useMemo } from "react";

import type { TradeRecord } from "@/lib/types";
import { useMarketStore } from "@/store/market-store";
import { useSolanaStreamStore, type SolanaStreamStoreState } from "@/store/solana-stream-store";

// Keep market read hooks in lib to avoid coupling with store write logic.

export function useTopLevels(
  side: "bids" | "asks",
  limit = 12
): Array<{
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
    // Map is mutable; use version to explicitly trigger recomputation.
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

export function useSolanaStream(): Pick<
  SolanaStreamStoreState,
  | "status"
  | "statusReason"
  | "reconnectAttempt"
  | "transactions"
  | "lastReorgAt"
  | "lastRollbackSlot"
> {
  const status = useSolanaStreamStore((state) => state.status);
  const statusReason = useSolanaStreamStore((state) => state.statusReason);
  const reconnectAttempt = useSolanaStreamStore((state) => state.reconnectAttempt);
  const transactions = useSolanaStreamStore((state) => state.transactions);
  const lastReorgAt = useSolanaStreamStore((state) => state.lastReorgAt);
  const lastRollbackSlot = useSolanaStreamStore((state) => state.lastRollbackSlot);

  return {
    status,
    statusReason,
    reconnectAttempt,
    transactions,
    lastReorgAt,
    lastRollbackSlot
  };
}
