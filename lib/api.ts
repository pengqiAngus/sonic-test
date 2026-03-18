import { normalizePrice, normalizeSize } from "@/lib/number";
import {
  type Candle,
  type CandleInterval,
  type CandleResponse,
  REST_API_URL,
  WS_API_URL,
  WS_SOLANA_STREAM_URL,
  type MarketId,
  type MarketSnapshot,
  type OrderPayload,
  type OrderResponse,
  type PriceLevel,
  type TradeRecord
} from "@/lib/types";

// API layer responsibilities:
// 1) Request backend endpoints
// 2) Normalize unstable response shapes into frontend-friendly structures
// 3) Standardize price/size precision at entry points
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

function readSnapshotSeq(payload: SnapshotPayload): number | null {
  const raw = payload.seq ?? payload.lastSeq;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
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

// Handle missing backend fields so UI always receives a complete TradeRecord.
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

// Fetch snapshot as the local orderbook initialization baseline.
export async function fetchSnapshot(marketId: MarketId): Promise<MarketSnapshot> {
  const payload = await fetchJSON<SnapshotPayload>(`${REST_API_URL}/markets/${marketId}/snapshot`);

  const bids = payload.bids ?? payload.book?.bids ?? [];
  const asks = payload.asks ?? payload.book?.asks ?? [];
  const trades = payload.trades ?? payload.recentTrades ?? [];

  return {
    marketId,
    seq: readSnapshotSeq(payload),
    bids: bids.map(normalizeLevel),
    asks: asks.map(normalizeLevel),
    trades: trades.map((trade) => normalizeTrade(marketId, trade)),
    fetchedAt: Date.now()
  };
}

// Fetch historical candles for initial chart render before live trade updates.
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

// Mock order endpoint: only wraps request and error handling, no business decisions.
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

// Build a WS URL with marketId query parameter.
export function getMarketWebSocketUrl(marketId: MarketId): string {
  const url = new URL(WS_API_URL);
  url.searchParams.set("marketId", marketId);
  return url.toString();
}

export function getSolanaStreamWebSocketUrl(): string {
  const url = new URL(WS_SOLANA_STREAM_URL);

  return url.toString();
}
