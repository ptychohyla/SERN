# 仓库贡献指南

## 项目结构与模块组织

SERN 是一个无依赖的静态网站，用于展示 SERN FinTech。请保持实现简洁，优先使用浏览器原生技术：

- `index.html` — 首页结构、内容区块与导航；脚本引用 `js/nav.js` 与 `js/script.js`。
- `markets.html` — 全球市场页面（多源行情榜单、热力图、评分抽屉），独立于首页的脚本链。
- `css/style.css` — 全部样式，包括设计变量、响应式规则和组件布局。
- `js/script.js` — 首页 IIFE，包含 Canvas 动画、图表及初始化逻辑。
- `js/nav.js` — 首页与市场页共用的移动端导航（汉堡菜单开关）。
- `js/market-data.js` — 市场页行情数据层：全部请求单走自有 StockAPI Worker（stockapi.hinsyeow.org，报价 /v1/quote、基本面 /v1/fundamentals、K 线 /v1/kline），无浏览器端多源回退。
- `js/data/industries.js` — 市场页行业分类表：固定 31 个申万一级行业（`code` / `zh` / `en`）。
- `js/data/universe.js` — 市场页个股池：按「市场 × 行业」维护的龙头/白马/蓝筹清单。
- `demo/` — 预览截图，仅供参考，不属于运行时资源。

当前没有代码生成层、包管理清单或测试目录。

## 市场页行业与股票池约定

市场页热力图与策略榜单使用固定的行业与股票池。改名单时只修改对应数据文件，不要把行业/个股清单散落到消费方代码里：

- **行业列表**（`js/data/industries.js`）— 固定 31 个申万一级行业，每条包含 `code`（`BKxxxx`）、`zh`、`en`。BK 代码只作稳定标识；行业分类描述公司主营业务，可同时用于全球股票，与上市市场无关。
- **个股池**（`js/data/universe.js`）— 每只股票用 `industry`（取值来自 `industries.js` 的 `code`）替代原 `sector` 标签，字段为 `{ symbol, name: { en, zh }, market, industry }`。
- **选股范围**：按「市场 × 行业」挑选龙头、白马、蓝筹，依据市场、行业深度与市值酌情调整每格数量（参考配额：US / CN 每行业 2–3 只，HK / JP / EU 每行业 1–2 只，KR / TW 每行业 1 只）。同一公司多地上市只保留主上市地；某市场某行业没有合适龙头时留空，不做硬凑。
- **更新方式（方案 A，纯静态）**：名单写死并带 `generatedAt` 生成日期，每周跑一次生成脚本、提交新文件即生效。浏览器端不做动态拉取，不引入 7 天 TTL 缓存。
- **基本面按需拉取**：`/v1/fundamentals` 是逐股接口，股票池扩容后不再全量预热，改为进入评分/抽屉时按需请求。

调整股票池或行业后，按上文资源版本号规则同步递增 `index.html` 与 `markets.html` 的版本号。

## 构建、测试与开发命令

本项目无需构建步骤。使用以下命令在本地启动服务：

```bash
python3 -m http.server 8000
```

随后访问 `http://localhost:8000`，按 `Ctrl+C` 停止服务。建议通过本地服务器访问，而非直接使用 `file://`，以确保字体和相对资源正常加载。

当前没有配置自动化测试或代码检查命令。请通过加载页面、查看浏览器控制台，并验证导航、动画、图表及响应式布局来完成校验。

## 代码风格与命名约定

- HTML、CSS 与 JavaScript 均使用 2 个空格缩进。
- JavaScript 保持在现有的 IIFE 中并启用 `'use strict'`；变量与函数使用小驼峰命名，例如 `initGlobe`、`drawPortfolioChart`。
- HTML/CSS 类名与 Canvas ID 使用短横线命名，例如 `hero-title`、`particle-canvas`、`cta-footer-wrap`。
- 共享颜色与字体应在 `:root` 中定义为 CSS 自定义属性，再添加组件专属值。
- HTML 中的 CSS/JS 引用统一带 `?v=YYYYMMDD` 版本查询参数（防浏览器缓存旧资源）；修改任何 CSS/JS 文件后，同步递增两个 HTML 文件中的版本号。
- 保持 `js/script.js` 中的分节注释结构，以及 `style.css` 中按组件分组的样式组织。

## 测试指南

当前没有测试框架或覆盖率要求。对于任何视觉或交互改动，请在桌面端和移动端宽度下进行手动冒烟测试：确认 Canvas 能正确缩放、动画保持流畅、链接指向正确的区块，且控制台无报错。若未来引入自动化测试，请在本文件中补充对应命令与测试位置。

## 提交与合并请求规范

Git 历史较短，提交信息多为小写的 `initial`，其中一条使用了 `docs:` 约定式前缀。新的提交建议采用 Conventional Commits 规范：

- `feat: 新增策略板块`
- `fix: 修复 Canvas 缩放`
- `style: 调整卡片间距`
- `docs: 更新贡献指南`

合并请求应概述改动内容、列出手动验证步骤并关联相关 Issue；视觉更新请附上修改前后的截图。请保持 PR 聚焦，除非确有必要，不要引入框架或构建系统。
