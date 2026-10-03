(function () {
  'use strict';

  window.SERN = window.SERN || {};

  var dict = {
    en: {
      'nav.home': 'Home',
      'nav.rankings': 'Rankings',
      'nav.products': 'Products',
      'nav.research': 'Research',
      'nav.technology': 'Technology',
      'nav.about': 'About',
      'nav.contact': 'Contact',
      'lang.label': '中文',

      'page.title': 'Global Valuation Rankings',
      'page.subtitle': 'Real-time multi-factor screening across global industry leaders, powered by Yahoo Finance data',

      'freshness.loading': 'Loading market data…',
      'freshness.done': 'Data loaded',
      'freshness.updated': 'Updated',
      'freshness.completed': 'Completed',
      'freshness.failed': 'Failed',
      'freshness.retry-failed': 'Retry failed',
      'freshness.refresh': 'Refresh all',

      'watch.filter': 'My watchlist only',
      'watch.empty': 'No starred stocks yet. Tap the star icon to add one.',

      'model.label': 'Scoring model',
      'model.multifactor': 'Multi-Factor',
      'model.deepvalue': 'Deep Value',
      'model.peg': 'PEG Growth',

      'top20.title': 'Top 20 Valuation Scores',
      'top20.subtitle': 'Ranked by cheapness within peer groups',
      'top10.title': 'Top 10 Best Value',
      'top10.subtitle': 'Cheap price combined with quality and growth',

      'col.rank': '#',
      'col.company': 'Company',
      'col.market': 'Market',
      'col.sector': 'Sector',
      'col.valuation': 'Valuation',
      'col.composite': 'Composite',
      'col.pe': 'P/E',
      'col.pb': 'P/B',
      'col.dividend': 'Div Yield',

      'score.valuation': 'Valuation',
      'score.quality': 'Quality',
      'score.growth': 'Growth',

      'dist.title': 'Where the cheap stocks are',
      'dist.by-sector': 'By sector',
      'dist.by-market': 'By market',
      'dist.count': 'stocks',

      'insufficient.title': 'Data unavailable',
      'insufficient.desc': 'These stocks returned price-only data or request failed and are excluded from ranking.',
      'insufficient.retry': 'Retry',

      'method.title': 'How scoring works',
      'method.p1': 'Every valuation metric is converted to a percentile rank among peer companies. In Multi-Factor and PEG models peers are companies in the same sector, so banks are never compared directly with technology stocks on P/E. Deep Value ranks across the whole market.',
      'method.p2': 'Multi-Factor blends industry-relative P/E, forward P/E, P/B, P/S, EV/EBITDA and dividend yield for the valuation score, then adds quality (ROE, free-cash-flow yield, net margin) and growth (earnings and revenue growth). High leverage applies a penalty up to 10 points.',
      'method.p3': 'Deep Value follows the Graham tradition: low trailing P/E and P/B with high dividend yield dominate, plus a light financial-health filter to avoid obvious value traps.',
      'method.p4': 'PEG follows the Peter Lynch rule — price relative to earnings growth. PEG carries half the valuation weight, supported by forward P/E, P/S and EV/EBITDA, with growth carrying the largest composite weight.',
      'method.p5': 'Missing metrics are renormalized over the available weights. Stocks with fewer than two usable valuation metrics are moved to the data-unavailable list.',
      'method.p6': 'Data sources: Yahoo Finance (primary), Eastmoney and Tencent Finance (fallback), cached in this browser for 30 minutes. When Yahoo is unreachable, stocks are scored on fallback snapshots (P/E, P/B, P/S, market cap only; P/E may be static). For research purposes only — not investment advice.',

      'drawer.metrics': 'Key metrics',
      'drawer.trend': '3-month trend',
      'drawer.open-yahoo': 'View on Yahoo Finance',
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
      'source.fallback': 'Eastmoney / Tencent',
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

      'market.US': 'US',
      'market.CN': 'China A',
      'market.HK': 'Hong Kong',
      'market.JP': 'Japan',
      'market.KR': 'Korea',
      'market.TW': 'Taiwan',
      'market.EU': 'Europe',

      'index.name': 'Indices'
    },

    zh: {
      'nav.home': '首页',
      'nav.rankings': '选股榜',
      'nav.products': '产品',
      'nav.research': '研究',
      'nav.technology': '技术',
      'nav.about': '关于',
      'nav.contact': '联系',
      'lang.label': 'EN',

      'page.title': '全球估值榜单',
      'page.subtitle': '基于 Yahoo Finance 实时数据，对全球行业龙头进行多因子筛选打分',

      'freshness.loading': '正在加载市场数据…',
      'freshness.done': '数据加载完成',
      'freshness.updated': '更新时间',
      'freshness.completed': '已完成',
      'freshness.failed': '失败',
      'freshness.retry-failed': '重试失败项',
      'freshness.refresh': '全部刷新',

      'watch.filter': '只看我的关注',
      'watch.empty': '还没有收藏，点击股票旁的星标即可添加。',

      'model.label': '评分模型',
      'model.multifactor': '专业多因子',
      'model.deepvalue': '深度价值',
      'model.peg': 'PEG 成长',

      'top20.title': '估值得分 Top 20',
      'top20.subtitle': '按同行业内的便宜程度排名',
      'top10.title': '性价比 Top 10',
      'top10.subtitle': '便宜价格叠加优秀质量与成长',

      'col.rank': '#',
      'col.company': '公司',
      'col.market': '市场',
      'col.sector': '行业',
      'col.valuation': '估值得分',
      'col.composite': '综合得分',
      'col.pe': '市盈率',
      'col.pb': '市净率',
      'col.dividend': '股息率',

      'score.valuation': '估值',
      'score.quality': '质量',
      'score.growth': '成长',

      'dist.title': '便宜股票集中在哪里',
      'dist.by-sector': '按行业',
      'dist.by-market': '按市场',
      'dist.count': '只股票',

      'insufficient.title': '数据不足',
      'insufficient.desc': '以下股票仅获取到价格或请求失败，不参与本次排名。',
      'insufficient.retry': '重试',

      'method.title': '评分原理',
      'method.p1': '所有估值指标先在同类公司中转换为百分位排名。专业多因子与 PEG 模型按同行业分组，因此银行不会与科技股直接比较市盈率；深度价值则在全市场范围内排名。',
      'method.p2': '专业多因子的估值得分综合行业相对市盈率、预期市盈率、市净率、市销率、EV/EBITDA 与股息率，再叠加质量分（ROE、自由现金流收益率、净利率）与成长分（盈利与营收增速），高负债最多扣 10 分。',
      'method.p3': '深度价值遵循格雷厄姆传统：以低市盈率、低市净率和高股息率为主，辅以轻度财务健康过滤，以规避明显的价值陷阱。',
      'method.p4': 'PEG 遵循彼得·林奇法则——相对盈利增速的便宜程度。PEG 占估值权重一半，配合预期市盈率、市销率与 EV/EBITDA，成长在综合分中占比最高。',
      'method.p5': '缺失指标会按可得权重重新归一化；可用估值指标少于两个的股票将被移入数据不足列表。',
      'method.p6': '数据来源：Yahoo Finance（主）、东方财富与腾讯财经（备用），在浏览器内缓存 30 分钟。Yahoo 不可达时，股票按备用快照评分（仅 PE/PB/PS/市值，PE 可能为静态口径）。仅供研究参考，不构成投资建议。',

      'drawer.metrics': '核心指标',
      'drawer.trend': '近 3 个月走势',
      'drawer.open-yahoo': '在 Yahoo 查看',
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
      'source.fallback': '东方财富 / 腾讯财经',
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

      'market.US': '美股',
      'market.CN': 'A股',
      'market.HK': '港股',
      'market.JP': '日本',
      'market.KR': '韩国',
      'market.TW': '台湾',
      'market.EU': '欧洲',

      'index.name': '指数'
    }
  };

  var lang = localStorage.getItem('sern-lang');
  if (!lang) {
    lang = (navigator.language || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  }
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
