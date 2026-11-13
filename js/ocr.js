// Lecture automatique des tickets (Tesseract.js, exécuté sur le téléphone,
// hors ligne une fois l'appli installée). Les valeurs lues ne sont que des
// PROPOSITIONS : rien n'est enregistré sans validation de l'utilisateur.
import { prepareForOcr } from './imaging.js';

let workerPromise = null;

function abs(path) { return new URL(path, document.baseURI).href; }

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Version « fichier unique » : les ressources sont embarquées dans la page.
      const inline = window.__INLINE__;
      const w = inline
        ? await window.Tesseract.createWorker([{ code: 'fra', data: inline.lang() }], 1, {
            // moteur + worker réunis dans un seul script (importScripts est
            // interdit pour les pages ouvertes depuis un fichier local)
            workerPath: inline.workerUrl(),
            workerBlobURL: false,
            corePath: 'inline-core.js',
            cacheMethod: 'none',
            logger: (m) => progressCb && progressCb(m),
          })
        : await window.Tesseract.createWorker('fra', 1, {
            workerPath: abs('vendor/tesseract/worker.min.js'),
            corePath: abs('vendor/tesseract/'),
            langPath: abs('vendor/tesseract/lang'),
            gzip: true,
            logger: (m) => progressCb && progressCb(m),
          });
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  progressCb = onProgress;
  return workerPromise;
}
let progressCb = null;

// Texte brut d'une image (carte grise…)
export async function recognizeText(image, onProgress) {
  const worker = await getWorker(onProgress);
  progressCb = onProgress;
  const { data } = await worker.recognize(prepareForOcr(image));
  return data.text || '';
}

export async function recognize(image, onProgress) {
  const worker = await getWorker(onProgress);
  progressCb = onProgress;
  const canvas = prepareForOcr(image);
  const { data } = await worker.recognize(canvas);
  return parseReceipt(data.text || '');
}

// ---------------------------------------------------------------------------
// Analyse du texte

const FUEL_PATTERNS = [
  // l'ordre compte : du plus spécifique au plus général
  ['E85', /\b(E\s?85|SUPER\s?[EÉ]THANOL|BIO\s?[EÉ]THANOL|ETHANOL)\b/],
  ['GPL', /\b(GPL\s?C?|LPG)\b/],
  ['HVO100', /\b(HVO\s?(100)?|XTL|B\s?100)\b/],
  ['Gazole', /\b(GAZOLE|GASOIL|GAS\s?OIL|DIESEL|B\s?7|B\s?10|GO\s?(PREMIUM|EXCELLIUM)?)\b/],
  ['SP95-E10', /(SP\s?95\s?[-\/]?\s?E\s?10|SANS\s?PLOMB\s?95\s?[-\/]?\s?E\s?10|\bE\s?10\b)/],
  ['SP98', /(SP\s?98|SANS\s?PLOMB\s?98|\bE\s?5\s?98|EXCELLIUM\s?98|V-?POWER\s?(98|RACING)?|ULTIMATE\s?98)/],
  ['SP95', /(SP\s?95|SANS\s?PLOMB\s?95|\bE\s?5\b)/],
];

const NON_FUEL = [
  'CAFE', 'CAFÉ', 'EXPRESSO', 'ESPRESSO', 'CAPPUCCINO', 'CHOCOLAT', 'BOISSON', 'SODA', 'COCA', 'EAU MIN', 'EVIAN', 'CRISTALINE',
  'SANDWICH', 'SNACK', 'VIENNOISERIE', 'CROISSANT', 'CONFISERIE', 'BONBON', 'BISCUIT', 'GLACE',
  'LAVAGE', 'ROULEAU', 'HAUTE PRESSION', 'ASPIRATEUR', 'ASPIRATION', 'GONFLAGE',
  'BOUTIQUE', 'SHOP', 'MAGASIN', 'JOURNAL', 'PRESSE', 'TABAC', 'FDJ',
  'ADBLUE', 'AD BLUE', 'HUILE', 'LAVE-GLACE', 'LAVE GLACE', 'ESSUIE', 'BALAI', 'AMPOULE', 'BOUTEILLE GAZ',
];

const TOTAL_WORDS = /(MONTANT|TOTAL|A\s?PAYER|À\s?PAYER|TTC|\bNET\b|DEBIT|DÉBIT|PAYE|PAYÉ|REGLE|RÉGLÉ|\bCB\b|CARTE)/;
const EXCLUDE_WORDS = /(TVA|T\.V\.A|\bHT\b|PRIX\s?(UNIT|\/|AU)|\/\s?L\b|€\s?\/\s?L|EUR\s?\/\s?L|LITRE|RENDU|MONNAIE|ESPECES|ESPÈCES|REMISE|FIDELIT|POINTS?\b|CUMUL)/;

const MONTHS = { JAN: 1, FEV: 2, FÉV: 2, FEB: 2, MAR: 3, AVR: 4, APR: 4, MAI: 5, MAY: 5, JUIN: 6, JUN: 6, JUIL: 7, JUL: 7, AOU: 8, AOÛ: 8, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, DÉC: 12 };

function pad2(n) { return String(n).padStart(2, '0'); }

function validDate(d, m, y) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (dt > tomorrow) return null;
  const tooOld = new Date(); tooOld.setFullYear(tooOld.getFullYear() - 3);
  if (dt < tooOld) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function findDate(text) {
  // chiffres mal lus courants dans les dates
  const t = text.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
  let m;
  const re = /(?<!\d)(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{4}|\d{2})(?!\d)/g;
  while ((m = re.exec(t))) {
    const r = validDate(+m[1], +m[2], +m[3]);
    if (r) return r;
  }
  const re2 = /(?<!\d)(\d{1,2})\s?([A-ZÉÛ]{3,5})\.?\s?(\d{4}|\d{2})(?!\d)/g;
  const up = t.toUpperCase();
  while ((m = re2.exec(up))) {
    const key = Object.keys(MONTHS).find((k) => m[2].startsWith(k));
    if (!key) continue;
    const r = validDate(+m[1], MONTHS[key], +m[3]);
    if (r) return r;
  }
  return null;
}

function findFuel(up) {
  for (const [name, re] of FUEL_PATTERNS) if (re.test(up)) return name;
  return null;
}

function lineHasFuel(line) {
  return FUEL_PATTERNS.some(([, re]) => re.test(line)) || /CARBURANT|ESSENCE|POMPE|PISTOLET/.test(line);
}

// Montants à 2 décimales (pas les prix au litre à 3 décimales, pas les litres)
function amountsInLine(line) {
  const out = [];
  const re = /(?<![\d.,])(\d{1,4}(?:[ .]\d{3})?)\s?[.,]\s?(\d{2})(?![\d])(\s?(?:L\b|LITRES?|LTR))?/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[3]) continue; // volume en litres
    const euros = parseInt(m[1].replace(/[ .]/g, ''), 10);
    const cents = euros * 100 + parseInt(m[2], 10);
    if (cents > 0 && cents < 100000) out.push(cents);
  }
  return out;
}

function findVolumeAndPrice(up) {
  const vol = up.match(/(\d{1,3})\s?[.,]\s?(\d{2,3})\s?(?:L\b|LITRES?|LTR)/);
  const price = up.match(/(?<![\d])([12])\s?[.,]\s?(\d{3})(?!\d)/);
  if (!vol || !price) return null;
  const litres = parseFloat(`${vol[1]}.${vol[2]}`);
  const pu = parseFloat(`${price[1]}.${price[2]}`);
  return { litres, pu, cents: Math.round(litres * pu * 100) };
}

export function parseReceipt(text) {
  const up = text.toUpperCase();
  const lines = up.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const date = findDate(text);
  const fuel = findFuel(up);
  const otherItems = [...new Set(NON_FUEL.filter((w) => up.includes(w)).map((w) => w.trim()))];

  const candidates = new Map(); // cents -> {cents, label, score}
  const add = (cents, label, score) => {
    const c = candidates.get(cents);
    if (!c || c.score < score) candidates.set(cents, { cents, label, score });
  };
  lines.forEach((line, i) => {
    const amounts = amountsInLine(line);
    if (!amounts.length) return;
    if (EXCLUDE_WORDS.test(line)) return;
    const short = line.replace(/\s+/g, ' ').slice(0, 40);
    if (lineHasFuel(line)) {
      amounts.forEach((a) => add(a, `Ligne carburant : ${short}`, 60));
    } else if (NON_FUEL.some((w) => line.includes(w))) {
      amounts.forEach((a) => add(a, `Autre achat : ${short}`, 5));
    } else if (TOTAL_WORDS.test(line)) {
      amounts.forEach((a) => add(a, `Total : ${short}`, 50));
    } else if (i > 0 && TOTAL_WORDS.test(lines[i - 1]) && !EXCLUDE_WORDS.test(lines[i - 1])) {
      amounts.forEach((a) => add(a, `Total : ${lines[i - 1].slice(0, 30)}`, 45));
    } else {
      amounts.forEach((a) => add(a, short, 10));
    }
  });
  const vp = findVolumeAndPrice(up);
  if (vp && vp.cents > 0) {
    const label = `${String(vp.litres).replace('.', ',')} L × ${String(vp.pu).replace('.', ',')} €/L`;
    // si un montant lu correspond (à 2 centimes près), il est confirmé
    let matched = false;
    for (const c of candidates.values()) {
      if (Math.abs(c.cents - vp.cents) <= 2) { c.score += 30; c.label += ` (= ${label})`; matched = true; }
    }
    if (!matched) add(vp.cents, `Calcul : ${label}`, 20);
  }

  let list = [...candidates.values()];
  // Sans autre achat, le total payé est aussi le montant du carburant :
  // on privilégie le plus grand montant « total ».
  if (!otherItems.length) {
    list.forEach((c) => { if (c.score >= 45) c.score += c.cents / 100000; });
  }
  list.sort((a, b) => b.score - a.score || b.cents - a.cents);
  list = list.slice(0, 6);

  return {
    text,
    date,
    fuel,
    amount: list.length ? list[0].cents : null,
    candidates: list,
    otherItems,
  };
}
