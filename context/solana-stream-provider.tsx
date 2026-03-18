"use client";

import { useCallback, useEffect, useRef } from "react";

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
import { useSolanaStreamStore } from "@/store/solana-stream-store";
import { isObject, safeJsonParse } from "@/lib/utils";

const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 12_000;

function parseMessage(raw: string): SolanaStreamMessage | null {
  return safeJsonParse<SolanaStreamMessage>(raw);
}

function isStreamHelloMessage(message: unknown): message is SolanaStreamHelloMessage {
  return (
    isObject(message) && message.type === "stream_hello" && typeof message.serverTime === "number"
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

export function SolanaStreamProvider({
  children
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const socketRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const pongTimeoutRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);

  const [machineState, send] = useMachine(solanaStreamMachine);

  const closeSocket = useCallback((reason = "cleanup"): void => {
    if (pingIntervalRef.current !== null) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (pongTimeoutRef.current !== null) {
      window.clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
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
    useSolanaStreamStore
      .getState()
      .setMachineStatus(
        deriveStatus(String(machineState.value)),
        machineState.context.reason,
        machineState.context.attempt
      );
  }, [machineState.context.attempt, machineState.context.reason, machineState.value]);

  useEffect(() => {
    useSolanaStreamStore.getState().reset();
    send({ type: "CONNECT" });

    return () => {
      closeSocket("provider-unmount");
      send({ type: "DISCONNECT", reason: "Provider unmounted" });
    };
  }, [closeSocket, send]);

  const shouldMaintainSocket = machineState.matches("connecting") || machineState.matches("open");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onOnline = (): void => {
      if (machineState.matches("closedConnection")) {
        send({ type: "CONNECT" });
      }
    };

    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [machineState, send]);

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
          if (pongTimeoutRef.current !== null) {
            window.clearTimeout(pongTimeoutRef.current);
          }
          pongTimeoutRef.current = window.setTimeout(() => {
            send({ type: "SOCKET_ERROR", reason: "Heartbeat timeout" });
            closeSocket("heartbeat-timeout");
          }, PONG_TIMEOUT_MS);
        }
      }, PING_INTERVAL_MS);

      send({ type: "SOCKET_OPEN" });
    };

    socket.onmessage = (event) => {
      const message = parseMessage(String(event.data));
      if (!message) {
        return;
      }

      if (isStreamHelloMessage(message)) {
        return;
      }
      if (message.type === "pong") {
        if (pongTimeoutRef.current !== null) {
          window.clearTimeout(pongTimeoutRef.current);
          pongTimeoutRef.current = null;
        }
        return;
      }

      if (isTransactionMessage(message)) {
        useSolanaStreamStore.getState().pushTransaction(message);
        return;
      }

      if (isReorgMessage(message)) {
        useSolanaStreamStore.getState().applyReorg(message.ts, message.rollbackSlot);
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
      if (pongTimeoutRef.current !== null) {
        window.clearTimeout(pongTimeoutRef.current);
        pongTimeoutRef.current = null;
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

  return <>{children}</>;
}
