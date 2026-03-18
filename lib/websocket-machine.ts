import { assign, setup } from "xstate";

import type { GapState } from "@/lib/types";

interface WebSocketMachineContext {
  attempt: number;
  reason: string | null;
  gap: GapState | null;
}

type WebSocketMachineEvent =
  | { type: "CONNECT" }
  | { type: "SOCKET_OPEN" }
  | { type: "SOCKET_ERROR"; reason?: string }
  | { type: "SOCKET_CLOSED"; reason?: string }
  | { type: "GAP_DETECTED"; expectedSeq: number; receivedSeq: number }
  | { type: "SNAPSHOT_SYNCED" }
  | { type: "DISCONNECT"; reason?: string };

export const websocketMachine = setup({
  types: {
    context: {} as WebSocketMachineContext,
    events: {} as WebSocketMachineEvent
  },
  delays: {
    retryDelay: ({ context }) => Math.min(1_000 * 2 ** Math.max(context.attempt - 1, 0), 15_000)
  },
  actions: {
    bumpAttempt: assign({
      attempt: ({ context }) => context.attempt + 1
    }),
    resetAttempt: assign({
      attempt: 0
    }),
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
    clearGap: assign({
      gap: null,
      reason: null
    }),
    rememberCloseReason: assign({
      reason: ({ event }) =>
        event.type === "SOCKET_CLOSED" || event.type === "SOCKET_ERROR"
          ? (event.reason ?? "Connection interrupted")
          : null
    }),
    rememberDisconnect: assign({
      reason: ({ event }) => (event.type === "DISCONNECT" ? (event.reason ?? "Disconnected") : null)
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
    idle: {
      on: {
        CONNECT: {
          target: "connecting"
        }
      }
    },
    connecting: {
      on: {
        SOCKET_OPEN: {
          target: "open",
          actions: ["resetAttempt", "clearGap"]
        },
        SOCKET_ERROR: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        SOCKET_CLOSED: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        GAP_DETECTED: {
          target: "gapDetected",
          actions: "rememberGap"
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    },
    open: {
      on: {
        GAP_DETECTED: {
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
    // Gap repair state:
    gapDetected: {
      on: {
        SNAPSHOT_SYNCED: {
          target: "connecting",
          actions: "clearGap"
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    },
    // Reconnecting state after failure:
    reconnecting: {
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
