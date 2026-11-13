// Lecture d'un certificat d'immatriculation (carte grise) français.
// Les rubriques utiles :
//   A    numéro d'immatriculation
//   C.3  adresse du titulaire (code postal + commune)
//   D.1  marque
//   D.3  dénomination commerciale (modèle)
//   P.6  puissance administrative (CV)
// Comme pour les tickets, ce ne sont que des propositions à vérifier.

const SIV = /\b([A-HJ-NP-TV-Z]{2})\s?[-–]?\s?(\d{3})\s?[-–]?\s?([A-HJ-NP-TV-Z]{2})\b/;
const FNI = /\b(\d{1,4})\s?([A-Z]{1,3})\s?(\d{2}|2A|2B)\b/;

function after(lines, labelRe) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (m) {
      const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:.)-]+/, '').trim();
      return { rest, next: lines[i + 1] || '', index: i };
    }
  }
  return null;
}

const clean = (s) => s.replace(/[|_«»"“”]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^A-Z0-9À-Ü]+/, '');

export function parseCarteGrise(text) {
  const up = text.toUpperCase();
  const lines = up.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = { immatriculation: '', marque: '', type: '', puissance: '', adresse: '', commune: '' };

  // A : immatriculation (de préférence sur la ligne de la rubrique A)
  const a = after(lines, /(^|\s)A\s?[.,]?\s(?=[A-Z0-9])/);
  const immatSrc = [a && a.rest, up].filter(Boolean);
  for (const src of immatSrc) {
    const m = src.match(SIV);
    if (m) { out.immatriculation = `${m[1]}-${m[2]}-${m[3]}`; break; }
  }
  if (!out.immatriculation && a) {
    const m = a.rest.match(FNI);
    if (m) out.immatriculation = `${m[1]} ${m[2]} ${m[3]}`;
  }

  // D.1 marque, D.3 modèle
  const d1 = after(lines, /\bD\s?[.,]?\s?1\b/);
  if (d1) out.marque = clean(d1.rest.split(/\bD\s?[.,]?\s?[23]\b/)[0]);
  const d3 = after(lines, /\bD\s?[.,]?\s?3\b/);
  if (d3) out.type = clean(d3.rest.split(/\b[EFGJK]\s?[.,]?\s?\d\b/)[0]);

  // P.6 puissance administrative
  // « P.6 » est souvent lu « P6 », « PE », « P.G »…
  const p6 = after(lines, /\bP\s?[.,:]?\s?[6EGB]\b/);
  if (p6) {
    const m = p6.rest.match(/^(\d{1,2})\b/) || p6.rest.match(/\b(\d{1,2})\b/);
    if (m) out.puissance = m[1];
  }

  // C.3 adresse : la ligne de la rubrique et la suivante, jusqu'au code postal + commune
  const c3 = after(lines, /\bC\s?[.,]?\s?3\b/);
  const cpRe = /\b(\d{5})\s+([A-ZÀ-Ü][A-ZÀ-Ü' -]{1,40})/;
  let cpLine = -1, cp = null;
  if (c3) {
    for (let i = c3.index; i <= Math.min(lines.length - 1, c3.index + 2) && !cp; i++) {
      const src = i === c3.index ? c3.rest : lines[i];
      const m = src.match(cpRe);
      if (m) { cp = m; cpLine = i; }
    }
  }
  if (!cp) {
    const i = lines.findIndex((l) => /\b(38|73)\d{3}\s+[A-Z]/.test(l));
    if (i >= 0) { cp = lines[i].match(cpRe); cpLine = i; }
  }
  if (cp) {
    // la commune s'arrête avant une éventuelle rubrique suivante (« D.1 », « E. »…)
    const commune = clean(cp[2].replace(/\b(CEDEX|FRANCE)\b.*$/, '').trim().replace(/\s[A-Z]$/, '').split(/\s{2,}|\s[A-Z]\s?[.,]?\s?\d\b|\s[A-Z]\.\s/)[0]);
    out.commune = commune.toLowerCase().replace(/(^|[\s'-])([a-zà-ü])/g, (m, a, b) => a + b.toUpperCase());
    const parts = [];
    if (c3) for (let i = c3.index; i < cpLine; i++) parts.push(i === c3.index ? c3.rest : lines[i]);
    const street = c3 && cpLine === c3.index ? c3.rest.slice(0, c3.rest.indexOf(cp[1])) : parts.join(' ');
    out.adresse = clean(`${street} ${cp[1]} ${commune}`);
  }
  return out;
}
