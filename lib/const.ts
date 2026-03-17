import type { ConnectionState } from "@/lib/types";

export const MARKET_MACHINE_STATE_TO_CONNECTION_STATE = {
  idle: "idle",
  connecting: "connecting",
  open: "open",
  gapDetected: "gap-detected",
  reconnecting: "reconnecting"
} as const;

export const CONNECTION_STATE_LABEL: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  open: "Connected",
  "gap-detected": "Gap Detected",
  reconnecting: "Reconnecting"
};

export const CONNECTION_STATE_TONE_CLASS: Record<ConnectionState, string> = {
  idle: "bg-slate-400",
  connecting: "bg-slate-400",
  open: "bg-emerald-500",
  "gap-detected": "bg-amber-500",
  reconnecting: "bg-orange-500"
};

export const SOLANA_STREAM_STATUS = {
  CONNECTING: "connecting",
  OPEN: "open",
  RECONNECTING: "reconnecting",
  CLOSED: "closed"
} as const;

export type SolanaStreamStatus =
  (typeof SOLANA_STREAM_STATUS)[keyof typeof SOLANA_STREAM_STATUS];

export const SOLANA_MACHINE_STATE_TO_STATUS = {
  idle: SOLANA_STREAM_STATUS.CLOSED,
  connecting: SOLANA_STREAM_STATUS.CONNECTING,
  open: SOLANA_STREAM_STATUS.OPEN,
  reconnecting: SOLANA_STREAM_STATUS.RECONNECTING
} as const;

export const SOLANA_STREAM_STATUS_LABEL: Record<SolanaStreamStatus, string> = {
  connecting: "Connecting",
  open: "Connected",
  reconnecting: "Reconnecting",
  closed: "Closed"
};

export const SOLANA_STREAM_STATUS_BADGE_CLASS: Record<SolanaStreamStatus, string> = {
  connecting: "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700",
  open: "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700",
  reconnecting: "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700",
  closed: "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"
};
