(function () {
  'use strict';

  window.SERN = window.SERN || {};
  var i18n = window.SERN.i18n;
  var yahoo = window.SERN.yahoo;
  var scoring = window.SERN.scoring;

  // ==================== Configuration ====================
  var INDEX_SYMBOLS = ['^GSPC', '^IXIC', '^HSI', '000300.SS', '^N225'];
  var INDEX_NAMES = {
    '^GSPC': { en: 'S&P 500', zh: '标普500' },
    '^IXIC': { en: 'Nasdaq', zh: '纳指' },
    '^HSI': { en: 'Hang Seng', zh: '恒生指数' },
    '000300.SS': { en: 'CSI 300', zh: '沪深300' },
    '^N225': { en: 'Nikkei 225', zh: '日经225' }
  };
  var SECTOR_COLORS = ['#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316',
    '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#84cc16', '#f43f5e'];
  var MARKET_COLORS = { US: '#3b82f6', CN: '#ef4444', HK: '#f97316', JP: '#22c55e', KR: '#06b6d4', TW: '#eab308', EU: '#a855f7' };

  // ==================== State ====================
  var state = {
    model: localStorage.getItem('sern-model') || 'multifactor',
    entries: [],
    done: 0,
    failed: 0,
    loading: true,
    watchOnly: false,
    scores: null,
    updatedAt: null,
    drawerSymbol: null
  };

  function getWatchlist() {
    try { return JSON.parse(localStorage.getItem('sern-watchlist') || '[]'); }
    catch (e) { return []; }
  }
  function setWatchlist(list) {
    localStorage.setItem('sern-watchlist', JSON.stringify(list));
  }
  function isWatched(symbol) {
    return getWatchlist().indexOf(symbol) !== -1;
  }
  function toggleWatch(symbol) {
    var list = getWatchlist();
    var i = list.indexOf(symbol);
    if (i === -1) list.push(symbol); else list.splice(i, 1);
    setWatchlist(list);
  }

  // ==================== Formatting ====================
  function t(key) { return i18n.t(key); }
  function langName(name) {
    var lang = i18n.getLang();
    return name[lang] || name.en;
  }
  function fmt(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return t('common.na');
    return Number(value).toFixed(digits === undefined ? 2 : digits);
  }
  function fmtPct(fraction, digits) {
    if (fraction === null || fraction === undefined || !isFinite(fraction)) return t('common.na');
    return (fraction * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }
  function fmtMarketCap(value, currency) {
    if (!value) return t('common.na');
    var symbols = { USD: '$', CNY: '¥', HKD: 'HK$', JPY: '¥', KRW: '₩', TWD: 'NT$', EUR: '€' };
    var sym = symbols[currency] || '';
    if (value >= 1e12) return sym + (value / 1e12).toFixed(2) + 'T';
    if (value >= 1e9) return sym + (value / 1e9).toFixed(1) + 'B';
    if (value >= 1e6) return sym + (value / 1e6).toFixed(0) + 'M';
    return sym + value.toFixed(0);
  }
  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Scoring lives in js/scoring.js (window.SERN.scoring) — pure functions,
  // shared by this page and verifiable outside the DOM.

  // ==================== Rendering helpers ====================
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function starSvg(filled) {
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z');
    path.setAttribute('fill', filled ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    return svg;
  }

  // ==================== Ticker bar ====================
  function initTicker() {
    var wrap = document.getElementById('index-ticker');
    INDEX_SYMBOLS.forEach(function (symbol) {
      var item = el('div', 'ticker-item');
      var name = el('span', 'ticker-name', INDEX_NAMES[symbol][i18n.getLang() === 'zh' ? 'zh' : 'en']);
      var value = el('span', 'ticker-value', '…');
      item.appendChild(name);
      item.appendChild(value);
      wrap.appendChild(item);
      yahoo.getChart(symbol).then(function (chart) {
        value.textContent = fmtPct(chart.changePct, 2);
        value.classList.add(chart.changePct >= 0 ? 'up' : 'down');
      }).catch(function () {
        value.textContent = t('common.na');
        value.classList.add('ticker-na');
      });
    });
  }

  // ==================== Freshness / progress ====================
  function updateFreshness() {
    // counters are always derived from entry statuses, never incremented by
    // callers — retries and overlapping reloads cannot double-count
    state.done = state.entries.filter(function (e) { return e.status === 'done'; }).length;
    state.failed = state.entries.filter(function (e) { return e.status === 'failed'; }).length;
    var bar = document.getElementById('progress-bar');
    var label = document.getElementById('progress-label');
    var total = state.entries.length;
    var finished = state.done + state.failed;
    bar.style.width = (total ? finished / total * 100 : 0) + '%';
    if (state.loading) {
      label.textContent = t('freshness.loading') + ' ' + finished + '/' + total +
        ' · ' + t('freshness.failed') + ' ' + state.failed;
    } else {
      label.textContent = t('freshness.done') + ' · ' + t('freshness.completed') + ' ' + state.done +
        '/' + total + ' · ' + t('freshness.failed') + ' ' + state.failed +
        (state.updatedAt ? ' · ' + t('freshness.updated') + ' ' + fmtTime(state.updatedAt) : '');
    }
  }

  // ==================== Rows ====================
  function marketTag(market) {
    var tag = el('span', 'market-tag market-' + market.toLowerCase(), t('market.' + market));
    return tag;
  }

  function scoreCell(value) {
    var cell = el('div', 'rank-score');
    var num = el('span', 'rank-score-num', value === null ? t('common.na') : fmt(value, 1));
    cell.appendChild(num);
    return cell;
  }

  function buildRow(entry, rank) {
    var d = entry.data;
    var row = el('div', 'rank-row');
    row.dataset.symbol = entry.meta.symbol;

    row.appendChild(el('div', 'rank-num', rank));

    var company = el('div', 'rank-company');
    var nameLine = el('div', 'rank-company-name', langName(entry.meta.name));
    var symbolLine = el('div', 'rank-company-symbol', entry.meta.symbol);
    company.appendChild(nameLine);
    company.appendChild(symbolLine);
    row.appendChild(company);

    var tags = el('div', 'rank-tags');
    tags.appendChild(marketTag(entry.meta.market));
    var sectorTag = el('span', 'sector-tag', t('sector.' + entry.meta.sector));
    tags.appendChild(sectorTag);
    row.appendChild(tags);

    var metrics = el('div', 'rank-metrics');
    metrics.appendChild(el('span', 'rank-metric', fmt(d.pe, 1)));
    metrics.appendChild(el('span', 'rank-metric', fmt(d.pb, 1)));
    metrics.appendChild(el('span', 'rank-metric', fmtPct(d.divYield, 2)));
    row.appendChild(metrics);

    row.appendChild(scoreCell(entry.scores.valuation));
    var compositeCell = scoreCell(entry.scores.composite);
    compositeCell.classList.add('rank-score-composite');
    row.appendChild(compositeCell);

    var actions = el('div', 'rank-actions');
    var star = el('button', 'star-btn' + (isWatched(entry.meta.symbol) ? ' starred' : ''));
    star.setAttribute('aria-label', 'watch');
    star.appendChild(starSvg(isWatched(entry.meta.symbol)));
    star.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleWatch(entry.meta.symbol);
      star.classList.toggle('starred');
      star.textContent = '';
      star.appendChild(starSvg(isWatched(entry.meta.symbol)));
      if (state.watchOnly) renderBoards();
    });
    actions.appendChild(star);
    row.appendChild(actions);

    row.addEventListener('click', function () { openDrawer(entry.meta.symbol); });
    return row;
  }

  function headerRow(extra) {
    var head = el('div', 'rank-row rank-head');
    head.appendChild(el('div', 'rank-num', t('col.rank')));
    head.appendChild(el('div', 'rank-company', t('col.company')));
    head.appendChild(el('div', 'rank-tags'));
    var metricHead = el('div', 'rank-metrics rank-metrics-head');
    metricHead.appendChild(el('span', '', t('col.pe')));
    metricHead.appendChild(el('span', '', t('col.pb')));
    metricHead.appendChild(el('span', '', t('col.dividend')));
    head.appendChild(metricHead);
    head.appendChild(el('div', 'rank-score', t('col.valuation')));
    if (extra) head.appendChild(el('div', 'rank-score rank-score-composite', t('col.composite')));
    head.appendChild(el('div', 'rank-actions'));
    return head;
  }

  function miniBars(scores) {
    var wrap = el('div', 'mini-bars');
    [['valuation', scores.valuation], ['quality', scores.quality], ['growth', scores.growth]].forEach(function (pair) {
      var col = el('div', 'mini-bar-col');
      var track = el('div', 'mini-bar-track');
      var fill = el('div', 'mini-bar-fill mini-bar-' + pair[0]);
      fill.style.width = (pair[1] === null ? 0 : pair[1]) + '%';
      track.appendChild(fill);
      col.appendChild(el('span', 'mini-bar-label', t('score.' + pair[0])));
      col.appendChild(track);
      wrap.appendChild(col);
    });
    return wrap;
  }

  function buildValueCard(entry, rank) {
    var card = el('div', 'value-card');
    card.addEventListener('click', function () { openDrawer(entry.meta.symbol); });

    var top = el('div', 'value-card-top');
    var rankBadge = el('span', 'value-rank', '#' + rank);
    var nameWrap = el('div', 'value-card-name-wrap');
    nameWrap.appendChild(el('span', 'value-card-name', langName(entry.meta.name)));
    var sub = el('span', 'value-card-sub', entry.meta.symbol);
    sub.appendChild(document.createTextNode(' · ' + t('market.' + entry.meta.market)));
    nameWrap.appendChild(sub);
    var score = el('span', 'value-score', fmt(entry.scores.composite, 1));
    top.appendChild(rankBadge);
    top.appendChild(nameWrap);
    top.appendChild(score);
    card.appendChild(top);
    card.appendChild(miniBars(entry.scores));
    return card;
  }

  // ==================== Boards ====================
  function visibleRanked() {
    var list = state.scores.slice().sort(function (a, b) {
      return b.scores.valuation - a.scores.valuation;
    });
    if (state.watchOnly) {
      list = list.filter(function (e) { return isWatched(e.meta.symbol); });
    }
    return list;
  }

  function renderBoards() {
    var ranked = visibleRanked();

    // Top 20
    var top20 = document.getElementById('top20-body');
    top20.innerHTML = '';
    if (state.scores.length === 0) {
      top20.appendChild(el('div', 'board-placeholder', t('freshness.loading')));
    } else if (ranked.length === 0) {
      top20.appendChild(el('div', 'board-placeholder', t('watch.empty')));
    } else {
      top20.appendChild(headerRow(true));
      ranked.slice(0, 20).forEach(function (entry, i) {
        top20.appendChild(buildRow(entry, i + 1));
      });
    }

    // Top 10
    var comp = state.scores.slice().sort(function (a, b) {
      return b.scores.composite - a.scores.composite;
    });
    if (state.watchOnly) comp = comp.filter(function (e) { return isWatched(e.meta.symbol); });
    var top10 = document.getElementById('top10-body');
    top10.innerHTML = '';
    if (ranked.length === 0 && state.scores.length > 0) {
      top10.appendChild(el('div', 'board-placeholder', t('watch.empty')));
    } else {
      comp.slice(0, 10).forEach(function (entry, i) {
        top10.appendChild(buildValueCard(entry, i + 1));
      });
    }

    renderDistribution(ranked.slice(0, 20));
  }

  // ==================== Donut charts ====================
  function drawDonut(canvasId, counts, colorMap) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var size = canvas.clientWidth || 180;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var entries = Object.keys(counts).filter(function (k) { return counts[k] > 0; });
    var total = entries.reduce(function (s, k) { return s + counts[k]; }, 0);
    var cx = size / 2, cy = size / 2, r = size * 0.38, ir = size * 0.24;

    if (!total) {
      ctx.clearRect(0, 0, size, size);
      return;
    }
    var start = -Math.PI / 2;
    entries.forEach(function (key, i) {
      var frac = counts[key] / total;
      var end = start + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = colorMap[key] || SECTOR_COLORS[i % SECTOR_COLORS.length];
      ctx.fill();
      start = end;
    });
    // inner hole
    ctx.beginPath();
    ctx.arc(cx, cy, ir, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3, 7, 18, 1)';
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(total), cx, cy - 6);
    ctx.font = '400 10px Inter, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(t('dist.count'), cx, cy + 12);
  }

  function renderLegend(containerId, counts, colorMap, labelPrefix) {
    var box = document.getElementById(containerId);
    box.innerHTML = '';
    Object.keys(counts).filter(function (k) { return counts[k] > 0; }).forEach(function (key, i) {
      var row = el('div', 'legend-row');
      var dot = el('span', 'legend-dot');
      dot.style.background = colorMap[key] || SECTOR_COLORS[i % SECTOR_COLORS.length];
      row.appendChild(dot);
      var label = labelPrefix ? t(labelPrefix + key) : key;
      row.appendChild(el('span', 'legend-label', label));
      row.appendChild(el('span', 'legend-count', String(counts[key])));
      box.appendChild(row);
    });
  }

  var sectorColorMap = {};
  function renderDistribution(topList) {
    var sectorCounts = {}, marketCounts = {};
    topList.forEach(function (e) {
      sectorCounts[e.meta.sector] = (sectorCounts[e.meta.sector] || 0) + 1;
      marketCounts[e.meta.market] = (marketCounts[e.meta.market] || 0) + 1;
    });
    Object.keys(sectorColorMap).length = 0;
    var i = 0;
    Object.keys(sectorCounts).forEach(function (s) {
      sectorColorMap[s] = SECTOR_COLORS[i % SECTOR_COLORS.length];
      i++;
    });
    drawDonut('donut-sector', sectorCounts, sectorColorMap);
    drawDonut('donut-market', marketCounts, MARKET_COLORS);
    renderLegend('sector-legend', sectorCounts, sectorColorMap, 'sector.');
    renderLegend('market-legend', marketCounts, MARKET_COLORS, 'market.');
  }

  // ==================== Insufficient list ====================
  function renderInsufficient() {
    var box = document.getElementById('insufficient-list');
    box.innerHTML = '';
    var items = state.entries.filter(function (e) {
      return e.status === 'done' && e.data && e.data.insufficient;
    });
    var failed = state.entries.filter(function (e) { return e.status === 'failed'; });
    // spec §4.3: fewer than two usable valuation metrics under the current
    // model -> excluded from ranking, listed here instead of vanishing
    var excluded = state.entries.filter(function (e) {
      return e.status === 'done' && e.data && !e.data.insufficient && !e.scores;
    });
    var all = items.concat(failed, excluded);
    var section = document.getElementById('insufficient-section');
    section.style.display = all.length ? '' : 'none';
    all.forEach(function (entry) {
      var row = el('div', 'insufficient-row');
      row.appendChild(el('span', 'insufficient-name', langName(entry.meta.name)));
      row.appendChild(el('span', 'insufficient-symbol', entry.meta.symbol));
      var btn = el('button', 'insufficient-retry', t('insufficient.retry'));
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        btn.textContent = '…';
        retryEntry(entry).then(function () { refreshAllViews(); });
      });
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  // ==================== Drawer ====================
  function metricBox(label, value) {
    var box = el('div', 'metric-box');
    box.appendChild(el('div', 'metric-box-label', label));
    box.appendChild(el('div', 'metric-box-value', value));
    return box;
  }

  function drawSpark(canvas, points) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!points || points.length < 2) return;

    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var range = max - min || 1;
    var up = points[points.length - 1] >= points[0];
    var color = up ? '#22c55e' : '#ef4444';

    var xy = points.map(function (p, i) {
      return [i / (points.length - 1) * w, h - 8 - (p - min) / range * (h - 16)];
    });

    ctx.beginPath();
    xy.forEach(function (pt, i) { i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]); });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop('0', color + '33');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function scoreBreakBar(label, value, cls) {
    var col = el('div', 'score-break-col');
    var head = el('div', 'score-break-head');
    head.appendChild(el('span', '', label));
    head.appendChild(el('span', '', value === null ? t('common.na') : fmt(value, 1)));
    col.appendChild(head);
    var track = el('div', 'mini-bar-track');
    var fill = el('div', 'mini-bar-fill ' + cls);
    fill.style.width = (value === null ? 0 : value) + '%';
    track.appendChild(fill);
    col.appendChild(track);
    return col;
  }

  function openDrawer(symbol) {
    var entry = state.entries.filter(function (e) { return e.meta.symbol === symbol; })[0];
    if (!entry || !entry.data) return;
    state.drawerSymbol = symbol;
    var d = entry.data;
    var drawer = document.getElementById('drawer');
    document.getElementById('drawer-overlay').classList.add('active');
    drawer.classList.add('open');

    document.getElementById('drawer-title').textContent = langName(entry.meta.name);
    document.getElementById('drawer-sub').textContent = symbol +
      (d.price !== null && d.currency ? ' · ' + d.currency + ' ' + fmt(d.price, 2) : '');

    var breaks = document.getElementById('drawer-scores');
    breaks.innerHTML = '';
    if (entry.scores) {
      breaks.appendChild(scoreBreakBar(t('score.valuation'), entry.scores.valuation, 'mini-bar-valuation'));
      breaks.appendChild(scoreBreakBar(t('score.quality'), entry.scores.quality, 'mini-bar-quality'));
      breaks.appendChild(scoreBreakBar(t('score.growth'), entry.scores.growth, 'mini-bar-growth'));
    }

    var metrics = document.getElementById('drawer-metrics');
    metrics.innerHTML = '';
    var rows = [
      ['drawer.pe', fmt(d.pe, 2)], ['drawer.fpe', fmt(d.forwardPe, 2)],
      ['drawer.pb', fmt(d.pb, 2)], ['drawer.ps', fmt(d.ps, 2)],
      ['drawer.evebitda', fmt(d.evEbitda, 2)], ['drawer.peg', fmt(d.peg, 2)],
      ['drawer.dividend', fmtPct(d.divYield, 2)], ['drawer.roe', fmtPct(d.roe, 2)],
      ['drawer.margin', fmtPct(d.margin, 2)],
      ['drawer.fcf', fmtMarketCap(d.fcf, d.currency)],
      ['drawer.earnings-growth', fmtPct(d.earningsGrowth, 1)],
      ['drawer.revenue-growth', fmtPct(d.revenueGrowth, 1)],
      ['drawer.debt', d.debtToEquity === null ? t('common.na') : fmt(d.debtToEquity, 1)],
      ['drawer.marketcap', fmtMarketCap(d.marketCap, d.currency)],
      ['drawer.currency', d.currency || t('common.na')],
      ['drawer.source', t('source.' + (d.source || 'yahoo'))]
    ];
    rows.forEach(function (r) { metrics.appendChild(metricBox(t(r[0]), r[1])); });

    var canvas = document.getElementById('drawer-spark');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    yahoo.getSpark(symbol).then(function (spark) {
      if (state.drawerSymbol === symbol) drawSpark(canvas, spark.points);
    }).catch(function () {});

    document.getElementById('drawer-yahoo').href =
      'https://finance.yahoo.com/quote/' + encodeURIComponent(symbol);
  }

  function closeDrawer() {
    state.drawerSymbol = null;
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('active');
  }

  // ==================== Data loading ====================
  function runQueue(tasks, concurrency, onSettled) {
    var index = 0;
    function worker() {
      if (index >= tasks.length) return Promise.resolve();
      var task = tasks[index++];
      return task().then(function (r) {
        onSettled(null, r);
        return worker();
      }).catch(function (err) {
        onSettled(err);
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < concurrency; i++) workers.push(worker());
    return Promise.all(workers);
  }

  function loadEntry(entry) {
    entry.status = 'loading';
    return yahoo.getQuote(entry.meta.symbol).then(function (data) {
      entry.data = data;
      entry.status = 'done';
      return entry;
    }).catch(function (err) {
      entry.status = 'failed';
      entry.error = err;
      throw err;
    });
  }

  function retryEntry(entry) {
    return yahoo.refreshQuote(entry.meta.symbol).then(function (data) {
      entry.data = data;
      entry.status = 'done';
      entry.error = null;
    }).catch(function (err) {
      entry.status = 'failed';
      entry.error = err;
    });
  }

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      refreshAllViews();
    });
  }

  function refreshAllViews() {
    state.scores = scoring.computeScores(state.entries, state.model);
    updateFreshness();
    renderBoards();
    renderInsufficient();
  }

  function startLoading() {
    state.entries = window.SERN.universe.map(function (meta) {
      return { meta: meta, status: 'pending', data: null, scores: null };
    });
    state.done = 0;
    state.failed = 0;
    state.loading = true;

    var tasks = state.entries.map(function (entry) {
      return function () { return loadEntry(entry); };
    });

    runQueue(tasks, 5, function () {
      state.updatedAt = Date.now();
      updateFreshness();
      scheduleRender();
    }).then(function () {
      state.loading = false;
      state.updatedAt = Date.now();
      updateFreshness();
      refreshAllViews();
    });

    updateFreshness();
  }

  // ==================== Controls ====================
  function initControls() {
    // segmented model switch
    var seg = document.getElementById('model-seg');
    seg.querySelectorAll('button').forEach(function (btn) {
      if (btn.dataset.model === state.model) btn.classList.add('active');
      btn.addEventListener('click', function () {
        state.model = btn.dataset.model;
        localStorage.setItem('sern-model', state.model);
        seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        refreshAllViews();
      });
    });

    // watchlist filter
    var filter = document.getElementById('watch-filter');
    filter.checked = state.watchOnly;
    filter.addEventListener('change', function () {
      state.watchOnly = filter.checked;
      renderBoards();
    });

    // retry failed
    document.getElementById('retry-btn').addEventListener('click', function () {
      var targets = state.entries.filter(function (e) {
        return e.status === 'failed' || (e.data && e.data.insufficient);
      });
      Promise.all(targets.map(retryEntry)).then(refreshAllViews);
    });

    // refresh all: clear caches then reload
    document.getElementById('refresh-btn').addEventListener('click', function () {
      try {
        Object.keys(sessionStorage).forEach(function (k) {
          if (k.indexOf('sern-') === 0) sessionStorage.removeItem(k);
        });
      } catch (e) {}
      startLoading();
    });

    // language toggle
    var langBtn = document.getElementById('lang-toggle');
    langBtn.textContent = t('lang.label');
    langBtn.addEventListener('click', function () {
      i18n.toggle();
    });

    // methodology collapse
    var methodHead = document.getElementById('method-head');
    methodHead.addEventListener('click', function () {
      document.getElementById('method-body').classList.toggle('open');
      methodHead.classList.toggle('collapsed');
    });

    // drawer close
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    window.addEventListener('resize', function () {
      if (state.scores) renderDistribution(visibleRanked().slice(0, 20));
    });
  }

  // ==================== Init ====================
  function init() {
    i18n.applyStatic();
    document.title = 'SERN FinTech - ' + t('page.title');
    initControls();
    initTicker();
    startLoading();

    i18n.onChange(function () {
      i18n.applyStatic();
      document.title = 'SERN FinTech - ' + t('page.title');
      document.getElementById('lang-toggle').textContent = t('lang.label');
      // ticker names
      var nodes = document.getElementById('index-ticker').querySelectorAll('.ticker-name');
      INDEX_SYMBOLS.forEach(function (s, i) {
        if (nodes[i]) nodes[i].textContent = INDEX_NAMES[s][i18n.getLang() === 'zh' ? 'zh' : 'en'];
      });
      refreshAllViews();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
