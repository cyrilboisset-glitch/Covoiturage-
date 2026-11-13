import * as store from './store.js';
import { EQUIPES, FUELS } from './layout.js';
import { formatEuros, parseEuros, centsToInput, formatDateFr, todayIso, escapeHtml } from './format.js';
import { loadImage, toCanvas, rotate90, compressForStorage, extractSignature, trimTransparent, canvasToBlob } from './imaging.js';
import { recognize } from './ocr.js';
import { detectTickets, cropRect } from './segment.js';
import { buildPdf, checkTemplate } from './pdf.js';

const $ = (sel) => document.querySelector(sel);
const state = {
  settings: { nom: '', prenom: '', equipage: '', equipe: '' },
  signature: null, // Blob PNG
  template: null, // Blob PDF du justificatif vierge
  tickets: [],
  docs: [],
  year: new Date().getFullYear(),
};

// ---------------------------------------------------------------------------
// Navigation entre écrans (le bouton « retour » du téléphone fonctionne)

const stack = ['home'];
// mode : 'push' (nouvel écran), 'replace' (remplace l'écran courant), 'none'
function show(id, mode = 'push') {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  if (mode === 'push' && stack[stack.length - 1] !== id) {
    stack.push(id);
    history.pushState({ depth: stack.length - 1 }, '');
  } else if (mode === 'replace') {
    stack[stack.length - 1] = id;
  }
  window.scrollTo(0, 0);
}
let replaceNext = false; // le prochain show() remplace l'écran courant
function showNext(id) { show(id, replaceNext ? 'replace' : 'push'); replaceNext = false; }
function back() { history.back(); }
window.addEventListener('popstate', (e) => {
  const depth = (e.state && e.state.depth) || 0;
  stack.length = Math.min(stack.length, depth + 1);
  const id = stack[stack.length - 1] || 'home';
  show(id, 'none');
  if (id === 'home') renderHome();
});
// Retour à l'accueil en vidant la pile
function goHome() {
  const n = stack.length - 1;
  if (n > 0) history.go(-n); else { show('home', 'none'); renderHome(); }
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------------------------------------------------------------------------
// Chargement

async function loadAll() {
  state.settings = { ...state.settings, ...((await store.kvGet('settings')) || {}) };
  state.signature = (await store.kvGet('signature')) || null;
  state.template = (await store.kvGet('template')) || null;
  // version « fichier unique » : justificatif éventuellement embarqué
  if (!state.template && window.__INLINE__ && window.__INLINE__.has('template')) {
    state.template = new Blob([window.__INLINE__.bytes('template')], { type: 'application/pdf' });
  }
  state.tickets = await store.getAll('tickets');
  state.docs = await store.getAll('docs');
  const y = await store.kvGet('year');
  if (y) state.year = y;
}

function settingsComplete() {
  const s = state.settings;
  return s.nom && s.prenom && s.equipe && state.signature;
}

// ---------------------------------------------------------------------------
// Accueil

function ticketsOfYear() {
  return state.tickets
    .filter((t) => t.date.startsWith(String(state.year)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

const thumbUrls = new Map();
function thumbUrl(obj) {
  const key = obj.id + ':' + (obj.updatedAt || obj.createdAt);
  if (!thumbUrls.has(key)) thumbUrls.set(key, URL.createObjectURL(obj.image));
  return thumbUrls.get(key);
}

function renderHome() {
  // années disponibles
  const years = new Set([new Date().getFullYear(), state.year, ...state.tickets.map((t) => +t.date.slice(0, 4))]);
  const sel = $('#year-select');
  sel.innerHTML = [...years].sort((a, b) => b - a).map((y) => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}</option>`).join('');

  const missing = [];
  if (!state.settings.nom || !state.settings.prenom) missing.push('nom et prénom');
  if (!state.settings.equipe) missing.push('équipe');
  if (!state.signature) missing.push('signature');
  if (!state.template) missing.push('justificatif vierge (PDF)');
  const w = $('#setup-warning');
  w.hidden = !missing.length;
  w.innerHTML = missing.length ? `À compléter dans les <a href="#" id="go-settings">Réglages</a> : ${missing.join(', ')}.` : '';
  if (missing.length) $('#go-settings').onclick = (e) => { e.preventDefault(); openSettings(); };

  const list = ticketsOfYear();
  const total = list.reduce((s, t) => s + t.amount, 0);
  $('#total-value').textContent = formatEuros(total);
  $('#total-sub').textContent = list.length ? `${list.length} ticket${list.length > 1 ? 's' : ''} en ${state.year}` : `Aucun ticket en ${state.year}`;

  $('#ticket-empty').hidden = list.length > 0;
  $('#ticket-list').innerHTML = list.map((t) => `
    <li class="item" data-id="${t.id}">
      <img src="${thumbUrl(t)}" alt="" loading="lazy">
      <div class="item-main">
        <div class="item-title">${formatDateFr(t.date)}</div>
        <div class="item-sub">${escapeHtml(t.fuel)}</div>
      </div>
      <div class="item-amount">${formatEuros(t.amount)}</div>
    </li>`).join('');
  $('#ticket-list').querySelectorAll('.item').forEach((li) => {
    li.addEventListener('click', () => editTicket(state.tickets.find((t) => t.id === li.dataset.id)));
  });

  $('#doc-list').innerHTML = state.docs.map((d) => `
    <li class="item" data-id="${d.id}">
      <img src="${thumbUrl(d)}" alt="" loading="lazy">
      <div class="item-main"><div class="item-title">${escapeHtml(d.name)}</div><div class="item-sub">Modifier, remplacer ou supprimer</div></div>
    </li>`).join('');
  $('#doc-list').querySelectorAll('.item').forEach((li) => {
    li.addEventListener('click', () => editDoc(state.docs.find((d) => d.id === li.dataset.id)));
  });
}

$('#year-select').addEventListener('change', async (e) => {
  state.year = +e.target.value;
  await store.kvSet('year', state.year);
  renderHome();
});
$('#btn-settings').addEventListener('click', () => openSettings());

// ---------------------------------------------------------------------------
// Choix d'une image (appareil photo ou galerie)

function pickImage(title = 'Ajouter une image') {
  return new Promise((resolve) => {
    const picker = $('#picker');
    $('#picker-title').textContent = title;
    picker.hidden = false;
    const done = (v) => { picker.hidden = true; cleanup(); resolve(v); };
    const fromInput = (input) => {
      input.value = '';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
      picker.hidden = true;
      cleanup();
    };
    const onCam = () => fromInput($('#cam-input'));
    const onGal = () => fromInput($('#gal-input'));
    const onCancel = () => done(null);
    const onBackdrop = (e) => { if (e.target === picker) done(null); };
    function cleanup() {
      $('#pick-camera').removeEventListener('click', onCam);
      $('#pick-gallery').removeEventListener('click', onGal);
      $('#pick-cancel').removeEventListener('click', onCancel);
      picker.removeEventListener('click', onBackdrop);
    }
    $('#pick-camera').addEventListener('click', onCam);
    $('#pick-gallery').addEventListener('click', onGal);
    $('#pick-cancel').addEventListener('click', onCancel);
    picker.addEventListener('click', onBackdrop);
  });
}

// ---------------------------------------------------------------------------
// Recadrage / rotation

let editorResolve = null;
const ed = { img: null, crop: null, scale: 1 };

function cropEditor(source, title = 'Recadrer') {
  return new Promise((resolve) => {
    editorResolve = resolve;
    ed.img = source;
    $('#editor-title').textContent = title;
    show('editor');
    requestAnimationFrame(() => layoutEditor(true));
  });
}

function layoutEditor(resetCrop) {
  const stage = $('#editor-stage');
  const canvas = $('#editor-canvas');
  const iw = ed.img.naturalWidth || ed.img.width;
  const ih = ed.img.naturalHeight || ed.img.height;
  const maxW = stage.clientWidth - 24;
  const maxH = stage.clientHeight - 24;
  ed.scale = Math.min(maxW / iw, maxH / ih);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${iw * ed.scale}px`;
  canvas.style.height = `${ih * ed.scale}px`;
  canvas.width = Math.round(iw * ed.scale * dpr);
  canvas.height = Math.round(ih * ed.scale * dpr);
  canvas.getContext('2d').drawImage(ed.img, 0, 0, canvas.width, canvas.height);
  if (resetCrop || !ed.crop) ed.crop = { x: 0, y: 0, w: iw, h: ih };
  drawCropBox();
}

function drawCropBox() {
  const canvas = $('#editor-canvas');
  const box = $('#crop-box');
  const r = canvas.getBoundingClientRect();
  const sr = $('#editor-stage').getBoundingClientRect();
  box.style.left = `${r.left - sr.left + ed.crop.x * ed.scale}px`;
  box.style.top = `${r.top - sr.top + ed.crop.y * ed.scale}px`;
  box.style.width = `${ed.crop.w * ed.scale}px`;
  box.style.height = `${ed.crop.h * ed.scale}px`;
}

(function setupCropDrag() {
  const box = $('#crop-box');
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    const handle = e.target.classList.contains('h') ? [...e.target.classList].find((c) => c !== 'h') : 'move';
    drag = { handle, x: e.clientX, y: e.clientY, start: { ...ed.crop } };
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const iw = ed.img.naturalWidth || ed.img.width;
    const ih = ed.img.naturalHeight || ed.img.height;
    const dx = (e.clientX - drag.x) / ed.scale;
    const dy = (e.clientY - drag.y) / ed.scale;
    const s = drag.start;
    const min = Math.max(30, Math.min(iw, ih) * 0.05);
    let { x, y, w, h } = s;
    if (drag.handle === 'move') {
      x = Math.max(0, Math.min(iw - w, s.x + dx));
      y = Math.max(0, Math.min(ih - h, s.y + dy));
    } else {
      let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
      if (drag.handle.includes('l')) x0 = Math.max(0, Math.min(x1 - min, s.x + dx));
      if (drag.handle.includes('r')) x1 = Math.min(iw, Math.max(x0 + min, s.x + s.w + dx));
      if (drag.handle.includes('t')) y0 = Math.max(0, Math.min(y1 - min, s.y + dy));
      if (drag.handle.includes('b')) y1 = Math.min(ih, Math.max(y0 + min, s.y + s.h + dy));
      x = x0; y = y0; w = x1 - x0; h = y1 - y0;
    }
    ed.crop = { x, y, w, h };
    drawCropBox();
  });
  const end = () => { drag = null; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (!$('#editor').hidden) layoutEditor(false); });
})();

$('#btn-rotate').addEventListener('click', () => {
  ed.img = rotate90(ed.img);
  layoutEditor(true);
});
$('#btn-crop-reset').addEventListener('click', () => layoutEditor(true));
$('#btn-crop-ok').addEventListener('click', () => {
  const c = ed.crop;
  const out = toCanvas(ed.img, Infinity, { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) });
  const r = editorResolve;
  editorResolve = null;
  r && r(out);
});

// Photo -> recadrage -> canvas (ou null si annulé)
async function captureImage(title) {
  const file = await pickImage(title);
  if (!file) return null;
  let img;
  try { img = await loadImage(file); } catch (_) { toast('Image illisible.'); return null; }
  // on réduit d'abord : les photos de 12 Mpx sont lentes à manipuler
  return cropEditor(toCanvas(img, 2400), 'Recadrer');
}

// ---------------------------------------------------------------------------
// Tickets

const tk = { id: null, blob: null, canvas: null, ocrRun: 0, touched: new Set(), createdAt: null };

function fillFuelSelect(current) {
  const sel = $('#t-fuel');
  const opts = ['<option value="">— Choisir —</option>', ...FUELS.map((f) => `<option>${f}</option>`), '<option value="__autre">Autre…</option>'];
  sel.innerHTML = opts.join('');
  if (current && !FUELS.includes(current)) {
    sel.value = '__autre';
    $('#t-fuel-other').value = current;
  } else {
    sel.value = current || '';
    $('#t-fuel-other').value = '';
  }
  $('#t-fuel-other-wrap').hidden = sel.value !== '__autre';
}

function setAuto(el, on) { el.classList.toggle('auto', on); }

function openTicketForm({ id = null, blob, canvas = null, date = '', fuel = '', amount = null, createdAt = null }) {
  tk.id = id; tk.blob = blob; tk.canvas = canvas; tk.createdAt = createdAt; tk.touched = new Set();
  tk.ocrRun++;
  const b = tk.batch;
  $('#ticket-title').innerHTML = b
    ? `Vérifier le ticket <span class="batch-badge">${b.index + 1} / ${b.items.length}</span>`
    : (id ? 'Modifier le ticket' : 'Vérifier le ticket');
  const img = $('#ticket-img');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(blob);
  img.src = img.dataset.url;
  $('#t-date').value = date;
  $('#t-date').max = todayIso();
  fillFuelSelect(fuel);
  $('#t-amount').value = centsToInput(amount);
  ['#t-date', '#t-fuel', '#t-amount'].forEach((s) => setAuto($(s), false));
  $('#ocr-status').hidden = true;
  $('#other-items').hidden = true;
  $('#amount-candidates').hidden = true;
  $('#t-checked').checked = false;
  $('#btn-ticket-delete').hidden = !id;
  $('#btn-ticket-retake').textContent = b ? 'Ignorer' : (id ? 'Changer la photo' : 'Reprendre');
  $('#btn-ticket-save').textContent = b && b.index < b.items.length - 1 ? 'Valider → suivant' : 'Valider';
  updateTicketValidity();
  showNext('ticket');
}

async function addTicket() {
  tk.batch = null;
  const canvas = await captureImage('Photographier le ticket');
  if (!canvas) { if (!$('#editor').hidden) back(); return; }
  const blob = await compressForStorage(canvas);
  // on remplace l'écran de recadrage par celui du ticket
  replaceNext = true;
  openTicketForm({ blob, canvas });
  runOcr(canvas);
}

function editTicket(t) {
  if (!t) return;
  tk.batch = null;
  openTicketForm({ id: t.id, blob: t.image, date: t.date, fuel: t.fuel, amount: t.amount, createdAt: t.createdAt });
}

async function runOcr(canvas) {
  const run = ++tk.ocrRun;
  const status = $('#ocr-status');
  status.hidden = false;
  status.className = 'banner info';
  status.textContent = 'Lecture du ticket en cours… Vous pouvez déjà saisir les valeurs.';
  try {
    const res = await recognize(canvas, (m) => {
      if (run !== tk.ocrRun) return;
      if (m.status === 'recognizing text') status.textContent = `Lecture du ticket… ${Math.round(m.progress * 100)} %`;
      else if (m.status && m.status.includes('load')) status.textContent = 'Préparation de la lecture automatique…';
    });
    if (run !== tk.ocrRun) return;
    applyOcr(res);
  } catch (err) {
    console.error(err);
    if (run !== tk.ocrRun) return;
    status.className = 'banner info';
    status.textContent = 'Lecture automatique indisponible. Saisissez les valeurs du ticket.';
  }
}

function applyOcr(res) {
  const status = $('#ocr-status');
  status.hidden = false;
  const found = [];
  if (res.date && !tk.touched.has('date')) { $('#t-date').value = res.date; setAuto($('#t-date'), true); found.push('date'); }
  if (res.fuel && !tk.touched.has('fuel')) { fillFuelSelect(res.fuel); setAuto($('#t-fuel'), true); found.push('carburant'); }
  if (res.amount != null && !tk.touched.has('amount')) { $('#t-amount').value = centsToInput(res.amount); setAuto($('#t-amount'), true); found.push('montant'); }
  status.className = found.length ? 'banner warn' : 'banner info';
  status.textContent = found.length
    ? `Lu automatiquement : ${found.join(', ')}. Les champs en orange sont à vérifier avec le ticket.`
    : 'Rien n\'a pu être lu automatiquement. Saisissez les valeurs du ticket.';
  const o = $('#other-items');
  o.hidden = !res.otherItems.length;
  if (res.otherItems.length) {
    o.innerHTML = `<b>Attention :</b> ce ticket semble contenir autre chose que du carburant (${escapeHtml(res.otherItems.slice(0, 4).join(', ').toLowerCase())}). Indiquez uniquement le montant du carburant.`;
  }
  renderCandidates(res.candidates);
  updateTicketValidity();
}

function renderCandidates(cands) {
  const box = $('#amount-candidates');
  if (!cands || cands.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="cand-title">Montants trouvés sur le ticket (touchez pour choisir) :</div>' +
    cands.map((c) => `<button type="button" class="chip" data-c="${c.cents}"><b>${formatEuros(c.cents)}</b><small>${escapeHtml(c.label.toLowerCase())}</small></button>`).join('');
  box.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    $('#t-amount').value = centsToInput(+b.dataset.c);
    tk.touched.add('amount');
    setAuto($('#t-amount'), false);
    updateTicketValidity();
  }));
}

function currentFuel() {
  const v = $('#t-fuel').value;
  return v === '__autre' ? $('#t-fuel-other').value.trim() : v;
}

function updateTicketValidity() {
  const date = $('#t-date').value;
  const amount = parseEuros($('#t-amount').value);
  const fuel = currentFuel();
  const ok = date && date <= todayIso() && amount != null && amount > 0 && fuel && $('#t-checked').checked;
  $('#btn-ticket-save').disabled = !ok;
  // doublon probable
  const dup = date && amount != null && state.tickets.find((t) => t.id !== tk.id && t.date === date && t.amount === amount);
  const dw = $('#dup-warning');
  dw.hidden = !dup;
  if (dup) dw.textContent = `Un ticket du ${formatDateFr(date)} de ${formatEuros(amount)} existe déjà. Vérifiez qu'il ne s'agit pas d'un doublon.`;
}

for (const [sel, key] of [['#t-date', 'date'], ['#t-fuel', 'fuel'], ['#t-amount', 'amount'], ['#t-fuel-other', 'fuel']]) {
  $(sel).addEventListener('input', () => {
    tk.touched.add(key);
    setAuto($(sel === '#t-fuel-other' ? '#t-fuel' : sel), false);
    if (sel === '#t-fuel') $('#t-fuel-other-wrap').hidden = $('#t-fuel').value !== '__autre';
    updateTicketValidity();
  });
}
$('#t-fuel').addEventListener('change', () => { $('#t-fuel-other-wrap').hidden = $('#t-fuel').value !== '__autre'; updateTicketValidity(); });
$('#t-checked').addEventListener('change', updateTicketValidity);
$('#t-amount').addEventListener('blur', () => {
  const c = parseEuros($('#t-amount').value);
  if (c != null) $('#t-amount').value = centsToInput(c);
});

$('#btn-ticket-save').addEventListener('click', async () => {
  const date = $('#t-date').value;
  const amount = parseEuros($('#t-amount').value);
  const fuel = currentFuel();
  if (!date || amount == null || amount <= 0 || !fuel || !$('#t-checked').checked) return;
  if (date > todayIso()) { toast('La date ne peut pas être dans le futur.'); return; }
  const t = {
    id: tk.id || store.newId(),
    date, fuel, amount,
    image: tk.blob,
    createdAt: tk.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await store.put('tickets', t);
  const i = state.tickets.findIndex((x) => x.id === t.id);
  if (i >= 0) state.tickets[i] = t; else state.tickets.push(t);
  tk.ocrRun++;
  // l'année affichée suit le ticket ajouté
  const y = +date.slice(0, 4);
  if (y !== state.year) { state.year = y; await store.kvSet('year', y); }
  if (tk.batch) { tk.batch.saved++; nextBatchItem(); return; }
  toast(`Ticket enregistré : ${formatEuros(amount)}`);
  goHome();
});

$('#btn-ticket-delete').addEventListener('click', async () => {
  if (!tk.id) return;
  if (!confirm('Supprimer définitivement ce ticket ?')) return;
  await store.del('tickets', tk.id);
  state.tickets = state.tickets.filter((t) => t.id !== tk.id);
  tk.ocrRun++;
  toast('Ticket supprimé.');
  goHome();
});

$('#btn-ticket-retake').addEventListener('click', async () => {
  if (tk.batch) { nextBatchItem(); return; } // « Ignorer »
  const canvas = await captureImage('Photographier le ticket');
  if (!canvas) { if (!$('#editor').hidden) back(); return; }
  tk.blob = await compressForStorage(canvas);
  back(); // ferme le recadrage
  const img = $('#ticket-img');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(tk.blob);
  img.src = img.dataset.url;
  $('#t-checked').checked = false;
  tk.touched = new Set();
  updateTicketValidity();
  runOcr(canvas);
});

// ---------------------------------------------------------------------------
// Plusieurs tickets sur une même photo

const bt = { image: null, rects: [], off: new Set(), url: null };

async function addBatch() {
  const file = await pickImage('Photographier les tickets');
  if (!file) return;
  let img;
  try { img = await loadImage(file); } catch (_) { toast('Image illisible.'); return; }
  bt.image = toCanvas(img, 3200);
  bt.rects = detectTickets(bt.image);
  bt.off = new Set();
  if (bt.url) URL.revokeObjectURL(bt.url);
  bt.url = URL.createObjectURL(await compressForStorage(bt.image));
  $('#batch-img').src = bt.url;
  renderBatchBoxes();
  $('#btn-batch-go').disabled = false;
  $('#btn-batch-retake').disabled = false;
  show('batch');
}

function renderBatchBoxes() {
  const W = bt.image.width, H = bt.image.height;
  $('#batch-boxes').innerHTML = bt.rects.map((r, i) => `
    <button type="button" class="bbox ${bt.off.has(i) ? 'off' : ''}" data-i="${i}"
      style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%"><span>${i + 1}</span></button>`).join('');
  $('#batch-boxes').querySelectorAll('.bbox').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    if (bt.off.has(i)) bt.off.delete(i); else bt.off.add(i);
    renderBatchBoxes();
  }));
  const n = bt.rects.length - bt.off.size;
  const info = $('#batch-info');
  info.className = bt.rects.length ? 'banner info' : 'banner warn';
  info.textContent = bt.rects.length
    ? `${bt.rects.length} ticket${bt.rects.length > 1 ? 's' : ''} détecté${bt.rects.length > 1 ? 's' : ''}. Vérifiez que chaque ticket a son propre cadre.`
    : 'Aucun ticket détecté. Posez les tickets bien à plat, sans qu\'ils se chevauchent, avec un peu d\'espace entre eux, et reprenez la photo.';
  $('#btn-batch-go').textContent = n ? `Lire ${n} ticket${n > 1 ? 's' : ''}` : 'Lire les tickets';
  $('#btn-batch-go').disabled = !n;
}

$('#btn-add-batch').addEventListener('click', addBatch);
$('#btn-batch-retake').addEventListener('click', () => { back(); setTimeout(addBatch, 50); });
$('#btn-batch-go').addEventListener('click', async () => {
  const chosen = bt.rects.filter((_, i) => !bt.off.has(i));
  if (!chosen.length) return;
  $('#btn-batch-go').disabled = true;
  $('#btn-batch-retake').disabled = true;
  const info = $('#batch-info');
  info.className = 'banner info';
  const items = [];
  for (let k = 0; k < chosen.length; k++) {
    info.textContent = `Lecture du ticket ${k + 1} / ${chosen.length}…`;
    const canvas = cropRect(bt.image, chosen[k]);
    let res = null;
    try {
      res = await recognize(canvas, (m) => {
        if (m.status === 'recognizing text') info.textContent = `Lecture du ticket ${k + 1} / ${chosen.length}… ${Math.round(m.progress * 100)} %`;
      });
    } catch (err) { console.error(err); }
    items.push({ canvas, blob: await compressForStorage(canvas), res, order: k });
  }
  // ordre chronologique (les dates non lues à la fin)
  items.sort((a, b) => {
    const da = a.res && a.res.date, db = b.res && b.res.date;
    if (da && db) return da.localeCompare(db) || a.order - b.order;
    if (da) return -1;
    if (db) return 1;
    return a.order - b.order;
  });
  tk.batch = { items, index: -1, saved: 0 };
  replaceNext = true;
  nextBatchItem();
});

function nextBatchItem() {
  const b = tk.batch;
  b.index++;
  if (b.index >= b.items.length) {
    const saved = b.saved, total = b.items.length;
    tk.batch = null;
    toast(`${saved} ticket${saved > 1 ? 's' : ''} enregistré${saved > 1 ? 's' : ''} sur ${total}.`, 3500);
    goHome();
    return;
  }
  const it = b.items[b.index];
  if (b.index > 0) replaceNext = true; // l'écran suivant remplace le précédent
  openTicketForm({ blob: it.blob, canvas: it.canvas });
  if (it.res) applyOcr(it.res);
  else {
    $('#ocr-status').hidden = false;
    $('#ocr-status').className = 'banner info';
    $('#ocr-status').textContent = 'Lecture automatique indisponible. Saisissez les valeurs du ticket.';
  }
}

$('#btn-ticket-zoom').addEventListener('click', () => openViewer($('#ticket-img').src));
$('#ticket-img').addEventListener('click', () => openViewer($('#ticket-img').src));
$('#btn-add-ticket').addEventListener('click', addTicket);

function openViewer(src) {
  $('#viewer-img').src = src;
  $('#viewer').hidden = false;
}
$('#viewer-close').addEventListener('click', () => { $('#viewer').hidden = true; });

// ---------------------------------------------------------------------------
// Autres documents

const dk = { id: null, blob: null, createdAt: null };

function openDocForm({ id = null, blob, name = '', createdAt = null }) {
  dk.id = id; dk.blob = blob; dk.createdAt = createdAt;
  const img = $('#doc-img');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(blob);
  img.src = img.dataset.url;
  $('#d-name').value = name;
  $('#btn-doc-delete').hidden = !id;
  showNext('doc');
  if (!name) setTimeout(() => $('#d-name').focus(), 300);
}

$('#btn-add-doc').addEventListener('click', async () => {
  const canvas = await captureImage('Photographier le document');
  if (!canvas) { if (!$('#editor').hidden) back(); return; }
  const blob = await compressForStorage(canvas);
  replaceNext = true;
  openDocForm({ blob });
});

function editDoc(d) { if (d) openDocForm({ id: d.id, blob: d.image, name: d.name, createdAt: d.createdAt }); }

$('#btn-doc-replace').addEventListener('click', async () => {
  const canvas = await captureImage('Photographier le document');
  if (!canvas) { if (!$('#editor').hidden) back(); return; }
  dk.blob = await compressForStorage(canvas);
  back();
  const img = $('#doc-img');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(dk.blob);
  img.src = img.dataset.url;
});

$('#btn-doc-save').addEventListener('click', async () => {
  const name = $('#d-name').value.trim();
  if (!name) { toast('Donnez un nom au document.'); $('#d-name').focus(); return; }
  const d = { id: dk.id || store.newId(), name, image: dk.blob, createdAt: dk.createdAt || Date.now(), updatedAt: Date.now() };
  await store.put('docs', d);
  const i = state.docs.findIndex((x) => x.id === d.id);
  if (i >= 0) state.docs[i] = d; else state.docs.push(d);
  toast('Document enregistré.');
  goHome();
});

$('#btn-doc-delete').addEventListener('click', async () => {
  if (!dk.id || !confirm('Supprimer définitivement ce document ?')) return;
  await store.del('docs', dk.id);
  state.docs = state.docs.filter((d) => d.id !== dk.id);
  toast('Document supprimé.');
  goHome();
});

// ---------------------------------------------------------------------------
// Réglages

let draftSignature; // signature en cours d'édition (undefined = inchangée)

function openSettings(firstRun = false) {
  const s = state.settings;
  $('#first-run-hint').hidden = !firstRun;
  $('#s-nom').value = s.nom || '';
  $('#s-prenom').value = s.prenom || '';
  $('#s-equipage').value = s.equipage || '';
  $('#s-equipe').innerHTML = EQUIPES.map((e) => `
    <label class="choice"><input type="radio" name="equipe" value="${e}" ${s.equipe === e ? 'checked' : ''}><span>${e}</span></label>`).join('');
  draftSignature = undefined;
  renderSigPreview();
  renderTplStatus();
  show('settings');
}

function renderSigPreview() {
  const sig = draftSignature !== undefined ? draftSignature : state.signature;
  const box = $('#sig-preview');
  if (box.dataset.url) URL.revokeObjectURL(box.dataset.url);
  if (sig) {
    box.dataset.url = URL.createObjectURL(sig);
    box.innerHTML = `<img src="${box.dataset.url}" alt="Signature">`;
  } else {
    box.innerHTML = '<span class="muted">Aucune signature</span>';
  }
  $('#btn-sig-delete').hidden = !sig;
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const equipe = (document.querySelector('input[name="equipe"]:checked') || {}).value || '';
  const s = {
    nom: $('#s-nom').value.trim(),
    prenom: $('#s-prenom').value.trim(),
    equipage: $('#s-equipage').value.trim(),
    equipe,
  };
  if (!s.nom || !s.prenom) { toast('Indiquez votre nom et votre prénom.'); return; }
  if (!s.equipe) { toast('Choisissez votre équipe.'); return; }
  state.settings = s;
  await store.kvSet('settings', s);
  if (draftSignature !== undefined) {
    state.signature = draftSignature;
    if (draftSignature) await store.kvSet('signature', draftSignature); else await store.kvDel('signature');
  }
  store.requestPersistence();
  toast(state.signature ? 'Réglages enregistrés.' : 'Réglages enregistrés. Pensez à ajouter votre signature.');
  goHome();
});

function renderTplStatus() {
  const st = $('#tpl-status');
  st.className = state.template ? 'banner info' : 'banner warn';
  st.textContent = state.template ? '✅ Justificatif vierge enregistré sur ce téléphone.' : 'Aucun justificatif vierge : importez le PDF fourni par l\'entreprise.';
  $('#btn-tpl-import').textContent = state.template ? '📄 Remplacer le justificatif vierge' : '📄 Importer le justificatif vierge';
}
$('#btn-tpl-import').addEventListener('click', () => { $('#tpl-input').value = ''; $('#tpl-input').click(); });
$('#tpl-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const blob = new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
    const info = await checkTemplate(blob);
    if (!info.ok && !confirm(`Ce PDF n'a pas le format attendu (${Math.round(info.width)} × ${Math.round(info.height)} pt au lieu de 612 × 792). Les valeurs risquent d'être mal placées. L'utiliser quand même ?`)) return;
    state.template = blob;
    await store.kvSet('template', blob);
    renderTplStatus();
    toast('Justificatif vierge enregistré.');
  } catch (err) {
    toast('PDF illisible : ' + (err.message || err), 4000);
  }
});

// Signature par photo
let sigCandidate = null;
let sigRedo = null;
async function signatureFromPhoto() {
  const canvas = await captureImage('Photographier la signature');
  if (!canvas) { if (!$('#editor').hidden) back(); return; }
  try {
    sigCandidate = await extractSignature(canvas);
  } catch (err) {
    toast(err.message || 'Signature introuvable.', 4500);
    back();
    return;
  }
  replaceNext = true;
  sigRedo = signatureFromPhoto;
  showSigCheck();
}

function showSigCheck() {
  const box = $('#sigcheck-preview');
  if (box.dataset.url) URL.revokeObjectURL(box.dataset.url);
  box.dataset.url = URL.createObjectURL(sigCandidate);
  box.innerHTML = `<img src="${box.dataset.url}" alt="Signature">`;
  showNext('sigcheck');
}

$('#btn-sig-photo').addEventListener('click', signatureFromPhoto);
$('#btn-sigcheck-ok').addEventListener('click', () => {
  draftSignature = sigCandidate;
  renderSigPreview();
  back();
  toast('Signature prête. Appuyez sur « Enregistrer ».');
});
$('#btn-sigcheck-redo').addEventListener('click', () => {
  back();
  setTimeout(() => sigRedo && sigRedo(), 50);
});
$('#btn-sig-delete').addEventListener('click', () => {
  if (!confirm('Supprimer la signature ?')) return;
  draftSignature = null;
  renderSigPreview();
});

// Signature au doigt
const pad = { ctx: null, drawing: false, last: null, empty: true };
function openSigPad() {
  show('sigpad');
  requestAnimationFrame(setupPadCanvas);
}
function setupPadCanvas() {
  const c = $('#sig-canvas');
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr);
  c.height = Math.round(r.height * dpr);
  pad.ctx = c.getContext('2d');
  pad.ctx.scale(dpr, dpr);
  pad.ctx.lineCap = 'round';
  pad.ctx.lineJoin = 'round';
  pad.ctx.strokeStyle = '#0d1f66';
  pad.ctx.lineWidth = 3;
  pad.empty = true;
}
(function setupPad() {
  const c = $('#sig-canvas');
  const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.addEventListener('pointerdown', (e) => {
    pad.drawing = true; pad.last = pos(e); c.setPointerCapture(e.pointerId);
    pad.ctx.beginPath(); pad.ctx.arc(pad.last.x, pad.last.y, 1.4, 0, Math.PI * 2); pad.ctx.fillStyle = '#0d1f66'; pad.ctx.fill();
    pad.empty = false; e.preventDefault();
  });
  c.addEventListener('pointermove', (e) => {
    if (!pad.drawing) return;
    const p = pos(e);
    const mid = { x: (pad.last.x + p.x) / 2, y: (pad.last.y + p.y) / 2 };
    pad.ctx.beginPath();
    pad.ctx.moveTo(pad.lastMid ? pad.lastMid.x : pad.last.x, pad.lastMid ? pad.lastMid.y : pad.last.y);
    pad.ctx.quadraticCurveTo(pad.last.x, pad.last.y, mid.x, mid.y);
    pad.ctx.stroke();
    pad.last = p; pad.lastMid = mid;
    e.preventDefault();
  });
  const end = () => { pad.drawing = false; pad.lastMid = null; };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (!$('#sigpad').hidden && pad.empty) setupPadCanvas(); });
})();
$('#btn-sig-draw').addEventListener('click', openSigPad);
$('#btn-sig-clear').addEventListener('click', setupPadCanvas);
$('#btn-sig-ok').addEventListener('click', async () => {
  if (pad.empty) { toast('Signez dans le cadre.'); return; }
  const trimmed = trimTransparent($('#sig-canvas'));
  if (!trimmed) { toast('Signez dans le cadre.'); return; }
  sigCandidate = await canvasToBlob(trimmed, 'image/png');
  replaceNext = true;
  sigRedo = openSigPad;
  showSigCheck();
});

// ---------------------------------------------------------------------------
// PDF

let pdfUrl = null;
let pdfBlob = null;
let pdfName = '';

function openPdfScreen() {
  const list = ticketsOfYear();
  const total = list.reduce((s, t) => s + t.amount, 0);
  const sheets = Math.max(1, Math.ceil(list.length / 16));
  const issues = [];
  if (!state.settings.nom || !state.settings.prenom) issues.push('nom et prénom manquants');
  if (!state.settings.equipe) issues.push('équipe non choisie');
  if (!state.signature) issues.push('signature manquante');
  if (!state.template) issues.push('justificatif vierge non importé (Réglages)');
  if (!list.length) issues.push(`aucun ticket en ${state.year}`);
  $('#pdf-summary').innerHTML = `
    <div class="sum-row"><span>Année</span><b>${state.year}</b></div>
    <div class="sum-row"><span>Justificatif${sheets > 1 ? 's' : ''} rempli${sheets > 1 ? 's' : ''}</span><b>${sheets} feuille${sheets > 1 ? 's' : ''}</b></div>
    <div class="sum-row"><span>Tickets</span><b>${list.length} (${Math.ceil(list.length / 9)} page${list.length > 9 ? 's' : ''})</b></div>
    <div class="sum-row"><span>Autres documents</span><b>${state.docs.length}</b></div>
    <div class="sum-row total"><span>Montant total</span><b>${formatEuros(total)}</b></div>
    ${issues.length ? `<div class="banner warn">À vérifier : ${issues.join(', ')}.</div>` : ''}
    <p class="hint">La case « DATE » à côté de la signature est laissée vide.</p>`;
  $('#pdf-progress').hidden = true;
  $('#pdf-result').hidden = true;
  $('#btn-pdf-generate').disabled = false;
  show('pdf');
}

$('#btn-pdf').addEventListener('click', openPdfScreen);

$('#btn-pdf-generate').addEventListener('click', async () => {
  const list = ticketsOfYear();
  if (!state.template) { toast('Importez d\'abord le justificatif vierge dans les Réglages.', 4000); return; }
  if (!list.length && !confirm(`Aucun ticket en ${state.year}. Générer quand même ?`)) return;
  if (!state.signature && !confirm('Aucune signature enregistrée. Générer quand même ?')) return;
  const btn = $('#btn-pdf-generate');
  btn.disabled = true;
  const prog = $('#pdf-progress');
  prog.hidden = false;
  prog.className = 'banner info';
  $('#pdf-result').hidden = true;
  try {
    pdfBlob = await buildPdf({
      template: state.template,
      settings: state.settings,
      signature: state.signature,
      tickets: list,
      docs: [...state.docs].sort((a, b) => a.createdAt - b.createdAt),
      onStep: (m) => { prog.textContent = m; },
    });
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(pdfBlob);
    const who = `${state.settings.nom}_${state.settings.prenom}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    pdfName = `Covoiturage_${state.year}${who ? '_' + who : ''}.pdf`;
    $('#btn-pdf-download').href = pdfUrl;
    $('#btn-pdf-download').download = pdfName;
    $('#btn-pdf-open').href = pdfUrl;
    $('#pdf-ok').textContent = `✅ ${pdfName} — ${(pdfBlob.size / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
    prog.hidden = true;
    $('#pdf-result').hidden = false;
    $('#btn-pdf-share').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([pdfBlob], pdfName, { type: 'application/pdf' })] }));
  } catch (err) {
    console.error(err);
    prog.className = 'banner error';
    prog.textContent = `Erreur pendant la génération : ${err.message || err}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Générer à nouveau';
  }
});

$('#btn-pdf-share').addEventListener('click', async () => {
  if (!pdfBlob) return;
  const file = new File([pdfBlob], pdfName, { type: 'application/pdf' });
  try {
    await navigator.share({ files: [file], title: pdfName });
  } catch (err) {
    if (err.name !== 'AbortError') toast('Partage impossible : utilisez « Enregistrer ».');
  }
});

// ---------------------------------------------------------------------------
// Sauvegarde / restauration

const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const dataUrlToBlob = async (url) => (await fetch(url)).blob();

$('#btn-export').addEventListener('click', async () => {
  toast('Préparation de la sauvegarde…');
  const data = {
    app: 'covoiturage-pde',
    format: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    signature: state.signature ? await blobToDataUrl(state.signature) : null,
    template: state.template ? await blobToDataUrl(state.template) : null,
    tickets: await Promise.all(state.tickets.map(async (t) => ({ ...t, image: await blobToDataUrl(t.image) }))),
    docs: await Promise.all(state.docs.map(async (d) => ({ ...d, image: await blobToDataUrl(d.image) }))),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `covoiturage-sauvegarde-${todayIso()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
});

$('#btn-import').addEventListener('click', () => { $('#import-input').value = ''; $('#import-input').click(); });
$('#import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { toast('Fichier de sauvegarde illisible.'); return; }
  if (!data || data.app !== 'covoiturage-pde') { toast('Ce fichier n\'est pas une sauvegarde de cette appli.'); return; }
  const n = (data.tickets || []).length, m = (data.docs || []).length;
  if (!confirm(`Restaurer cette sauvegarde (${n} tickets, ${m} documents) ?\nToutes les données actuelles de l'appli seront remplacées.`)) return;
  try {
    const tickets = await Promise.all((data.tickets || []).map(async (t) => ({ ...t, image: await dataUrlToBlob(t.image) })));
    const docs = await Promise.all((data.docs || []).map(async (d) => ({ ...d, image: await dataUrlToBlob(d.image) })));
    const signature = data.signature ? await dataUrlToBlob(data.signature) : null;
    const template = data.template ? await dataUrlToBlob(data.template) : null;
    await store.clear('tickets');
    await store.clear('docs');
    for (const t of tickets) await store.put('tickets', t);
    for (const d of docs) await store.put('docs', d);
    await store.kvSet('settings', data.settings || {});
    if (signature) await store.kvSet('signature', signature); else await store.kvDel('signature');
    if (template) await store.kvSet('template', template);
    await loadAll();
    renderHome();
    toast('Sauvegarde restaurée.');
  } catch (err) {
    console.error(err);
    toast('Restauration impossible : ' + (err.message || err), 4000);
  }
});

// ---------------------------------------------------------------------------
// Démarrage

(async function init() {
  history.replaceState({ depth: 0 }, '');
  await loadAll();
  renderHome();
  if (!state.settings.nom && !state.settings.prenom) openSettings(true);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
})();
