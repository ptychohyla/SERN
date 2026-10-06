(function () {
  'use strict';

  window.SERN = window.SERN || {};

  var dict = {
    en: {
      'nav.home': 'Home',
      'nav.markets': 'Markets',
      'nav.menu': 'Menu',
      'nav.products': 'Products',
      'nav.research': 'Research',
      'nav.technology': 'Technology',
      'nav.about': 'About',
      'nav.contact': 'Contact',
      'lang.label': '中文',
      'lang.switch': 'Switch to 中文',

      'page.title': 'Global Markets',
      'page.subtitle': 'Real-time multi-factor screening across global industry leaders, powered by multi-source market data',

      'freshness.loading': 'Loading market data…',
      'freshness.refresh': 'Refresh all',

      'model.label': 'Scoring model',
      'model.multifactor': 'Multi-Factor',
      'model.deepvalue': 'Deep Value',
      'model.peg': 'PEG Growth',
      // one-line scoring principle per strategy, shown under the switcher
      'model.note.multifactor': 'Industry-relative P/E, forward P/E, P/B, P/S, EV/EBITDA and dividend yield, blended with quality (ROE, FCF yield, margin) and growth, minus a leverage penalty.',
      'model.note.deepvalue': 'Graham style — low trailing P/E and P/B with high dividend yield dominate, plus a light financial-health filter against value traps.',
      'model.note.peg': 'Lynch style — PEG carries half the valuation weight, and growth is weighted highest in the composite score.',

      'top20.title': 'Top 20 Strategy Picks',
      'top20.subtitle': 'Ranked by the selected scoring model',

      'col.rank': '#',
      'col.company': 'Company',
      'col.market': 'Market',
      'col.sector': 'Sector',
      'col.score': 'Score',
      'col.pe': 'P/E',
      'col.pb': 'P/B',
      'col.dividend': 'Div Yield',

      'score.valuation': 'Valuation',
      'score.quality': 'Quality',
      'score.growth': 'Growth',
      'score.tip.valuation.sector': 'Valuation score — each metric becomes a percentile rank among same-sector companies (cheaper ranks higher; dividend yield inverted), then the model weights below apply. Missing metrics renormalize over the rest. Weights:',
      'score.tip.valuation.market': 'Valuation score — each metric becomes a percentile rank across the whole market (cheaper ranks higher; dividend yield inverted), then the model weights below apply. Missing metrics renormalize over the rest. Weights:',
      'score.tip.quality': 'Quality score — equal-weight percentile average across the whole market (higher is better):',
      'score.tip.growth': 'Growth score — equal-weight percentile average across the whole market (higher is better):',
      'metric.fcf-yield': 'FCF yield',

      'heat.title': 'Market Heatmap',
      'heat.subtitle': 'Daily move across the tracked universe',

      'dist.title': 'Where the top picks are',
      'dist.by-sector': 'By sector',
      'dist.by-market': 'By market',
      'dist.count': 'stocks',

      'insufficient.title': 'Data unavailable',
      'insufficient.desc': 'These stocks returned price-only data or request failed and are excluded from ranking.',
      'insufficient.retry': 'Retry',

      'search.placeholder': 'Search symbol or name',
      'search.group-pool': 'Universe',
      'search.group-more': 'More results',
      'search.empty': 'No matches',
      'search.loading': 'Searching…',
      'search.unavailable': 'No data for this stock',


      'drawer.metrics': 'Key metrics',
      'drawer.trend': '3-month trend',
      'drawer.open-yahoo': 'View on Yahoo Finance',
      'favorites.add': 'Add to favorites',
      'favorites.remove': 'Remove from favorites',
      'drawer.pe': 'Trailing P/E',
      'drawer.fpe': 'Forward P/E',
      'drawer.pb': 'P/B',
      'drawer.ps': 'P/S',
      'drawer.evebitda': 'EV/EBITDA',
      'drawer.peg': 'PEG',
      'drawer.dividend': 'Dividend yield',
      'drawer.roe': 'Return on equity',
      'drawer.margin': 'Net margin',
      'drawer.fcf': 'Free cash flow',
      'drawer.earnings-growth': 'Earnings growth',
      'drawer.revenue-growth': 'Revenue growth',
      'drawer.debt': 'Debt / equity',
      'drawer.marketcap': 'Market cap',
      'drawer.currency': 'Currency',
      'drawer.source': 'Data source',

      'source.yahoo': 'Yahoo Finance',
      'source.tencent': 'Tencent Finance',
      'source.eastmoney': 'Eastmoney',
      'source.tradingview': 'TradingView',
      'source.ths': 'THS',
      'source.stockapi': 'StockAPI (self-hosted)',
      'source.price': 'Price only (fallback)',

      'common.na': 'N/A',

      'sector.technology': 'Technology',
      'sector.communication': 'Communication',
      'sector.discretionary': 'Cons. Discretionary',
      'sector.staples': 'Cons. Staples',
      'sector.health-care': 'Health Care',
      'sector.financials': 'Financials',
      'sector.industrials': 'Industrials',
      'sector.energy': 'Energy',
      'sector.utilities': 'Utilities',
      'sector.materials': 'Materials',
      'sector.real-estate': 'Real Estate',
      'sector.favorites': 'Favorites',

      'market.US': 'US',
      'market.CN': 'China A',
      'market.HK': 'Hong Kong',
      'market.JP': 'Japan',
      'market.KR': 'Korea',
      'market.TW': 'Taiwan',
      'market.EU': 'Europe',

      'index.name': 'Indices',

      'home.title': 'SERN FinTech - Quantitative Intelligence',
      'home.hero.title-1': 'Quantitative Intelligence',
      'home.hero.title-2': 'For Modern Markets',
      'home.hero.sub-1': 'LLM-powered quantitative infrastructure',
      'home.hero.sub-2': 'for strategy tracking, backtesting,',
      'home.hero.sub-3': 'and algorithmic research',
      'home.hero.explore': 'Explore Platform',
      'home.hero.strategies': 'View Strategies',
      'home.stat.backtested': 'Backtested Volume',
      'home.stat.stability': 'Strategy Stability',
      'home.stat.latency': 'Execution Latency',
      'home.stat.datapoints': 'Data Points Processed',
      'home.stat.deployed': 'Strategies Deployed',
      'home.stat.historical': 'Historical Data',
      'home.stat.years-unit': 'Years',
      'home.solutions.title': 'Our Solutions',
      'home.solutions.tracking': 'Quant Strategy Tracking',
      'home.solutions.sharpe': 'Sharpe Ratio',
      'home.solutions.drawdown': 'Max Drawdown',
      'home.solutions.backtesting': 'Advanced Backtesting',
      'home.solutions.tick': 'Tick-Level Simulation',
      'home.solutions.multifactor': 'Multi-Factor Engine',
      'home.solutions.risk': 'Risk Analysis',
      'home.solutions.research': 'AI & Data Research',
      'home.solutions.llm': 'LLM Signal Analysis',
      'home.solutions.regime': 'Market Regime Detection',
      'home.solutions.altdata': 'Alt Data Intelligence',
      'home.analysis.title': 'Robust Performance Analysis',
      'home.analysis.subtitle': 'In-Depth Risk Metrics',
      'home.analysis.portfolio': 'Portfolio Analysis',
      'home.analysis.netreturn': 'Net Return',
      'home.partners.title': 'Trusted By Industry Leaders',
      'home.cta.title': 'Ready to Transform Your Strategy?',
      'home.cta.contact': 'Contact Us',
      'home.footer.desc': 'LLM-powered quantitative infrastructure for modern markets.',
      'home.footer.tracking': 'Strategy Tracking',
      'home.footer.backtesting': 'Backtesting',
      'home.footer.airesearch': 'AI Research',
      'home.footer.company': 'Company',
      'home.footer.careers': 'Careers',
      'home.footer.legal': 'Legal',
      'home.footer.privacy': 'Privacy',
      'home.footer.terms': 'Terms',
      'home.footer.compliance': 'Compliance',
      'home.footer.rights': '© 2024 SERN FinTech. All rights reserved.'
    },

    zh: {
      'nav.home': '首页',
      'nav.markets': '市场',
      'nav.menu': '菜单',
      'nav.products': '产品',
      'nav.research': '研究',
      'nav.technology': '技术',
      'nav.about': '关于',
      'nav.contact': '联系',
      'lang.label': 'EN',
      'lang.switch': 'Switch to English',

      'page.title': '全球市场',
      'page.subtitle': '基于多数据源实时行情，对全球行业龙头进行多因子筛选打分',

      'freshness.loading': '正在加载市场数据…',
      'freshness.refresh': '全部刷新',

      'model.label': '评分模型',
      'model.multifactor': '专业多因子',
      'model.deepvalue': '深度价值',
      'model.peg': 'PEG 成长',
      'model.note.multifactor': '行业相对市盈率、预期市盈率、市净率、市销率、EV/EBITDA 与股息率，叠加质量（ROE、自由现金流收益率、净利率）与成长，高负债扣分。',
      'model.note.deepvalue': '格雷厄姆式价值：低市盈率、低市净率与高股息率为主，辅以财务健康过滤规避价值陷阱。',
      'model.note.peg': '彼得·林奇法则：PEG 占估值权重一半，成长在综合分中占比最高。',

      'top20.title': '策略精选 Top 20',
      'top20.subtitle': '按当前所选评分策略的综合得分排名',

      'col.rank': '#',
      'col.company': '公司',
      'col.market': '市场',
      'col.sector': '行业',
      'col.score': '策略得分',
      'col.pe': '市盈率',
      'col.pb': '市净率',
      'col.dividend': '股息率',

      'score.valuation': '估值',
      'score.quality': '质量',
      'score.growth': '成长',
      'score.tip.valuation.sector': '估值得分：各指标先转换为同行业公司的百分位排名（越便宜越高，股息率反向），再按当前模型权重加权，缺失指标按剩余权重重归一。权重：',
      'score.tip.valuation.market': '估值得分：各指标先转换为全市场的百分位排名（越便宜越高，股息率反向），再按当前模型权重加权，缺失指标按剩余权重重归一。权重：',
      'score.tip.quality': '质量得分：全市场百分位等权平均（越高越好）：',
      'score.tip.growth': '成长得分：全市场百分位等权平均（越高越好）：',
      'metric.fcf-yield': '自由现金流收益率',

      'heat.title': '市场热力图',
      'heat.subtitle': '全池股票的当日涨跌一览',

      'dist.title': '策略精选集中在哪里',
      'dist.by-sector': '按行业',
      'dist.by-market': '按市场',
      'dist.count': '只股票',

      'insufficient.title': '数据不足',
      'insufficient.desc': '以下股票仅获取到价格或请求失败，不参与本次排名。',
      'insufficient.retry': '重试',

      'search.placeholder': '输入代码或名称',
      'search.group-pool': '股票池',
      'search.group-more': '更多结果',
      'search.empty': '无匹配',
      'search.loading': '搜索中…',
      'search.unavailable': '该股票暂无数据',


      'drawer.metrics': '核心指标',
      'drawer.trend': '近 3 个月走势',
      'drawer.open-yahoo': '在 Yahoo 查看',
      'favorites.add': '收藏（置顶到热力图与榜单）',
      'favorites.remove': '取消收藏',
      'drawer.pe': '市盈率(TTM)',
      'drawer.fpe': '预期市盈率',
      'drawer.pb': '市净率',
      'drawer.ps': '市销率',
      'drawer.evebitda': 'EV/EBITDA',
      'drawer.peg': 'PEG',
      'drawer.dividend': '股息率',
      'drawer.roe': '净资产收益率',
      'drawer.margin': '净利率',
      'drawer.fcf': '自由现金流',
      'drawer.earnings-growth': '盈利增速',
      'drawer.revenue-growth': '营收增速',
      'drawer.debt': '负债/权益',
      'drawer.marketcap': '总市值',
      'drawer.currency': '币种',
      'drawer.source': '数据来源',

      'source.yahoo': 'Yahoo Finance',
      'source.tencent': '腾讯财经',
      'source.eastmoney': '东方财富',
      'source.tradingview': 'TradingView',
      'source.ths': '同花顺',
      'source.stockapi': 'StockAPI（自建）',
      'source.price': '仅价格（备用源）',

      'common.na': '暂无',

      'sector.technology': '信息技术',
      'sector.communication': '通信服务',
      'sector.discretionary': '可选消费',
      'sector.staples': '日常消费',
      'sector.health-care': '医疗保健',
      'sector.financials': '金融',
      'sector.industrials': '工业',
      'sector.energy': '能源',
      'sector.utilities': '公用事业',
      'sector.materials': '原材料',
      'sector.real-estate': '房地产',
      'sector.favorites': '收藏',

      'market.US': '美股',
      'market.CN': 'A股',
      'market.HK': '港股',
      'market.JP': '日本',
      'market.KR': '韩国',
      'market.TW': '台湾',
      'market.EU': '欧洲',

      'index.name': '指数',

      'home.title': 'SERN FinTech - 量化智能',
      'home.hero.title-1': '量化智能',
      'home.hero.title-2': '驱动现代市场',
      'home.hero.sub-1': 'LLM 驱动的量化基础设施',
      'home.hero.sub-2': '覆盖策略跟踪、回测',
      'home.hero.sub-3': '与算法研究',
      'home.hero.explore': '探索平台',
      'home.hero.strategies': '查看策略',
      'home.stat.backtested': '累计回测量',
      'home.stat.stability': '策略稳定性',
      'home.stat.latency': '执行延迟',
      'home.stat.datapoints': '已处理数据点',
      'home.stat.deployed': '已部署策略',
      'home.stat.historical': '历史数据',
      'home.stat.years-unit': '年',
      'home.solutions.title': '我们的方案',
      'home.solutions.tracking': '量化策略跟踪',
      'home.solutions.sharpe': '夏普比率',
      'home.solutions.drawdown': '最大回撤',
      'home.solutions.backtesting': '高级回测',
      'home.solutions.tick': 'Tick 级仿真',
      'home.solutions.multifactor': '多因子引擎',
      'home.solutions.risk': '风险分析',
      'home.solutions.research': 'AI 与数据研究',
      'home.solutions.llm': 'LLM 信号分析',
      'home.solutions.regime': '市场状态识别',
      'home.solutions.altdata': '另类数据智能',
      'home.analysis.title': '稳健绩效分析',
      'home.analysis.subtitle': '深度风险指标',
      'home.analysis.portfolio': '组合分析',
      'home.analysis.netreturn': '净收益',
      'home.partners.title': '深受行业领导者信赖',
      'home.cta.title': '准备好革新你的策略了吗？',
      'home.cta.contact': '联系我们',
      'home.footer.desc': '面向现代市场的 LLM 量化基础设施。',
      'home.footer.tracking': '策略跟踪',
      'home.footer.backtesting': '回测',
      'home.footer.airesearch': 'AI 研究',
      'home.footer.company': '公司',
      'home.footer.careers': '加入我们',
      'home.footer.legal': '法律',
      'home.footer.privacy': '隐私政策',
      'home.footer.terms': '服务条款',
      'home.footer.compliance': '合规',
      'home.footer.rights': '© 2024 SERN FinTech. 保留所有权利。'
    }
  };

  // Default English; the browser language is deliberately NOT consulted.
  // Only an explicit toggle is remembered (localStorage 'sern-lang').
  var lang = localStorage.getItem('sern-lang');
  if (lang !== 'en' && lang !== 'zh') lang = 'en';
  var listeners = [];

  function t(key) {
    return (dict[lang] && dict[lang][key]) || dict.en[key] || key;
  }

  function getLang() {
    return lang;
  }

  function setLang(next) {
    if (next !== 'en' && next !== 'zh') return;
    lang = next;
    localStorage.setItem('sern-lang', lang);
    applyStatic();
    for (var i = 0; i < listeners.length; i++) listeners[i](lang);
  }

  function toggle() {
    setLang(lang === 'en' ? 'zh' : 'en');
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function applyStatic(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }

  window.SERN.i18n = { t: t, getLang: getLang, setLang: setLang, toggle: toggle, onChange: onChange, applyStatic: applyStatic };
})();
