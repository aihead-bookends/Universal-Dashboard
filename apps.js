/* Universal Dashboard — the app registry.
 *
 * This is the ONLY file to edit when an app is added, renamed or moves. Tiles
 * render in this order.
 *
 *   id      stable key, lowercase, unique
 *   name    tile title
 *   desc    one short line under the title ('' is fine)
 *   icon    factory | phone | truck | pan | building | route | hat | cat | grid
 *   accent  tile colour (hex); keep it bright, the tiles sit on near-black
 *   url     where OPEN goes. Either a full address, or a template where {host}
 *           is replaced by the machine the dashboard was opened from — so
 *           'http://{host}:3000' reaches an app running on the same PC, from
 *           that PC or from a phone on the same Wi-Fi.
 *           Leave '' until the app has an address: the tile shows
 *           "Not connected" and cannot be opened.
 */
window.UNISIS_APPS = [
  { id: 'kostkraft',  name: 'Kostkraft',  desc: 'Recipe costing, yield & wastage', icon: 'factory',  accent: '#E0B020', url: 'https://kostkraft.bookends.co.in/' },
  { id: 'instasuite', name: 'Instasuite', desc: '', icon: 'phone',    accent: '#E879B0', url: '' },
  { id: 'shifly',     name: 'Shifly',     desc: '', icon: 'truck',    accent: '#5BB8EC', url: '' },
  { id: 'mise',       name: 'Mise',       desc: 'Month-end stock counts across outlets', icon: 'pan', accent: '#A8D93A', url: 'https://scnhrk-capiche.onrender.com/' },
  { id: 'bookends',   name: 'Bookends',   desc: 'The live customer menu', icon: 'building', accent: '#E3A857', url: 'https://bookends.capichesecretmenu.workers.dev/' },
  { id: 'dispatch',   name: 'Dispatch',   desc: 'ODC management', icon: 'route',    accent: '#F2834A', url: 'https://dishpatch.mobioffice.io/' },
  { id: 'chucky',     name: 'Chucky',     desc: "Menu editor — Capiche, Aiko, Churn'd & Beshak", icon: 'cat', accent: '#FF4A3A', url: 'https://bookends-chucky.capichesecretmenu.workers.dev/chucky/' },
];
