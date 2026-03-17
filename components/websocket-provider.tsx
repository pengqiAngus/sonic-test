"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";

import { useMachine } from "@xstate/react";
import useSWR from "swr";

import { fetchSnapshot, getMarketWebSocketUrl } from "@/lib/api";
import type { ConnectionState, GapState, MarketId, MarketMessage } from "@/lib/types";
import { websocketMachine } from "@/lib/websocket-machine";
import { useMarketStore, type BufferedFrame } from "@/store/market-store";

function createEmptyFrame(lastSeq = 0): BufferedFrame {
  return {
    deltas: [],
    trades: [],
    lastSeq
  };
}

function parseMessage(raw: string): MarketMessage | null {
  try {
    return JSON.parse(raw) as MarketMessage;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPriceLevelArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(
    (level) =>
      isObject(level) && typeof level.price === "number" && typeof level.size === "number"
  );
}

function isHelloMessage(message: unknown): message is Extract<MarketMessage, { type: "hello" }> {
  return (
    isObject(message) &&
    message.type === "hello" &&
    typeof message.marketId === "string" &&
    typeof message.serverTime === "number"
  );
}

function isPongMessage(message: unknown): message is Extract<MarketMessage, { type: "pong" }> {
  return isObject(message) && message.type === "pong" && typeof message.ts === "number";
}

function isTradeMessage(message: unknown): message is Extract<MarketMessage, { type: "trade" }> {
  return (
    isObject(message) &&
    message.type === "trade" &&
    typeof message.marketId === "string" &&
    typeof message.tradeId === "string" &&
    typeof message.ts === "number" &&
    typeof message.price === "number" &&
    typeof message.size === "number" &&
    (message.side === "buy" || message.side === "sell")
  );
}

function isBookDeltaMessage(
  message: unknown
): message is Extract<MarketMessage, { type: "book_delta" }> {
  return (
    isObject(message) &&
    message.type === "book_delta" &&
    typeof message.marketId === "string" &&
    typeof message.ts === "number" &&
    typeof message.seq === "number" &&
    isPriceLevelArray(message.bids) &&
    isPriceLevelArray(message.asks)
  );
}

function deriveConnectionState(value: string): ConnectionState {
  switch (value) {
    case "connecting":
      return "connecting";
    case "open":
      return "open";
    case "gapDetected":
      return "gap-detected";
    case "reconnecting":
      return "reconnecting";
    default:
      return "idle";
  }
}

export function WebSocketProvider({
  marketId,
  children
}: {
  marketId: MarketId;
  children: React.ReactNode;
}): React.ReactElement {
  const resetMarket = useMarketStore((state) => state.resetMarket);
  const hydrateSnapshot = useMarketStore((state) => state.hydrateSnapshot);
  const applyFrame = useMarketStore((state) => state.applyFrame);
  const clearGap = useMarketStore((state) => state.clearGap);
  const markGap = useMarketStore((state) => state.markGap);
  const markPong = useMarketStore((state) => state.markPong);
  const setMessageRates = useMarketStore((state) => state.setMessageRates);
  const setConnectionState = useMarketStore((state) => state.setConnectionState);

  const [machineState, send] = useMachine(websocketMachine);

  const socketRef = useRef<WebSocket | null>(null);
  const rafRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const rateIntervalRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const seqRef = useRef(0);
  const frameRef = useRef<BufferedFrame>(createEmptyFrame());
  const appliedSnapshotRef = useRef<number | null>(null);
  const bookRateRef = useRef(0);
  const tradeRateRef = useRef(0);
  const messageHandlerRef = useRef<(message: MarketMessage) => void>(() => undefined);

  const snapshotKey = useMemo(() => `snapshot:${marketId}`, [marketId]);
  const { data: snapshot, error: snapshotError, mutate } = useSWR(snapshotKey, () =>
    fetchSnapshot(marketId)
  );

  const cancelFrame = useCallback((): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  function flushFrame(): void {
    rafRef.current = null;

    const frame = frameRef.current;

    if (frame.deltas.length === 0 && frame.trades.length === 0) {
      return;
    }

    frameRef.current = createEmptyFrame(seqRef.current);

    startTransition(() => {
      applyFrame(frame);
    });
  }

  function scheduleFlush(): void {
    if (rafRef.current !== null) {
      return;
    }

    rafRef.current = window.requestAnimationFrame(() => {
      flushFrame();
    });
  }

  const closeSocket = useCallback((reason = "cleanup"): void => {
    cancelFrame();

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
  }, [cancelFrame]);

  messageHandlerRef.current = (rawMessage) => {
    if (!isObject(rawMessage) || typeof rawMessage.type !== "string") {
      return;
    }

    if (isHelloMessage(rawMessage)) {
      if (rawMessage.marketId !== marketId) {
        return;
      }

      return;
    }

    if (isPongMessage(rawMessage)) {
      markPong(rawMessage.ts);
      return;
    }

    if (isTradeMessage(rawMessage)) {
      if (rawMessage.marketId !== marketId) {
        return;
      }

      tradeRateRef.current += 1;
      frameRef.current.trades.push(rawMessage);
      scheduleFlush();
      return;
    }

    if (!isBookDeltaMessage(rawMessage)) {
      return;
    }

    if (rawMessage.marketId !== marketId) {
      return;
    }

    bookRateRef.current += 1;

    const expectedSeq = seqRef.current + 1;

    if (rawMessage.seq <= seqRef.current) {
      return;
    }

    if (rawMessage.seq !== expectedSeq) {
      const gap: GapState = {
        expectedSeq,
        receivedSeq: rawMessage.seq
      };

      frameRef.current = createEmptyFrame(seqRef.current);
      markGap(gap);
      closeSocket("gap-detected");
      send({
        type: "GAP_DETECTED",
        expectedSeq: gap.expectedSeq,
        receivedSeq: gap.receivedSeq
      });
      void mutate();
      return;
    }

    seqRef.current = rawMessage.seq;
    frameRef.current.lastSeq = rawMessage.seq;
    frameRef.current.deltas.push(rawMessage);
    scheduleFlush();
  };

  useEffect(() => {
    resetMarket(marketId);
    appliedSnapshotRef.current = null;
    frameRef.current = createEmptyFrame();
    seqRef.current = 0;
    bookRateRef.current = 0;
    tradeRateRef.current = 0;

    return () => {
      closeSocket("provider-unmount");
      send({
        type: "DISCONNECT",
        reason: "Provider unmounted"
      });
    };
  }, [closeSocket, marketId, resetMarket, send]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (appliedSnapshotRef.current === snapshot.fetchedAt) {
      return;
    }

    appliedSnapshotRef.current = snapshot.fetchedAt;
    hydrateSnapshot(snapshot);
    clearGap();
    seqRef.current = snapshot.seq;
    frameRef.current = createEmptyFrame(snapshot.seq);

    if (machineState.matches("idle")) {
      send({
        type: "CONNECT"
      });
      return;
    }

    if (machineState.matches("gapDetected")) {
      send({
        type: "SNAPSHOT_SYNCED"
      });
    }
  }, [clearGap, hydrateSnapshot, machineState, send, snapshot]);

  const machineValue = String(machineState.value);
  const machineAttempt = machineState.context.attempt;
  const machineReason = machineState.context.reason;

  useEffect(() => {
    const connectionState = deriveConnectionState(machineValue);
    const message = snapshotError instanceof Error ? snapshotError.message : machineReason;

    setConnectionState(connectionState, machineAttempt, message);
  }, [machineAttempt, machineReason, machineValue, setConnectionState, snapshotError]);

  useEffect(() => {
    rateIntervalRef.current = window.setInterval(() => {
      setMessageRates({
        bookPerSecond: bookRateRef.current,
        tradePerSecond: tradeRateRef.current
      });

      bookRateRef.current = 0;
      tradeRateRef.current = 0;
    }, 1_000);

    return () => {
      if (rateIntervalRef.current !== null) {
        window.clearInterval(rateIntervalRef.current);
      }
    };
  }, [setMessageRates]);

  const shouldMaintainSocket =
    Boolean(snapshot) && (machineState.matches("connecting") || machineState.matches("open"));

  useEffect(() => {
    if (!shouldMaintainSocket) {
      closeSocket("state-transition");
      return;
    }

    if (socketRef.current) {
      return;
    }

    intentionalCloseRef.current = false;

    const socket = new WebSocket(getMarketWebSocketUrl(marketId));
    socketRef.current = socket;

    socket.onopen = () => {
      pingIntervalRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 15_000);

      send({
        type: "SOCKET_OPEN"
      });
    };

    socket.onmessage = (event) => {
      const message = parseMessage(String(event.data));

      if (message) {
        messageHandlerRef.current(message);
      }
    };

    socket.onerror = () => {
      send({
        type: "SOCKET_ERROR",
        reason: "WebSocket error"
      });
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
  }, [closeSocket, marketId, mutate, send, shouldMaintainSocket]);

  return <>{children}</>;
}
