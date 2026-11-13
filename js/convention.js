// Convention commune covoiturage : remplissage du formulaire (PDF importé
// dans les Réglages, 3 pages) puis ajout des pièces jointes de chaque
// covoitureur (permis, carte grise, assurance).
import { compressForPdf } from './imaging.js';
import { formatDateFr, todayIso } from './format.js';

const H = 792;
const Y = (top) => H - top;

// Mesures sur le PDF d'origine (ordonnées depuis le haut de la page).
export const CONV = {
  // titre « Covoitureur n » de chaque bloc : [page, y]
  blocks: [[0, 229.4], [0, 420.9], [1, 87.6], [1, 279.7], [1, 470.5]],
  // décalage des lignes par rapport au titre du bloc
  rows: { nom: 26, prenom: 40, badge: 54, contrat: 68, horaire: 82, commune: 96, km: 110,
    marque: 124.8, type: 138.8, puissance: 153.8, immatriculation: 166.9 },
  valueX: 266, valueMaxWidth: 224,
  cdi: { cx: 353.2, rx: 11 }, cdd: { cx: 400.8, rx: 13 }, contratDy: 71.2,
  taux: { cx: 388.2, half: 4.6, rows: { '80': 150.3, '50-80': 165.5, '20-50': 180.5 } },
  faitA: { x: 156, baseline: 326, page: 2 },
  date: { x0: 228, x1: 274, baseline: 326, page: 2 },
  signatures: { cols: [179, 257.5, 335, 411.5, 488.5, 565.5], top: 384, bottom: 433, page: 2 },
};

export const TAUX = [
  ['80', 'Plus de 80 % de nos trajets'],
  ['50-80', 'De 50 % à 80 % de nos trajets'],
  ['20-50', 'De 20 % à 50 % de nos trajets'],
];

export const PIECES = [
  ['permis', 'Permis de conduire'],
  ['carteGrise', 'Carte grise'],
  ['assurance', "Certificat d'assurance"],
];

function safe(font, text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    try { font.encodeText(ch); out += ch; } catch (_) {
      const base = ({ 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i' })[ch] || ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      try { font.encodeText(base); out += base; } catch (__) { out += '?'; }
    }
  }
  return out;
}

function fit(font, text, size, maxWidth) {
  let s = size;
  while (s > 6 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}

/**
 * @param members  covoitureurs dans l'ordre (le premier = celui qui envoie)
 *   { nom, prenom, badge, contrat, horaire, commune, km, vehicule:{marque,type,puissance,immatriculation},
 *     signature: Blob|null, pieces: {permis:[Blob], carteGrise:[Blob], assurance:[Blob]} }
 */
export async function buildConvention({ template, members, taux, faitA, onStep }) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const step = (m) => onStep && onStep(m);
  if (!template) throw new Error('Convention vierge manquante : importez-la dans les Réglages.');
  step('Remplissage de la convention…');
  const tpl = await PDFDocument.load(await template.arrayBuffer());
  const out = await PDFDocument.create();
  out.setTitle('Convention commune covoiturage');
  out.setCreator('Covoiturage PDE');
  const pages = await out.copyPages(tpl, tpl.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.13, 0.45);
  const C = CONV;

  const text = (page, str, x, top, size = 10, f = font, maxW = C.valueMaxWidth) => {
    const t = safe(f, str);
    if (!t) return;
    page.drawText(t, { x, y: Y(top), size: fit(f, t, size, maxW), font: f, color: ink });
  };
  const cross = (page, cx, cy, h) => {
    const o = { thickness: 1.6, color: ink };
    page.drawLine({ start: { x: cx - h, y: Y(cy - h) }, end: { x: cx + h, y: Y(cy + h) }, ...o });
    page.drawLine({ start: { x: cx - h, y: Y(cy + h) }, end: { x: cx + h, y: Y(cy - h) }, ...o });
  };

  // Taux de covoiturage
  if (C.taux.rows[taux]) cross(pages[0], C.taux.cx, C.taux.rows[taux], C.taux.half - 0.8);

  // Covoitureurs
  members.slice(0, 5).forEach((m, i) => {
    const [pi, ty] = C.blocks[i];
    const page = pages[pi];
    const row = (key) => ty + C.rows[key] + 7.6; // ligne de base dans la case
    text(page, m.nom, C.valueX, row('nom'), 10, bold);
    text(page, m.prenom, C.valueX, row('prenom'), 10, bold);
    text(page, m.badge, C.valueX, row('badge'));
    if (m.contrat === 'CDI' || m.contrat === 'CDD') {
      const c = m.contrat === 'CDI' ? C.cdi : C.cdd;
      page.drawEllipse({ x: c.cx, y: Y(ty + C.contratDy), xScale: c.rx, yScale: 6.3, borderColor: ink, borderWidth: 1.3 });
    }
    text(page, m.horaire, C.valueX, row('horaire'));
    text(page, m.commune, C.valueX, row('commune'));
    text(page, m.km ? `${m.km} km` : '', C.valueX, row('km'));
    const v = m.vehicule || {};
    text(page, v.marque, C.valueX, row('marque'));
    text(page, v.type, C.valueX, row('type'));
    text(page, v.puissance ? `${v.puissance} CV` : '', C.valueX, row('puissance'));
    text(page, v.immatriculation, C.valueX, row('immatriculation'));
  });

  // Fait à / Le
  const p3 = pages[C.faitA.page];
  text(p3, faitA, C.faitA.x, C.faitA.baseline, 10, font, 52);
  p3.drawRectangle({ x: C.date.x0, y: Y(C.date.baseline + 2.5), width: C.date.x1 - C.date.x0, height: 11, color: rgb(1, 1, 1) });
  text(p3, formatDateFr(todayIso()), C.date.x0 + 1, C.date.baseline, 10, font, 60);

  // Signatures
  const S = C.signatures;
  for (let i = 0; i < Math.min(5, members.length); i++) {
    const sig = members[i].signature;
    if (!sig) continue;
    const img = await out.embedPng(new Uint8Array(await sig.arrayBuffer()));
    const x0 = S.cols[i] + 3, x1 = S.cols[i + 1] - 3, bw = x1 - x0, bh = S.bottom - S.top - 6;
    const sc = Math.min(bw / img.width, bh / img.height);
    const w = img.width * sc, h = img.height * sc;
    p3.drawImage(img, { x: x0 + (bw - w) / 2, y: Y(S.bottom - 3) + (bh - h) / 2, width: w, height: h });
  }

  // Pièces jointes : une image par page
  const margin = 22;
  let n = 0;
  const total = members.reduce((s, m) => s + PIECES.reduce((t, [k]) => t + ((m.pieces && m.pieces[k]) || []).length, 0), 0);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    for (const [key, label] of PIECES) {
      const list = (m.pieces && m.pieces[key]) || [];
      for (let j = 0; j < list.length; j++) {
        n++;
        step(`Ajout des pièces jointes… ${n} / ${total}`);
        const img = await compressForPdf(list[j], 2000, 0.72, false);
        const size = img.width > img.height ? [841.89, 595.28] : [595.28, 841.89];
        const page = out.addPage(size);
        const cap = safe(bold, `Covoitureur ${i + 1} – ${m.prenom} ${m.nom} – ${label}${list.length > 1 ? ` (${j + 1}/${list.length})` : ''}`);
        page.drawText(cap, { x: margin, y: size[1] - margin - 10, size: fit(bold, cap, 10, size[0] - 2 * margin), font: bold, color: rgb(0.2, 0.2, 0.2) });
        const emb = await out.embedJpg(img.bytes);
        const aw = size[0] - 2 * margin, ah = size[1] - 2 * margin - 30;
        const sc = Math.min(aw / emb.width, ah / emb.height);
        const w = emb.width * sc, h = emb.height * sc;
        page.drawImage(emb, { x: (size[0] - w) / 2, y: margin + (ah - h) / 2, width: w, height: h });
      }
    }
  }
  step('Finalisation…');
  return new Blob([await out.save()], { type: 'application/pdf' });
}
