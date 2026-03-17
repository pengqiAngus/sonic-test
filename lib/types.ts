// 全项目共享类型定义：
// - API 地址常量
// - 行情/订单领域模型
// - WebSocket 消息协议
export const REST_API_URL =
  process.env.NEXT_PUBLIC_SMFS_REST_URL ?? "https://interviews-api.sonic.game";

export const WS_API_URL =
  process.env.NEXT_PUBLIC_SMFS_WS_URL ?? "wss://interviews-api.sonic.game/ws";
export const WS_SOLANA_STREAM_URL =
  process.env.NEXT_PUBLIC_SMFS_SOLANA_STREAM_URL ?? "wss://interviews-api.sonic.game/ws/stream";

export const SUPPORTED_MARKETS = ["BTC-PERP", "SOL-PERP"] as const;

// 仅允许受支持市场，避免字符串随意传递造成运行时问题。
export type MarketId = (typeof SUPPORTED_MARKETS)[number];
export type TradeSide = "buy" | "sell";
export type CandleInterval = "1s" | "1m" | "5m" | "15m";
export type OrderSide = "buy" | "sell";
export type OrderType = "limit";

export interface PriceLevel {
  price: number;
  size: number;
}

export interface TradeRecord {
  marketId: MarketId;
  tradeId: string;
  ts: number;
  price: number;
  size: number;
  side: TradeSide;
}

export interface MarketSnapshot {
  marketId: MarketId;
  // snapshot 可能不返回 seq；为空时由首条 book_delta 建立本地基线。
  seq: number | null;
  bids: PriceLevel[];
  asks: PriceLevel[];
  trades: TradeRecord[];
  fetchedAt: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface CandleResponse {
  marketId: MarketId;
  interval: CandleInterval;
  candles: Candle[];
}

export interface OrderPayload {
  marketId: MarketId;
  side: OrderSide;
  type: OrderType;
  price: number;
  size: number;
}

export interface OrderResponse {
  orderId?: string;
  status?: string;
  accepted?: boolean;
  [key: string]: unknown;
}

export interface HelloMessage {
  type: "hello";
  marketId: MarketId;
  serverTime: number;
}

export interface BookDeltaMessage {
  type: "book_delta";
  marketId: MarketId;
  ts: number;
  // 序列号必须严格递增，否则需要触发 gap 恢复。
  seq: number;
  bids: PriceLevel[];
  asks: PriceLevel[];
}

export interface TradeMessage extends TradeRecord {
  type: "trade";
}

export interface PongMessage {
  type: "pong";
  ts: number;
}

export interface ResetMessage {
  type: "reset";
  reason: string;
  ts: number;
}

export type MarketMessage =
  | HelloMessage
  | BookDeltaMessage
  | TradeMessage
  | PongMessage
  | ResetMessage;

export interface SolanaStreamFilters {
  programs: string[];
  accounts: string[];
}

export interface SolanaStreamHelloMessage {
  type: "stream_hello";
  serverTime: number;
  filters: SolanaStreamFilters;
}

export interface SolanaTransactionMessage {
  type: "transaction";
  signature: string;
  slot: number;
  blockTime: number | null;
  fee: number;
  computeUnitsConsumed: number;
  err: Record<string, unknown> | null;
  accounts: string[];
  programIds: string[];
  instructions: Array<{
    programId: string;
    accounts: string[];
    data: string;
  }>;
  seq: number;
}

export interface SolanaReorgMessage {
  type: "reorg";
  rollbackSlot: number;
  ts: number;
}

export type SolanaStreamMessage =
  | SolanaStreamHelloMessage
  | SolanaTransactionMessage
  | SolanaReorgMessage
  | PongMessage;

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "gap-detected"
  | "reconnecting";

export interface MessageRates {
  bookPerSecond: number;
  tradePerSecond: number;
}

export interface GapState {
  expectedSeq: number;
  receivedSeq: number;
}
