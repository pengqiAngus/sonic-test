# Sonic Perps UI

一个基于 Next.js、SWR、XState、Zustand、Lightweight Charts 的 Sonic 永续行情前端页面。

## 架构说明

- 页面壳层：`app/page.tsx` 仅挂载 `AppShell`，由 `components/app-shell.tsx` 编排图表、订单簿、成交流、下单面板与性能说明区。
- 行情链路（核心）：`context/websocket-provider.tsx` 负责 snapshot-first、WS 生命周期、seq 连续性校验、gap 检测、reset 恢复、消息速率统计。
- 连接控制面：`lib/websocket-machine.ts` 用 XState 管理 `idle -> connecting -> open -> reconnecting -> gapDetected`，将重连退避和 gap 修复流程显式化。
- 数据落地层：`store/market-store.ts` 使用 `Map<number, number>` 保存 bids/asks，`trades` 保存最近成交；通过 `bookVersion/tradeVersion` 驱动精准重算。
- 读取层：`lib/hooks.ts` 统一对外暴露 `useBookLevels/useRecentTrades/useMidPrice`，隔离 UI 与 store 写入逻辑。
- 图表与交易：`components/tv-chart.tsx` 先拉历史 candles，再把最新 trade 聚合进当前 K 线；`components/order-panel.tsx` 通过 `zod + react-hook-form + SWR mutation` 完成下单表单。
- Solana Stream：`context/solana-stream-provider.tsx` + `store/solana-stream-store.ts` 独立维护 `/ws/stream` 状态，展示 transactions，并在 `reorg` 时按 `rollbackSlot` 回滚本地列表。

## 性能决策（优化与原因）

- Snapshot-first 再建 WS：先建立一致性基线，再消费增量，避免冷启动时错序导致本地账本污染。
- RAF 批处理 + hidden tab 兜底：高频消息先缓冲到 frame，再每帧提交一次；标签页隐藏时改为短定时器 flush，防止缓冲无限堆积。
- `Map` 存储订单簿：增量更新/删除是 O(1)，适合高频档位变更；并限制单侧最大档位，防止内存和滚动高度失控。
- 细粒度订阅 + `useDeferredValue`：UI 只订阅需要字段，并延后高频列表消费，减轻主线程阻塞。
- 列表虚拟化：orderbook / trade tape / solana transactions 全部接入 `@tanstack/react-virtual`，控制 DOM 数量。
- 图表增量更新：历史数据一次 `setData`，实时仅 `series.update` 当前柱，避免整图重绘。

## 已识别瓶颈

- `useBookLevels` 仍是“版本变更后整侧排序”，在极深盘口下 CPU 压力会上升。
- `tradeVersion` 高频变化会带动图表与交易列表频繁更新；在更高吞吐下需进一步做分层采样或 worker 化。
- Solana 交易面板当前 `pushTransaction` 采用数组 `some` 去重，数据量扩大后会退化为 O(n) 检查。
- `lightweight-charts` 首次动态导入仍有初始化成本，弱网下首开图表会有感知延迟。
- 当前测试以组件渲染和关键流程断言为主，尚缺真实 WS 高压场景下的端到端性能回归。

## 扩展策略（10 倍负载场景）

- 将盘口结构升级为“有序索引 + 增量插入”（如 price bucket + binary insertion / 跳表），避免每次全量排序。
- 将派生计算下沉至 Web Worker（book levels、running total、trade 聚合），主线程只做视图渲染。
- 对非关键面板实施自适应采样（30fps/15fps），关键路径（连接状态、最佳买卖价）保持实时。
- Solana 去重改为 `Set/Map` 索引（signature -> index），将重复检测从 O(n) 降到接近 O(1)。
- 按市场拆分 provider/store 或 actor，减少单仓库写放大与跨面板联动。
- 在 API 边缘层为 snapshot/candles 做缓存压缩与预热，降低冷启动和重连恢复时延。

## 取舍说明

- 双 Provider（市场 WS 与 Solana WS）而非单总线：可读性和故障隔离更好，但增加了连接管理与状态同步复杂度。
- 使用可变 `Map` + `version` 计数，而非纯不可变结构：换来高频写入性能，但调试时需依赖版本号理解重算时机。
- API 层做防御式归一化（缺字段补默认值、数值标准化）：提升前端稳健性，但可能掩盖后端契约漂移，需要结合日志监控。
- 当前优先保证“序列一致性 + 重连恢复 + UI 可响应”，对极端负载下的最优排序算法与 worker 化暂未一次性引入，以控制实现复杂度。
- 测试策略先覆盖核心组件与 Provider 行为，CI 采用 `lint + typecheck + test + build`，取舍了更重的 e2e 成本以保持开发迭代速度。

## 本地运行

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run dev
```
