(function() {
  'use strict';

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, width: rect.width, height: rect.height };
  }

  function setupCanvasHiDPI(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, width: w, height: h };
  }

  // ==================== Particle System ====================
  function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H;
    const particles = [];
    const particleCount = 220;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = document.documentElement.scrollHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 2 + 0.5,
        speedY: -(Math.random() * 0.00015 + 0.00003), // 缓慢上升
        swayAmp: Math.random() * 0.00008 + 0.00002,
        swayFreq: Math.random() * 0.5 + 0.3,
        swayOffset: Math.random() * Math.PI * 2,
        alphaBase: Math.random() * 0.45 + 0.25,
        twinkleSpeed: Math.random() * 0.025 + 0.008,
        twinkleOffset: Math.random() * Math.PI * 2
      });
    }

    let time = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      time += 1;

      particles.forEach(p => {
        // 缓慢上升 + 正弦水平摆动
        p.y += p.speedY;
        const sway = Math.sin(time * p.swayFreq + p.swayOffset) * p.swayAmp;
        p.x += sway;

        // wrap around
        if (p.x < -0.05) p.x += 1.1;
        if (p.x > 1.05) p.x -= 1.1;
        if (p.y < -0.05) p.y += 1.1;
        if (p.y > 1.05) p.y -= 1.1;

        const twinkle = Math.sin(time * p.twinkleSpeed + p.twinkleOffset) * 0.4 + 0.6;
        const alpha = p.alphaBase * twinkle;
        const px = p.x * W;
        const py = p.y * H;

        // 普通圆点带光晕
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 220, 255, ${alpha})`;
        ctx.fill();

        // 光晕效果
        if (p.size > 1.0) {
          const grad = ctx.createRadialGradient(px, py, 0, px, py, p.size * 5);
          grad.addColorStop(0, `rgba(100, 210, 255, ${alpha * 0.5})`);
          grad.addColorStop(0.5, `rgba(80, 200, 255, ${alpha * 0.2})`);
          grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, p.size * 5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', resize);
  }

  // ==================== Hero Background K-Line ====================
  function drawHeroBg() {
    const canvas = document.getElementById('hero-bg-canvas');
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);

    // Left side vertical candlesticks - more prominent
    const candleCount = 55;
    const areaW = width * 0.5;
    const spacing = areaW / candleCount;
    let price = height * 0.5;

    for (let i = 0; i < candleCount; i++) {
      const change = (Math.random() - 0.48) * height * 0.18;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * height * 0.05;
      const low = Math.min(open, close) - Math.random() * height * 0.05;
      const x = i * spacing + spacing * 0.5;
      const isUp = close >= open;

      ctx.strokeStyle = isUp ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, Math.max(0, high));
      ctx.lineTo(x, Math.min(height, low));
      ctx.stroke();

      ctx.fillStyle = isUp ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
      const bodyTop = Math.min(open, close);
      const bodyHeight = Math.max(1.5, Math.abs(close - open));
      ctx.fillRect(x - 1.5, bodyTop, 3, bodyHeight);

      price = close;
    }

    // faint moving average line overlay
    ctx.strokeStyle = 'rgba(59,130,246,0.12)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let ma = height * 0.5;
    for (let i = 0; i < candleCount; i++) {
      const x = i * spacing + spacing * 0.5;
      ma = ma * 0.92 + (height * 0.5 + Math.sin(i * 0.15) * height * 0.1) * 0.08;
      if (i === 0) ctx.moveTo(x, ma);
      else ctx.lineTo(x, ma);
    }
    ctx.stroke();

    // scattered stars/dots on right side and across
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const s = Math.random() * 1.8 + 0.3;
      const alpha = Math.random() * 0.35 + 0.08;
      // glow for larger dots
      if (s > 1.2) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, s * 5);
        g.addColorStop(0, `rgba(56, 189, 248, ${alpha * 0.25})`);
        g.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, s * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(147,197,253,${alpha})`;
      ctx.fill();
      // cross sparkle for some
      if (Math.random() > 0.7) {
        ctx.strokeStyle = `rgba(200,225,255,${alpha * 0.8})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x - s * 3, y);
        ctx.lineTo(x + s * 3, y);
        ctx.moveTo(x, y - s * 3);
        ctx.lineTo(x, y + s * 3);
        ctx.stroke();
      }
    }
  }

  // ==================== 3D Wireframe Globe ====================
  function initGlobe() {
    const canvas = document.getElementById('globe-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    const cx = W / 2;
    const cy = H / 2;
    const radius = Math.min(W, H) * 0.36;

    const latLines = 14;
    const lonLines = 18;
    const nodes = [];
    for (let i = 0; i < 180; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      nodes.push({ theta, phi, size: Math.random() * 2.5 + 1.2 });
    }

    let rotation = 0;

    function project(x, y, z) {
      const scale = 380 / (380 + z);
      return { x: cx + x * scale, y: cy + y * scale, scale };
    }

    function rotateY(x, y, z, angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: x * cos - z * sin, y, z: x * sin + z * cos };
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      rotation += 0.003;

      for (let i = 1; i < latLines; i++) {
        const phi = (Math.PI * i) / latLines;
        ctx.beginPath();
        let first = true;
        for (let j = 0; j <= lonLines; j++) {
          const theta = (2 * Math.PI * j) / lonLines;
          const x = radius * Math.sin(phi) * Math.cos(theta);
          const y = radius * Math.cos(phi);
          const z = radius * Math.sin(phi) * Math.sin(theta);
          const r = rotateY(x, y, z, rotation);
          const p = project(r.x, r.y, r.z);
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(56,189,248,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      for (let i = 0; i < lonLines; i++) {
        const theta = (2 * Math.PI * i) / lonLines;
        ctx.beginPath();
        let first = true;
        for (let j = 0; j <= latLines * 2; j++) {
          const phi = (Math.PI * j) / (latLines * 2);
          const x = radius * Math.sin(phi) * Math.cos(theta);
          const y = radius * Math.cos(phi);
          const z = radius * Math.sin(phi) * Math.sin(theta);
          const r = rotateY(x, y, z, rotation);
          const p = project(r.x, r.y, r.z);
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(56,189,248,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Node connections
      const projected = nodes.map(node => {
        const x = radius * Math.sin(node.phi) * Math.cos(node.theta + rotation);
        const y = radius * Math.cos(node.phi);
        const z = radius * Math.sin(node.phi) * Math.sin(node.theta + rotation);
        return { ...project(x, y, z), z, node };
      }).filter(p => p.scale > 0.55);

      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const dx = projected[i].x - projected[j].x;
          const dy = projected[i].y - projected[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 70) {
            const alpha = (1 - dist / 70) * 0.12 * projected[i].scale;
            ctx.beginPath();
            ctx.moveTo(projected[i].x, projected[i].y);
            ctx.lineTo(projected[j].x, projected[j].y);
            ctx.strokeStyle = `rgba(56,189,248,${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      projected.forEach(p => {
        const alpha = Math.max(0, (p.scale - 0.5) * 0.6);

        // outer glow
        const outerGlow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.node.size * p.scale * 8);
        outerGlow.addColorStop(0, `rgba(6,182,212,${alpha * 0.2})`);
        outerGlow.addColorStop(0.5, `rgba(56,189,248,${alpha * 0.1})`);
        outerGlow.addColorStop(1, 'rgba(56,189,248,0)');
        ctx.fillStyle = outerGlow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.node.size * p.scale * 8, 0, Math.PI * 2);
        ctx.fill();

        // inner glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.node.size * p.scale * 4);
        grad.addColorStop(0, `rgba(6,182,212,${alpha * 0.4})`);
        grad.addColorStop(1, 'rgba(6,182,212,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.node.size * p.scale * 4, 0, Math.PI * 2);
        ctx.fill();

        // node dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.node.size * p.scale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,230,255,${alpha * 0.9})`;
        ctx.fill();
      });

      requestAnimationFrame(draw);
    }
    draw();
  }

  // ==================== Chart 1: Upward Line ====================
  function drawChart1() {
    const canvas = document.getElementById('chart1');
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);

    const points = [];
    const count = 40;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const y = height - (t * height * 0.65 + Math.sin(t * 8) * height * 0.08 + height * 0.18);
      points.push({ x: t * width, y });
    }

    // area
    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(59,130,246,0.22)');
    grad.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // line glow
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = 'rgba(59,130,246,0.35)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // main line
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // dots on some points
    points.forEach((p, i) => {
      if (i % 4 === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
      }
    });
  }

  // ==================== Chart 2: Volatile Line with dots ====================
  function drawChart2() {
    const canvas = document.getElementById('chart2');
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);

    // dotted grid background
    ctx.fillStyle = 'rgba(56,189,248,0.08)';
    for (let gx = 0; gx < width; gx += 16) {
      for (let gy = 0; gy < height; gy += 16) {
        ctx.beginPath();
        ctx.arc(gx, gy, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const points = [];
    const count = 30;
    let y = height * 0.55;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      y += (Math.random() - 0.48) * height * 0.18;
      y = Math.max(height * 0.15, Math.min(height * 0.85, y));
      points.push({ x: t * width, y });
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(6,182,212,0.18)');
    grad.addColorStop(1, 'rgba(6,182,212,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // dots on some points
    points.forEach((p, i) => {
      if (i % 5 === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6,182,212,0.8)';
        ctx.fill();
      }
    });
  }

  // ==================== Chart 3: Candlestick ====================
  function drawChart3() {
    const canvas = document.getElementById('chart3');
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);

    const candleWidth = 5;
    const gap = 3.5;
    const count = Math.floor(width / (candleWidth + gap));
    let price = height * 0.5;

    for (let i = 0; i < count; i++) {
      const change = (Math.random() - 0.48) * height * 0.28;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * height * 0.07;
      const low = Math.min(open, close) - Math.random() * height * 0.07;
      const x = i * (candleWidth + gap) + gap / 2 + candleWidth / 2;
      const isUp = close >= open;

      ctx.strokeStyle = isUp ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, Math.max(0, high));
      ctx.lineTo(x, Math.min(height, low));
      ctx.stroke();

      ctx.fillStyle = isUp ? '#22c55e' : '#ef4444';
      const bodyTop = Math.min(open, close);
      const bodyHeight = Math.max(1, Math.abs(close - open));
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);

      price = close;
    }
  }

  // ==================== Portfolio Chart ====================
  function drawPortfolioChart() {
    const canvas = document.getElementById('portfolio-chart');
    if (!canvas) return;
    const { ctx, width, height } = setupCanvas(canvas);

    const padding = { top: 8, right: 8, bottom: 16, left: 8 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    function drawLine(color, startY, volatility, trendFunc, widthMult) {
      const points = [];
      const count = 55;
      let y = startY;
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const trend = trendFunc ? trendFunc(t) : 0;
        y += (Math.random() - 0.48) * volatility + trend;
        y = Math.max(padding.top + 4, Math.min(padding.top + chartH - 4, y));
        points.push({ x: padding.left + t * chartW, y });
      }

      ctx.beginPath();
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = widthMult || 1.8;
      ctx.stroke();
      return points;
    }

    // Orange line: low, slight rise
    drawLine('rgba(249,115,22,0.85)', padding.top + chartH * 0.78, 4, t => -0.1 + t * 0.15);
    // Yellow line: middle, moderate rise
    drawLine('rgba(234,179,8,0.85)', padding.top + chartH * 0.58, 3.5, t => -0.05 + t * 0.2);
    // Blue line: starts mid, strong rise to top
    const bluePoints = drawLine('rgba(59,130,246,0.9)', padding.top + chartH * 0.65, 3, t => -0.15 + t * 0.45);

    const last = bluePoints[bluePoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(59,130,246,0.15)';
    ctx.fill();
  }

  // ==================== Full-page Wave Grid Canvas ====================
  function initCtaFooterCanvas() {
    const canvas = document.getElementById('cta-footer-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    resize();

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    let time = 0;
    function draw() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);
      time += 0.008;

      const rows = Math.max(14, Math.round(H / 55));
      const cols = Math.max(30, Math.round(W / 55));
      const rowH = H / rows;
      const colW = W / cols;

      // Horizontal arcs (latitude-like)
      for (let r = 0; r <= rows; r++) {
        const yBase = r * rowH;
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) {
          const x = c * colW;
          const wave = Math.sin(c * 0.15 + time + r * 0.4) * rowH * 0.3;
          const y = yBase + wave;
          if (c === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const alpha = 0.06 + Math.sin(r * 0.3 + time) * 0.03;
        ctx.strokeStyle = `rgba(56,189,248,${Math.max(0, alpha)})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Vertical arcs (longitude-like)
      for (let c = 0; c <= cols; c++) {
        const xBase = c * colW;
        ctx.beginPath();
        for (let r = 0; r <= rows; r++) {
          const y = r * rowH;
          const wave = Math.sin(r * 0.25 + time + c * 0.3) * colW * 0.15;
          const x = xBase + wave;
          if (r === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const alpha = 0.05 + Math.sin(c * 0.2 + time) * 0.025;
        ctx.strokeStyle = `rgba(56,189,248,${Math.max(0, alpha)})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Intersection glow dots
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = c * colW + Math.sin(r * 0.25 + time + c * 0.3) * colW * 0.15;
          const y = r * rowH + Math.sin(c * 0.15 + time + r * 0.4) * rowH * 0.3;
          const glow = Math.sin(c * 0.5 + r * 0.3 + time * 2) * 0.5 + 0.5;
          if (glow > 0.65) {
            const ga = (glow - 0.65) * 1.2;
            // glow halo
            const g = ctx.createRadialGradient(x, y, 0, x, y, 4);
            g.addColorStop(0, `rgba(147, 197, 253, ${ga * 0.4})`);
            g.addColorStop(1, 'rgba(147, 197, 253, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            // center dot
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(200, 230, 255, ${ga * 0.8})`;
            ctx.fill();
          }
        }
      }

      // Bottom glow
      const bgrad = ctx.createLinearGradient(0, H * 0.85, 0, H);
      bgrad.addColorStop(0, 'rgba(59,130,246,0)');
      bgrad.addColorStop(0.5, 'rgba(59,130,246,0.02)');
      bgrad.addColorStop(1, 'rgba(59,130,246,0.06)');
      ctx.fillStyle = bgrad;
      ctx.fillRect(0, H * 0.85, W, H * 0.15);

      requestAnimationFrame(draw);
    }
    draw();
    window.addEventListener('resize', resize);
  }

  // ==================== Initialize ====================
  function init() {
    initParticles();
    drawHeroBg();
    initGlobe();
    drawChart1();
    drawChart2();
    drawChart3();
    drawPortfolioChart();
    initCtaFooterCanvas();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawHeroBg();
      drawChart1();
      drawChart2();
      drawChart3();
      drawPortfolioChart();
    }, 250);
  });
})();
