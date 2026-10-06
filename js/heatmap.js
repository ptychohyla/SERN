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

  // opts: {entries, t, langName, isFavorite, onSelect}
  function render(container, opts) {
    lastContainer = container;
    lastOpts = opts;
    bindResize();

    container.innerHTML = '';
    var tree = el('div', 'heat-tree');
    container.appendChild(tree);

    // Group loaded entries by sector; pending quotes have no cap yet, so they
    // simply appear on a later render (the wall itself never changes shape).
    var order = [];
    var bySector = {};
    opts.entries.forEach(function (e) {
      if (e.status !== 'done' || !e.data) return;
      var s = e.meta.sector;
      if (!bySector[s]) {
        bySector[s] = [];
        order.push(s);
      }
      bySector[s].push(e);
    });

    if (!order.length) {
      tree.appendChild(el('div', 'board-placeholder', opts.t('freshness.loading')));
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
        // text tiers by rendered px: full (symbol+value), sm (symbol at a
        // smaller font), xs (no text — color + hover tooltip only). The xs
        // floor is deliberately low so small-cap names stay readable.
        if (tr.w < 22 || tr.h < 12) cls += ' heat-tile-xs';
        else if (tr.w < 58 || tr.h < 30) cls += ' heat-tile-sm';
        // ★ badge on favorited stocks (forced into the wall); skipped on
        // no-text tiles where an 8px glyph would be the only content
        if (opts.isFavorite && opts.isFavorite(e.meta.symbol) && cls.indexOf('heat-tile-xs') === -1) {
          cls += ' heat-tile-fav';
        }
        var tile = el('div', cls);
        tile.style.left = tr.x + 'px';
        tile.style.top = tr.y + 'px';
        tile.style.width = tr.w + 'px';
        tile.style.height = tr.h + 'px';
        tile.dataset.symbol = e.meta.symbol;
        tile.setAttribute('title', opts.langName(e.meta.name) + ' ' + e.meta.symbol + ' · ' + v.text);
        tile.appendChild(el('div', 'heat-symbol', e.meta.symbol));
        tile.appendChild(el('div', 'heat-value', v.text));
        tile.addEventListener('click', function () { opts.onSelect(e.meta.symbol); });
        node.appendChild(tile);
      });
      tree.appendChild(node);
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
