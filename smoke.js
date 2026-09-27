/* The background: soft grey ribbons of smoke, drawn in as you scroll down the dashboard.
 *
 * One 2D canvas inside the .space layer. Each ribbon is a band twisting as it runs across the
 * screen, drawn as many fine, faint lines across its width: where the band turns edge-on the lines
 * crowd together into a darker fold, where it faces you they spread into a pale veil, which is what
 * gives it the look of smoke or chiffon. Nothing shows at the top of the page; scrolling down draws
 * the ribbons in from the left and brings them up, and scrolling back up takes them away again.
 * They drift and twist slowly on their own, and flow along a little faster while the page moves.
 *
 * No libraries. Paused while the tab is hidden; with reduced motion asked for, the ribbons follow
 * the scroll but do not drift.
 */
(() => {
  'use strict';
  const host = document.querySelector('.space');
  if (!host) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  host.append(canvas);

  // Each ribbon: where its middle runs (as a height on the screen, 0 top to 1 bottom), how it
  // meanders, how wide it is, how many times it twists across the screen, and how dark it draws.
  const RIBBONS = [
    { at: 0.56, rise: 0.10, bend: 1.3, bendPhase: 0.4, wide: 0.13, twist: 1.6, twistPhase: 0.2, drift: 0.05, lines: 64, ink: 0.075 },
    { at: 0.60, rise: 0.08, bend: 1.8, bendPhase: 2.2, wide: 0.09, twist: 2.3, twistPhase: 1.7, drift: -0.07, lines: 48, ink: 0.085 },
    { at: 0.66, rise: 0.06, bend: 1.0, bendPhase: 4.0, wide: 0.07, twist: 1.2, twistPhase: 3.1, drift: 0.04, lines: 40, ink: 0.06 },
  ];
  const STEP = 8; // px between points along a line
  // Smoke is never evenly combed: each thread gets its own small offset across the band and its own
  // slow wander, fixed once so the ribbon keeps its character from frame to frame.
  const rand = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  RIBBONS.forEach((r, ri) => {
    r.threads = Array.from({ length: r.lines }, (_, i) => ({
      s: ((i + 0.5) / r.lines) * 2 - 1 + (rand(ri * 97 + i) - 0.5) * (1.6 / r.lines),
      wander: rand(ri * 31 + i * 7) * Math.PI * 2,
      cw: 0, sw: 0, // cos and sin of wander, filled in below
      weight: 0.55 + rand(ri * 13 + i * 3) * 0.9,
    }));
    r.threads.forEach((th) => { th.cw = Math.cos(th.wander); th.sw = Math.sin(th.wander); });
  });

  let W = 0, H = 0, dpr = 1;
  // On a phone the address bar slides in and out as the page scrolls, changing the window height a
  // little every time. Rebuilding the canvas for that would clear it and shift every ribbon mid-scroll,
  // so a height change that small, with the width unchanged, is left to CSS to absorb.
  function resize() {
    const d = Math.min(window.devicePixelRatio || 1, 1.5); // fine threads need no more, and it keeps every frame cheap
    if (innerWidth === W && d === dpr && Math.abs(innerHeight - H) < 160) return false;
    dpr = d;
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    blank = true;
    return true;
  }
  let blank = true; // nothing on the canvas, so an empty frame need not clear it again
  resize();

  function draw(t, shown) {
    if (shown <= 0.005 && blank) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    blank = shown <= 0.005;
    if (!blank) ribbons(t, shown);
  }

  function ribbons(t, shown) {
    // Drawn in from the left: each line runs as far as the scroll has brought it, and fades out
    // over its last stretch instead of stopping at a hard end.
    const reach = -0.1 * W + shown * 1.25 * W;
    const tail = W * 0.25;
    // One fading tip for every thread: full ink behind it, nothing past it. Each thread sets its own
    // strength with globalAlpha, so no colour has to be built per thread per frame.
    const tip = ctx.createLinearGradient(reach - tail, 0, reach, 0);
    tip.addColorStop(0, 'rgba(28,28,32,1)');
    tip.addColorStop(1, 'rgba(28,28,32,0)');

    RIBBONS.forEach((r) => {
      const phase = t * r.drift;
      // The middle of the ribbon and its half-width at x, and how far it has turned there:
      // cos(turn) is 1 where it faces you, 0 where it is seen edge-on.
      const mid = (u) => H * (r.at + r.rise * Math.sin(u * Math.PI * r.bend + r.bendPhase + phase * 6)
        + 0.03 * Math.sin(u * Math.PI * 3.1 + phase * 9 + r.bendPhase));
      const half = (u) => H * r.wide * (0.55 + 0.45 * Math.sin(u * Math.PI * 0.9 + r.bendPhase + phase * 4));
      const turn = (u) => Math.cos(u * Math.PI * r.twist + r.twistPhase + phase * 10);

      // Every point along the ribbon, worked out once for all its lines.
      // The small wander each thread has is sin(a + its own offset), and a is the same for every
      // thread at a given point, so it is worked out here once: sin and cos of it, per point.
      const pts = [];
      const wob = H * 0.006;
      for (let x = -STEP; x <= Math.min(W + STEP, reach); x += STEP) {
        const u = x / W;
        const a = u * Math.PI * 4 + phase * 8;
        pts.push([x, mid(u), half(u) * turn(u), Math.sin(a) * wob, Math.cos(a) * wob]);
      }
      if (pts.length < 2) return;

      r.threads.forEach(({ s: across, cw, sw, weight }) => {
        const edge = Math.abs(across) > 0.9;                            // the edges draw a shade darker
        ctx.globalAlpha = Math.min(1, r.ink * weight * (edge ? 1.7 : 0.5 + 0.5 * (1 - Math.abs(across))) * shown);
        ctx.strokeStyle = tip;
        ctx.lineWidth = edge ? 1.2 : 0.95;
        ctx.beginPath();
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k];
          const y = p[1] + across * p[2] + p[3] * cw + p[4] * sw;
          if (k) ctx.lineTo(p[0], y); else ctx.moveTo(p[0], y);
        }
        ctx.stroke();
      });

      // A faint veil across the band where it faces you, so the ribbon has a body, not just threads.
      ctx.beginPath();
      pts.forEach(([x, m, h], k) => (k ? ctx.lineTo(x, m - h) : ctx.moveTo(x, m - h)));
      for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k][0], pts[k][1] + pts[k][2]);
      ctx.closePath();
      ctx.globalAlpha = r.ink * 0.45 * shown;
      ctx.fillStyle = tip;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* --------------------------------------------------------------- motion */

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  // How far the page scrolls, kept up to date when the page changes size rather than read every
  // frame: reading it after the logo flights have written their styles would make the browser lay
  // the whole page out again in the middle of the frame.
  let room = 0;
  const measure = () => { room = document.documentElement.scrollHeight - innerHeight; };
  measure();
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(document.body);
  addEventListener('load', measure);
  // How far through the reveal a scroll position is: fully drawn after most of a screen's scroll,
  // or at the foot of the page if it is shorter than that.
  const reveal = (y) => {
    const span = Math.min(room, innerHeight * 0.9);
    return span > 2 ? Math.min(1, Math.max(0, y / span)) : 1;
  };

  // Everything follows the scroll through springs, never the raw scroll: a wheel moves the page in
  // jumps, and those jumps must not reach the ribbons. The page position is eased first, the speed
  // is read from that eased position, and the speed is eased again before it touches the drift.
  const ease = (dt, tau) => 1 - Math.exp(-dt / tau);
  let shown = still.matches ? reveal(scrollY) : 0;
  let drawn = 0;              // shown, eased, as last drawn
  let clock = 0;
  let pace = 0;               // extra drift from scrolling, 0 at rest
  let glideY = scrollY;       // the page position, eased
  let last = performance.now();
  let frame = 0;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const before = glideY;
    glideY += (scrollY - glideY) * ease(dt, 0.18);
    const speed = dt ? Math.abs(glideY - before) / dt : 0;   // px per second, already smooth
    // Scrolling either way only quickens the drift, up to two and a half times, and it settles back
    // over about a second; it never reverses, so nothing whips back and forth.
    pace += (Math.min(1.5, speed / 900) - pace) * ease(dt, speed / 900 > pace ? 0.35 : 0.9);
    if (!still.matches) clock += dt * (1 + pace);

    shown = still.matches ? reveal(scrollY) : shown + (reveal(glideY) - shown) * ease(dt, 0.25);
    drawn = shown * shown * (3 - 2 * shown); // eased in and out at both ends
    draw(clock, drawn);
    frame = still.matches || document.hidden ? 0 : requestAnimationFrame(tick);
  }

  const start = () => {
    if (frame || document.hidden) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };
  addEventListener('resize', () => { measure(); if (resize()) draw(clock, drawn); }, { passive: true });
  addEventListener('scroll', () => { if (still.matches) start(); }, { passive: true });
  document.addEventListener('visibilitychange', start);
  if (still.addEventListener) still.addEventListener('change', start);
  start();
})();
