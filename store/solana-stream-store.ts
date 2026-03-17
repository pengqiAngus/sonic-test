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
  activeFilters: { programs: string[]; accounts: string[] };
  reset: () => void;
  setMachineStatus: (
    status: SolanaStreamStatus,
    statusReason: string | null,
    reconnectAttempt: number
  ) => void;
  setActiveFilters: (filters: { programs: string[]; accounts: string[] }) => void;
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
    activeFilters: { programs: [], accounts: [] },
    reset: () =>
      set({
        status: SOLANA_STREAM_STATUS.CONNECTING,
        statusReason: null,
        reconnectAttempt: 0,
        transactions: [],
        lastReorgAt: null,
        lastRollbackSlot: null,
        activeFilters: { programs: [], accounts: [] }
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
    setActiveFilters: (filters) =>
      set((state) => {
        const samePrograms =
          state.activeFilters.programs.length === filters.programs.length &&
          state.activeFilters.programs.every(
            (programId, index) => programId === filters.programs[index]
          );
        const sameAccounts =
          state.activeFilters.accounts.length === filters.accounts.length &&
          state.activeFilters.accounts.every(
            (account, index) => account === filters.accounts[index]
          );
        if (samePrograms && sameAccounts) {
          return state;
        }
        return {
          activeFilters: {
            programs: [...filters.programs],
            accounts: [...filters.accounts]
          }
        };
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
