/* Universal Dashboard — the app registry.
 *
 * This is the ONLY file to edit when an app is added, renamed or moves. Logos
 * appear in this order.
 *
 *   id      stable key, lowercase, unique
 *   name    the app's name
 *   tag     two or three words on what it is, shown above the description
 *   desc    the system line: what the app runs, in one sentence
 *   icon    cube | lens | rotate | tally | lock | send | cat | chart | grid
 *   accent  logo colour (hex); keep it bright, the logos sit on a near-black background
 *   url     where OPEN goes. Either a full address, or a template where {host}
 *           is replaced by the machine the dashboard was opened from — so
 *           'http://{host}:3000' reaches an app running on the same PC, from
 *           that PC or from a phone on the same Wi-Fi.
 *           Leave '' until the app has an address: the logo shows
 *           "Not connected" and cannot be opened.
 */
window.UNISIS_APPS = [
  { id: 'kostkraft',  name: 'Kostkraft',  tag: 'Cost & food control',
    desc: 'Cost Intelligence System — monitors food costs, ingredient pricing, consumption and operational profitability.',
    icon: 'cube',  accent: '#E0B020', url: 'https://kostkraft.bookends.co.in/' },
  { id: 'instasuite', name: 'Instasuite', tag: 'Restaurant management',
    desc: 'Restaurant Operations Suite — centralised tools for day-to-day operations, incoming orders, guest queries, reservations and guest communication.',
    icon: 'lens',    accent: '#E879B0', url: 'https://instasuite.in/' },
  { id: 'shifly',     name: 'Shifly',     tag: 'Staff & shift management',
    desc: 'Workforce Coordination System — manages employee shifts, schedules, attendance and staffing operations.',
    icon: 'rotate',    accent: '#5BB8EC', url: 'https://shiftly-bk.onrender.com/' },
  { id: 'mise',       name: 'Mise',       tag: 'Kitchen intelligence',
    desc: 'Kitchen Management System — handles recipes, inventory, invoices, food costing and kitchen back-office operations.',
    icon: 'tally',      accent: '#A8D93A', url: 'https://scnhrk-capiche.onrender.com/' },
  { id: 'secretmenu', name: 'Secret Menu', tag: 'Capiche classified',
    desc: "Classified Menu Access — tonight's word unlocks the Capiche secret menu; the word is given out by phone only and expires each night.",
    icon: 'lock',      accent: '#E5243B', url: 'https://bookends.capichesecretmenu.workers.dev/' },
  { id: 'dispatch',   name: 'Dispatch',   tag: 'Delivery & dispatch',
    desc: 'Dispatch Control System — manages delivery, dispatch coordination, order movement and operational tracking.',
    icon: 'send',    accent: '#F2834A', url: 'https://dishpatch.mobioffice.io/' },
  { id: 'chucky',     name: 'Chucky',     tag: 'Menu management',
    desc: "Menu Intelligence System — menu editing and management across Capiche, Aiko, Churn'd & Beshak.",
    icon: 'cat',      accent: '#FF4A3A', url: 'https://chucky-chi.vercel.app/' },
  { id: 'ordergenie', name: 'OrderGenie', tag: 'Ordering & procurement',
    desc: 'Procurement Intelligence System — compares supplier pricing, manages purchasing and controls food-cost decisions.',
    icon: 'chart',  accent: '#9B8CFF', url: 'https://ordergenie.bookends.co.in/' },
];
