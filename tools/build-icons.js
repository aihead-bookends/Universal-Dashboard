'use strict';

/**
 * Rasterises icons/icon.svg into the PNGs that home screens, the manifest and
 * APK packagers need. Uses headless Chrome/Edge, so nothing to install.
 *
 *   npm run build:icons
 *
 * Re-run after editing icon.svg.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ICONS = path.join(__dirname, '..', 'icons');
const SVG = path.join(ICONS, 'icon.svg');
const SIZES = [180, 192, 512];

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
const svgUrl = 'file:///' + SVG.replace(/\\/g, '/');

for (const size of SIZES) {
  const page = path.join(tmp, `icon-${size}.html`);
  const out = path.join(ICONS, `icon-${size}.png`);
  fs.writeFileSync(page, `<html><body style="margin:0;background:#0E0D0B"><img src="${svgUrl}" width="${size}" height="${size}" style="display:block"></body></html>`);

  spawnSync(exe, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--user-data-dir=${path.join(tmp, 'profile')}`,
    '--force-device-scale-factor=1', `--window-size=${size},${size}`,
    `--screenshot=${out}`, 'file:///' + page.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 30_000 });

  // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
  const png = fs.existsSync(out) ? fs.readFileSync(out) : null;
  const w = png ? png.readUInt32BE(16) : 0;
  const h = png ? png.readUInt32BE(20) : 0;
  if (w !== size || h !== size) {
    console.error(`icon-${size}.png came out ${w}x${h}, expected ${size}x${size}`);
    process.exit(1);
  }
  console.log(`icons/icon-${size}.png  ${size}x${size}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
