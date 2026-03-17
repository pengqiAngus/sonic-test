# Role: Senior Web3 Frontend Architect (Specializing in CEX/DEX UI)

# Context & Goal
请根据 `overview.zh-CN.md` 文档，使用 Next.js 构建高性能的 **Sonic 永续交易 UI**。系统核心挑战是处理高频数据流（订单簿 20-50 次/秒，成交 5-20 次/秒），必须在保持 60fps 渲染性能的同时，确保前端数据状态与后端严格一致。

# Simplified High-Performance Tech Stack
- **Framework**: Next.js 14+ (App Router), Tailwind CSS, shadcn/ui.
- **Charts**: **TradingView Lightweight Charts** (用于 K 线和实时价格).
- **State Management**:
    - **XState**: 专门负责 **WebSocket 生命周期管理**（IDLE, CONNECTING, OPEN, GAP_DETECTED, RECONNECTING）.
    - **Zustand**: 唯一的**全局数据与 UI 仓储**。负责存储 Orderbook (Map 结构)、Trade History 及全局 UI 变量.
- **Data Fetching**: **SWR**。用于 REST API 的初始化（/snapshot, /candles）和纠错机制.
- **Virtualization**: **@tanstack/react-virtual**。必须用于 Orderbook 和 Trade Tape 列表.
- **Math & Utils**: **bignumber.js** (精度计算), **date-fns**.

# Technical Implementation Requirements

## 1. 严格的数据对齐逻辑 (Sequence Alignment)
为了防止 WebSocket 增量更新与 REST 快照冲突：
- **Snapshot First**: 必须先通过 SWR 获取 `/snapshot`，将其 `seq` 作为 Zustand 中的 `lastSeq`.
- **Sequential Filtering**: 处理 WS 的 `book_delta` 时：
    - `msg.seq <= lastSeq`: 过期消息，直接丢弃.
    - `msg.seq === lastSeq + 1`: 正常合并更新，并 `lastSeq++`.
    - `msg.seq > lastSeq + 1`: **检测到序列缺口 (Data Gap)**，立即通过 XState 切换到 `GAP_DETECTED` 状态，触发 SWR `mutate` 重新拉取快照并重置状态.

## 2. 极致性能优化 (60fps Strategy)
- **Zustand 存储优化**: Orderbook 档位必须使用 `Map<number, number>` 存储，确保 $O(1)$ 的增删改查。`size: 0` 时执行 `delete` 操作.
- **渲染节流 (RAF)**: 严禁在每次 WS 消息到达时触发 React 重渲染。必须实现一个基于 `requestAnimationFrame` 的缓冲机制，将 UI 更新频率限制在 60fps 以内.
- **Chart Sync**: 收到 WS `trade` 后，实时计算当前 OHLC 柱状图的变动并调用 `series.update()`，确保 K 线与成交流无缝同步.

## 3. UI 核心功能
- **Market Selector**: 切换市场需触发 XState 重启 WS 并清空 Zustand 旧数据.
- **Order Panel**: 实现模拟下单 (POST /orders)，包含 `zod` 表单校验、精度处理及 `sonner` 状态反馈.
- **Connection Indicator**: 展示实时连接状态及消息速率 (Messages Per Second).

# Workflow
1. **Phase 1**: 设计 XState 状态机逻辑（含指数退避重连）与 Zustand Store 结构。
2. **Phase 2**: 实现 `WebSocketProvider`，集成 `seq` 校验与 SWR 快照纠错逻辑。
3. **Phase 3**: 封装 `TVChart` 组件与高性能虚拟化 Orderbook 组件。
4. **Phase 4**: 整体 UI 组装与性能审计（内存泄漏、重渲染检查）。

# Output Requirement
请先给出 **Phase 1 & Phase 2** 的核心代码实现，并详细说明你如何保证在高频更新下不出现 UI 阻塞。