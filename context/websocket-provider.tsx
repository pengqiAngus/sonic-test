"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";

import { useMachine } from "@xstate/react";
import useSWR from "swr";

import { fetchSnapshot, getMarketWebSocketUrl } from "@/lib/api";
import { MARKET_MACHINE_STATE_TO_CONNECTION_STATE } from "@/lib/const";
import type { ConnectionState, GapState, MarketId, MarketMessage } from "@/lib/types";
import { isObject, safeJsonParse } from "@/lib/utils";
import { websocketMachine } from "@/lib/websocket-machine";
import { useMarketStore, type BufferedFrame } from "@/store/market-store";

// Create an empty frame used to buffer deltas within one animation frame.
function createEmptyFrame(lastSeq = 0): BufferedFrame {
  return {
    deltas: [],
    trades: [],
    lastSeq
  };
}

// Safe WebSocket text message parsing to avoid breaking the message loop.
function parseMessage(raw: string): MarketMessage | null {
  return safeJsonParse<MarketMessage>(raw);
}

// The following type guards provide runtime protection:
// backend payloads can still be malformed even with TypeScript types.
function isPriceLevelArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(
    (level) => isObject(level) && typeof level.price === "number" && typeof level.size === "number"
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

function isResetMessage(message: unknown): message is Extract<MarketMessage, { type: "reset" }> {
  return (
    isObject(message) &&
    message.type === "reset" &&
    typeof message.reason === "string" &&
    typeof message.ts === "number"
  );
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

// Map machine state value to a UI-facing connection status.
function deriveConnectionState(value: string): ConnectionState {
  return (
    MARKET_MACHINE_STATE_TO_CONNECTION_STATE[
      value as keyof typeof MARKET_MACHINE_STATE_TO_CONNECTION_STATE
    ] ?? "idle"
  );
}

export function WebSocketProvider({
  marketId,
  children
}: {
  marketId: MarketId;
  children: React.ReactNode;
}): React.ReactElement {
  // -------------------- store write actions only (no derived calculations here) --------------------
  const resetMarket = useMarketStore((state) => state.resetMarket);
  const hydrateSnapshot = useMarketStore((state) => state.hydrateSnapshot);
  const applyFrame = useMarketStore((state) => state.applyFrame);
  const clearGap = useMarketStore((state) => state.clearGap);
  const markGap = useMarketStore((state) => state.markGap);
  const markPong = useMarketStore((state) => state.markPong);
  const setMessageRates = useMarketStore((state) => state.setMessageRates);
  const setConnectionState = useMarketStore((state) => state.setConnectionState);

  const [machineState, send] = useMachine(websocketMachine);

  // -------------------- use refs for high-frequency state to avoid render-per-message --------------------
  const socketRef = useRef<WebSocket | null>(null);
  const rafRef = useRef<number | null>(null);
  const flushTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const rateIntervalRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const seqRef = useRef(0);
  const frameRef = useRef<BufferedFrame>(createEmptyFrame());
  const appliedSnapshotRef = useRef<number | null>(null);
  const bookRateRef = useRef(0);
  const tradeRateRef = useRef(0);
  const hasSeqBaselineRef = useRef(false);
  const messageHandlerRef = useRef<(message: MarketMessage) => void>(() => undefined);

  // SWR key changes on market switch and triggers a new snapshot fetch.
  const snapshotKey = useMemo(() => `snapshot:${marketId}`, [marketId]);
  const {
    data: snapshot,
    error: snapshotError,
    mutate
  } = useSWR(snapshotKey, () => fetchSnapshot(marketId));

  const cancelFrame = useCallback((): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (flushTimeoutRef.current !== null) {
      window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
  }, []);

  // Commit once per frame to reduce render pressure from high-frequency messages.
  function flushFrame(): void {
    rafRef.current = null;
    flushTimeoutRef.current = null;

    const frame = frameRef.current;

    // Skip store updates when no deltas are buffered.
    if (frame.deltas.length === 0 && frame.trades.length === 0) {
      return;
    }

    frameRef.current = createEmptyFrame(seqRef.current);

    startTransition(() => {
      applyFrame(frame);
    });
  }

  function scheduleFlush(): void {
    if (rafRef.current !== null || flushTimeoutRef.current !== null) {
      // Flush already queued; do not queue again.
      return;
    }

    // In hidden tabs, requestAnimationFrame may pause or be heavily throttled.
    // Use a short timeout fallback to avoid unbounded buffer growth.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flushTimeoutRef.current = window.setTimeout(() => {
        flushFrame();
      }, 120);
      return;
    }

    rafRef.current = window.requestAnimationFrame(() => {
      flushFrame();
    });
  }

  const closeSocket = useCallback(
    (reason = "cleanup"): void => {
      cancelFrame();

      if (pingIntervalRef.current !== null) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      const socket = socketRef.current;

      if (socket) {
        // Mark as intentional close to avoid false reconnect transitions in onclose.
        intentionalCloseRef.current = true;

        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          socket.close(1000, reason);
        }

        socketRef.current = null;
      }
    },
    [cancelFrame]
  );

  messageHandlerRef.current = (rawMessage) => {
    // Unified entry: validate shape before handling any message.
    if (!isObject(rawMessage) || typeof rawMessage.type !== "string") {
      return;
    }

    if (isHelloMessage(rawMessage)) {
      // hello is only handshake confirmation; filter by market and do not write store.
      if (rawMessage.marketId !== marketId) {
        return;
      }

      return;
    }

    if (isPongMessage(rawMessage)) {
      // Heartbeat reply only updates last pong timestamp for health display.
      markPong(rawMessage.ts);
      return;
    }

    if (isResetMessage(rawMessage)) {
      // Server reset requires snapshot refetch and local state rebuild.
      hasSeqBaselineRef.current = false;
      frameRef.current = createEmptyFrame(seqRef.current);
      closeSocket("server-reset");
      send({
        type: "GAP_DETECTED",
        expectedSeq: seqRef.current + 1,
        receivedSeq: seqRef.current + 1
      });
      void mutate();
      return;
    }

    if (isTradeMessage(rawMessage)) {
      if (rawMessage.marketId !== marketId) {
        return;
      }

      tradeRateRef.current += 1;
      // Do not set state immediately; buffer into frame and batch on RAF.
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

    if (!hasSeqBaselineRef.current) {
      // If snapshot has no seq, initialize baseline from first delta to avoid false gaps.
      hasSeqBaselineRef.current = true;
      seqRef.current = rawMessage.seq;
      frameRef.current.lastSeq = rawMessage.seq;
      frameRef.current.deltas.push(rawMessage);
      scheduleFlush();
      return;
    }

    // Critical consistency rule: book_delta seq must increase strictly and continuously.
    const expectedSeq = seqRef.current + 1;

    if (rawMessage.seq <= seqRef.current) {
      // Drop stale or duplicate messages.
      return;
    }

    if (rawMessage.seq !== expectedSeq) {
      const gap: GapState = {
        expectedSeq,
        receivedSeq: rawMessage.seq
      };

      // On gap, discard current frame to avoid applying invalid deltas.
      frameRef.current = createEmptyFrame(seqRef.current);
      markGap(gap);
      closeSocket("gap-detected");
      send({
        type: "GAP_DETECTED",
        expectedSeq: gap.expectedSeq,
        receivedSeq: gap.receivedSeq
      });
      // Trigger snapshot refetch to recover a consistent baseline.
      void mutate();
      return;
    }

    seqRef.current = rawMessage.seq;
    frameRef.current.lastSeq = rawMessage.seq;
    frameRef.current.deltas.push(rawMessage);
    scheduleFlush();
  };

  useEffect(() => {
    // On market switch (or first mount), reset local state and wait for new snapshot.
    resetMarket(marketId);
    appliedSnapshotRef.current = null;
    frameRef.current = createEmptyFrame();
    seqRef.current = 0;
    hasSeqBaselineRef.current = false;
    bookRateRef.current = 0;
    tradeRateRef.current = 0;

    return () => {
      // Intentionally close on provider unmount to avoid stale sockets/timers.
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
      // Avoid rehydrating store with the same snapshot.
      return;
    }

    appliedSnapshotRef.current = snapshot.fetchedAt;
    hydrateSnapshot(snapshot);
    clearGap();
    // Snapshot may not contain seq; if missing, first delta establishes seq baseline.
    if (typeof snapshot.seq === "number") {
      seqRef.current = snapshot.seq;
      hasSeqBaselineRef.current = true;
    } else {
      seqRef.current = 0;
      hasSeqBaselineRef.current = false;
    }
    frameRef.current = createEmptyFrame(seqRef.current);

    if (machineState.matches("idle")) {
      // Start WS after the first snapshot is ready.
      send({
        type: "CONNECT"
      });
      return;
    }

    if (machineState.matches("gapDetected")) {
      // In gap flow: snapshot is synced, notify machine to reconnect.
      send({
        type: "SNAPSHOT_SYNCED"
      });
    }
  }, [clearGap, hydrateSnapshot, machineState, send, snapshot]);

  const machineValue = String(machineState.value);
  const machineAttempt = machineState.context.attempt;
  const machineReason = machineState.context.reason;

  useEffect(() => {
    // Project machine state into UI store for indicator display.
    const connectionState = deriveConnectionState(machineValue);
    const message = snapshotError instanceof Error ? snapshotError.message : machineReason;

    setConnectionState(connectionState, machineAttempt, message);
  }, [machineAttempt, machineReason, machineValue, setConnectionState, snapshotError]);

  useEffect(() => {
    // Aggregate message throughput once per second to avoid UI flicker.
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
    // Ensure socket is closed when not in a connect-maintained state.
    if (!shouldMaintainSocket) {
      closeSocket("state-transition");
      return;
    }

    if (socketRef.current) {
      // Skip creating a new socket when one already exists.
      return;
    }

    intentionalCloseRef.current = false;

    const socket = new WebSocket(getMarketWebSocketUrl(marketId));
    socketRef.current = socket;

    socket.onopen = () => {
      // Keepalive heartbeat: send ping periodically and update lastPongAt on pong.
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
        // Keep handler in ref to avoid frequent socket recreation from effect deps.
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
        // Report SOCKET_CLOSED only for unexpected closes and let machine decide reconnect.
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
