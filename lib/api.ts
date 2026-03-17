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

// API 层职责：
// 1) 请求后端接口
// 2) 将不稳定响应格式归一为前端统一结构
// 3) 在入口处完成价格/数量精度标准化
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

// 兼容后端字段缺省，确保 UI 层永远拿到完整 TradeRecord。
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

// 拉取快照作为本地订单簿初始化基线。
export async function fetchSnapshot(marketId: MarketId): Promise<MarketSnapshot> {
  const payload = await fetchJSON<SnapshotPayload>(
    `${REST_API_URL}/markets/${marketId}/snapshot`
  );

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

// 拉取历史 K 线，供图表先渲染历史再叠加实时 trade。
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

// 模拟下单接口：仅封装请求与错误信息，不做业务决策。
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

// 统一生成带 marketId 参数的 WS 地址。
export function getMarketWebSocketUrl(marketId: MarketId): string {
  const url = new URL(WS_API_URL);
  url.searchParams.set("marketId", marketId);
  return url.toString();
}

export function getSolanaStreamWebSocketUrl(filters?: {
  programs?: string[];
  accounts?: string[];
}): string {
  const url = new URL(WS_SOLANA_STREAM_URL);

  if (filters?.programs && filters.programs.length > 0) {
    url.searchParams.set("programs", filters.programs.join(","));
  }
  if (filters?.accounts && filters.accounts.length > 0) {
    url.searchParams.set("accounts", filters.accounts.join(","));
  }

  return url.toString();
}
