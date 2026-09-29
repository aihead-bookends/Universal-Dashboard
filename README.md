# Universal Dashboard (UNISIS)

One launcher for every Bookends app. It opens on phones and desktops, and installs
like an app on Android, iPhone, Windows and macOS (it is a PWA — Progressive Web App).
No build step, no dependencies.

```
index.html              page + styles
apps.js                 THE APP LIST — the only file to edit day to day
app.js                  tiles, search, online checks, install button
sw.js                   offline cache for the dashboard itself
manifest.webmanifest    install metadata (name, colours, icons)
icons/                  icon.svg + generated PNGs (npm run build:icons)
server.js               tiny static server for local / LAN use
```

## Run it

```bash
npm start            # http://localhost:4000
```

The console also prints a `http://192.168.x.x:4000` address for phones on the same Wi-Fi.

## Add or change an app

Edit `apps.js`. Each entry is one tile:

| Field | Meaning |
|---|---|
| `name`, `desc` | Title and one-line description |
| `icon` | `factory` `phone` `truck` `pan` `building` `route` `hat` `receipt` `cat` `grid` |
| `accent` | Tile colour (hex) |
| `url` | Full address, or `http://{host}:PORT` for an app on the same machine. Leave `''` and the tile shows **Not connected** |

Each tile shows **Online** or **Unreachable**. The dashboard can't check `http://`
apps when it is served over `https://`, so those show **Not checked**.

Current state: every app is live. Mise and Shifly run on Render; the rest are on
their own hosts.

Mise and Shifly are on Render's free plan, which sleeps when idle. Their tiles show
**Waking up** for up to a minute while the first request wakes them.

## Install it (mobile + desktop)

Installing needs the dashboard on **HTTPS**. `localhost` also works for testing on the PC itself.

- **Android (Chrome):** tap *Install app* in the top bar, or ⋮ → *Install app*.
- **iPhone / iPad (Safari):** tap *Install app*; it explains Share → *Add to Home Screen*.
- **Windows / macOS (Chrome or Edge):** *Install app* in the top bar, or the install icon in the address bar.

## Build an APK (Android)

Once the dashboard is on an HTTPS URL:

1. Go to <https://www.pwabuilder.com>, enter the URL, and choose **Package for stores → Android**.
2. Download the package. It contains a signed `.apk` for sideloading, an `.aab` for the
   Play Store, and `assetlinks.json`.
3. Upload `assetlinks.json` to `https://<your-domain>/.well-known/assetlinks.json`.
   Without it the APK still works, but shows a browser URL bar.

The APK is a thin wrapper around the hosted page. Editing `apps.js` on the server
updates every installed copy, so you never need to rebuild the APK to add an app.

(CLI alternative: `npx @bubblewrap/cli init --manifest https://<url>/manifest.webmanifest`.
It downloads its own JDK and Android SDK on first run.)

## Open to everyone

There is no sign-in. Anyone who can reach the dashboard sees every app in `apps.js`.

## Host it

It is plain static files, so any host works: Cloudflare Pages, Netlify, or next to
Chucky by copying the folder into `chucky-krish/deploy/public/unisis/`. Serve
`index.html`, `app.js`, `apps.js`, `sw.js`, `manifest.webmanifest` and `icons/`.