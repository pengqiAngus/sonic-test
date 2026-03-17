export const REST_API_URL =
  process.env.NEXT_PUBLIC_SMFS_REST_URL ?? "https://interviews-api.sonic.game";

export const WS_API_URL =
  process.env.NEXT_PUBLIC_SMFS_WS_URL ?? "wss://interviews-api.sonic.game/ws";

export const SUPPORTED_MARKETS = ["BTC-PERP", "SOL-PERP"] as const;

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
  seq: number;
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

export type MarketMessage = HelloMessage | BookDeltaMessage | TradeMessage | PongMessage;

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
