/* Universal Dashboard — renders apps.js as tiles, search, reachability, install. */
(() => {
  'use strict';

  const APPS = Array.isArray(window.UNISIS_APPS) ? window.UNISIS_APPS : [];
  const $ = (s) => document.querySelector(s);

  // One 24px grid, one stroke weight: each mark is a geometric abstraction of what its app does.
  // Trusted constants only — app data is never put through innerHTML.
  const ICONS = {
    // Kostkraft: an isometric cube of stock with one face left open — yield against wastage.
    cube: '<path d="M12 4 18.9 8 18.9 16 12 20 5.1 16 5.1 8Z"/><path d="M12 12V20M12 12 5.1 8"/>',
    // Instasuite: a lens in a rounded frame, the social square.
    lens: '<rect x="4.5" y="4.5" width="15" height="15" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.4" cy="7.6" r=".95" fill="currentColor" stroke="none"/>',
    // Shifly: two arcs chasing each other, shift after shift.
    rotate: '<path d="M10.8 5.1A7 7 0 0 1 17.4 16.5"/><path d="M20 15.5 17.4 16.5 17.9 13.7"/><path d="M13.2 18.9A7 7 0 0 1 6.6 7.5"/><path d="M4 8.5 6.6 7.5 6.1 10.3"/>',
    // Mise: outlets as modules on a grid, one of them counted.
    tally: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M12 5v14M5 12h14"/><circle cx="15.5" cy="15.5" r="1.15" fill="currentColor" stroke="none"/>',
    // Secret Menu: a padlock, its shackle closed, one redacted bar across the body.
    lock: '<rect x="5" y="10.5" width="14" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M9.5 15h5"/>',
    // Dispatch: a load sent on down the line.
    send: '<path d="M4.5 12H9"/><path d="M10.5 6.5 16 12l-5.5 5.5"/>',
    // Chucky: their own cat, from the 220 grid of chucky-chi.vercel.app, the site this logo opens,
    // scaled onto ours. Head, shades and one whisker each side survive at this size; the body and the
    // glint do not. The inner stroke width cancels the scale, keeping the weight of every other mark.
    cat: '<g transform="translate(-5.02 1.03) scale(.148)" stroke-width="10.8">'
      + '<path d="M74 70 L68 30 L94 54 C102 50 118 50 126 56 L152 32 L146 74 C156 96 150 120 110 121 C72 121 64 94 74 70 Z"/>'
      + '<path d="M80 88 L58 82M150 84 L172 78"/>'
      + '<rect x="74" y="64" width="30" height="18" fill="currentColor" stroke="none"/>'
      + '<rect x="112" y="62" width="26" height="15" fill="currentColor" stroke="none"/></g>',
    // OrderGenie: service rising, counted off a baseline.
    chart: '<path d="M5.5 19h13"/><path d="M8 16v-4M12 16V9M16 16V6"/>',
    // Anything unknown: four modules on the grid.
    grid: '<rect x="4.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.5"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.5"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.5"/>',
  };

  const iconSvg = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (ICONS[name] || ICONS.grid) + '</svg>';

  // {host} = the machine this page was opened from (empty on file://).
  const host = location.hostname || 'localhost';
  const resolve = (template) => {
    if (!template) return '';
    try { return new URL(String(template).replace(/\{host\}/g, host)).href; } catch { return ''; }
  };

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  /* ------------------------------------------------------------- tiles */
  const grid = $('#grid');
  const tiles = APPS.map((app, i) => {
    const href = resolve(app.url);
    const tile = make(href ? 'a' : 'div', 'tile' + (href ? '' : ' off'));
    tile.style.setProperty('--i', i);
    if (/^#[0-9a-f]{3,8}$/i.test(app.accent || '')) tile.style.setProperty('--ac', app.accent);

    // Closed, a tile is just its logo; .info (name, description, status) unfolds beside it.
    const ico = make('span', 'ico');
    ico.innerHTML = iconSvg(app.icon);
    const info = make('div', 'info');
    info.append(make('h2', 'name', app.name));
    if (app.tag) info.append(make('p', 'tag', app.tag));
    if (app.desc) info.append(make('p', 'desc', app.desc));
    // Each holds what it casts on the wall behind it: the logo its own soft light, the details
    // theirs. The cast comes first, so it paints underneath. (It can't live inside .ico: that is
    // its own stacking context, and anything in it would paint over the glass.)
    const orb = make('span', 'orb');
    orb.append(make('span', 'cast'), ico);
    const panel = make('div', 'panel');
    panel.append(make('span', 'cast cast-card'), info);
    tile.append(orb, panel);

    const meta = make('div', 'meta');
    const status = make('span', 'status');
    status.append(make('span', 'dot'), make('span', 'label'));
    meta.append(status);

    if (href) {
      tile.href = href;
      tile.target = '_blank';
      tile.rel = 'noopener';
      tile.setAttribute('aria-label', `Open ${app.name}`);
      const go = make('span', 'go');
      go.append(make('span', 'go-t', 'Open '), '→');
      meta.append(go);
      setStatus(status, 'idle', new URL(href).host);
    } else {
      tile.setAttribute('aria-disabled', 'true');
      setStatus(status, 'off', 'Not connected');
    }
    info.append(meta);
    grid.append(tile);
    return { app, href, tile, status, haystack: `${app.name} ${app.tag || ''} ${app.desc || ''}`.toLowerCase() };
  });

  function setStatus(el, state, label) {
    el.dataset.s = state;
    el.lastChild.textContent = label;
    el.title = label;
  }

  /* ------------------------------------------------------ reachability */
  // A no-cors request resolves for any HTTP answer and rejects when nothing
  // answers, which is exactly "is it up". The page itself is not readable.
  let lastProbe = 0;
  function probeAll() {
    if (!navigator.onLine) return;
    lastProbe = Date.now();
    tiles.filter((t) => t.href).forEach(async (t) => {
      const url = new URL(t.href);
      // An https page may not fetch http:// (mixed content) — say so rather than claim it is down.
      if (location.protocol === 'https:' && url.protocol === 'http:') return setStatus(t.status, 'idle', 'Not checked');
      setStatus(t.status, 'checking', 'Checking');
      let up = await reach(url, 6000);
      if (!up) {
        // Free hosts (Render) sleep when idle and take 30-60s to wake; the first request starts that.
        setStatus(t.status, 'checking', 'Waking up');
        up = await reach(url, 60_000);
      }
      setStatus(t.status, up ? 'online' : 'down', up ? 'Online' : 'Unreachable');
    });
  }

  async function reach(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      await fetch(url.origin + '/', { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /* --------------------------------------------------------- emergence */
  // As the page scrolls, each logo in turn flies into place: it starts small near the middle of the
  // screen and arcs out to its spot. Scrolling back up sends it back again. Progress follows the scroll, eased so the flight glides between wheel steps.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flights = tiles.map(({ tile }, i) => ({
    tile,
    orb: tile.firstChild,
    shown: still ? 1 : 0,
    // Where it starts, around the middle of the screen: a golden-angle spread, so no two share a spot.
    angle: i * 2.39996,
    reach: 0.08 + 0.2 * ((i * 0.618034) % 1),
    landed: false,
    light: '', // the shadow values last written, so an unchanged frame writes nothing
  }));
  const flightOf = new Map(flights.map((f) => [f.tile, f]));
  const landed = (tile) => flightOf.get(tile).shown > 0.97;

  // One studio light for the whole page, overhead and a touch to the left, so every shadow falls
  // beneath its logo and leans a little to the right. It follows the scroll: a logo in the middle
  // of the screen has its shadow tucked in close and crisp, the light focused on it; toward the top
  // or bottom the shadow stretches, swings a little and softens, as if leaving the spotlight. Worked out from the positions the flight
  // loop has just read, so it costs no extra layout, and rounded so that most frames of a scroll
  // change nothing visible and write nothing at all.
  function light(slots, H) {
    flights.forEach((f, i) => {
      const slot = slots[i];
      if (!slot) return;
      const d = Math.max(-1.3, Math.min(1.3, (slot[1] - H / 2) / (H / 2))); // -1 top edge, 1 bottom
      if (Math.abs(d) >= 1.3 && f.light) return; // well off screen: leave it as it was
      const far = Math.abs(d);
      const turn = ((70 + d * 10) * Math.PI) / 180; // 90deg would be straight down; less leans right
      const reach = 5 + 16 * far;
      const sx = Math.round(Math.cos(turn) * reach);
      const sy = Math.round(Math.sin(turn) * reach);
      const ss = (Math.round((1 + 0.5 * far) * 20) / 20).toFixed(2);  // spread: bigger reads softer
      const so = (Math.round((1 - 0.5 * Math.min(far, 1)) * 20) / 20).toFixed(2); // strength
      const key = `${sx} ${sy} ${ss} ${so}`;
      if (key === f.light) return;
      f.light = key;
      const ts = f.tile.style;
      ts.setProperty('--sx', `${sx}px`);
      ts.setProperty('--sy', `${sy}px`);
      ts.setProperty('--ss', ss);
      ts.setProperty('--so', so);
    });
  }

  let lastFlight = performance.now();
  function fly(now) {
    const dt = Math.min(0.05, (now - lastFlight) / 1000);
    lastFlight = now;
    const W = innerWidth;
    const H = innerHeight;
    const [coreX, coreY] = [W / 2, H / 2];
    const glide = still ? 1 : 1 - Math.exp(-dt / 0.22);
    // Read every logo's resting place first, then write, so the page is laid out once per frame.
    const slots = flights.map((f) => {
      if (f.tile.hidden) return null;
      const box = f.tile.getBoundingClientRect();
      return [box.left + f.orb.offsetLeft + f.orb.offsetWidth / 2, box.top + f.orb.offsetTop + f.orb.offsetHeight / 2];
    });
    light(slots, H);
    // At the foot of the page nothing can scroll higher, so every logo on screen finishes its flight.
    const atBottom = scrollY >= document.documentElement.scrollHeight - H - 2;
    let justLanded = false;
    flights.forEach((f, i) => {
      const slot = slots[i];
      if (!slot) return;
      // A logo flies out while its place scrolls up the bottom quarter of the screen: a shorter stretch than
      // the gap between logos (index.html), so each one lands before the next sets off.
      const target = still || (atBottom && slot[1] < H) ? 1 : Math.min(1, Math.max(0, (H * 0.96 - slot[1]) / (H * 0.24)));
      f.shown += (target - f.shown) * glide;
      const st = f.orb.style;
      if (target === 1 && f.shown > 0.995) { // by here the flight is within a fraction of a pixel of home
        if (!f.landed) {
          ['--ex', '--ey', '--es', '--eo'].forEach((name) => st.removeProperty(name));
          f.tile.classList.remove('flying');
          f.landed = true;
          justLanded = true;
        }
        return;
      }
      if (f.landed) {
        f.tile.classList.add('flying');
        f.landed = false;
      }
      const p = f.shown;
      const e = 1 - (1 - p) ** 3;
      const span = Math.min(W, H);
      const ox = coreX + Math.cos(f.angle) * f.reach * span;
      const oy = coreY + Math.sin(f.angle) * f.reach * span * 0.55; // the disc is seen tilted
      const dx = slot[0] - ox;
      const dy = slot[1] - oy;
      const bend = Math.sin(Math.PI * e) * 0.18; // a gentle arc rather than a straight line
      const x = ox + dx * e - dy * bend;
      const y = oy + dy * e + dx * bend;
      st.setProperty('--ex', `${(x - slot[0]).toFixed(1)}px`);
      st.setProperty('--ey', `${(y - slot[1]).toFixed(1)}px`);
      st.setProperty('--es', (0.18 + 0.82 * e).toFixed(3));
      st.setProperty('--eo', Math.min(1, p / 0.3).toFixed(3));
    });
    // A logo that lands in the middle of the screen opens, as if the scroll had just brought it there.
    if (justLanded) focusMiddle();
    requestAnimationFrame(fly);
  }
  flights.forEach((f) => f.tile.classList.add('flying'));
  requestAnimationFrame(fly);

  /* -------------------------------------------------- details on demand */
  // One app shows its details at a time: the one under the mouse, or the one a
  // scroll brings to the middle of the screen. Moving the mouse off folds it
  // back to its logo. Keyboard focus opens a tile through CSS.
  let active = null;
  let leaveTimer = 0;
  function setActive(tile) {
    if (tile === active) return;
    active?.classList.remove('on');
    active = tile;
    active?.classList.add('on');
  }
  tiles.forEach(({ tile }) => {
    tile.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !landed(tile)) return;
      clearTimeout(leaveTimer);
      setActive(tile);
    });
    // A short grace period lets the mouse cross the gap from logo to details.
    tile.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      leaveTimer = setTimeout(() => { if (active === tile) setActive(null); }, 160);
    });
  });

  let scrollQueued = false;
  function focusMiddle() {
    scrollQueued = false;
    const mid = innerHeight / 2;
    let best = null;
    let bestGap = innerHeight * 0.18;
    tiles.forEach(({ tile }) => {
      if (tile.hidden || !landed(tile)) return;
      const r = tile.firstChild.getBoundingClientRect();
      const gap = Math.abs(r.top + r.height / 2 - mid);
      if (gap < bestGap) {
        best = tile;
        bestGap = gap;
      }
    });
    setActive(best);
  }
  addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(focusMiddle);
  }, { passive: true });

  /* ------------------------------------------------------------ search */
  const q = $('#q');
  const count = $('#count');
  const empty = $('#empty');
  const total = tiles.length;

  function applySearch() {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    tiles.forEach((t) => {
      const hit = !term || t.haystack.includes(term);
      t.tile.hidden = !hit;
      if (!hit) return;
      // Visible logos zig-zag down the page, each a little further in or out.
      t.tile.classList.toggle('flip', shown % 2 === 1);
      t.tile.style.setProperty('--o', `${[0, 10, 4, 14][shown % 4]}%`);
      shown++;
    });
    if (active?.hidden) setActive(null);
    const live = tiles.filter((t) => t.href).length;
    count.textContent = term ? `${shown} of ${total} apps` : `${live} of ${total} connected`;
    empty.hidden = shown > 0;
    empty.textContent = shown ? '' : `No app matches “${q.value.trim()}”.`;
  }
  q.addEventListener('input', applySearch);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = tiles.find((t) => t.href && !t.tile.hidden);
      if (first) first.tile.click();
    } else if (e.key === 'Escape') {
      q.value = '';
      applySearch();
      q.blur();
    }
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      q.focus();
    }
  });
  applySearch();

  /* ---------------------------------------------------------- greeting */
  function tick() {
    const now = new Date();
    const h = now.getHours();
    const hello = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const day = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    // Each phrase is its own nowrap span, so a narrow screen breaks between phrases, not inside a date.
    $('#greet').replaceChildren(...['Welcome back', hello, day].flatMap((text, i) => [i ? ' · ' : '', make('span', '', text)]));
  }
  tick();
  setInterval(tick, 30_000);

  /* ------------------------------------------------------ connectivity */
  const offline = $('#offline');
  const syncOnline = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('online', () => { syncOnline(); probeAll(); });
  window.addEventListener('offline', syncOnline);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastProbe > 60_000) probeAll();
  });
  syncOnline();
  probeAll();

  /* --------------------------------------------------------- account */
  // The server only serves this page to a signed-in session; this just names them and offers a way out.
  // Hosted without the sign-in functions there is no api/me, so the footer stays as it is.
  (async () => {
    const who = $("#who");
    try {
      const res = await fetch("api/me", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const { name, role } = await res.json();
      // A shared word signs in as the role itself, so "reader (reader)" would read oddly.
      who.append(name === role ? `Signed in with the ${role} word` : `Signed in as ${name} (${role})`);
      if (role === "superadmin") {
        const manage = make("a", "", "Access");
        manage.href = "admin";
        who.append(manage);
      }
      const out = make("button", "", "Sign out");
      out.type = "button";
      out.addEventListener("click", async () => {
        await fetch("api/logout", { method: "POST" });
        location.replace("login");
      });
      who.append(out);
      who.hidden = false;
    } catch { /* no sign-in behind this copy of the dashboard */ }
  })();

  /* ----------------------------------------------------------- install */
  const installBtn = $('#install');
  const sheet = $('#iosSheet');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferredPrompt = null;

  // Chrome/Edge (Android, Windows, macOS, ChromeOS) hand us the prompt; show the button only then.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; deferredPrompt = null; });
  if (isIOS && !standalone) installBtn.hidden = false;

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.hidden = true;
    } else if (isIOS) {
      sheet.hidden = false;
      $('#iosClose').focus();
    }
  });
  $('#iosClose').addEventListener('click', () => { sheet.hidden = true; });

  // Service workers need a secure context (https, or localhost while developing).
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* dashboard still works, just not offline */ });
  }
})();
