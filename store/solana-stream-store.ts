import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { SOLANA_STREAM_STATUS, type SolanaStreamStatus } from "@/lib/const";
import type { SolanaTransactionMessage } from "@/lib/types";

const MAX_RECENT_TRANSACTIONS = 300;

export interface SolanaStreamStoreState {
  status: SolanaStreamStatus;
  statusReason: string | null;
  reconnectAttempt: number;
  transactions: SolanaTransactionMessage[];
  lastReorgAt: number | null;
  lastRollbackSlot: number | null;
  reset: () => void;
  setMachineStatus: (
    status: SolanaStreamStatus,
    statusReason: string | null,
    reconnectAttempt: number
  ) => void;
  pushTransaction: (message: SolanaTransactionMessage) => void;
  applyReorg: (ts: number, rollbackSlot: number) => void;
}

export const useSolanaStreamStore = create<SolanaStreamStoreState>()(
  subscribeWithSelector((set) => ({
    status: SOLANA_STREAM_STATUS.CONNECTING,
    statusReason: null,
    reconnectAttempt: 0,
    transactions: [],
    lastReorgAt: null,
    lastRollbackSlot: null,
    reset: () =>
      set({
        status: SOLANA_STREAM_STATUS.CONNECTING,
        statusReason: null,
        reconnectAttempt: 0,
        transactions: [],
        lastReorgAt: null,
        lastRollbackSlot: null
      }),
    setMachineStatus: (status, statusReason, reconnectAttempt) =>
      set((state) => {
        if (
          state.status === status &&
          state.statusReason === statusReason &&
          state.reconnectAttempt === reconnectAttempt
        ) {
          return state;
        }
        return { status, statusReason, reconnectAttempt };
      }),
    pushTransaction: (message) =>
      set((state) => {
        const exists = state.transactions.some((item) => item.signature === message.signature);
        if (exists) {
          return state;
        }
        return {
          transactions: [message, ...state.transactions].slice(0, MAX_RECENT_TRANSACTIONS)
        };
      }),
    applyReorg: (ts, rollbackSlot) =>
      set((state) => ({
        lastReorgAt: ts,
        lastRollbackSlot: rollbackSlot,
        transactions: state.transactions.filter((item) => item.slot <= rollbackSlot)
      }))
  }))
);
