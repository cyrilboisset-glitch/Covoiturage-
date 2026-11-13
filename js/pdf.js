// Génération du dossier PDF :
//   1. justificatif(s) rempli(s) (16 lignes par feuille)
//   2. tickets, 9 par page (3 x 3), ordre chronologique
//   3. autres documents, un par page
import { FORM, ROWS_PER_SHEET } from './layout.js';
import { compressForPdf } from './imaging.js';
import { formatEuros, formatDateFr, fuelLabel } from './format.js';

const INK = () => window.PDFLib.rgb(0.05, 0.13, 0.45); // bleu « stylo »
const A4 = [595.28, 841.89];

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Les polices standard du PDF ne couvrent que l'alphabet latin courant :
// on remplace les caractères non pris en charge plutôt que d'échouer.
function safe(font, text) {
  let out = '';
  for (const ch of String(text)) {
    try { font.encodeText(ch); out += ch; } catch (_) {
      const base = ({ 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i' })[ch] || ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      try { font.encodeText(base); out += base; } catch (__) { out += '?'; }
    }
  }
  return out;
}

function fitText(font, text, size, maxWidth) {
  let s = size;
  while (s > 6 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.5;
  return s;
}

export async function buildPdf({ settings, signature, tickets, docs, onStep }) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const step = (msg) => onStep && onStep(msg);

  step('Préparation du justificatif…');
  const templateBytes = await (await fetch('assets/justificatif.pdf')).arrayBuffer();
  const template = await PDFDocument.load(templateBytes);
  const out = await PDFDocument.create();
  out.setTitle(`Justificatifs covoiturage ${settings.prenom || ''} ${settings.nom || ''}`.trim());
  out.setCreator('Covoiturage PDE');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ink = INK();
  const H = FORM.pageHeight;
  const Y = (top) => H - top; // conversion haut -> repère PDF

  let sigImage = null;
  if (signature) sigImage = await out.embedPng(new Uint8Array(await signature.arrayBuffer()));

  const sorted = [...tickets].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const sheets = chunk(sorted, ROWS_PER_SHEET);
  if (!sheets.length) sheets.push([]);
  const grandTotal = sorted.reduce((s, t) => s + t.amount, 0);

  for (let si = 0; si < sheets.length; si++) {
    const [page] = await out.copyPages(template, [0]);
    out.addPage(page);
    const rows = sheets[si];

    // Nom / prénom
    const nom = safe(bold, (settings.nom || '').trim());
    const prenom = safe(bold, (settings.prenom || '').trim());
    if (nom) page.drawText(nom, { x: FORM.nom.x, y: Y(FORM.nom.baseline), size: fitText(bold, nom, 13, FORM.nom.maxWidth), font: bold, color: ink });
    if (prenom) page.drawText(prenom, { x: FORM.prenom.x, y: Y(FORM.prenom.baseline), size: fitText(bold, prenom, 13, FORM.prenom.maxWidth), font: bold, color: ink });

    // N° d'équipage (facultatif), un caractère par case
    const eq = safe(bold, settings.equipage || '').replace(/\s/g, '').slice(0, 6);
    const edges = FORM.equipage.edges;
    [...eq].forEach((ch, i) => {
      const w = bold.widthOfTextAtSize(ch, 12);
      const cx = (edges[i] + edges[i + 1]) / 2;
      page.drawText(ch, { x: cx - w / 2, y: Y(FORM.equipage.baseline), size: 12, font: bold, color: ink });
    });

    // Équipe cochée : une croix dans la case
    const box = FORM.equipes[settings.equipe];
    if (box) {
      const h = FORM.checkHalf - 0.8;
      const o = { thickness: 1.6, color: ink };
      page.drawLine({ start: { x: box.cx - h, y: Y(box.cy - h) }, end: { x: box.cx + h, y: Y(box.cy + h) }, ...o });
      page.drawLine({ start: { x: box.cx - h, y: Y(box.cy + h) }, end: { x: box.cx + h, y: Y(box.cy - h) }, ...o });
    }

    // Numéro de feuille si plusieurs
    if (sheets.length > 1) {
      const t = `Feuille ${si + 1} / ${sheets.length}`;
      page.drawText(t, { x: FORM.sheetNumber.right - font.widthOfTextAtSize(t, 8.5), y: Y(FORM.sheetNumber.baseline), size: 8.5, font, color: ink });
    }

    // Tableau
    const R = FORM.table.rows;
    const C = FORM.table.cols;
    rows.forEach((t, i) => {
      const top = R[i], bottom = R[i + 1];
      const base = Y((top + bottom) / 2 + 3.6);
      // masque le pointillé « …./…./…… » de la colonne date
      page.drawRectangle({ x: C.date[0] + 1.2, y: Y(bottom - 1), width: C.date[1] - C.date[0] - 2.4, height: bottom - top - 2, color: rgb(1, 1, 1) });
      const d = formatDateFr(t.date);
      const dw = font.widthOfTextAtSize(d, 10.5);
      page.drawText(d, { x: (C.date[0] + C.date[1]) / 2 - dw / 2, y: base, size: 10.5, font, color: ink });
      const label = safe(font, fuelLabel(t.fuel));
      page.drawText(label, { x: C.type[0] + 8, y: base, size: fitText(font, label, 10.5, C.type[1] - C.type[0] - 16), font, color: ink });
      const m = formatEuros(t.amount);
      page.drawText(m, { x: C.montant[1] - 8 - font.widthOfTextAtSize(m, 10.5), y: base, size: 10.5, font, color: ink });
    });

    // Montant total de la feuille
    const subtotal = rows.reduce((s, t) => s + t.amount, 0);
    if (rows.length) {
      const m = formatEuros(subtotal);
      const T = FORM.total;
      page.drawText(m, { x: T.x1 - 8 - bold.widthOfTextAtSize(m, 12), y: Y((T.top + T.bottom) / 2 + 4.2), size: 12, font: bold, color: ink });
    }
    if (sheets.length > 1 && si === sheets.length - 1) {
      const g = `Total général (${sheets.length} feuilles, ${sorted.length} justificatifs) : ${formatEuros(grandTotal)}`;
      page.drawText(g, { x: FORM.grandTotal.right - bold.widthOfTextAtSize(g, 9.5), y: Y(FORM.grandTotal.baseline), size: 9.5, font: bold, color: ink });
    }

    // Signature (la case DATE reste vide, à remplir à la main)
    if (sigImage) {
      const S = FORM.signature;
      const bw = S.x1 - S.x0, bh = S.bottom - S.top;
      const scale = Math.min(bw / sigImage.width, bh / sigImage.height);
      const w = sigImage.width * scale, h = sigImage.height * scale;
      page.drawImage(sigImage, { x: S.x0 + (bw - w) / 2, y: Y(S.bottom) + (bh - h) / 2, width: w, height: h });
    }
  }

  // Tickets : grille 3 x 3
  const pages = chunk(sorted, 9);
  const margin = 22, header = 18, gap = 8, caption = 13;
  const [PW, PH] = A4;
  const cellW = (PW - 2 * margin - 2 * gap) / 3;
  const cellH = (PH - 2 * margin - header - 2 * gap) / 3;
  let n = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    const page = out.addPage(A4);
    const title = `Justificatifs de carburant — page ${pi + 1} / ${pages.length}`;
    page.drawText(title, { x: margin, y: PH - margin - 10, size: 9, font: bold, color: rgb(0.2, 0.2, 0.2) });
    for (let k = 0; k < pages[pi].length; k++) {
      const t = pages[pi][k];
      n++;
      step(`Compression des tickets… ${n} / ${sorted.length}`);
      const col = k % 3, row = Math.floor(k / 3);
      const x = margin + col * (cellW + gap);
      const yTop = PH - margin - header - row * (cellH + gap);
      const imgH = cellH - caption;
      const img = await compressForPdf(t.image, 1100, 0.6, true);
      const emb = await out.embedJpg(img.bytes);
      const s = Math.min(cellW / emb.width, imgH / emb.height);
      const w = emb.width * s, h = emb.height * s;
      page.drawImage(emb, { x: x + (cellW - w) / 2, y: yTop - imgH + (imgH - h) / 2, width: w, height: h });
      page.drawRectangle({ x, y: yTop - cellH, width: cellW, height: cellH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
      const cap = safe(font, `${n}. ${formatDateFr(t.date)} · ${t.fuel} · ${formatEuros(t.amount)}`);
      page.drawText(cap, { x: x + 4, y: yTop - cellH + 4, size: fitText(font, cap, 8, cellW - 8), font, color: rgb(0.15, 0.15, 0.15) });
    }
  }

  // Autres documents : un par page
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    step(`Ajout des documents… ${i + 1} / ${docs.length}`);
    const img = await compressForPdf(d.image, 2000, 0.72, false);
    const landscape = img.width > img.height;
    const size = landscape ? [A4[1], A4[0]] : A4;
    const page = out.addPage(size);
    const top = 30;
    page.drawText(safe(bold, d.name), { x: margin, y: size[1] - margin - 10, size: 10, font: bold, color: rgb(0.2, 0.2, 0.2) });
    const emb = await out.embedJpg(img.bytes);
    const aw = size[0] - 2 * margin, ah = size[1] - 2 * margin - top;
    const s = Math.min(aw / emb.width, ah / emb.height);
    const w = emb.width * s, h = emb.height * s;
    page.drawImage(emb, { x: (size[0] - w) / 2, y: margin + (ah - h) / 2, width: w, height: h });
  }

  step('Finalisation…');
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
