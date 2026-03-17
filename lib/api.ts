import { normalizePrice, normalizeSize } from "@/lib/number";
import {
  type Candle,
  type CandleInterval,
  type CandleResponse,
  REST_API_URL,
  WS_API_URL,
  type MarketId,
  type MarketSnapshot,
  type OrderPayload,
  type OrderResponse,
  type PriceLevel,
  type TradeRecord
} from "@/lib/types";

interface SnapshotPayload {
  seq?: number;
  lastSeq?: number;
  bids?: PriceLevel[];
  asks?: PriceLevel[];
  trades?: Array<Partial<TradeRecord>>;
  recentTrades?: Array<Partial<TradeRecord>>;
  book?: {
    bids?: PriceLevel[];
    asks?: PriceLevel[];
  };
}

interface CandlePayload {
  marketId?: MarketId;
  interval?: CandleInterval;
  candles?: Candle[];
}

function normalizeLevel(level: PriceLevel): PriceLevel {
  return {
    price: normalizePrice(Number(level.price ?? 0)),
    size: normalizeSize(Number(level.size ?? 0))
  };
}

function normalizeTrade(marketId: MarketId, trade: Partial<TradeRecord>): TradeRecord {
  return {
    marketId,
    tradeId: String(trade.tradeId ?? crypto.randomUUID()),
    ts: Number(trade.ts ?? Date.now()),
    price: normalizePrice(Number(trade.price ?? 0)),
    size: normalizeSize(Number(trade.size ?? 0)),
    side: trade.side === "sell" ? "sell" : "buy"
  };
}

export async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function fetchSnapshot(marketId: MarketId): Promise<MarketSnapshot> {
  const payload = await fetchJSON<SnapshotPayload>(
    `${REST_API_URL}/markets/${marketId}/snapshot`
  );

  const bids = payload.bids ?? payload.book?.bids ?? [];
  const asks = payload.asks ?? payload.book?.asks ?? [];
  const trades = payload.trades ?? payload.recentTrades ?? [];

  return {
    marketId,
    seq: Number(payload.seq ?? payload.lastSeq ?? 0),
    bids: bids.map(normalizeLevel),
    asks: asks.map(normalizeLevel),
    trades: trades.map((trade) => normalizeTrade(marketId, trade)),
    fetchedAt: Date.now()
  };
}

export async function fetchCandles(
  marketId: MarketId,
  interval: CandleInterval,
  limit = 600
): Promise<CandleResponse> {
  const payload = await fetchJSON<CandlePayload>(
    `${REST_API_URL}/markets/${marketId}/candles?interval=${interval}&limit=${limit}`
  );

  return {
    marketId: payload.marketId ?? marketId,
    interval: payload.interval ?? interval,
    candles: (payload.candles ?? []).map((candle) => ({
      time: Number(candle.time),
      open: normalizePrice(Number(candle.open ?? 0)),
      high: normalizePrice(Number(candle.high ?? 0)),
      low: normalizePrice(Number(candle.low ?? 0)),
      close: normalizePrice(Number(candle.close ?? 0)),
      volume: normalizeSize(Number(candle.volume ?? 0)),
      trades: Number(candle.trades ?? 0)
    }))
  };
}

export async function submitOrder(payload: OrderPayload): Promise<OrderResponse> {
  const response = await fetch(`${REST_API_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Order rejected with status ${response.status}`);
  }

  return (await response.json()) as OrderResponse;
}

export function getMarketWebSocketUrl(marketId: MarketId): string {
  const url = new URL(WS_API_URL);
  url.searchParams.set("marketId", marketId);
  return url.toString();
}
