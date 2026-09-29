# Project Completion Report: Bookends Universal Dashboard (UNISIS)

| | |
|---|---|
| **Project** | Universal Dashboard (UNISIS) |
| **Organisation** | Bookends Hospitality Pvt Ltd, Surat & Ahmedabad |
| **Period** | 10 September 2026 to 29 September 2026 |
| **Status** | Complete: ready for production on Vercel |
| **Repository** | https://github.com/bookendskg/Universal-Dashboard |
| **Live URL** | _add the Vercel address once deployed_ |
| **Prepared by** | _name_ |
| **Date** | 29 September 2026 |

---

## 1. Summary

Bookends runs eight separate web applications for costing, kitchen operations, staffing, menus, procurement and delivery. Each has its own address, so staff had to remember or bookmark every one.

The Universal Dashboard puts all of them on one page. It opens on any phone or computer and can be installed like an app on Android, iPhone, Windows and macOS. Each app has a tile that shows whether the app is currently online and opens it in one tap.

The project was delivered in three weeks. It has no build step, no third-party code libraries and no running costs beyond free static hosting.

## 2. Objectives and outcomes

| Objective | Outcome |
|---|---|
| One entry point for every Bookends app | Done. All 8 apps are listed and connected. |
| Works on mobile and desktop | Done. The layout adapts from phone to wide screen. |
| Installable like a native app | Done. It is a PWA (Progressive Web App) with home-screen icons, and an Android APK can be generated from the hosted site. |
| Show whether each app is up | Done. Each tile shows a live status: Online, Waking up, Unreachable or Not checked. |
| Easy to maintain without a developer | Done. Adding or changing an app is one entry in one file (`apps.js`). |
| Branded, professional look | Done. It carries the Bookends Hospitality identity and has a custom icon for each app. |

## 3. Applications connected

| # | App | Purpose |
|---|---|---|
| 01 | **Kostkraft** | Cost and food control: food costs, ingredient pricing, profitability |
| 02 | **Instasuite** | Restaurant operations: orders, guest queries, reservations |
| 03 | **Shifly** | Staff and shift management: schedules and attendance |
| 04 | **Mise** | Kitchen management: recipes, inventory, invoices, costing |
| 05 | **Secret Menu** | Capiche's nightly secret menu, unlocked with a password word |
| 06 | **Dispatch** | Delivery and dispatch coordination |
| 07 | **Chucky** | Menu management across Capiche, Aiko, Churn'd and Beshak |
| 08 | **OrderGenie** | Procurement: supplier pricing and purchasing |

## 4. Features delivered

- **Opening screen.** A greeting that changes with the time of day, the dashboard title and the Bookends Hospitality logo. After 3 seconds the page glides down to the applications. The glide is skipped if the user scrolls, taps or starts typing first.
- **App tiles.** Each app has its own icon and colour, a short description and an Open button. As the user scrolls, the logos fly into place.
- **Live status checks.** Every app is checked when the page opens and again when the user returns to it. Apps on free hosting that sleep when idle show "Waking up" while they start.
- **Search.** Filters apps by name or purpose. Pressing `/` jumps to the search box and Enter opens the first match.
- **Works offline.** The dashboard itself opens without a connection and shows a notice that apps need one.
- **Accessibility.** It works with a keyboard and respects the operating system's "reduce motion" setting.

## 5. Timeline

| Date | Milestone |
|---|---|
| 10 Sep | Dashboard launched, Android APK link added, app list tidied |
| 11 Sep | OrderGenie added, new visual theme |
| 12 Sep | Chucky tile fixed, animation fixes |
| 15–28 Sep | Sign-in and access control trialled, layout and background refined |
| 29 Sep | Decision to open the dashboard to all staff: sign-in removed, opening screen redesigned, auto-scroll added, moved to the Bookends GitHub organisation, Vercel set up |

## 6. Technical overview

| Area | Detail |
|---|---|
| Type | Static web app and PWA; no server-side code in production |
| Code | Plain HTML, CSS and JavaScript, about 52 KB in total |
| Files | `index.html` (page and styles), `app.js` (behaviour), `apps.js` (app list), `sw.js` (offline cache), `manifest.webmanifest` (install details), `icons/` |
| Hosting | Vercel, serving the files as a static site; every push to `main` deploys automatically |
| Local use | `npm start` runs a small server at http://localhost:4000, also reachable from phones on the office Wi-Fi |
| Requirements | Node 18 or later, for local use only |

## 7. Key decisions

1. **Open access.** A sign-in system was built and then removed on 29 Sep. Anyone with the link can see the app list. Each app still has its own login, so the dashboard exposes nothing beyond the list of names and links.
2. **No build tools or libraries.** This keeps the project easy to hand over and edit, and there are no outside packages to keep up to date.
3. **Static hosting.** There is no server to run or pay for. Updating `apps.js` updates every installed copy.

## 8. Handover: common tasks

| Task | How |
|---|---|
| Add, rename or move an app | Edit `apps.js`, commit and push. Vercel redeploys within a minute. |
| Change the look | Edit the styles at the top of `index.html`. |
| After changing any site file | Raise `VERSION` in `sw.js` (for example `unisis-v37` to `unisis-v38`) so installed copies update. |
| Build an Android APK | Put the Vercel URL into https://www.pwabuilder.com, then choose Package for stores → Android. |

## 9. Known limitations and next steps

- **Mise and Shifly** run on free hosting that sleeps when idle, so they can take up to a minute to open. Moving them to a paid plan would remove the wait.
- **The first Vercel deployment** still has to be connected once in the Vercel account. The steps are in `README.md`. A custom domain (for example `apps.bookends.co.in`) can then be added.
- **Repository cleanup:** a stray nested `UNISIS` folder was committed by accident in the last commit and should be removed. A `.gitignore` file should also be restored.
- **Possible future work:** usage analytics, group-specific app lists if access control is needed again, and an app-status history.

## 10. Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| Project owner | | | |
| Developer | | | |
| Approved by | | | |
