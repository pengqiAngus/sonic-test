import { assign, setup } from "xstate";

import type { GapState } from "@/lib/types";

// ---------------------------------------------------------------------
// WebSocket connection state machine (control plane only):
// - does not process orderbook/trade data itself
// - only decides: when to connect, reconnect, and wait for snapshot gap recovery
//
// Design goals:
// 1) predictable connection behavior (all transitions explicit)
// 2) recoverable failures (reconnect + gap repair)
// 3) decoupled from data processing (provider sends events only)
// ---------------------------------------------------------------------

// Connection machine context:
// - attempt: current reconnect attempt (for exponential backoff)
// - reason: latest error/close reason
// - gap: sequence gap metadata
interface WebSocketMachineContext {
  attempt: number;
  reason: string | null;
  gap: GapState | null;
}

// Machine input events (from websocket-provider):
// - CONNECT: allow connection start
// - SOCKET_OPEN: low-level ws onopen
// - SOCKET_ERROR/SOCKET_CLOSED: failure path, enter reconnecting
// - GAP_DETECTED: non-continuous book seq, enter wait-for-snapshot-repair
// - SNAPSHOT_SYNCED: gap repair done, can reconnect
// - DISCONNECT: intentional disconnect (unmount/switch market), go back to idle
type WebSocketMachineEvent =
  | { type: "CONNECT" }
  | { type: "SOCKET_OPEN" }
  | { type: "SOCKET_ERROR"; reason?: string }
  | { type: "SOCKET_CLOSED"; reason?: string }
  | { type: "GAP_DETECTED"; expectedSeq: number; receivedSeq: number }
  | { type: "SNAPSHOT_SYNCED" }
  | { type: "DISCONNECT"; reason?: string };

// Machine controls connection lifecycle and does not process market payload data directly.
export const websocketMachine = setup({
  types: {
    context: {} as WebSocketMachineContext,
    events: {} as WebSocketMachineEvent
  },
  delays: {
    // 1s, 2s, 4s... capped at 15s
    retryDelay: ({ context }) => Math.min(1_000 * 2 ** Math.max(context.attempt - 1, 0), 15_000)
  },
  actions: {
    // Increment reconnect attempt after each connection failure (error/close).
    bumpAttempt: assign({
      attempt: ({ context }) => context.attempt + 1
    }),
    // Reset reconnect attempt after successful open.
    resetAttempt: assign({
      attempt: 0
    }),
    // Store gap data so UI can display expected/received seq.
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
    // Clear gap and error reason after successful gap repair.
    clearGap: assign({
      gap: null,
      reason: null
    }),
    // Record interruption reason for connection indicator display.
    rememberCloseReason: assign({
      reason: ({ event }) =>
        event.type === "SOCKET_CLOSED" || event.type === "SOCKET_ERROR"
          ? (event.reason ?? "Connection interrupted")
          : null
    }),
    // Keep disconnect reason for intentional closes (e.g. provider unmounted).
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
    // Initial idle state: no connect/reconnect, wait for external CONNECT.
    idle: {
      on: {
        CONNECT: {
          target: "connecting"
        }
      }
    },
    // Connecting state: wait for SOCKET_OPEN or failure events.
    connecting: {
      on: {
        SOCKET_OPEN: {
          // Enter open on success and clear previous failure traces.
          target: "open",
          actions: ["resetAttempt", "clearGap"]
        },
        SOCKET_ERROR: {
          // Connection-stage failure enters automatic reconnect flow.
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        SOCKET_CLOSED: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberCloseReason"]
        },
        GAP_DETECTED: {
          // Out-of-order events can still happen here; use unified gap-repair flow.
          target: "gapDetected",
          actions: "rememberGap"
        },
        DISCONNECT: {
          // Intentional disconnect has highest priority, return to idle immediately.
          target: "idle",
          actions: "rememberDisconnect"
        }
      }
    },
    // Open state: receive messages and watch for failures/gaps.
    open: {
      on: {
        GAP_DETECTED: {
          // Data consistency first: on gap, pause flow and repair snapshot immediately.
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
    // No auto-reconnect here; wait for external SNAPSHOT_SYNCED after snapshot sync.
    gapDetected: {
      on: {
        SNAPSHOT_SYNCED: {
          // Snapshot repaired, return to connecting and rebuild the link.
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
    // Wait backoff then return to connecting; can also be interrupted by DISCONNECT.
    reconnecting: {
      // On enter, wait retryDelay then attempt to connect again.
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
