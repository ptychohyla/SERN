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
    loading: true,
    scores: null,
    drawerSymbol: null,
    drawerEntry: null
  };

  // ==================== Favorites ====================
  // Starred stocks are forced into the heatmap and the ranking board, marked
  // with a ★. Storefront metadata is persisted so off-universe picks (from
  // search) survive reloads; they join a dedicated "favorites" sector bucket.
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem('sern-favorites') || '[]'); }
    catch (e) { return []; }
  }
  function setFavorites(list) {
    localStorage.setItem('sern-favorites', JSON.stringify(list));
  }
  function isFavorite(symbol) {
    var favs = getFavorites();
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].symbol === symbol) return true;
    }
    return false;
  }
  function universeMeta(symbol) {
    var u = window.SERN.universe || [];
    for (var i = 0; i < u.length; i++) {
      if (u[i].symbol === symbol) return u[i];
    }
    return null;
  }
  function favoriteMeta(symbol) {
    // pool stocks keep their real sector; off-pool picks live in one bucket
    var meta = universeMeta(symbol);
    if (meta) return meta;
    var favs = getFavorites();
    for (var i = 0; i < favs.length; i++) {
      if (favs[i].symbol === symbol) {
        return {
          symbol: symbol,
          name: favs[i].name || { en: symbol, zh: symbol },
          market: favs[i].market || null,
          sector: 'favorites'
        };
      }
    }
    return null;
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
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z');
    path.setAttribute('fill', filled ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    return svg;
  }

  // ==================== Ticker bar ====================
  // Index chips: name / level / change on the left, a mini candlestick chart
  // on the right (style per the reference: red up / green down, CN
  // convention). Candles play in a loop — bars reveal one by one, the full
  // chart holds, then it replays — staggered per chip so the strip ripples.
  var KLINE_W = 84;
  var KLINE_H = 42;
  var KLINE_BARS = 26;        // ~一个月的交易日，实体宽度 ~2px 更清晰
  var KLINE_BAR_MS = 34;      // per-bar reveal step
  var KLINE_HOLD_MS = 1500;   // full-chart hold before the next replay
  var KLINE_STAGGER_MS = 420; // per-chip start offset
  var KLINE_RED = '#ef4444';  // --accent-red (canvas cannot read CSS vars)
  var KLINE_GREEN = '#22c55e';

  function fmtIndex(v) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function startTickerKline(canvas, candles, idx) {
    var DPR = window.devicePixelRatio || 1;
    canvas.width = KLINE_W * DPR;
    canvas.height = KLINE_H * DPR;
    var ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    var data = candles.slice(-KLINE_BARS);
    var n = data.length;
    var min = Infinity;
    var max = -Infinity;
    data.forEach(function (c) {
      if (c.l < min) min = c.l;
      if (c.h > max) max = c.h;
    });
    var range = (max - min) || 1;
    var padY = 2;
    var padX = 1;
    var slot = (KLINE_W - padX * 2) / n;
    var bodyW = Math.max(1, Math.floor(slot * 0.62));

    function yOf(v) { return padY + (max - v) / range * (KLINE_H - padY * 2); }

    function draw(shown) {
      ctx.clearRect(0, 0, KLINE_W, KLINE_H);
      for (var i = 0; i < shown; i++) {
        var c = data[i];
        var x = Math.round(padX + i * slot + slot / 2) + 0.5;
        var color = c.c >= c.o ? KLINE_RED : KLINE_GREEN;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        // wick
        ctx.beginPath();
        ctx.moveTo(x, yOf(c.h));
        ctx.lineTo(x, yOf(c.l));
        ctx.stroke();
        // body (1px minimum so doji bars stay visible)
        var top = yOf(Math.max(c.o, c.c));
        var bottom = yOf(Math.min(c.o, c.c));
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), bodyW,
          Math.max(1, Math.round(bottom - top)));
      }
    }

    var reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { draw(n); return; }

    var startAt = performance.now() + idx * KLINE_STAGGER_MS;
    var cycle = n * KLINE_BAR_MS + KLINE_HOLD_MS;
    var shownBars = -1;
    function loop() {
      if (!document.hidden) {
        var t = performance.now() - startAt;
        var elapsed = t < 0 ? 0 : t % cycle;
        var cur = Math.min(n, Math.ceil(elapsed / KLINE_BAR_MS));
        if (cur !== shownBars) {
          draw(cur);
          shownBars = cur;
        }
      }
      requestAnimationFrame(loop);
    }
    draw(0);
    requestAnimationFrame(loop);
  }

  function initTicker() {
    var strip = document.getElementById('index-ticker');
    var track = el('div', 'ticker-track');
    strip.appendChild(track);

    INDEX_SYMBOLS.forEach(function (symbol, idx) {
      var item = el('div', 'ticker-item');
      item.dataset.symbol = symbol;
      var info = el('div', 'ticker-info');
      var name = el('span', 'ticker-name', INDEX_NAMES[symbol][i18n.getLang() === 'zh' ? 'zh' : 'en']);
      var price = el('span', 'ticker-price', '…');
      var value = el('span', 'ticker-value', '…');
      info.appendChild(name);
      info.appendChild(price);
      info.appendChild(value);
      item.appendChild(info);
      item.appendChild(el('canvas', 'ticker-kline'));
      track.appendChild(item);
    });

    // Seamless marquee: duplicate the card set until one full set's width is
    // covered after the track shifts by exactly that set width, then let CSS
    // translate the track and wrap. Copies are aria-hidden decoration.
    var setW = track.scrollWidth;
    if (setW > 0) {
      // +2 sets of slack: covers ultra-wide windows and post-measure font
      // metric shifts without ever re-measuring
      var copies = Math.max(1, Math.ceil(strip.clientWidth / setW)) + 2;
      for (var c = 1; c < copies; c++) {
        Array.prototype.slice.call(track.children).slice(0, INDEX_SYMBOLS.length).forEach(function (node) {
          var clone = node.cloneNode(true);
          clone.setAttribute('aria-hidden', 'true');
          track.appendChild(clone);
        });
      }
      track.style.setProperty('--ticker-distance', setW + 'px');
      track.style.setProperty('--ticker-duration', (setW / 45).toFixed(1) + 's');
    }

    // One fetch per index, fanned out to every copy (clones share no state).
    INDEX_SYMBOLS.forEach(function (symbol, idx) {
      yahoo.getChart(symbol).then(function (chart) {
        track.querySelectorAll('[data-symbol="' + symbol + '"]').forEach(function (item) {
          item.querySelector('.ticker-price').textContent = fmtIndex(chart.price);
          var value = item.querySelector('.ticker-value');
          value.textContent = fmtPct(chart.changePct, 2);
          value.classList.add(chart.changePct >= 0 ? 'up' : 'down');
        });
      }).catch(function () {
        track.querySelectorAll('[data-symbol="' + symbol + '"]').forEach(function (item) {
          item.querySelector('.ticker-price').textContent = '';
          var value = item.querySelector('.ticker-value');
          value.textContent = t('common.na');
          value.classList.add('ticker-na');
        });
      });

      yahoo.getCandles(symbol).then(function (res) {
        track.querySelectorAll('[data-symbol="' + symbol + '"] canvas').forEach(function (canvas) {
          // same idx for every copy so the marquee shows one coherent replay
          startTickerKline(canvas, res.candles, idx);
        });
      }).catch(function () {
        track.querySelectorAll('[data-symbol="' + symbol + '"] canvas').forEach(function (canvas) {
          canvas.style.display = 'none'; // no candle data: keep the text-only chip
        });
      });
    });
  }

  // ==================== Freshness / progress ====================
  function updateFreshness() {
    // the refresh icon's spin is the only loading indicator left
    document.getElementById('refresh-btn').classList.toggle('is-loading', state.loading);
  }

  // Manual refresh dims the data sections until the reload settles
  function setRefreshing(on) {
    var main = document.querySelector('.markets-main');
    if (main) main.classList.toggle('refreshing', !!on);
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
    var nameLine = el('div', 'rank-company-name');
    if (isFavorite(entry.meta.symbol)) nameLine.appendChild(el('span', 'rank-fav', '★'));
    nameLine.appendChild(document.createTextNode(langName(entry.meta.name)));
    var symbolLine = el('div', 'rank-company-symbol', entry.meta.symbol);
    company.appendChild(nameLine);
    company.appendChild(symbolLine);
    row.appendChild(company);

    var tags = el('div', 'rank-tags');
    if (entry.meta.market) tags.appendChild(marketTag(entry.meta.market));
    var sectorTag = el('span', 'sector-tag', t('sector.' + entry.meta.sector));
    tags.appendChild(sectorTag);
    row.appendChild(tags);

    var metrics = el('div', 'rank-metrics');
    metrics.appendChild(el('span', 'rank-metric', fmt(d.pe, 1)));
    metrics.appendChild(el('span', 'rank-metric', fmt(d.pb, 1)));
    metrics.appendChild(el('span', 'rank-metric', fmtPct(d.divYield, 2)));
    row.appendChild(metrics);

    row.appendChild(scoreCell(entry.scores.composite));

    row.addEventListener('click', function () { openDrawer(entry.meta.symbol); });
    return row;
  }

  function headerRow() {
    var head = el('div', 'rank-row rank-head');
    head.appendChild(el('div', 'rank-num', t('col.rank')));
    head.appendChild(el('div', 'rank-company', t('col.company')));
    head.appendChild(el('div', 'rank-tags'));
    var metricHead = el('div', 'rank-metrics rank-metrics-head');
    metricHead.appendChild(el('span', '', t('col.pe')));
    metricHead.appendChild(el('span', '', t('col.pb')));
    metricHead.appendChild(el('span', '', t('col.dividend')));
    head.appendChild(metricHead);
    head.appendChild(el('div', 'rank-score', t('col.score')));
    return head;
  }

  // ==================== Boards ====================
  // One ranking, ordered by the composite score of the currently selected
  // model — switching Multi-Factor / Deep Value / PEG Growth re-weights and
  // re-orders this board (and the donuts it feeds).
  function visibleRanked() {
    return state.scores.slice().sort(function (a, b) {
      return b.scores.composite - a.scores.composite;
    });
  }

  function renderBoards() {
    var ranked = visibleRanked();

    var top20 = document.getElementById('top20-body');
    top20.innerHTML = '';
    if (state.scores.length === 0) {
      top20.appendChild(el('div', 'board-placeholder', t('freshness.loading')));
    } else {
      top20.appendChild(headerRow());
      // starred stocks are pinned above the board with a ★, keeping their
      // true rank number; the regular Top 20 follows under a divider
      var pinned = ranked.filter(function (e) { return isFavorite(e.meta.symbol); });
      if (pinned.length) {
        pinned.forEach(function (entry) {
          top20.appendChild(buildRow(entry, ranked.indexOf(entry) + 1));
        });
        top20.appendChild(el('div', 'rank-divider', t('top20.title')));
      }
      ranked.slice(0, 20).forEach(function (entry, i) {
        top20.appendChild(buildRow(entry, i + 1));
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

  function scoreBreakBar(label, value, cls, tip) {
    var col = el('div', 'score-break-col');
    var head = el('div', 'score-break-head');
    var labelWrap = el('span', 'score-break-label');
    labelWrap.appendChild(document.createTextNode(label));
    if (tip) labelWrap.appendChild(el('span', 'score-break-help', '?'));
    head.appendChild(labelWrap);
    head.appendChild(el('span', '', value === null ? t('common.na') : fmt(value, 1)));
    col.appendChild(head);
    var track = el('div', 'mini-bar-track');
    var fill = el('div', 'mini-bar-fill ' + cls);
    fill.style.width = (value === null ? 0 : value) + '%';
    track.appendChild(fill);
    col.appendChild(track);
    if (tip) {
      col.setAttribute('title', tip);
      col.style.cursor = 'help';
    }
    return col;
  }

  // ---- score derivation tooltips ----
  // Weights come straight from SERN.scoring.models so the explanation can
  // never drift from the scoring code.
  var METRIC_LABEL_KEY = {
    pe: 'drawer.pe', forwardPe: 'drawer.fpe', pb: 'drawer.pb', ps: 'drawer.ps',
    evEbitda: 'drawer.evebitda', divYield: 'drawer.dividend', peg: 'drawer.peg',
    roe: 'drawer.roe', fcfYield: 'metric.fcf-yield', margin: 'drawer.margin',
    earningsGrowth: 'drawer.earnings-growth', revenueGrowth: 'drawer.revenue-growth'
  };
  function metricLabel(k) {
    return t(METRIC_LABEL_KEY[k] || k);
  }
  function valuationTip() {
    var cfg = window.SERN.scoring.models[state.model];
    var weights = Object.keys(cfg.valuation).map(function (k) {
      return metricLabel(k) + ' ' + cfg.valuation[k] + '%';
    }).join(' · ');
    return t('score.tip.valuation.' + (cfg.scope === 'sector' ? 'sector' : 'market')) + ' ' + weights;
  }
  function qualityTip() {
    return t('score.tip.quality') + ' ' +
      ['roe', 'fcfYield', 'margin'].map(metricLabel).join(' · ');
  }
  function growthTip() {
    return t('score.tip.growth') + ' ' +
      ['earningsGrowth', 'revenueGrowth'].map(metricLabel).join(' · ');
  }

  // ==================== Drawer ====================
  // renderDrawer drives both entries: pool rows (openDrawer) and off-universe
  // search results (openExternalDrawer). External entries arrive with
  // data=null (skeleton) and are filled asynchronously.
  function renderDrawerSub(entry) {
    var d = entry.data;
    var suffix = '';
    if (d && d.price !== null && d.currency) suffix = ' · ' + d.currency + ' ' + fmt(d.price, 2);
    else if (entry.external && !d) suffix = ' · ' + t('freshness.loading');
    document.getElementById('drawer-sub').textContent = entry.meta.symbol + suffix;
  }

  function renderDrawerMetrics(entry) {
    var metrics = document.getElementById('drawer-metrics');
    metrics.innerHTML = '';
    var d = entry.data;
    if (!d) {
      if (entry.external) {
        var loading = document.createElement('div');
        loading.className = 'drawer-note';
        loading.textContent = t('freshness.loading');
        metrics.appendChild(loading);
      }
      return;
    }
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
      ['drawer.source', (d.sources && d.sources.length ? d.sources : [d.source || 'yahoo'])
        .map(function (s) { return t('source.' + s); }).join(' + ')]
    ];
    rows.forEach(function (r) { metrics.appendChild(metricBox(t(r[0]), r[1])); });
  }

  function updateDrawerFav(entry) {
    var btn = document.getElementById('drawer-fav');
    var fav = isFavorite(entry.meta.symbol);
    btn.className = 'drawer-fav' + (fav ? ' starred' : '');
    btn.setAttribute('aria-label', t(fav ? 'favorites.remove' : 'favorites.add'));
    btn.setAttribute('title', t(fav ? 'favorites.remove' : 'favorites.add'));
    btn.innerHTML = '';
    btn.appendChild(starSvg(fav));
  }

  // Star/unstar the open stock. Favoriting guarantees the stock is loaded into
  // the pipeline (off-pool picks join a "favorites" bucket); unfavoriting an
  // off-pool pick drops its entry again.
  function toggleFavoriteEntry(entry) {
    var symbol = entry.meta.symbol;
    var favs = getFavorites();
    var idx = -1;
    favs.forEach(function (f, i) { if (f.symbol === symbol) idx = i; });

    if (idx === -1) {
      favs.push({
        symbol: symbol,
        name: entry.meta.name,
        market: entry.meta.market || null
      });
      setFavorites(favs);
      var inPipeline = state.entries.some(function (e) { return e.meta.symbol === symbol; });
      if (!inPipeline) {
        var meta = favoriteMeta(symbol);
        var added = {
          meta: meta,
          status: entry.data ? 'done' : 'pending',
          data: entry.data || null,
          scores: null,
          external: true
        };
        state.entries.push(added);
        if (added.status === 'pending') {
          // failure already marks the entry 'failed'; refresh either way
          loadEntry(added).then(refreshAllViews, refreshAllViews);
          scheduleRender();
          updateFreshness();
        }
      }
    } else {
      favs.splice(idx, 1);
      setFavorites(favs);
      // off-pool entries only exist because of the star — remove them
      state.entries = state.entries.filter(function (e) {
        return !(e.external && e.meta.symbol === symbol);
      });
    }
    updateDrawerFav(entry);
    refreshAllViews();
  }

  function renderDrawer(entry) {
    var symbol = entry.meta.symbol;
    state.drawerSymbol = symbol;
    state.drawerEntry = entry;
    var drawer = document.getElementById('drawer');
    document.getElementById('drawer-overlay').classList.add('active');
    drawer.classList.add('open');

    document.getElementById('drawer-title').textContent = langName(entry.meta.name);
    renderDrawerSub(entry);
    updateDrawerFav(entry);

    var breaks = document.getElementById('drawer-scores');
    breaks.innerHTML = '';
    if (entry.scores) {
      breaks.appendChild(scoreBreakBar(t('score.valuation'), entry.scores.valuation, 'mini-bar-valuation', valuationTip()));
      breaks.appendChild(scoreBreakBar(t('score.quality'), entry.scores.quality, 'mini-bar-quality', qualityTip()));
      breaks.appendChild(scoreBreakBar(t('score.growth'), entry.scores.growth, 'mini-bar-growth', growthTip()));
    }

    renderDrawerMetrics(entry);

    var canvas = document.getElementById('drawer-spark');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    yahoo.getSpark(symbol).then(function (spark) {
      if (state.drawerSymbol === symbol) drawSpark(canvas, spark.points);
    }).catch(function () {});

    document.getElementById('drawer-yahoo').href =
      'https://finance.yahoo.com/quote/' + encodeURIComponent(symbol);
  }

  function openDrawer(symbol) {
    var entry = state.entries.filter(function (e) { return e.meta.symbol === symbol; })[0];
    if (!entry || !entry.data) return;
    renderDrawer(entry);
  }

  function renderExternalFailure(entry) {
    var metrics = document.getElementById('drawer-metrics');
    metrics.innerHTML = '';
    var note = document.createElement('div');
    note.className = 'drawer-note';
    note.textContent = t('search.unavailable') + ' ';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'panel-btn';
    retry.textContent = t('insufficient.retry');
    retry.addEventListener('click', function () {
      var symbol = entry.meta.symbol;
      if (state.drawerSymbol !== symbol) return;
      entry.data = null;
      renderDrawerMetrics(entry); // back to the loading placeholder
      yahoo.refreshQuote(symbol).then(function (q) {
        if (state.drawerSymbol !== symbol) return;
        if (q && q.price !== null) {
          entry.data = q;
          renderDrawerSub(entry);
          renderDrawerMetrics(entry);
        } else {
          renderExternalFailure(entry);
        }
      }, function () {
        if (state.drawerSymbol === symbol) renderExternalFailure(entry);
      });
    });
    note.appendChild(retry);
    metrics.appendChild(note);
  }

  // Off-universe pick from search: open the drawer as a skeleton, then fill
  // metrics from the normal multi-source chain. scores stays null so the
  // scores section hides itself (no sector peers => no meaningful score).
  function openExternalDrawer(symbol, name) {
    var entry = {
      meta: { symbol: symbol, name: { en: name, zh: name }, market: null, sector: null },
      data: null,
      scores: null,
      external: true
    };
    renderDrawer(entry);
    yahoo.getQuote(symbol).then(function (q) {
      if (state.drawerSymbol !== symbol) return;
      if (q && q.price !== null) {
        entry.data = q;
        renderDrawerSub(entry);
        renderDrawerMetrics(entry);
      } else {
        renderExternalFailure(entry);
      }
    }, function () {
      if (state.drawerSymbol === symbol) renderExternalFailure(entry);
    });
  }

  function closeDrawer() {
    state.drawerSymbol = null;
    state.drawerEntry = null;
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

  function renderHeatmap() {
    if (!window.SERN.heatmap) return;
    window.SERN.heatmap.render(document.getElementById('heatmap-body'), {
      entries: state.entries,
      t: t,
      langName: langName,
      isFavorite: isFavorite,
      onSelect: openDrawer
    });
  }

  function refreshAllViews() {
    state.scores = scoring.computeScores(state.entries, state.model);
    updateFreshness();
    renderBoards();
    renderInsufficient();
    renderHeatmap();
  }

  function startLoading() {
    state.entries = window.SERN.universe.map(function (meta) {
      return { meta: meta, status: 'pending', data: null, scores: null };
    });
    // starred off-universe picks ride along: they are forced into the heatmap
    // and the ranking board (marked ★) alongside the regular universe
    getFavorites().forEach(function (f) {
      if (universeMeta(f.symbol)) return; // pool stock: already present
      state.entries.push({
        meta: favoriteMeta(f.symbol),
        status: 'pending',
        data: null,
        scores: null,
        external: true
      });
    });
    state.loading = true;
    state.loadStartedAt = Date.now();

    var tasks = state.entries.map(function (entry) {
      return function () { return loadEntry(entry); };
    });

    // paint the empty shell (heatmap placeholder square, empty boards) up
    // front — the first batch callback can be many seconds out on a cold cache
    scheduleRender();

    runQueue(tasks, 5, function () {
      updateFreshness();
      scheduleRender();
    }).then(function () {
      state.loading = false;
      updateFreshness();
      refreshAllViews();
      setRefreshing(false);
    });

    updateFreshness();
  }

  // ==================== Controls ====================
  // The scoring-principle note under the model switcher follows the selected
  // strategy (and the active language).
  function updateModelNote() {
    var note = document.getElementById('model-note');
    if (note) note.textContent = t('model.note.' + state.model);
  }

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
        updateModelNote();
        refreshAllViews();
      });
    });
    updateModelNote();

    // force refresh: wipe all data caches (prefs kept), re-warm, reload.
    // Click feedback: a quick full turn on the icon plus a dim of the data
    // sections, both cleared when the reload settles (see startLoading).
    var refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.setAttribute('aria-label', t('freshness.refresh'));
    refreshBtn.setAttribute('title', t('freshness.refresh'));
    refreshBtn.addEventListener('click', function () {
      refreshBtn.classList.add('kick');
      setTimeout(function () { refreshBtn.classList.remove('kick'); }, 600);
      setRefreshing(true);
      yahoo.clearCache().then(function () { startLoading(); });
    });

    // language toggle wiring lives in js/nav.js (shared by both pages) —
    // adding a second click handler here would double-fire the toggle

    // drawer close
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
    // drawer favorite: forces the stock into the heatmap and the ranking
    document.getElementById('drawer-fav').addEventListener('click', function () {
      if (state.drawerEntry) toggleFavoriteEntry(state.drawerEntry);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    window.addEventListener('resize', function () {
      if (state.scores) renderDistribution(visibleRanked().slice(0, 20));
    });
  }

  // Consumed by js/search.js: pool results open the scored drawer,
  // off-universe results open the external (scoreless) one.
  window.SERN.markets = {
    openDrawer: openDrawer,
    openExternalDrawer: openExternalDrawer
  };

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
      var refreshBtn = document.getElementById('refresh-btn');
      refreshBtn.setAttribute('aria-label', t('freshness.refresh'));
      refreshBtn.setAttribute('title', t('freshness.refresh'));
      // ticker names (original cards + marquee clones, keyed by data-symbol)
      var items = document.getElementById('index-ticker').querySelectorAll('.ticker-item');
      var langKey = i18n.getLang() === 'zh' ? 'zh' : 'en';
      items.forEach(function (item) {
        var symbol = item.dataset.symbol;
        var name = item.querySelector('.ticker-name');
        if (name && INDEX_NAMES[symbol]) name.textContent = INDEX_NAMES[symbol][langKey];
      });
      updateModelNote();
      refreshAllViews();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
