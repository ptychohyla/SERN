# SERN 股票搜索设计文档

日期：2026-10-05
状态：已确认（范围=任意股票、入口=markets 页独立醒目位置、方案=本地优先 + Worker 联想）

## 背景与目标

markets 页当前只能浏览约 136 只股票池。用户希望"提供搜索工具，搜索某个股票的内容"——输入代码或名称（含中文名）找到**任意**股票，并查看其行情内容（价格、涨跌、关键指标、3 个月走势）。

关键既有事实（已核实）：

- **Yahoo 风格符号 = SERN 内部符号**：`AAPL`、`600519.SS`、`0700.HK`、`7203.T`，搜索结果零转换即可进入现有行情链。
- **行情链符号无关**：`txCode`/`emSecid` 均为规则映射（`us`+代码、`1.`/`0.`/`116.`/`176.`/`177.`/`178.`/`185.`/`186.` 前缀），任意符号可走完整 `stockapi → tencent → eastmoney → tradingview → ths → yahoo` 链。
- **抽屉评分区有空值守卫**：`openDrawer` 中 `if (entry.scores)` 已存在，`scores=null` 的 entry 天然渲染为"精简抽屉"。
- **Worker 的 `normalizeSymbol` 仅支持 SH/SZ/BJ/HK/US**：搜索端点不得经过它，作为独立路由代理全球符号。

## 一、Worker 端点（/Users/hins/Project/stockapi 仓库）

### `GET /v1/search?q=`

独立路由，不进 `MarketDataProvider` 接口。新增 `src/lib/search.ts`（上游客户端 + 归一化 + 合并），`src/index.ts` 挂载路由并更新使用手册页。

**参数**：`q` 必填，trim 后为空或长度 > 32 → `400 INVALID_PARAMETER`。

**上游（并行，各 3 秒 AbortController）**：

| 上游 | URL | 启用条件 | 解析 |
|---|---|---|---|
| Yahoo Search | `https://query2.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=10&newsCount=0&listsCount=0` | 总是 | `quotes[]` 中 `quoteType === "EQUITY"` 项，取 `symbol`、`shortname \|\| longname`、`exchange` |
| 东方财富联想 | `https://searchapi.eastmoney.com/api/suggest/get?input={q}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8` | q 含 CJK 字符或为纯数字 | `QuotationCodeTable.Data[]` 的 `Code`/`Name`/`MktNum` |

（token 为东方财富 web 端公开硬编码值，与 akshare 等公开实现一致。）

**归一化为 Yahoo 风格符号**：

- Yahoo 结果：原样使用（`AAPL`、`600519.SS`、`0700.HK`、`7203.T`、`005930.KS`、`MC.PA`…）。
- 东财结果按 `MktNum` 映射（与 SERN 端 `emSecid` 实测映射一致）：`1`→`.SS`、`0`→`.SZ`、`116`→`.HK`（去前导零保留 ≥4 位）、`176`→`.T`、`177`→`.KS`、`178`→`.TW`、`185`→`.DE`、`186`→`.PA`；其余市场号丢弃。

**合并**：按 symbol 去重（Yahoo 优先），总量截断至 10 条。

**响应**：

```json
{ "data": [ { "symbol": "600519.SS", "name": "贵州茅台", "market": "CN" } ] }
```

`market` 取值 `US/CN/HK/JP/KR/TW/EU`（由 Yahoo `exchange` 字段或东财 `MktNum` 映射；无法确定时为 `null`，前端不显示市场标签）。

**错误**：两路全失败 → `502 ALL_PROVIDERS_FAILED`（复用现有错误格式）；单路失败用另一路结果。CORS 由现有 `app.use("*", cors())` 覆盖。

**测试**（`test/search.test.ts`，vitest，mock 双上游）：归一化映射、去重优先级、CJK 触发东财、单路失败降级、双失败 502、空 q 400、CJK 中文名端到端 shape。

## 二、前端搜索组件（SERN 仓库）

### 位置与结构

`markets.html`：`.markets-header` 与 `.ticker-strip` 之间插入独立一行 `.search-section`——居中搜索框（放大镜 SVG + `<input>` + 清除按钮）+ 建议面板（绝对定位下拉卡片，复用汉堡菜单的毛玻璃卡片语言）。`index.html` 不动（仅递增 `?v=`）。

### `js/search.js`（新 IIFE，`'use strict'`，2 空格缩进，短横线类名）

**纯函数（可离线断言）**：

- `localMatches(query, universe)`：对 `symbol`/`name.en`/`name.zh` 做大小写不敏感匹配；排序 = 代码前缀 > 名称前缀 > 子串，各组内保持 universe 原序；上限 5 条。
- `mergeSuggestions(local, remote)`：本地在前（分组"股票池"）；远程项去重后，**命中股票池但本地未命中的（如 5 位写法 `00700` 对应池内 `0700.HK`）并入"股票池"组**（保证仍打开评分抽屉），其余池外项追加到"更多结果"组（标记 external），总量 ≤ 10。

**交互流程**：

1. 输入 ≥1 字符：立即渲染本地结果。
2. 输入 ≥2 字符：防抖 300ms 后请求 `${STOCKAPI_ORIGIN}/v1/search?q=`（8s AbortController，与 market-data.js 同模式；**每次新请求 abort 上一个未完成的搜索请求**）。`stockapiState === 'down'`（被墙）时跳过远程请求，静默只用本地结果。
3. 面板交互：↓/↑ 移动高亮、Enter 选中（无高亮时选第一项）、Esc 关闭；鼠标 hover 同步高亮、click 选中；失焦 150ms 后关闭（让 click 先触发）。
4. 空态：本地+远程均无结果时面板显示"无匹配"；远程加载中在面板底部显示"搜索中…"细条。

**错误处理**：远程失败/超时静默降级为纯本地结果（`console.warn` 一次，不打扰 UI）。

**i18n 新增键**：`search.placeholder`（`Search symbol or name` / `输入代码或名称`）、`search.group-pool`（`Universe` / `股票池`）、`search.group-more`（`More results` / `更多结果`）、`search.empty`（`No matches` / `无匹配`）、`search.loading`（`Searching…` / `搜索中…`）、`search.unavailable`（`No data for this stock` / `该股票暂无数据`）。placeholder 由 search.js 用 `i18n.t` 设置并随 `onChange` 更新（`applyStatic` 只处理 textContent）。

**样式**：`css/style.css` 新增 `.search-section`/`.search-box`/`.search-panel`/`.search-item`/`.search-chip` 等，全部使用 `:root` 变量（`--bg-card`、`--border-color`、`--accent-cyan`），移动端全宽。两 HTML 的 `?v=20261004` → `?v=20261005`。

## 三、选中后的数据流

**池内股票** → 现有 `openDrawer(symbol)`（完整评分抽屉）。

**池外股票** → `openExternalDrawer(symbol, name)`（精简抽屉）：

1. 抽屉立即打开：标题 = 联想名称、副标题 = `symbol · 加载中…`（复用 `freshness.loading`）、Yahoo 链接直接可用（内部符号即 Yahoo 符号）。
2. 后台 `window.SERN.yahoo.getQuote(symbol)` 走现有多源链；完成后填充 metrics（与池内同一套 `metricBox` 渲染，null 字段自然显示 N/A，`drawer.source` 行照常标注来源）。写入前检查 `state.drawerSymbol === symbol`（防止加载期间用户已切换）。
3. `getSpark(symbol)` 完成后绘制 3 个月走势（现有 `drawSpark`）。
4. 评分区：`scores = null` → 既有守卫跳过，天然精简。
5. 全源失败：抽屉内容区显示 `search.unavailable` + 重试按钮（复用 `insufficient.retry` 文案），重试调用 `refreshQuote(symbol)` 后重填。

**实现**（`js/markets.js`）：

- 把 `openDrawer` 的渲染体抽为 `renderDrawer(entry)`；`openDrawer(symbol)` 保持原签名，内部 = 查 `state.entries` + `renderDrawer`。
- 新增 `openExternalDrawer(symbol, name)`：构造 `entry = { meta: { symbol, name: { en: name, zh: name }, market: null }, data: null, scores: null }` → `renderDrawer` 骨架态 → 异步填 `entry.data` 后重渲染 metrics 区。
- 暴露 `window.SERN.markets = { openDrawer: openDrawer, openExternalDrawer: openExternalDrawer }` 供 search.js 调用。
- 行情缓存复用现有 localStorage 日缓存，池外股票无额外逻辑。

## 四、测试与验收

1. **Worker**：`npm test`（新增 search 用例全绿）、`npm run typecheck`。
2. **前端纯函数**：/tmp Node 脚本（不提交）断言 `localMatches` 排序/大小写/中英文、`mergeSuggestions` 去重与分组、池外 entry 构造。
3. **手动冒烟**（桌面 + 移动宽度）：
   - 池内搜索（英文/中文/代码）→ 抽屉正常含评分；
   - 池外搜索（如 `PDD`、`宁德时代`）→ 精简抽屉，价格/指标/走势渲染、来源标注正确、无评分区；
   - 键盘全流程（↓↑/Enter/Esc）；
   - 断开 workers.dev（开发者本机即天然环境）→ 搜索仅出本地结果、无报错无卡顿；
   - 控制台无报错。

## 五、明确不做（YAGNI）

- 搜索历史、热门搜索、拼音搜索；
- 新闻/公告等"内容"（本期"内容"= 行情数据）；
- 池外股票评分（无行业 peers，分数无意义）；
- index.html 搜索入口（选中结果需跳转联动，本期不做）。

## 改动文件清单

**stockapi 仓库**：`src/lib/search.ts`（新）、`src/index.ts`（路由 + 手册页）、`test/search.test.ts`（新）。

**SERN 仓库**：`js/search.js`（新）、`js/markets.js`（renderDrawer 抽取 + openExternalDrawer + 导出）、`js/i18n.js`（search.\* 键）、`markets.html`（搜索框结构 + 脚本引用 + 版本号）、`index.html`（版本号）、`css/style.css`（search 组件样式）。
