import { assign, setup } from "xstate";

import type { GapState } from "@/lib/types";

// ---------------------------------------------------------------------
// WebSocket 连接状态机（只管“连接控制面”）：
// - 不处理订单簿/成交数据本身
// - 只负责：何时连接、何时重连、何时等待快照修复 gap
//
// 设计目标：
// 1) 连接行为可预测（所有迁移都显式）
// 2) 出错可恢复（重连 + gap 修复）
// 3) 与数据处理解耦（provider 只发事件给状态机）
// ---------------------------------------------------------------------

// 连接状态机上下文：
// - attempt: 当前重连次数（用于指数退避）
// - reason: 最近一次错误/断开原因
// - gap: 序列缺口信息
interface WebSocketMachineContext {
  attempt: number;
  reason: string | null;
  gap: GapState | null;
}

// 状态机输入事件（来自 websocket-provider）：
// - CONNECT: 允许开始建立连接
// - SOCKET_OPEN: 底层 ws onopen
// - SOCKET_ERROR/SOCKET_CLOSED: 异常路径，进入重连
// - GAP_DETECTED: book seq 不连续，进入“等待快照修复”状态
// - SNAPSHOT_SYNCED: gap 修复完成，可以重新连接
// - DISCONNECT: 主动断开（卸载/切市场），回到 idle
type WebSocketMachineEvent =
  | { type: "CONNECT" }
  | { type: "SOCKET_OPEN" }
  | { type: "SOCKET_ERROR"; reason?: string }
  | { type: "SOCKET_CLOSED"; reason?: string }
  | { type: "GAP_DETECTED"; expectedSeq: number; receivedSeq: number }
  | { type: "SNAPSHOT_SYNCED" }
  | { type: "DISCONNECT"; reason?: string };

// 状态机负责连接生命周期，不直接处理行情数据内容。
export const websocketMachine = setup({
  types: {
    context: {} as WebSocketMachineContext,
    events: {} as WebSocketMachineEvent
  },
  delays: {
    // 1s, 2s, 4s... 最多 15s
    retryDelay: ({ context }) =>
      Math.min(1_000 * 2 ** Math.max(context.attempt - 1, 0), 15_000)
  },
  actions: {
    // 每次连接失败（error/close）都累加重连次数。
    bumpAttempt: assign({
      attempt: ({ context }) => context.attempt + 1
    }),
    // 连接成功后清零重连次数。
    resetAttempt: assign({
      attempt: 0
    }),
    // 记录 gap 信息，方便 UI 展示 expected/received seq。
    rememberGap: assign({
      gap: ({ event }) =>
        event.type === "GAP_DETECTED"
          ? {
              expectedSeq: event.expectedSeq,
              receivedSeq: event.receivedSeq
            }
          : null,
      reason: () => "Sequence gap detected"
    }),
    // gap 修复成功后清空 gap 和错误原因。
    clearGap: assign({
      gap: null,
      reason: null
    }),
    // 记录连接中断原因，便于连接指示器展示。
    rememberCloseReason: assign({
      reason: ({ event }) =>
        event.type === "SOCKET_CLOSED" || event.type === "SOCKET_ERROR"
          ? event.reason ?? "Connection interrupted"
          : null
    }),
    // 主动断开时保留原因（比如 Provider unmounted）。
    rememberDisconnect: assign({
      reason: ({ event }) =>
        event.type === "DISCONNECT" ? event.reason ?? "Disconnected" : null
    })
  }
}).createMachine({
  id: "market-websocket",
  initial: "idle",
  context: () => ({
    attempt: 0,
    reason: null,
    gap: null
  }),
  states: {
    // 初始静止态：不连接、不重连，等待外部发 CONNECT。
    idle: {
      on: {
        CONNECT: {
          target: "connecting"
        }
      }
    },
    // 连接进行中：等待 SOCKET_OPEN 或失败事件。
    connecting: {
      on: {
        SOCKET_OPEN: {
          // 连上后进入 open，并清理失败痕迹。
          target: "open",
          actions: ["resetAttempt", "clearGap"]
        },
        SOCKET_ERROR: {
          // 连接阶段出错，进入自动重连。
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        SOCKET_CLOSED: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        GAP_DETECTED: {
          // 理论上连接阶段也可能收到错序事件，统一进入 gap 修复流程。
          target: "gapDetected",
          actions: "rememberGap"
        },
        DISCONNECT: {
          // 主动断开优先级最高，直接回 idle。
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    },
    // 已连接态：正常收消息，监听异常和 gap。
    open: {
      on: {
        GAP_DETECTED: {
          // 数据一致性优先：发现 gap 立刻暂停连接流程，先修复快照。
          target: "gapDetected",
          actions: "rememberGap"
        },
        SOCKET_ERROR: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        SOCKET_CLOSED: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    },
    // gap 修复态：
    // 该状态不会自动重连，必须等外部在 snapshot 同步后发送 SNAPSHOT_SYNCED。
    gapDetected: {
      on: {
        SNAPSHOT_SYNCED: {
          // 快照已修复，回到 connecting 重新建链路。
          target: "connecting",
          actions: "clearGap"
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    },
    // 失败重连态：
    // 自动等待退避时间后回 connecting；也可以被 DISCONNECT 中断。
    reconnecting: {
      // 进入该状态后自动等待 retryDelay，再次尝试连接。
      after: {
        retryDelay: {
          target: "connecting"
        }
      },
      on: {
        DISCONNECT: {
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    }
  }
});
