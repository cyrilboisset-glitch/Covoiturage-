// Outils d'image : chargement, redimensionnement, rotation, recadrage,
// compression, préparation OCR et extraction de signature.

export async function loadImage(src) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img; // l'orientation EXIF est appliquée par le navigateur
  } finally {
    if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Dessine une source (image/canvas) dans un canvas dont le plus grand côté <= maxSide
export function toCanvas(source, maxSide = Infinity, crop = null) {
  const sw = crop ? crop.w : (source.naturalWidth || source.width);
  const sh = crop ? crop.h : (source.naturalHeight || source.height);
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = makeCanvas(sw * scale, sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (crop) ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  else ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function rotate90(source) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const c = makeCanvas(h, w);
  const ctx = c.getContext('2d');
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion image impossible'))), type, quality);
  });
}

// Image stockée sur le téléphone : JPEG, 1800 px max.
export async function compressForStorage(source) {
  return canvasToBlob(toCanvas(source, 1800), 'image/jpeg', 0.82);
}

// Image pour le PDF : plus petite, éventuellement en niveaux de gris.
export async function compressForPdf(blob, maxSide, quality, gray) {
  const img = await loadImage(blob);
  const c = toCanvas(img, maxSide);
  if (gray) {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      p[i] = p[i + 1] = p[i + 2] = y;
    }
    ctx.putImageData(d, 0, 0);
  }
  const out = await canvasToBlob(c, 'image/jpeg', quality);
  return { bytes: new Uint8Array(await out.arrayBuffer()), width: c.width, height: c.height };
}

// Prépare une image pour l'OCR : niveaux de gris + étirement du contraste.
export function prepareForOcr(source) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  // largeur cible ~1400 px (texte de ticket lisible sans être trop lourd)
  const scale = Math.max(0.4, Math.min(2, 1400 / sw));
  const c = makeCanvas(sw * scale, sh * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) {
    const y = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) | 0;
    p[i] = y;
    hist[y]++;
  }
  const n = p.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((p[i] - lo) * 255) / range));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// Signature photographiée sur feuille blanche -> PNG recadré, fond transparent.
export async function extractSignature(source) {
  const c = toCanvas(source, 1600);
  const W = c.width, H = c.height;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, W, H);
  const p = d.data;
  const lum = new Float32Array(W * H);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];

  // Normalisation de l'éclairage : on estime le « blanc » local du papier
  // (maximum sur des blocs) pour compenser les ombres.
  const B = 32;
  const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const vals = [];
      for (let y = by * B; y < Math.min(H, by * B + B); y += 2)
        for (let x = bx * B; x < Math.min(W, bx * B + B); x += 2) vals.push(lum[y * W + x]);
      vals.sort((a, b) => a - b);
      bg[by * bw + bx] = vals[Math.floor(vals.length * 0.9)] || 255;
    }
  }
  const bgAt = (x, y) => {
    // interpolation bilinéaire entre centres de blocs
    const fx = Math.max(0, Math.min(bw - 1, x / B - 0.5));
    const fy = Math.max(0, Math.min(bh - 1, y / B - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    return (bg[y0 * bw + x0] * (1 - ax) + bg[y0 * bw + x1] * ax) * (1 - ay) +
           (bg[y1 * bw + x0] * (1 - ax) + bg[y1 * bw + x1] * ax) * ay;
  };
  const ink = new Float32Array(W * H); // 0 = papier, 1 = encre
  const hist = new Uint32Array(256);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = y * W + x;
      const r = Math.min(1, lum[j] / Math.max(1, bgAt(x, y)));
      const v = Math.round((1 - r) * 255);
      ink[j] = v;
      hist[v]++;
    }
  }
  let thr = otsu(hist, W * H);
  thr = Math.max(thr, 40); // évite de prendre le grain du papier pour de l'encre

  // Boîte englobante en ignorant une marge (bords de feuille, ombres)
  const mx = Math.round(W * 0.03), my = Math.round(H * 0.03);
  const colCount = new Uint32Array(W), rowCount = new Uint32Array(H);
  for (let y = my; y < H - my; y++)
    for (let x = mx; x < W - mx; x++)
      if (ink[y * W + x] > thr) { colCount[x]++; rowCount[y]++; }
  const minC = 2;
  const span = (arr, lo, hi) => {
    let a = lo, b = hi - 1;
    while (a < b && arr[a] < minC) a++;
    while (b > a && arr[b] < minC) b--;
    return [a, b];
  };
  const [x0, x1] = span(colCount, mx, W - mx);
  const [y0, y1] = span(rowCount, my, H - my);
  if (x1 - x0 < 20 || y1 - y0 < 10) throw new Error('Aucune signature détectée. Signez au feutre noir sur une feuille blanche et cadrez de plus près.');

  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 4;
  const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad);
  const cx1 = Math.min(W - 1, x1 + pad), cy1 = Math.min(H - 1, y1 + pad);
  const out = makeCanvas(cx1 - cx0 + 1, cy1 - cy0 + 1);
  const octx = out.getContext('2d');
  const od = octx.createImageData(out.width, out.height);
  const q = od.data;
  const soft = thr * 0.6;
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const j = y * W + x;
      const k = ((y - cy0) * out.width + (x - cx0)) * 4;
      const v = ink[j];
      let a = 0;
      if (v >= thr) a = 255;
      else if (v > soft) a = Math.round(((v - soft) / (thr - soft)) * 255);
      // couleur de l'encre conservée mais assombrie pour bien ressortir
      q[k] = Math.round(p[j * 4] * 0.5);
      q[k + 1] = Math.round(p[j * 4 + 1] * 0.5);
      q[k + 2] = Math.round(p[j * 4 + 2] * 0.5);
      q[k + 3] = a;
    }
  }
  octx.putImageData(od, 0, 0);
  return canvasToBlob(fitCanvas(out, 900), 'image/png');
}

function fitCanvas(c, maxSide) {
  if (Math.max(c.width, c.height) <= maxSide) return c;
  const s = maxSide / Math.max(c.width, c.height);
  const o = makeCanvas(c.width * s, c.height * s);
  const ctx = o.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

// Recadre un canvas transparent autour des pixels non transparents.
export function trimTransparent(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const p = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (p[(y * W + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const o = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  o.getContext('2d').drawImage(canvas, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
