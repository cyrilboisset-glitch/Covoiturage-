// Détection de plusieurs tickets sur une même photo (planche de tickets).
//
// Principe : on repère l'« encre » (texte et bords des tickets) en compensant
// l'éclairage, on l'épaissit pour que chaque ticket devienne une seule tache,
// puis on prend les taches assez grandes comme tickets. Fonctionne sur fond
// sombre (tickets posés sur une table) comme sur fond blanc (tickets collés
// sur une feuille), à condition que les tickets ne se chevauchent pas.
import { makeCanvas, toCanvas } from './imaging.js';

const WORK = 900; // résolution de travail (plus grand côté)

function luminance(canvas) {
  const { width: W, height: H } = canvas;
  const p = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  return lum;
}

// « Blanc » local estimé par blocs (maximum robuste), pour compenser ombres et fond.
function localWhite(lum, W, H, B) {
  const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const vals = [];
      for (let y = by * B; y < Math.min(H, by * B + B); y += 2)
        for (let x = bx * B; x < Math.min(W, bx * B + B); x += 2) vals.push(lum[y * W + x]);
      vals.sort((a, b) => a - b);
      bg[by * bw + bx] = vals[Math.floor(vals.length * 0.92)] || 255;
    }
  // lissage 3x3 du fond pour éviter les marches entre blocs
  const sm = new Float32Array(bg.length);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < bw && yy < bh) { s = Math.max(s, bg[yy * bw + xx]); n++; }
        }
      sm[y * bw + x] = s;
    }
  return { bg: sm, bw, B };
}

// Dilatation rectangulaire rapide (image intégrale)
function dilate(mask, W, H, rx, ry) {
  const I = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += mask[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - ry), y1 = Math.min(H, y + ry + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - rx), x1 = Math.min(W, x + rx + 1);
      const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[y * W + x] = s > 0 ? 1 : 0;
    }
  }
  return out;
}

// Composantes connexes (4-voisinage) -> boîtes englobantes
function components(mask, W, H) {
  const label = new Int32Array(W * H);
  const boxes = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    const id = boxes.length + 1;
    const b = { x0: W, y0: H, x1: 0, y1: 0, n: 0 };
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      b.n++;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < W - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - W] && !label[i - W]) { label[i - W] = id; stack.push(i - W); }
      if (y < H - 1 && mask[i + W] && !label[i + W]) { label[i + W] = id; stack.push(i + W); }
    }
    boxes.push(b);
  }
  return boxes;
}

// Hauteur typique d'un caractère : médiane des hauteurs des petites taches d'encre.
function typicalCharHeight(ink, W, H) {
  const boxes = components(ink, W, H).filter((b) => b.n >= 3);
  const hs = boxes.map((b) => b.y1 - b.y0 + 1).filter((h) => h >= 3 && h < H / 15).sort((a, b) => a - b);
  if (hs.length < 20) return Math.max(4, H / 120);
  return hs[Math.floor(hs.length / 2)];
}

const overlap = (a, b) => !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);

function mergeOverlapping(boxes) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < boxes.length && !changed; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (overlap(boxes[i], boxes[j])) {
          const a = boxes[i], b = boxes[j];
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), n: a.n + b.n };
          boxes.splice(j, 1);
          changed = true;
          break;
        }
  }
  return boxes;
}

/**
 * Détecte les tickets présents sur une photo.
 * @returns {Array<{x,y,w,h}>} rectangles en pixels de l'image source, dans
 *          l'ordre de lecture (de haut en bas, de gauche à droite).
 */
export function detectTickets(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const small = toCanvas(source, WORK);
  const W = small.width, H = small.height;
  const scale = sw / W;
  const lum = luminance(small);

  // Fond sombre (tickets posés sur une table) : on repère directement le papier.
  const paper = paperRegions(lum, W, H);
  if (paper) return finish(paper.boxes, paper.ch, W, H, sw, sh, scale);

  const { bg, bw, B } = localWhite(lum, W, H, Math.max(16, Math.round(Math.max(W, H) / 40)));
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const bx = Math.min(bw - 1, (x / B) | 0), by = Math.min(bg.length / bw - 1, (y / B) | 0);
      const white = bg[by * bw + bx];
      const j = y * W + x;
      // encre = nettement plus sombre que le papier local, ou fond sombre bordant du papier
      ink[j] = white > 60 && lum[j] < white * 0.72 ? 1 : 0;
    }

  const ch = typicalCharHeight(ink, W, H);
  // Épaississement : relie les caractères d'une ligne et les lignes d'un
  // même ticket, mais pas deux tickets séparés d'un espace net.
  const blob = dilate(ink, W, H, Math.round(ch * 1.6), Math.round(ch * 1.3));
  let boxes = components(blob, W, H);

  const minArea = W * H * 0.008;
  boxes = boxes.filter((b) => {
    const bwid = b.x1 - b.x0 + 1, bhei = b.y1 - b.y0 + 1;
    if (bwid * bhei < minArea) return false; // tache, logo isolé, poussière
    if (bhei < ch * 4) return false; // une seule ligne de texte
    if (bwid > W * 0.97 && bhei > H * 0.97) return false; // toute l'image (bord de feuille)
    return true;
  });
  boxes = mergeOverlapping(boxes);

  // Morceaux d'un même ticket séparés par une ligne blanche : on fusionne
  // les blocs alignés verticalement et très proches.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        const a = boxes[i], b = boxes[j];
        if (b.y0 <= a.y1) continue; // b doit être sous a
        const gap = b.y0 - a.y1;
        const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0);
        const small = Math.min(a.y1 - a.y0, b.y1 - b.y0) < ch * 9;
        if (gap < ch * 2.2 && ov > narrow * 0.6 && small) {
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: a.y0, x1: Math.max(a.x1, b.x1), y1: b.y1, n: a.n + b.n };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }

  return finish(boxes, ch, W, H, sw, sh, scale);
}

function otsu(lum) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.min(255, lum[i] | 0)]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = lum.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return { thr, hist };
}

function paperRegions(lum, W, H) {
  const { thr } = otsu(lum);
  let bright = 0, sumB = 0, sumD = 0, nD = 0;
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] > thr) { bright++; sumB += lum[i]; } else { sumD += lum[i]; nD++; }
  }
  const frac = bright / lum.length;
  // il faut un fond nettement plus sombre que le papier, et assez de fond visible
  if (frac > 0.72 || frac < 0.08 || !nD || sumB / bright - sumD / nD < 50) return null;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < lum.length; i++) mask[i] = lum[i] > thr ? 1 : 0;
  // ouverture légère : sépare des tickets qui se frôlent
  const r = Math.max(1, Math.round(Math.max(W, H) / 300));
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) inv[i] = 1 - mask[i];
  const eroded = dilate(inv, W, H, r, r);
  for (let i = 0; i < mask.length; i++) mask[i] = 1 - eroded[i];
  let boxes = components(mask, W, H).filter((b) => {
    const bwid = b.x1 - b.x0 + 1, bhei = b.y1 - b.y0 + 1;
    return bwid * bhei > W * H * 0.008 && b.n > bwid * bhei * 0.35 && Math.min(bwid, bhei) > Math.max(W, H) * 0.04;
  });
  if (!boxes.length) return null;
  boxes = mergeOverlapping(boxes.map((b) => ({ ...b, x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r })));
  return { boxes, ch: Math.max(4, Math.max(W, H) / 150) };
}

function finish(boxes, ch, W, H, sw, sh, scale) {
  // ordre de lecture : par rangées puis de gauche à droite
  boxes.sort((a, b) => a.y0 - b.y0);
  const rows = [];
  for (const b of boxes) {
    const row = rows.find((r) => b.y0 < r.yMax && b.y0 > r.y0 - ch * 3);
    if (row) { row.items.push(b); row.yMax = Math.max(row.yMax, (b.y0 + b.y1) / 2); }
    else rows.push({ y0: b.y0, yMax: (b.y0 + b.y1) / 2, items: [b] });
  }
  const ordered = rows.flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));

  const pad = ch * 1.2;
  return ordered.map((b) => {
    const x0 = Math.max(0, (b.x0 - pad) * scale), y0 = Math.max(0, (b.y0 - pad) * scale);
    const x1 = Math.min(sw, (b.x1 + 1 + pad) * scale), y1 = Math.min(sh, (b.y1 + 1 + pad) * scale);
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  });
}

export function cropRect(source, r) {
  const c = makeCanvas(r.w, r.h);
  c.getContext('2d').drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}
