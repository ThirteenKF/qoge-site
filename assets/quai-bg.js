// Quai-style animated background for the research hub and the QUAI Live dashboard.
// A slow mesh of grey nodes (zones), a few red hubs (regions) and small "blocks" running along links.
// Very dim on purpose; pauses when the tab is hidden; static when the system asks for reduced motion.
// Usage: <canvas id="qbg" aria-hidden="true"></canvas><script src=".../assets/quai-bg.js" defer></script>
(function () {
  var c = document.getElementById('qbg');
  if (!c || !c.getContext) return;
  var x = c.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
  var W = 0, H = 0, nodes = [], packets = [], last = 0, spawn = 0, LINK = 150;
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    W = innerWidth; H = innerHeight;
    c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(Math.min(110, Math.max(28, W * H / 26000)));
    nodes = [];
    for (var i = 0; i < n; i++) nodes.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .12, vy: (Math.random() - .5) * .12,
      hub: Math.random() < .1, r: Math.random() * 1.2 + 1
    });
    if (still) draw(0, 0);
  }

  function draw(t, dt) {
    x.clearRect(0, 0, W, H);
    nodes.forEach(function (p) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20; if (p.y > H + 20) p.y = -20;
    });
    for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
      var a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < LINK) {
        x.strokeStyle = 'rgba(255,255,255,' + (0.085 * (1 - d / LINK)).toFixed(3) + ')';
        x.lineWidth = 1; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
      }
    }
    nodes.forEach(function (p) {
      x.fillStyle = p.hub ? 'rgba(227,38,43,.45)' : 'rgba(255,255,255,.2)';
      x.beginPath(); x.arc(p.x, p.y, p.hub ? p.r + 1.2 : p.r, 0, 6.283); x.fill();
      if (p.hub) { x.strokeStyle = 'rgba(227,38,43,.18)'; x.beginPath(); x.arc(p.x, p.y, p.r + 6, 0, 6.283); x.stroke(); }
    });
    if (dt && t > spawn) {
      spawn = t + 900;
      var hubs = nodes.filter(function (p) { return p.hub; }), h = hubs[Math.floor(Math.random() * hubs.length)];
      if (h) {
        var nb = nodes.filter(function (q) { var dx = q.x - h.x, dy = q.y - h.y; return q !== h && dx * dx + dy * dy < LINK * LINK; });
        var to = nb[Math.floor(Math.random() * nb.length)];
        if (to) packets.push({ a: h, b: to, k: 0 });
      }
    }
    packets = packets.filter(function (k) {
      k.k += 0.012 * dt; if (k.k >= 1) return false;
      var px = k.a.x + (k.b.x - k.a.x) * k.k, py = k.a.y + (k.b.y - k.a.y) * k.k;
      x.strokeStyle = 'rgba(227,38,43,.35)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(k.a.x, k.a.y); x.lineTo(px, py); x.stroke();
      x.fillStyle = 'rgba(255,90,90,.8)'; x.fillRect(px - 2, py - 2, 4, 4);
      return true;
    });
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || t - last < 33) return;
    var dt = last ? Math.min(3, (t - last) / 16.7) : 1; last = t;
    draw(t, dt);
  }

  init();
  addEventListener('resize', init);
  if (!still) requestAnimationFrame(frame);
})();
