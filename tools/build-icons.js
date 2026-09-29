'use strict';

/**
 * Rasterises the icon SVGs into the PNGs that home screens, the manifest and
 * APK packagers need. Uses headless Chrome/Edge, so nothing to install.
 *
 *   npm run build:icons
 *
 * icon.svg      -> icon-180/192/512.png, transparent, so the taskbar and tab
 *                  show the mark alone with no square behind it.
 * icon-mask.svg -> icon-maskable-512.png, on its own dark ground, which is what
 *                  Android crops to a circle or squircle.
 *
 * Re-run after editing either SVG.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ICONS = path.join(__dirname, '..', 'icons');
const JOBS = [
  { svg: 'icon.svg', size: 180, out: 'icon-180.png', clear: true },
  { svg: 'icon.svg', size: 192, out: 'icon-192.png', clear: true },
  { svg: 'icon.svg', size: 512, out: 'icon-512.png', clear: true },
  { svg: 'icon-mask.svg', size: 512, out: 'icon-maskable-512.png', clear: false },
];

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('No Chrome or Edge found — cannot rasterise icons.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unisis-icons-'));

for (const job of JOBS) {
  const page = path.join(tmp, `${job.out}.html`);
  const out = path.join(ICONS, job.out);
  const svgUrl = 'file:///' + path.join(ICONS, job.svg).replace(/\\/g, '/');
  fs.writeFileSync(page, `<html><body style="margin:0;background:${job.clear ? 'transparent' : '#000'}">`
    + `<img src="${svgUrl}" width="${job.size}" height="${job.size}" style="display:block"></body></html>`);

  spawnSync(exe, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${path.join(tmp, 'profile')}`,
    // Transparent page behind the mark, so the PNG keeps its alpha.
    // Transparent ground, so the PNG keeps its alpha.
    ...(job.clear ? ['--default-background-color=00000000'] : []),
    '--force-device-scale-factor=1', `--window-size=${job.size},${job.size}`,
    `--screenshot=${out}`, 'file:///' + page.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 30_000 });

  // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20, colour type at 25 (6 = RGBA).
  const png = fs.existsSync(out) ? fs.readFileSync(out) : null;
  const w = png ? png.readUInt32BE(16) : 0;
  const h = png ? png.readUInt32BE(20) : 0;
  if (w !== job.size || h !== job.size) {
    console.error(`${job.out} came out ${w}x${h}, expected ${job.size}x${job.size}`);
    process.exit(1);
  }
  console.log(`icons/${job.out}  ${w}x${h}  ${job.clear ? 'transparent' : 'on dark'}  (colour type ${png[25]})`);
}

fs.rmSync(tmp, { recursive: true, force: true });
