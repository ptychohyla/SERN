# 市场页行业分类与股票池改造设计

日期：2026-10-14
状态：待评审

## 1. 背景与目标

**现状问题**

- 热力图的「板块」并不是行业板块，而是 `js/data/universe.js` 里每只股票硬编码的 11 个 GICS 大类（`technology` / `financials` / …）。行业列表和个股名单都写死在同一个文件里。
- 颗粒度粗：85 只美股只分 11 类，「行业龙头」看不出行业差异；A 股尤其明显（28 只里 `industrials` 只有 1 只）。
- 股票池是历次手工增补的结果，没有统一的选股口径，也没有生成日期。

**目标**

1. 行业分类换成 **31 个申万一级行业**（口径取自 stock-sdk 行业板块列表），**全球股票统一使用**——行业分类描述公司主营业务，与上市市场无关。
2. 股票池按「**市场 × 行业**」重建，每个格子只保留龙头 / 白马 / 蓝筹，按市场与行业深度酌情调整数量。
3. 行业表与股票池都是**静态数据文件**（方案 A），带生成日期，每周重新生成并提交；浏览器端不做动态拉取。
4. stockapi 新增**批量基本面端点**，把冷启动基本面请求量从 O(股票数) 降到 O(股票数 / 批大小)。

**非目标**

- 不改首页（`index.html` / `js/script.js`）。
- 不改行情、K 线链路与数据源优先级链。
- 不引入构建步骤、包管理清单或第三方前端依赖。

## 2. 已确认决策

| 议题 | 决策 |
|---|---|
| 行业分类口径 | 31 个申万一级行业，参考 stock-sdk 行业板块列表；**不要求板块 API 覆盖该市场** |
| 行业表存放 | 新增 `js/data/industries.js`，写死，独立于股票池 |
| 股票池口径 | 市场 × 行业的龙头 / 白马 / 蓝筹 |
| 股票池存放 | `js/data/universe.js`，写死 + `generatedAt` |
| 更新方式 | **方案 A**：每周重新生成、提交新文件；无浏览器端动态拉取，无 TTL 缓存 |
| 基本面请求量 | **方案 A**：stockapi 新增批量基本面端点 |
| 基本面浏览器缓存 | 维持现状（每日 06:00 滚动过期），批量后无需再延长 |
| 每日热度排序 | **方案 A+**：静态池成员固定，池内按当日成交额在「市场 × 行业」内排序，每日刷新（§4.6） |

> 「缓存 7 天」在方案 A 下体现为**股票池每周重新生成一次**，不落地为浏览器 TTL——池子成员是静态文件，改它必须发版。行情与基本面仍按各自的日频缓存滚动。

## 3. 行业分类表：`js/data/industries.js`（新增）

### 3.1 数据形状

```js
(function () {
  'use strict';
  window.SERN = window.SERN || {};

  // 申万一级行业（31 个）。code 为 stock-sdk 行业板块代码，仅作稳定标识，
  // 与上市市场无关——行业分类描述公司主营业务，全球股票通用。
  // 生成日期：2026-10-14
  var list = [
    { code: 'BK0433', zh: '农林牧渔', en: 'Agriculture' },
    // ...
  ];

  var byCode = {};
  list.forEach(function (i) { byCode[i.code] = i; });

  window.SERN.industries = {
    list: list,
    byCode: byCode,
    // 未知 code 回退为 code 本身，保证标签永不空白
    name: function (code, lang) {
      var i = byCode[code];
      if (!i) return code;
      return i[lang] || i.en || i.zh;
    }
  };
})();
```

- `code` 只作稳定标识与 i18n 键使用；UI 文案一律走 `name(code, lang)`，不再依赖 `i18n.js` 的 `sector.*` 键。
- 未收录的 code 回退显示 code 本身（收藏夹等特殊 bucket 除外）。

### 3.2 31 个一级行业

| # | code | zh | en |
|---|---|---|---|
| 1 | `BK0433` | 农林牧渔 | Agriculture |
| 2 | `BK1206` | 基础化工 | Basic Chemicals |
| 3 | `BK0479` | 钢铁 | Steel |
| 4 | `BK0478` | 有色金属 | Non-ferrous Metals |
| 5 | `BK1201` | 电子 | Electronics |
| 6 | `BK1211` | 汽车 | Automobiles |
| 7 | `BK0456` | 家用电器 | Home Appliances |
| 8 | `BK0438` | 食品饮料 | Food & Beverage |
| 9 | `BK0436` | 纺织服饰 | Textiles & Apparel |
| 10 | `BK1212` | 轻工制造 | Light Industry |
| 11 | `BK1216` | 医药生物 | Pharmaceuticals & Biotech |
| 12 | `BK0427` | 公用事业 | Utilities |
| 13 | `BK1210` | 交通运输 | Transportation |
| 14 | `BK1202` | 房地产 | Real Estate |
| 15 | `BK1213` | 商贸零售 | Commerce & Retail |
| 16 | `BK1214` | 社会服务 | Social Services |
| 17 | `BK1217` | 综合 | Conglomerates |
| 18 | `BK1208` | 建筑材料 | Building Materials |
| 19 | `BK1209` | 建筑装饰 | Construction & Decoration |
| 20 | `BK1200` | 电力设备 | Power Equipment |
| 21 | `BK1204` | 国防军工 | Defense & Aerospace |
| 22 | `BK1207` | 计算机 | Computers |
| 23 | `BK0486` | 传媒 | Media |
| 24 | `BK1215` | 通信 | Telecommunications |
| 25 | `BK1283` | 银行 | Banks |
| 26 | `BK1203` | 非银金融 | Non-bank Financials |
| 27 | `BK0437` | 煤炭 | Coal |
| 28 | `BK0464` | 石油石化 | Oil & Petrochemicals |
| 29 | `BK0728` | 环保 | Environmental Protection |
| 30 | `BK1035` | 美容护理 | Beauty & Personal Care |
| 31 | `BK1205` | 机械设备 | Machinery |

> 板块列表响应中同名行业存在 `Ⅱ` / `Ⅲ` 后缀重复项（如 `BK1217 综合`、`BK0539 综合Ⅱ`、`BK1627 综合Ⅲ` 数值完全相同）。本设计**只取无后缀的一级口径**，重复项忽略。

## 4. 股票池：`js/data/universe.js`（改造）

### 4.1 数据形状

`market` + `sector` → `market` + `industry`，其余不变：

```js
(function () {
  'use strict';
  window.SERN = window.SERN || {};

  // 市场 × 行业龙头/白马/蓝筹池。industry 取值见 js/data/industries.js。
  // 生成日期：2026-10-14
  var universe = [
    { symbol: 'AAPL', name: { en: 'Apple', zh: '苹果' }, market: 'US', industry: 'BK1201' },
    { symbol: '0700.HK', name: { en: 'Tencent', zh: '腾讯控股' }, market: 'HK', industry: 'BK1215' },
    // ...
  ];

  window.SERN.universe = universe;
  window.SERN.universeGeneratedAt = '2026-10-14';
})();
```

- `symbol` 维持现有 Yahoo 形态，`market` 取值不变（`US` / `CN` / `HK` / `JP` / `KR` / `TW` / `EU`）。
- 每只股票**只挂一个一级行业**；跨行业集团（如 Alphabet、Amazon）按主营收入占比归入单一行业，规则见 4.2。
- 生成日期同时写入文件头注释与 `window.SERN.universeGeneratedAt`，便于页面/排查时确认版本。

### 4.2 选股规则

按以下优先级逐格挑选，规则全局一致：

1. **市值优先**：在目标市场内按总市值降序取候选。
2. **龙头/白马/蓝筹**：要求同时满足——上市满 3 年、非 ST / 非退市风险、非微盘壳、近三年主营稳定；市值与流动性明显低于同格候选的剔除。
3. **同公司多地上市只保留主上市地**：如腾讯只留 `0700.HK`、阿里只留 `9988.HK`、中国平安只留 A 股或 H 股其中一只（取流动性更高者）。
4. **跨行业集团按主营归类**：Alphabet / Meta 归 `BK0486 传媒`；Amazon 归 `BK1213 商贸零售`；Tesla 归 `BK1211 汽车`。规则写在生成脚本注释里，避免同类公司散落。
5. **不硬凑**：某市场某行业没有符合条件的龙头就**留空**，热力图渲染时自然跳过。

### 4.3 每格配额

| 市场 | 每行业数量 | 说明 |
|---|---|---|
| US | 2–3 | 池子最深，行业覆盖全 |
| CN | 2–3 | 主战场，龙头明确 |
| HK | 1–2 | 中资龙头为主 |
| JP | 1–2 | 各行业取市值最大 |
| KR | 1 | 有则取，无则跳过 |
| TW | 1 | 同上 |
| EU | 1–2 | 德/法为主 |

「酌情调整」的判定：行业市值占比高、候选之间市值差距小（前三名市值在同一量级）时取上限，否则取下限。

### 4.4 候选池生成方法

1. 用 stock-sdk 全市场行情取候选与总市值：`sdk.batch.us()` / `sdk.batch.cn()` / `sdk.batch.hk()`（批量行情自带 `totalMarketCap`），日/韩/台/欧的候选按现有池子 + 行业龙头清单人工补充。
2. 按 4.2 规则打分排序，按 4.3 配额截断。
3. 人工复核一遍归属与去重（同公司多地上市、跨行业集团）。
4. 生成 `universe.js`，写入生成日期。

> 生成脚本一次性使用，**不纳入仓库**（仓库无构建/依赖约束）；产出物是提交进仓库的静态 `universe.js`。

### 4.5 规模与请求量

- 预计 **180–200 只**（当前 151）。
- 行情：`/v1/quote` 每批 20，≈ **10 个请求**。
- 基本面：批量端点后每批 20，≈ **10 个请求**（当前 151 次逐股）。
- 冷启动网络请求从 ≈160 降到 ≈20。

### 4.6 每日成交额热度排序（方案 A+）

**动机**：池子成员固定（§4.2–4.3）保证不会漂成妖股/小盘热炒；但「今天资金在往哪几只龙头集中」是每天都变的，静态池看不出。用当日**成交额**给池内股票排序，得到「池内最热」，成员稳定 + 排序新鲜。

**数据来源**：复用已有的 `/v1/quote` 批量预热，**不新增任何请求**。`Quote.amount` 已由 stocksdk（A 股上游为万元，`src/providers/stocksdk.ts:146` 已 ×10000 换算为元）与 eastmoney（`f48`，元）填充；Yahoo 兜底路径没有 `amount`，缺失时该项热度记 `null`、排在末位。

**排序口径**：在「市场 × 行业」桶内按 `amount` 降序，取前 N。**不跨市场比较**——`amount` 单位为各市场计价货币主单位（A 股元 / 港股港元 / 美股美元），文档明确「不跨币种折算」，混排会失真。桶内比较安全。

**前端改动**：
- `js/market-data.js`：`parseStockapiQuotes` 的 `out[item.symbol]` 增加 `amount: num(item.amount)`；`stockapiSnapshots` 相应多存一个字段；`stockapiQuote()` 把它带到快照上，**并把 `amount` 加进 `FILL_KEYS`**——`getQuote()` 用 `fillFrom()` 只复制 `FILL_KEYS` 内的键，不加进去 `amount` 会在合并时丢失、`entry.data.amount` 永远为 `null`。
- `js/markets.js`：新增 `heatRank(entries)` —— 按 `market + industry` 分桶、桶内 `amount` 降序，输出 `{ [symbol]: rank }`；榜单在「同分/同数据完整度」时用它做二级排序键，或作为「热门」标记/徽标展示（具体呈现形态见 §4.7，二选一由实现时确认）。

**缓存**：沿用现有 localStorage 每日 06:00 滚动过期（`lastRollover`）——`amount` 与报价同生命周期，不新增 TTL。

**已知限制**：
- 只覆盖**池内**，不是全市场最热。全市场最热需要 A 股 31 个行业各调 `board.industry.constituents`（自带 `amount`），31×2 = 62 子请求 > Cloudflare 免费版 50/请求上限，必须 Cron 预生成；且板块 API 仅覆盖 A 股（港/美/日/韩/台/欧无行业归属）。**不在本次范围。**
- `amount` 为 0（停牌）或 `null`（Yahoo 兜底）时视为最末位，不影响其他项排序。

## 5. 消费方迁移（`sector` → `industry`）

| 文件 | 改动 |
|---|---|
| `js/data/industries.js` | 新增（§3） |
| `js/data/universe.js` | 字段 `sector` → `industry`，值换成 `BKxxxx`（§4） |
| `markets.html` | 新增 `<script src="js/data/industries.js?v=...">`，位置在 `universe.js` 之前 |
| `js/heatmap.js` | 分组字段 `e.meta.sector` → `e.meta.industry`；分组标签由 `t('sector.'+s)` 改为 `industries.name(code, lang)`；内部变量 `sector*` 重命名为 `industry*`（纯重命名，不改布局算法） |
| `js/markets.js` | `sectorTag` / `sectorCounts` / `renderLegend` 改用 `industries.name()`；`SECTOR_COLORS` 由 11 个硬编码色改为按 HSL 均匀生成的 31+ 色（`hue = i * 360 / n`，饱和度/明度固定）；收藏 bucket 的 `sector: 'favorites'` → `industry: 'favorites'`；外部股票的 `sector: null` → `industry: null`；`MARKET_ORDER` 不变 |
| `js/scoring.js` | `groupKey()` 读 `entry.meta.industry`；配置项 `scope: 'sector'` → `scope: 'industry'`（语义一致，仅改名） |
| `js/i18n.js` | 删除 `sector.*` 键（11 类）；新增 `industry.favorites`（收藏 / Favorites）供收藏 bucket 使用；`dist.by-sector` 键名改为 `dist.by-industry`、文案改为「按行业 / By industry」，`markets.html` 的 `data-i18n` 同步；`score.tip.valuation.sector` 键与文案保持（语义仍为「同行业」） |
| `js/search.js` | 无改动（只用 `symbol` / `name` / `market`） |

**标签渲染统一入口**：`markets.html` 的行业环形图标题 `data-i18n` 同步改为 `dist.by-industry`。新增 `industryName(code)` 小工具（内部调 `industries.name(code, i18n.getLang())`），`heatmap.js` 与 `markets.js` 共用，避免两处各写一遍回退逻辑。收藏 bucket 走 `t('industry.favorites')` 特殊分支。

## 6. 热力图对稀疏行业的处理

31 个行业摊到 180–200 只股票后，必然出现「空行业」和「只有 1 只股票的小行业」。处理原则：**不为凑版面而合并或硬塞**。

- **空行业**：分组数据来自 entries，天然不会渲染；不做占位方块。
- **单股行业**：照常渲染，沿用现有阈值——矩形宽度 `< 64px` 时隐藏行业标签（`LABEL_MIN_W`）、方块过小则退化为纯色块。行业名仍可通过 `title` 提示与下方环形图图例查到。
- **行业标签**：保留现有「宽度不足则隐藏」策略，不新增换行/缩略名逻辑。
- **环形图图例**：`renderLegend` 已按计数降序输出全部行业，是稀疏行业的主要可读入口，无需改动。
- **收藏 bucket**：与行业并列渲染，标签「收藏 / Favorites」，不参与行业计数排序的语义。

> 如果实测发现单股行业标签缺失影响可读性，再单独提优化（例如小行业合并为「其他」），**不在本次范围**。

## 7. stockapi：批量基本面端点

### 7.1 契约

```
GET /v1/fundamentals?symbols=600519.SS,AAPL,0700.HK
```

- `symbols` 逗号分隔，1–20 个；接受 Yahoo 风格代码，也接受本站规范代码（与现有单数端点一致，经 `toYahooSymbol(normalizeSymbol())` 换算）。
- 数量为空或 > 20 → 400 `INVALID_PARAMETER`。
- 返回 HTTP 200，`data` 为数组，**顺序与入参一致**，逐项独立成败：

```json
{
  "data": [
    { "symbol": "600519.SS", "name": "Kweichow Moutai", "pe": 20.1, "market_cap": 1580000000000 },
    { "symbol": "AAPL", "error": "NOT_FOUND" },
    { "symbol": "0700.HK", "error": "ALL_PROVIDERS_FAILED" }
  ]
}
```

- 字段与现有单数端点完全一致（`Fundamentals` 结构，snake_case）。
- 部分失败**不降级为 5xx**——与 `/v1/quote` 的「部分失败 HTTP 200 + 内嵌 error」契约对齐。
- 现有 `GET /v1/fundamentals/:symbol` **保留**，作为单股/抽屉路径，行为不变。

### 7.2 服务端实现

- 复用 `src/lib/fundamentals.ts` 的解析逻辑，抽出「已拿到 auth → 解析一个 symbol」的内部函数，批量为它加一层有界并发扇出。
- **crumb 复用**：整个批次共享一次 `getCrumbAuth()`；只在批次首个请求 401/429/400 时走 cookie+crumb 流程，避免每只股票各取一次。
- **并发上限 5**：与前端现有 `FUND_CONCURRENCY = 8` 相比更保守，降低被 Yahoo 限流的概率。
- **子请求预算**（Cloudflare 免费额度 50/请求，需显式写进注释）：
  - crumb 已缓存：≈ 20（每 symbol 1 次）+ 0 = 20。
  - crumb 未缓存且裸试失败：≈ 20×2 + 2（cookie + crumb）= 42，仍在 50 以内。
  - 因此**批大小硬上限 20**，不得提高。
- 超时沿用单数端点的 `TOTAL_TIMEOUT_MS = 6000`，整批共用一个 AbortController。

### 7.3 手册与测试

- `src/index.ts` 的内嵌中文手册新增该端点条目（参数、示例、部分失败语义、与单数端点的关系）——按 stockapi 工作规则，改端点必须同步更新手册。
- 新增 vitest 用例：批量返回顺序、部分失败内嵌 error、超 20 个 400、crumb 全批次只取一次、并发不超过 5。

## 8. SERN 端批量基本面接入

`js/market-data.js`：

- `stockapiFundamentals(symbol)` 保留（抽屉/池外股票的按需路径）。
- `warmFundamentals(symbols)` 改为**按批**调用新端点：`chunkOf(symbols, 20)` + `runChunks(..., 3, ...)`，与 `warmStockapi` 的报价批量策略对齐。
- 批内逐项写回 `sern-fund-<symbol>` 缓存；`error` 项跳过（不写缓存、不阻塞其他项）。
- 失败语义不变：整批网络失败才 `markDown('stockapi-fund')`；HTTP 4xx/5xx 视为逐股 miss。
- `_test` 导出的解析函数改为「批量响应 → {symbol: fundamentals}」映射，并保留单股解析供回归测试。

## 9. 版本号与缓存

- 新增/修改任何 `js/*` 后，同步递增 `index.html` 与 `markets.html` 的 `?v=YYYYMMDD` 版本号（本次目标 `?v=20261014`）。
- 股票池与行业表的「周更」通过**重新生成文件 + 提交 + 递增版本号**完成，浏览器端无额外缓存层。
- 行情与基本面缓存维持现有 06:00 滚动过期逻辑，不新增 TTL。

## 10. 验证

- **stockapi**：`npm test`（新增批量用例全绿）、`npm run typecheck` 干净；部署后 `curl` 三市场批量验证（含一个不存在代码确认内嵌 error）。
- **SERN**：
  - Node 侧跑 `_test` 纯函数回归（批量解析、顺序保持、错误项跳过）。
  - 本地 `python3 -m http.server 8000` 打开 `markets.html`：确认热力图按 31 行业分组、行业标签中英文正确、稀疏行业不崩、环形图图例完整、榜单行业标签正确。
  - 桌面端与移动端宽度各跑一次冒烟；确认控制台无报错、冷启动请求数 ≈20。
  - 手动刷新确认行情/基本面缓存行为未变。

## 11. 不在本次范围（待单独确认）

以下改动此前已提出但**未获确认**，不并入本设计：

- **策略公式展示**：在策略切换器下方列出各模型计算公式。当前 `js/i18n.js` 末尾被追加了一段**无效的公式注释**（无 i18n key、`updateModelNote()` 未改），功能未实现，需要单独设计与确认。
- **`js/scoring.js` 未确认的修复**：PEG 权重 50→5、深度价值成长权重 0→15、杠杆惩罚改对数等，以及遗留的 `js/scoring.js.backup` 备份文件。
- **`js/i18n.js` 末尾无效注释清理**：与上两项一并处理。

建议本设计落地后，再单独出一份「策略评分修复与公式展示」设计。

## 12. 改动文件汇总

**stockapi**：`src/lib/fundamentals.ts`、`src/index.ts`（路由 + 手册）、`test/fundamentals.test.ts`。

**SERN**：`js/data/industries.js`（新）、`js/data/universe.js`、`js/heatmap.js`、`js/markets.js`、`js/scoring.js`、`js/i18n.js`、`js/market-data.js`、`markets.html`、`index.html`（版本号）、`AGENTS.md`（已更新）、本文档。
