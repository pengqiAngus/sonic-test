import { assign, setup } from "xstate";

const MAX_RECONNECT_ATTEMPTS = 5;

interface SolanaStreamMachineContext {
  attempt: number;
  reason: string | null;
}

type SolanaStreamMachineEvent =
  | { type: "CONNECT" }
  | { type: "SOCKET_OPEN" }
  | { type: "SOCKET_ERROR"; reason?: string }
  | { type: "SOCKET_CLOSED"; reason?: string }
  | { type: "DISCONNECT"; reason?: string };

export const solanaStreamMachine = setup({
  types: {
    context: {} as SolanaStreamMachineContext,
    events: {} as SolanaStreamMachineEvent
  },
  delays: {
    retryDelay: ({ context }) => Math.min(1_000 * 2 ** Math.max(context.attempt - 1, 0), 10_000)
  },
  guards: {
    canRetry: ({ context }) => context.attempt < MAX_RECONNECT_ATTEMPTS
  },
  actions: {
    bumpAttempt: assign({
      attempt: ({ context }) => context.attempt + 1
    }),
    resetAttempt: assign({
      attempt: 0
    }),
    rememberReason: assign({
      reason: ({ event }) => {
        if (event.type === "SOCKET_ERROR" || event.type === "SOCKET_CLOSED") {
          return event.reason ?? "Solana stream interrupted";
        }
        if (event.type === "DISCONNECT") {
          return event.reason ?? "Disconnected";
        }
        return null;
      }
    }),
    clearReason: assign({
      reason: null
    })
  }
}).createMachine({
  id: "solana-stream-websocket",
  initial: "idle",
  context: () => ({
    attempt: 0,
    reason: null
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
          actions: ["resetAttempt", "clearReason"]
        },
        SOCKET_ERROR: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberReason"]
        },
        SOCKET_CLOSED: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberReason"]
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberReason"
        }
      }
    },
    open: {
      on: {
        SOCKET_ERROR: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberReason"]
        },
        SOCKET_CLOSED: {
          target: "reconnecting",
          actions: ["bumpAttempt", "rememberReason"]
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberReason"
        }
      }
    },
    reconnecting: {
      after: {
        retryDelay: [
          {
            guard: "canRetry",
            target: "connecting"
          },
          {
            target: "closedConnection"
          }
        ]
      },
      on: {
        DISCONNECT: {
          target: "idle",
          actions: "rememberReason"
        }
      }
    },
    closedConnection: {
      on: {
        CONNECT: {
          target: "connecting",
          actions: ["resetAttempt", "clearReason"]
        },
        DISCONNECT: {
          target: "idle",
          actions: "rememberReason"
        }
      }
    }
  }
});
