/* Universal Dashboard — renders apps.js as tiles, search, reachability, install. */
(() => {
  'use strict';

  const APPS = Array.isArray(window.UNISIS_APPS) ? window.UNISIS_APPS : [];
  const $ = (s) => document.querySelector(s);

  // 24px line icons. Trusted constants only — app data is never put through innerHTML.
  const ICONS = {
    factory:  '<path d="M2.5 20.5h19"/><path d="M4 20.5v-10l5 3v-3l5 3V4h5v16.5"/><path d="M7.5 17h2M12.5 17h2"/>',
    phone:    '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18h3"/>',
    truck:    '<path d="M14 16.5v-11H2v11h2"/><path d="M14 8.5h4l3.5 4v4H19"/><path d="M8 16.5h7"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    pan:      '<circle cx="9.5" cy="13.5" r="6.5"/><circle cx="9.5" cy="13.5" r="2"/><path d="M14.1 8.9 21 3"/>',
    building: '<rect x="4.5" y="3" width="15" height="18" rx="1.5"/><path d="M10 21v-3.5h4V21"/><path d="M8.5 7.5h1.5M14 7.5h1.5M8.5 11.5h1.5M14 11.5h1.5"/>',
    route:    '<circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><path d="M8.5 18.5H15a3.25 3.25 0 0 0 0-6.5H9a3.25 3.25 0 0 1 0-6.5h6.5"/>',
    hat:      '<path d="M6.5 14a4 4 0 0 1 .6-7.9 5 5 0 0 1 9.8 0A4 4 0 0 1 17.5 14v6h-11z"/><path d="M6.5 17h11"/>',
    receipt:  '<path d="M5.5 2.5h13v19l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z"/><path d="M9 7.5h6M9 11.5h6M9 15.5h3.5"/>',
    grid:     '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  };
  // Chucky's head from the Bookends landing, in its own coordinate space.
  const CAT = '<svg viewBox="56 22 108 108" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M74 70 L68 30 L94 54 C102 50 118 50 126 56 L152 32 L146 74 C156 96 150 120 110 121 C72 121 64 94 74 70 Z"/>'
    + '<rect x="74" y="64" width="30" height="18" fill="currentColor" stroke="none"/><rect x="112" y="62" width="26" height="15" fill="currentColor" stroke="none"/></svg>';

  const iconSvg = (name) => name === 'cat' ? CAT
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
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

    const ico = make('span', 'ico');
    ico.innerHTML = iconSvg(app.icon);
    tile.append(ico, make('h2', 'name', app.name));
    if (app.desc) tile.append(make('p', 'desc', app.desc));

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
    tile.append(meta);
    grid.append(tile);
    return { app, href, tile, status, haystack: `${app.name} ${app.desc || ''}`.toLowerCase() };
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
      if (hit) shown++;
    });
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

  /* ----------------------------------------------------- greeting/clock */
  function tick() {
    const now = new Date();
    const h = now.getHours();
    const hello = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const day = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    // Each phrase is its own nowrap span, so a narrow screen breaks between phrases, not inside a date.
    $('#greet').replaceChildren(...['Welcome back', hello, day].flatMap((text, i) => [i ? ' · ' : '', make('span', '', text)]));
    $('#clock').textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
