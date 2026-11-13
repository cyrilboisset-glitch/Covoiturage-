// Formats français : montants en centimes (entiers) pour éviter les erreurs d'arrondi.

export function formatEuros(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${euros},${String(abs % 100).padStart(2, '0')} €`;
}

// "45,3" / "45.30" / "45,30 €" -> 4530 ; null si invalide
export function parseEuros(str) {
  if (str == null) return null;
  const s = String(str).replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d{1,5}(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

export function centsToInput(cents) {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

// "2026-11-05" -> "05/11/2026"
export function formatDateFr(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function fuelLabel(fuel) {
  return `Carburant – ${fuel}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
