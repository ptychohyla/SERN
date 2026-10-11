(function () {
  'use strict';

  window.SERN = window.SERN || {};

  // Market heatmap: ONE fixed-shape square wall (squarified treemap) over the
  // whole tracked universe. Classic two-dimension encoding: tile SIZE (area)
  // represents market cap — 体量; color and its intensity represent the daily
  // change % — 表现 (red up / green down, CN convention). Stocks are grouped
  // into labeled industry rectangles sized by their members' combined cap,
  // ordered by market cap desc both across industries and within each one.
  // The wall's outer shape never changes — only the internal rectangles
  // re-compute as quotes stream in (caps unknown until a quote lands) or on
  // resize. markets.js owns state and calls render() on every refresh.

  // Approximate FX to USD — used ONLY for relative treemap sizing (raw caps
  // arrive in listing currency; JPY/KRW magnitudes would swamp the map).
  // Never displayed; a few % of drift is invisible in area terms.
  var FX_TO_USD = {
    USD: 1, CNY: 0.14, HKD: 0.128, JPY: 0.0067,
    KRW: 0.00072, TWD: 0.031, EUR: 1.08, GBP: 1.27
  };

  var SECTOR_PAD = 3;   // px inset per sector rect -> 6px gutters
  var TILE_PAD = 1.5;   // px inset per tile -> 3px gutters
  var LABEL_H = 16;     // sector label strip height (px)
  var LABEL_MIN_W = 64; // hide label below this sector rect width
  var LABEL_MIN_H = 34; // ...or height

  function changeClass(pct) {
    if (pct === null || pct === undefined || !isFinite(pct)) return 'heat-na';
    if (pct >= 0.03) return 'heat-up-3';
    if (pct >= 0.015) return 'heat-up-2';
    if (pct >= 0.005) return 'heat-up-1';
    if (pct > -0.005) return 'heat-flat';
    if (pct > -0.015) return 'heat-down-1';
    if (pct > -0.03) return 'heat-down-2';
    return 'heat-down-3';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fmtPct(p) {
    return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%';
  }

  function tileValue(entry) {
    var p = entry.data ? entry.data.changePct : null;
    return {
      text: (p === null || p === undefined) ? '—' : fmtPct(p),
      cls: changeClass(p)
    };
  }

  // ---- Treemap math (pure, exported for node-based sanity tests) ----

  function worstAspect(areas, side) {
    var s = 0;
    var rmax = 0;
    var rmin = Infinity;
    for (var i = 0; i < areas.length; i++) {
      s += areas[i];
      if (areas[i] > rmax) rmax = areas[i];
      if (areas[i] < rmin) rmin = areas[i];
    }
    if (s <= 0 || side <= 0) return Infinity;
    return Math.max(side * side * rmax / (s * s), s * s / (side * side * rmin));
  }

  // Squarified treemap (Bruls, Huizing, van Wijk): lay `weights` (positive)
  // out inside (x, y, w, h); returns rects parallel to weights, same order.
  // Caller sorts weights desc for best aspect ratios.
  function squarify(weights, x, y, w, h) {
    var n = weights.length;
    if (!n || w <= 0 || h <= 0) return [];
    var total = 0;
    var i;
    for (i = 0; i < n; i++) total += weights[i];
    var scale = w * h / total;
    var areas = new Array(n);
    for (i = 0; i < n; i++) areas[i] = weights[i] * scale;

    var rects = new Array(n);
    var row = [];
    var rowAreas = [];
    var rowSum = 0;
    var rx = x, ry = y, rw = w, rh = h;

    function flushRow() {
      var horiz = rw >= rh;
      var frac = rowSum / (rw * rh);
      var j, idx, off;
      if (horiz) {
        var rowW = frac * rw;
        off = ry;
        for (j = 0; j < row.length; j++) {
          idx = row[j];
          rects[idx] = { x: rx, y: off, w: rowW, h: rowAreas[j] / rowW };
          off += rects[idx].h;
        }
        rx += rowW;
        rw -= rowW;
      } else {
        var rowH = frac * rh;
        off = rx;
        for (j = 0; j < row.length; j++) {
          idx = row[j];
          rects[idx] = { x: off, y: ry, w: rowAreas[j] / rowH, h: rowH };
          off += rects[idx].w;
        }
        ry += rowH;
        rh -= rowH;
      }
      row = [];
      rowAreas = [];
      rowSum = 0;
    }

    for (i = 0; i < n; i++) {
      if (rw <= 1e-9 || rh <= 1e-9) {
        // float drift exhausted the rect: park the rest as zero-area slivers
        rects[i] = { x: rx, y: ry, w: 0, h: 0 };
        continue;
      }
      var side = Math.min(rw, rh);
      if (row.length &&
          worstAspect(rowAreas.concat(areas[i]), side) > worstAspect(rowAreas, side)) {
        flushRow();
      }
      row.push(i);
      rowAreas.push(areas[i]);
      rowSum += areas[i];
    }
    if (row.length && rw > 1e-9 && rh > 1e-9) flushRow();
    else for (i = 0; i < row.length; i++) rects[row[i]] = { x: rx, y: ry, w: 0, h: 0 };
    return rects;
  }

  function insetRect(r, pad) {
    return {
      x: r.x + pad,
      y: r.y + pad,
      w: Math.max(0, r.w - pad * 2),
      h: Math.max(0, r.h - pad * 2)
    };
  }

  // Tile weight = USD-normalized market cap (体量); entries missing a cap get
  // `fallback` — a quarter of the smallest valid cap this render, keeping
  // them visible but tiny.
  function weightOf(entry, fallback) {
    var d = entry.data || {};
    var cap = d.marketCap;
    if (cap === null || cap === undefined || !isFinite(cap) || cap <= 0) return fallback;
    var fx = FX_TO_USD[d.currency] || 1;
    return cap * fx;
  }

  // ---- Render ----

  var lastContainer = null;
  var lastOpts = null;
  var resizeTimer = null;
  var resizeBound = false;

  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (lastContainer && lastOpts) render(lastContainer, lastOpts);
      }, 150);
    });
  }

  // ---- Company logos ----
  // Logos live on a remote, strongly-cached image service. Defer the queue
  // until the wall approaches the viewport, cap concurrency, and only place
  // marks on tiles large enough to keep symbol/value legible. Small tiles
  // never issue an image request, so first paint and quote streaming stay
  // independent of logo availability.
  // Priority inside a tile is icon > symbol > change. A tile has to be big
  // enough for a recognisable mark, but does not need room for all three.
  // Tiles below ICON_MIN_* fall through to the existing text tiers; this is
  // the only place logos are queued, so the request count remains bounded.
  var LOGO_MIN_W = 22;
  var LOGO_MIN_H = 18;
  var LOGO_TEXT_MIN_W = 36;
  var LOGO_TEXT_MIN_H = 30;
  var LOGO_VALUE_MIN_W = 54;
  var LOGO_VALUE_MIN_H = 42;
  var LOGO_MAX_ACTIVE = 3;
  var LOGO_ORIGIN = 'https://img.loadlogo.com/ticker/';
  var logoPending = [];
  var logoActive = 0;
  var logoStates = {};
  var logoLoadedUrl = {};
  var logoTargets = {};
  var logoObserver = null;
  var logoObservedContainer = null;
  var logoFallbackTimer = null;
  var logoLoadStarted = false;

  function logoUrl(symbol) {
    return LOGO_ORIGIN + encodeURIComponent(symbol) +
      '?size=64&format=png&fallback=monogram';
  }

  function makeLogoImage(symbol) {
    var url = logoLoadedUrl[symbol];
    if (!url) return null;
    var img = document.createElement('img');
    img.className = 'heat-logo';
    img.src = url;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.setAttribute('decoding', 'async');
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.draggable = false;
    if ('fetchPriority' in img) img.fetchPriority = 'low';
    img.addEventListener('error', function () { img.remove(); });
    return img;
  }

  function attachLogo(symbol) {
    var tile = logoTargets[symbol];
    if (!tile || !tile.isConnected || tile.querySelector('.heat-logo')) return;
    var img = makeLogoImage(symbol);
    if (img) tile.insertBefore(img, tile.firstChild);
  }

  function pumpLogos() {
    if (!logoLoadStarted) return;
    while (logoActive < LOGO_MAX_ACTIVE && logoPending.length) {
      var symbol = logoPending.shift();
      if (logoStates[symbol] !== 'queued') continue;
      logoStates[symbol] = 'loading';
      logoActive++;
      loadLogo(symbol);
    }
  }

  function loadLogo(symbol) {
    var probe = new Image();
    probe.decoding = 'async';
    probe.referrerPolicy = 'no-referrer';
    if ('fetchPriority' in probe) probe.fetchPriority = 'low';
    probe.onload = function () {
      logoStates[symbol] = 'ok';
      logoLoadedUrl[symbol] = logoUrl(symbol);
      logoActive--;
      attachLogo(symbol);
      pumpLogos();
    };
    probe.onerror = function () {
      logoStates[symbol] = 'fail';
      logoActive--;
      pumpLogos();
    };
    probe.src = logoUrl(symbol);
  }

  function queueLogo(symbol, tile) {
    logoTargets[symbol] = tile;
    if (logoStates[symbol] === 'ok') {
      attachLogo(symbol);
      return;
    }
    if (logoStates[symbol] === 'fail' || logoStates[symbol] === 'loading') return;
    if (logoStates[symbol] !== 'queued') {
      logoStates[symbol] = 'queued';
      logoPending.push(symbol);
    }
    pumpLogos();
  }

  function startLogoLoading() {
    if (logoLoadStarted) return;
    logoLoadStarted = true;
    if (logoFallbackTimer) {
      clearTimeout(logoFallbackTimer);
      logoFallbackTimer = null;
    }
    if (logoObserver) {
      logoObserver.disconnect();
      logoObserver = null;
    }
    pumpLogos();
  }

  function observeLogoLoading(container) {
    if (logoLoadStarted || logoObservedContainer === container) return;
    if (logoObserver) logoObserver.disconnect();
    logoObservedContainer = container;
    if (typeof window.IntersectionObserver === 'function') {
      logoObserver = new window.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            startLogoLoading();
            return;
          }
        }
      }, { rootMargin: '240px 0px' });
      logoObserver.observe(container);
    }
    // Some embedded / prerender engines throttle IntersectionObserver but do
    // fire timers. Deferring the fallback keeps logos from ever being needed
    // on the critical path, while still making the feature resilient.
    logoFallbackTimer = setTimeout(startLogoLoading, 2500);
  }

  // opts: {entries, t, langName, isFavorite, loading, onSelect}
  function render(container, opts) {
    lastContainer = container;
    lastOpts = opts;
    bindResize();

    // Keyboard focus must survive this rebuild: quotes land every ~200ms
    // while the pool warms, and clearing innerHTML would dump focus to
    // <body>. Only a focused tile triggers it — focus inside the drawer
    // (a different activeElement) is left alone.
    var active = document.activeElement;
    var focusSymbol = (active && active.classList &&
      active.classList.contains('heat-tile') && active.dataset)
      ? active.dataset.symbol : null;

    container.innerHTML = '';
    var tree = el('div', 'heat-tree');
    container.appendChild(tree);
    logoTargets = {};

    // Group loaded entries by sector; entries without data (still pending on
    // the very first load) appear on a later render. Entries holding stale
    // data mid-refresh keep their tile — the wall never blanks.
    var order = [];
    var bySector = {};
    opts.entries.forEach(function (e) {
      if (!e.data) return;
      var s = e.meta.sector;
      if (!bySector[s]) {
        bySector[s] = [];
        order.push(s);
      }
      bySector[s].push(e);
    });

    if (!order.length) {
      tree.appendChild(el('div', 'board-placeholder',
        opts.loading ? opts.t('freshness.loading') : opts.t('board.empty')));
      return;
    }

    // Fallback weight for done entries missing a cap: a quarter of the
    // smallest valid cap this render — keeps them visible but tiny.
    var minCap = Infinity;
    order.forEach(function (s) {
      bySector[s].forEach(function (e) {
        var w = weightOf(e, Infinity);
        if (w < minCap) minCap = w;
      });
    });
    var fallback = minCap === Infinity ? 1 : minCap * 0.25;

    // Sectors and the stocks inside them are both ordered by market cap desc
    // (treemap geography follows 体量); color alone carries 表现.
    var sectors = order.map(function (s) {
      var stocks = bySector[s].map(function (e) {
        return { entry: e, weight: weightOf(e, fallback) };
      }).sort(function (a, b) { return b.weight - a.weight; });
      var wsum = 0;
      stocks.forEach(function (st) { wsum += st.weight; });
      return { sector: s, stocks: stocks, weight: wsum };
    }).sort(function (a, b) { return b.weight - a.weight; });

    var W = tree.clientWidth;
    var H = tree.clientHeight;
    if (W > 0 && H <= 0) {
      // pre-2021 engines without aspect-ratio: pin the square explicitly,
      // else the all-absolute tree collapses to zero height
      tree.style.height = W + 'px';
      H = W;
    }
    if (W <= 0 || H <= 0) return; // hidden/detached: next resize re-renders

    var sectorRects = squarify(sectors.map(function (s) { return s.weight; }), 0, 0, W, H);

    sectors.forEach(function (sec, i) {
      var r = insetRect(sectorRects[i], SECTOR_PAD);
      if (r.w < 2 || r.h < 2) return; // invisible sliver
      var node = el('div', 'heat-sector');
      node.style.left = r.x + 'px';
      node.style.top = r.y + 'px';
      node.style.width = r.w + 'px';
      node.style.height = r.h + 'px';

      var label = opts.t('sector.' + sec.sector);
      var labelH = (r.w >= LABEL_MIN_W && r.h >= LABEL_MIN_H) ? LABEL_H : 0;
      if (labelH) node.appendChild(el('div', 'heat-sector-label', label));
      node.setAttribute('title', label);

      var tileRects = squarify(
        sec.stocks.map(function (st) { return st.weight; }),
        0, labelH, r.w, r.h - labelH
      );

      sec.stocks.forEach(function (st, j) {
        var tr = insetRect(tileRects[j], TILE_PAD);
        if (tr.w < 1 || tr.h < 1) return; // invisible sliver
        var e = st.entry;
        var v = tileValue(e);
        var cls = 'heat-tile ' + v.cls;
        var hasLogo = tr.w >= LOGO_MIN_W && tr.h >= LOGO_MIN_H;
        var showText = !hasLogo || (tr.w >= LOGO_TEXT_MIN_W && tr.h >= LOGO_TEXT_MIN_H);
        var showValue = !hasLogo
          ? (tr.w >= 54 && tr.h >= 30)
          : (tr.w >= LOGO_VALUE_MIN_W && tr.h >= LOGO_VALUE_MIN_H);
        // Without a logo, keep the original text tiers: full (symbol+value),
        // sm (symbol), xs (colour + tooltip). With a logo, the layout follows
        // the explicit icon > symbol > change priority instead.
        if (!hasLogo && (tr.w < 18 || tr.h < 12)) cls += ' heat-tile-xs';
        else if (!hasLogo && (tr.w < 54 || tr.h < 30)) cls += ' heat-tile-sm';
        if (hasLogo && !showText) cls += ' heat-tile-logo-only';
        if (hasLogo && showText) cls += ' heat-tile-has-logo';
        if (!showValue) cls += ' heat-tile-no-value';
        // ★ badge on favorited stocks (forced into the wall); skipped on
        // no-text tiles where an 8px glyph would be the only content
        if (opts.isFavorite && opts.isFavorite(e.meta.symbol) && cls.indexOf('heat-tile-xs') === -1) {
          cls += ' heat-tile-fav';
        }
        var tile = el('div', cls);
        tile.setAttribute('role', 'button');
        tile.tabIndex = -1;
        tile.style.left = tr.x + 'px';
        tile.style.top = tr.y + 'px';
        tile.style.width = tr.w + 'px';
        tile.style.height = tr.h + 'px';
        tile.dataset.symbol = e.meta.symbol;
        tile.setAttribute('title', opts.langName(e.meta.name) + ' ' + e.meta.symbol + ' · ' + v.text);
        tile.setAttribute('aria-label', opts.langName(e.meta.name) + ' ' + e.meta.symbol + ' · ' + v.text);
        if (showText) tile.appendChild(el('div', 'heat-symbol', e.meta.symbol));
        tile.appendChild(el('div', 'heat-value', showValue ? v.text : ''));
        if (hasLogo) {
          tile.className = cls;
          var logoSize = Math.max(14, Math.min(28, Math.floor(Math.min(tr.w, tr.h) * 0.42)));
          if (!showText) logoSize = Math.max(14, Math.min(28, Math.floor(Math.min(tr.w, tr.h) * 0.65)));
          tile.style.setProperty('--heat-logo-size', logoSize + 'px');
          queueLogo(e.meta.symbol, tile);
        }
        tile.addEventListener('click', function () { opts.onSelect(e.meta.symbol); });
        node.appendChild(tile);
      });
      tree.appendChild(node);
    });

    observeLogoLoading(container);
    bindTileKeys(tree, focusSymbol);
  }

  // Roving tabindex: 150 tiles must not be 150 tab stops. The tree takes one
  // stop, arrow keys walk the tiles in DOM order (sector, then size desc).
  // focusSymbol re-hands that stop to the tile that held it last render.
  function bindTileKeys(tree, focusSymbol) {
    var tiles = tree.querySelectorAll('.heat-tile');
    if (!tiles.length) return;
    var start = 0;
    if (focusSymbol) {
      for (var i = 0; i < tiles.length; i++) {
        if (tiles[i].dataset.symbol === focusSymbol) { start = i; break; }
      }
    }
    tiles[start].tabIndex = 0;
    if (focusSymbol) tiles[start].focus();
    tree.addEventListener('keydown', function (ev) {
      var list = tree.querySelectorAll('.heat-tile');
      var idx = Array.prototype.indexOf.call(list, document.activeElement);
      if (idx === -1) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        list[idx].click();
        return;
      }
      var next = null;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = idx + 1;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = idx - 1;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = list.length - 1;
      else return;
      ev.preventDefault();
      if (next < 0) next = 0;
      if (next >= list.length) next = list.length - 1;
      list[idx].tabIndex = -1;
      list[next].tabIndex = 0;
      list[next].focus();
    });
  }

  window.SERN.heatmap = {
    render: render,
    changeClass: changeClass,
    // exposed for node-based sanity tests of the pure treemap math
    layout: {
      squarify: squarify,
      insetRect: insetRect
    }
  };
})();
