"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMachine } from "@xstate/react";

import { getSolanaStreamWebSocketUrl } from "@/lib/api";
import {
  SOLANA_MACHINE_STATE_TO_STATUS,
  SOLANA_STREAM_STATUS,
  type SolanaStreamStatus
} from "@/lib/const";
import { solanaStreamMachine } from "@/lib/solana-stream-machine";
import type {
  SolanaReorgMessage,
  SolanaStreamHelloMessage,
  SolanaStreamMessage,
  SolanaTransactionMessage
} from "@/lib/types";
import { isObject, safeJsonParse } from "@/lib/utils";

const MAX_RECENT_TRANSACTIONS = 300;

export interface SolanaStreamContextValue {
  status: SolanaStreamStatus;
  statusReason: string | null;
  reconnectAttempt: number;
  transactions: SolanaTransactionMessage[];
  lastReorgAt: number | null;
  lastRollbackSlot: number | null;
  activeFilters: { programs: string[]; accounts: string[] };
}

export const SolanaStreamContext = createContext<SolanaStreamContextValue | null>(null);

function parseMessage(raw: string): SolanaStreamMessage | null {
  return safeJsonParse<SolanaStreamMessage>(raw);
}

function isStreamHelloMessage(message: unknown): message is SolanaStreamHelloMessage {
  return (
    isObject(message) &&
    message.type === "stream_hello" &&
    typeof message.serverTime === "number" &&
    isObject(message.filters) &&
    Array.isArray(message.filters.programs) &&
    Array.isArray(message.filters.accounts)
  );
}

function isTransactionMessage(message: unknown): message is SolanaTransactionMessage {
  return (
    isObject(message) &&
    message.type === "transaction" &&
    typeof message.signature === "string" &&
    typeof message.slot === "number" &&
    (typeof message.blockTime === "number" || message.blockTime === null) &&
    typeof message.fee === "number" &&
    Array.isArray(message.programIds) &&
    typeof message.seq === "number"
  );
}

function isReorgMessage(message: unknown): message is SolanaReorgMessage {
  return (
    isObject(message) &&
    message.type === "reorg" &&
    typeof message.rollbackSlot === "number" &&
    typeof message.ts === "number"
  );
}

function deriveStatus(value: string): SolanaStreamStatus {
  return (
    SOLANA_MACHINE_STATE_TO_STATUS[value as keyof typeof SOLANA_MACHINE_STATE_TO_STATUS] ??
    SOLANA_STREAM_STATUS.CLOSED
  );
}

export function SolanaStreamProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [transactions, setTransactions] = useState<SolanaTransactionMessage[]>([]);
  const [lastReorgAt, setLastReorgAt] = useState<number | null>(null);
  const [lastRollbackSlot, setLastRollbackSlot] = useState<number | null>(null);
  const [activeFilters, setActiveFilters] = useState<{ programs: string[]; accounts: string[] }>({
    programs: [],
    accounts: []
  });
  const [status, setStatus] = useState<SolanaStreamStatus>(SOLANA_STREAM_STATUS.CONNECTING);

  const socketRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);

  const [machineState, send] = useMachine(solanaStreamMachine);

  const closeSocket = useCallback((reason = "cleanup"): void => {
    if (pingIntervalRef.current !== null) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    const socket = socketRef.current;
    if (socket) {
      intentionalCloseRef.current = true;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, reason);
      }
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    setStatus(deriveStatus(String(machineState.value)));
  }, [machineState.value]);

  useEffect(() => {
    send({ type: "CONNECT" });

    return () => {
      closeSocket("provider-unmount");
      send({ type: "DISCONNECT", reason: "Provider unmounted" });
    };
  }, [closeSocket, send]);

  const shouldMaintainSocket = machineState.matches("connecting") || machineState.matches("open");

  useEffect(() => {
    if (!shouldMaintainSocket) {
      closeSocket("state-transition");
      return;
    }

    if (socketRef.current) {
      return;
    }

    intentionalCloseRef.current = false;
    const socket = new WebSocket(getSolanaStreamWebSocketUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      pingIntervalRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 20_000);

      send({ type: "SOCKET_OPEN" });
    };

    socket.onmessage = (event) => {
      const message = parseMessage(String(event.data));
      if (!message) {
        return;
      }

      if (isStreamHelloMessage(message)) {
        setActiveFilters({
          programs: message.filters.programs,
          accounts: message.filters.accounts
        });
        return;
      }

      if (isTransactionMessage(message)) {
        setTransactions((prev) => {
          const exists = prev.some((item) => item.signature === message.signature);
          if (exists) {
            return prev;
          }
          return [message, ...prev].slice(0, MAX_RECENT_TRANSACTIONS);
        });
        return;
      }

      if (isReorgMessage(message)) {
        setLastReorgAt(message.ts);
        setLastRollbackSlot(message.rollbackSlot);
        setTransactions((prev) => prev.filter((item) => item.slot <= message.rollbackSlot));
      }
    };

    socket.onerror = () => {
      send({ type: "SOCKET_ERROR", reason: "WebSocket error" });
    };

    socket.onclose = (event) => {
      socketRef.current = null;
      if (pingIntervalRef.current !== null) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      if (!intentionalCloseRef.current) {
        send({
          type: "SOCKET_CLOSED",
          reason: event.reason || `Closed with code ${event.code}`
        });
      }
      intentionalCloseRef.current = false;
    };

    return () => {
      closeSocket("effect-cleanup");
    };
  }, [closeSocket, send, shouldMaintainSocket]);

  const contextValue = useMemo<SolanaStreamContextValue>(
    () => ({
      status,
      statusReason: machineState.context.reason,
      reconnectAttempt: machineState.context.attempt,
      transactions,
      lastReorgAt,
      lastRollbackSlot,
      activeFilters
    }),
    [
      activeFilters,
      lastReorgAt,
      lastRollbackSlot,
      machineState.context.attempt,
      machineState.context.reason,
      status,
      transactions
    ]
  );

  return <SolanaStreamContext.Provider value={contextValue}>{children}</SolanaStreamContext.Provider>;
}

