# Sonic Perps UI

一个基于 Next.js 14、SWR、XState、Zustand 与 Lightweight Charts 的 Sonic 永续交易前端实现，覆盖题面要求的 Phase 1 到 Phase 4。

## 架构说明

- `app/page.tsx` 只负责挂载应用壳层。
- `components/websocket-provider.tsx` 实现快照优先、WebSocket 生命周期、seq gap 检测、SWR 快照纠错与 RAF 批处理。
- `store/market-store.ts` 是唯一的全局状态中心，使用 `Map<number, number>` 保存订单簿，`trades` 保存最近成交，并暴露细粒度 selector。
- `components/tv-chart.tsx` 使用 Lightweight Charts 拉取历史 candles，并用实时 trade 更新当前 candle。
- `components/orderbook-panel.tsx` 和 `components/trade-tape.tsx` 使用 `@tanstack/react-virtual` 渲染长列表。
- `components/order-panel.tsx` 使用 `react-hook-form` + `zod` 校验订单参数，并通过 `sonner` 显示提交流程。

## 性能决策

- Snapshot-first：只有在 `/markets/:marketId/snapshot` 成功后才启动 WebSocket，保证 `lastSeq` 初值可信。
- RAF batching：WS 消息先写入 `useRef` 缓冲，不在每条消息上触发 React 渲染；统一在 `requestAnimationFrame` 中提交到 Zustand。
- `Map` 存储订单簿：增删改查为 O(1)，`size === 0` 时直接 `delete`。
- 细粒度订阅：组件通过 `useBookLevels` / `useRecentTrades` 只读取自己关心的数据。
- UI defer：列表消费端使用 `useDeferredValue`，降低高频排序对输入与按钮交互的影响。
- 虚拟化：订单簿和成交明细都使用 `react-virtual`，避免全量 DOM。

## 已识别瓶颈

- `useBookLevels` 当前仍会在每次 bookVersion 变化后对整侧数据排序，若档位显著增加，需进一步改成增量有序结构。
- `lightweight-charts` 目前在客户端动态导入，首屏首次打开图表仍存在一次性初始化成本。
- 订单接口 schema 无法通过 `/openapi.json` 二次确认，因为该端点返回了 `503 Service Temporarily Unavailable`，当前按题面字段实现。

## 10 倍负载扩展策略

- 将 orderbook 排序从每帧全量排序升级为 price bucket + binary insertion 或跳表。
- 在 provider 中按市场拆分 actor，把交易、订单簿与统计面板拆成独立消息通道。
- 把 trade tape 与 orderbook 派生数据迁移到 Web Worker，主线程只接收可渲染快照。
- 为 snapshot/candles 增加边缘缓存和 gzip/brotli，以减少冷启动流量。
- 对图表与列表引入“视图层采样”，例如在超高频场景下降低非关键面板刷新率到 30fps。

## 取舍说明

- 优先把题面里的正确性约束写成可运行代码，而不是一次性堆满所有业务细节。
- 下单流目前仅实现 limit mock order；高级订单类型可以在现有 schema 上继续扩展。
- 当前已提供 GitHub Actions 质量门禁（`lint + typecheck + build`）；后续可补充自动化测试并将 `test` 纳入 CI。

## 本地运行

```bash
npm install
npm run typecheck
npm run build
npm run dev
```
