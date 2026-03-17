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

// ---------------------------------------------------------------------
// 这个文件是“实时链路中枢”：
// 1) 先通过 snapshot 建立本地基线
// 2) 再消费 WS 增量消息（trade/book_delta）
// 3) 用 requestAnimationFrame 批量提交到 Zustand
// 4) 用 xstate 控制连接、重连、gap 恢复
// ---------------------------------------------------------------------

// 创建空帧，用于缓存一个动画帧周期内收到的增量消息。
function createEmptyFrame(lastSeq = 0): BufferedFrame {
  return {
    deltas: [],
    trades: [],
    lastSeq
  };
}

// WebSocket 文本消息解析保护，避免异常中断消息循环。
function parseMessage(raw: string): MarketMessage | null {
  return safeJsonParse<MarketMessage>(raw);
}

// 下列类型守卫用于“运行时兜底”：
// 后端消息即使类型声明正确，运行时仍可能脏数据，必须防御。
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

// 将状态机值映射为 UI 可消费的连接状态枚举。
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
  // -------------------- store 写入动作（只写，不在这里做派生计算） --------------------
  const resetMarket = useMarketStore((state) => state.resetMarket);
  const hydrateSnapshot = useMarketStore((state) => state.hydrateSnapshot);
  const applyFrame = useMarketStore((state) => state.applyFrame);
  const clearGap = useMarketStore((state) => state.clearGap);
  const markGap = useMarketStore((state) => state.markGap);
  const markPong = useMarketStore((state) => state.markPong);
  const setMessageRates = useMarketStore((state) => state.setMessageRates);
  const setConnectionState = useMarketStore((state) => state.setConnectionState);

  const [machineState, send] = useMachine(websocketMachine);

  // -------------------- 高频状态使用 ref，避免每条消息触发 React 渲染 --------------------
  // socketRef: 当前 WebSocket 连接句柄
  // rafRef: 当前是否已排队一个 RAF flush
  // pingIntervalRef/rateIntervalRef: 定时器句柄，便于统一清理
  // intentionalCloseRef: 区分“主动关闭”和“异常关闭”
  // seqRef: 本地已接收的最新 seq（用于 gap 检测）
  // frameRef: 当前动画帧缓存（trade + book delta）
  // appliedSnapshotRef: 避免重复应用同一份 snapshot
  // bookRateRef/tradeRateRef: 每秒消息计数器
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

  // market 切换时，SWR key 变化，自动触发新 snapshot 拉取。
  const snapshotKey = useMemo(() => `snapshot:${marketId}`, [marketId]);
  const { data: snapshot, error: snapshotError, mutate } = useSWR(snapshotKey, () =>
    fetchSnapshot(marketId)
  );

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

  // 每帧提交一次，降低高频消息导致的 React 渲染压力。
  function flushFrame(): void {
    rafRef.current = null;
    flushTimeoutRef.current = null;

    const frame = frameRef.current;

    // 没有增量则不触发 store 更新。
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
      // 已经排队过 flush，不重复排队。
      return;
    }

    // hidden tab 下 requestAnimationFrame 会被暂停或极度降频，
    // 这里改用短定时器兜底，避免 frame 缓冲无限堆积吃掉内存。
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

  const closeSocket = useCallback((reason = "cleanup"): void => {
    cancelFrame();

    if (pingIntervalRef.current !== null) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    const socket = socketRef.current;

    if (socket) {
      // 标记“主动关闭”，避免 onclose 被误判为异常并触发重连状态转换。
      intentionalCloseRef.current = true;

      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, reason);
      }

      socketRef.current = null;
    }
  }, [cancelFrame]);

  messageHandlerRef.current = (rawMessage) => {
    // 统一入口：任何消息都先过结构校验。
    if (!isObject(rawMessage) || typeof rawMessage.type !== "string") {
      return;
    }

    if (isHelloMessage(rawMessage)) {
      // hello 主要用于握手确认；这里只做市场过滤，不写入 store。
      if (rawMessage.marketId !== marketId) {
        return;
      }

      return;
    }

    if (isPongMessage(rawMessage)) {
      // 心跳回包只更新最近 pong 时间，供健康状态展示。
      markPong(rawMessage.ts);
      return;
    }

    if (isResetMessage(rawMessage)) {
      // 服务端要求 reset 后重新拉取快照并重建本地状态。
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
      // 不立即 setState，先进入 frame 缓冲，等待 RAF 批量提交。
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
      // 快照无 seq 时，用首条 delta 建立基线，避免误判 gap。
      hasSeqBaselineRef.current = true;
      seqRef.current = rawMessage.seq;
      frameRef.current.lastSeq = rawMessage.seq;
      frameRef.current.deltas.push(rawMessage);
      scheduleFlush();
      return;
    }

    // 关键一致性规则：book_delta seq 必须严格连续递增。
    const expectedSeq = seqRef.current + 1;

    if (rawMessage.seq <= seqRef.current) {
      // 旧消息或重复消息，直接丢弃。
      return;
    }

    if (rawMessage.seq !== expectedSeq) {
      const gap: GapState = {
        expectedSeq,
        receivedSeq: rawMessage.seq
      };

      // 发生 gap 后，当前 frame 作废，避免“错误增量”污染本地 book。
      frameRef.current = createEmptyFrame(seqRef.current);
      markGap(gap);
      closeSocket("gap-detected");
      send({
        type: "GAP_DETECTED",
        expectedSeq: gap.expectedSeq,
        receivedSeq: gap.receivedSeq
      });
      // 触发 snapshot 重拉，恢复一致性基线。
      void mutate();
      return;
    }

    seqRef.current = rawMessage.seq;
    frameRef.current.lastSeq = rawMessage.seq;
    frameRef.current.deltas.push(rawMessage);
    scheduleFlush();
  };

  useEffect(() => {
    // market 切换（或首次挂载）时，先清空本地状态，等待新 snapshot。
    resetMarket(marketId);
    appliedSnapshotRef.current = null;
    frameRef.current = createEmptyFrame();
    seqRef.current = 0;
    hasSeqBaselineRef.current = false;
    bookRateRef.current = 0;
    tradeRateRef.current = 0;

    return () => {
      // Provider 卸载时主动断开，避免遗留连接和定时器。
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
      // 同一份 snapshot 避免重复灌入 store。
      return;
    }

    appliedSnapshotRef.current = snapshot.fetchedAt;
    hydrateSnapshot(snapshot);
    clearGap();
    // snapshot 不一定有 seq；缺失时由首条 delta 建立 seq 基线。
    if (typeof snapshot.seq === "number") {
      seqRef.current = snapshot.seq;
      hasSeqBaselineRef.current = true;
    } else {
      seqRef.current = 0;
      hasSeqBaselineRef.current = false;
    }
    frameRef.current = createEmptyFrame(seqRef.current);

    if (machineState.matches("idle")) {
      // 初次拿到 snapshot 后，开始连接 WS。
      send({
        type: "CONNECT"
      });
      return;
    }

    if (machineState.matches("gapDetected")) {
      // gap 场景：snapshot 已同步，通知状态机进入重新连接流程。
      send({
        type: "SNAPSHOT_SYNCED"
      });
    }
  }, [clearGap, hydrateSnapshot, machineState, send, snapshot]);

  const machineValue = String(machineState.value);
  const machineAttempt = machineState.context.attempt;
  const machineReason = machineState.context.reason;

  useEffect(() => {
    // 将状态机状态“投影”到 UI store（用于指标面板展示）。
    const connectionState = deriveConnectionState(machineValue);
    const message = snapshotError instanceof Error ? snapshotError.message : machineReason;

    setConnectionState(connectionState, machineAttempt, message);
  }, [machineAttempt, machineReason, machineValue, setConnectionState, snapshotError]);

  useEffect(() => {
    // 每秒汇总一次消息吞吐率，避免 UI 上实时频闪。
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
    // 不在连接态时，确保 socket 被关闭。
    if (!shouldMaintainSocket) {
      closeSocket("state-transition");
      return;
    }

    if (socketRef.current) {
      // 已有连接则不重复创建。
      return;
    }

    intentionalCloseRef.current = false;

    const socket = new WebSocket(getMarketWebSocketUrl(marketId));
    socketRef.current = socket;

    socket.onopen = () => {
      // 心跳保活：定时发送 ping，pong 到达时更新 lastPongAt。
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
        // 使用 ref 保存处理函数，避免 effect 因 handler 依赖而频繁重建 socket。
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
        // 只有非主动关闭才上报 SOCKET_CLOSED，交给状态机决定重连。
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
