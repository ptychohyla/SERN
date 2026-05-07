/* ========================================
   Sern FinTech — Main JavaScript
   ======================================== */

(function () {
    'use strict';

    // -------- Particle Network Canvas --------
    const heroCanvas = document.getElementById('heroCanvas');
    let ctx, particles, mouse, animFrame;
    const PARTICLE_COUNT = 90;

    function initParticles() {
        if (!heroCanvas) return;
        ctx = heroCanvas.getContext('2d');
        particles = [];
        mouse = { x: null, y: null, radius: 120 };

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        heroCanvas.addEventListener('mousemove', onMouseMove);
        heroCanvas.addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(createParticle());
        }
        animateParticles();
    }

    function resizeCanvas() {
        heroCanvas.width = heroCanvas.offsetWidth;
        heroCanvas.height = heroCanvas.offsetHeight;
    }

    function createParticle() {
        return {
            x: Math.random() * heroCanvas.width,
            y: Math.random() * heroCanvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            radius: Math.random() * 2 + 1,
            opacity: Math.random() * 0.5 + 0.1
        };
    }

    function onMouseMove(e) {
        const rect = heroCanvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    }

    function animateParticles() {
        ctx.clearRect(0, 0, heroCanvas.width, heroCanvas.height);

        particles.forEach((p, i) => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > heroCanvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > heroCanvas.height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(212, 168, 83, ${p.opacity})`;
            ctx.fill();

            for (let j = i + 1; j < particles.length; j++) {
                const dx = p.x - particles[j].x;
                const dy = p.y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 150) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(212, 168, 83, ${0.06 * (1 - dist / 150)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }

            // Mouse interaction
            if (mouse.x !== null) {
                const dx = p.x - mouse.x;
                const dy = p.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < mouse.radius) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.radius * 1.8, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(212, 168, 83, ${0.3 * (1 - dist / mouse.radius)})`;
                    ctx.fill();

                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.strokeStyle = `rgba(212, 168, 83, ${0.1 * (1 - dist / mouse.radius)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        });

        animFrame = requestAnimationFrame(animateParticles);
    }

    // -------- Mini Chart Renderings --------
    function renderMiniChart(canvasId, color, type) {
        const container = document.getElementById(canvasId);
        if (!container) return;

        const canvas = document.createElement('canvas');
        canvas.className = 'mini-chart';
        container.appendChild(canvas);

        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = rect.width || container.parentElement.offsetWidth || 400;
        const h = rect.height || 300;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        const c = canvas.getContext('2d');
        c.scale(dpr, dpr);

        // Generate data points
        const points = 80;
        const data = [];
        let val = 100 + Math.random() * 20;

        for (let i = 0; i < points; i++) {
            val += (Math.random() - 0.48) * 4 + Math.sin(i * 0.15) * 0.8;
            if (type === 'wave') val += Math.sin(i * 0.3) * 2;
            data.push(val);
        }

        const padding = 40;
        const chartW = w - padding * 2;
        const chartH = h - padding * 2;
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        // Draw grid lines
        c.strokeStyle = 'rgba(212, 168, 83, 0.06)';
        c.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
            const y = padding + (chartH / 3) * i;
            c.beginPath();
            c.moveTo(padding, y);
            c.lineTo(w - padding, y);
            c.stroke();
        }

        // Draw area fill
        c.beginPath();
        data.forEach((d, i) => {
            const x = padding + (i / (points - 1)) * chartW;
            const y = padding + chartH - ((d - min) / range) * chartH;
            i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        });
        c.lineTo(w - padding, padding + chartH);
        c.lineTo(padding, padding + chartH);
        c.closePath();

        const grad = c.createLinearGradient(0, padding, 0, padding + chartH);
        grad.addColorStop(0, 'rgba(212, 168, 83, 0.2)');
        grad.addColorStop(1, 'rgba(212, 168, 83, 0.01)');
        c.fillStyle = grad;
        c.fill();

        // Draw main line
        c.beginPath();
        data.forEach((d, i) => {
            const x = padding + (i / (points - 1)) * chartW;
            const y = padding + chartH - ((d - min) / range) * chartH;
            i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        });
        c.strokeStyle = color;
        c.lineWidth = 2;
        c.stroke();

        // Glow effect
        c.shadowColor = color;
        c.shadowBlur = 10;
        c.beginPath();
        data.forEach((d, i) => {
            const x = padding + (i / (points - 1)) * chartW;
            const y = padding + chartH - ((d - min) / range) * chartH;
            i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        });
        c.strokeStyle = color;
        c.lineWidth = 1.5;
        c.globalAlpha = 0.4;
        c.stroke();
        c.globalAlpha = 1;
        c.shadowBlur = 0;
    }

    // -------- Scroll Reveal --------
    function initScrollReveal() {
        const els = document.querySelectorAll('.reveal');
        if (!els.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });

        els.forEach(el => observer.observe(el));
    }

    // -------- Counter Animation --------
    function initCounters() {
        const counters = document.querySelectorAll('.hero-stat-num');
        if (!counters.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseFloat(el.dataset.count);
                    const suffixEl = el.nextElementSibling;
                    const isDecimal = target % 1 !== 0;
                    const duration = 2000;
                    const start = performance.now();

                    function animate(now) {
                        const elapsed = now - start;
                        const progress = Math.min(elapsed / duration, 1);
                        // Ease out cubic
                        const eased = 1 - Math.pow(1 - progress, 3);
                        const current = eased * target;

                        if (isDecimal) {
                            el.textContent = current.toFixed(1);
                        } else {
                            el.textContent = Math.floor(current);
                        }

                        if (progress < 1) {
                            requestAnimationFrame(animate);
                        } else {
                            el.textContent = isDecimal ? target.toFixed(1) : target;
                        }
                    }

                    requestAnimationFrame(animate);
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(c => observer.observe(c));
    }

    // -------- Navbar Scroll Effect --------
    function initNavbar() {
        const navbar = document.getElementById('navbar');
        if (!navbar) return;

        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        }, { passive: true });
    }

    // -------- Mobile Nav Toggle --------
    function initMobileNav() {
        const toggle = document.getElementById('navToggle');
        const links = document.getElementById('navLinks');

        if (!toggle || !links) return;

        toggle.addEventListener('click', () => {
            links.classList.toggle('active');
        });

        // Close on link click
        links.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                links.classList.remove('active');
            });
        });
    }

    // -------- Smooth anchor scroll offset --------
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                const target = document.querySelector(this.getAttribute('href'));
                if (!target) return;
                e.preventDefault();
                const offset = 80;
                const top = target.getBoundingClientRect().top + window.scrollY - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            });
        });
    }

    // -------- Initialize Everything --------
    function init() {
        initParticles();
        initScrollReveal();
        initCounters();
        initNavbar();
        initMobileNav();
        initSmoothScroll();

        // Render mini charts with a small delay for layout
        setTimeout(() => {
            renderMiniChart('chart1', '#d4a853', 'default');
            renderMiniChart('chart2', '#f0b90b', 'wave');
        }, 300);

        // Re-render charts on resize
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                document.querySelectorAll('.product-chart').forEach(el => {
                    const c = el.querySelector('canvas');
                    if (c) c.remove();
                });
                renderMiniChart('chart1', '#d4a853', 'default');
                renderMiniChart('chart2', '#f0b90b', 'wave');
            }, 500);
        });
    }

    // Run after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
