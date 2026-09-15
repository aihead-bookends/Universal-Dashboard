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

## Sign in

Nobody sees the dashboard, the app list or the scripts without signing in, with Google
or with a name and password. Either way it sets a cookie that lasts 30 days, and the
login page offers whichever of the two is set up.

The login page runs the dashboard's own galaxy behind it — the same galaxy.js, at the same
camera it uses at the top of the dashboard, pointer stirring included — with the sign-in set
against it on the left. The galaxy hands its clock across in sessionStorage, so
the arms carry on turning from where they were rather than snapping back to the start.
Signing in clears the glass, and the dashboard is prerendered in the background first so the
navigation is a swap rather than a load: the same galaxy is there, in the same place, with no
blank frame in between.

Add the first account, then start the server:

```
npm run user add krish        # asks for the password, twice is fine to re-set it
npm start
```

| Command | What it does |
| --- | --- |
| `npm run user add <name>` | add an account, or change its password |
| `npm run user list` | who has an account |
| `npm run user remove <name>` | take an account away |
| `npm run user export` | accounts on one line, to paste into the host |

Passwords are never stored. `users.json` keeps a random salt and a PBKDF2-SHA256 hash
(120,000 rounds) per account, and `.session-secret` signs the cookies. Both are
git-ignored: keep them off GitHub and out of screenshots. Deleting `.session-secret`
signs everyone out. Ten wrong tries from one address in five minutes stops the rest.

### Google sign-in

People sign in with their Google account, and only the addresses you allow get in.
Set it up once:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create
   an **OAuth client ID** of type **Web application**.
2. Under **Authorised JavaScript origins** add every address the dashboard is opened
   from, e.g. `http://localhost:4000` and your hosted `https://...` address.
3. Point the dashboard at it, and say who may come in:

```
npm run user google 1234-abc.apps.googleusercontent.com
npm run user allow krish@bookends.co.in     # one address
npm run user allow @bookends.co.in          # or everyone at a domain
npm run user config                         # what is set right now
```

Google only allows sign-in from `localhost` or an HTTPS address, so a phone opening
`http://172.16.x.x:4000` over the office Wi-Fi cannot use it. Keep a password account
for that, or reach the dashboard over HTTPS.

The ID token from Google is checked against the signing keys Google publishes, that it
was minted for this dashboard, that it has not expired and that the address is
verified, and then against the allow list. Settings live in `auth.config.json`.

### Hosted (Cloudflare Pages)

`functions/` holds the same gate for the hosted copy, using the same hashes and cookie,
so one `users.json` covers both. On the Pages project, under Settings ->
Environment variables, set:

| Name | Value |
| --- | --- |
| `UNISIS_SECRET` | a long random string; changing it signs everyone out |
| `UNISIS_USERS` | password accounts: the one line printed by `npm run user export` |
| `UNISIS_GOOGLE_CLIENT_ID` | Google sign-in: the same client id |
| `UNISIS_ALLOWED` | who may sign in with Google: `a@b.com,@a-domain.com` |

Netlify and plain static hosts cannot run these functions. Use their own password
protection there, or host on Pages.

## Host it

It is plain static files, so any host works: Cloudflare Pages, Netlify, or next to
Chucky by copying the folder into `chucky-krish/deploy/public/unisis/`. Serve
`index.html`, `app.js`, `apps.js`, `sw.js`, `manifest.webmanifest` and `icons/`.